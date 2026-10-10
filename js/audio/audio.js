/* EMBERWHEEL — SD.Audio: synthesized SFX + generative ambient music.
 * Web Audio API only (oscillators, filtered noise buffers, envelopes, simple FM, convolver reverb from generated
 * impulse noise, compressor on master). No audio files, no libraries, works from file://.
 *
 * Contract (docs/ARCH.md "Audio contract"):
 *   SD.Audio.init()                            create/resume the AudioContext. Call on the first user gesture. Idempotent.
 *   SD.Audio.play(name, { pitch, vol, n, pan, delay })
 *                                              pitch: multiplier (1) · vol: multiplier (1) · n: index (reel_stop reel 0..3,
 *                                              doom_tick count 3..1) · pan: -1..1 · delay: seconds
 *   SD.Audio.setMusic(track, opts)             'title'|'camp'|'cellar'|'ossuary'|'gearworks'|'boss'|'backstage'|'kurite'|'victory'|'none'
 *                                              (opts.layer: the starting layer of a layered track)
 *   SD.Audio.setMusicLayer(n)                  a layered track (kurite) adds its instruments up to layer n (1..4), fading in
 *                                              1.5s crossfade; generative, loops forever.
 *   SD.Audio.setVolume({ master, music, sfx }) 0..1 slider positions (perceptual curve applied). Partial objects OK.
 *                                              Nothing is persisted — the caller stores settings.
 *   SD.Audio.duck(amount, seconds)             lower the music by `amount` (0..1) for `seconds`, then recover.
 * Before init(): play()/duck() are silent no-ops; setVolume()/setMusic() only remember the request and apply on init().
 * Extras (tools/tests): SD.Audio.SFX, SD.Audio.TRACKS, isReady(), getVolume(), getMusic(), voices(), musicInfo(), debug,
 *   render(nameOr'music:<track>', opts, seconds) -> Promise<AudioBuffer> (OfflineAudioContext, for previews/metering).
 */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});

  const SFX_NAMES = [
    'spin_start', 'reel_tick', 'reel_stop', 'anticipation', 'hold', 'unhold', 'respin', 'nudge', 'resolve',
    'blade', 'blade_big', 'flame', 'heal', 'ward', 'lantern', 'skull', 'enemy_hit', 'enemy_hit_big', 'party_hit', 'block',
    'armor_clank', 'burn', 'enemy_die', 'combo_pair', 'combo_triple', 'combo_bond', 'jackpot', 'seal_break', 'reaper',
    'hex', 'drain', 'jam', 'mark', 'reflect', 'enemy_heal', 'windup', 'doom_tick',
    'ui_hover', 'ui_click', 'ui_confirm', 'ui_deny', 'unlock', 'ember', 'spark_gain', 'spark_use', 'door', 'step',
    'reward', 'relic', 'second_wind', 'death', 'boss_appear', 'boss_phase', 'victory', 'near_miss', 'clack',
    'string_pluck', 'string_snap', 'lift_winch', 'drop_slam', 'mask_crack', 'curtain_fall', 'theater_collapse', 'music_box',
  ];
  const TRACKS = ['title', 'camp', 'cellar', 'ossuary', 'gearworks', 'boss', 'backstage', 'kurite', 'victory', 'none'];

  // ------------------------------------------------------------------ config / state
  const SFX_BASE = 0.9;      // sfx bus headroom
  const MUSIC_BASE = 1.0;    // music bus (track vols below keep it well under the SFX)
  const FADE = 1.5;          // music crossfade (s)
  const MAX_VOICES = 48;     // soft cap on simultaneous SFX voices
  const vol = { master: 0.8, music: 0.6, sfx: 0.8 };
  const curve = (v) => v * v; // slider position -> linear gain

  let G = null;              // active graph (main or a temporary offline one during render())
  let mainG = null;          // the realtime graph
  let pendingTrack = null, pendingLayer = 1; // (pendingLayer: the layer a layered track starts with)
  let active = 0;            // live sfx voices
  let endT = 0;              // latest end time scheduled by the current voice (for cleanup)
  const lastPlay = {}, burstN = {};
  const music = { name: 'none', cur: null, timer: null, plays: 0 };
  const duckState = { until: 0, depth: 1 };

  const rnd = Math.random;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const semi = (n) => Math.pow(2, n / 12);
  const wall = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) / 1000;
  const docHidden = () => typeof document !== 'undefined' && !!document.hidden;
  const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]; // major pentatonic (semitones)

  function makeRng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ------------------------------------------------------------------ buffers
  // Loop-safe noise: generate len+X samples and crossfade the tail into the head so looping never clicks.
  function makeNoise(ac, kind, secs) {
    const sr = ac.sampleRate || 44100, len = Math.floor(sr * secs), X = Math.floor(sr * 0.05);
    const raw = new Float32Array(len + X);
    let b0 = 0, b1 = 0, b2 = 0, br = 0, sq = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = rnd() * 2 - 1;
      let v;
      if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        v = b0 + b1 + b2 + w * 0.1848;
      } else if (kind === 'brown') {
        br = (br + 0.02 * w) / 1.02; v = br;
      } else v = w;
      raw[i] = v; sq += v * v;
    }
    const k = 0.5 / Math.sqrt(sq / raw.length || 1); // normalise every colour to the same RMS
    const buf = ac.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      let v = raw[i];
      if (i < X) { const w = i / X; v = raw[i] * w + raw[len + i] * (1 - w); }
      d[i] = clamp(v * k, -1, 1);
    }
    return buf;
  }
  // Stone-room impulse: a few early reflections + noise tail that darkens as it decays.
  function makeIR(ac, secs, shape, pre, bright, dark) {
    const sr = ac.sampleRate || 44100, len = Math.max(64, Math.floor(sr * secs)), preN = Math.floor(sr * pre);
    const buf = ac.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0, a = 0;
      for (let i = preN; i < len; i++) {
        const x = (i - preN) / (len - preN);
        if (((i - preN) & 63) === 0) a = 1 - Math.exp((-2 * Math.PI * bright * Math.pow(dark / bright, x)) / sr);
        lp += a * (rnd() * 2 - 1 - lp);
        d[i] = lp * Math.pow(1 - x, shape) * 2.2;
      }
      for (let k = 0; k < 7; k++) {
        const idx = preN + Math.floor(sr * (0.006 + k * 0.0105 + rnd() * 0.006));
        if (idx < len) d[idx] += (rnd() < 0.5 ? -1 : 1) * 0.45 * Math.pow(0.72, k);
      }
    }
    return buf;
  }

  // ------------------------------------------------------------------ graph
  //   voices ─┬─────────────────────► sfx ─┐
  //           └─ wet ─► sfxRev ─────► sfx  │
  //   track.out ─┬──────────────────► music ─► duck ─┤
  //              └─ wet ─► musicRev ► music          ├─► pre ─► hp ─► shelf ─► comp ─► master ─► out
  function buildGraph(ac, share) {
    const g = { ctx: ac, sr: ac.sampleRate || 44100 };
    const reuse = !!(share && share.sr === g.sr);
    g.white = reuse ? share.white : makeNoise(ac, 'white', 3);
    g.pink = reuse ? share.pink : makeNoise(ac, 'pink', 3);
    g.brown = reuse ? share.brown : makeNoise(ac, 'brown', 3);
    g.irS = reuse ? share.irS : makeIR(ac, 1.4, 3.4, 0.006, 5000, 700);
    g.irM = reuse ? share.irM : makeIR(ac, 3.4, 2.4, 0.022, 3400, 450);

    g.master = ac.createGain(); g.master.gain.value = curve(vol.master);
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.2; comp.attack.value = 0.004; comp.release.value = 0.2;
    const shelf = ac.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 6800; shelf.gain.value = -4;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 30; hp.Q.value = 0.6;
    g.pre = ac.createGain();
    g.pre.connect(hp); hp.connect(shelf); shelf.connect(comp); comp.connect(g.master); g.master.connect(ac.destination);

    g.sfx = ac.createGain(); g.sfx.gain.value = curve(vol.sfx) * SFX_BASE; g.sfx.connect(g.pre);
    g.sfxRev = ac.createConvolver(); g.sfxRev.buffer = g.irS;
    const sr = ac.createGain(); sr.gain.value = 0.7; g.sfxRev.connect(sr); sr.connect(g.sfx);

    g.duck = ac.createGain(); g.duck.gain.value = 1; g.duck.connect(g.pre);
    g.music = ac.createGain(); g.music.gain.value = curve(vol.music) * MUSIC_BASE; g.music.connect(g.duck);
    g.musicRev = ac.createConvolver(); g.musicRev.buffer = g.irM;
    const mr = ac.createGain(); mr.gain.value = 0.85; g.musicRev.connect(mr); mr.connect(g.music);
    return g;
  }

  // ------------------------------------------------------------------ synthesis primitives
  // Linear attack, optional hold, exponential decay to silence.
  function env(p, t, a, peak, d, hold) {
    a = Math.max(0.001, a); hold = hold || 0; peak = Math.max(0.00015, peak);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    if (hold > 0) p.setValueAtTime(peak, t + a + hold);
    p.exponentialRampToValueAtTime(0.0001, t + a + hold + Math.max(0.004, d));
  }
  function mark(end) { if (end > endT) endT = end; }
  function filt(src, type, f, q, t, f1, ft) {
    const fl = G.ctx.createBiquadFilter();
    fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (f1) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + ft);
    src.connect(fl);
    return fl;
  }
  function lfo(param, t, end, rate, depth, delay) {
    const ac = G.ctx, l = ac.createOscillator(), lg = ac.createGain();
    l.frequency.value = rate;
    if (delay) { lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(depth, t + delay); } else lg.gain.value = depth;
    l.connect(lg); lg.connect(param);
    l.start(t); l.stop(end + 0.03);
    return l;
  }
  // Oscillator note. op: type, a, hold, f1 (glide target), glide, det (cents), vib [rate, depthHz, delay],
  // lp / lp1 / lpT / q (lowpass + sweep), hp.
  function tone(o, t, f, d, g, op) {
    op = op || {};
    const ac = G.ctx;
    const a = op.a != null ? op.a : 0.002, hold = op.hold || 0, end = t + a + hold + d;
    const osc = ac.createOscillator();
    osc.type = op.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (op.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(5, op.f1), t + (op.glide || a + hold + d));
    if (op.det) osc.detune.setValueAtTime(op.det, t);
    if (op.vib) lfo(osc.frequency, t, end, op.vib[0], op.vib[1], op.vib[2]);
    const eg = ac.createGain();
    env(eg.gain, t, a, g, d, hold);
    let n = osc;
    if (op.lp) n = filt(n, 'lowpass', op.lp, op.q || 0.707, t, op.lp1, op.lpT || d);
    if (op.hp) n = filt(n, 'highpass', op.hp, 0.707, t);
    n.connect(eg); eg.connect(o);
    osc.start(t); osc.stop(end + 0.03);
    mark(end);
    return osc;
  }
  // Filtered noise burst. op: buf ('white'|'pink'|'brown'), type, f, f1, glide, pts [[dt,f]...], q, a, hold, rate.
  function noise(o, t, d, g, op) {
    op = op || {};
    const ac = G.ctx;
    const a = op.a != null ? op.a : 0.002, hold = op.hold || 0, end = t + a + hold + d;
    const src = ac.createBufferSource();
    src.buffer = op.buf === 'pink' ? G.pink : op.buf === 'brown' ? G.brown : G.white;
    src.loop = true;
    if (op.rate) src.playbackRate.value = op.rate;
    const fl = ac.createBiquadFilter();
    fl.type = op.type || 'bandpass';
    fl.Q.value = op.q != null ? op.q : 1;
    if (op.pts) {
      fl.frequency.setValueAtTime(op.pts[0][1], t + op.pts[0][0]);
      for (let i = 1; i < op.pts.length; i++) fl.frequency.exponentialRampToValueAtTime(op.pts[i][1], t + op.pts[i][0]);
    } else {
      fl.frequency.setValueAtTime(op.f || 1000, t);
      if (op.f1) fl.frequency.exponentialRampToValueAtTime(Math.max(20, op.f1), t + (op.glide || a + hold + d));
    }
    const eg = ac.createGain();
    env(eg.gain, t, a, g, d, hold);
    src.connect(fl); fl.connect(eg); eg.connect(o);
    src.start(t, rnd() * 2.5);
    src.stop(end + 0.03);
    mark(end);
  }
  // Additive partial stack: P = [[ratio, amp, decayScale], ...]
  function partials(o, t, f, d, g, P, op) {
    op = op || {};
    for (let i = 0; i < P.length; i++) {
      const pr = P[i], ff = f * pr[0];
      if (ff > 14000 || ff < 18) continue;
      tone(o, t, ff, d * pr[2], g * pr[1], { a: op.a || 0.0015, det: op.spread ? (rnd() * 2 - 1) * op.spread : 0 });
    }
  }
  const P_CHIME = [[1, 1, 1], [2.756, 0.32, 0.42], [5.404, 0.1, 0.22], [8.933, 0.04, 0.12]];
  const P_BELL = [[0.5, 0.32, 1.4], [1, 1, 1], [1.19, 0.32, 0.8], [1.5, 0.26, 0.6], [2, 0.22, 0.5], [2.52, 0.1, 0.35], [3, 0.07, 0.25]];
  const P_EERIE = [[0.5, 0.4, 1.3], [1, 1, 1], [1.183, 0.45, 0.9], [1.414, 0.32, 0.8], [2.02, 0.2, 0.6], [2.53, 0.14, 0.45], [3.17, 0.08, 0.3]];
  const P_METAL = [[1, 1, 1], [1.48, 0.6, 0.7], [2.15, 0.42, 0.5], [2.88, 0.28, 0.35], [3.9, 0.14, 0.25]];
  const P_PLATE = [[1, 1, 1], [1.71, 0.5, 0.5], [2.63, 0.24, 0.3]];
  const P_BRASS = [[1, 1, 1], [2.0, 0.42, 0.6], [3.01, 0.2, 0.4], [4.13, 0.1, 0.3]];
  const P_GLASS = [[1, 1, 1], [2.32, 0.42, 0.5], [4.25, 0.2, 0.3], [6.63, 0.1, 0.2]];
  const P_GONG = [[1, 1, 1], [1.52, 0.7, 0.85], [2.03, 0.5, 0.7], [2.47, 0.42, 0.55], [2.95, 0.32, 0.45], [3.6, 0.22, 0.35],
    [4.2, 0.14, 0.3], [5.3, 0.09, 0.22], [6.8, 0.06, 0.18], [8.9, 0.04, 0.14], [11.2, 0.025, 0.1]];

  // Simple 2-op FM (bells, tines, magic).
  function fm(o, t, f, d, g, op) {
    op = op || {};
    const ac = G.ctx, a = op.a || 0.002, end = t + a + d, ratio = op.ratio || 2;
    const car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain(), eg = ac.createGain();
    car.frequency.value = f; mod.frequency.value = f * ratio;
    const dev = f * ratio;
    mg.gain.setValueAtTime(dev * (op.index != null ? op.index : 2), t);
    mg.gain.exponentialRampToValueAtTime(Math.max(0.01, dev * (op.index1 != null ? op.index1 : 0.1)), t + a + d * (op.idxT || 0.7));
    mod.connect(mg); mg.connect(car.frequency);
    env(eg.gain, t, a, g, d, 0);
    car.connect(eg); eg.connect(o);
    car.start(t); mod.start(t); car.stop(end + 0.03); mod.stop(end + 0.03);
    mark(end);
  }
  // Warm brass: two detuned saws through a lowpass that "blats" open on the attack.
  function brass(o, t, f, d, g, op) {
    op = op || {};
    const ac = G.ctx, a = op.a != null ? op.a : 0.02, hold = op.hold || 0, end = t + a + hold + d;
    const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 0.9;
    fl.frequency.setValueAtTime(Math.max(f * 1.2, 180), t);
    fl.frequency.exponentialRampToValueAtTime(Math.min(f * (op.bright || 5), 4200), t + a + 0.015);
    fl.frequency.exponentialRampToValueAtTime(Math.max(f * 1.6, 260), end);
    const eg = ac.createGain();
    env(eg.gain, t, a, g, d, hold);
    for (let k = 0; k < 2; k++) {
      const s = ac.createOscillator(); s.type = 'sawtooth';
      s.frequency.setValueAtTime(f, t); s.detune.value = k ? 6 : -6;
      if (hold + d > 0.35) lfo(s.detune, t, end, 5.2, 9, 0.25);
      s.connect(fl); s.start(t); s.stop(end + 0.03);
    }
    fl.connect(eg); eg.connect(o);
    tone(o, t, f, d + hold * 0.5, g * 0.35, { a: a });
    mark(end);
  }
  // Formant "voice" (choir / sigh).
  const VOWELS = {
    a: [[730, 1, 9], [1090, 0.5, 11], [2440, 0.16, 14]],
    o: [[570, 1, 9], [840, 0.45, 11], [2410, 0.1, 14]],
    u: [[320, 1, 8], [800, 0.25, 10], [2240, 0.06, 12]],
  };
  function vox(o, t, f, d, g, vowel, op) {
    op = op || {};
    const ac = G.ctx, a = op.a || 0.05, hold = op.hold || 0, end = t + a + hold + d;
    const src = ac.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(f, t);
    if (op.f1) src.frequency.exponentialRampToValueAtTime(op.f1, t + (op.glide || a + hold + d));
    lfo(src.frequency, t, end, op.vibRate || 5.2, f * 0.012, 0.12);
    const eg = ac.createGain(); env(eg.gain, t, a, g, d, hold); eg.connect(o);
    const F = VOWELS[vowel] || VOWELS.a;
    for (let i = 0; i < F.length; i++) {
      const b = ac.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = F[i][0]; b.Q.value = F[i][2];
      const bg = ac.createGain(); bg.gain.value = F[i][1] * 2.4;
      src.connect(b); b.connect(bg); bg.connect(eg);
    }
    src.start(t); src.stop(end + 0.03);
    mark(end);
  }
  // Amplitude flutter: returns a node to connect sources into.
  function trem(o, t, end, rate, depth, rate1) {
    const ac = G.ctx, tg = ac.createGain();
    tg.gain.value = 1 - depth / 2;
    const l = ac.createOscillator(), lg = ac.createGain();
    l.frequency.setValueAtTime(rate, t);
    if (rate1) l.frequency.linearRampToValueAtTime(rate1, end);
    lg.gain.value = depth / 2;
    l.connect(lg); lg.connect(tg.gain);
    tg.connect(o);
    l.start(t); l.stop(end + 0.03);
    return tg;
  }
  function panned(o, pan) {
    const ac = G.ctx;
    if (!ac.createStereoPanner) return o;
    const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(o);
    return p;
  }
  function ping(o, t, f, d, g) { tone(o, t, f, d, g); tone(o, t, f * 2.756, d * 0.35, g * 0.16); }
  function mallet(o, t, f, d, g) {
    tone(o, t, f, d, g);
    tone(o, t, f, d * 0.5, g * 0.3, { type: 'triangle' });
    tone(o, t, f * 4, d * 0.1, g * 0.12, { a: 0.001 });
  }
  function coin(o, t, f, g) {
    tone(o, t, f, 0.05, g * 0.75);
    tone(o, t + 0.045, f * 1.335, 0.16, g);
    tone(o, t + 0.045, f * 1.335 * 2.756, 0.05, g * 0.14);
  }
  function ratchet(o, t, count, span, g, f) {
    for (let i = 0; i < count; i++) {
      const tt = t + span * Math.pow(i / count, 0.75);
      const gg = g * (0.75 + 0.25 * rnd()) * (0.7 + 0.3 * (i / count));
      noise(o, tt, 0.011, gg, { type: 'bandpass', f: f * (0.9 + 0.2 * rnd()), q: 4 });
      tone(o, tt, f * 0.42, 0.012, gg * 0.25);
    }
  }
  // Pentatonic glints. dir: 1 rising, -1 falling, 0 random.
  function sparkle(o, t, count, span, g, base, dir) {
    for (let i = 0; i < count; i++) {
      let k;
      if (dir > 0) k = Math.min(8, i + (rnd() < 0.3 ? 1 : 0));
      else if (dir < 0) k = Math.max(0, 8 - i - (rnd() < 0.3 ? 1 : 0));
      else k = (rnd() * 8) | 0;
      ping(o, t + span * (i / count) + rnd() * 0.02, base * semi(PENT[k]), 0.1 + rnd() * 0.16, g * (0.6 + 0.4 * rnd()));
    }
  }
  function thud(o, t, f, d, g) { tone(o, t, f, d, g, { f1: f * 0.42, glide: d * 0.7 }); }

  // ------------------------------------------------------------------ SFX definitions
  // meta: v (volume), wet (reverb send), gap (min seconds between plays), burst (window for repeat attenuation),
  //       burstMin, jit (random pitch ±), pri (survives voice cap), keyN (rate-limit per opts.n), pan(n)
  // fn(o, t, p, n, p0): o = voice input, t = start time, p = pitch mult incl. jitter, p0 = caller pitch (no jitter)
  const SFX = {};
  function def(name, meta, fn) { meta.fn = fn; SFX[name] = meta; }

  // ---- the Emberwheel
  def('spin_start', { wet: 0.1, pri: 1 }, (o, t, p) => {
    thud(o, t, 150 * p, 0.14, 0.42);
    noise(o, t, 0.05, 0.3, { type: 'lowpass', f: 1500, q: 0.8, buf: 'pink' });
    partials(o, t + 0.004, 610 * p, 0.14, 0.04, P_BRASS);
    ratchet(o, t + 0.05, 7, 0.26, 0.15, 2500 * p);
    const tg = trem(o, t + 0.06, t + 0.62, 20, 0.55, 34);
    noise(tg, t + 0.06, 0.22, 0.13, { a: 0.16, hold: 0.12, type: 'bandpass', f: 380 * p, f1: 1500 * p, glide: 0.5, q: 1.6, buf: 'pink' });
    tone(tg, t + 0.06, 92 * p, 0.22, 0.05, { a: 0.16, hold: 0.12, type: 'triangle', f1: 185 * p, glide: 0.5, lp: 800 });
  });
  def('reel_tick', { gap: 0.045, burst: 0.12, burstMin: 0.5, jit: 0.07 }, (o, t, p) => {
    noise(o, t, 0.013, 0.13, { type: 'bandpass', f: 1900 * p, q: 3.5 });
    tone(o, t, 1150 * p, 0.016, 0.035, { a: 0.001 });
    tone(o, t, 420 * p, 0.02, 0.05, { a: 0.001 });
  });
  const REEL_STEPS = [0, 4, 7, 12, 16, 19];
  def('reel_stop', { wet: 0.14, keyN: true, pri: 1, pan: (n) => clamp((n - 1) * 0.22, -0.5, 0.5) }, (o, t, p, n, p0) => {
    const m = semi(REEL_STEPS[clamp(n, 0, 5)]);
    const pb = p * Math.pow(m, 0.35); // the drum body rises a little; the ring carries the melody
    tone(o, t, 125 * pb, 0.22, 0.5, { f1: 52 * pb, glide: 0.12 });
    tone(o, t, 260 * pb, 0.07, 0.15, { type: 'triangle', f1: 120 * pb, glide: 0.05 });
    noise(o, t, 0.07, 0.34, { type: 'lowpass', f: 900, q: 0.7, buf: 'brown' });
    noise(o, t, 0.006, 0.09, { type: 'bandpass', f: 2800, q: 1.2 });
    partials(o, t + 0.006, 392 * m * p0 * (1 + (rnd() - 0.5) * 0.008), 0.34, 0.06, P_BRASS);
  });
  def('anticipation', { wet: 0.2, pri: 1, jit: 0.015 }, (o, t, p) => {
    const dur = 0.62;
    for (let tt = 0; tt < dur;) {
      const x = tt / dur, g = 0.07 + 0.2 * x;
      tone(o, t + tt, (85 + 45 * x) * p, 0.09, g, { f1: (60 + 30 * x) * p, glide: 0.07 });
      noise(o, t + tt, 0.035, g * 0.55, { type: 'bandpass', f: 700 + 600 * x, q: 1.2, buf: 'pink' });
      tt += 0.075 - 0.045 * x;
    }
    noise(o, t, 0.12, 0.06, { a: 0.55, type: 'bandpass', f: 3000 * p, f1: 7000 * p, glide: 0.62, q: 2.5 });
    tone(o, t, 330 * p, 0.12, 0.03, { a: 0.55, f1: 660 * p, glide: 0.65, type: 'triangle' });
    tone(o, t, 495 * p, 0.12, 0.016, { a: 0.55, f1: 990 * p, glide: 0.65 });
  });
  def('hold', { wet: 0.08 }, (o, t, p) => {
    thud(o, t, 210 * p, 0.06, 0.22);
    noise(o, t, 0.018, 0.26, { type: 'bandpass', f: 2300 * p, q: 5 });
    noise(o, t + 0.038, 0.022, 0.2, { type: 'bandpass', f: 1600 * p, q: 5 });
    partials(o, t + 0.038, 1180 * p, 0.1, 0.04, P_METAL);
    thud(o, t + 0.038, 180 * p, 0.05, 0.16);
  });
  def('unhold', {}, (o, t, p) => {
    noise(o, t, 0.02, 0.14, { type: 'bandpass', f: 1500 * p, q: 4 });
    tone(o, t, 820 * p, 0.06, 0.035, { f1: 980 * p });
    noise(o, t + 0.045, 0.015, 0.08, { type: 'bandpass', f: 2200 * p, q: 4 });
    thud(o, t, 160 * p, 0.04, 0.08);
  });
  def('respin', { wet: 0.25, pri: 1 }, (o, t, p) => {
    noise(o, t, 0.28, 0.2, { a: 0.12, type: 'bandpass', f: 350 * p, f1: 2600 * p, glide: 0.35, q: 1.4, buf: 'pink' });
    for (let i = 0; i < 5; i++) ping(o, t + 0.04 + i * 0.045, 1046.5 * semi(PENT[i]) * p, 0.2, 0.032);
    ratchet(o, t + 0.22, 5, 0.18, 0.1, 2400 * p);
  });
  def('nudge', { wet: 0.15 }, (o, t, p) => {
    tone(o, t, 330 * p, 0.06, 0.26, { f1: 200 * p });
    noise(o, t, 0.03, 0.18, { type: 'bandpass', f: 900 * p, q: 2, buf: 'pink' });
    partials(o, t + 0.03, 1318.5 * p, 0.42, 0.05, P_CHIME);
  });
  def('resolve', { wet: 0.08 }, (o, t, p) => {
    thud(o, t, 115 * p, 0.16, 0.36);
    noise(o, t, 0.05, 0.18, { type: 'lowpass', f: 700, buf: 'brown' });
    tone(o, t + 0.01, 440 * p, 0.12, 0.022, { type: 'triangle' });
    tone(o, t + 0.01, 660 * p, 0.1, 0.012);
  });

  // ---- party / combat
  def('blade', {}, (o, t, p) => {
    noise(o, t, 0.13, 0.3, { a: 0.012, type: 'bandpass', f: 1600 * p, f1: 4800 * p, glide: 0.08, q: 1.1 });
    noise(o, t, 0.08, 0.12, { a: 0.01, type: 'lowpass', f: 700, buf: 'pink' });
    fm(o, t + 0.02, 1650 * p, 0.2, 0.03, { ratio: 1.414, index: 1.5, index1: 0.2 });
  });
  def('blade_big', { wet: 0.2, pri: 1 }, (o, t, p) => {
    noise(o, t, 0.22, 0.34, { a: 0.02, type: 'bandpass', f: 900 * p, f1: 3800 * p, glide: 0.12, q: 0.9 });
    thud(o, t + 0.02, 95 * p, 0.26, 0.38);
    partials(o, t + 0.03, 880 * p, 0.65, 0.06, P_GLASS);
    noise(o, t + 0.02, 0.03, 0.16, { type: 'bandpass', f: 2400, q: 1 });
  });
  def('flame', { wet: 0.12 }, (o, t, p) => {
    noise(o, t, 0.3, 0.34, { a: 0.03, type: 'lowpass', pts: [[0, 250 * p], [0.06, 2200 * p], [0.35, 350 * p]], q: 1.5, buf: 'pink' });
    tone(o, t, 82 * p, 0.3, 0.3, { a: 0.03, f1: 52 * p, glide: 0.3 });
    for (let i = 0; i < 4; i++) noise(o, t + 0.05 + rnd() * 0.22, 0.006, 0.06 + rnd() * 0.06, { type: 'bandpass', f: 2500 + rnd() * 2500, q: 2 });
  });
  def('heal', { wet: 0.32, jit: 0.006 }, (o, t, p) => {
    const N = [0, 4, 7, 12];
    for (let i = 0; i < 4; i++) partials(o, t + i * 0.07, 587.33 * semi(N[i]) * p, 0.7, 0.055, P_CHIME);
    noise(o, t, 0.4, 0.025, { a: 0.1, type: 'bandpass', f: 6000, q: 2 });
  });
  def('ward', { wet: 0.16 }, (o, t, p) => {
    noise(o, t, 0.025, 0.26, { type: 'bandpass', f: 2600 * p, q: 0.9 });
    thud(o, t, 160 * p, 0.1, 0.3);
    partials(o, t, 520 * p, 0.4, 0.075, P_METAL);
    tone(o, t + 0.01, 260 * p, 0.35, 0.035, { type: 'triangle' });
  });
  def('lantern', { wet: 0.2, jit: 0.015 }, (o, t, p) => {
    noise(o, t, 0.008, 0.05, { type: 'highpass', f: 5000 });
    tone(o, t, 1318.5 * p, 0.09, 0.055); tone(o, t, 2637 * p, 0.05, 0.01);
    tone(o, t + 0.06, 1760 * p, 0.28, 0.065); tone(o, t + 0.06, 1760 * 2.756 * p, 0.08, 0.01);
    tone(o, t + 0.06, 880 * p, 0.2, 0.02, { type: 'triangle' });
  });
  def('skull', { wet: 0.22 }, (o, t, p) => {
    vox(o, t, 98 * p, 0.4, 0.09, 'o', { a: 0.08, hold: 0.15, f1: 80 * p, glide: 0.6, vibRate: 4.5 });
    vox(o, t, 98 * semi(6) * p, 0.35, 0.03, 'u', { a: 0.1, hold: 0.1, f1: 80 * semi(6) * p, glide: 0.6 });
    tone(o, t, 49 * p, 0.5, 0.14, { a: 0.06, f1: 42 * p });
  });
  def('enemy_hit', {}, (o, t, p) => {
    thud(o, t, 150 * p, 0.15, 0.48);
    noise(o, t, 0.09, 0.4, { type: 'lowpass', f: 1600, f1: 300, glide: 0.08, q: 1, buf: 'pink' });
    noise(o, t, 0.04, 0.14, { type: 'bandpass', f: 520 * p, q: 1.5 });
  });
  def('enemy_hit_big', { wet: 0.18, pri: 1 }, (o, t, p) => {
    tone(o, t, 120 * p, 0.32, 0.56, { f1: 40 * p, glide: 0.2 });
    noise(o, t, 0.2, 0.44, { type: 'lowpass', f: 2400, f1: 220, glide: 0.18, q: 1.2, buf: 'pink' });
    noise(o, t, 0.018, 0.2, { type: 'bandpass', f: 1500, q: 1 });
    tone(o, t + 0.01, 70 * p, 0.4, 0.22, { f1: 45 * p });
  });
  def('party_hit', { wet: 0.08 }, (o, t, p) => {
    tone(o, t, 190 * p, 0.12, 0.4, { f1: 85 * p, glide: 0.08 });
    noise(o, t, 0.07, 0.3, { type: 'lowpass', f: 900, q: 0.8, buf: 'pink' });
    tone(o, t + 0.02, 98 * p, 0.26, 0.11, { type: 'triangle', f1: 90 * p, lp: 500 });
    tone(o, t + 0.02, 98 * semi(3) * p, 0.2, 0.04, { type: 'triangle', lp: 500 });
  });
  def('block', { wet: 0.1 }, (o, t, p) => {
    noise(o, t, 0.02, 0.2, { type: 'bandpass', f: 1900 * p, q: 1.4 });
    thud(o, t, 150 * p, 0.09, 0.3);
    partials(o, t, 380 * p, 0.22, 0.065, P_METAL);
    noise(o, t + 0.02, 0.16, 0.08, { a: 0.01, type: 'lowpass', f: 900, f1: 200, buf: 'pink' });
  });
  def('armor_clank', { wet: 0.08 }, (o, t, p) => {
    noise(o, t, 0.035, 0.22, { type: 'bandpass', f: 1150 * p, q: 2.5 });
    partials(o, t, 300 * p, 0.16, 0.075, P_PLATE);
    tone(o, t, 230 * p, 0.07, 0.15, { f1: 160 * p });
  });
  def('burn', { gap: 0.06, burst: 0.3 }, (o, t, p) => {
    for (let i = 0; i < 9; i++) noise(o, t + rnd() * 0.28, 0.004 + rnd() * 0.008, 0.06 + rnd() * 0.1, { type: 'bandpass', f: (1800 + rnd() * 3000) * p, q: 1.5 });
    noise(o, t, 0.25, 0.07, { a: 0.03, type: 'bandpass', f: 1200, q: 0.7, buf: 'pink' });
    tone(o, t, 70 * p, 0.2, 0.08, { a: 0.03 });
  });

  // ---- combos / big moments
  def('enemy_die', { wet: 0.3, pri: 1 }, (o, t, p) => {
    noise(o, t, 0.32, 0.32, { a: 0.01, type: 'lowpass', f: 2600, f1: 300, glide: 0.3, q: 0.9, buf: 'pink' });
    thud(o, t, 130 * p, 0.22, 0.2);
    sparkle(o, t + 0.06, 6, 0.33, 0.035, 1046.5 * p, -1);
  });
  def('combo_pair', { wet: 0.22, jit: 0.006 }, (o, t, p) => {
    mallet(o, t, 784 * p, 0.35, 0.1);
    mallet(o, t + 0.085, 1175 * p, 0.5, 0.11);
  });
  def('combo_triple', { wet: 0.3, pri: 1, jit: 0.004 }, (o, t, p) => {
    brass(o, t, 392 * p, 0.06, 0.06, { a: 0.01 });
    const tc = t + 0.07;
    const C = [261.63, 329.63, 392, 523.25];
    for (let i = 0; i < C.length; i++) brass(o, tc, C[i] * p, 0.5, 0.06, { a: 0.02, hold: 0.12 });
    tone(o, tc, 130.8 * p, 0.6, 0.16, { type: 'triangle', lp: 600 });
    tone(o, tc, 65.4 * p, 0.5, 0.32, { f1: 52 * p, glide: 0.35 });
    noise(o, tc, 0.08, 0.16, { type: 'lowpass', f: 1200, buf: 'pink' });
    sparkle(o, tc + 0.05, 8, 0.6, 0.03, 1046.5 * p, 1);
  });
  def('combo_bond', { wet: 0.3, pri: 1, jit: 0.004 }, (o, t, p) => {
    brass(o, t, 523.25 * p, 0.14, 0.065, { a: 0.012 });                                  // ブラム: brass
    fm(o, t + 0.12, 659.25 * p, 0.28, 0.06, { ratio: 2, index: 2.2, index1: 0.3 });     // ルゥ: FM glint
    partials(o, t + 0.24, 783.99 * p, 0.45, 0.075, P_CHIME);                            // トト: chime
    const tc = t + 0.38;
    const C = [261.63, 329.63, 392, 523.25, 659.25];
    for (let i = 0; i < C.length; i++) brass(o, tc, C[i] * p, 0.6, 0.045, { a: 0.03, hold: 0.1, bright: 4 });
    partials(o, tc, 1046.5 * p, 0.8, 0.045, P_CHIME);
    tone(o, tc, 65.4 * p, 0.5, 0.28, { f1: 55 * p });
  });
  def('jackpot', { wet: 0.3, pri: 1, jit: 0.004 }, (o, t, p) => {
    const sides = [panned(o, -0.55), o, panned(o, 0.55)];
    for (let i = 0; i < 18; i++) coin(sides[(rnd() * 3) | 0], t + Math.pow(rnd(), 0.8) * 0.9, (1700 + rnd() * 1500) * p, 0.025 + rnd() * 0.025);
    const C = [293.66, 369.99, 440, 587.33];
    for (let i = 0; i < C.length; i++) {
      brass(o, t, C[i] * p, 0.6, 0.042, { a: 0.02, hold: 0.15 });
      partials(o, t + 0.02, C[i] * 2 * p, 1.1, 0.035, P_CHIME);
    }
    tone(o, t, 73.4 * p, 0.5, 0.28, { f1: 60 * p });
  });
  def('seal_break', { wet: 0.35, pri: 1 }, (o, t, p) => {
    noise(o, t, 0.3, 0.16, { type: 'bandpass', f: 5200, f1: 2500, q: 0.8 });
    for (let i = 0; i < 14; i++) tone(o, t + Math.pow(rnd(), 1.5) * 0.3, (2400 + rnd() * 4200) * p, 0.05 + rnd() * 0.12, 0.022 + rnd() * 0.026, { type: rnd() < 0.5 ? 'sine' : 'triangle' });
    partials(o, t, 1480 * p, 0.6, 0.035, P_GLASS);
    tone(o, t, 72 * p, 0.95, 0.56, { f1: 34 * p, glide: 0.8 });
    noise(o, t, 0.6, 0.36, { type: 'lowpass', f: 500, f1: 120, q: 0.7, buf: 'brown' });
  });
  def('reaper', { wet: 0.4, pri: 1, jit: 0.01 }, (o, t, p) => {
    const C = [146.83, 174.61, 220, 293.66];
    for (let i = 0; i < C.length; i++) vox(o, t, C[i] * p, 0.5, 0.045, i % 2 ? 'o' : 'a', { a: 0.55, hold: 0.05 });
    tone(o, t, 73.4 * p, 0.5, 0.12, { a: 0.5, type: 'triangle', lp: 300 });
    const th = t + 0.58;
    noise(o, th - 0.12, 0.08, 0.12, { a: 0.08, type: 'bandpass', f: 1200, f1: 4000, glide: 0.12, q: 1.5 });
    tone(o, th, 110 * p, 0.5, 0.55, { f1: 38 * p, glide: 0.35 });
    noise(o, th, 0.25, 0.42, { type: 'lowpass', f: 2500, f1: 200, glide: 0.2, buf: 'pink' });
    partials(o, th, 147 * p, 0.9, 0.05, P_GONG);
  });

  // ---- enemy actions
  def('hex', { wet: 0.32 }, (o, t, p) => {
    tone(o, t, 620 * p, 0.45, 0.055, { a: 0.04, f1: 410 * p, glide: 0.45, type: 'triangle', vib: [6, 8] });
    tone(o, t, 620 * semi(6) * p, 0.45, 0.035, { a: 0.04, f1: 410 * semi(6) * p, glide: 0.45, vib: [6.5, 10] });
    noise(o, t, 0.4, 0.07, { a: 0.08, type: 'bandpass', f: 1600, f1: 500, q: 6, buf: 'pink' });
    tone(o, t, 110 * p, 0.4, 0.08, { a: 0.05, f1: 98 * p });
  });
  def('drain', { wet: 0.22 }, (o, t, p) => {
    noise(o, t, 0.06, 0.2, { a: 0.3, type: 'bandpass', f: 3200 * p, f1: 450 * p, glide: 0.34, q: 3 });
    tone(o, t, 880 * p, 0.08, 0.055, { a: 0.28, f1: 280 * p, glide: 0.34, type: 'triangle' });
    tone(o, t + 0.34, 180 * p, 0.08, 0.18, { f1: 90 * p });
  });
  def('jam', { wet: 0.12 }, (o, t, p) => {
    const tg = trem(o, t, t + 0.5, 28, 0.85);
    tone(tg, t, 58 * p, 0.3, 0.11, { a: 0.03, hold: 0.1, type: 'sawtooth', lp: 900, f1: 50 * p });
    noise(tg, t, 0.3, 0.12, { a: 0.03, hold: 0.1, type: 'bandpass', f: 1400, q: 2.5 });
    for (let i = 0; i < 7; i++) noise(o, t + 0.02 + i * 0.06 + rnd() * 0.02, 0.012, 0.13, { type: 'bandpass', f: 2600 + rnd() * 1200, q: 7 });
    thud(o, t + 0.46, 150 * p, 0.1, 0.3);
    noise(o, t + 0.46, 0.03, 0.2, { type: 'bandpass', f: 1700, q: 3 });
  });
  def('mark', { wet: 0.5 }, (o, t, p) => {
    partials(o, t, 740 * p, 1.3, 0.065, P_EERIE, { spread: 8 });
    tone(o, t, 370 * semi(-1) * p, 0.9, 0.02, { a: 0.05, vib: [3.5, 3] });
  });
  def('reflect', { wet: 0.35 }, (o, t, p) => {
    const F = [[1760, 0.6], [1767, 0.6], [2637, 0.45], [2650, 0.45], [3520, 0.3]];
    for (let i = 0; i < F.length; i++) tone(o, t + i * 0.02, F[i][0] * p, F[i][1], 0.022, { a: 0.03 });
    noise(o, t, 0.4, 0.04, { a: 0.05, type: 'bandpass', f: 6500, f1: 9000, q: 3 });
    tone(o, t, 880 * p, 0.2, 0.03, { a: 0.01, f1: 1760 * p, glide: 0.12, type: 'triangle' });
  });
  def('enemy_heal', { wet: 0.32, jit: 0.01 }, (o, t, p) => {
    const N = [0, 3, 7, 12];
    for (let i = 0; i < 4; i++) partials(o, t + i * 0.08, 440 * semi(N[i]) * p, 0.5, 0.045, P_CHIME, { spread: 15 });
    noise(o, t, 0.4, 0.03, { a: 0.1, type: 'bandpass', f: 3000, q: 2 });
    tone(o, t, 220 * p, 0.5, 0.04, { a: 0.1, type: 'triangle', vib: [4, 3] });
  });
  def('windup', { wet: 0.2, pri: 1, jit: 0.02 }, (o, t, p) => {
    const tg = trem(o, t, t + 0.95, 7, 0.5, 14);
    tone(tg, t, 52 * p, 0.2, 0.2, { a: 0.65, type: 'sawtooth', f1: 78 * p, glide: 0.8, lp: 180, lp1: 900, lpT: 0.75 });
    tone(tg, t, 52 * semi(6) * p, 0.2, 0.08, { a: 0.65, type: 'sawtooth', f1: 78 * semi(6) * p, glide: 0.8, lp: 180, lp1: 700, lpT: 0.75 });
    tone(o, t, 41 * p, 0.22, 0.22, { a: 0.65, f1: 55 * p, glide: 0.8 });
    noise(o, t, 0.15, 0.12, { a: 0.65, type: 'lowpass', f: 200, f1: 1400, glide: 0.8, q: 2, buf: 'brown' });
  });
  def('doom_tick', { wet: 0.4, pri: 1, jit: 0.01 }, (o, t, p, n) => {
    const k = n > 0 ? clamp(n, 1, 3) : 2;
    const pp = p * (1 - (3 - k) * 0.04), I = 1 + (3 - k) * 0.18;
    tone(o, t, 320 * pp, 0.05, 0.3 * I, { f1: 200 * pp });
    noise(o, t, 0.02, 0.22 * I, { type: 'bandpass', f: 1300 * pp, q: 3 });
    tone(o, t, 73.4 * pp, 0.7, 0.24 * I);
    tone(o, t, 146.8 * pp, 0.4, 0.07 * I);
    partials(o, t, 220 * pp, 0.6, 0.025 * I, P_BELL);
  });

  // ---- UI / meta
  def('ui_hover', { gap: 0.05, burst: 0.25, burstMin: 0.4, jit: 0.04 }, (o, t, p) => {
    tone(o, t, 2300 * p, 0.014, 0.03);
    noise(o, t, 0.004, 0.025, { type: 'bandpass', f: 4200, q: 2 });
  });
  def('ui_click', { gap: 0.03 }, (o, t, p) => {
    noise(o, t, 0.012, 0.12, { type: 'bandpass', f: 2400 * p, q: 2 });
    tone(o, t, 880 * p, 0.04, 0.07, { f1: 700 * p });
    thud(o, t, 190 * p, 0.04, 0.12);
  });
  def('ui_confirm', { wet: 0.15, jit: 0.006 }, (o, t, p) => {
    thud(o, t, 180 * p, 0.05, 0.12);
    mallet(o, t + 0.01, 659.25 * p, 0.2, 0.07);
    mallet(o, t + 0.07, 987.77 * p, 0.3, 0.075);
  });
  def('ui_deny', { gap: 0.08 }, (o, t, p) => {
    tone(o, t, 124 * p, 0.16, 0.09, { a: 0.01, type: 'triangle', f1: 104 * p, lp: 700 });
    tone(o, t, 131 * p, 0.16, 0.06, { a: 0.01, type: 'sawtooth', f1: 110 * p, lp: 500 });
    thud(o, t, 180 * p, 0.04, 0.08);
  });
  def('unlock', { wet: 0.4, pri: 1, jit: 0.004 }, (o, t, p) => {
    partials(o, t, 523.25 * p, 1.4, 0.09, P_BELL);
    partials(o, t + 0.12, 783.99 * p, 1.1, 0.045, P_CHIME);
    for (let i = 0; i < 8; i++) ping(o, t + 0.1 + i * 0.06, 1046.5 * semi(PENT[i]) * p, 0.4, 0.028);
    noise(o, t, 0.5, 0.035, { a: 0.25, type: 'bandpass', f: 5000, f1: 8000, glide: 0.75, q: 2 });
    tone(o, t, 130.8 * p, 0.8, 0.11, { type: 'triangle', lp: 500 });
  });
  def('ember', { gap: 0.03, burst: 0.15, burstMin: 0.4, jit: 0.005 }, (o, t, p) => {
    const f = 2093 * semi(PENT[(rnd() * 5) | 0]) * p;
    tone(o, t, f, 0.07, 0.04);
    tone(o, t, f * 2, 0.03, 0.008);
  });
  def('spark_gain', { wet: 0.2, jit: 0.01 }, (o, t, p) => {
    noise(o, t, 0.12, 0.1, { a: 0.02, type: 'bandpass', f: 700, f1: 3200, glide: 0.12, q: 1.6, buf: 'pink' });
    mallet(o, t + 0.05, 784 * p, 0.4, 0.065);
    tone(o, t + 0.05, 1568 * p, 0.25, 0.018);
  });
  def('spark_use', { wet: 0.2 }, (o, t, p) => {
    noise(o, t, 0.16, 0.13, { a: 0.01, type: 'lowpass', f: 3000, f1: 500, glide: 0.15, buf: 'pink' });
    tone(o, t, 523 * p, 0.18, 0.045, { f1: 1046 * p, glide: 0.12, type: 'triangle' });
    ping(o, t + 0.08, 1568 * p, 0.3, 0.035);
  });
  def('door', { wet: 0.25 }, (o, t, p) => {
    const ac = G.ctx, end = t + 0.72;
    const src = ac.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(38 * p, t);
    src.frequency.linearRampToValueAtTime(56 * p, t + 0.25);
    src.frequency.linearRampToValueAtTime(31 * p, t + 0.55);
    src.frequency.linearRampToValueAtTime(46 * p, end);
    lfo(src.frequency, t, end, 9, 4);
    const eg = ac.createGain(); env(eg.gain, t, 0.06, 0.32, 0.2, 0.42); eg.connect(o);
    const b1 = filt(src, 'bandpass', 950 * p, 7, t); b1.connect(eg);
    const b2 = filt(src, 'bandpass', 2300 * p, 9, t); const b2g = ac.createGain(); b2g.gain.value = 0.5; b2.connect(b2g); b2g.connect(eg);
    src.start(t); src.stop(end + 0.05); mark(end);
    noise(o, t + 0.1, 0.5, 0.05, { a: 0.3, type: 'bandpass', f: 500, q: 0.8, buf: 'pink' });
    thud(o, t + 0.72, 95 * p, 0.22, 0.28);
    noise(o, t + 0.72, 0.08, 0.2, { type: 'lowpass', f: 600, buf: 'brown' });
  });
  def('step', { gap: 0.07, jit: 0.08 }, (o, t, p) => {
    noise(o, t, 0.07, 0.22, { a: 0.004, type: 'lowpass', f: 650 * p, f1: 250, q: 0.8, buf: 'pink' });
    thud(o, t, 95 * p, 0.05, 0.1);
    noise(o, t + 0.01, 0.02, 0.035, { type: 'bandpass', f: 2400, q: 1 });
  });
  def('reward', { wet: 0.25, jit: 0.005 }, (o, t, p) => {
    mallet(o, t, 784 * p, 0.35, 0.065);
    mallet(o, t + 0.08, 1046.5 * p, 0.35, 0.065);
    mallet(o, t + 0.16, 1318.5 * p, 0.6, 0.075);
    sparkle(o, t + 0.2, 4, 0.3, 0.02, 1318.5 * p, 1);
  });
  def('relic', { wet: 0.45, pri: 1, jit: 0.005 }, (o, t, p) => {
    partials(o, t, 587.33 * p, 1.3, 0.055, P_BELL);
    partials(o, t + 0.1, 880 * p, 1.1, 0.045, P_CHIME);
    partials(o, t + 0.2, 1318.5 * p, 0.9, 0.035, P_CHIME);
    tone(o, t, 293.66 * p, 0.9, 0.05, { a: 0.2, type: 'triangle', lp: 900 });
    tone(o, t, 440 * p, 0.9, 0.03, { a: 0.25, type: 'triangle', lp: 900 });
    noise(o, t, 0.6, 0.025, { a: 0.3, type: 'bandpass', f: 6000, q: 2 });
  });
  def('second_wind', { wet: 0.4, pri: 1, jit: 0.004 }, (o, t, p) => {
    noise(o, t, 0.03, 0.18, { a: 0.6, type: 'bandpass', f: 500, f1: 4000, glide: 0.62, q: 1.2, buf: 'pink' });
    const C = [261.63, 392, 523.25];
    for (let i = 0; i < C.length; i++) tone(o, t, C[i] * p, 0.05, 0.045, { a: 0.6, type: 'triangle', lp: 1500 });
    const tc = t + 0.62;
    partials(o, tc, 1046.5 * p, 1.1, 0.08, P_CHIME);
    partials(o, tc + 0.06, 1568 * p, 0.9, 0.045, P_CHIME);
    tone(o, tc, 130.8 * p, 0.6, 0.22, { f1: 110 * p });
    sparkle(o, tc + 0.05, 6, 0.5, 0.025, 1046.5 * p, 1);
  });
  def('death', { wet: 0.45, pri: 1, jit: 0 }, (o, t, p) => {
    const S = [[0, 659.25, 0.5], [0.28, 523.25, 0.5], [0.56, 440, 0.6], [0.84, 329.63, 1.1]];
    for (let i = 0; i < S.length; i++) {
      mallet(o, t + S[i][0], S[i][1] * p, S[i][2], 0.07);
      tone(o, t + S[i][0], S[i][1] * 0.5 * p, S[i][2], 0.03, { a: 0.02, type: 'triangle', lp: 800 });
    }
    tone(o, t + 0.84, 110 * p, 1.0, 0.12, { a: 0.05, type: 'triangle', lp: 400 });
    tone(o, t, 220 * p, 0.9, 0.03, { a: 0.3, hold: 0.4, type: 'triangle', lp: 600 });
  });
  def('boss_appear', { wet: 0.45, pri: 1, jit: 0.01 }, (o, t, p) => {
    partials(o, t + 0.02, 62 * p, 2.2, 0.15, P_GONG, { spread: 6 });
    noise(o, t, 0.12, 0.32, { type: 'lowpass', f: 1800, f1: 300, buf: 'pink' });
    tone(o, t, 45 * p, 1.6, 0.36, { f1: 38 * p, glide: 1.4 });
    noise(o, t, 1.6, 0.42, { a: 0.25, type: 'lowpass', f: 140, q: 0.7, buf: 'brown' });
    tone(o, t, 31 * p, 1.5, 0.18, { a: 0.3 });
  });
  def('boss_phase', { wet: 0.4, pri: 1, jit: 0.01 }, (o, t, p) => {
    tone(o, t, 70 * p, 0.9, 0.48, { f1: 32 * p, glide: 0.7 });
    noise(o, t, 0.4, 0.32, { type: 'lowpass', f: 1500, f1: 150, glide: 0.35, buf: 'pink' });
    partials(o, t, 98 * p, 1.2, 0.09, P_GONG, { spread: 8 });
    const C = [146.83, 207.65, 293.66];
    for (let i = 0; i < C.length; i++) brass(o, t + 0.05, C[i] * p, 0.7, 0.035, { a: 0.08, hold: 0.2, bright: 3 });
  });
  def('victory', { wet: 0.3, pri: 1, jit: 0 }, (o, t, p) => {
    const N = [[0, 392, 0.1], [0.13, 523.25, 0.1], [0.26, 659.25, 0.1], [0.39, 783.99, 0.38], [0.82, 659.25, 0.12], [0.98, 783.99, 1.1]];
    for (let i = 0; i < N.length; i++) brass(o, t + N[i][0], N[i][1] * p, N[i][2] + 0.12, 0.07, { a: 0.015, hold: N[i][2] * 0.6 });
    const C = [261.63, 329.63, 392, 523.25];
    for (let i = 0; i < C.length; i++) brass(o, t + 0.98, C[i] * p, 1.2, 0.04, { a: 0.04, hold: 0.5, bright: 3 });
    const B = [0, 0.39, 0.98];
    for (let i = 0; i < B.length; i++) tone(o, t + B[i], 65.4 * p, 0.5, 0.28, { f1: 55 * p });
    sparkle(o, t + 1.0, 10, 1.0, 0.024, 1046.5 * p, 0);
    partials(o, t + 0.98, 1046.5 * p, 1.4, 0.04, P_CHIME);
  });
  def('near_miss', { wet: 0.25, jit: 0.008 }, (o, t, p) => {
    vox(o, t, 330 * p, 0.2, 0.06, 'o', { a: 0.04, hold: 0.06 });
    tone(o, t, 330 * p, 0.2, 0.025, { a: 0.04, hold: 0.06, type: 'triangle' });
    vox(o, t + 0.24, 262 * p, 0.35, 0.06, 'o', { a: 0.04, hold: 0.06, f1: 247 * p });
    tone(o, t + 0.24, 262 * p, 0.35, 0.025, { a: 0.04, hold: 0.06, type: 'triangle', f1: 247 * p });
  });

  // 拍子木 (hyoshigi): two dry wooden claps — the scene changes, the Ashwheel's script moves on
  def('clack', { wet: 0.22, pri: 1, jit: 0.02 }, (o, t, p) => {
    for (const [dt, k] of [[0, 1], [0.105, 1.07]]) {
      noise(o, t + dt, 0.022, 0.42, { type: 'bandpass', f: 2350 * p * k, q: 7 });
      noise(o, t + dt, 0.035, 0.18, { type: 'bandpass', f: 1150 * p * k, q: 4, buf: 'pink' });
      tone(o, t + dt, 930 * p * k, 0.045, 0.09, { a: 0.001, type: 'triangle', f1: 860 * p * k });
      tone(o, t + dt, 1870 * p * k, 0.025, 0.035, { a: 0.001 });
    }
  });

  // ---- 最深の間 (B17): the puppeteer's strings and the paper theater
  def('string_pluck', { wet: 0.25, jit: 0.02 }, (o, t, p) => {
    tone(o, t, 880 * p, 0.6, 0.12, { type: 'triangle', f1: 840 * p, glide: 0.1, lp: 6000, lp1: 1800, lpT: 0.4 });
    tone(o, t, 1760 * p, 0.3, 0.035);
    tone(o, t, 3520 * p, 0.08, 0.02, { a: 0.001 });
  });
  def('string_snap', { wet: 0.4, pri: 1, jit: 0.02 }, (o, t, p) => {
    noise(o, t, 0.05, 0.5, { type: 'highpass', f: 2500 });
    tone(o, t, 1400 * p, 0.12, 0.14, { type: 'triangle', f1: 3600 * p, glide: 0.05 });
    tone(o, t, 700 * p, 0.35, 0.08, { type: 'triangle', f1: 420 * p, glide: 0.3 }); // the loose end whips back
    noise(o, t + 0.04, 0.25, 0.12, { type: 'bandpass', f: 4200, f1: 1200, glide: 0.25, q: 2 });
    thud(o, t, 110 * p, 0.3, 0.3);
    partials(o, t + 0.02, 1046.5 * p, 0.9, 0.04, P_CHIME);
  });
  def('lift_winch', { wet: 0.25, pri: 1, jit: 0.02 }, (o, t, p) => {
    ratchet(o, t, 12, 0.8, 0.15, 1500 * p);
    const ac = G.ctx, end = t + 0.85;
    const src = ac.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(48 * p, t); src.frequency.linearRampToValueAtTime(96 * p, end);
    lfo(src.frequency, t, end, 11, 5);
    const eg = ac.createGain(); env(eg.gain, t, 0.08, 0.2, 0.25, 0.5); eg.connect(o);
    filt(src, 'bandpass', 900 * p, 7, t).connect(eg);
    src.start(t); src.stop(end + 0.05); mark(end);
  });
  def('drop_slam', { wet: 0.3, pri: 1, jit: 0.02 }, (o, t, p) => {
    tone(o, t, 62 * p, 0.7, 0.55, { f1: 34 * p, glide: 0.5 });
    noise(o, t, 0.25, 0.45, { type: 'lowpass', f: 2200, f1: 200, glide: 0.2, buf: 'pink' });
    noise(o, t, 0.06, 0.3, { type: 'bandpass', f: 1300, q: 3 }); // the wood
    partials(o, t, 180 * p, 0.5, 0.06, P_PLATE);
  });
  def('mask_crack', { wet: 0.35, pri: 1, jit: 0.02 }, (o, t, p) => {
    for (let i = 0; i < 6; i++) noise(o, t + i * 0.03 + rnd() * 0.02, 0.012, 0.3 * (1 - i * 0.1), { type: 'bandpass', f: 2600 + rnd() * 3000, q: 4 });
    partials(o, t + 0.05, 1320 * p, 0.6, 0.05, P_GLASS);
    tone(o, t + 0.05, 330 * p, 0.6, 0.06, { type: 'triangle', f1: 300 * p });
  });
  def('curtain_fall', { wet: 0.35, pri: 1, jit: 0.02 }, (o, t, p) => {
    noise(o, t, 0.9, 0.3, { a: 0.15, type: 'lowpass', f: 1800, f1: 300, glide: 0.9, buf: 'pink' });
    noise(o, t + 0.85, 0.3, 0.35, { type: 'lowpass', f: 500, buf: 'brown' });
    thud(o, t + 0.85, 70 * p, 0.4, 0.4);
  });
  def('theater_collapse', { wet: 0.45, pri: 1, jit: 0.01 }, (o, t, p) => {
    for (let i = 0; i < 5; i++) {
      const tt = t + i * 0.32 + rnd() * 0.08;
      thud(o, tt, (90 - i * 8) * p, 0.4, 0.35);
      noise(o, tt, 0.2, 0.3, { type: 'lowpass', f: 1600, f1: 250, glide: 0.2, buf: 'pink' });
      noise(o, tt, 0.05, 0.2, { type: 'bandpass', f: 1200 + rnd() * 800, q: 3 });
    }
    const ac = G.ctx, end = t + 1.4;
    const src = ac.createOscillator(); src.type = 'sawtooth'; // the frame groans as it goes
    src.frequency.setValueAtTime(70 * p, t); src.frequency.linearRampToValueAtTime(40 * p, end);
    lfo(src.frequency, t, end, 7, 6);
    const eg = ac.createGain(); env(eg.gain, t, 0.2, 0.18, 0.4, 0.8); eg.connect(o);
    filt(src, 'bandpass', 700 * p, 6, t).connect(eg);
    src.start(t); src.stop(end + 0.05); mark(end);
    noise(o, t + 0.2, 1.6, 0.3, { a: 0.4, type: 'lowpass', f: 160, buf: 'brown' });
  });
  // the title's theme, once, on a music box (the silence after the last string)
  def('music_box', { wet: 0.5, pri: 1, jit: 0 }, (o, t, p) => {
    const sc = SC.aeolian, R = 329.63 * p;
    for (const [k, deg] of THEME) {
      const f = R * Math.pow(2, (sc[deg % 7] + 12 * Math.floor(deg / 7)) / 12), tt = t + k * 0.36;
      tone(o, tt, f, 1.4, 0.06, { a: 0.002 }); tone(o, tt, f * 2, 0.4, 0.006, { a: 0.002 }); tone(o, tt, f * 5.4, 0.06, 0.003, { a: 0.001 });
    }
  });

  // Mix table: per-SFX gain, balanced from offline metering (short-term loudness). Tiers, at full volume:
  // big moments ≈ -12 dB · combat ≈ -18 dB · device/feedback ≈ -22 dB · UI ≈ -28 dB · ticks/hover/ember ≈ -35 dB peak.
  const MIX = {
    spin_start: 1.8, reel_tick: 1.6, reel_stop: 1.1, anticipation: 0.85, hold: 2, unhold: 2, respin: 2.5, nudge: 2.5, resolve: 1.4,
    blade: 3.5, blade_big: 1.4, flame: 1, heal: 1.7, ward: 2.2, lantern: 2, skull: 1, enemy_hit: 1.8, enemy_hit_big: 1.1,
    party_hit: 1.8, block: 2.4, armor_clank: 2.5, burn: 1.6,
    enemy_die: 2.2, combo_pair: 1.4, combo_triple: 1, combo_bond: 1, jackpot: 1.7, seal_break: 1, reaper: 0.8,
    hex: 1.7, drain: 1.6, jam: 1, mark: 1.9, reflect: 2.2, enemy_heal: 2, windup: 0.6, doom_tick: 1,
    ui_hover: 1.5, ui_click: 1.6, ui_confirm: 1.6, ui_deny: 1.6, unlock: 2.5, ember: 2, spark_gain: 1.5, spark_use: 3,
    door: 0.8, step: 1.6, reward: 2, relic: 2, second_wind: 1, death: 1.3, boss_appear: 0.85, boss_phase: 1, victory: 1,
    near_miss: 2.5, clack: 2.2,
    string_pluck: 3.6, string_snap: 3, lift_winch: 5.6, drop_slam: 1, mask_crack: 4, curtain_fall: 1.2, theater_collapse: 0.9, music_box: 1.8,
  };
  Object.keys(MIX).forEach((k) => { if (SFX[k]) SFX[k].v = MIX[k]; });

  // ------------------------------------------------------------------ SFX playback
  function voice(v, wet, pan) {
    const ac = G.ctx;
    const o = ac.createGain(); o.gain.value = v;
    let out = o, pn = null, w = null;
    if (pan && ac.createStereoPanner) { pn = ac.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1); o.connect(pn); out = pn; }
    out.connect(G.sfx);
    if (wet > 0) { w = ac.createGain(); w.gain.value = wet; out.connect(w); w.connect(G.sfxRev); }
    return {
      o,
      free() { active = Math.max(0, active - 1); try { out.disconnect(); if (w) w.disconnect(); if (pn) o.disconnect(); } catch (e) { /* already gone */ } },
    };
  }
  function emit(sd, t, p, v, n, pan, p0) {
    const vc = voice(v, sd.wet || 0, pan);
    endT = t;
    try { sd.fn(vc.o, t, p, n, p0); } catch (e) { if (SD.Audio && SD.Audio.debug) console.warn('[audio]', e); }
    if (G === mainG) {
      active++;
      setTimeout(vc.free, Math.max(0.1, endT - G.ctx.currentTime + 0.3) * 1000);
    }
    return true;
  }
  function play(name, opts) {
    if (!mainG || G !== mainG) return false;
    const sd = SFX[name];
    if (!sd) return false;
    opts = opts || {};
    const ac = G.ctx;
    if (ac.state === 'suspended' || ac.state === 'interrupted') { try { ac.resume(); } catch (e) { /* ignore */ } }
    const n = opts.n | 0;
    const key = sd.keyN ? name + ':' + n : name;
    const w = wall(), last = lastPlay[key];
    if (last != null && w - last < (sd.gap != null ? sd.gap : 0.025)) return false;
    let k = 1;
    if (sd.burst) {
      burstN[key] = last != null && w - last < sd.burst ? (burstN[key] || 0) + 1 : 0;
      k = Math.max(sd.burstMin || 0.35, 1 / (1 + burstN[key] * 0.15));
    }
    if (active >= MAX_VOICES * 2 || (active >= MAX_VOICES && !sd.pri)) return false;
    lastPlay[key] = w;
    const p0 = opts.pitch > 0 ? +opts.pitch : 1;
    const p = p0 * (1 + (rnd() * 2 - 1) * (sd.jit != null ? sd.jit : 0.03));
    const v = (opts.vol != null && isFinite(opts.vol) ? Math.max(0, +opts.vol) : 1) * (sd.v || 1) * k;
    const t = ac.currentTime + 0.006 + Math.max(0, +opts.delay || 0);
    const pan = opts.pan != null && isFinite(opts.pan) ? +opts.pan : sd.pan ? sd.pan(n) : 0;
    return emit(sd, t, p, v, n, pan, p0);
  }

  // ------------------------------------------------------------------ music
  // the title's theme ([step, scale degree]; 最深の間: the music box, and the puppeteer's 終幕 in minor)
  const THEME = [[0, 7], [1, 9], [2, 11], [3, 9], [4, 11], [5.5, 10], [7, 7]];
  const SC = {
    aeolian: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], ionian: [0, 2, 4, 5, 7, 9, 11],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
  };
  function degF(d, deg, oct) {
    const sc = d.scale, L = sc.length, o = Math.floor(deg / L), i = deg - o * L;
    return d.root * Math.pow(2, (sc[i] + 12 * (o + (oct || 0))) / 12);
  }
  function wrapF(f, lo, hi) { if (!(f > 0)) return lo; while (f > hi) f /= 2; while (f < lo) f *= 2; return f; }
  function mNote(inst, send, pan) {
    const ac = G.ctx, n = ac.createGain();
    let out = n;
    if (pan && ac.createStereoPanner) { const pn = ac.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1); n.connect(pn); out = pn; }
    out.connect(inst.in);
    if (send && inst.dly) out.connect(inst.dly);
    return n;
  }
  function mPad(inst, t, freqs, dur, g, cut, saw) {
    const ac = G.ctx;
    const a = Math.min(1.8, dur * 0.4), rel = Math.min(3, dur * 0.6 + 0.8), end = t + dur + rel;
    const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 0.6;
    fl.frequency.setValueAtTime(cut * 0.6, t);
    fl.frequency.linearRampToValueAtTime(cut, t + dur * 0.5);
    fl.frequency.linearRampToValueAtTime(cut * 0.55, end);
    const eg = ac.createGain();
    eg.gain.setValueAtTime(0, t);
    eg.gain.linearRampToValueAtTime(g, t + a);
    eg.gain.setValueAtTime(g, t + dur);
    eg.gain.linearRampToValueAtTime(0, end);
    const sg = ac.createGain(); sg.gain.value = saw; sg.connect(fl);
    for (let i = 0; i < freqs.length; i++) {
      const o1 = ac.createOscillator(); o1.type = 'triangle'; o1.frequency.value = freqs[i]; o1.detune.value = -5 + rnd() * 2; o1.connect(fl);
      const o2 = ac.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = freqs[i]; o2.detune.value = 5 + rnd() * 3; o2.connect(sg);
      o1.start(t); o2.start(t); o1.stop(end + 0.05); o2.stop(end + 0.05);
    }
    fl.connect(eg); eg.connect(mNote(inst, false));
  }
  // Music voices: (inst, t, f, g, pan)
  const MV = {
    box(inst, t, f, g, pan) {        // music-box tine
      const o = mNote(inst, true, pan);
      tone(o, t, f, 1.6, g, { a: 0.002 });
      tone(o, t, f * 2, 0.45, g * 0.1, { a: 0.002 });
      tone(o, t, f * 5.4, 0.06, g * 0.05, { a: 0.001 });
    },
    pluck(inst, t, f, g, pan) {      // nylon-ish pluck
      const o = mNote(inst, true, pan);
      tone(o, t, f, 1.1, g, { type: 'triangle', a: 0.003, lp: f * 6, lp1: f * 1.5, lpT: 0.4 });
      tone(o, t, f, 0.5, g * 0.3, { type: 'sawtooth', a: 0.003, lp: f * 4, lp1: f * 1.2, lpT: 0.25 });
    },
    bell(inst, t, f, g) {            // low, far bell
      partials(mNote(inst, true), t, f, 3.6, g, P_BELL);
    },
    pulse(inst, t, f, g) {           // soft heartbeat bass
      const o = mNote(inst);
      tone(o, t, f, 0.55, g, { a: 0.02 });
      tone(o, t, f * 2, 0.3, g * 0.18, { a: 0.02, type: 'triangle' });
    },
    bassPluck(inst, t, f, g) {       // muted ostinato bass
      const o = mNote(inst);
      tone(o, t, f, 0.3, g, { type: 'sawtooth', a: 0.004, lp: f * 7, lp1: f * 1.4, lpT: 0.18, q: 2 });
      tone(o, t, f, 0.33, g * 0.6, { a: 0.004 });
    },
    swell(inst, t, freqs, dur, g) {  // brass crescendo (boss)
      const ac = G.ctx, end = t + dur + 0.35;
      const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 1.1;
      fl.frequency.setValueAtTime(240, t); fl.frequency.exponentialRampToValueAtTime(1300, t + dur); fl.frequency.exponentialRampToValueAtTime(280, end);
      const eg = ac.createGain();
      eg.gain.setValueAtTime(0, t); eg.gain.linearRampToValueAtTime(g, t + dur); eg.gain.linearRampToValueAtTime(0, end);
      for (let i = 0; i < freqs.length; i++) for (let k = 0; k < 2; k++) {
        const s = ac.createOscillator(); s.type = 'sawtooth'; s.frequency.value = freqs[i]; s.detune.value = k ? 7 : -7;
        s.connect(fl); s.start(t); s.stop(end + 0.05);
      }
      fl.connect(eg); eg.connect(mNote(inst, false));
    },
    twang(inst, t, f, g, pan) {      // a plucked string, bending down a little (the puppeteer's strings)
      const o = mNote(inst, true, pan);
      tone(o, t, f * 1.03, 0.5, g, { type: 'triangle', a: 0.002, f1: f, glide: 0.08, lp: f * 8, lp1: f * 2, lpT: 0.3 });
      tone(o, t, f * 2.01, 0.25, g * 0.25, { a: 0.002 });
      tone(o, t, f * 3.98, 0.08, g * 0.1, { a: 0.001 });
    },
    organ(inst, t, freqs, dur, g) {  // drawbar organ: 8' + 4' + 2 2/3', held, with a slow tremulant
      const o = mNote(inst, true), hold = Math.max(0.1, dur - 0.1);
      for (const f of freqs) {
        tone(o, t, f, 0.35, g, { a: 0.05, hold, vib: [5.6, f * 0.004, 0.2] });
        tone(o, t, f * 2, 0.3, g * 0.5, { a: 0.05, hold });
        tone(o, t, f * 3, 0.25, g * 0.25, { a: 0.05, hold });
      }
    },
    choir(inst, t, freqs, dur, g) {  // formant voices on 'o'
      const o = mNote(inst, true);
      for (const f of freqs) vox(o, t, f, 1.2, g, 'o', { a: 0.6, hold: Math.max(0.2, dur - 1.4) });
    },
    lead(inst, t, f, g, pan) {       // the brass lead (終幕の段)
      brass(mNote(inst, true, pan), t, f, 0.22, g, { a: 0.012, hold: 0.12, bright: 4 });
    },
  };
  // how far a layered track's layer k has faded in at time t (0 while it is not reached)
  function lay(inst, k, t) { return inst.layer >= k ? clamp((t - (inst.layerAt[k] || -99)) / 2.5, 0, 1) : 0; }
  const PV = {
    taiko(inst, t, g, f) { const o = mNote(inst); tone(o, t, f, 0.4, g, { f1: f * 0.62, glide: 0.25 }); noise(o, t, 0.05, g * 0.5, { type: 'lowpass', f: 500, buf: 'pink' }); },
    rim(inst, t, g) { const o = mNote(inst, false, -0.2); noise(o, t, 0.05, g, { type: 'bandpass', f: 1700, q: 2.5 }); tone(o, t, 380, 0.04, g * 0.5); },
    shaker(inst, t, g) { noise(mNote(inst, false, 0.25), t, 0.035, g, { a: 0.008, type: 'bandpass', f: 6500, q: 1.2 }); },
    tick(inst, t, g, f) { const o = mNote(inst, false, 0.15); noise(o, t, 0.012, g, { type: 'bandpass', f, q: 5 }); tone(o, t, f * 0.5, 0.018, g * 0.4); },
    clank(inst, t, g) { const o = mNote(inst, true, inst.rng() - 0.5); partials(o, t, 300 + inst.rng() * 300, 1.0, g, P_METAL); noise(o, t, 0.02, g * 1.5, { type: 'bandpass', f: 2000, q: 1.5 }); },
    crackle(inst, t, g) { noise(mNote(inst, false, inst.rng() * 1.2 - 0.6), t, 0.004 + rnd() * 0.01, g, { type: 'bandpass', f: 1800 + rnd() * 3500, q: 1.5 }); },
    drip(inst, t, g) { const f = 700 + rnd() * 900; tone(mNote(inst, true, rnd() * 1.4 - 0.7), t, f, 0.07, g, { f1: f * 2.1, glide: 0.035 }); },
    creak(inst, t, g) {              // a fly rope groaning on its pulley
      const ac = G.ctx, o = mNote(inst, true, inst.rng() - 0.5), end = t + 0.5;
      const src = ac.createOscillator(); src.type = 'sawtooth';
      src.frequency.setValueAtTime(70, t); src.frequency.linearRampToValueAtTime(95, t + 0.2); src.frequency.linearRampToValueAtTime(60, end);
      const eg = ac.createGain(); env(eg.gain, t, 0.05, g, 0.25, 0.2); eg.connect(o);
      filt(src, 'bandpass', 1100, 8, t).connect(eg);
      src.start(t); src.stop(end + 0.05); mark(end);
    },
  };

  /* Track definitions.
   * root (Hz) + scale; stepDur (s per step); bar (steps); chordSteps; prog (scale-degree chord roots).
   * pad: soft drone chord per chord change (+ tonic an octave below). arp: sparse pattern of chord-tone indices
   * (null = rest), voiced by a music-box/pluck, with seeded variation (pattern choice, skipped notes, passing tones,
   * resting bars, slow density swell). motifs: [[step, scaleDegree], ...] fragments. bell: occasional low bell.
   */
  const TRACK_DEFS = {
    title: {
      root: 164.81, scale: SC.aeolian, stepDur: 0.55, bar: 8, chordSteps: 16, prog: [0, 5, 3, 6, 0, 5, 2, 4], vol: 1, wet: 0.65,
      pad: { tones: [0, 2, 4], g: 0.02, cut: 650, saw: 0.25 },
      arp: { voice: 'box', oct: 1, g: 0.042, density: 0.5, rest: 0.3, pass: 0.1, sev: true, spread: 0.6,
        patterns: [[0, null, null, 2, null, null, 4, null], [null, 4, null, 2, null, 1, null, null], [3, null, 2, null, null, null, 1, null], [0, null, 2, null, 4, null, 6, null]] },
      motifs: [[[0, 7], [2, 9], [4, 11], [6, 9]], [[0, 11], [3, 10], [6, 7]], [[0, 4], [2, 7], [3, 6], [6, 4]]], motifP: 0.22, motifOct: 1,
      bell: { p: 0.35, g: 0.03 },
    },
    camp: {
      root: 196.0, scale: SC.ionian, stepDur: 0.42, bar: 6, chordSteps: 12, prog: [0, 3, 0, 4, 5, 3, 1, 4], vol: 1, wet: 0.45,
      pad: { tones: [0, 2, 4], g: 0.018, cut: 950, saw: 0.3 },
      arp: { voice: 'pluck', oct: 0, g: 0.05, density: 0.85, rest: 0.12, pass: 0.05, spread: 0.5,
        patterns: [[0, 1, 2, 3, 2, 1], [0, 2, 3, 4, 3, 2], [0, null, 2, 3, null, 2], [0, 1, 2, null, 3, null]] },
      motifs: [[[0, 9], [2, 8], [3, 7], [4, 9]], [[0, 11], [2, 9], [4, 7]], [[0, 7], [1, 8], [2, 9], [4, 11]]], motifP: 0.3, motifOct: 1, motifVoice: 'box', motifG: 0.035,
      bell: { p: 0.1, g: 0.022 },
      perc(inst, s, sib, bar, t) {
        const r = inst.rng, sd = inst.def.stepDur;
        if (r() < 0.55) PV.crackle(inst, t + r() * sd, 0.012 + r() * 0.02);
        if (r() < 0.25) PV.crackle(inst, t + r() * sd, 0.01 + r() * 0.015);
        if (r() < 0.035) PV.crackle(inst, t + r() * sd, 0.05);
      },
    },
    cellar: {
      root: 220.0, scale: SC.aeolian, stepDur: 0.36, bar: 8, chordSteps: 16, prog: [0, 5, 3, 4, 0, 5, 2, 6], vol: 0.9, wet: 0.5,
      pad: { tones: [0, 2, 4], g: 0.018, cut: 750, saw: 0.3 },
      arp: { voice: 'box', oct: 1, g: 0.04, density: 0.55, rest: 0.25, pass: 0.08, spread: 0.6,
        patterns: [[0, null, 2, null, 4, null, 2, null], [0, null, null, 2, null, null, 3, null], [4, null, 2, null, 1, null, null, null], [null, null, 0, null, 2, null, 4, 3]] },
      motifs: [[[0, 4], [2, 3], [4, 2], [6, 0]], [[0, 7], [2, 6], [3, 4], [6, 2]]], motifP: 0.2, motifOct: 1,
      pulse: { steps: [0, 4], g: 0.1 },
      bell: { p: 0.22, g: 0.028 },
    },
    ossuary: {
      root: 146.83, scale: SC.dorian, stepDur: 0.62, bar: 8, chordSteps: 16, prog: [0, 3, 0, 6, 0, 3, 4, 6], vol: 0.9, wet: 0.75,
      pad: { tones: [0, 2, 4], g: 0.02, cut: 520, saw: 0.12 },
      arp: { voice: 'box', oct: 2, g: 0.03, density: 0.4, rest: 0.35, pass: 0.1, spread: 0.8,
        patterns: [[0, null, null, null, 2, null, null, null], [null, null, 4, null, null, 3, null, null], [2, null, null, 1, null, null, 0, null]] },
      motifs: [[[0, 4], [3, 5], [6, 3]], [[0, 7], [2, 5], [4, 4], [6, 2]]], motifP: 0.2, motifOct: 1,
      delay: { time: 0.93, fb: 0.42, lp: 1800, send: 0.5, wobbleHz: 0.21, wobble: 0.0045 },
      bell: { p: 0.3, g: 0.028 },
      perc(inst, s, sib, bar, t) { const r = inst.rng; if (r() < 0.06) PV.drip(inst, t + r() * inst.def.stepDur, 0.018 + r() * 0.012); },
    },
    gearworks: {
      root: 130.81, scale: SC.phrygian, stepDur: 0.32, bar: 8, chordSteps: 32, prog: [0, 1, 0, 6], vol: 1, wet: 0.4,
      pad: { tones: [0, 2, 4], g: 0.018, cut: 480, saw: 0.45 },
      arp: { voice: 'box', oct: 2, g: 0.024, density: 0.3, rest: 0.4, pass: 0.05, spread: 0.7,
        patterns: [[0, null, null, null, null, null, 1, null], [null, null, 2, null, null, null, null, 1], [4, null, null, 3, null, null, null, null]] },
      bell: { p: 0.25, g: 0.026 },
      perc(inst, s, sib, bar, t, cr) {
        const r = inst.rng, d = inst.def;
        if (sib % 2 === 0) PV.tick(inst, t, sib === 0 ? 0.045 : 0.028, sib % 4 === 0 ? 2100 : 1500);
        if ((sib === 0 || sib === 3 || sib === 6) && r() < 0.85) MV.bassPluck(inst, t, wrapF(degF(d, cr, -1), d.root * 0.42, d.root * 0.84), sib === 0 ? 0.06 : 0.042);
        if (sib === 5 && bar % 4 === 2 && r() < 0.5) PV.clank(inst, t, 0.01);
      },
    },
    boss: {
      root: 146.83, scale: SC.phrygian, stepDur: 0.2, bar: 8, chordSteps: 32, prog: [0, 0, 5, 1], vol: 0.62, wet: 0.3,
      pad: { tones: [0, 4], g: 0.022, cut: 650, saw: 0.6 },
      arp: { voice: 'box', oct: 2, g: 0.022, density: 0.3, rest: 0.5, pass: 0, spread: 0.8,
        patterns: [[0, null, null, 1, null, null, 0, null], [null, null, 2, null, null, 1, null, null]] },
      bell: { p: 0.3, g: 0.028 },
      onChord(inst, ci, cr, t) {
        const d = inst.def, dur = d.chordSteps * d.stepDur;
        if (inst.rng() < 0.55) {
          const lo = d.root * 0.84, hi = lo * 2;
          MV.swell(inst, t + dur - 2.4, [wrapF(degF(d, cr, 0), lo, hi), wrapF(degF(d, cr + 4, 0), lo, hi)], 2.2, 0.03);
        }
      },
      perc(inst, s, sib, bar, t, cr) {
        const d = inst.def, OST = [0, 0, 7, 0, 0, 1, 0, -1];
        const strong = sib === 0 || sib === 3 || sib === 6;
        MV.bassPluck(inst, t, degF(d, (cr > 3 ? cr - 7 : cr) + OST[sib], -1), strong ? 0.07 : 0.045);
        if (strong) PV.taiko(inst, t, sib === 0 ? 0.2 : 0.13, sib === 0 ? 72 : 84);
        if (sib === 4) PV.rim(inst, t, 0.05);
        PV.shaker(inst, t, sib % 2 ? 0.012 : 0.02);
        if (bar % 4 === 3 && sib >= 6) PV.taiko(inst, t + d.stepDur * 0.5, 0.09, 110);
      },
    },
    // 最深の間 (B17), before the fight: the backstage — a low drone, a rope creaking now and then, and once, far away,
    // the title's theme on a music box
    backstage: {
      root: 110, scale: SC.aeolian, stepDur: 0.6, bar: 8, chordSteps: 32, prog: [0, 5], vol: 0.9, wet: 0.7,
      pad: { tones: [0, 4], g: 0.02, cut: 420, saw: 0.15 },
      arp: { voice: 'box', oct: 2, g: 0, density: 0, rest: 1, patterns: [[null]] },
      bell: { p: 0.15, g: 0.02 },
      perc(inst, s, sib, bar, t) {
        const r = inst.rng;
        if (r() < 0.05) PV.creak(inst, t + r() * 0.3, 0.05 + r() * 0.04);
        if (s === 12) for (const [k, deg] of THEME) MV.box(inst, t + k * 0.42, degF(inst.def, deg, 1), 0.03, 0.3);
      },
    },
    // 深淵の繰り手 (B17): one piece that grows by act (SD.Audio.setMusicLayer): ① taiko, a winding bass and plucked
    // strings ② an organ holds the chords ③ a choir and トト's bell ④ the title's theme in minor, fast, on brass
    kurite: {
      root: 164.81, scale: SC.aeolian, stepDur: 0.19, bar: 8, chordSteps: 32, prog: [0, 5, 3, 4], vol: 0.66, wet: 0.32, layers: 4,
      pad: { tones: [0, 4], g: 0.016, cut: 600, saw: 0.5 },
      arp: { voice: 'box', oct: 2, g: 0, density: 0, rest: 1, patterns: [[null]] },
      perc(inst, s, sib, bar, t, cr) {
        const d = inst.def, r = inst.rng, OST = [0, 0, 7, 0, 0, 1, 0, -1], strong = sib === 0 || sib === 3 || sib === 6;
        const c0 = cr > 3 ? cr - 7 : cr;
        MV.bassPluck(inst, t, degF(d, c0 + OST[sib], -1), strong ? 0.07 : 0.045);
        if (strong) PV.taiko(inst, t, sib === 0 ? 0.2 : 0.13, sib === 0 ? 70 : 82);
        if (bar % 4 === 3 && sib >= 6) PV.taiko(inst, t + d.stepDur * 0.5, 0.09, 108);
        if ((sib === 2 || sib === 7) && r() < 0.7) MV.twang(inst, t, degF(d, c0 + (sib === 2 ? 4 : 2), 1), 0.035, sib === 2 ? -0.4 : 0.4);
        const L2 = lay(inst, 2, t);
        if (L2 && sib === 0) MV.organ(inst, t, [0, 2, 4].map((k) => wrapF(degF(d, cr + k, 0), d.root * 0.84, d.root * 1.68)), d.bar * d.stepDur, 0.02 * L2);
        const L3 = lay(inst, 3, t);
        if (L3 && sib === 0 && bar % 2 === 0) MV.choir(inst, t, [wrapF(degF(d, cr, 1), d.root, d.root * 2), wrapF(degF(d, cr + 2, 1), d.root, d.root * 2)], d.bar * d.stepDur * 2, 0.026 * L3);
        if (L3 && sib === 0 && r() < 0.5) MV.bell(inst, t + d.stepDur * 4, wrapF(degF(d, cr + 4, 1), d.root, d.root * 2), 0.03 * L3);
        const L4 = lay(inst, 4, t);
        if (L4) {
          // (the theme over each bar; every other bar answers it two degrees lower)
          for (const [k, deg] of THEME) if (Math.floor(k) === sib) MV.lead(inst, t + (k % 1) * d.stepDur, degF(d, deg - (bar % 2) * 2, 0), 0.04 * L4, (r() - 0.5) * 0.3);
          if (sib % 2 === 1) PV.taiko(inst, t, 0.06 * L4, 120);
          PV.shaker(inst, t, (sib % 2 ? 0.012 : 0.02) * L4);
        }
      },
    },
    victory: {
      root: 261.63, scale: SC.ionian, stepDur: 0.28, bar: 8, chordSteps: 8, prog: [0, 3, 4, 0, 5, 3, 1, 4], vol: 0.95, wet: 0.45,
      pad: { tones: [0, 2, 4], g: 0.018, cut: 1200, saw: 0.35 },
      arp: { voice: 'box', oct: 1, g: 0.04, density: 0.9, rest: 0.05, pass: 0.04, spread: 0.6,
        patterns: [[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 4, 2, 3, 4, 5, 4], [0, null, 2, 3, null, 4, 3, 2]] },
      pulse: { steps: [0, 4], g: 0.07 },
      bell: { p: 0.3, g: 0.022 },
      perc(inst, s, sib, bar, t, cr) {
        const d = inst.def;
        if (sib % 2 === 0) PV.shaker(inst, t, 0.009);
        if (sib === 0 || sib === 4) MV.pluck(inst, t, wrapF(degF(d, cr, 0), d.root * 0.84, d.root * 1.68), 0.03, -0.3);
      },
    },
  };

  function makeInst(name, seed) {
    const d = TRACK_DEFS[name], ac = G.ctx;
    const inst = { name, def: d, step: 0, nextT: 0, rng: makeRng(seed), lfos: [], nodes: [], barPlay: false, pattern: null, motif: null, noteP: 0, layer: d.layers ? 1 : 0, layerAt: [] };
    inst.phase = inst.rng() * 6.283;
    inst.out = ac.createGain(); inst.out.gain.value = 0; inst.out.connect(G.music);
    const wet = ac.createGain(); wet.gain.value = d.wet; inst.out.connect(wet); wet.connect(G.musicRev);
    inst.in = ac.createGain(); inst.in.connect(inst.out);
    inst.nodes.push(inst.in, inst.out, wet);
    if (d.delay) {   // watery feedback delay with a slowly wobbling time
      const dl = ac.createDelay(2), fb = ac.createGain(), lp = ac.createBiquadFilter();
      dl.delayTime.value = d.delay.time; fb.gain.value = d.delay.fb;
      lp.type = 'lowpass'; lp.frequency.value = d.delay.lp;
      inst.dly = ac.createGain(); inst.dly.gain.value = d.delay.send;
      inst.dly.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(inst.out);
      const l = ac.createOscillator(), lg = ac.createGain();
      l.frequency.value = d.delay.wobbleHz; lg.gain.value = d.delay.wobble;
      l.connect(lg); lg.connect(dl.delayTime); l.start();
      inst.lfos.push(l); inst.nodes.push(inst.dly, dl, fb, lp, lg);
    }
    return inst;
  }
  function killInst(inst) {
    for (let i = 0; i < inst.lfos.length; i++) { try { inst.lfos[i].stop(); } catch (e) { /* ignore */ } }
    for (let i = 0; i < inst.nodes.length; i++) { try { inst.nodes[i].disconnect(); } catch (e) { /* ignore */ } }
  }
  function trackStep(inst, s, t) {
    const d = inst.def, r = inst.rng, A = d.arp;
    const sib = s % d.bar, bar = Math.floor(s / d.bar);
    const ci = Math.floor(s / d.chordSteps) % d.prog.length;
    const cr = d.prog[ci];
    const cra = cr > 3 ? cr - 7 : cr; // keep arps centred around the tonic
    if (s % d.chordSteps === 0) {
      const lo = d.root * 0.84, hi = lo * 2;
      const fs = d.pad.tones.map((k) => wrapF(degF(d, cr + k, 0), lo, hi));
      fs.push(d.root / 2); // drone: tonic pedal
      mPad(inst, t, fs, d.chordSteps * d.stepDur, d.pad.g, d.pad.cut, d.pad.saw);
      if (d.bell && r() < d.bell.p) MV.bell(inst, t + d.stepDur * (r() < 0.5 ? 0 : 2), wrapF(degF(d, cr, 0), d.root * 0.6, d.root * 1.2), d.bell.g);
      if (d.onChord) d.onChord(inst, ci, cr, t);
    }
    if (sib === 0) {
      inst.pattern = A.patterns[(r() * A.patterns.length) | 0];
      inst.barPlay = r() >= (A.rest || 0);
      inst.noteP = A.density * (0.7 + 0.3 * Math.sin(bar * 0.483 + inst.phase)); // slow breathing of density
      inst.motif = null;
      if (d.motifs && r() < (d.motifP || 0)) { inst.motif = d.motifs[(r() * d.motifs.length) | 0]; inst.noteP *= 0.5; }
    }
    if (inst.barPlay) {
      const k = inst.pattern[sib % inst.pattern.length];
      if (k != null && r() < inst.noteP) {
        const tpo = A.sev ? 4 : 3;
        let deg = cra + 2 * (k % tpo) + 7 * Math.floor(k / tpo);
        if (A.pass && r() < A.pass) deg += r() < 0.5 ? 1 : -1;
        const accent = sib === 0 ? 1 : sib % 2 ? 0.72 : 0.86;
        MV[A.voice](inst, t + r() * 0.012, degF(d, deg, A.oct), A.g * accent * (0.8 + 0.2 * r()), (r() - 0.5) * (A.spread || 0.5));
      }
    }
    if (inst.motif) {
      for (let i = 0; i < inst.motif.length; i++) {
        const m = inst.motif[i];
        if (m[0] === sib) MV[d.motifVoice || 'box'](inst, t, degF(d, m[1], d.motifOct || 0), d.motifG || A.g * 1.1, (r() - 0.5) * 0.3);
      }
    }
    if (d.pulse && d.pulse.steps.indexOf(sib) >= 0) MV.pulse(inst, t, wrapF(degF(d, cr, -1), d.root * 0.42, d.root * 0.84), d.pulse.g * (sib === 0 ? 1 : 0.8));
    if (d.perc) d.perc(inst, s, sib, bar, t, cr);
  }
  function schedTick() {
    music.timer = null;
    if (!mainG || !music.cur) return;
    const prevG = G; G = mainG;
    const ac = mainG.ctx, inst = music.cur, d = inst.def, now = ac.currentTime;
    const ahead = docHidden() ? 1.6 : 0.3;
    if (inst.nextT < now - 0.25) inst.nextT = now + 0.05; // fell behind (suspended / throttled): skip ahead
    let guard = 0;
    while (inst.nextT < now + ahead && guard++ < 64) {
      try { trackStep(inst, inst.step, inst.nextT); } catch (e) { if (SD.Audio && SD.Audio.debug) console.warn('[audio]', e); }
      inst.step++; inst.nextT += d.stepDur;
    }
    G = prevG;
    music.timer = setTimeout(schedTick, docHidden() ? 300 : 60);
  }
  function setMusic(track, opts) {
    track = String(track == null ? 'none' : track);
    if (track !== 'none' && !TRACK_DEFS[track]) return;
    pendingTrack = track;
    pendingLayer = (opts && opts.layer) || 1;
    if (!mainG) return;
    if (track === music.name) { if (opts && opts.layer) setMusicLayer(opts.layer); return; }
    const ac = mainG.ctx, now = ac.currentTime;
    if (music.cur) {
      const old = music.cur, gp = old.out.gain;
      if (gp.cancelAndHoldAtTime) gp.cancelAndHoldAtTime(now); else { gp.cancelScheduledValues(now); gp.setValueAtTime(gp.value, now); }
      gp.linearRampToValueAtTime(0, now + FADE);
      setTimeout(() => killInst(old), (FADE + 0.4) * 1000);
    }
    music.cur = null; music.name = track;
    if (track === 'none') return;
    const prevG = G; G = mainG;
    const inst = makeInst(track, hash(track) + (music.plays++) * 7919);
    if (inst.def.layers) inst.layer = clamp(pendingLayer, 1, inst.def.layers); // (the layers it starts with are already in)
    G = prevG;
    inst.out.gain.setValueAtTime(0, now);
    inst.out.gain.linearRampToValueAtTime(inst.def.vol, now + FADE);
    inst.nextT = now + 0.1;
    music.cur = inst;
    if (music.timer == null) music.timer = setTimeout(schedTick, 0);
  }

  // a layered track: bring in its instruments up to layer n (each new layer fades in over a few seconds)
  function setMusicLayer(n) {
    pendingLayer = n | 0 || 1;
    const inst = music.cur;
    if (!inst || !inst.def.layers || !mainG) return;
    const L = clamp(n | 0, 1, inst.def.layers), now = mainG.ctx.currentTime;
    for (let k = inst.layer + 1; k <= L; k++) inst.layerAt[k] = now;
    inst.layer = L;
  }

  // ------------------------------------------------------------------ public API
  function init() {
    if (mainG) {
      const st = mainG.ctx.state;
      if (st === 'suspended' || st === 'interrupted') { try { mainG.ctx.resume(); } catch (e) { /* ignore */ } }
      return true;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    let ac;
    try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ac = new AC(); } catch (e2) { return false; } }
    try { mainG = G = buildGraph(ac, null); } catch (e) { mainG = G = null; return false; }
    if (ac.state === 'suspended') { try { ac.resume(); } catch (e) { /* ignore */ } }
    if (pendingTrack && pendingTrack !== 'none') setMusic(pendingTrack);
    return true;
  }
  function setVolume(o) {
    if (!o || typeof o !== 'object') return;
    ['master', 'music', 'sfx'].forEach((k) => { if (o[k] != null && isFinite(o[k])) vol[k] = clamp(+o[k], 0, 1); });
    if (!mainG) return;
    const now = mainG.ctx.currentTime;
    mainG.master.gain.setTargetAtTime(curve(vol.master), now, 0.03);
    mainG.sfx.gain.setTargetAtTime(curve(vol.sfx) * SFX_BASE, now, 0.03);
    mainG.music.gain.setTargetAtTime(curve(vol.music) * MUSIC_BASE, now, 0.03);
  }
  function duck(amount, seconds) {
    if (!mainG) return;
    const depth = 1 - clamp(amount == null ? 0.5 : +amount || 0, 0, 1);
    const secs = clamp(seconds == null ? 1 : +seconds || 0, 0, 30);
    const now = mainG.ctx.currentTime, p = mainG.duck.gain;
    let target = depth, until = now + secs;
    if (duckState.until > now) { target = Math.min(target, duckState.depth); until = Math.max(until, duckState.until); }
    duckState.depth = target; duckState.until = until;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
    p.setTargetAtTime(target, now, 0.06);
    p.setTargetAtTime(1, until, 0.45);
  }
  // Offline render of one SFX or 'music:<track>' (for preview pages / metering). Never touches the live graph.
  function render(what, opts, seconds) {
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!OAC) return Promise.reject(new Error('OfflineAudioContext unavailable'));
    opts = opts || {};
    const sr = mainG ? mainG.sr : 48000, secs = seconds || 3;
    const oc = new OAC(2, Math.ceil(sr * secs), sr);
    const prevG = G;
    try {
      G = buildGraph(oc, mainG);
      const w = String(what);
      if (w.indexOf('music:') === 0) {
        const name = w.slice(6), d = TRACK_DEFS[name];
        if (d) {
          const inst = makeInst(name, hash(name));
          if (d.layers) inst.layer = clamp(opts.layer | 0 || 1, 1, d.layers);
          inst.out.gain.value = d.vol;
          for (let s = 0, t = 0.02; t < secs; s++, t += d.stepDur) trackStep(inst, s, t);
        }
      } else if (SFX[w]) {
        const sd = SFX[w], n = opts.n | 0, p0 = opts.pitch > 0 ? +opts.pitch : 1;
        emit(sd, 0.01, p0, (opts.vol != null ? +opts.vol : 1) * (sd.v || 1), n, sd.pan ? sd.pan(n) : 0, p0);
      }
    } finally { G = prevG; }
    return oc.startRendering();
  }

  SD.Audio = {
    init, play, setMusic, setMusicLayer, setVolume, duck, render,
    isReady: () => !!mainG,
    getVolume: () => ({ master: vol.master, music: vol.music, sfx: vol.sfx }),
    getMusic: () => (mainG ? music.name : pendingTrack || 'none'),
    voices: () => active,
    musicInfo: () => ({ track: music.name, step: music.cur ? music.cur.step : 0, duck: duckState.until > (mainG ? mainG.ctx.currentTime : 0) ? duckState.depth : 1 }),
    SFX: SFX_NAMES.slice(),
    TRACKS: TRACKS.slice(),
    debug: false,
  };
})();
