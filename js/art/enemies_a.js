/* EMBERWHEEL — enemies A (zone 1–2 small enemies + elite bellhound).
 * rat 燭ネズミ · slime 澱スライム · shellback 殻ムシ · bellhound 鐘つき犬 (elite) · moth 呪い蛾 · wisp 吸い火
 * Contract (docs/ARCH.md "Enemies"): SD.Art.registerEnemy(id, { draw(ctx, pose, opts), info })
 *  - origin (0,0) = feet center, facing LEFT, body at negative y.
 *  - pose: idle · windup · attack · cast · stance · hit · die  (unknown poses fall back to idle)
 *  - opts: { t, p, enraged }   enraged => red glowing eyes + red aura/rim (Dread variant)
 * Style: "Candlelit Paper Theater" — ink outlines, flat fill + one crescent shade (Art.shape), glows for light only.
 */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  const Art = SD.Art;
  if (!Art || !Art.registerEnemy) return;
  const PAL = Art.PAL;
  const TAU = Math.PI * 2;
  const C = Art.clamp01, L = Art.lerp;
  const POSES = { idle: 1, windup: 1, attack: 1, cast: 1, stance: 1, hit: 1, die: 1 };
  const normPose = (pose) => (POSES[pose] ? pose : 'idle');
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  // ======================================================================
  // shared private helpers
  // ======================================================================
  const frac = (x) => x - Math.floor(x);
  // occasional blink 0..1
  const blinkAt = (t, seed) => { const ph = frac((t + seed * 1.37) / 3.9); return ph > 0.955 ? Math.sin(((ph - 0.955) / 0.045) * Math.PI) : 0; };
  // attack lunge curve: negative = wind back (anticipation), 1 = full lunge, overshoot, then return
  function lungeK(p) {
    p = C(p);
    if (p < 0.3) return -0.32 * Art.easeOut(p / 0.3);
    if (p < 0.44) return L(-0.32, 1.08, Art.easeIn((p - 0.3) / 0.14));
    if (p < 0.58) return L(1.08, 1.0, Art.easeOut((p - 0.44) / 0.14));
    return 1 - Art.easeInOut((p - 0.58) / 0.42);
  }
  // 0..1 strike window (peaks at the moment of impact)
  const strikeK = (p) => Art.pulse(C((C(p) - 0.26) / 0.46), 0.35);
  const anticK = (p) => (C(p) < 0.3 ? Art.easeOut(C(p) / 0.3) : Math.max(0, 1 - (C(p) - 0.3) / 0.1));
  const recoil = (p) => Art.pulse(C(p), 0.12);
  const dieAlpha = (p) => Math.pow(1 - C(p), 1.7);

  // Glowing enemy eye; enraged => red.
  function eye(ctx, o, x, y, size, ex) {
    const q = Object.assign({}, ex || {});
    if (o.enraged) { q.color = '#ff4a3a'; q.glowColor = 'rgba(255,40,30,0.8)'; q.glowAlpha = 1; }
    Art.enemyEye(ctx, x, y, size, q);
  }
  // Dread aura (behind the body)
  function aura(ctx, o, x, y, r) {
    if (!o.enraged) return;
    const t = num(o.t, 0);
    Art.glow(ctx, x, y, r, 'rgba(255,30,45,0.45)', 0.7 + Math.sin(t * 3.3) * 0.2);
    Art.glow(ctx, x, y + r * 0.35, r * 0.7, 'rgba(160,0,30,0.35)', 0.8);
  }
  // House-style shape + optional clipped inner details + red rim when enraged.
  function shapeR(ctx, o, pathFn, base, shade, opts) {
    opts = opts || {};
    const lw = opts.lw == null ? Art.LW : opts.lw;
    Art.shape(ctx, pathFn, base, shade, { dx: opts.dx, dy: opts.dy, hi: opts.hi, lw: 0 });
    if (opts.inner || (o.enraged && !opts.noRim)) {
      ctx.save(); pathFn(ctx); ctx.clip();
      if (opts.inner) opts.inner(ctx);
      if (o.enraged && !opts.noRim) { pathFn(ctx); ctx.lineWidth = opts.rimW || 7; ctx.strokeStyle = 'rgba(255,58,48,0.38)'; ctx.stroke(); }
      ctx.restore();
    }
    if (lw > 0) { pathFn(ctx); Art.strokeOnly(ctx, lw); }
  }
  // Outline polygon around a polyline with tapering width (tails, tentacles, tongues).
  function taperPts(pts, w0, w1) {
    const n = pts.length, A = [], B = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
      const w = (Array.isArray(w0) ? w0[Math.min(i, w0.length - 1)] : L(w0, w1, i / (n - 1))) / 2;
      A.push([pts[i][0] - ty * w, pts[i][1] + tx * w]);
      B.push([pts[i][0] + ty * w, pts[i][1] - tx * w]);
    }
    return A.concat(B.reverse());
  }
  const taperPath = (ctx, pts, w0, w1) => Art.blobPath(ctx, taperPts(pts, w0, w1), 1);
  // Outlined tube (limbs): ink underlay then fill.
  function tube(ctx, pts, w, fill) {
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    Art.curvePath(ctx, pts); ctx.lineWidth = w + 3; ctx.strokeStyle = PAL.ink; ctx.stroke();
    Art.curvePath(ctx, pts); ctx.lineWidth = Math.max(0.5, w - 3); ctx.strokeStyle = fill; ctx.stroke();
    ctx.restore();
  }
  function line(ctx, pts, lw, color, alpha) {
    ctx.save();
    if (alpha != null) ctx.globalAlpha *= alpha;
    Art.curvePath(ctx, pts); ctx.lineWidth = lw; ctx.strokeStyle = color || PAL.ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }
  function dot(ctx, x, y, r, color, alpha) {
    ctx.save(); if (alpha != null) ctx.globalAlpha *= alpha;
    Art.circlePath(ctx, x, y, r); ctx.fillStyle = color; ctx.fill(); ctx.restore();
  }
  // Rising ember/dust motes for the 'die' dissolve; fade out completely at p=1.
  function dieMotes(ctx, p, cx, cy, w, h, n, color, seed) {
    if (p <= 0.01) return;
    const base = ctx.globalAlpha;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const h1 = Art.hash(i * 3.1 + seed), h2 = Art.hash(i * 7.7 + seed), h3 = Art.hash(i * 1.9 + seed + 5);
      const d = h1 * 0.45, q = C((p - d) / 0.55);
      if (q <= 0 || q >= 1) continue;
      const x = cx + (h2 - 0.5) * w + Math.sin(q * 7 + i) * 5;
      const y = cy + (h3 - 0.5) * h - q * (26 + h1 * 60);
      const a = Math.sin(q * Math.PI) * Math.pow(1 - p, 0.6);
      const rr = 1.1 + h3 * 1.9 * (1 - q * 0.6);
      ctx.globalAlpha = base * a * 0.35; Art.circlePath(ctx, x, y, rr * 3); ctx.fillStyle = color; ctx.fill();
      ctx.globalAlpha = base * a; Art.circlePath(ctx, x, y, rr); ctx.fillStyle = '#fff1cf'; ctx.fill();
    }
    ctx.restore();
  }
  // faint ground shadow for hovering enemies (they float above the feet point)
  function hoverShadow(ctx, x, w, alpha) {
    w = Math.max(4, w);
    ctx.save(); ctx.globalAlpha *= alpha;
    Art.ellipsePath(ctx, x, 0, w, w * 0.22); ctx.fillStyle = 'rgba(6,3,14,0.55)'; ctx.fill();
    Art.ellipsePath(ctx, x, 0, w * 0.6, w * 0.13); ctx.fillStyle = 'rgba(6,3,14,0.45)'; ctx.fill();
    ctx.restore();
  }
  // Draw fn into an offscreen layer and composite it with `alpha`, so overlapping parts fade as ONE
  // silhouette (no see-through seams while dissolving). Falls back to plain globalAlpha (Node / no DOM).
  let _layer = null;
  function layered(ctx, alpha, fn) {
    const a = C(alpha);
    if (a <= 0.004) return;
    const cv = ctx.canvas;
    let ok = a < 0.995 && typeof document !== 'undefined' && cv && cv.width > 0 && cv.height > 0 && typeof ctx.getTransform === 'function';
    if (ok) {
      try {
        if (!_layer) _layer = document.createElement('canvas');
        if (_layer.width !== cv.width || _layer.height !== cv.height) { _layer.width = cv.width; _layer.height = cv.height; }
      } catch (e) { ok = false; }
    }
    if (!ok) { ctx.save(); ctx.globalAlpha *= a; fn(ctx); ctx.restore(); return; }
    const lc = _layer.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalAlpha = 1; lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, _layer.width, _layer.height);
    lc.setTransform(ctx.getTransform());
    fn(lc);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= a; ctx.drawImage(_layer, 0, 0); ctx.restore();
  }
  // rotate around a pivot
  function pivot(ctx, px, py, a) { ctx.translate(px, py); ctx.rotate(a); ctx.translate(-px, -py); }

  // ======================================================================
  // RAT 燭ネズミ — scruffy sewer rat with a melted candle on its back
  // ======================================================================
  const RAT = { fur: '#8a7890', furShade: '#5c4c69', belly: '#bba6a8', pink: '#f2a2b6', pinkShade: '#c26e8c',
    wax: '#f6ead0', waxShade: '#cdb48a', mouth: '#3a1020' };

  function ratRig(pose, o) {
    const t = num(o.t, 0), p = C(num(o.p, 0));
    const br = Math.sin((t * TAU) / 1.4);
    const sniffOn = Math.sin(t * 0.9) > 0.35 ? 1 : 0;
    const r = { x: 0, y: 0, px: 22, rot: 0, sx: 1 - br * 0.015, sy: 1 + br * 0.03, head: Math.sin(t * 1.7) * 0.04 + sniffOn * Math.sin(t * 17) * 0.025,
      mouth: 0.06, bristle: 0, flare: 1, blink: blinkAt(t, 1), ears: Math.max(0, Math.sin(t * 0.7 + 1)) > 0.97 ? 0.4 : 0, slit: 0, alpha: 1,
      paws: 0, tailAmp: 1, snuff: 0, glow: 0, nose: sniffOn * Math.sin(t * 17) };
    switch (pose) {
      case 'windup': {
        const tr = Math.sin(t * 47) * 0.9;
        Object.assign(r, { x: 7 + tr, sx: 1.07, sy: 0.9 + Math.sin(t * 6) * 0.015, rot: 0.03, head: -0.07 + Math.sin(t * 11) * 0.02,
          mouth: 0.55 + Math.sin(t * 11) * 0.08, bristle: 1.2, flare: 1.6 + Math.sin(t * 9) * 0.1, ears: 1, slit: 1, tailAmp: 2.4, glow: 0.8, nose: 0 });
        break;
      }
      case 'attack': {
        const k = lungeK(p), s = strikeK(p), a = anticK(p);
        Object.assign(r, { x: -40 * k, y: -Math.sin(C((p - 0.3) / 0.28) * Math.PI) * 7, rot: -0.1 * Math.max(0, k) + 0.05 * a,
          sx: 1 + 0.07 * a + 0.1 * s, sy: 1 - 0.1 * a - 0.07 * s, head: 0.14 * s - 0.06 * a, mouth: 0.15 + 0.85 * s,
          bristle: 0.7, flare: 1 + 0.3 * s, ears: 0.8, slit: 0.6 * a, tailAmp: 1.8, nose: 0 });
        break;
      }
      case 'cast': {
        const k = 0.78 + 0.22 * Art.pulse(p, 0.4);
        Object.assign(r, { rot: 0.34 * k, px: 28, head: 0.16 + Math.sin(t * 9) * 0.04, mouth: 0.35, flare: 1.45 + 0.45 * Art.pulse(p, 0.4),
          paws: 1, glow: 0.9, sx: 0.97, sy: 1.04 + Math.sin(t * 5) * 0.015, tailAmp: 1.4 });
        break;
      }
      case 'stance': {
        Object.assign(r, { x: 4, sx: 1.09, sy: 0.85 + br * 0.012, head: -0.13, ears: 1, slit: 1, bristle: 1.5, flare: 1.25, glow: 0.45,
          tailAmp: 0.35, paws: 0.35, mouth: 0.3 + Math.sin(t * 7) * 0.05, nose: 0 });
        break;
      }
      case 'hit': {
        const k = recoil(p);
        Object.assign(r, { x: 14 * k, rot: 0.17 * k, px: 26, sx: 1 - 0.07 * k, sy: 1 + 0.07 * k, blink: 0.85 * k, mouth: 0.06 + 0.45 * k,
          head: 0.22 * k, flare: 1 - 0.45 * k, ears: k, bristle: 1.4 * k, tailAmp: 1 + 2 * k, nose: 0 });
        break;
      }
      case 'die': {
        const e = Art.easeOut(C(p / 0.45)), sh = 1 - 0.28 * p;
        Object.assign(r, { x: 6 * e, y: 7 * Art.easeIn(p), rot: -0.1 * e, px: 0, sx: (1 + 0.16 * p) * sh, sy: (1 - 0.36 * Art.easeIn(p)) * sh,
          head: -0.28 * e, mouth: 0.3 * e, blink: Math.max(0.9 * e, 0), flare: Math.max(0, 1 - p * 3.2), alpha: dieAlpha(p), tailAmp: 1 - e,
          snuff: p, ears: e, nose: 0 });
        break;
      }
    }
    return r;
  }

  function ratBodyPath(c, bristle) {
    const cx = 4, cy = -27, rx = 38, ry = 24, N = 46, pts = [];
    for (let i = 0; i < N; i++) {
      const a = Math.PI + (i / N) * TAU;
      let rr = 1, aa = a;
      if (a > Math.PI * 1.1 && a < Math.PI * 2.1 && i % 2 === 1) { rr = 1.09 + 0.07 * bristle + Art.hash(i + 3) * 0.07; aa = a + 0.055; }
      pts.push([cx + Math.cos(aa) * rx * rr, cy + Math.sin(aa) * ry * rr]);
    }
    Art.polyPath(c, pts, true);
  }

  function ratCandle(ctx, o, r, t) {
    ctx.save();
    ctx.translate(5, -50);
    ctx.rotate(-0.14 + Math.sin(t * 1.4) * 0.03);
    // wax puddle melted over the fur + drips hanging off it
    Art.blobPath(ctx, [[-13, 1], [-9, -2], [0, -3], [10, -2], [14, 1], [11, 4], [6, 3], [2, 7], [-2, 3], [-8, 5], [-11, 9], [-13, 4]], 0.9);
    Art.fs(ctx, RAT.wax, Art.LW_THIN);
    // candle stub
    const body = (c) => { c.beginPath(); c.moveTo(-6, 0); c.lineTo(-5.5, -16); c.quadraticCurveTo(-3, -19, -1, -17); c.quadraticCurveTo(1.5, -20.5, 3.5, -17.5);
      c.quadraticCurveTo(6, -18.5, 6, -14); c.lineTo(6, 0); c.closePath(); };
    shapeR(ctx, o, body, RAT.wax, RAT.waxShade, { dx: -3, dy: 0, lw: Art.LW_THIN });
    // side drips
    for (const [x, y0, len] of [[-4.6, -16, 9], [3.6, -16.5, 12]]) { Art.roundRectPath(ctx, x - 1.7, y0, 3.4, len, 1.7); Art.fs(ctx, RAT.wax, 1.4); }
    // wick
    line(ctx, [[0, -17], [0.5, -20], [1.5, -22]], 1.8, PAL.ink);
    const fl = 8.5 * r.flare;
    if (fl > 0.6) {
      if (r.glow > 0) Art.glow(ctx, 1, -28, 40 + 14 * r.glow, 'rgba(255,150,60,0.45)', r.glow);
      Art.flame(ctx, 1.5, -21, fl, t, { seed: 2, outline: true });
    }
    if (r.snuff > 0.2) { // smoke curl from the snuffed wick
      const a = Math.sin(C((r.snuff - 0.2) / 0.8) * Math.PI) * 0.8, rise = r.snuff * 22;
      line(ctx, [[1.5, -22], [4, -28 - rise * 0.3], [-1, -34 - rise * 0.6], [3, -42 - rise]], 2.2, 'rgba(190,180,210,1)', a);
    }
    ctx.restore();
  }

  function drawRat(ctx, pose, o) {
    pose = normPose(pose);
    const t = num(o.t, 0);
    const r = ratRig(pose, o);
    const p = C(num(o.p, 0));
    layered(ctx, r.alpha, (ctx) => {
    ctx.save();
    aura(ctx, o, r.x, -30, 72);
    ctx.translate(r.x, r.y);
    pivot(ctx, r.px, 0, r.rot);
    ctx.scale(r.sx * 0.9, r.sy * 0.9);

    // --- tail (behind body) ---
    const tp = [];
    for (let i = 0; i <= 14; i++) {
      const s = i / 14, w = t * 2.3 - s * 3.6;
      tp.push([36 + 48 * s - 16 * s * s * s + Math.cos(w) * 3 * s * r.tailAmp,
        -11 + 4 * Math.sin(s * Math.PI) - 42 * Math.pow(s, 2.2) + Math.sin(w) * 7 * s * r.tailAmp]);
    }
    shapeR(ctx, o, (c) => taperPath(c, tp, 9.5, 2.2), RAT.pink, RAT.pinkShade, { dx: -1.5, dy: -2.5, rimW: 4 });
    for (let i = 3; i < 13; i += 2) { // ring creases on the tail
      const a = tp[i - 1], b = tp[i + 1], q = tp[i];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
      const w = L(9.5, 2.2, i / 14) * 0.38;
      line(ctx, [[q[0] - ty * w, q[1] + tx * w], [q[0] + ty * w, q[1] - tx * w]], 1.1, PAL.ink, 0.5);
    }
    // far feet
    Art.ellipsePath(ctx, 36, -2.5, 8, 3); Art.fs(ctx, RAT.pinkShade, Art.LW_THIN);
    const pawX = L(-18, -30, r.paws), pawY = L(-2.5, -24, r.paws);
    Art.ellipsePath(ctx, pawX, pawY, 5, 3, -0.6 * r.paws); Art.fs(ctx, RAT.pinkShade, Art.LW_THIN);

    // --- body ---
    shapeR(ctx, o, (c) => ratBodyPath(c, r.bristle), RAT.fur, RAT.furShade, { dx: -5, dy: -6, inner: (c) => {
      Art.ellipsePath(c, -14, -8, 22, 11, -0.15); c.fillStyle = RAT.belly; c.fill();
      for (const [x, y] of [[-6, -40], [8, -44], [22, -36], [0, -30], [28, -26], [12, -22], [-16, -30]]) line(c, [[x, y], [x + 3, y - 1], [x + 6, y - 4]], 1.4, PAL.ink, 0.5);
    } });
    // haunch
    shapeR(ctx, o, (c) => Art.blobPath(c, [[12, -20], [16, -31], [28, -33], [38, -24], [36, -10], [24, -6], [14, -10]]), RAT.fur, RAT.furShade,
      { dx: -3, dy: -4, lw: Art.LW_THIN });
    line(ctx, [[24, -30], [27, -26], [26, -22]], 1.3, PAL.ink, 0.45);
    // hind foot
    shapeR(ctx, o, (c) => Art.ellipsePath(c, 21, -2.6, 11, 3.6), RAT.pink, RAT.pinkShade, { dx: -1, dy: -1.5, lw: Art.LW_THIN, noRim: true });
    for (let i = 0; i < 3; i++) line(ctx, [[11 + i * 2.6, -4.5], [11.5 + i * 2.6, -1]], 1, PAL.ink, 0.7);

    // --- candle on the back ---
    ratCandle(ctx, o, r, t);

    // --- head ---
    ctx.save();
    pivot(ctx, -24, -34, r.head);
    // far ear
    ctx.save(); pivot(ctx, -20, -46, r.ears * 0.4 + 0.1);
    Art.blobPath(ctx, [[-25, -46], [-26, -56], [-20, -62], [-13, -58], [-13, -48]], 1); Art.fs(ctx, RAT.furShade, Art.LW_THIN);
    ctx.restore();
    // mouth interior + lower jaw
    const m = r.mouth;
    if (m > 0.08) {
      Art.ellipsePath(ctx, -44, -23 + m * 3, 13, 2.5 + 6 * m); Art.fs(ctx, RAT.mouth, Art.LW_THIN);
      Art.ellipsePath(ctx, -40, -20 + m * 5, 7, 2 + 2 * m); ctx.fillStyle = '#d4607a'; ctx.fill();
    }
    ctx.save(); pivot(ctx, -30, -25, -m * 0.55);
    shapeR(ctx, o, (c) => Art.blobPath(c, [[-55, -24], [-44, -22.5], [-31, -24], [-29, -19], [-40, -15.5], [-52, -17.5]], 1), RAT.fur, RAT.furShade, { dx: -2, dy: -2, lw: Art.LW_THIN });
    for (const x of [-52, -48.5]) { Art.polyPath(ctx, [[x, -23], [x + 2.6, -23], [x + 1.3, -26.5]]); Art.fs(ctx, PAL.bone, 1); }
    ctx.restore();
    // head
    const headPath = (c) => Art.blobPath(c, [[-66, -31], [-59, -39], [-46, -47.5], [-31, -50], [-19, -43], [-17, -31], [-27, -23.5], [-44, -24.5], [-59, -25.5]], 1);
    shapeR(ctx, o, headPath, RAT.fur, RAT.furShade, { dx: -4, dy: -4, inner: (c) => {
      Art.ellipsePath(c, -50, -24, 14, 4); c.fillStyle = RAT.belly; c.fill(); // muzzle
      for (let i = 0; i < 4; i++) { const x = -22 + i * 1.5, y = -42 + i * 5; Art.polyPath(c, [[x + 4, y - 3], [x - 3, y], [x + 4, y + 3]], false); Art.strokeOnly(c, 1.2); }
    } });
    // cheek tuft
    Art.polyPath(ctx, [[-22, -30], [-14, -32], [-19, -27], [-12, -25], [-20, -23]], false); Art.fs(ctx, null, 1.6);
    // buck teeth
    for (const x of [-58.5, -55]) { Art.roundRectPath(ctx, x, -27, 3.5, 7 + m * 1.5, 1); Art.fs(ctx, PAL.bone, 1.4); }
    // nose
    const nz = r.nose * 0.9;
    dot(ctx, -66, -32 + nz, 3.6, PAL.ink);
    dot(ctx, -66, -32 + nz, 2.6, RAT.pink);
    dot(ctx, -67, -33 + nz, 0.9, '#ffffff', 0.8);
    // whiskers
    const ws = Math.sin(t * 3.1) * 1.6 + nz;
    for (const [dx, dy] of [[-17, -7], [-20, 0], [-16, 7]]) line(ctx, [[-59, -29], [-59 + dx * 0.55, -29 + dy * 0.45 - 1], [-59 + dx, -29 + dy + ws]], 1.1, PAL.ink, 0.85);
    // eye + angry brow
    eye(ctx, o, -44.5, -38, 4.3, { blink: r.blink, slit: r.slit, rot: -0.25 });
    line(ctx, [[-52, -42.5], [-44, -44], [-37.5, -47]], 2.2, PAL.ink);
    // near ear (torn notch)
    ctx.save(); pivot(ctx, -30, -46, r.ears * 0.5);
    const earP = [[-38, -46], [-41, -55], [-37, -64], [-28, -66], [-23, -61], [-25.5, -58], [-21, -55], [-24, -47]];
    shapeR(ctx, o, (c) => Art.blobPath(c, earP, 0.7), RAT.fur, RAT.furShade, { dx: -2, dy: -2, lw: Art.LW_THIN, inner: (c) => {
      Art.blobPath(c, [[-35, -48], [-37, -55], [-34, -61], [-29, -62], [-27, -57], [-28, -49]], 1); c.fillStyle = RAT.pink; c.fill();
    } });
    ctx.restore();
    ctx.restore(); // head

    // --- near front leg / paw ---
    tube(ctx, [[-19, -20], [L(-23, -28, r.paws), L(-11, -24, r.paws)], [L(-27, -38, r.paws), L(-4, -27, r.paws)]], 9.5, RAT.fur);
    line(ctx, [[-17, -22], [-13, -17], [-16, -13]], 1.3, PAL.ink, 0.5);
    Art.ellipsePath(ctx, L(-29, -40, r.paws), L(-2.6, -28, r.paws), 5.5, 3.2, -0.5 * r.paws); Art.fs(ctx, RAT.pink, Art.LW_THIN);
    ctx.restore();
    });
    if (pose === 'die') dieMotes(ctx, p, 0, -30, 80, 40, 18, PAL.candleDeep, 11);
  }

  Art.registerEnemy('rat', {
    draw: (ctx, pose, opts) => drawRat(ctx, pose, opts || {}),
    info: { height: 74, width: 100, fx: [-10, -27], head: [2, -78] },
  });

  // ======================================================================
  // small props shared by several enemies (sunken skulls, bones, coins)
  // ======================================================================
  function miniSkull(c, x, y, s, rot, col, sock) {
    c.save(); c.translate(x, y); c.rotate(rot || 0);
    col = col || PAL.bone; sock = sock || PAL.ink;
    Art.roundRectPath(c, -s * 0.55, s * 0.35, s * 1.1, s * 0.6, s * 0.2); Art.fs(c, col, 1.6);
    Art.blobPath(c, [[-s, -s * 0.1], [-s * 0.75, -s * 0.85], [0, -s * 1.1], [s * 0.75, -s * 0.85], [s, -s * 0.1], [s * 0.55, s * 0.55], [-s * 0.55, s * 0.55]], 1);
    Art.fs(c, col, 1.6);
    Art.ellipsePath(c, -s * 0.42, -s * 0.12, s * 0.3, s * 0.34); c.fillStyle = sock; c.fill();
    Art.ellipsePath(c, s * 0.42, -s * 0.12, s * 0.3, s * 0.34); c.fillStyle = sock; c.fill();
    Art.polyPath(c, [[0, s * 0.18], [-s * 0.12, s * 0.38], [s * 0.12, s * 0.38]]); c.fillStyle = sock; c.fill();
    for (const k of [-0.25, 0, 0.25]) line(c, [[k * s, s * 0.55], [k * s, s * 0.85]], 1, sock);
    c.restore();
  }
  function bone(c, x1, y1, x2, y2, w, col) {
    col = col || PAL.bone;
    const a = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(a) * w * 0.7, ny = Math.cos(a) * w * 0.7;
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      Art.circlePath(c, x + nx, y + ny, w * 0.95); Art.fs(c, col, 1.5);
      Art.circlePath(c, x - nx, y - ny, w * 0.95); Art.fs(c, col, 1.5);
    }
    c.save(); c.lineCap = 'butt';
    c.beginPath(); c.moveTo(L(x1, x2, 0.06), L(y1, y2, 0.06)); c.lineTo(L(x1, x2, 0.94), L(y1, y2, 0.94));
    c.lineWidth = w * 1.5 + 3; c.strokeStyle = PAL.ink; c.stroke();
    c.beginPath(); c.moveTo(L(x1, x2, 0.02), L(y1, y2, 0.02)); c.lineTo(L(x1, x2, 0.98), L(y1, y2, 0.98));
    c.lineWidth = w * 1.5; c.strokeStyle = col; c.stroke();
    c.restore();
  }
  function coin(c, x, y, r, rot) {
    c.save(); c.translate(x, y); c.rotate(rot || 0);
    Art.ellipsePath(c, 0, 0, r, r * 0.62); Art.fs(c, PAL.gold, 1.5);
    Art.ellipsePath(c, 0, 0, r * 0.55, r * 0.33); Art.strokeOnly(c, 1, PAL.brassDark);
    dot(c, -r * 0.4, -r * 0.2, r * 0.22, '#fff6d8', 0.9);
    c.restore();
  }

  // ======================================================================
  // SLIME 澱スライム — murky violet-grey ooze with bones & coins sunk inside
  // ======================================================================
  const SLIME = { base: '#7d7198', shade: '#554a75', puddle: '#3a3156', mouth: '#1d1430', streak: 'rgba(60,48,96,0.45)',
    eye: '#e3ff9c', eyeGlow: 'rgba(190,255,120,0.5)', glowc: 'rgba(175,140,255,0.6)' };

  function slimeRig(pose, o) {
    const t = num(o.t, 0), p = C(num(o.p, 0));
    const br = Math.sin((t * TAU) / 1.8);
    const r = { x: 0, H: 72 + br * 2.4, W: 92 - br * 2.2, lean: Math.sin(t * 1.1) * 2, wob: 1, mouth: 0.18 + Math.max(0, Math.sin(t * 0.8)) * 0.12,
      slit: 0, blink: blinkAt(t, 2), glow: 0, alpha: 1, bub: 1, drool: 0.4 };
    switch (pose) {
      case 'windup': {
        const q = Math.sin(t * 38) * 0.9;
        Object.assign(r, { x: 5 + q, H: 94 + Math.sin(t * 5) * 2, W: 80, lean: 15, wob: 1.8, mouth: 0.9 + Math.sin(t * 9) * 0.08, slit: 1, glow: 0.45, bub: 2.5, drool: 1 });
        break;
      }
      case 'attack': {
        const k = lungeK(p), s = strikeK(p), a = anticK(p);
        Object.assign(r, { x: -44 * k, H: 72 + 18 * a - 20 * s, W: 92 - 10 * a + 28 * s, lean: 13 * a - 24 * s, wob: 1.5 + s, mouth: 0.25 + 0.8 * s + 0.35 * a, slit: a * 0.8, drool: 1 });
        break;
      }
      case 'cast': {
        const k = 0.75 + 0.25 * Art.pulse(p, 0.4), g = Math.sin(t * 4);
        Object.assign(r, { H: 74 + 24 * k + g * 2, W: 94 + 14 * k - g * 2, wob: 1.7, mouth: 0.5, glow: k, bub: 3.5, slit: 0.4, drool: 0.8 });
        break;
      }
      case 'stance':
        Object.assign(r, { x: 3, H: 56 + br * 1.2, W: 112, lean: -4, wob: 0.3, mouth: 0.04, slit: 1, bub: 0.4, drool: 0 });
        break;
      case 'hit': {
        const k = recoil(p), j = Math.sin(C(p) * Math.PI * 6) * (1 - C(p));
        Object.assign(r, { x: 12 * k, H: 72 - 14 * k + j * 7, W: 92 + 16 * k - j * 7, lean: 16 * k, wob: 1 + 3 * k, mouth: 0.18 + 0.5 * k, blink: 0.9 * k });
        break;
      }
      case 'die': {
        const e = Art.easeInOut(p);
        Object.assign(r, { H: L(72, 7, e), W: L(92, 128, e), lean: 0, wob: 1 - e * 0.8, mouth: 0.3 * (1 - e), blink: Math.min(1, p * 2.5), alpha: dieAlpha(p), bub: 2 * (1 - e), drool: 0 });
        break;
      }
    }
    return r;
  }

  function slimePts(r, t) {
    const H = r.H, W = r.W, ln = r.lean, w = r.wob;
    const wv = (i, s) => Math.sin(t * (2.6 + i * 0.37) + i * 1.9) * s * w;
    const tip = Math.sin(t * 2.2) * 2.5 * w;
    return [
      [-W / 2 - 7, 0],
      [-W / 2 + 1 + wv(1, 1.3), -H * 0.2],
      [-W * 0.44 + ln * 0.3 + wv(2, 1.6), -H * 0.52],
      [-W * 0.3 + ln * 0.65 + wv(3, 1.6), -H * 0.8 + wv(9, 1)],
      [-W * 0.13 + ln * 0.9, -H * 0.95],
      [-W * 0.07 + ln * 1.1 - 6 + tip, -H * 1.08],
      [W * 0.04 + ln, -H * 0.96],
      [W * 0.21 + ln * 0.65 + wv(4, 1.6), -H * 0.85],
      [W * 0.39 + ln * 0.3 + wv(5, 1.6), -H * 0.57],
      [W / 2 + wv(6, 1.3), -H * 0.22],
      [W / 2 + 8, 0],
      [W * 0.18, 1.2],
      [-W * 0.2, 1.2],
    ];
  }

  function drawSlime(ctx, pose, o) {
    pose = normPose(pose);
    const t = num(o.t, 0), p = C(num(o.p, 0));
    const r = slimeRig(pose, o);
    const H = r.H, W = r.W, ln = r.lean;
    layered(ctx, r.alpha, (ctx) => {
    ctx.save();
    aura(ctx, o, r.x, -H * 0.45, 82);
    ctx.translate(r.x, 0);
    // puddle + stray droplets
    Art.ellipsePath(ctx, 0, 0, W / 2 + 15, 5); Art.fs(ctx, SLIME.puddle, Art.LW_THIN);
    Art.ellipsePath(ctx, -W / 2 - 22, 0.5, 5, 1.8); Art.fs(ctx, SLIME.puddle, 1.5);
    Art.ellipsePath(ctx, W / 2 + 24, 0.5, 3.5, 1.4); Art.fs(ctx, SLIME.puddle, 1.5);
    if (r.glow > 0) Art.glow(ctx, 0, -H * 0.45, H * 1.1, SLIME.glowc, r.glow * 0.7);

    const pts = slimePts(r, t);
    const bodyPath = (c) => Art.blobPath(c, pts, 1);
    shapeR(ctx, o, bodyPath, SLIME.base, SLIME.shade, { dx: -6, dy: -7, inner: (c) => {
      if (r.glow > 0) Art.glow(c, 4, -H * 0.42, H * 0.75, SLIME.glowc, r.glow);
      // drip streaks running down the surface
      for (const [u, len] of [[-0.32, 0.34], [0.12, 0.42], [0.33, 0.28]]) {
        const x = u * W + ln * 0.5, y0 = -H * (0.86 - Math.abs(u) * 0.5);
        Art.blobPath(c, [[x - 3, y0], [x + 3, y0], [x + 2.2, y0 + H * len], [x, y0 + H * len + 3], [x - 2.2, y0 + H * len]], 1);
        c.fillStyle = SLIME.streak; c.fill();
      }
      // sunken things (seen through the murk)
      c.save(); c.globalAlpha *= 0.66;
      const bob = Math.sin(t * 1.3) * 1.5;
      miniSkull(c, W * 0.15 + ln * 0.3, -H * 0.36 + bob, 9, 0.45 + Math.sin(t * 0.9) * 0.06, '#d9cfe0', '#2a2040');
      bone(c, -W * 0.1, -H * 0.12 - bob * 0.5, W * 0.17, -H * 0.2, 2.6, '#d9cfe0');
      coin(c, W * 0.31, -H * 0.13 + bob * 0.4, 4.6, 0.3);
      coin(c, -W * 0.33, -H * 0.17 - bob * 0.3, 4, -0.5 + Math.sin(t * 1.7) * 0.2);
      coin(c, W * 0.02 + ln * 0.4, -H * 0.58 + bob, 3.6, 0.9);
      c.restore();
      // murky sediment at the bottom
      Art.ellipsePath(c, 0, 2, W * 0.62, H * 0.2); c.fillStyle = 'rgba(38,28,66,0.32)'; c.fill();
      // bubbles rising inside
      const nb = Math.round(3 * r.bub) + 1;
      for (let i = 0; i < nb; i++) {
        const ph = frac(t * (0.28 + Art.hash(i) * 0.25) + Art.hash(i + 7)), x = (Art.hash(i + 2) - 0.5) * W * 0.6 + Math.sin(ph * 9 + i) * 2;
        const y = -H * 0.08 - ph * H * 0.8, rr = 1.3 + Art.hash(i + 4) * 2.2;
        Art.circlePath(c, x, y, rr); c.lineWidth = 1; c.strokeStyle = 'rgba(235,225,255,0.55)'; c.stroke();
        dot(c, x - rr * 0.35, y - rr * 0.35, rr * 0.3, 'rgba(255,255,255,0.7)');
      }
      // glossy highlight (light from upper-left)
      c.beginPath(); c.arc(-W * 0.06 + ln * 0.5, -H * 0.5, H * 0.38, Math.PI * 1.12, Math.PI * 1.42);
      c.lineWidth = 4; c.lineCap = 'round'; c.strokeStyle = 'rgba(240,232,255,0.55)'; c.stroke();
      dot(c, -W * 0.06 + ln * 0.5 + Math.cos(Math.PI * 1.5) * H * 0.38 + 6, -H * 0.5 - H * 0.38 + 4, 2.2, 'rgba(255,255,255,0.7)');
    } });

    // --- face ---
    const fx = ln * 0.55, mx = -W * 0.17 + fx, my = -H * 0.36, mw = W * 0.17, open = 2 + r.mouth * 15;
    const mouth = (c) => { c.beginPath(); c.moveTo(mx - mw, my - 4); c.quadraticCurveTo(mx, my + 3, mx + mw, my - 6);
      c.quadraticCurveTo(mx + 3, my + 3 + open * 1.5, mx - mw, my - 4); c.closePath(); };
    mouth(ctx); Art.fs(ctx, SLIME.mouth, Art.LW_THIN);
    ctx.save(); mouth(ctx); ctx.clip();
    for (let i = 0; i < 5; i++) { // jagged bone teeth along the top lip
      const u = 0.12 + i * 0.19, x = L(mx - mw, mx + mw, u), y = L(my - 4, my - 6, u) + Math.sin(u * Math.PI) * 3.5 - 0.5;
      const tl = 3 + open * 0.22 + (i % 2) * 1.5;
      Art.polyPath(ctx, [[x - 2.4, y - 1], [x + 2.4, y - 1], [x + 0.3, y + tl]]); Art.fs(ctx, PAL.bone, 1.2);
    }
    if (open > 6) for (const u of [0.3, 0.62]) { const x = L(mx - mw, mx + mw, u) + 1, y = my + open * 1.05;
      Art.polyPath(ctx, [[x - 2, y + 3], [x + 2, y + 3], [x, y - open * 0.25]]); Art.fs(ctx, PAL.bone, 1.2); }
    ctx.restore();
    // drool strand
    if (r.drool > 0 && r.mouth > 0.35) {
      const ph = frac(t * 0.55), len = 3 + ph * 12 * r.drool, dx = mx + 2, dy = my + 1 + open * 0.9;
      line(ctx, [[dx, dy - 2], [dx + 0.5, dy + len * 0.6], [dx, dy + len]], 3, PAL.ink);
      line(ctx, [[dx, dy - 2], [dx + 0.5, dy + len * 0.6], [dx, dy + len]], 1.2, '#b9a9e0');
      const dr = 2.4 + ph * 0.9, dyy = dy + len + 1;
      ctx.beginPath(); ctx.moveTo(dx, dyy - dr * 1.8); ctx.quadraticCurveTo(dx + dr * 1.2, dyy, dx, dyy + dr); ctx.quadraticCurveTo(dx - dr * 1.2, dyy, dx, dyy - dr * 1.8);
      Art.fs(ctx, '#b9a9e0', 1.4);
      dot(ctx, dx - dr * 0.3, dyy - dr * 0.1, dr * 0.3, '#ffffff', 0.8);
    }
    // eyes (menacing slant)
    const ey = -H * 0.62;
    eye(ctx, o, -W * 0.27 + fx, ey + 2, 5, { blink: r.blink, slit: r.slit, rot: 0.3, color: SLIME.eye, glowColor: SLIME.eyeGlow });
    eye(ctx, o, -W * 0.07 + fx, ey - 1, 5.6, { blink: r.blink, slit: r.slit, rot: -0.25, color: SLIME.eye, glowColor: SLIME.eyeGlow });
    line(ctx, [[-W * 0.35 + fx, ey - 6], [-W * 0.22 + fx, ey - 3]], 2.2, PAL.ink, 0.85);
    line(ctx, [[-W * 0.12 + fx, ey - 7], [W * 0.01 + fx, ey - 10]], 2.2, PAL.ink, 0.85);
    ctx.restore();
    });
    // growth / cast motes
    if (pose === 'cast') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 9; i++) {
        const ph = frac(t * 0.7 + i / 9), x = r.x + (Art.hash(i + 30) - 0.5) * W * 1.1, y = -H * (0.2 + ph * 1.1);
        dot(ctx, x, y, 1.6 + (1 - ph) * 1.4, '#cdb8ff', Math.sin(ph * Math.PI) * 0.9);
      }
      ctx.restore();
    }
    if (pose === 'die') dieMotes(ctx, p, r.x, -12, 110, 20, 16, '#b49cff', 23);
  }

  Art.registerEnemy('slime', {
    draw: (ctx, pose, opts) => drawSlime(ctx, pose, opts || {}),
    info: { height: 80, width: 100, fx: [-6, -34], head: [-6, -84] },
  });

  // ======================================================================
  // SHELLBACK 殻ムシ — armored pill-bug with overlapping riveted steel plates
  // ======================================================================
  const SHELL = { plate: '#6283ad', plateShade: '#3e5782', lip: 'rgba(196,220,244,0.8)', gap: 'rgba(20,24,52,0.42)', under: '#2a2541',
    leg: '#3a3556', legFar: '#26223a', head: '#46587e', headShade: '#2d3b5b', mand: '#e6d8b8', mandShade: '#b8a684' };
  const SEAMS = [-25, -5, 15, 34];
  const PLATE_B = [-43, -25, -5, 15, 34, 51];

  function rivet(c, x, y, r) {
    Art.circlePath(c, x, y, r); Art.fs(c, PAL.brassLight, 1.2);
    dot(c, x - r * 0.35, y - r * 0.35, r * 0.4, '#fff6d8', 0.9);
  }
  function sparkle(c, x, y, s, a) {
    if (a <= 0.02 || s <= 0) return;
    c.save(); c.globalAlpha *= a; c.globalCompositeOperation = 'lighter';
    Art.glow(c, x, y, s * 1.6, 'rgba(200,230,255,0.8)', 0.7);
    c.beginPath();
    c.moveTo(x, y - s); c.quadraticCurveTo(x, y, x + s, y); c.quadraticCurveTo(x, y, x, y + s); c.quadraticCurveTo(x, y, x - s, y); c.quadraticCurveTo(x, y, x, y - s);
    c.fillStyle = '#ffffff'; c.fill();
    c.restore();
  }

  function shellRig(pose, o) {
    const t = num(o.t, 0), p = C(num(o.p, 0));
    const br = Math.sin((t * TAU) / 1.7);
    const r = { x: 0, y: 0, rot: 0, px: 46, py: -8, sx: 1 - br * 0.01, sy: 1 + br * 0.02, legPh: t * 5, legAmp: 0.6, mand: 0.12 + Math.max(0, Math.sin(t * 3.1)) * 0.25,
      ant: 0, antSw: 1, slit: 0, blink: blinkAt(t, 3), alpha: 1, lift: 0, curl: 0, shimmer: 0, flip: 0 };
    switch (pose) {
      case 'windup': {
        const q = Math.sin(t * 44) * 0.8;
        Object.assign(r, { x: 6 + q, rot: 0.2 + Math.sin(t * 6) * 0.015, mand: 0.9 + Math.sin(t * 14) * 0.1, ant: 0.6, antSw: 2.2, slit: 1, lift: 1, legPh: t * 16, legAmp: 1.2, sx: 0.97, sy: 1.03 });
        break;
      }
      case 'attack': {
        const k = lungeK(p), s = strikeK(p), a = anticK(p);
        Object.assign(r, { x: -46 * k, rot: 0.12 * a - 0.07 * s, mand: 0.2 + 0.8 * a + 0.3 * s * (p < 0.38 ? 1 : 0), ant: 0.5 * s + 0.3 * a, legPh: t * 5 + p * 30, legAmp: 1.3,
          sx: 1 - 0.04 * a + 0.08 * s, sy: 1 + 0.04 * a - 0.06 * s, slit: a });
        break;
      }
      case 'cast': {
        const k = 0.75 + 0.25 * Art.pulse(p, 0.4);
        Object.assign(r, { rot: 0.08 * k, lift: 0.6 * k, shimmer: k, ant: -0.2 + Math.sin(t * 4) * 0.25, antSw: 2, mand: 0.4 + Math.sin(t * 8) * 0.15 });
        break;
      }
      case 'stance':
        Object.assign(r, { curl: 1, rot: Math.sin(t * 1.8) * 0.05, px: 0, py: 0, sx: 1 + br * 0.01, sy: 1 - br * 0.012 });
        break;
      case 'hit': {
        const k = recoil(p);
        Object.assign(r, { x: 12 * k, rot: 0.12 * k + Math.sin(C(p) * 40) * 0.03 * (1 - C(p)), sx: 1 + 0.05 * k, sy: 1 - 0.05 * k, blink: 0.9 * k, mand: 0.6 * k, ant: -0.6 * k, lift: 0.7 * k, legAmp: 1.6 * k + 0.4 });
        break;
      }
      case 'die': {
        const e = Art.easeInOut(C(p / 0.5));
        Object.assign(r, { flip: e, y: -Math.sin(e * Math.PI) * 18 + 6 * Art.easeIn(C((p - 0.5) / 0.5)), legPh: t * 22, legAmp: 1.6 * (1 - C((p - 0.4) / 0.6)),
          blink: e, mand: 0.5, alpha: dieAlpha(p), sx: 1 - 0.25 * p, sy: 1 - 0.3 * p, ant: -0.5 * e });
        break;
      }
    }
    return r;
  }

  const shellDomePath = (c) => { c.beginPath(); c.ellipse(4, -12, 47, 58, 0, Math.PI, TAU); c.quadraticCurveTo(4, -5, -43, -12); c.closePath(); };
  const shellBottomY = (x) => -12 + 6.5 * (1 - Math.pow((x - 4) / 47, 2));

  function drawShellBody(ctx, o, r, t) {
    // far legs
    for (let i = 0; i < 7; i++) {
      const x = -30 + i * 12.5 + 5, a = Math.sin(r.legPh + i * 0.9 + 1.6) * r.legAmp;
      tube(ctx, [[x, -12], [x - 3 + a * 2, -6], [x - 5 + a * 3, 0]], 3.4, SHELL.legFar);
    }
    // tail uropods
    for (const [dx, dy, a] of [[0, 0, 0.35], [-2, 3, 0.1]]) {
      ctx.save(); ctx.translate(48 + dx, -12 + dy); ctx.rotate(a);
      Art.polyPath(ctx, [[0, -3], [15, 1], [0, 3.5]]); Art.fs(ctx, SHELL.plateShade, Art.LW_THIN);
      ctx.restore();
    }
    // underbelly
    Art.ellipsePath(ctx, 4, -9, 44, 6); Art.fs(ctx, SHELL.under, Art.LW_THIN);
    // near legs
    for (let i = 0; i < 7; i++) {
      const x = -32 + i * 12.5, a = Math.sin(r.legPh + i * 0.9) * r.legAmp;
      tube(ctx, [[x, -11], [x - 3 + a * 2, -5.5], [x - 6 + a * 3, -0.5]], 4.2, SHELL.leg);
    }
    // head (tucked under the front plate)
    ctx.save();
    pivot(ctx, -44, -18, -r.rot * 0.3);
    // antennae
    for (const [bx, by, ba, len, far] of [[-46, -30, -2.05, 7.4, 1], [-53, -29, -2.35, 7, 0]]) {
      const pts = [[bx, by]];
      let x = bx, y = by;
      for (let s = 1; s <= 6; s++) {
        const a = ba + r.ant * 0.5 + (s / 6) * (-0.55 - r.ant * 0.3) * (far ? 0.8 : 1) + Math.sin(t * 2.2 + s * 0.7 + far) * 0.08 * r.antSw * (s / 6);
        x += Math.cos(a) * len; y += Math.sin(a) * len; pts.push([x, y]);
      }
      line(ctx, pts, 3.4, PAL.ink);
      line(ctx, pts, 1.4, far ? '#5f7499' : '#93abd2');
      for (let s = 1; s < 6; s += 2) dot(ctx, pts[s][0], pts[s][1], 1.4, PAL.ink);
      Art.circlePath(ctx, x, y, 2.8); Art.fs(ctx, far ? '#5f7499' : '#93abd2', 1.6);
    }
    // mandibles (far, then head, then near)
    const mand = (c, flip, col, shd) => {
      c.save(); c.translate(-59, -12); c.rotate(flip * (0.08 + r.mand * 0.42)); c.scale(1.3, 1.3);
      shapeR(c, o, (q) => Art.blobPath(q, [[0, -3], [-8, -4.5 * flip - 0.5], [-14, -1.5 * flip - 1.5], [-12.5, 1.5], [-9, -0.2 * flip], [-3, 3]], 1), col, shd, { dx: -1.5, dy: -1.5, lw: Art.LW_THIN, noRim: true });
      c.restore();
    };
    mand(ctx, 1, SHELL.mandShade, SHELL.mandShade);
    shapeR(ctx, o, (c) => Art.ellipsePath(c, -50, -18, 15, 13, -0.2), SHELL.head, SHELL.headShade, { dx: -3, dy: -3, inner: (c) => {
      c.beginPath(); c.moveTo(-60, -28); c.quadraticCurveTo(-50, -33, -40, -28); Art.strokeOnly(c, 1.6, '#7f97c0'); // head-plate ridge
    } });
    eye(ctx, o, -58, -20, 3.9, { blink: r.blink, slit: r.slit, rot: 0.2 });
    eye(ctx, o, -49, -24, 3.4, { blink: r.blink, slit: r.slit, rot: -0.2 });
    line(ctx, [[-63.5, -25.5], [-54, -28]], 2.2, PAL.ink);
    mand(ctx, -1, SHELL.mand, SHELL.mandShade);
    ctx.restore();

    // plate tips along the skirt (drawn under the dome so the dome overlaps them)
    for (let k = 0; k < PLATE_B.length - 1; k++) {
      const xa = PLATE_B[k] + 1.5, xb = PLATE_B[k + 1] - 1.5, xm = (xa + xb) / 2, yb = shellBottomY(xm);
      Art.ellipsePath(ctx, xm, yb - 2, (xb - xa) / 2 + 1, 6.5); Art.fs(ctx, SHELL.plateShade, Art.LW);
    }
    // dome with seams, lips, rivets
    const lift = r.lift;
    shapeR(ctx, o, shellDomePath, SHELL.plate, SHELL.plateShade, { dx: -7, dy: -8, inner: (c) => {
      for (let i = 0; i < SEAMS.length; i++) {
        const x0 = SEAMS[i], lf = lift * (1.5 + Math.sin(t * 30 + i * 2) * 0.8);
        const seam = (dx, w, col) => { c.beginPath(); c.moveTo(x0 + 5 + dx, -4); c.quadraticCurveTo(x0 - 9 + dx, -42, x0 + 3 + dx, -84);
          c.lineWidth = w; c.strokeStyle = col; c.lineCap = 'round'; c.stroke(); };
        seam(4 + lf, 6 + lf * 2, SHELL.gap);            // shadow cast by the overlapping plate
        if (lift > 0) seam(2.5, 2 + lf * 2, 'rgba(255,120,60,' + (0.35 * lift) + ')'); // hot glint in the gaps
        seam(-2.6, 2.4, SHELL.lip);                         // bright plate lip
        seam(0, 2.6, PAL.ink);                          // seam line
        for (const s of [0.28, 0.5, 0.72]) {             // rivets on the lip
          const u = 1 - s, x = u * u * (x0 + 5) + 2 * u * s * (x0 - 9) + s * s * (x0 + 3) - 6.5, y = u * u * -4 + 2 * u * s * -42 + s * s * -84;
          if (y > -66 + Math.abs(x - 4) * 0.35) rivet(c, x, y, 2.2);
        }
      }
      // steel shine streaks (upper-left light)
      for (const [x, y, l] of [[-30, -42, 8], [-14, -58, 10], [3, -64, 9], [-24, -30, 5]]) line(c, [[x, y], [x + l * 0.6, y - l * 0.55]], 2.6, 'rgba(235,245,255,0.6)');
      // scratches / dents
      for (const [x, y] of [[28, -40], [14, -26], [44, -26]]) line(c, [[x, y], [x + 5, y + 2], [x + 8, y + 1]], 1.1, PAL.ink, 0.45);
      if (r.shimmer > 0) Art.glow(c, 0, -40, 60, 'rgba(111,211,255,0.35)', r.shimmer * (0.6 + 0.4 * Math.sin(t * 6)));
    } });
    rivet(ctx, -37, -16, 2.2); // front plate corner rivet
  }

  function drawShellBall(ctx, o, r, t) {
    const R = 39, cx = 0, cy = -R - 1, roll = r.rot * 2.2;
    // armor shimmer
    Art.glow(ctx, cx, cy, R * 1.6, 'rgba(111,211,255,0.22)', 0.7 + 0.3 * Math.sin(t * 2.4));
    // tucked tail tip & little feet peeking out
    for (const x of [-14, -4, 6]) { Art.ellipsePath(ctx, x, -2, 4, 2.6); Art.fs(ctx, SHELL.legFar, Art.LW_THIN); }
    const ball = (c) => Art.circlePath(c, cx, cy, R);
    shapeR(ctx, o, ball, SHELL.plate, SHELL.plateShade, { dx: -7, dy: -8, inner: (c) => {
      for (let k = -2; k <= 2; k++) {
        const ph = k * 0.55 + roll, s = Math.sin(ph), rx = Math.abs(s) * R;
        const meridian = (dx, w, col) => {
          c.beginPath();
          if (s >= 0) c.ellipse(cx + dx, cy, Math.max(0.5, rx), R, 0, -Math.PI / 2, Math.PI / 2);
          else c.ellipse(cx + dx, cy, Math.max(0.5, rx), R, 0, Math.PI / 2, Math.PI * 1.5);
          c.lineWidth = w; c.strokeStyle = col; c.stroke();
        };
        meridian(3.5, 5.5, SHELL.gap);
        meridian(-2.4, 2.4, SHELL.lip);
        meridian(0, 2.6, PAL.ink);
        for (const lam of [-0.95, -0.45, 0.05, 0.55]) {
          const x = cx + s * Math.cos(lam) * R - 5, y = cy + Math.sin(lam) * R;
          if (Math.abs(s) > 0.12 && Math.abs(s) < 0.95) rivet(c, x, y, 2.1);
        }
      }
      // big polished highlight + reflected candle glint
      c.beginPath(); c.arc(cx, cy, R * 0.78, Math.PI * 1.08, Math.PI * 1.42); c.lineWidth = 5; c.lineCap = 'round'; c.strokeStyle = 'rgba(235,245,255,0.6)'; c.stroke();
      dot(c, cx - R * 0.42, cy - R * 0.62, 3, 'rgba(255,255,255,0.75)');
      Art.ellipsePath(c, cx + R * 0.15, cy + R * 0.82, R * 0.8, R * 0.3); c.fillStyle = 'rgba(20,18,40,0.3)'; c.fill();
    } });
    // pale ward rim: "blades will bounce"
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, R + 5, Math.PI * 0.95, Math.PI * 1.75);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(111,211,255,' + (0.35 + 0.2 * Math.sin(t * 3)).toFixed(3) + ')'; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R + 9, Math.PI * 1.1, Math.PI * 1.55);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(111,211,255,' + (0.2 + 0.15 * Math.sin(t * 3 + 1)).toFixed(3) + ')'; ctx.stroke();
    ctx.restore();
    // one eye peeking out between plates
    eye(ctx, o, cx - R * 0.66, cy + R * 0.56, 2.6, { slit: 1, blink: r.blink * 0.5, rot: 0.6 });
    // antenna tip peeking
    line(ctx, [[cx - R * 0.8, cy + R * 0.42], [cx - R * 1.05, cy + R * 0.25], [cx - R * 1.12, cy + R * 0.05]], 3.2, PAL.ink);
    line(ctx, [[cx - R * 0.8, cy + R * 0.42], [cx - R * 1.05, cy + R * 0.25], [cx - R * 1.12, cy + R * 0.05]], 1.2, SHELL.head);
    // twinkle — "blades will bounce"
    const tw = frac(t * 0.45);
    sparkle(ctx, cx - R * 0.5, cy - R * 0.68, 9 * Math.sin(C(tw / 0.25) * Math.PI), 1);
    sparkle(ctx, cx + R * 0.62, cy - R * 0.2, 6 * Math.sin(C((tw - 0.4) / 0.2) * Math.PI), 0.9);
  }

  function drawShellback(ctx, pose, o) {
    pose = normPose(pose);
    const t = num(o.t, 0), p = C(num(o.p, 0));
    const r = shellRig(pose, o);
    layered(ctx, r.alpha, (ctx) => {
    ctx.save();
    aura(ctx, o, r.x, -36, 86);
    ctx.translate(r.x, r.y);
    if (r.curl) {
      pivot(ctx, 0, 0, r.rot);
      ctx.scale(r.sx, r.sy);
      drawShellBall(ctx, o, r, t);
    } else {
      pivot(ctx, r.px, r.py, r.rot);
      if (r.flip > 0) pivot(ctx, 4, -36, r.flip * Math.PI);
      ctx.scale(r.sx, r.sy);
      drawShellBody(ctx, o, r, t);
    }
    ctx.restore();
    });
    if (pose === 'die') dieMotes(ctx, p, 0, -30, 100, 40, 18, PAL.ward, 37);
  }

  Art.registerEnemy('shellback', {
    draw: (ctx, pose, opts) => drawShellback(ctx, pose, opts || {}),
    info: { height: 82, width: 120, fx: [-4, -34], head: [-6, -86] },
  });

  // ======================================================================
  // BELLHOUND 鐘つき犬 (ELITE) — hulking hound with a bronze church bell on a spiked collar
  // ======================================================================
  const HOUND = { fur: '#4f4364', furShade: '#31283f', belly: '#625478', mane: '#33283f', maneShade: '#1f1826', maneTip: '#6e5a84',
    leather: '#6b3f2a', leatherShade: '#43251a', mouth: '#4a1022', tongue: '#c9506a', nose: '#1d1724', scar: '#8f7aa6' };
  const HOUND_TORSO = [[-56, -98], [-50, -72], [-30, -58], [2, -62], [34, -66], [60, -64], [82, -76], [90, -98], [80, -116], [52, -121], [20, -125], [-12, -139], [-42, -135]];

  // Sound-wave arcs "(( ))" expanding from a point.
  function soundRings(ctx, x, y, t, k, r0, r1, speed, sides) {
    if (k <= 0.01) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const ph = frac(t * speed + i / 3), rr = L(r0, r1, ph), a = Math.sin(Math.min(1, ph * 4) * Math.PI / 2) * (1 - ph) * k;
      for (const side of sides || [-1, 1]) {
        const c = side < 0 ? Math.PI : (side > 1 ? -Math.PI / 2 : 0);
        ctx.beginPath(); ctx.arc(x, y, rr, c - 0.5, c + 0.5);
        ctx.lineWidth = 4.2 * (1 - ph * 0.5); ctx.strokeStyle = 'rgba(255,190,90,' + (a * 0.55).toFixed(3) + ')'; ctx.stroke();
        ctx.lineWidth = 1.8 * (1 - ph * 0.4); ctx.strokeStyle = 'rgba(255,240,200,' + a.toFixed(3) + ')'; ctx.stroke();
      }
    }
    ctx.restore();
  }

  function houndRig(pose, o) {
    const t = num(o.t, 0), p = C(num(o.p, 0));
    const br = Math.sin((t * TAU) / 2.2);
    const r = { x: 0, y: 0, rot: 0, px: 66, py: -80, cy: br * 1.6, sx: 1, sy: 1, head: Math.sin(t * 0.9) * 0.03 + br * 0.02, jaw: 0.14 + Math.max(0, Math.sin(t * 1.3)) * 0.1,
      bell: Math.sin(t * 1.6) * 0.1, bellGlow: 0, shake: 0, rings: 0, howl: 0, bristle: 0, tailAmp: 1, slit: 0, blink: blinkAt(t, 4), alpha: 1, ears: 0, clap: Math.sin(t * 1.6 - 0.8) * 2 };
    switch (pose) {
      case 'windup': {
        const q = Math.sin(t * 52);
        Object.assign(r, { x: q * 0.8, rot: 0.07, cy: -5 + Math.sin(t * 3) * 1, head: 1.02 + Math.sin(t * 3) * 0.04, jaw: 1, bell: Math.sin(t * 13) * 0.1,
          bellGlow: 0.85 + Math.sin(t * 8) * 0.15, shake: 1, rings: 1, howl: 1, bristle: 1.3, ears: 1, slit: 1, tailAmp: 2.2, clap: Math.sin(t * 26) * 5 });
        break;
      }
      case 'attack': {
        const k = lungeK(p), s = strikeK(p), a = anticK(p);
        const jaw = p < 0.41 ? 0.2 + 0.8 * C(p / 0.34) : 0.12 + 0.3 * (1 - C((p - 0.41) / 0.3));
        Object.assign(r, { x: -64 * k, cy: 12 * a - 3 * s, rot: 0.05 * a - 0.07 * s, head: -0.28 * a - 0.12 * s, jaw, bell: 0.35 * a + 0.9 * s - 0.25 * Math.max(0, k) * (1 - s),
          bellGlow: 0.5 * s, rings: 0.8 * s, shake: 0.6 * s, bristle: 0.8, ears: 0.8, slit: a, sx: 1 + 0.05 * s, sy: 1 - 0.03 * s, tailAmp: 1.8, clap: -6 * s });
        break;
      }
      case 'cast': {
        const k = 0.7 + 0.3 * Art.pulse(p, 0.4);
        Object.assign(r, { head: 0.3 * k + Math.sin(t * 7) * 0.14, jaw: 0.55, bell: Math.sin(t * 7 + 1) * 0.55 * k, bellGlow: 0.55 * k, rings: 0.7 * k, ears: 0.6, slit: 0.5,
          clap: Math.sin(t * 7 - 0.6) * 6, bristle: 0.5 });
        break;
      }
      case 'stance': {
        Object.assign(r, { cy: 9 + br, rot: -0.04, head: -0.16 + Math.sin(t * 9) * 0.015, jaw: 0.38 + Math.sin(t * 9) * 0.04, bristle: 1.4, ears: 1, slit: 1, tailAmp: 0.3, bell: Math.sin(t * 1.6) * 0.04 });
        break;
      }
      case 'hit': {
        const k = recoil(p);
        Object.assign(r, { x: 16 * k, rot: 0.07 * k, head: 0.36 * k, jaw: 0.14 + 0.5 * k, bell: -0.7 * k + Math.sin(C(p) * 18) * 0.3 * (1 - C(p)), rings: 0.6 * k, shake: 0.5 * k,
          blink: 0.9 * k, ears: k, bristle: k, tailAmp: 1 + k, clap: 5 * k });
        break;
      }
      case 'die': {
        const e = Art.easeOut(C(p / 0.55)), sh = 1 - 0.22 * p;
        Object.assign(r, { cy: 44 * e, rot: -0.07 * e, head: -0.5 * e, jaw: 0.3, bell: 1.15 * e, blink: e, alpha: dieAlpha(p), sx: sh * (1 + 0.08 * e), sy: sh, tailAmp: 1 - e, ears: e, clap: 0 });
        break;
      }
    }
    return r;
  }

  function drawPaw(ctx, x, y, col, shd, o) {
    shapeR(ctx, o, (c) => Art.blobPath(c, [[x - 13, y + 5], [x - 12, y - 3], [x - 2, y - 7], [x + 9, y - 4], [x + 10, y + 5]], 1), col, shd, { dx: -2, dy: -2, lw: Art.LW, noRim: true });
    for (const k of [0, 1, 2]) { const cx = x - 13 + k * 4.5; Art.polyPath(ctx, [[cx - 1.8, y + 3.5], [cx - 6, y + 5.5], [cx + 1.2, y + 5.5]]); Art.fs(ctx, PAL.bone, 1.2); }
    for (const k of [0, 1]) line(ctx, [[x - 7 + k * 5, y - 4], [x - 6 + k * 5, y + 1]], 1.2, PAL.ink, 0.6);
  }

  function drawBell(ctx, o, r, t, wx, wy) {
    const sh = r.shake;
    ctx.save();
    ctx.translate(wx + Math.sin(t * 61) * 1.6 * sh, wy + Math.cos(t * 47) * 0.8 * sh);
    ctx.rotate(r.bell + Math.sin(t * 57) * 0.05 * sh);
    // chain links
    Art.ellipsePath(ctx, 0, 5, 3.2, 4.6); Art.strokeOnly(ctx, 4.4); Art.ellipsePath(ctx, 0, 5, 3.2, 4.6); Art.strokeOnly(ctx, 2, PAL.steelShade);
    Art.roundRectPath(ctx, -1.6, 8.5, 3.2, 8.5, 1.6); Art.fs(ctx, PAL.steelShade, 1.6);
    // crown loop
    ctx.beginPath(); ctx.arc(0, 18, 4.5, Math.PI, TAU); Art.strokeOnly(ctx, 5); ctx.beginPath(); ctx.arc(0, 18, 4.5, Math.PI, TAU); Art.strokeOnly(ctx, 2.4, PAL.brassDark);
    if (r.bellGlow > 0) Art.glow(ctx, 0, 36, 46 + 30 * r.bellGlow, 'rgba(255,190,80,0.7)', r.bellGlow);
    // clapper (behind the lip)
    const cl = r.clap;
    line(ctx, [[0, 30], [cl * 0.6, 46]], 2, PAL.brassShadow);
    const bellPath = (c) => { c.beginPath(); c.moveTo(-8, 21); c.bezierCurveTo(-8, 14.5, 8, 14.5, 8, 21); c.bezierCurveTo(10, 31, 11, 40, 18, 47.5);
      c.quadraticCurveTo(0, 51.5, -18, 47.5); c.bezierCurveTo(-11, 40, -10, 31, -8, 21); c.closePath(); };
    shapeR(ctx, o, bellPath, PAL.brass, PAL.brassDark, { dx: -5, dy: -2, rimW: 5, inner: (c) => {
      // engraved bands + ember emblem
      c.beginPath(); c.moveTo(-10, 25.5); c.quadraticCurveTo(0, 27.5, 10, 25.5); Art.strokeOnly(c, 1.6, PAL.brassShadow);
      c.beginPath(); c.moveTo(-14.5, 41.5); c.quadraticCurveTo(0, 44.5, 14.5, 41.5); Art.strokeOnly(c, 1.6, PAL.brassShadow);
      c.beginPath(); c.moveTo(-17, 45.5); c.quadraticCurveTo(0, 49, 17, 45.5); Art.strokeOnly(c, 2.4, PAL.brassDark);
      Art.circlePath(c, 0, 34, 4.2); Art.strokeOnly(c, 1.4, PAL.brassShadow);
      dot(c, 0, 34, 1.6, PAL.brassShadow);
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; line(c, [[Math.cos(a) * 5.6, 34 + Math.sin(a) * 5.6], [Math.cos(a) * 7.2, 34 + Math.sin(a) * 7.2]], 1.2, PAL.brassShadow); }
      // verdigris speckles
      for (const [x, y] of [[6, 38], [-9, 44], [9, 23]]) dot(c, x, y, 1.6, '#6fa38a', 0.55);
      // polished highlight
      c.beginPath(); c.moveTo(-5.5, 21); c.bezierCurveTo(-7, 30, -8, 38, -12.5, 45); Art.strokeOnly(c, 2.6, PAL.brassLight);
      dot(c, -4, 20, 1.5, '#fff1c4', 0.9);
      if (r.bellGlow > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgba(255,180,70,' + (0.45 * r.bellGlow).toFixed(3) + ')'; c.fillRect(-20, 12, 40, 42); c.restore(); }
    } });
    // mouth of the bell + clapper ball
    Art.ellipsePath(ctx, 0, 48, 15.5, 2.6); ctx.fillStyle = PAL.brassShadow; ctx.fill();
    Art.circlePath(ctx, cl * 0.7, 49.5, 3.6); Art.fs(ctx, PAL.brassDark, 1.6);
    soundRings(ctx, 0, 36, t, r.rings, 24, 74, 1.7);
    ctx.restore();
  }

  function drawHoundHead(ctx, o, r, t) {
    // far ear
    ctx.save(); pivot(ctx, -48, -132, r.ears * 0.35);
    Art.polyPath(ctx, [[-52, -131], [-34, -158], [-38, -140], [-40, -128]]); Art.fs(ctx, HOUND.furShade, Art.LW_THIN);
    ctx.restore();
    // lower jaw + mouth interior
    const ja = -r.jaw * 0.72, J = [-58, -108];
    const rot = (x, y) => { const dx = x - J[0], dy = y - J[1], c = Math.cos(ja), s = Math.sin(ja); return [J[0] + dx * c - dy * s, J[1] + dx * s + dy * c]; };
    if (r.jaw > 0.05) {
      Art.blobPath(ctx, [[-56, -114], [-80, -112], [-99, -110], rot(-97, -104), rot(-80, -100), rot(-60, -100)], 0.8); Art.fs(ctx, HOUND.mouth, Art.LW_THIN);
      Art.blobPath(ctx, [[-62, -106], rot(-88, -104), rot(-74, -101), rot(-60, -102)], 1); ctx.fillStyle = HOUND.tongue; ctx.fill();
    }
    ctx.save(); pivot(ctx, J[0], J[1], ja);
    shapeR(ctx, o, (c) => Art.blobPath(c, [[-55, -110], [-80, -109], [-97, -108], [-99, -103], [-84, -98], [-62, -99], [-50, -104]], 1), HOUND.fur, HOUND.furShade, { dx: -2, dy: -3 });
    for (const [x, h] of [[-93, 7], [-79, 5], [-70, 3.5]]) { Art.polyPath(ctx, [[x - 2.6, -107], [x + 2.6, -107], [x + 0.4, -107 - h]]); Art.fs(ctx, PAL.bone, 1.3); }
    ctx.restore();
    // skull
    const skull = (c) => Art.blobPath(c, [[-56, -136], [-72, -140], [-86, -133], [-98, -125], [-105, -117], [-101, -108], [-84, -106], [-64, -105], [-48, -110], [-44, -126]], 1);
    shapeR(ctx, o, skull, HOUND.fur, HOUND.furShade, { dx: -4, dy: -5, inner: (c) => {
      Art.blobPath(c, [[-104, -113], [-90, -112], [-72, -110], [-70, -104], [-104, -104]], 1); c.fillStyle = HOUND.belly; c.fill(); // muzzle
      line(c, [[-93, -129], [-89, -121], [-86, -114]], 1.6, HOUND.scar);            // old scar
      for (const [x, y] of [[-62, -128], [-56, -120], [-66, -118]]) line(c, [[x, y], [x + 5, y - 2], [x + 8, y - 6]], 1.3, PAL.ink, 0.5);
    } });
    // upper fangs
    for (const [x, h] of [[-95, 9.5], [-86, 6], [-76, 7.5]]) { Art.polyPath(ctx, [[x - 2.8, -107], [x + 2.8, -107], [x - 0.4, -107 + h]]); Art.fs(ctx, PAL.bone, 1.3); }
    // nose
    Art.ellipsePath(ctx, -103, -119, 5.2, 4); Art.fs(ctx, HOUND.nose, Art.LW_THIN);
    dot(ctx, -104.5, -120.5, 1.4, '#ffffff', 0.6);
    // eye under a heavy brow
    eye(ctx, o, -80, -123.5, 5.4, { blink: r.blink, slit: r.slit, rot: -0.3 });
    Art.blobPath(ctx, [[-93, -128], [-80, -134], [-68, -134], [-70, -129], [-82, -128]], 0.8); Art.fs(ctx, HOUND.furShade, Art.LW_THIN);
    // cheek ruff
    Art.polyPath(ctx, [[-52, -116], [-40, -114], [-47, -109], [-38, -103], [-48, -103], [-44, -96], [-56, -103]]); Art.fs(ctx, HOUND.fur, Art.LW_THIN);
    // near ear (torn)
    ctx.save(); pivot(ctx, -56, -132, r.ears * 0.4);
    shapeR(ctx, o, (c) => Art.polyPath(c, [[-64, -132], [-48, -165], [-49, -150], [-43, -153], [-50, -128]]), HOUND.fur, HOUND.furShade, { dx: -2, dy: -2, inner: (c) => {
      Art.polyPath(c, [[-60, -133], [-50, -156], [-52, -134]]); c.fillStyle = '#7a4a62'; c.fill();
    } });
    ctx.restore();
    // howl sound waves from the mouth
    if (r.howl > 0) soundRings(ctx, -100, -112, t, r.howl, 14, 60, 1.25, [-1]);
  }

  function drawBellhound(ctx, pose, o) {
    pose = normPose(pose);
    const t = num(o.t, 0), p = C(num(o.p, 0));
    const r = houndRig(pose, o);
    const cs = Math.cos(r.rot), sn = Math.sin(r.rot);
    const rp = (x, y) => { const dx = x - r.px, dy = y - r.py; return [r.px + dx * cs - dy * sn, r.py + dx * sn + dy * cs + r.cy]; };
    const upper = (c) => { c.translate(0, r.cy); pivot(c, r.px, r.py, r.rot); };
    layered(ctx, r.alpha, (ctx) => {
    ctx.save();
    aura(ctx, o, r.x, -85, 140);
    if (r.bellGlow > 0) Art.glow(ctx, r.x - 60, -60 + r.cy, 150, 'rgba(255,150,60,0.35)', r.bellGlow);
    ctx.translate(r.x, r.y);
    ctx.scale(r.sx, r.sy);

    // --- tail ---
    ctx.save(); upper(ctx);
    const tp = [];
    for (let i = 0; i <= 9; i++) {
      const s = i / 9, w = t * 2 - s * 2.6;
      tp.push([86 + 14 * s + 3 * s * s + Math.sin(w) * 6 * s * r.tailAmp, -102 - 40 * s + 6 * s * s * s + Math.cos(w) * 3 * s * r.tailAmp]);
    }
    const tq = taperPts(tp, 18, 5);
    for (let i = 1; i < tq.length - 1; i += 2) { // shaggy
      const a = tq[i], b = tq[tq.length - 1 - i] || a; a[0] += (a[0] - b[0]) * 0.18; a[1] += (a[1] - b[1]) * 0.18;
    }
    tq.splice(10, 0, [tp[9][0] + 9, tp[9][1] - 8]);
    shapeR(ctx, o, (c) => Art.polyPath(c, tq, true), HOUND.mane, HOUND.maneShade, { dx: -2, dy: -3 });
    ctx.restore();

    // --- far legs ---
    const fS = rp(-14, -92), fH = rp(44, -92);
    shapeR(ctx, o, (c) => taperPath(c, [fH, [(fH[0] + 60) / 2 - 12, (fH[1] - 28) / 2], [60, -28], [52, -8]], [34, 22, 13, 12]), HOUND.furShade, HOUND.maneShade, { dx: -2, dy: -2, noRim: true });
    shapeR(ctx, o, (c) => taperPath(c, [fS, [(fS[0] - 22) / 2 + 9, (fS[1] - 18) / 2], [-22, -18], [-26, -8]], [32, 19, 14, 13]), HOUND.furShade, HOUND.maneShade, { dx: -2, dy: -2, noRim: true });
    drawPaw(ctx, -30, -5, HOUND.furShade, HOUND.maneShade, o);
    drawPaw(ctx, 48, -5, HOUND.furShade, HOUND.maneShade, o);

    // --- torso ---
    ctx.save(); upper(ctx);
    shapeR(ctx, o, (c) => Art.blobPath(c, HOUND_TORSO, 1), HOUND.fur, HOUND.furShade, { dx: -7, dy: -8, inner: (c) => {
      Art.ellipsePath(c, 20, -60, 46, 9); c.fillStyle = HOUND.belly; c.fill();
      for (const [x, y] of [[8, -84], [22, -80], [36, -84], [14, -100], [30, -104]]) { c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 3, y + 6, x + 1, y + 12); Art.strokeOnly(c, 1.6, HOUND.furShade); }
      for (const [x, y] of [[48, -110], [64, -104], [56, -94], [70, -88]]) line(c, [[x, y], [x + 5, y - 2], [x + 9, y - 6]], 1.3, PAL.ink, 0.45);
    } });
    ctx.restore();

    // --- near hind leg (big haunch) ---
    const nH = rp(62, -92), hock = [80, -28];
    const knee = [(nH[0] + hock[0]) / 2 - 14 - r.cy * 0.3, (nH[1] + hock[1]) / 2 + 4];
    shapeR(ctx, o, (c) => taperPath(c, [nH, knee, hock, [70, -7]], [46, 28, 15, 13]), HOUND.fur, HOUND.furShade, { dx: -4, dy: -4, inner: (c) => {
      line(c, [[nH[0] - 8, nH[1] + 10], [nH[0] - 2, nH[1] + 20], [nH[0] + 4, nH[1] + 24]], 1.4, PAL.ink, 0.45);
    } });
    drawPaw(ctx, 66, -5, HOUND.fur, HOUND.furShade, o);

    // --- mane + collar (upper body) ---
    ctx.save(); upper(ctx);
    const mpts = [];
    for (let i = 0, N = 28; i < N; i++) {
      const a = (i / N) * TAU, odd = i % 2;
      const sp = odd ? 1.15 + 0.11 * r.bristle + Art.hash(i + 40) * 0.1 : 0.95;
      const aa = a + (odd ? 0.11 + Math.sin(t * 2.2 + i) * 0.025 : 0);
      mpts.push([-30 + Math.cos(aa) * 38 * sp, -114 + Math.sin(aa) * 33 * sp]);
    }
    shapeR(ctx, o, (c) => Art.polyPath(c, mpts, true), HOUND.mane, HOUND.maneShade, { dx: -5, dy: -6, inner: (c) => {
      for (let i = 0; i < 9; i++) {
        const a = -2.6 + i * 0.55, x = -30 + Math.cos(a) * 24, y = -114 + Math.sin(a) * 21;
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + 0.4) * 8, y + Math.sin(a + 0.4) * 8, x + Math.cos(a + 0.2) * 14, y + Math.sin(a + 0.2) * 14);
        Art.strokeOnly(c, 2, HOUND.maneTip);
      }
    } });
    // collar strap with steel spikes
    const strap = [[-28, -148], [-40, -124], [-56, -96]];
    tube(ctx, strap, 14, HOUND.leather);
    line(ctx, [[-30, -146], [-42, -123], [-57, -100]], 2.2, HOUND.leatherShade, 0.9);
    line(ctx, [[-25, -147], [-36, -125], [-51, -98]], 1.4, '#9a6448', 0.9);
    for (const [x, y, a] of [[-28, -142, 0.1], [-35, -129, 0.35], [-42, -116, 0.55], [-49, -104, 0.75]]) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      shapeR(ctx, o, (c) => Art.polyPath(c, [[0, -4.5], [13, 0], [0, 4.5]]), PAL.steel, PAL.steelShade, { dx: -1, dy: -2, lw: Art.LW_THIN, noRim: true });
      ctx.restore();
      rivet(ctx, x + 1, y, 1.8);
    }
    { // broken leash chain draped over the shoulder, swaying
      const sw = Math.sin(t * 1.9) * 3 * (1 + r.shake) + r.bell * 6;
      const P0 = [-31, -134], P1 = [-10, -118], P2 = [-6 + sw, -88];
      for (let i = 0; i < 8; i++) {
        const u = (i + 0.5) / 8, v = 1 - u;
        const x = v * v * P0[0] + 2 * v * u * P1[0] + u * u * P2[0], y = v * v * P0[1] + 2 * v * u * P1[1] + u * u * P2[1];
        const tx = 2 * v * (P1[0] - P0[0]) + 2 * u * (P2[0] - P1[0]), ty = 2 * v * (P1[1] - P0[1]) + 2 * u * (P2[1] - P1[1]);
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(ty, tx));
        if (i % 2) { Art.roundRectPath(ctx, -4.6, -1.3, 9.2, 2.6, 1.3); Art.fs(ctx, PAL.steelShade, 1.6); }
        else { Art.ellipsePath(ctx, 0, 0, 4.6, 3); Art.strokeOnly(ctx, 4.2); Art.ellipsePath(ctx, 0, 0, 4.6, 3); Art.strokeOnly(ctx, 1.8, PAL.steel); }
        ctx.restore();
      }
    }
    Art.circlePath(ctx, -57, -93, 5); Art.strokeOnly(ctx, 5.4); Art.circlePath(ctx, -57, -93, 5); Art.strokeOnly(ctx, 2.6, PAL.brassLight);
    ctx.restore();

    // --- bell (hangs in world space from the collar ring) ---
    const ring = rp(-57, -89);
    drawBell(ctx, o, r, t, ring[0], ring[1]);

    // --- near foreleg ---
    const nS = rp(-34, -92), wr = [-48, -18];
    const elb = [(nS[0] + wr[0]) / 2 + 10 + r.cy * 0.35, (nS[1] + wr[1]) / 2 + 2];
    const upArm = [L(nS[0], elb[0], 0.45) - 3, L(nS[1], elb[1], 0.45)];
    shapeR(ctx, o, (c) => taperPath(c, [nS, upArm, elb, wr, [-52, -8]], [40, 36, 21, 15, 15]), HOUND.fur, HOUND.furShade, { dx: -4, dy: -4, inner: (c) => {
      c.beginPath(); c.moveTo(upArm[0] - 12, upArm[1] - 10); c.quadraticCurveTo(upArm[0] - 2, upArm[1] + 6, upArm[0] + 10, upArm[1] + 2); Art.strokeOnly(c, 1.6, HOUND.furShade);
      line(c, [[wr[0] + 2, wr[1] - 10], [wr[0] + 4, wr[1] - 2]], 1.3, PAL.ink, 0.45);
    } });
    // elbow feathering
    Art.polyPath(ctx, [[elb[0] + 6, elb[1] - 12], [elb[0] + 17, elb[1] - 2], [elb[0] + 8, elb[1] - 3], [elb[0] + 14, elb[1] + 7], [elb[0] + 4, elb[1] + 3]]);
    Art.fs(ctx, HOUND.fur, Art.LW_THIN);
    drawPaw(ctx, -54, -5, HOUND.fur, HOUND.furShade, o);

    // --- head ---
    ctx.save(); upper(ctx);
    pivot(ctx, -50, -116, r.head);
    drawHoundHead(ctx, o, r, t);
    ctx.restore();
    ctx.restore();
    });
    if (pose === 'die') dieMotes(ctx, p, 0, -60, 170, 80, 30, PAL.candleDeep, 51);
  }

  Art.registerEnemy('bellhound', {
    draw: (ctx, pose, opts) => drawBellhound(ctx, pose, opts || {}),
    info: { height: 165, width: 200, fx: [-16, -82], head: [-34, -170] },
  });

  // ======================================================================
  // MOTH 呪い蛾 — pale hovering moth with skull markings, shedding curse dust
  // ======================================================================
  const MOTH = { wing: '#e9dfcc', wingShade: '#baa98e', wingFar: '#c9bba2', wingFarShade: '#9c8b72', band: '#cbb89a', vein: '#8d7c98',
    skull: '#4c3a6e', body: '#d8cbb2', bodyShade: '#a6957b', fluff: '#f1e8d6', stripe: '#6d5a92', eye: '#e6cbff', eyeGlow: 'rgba(170,120,255,0.6)' };
  const FORE = [[0, 0], [-10, -16], [-30, -34], [-50, -42], [-58, -36], [-55, -24], [-46, -16], [-44, -8], [-34, -4], [-28, 2], [-14, 3]];
  const HIND = [[0, 2], [-16, 4], [-30, 10], [-36, 22], [-30, 33], [-18, 34], [-6, 22]];

  function mothRig(pose, o) {
    const t = num(o.t, 0), p = C(num(o.p, 0));
    const r = { x: 0, h: 62 + Math.sin(t * 2.2) * 5, rot: Math.sin(t * 1.1) * 0.04, flap: Math.sin(t * 8.5), flapAmp: 1, open: 0, spread: 1, dust: 1, glow: 0,
      slit: 0, blink: blinkAt(t, 5), alpha: 1, fold: 0, ant: 0, cast: 0, sx: 1, sy: 1 };
    switch (pose) {
      case 'windup':
        Object.assign(r, { h: 74 + Math.sin(t * 3) * 3, open: 0.5 + Math.sin(t * 16) * 0.05, flapAmp: 0.25, flap: Math.sin(t * 16), dust: 2.2, glow: 0.85 + Math.sin(t * 7) * 0.15, slit: 1, ant: 0.5, x: Math.sin(t * 40) * 0.8, sigil: 1 });
        break;
      case 'attack': {
        const k = lungeK(p), s = strikeK(p), a = anticK(p);
        Object.assign(r, { x: -58 * k, h: 62 + 14 * a - 18 * s, rot: 0.15 * a - 0.42 * s, open: 0.45 * a - 0.55 * s, flapAmp: 0.6, flap: Math.sin(t * 14), dust: 1.5, slit: a });
        break;
      }
      case 'cast': {
        const k = 0.75 + 0.25 * Art.pulse(p, 0.4);
        Object.assign(r, { h: 70, open: 0.18 * k, spread: 1 + 0.2 * k, flapAmp: 0.18, flap: Math.sin(t * 5), dust: 3, glow: k, cast: k, ant: 0.3, sigil: 0.7 * k });
        break;
      }
      case 'stance':
        Object.assign(r, { h: 54 + Math.sin(t * 1.6) * 2, fold: 1, flapAmp: 0.1, dust: 0.5, slit: 1 });
        break;
      case 'hit': {
        const k = recoil(p);
        Object.assign(r, { x: 16 * k, h: 62 + 6 * k, rot: 0.3 * k, open: -0.5 * k, flapAmp: 1 - k * 0.8, dust: 1 + 3 * k, blink: 0.9 * k, ant: -0.6 * k, sx: 1 - 0.08 * k });
        break;
      }
      case 'die': {
        const e = Art.easeIn(p);
        Object.assign(r, { h: L(62, 10, e), x: Math.sin(p * 9) * 10 * (1 - p), rot: 0.6 * Math.sin(p * 5) * p + p * 0.8, open: 0.4 * p, flapAmp: 1 - p, dust: 3 * (1 - p), blink: p > 0.2 ? 1 : 0,
          alpha: dieAlpha(p), sx: 1 - 0.35 * p, sy: 1 - 0.35 * p, fold: 0 });
        break;
      }
    }
    return r;
  }

  // glowing hex circle on the floor (moth windup / cast)
  function curseSigil(ctx, x, y, rx, t, k) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= C(k);
    const ry = rx * 0.26, pulse = 0.75 + 0.25 * Math.sin(t * 5);
    Art.glow(ctx, x, y, rx * 1.3, 'rgba(155,123,214,0.45)', pulse);
    for (const [s, w, a] of [[1, 2.4, 0.85], [0.72, 1.4, 0.6]]) {
      ctx.beginPath(); ctx.ellipse(x, y, rx * s, ry * s, 0, 0, TAU); ctx.lineWidth = w; ctx.strokeStyle = 'rgba(200,170,255,' + (a * pulse).toFixed(3) + ')'; ctx.stroke();
    }
    for (let i = 0; i < 10; i++) { // rune ticks crawling around the ring
      const a = t * 0.8 + (i / 10) * TAU, cx = x + Math.cos(a) * rx * 0.86, cy = y + Math.sin(a) * ry * 0.86;
      line(ctx, [[cx - 2.5, cy - 1.5], [cx, cy + 1.2], [cx + 2.5, cy - 1.5]], 1.4, '#e6d4ff', 0.8 * pulse);
    }
    ctx.restore();
  }

  // one wing (side s = -1 left/near-party, +1 right) in body space; root at (rx, ry)
  function mothWing(ctx, o, r, t, s, hind, far) {
    const pts = hind ? HIND : FORE;
    const flapA = r.flap * r.flapAmp * (hind ? 0.18 : 0.28);
    const ang = (r.open + flapA) * (hind ? 0.7 : 1) - r.fold * (hind ? 0.5 : 1.62);
    const scl = r.spread * (far ? 0.86 : 1) * (1 - r.fold * (hind ? 0.4 : 0.06));
    const fx = 1 - Math.abs(r.flap) * r.flapAmp * 0.12;
    ctx.save();
    ctx.translate(s * (far ? 3 : 4), hind ? -62 : -68);
    ctx.scale(s < 0 ? 1 : -1, 1);
    ctx.rotate(ang);
    ctx.scale(scl * fx, scl);
    const path = (c) => Art.blobPath(c, pts, 1);
    const base = far ? MOTH.wingFar : MOTH.wing, shade = far ? MOTH.wingFarShade : MOTH.wingShade;
    shapeR(ctx, o, path, base, shade, { dx: hind ? -3 : -5, dy: -5, lw: Art.LW / scl, rimW: 6 / scl, inner: (c) => {
      // scalloped edge band
      Art.blobPath(c, pts.map(([x, y]) => [x * 1.0, y * 1.0]), 1); c.lineWidth = 7 / scl; c.strokeStyle = MOTH.band; c.stroke();
      // veins
      c.lineWidth = 1.1 / scl; c.strokeStyle = MOTH.vein; c.lineCap = 'round';
      const veins = hind ? [[-28, 14], [-30, 28], [-16, 30]] : [[-50, -38], [-52, -26], [-42, -10], [-30, -2]];
      for (const [x, y] of veins) { c.beginPath(); c.moveTo(-2, 1); c.quadraticCurveTo(x * 0.5, y * 0.5 + 3, x, y); c.stroke(); }
      if (!hind) {
        // skull marking
        c.save(); c.translate(-30, -20); c.rotate(-0.35);
        const g = r.glow;
        if (g > 0) Art.glow(c, 0, 0, 22, 'rgba(170,120,255,0.8)', g);
        Art.blobPath(c, [[-9, -2], [-7, -10], [0, -12.5], [7, -10], [9, -2], [5, 5], [4.5, 10], [-4.5, 10], [-5, 5]], 1);
        c.fillStyle = g > 0.3 ? '#6a4ea0' : MOTH.skull; c.fill();
        const sock = g > 0.3 ? '#f2e2ff' : base;
        Art.ellipsePath(c, -3.6, -3, 2.7, 3.2, 0.2); c.fillStyle = sock; c.fill();
        Art.ellipsePath(c, 3.6, -3, 2.7, 3.2, -0.2); c.fillStyle = sock; c.fill();
        Art.polyPath(c, [[0, 1.5], [-1.3, 4], [1.3, 4]]); c.fillStyle = sock; c.fill();
        for (const k of [-2.4, 0, 2.4]) line(c, [[k, 6.5], [k, 9.5]], 1.1, sock);
        c.restore();
        // eyespot near tip
        Art.circlePath(c, -50, -34, 3.2); c.fillStyle = MOTH.skull; c.fill();
        dot(c, -50.5, -34.5, 1.3, MOTH.band);
      } else {
        Art.circlePath(c, -22, 20, 5); c.fillStyle = 'rgba(76,58,110,0.55)'; c.fill();
      }
    } });
    ctx.restore();
  }

  function drawMoth(ctx, pose, o) {
    pose = normPose(pose);
    const t = num(o.t, 0), p = C(num(o.p, 0));
    const r = mothRig(pose, o);
    layered(ctx, r.alpha, (ctx) => {
    ctx.save();
    hoverShadow(ctx, r.x, 30 * (1 - (r.h - 50) / 90), 0.8);
    if (r.sigil) curseSigil(ctx, r.x, 0, 44, t, r.sigil);
    aura(ctx, o, r.x, -r.h - 4, 80);
    ctx.translate(r.x, 0);
    ctx.translate(0, -r.h + 62);   // body space: thorax centered at (0,-66) when h=62
    pivot(ctx, 0, -64, r.rot);
    ctx.scale(r.sx, r.sy);
    if (r.glow > 0) Art.glow(ctx, 0, -64, 90, 'rgba(155,123,214,0.45)', r.glow);

    // far wings, then near wings around the body (left = toward the party is near)
    mothWing(ctx, o, r, t, 1, true, true);
    mothWing(ctx, o, r, t, 1, false, true);
    // abdomen
    const ab = Math.sin(t * 2.2 + 1) * 2;
    shapeR(ctx, o, (c) => Art.blobPath(c, [[-6, -60], [6, -60], [10, -48], [7 + ab * 0.3, -34], [2 + ab, -26], [-3 + ab * 0.5, -34], [-8, -48]], 1), MOTH.body, MOTH.bodyShade, { dx: -3, dy: -3, inner: (c) => {
      for (const y of [-52, -45, -38]) { c.beginPath(); c.moveTo(-10, y); c.quadraticCurveTo(0, y + 3.5, 12, y); c.lineWidth = 3; c.strokeStyle = MOTH.stripe; c.stroke(); }
    } });
    mothWing(ctx, o, r, t, -1, true, false);
    mothWing(ctx, o, r, t, -1, false, false);
    // thorax with fluffy ruff
    const ruff = [];
    for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU, k = i % 2 ? 1.18 : 1; ruff.push([Math.cos(a) * 12.5 * k, -66 + Math.sin(a) * 11 * k]); }
    shapeR(ctx, o, (c) => Art.polyPath(c, ruff, true), MOTH.fluff, MOTH.bodyShade, { dx: -3, dy: -3, lw: Art.LW_THIN });
    // head
    shapeR(ctx, o, (c) => Art.blobPath(c, [[-17, -76], [-15, -83], [-7, -86], [1, -83], [3, -76], [-2, -69], [-12, -69]], 1), MOTH.fluff, MOTH.bodyShade, { dx: -2, dy: -2 });
    // feathery antennae
    for (const [bx, s] of [[-11, -1], [-3, 1]]) {
      const pts = [];
      for (let i = 0; i <= 6; i++) { const u = i / 6, a = -Math.PI / 2 + s * (0.35 + u * 0.9) - r.ant * 0.4 * s + Math.sin(t * 2 + u * 2 + s) * 0.06; pts.push([bx + Math.cos(a) * 0 + s * u * u * 20 + (s < 0 ? -u * 6 : u * 2), -82 - Math.sin(u * 1.6) * 26 + u * u * 4]); }
      for (let i = 1; i < pts.length; i++) {
        const [x, y] = pts[i], bl = 4.6 * (1 - i / 9);
        line(ctx, [[x - bl, y - bl * 0.6], [x, y], [x + bl, y - bl * 0.6]], 3, PAL.ink);
        line(ctx, [[x - bl, y - bl * 0.6], [x, y], [x + bl, y - bl * 0.6]], 1.2, MOTH.band);
      }
      line(ctx, pts, 3.4, PAL.ink);
      line(ctx, pts, 1.4, MOTH.fluff);
    }
    // compound eyes
    eye(ctx, o, -12.5, -76, 3.6, { blink: r.blink, slit: r.slit, rot: 0.3, color: MOTH.eye, glowColor: MOTH.eyeGlow });
    eye(ctx, o, -3, -77.5, 3.2, { blink: r.blink, slit: r.slit, rot: -0.3, color: MOTH.eye, glowColor: MOTH.eyeGlow });
    // tiny legs dangling
    for (const [x, d] of [[-8, 0], [-2, 1], [4, 2]]) line(ctx, [[x, -58], [x - 3, -52 + d], [x - 1 + Math.sin(t * 3 + x) * 1.2, -47 + d]], 1.6, PAL.ink);
    ctx.restore();
    });

    // curse dust falling from the wings (world space)
    const cx = r.x, cy = -r.h - 2;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const nd = Math.round(8 * r.dust);
    for (let i = 0; i < nd; i++) {
      const sp = 0.35 + Art.hash(i + 60) * 0.35, ph = frac(t * sp + Art.hash(i + 61));
      const side = i % 2 ? 1 : -1, x = cx + side * (12 + Art.hash(i + 62) * 40) + Math.sin(t * 2 + i) * 4, y = cy - 10 + ph * (r.h + 4);
      const a = Math.sin(ph * Math.PI) * 0.85 * r.alpha;
      dot(ctx, x, y, 3.2, 'rgba(155,123,214,0.35)', a);
      dot(ctx, x, y, 1.2, '#e2d2ff', a);
    }
    // cast: motes bursting outward from the spread wings
    if (r.cast > 0) {
      for (let i = 0; i < 16; i++) {
        const ph = frac(t * 0.9 + i / 16), a = (i / 16) * TAU + t * 0.4, d = 20 + ph * 70;
        const x = cx + Math.cos(a) * d * 1.2, y = cy + Math.sin(a) * d * 0.7;
        const al = Math.sin(ph * Math.PI) * r.cast;
        dot(ctx, x, y, 4.5 * (1 - ph * 0.5), 'rgba(155,123,214,0.4)', al);
        dot(ctx, x, y, 1.8, '#f0e4ff', al);
      }
    }
    ctx.restore();
    if (pose === 'die') dieMotes(ctx, p, r.x, -r.h + 4, 90, 40, 26, PAL.curse, 71);
  }

  Art.registerEnemy('moth', {
    draw: (ctx, pose, opts) => drawMoth(ctx, pose, opts || {}),
    info: { height: 110, width: 116, fx: [-4, -66], head: [-6, -114] },
  });

  // ======================================================================
  // WISP 吸い火 — hungry blue-green will-o-wisp that drains sparks
  // ======================================================================
  const WISP = { base: '#58dcc5', shade: '#2b9c9b', core: '#c4fff0', hot: '#f4fffb', hole: '#0a1822', glow: 'rgba(80,240,210,0.55)', deep: '#1d6f78', pupil: '#eafff8' };

  // closed smooth path through pts, with sharp corners at the indices in `sharp`
  function sharpBlob(c, pts, sharp) {
    const n = pts.length;
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      let c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      let c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      if (sharp[i]) { c1x = L(p1[0], p2[0], 0.3); c1y = L(p1[1], p2[1], 0.3); }
      if (sharp[(i + 1) % n]) { c2x = L(p2[0], p1[0], 0.3); c2y = L(p2[1], p1[1], 0.3); }
      c.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
    }
    c.closePath();
  }

  function wispRig(pose, o) {
    const t = num(o.t, 0), p = C(num(o.p, 0));
    const r = { x: 0, h: Math.sin(t * 1.9) * 5, lean: Math.sin(t * 1.3) * 0.15, sx: 1 + Math.sin(t * 3.1) * 0.025, sy: 1 - Math.sin(t * 3.1) * 0.025, open: 0.3 + Math.sin(t * 2.3) * 0.12,
      slit: 0, blink: blinkAt(t, 6), glow: 0, vortex: 0, flick: 1, alpha: 1, ring: 0, smoke: 0 };
    switch (pose) {
      case 'windup':
        Object.assign(r, { x: Math.sin(t * 43) * 1, h: -6, sx: 0.92, sy: 1.24 + Math.sin(t * 9) * 0.03, open: 0.75 + Math.sin(t * 10) * 0.08, slit: 1, glow: 1, flick: 2.2, lean: Math.sin(t * 7) * 0.2 });
        break;
      case 'attack': {
        const k = lungeK(p), s = strikeK(p), a = anticK(p);
        Object.assign(r, { x: -58 * k, h: 6 * a - 4 * s, lean: 0.25 * a + 0.75 * s * (k > 0 ? 1 : 0), sx: 1 - 0.08 * a + 0.16 * s, sy: 1 + 0.1 * a - 0.12 * s,
          open: p < 0.4 ? 0.4 + 1.0 * C(p / 0.36) : 0.25 + 0.5 * (1 - C((p - 0.4) / 0.25)), slit: a, flick: 1.6, glow: 0.4 * s });
        break;
      }
      case 'cast': {
        const k = 0.75 + 0.25 * Art.pulse(p, 0.4);
        Object.assign(r, { x: 4, lean: -0.12 + Math.sin(t * 6) * 0.05, sx: 1.06, sy: 1.02, open: 1.35 * k + Math.sin(t * 8) * 0.06, glow: 0.8 * k, vortex: k, slit: 0.6, flick: 1.4 });
        break;
      }
      case 'stance':
        Object.assign(r, { h: 4 + Math.sin(t * 1.9) * 2, sx: 0.96, sy: 0.84, open: 0.04, slit: 1, glow: 0.7, ring: 1, flick: 0.6, lean: 0 });
        break;
      case 'hit': {
        const k = recoil(p);
        Object.assign(r, { x: 15 * k, lean: 0.6 * k, sx: 1 + 0.15 * k, sy: 1 - 0.18 * k, open: 0.3 + 0.6 * k, blink: 0.9 * k, flick: 1 + 3 * k });
        break;
      }
      case 'die': {
        const e = Art.easeIn(C(p / 0.8));
        Object.assign(r, { h: 12 * e, sx: L(1, 0.5, e), sy: L(1, 0.12, e), open: 0.3 * (1 - e), blink: Math.min(1, p * 2), flick: 1 + 2 * e, alpha: dieAlpha(p), smoke: p, lean: 0.4 * e });
        break;
      }
    }
    return r;
  }

  function wispPts(r, t) {
    const f = r.flick, ln = r.lean * 22;
    const fl = (i, ax, ay) => [Math.sin(t * (9 + i) + i * 2.1) * ax * f, Math.sin(t * (11 + i * 0.7) + i) * ay * f];
    const P = [
      [-23, -46], [-25, -62], [-19, -76], [-24 + ln * 0.7, -91], [-9, -82], [3 + ln, -106], [12, -86], [26 + ln * 0.8, -92], [23, -72],
      [25, -55], [19, -40], [30, -28], [11, -31], [-2, -29], [-16, -33]];
    const tipW = { 3: [2, 3], 5: [2.5, 4], 7: [2, 3], 11: [2.5, 2] };
    return P.map(([x, y], i) => { const w = tipW[i]; if (!w) return [x, y]; const d = fl(i, w[0], w[1]); return [x + d[0], y + d[1]]; });
  }
  const WISP_SHARP = { 3: 1, 5: 1, 7: 1, 11: 1 };

  function drawWisp(ctx, pose, o) {
    pose = normPose(pose);
    const t = num(o.t, 0), p = C(num(o.p, 0));
    const r = wispRig(pose, o);
    layered(ctx, r.alpha, (ctx) => {
    ctx.save();
    hoverShadow(ctx, r.x, 26 - r.h * 0.4, 0.7);
    Art.glow(ctx, r.x, 0, 46, 'rgba(80,240,210,0.25)', 0.9);         // light pooled on the floor
    aura(ctx, o, r.x, -62, 82);
    ctx.translate(r.x, r.h);
    Art.glow(ctx, 0, -62, 70 + 30 * r.glow, WISP.glow, 0.55 + 0.45 * r.glow);
    // orbiting flamelets (behind)
    const orb = (front) => {
      for (let i = 0; i < 3; i++) {
        const a = t * 1.6 + i * TAU / 3, z = Math.sin(a);
        if ((z >= 0) !== front) continue;
        const ox = Math.cos(a) * 38, oy = -60 + Math.sin(a) * 9 - 4;
        Art.flame(ctx, ox, oy, 7.5 + z * 1.8, t + i, { seed: i * 3 + 1, outer: WISP.base, inner: WISP.hot, glowColor: 'rgba(80,240,210,0.6)' });
      }
    };
    if (r.smoke < 0.5) orb(false);
    ctx.save();
    ctx.translate(0, -30);
    ctx.scale(r.sx, r.sy);
    ctx.translate(0, 30);
    const pts = wispPts(r, t);
    const body = (c) => sharpBlob(c, pts, WISP_SHARP);
    shapeR(ctx, o, body, WISP.base, WISP.shade, { dx: -6, dy: -6, inner: (c) => {
      // inner core flame
      const ln = r.lean * 14, fk = Math.sin(t * 10.3) * 3 * r.flick;
      sharpBlob(c, [[-15, -37], [-16, -52], [-9, -68], [-1 + ln, -88 + fk], [6, -70], [13, -54], [11, -38], [-1, -32]], { 3: 1 });
      c.fillStyle = WISP.core; c.fill();
      Art.ellipsePath(c, -3, -46, 11, 8); c.fillStyle = WISP.hot; c.fill();
      // deep-water ripple bands
      c.beginPath(); c.moveTo(-26, -40); c.quadraticCurveTo(0, -30, 26, -42); c.lineWidth = 3; c.strokeStyle = 'rgba(29,111,120,0.5)'; c.stroke();
    } });
    ctx.restore();

    // --- face ---
    ctx.save();
    ctx.translate(0, -30); ctx.scale(Math.sqrt(r.sx), Math.sqrt(r.sy)); ctx.translate(0, 30);
    // eye-holes (angry, flat-topped)
    const hole = (x, y, w, h, tilt) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
      ctx.beginPath(); ctx.moveTo(-w, -h * 0.35); ctx.lineTo(w, -h * 0.7); ctx.quadraticCurveTo(w * 1.1, h, 0, h); ctx.quadraticCurveTo(-w * 1.1, h, -w, -h * 0.35); ctx.closePath();
      Art.fs(ctx, WISP.hole, Art.LW_THIN);
      ctx.restore();
    };
    hole(-13, -62, 5.6, 6.5, 0.12);
    hole(4, -64, 5, 6, -0.12);
    eye(ctx, o, -13, -60, 2.3, { blink: r.blink, slit: r.slit, color: WISP.pupil, glowColor: 'rgba(120,255,230,0.7)' });
    eye(ctx, o, 4, -62, 2.1, { blink: r.blink, slit: r.slit, color: WISP.pupil, glowColor: 'rgba(120,255,230,0.7)' });
    // hungry jagged mouth
    const mo = r.open, mx = -5, my = -46, mw = 15 + mo * 3, mh = 3 + mo * 12;
    const mouthPts = [];
    const nT = 6;
    for (let i = 0; i <= nT; i++) { const u = i / nT; mouthPts.push([mx - mw + u * 2 * mw, my - 3 + Math.sin(u * Math.PI) * -2 + (i % 2 ? 4 + mo * 2 : 0)]); }
    for (let i = nT; i >= 0; i--) { const u = i / nT; mouthPts.push([mx - mw + u * 2 * mw, my - 1 + Math.sin(u * Math.PI) * mh + (i % 2 ? -3 - mo * 2 : 0) * (mo > 0.2 ? 1 : 0.3)]); }
    Art.polyPath(ctx, mouthPts, true); Art.fs(ctx, WISP.hole, Art.LW_THIN);
    if (r.vortex > 0) { // throat glow while draining
      ctx.save(); Art.polyPath(ctx, mouthPts, true); ctx.clip();
      Art.glow(ctx, mx, my + mh * 0.4, mh * 1.4, 'rgba(255,150,70,0.85)', r.vortex);
      ctx.restore();
    }
    ctx.restore();

    if (r.smoke < 0.5) orb(true);
    // stance: ring of cold fire
    if (r.ring > 0) {
      for (let i = 0; i < 8; i++) {
        const a = t * 1.2 + i * TAU / 8, z = Math.sin(a);
        const ox = Math.cos(a) * 44, oy = -52 + z * 10;
        Art.flame(ctx, ox, oy, 5 + z * 1.2, t + i * 0.3, { seed: i, outer: '#3fb8d8', inner: '#e0fbff', glowColor: 'rgba(111,211,255,0.45)', glow: i % 2 === 0 });
      }
      ctx.beginPath(); ctx.ellipse(0, -52, 44, 10, 0, 0, TAU); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(160,240,255,0.45)'; ctx.stroke();
    }
    // die: guttering smoke
    if (r.smoke > 0.3) {
      const k = C((r.smoke - 0.3) / 0.7), a = Math.sin(k * Math.PI) * 0.7;
      for (let i = 0; i < 3; i++) line(ctx, [[i * 6 - 6, -32], [i * 6 - 2 + Math.sin(t * 3 + i) * 4, -46 - k * 20], [i * 6 - 8, -60 - k * 34]], 3, 'rgba(150,190,190,1)', a * (1 - i * 0.2));
    }
    ctx.restore();

    // drain vortex: spiral arms + stolen ember sparks flowing into the mouth
    if (r.vortex > 0) {
      const vx = r.x - 5, vy = r.h - 42;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (let arm = 0; arm < 4; arm++) {
        let px = 0, py = 0;
        for (let j = 0; j <= 22; j++) {
          const u = j / 22, rad = 5 + u * 46, a = arm * TAU / 4 - t * 5 + u * 3.4;
          const x = vx + Math.cos(a) * rad - u * 22, y = vy + Math.sin(a) * rad * 0.5;
          if (j > 0) {
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y);
            ctx.lineWidth = 3.2 * (1 - u * 0.7); ctx.strokeStyle = 'rgba(150,255,230,' + (0.6 * (1 - u) * r.vortex).toFixed(3) + ')'; ctx.stroke();
          }
          px = x; py = y;
        }
      }
      for (let i = 0; i < 12; i++) {
        const ph = frac(t * 0.8 + i / 12), d = (1 - ph) * 96, a = i * 2.4 + ph * 5;
        const x = vx - d * 0.9 + Math.cos(a) * d * 0.3, y = vy + Math.sin(a) * d * 0.35;
        const al = Math.sin(Math.min(1, ph * 1.3) * Math.PI) * r.vortex;
        dot(ctx, x, y, 4.5 * (1 - ph * 0.6), 'rgba(255,140,60,0.45)', al);
        dot(ctx, x, y, 1.7, '#ffe1a0', al);
      }
      ctx.restore();
    }
    ctx.restore();
    });
    if (pose === 'die') dieMotes(ctx, p, r.x, -52, 60, 40, 20, '#7ff5dc', 83);
  }

  Art.registerEnemy('wisp', {
    draw: (ctx, pose, opts) => drawWisp(ctx, pose, opts || {}),
    info: { height: 104, width: 92, fx: [-4, -58], head: [2, -108] },
  });
})();
