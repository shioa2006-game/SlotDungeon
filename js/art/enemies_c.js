/* EMBERWHEEL — enemies_c.js : 第四層「灰の底」 (Candlelit Paper Theater style).
 * Registers: husk 重ね殻 (stacked ash shells), mirror 返し鏡 (a floating mirror that seals what it saw).
 * Contract (ARCH.md "Enemies"): draw(ctx, pose, opts) with origin = feet center, facing LEFT.
 * Poses: idle · windup · attack(p) · cast · stance · hit(p) · die(p). Unknown pose -> idle.
 */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  const Art = SD.Art;
  if (!Art || !Art.registerEnemy) return;
  const PAL = Art.PAL, LW = Art.LW, LWT = Art.LW_THIN;
  const TAU = Math.PI * 2;
  const POSES = { idle: 1, windup: 1, attack: 1, cast: 1, stance: 1, hit: 1, die: 1 };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const ease = Art.easeInOut, eOut = Art.easeOut;

  function st(pose, opts) {
    opts = opts || {};
    const P = POSES[pose] ? pose : 'idle';
    const s = { pose: P, t: num(opts.t, 0), p: clamp(num(opts.p, 0), 0, 1), opts };
    s.atk = P === 'attack' ? Art.pulse(s.p, 0.35) : 0;
    s.hitK = P === 'hit' ? 1 - eOut(s.p) : 0;
    s.dieK = P === 'die' ? ease(seg(s.p, 0.05, 1)) : 0;
    s.hold = P === 'windup' || P === 'stance' || P === 'cast';
    return s;
  }
  function fadeLayer(ctx, alpha, fn) {
    if (alpha <= 0.01) return;
    ctx.save(); ctx.globalAlpha *= alpha; fn(ctx); ctx.restore();
  }
  function motes(ctx, k, x, y, w, h, n, color, seed) {
    if (k <= 0) return;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const hx = Art.hash(seed + i * 3.1), hy = Art.hash(seed + i * 7.7);
      const px = x + (hx - 0.5) * w, py = y + (hy - 0.5) * h - k * (40 + hy * 60);
      ctx.globalAlpha = (1 - k) * 0.8;
      Art.circlePath(ctx, px, py, 1.5 + Art.hash(seed + i) * 2.5);
      ctx.fillStyle = color; ctx.fill();
    }
    ctx.restore();
  }

  // ================================================================ HUSK 重ね殻
  const HU = {
    shell: ['#5b5354', '#6a6163', '#7a7072'], shellSh: ['#3a3435', '#453e40', '#524a4c'],
    rim: '#2a2324', crack: '#ff7a3a', crackGlow: 'rgba(255,110,50,0.55)',
    skin: '#3d2f33', skinSh: '#271d21', leg: '#2f2528',
    eye: { color: '#ffb36a', glowColor: 'rgba(255,140,60,0.65)' },
  };
  // one dome plate: center x, base y, half width, height
  function plate(ctx, cx, by, hw, h, i, glowK, t) {
    const path = (c) => {
      c.beginPath();
      c.moveTo(cx - hw, by);
      c.bezierCurveTo(cx - hw * 0.95, by - h * 0.9, cx - hw * 0.35, by - h * 1.08, cx + hw * 0.1, by - h);
      c.bezierCurveTo(cx + hw * 0.7, by - h * 0.92, cx + hw * 1.02, by - h * 0.45, cx + hw, by);
      c.quadraticCurveTo(cx, by + h * 0.16, cx - hw, by);
      c.closePath();
    };
    Art.shape(ctx, path, HU.shell[i], HU.shellSh[i], { dx: -5, dy: -5, hi: { x: cx - hw * 0.35, y: by - h * 0.72, rx: hw * 0.28, ry: h * 0.12, rot: -0.3, color: 'rgba(255,255,255,0.12)' } });
    // ridge line + ember cracks
    ctx.save(); path(ctx); ctx.clip();
    ctx.beginPath(); ctx.moveTo(cx - hw * 0.8, by - h * 0.12); ctx.quadraticCurveTo(cx, by - h * 0.32, cx + hw * 0.85, by - h * 0.1);
    Art.strokeOnly(ctx, LWT, HU.rim);
    const g = 0.45 + 0.55 * glowK + 0.12 * Math.sin(t * 3 + i);
    ctx.globalAlpha *= clamp(g, 0, 1);
    for (let k = 0; k < 3; k++) {
      const x0 = cx + (k - 1) * hw * 0.5 + (Art.hash(i * 9 + k) - 0.5) * 10, y0 = by - h * (0.35 + Art.hash(i * 5 + k) * 0.4);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + 5, y0 + 7); ctx.lineTo(x0 + 1, y0 + 12); ctx.lineTo(x0 + 6, y0 + 18);
      ctx.lineWidth = 2; ctx.strokeStyle = HU.crack; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.restore();
  }
  function huskBody(ctx, s) {
    const t = s.t, br = Math.sin(t * TAU / 2.4);
    const lunge = -34 * s.atk, shake = s.hitK * Math.sin(s.p * 60) * 5;
    const tuck = s.hold ? 1 : 0; // wind-up: the head draws in, the plates close down
    const glowK = s.hold ? 0.6 + 0.4 * Math.sin(t * 6) : s.atk;
    ctx.save();
    ctx.translate(lunge + shake, 0);
    // legs (stubby, four visible)
    for (const [lx, ph] of [[-44, 0], [-16, 1.7], [14, 3.1], [40, 4.4]]) {
      const lift = s.atk > 0 ? Math.max(0, Math.sin(t * 9 + ph)) * 3 : 0;
      Art.shape(ctx, (c) => Art.roundRectPath(c, lx - 6, -18 - lift, 12, 18 + lift, 4), HU.leg, PAL.ink, { lw: LWT, dx: -2, dy: -2 });
    }
    // head (pokes out to the left, under the front plate)
    const hx = -62 + tuck * 18 - s.atk * 10, hy = -26 + tuck * 6;
    Art.shape(ctx, (c) => Art.blobPath(c, [[hx - 18, hy], [hx - 12, hy - 15], [hx + 6, hy - 17], [hx + 18, hy - 6], [hx + 14, hy + 9], [hx - 6, hy + 11]], 1), HU.skin, HU.skinSh, { dx: -3, dy: -3 });
    for (const ex of [hx - 9, hx + 1]) Art.enemyEye(ctx, ex, hy - 6, 2.8, Object.assign({ slit: 1 }, HU.eye));
    // mandibles
    ctx.beginPath(); ctx.moveTo(hx - 16, hy + 4); ctx.quadraticCurveTo(hx - 26, hy + 10 + s.atk * 4, hx - 20, hy + 14); Art.strokeOnly(ctx, LWT);
    // the stacked shells: back (largest) to front, rising and falling a little out of step
    const lift = (k) => br * (1.2 + k * 0.6) - tuck * (6 - k * 2);
    plate(ctx, 12, -16 + lift(0) * 0.4, 66, 70 - tuck * 6, 0, glowK, t);
    plate(ctx, -2, -12 + lift(1) * 0.5, 56, 52 - tuck * 5, 1, glowK, t);
    plate(ctx, -18, -8 + lift(2) * 0.6, 42, 34 - tuck * 4, 2, glowK, t);
    if (s.hold) Art.glow(ctx, -6, -48, 90, HU.crackGlow, 0.35 + 0.2 * Math.sin(t * 6));
    ctx.restore();
  }
  Art.registerEnemy('husk', {
    info: { height: 96, width: 150, fx: [-30, -50], head: [-6, -112] },
    draw(ctx, pose, opts) {
      const s = st(pose, opts);
      fadeLayer(ctx, 1 - 0.95 * s.dieK, (c) => {
        if (s.dieK > 0) { c.translate(0, s.dieK * 14); c.scale(1 + s.dieK * 0.08, 1 - s.dieK * 0.3); }
        huskBody(c, s);
      });
      motes(ctx, s.dieK, 0, -50, 150, 80, 22, '#a89c9e', 31);
    },
  });

  // ================================================================ MIRROR 返し鏡
  const MI2 = {
    frame: '#4a3a58', frameSh: '#2c2238', trim: PAL.brassLight, trimSh: PAL.brass,
    glass: '#20263a', glassHi: 'rgba(200,220,255,0.28)', face: 'rgba(220,210,255,0.55)',
    eye: { color: '#d9c4ff', glowColor: 'rgba(170,120,255,0.7)' }, aura: 'rgba(160,110,255,0.45)',
  };
  function mirrorBody(ctx, s) {
    const t = s.t, bob = Math.sin(t * TAU / 2.8) * 6;
    const tilt = -0.12 * s.atk + s.hitK * Math.sin(s.p * 50) * 0.06;
    const flash = s.atk + (s.hold ? 0.35 + 0.25 * Math.sin(t * 5) : 0);
    ctx.save();
    ctx.translate(-14 * s.atk, -26 + bob);
    ctx.rotate(tilt);
    const W = 46, H = 70, cy = -92;
    Art.glow(ctx, 0, cy, 120, MI2.aura, 0.25 + flash * 0.5);
    // frame: an ornate oval with a crest and a pointed foot
    const outer = (c) => { Art.ellipsePath(c, 0, cy, W + 12, H + 12); };
    Art.shape(ctx, outer, MI2.frame, MI2.frameSh, { dx: -5, dy: -5 });
    Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(-16, cy - H - 8); c.quadraticCurveTo(0, cy - H - 40, 16, cy - H - 8); c.closePath(); }, MI2.trim, MI2.trimSh, { lw: LWT });
    Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(-12, cy + H + 8); c.lineTo(0, cy + H + 34); c.lineTo(12, cy + H + 8); c.closePath(); }, MI2.frame, MI2.frameSh, { lw: LWT });
    for (let i = 0; i < 10; i++) { // studs on the frame
      const a = (i / 10) * TAU + 0.3;
      Art.circlePath(ctx, Math.cos(a) * (W + 6), cy + Math.sin(a) * (H + 6), 2.6); Art.fs(ctx, MI2.trim, 1.2);
    }
    // glass
    const glass = (c) => Art.ellipsePath(c, 0, cy, W, H);
    ctx.save(); glass(ctx); ctx.clip();
    ctx.fillStyle = MI2.glass; ctx.fillRect(-W, cy - H, W * 2, H * 2);
    // the pale face in the glass (it watches what you did)
    ctx.globalAlpha = 0.55 + 0.25 * flash;
    Art.ellipsePath(ctx, 0, cy - 6, 22, 30); ctx.fillStyle = MI2.face; ctx.fill();
    ctx.globalAlpha = 1;
    Art.enemyEye(ctx, -9, cy - 12, 3.2, Object.assign({ slit: 1 }, MI2.eye));
    Art.enemyEye(ctx, 9, cy - 12, 3.2, Object.assign({ slit: 1 }, MI2.eye));
    ctx.beginPath(); ctx.moveTo(-7, cy + 10); ctx.quadraticCurveTo(0, cy + 6 + s.atk * 6, 7, cy + 10); Art.strokeOnly(ctx, 1.6, 'rgba(40,30,60,0.8)');
    // sheen sweeping across the glass
    const sw = ((t * 0.35) % 1) * (W * 4) - W * 2;
    ctx.globalAlpha = 0.8 + flash * 0.2;
    ctx.beginPath(); ctx.moveTo(sw - 10, cy - H); ctx.lineTo(sw + 8, cy - H); ctx.lineTo(sw - 22, cy + H); ctx.lineTo(sw - 40, cy + H); ctx.closePath();
    ctx.fillStyle = MI2.glassHi; ctx.fill();
    // hit: cracks
    if (s.hitK > 0.05 || s.dieK > 0) {
      ctx.globalAlpha = Math.max(s.hitK, s.dieK);
      ctx.beginPath();
      for (const [a, l] of [[-0.6, 50], [0.4, 60], [2.2, 44], [3.6, 52], [5.0, 40]]) { ctx.moveTo(4, cy - 4); ctx.lineTo(4 + Math.cos(a) * l * 0.5, cy - 4 + Math.sin(a) * l * 0.5 + 4); ctx.lineTo(4 + Math.cos(a) * l, cy - 4 + Math.sin(a) * l); }
      ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(235,240,255,0.9)'; ctx.stroke();
    }
    ctx.restore();
    glass(ctx); Art.strokeOnly(ctx, LW);
    ctx.restore();
    // orbiting shards
    const nS = 4;
    for (let i = 0; i < nS; i++) {
      const a = t * (s.hold ? 2.2 : 0.9) + (i / nS) * TAU, r = 74 + Math.sin(t * 1.3 + i) * 6;
      const x = Math.cos(a) * r - 14 * s.atk, y = -118 + bob + Math.sin(a) * r * 0.32;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a * 1.7);
      Art.polyPath(ctx, [[-4, -7], [5, -2], [1, 8]]);
      Art.fs(ctx, 'rgba(190,205,240,0.85)', 1.4);
      ctx.restore();
    }
  }
  Art.registerEnemy('mirror', {
    info: { height: 190, width: 120, fx: [-10, -118], head: [0, -214] },
    draw(ctx, pose, opts) {
      const s = st(pose, opts);
      fadeLayer(ctx, 1 - 0.95 * s.dieK, (c) => mirrorBody(c, s));
      motes(ctx, s.dieK, 0, -120, 140, 140, 26, '#d8e2ff', 57);
    },
  });
})();
