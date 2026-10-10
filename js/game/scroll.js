/* EMBERWHEEL — 絵巻 (picture scrolls): 序の巻 (the first time a new save starts) and 終の巻 (深淵の繰り手 beaten).
 * docs/EXPANSION_4A_SPEC.md §6, docs/EXPANSION_4D_PLAN.md. A long paper band across the screen that unrolls from the
 * right and is read right to left; ink cut-paper scenes where only lights, embers and strings have colour; one vertical
 * line of narration per scene. A click goes to the next scene, 「とばす」 (or Escape) ends it.
 *   const sc = SD.Scroll.create('prologue' | 'epilogue', { short, records, onDone });
 *   host: sc.mount(rootEl) once; each frame sc.update(dt) and sc.render(ctx); input: sc.input(); sc.done when finished.
 */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  const INK = '#1c1620', PAPER = '#efe5cf', PAPER_SH = '#ddd0b2';
  const TAU = Math.PI * 2;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ease = (t) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const BAND = { y: 110, h: 470 }, VIEW = { x0: 46, x1: 1234 }, SW = 1000; // the paper band, the window, one scene's width

  // ------------------------------------------------------------------ ink helpers
  const fillInk = (c, a) => { c.fillStyle = a == null ? INK : `rgba(28,22,32,${a})`; c.fill(); };
  function glow(c, x, y, r, rgb, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.save(); c.globalCompositeOperation = 'source-over'; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore();
  }
  function flame(c, x, y, s, t) { if (SD.Art && SD.Art.flame) SD.Art.flame(c, x, y, s, t); else { c.beginPath(); c.arc(x, y - s * 0.6, s * 0.5, 0, TAU); c.fillStyle = '#ff9a3c'; c.fill(); } }
  // a hero / the puppeteer as an ink silhouette (the game's own art, cut from black paper). The art is drawn on a small
  // canvas of its own and filled with ink there (source-in), then laid on the scroll: a canvas `filter` costs a whole
  // layer per stroke (about 1 s a hero), which made the scroll crawl. box: the art's extent around its feet (art units)
  const HERO_BOX = { x: -120, y: -215, w: 240, h: 255 }, KURITE_BOX = { x: -210, y: -600, w: 500, h: 670 };
  const cut = { cv: null, c: null };
  function silhouette(c, draw, x, y, k, alpha, box) {
    box = box || HERO_BOX;
    const m = c.getTransform(), s = Math.hypot(m.a, m.b) * k; // (device pixels per art unit)
    const w = Math.ceil(box.w * s), h = Math.ceil(box.h * s);
    if (w < 1 || h < 1) return;
    if (!cut.cv) { cut.cv = document.createElement('canvas'); cut.c = cut.cv.getContext('2d'); }
    if (cut.cv.width < w || cut.cv.height < h) { cut.cv.width = Math.max(cut.cv.width, w); cut.cv.height = Math.max(cut.cv.height, h); }
    const o = cut.c;
    o.setTransform(1, 0, 0, 1, 0, 0); o.globalAlpha = 1; o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, w, h);
    o.save(); o.setTransform(s, 0, 0, s, -box.x * s, -box.y * s); draw(o); o.restore();
    o.globalCompositeOperation = 'source-in'; o.fillStyle = INK; o.fillRect(0, 0, w, h); o.globalCompositeOperation = 'source-over';
    c.save(); c.translate(x, y); c.scale(k, k); c.globalAlpha *= alpha == null ? 0.92 : alpha;
    c.drawImage(cut.cv, 0, 0, w, h, box.x, box.y, box.w, box.h);
    c.restore();
  }
  const hero = (c, id, x, y, k, t, pose) => silhouette(c, (cc) => SD.Art.drawHero(cc, id, pose || 'idle', { t, p: 0.3 }), x, y, k);
  // the Emberwheel: three stone drums in a frame. lit: the symbols glow on them (every 灯紋 lit)
  function wheel(c, x, y, k, t, lit, turn) {
    c.save(); c.translate(x, y); c.scale(k, k);
    c.beginPath(); c.roundRect ? c.roundRect(-92, -70, 184, 120, 12) : c.rect(-92, -70, 184, 120); fillInk(c);
    for (let i = 0; i < 3; i++) {
      const dx = -58 + i * 58;
      c.beginPath(); c.ellipse(dx, -10, 24, 52, 0, 0, TAU); c.fillStyle = '#3a3040'; c.fill();
      for (let j = 0; j < 3; j++) {
        const yy = -40 + j * 30 + ((t * (turn || 0) * 40 + i * 13) % 30);
        if (yy < -58 || yy > 40) continue;
        c.beginPath(); c.arc(dx, yy, 6, 0, TAU);
        c.fillStyle = lit ? ['#ffd257', '#ff7a4a', '#7fe0c0', '#c58bff'][(i + j) % 4] : 'rgba(239,229,207,0.18)'; c.fill();
      }
    }
    if (lit) glow(c, 0, -10, 150, '255,190,110', 0.35 + 0.1 * Math.sin(t * 2));
    c.restore();
  }
  // the ash wheel (灰輪): spokes in ink, turning `dir`
  function ashWheel(c, x, y, r, t, dir, embers) {
    c.save(); c.translate(x, y); c.rotate(t * 0.4 * dir);
    c.lineWidth = r * 0.09; c.strokeStyle = INK; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
    for (let k = 0; k < 10; k++) { const a = k * TAU / 10; c.beginPath(); c.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2); c.lineTo(Math.cos(a) * r, Math.sin(a) * r); c.lineWidth = r * 0.05; c.stroke(); }
    c.beginPath(); c.arc(0, 0, r * 0.2, 0, TAU); fillInk(c);
    c.restore();
    if (embers) glow(c, x, y, r * 1.3, '255,110,60', 0.18 + 0.08 * Math.sin(t * 3));
  }
  // night (an ink wash from the top) or dawn (gold over the paper)
  function sky(c, x0, W, dawn, k) {
    const g = c.createLinearGradient(0, BAND.y, 0, BAND.y + BAND.h * 0.7);
    if (dawn) { g.addColorStop(0, `rgba(255,170,90,${0.55 * k})`); g.addColorStop(0.6, `rgba(255,220,150,${0.3 * k})`); g.addColorStop(1, 'rgba(255,230,180,0)'); }
    else { g.addColorStop(0, 'rgba(28,22,32,0.5)'); g.addColorStop(0.7, 'rgba(28,22,32,0.08)'); g.addColorStop(1, 'rgba(28,22,32,0)'); }
    c.fillStyle = g; c.fillRect(x0, BAND.y, W, BAND.h * 0.7);
  }
  const ground = (c, x0, W, y) => { c.beginPath(); c.moveTo(x0, y); for (let x = 0; x <= W; x += 40) c.lineTo(x0 + x, y - 10 * Math.sin(x * 0.013) - 6 * hash(x)); c.lineTo(x0 + W, BAND.y + BAND.h); c.lineTo(x0, BAND.y + BAND.h); c.closePath(); fillInk(c); };

  // ------------------------------------------------------------------ scenes: (c, x0, W, t, o) — x0 = the scene's left on screen
  const GY = BAND.y + BAND.h - 70;
  const SCENES = {
    // the night camp: a fire, the three-drum wheel
    camp(c, x0, W, t, o) {
      sky(c, x0, W, o.dawn, o.dawnK == null ? 1 : o.dawnK);
      if (o.dawn) { const k = o.dawnK == null ? 1 : o.dawnK; glow(c, x0 + W * 0.13, GY - 40, 260, '255,200,120', 0.55 * k); c.beginPath(); c.arc(x0 + W * 0.13, GY - 20 - 90 * k, 46, 0, TAU); c.fillStyle = `rgba(255,214,140,${0.85 * k})`; c.fill(); }
      else { c.beginPath(); c.arc(x0 + W * 0.22, BAND.y + 80, 30, 0.4, 5.3); c.fillStyle = PAPER; c.fill(); }
      ground(c, x0, W, GY);
      c.beginPath(); c.moveTo(x0 + W * 0.72, GY + 4); c.lineTo(x0 + W * 0.8, GY - 110); c.lineTo(x0 + W * 0.9, GY + 4); fillInk(c); // the tent
      const fx = x0 + W * 0.5;
      glow(c, fx, GY - 20, 150, '255,160,80', 0.45 + 0.1 * Math.sin(t * 7));
      c.save(); c.translate(fx, GY + 2); c.beginPath(); c.moveTo(-30, 0); c.lineTo(30, -8); c.lineTo(28, 2); c.lineTo(-28, 8); fillInk(c); c.restore();
      flame(c, fx, GY - 6, 26, t);
      wheel(c, x0 + W * 0.3, GY - 52, 0.75, t, !!o.lit, o.lit ? 1 : 0);
      if (o.heroes) ['priest', 'witch', 'knight'].forEach((id, i) => hero(c, id, x0 + W * (0.58 + i * 0.07), GY + 2, 0.8, t + i, o.dawn ? 'cheer' : 'idle'));
    },
    // the stairs down to the abyss; at the bottom the ash wheel turning backwards (or rightly, in 終の巻)
    stairs(c, x0, W, t, o) {
      sky(c, x0, W, false, 1);
      const pr = x0 + W - 170; // (the paper on the right stays light: the narration is read there)
      c.beginPath(); c.moveTo(x0, BAND.y + 60); c.lineTo(pr, BAND.y + 60); c.lineTo(pr + 40, BAND.y + BAND.h); c.lineTo(x0, BAND.y + BAND.h); c.closePath(); fillInk(c, 0.92);
      c.fillStyle = PAPER;
      for (let i = 0; i < 9; i++) { const sx = x0 + W * 0.78 - i * 58, sy = BAND.y + 80 + i * 30; c.fillRect(sx - 60, sy, 64, 4); c.fillRect(sx - 60, sy, 4, 30); }
      ashWheel(c, x0 + W * 0.28, BAND.y + BAND.h - 120, 110, t, o.lit ? 1 : -1, !o.lit);
      if (o.lit) glow(c, x0 + W * 0.28, BAND.y + BAND.h - 120, 160, '255,214,140', 0.25);
    },
    // the three go down with the wheel on their backs; a faint gold string above each head (in 序の巻 only)
    descent(c, x0, W, t, o) {
      sky(c, x0, W, false, 1);
      c.beginPath(); c.moveTo(x0, GY - 120); c.lineTo(x0 + W, GY + 30); c.lineTo(x0 + W, BAND.y + BAND.h); c.lineTo(x0, BAND.y + BAND.h); c.closePath(); fillInk(c);
      const xs = [0.62, 0.48, 0.34];
      ['knight', 'witch', 'priest'].forEach((id, i) => {
        const hx = x0 + W * xs[i], hy = GY - 120 + (xs[i] * W) * (150 / W) + Math.sin(t * 2 + i) * 2;
        if (o.strings) { c.save(); c.globalAlpha = 0.35 + 0.15 * Math.sin(t * 1.5 + i); c.strokeStyle = '#d9a83a'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(hx + 4, BAND.y); c.lineTo(hx + 4, hy - 100); c.stroke(); c.restore(); }
        hero(c, id, hx, hy, 0.85, t + i, 'walk');
        glow(c, hx - 26, hy - 50, 40, '255,190,110', 0.55);
      });
      wheel(c, x0 + W * 0.64, GY - 196 + (0.64 * 150), 0.32, t, !!o.lit, 0);
    },
    // a fallen one; the embers go back to the wheel
    embers(c, x0, W, t, o) {
      sky(c, x0, W, false, 1);
      ground(c, x0, W, GY);
      silhouette(c, (cc) => SD.Art.drawHero(cc, 'knight', 'dead', { t, p: 1 }), x0 + W * 0.7, GY + 4, 0.9);
      const wx = x0 + W * 0.25, wy = GY - 52;
      wheel(c, wx, wy, 0.7, t, false, 0);
      for (let i = 0; i < 18; i++) {
        const k = ((t * 0.35 + hash(i)) % 1), sx = x0 + W * 0.7, sy = GY - 30;
        const x = sx + (wx - sx) * k, y = sy + (wy - sy) * k - Math.sin(k * Math.PI) * 120;
        glow(c, x, y, 14, '255,140,60', 0.8 * Math.sin(k * Math.PI));
        c.beginPath(); c.arc(x, y, 2.4, 0, TAU); c.fillStyle = '#ffb36b'; c.fill();
      }
    },
    // the end of 序の巻: blank paper
    blank() {},
    // 終の巻: the blank part painted — the deepest hall, the four strings cut
    hall(c, x0, W, t, o) {
      const k = o.reveal == null ? 1 : o.reveal; // (a brush sweeping right to left)
      c.save(); c.beginPath(); c.rect(x0 + W * (1 - k), BAND.y, W * k + 2, BAND.h); c.clip();
      c.beginPath(); c.rect(x0, BAND.y, W, BAND.h); fillInk(c, 0.1);
      ground(c, x0, W, GY);
      silhouette(c, (cc) => SD.Art.drawEnemy(cc, 'kurite', 'idle', { t: 0, phase: 4, cut: 4 }), x0 + W * 0.66, GY + 10, 0.9, null, KURITE_BOX);
      ['priest', 'witch', 'knight'].forEach((id, i) => hero(c, id, x0 + W * (0.16 + i * 0.09), GY + 2, 0.85, t + i, 'cheer'));
      // four gold strings, each broken in two
      for (let i = 0; i < 4; i++) {
        const sx = x0 + W * 0.66 - 84 + i * 56, top = BAND.y + 20, gapY = BAND.y + 150 + i * 18;
        c.strokeStyle = '#e0b048'; c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(sx, top); c.lineTo(sx + 3, gapY - 14); c.stroke();
        c.beginPath(); c.moveTo(sx + 6, gapY + 12); c.quadraticCurveTo(sx + 14, gapY + 60, sx + 2, gapY + 90); c.stroke();
        glow(c, sx + 4, gapY, 22, '255,214,120', 0.7);
      }
      c.restore();
      if (k > 0 && k < 1) { c.save(); c.globalAlpha = 0.5; c.fillStyle = INK; c.beginPath(); c.ellipse(x0 + W * (1 - k), BAND.y + BAND.h / 2, 10, BAND.h * 0.42, 0, 0, TAU); c.fill(); c.restore(); }
    },
    // 終の巻: the three turn the wheel with their own hands
    hands(c, x0, W, t) {
      sky(c, x0, W, false, 0.6);
      ground(c, x0, W, GY);
      wheel(c, x0 + W * 0.5, GY - 110, 1.4, t, true, 1);
      [['priest', 0.3], ['witch', 0.5], ['knight', 0.7]].forEach(([id, f], i) => hero(c, id, x0 + W * f, GY + 2, 0.95, t + i, 'cast'));
    },
    // 終の巻: the title, the seal, the colophon, 完
    title(c, x0, W, t, o) {
      const R = o.records || {};
      vText(c, '灯輪と深淵', x0 + W * 0.84, BAND.y + 50, 62, INK, 1);
      // the seal (落款)
      const sx = x0 + W * 0.72, sy = BAND.y + 330;
      c.save(); c.translate(sx, sy); c.rotate(-0.05);
      c.fillStyle = '#b8322a'; c.fillRect(-30, -30, 60, 60);
      c.fillStyle = PAPER; c.font = `900 40px ${SD.Game.fontTitle}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('灯', 0, 2);
      c.restore();
      // the colophon: this record
      const lines = Array.isArray(R) ? R : R.lines || [], lt = o.lt == null ? 99 : o.lt;
      lines.forEach((ln, i) => vText(c, ln, x0 + W * 0.58 - i * 40, BAND.y + 50, 22, 'rgba(28,22,32,0.85)', clamp01((lt - 1 - i * 0.5) / 0.8)));
      vText(c, '完', x0 + W * 0.12, BAND.y + BAND.h / 2 - 40, 72, INK, clamp01((lt - 1.5 - lines.length * 0.5) / 1));
    },
  };
  // vertical text (縦書き), one character under another
  function vText(c, str, x, y, size, color, alpha, maxPer) {
    if (alpha <= 0) return;
    c.save(); c.globalAlpha *= alpha; c.font = `900 ${size}px ${SD.Game.fontTitle}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color;
    const chars = [...str], per = maxPer || chars.length, cols = [];
    for (const ch of chars) { const last = cols[cols.length - 1]; if (!last || (last.length >= per && ch !== '、' && ch !== '。')) cols.push([ch]); else last.push(ch); }
    cols.forEach((col, ci) => col.forEach((ch, j) => {
      c.save(); c.translate(x - ci * size * 1.45, y + j * (size * 1.08));
      if (ch === '―' || ch === 'ー' || ch === '〜') c.rotate(Math.PI / 2);
      if (ch === '、' || ch === '。') c.translate(size * 0.38, -size * 0.36);
      c.fillText(ch, 0, 0); c.restore();
    }));
    c.restore();
  }

  // ------------------------------------------------------------------ the two scrolls
  // each: scene id, opts, narration, seconds (a click goes on earlier)
  const PROLOGUE = [
    { s: 'camp', o: { heroes: true }, text: '祈れば、灯輪は廻る。', d: 10 },
    { s: 'stairs', o: {}, text: '深淵の底で、灰輪の主が運命を逆さに廻している。', d: 11 },
    { s: 'descent', o: { strings: true }, text: '三人は灯輪を背負い、降りていく。', d: 10 },
    { s: 'embers', o: {}, text: '倒れても、残り火は灯輪へ還る。', d: 10 },
    { s: 'blank', o: {}, text: '', d: 4, rollBack: true },
  ];
  const EPILOGUE = [
    { s: 'replay', o: {}, text: '', d: 9 },
    { s: 'hall', o: {}, text: '糸は断たれた。', d: 11, paint: true },
    { s: 'hands', o: {}, text: '運命は、祈るものではなく、組み立てるものになった。', d: 11 },
    { s: 'camp', o: { lit: true, heroes: true, dawn: true }, text: '灯輪は、もう誰の糸にも繋がれていない。', d: 12, dawn: true },
    { s: 'title', o: {}, text: '', d: 0, hold: true },
  ];

  function create(kind, opts) {
    opts = opts || {};
    let list = kind === 'epilogue' ? EPILOGUE : PROLOGUE;
    if (kind === 'epilogue' && opts.short) list = list.slice(1); // (2nd and later: scenes 2-5)
    const P = { kind, list, i: -1, t: 0, lt: 0, done: false, open: 0, closing: 0, onDone: opts.onDone || null, records: opts.records || null, el: null };
    P.mount = (root) => {
      const b = document.createElement('button');
      b.className = 'btn mini scroll-skip'; b.innerHTML = 'とばす <kbd>Esc</kbd>';
      b.addEventListener('click', (e) => { e.stopPropagation(); P.finish(); });
      root.appendChild(b); P.el = b;
      if (SD.Audio) SD.Audio.setMusic('emaki');
    };
    P.next = () => {
      P.i++; P.lt = 0;
      if (P.i >= P.list.length) { P.finish(); return; }
      const sc = P.list[P.i];
      if (sc.dawn && SD.Audio) SD.Audio.setMusic('emaki_dawn');
      if (sc.paint && SD.Audio) SD.Audio.play('string_snap', { vol: 0.6 });
    };
    P.finish = () => {
      if (P.done) return;
      P.done = true;
      if (P.el) { P.el.remove(); P.el = null; }
      if (P.onDone) P.onDone();
    };
    // a click: show the line now if it is still coming; else the next scene (the last one waits for this click)
    P.input = () => {
      if (P.done) return;
      if (P.open < 1) { P.open = 1; return; }
      const sc = P.list[P.i];
      if (sc && P.lt < 1.4) { P.lt = 1.4; return; }
      if (sc && sc.rollBack) { P.closing = Math.max(P.closing, 0.01); return; }
      P.next();
    };
    P.update = (dt) => {
      if (P.done) return;
      P.t += dt;
      if (P.open < 1) { P.open = Math.min(1, P.open + dt / 1.6); if (P.open >= 1 && P.i < 0) P.next(); return; }
      if (P.i < 0) P.next();
      P.lt += dt;
      const sc = P.list[P.i];
      if (sc.rollBack && P.lt > 1.5) P.closing = Math.max(P.closing, 0.01);
      if (P.closing > 0) { P.closing += dt / 2.2; if (P.closing >= 1) P.finish(); return; }
      if (!sc.hold && sc.d && P.lt >= sc.d) P.next();
    };
    // the camera: centred on the current scene (scene i spans content x [-(i+1)*SW, -i*SW]), easing over 1.6 s
    P.cam = () => {
      const i = Math.max(0, P.i), c1 = -(i + 0.5) * SW, c0 = -(Math.max(0, i - 1) + 0.5) * SW;
      return i === 0 ? c1 : c0 + (c1 - c0) * ease(P.lt / 1.6);
    };
    P.render = (ctx) => {
      if (P.done) return;
      ctx.save();
      ctx.fillStyle = 'rgba(8,6,12,0.94)'; ctx.fillRect(0, 0, 1280, 720);
      // the band unrolls from the right roller; rolls back at the end of 序の巻
      const full = VIEW.x1 - VIEW.x0, w = full * ease(P.open) * (1 - ease(P.closing));
      const left = VIEW.x1 - w;
      ctx.save(); ctx.beginPath(); ctx.rect(left, BAND.y, w, BAND.h); ctx.clip();
      ctx.fillStyle = PAPER; ctx.fillRect(left, BAND.y, w, BAND.h);
      for (let k = 0; k < 120; k++) { ctx.fillStyle = 'rgba(160,140,100,0.08)'; ctx.fillRect(VIEW.x0 + hash(k) * full, BAND.y + hash(k + 50) * BAND.h, 30 + hash(k + 9) * 60, 1); } // (fibres)
      const cam = P.cam();
      const toScreen = (cx) => cx - cam + 640;
      for (let j = 0; j < P.list.length; j++) {
        const sx = toScreen(-(j + 1) * SW);
        if (sx > VIEW.x1 || sx + SW < VIEW.x0) continue;
        const sc = P.list[j], lt = j === P.i ? P.lt : j < P.i ? 99 : 0;
        if (sc.s === 'replay') drawReplay(ctx, sx, lt);
        else {
          const o = Object.assign({}, sc.o, { records: P.records, lt });
          if (sc.paint) o.reveal = clamp01((lt - 0.6) / 4);
          if (sc.dawn) o.dawnK = clamp01(lt / 5);
          SCENES[sc.s](ctx, sx, SW, P.t, o);
        }
        if (sc.text) vText(ctx, sc.text, sx + SW - 64, BAND.y + 46, 30, INK, clamp01((lt - 1.0) / 0.8), 10);
        ctx.fillStyle = 'rgba(160,140,100,0.25)'; ctx.fillRect(sx, BAND.y, 1, BAND.h); // (a faint join between the sheets)
      }
      ctx.restore();
      // paper shading and the two rollers
      const sh = ctx.createLinearGradient(0, BAND.y, 0, BAND.y + BAND.h);
      sh.addColorStop(0, 'rgba(0,0,0,0.12)'); sh.addColorStop(0.08, 'rgba(0,0,0,0)'); sh.addColorStop(0.92, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.15)');
      ctx.fillStyle = sh; ctx.fillRect(left, BAND.y, w, BAND.h);
      for (const rx of [left, VIEW.x1]) {
        ctx.fillStyle = '#5a3d22'; ctx.fillRect(rx - 9, BAND.y - 16, 18, BAND.h + 32);
        ctx.fillStyle = '#c9953b'; ctx.fillRect(rx - 12, BAND.y - 24, 24, 10); ctx.fillRect(rx - 12, BAND.y + BAND.h + 14, 24, 10);
      }
      const sc = P.list[Math.max(0, P.i)];
      if (P.open >= 1 && sc && sc.hold) { ctx.globalAlpha = 0.6 + 0.3 * Math.sin(P.t * 3); ctx.font = `700 15px ${SD.Game.fontUI}`; ctx.fillStyle = '#efe5cf'; ctx.textAlign = 'center'; ctx.fillText('クリックで閉じる', 640, 650); }
      ctx.restore();
    };
    return P;
  }

  // 終の巻 scene 1: the first scroll again, quickly — every 灯紋 lit, the ash wheel turning rightly, no strings
  function drawReplay(c, x0, lt) {
    const k = clamp01(lt / 8), parts = ['camp', 'stairs', 'descent', 'embers'];
    c.save(); c.beginPath(); c.rect(x0, BAND.y, SW, BAND.h); c.clip();
    // (read right to left: the first sheet on the right; the paper slides right as the eye goes on)
    const pan = k * (parts.length - 1) * (SW * 0.5);
    parts.forEach((s, i) => {
      c.save(); c.translate(x0 + SW * 0.5 - i * SW * 0.5 + pan, BAND.y + BAND.h * 0.2); c.scale(0.5, 0.5); c.translate(0, -BAND.y);
      SCENES[s](c, 0, SW, lt, { lit: true, heroes: true });
      c.restore();
    });
    c.restore();
  }

  // 終の巻's colophon: this save's record, one vertical line each (the play clock counts from `since` on an older save)
  function colophon(p) {
    const s = p.stats, t = SD.Meta.treeState(p), ck = p.clock || {};
    const min = Math.round((ck.sec || 0) / 60), time = `${Math.floor(min / 60)}時間${min % 60}分`;
    return [`挑戦 ${s.runs} 回`, `灰の底 ${s.deepRuns || 0} 回`, `真のクリア ${s.finalClears || 0} 回`, `灯した灯紋 ${t.lit}／${t.all}`,
      `集めた残り火 ${s.totalEmbers}`, `遊んだ時間 ${time}`].concat(ck.fromStart || !ck.since ? [] : [`（${ck.since}から数えて）`]);
  }

  SD.Scroll = { create, colophon };
})();
