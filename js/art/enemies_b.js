/* EMBERWHEEL — enemies_b.js : big enemies + boss (Candlelit Paper Theater style).
 * Registers: sentry 骸骨衛兵 (variant 'deep'), abbot 骨の修道院長 (elite), golem 歯車ゴーレム,
 *            shade 影の写し身, mimic ミミック, ashlord 灰輪の主 (boss).
 * Contract (ARCH.md "Enemies"): draw(ctx, pose, opts) with origin = feet center, facing LEFT.
 * Poses: idle · windup · attack(p) · cast · stance · hit(p) · die(p). Unknown pose -> idle.
 * windup / stance / cast are held poses: they are fully posed at any p and loop on opts.t.
 */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  const Art = SD.Art;
  if (!Art || !Art.registerEnemy) return;
  const PAL = Art.PAL, LW = Art.LW, LWT = Art.LW_THIN;
  const TAU = Math.PI * 2;
  const POSES = { idle: 1, windup: 1, attack: 1, cast: 1, stance: 1, hit: 1, die: 1 };

  // ---------------------------------------------------------------- small utils
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = Art.lerp, ease = Art.easeInOut, eOut = Art.easeOut, eIn = Art.easeIn;
  const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1); // remap p in [a,b] -> 0..1
  const wave = (t, period, ph) => Math.sin(((t / period) + (ph || 0)) * TAU);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  const RED_EYE = { color: '#ff5348', glowColor: 'rgba(255,40,40,0.65)' };

  // Normalised pose state.
  function st(pose, opts) {
    opts = opts || {};
    const P = POSES[pose] ? pose : 'idle';
    const s = { pose: P, t: num(opts.t, 0), p: clamp(num(opts.p, 0), 0, 1), opts, en: !!opts.enraged };
    // attack phases: wind (anticipation) -> strike -> recover
    const p = s.p;
    s.wind = P === 'attack' ? (p < 0.28 ? eOut(p / 0.28) : p < 0.46 ? 1 - eIn((p - 0.28) / 0.18) : 0) : 0;
    s.strike = P === 'attack' ? (p < 0.28 ? 0 : p < 0.46 ? eIn((p - 0.28) / 0.18) : 1 - ease((p - 0.46) / 0.54)) : 0;
    s.hitK = P === 'hit' ? Art.pulse(p, 0.12) : 0;
    return s;
  }

  // Whole-body puppet motion for one-shot poses. k: {back, lunge, recoil, lean}
  function motion(ctx, s, k) {
    k = k || {};
    const p = s.p;
    let dx = 0, dy = 0, rot = 0, sx = 1, sy = 1;
    if (s.pose === 'attack') {
      const back = num(k.back, 10), lunge = num(k.lunge, 46), lean = num(k.lean, 0.1);
      if (p < 0.28) { const q = eOut(p / 0.28); dx = back * q; rot = lean * 0.6 * q; sx = 1 + 0.05 * q; sy = 1 - 0.05 * q; }
      else if (p < 0.46) { const q = eIn((p - 0.28) / 0.18); dx = lerp(back, -lunge, q); rot = lerp(lean * 0.6, -lean, q); sx = lerp(1.05, 0.95, q); sy = lerp(0.95, 1.06, q); }
      else { const q = ease((p - 0.46) / 0.54); const ov = Math.sin(q * Math.PI) * 0.03; dx = lerp(-lunge, 0, q); rot = lerp(-lean, 0, q); sx = 1 - ov; sy = 1 + ov; }
    } else if (s.pose === 'hit') {
      const q = s.hitK, rc = num(k.recoil, 16);
      dx = rc * q + Math.sin(p * 55) * 3 * (1 - p) * (p < 0.6 ? 1 : 0);
      rot = 0.09 * q * num(k.lean, 1);
      sx = 1 - 0.06 * q; sy = 1 + 0.03 * q;
    }
    ctx.translate(dx, dy); ctx.rotate(rot); ctx.scale(sx, sy);
  }

  // Fade a whole figure as ONE layer (no overlap seams). Browser only; falls back to globalAlpha.
  let _layer = null;
  function fadeLayer(ctx, alpha, fn) {
    alpha = clamp(alpha, 0, 1);
    if (alpha >= 0.999) { fn(ctx); return; }
    if (alpha <= 0.002) return;
    const can = typeof document !== 'undefined' && ctx && ctx.canvas && ctx.canvas.width > 0 &&
      typeof ctx.getTransform === 'function' && typeof ctx.drawImage === 'function';
    if (can) {
      try {
        const W = ctx.canvas.width, H = ctx.canvas.height;
        if (!_layer) _layer = document.createElement('canvas');
        if (_layer.width !== W || _layer.height !== H) { _layer.width = W; _layer.height = H; }
        const lc = _layer.getContext('2d');
        lc.setTransform(1, 0, 0, 1, 0, 0);
        lc.clearRect(0, 0, W, H);
        lc.setTransform(ctx.getTransform());
        lc.globalAlpha = 1; lc.globalCompositeOperation = 'source-over';
        lc.save(); fn(lc); lc.restore();
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha *= alpha;
        ctx.drawImage(_layer, 0, 0);
        ctx.restore();
        return;
      } catch (e) { /* fall through */ }
    }
    ctx.save(); ctx.globalAlpha *= alpha; fn(ctx); ctx.restore();
  }

  // Dread aura behind the body.
  function dreadAura(ctx, s, x, y, r) {
    if (!s.en) return;
    const k = 0.75 + 0.25 * wave(s.t, 1.3);
    Art.glow(ctx, x, y, r * (1 + 0.06 * wave(s.t, 0.9)), 'rgba(255,40,50,0.38)', k);
    Art.glow(ctx, x, y + r * 0.45, r * 0.7, 'rgba(160,10,30,0.35)', k);
  }
  function eyeOpts(s, base) { return s.en ? Object.assign({}, base, RED_EYE) : base; }

  // ---------------------------------------------------------------- drawing helpers
  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  function at(ctx, x, y, a, fn) { ctx.save(); ctx.translate(x, y); if (a) ctx.rotate(a); fn(ctx); ctx.restore(); }

  // Outlined bone with knobby ends + a shade line on the lower-right side.
  function bone(ctx, x1, y1, x2, y2, w, col, sh) {
    col = col || PAL.bone; sh = sh || PAL.boneShade;
    const k = w * 0.62, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L, ny = dx / L; if (nx + ny < 0) { nx = -nx; ny = -ny; }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = w + LW * 2; line(ctx, x1, y1, x2, y2); ctx.stroke();
    ctx.fillStyle = PAL.ink;
    Art.circlePath(ctx, x1, y1, k + LW); ctx.fill(); Art.circlePath(ctx, x2, y2, k + LW); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = w; line(ctx, x1, y1, x2, y2); ctx.stroke();
    ctx.fillStyle = col;
    Art.circlePath(ctx, x1, y1, k); ctx.fill(); Art.circlePath(ctx, x2, y2, k); ctx.fill();
    ctx.strokeStyle = sh; ctx.lineWidth = Math.max(1.2, w * 0.32);
    const o = w * 0.26;
    line(ctx, x1 + nx * o + dx * 0.12, y1 + ny * o + dy * 0.12, x2 + nx * o - dx * 0.12, y2 + ny * o - dy * 0.12); ctx.stroke();
    ctx.restore();
  }

  // Two-segment IK: returns elbow/knee point. bend = +1 / -1 picks the side.
  function ik(sx, sy, hx, hy, l1, l2, bend) {
    const dx = hx - sx, dy = hy - sy, d = Math.max(0.001, Math.hypot(dx, dy));
    const dd = Math.min(d, l1 + l2 - 0.01);
    const base = Math.atan2(dy, dx);
    const a = Math.acos(clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1));
    const ang = base + (bend || 1) * a;
    return [sx + Math.cos(ang) * l1, sy + Math.sin(ang) * l1];
  }

  // Ink-outlined thick stroke (pipes, tentacles, chain bars)
  function tube(ctx, pathFn, w, col, sh) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    pathFn(ctx); ctx.strokeStyle = PAL.ink; ctx.lineWidth = w + LW * 2; ctx.stroke();
    pathFn(ctx); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
    if (sh) { ctx.translate(w * 0.18, w * 0.2); pathFn(ctx); ctx.strokeStyle = sh; ctx.lineWidth = w * 0.3; ctx.stroke(); }
    ctx.restore();
  }

  function rivet(ctx, x, y, r, col) {
    Art.circlePath(ctx, x, y, r); ctx.fillStyle = PAL.ink; ctx.fill();
    Art.circlePath(ctx, x - r * 0.25, y - r * 0.25, r * 0.55); ctx.fillStyle = col || PAL.steel; ctx.fill();
  }

  // Sagging chain from (x1,y1) to (x2,y2). Alternating face-on rings and edge-on bars.
  function chain(ctx, x1, y1, x2, y2, sag, link, col, sh) {
    col = col || '#8a8296'; sh = sh || '#4d4658';
    const pts = [];
    const N = 24;
    for (let i = 0; i <= N; i++) { const u = i / N; pts.push([lerp(x1, x2, u), lerp(y1, y2, u) + sag * 4 * u * (1 - u)]); }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    let j = 0, idx = 0;
    ctx.save(); ctx.lineCap = 'round';
    for (let d = link * 0.5; d < total; d += link * 0.82, idx++) {
      while (j < cum.length - 2 && cum[j + 1] < d) j++;
      const u = (d - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      const x = lerp(pts[j][0], pts[j + 1][0], u), y = lerp(pts[j][1], pts[j + 1][1], u);
      const a = Math.atan2(pts[j + 1][1] - pts[j][1], pts[j + 1][0] - pts[j][0]);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      if (idx % 2 === 0) {
        Art.ellipsePath(ctx, 0, 0, link * 0.62, link * 0.36);
        ctx.strokeStyle = PAL.ink; ctx.lineWidth = link * 0.36 + 2.4; ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = link * 0.26; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(0, 0, link * 0.62, link * 0.36, 0, 0.2, Math.PI - 0.2);
        ctx.strokeStyle = sh; ctx.lineWidth = link * 0.12; ctx.stroke();
      } else {
        line(ctx, -link * 0.6, 0, link * 0.6, 0);
        ctx.strokeStyle = PAL.ink; ctx.lineWidth = link * 0.34 + 2.4; ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = link * 0.3; ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // Rising particles (embers / ash / sparks). deterministic from t.
  function particles(ctx, s, n, x, y, w, h, opts) {
    opts = opts || {};
    const sp = opts.speed || 0.5, seed = opts.seed || 1, size = opts.size || 2.2;
    ctx.save();
    if (opts.add !== false) ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const r1 = Art.hash(seed * 31 + i * 7.13), r2 = Art.hash(seed * 17 + i * 3.71), r3 = Art.hash(seed + i * 11.3);
      const ph = (s.t * sp * (0.6 + r2 * 0.8) + r1) % 1;
      const px = x + (r2 - 0.5) * w + Math.sin(s.t * 2 + i) * (opts.drift == null ? 6 : opts.drift) * ph;
      const py = y - ph * h * (opts.dir || 1);
      const a = Math.sin(ph * Math.PI) * (opts.alpha || 1);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = r3 < 0.5 ? (opts.c1 || PAL.flameHot) : (opts.c2 || PAL.ember);
      const z = size * (0.6 + r3 * 0.8) * (opts.shrink ? 1 - ph * 0.6 : 1);
      ctx.beginPath(); ctx.moveTo(px, py - z * 1.4); ctx.lineTo(px + z, py); ctx.lineTo(px, py + z * 1.4); ctx.lineTo(px - z, py); ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Flat paper-cut steam puff cluster.
  function puff(ctx, x, y, r, a, col) {
    if (a <= 0.01 || r <= 0.5) return;
    ctx.save();
    ctx.globalAlpha *= clamp(a, 0, 1);
    const lobes = [[0, 0, 1], [-0.75, 0.2, 0.7], [0.75, 0.25, 0.72], [-0.2, -0.6, 0.66], [0.4, -0.45, 0.55]];
    ctx.fillStyle = 'rgba(26,18,34,0.55)';
    for (const l of lobes) { Art.circlePath(ctx, x + l[0] * r, y + l[1] * r, l[2] * r + 1.6); ctx.fill(); }
    ctx.fillStyle = col || '#d9d3e6';
    for (const l of lobes) { Art.circlePath(ctx, x + l[0] * r, y + l[1] * r, l[2] * r); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    Art.circlePath(ctx, x - r * 0.35, y - r * 0.35, r * 0.35); ctx.fill();
    ctx.restore();
  }

  // Procedural rune glyph (3 strokes) seeded by i.
  function glyph(ctx, x, y, sz, i) {
    ctx.beginPath();
    const h = (k) => Art.hash(i * 13.7 + k * 5.1);
    ctx.moveTo(x + (h(1) - 0.5) * sz, y - sz * 0.6); ctx.lineTo(x + (h(2) - 0.5) * sz, y + sz * 0.6);
    ctx.moveTo(x - sz * 0.45, y + (h(3) - 0.5) * sz); ctx.lineTo(x + sz * 0.45, y + (h(4) - 0.5) * sz * 0.8);
    if (h(5) > 0.4) { ctx.moveTo(x + (h(6) - 0.5) * sz, y - sz * 0.2); ctx.lineTo(x + (h(7) - 0.5) * sz * 1.2, y + sz * 0.3); }
  }

  // Floating rune circle (cast). col = line colour, r radius, spin angle.
  function runeCircle(ctx, x, y, r, t, col, alpha, sq) {
    if (alpha <= 0.01) return;
    sq = sq || 1;
    Art.glow(ctx, x, y, r * 1.5, col.glow || 'rgba(155,123,214,0.5)', alpha);
    ctx.save();
    ctx.translate(x, y); ctx.scale(1, sq);
    ctx.globalAlpha *= alpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = col.line; ctx.lineWidth = 2.2;
    Art.circlePath(ctx, 0, 0, r); ctx.stroke();
    ctx.lineWidth = 1.4; Art.circlePath(ctx, 0, 0, r * 0.78); ctx.stroke();
    ctx.save(); ctx.rotate(t * 0.9);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      ctx.save(); ctx.rotate(a); ctx.translate(0, -r * 0.89);
      glyph(ctx, 0, 0, r * 0.11, i); ctx.lineWidth = 1.6; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    ctx.save(); ctx.rotate(-t * 0.6);
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) { const a = (i * 2 / 5) * TAU - Math.PI / 2; const px = Math.cos(a) * r * 0.74, py = Math.sin(a) * r * 0.74; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = col.line;
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU - Math.PI / 2; Art.circlePath(ctx, Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78, 2.4); ctx.fill(); }
    ctx.restore();
    ctx.restore();
  }

  // Jagged glowing crack polyline.
  function crack(ctx, pts, col, w, glowA) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    Art.polyPath(ctx, pts, false);
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = w + 1.6; ctx.stroke();
    if (col) {
      if (glowA) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= glowA; ctx.strokeStyle = col; ctx.lineWidth = w * 3.2; Art.polyPath(ctx, pts, false); ctx.stroke(); ctx.restore(); }
      Art.polyPath(ctx, pts, false); ctx.strokeStyle = col; ctx.lineWidth = w * 0.55; ctx.stroke();
    }
    ctx.restore();
  }

  // Slash swoosh crescent for attacks (light colors, additive).
  function swoosh(ctx, x, y, r, a0, a1, w, col, alpha) {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= alpha;
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a1, a1 < a0);
    ctx.arc(x, y, r - w, a1, a0, a1 >= a0);
    ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.restore();
  }

  function blinkAt(t, period, seed) { const u = (t + (seed || 0)) % period; return u < 0.16 ? Math.sin((u / 0.16) * Math.PI) : 0; }

  // ================================================================ SENTRY 骸骨衛兵
  const SENTRY_COL = {
    normal: {
      bone: PAL.bone, boneSh: PAL.boneShade, iron: '#8f97b3', ironSh: '#5c6482', ironHi: '#c9d2e6',
      cloth: '#2f6466', clothSh: '#1f4346', wood: '#7b5234', woodSh: '#563620', emblem: '#a9dccf',
      leather: '#5a3a2a', eye: { color: '#a8f6ff', glowColor: 'rgba(110,230,255,0.55)' }, edge: '#ffd27a', edgeGlow: 'rgba(255,190,90,0.7)',
    },
    deep: {
      bone: '#6f6472', boneSh: '#473d4a', iron: '#9a4630', ironSh: '#62271b', ironHi: '#d47b52',
      cloth: '#3d1c26', clothSh: '#26101a', wood: '#4a2c25', woodSh: '#2f1915', emblem: '#c2453a',
      leather: '#3a2420', eye: RED_EYE, edge: '#ff6a3a', edgeGlow: 'rgba(255,70,40,0.75)',
    },
  };

  function sentryHalberd(ctx, C, hot, t) {
    // shaft
    tube(ctx, (c) => line(c, 0, 64, 0, -70), 5, C.wood, C.woodSh);
    // grip wraps
    ctx.save(); ctx.strokeStyle = C.leather; ctx.lineWidth = 2;
    for (let y = -6; y <= 8; y += 4) { line(ctx, -3, y, 3, y - 2); ctx.stroke(); }
    ctx.restore();
    // butt spike
    Art.polyPath(ctx, [[-3.5, 62], [3.5, 62], [0, 74]]); Art.fs(ctx, C.iron, LWT);
    // tattered pennant ribbon swaying from the socket (secondary motion)
    const sw = Math.sin(t * 2.3) * 4, sw2 = Math.sin(t * 2.3 - 1) * 6;
    Art.polyPath(ctx, [[3, -66], [14 + sw * 0.5, -62], [22 + sw, -54 + sw * 0.2], [18 + sw2, -44], [24 + sw2, -36], [12 + sw, -42], [4, -56]]);
    Art.fs(ctx, C.cloth, LWT);
    // back hook
    Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(3, -78); c.quadraticCurveTo(14, -78, 22, -92); c.quadraticCurveTo(14, -84, 3, -88); c.closePath(); }, C.iron, C.ironSh, { lw: LWT + 0.5 });
    // top spike
    Art.shape(ctx, (c) => Art.polyPath(c, [[-3.5, -90], [0, -124], [3.5, -90]]), C.ironHi, C.iron, { lw: LWT + 0.5 });
    // axe blade (front side)
    const blade = (c) => { c.beginPath(); c.moveTo(-3, -72); c.quadraticCurveTo(-15, -68, -26, -58); c.quadraticCurveTo(-38, -82, -28, -106); c.quadraticCurveTo(-16, -96, -3, -92); c.closePath(); };
    Art.shape(ctx, blade, C.ironHi, C.iron, { lw: LW, hi: { x: -18, y: -92, rx: 6, ry: 3, rot: -0.6 } });
    // bevel line + hole + nick
    ctx.beginPath(); ctx.moveTo(-22, -62); ctx.quadraticCurveTo(-31, -82, -24, -100); Art.strokeOnly(ctx, 1.5, C.ironSh);
    Art.circlePath(ctx, -13, -82, 2.6); ctx.fillStyle = PAL.ink; ctx.fill();
    Art.polyPath(ctx, [[-33.5, -80], [-30, -78], [-33, -75]], false); Art.strokeOnly(ctx, 1.6);
    // glowing edge (windup)
    if (hot > 0) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(-26, -58); ctx.quadraticCurveTo(-38, -82, -28, -106);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= hot; ctx.lineCap = 'round';
      ctx.strokeStyle = C.edgeGlow; ctx.lineWidth = 9; ctx.stroke();
      ctx.strokeStyle = C.edge; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.restore();
      Art.glow(ctx, -32, -82, 40, C.edgeGlow, hot * (0.7 + 0.3 * Math.sin(t * 9)));
    }
    // socket langet
    Art.roundRectPath(ctx, -4.5, -80, 9, 16, 2); Art.fs(ctx, C.iron, LWT);
    rivet(ctx, 0, -76, 1.6, C.ironHi); rivet(ctx, 0, -68, 1.6, C.ironHi);
  }

  function sentryShield(ctx, C, deep, t, glowK) {
    if (glowK > 0) Art.glow(ctx, 0, 0, 70, deep ? 'rgba(255,90,60,0.35)' : 'rgba(111,211,255,0.35)', glowK * (0.75 + 0.25 * Math.sin(t * 4)));
    // thickness edge (right side, away from light)
    const outer = (c) => { c.beginPath(); c.moveTo(-23, -44); c.quadraticCurveTo(0, -56, 23, -44); c.lineTo(23, 40); c.quadraticCurveTo(0, 52, -23, 40); c.closePath(); };
    ctx.save(); ctx.translate(5, 2); outer(ctx); Art.fs(ctx, C.woodSh, LW); ctx.restore();
    // iron rim + chipped top-left corner
    const rim = (c) => { c.beginPath(); c.moveTo(-23, -36); c.lineTo(-16, -40); c.lineTo(-13, -48); c.quadraticCurveTo(4, -55, 23, -44); c.lineTo(23, 40); c.quadraticCurveTo(0, 52, -23, 40); c.closePath(); };
    Art.shape(ctx, rim, C.iron, C.ironSh, { dx: -3, dy: -3 });
    // wooden face (inset)
    const face = (c) => { c.beginPath(); c.moveTo(-18, -33); c.lineTo(-12, -36); c.lineTo(-10, -42); c.quadraticCurveTo(3, -48, 18, -39); c.lineTo(18, 35); c.quadraticCurveTo(0, 45, -18, 35); c.closePath(); };
    Art.shape(ctx, face, C.wood, C.woodSh, { lw: LWT, dx: -4, dy: -3 });
    ctx.save(); face(ctx); ctx.clip();
    // planks
    ctx.strokeStyle = 'rgba(26,18,34,0.55)'; ctx.lineWidth = 1.5;
    for (const x of [-7, 6]) { line(ctx, x, -50, x + 1, 48); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,230,190,0.12)'; ctx.lineWidth = 1;
    for (const x of [-15, -2, 11]) { ctx.beginPath(); ctx.moveTo(x, -30); ctx.quadraticCurveTo(x + 2, 0, x, 30); ctx.stroke(); }
    // faded emblem: the cracked ash-wheel
    ctx.globalAlpha *= 0.6;
    ctx.strokeStyle = C.emblem; ctx.lineWidth = 3;
    Art.circlePath(ctx, 0, -2, 12); ctx.stroke();
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + 0.3; line(ctx, Math.cos(a) * 4, -2 + Math.sin(a) * 4, Math.cos(a) * 11, -2 + Math.sin(a) * 11); ctx.lineWidth = 2; ctx.stroke(); }
    Art.circlePath(ctx, 0, -2, 3.5); ctx.fillStyle = C.emblem; ctx.fill();
    ctx.globalAlpha /= 0.6;
    // claw scratches
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) { line(ctx, 4 + i * 4, -30 + i, 12 + i * 4, -18 + i); ctx.stroke(); }
    ctx.restore();
    // iron bands + rivets
    for (const y of [-26, 24]) {
      Art.roundRectPath(ctx, -19, y - 3, 38, 6, 2); Art.fs(ctx, C.iron, LWT);
      rivet(ctx, -14, y, 1.7, C.ironHi); rivet(ctx, 0, y, 1.7, C.ironHi); rivet(ctx, 14, y, 1.7, C.ironHi);
    }
    // crack in the wood
    crack(ctx, [[-18, 10], [-11, 14], [-8, 22], [-2, 25]], null, 1.2);
    // a broken arrow stuck in it
    tube(ctx, (c) => line(c, -9, -12, -24, -22), 2, '#8a6a46');
    Art.polyPath(ctx, [[-22, -21], [-29, -19], [-26, -25]]); Art.fs(ctx, '#c9c0b0', 1.5);
    Art.polyPath(ctx, [[-25, -22], [-31, -27], [-24, -27]]); Art.fs(ctx, '#a99f90', 1.5);
  }

  function sentrySkull(ctx, C, s, o) {
    const jaw = o.jaw || 0;
    // jaw
    at(ctx, 6, 7, jaw, (c) => {
      Art.shape(c, (q) => { q.beginPath(); q.moveTo(-1, -2); q.lineTo(-18, -1); q.quadraticCurveTo(-21, 6, -15, 10); q.lineTo(-1, 9); q.quadraticCurveTo(6, 6, 6, 0); q.closePath(); }, C.bone, C.boneSh, { lw: LWT + 0.5 });
      c.beginPath(); for (let x = -16; x <= -4; x += 3.5) { c.moveTo(x, -1); c.lineTo(x, 3); } Art.strokeOnly(c, 1.3);
    });
    // cranium (facing left)
    const cran = (c) => Art.blobPath(c, [[-19, -2], [-17, -13], [-6, -19], [8, -18], [17, -9], [17, 3], [10, 9], [-2, 8], [-11, 11], [-19, 7]]);
    Art.shape(ctx, cran, C.bone, C.boneSh, { hi: { x: -9, y: -11, rx: 5, ry: 3, color: 'rgba(255,255,255,0.3)' } });
    // teeth row (upper)
    ctx.beginPath(); for (let x = -15; x <= -3; x += 3.5) { ctx.moveTo(x, 7); ctx.lineTo(x, 11); } Art.strokeOnly(ctx, 1.3);
    // sockets
    const so = o.eyeA == null ? 1 : o.eyeA;
    Art.ellipsePath(ctx, -10, -2, 5.4, 5); ctx.fillStyle = PAL.ink; ctx.fill();
    Art.ellipsePath(ctx, 3, -2.5, 4.4, 4.8); ctx.fillStyle = PAL.ink; ctx.fill();
    // nose
    Art.polyPath(ctx, [[-17, 3], [-14, 1], [-13, 6]]); ctx.fillStyle = PAL.ink; ctx.fill();
    // cheek crack
    crack(ctx, [[6, -12], [9, -7], [7, -4]], null, 0.8);
    if (so > 0.02) {
      const eo = Object.assign({ blink: o.blink || 0, glowAlpha: 0.8 * so }, eyeOpts(s, C.eye));
      ctx.save(); ctx.globalAlpha *= so;
      Art.enemyEye(ctx, -10, -1.5, 2.9 * (o.eyeScale || 1), eo);
      Art.enemyEye(ctx, 3, -2, 2.5 * (o.eyeScale || 1), eo);
      ctx.restore();
    }
  }

  function sentryHelm(ctx, C, deep) {
    // chin strap (loose leather)
    ctx.beginPath(); ctx.moveTo(14, -6); ctx.quadraticCurveTo(15, 10, 6, 14); Art.strokeOnly(ctx, 4.5); ctx.strokeStyle = C.leather; ctx.lineWidth = 2.2; ctx.stroke();
    // dented kettle dome
    const dome = (c) => { c.beginPath(); c.moveTo(-20, -6); c.quadraticCurveTo(-21, -22, -9, -27); c.lineTo(-4, -22); c.quadraticCurveTo(1, -30, 10, -29); c.quadraticCurveTo(21, -25, 20, -6); c.closePath(); };
    Art.shape(ctx, dome, C.iron, C.ironSh, { hi: { x: 6, y: -24, rx: 4, ry: 2, color: 'rgba(255,255,255,0.4)' } });
    // dent crease + crest ridge
    ctx.beginPath(); ctx.moveTo(-9, -26); ctx.quadraticCurveTo(-8, -20, -4, -21); Art.strokeOnly(ctx, 1.5);
    ctx.beginPath(); ctx.moveTo(2, -28.5); ctx.quadraticCurveTo(14, -22, 16, -8); Art.strokeOnly(ctx, 1.2, C.ironSh);
    if (deep) { // rusted spikes on the crown
      Art.polyPath(ctx, [[-1, -27], [3, -40], [6, -28]]); Art.fs(ctx, C.ironSh, LWT);
      Art.polyPath(ctx, [[9, -28], [16, -37], [15, -24]]); Art.fs(ctx, C.ironSh, LWT);
    }
    // rivet band
    Art.roundRectPath(ctx, -20, -10, 40, 5, 2); Art.fs(ctx, C.ironSh, LWT);
    for (let x = -15; x <= 15; x += 7.5) rivet(ctx, x, -7.5, 1.4, C.ironHi);
    // brim (front droops a little)
    const brim = (c) => { c.beginPath(); c.moveTo(-31, -2); c.quadraticCurveTo(-4, -9, 27, -6); c.lineTo(27, -1); c.quadraticCurveTo(-4, -4, -30, 3); c.closePath(); };
    Art.shape(ctx, brim, C.iron, C.ironSh, { lw: LW, dx: 0, dy: -2 });
  }

  function sentryBody(ctx, s, C, deep) {
    const t = s.t, p = s.p, P = s.pose;
    const br = wave(t, 1.9);
    const guard = P === 'stance' ? 1 : 0, wu = P === 'windup' ? 1 : 0;
    const dk = P === 'die' ? ease(seg(p, 0, 0.55)) : 0;
    const shake = wu ? Math.sin(t * 38) * 0.7 : 0;

    dreadAura(ctx, s, 0, -85, 100);
    ctx.save();
    motion(ctx, s, { back: 12, lunge: 40, recoil: 16 });

    // ---- pose targets (torso frame: pelvis origin)
    const crouch = guard * 7 + wu * 5 + s.wind * 4 + s.hitK * 3;
    const hipY = -62 + crouch - br * 1.1 + dk * 38;
    const rot = wu * 0.09 + guard * -0.05 + s.hitK * 0.12 + dk * 0.42 + shake * 0.01;
    const footF = [-14 - guard * 6 - wu * 4, 0], footB = [14 + wu * 6, 0];
    // halberd hand + angle (back arm)
    const hI = [24, -14], aI = 0.05;
    const hW = [16, -90], aW = 0.6;
    const hS = [-34, -34], aS = -2.05;
    let hh = [hI[0], hI[1] - br * 1.2], ha = aI + Math.sin(t * 0.9) * 0.02;
    const wk = Math.max(wu, s.wind);
    hh = [lerp(hh[0], hW[0], wk) + s.strike * (hS[0] - hI[0]), lerp(hh[1], hW[1], wk) + s.strike * (hS[1] - hI[1])];
    ha = lerp(ha, aW, wk) + s.strike * (aS - aI) + shake * 0.03;
    if (P === 'hit') { hh = [hh[0] + 4 * s.hitK, hh[1] - 8 * s.hitK]; ha += 0.15 * s.hitK; }
    if (P === 'die') { hh = [lerp(hh[0], 30, dk), lerp(hh[1], 30, dk)]; ha = lerp(ha, 1.35, eIn(seg(p, 0.05, 0.6))); }
    // shield hand (front arm)
    let sh = [-30, -4 - br * 0.8], sa = -0.04;
    if (guard) { sh = [-38, -32]; sa = -0.02; }
    if (wu || s.wind) { const k = Math.max(wu, s.wind); sh = [lerp(sh[0], -24, k), lerp(sh[1], 4, k)]; sa = lerp(sa, -0.18, k); }
    if (s.strike) { sh = [lerp(sh[0], -8, s.strike), lerp(sh[1], 8, s.strike)]; sa = lerp(sa, 0.25, s.strike); }
    if (P === 'die') { sh = [lerp(sh[0], -40, dk), lerp(sh[1], 44, dk)]; sa = lerp(sa, -1.2, dk); }
    const hot = Math.max(wu, s.wind, s.strike * 0.8);

    // ---- legs (world frame)
    const hip = [0, hipY];
    const legs = [[[6, 0], footB], [[-6, 0], footF]];
    for (let i = 0; i < 2; i++) {
      const hx = hip[0] + legs[i][0][0], hy = hip[1];
      const fx = legs[i][1][0], fy = -9;
      const kn = ik(hx, hy, fx, fy, 30, 30, 1);
      const back = i === 0;
      bone(ctx, hx, hy, kn[0], kn[1], 6.5, back ? C.boneSh : C.bone, back ? '#8f8068' : C.boneSh);
      bone(ctx, kn[0], kn[1], fx, fy, 5.5, back ? C.boneSh : C.bone, back ? '#8f8068' : C.boneSh);
      // knee cop
      Art.shape(ctx, (c) => Art.ellipsePath(c, kn[0] - 1, kn[1], 6, 5.5), C.iron, C.ironSh, { lw: LWT });
      rivet(ctx, kn[0] - 1.5, kn[1] - 0.5, 1.4, C.ironHi);
      // sabaton (pointed toe forward/left)
      Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(fx + 8, -12); c.lineTo(fx + 9, 0); c.lineTo(fx - 15, 0); c.quadraticCurveTo(fx - 14, -6, fx - 5, -9); c.lineTo(fx - 4, -13); c.closePath(); }, back ? C.ironSh : C.iron, back ? '#3d4258' : C.ironSh, { lw: LW });
      ctx.beginPath(); ctx.moveTo(fx - 4, -6); ctx.lineTo(fx + 8, -6); Art.strokeOnly(ctx, 1.3);
    }

    // ---- torso frame
    ctx.save();
    ctx.translate(hip[0], hip[1]); ctx.rotate(rot);
    const skullDetach = P === 'die' ? eIn(seg(p, 0.12, 0.62)) : 0;

    // back arm + halberd (behind torso unless striking)
    const drawHalberdArm = () => {
      const S = [12, -46];
      const el = ik(S[0], S[1], hh[0], hh[1], 23, 23, -1);
      bone(ctx, S[0], S[1], el[0], el[1], 5.5, C.boneSh, '#8f8068');
      at(ctx, hh[0], hh[1], ha, (c) => sentryHalberd(c, C, hot, t));
      bone(ctx, el[0] - 1.5, el[1], hh[0] - 1.5, hh[1], 3.2, C.bone, C.boneSh);
      bone(ctx, el[0] + 1.5, el[1] + 1, hh[0] + 1.5, hh[1] + 1, 3.2, C.bone, C.boneSh);
      at(ctx, hh[0], hh[1], ha, (c) => { Art.ellipsePath(c, 0, 0, 5.5, 6.5); Art.fs(c, C.bone, LWT); c.beginPath(); c.moveTo(-5, -2); c.lineTo(5, -3); c.moveTo(-5, 2); c.lineTo(5, 1); Art.strokeOnly(c, 1.2); });
    };
    if (!s.strike) drawHalberdArm();

    // tabard + belt
    const sway = Math.sin(t * 1.7) * 2;
    Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(-15, -8); c.lineTo(14, -8); c.lineTo(13 + sway * 0.5, 16); c.lineTo(8 + sway, 24); c.lineTo(3 + sway, 17); c.lineTo(-2 + sway, 27); c.lineTo(-7 + sway, 18); c.lineTo(-13 + sway, 24); c.lineTo(-16 + sway * 0.5, 12); c.closePath(); }, C.cloth, C.clothSh);
    ctx.beginPath(); ctx.moveTo(-2, -6); ctx.lineTo(-2 + sway * 0.8, 22); Art.strokeOnly(ctx, 1.2, C.clothSh);
    // spine + lower ribs
    for (let i = 0; i < 3; i++) { Art.roundRectPath(ctx, -5 - i * 0.3, -14 - i * 5.5, 9, 5, 2); Art.fs(ctx, C.bone, LWT); }
    for (let i = 0; i < 2; i++) {
      const y = -24 - i * 5;
      ctx.beginPath(); ctx.moveTo(-1, y); ctx.quadraticCurveTo(-16 + i, y + 2, -13 + i, y + 7);
      Art.strokeOnly(ctx, 5.5); ctx.strokeStyle = C.bone; ctx.lineWidth = 2.6; ctx.stroke();
    }
    Art.roundRectPath(ctx, -17, -11, 34, 6, 2.5); Art.fs(ctx, C.leather, LWT);
    Art.roundRectPath(ctx, -5, -12, 8, 8, 1.5); Art.fs(ctx, PAL.brass, LWT);
    // breastplate (peascod) with dent + ridge
    const plate = (c) => { c.beginPath(); c.moveTo(-17, -52); c.quadraticCurveTo(-23, -36, -10, -26); c.quadraticCurveTo(-1, -21, 10, -26); c.quadraticCurveTo(19, -36, 15, -52); c.quadraticCurveTo(-1, -58, -17, -52); c.closePath(); };
    Art.shape(ctx, plate, C.iron, C.ironSh, { hi: { x: -9, y: -46, rx: 4, ry: 6, rot: 0.3, color: 'rgba(255,255,255,0.32)' } });
    ctx.beginPath(); ctx.moveTo(-3, -55); ctx.quadraticCurveTo(-6, -38, -1, -23); Art.strokeOnly(ctx, 1.4, C.ironSh);
    Art.ellipsePath(ctx, 6, -40, 4, 3, 0.4); ctx.fillStyle = C.ironSh; ctx.fill();
    ctx.beginPath(); ctx.arc(6, -40, 4, 3.6, 5.6); Art.strokeOnly(ctx, 1.4);
    if (deep) { Art.ellipsePath(ctx, -10, -33, 3, 2); ctx.fillStyle = '#c86a3e'; ctx.fill(); Art.ellipsePath(ctx, 10, -48, 2.4, 1.6); ctx.fill(); }
    rivet(ctx, -13, -48, 1.6, C.ironHi); rivet(ctx, 11, -49, 1.6, C.ironHi);
    // gorget + neck
    Art.roundRectPath(ctx, -12, -58, 22, 7, 3); Art.fs(ctx, C.ironSh, LWT);
    bone(ctx, -2, -58, -3, -62, 5, C.bone, C.boneSh);

    // skull + helm (detaches and rolls when dying)
    const jaw = 0.04 + Math.max(0, Math.sin(t * 1.3)) * 0.05 + wu * (0.22 + Math.sin(t * 22) * 0.04) + s.strike * 0.3 + s.hitK * 0.35 + dk * 0.4;
    const eyeA = 1 - ease(seg(p, 0.15, 0.6)) * (P === 'die' ? 1 : 0);
    const drawHead = (c) => {
      sentrySkull(c, C, s, { jaw, blink: P === 'hit' ? s.hitK : blinkAt(t, 3.9, 0.7), eyeA, eyeScale: 1 + hot * 0.35 });
      if (hot > 0) Art.glow(c, -4, -2, 30, C.eye.glowColor, hot * 0.6);
      at(c, 0, -3, -0.06 + s.hitK * 0.2 + skullDetach * 0.5, sentryHelm.bind(null, c, C, deep));
    };
    if (skullDetach <= 0) {
      at(ctx, -4, -76 + guard * 2, -0.04 + s.hitK * -0.1 + wu * -0.05, (c) => { c.scale(1.16, 1.16); drawHead(c); });
    }
    if (s.strike) drawHalberdArm();

    // front arm + shield
    {
      const S = [-14, -47];
      const el = ik(S[0], S[1], sh[0] + 2, sh[1] - 4, 22, 22, -1);
      bone(ctx, S[0], S[1], el[0], el[1], 5.5, C.bone, C.boneSh);
      bone(ctx, el[0], el[1], sh[0] + 2, sh[1] - 4, 4.5, C.bone, C.boneSh);
      at(ctx, sh[0], sh[1], sa, (c) => sentryShield(c, C, deep, t, guard));
      // pauldron
      Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(-28, -42); c.quadraticCurveTo(-28, -60, -12, -59); c.quadraticCurveTo(-2, -57, -3, -46); c.quadraticCurveTo(-14, -48, -28, -42); c.closePath(); }, C.iron, C.ironSh, { hi: { x: -18, y: -55, rx: 4, ry: 2, color: 'rgba(255,255,255,0.35)' } });
      ctx.beginPath(); ctx.moveTo(-27, -46); ctx.quadraticCurveTo(-15, -52, -4, -50); Art.strokeOnly(ctx, 1.4);
      rivet(ctx, -16, -55, 1.6, C.ironHi);
      if (deep) { Art.polyPath(ctx, [[-22, -55], [-30, -66], [-16, -58]]); Art.fs(ctx, C.ironSh, LWT); }
    }
    ctx.restore();

    // falling skull (world)
    if (skullDetach > 0) {
      const r = rot, ox = -4, oy = -76;
      const ax = ox * Math.cos(r) - oy * Math.sin(r), ay = hip[1] + ox * Math.sin(r) + oy * Math.cos(r);
      const u = skullDetach;
      const bx = lerp(ax, -46, u), by = lerp(ay, -16, u) - Math.sin(u * Math.PI) * 18;
      at(ctx, bx, by, -u * 2.2, (c) => { c.scale(1.16, 1.16); drawHead(c); });
    }
    ctx.restore();
  }

  Art.registerEnemy('sentry', {
    info: { height: 155, width: 112, fx: [-26, -96], head: [-4, -178] },
    draw(ctx, pose, opts) {
      opts = opts || {};
      const s = st(pose, opts);
      const deep = opts.variant === 'deep';
      const C = deep ? SENTRY_COL.deep : SENTRY_COL.normal;
      const alpha = s.pose === 'die' ? 1 - 0.97 * ease(seg(s.p, 0.3, 1)) : 1;
      fadeLayer(ctx, alpha, (c) => sentryBody(c, s, C, deep));
    },
  });

  // ================================================================ shared: sleeves + bony hands
  // Wide robe sleeve from shoulder S to wrist H (bell cuff hanging down).
  function sleeve(ctx, sx, sy, hx, hy, w0, w1, col, sh, inner) {
    const dx = hx - sx, dy = hy - sy, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    let nx = -uy, ny = ux; if (ny < 0) { nx = -nx; ny = -ny; } // n points "down-ish"
    const mx = (sx + hx) / 2, my = (sy + hy) / 2;
    const pts = [
      [sx - nx * w0 * 0.5, sy - ny * w0 * 0.5], [mx - nx * w0 * 0.42, my - ny * w0 * 0.42],
      [hx - nx * w1 * 0.45 + ux * 2, hy - ny * w1 * 0.45 + uy * 2],
      [hx + nx * w1 * 0.75 + ux * 3, hy + ny * w1 * 0.75 + 6],
      [mx + nx * w0 * 0.6, my + ny * w0 * 0.6 + 4], [sx + nx * w0 * 0.5, sy + ny * w0 * 0.5],
    ];
    Art.shape(ctx, (c) => Art.blobPath(c, pts, 0.75), col, sh);
    // cuff opening
    Art.ellipsePath(ctx, hx + nx * w1 * 0.12, hy + ny * w1 * 0.12 + 1, w1 * 0.24, w1 * 0.62, Math.atan2(ny, nx));
    Art.fs(ctx, inner || PAL.void, LWT);
  }
  // Skeletal hand: local frame, fingers point along +x. curl 0..1.
  function boneHand(ctx, x, y, a, curl, col, sh, scale) {
    const k = scale || 1;
    at(ctx, x, y, a, (c) => {
      c.scale(k, k);
      for (let i = 0; i < 4; i++) {
        const off = (i - 1.5) * 3.2, len = i === 0 || i === 3 ? 7 : 9;
        const ang = (i - 1.5) * 0.18;
        const kx = 4 + Math.cos(ang) * len * 0.55, ky = off + Math.sin(ang) * len * 0.55;
        const ca = ang + curl * 1.6;
        const tx = kx + Math.cos(ca) * len * 0.55, ty = ky + Math.sin(ca) * len * 0.55;
        c.beginPath(); c.moveTo(2, off * 0.6); c.lineTo(kx, ky); c.lineTo(tx, ty);
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.strokeStyle = PAL.ink; c.lineWidth = 5; c.stroke();
        c.strokeStyle = col; c.lineWidth = 2.2; c.stroke();
      }
      // thumb
      c.beginPath(); c.moveTo(1, -3); c.lineTo(5, -8); c.lineTo(9 - curl * 4, -9 + curl * 3);
      c.strokeStyle = PAL.ink; c.lineWidth = 5; c.stroke(); c.strokeStyle = col; c.lineWidth = 2.2; c.stroke();
      Art.shape(c, (q) => Art.ellipsePath(q, 1, 0, 5, 4.5), col, sh, { lw: LWT });
    });
  }

  // ================================================================ ABBOT 骨の修道院長 (elite)
  const AB_NORMAL = {
    robe: '#3b2652', robeSh: '#24163a', robeIn: '#150c22', mantle: '#4d3270', mantleSh: '#2f1d47',
    mitre: '#5d3c90', mitreSh: '#3d2765', gold: PAL.brassLight, goldSh: PAL.brass,
    eye: { color: '#e0b8ff', glowColor: 'rgba(170,110,255,0.65)' },
    fire: { outer: '#9b6cf0', inner: '#f3e6ff', glowColor: 'rgba(150,100,255,0.6)' },
    rune: { line: '#c9a8ff', glow: 'rgba(150,100,255,0.55)' },
    book: '#5a1f2c', bookSh: '#3a1119', page: '#efe2c4', pageSh: '#cbb995',
  };
  const AB = AB_NORMAL;

  function abbotCenser(ctx, s, x, y, swing, fireK) {
    const t = s.t;
    // body: perforated brass orb with lid + finial
    at(ctx, x, y, swing * 0.5, (c) => {
      c.scale(1.35, 1.35);
      Art.flame(c, 0, -10, 9 + fireK * 9, t, { outer: AB.fire.outer, inner: AB.fire.inner, glowColor: AB.fire.glowColor, seed: 3 });
      Art.shape(c, (q) => { q.beginPath(); q.arc(0, 0, 10, 0, Math.PI); q.lineTo(-10, -1); q.closePath(); }, PAL.brass, PAL.brassDark);
      Art.shape(c, (q) => { q.beginPath(); q.moveTo(-10, -1); q.quadraticCurveTo(-9, -11, 0, -12); q.quadraticCurveTo(9, -11, 10, -1); q.closePath(); }, PAL.brassLight, PAL.brass, { lw: LWT + 0.5 });
      Art.roundRectPath(c, -11, -3, 22, 4, 2); Art.fs(c, PAL.brassDark, LWT);
      // glowing perforations
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const [hx, hy] of [[-5, 4], [0, 6], [5, 4], [-4, -6], [3, -7]]) { Art.circlePath(c, hx, hy, 1.7); c.fillStyle = AB.fire.inner; c.fill(); }
      c.restore();
      Art.circlePath(c, 0, 10, 2.4); Art.fs(c, PAL.brassDark, LWT);
    });
    // purple smoke wisps trailing upward
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.6 + i / 3) % 1;
      puff(ctx, x + Math.sin(t * 1.3 + i * 2) * 6 + ph * 10, y - 14 - ph * 40, 4 + ph * 6, (1 - ph) * 0.45, '#7a5aa8');
    }
  }

  function abbotBook(ctx, s, glowK) {
    // open grimoire in local frame, spine at origin, pages up.
    const t = s.t;
    if (glowK > 0) Art.glow(ctx, 0, -6, 46, AB.rune.glow, glowK);
    // cover
    Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(-22, -2); c.lineTo(0, 4); c.lineTo(22, -2); c.lineTo(20, 4); c.lineTo(0, 10); c.lineTo(-20, 4); c.closePath(); }, AB.book, AB.bookSh, { lw: LW });
    // pages
    const flip = Math.sin(t * 3.1) * 2 * glowK;
    Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(0, 4); c.lineTo(-20, -2); c.lineTo(-19, -18 - flip); c.quadraticCurveTo(-9, -15, 0, -10); c.closePath(); }, AB.page, AB.pageSh, { lw: LWT + 0.5, dx: 3, dy: -3 });
    Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(0, 4); c.lineTo(20, -2); c.lineTo(19, -18); c.quadraticCurveTo(9, -15, 0, -10); c.closePath(); }, AB.page, AB.pageSh, { lw: LWT + 0.5 });
    // scribbles / glyphs
    ctx.save();
    ctx.strokeStyle = glowK > 0.2 ? '#8a4fe0' : 'rgba(26,18,34,0.7)'; ctx.lineWidth = 1.1;
    for (let i = 0; i < 4; i++) { line(ctx, -16, -13 + i * 3.2, -4, -9 + i * 3.4); ctx.stroke(); line(ctx, 4, -9 + i * 3.4, 16, -13 + i * 3.2); ctx.stroke(); }
    ctx.restore();
    // brass corners + ribbon bookmark
    Art.polyPath(ctx, [[-20, 4], [-15, 5.5], [-20, -1]]); Art.fs(ctx, PAL.brass, 1.5);
    Art.polyPath(ctx, [[20, 4], [15, 5.5], [20, -1]]); Art.fs(ctx, PAL.brass, 1.5);
    const rb = Math.sin(t * 2.2) * 3;
    ctx.beginPath(); ctx.moveTo(1, 8); ctx.quadraticCurveTo(3 + rb, 16, 0 + rb * 1.5, 24); Art.strokeOnly(ctx, 4.5); ctx.strokeStyle = PAL.blood; ctx.lineWidth = 2.4; ctx.stroke();
    if (glowK > 0.05) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= glowK;
      ctx.strokeStyle = AB.rune.line; ctx.lineWidth = 1.6;
      for (let i = 0; i < 4; i++) {
        const ph = (t * 0.8 + i * 0.25) % 1;
        ctx.save(); ctx.globalAlpha *= Math.sin(ph * Math.PI);
        glyph(ctx, -10 + i * 7 + Math.sin(t + i) * 4, -16 - ph * 34, 5, i + 3); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  function abbotHead(ctx, s, o) {
    const t = s.t;
    // lappets (mitre ribbons) hanging behind
    const sw = Math.sin(t * 1.6) * 3;
    for (let i = 0; i < 2; i++) {
      const x0 = 8 + i * 5;
      Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(x0, -10); c.quadraticCurveTo(x0 + 6 + sw, 14, x0 + 5 + sw * 1.6, 34); c.lineTo(x0 + 10 + sw * 1.6, 30); c.lineTo(x0 + 13 + sw * 1.6, 36); c.quadraticCurveTo(x0 + 14 + sw, 12, x0 + 6, -10); c.closePath(); }, i ? AB.mitreSh : AB.mitre, AB.mitreSh, { lw: LWT + 0.5 });
      ctx.beginPath(); ctx.moveTo(x0 + 6 + sw * 1.5, 26); ctx.lineTo(x0 + 11 + sw * 1.5, 25); Art.strokeOnly(ctx, 1.6, AB.goldSh);
    }
    // jaw
    at(ctx, 0, 9, o.jaw, (c) => {
      Art.shape(c, (q) => { q.beginPath(); q.moveTo(4, -2); q.lineTo(-14, -1); q.quadraticCurveTo(-18, 10, -12, 15); q.lineTo(-5, 14); q.quadraticCurveTo(6, 8, 6, 0); q.closePath(); }, PAL.bone, PAL.boneShade, { lw: LWT + 0.5 });
      c.beginPath(); for (let x = -12; x <= -2; x += 3.3) { c.moveTo(x, -1); c.lineTo(x, 3); } Art.strokeOnly(c, 1.2);
    });
    // gaunt skull
    Art.shape(ctx, (c) => Art.blobPath(c, [[-16, -6], [-12, -16], [0, -19], [11, -15], [15, -4], [12, 6], [4, 9], [-6, 11], [-15, 10], [-18, 3]]), PAL.bone, PAL.boneShade, { hi: { x: -8, y: -9, rx: 4, ry: 2.5 } });
    ctx.beginPath(); for (let x = -14; x <= -4; x += 3.3) { ctx.moveTo(x, 8); ctx.lineTo(x, 11.5); } Art.strokeOnly(ctx, 1.2);
    // hollow cheek
    ctx.beginPath(); ctx.moveTo(-1, 3); ctx.quadraticCurveTo(-5, 7, -10, 6); Art.strokeOnly(ctx, 1.4, PAL.boneShade);
    // sockets + eyes
    Art.ellipsePath(ctx, -9, -2, 5.2, 4.6, -0.2); ctx.fillStyle = PAL.ink; ctx.fill();
    Art.ellipsePath(ctx, 3.5, -3, 4.2, 4.4); ctx.fillStyle = PAL.ink; ctx.fill();
    Art.polyPath(ctx, [[-17, 4], [-13, 2], [-13, 6]]); ctx.fillStyle = PAL.ink; ctx.fill();
    if (o.eyeA > 0.02) {
      ctx.save(); ctx.globalAlpha *= o.eyeA;
      const eo = Object.assign({ blink: o.blink, slit: 1 }, eyeOpts(s, AB.eye));
      Art.enemyEye(ctx, -9, -1.5, 3 * o.eyeK, eo); Art.enemyEye(ctx, 3.5, -2.5, 2.5 * o.eyeK, eo);
      ctx.restore();
    }
    // mitre: back panel, front panel, gold bands, emblem
    at(ctx, 0, 0, o.mitreTilt, (c) => {
      Art.shape(c, (q) => { q.beginPath(); q.moveTo(-2, -10); q.lineTo(5, -57); q.quadraticCurveTo(15, -40, 18, -10); q.closePath(); }, AB.mitreSh, '#2a1a48');
      Art.shape(c, (q) => { q.beginPath(); q.moveTo(-19, -8); q.lineTo(-18, -24); q.quadraticCurveTo(-15, -47, -5, -64); q.quadraticCurveTo(7, -42, 11, -24); q.lineTo(12, -8); q.closePath(); }, AB.mitre, AB.mitreSh, { hi: { x: -12, y: -30, rx: 2.5, ry: 10, rot: 0.2, color: 'rgba(255,255,255,0.14)' } });
      c.beginPath(); c.moveTo(-4, -12); c.quadraticCurveTo(-3, -40, -5, -62); Art.strokeOnly(c, 6.5); c.strokeStyle = AB.gold; c.lineWidth = 3.5; c.stroke();
      Art.roundRectPath(c, -21, -14, 35, 7, 2); Art.fs(c, AB.gold, LWT);
      for (let x = -16; x <= 10; x += 6.5) { Art.circlePath(c, x, -10.5, 1.3); c.fillStyle = AB.goldSh; c.fill(); }
      // reversed-wheel emblem with violet gem
      Art.circlePath(c, -4.5, -33, 7); Art.fs(c, AB.gold, LWT);
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6; line(c, -4.5, -33, -4.5 + Math.cos(a) * 6, -33 + Math.sin(a) * 6); Art.strokeOnly(c, 1.2, AB.goldSh); }
      Art.circlePath(c, -4.5, -33, 3); Art.fs(c, '#b37cff', 1.4);
      Art.glow(c, -4.5, -33, 12, 'rgba(170,110,255,0.6)', 0.5 + 0.5 * o.eyeK - 0.5);
      Art.circlePath(c, -5, -66, 2.8); Art.fs(c, AB.gold, LWT);
    });
  }

  function abbotBody(ctx, s) {
    const t = s.t, p = s.p, P = s.pose;
    const bob = wave(t, 2.4) * 2.2;
    const wu = P === 'windup' ? 1 : 0, cast = P === 'cast' ? 1 : 0, guard = P === 'stance' ? 1 : 0;
    const flare = cast ? 0.6 + 0.4 * Art.pulse(p, 0.4) : 0;
    const dk = P === 'die' ? ease(seg(p, 0, 0.7)) : 0;

    dreadAura(ctx, s, 0, -110, 120);
    ctx.save();
    motion(ctx, s, { back: 10, lunge: 34, recoil: 14, lean: 0.08 });
    // die: robe crumples down
    ctx.scale(1 + dk * 0.25, 1 - dk * 0.62);
    ctx.rotate(wu * 0.08 - cast * 0.03 + dk * 0.1);
    const up = -bob - wu * 2 + guard * 3;

    // ---- censer arm targets (back arm)
    const SB = [18, -142 + up];
    let hb = [50, -112 + up], cens;
    const L = 46;
    let ang = Math.sin(t * 1.7) * 0.3 + s.hitK * 0.9;
    if (P === 'attack') {
      const p1 = s.p;
      hb = [lerp(50, 30, s.wind) + s.strike * (-64 - 50), lerp(-112, -182, s.wind) + s.strike * (-136 + 112) + up];
      if (p1 < 0.46) ang = lerp(lerp(ang, 2.6, s.wind), 5.35, p1 < 0.28 ? 0 : eIn((p1 - 0.28) / 0.18));
      else ang = lerp(0, -0.93, s.strike);
      cens = [hb[0] + Math.sin(ang) * L, hb[1] + Math.cos(ang) * L];
    } else if (wu) {
      hb = [30, -186 + up];
      const w = t * 7.5;
      cens = [hb[0] + Math.cos(w) * 30, hb[1] + 6 + Math.sin(w) * 12];
    } else {
      if (guard) { hb = [34, -118 + up]; ang *= 0.4; }
      cens = [hb[0] + Math.sin(ang) * L, hb[1] + Math.cos(ang) * L];
    }
    if (P === 'die') { cens = [lerp(cens[0], 52, dk), lerp(cens[1], -6, dk)]; }
    const fireK = Math.max(wu, s.wind, s.strike) * (1 - dk) + cast * 0.3 - dk * 0.9;
    const censFront = P === 'attack' && s.p > 0.33 && s.p < 0.8;

    const drawSleeveB = () => sleeve(ctx, SB[0], SB[1], hb[0], hb[1], 22, 24, AB.robeSh, '#1a0f2a', AB.robeIn);
    const drawCenserArm = () => {
      chain(ctx, hb[0], hb[1], cens[0], cens[1] - 10, 0, 6, PAL.brass, PAL.brassDark);
      boneHand(ctx, hb[0], hb[1], Math.atan2(cens[1] - hb[1], cens[0] - hb[0]), 0.8, PAL.boneShade, '#8f8068');
      if (wu) { // whirl trail + charged glow
        Art.glow(ctx, hb[0], hb[1] + 6, 80, 'rgba(160,100,255,0.55)', 0.75 + 0.25 * Math.sin(t * 9));
        swoosh(ctx, hb[0], hb[1] + 6, 34, t * 7.5 - 4.6, t * 7.5 - 2.6, 5, 'rgba(160,110,255,0.3)', 0.9);
        swoosh(ctx, hb[0], hb[1] + 6, 34, t * 7.5 - 2.4, t * 7.5 - 0.2, 7, 'rgba(160,110,255,0.55)', 0.9);
      }
      abbotCenser(ctx, s, cens[0], cens[1], ang, Math.max(-0.9, fireK));
    };
    drawSleeveB();

    // ---- robe (bell) with tattered hem
    const hemPts = [];
    const n = 11;
    for (let i = 0; i <= n; i++) {
      const u = i / n, x = lerp(-58, 56, u);
      const y = (i % 2 ? -12 : 0) + Math.sin(t * 1.5 + i * 1.3) * 2.2 - (i === 0 || i === n ? 4 : 0);
      hemPts.push([x + Math.sin(t * 1.2 + i) * 1.5, y]);
    }
    const robePath = (c) => {
      c.beginPath();
      c.moveTo(-26, -150 + up);
      c.quadraticCurveTo(-40, -96 + up * 0.5, -58, -4);
      for (const h of hemPts) c.lineTo(h[0], h[1]);
      c.quadraticCurveTo(52, -78 + up * 0.5, 38, -128 + up);
      c.quadraticCurveTo(32, -148 + up, 20, -152 + up);
      c.closePath();
    };
    // inner lining visible at the hem
    ctx.save(); ctx.translate(4, 0); Art.polyPath(ctx, [[-56, -14]].concat(hemPts.map((h) => [h[0], h[1] - 2]), [[52, -14]])); ctx.fillStyle = AB.robeIn; ctx.fill(); ctx.restore();
    Art.shape(ctx, robePath, AB.robe, AB.robeSh, { dx: -7, dy: -3 });
    ctx.save(); robePath(ctx); ctx.clip();
    // fold lines
    ctx.strokeStyle = AB.robeSh; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    for (const [x0, x1] of [[-22, -34], [-6, -12], [12, 18], [26, 36]]) { ctx.beginPath(); ctx.moveTo(x0, -96 + up * 0.5); ctx.quadraticCurveTo((x0 + x1) / 2 + Math.sin(t * 1.4 + x0) * 2, -50, x1, -10); ctx.stroke(); }
    // moth holes
    for (const [hx, hy, r] of [[28, -40, 3], [-30, -30, 2.2], [36, -20, 2]]) { Art.ellipsePath(ctx, hx, hy, r * 1.3, r); ctx.fillStyle = PAL.void; ctx.fill(); }
    ctx.restore();
    // stole (gold orphrey with glyphs) down the front
    const sts = Math.sin(t * 1.5) * 1.5;
    Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(-15, -146 + up); c.lineTo(-7, -146 + up); c.quadraticCurveTo(-14, -70, -18 + sts, -4); c.lineTo(-28 + sts, -2); c.lineTo(-24 + sts, -12); c.quadraticCurveTo(-24, -80, -15, -146 + up); c.closePath(); }, PAL.brass, PAL.brassDark, { lw: LWT + 0.5 });
    ctx.save(); ctx.strokeStyle = PAL.brassShadow; ctx.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) { glyph(ctx, -16 - i * 1.6 + sts * (i / 4), -120 + i * 26 + up * 0.5, 4, i + 20); ctx.stroke(); }
    ctx.restore();
    // rope cincture + skull-bead rosary
    ctx.beginPath(); ctx.moveTo(-36, -96 + up * 0.5); ctx.quadraticCurveTo(-4, -90 + up * 0.5, 34, -96 + up * 0.5); Art.strokeOnly(ctx, 6.5); ctx.strokeStyle = '#b8a070'; ctx.lineWidth = 3.6; ctx.stroke();
    const rs = Math.sin(t * 1.9 + 0.5) * 3 + s.hitK * 6;
    ctx.beginPath(); ctx.moveTo(-28, -94 + up * 0.5); ctx.quadraticCurveTo(-30 + rs * 0.4, -78, -30 + rs, -62); Art.strokeOnly(ctx, 4); ctx.strokeStyle = '#b8a070'; ctx.lineWidth = 2; ctx.stroke();
    for (let i = 0; i < 3; i++) { const u = (i + 1) / 3.4; Art.circlePath(ctx, -28 + (rs - 2) * u, -92 + up * 0.5 + 30 * u, 2.6); Art.fs(ctx, PAL.bone, 1.5); }
    at(ctx, -30 + rs, -58, rs * 0.04, (c) => { Art.ellipsePath(c, 0, 0, 4.6, 4.2); Art.fs(c, PAL.bone, LWT); Art.circlePath(c, -1.6, -0.5, 1); c.fillStyle = PAL.ink; c.fill(); Art.circlePath(c, 1.6, -0.5, 1); c.fill(); });
    // mantle capelet over the shoulders
    const mp = [];
    for (let i = 0; i <= 8; i++) { const u = i / 8; mp.push([lerp(-46, 44, u), -116 + up + (i % 2 ? -7 : 0) + Math.sin(t * 1.7 + i) * 1.5]); }
    Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(-6, -158 + up); c.quadraticCurveTo(-40, -156 + up, -46, -116 + up); for (const m of mp) c.lineTo(m[0], m[1]); c.quadraticCurveTo(42, -152 + up, 14, -158 + up); c.closePath(); }, AB.mantle, AB.mantleSh);
    // high collar behind the head
    Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(-2, -150 + up); c.quadraticCurveTo(6, -178 + up, 22, -176 + up); c.quadraticCurveTo(20, -158 + up, 16, -150 + up); c.closePath(); }, AB.mantleSh, '#1f1232', { lw: LWT + 0.5 });

    // chest opening: ribcage with a violet ember heart
    const vee = (c) => { c.beginPath(); c.moveTo(-6, -148 + up); c.lineTo(2, -122 + up); c.lineTo(12, -148 + up); c.closePath(); };
    vee(ctx); Art.fs(ctx, AB.robeIn, LWT);
    ctx.save(); vee(ctx); ctx.clip();
    Art.glow(ctx, 3, -132 + up, 16, 'rgba(170,110,255,0.8)', 0.6 + 0.3 * wave(t, 1.1) + flare * 0.4);
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(3, -144 + i * 6 + up); ctx.quadraticCurveTo(-6, -142 + i * 6 + up, -6, -137 + i * 6 + up); Art.strokeOnly(ctx, 4.5); ctx.strokeStyle = PAL.boneShade; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.restore();
    if (!censFront) drawCenserArm();
    // ---- head
    const headTilt = -0.06 + wu * -0.08 + s.hitK * 0.25 + cast * -0.1 + Math.sin(t * 0.8) * 0.02;
    at(ctx, -6, -164 + up, headTilt, (c) => abbotHead(c, s, {
      jaw: 0.05 + wu * 0.25 + s.strike * 0.3 + s.hitK * 0.3 + cast * 0.12 * (1 + Math.sin(t * 9)) + dk * 0.3,
      eyeK: 1 + Math.max(wu, s.wind, flare) * 0.4, eyeA: 1 - dk, blink: P === 'hit' ? s.hitK : blinkAt(t, 4.4, 1.3),
      mitreTilt: s.hitK * 0.15 + dk * 0.5,
    }));

    // ---- front arm + grimoire
    const SF = [-22, -142 + up];
    let hf = [-38, -110 + up], ba = -0.15;
    if (cast) { hf = [-42, -178 + up - flare * 4]; ba = -0.55; }
    else if (guard) { hf = [-46, -124 + up]; ba = -0.9; }
    else if (wu) { hf = [-34, -104 + up]; ba = 0.1; }
    if (P === 'attack') { hf = [lerp(-38, -30, s.wind) + s.strike * 6, -110 + up + s.wind * 4]; }
    if (P === 'hit') { hf = [hf[0] + 6 * s.hitK, hf[1] - 8 * s.hitK]; ba += 0.3 * s.hitK; }
    const bookGlow = Math.max(cast * flare, guard * 0.7, wu * 0.25);
    sleeve(ctx, SF[0], SF[1], hf[0] + 6, hf[1] + 2, 22, 26, AB.robe, AB.robeSh, AB.robeIn);
    at(ctx, hf[0] - 4, hf[1] - 4, ba, (c) => abbotBook(c, s, bookGlow));
    boneHand(ctx, hf[0] + 2, hf[1] + 4, -Math.PI / 2 - 0.4 + ba, 0.3, PAL.bone, PAL.boneShade);

    if (censFront) drawCenserArm();
    if (P === 'attack') { const k = s.p < 0.46 ? seg(s.p, 0.3, 0.46) : 1 - seg(s.p, 0.46, 0.7); swoosh(ctx, hb[0], hb[1], L + 10, -0.6 - 1.4, -0.6 + 0.9, 12, 'rgba(170,110,255,0.6)', k); }
    // stance: protective violet ward dome
    if (guard) {
      const sh = 0.6 + 0.2 * Math.sin(t * 3);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= sh;
      ctx.beginPath(); ctx.ellipse(-30, -100 + up, 52, 108, 0, Math.PI * 0.6, Math.PI * 1.4);
      ctx.strokeStyle = 'rgba(190,150,255,0.8)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = 'rgba(150,100,255,0.35)'; ctx.lineWidth = 10; ctx.stroke();
      ctx.restore();
    }
    // die: purple soul-smoke rising
    if (dk > 0) particles(ctx, s, 14, 0, -60, 80, 140, { c1: '#c9a8ff', c2: '#7a5aa8', alpha: dk, speed: 0.7, size: 3 });
    ctx.restore();
    // cast: floating rune circle (not affected by body squash)
    if (cast) runeCircle(ctx, -88, -132 + up, 36 + flare * 4, t * 1.4, AB.rune, 0.55 + flare * 0.45, 1);
  }

  Art.registerEnemy('abbot', {
    info: { height: 215, width: 128, fx: [-46, -126], head: [-8, -232] },
    draw(ctx, pose, opts) {
      const s = st(pose, opts);
      const alpha = s.pose === 'die' ? 1 - 0.97 * ease(seg(s.p, 0.3, 1)) : 1;
      fadeLayer(ctx, alpha, (c) => abbotBody(c, s));
    },
  });

  // ================================================================ GOLEM 歯車ゴーレム
  const GO = {
    brass: PAL.brass, brassSh: PAL.brassDark, brassHi: PAL.brassLight, deep: PAL.brassShadow,
    copper: '#b8653a', copperSh: '#7d3b20', iron: '#4e4866', ironSh: '#2f2a42', verd: '#5fa38f',
    glass: '#1c1a2e', furnace: 'rgba(255,120,40,0.85)',
  };
  function gearPath(ctx, x, y, r, teeth, a, depth) {
    const ri = r * (1 - (depth || 0.22)), w = (Math.PI / teeth) * 0.55;
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a0 = a + (i * TAU) / teeth;
      const pts = [[ri, a0 - w * 1.25], [r, a0 - w * 0.7], [r, a0 + w * 0.7], [ri, a0 + w * 1.25]];
      for (let j = 0; j < 4; j++) {
        const px = x + Math.cos(pts[j][1]) * pts[j][0], py = y + Math.sin(pts[j][1]) * pts[j][0];
        if (i === 0 && j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
  }
  function gear(ctx, x, y, r, teeth, a, col, sh, holes, holeCol) {
    Art.shape(ctx, (c) => gearPath(c, x, y, r, teeth, a), col, sh, { dx: -r * 0.12, dy: -r * 0.12 });
    const n = holes || 0;
    for (let i = 0; i < n; i++) {
      const ha = a + (i / n) * TAU + Math.PI / n;
      Art.circlePath(ctx, x + Math.cos(ha) * r * 0.5, y + Math.sin(ha) * r * 0.5, r * 0.16);
      Art.fs(ctx, holeCol || PAL.ink, 1.5);
    }
    Art.circlePath(ctx, x, y, r * 0.24); Art.fs(ctx, sh, LWT);
    Art.circlePath(ctx, x, y, r * 0.09); ctx.fillStyle = PAL.ink; ctx.fill();
  }

  function golemArm(ctx, S, E, W, fa, back, s, opts) {
    const col = back ? GO.brassSh : GO.brass, sh = back ? GO.deep : GO.brassSh;
    // ribbed hose upper arm
    tube(ctx, (c) => { c.beginPath(); c.moveTo(S[0], S[1]); c.quadraticCurveTo((S[0] + E[0]) / 2 - 6, (S[1] + E[1]) / 2, E[0], E[1]); }, 15, back ? GO.ironSh : GO.iron);
    ctx.save(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.4;
    for (let i = 1; i < 6; i++) {
      const u = i / 6, mx = lerp(S[0], E[0], u) - Math.sin(u * Math.PI) * 3, my = lerp(S[1], E[1], u);
      const dx = E[0] - S[0], dy = E[1] - S[1], L = Math.hypot(dx, dy) || 1;
      line(ctx, mx - (dy / L) * 7, my + (dx / L) * 7, mx + (dy / L) * 7, my - (dx / L) * 7); ctx.stroke();
    }
    ctx.restore();
    // forearm: tapered cylinder (thicker toward the fist)
    const dx = W[0] - E[0], dy = W[1] - E[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const w0 = 13, w1 = 19;
    const fore = (c) => Art.blobPath(c, [[E[0] + nx * w0, E[1] + ny * w0], [W[0] + nx * w1, W[1] + ny * w1], [W[0] + ux * 4, W[1] + uy * 4], [W[0] - nx * w1, W[1] - ny * w1], [E[0] - nx * w0, E[1] - ny * w0], [E[0] - ux * 5, E[1] - uy * 5]], 0.45);
    Art.shape(ctx, fore, col, sh, { hi: back ? null : { x: E[0] + ux * L * 0.4 - nx * 5, y: E[1] + uy * L * 0.4 - ny * 5, rx: 3, ry: 9, rot: Math.atan2(uy, ux) + Math.PI / 2, color: 'rgba(255,240,200,0.35)' } });
    // copper band + rivets
    const bx = E[0] + ux * L * 0.62, by = E[1] + uy * L * 0.62;
    ctx.beginPath(); ctx.moveTo(bx + nx * 14.5, by + ny * 14.5); ctx.lineTo(bx - nx * 14.5, by - ny * 14.5); Art.strokeOnly(ctx, 8); ctx.strokeStyle = back ? GO.copperSh : GO.copper; ctx.lineWidth = 5; ctx.stroke();
    for (const k of [-8, 0, 8]) rivet(ctx, bx + nx * k, by + ny * k, 1.5, GO.brassHi);
    if (!back) { Art.ellipsePath(ctx, E[0] + ux * L * 0.3 + nx * 4, E[1] + uy * L * 0.3 + ny * 4, 4, 3); ctx.fillStyle = GO.verd; ctx.fill(); }
    // elbow joint
    Art.circlePath(ctx, E[0], E[1], 10); Art.fs(ctx, back ? GO.ironSh : GO.iron);
    rivet(ctx, E[0], E[1], 3, GO.brassHi);
    // fist (local frame: knuckles along +x)
    at(ctx, W[0], W[1], fa, (c) => {
      c.scale(1.3, 1.3);
      const fc = back ? GO.brassSh : GO.brass, fs2 = back ? GO.deep : GO.brassSh;
      Art.shape(c, (q) => Art.roundRectPath(q, -6, -15, 24, 30, 7), fc, fs2);
      for (let i = 0; i < 3; i++) {
        Art.shape(c, (q) => Art.roundRectPath(q, 14, -14 + i * 9.6, 13, 9, 3.5), fc, fs2, { lw: LWT + 0.5 });
        rivet(c, 20, -9.5 + i * 9.6, 1.3, GO.brassHi);
      }
      Art.shape(c, (q) => Art.roundRectPath(q, 2, -21, 14, 9, 3.5), fc, fs2, { lw: LWT + 0.5 });
      c.beginPath(); c.moveTo(-2, -10); c.lineTo(-2, 10); Art.strokeOnly(c, 1.4, fs2);
    });
  }

  function golemBody(ctx, s) {
    const t = s.t, p = s.p, P = s.pose;
    const wu = P === 'windup' ? 1 : 0, guard = P === 'stance' ? 1 : 0, cast = P === 'cast' ? 1 : 0;
    const dk = P === 'die' ? ease(seg(p, 0, 0.6)) : 0;
    const br = wave(t, 2.2);
    const hum = wu ? Math.sin(t * 46) * 1.2 : 0;

    dreadAura(ctx, s, 0, -100, 120);
    ctx.save();
    motion(ctx, s, { back: 14, lunge: 44, recoil: 12, lean: 0.07 });
    const crouch = wu * 8 + guard * 9 + s.wind * 8 - s.strike * 4 + dk * 18;
    // whole-body lean and slump
    ctx.translate(hum, 0);

    // ---- arm targets
    let fS = [-60, -138], bS = [58, -140];
    let fE = [-80, -92], fW = [-82, -46], fA = Math.PI / 2;
    let bE = [76, -96], bW = [78, -50], bA = Math.PI / 2;
    const sw = br * 2;
    fW[1] += sw; bW[1] += sw * 0.8;
    if (wu || s.wind) {
      const k = Math.max(wu, s.wind);
      fE = [lerp(fE[0], -76, k), lerp(fE[1], -176, k)]; fW = [lerp(fW[0], -52, k), lerp(fW[1], -214, k)]; fA = lerp(fA, -Math.PI / 2 - 0.3, k);
      bE = [lerp(bE[0], 78, k), lerp(bE[1], -176, k)]; bW = [lerp(bW[0], 46, k), lerp(bW[1], -214, k)]; bA = lerp(bA, -Math.PI / 2 + 0.3, k);
    }
    if (s.strike) {
      const k = s.strike;
      fE = [lerp(fE[0], -110, k), lerp(fE[1], -100, k)]; fW = [lerp(fW[0], -128, k), lerp(fW[1], -30, k)]; fA = lerp(fA, Math.PI / 2 + 0.6, k);
      bE = [lerp(bE[0], -40, k), lerp(bE[1], -110, k)]; bW = [lerp(bW[0], -96, k), lerp(bW[1], -34, k)]; bA = lerp(bA, Math.PI / 2 + 0.6, k);
    }
    if (guard) { fE = [-90, -92]; fW = [-74, -146]; fA = -Math.PI / 2 - 0.25; bE = [14, -78]; bW = [-36, -118]; bA = -2.5; }
    let wedge = null;
    if (cast) {
      const ext = eOut(seg(p, 0, 0.3)) * (1 - 0.3 * ease(seg(p, 0.75, 1)));
      fE = [lerp(fE[0], -100, ext), lerp(fE[1], -124, ext)]; fW = [lerp(fW[0], -136, ext), lerp(fW[1], -128, ext)]; fA = lerp(fA, Math.PI, ext);
      const fly = seg(p, 0.32, 0.85);
      wedge = { x: fW[0] - 26 - eOut(fly) * 120, y: fW[1] - 4 - Math.sin(fly * Math.PI) * 22, a: -t * 9 - fly * 12, k: 1 - seg(p, 0.85, 1) };
    }
    if (P === 'hit') { fW = [fW[0] + 10 * s.hitK, fW[1] - 14 * s.hitK]; bW = [bW[0] + 8 * s.hitK, bW[1] - 12 * s.hitK]; }
    if (dk) { fW = [lerp(fW[0], -96, dk), lerp(fW[1], -10, dk)]; fE[1] += dk * 30; bE[1] += dk * 30; fA = lerp(fA, Math.PI / 2 + 0.9, dk); }
    const Y = (y) => y + crouch * (y < -40 ? 1 : 0) - br * 1.5 * (y < -40 ? 1 : 0);
    fS = [fS[0], Y(fS[1])]; bS = [bS[0], Y(bS[1])];

    // ---- exhaust stacks + steam (behind)
    const stack = (x, h, bend) => {
      tube(ctx, (c) => { c.beginPath(); c.moveTo(x, Y(-140)); c.quadraticCurveTo(x + bend, Y(-170), x + bend * 0.6, Y(-140 - h)); }, 12, GO.copper, GO.copperSh);
      Art.roundRectPath(ctx, x + bend * 0.6 - 9, Y(-140 - h) - 4, 18, 8, 2); Art.fs(ctx, GO.iron, LWT);
    };
    stack(30, 54, 6); stack(48, 40, 10);
    const steamK = 1 + wu * 1.8 + s.hitK;
    for (let st2 = 0; st2 < 2; st2++) {
      const sx = st2 ? 54 : 33.6, sy = Y(st2 ? -180 : -194);
      for (let i = 0; i < 4; i++) {
        const ph = (t * (0.55 + wu * 0.9) + i / 4 + st2 * 0.13) % 1;
        puff(ctx, sx + ph * (14 + wu * 10) + Math.sin(t * 2 + i) * 3, sy - ph * (44 + wu * 30), (4 + ph * 10) * (0.8 + 0.4 * steamK), (1 - ph) * (0.75 + wu * 0.2));
      }
    }

    // back arm (behind torso) + back leg
    const backFront = guard || s.strike > 0.3;
    if (!backFront) golemArm(ctx, bS, [bE[0], bE[1] + crouch * 0.6], bW, bA, true, s);
    const leg = (x, back) => {
      const col = back ? GO.brassSh : GO.brass, sh = back ? GO.deep : GO.brassSh;
      const hy = Y(-48);
      tube(ctx, (c) => line(c, x, hy, x - 2, -20), 18, back ? GO.ironSh : GO.iron);
      // piston rod
      ctx.save(); ctx.lineCap = 'round'; line(ctx, x + 9, hy + 2, x + 8, -18); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 5.5; ctx.stroke(); ctx.strokeStyle = PAL.steel; ctx.lineWidth = 2.5; ctx.stroke(); ctx.restore();
      Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(x - 14, -30); c.lineTo(x + 14, -30); c.lineTo(x + 18, -14); c.lineTo(x + 16, 0); c.lineTo(x - 30, 0); c.quadraticCurveTo(x - 30, -12, x - 16, -16); c.closePath(); }, col, sh);
      ctx.beginPath(); ctx.moveTo(x - 26, -6); ctx.lineTo(x + 14, -6); Art.strokeOnly(ctx, 1.4, sh);
      rivet(ctx, x - 6, -22, 1.8, GO.brassHi); rivet(ctx, x + 8, -22, 1.8, GO.brassHi);
    };
    leg(30, true);

    // ---- torso (bronze boiler)
    const torso = (c) => Art.blobPath(c, [[-54, Y(-54)], [-68, Y(-100)], [-62, Y(-146)], [-36, Y(-166)], [2, Y(-170)], [40, Y(-166)], [64, Y(-146)], [68, Y(-100)], [54, Y(-54)], [0, Y(-44)]], 0.9);
    Art.shape(ctx, torso, GO.brass, GO.brassSh, { dx: -8, dy: -6, hi: { x: -40, y: Y(-140), rx: 10, ry: 6, rot: -0.5, color: 'rgba(255,240,200,0.3)' } });
    ctx.save(); torso(ctx); ctx.clip();
    // plate seams + rivets
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-70, Y(-74)); ctx.quadraticCurveTo(0, Y(-62), 70, Y(-74)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(30, Y(-170)); ctx.quadraticCurveTo(44, Y(-110), 34, Y(-48)); ctx.stroke();
    for (let i = 0; i < 7; i++) rivet(ctx, -54 + i * 18, Y(-71) + Math.sin((i / 6) * Math.PI) * 4 + 4, 1.7, GO.brassHi);
    for (let i = 0; i < 5; i++) rivet(ctx, 38 + Math.sin((i / 4) * Math.PI) * 6, Y(-156) + i * 22, 1.7, GO.brassHi);
    // copper patch + verdigris
    Art.roundRectPath(ctx, 40, Y(-130), 20, 24, 3); Art.fs(ctx, GO.copper, LWT);
    rivet(ctx, 44, Y(-126), 1.3, GO.brassHi); rivet(ctx, 56, Y(-126), 1.3, GO.brassHi); rivet(ctx, 44, Y(-110), 1.3, GO.brassHi); rivet(ctx, 56, Y(-110), 1.3, GO.brassHi);
    for (const [vx, vy, r] of [[-52, -86, 5], [-46, -80, 3], [12, -58, 4], [52, -92, 3]]) { Art.ellipsePath(ctx, vx, Y(vy), r * 1.4, r); ctx.fillStyle = GO.verd; ctx.fill(); }
    ctx.restore();
    // waist gear housing
    Art.roundRectPath(ctx, -44, Y(-56), 88, 14, 6); Art.fs(ctx, GO.iron);
    for (let i = 0; i < 6; i++) rivet(ctx, -36 + i * 14.4, Y(-49), 1.6, GO.brassHi);

    // ---- chest porthole + turning gear + furnace light
    const gx = -8, gy = Y(-110);
    const spin = wu ? t * 9 : P === 'hit' ? t * 0.8 + Math.sin(p * 30) * 0.2 * (1 - p) : t * 0.8 + (s.strike ? s.strike * 2 : 0);
    const heat = 0.55 + 0.15 * wave(t, 1.4) + wu * 0.45 + s.wind * 0.4 - dk * 0.55;
    Art.circlePath(ctx, gx, gy, 34); Art.fs(ctx, GO.iron);
    Art.circlePath(ctx, gx, gy, 27); Art.fs(ctx, '#2a1410', LWT);
    Art.glow(ctx, gx, gy, 30 + wu * 14, GO.furnace, heat);
    gear(ctx, gx, gy, 24, 10, -spin, GO.brassHi, GO.brass, 5, wu ? PAL.flameHot : PAL.ember);
    if (wu) { // motion blur arcs
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,220,140,0.55)'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(gx, gy, 18 + i * 3, -t * 9 + i * 2, -t * 9 + i * 2 + 1.4); ctx.stroke(); }
      ctx.restore();
    }
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; rivet(ctx, gx + Math.cos(a) * 30.5, gy + Math.sin(a) * 30.5, 1.6, GO.brassHi); }
    // steam vents at the sides (burst on windup / hit)
    if (wu || s.hitK > 0.1) {
      for (let i = 0; i < 3; i++) {
        const ph = (t * 2.2 + i / 3) % 1, k = wu ? 1 : s.hitK;
        puff(ctx, -66 - ph * 26, Y(-70) - ph * 10 - i * 2, (5 + ph * 9) * k, (1 - ph) * 0.8 * k);
        puff(ctx, 66 + ph * 22, Y(-76) - ph * 12, (5 + ph * 8) * k, (1 - ph) * 0.8 * k);
      }
    }

    // front leg
    leg(-32, false);

    // ---- head: sunk dome with one big eye + pressure gauge
    const hx = -22, hy = Y(-174);
    at(ctx, hx, hy, s.hitK * 0.15 + wu * -0.06 + dk * 0.5, (c) => {
      c.scale(1.22, 1.22);
      // gauge on a stalk
      c.save(); c.lineCap = 'round'; line(c, 10, -20, 14, -34); c.strokeStyle = PAL.ink; c.lineWidth = 5; c.stroke(); c.strokeStyle = GO.iron; c.lineWidth = 2.6; c.stroke(); c.restore();
      Art.circlePath(c, 15, -38, 7); Art.fs(c, PAL.bone, LWT);
      const needle = -2.2 + 0.4 * Math.sin(t * 3.1) + wu * (1.9 + Math.sin(t * 30) * 0.2) + s.hitK * 1.2;
      c.beginPath(); c.moveTo(15, -38); c.lineTo(15 + Math.cos(needle) * 5, -38 + Math.sin(needle) * 5); Art.strokeOnly(c, 1.5, wu ? PAL.blood : PAL.ink);
      // dome
      Art.shape(c, (q) => { q.beginPath(); q.moveTo(-26, 8); q.quadraticCurveTo(-28, -22, 0, -24); q.quadraticCurveTo(26, -22, 24, 8); q.closePath(); }, GO.brass, GO.brassSh, { hi: { x: -10, y: -16, rx: 6, ry: 3, rot: -0.3, color: 'rgba(255,240,200,0.4)' } });
      // brow visor
      Art.shape(c, (q) => { q.beginPath(); q.moveTo(-30, -6); q.quadraticCurveTo(-14, -16, 2, -12); q.lineTo(2, -6); q.quadraticCurveTo(-14, -10, -30, -1); q.closePath(); }, GO.copper, GO.copperSh, { lw: LWT + 0.5 });
      // lens
      Art.circlePath(c, -12, 4, 16); Art.fs(c, GO.iron);
      Art.circlePath(c, -12, 4, 12); Art.fs(c, GO.glass, LWT);
      const blink = P === 'hit' ? s.hitK : blinkAt(t, 5.1, 2.2);
      const eyeA = 1 - dk;
      if (eyeA > 0.02) {
        c.save(); c.globalAlpha *= eyeA;
        const look = Math.sin(t * 0.7) * 1.5;
        Art.enemyEye(c, -14 + look, 4, 6.4 + wu * 1.4 + s.wind, Object.assign({ blink }, eyeOpts(s, { color: PAL.flameHot, glowColor: 'rgba(255,150,50,0.6)' })));
        c.restore();
      }
      // aperture shutter ring
      c.save(); Art.circlePath(c, -12, 4, 12); c.clip();
      c.strokeStyle = 'rgba(26,18,34,0.35)'; c.lineWidth = 1;
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + t * 0.2; line(c, -12 + Math.cos(a) * 12, 4 + Math.sin(a) * 12, -12 + Math.cos(a + 1.2) * 8, 4 + Math.sin(a + 1.2) * 8); c.stroke(); }
      c.restore();
      Art.ellipsePath(c, -18, -2, 3.2, 1.8, -0.6); c.fillStyle = 'rgba(255,255,255,0.5)'; c.fill();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; rivet(c, -12 + Math.cos(a) * 14.1, 4 + Math.sin(a) * 14.1, 1.2, GO.brassHi); }
    });

    // shoulders (pauldrons)
    const pauldron = (x, y, back) => {
      Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(x - 24, y + 12); c.quadraticCurveTo(x - 26, y - 18, x, y - 20); c.quadraticCurveTo(x + 26, y - 18, x + 24, y + 12); c.quadraticCurveTo(x, y + 4, x - 24, y + 12); c.closePath(); }, back ? GO.brassSh : GO.brass, back ? GO.deep : GO.brassSh, { hi: back ? null : { x: x - 8, y: y - 12, rx: 6, ry: 3, rot: -0.4, color: 'rgba(255,240,200,0.35)' } });
      ctx.beginPath(); ctx.moveTo(x - 22, y + 2); ctx.quadraticCurveTo(x, y - 6, x + 22, y + 2); Art.strokeOnly(ctx, 1.5);
      for (let i = 0; i < 3; i++) rivet(ctx, x - 12 + i * 12, y - 9 + (i === 1 ? -2 : 0), 1.6, GO.brassHi);
    };
    pauldron(bS[0] + 2, bS[1] - 6, true);
    if (backFront) golemArm(ctx, bS, [bE[0], bE[1] + crouch * 0.6], bW, bA, true, s);

    // front arm
    golemArm(ctx, fS, [fE[0], fE[1] + crouch * 0.6], fW, fA, false, s);
    pauldron(fS[0], fS[1] - 4, false);

    // cast: the gear wedge
    if (wedge && wedge.k > 0.01) {
      ctx.save(); ctx.globalAlpha *= wedge.k;
      at(ctx, wedge.x, wedge.y, wedge.a, (c) => {
        gear(c, 0, 0, 13, 8, 0, PAL.steel, PAL.steelShade, 0);
        Art.polyPath(c, [[-6, -4], [-24, 0], [-6, 4]]); Art.fs(c, PAL.steel, LWT);
      });
      particles(ctx, s, 6, wedge.x + 14, wedge.y + 8, 18, 18, { size: 1.6, speed: 2 });
      ctx.restore();
    }
    // attack impact sparks
    if (P === 'attack' && p > 0.4 && p < 0.7) {
      const k = 1 - seg(p, 0.4, 0.7);
      Art.glow(ctx, -112, -20, 50, 'rgba(255,170,80,0.6)', k);
      for (let i = 0; i < 8; i++) { const a = -Math.PI + (i / 7) * Math.PI, r = 20 + (1 - k) * 40; puff(ctx, -112 + Math.cos(a) * r, -10 + Math.sin(a) * r * 0.4, 6 * k + 2, k * 0.7, '#b9a98f'); }
    }
    if (dk > 0) {
      for (let i = 0; i < 5; i++) { const ph = (t * 0.6 + i / 5) % 1; puff(ctx, -40 + i * 20 + ph * 8, -100 - ph * 70, 8 + ph * 14, (1 - ph) * dk * 0.8); }
      // spilled cogs
      for (let i = 0; i < 3; i++) { const u = eOut(seg(p, 0.2 + i * 0.08, 0.7)); gear(ctx, -30 - i * 20 - u * 40, -8 - i * 2, 7 - i, 7, u * 8, GO.brassHi, GO.brass, 0); }
    }
    ctx.restore();
  }

  Art.registerEnemy('golem', {
    info: { height: 185, width: 180, fx: [-40, -110], head: [-14, -212] },
    draw(ctx, pose, opts) {
      const s = st(pose, opts);
      const alpha = s.pose === 'die' ? 1 - 0.97 * ease(seg(s.p, 0.3, 1)) : 1;
      fadeLayer(ctx, alpha, (c) => golemBody(c, s));
    },
  });

  // ================================================================ SHADE 影の写し身
  const SH = {
    body: '#2a1f40', bodySh: '#170f26', rim: 'rgba(170,140,240,0.9)', halo: 'rgba(140,110,220,0.22)',
    cape: '#21182f', capeSh: '#120b1c', mirror: '#bdb5e2', mirrorSh: '#7f76b2', mirrorHi: '#ffffff',
    eye: { color: '#f4b8ff', glowColor: 'rgba(225,110,255,0.85)' }, glow: 'rgba(200,180,255,0.55)',
  };
  // ink shape with a violet halo outside and a violet rim light along the lit (upper-left) edge
  function inkShape(ctx, pathFn, base, shade, rimW) {
    ctx.save(); pathFn(ctx); ctx.strokeStyle = SH.halo; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
    Art.shape(ctx, pathFn, base, shade, { dx: -5, dy: -5 });
    ctx.save(); pathFn(ctx); ctx.clip(); ctx.translate(2.6, 2.6); pathFn(ctx);
    ctx.strokeStyle = SH.rim; ctx.lineWidth = rimW || 2; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
  }
  // wobbly blob: points get a small animated ripple so the edges feel inky
  const wob = (pts, t, amp, sp) => pts.map((q, i) => [q[0] + Math.sin(t * (sp || 2.3) + i * 1.9) * amp, q[1] + Math.cos(t * (sp || 2.3) * 0.8 + i * 2.7) * amp]);

  function shadeFace(ctx, s, o) {
    const t = s.t;
    // the cracked mirror shard (local: helm frame)
    const shard = (c) => Art.polyPath(c, [[-33, -13], [-24, -16], [-17, -25], [-3, -21], [4, -9], [8, 0], [2, 14], [-10, 21], [-18, 16], [-28, 17], [-34, 4]]);
    Art.shape(ctx, shard, SH.mirror, SH.mirrorSh, { dx: -3, dy: -3, lw: LWT + 0.5 });
    ctx.save(); shard(ctx); ctx.clip();
    // drifting reflection band
    const off = ((t * 14) % 60) - 30;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.moveTo(-36 + off, 24); ctx.lineTo(-28 + off, 24); ctx.lineTo(-8 + off, -26); ctx.lineTo(-16 + off, -26); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(155,123,214,0.4)';
    ctx.beginPath(); ctx.moveTo(-36, 18); ctx.lineTo(10, 2); ctx.lineTo(10, 24); ctx.lineTo(-36, 24); ctx.closePath(); ctx.fill();
    ctx.restore();
    // cracks from the impact point
    const ck = o.crackGlow || 0;
    const C0 = [-12, 4];
    const rays = [[[-33, -9], [-22, -4]], [[-15, -23], [-14, -10]], [[4, -9], [-4, -2]], [[2, 13], [-5, 9]], [[-24, 16], [-17, 10]], [[-34, 6], [-26, 6]]];
    for (const r of rays) crack(ctx, [C0].concat(r.slice().reverse()), ck > 0.05 ? '#ffb0ff' : null, 1, ck);
    // eyes behind the glass: dark slits in the shard with glowing pupils
    Art.ellipsePath(ctx, -22, -4, 6.5, 4, -0.15); ctx.fillStyle = 'rgba(20,12,34,0.92)'; ctx.fill();
    Art.ellipsePath(ctx, -6, -5, 5.4, 3.5, -0.15); ctx.fill();
    if (o.eyeA > 0.02) {
      ctx.save(); ctx.globalAlpha *= o.eyeA;
      const eo = Object.assign({ blink: o.blink, slit: 1, rot: -0.15 }, eyeOpts(s, SH.eye));
      Art.enemyEye(ctx, -22, -4, 4.2 * o.eyeK, eo); Art.enemyEye(ctx, -6, -5, 3.5 * o.eyeK, eo);
      ctx.restore();
    }
  }

  function shadeMirror(ctx, s, k) {
    // big hand mirror in a thorny dark frame; local frame centred on the glass
    const t = s.t;
    Art.glow(ctx, 0, 0, 80, SH.glow, 0.55 * k + 0.15 * Math.sin(t * 5));
    Art.glow(ctx, 0, 0, 40, 'rgba(255,255,255,0.35)', 0.5 * k);
    // frame spikes
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.15, cx = Math.cos(a), sy = Math.sin(a);
      Art.polyPath(ctx, [[cx * 26 - sy * 5, sy * 36 + cx * 5], [cx * 36, sy * 47], [cx * 26 + sy * 5, sy * 36 - cx * 5]]);
      Art.fs(ctx, SH.body, LWT);
    }
    Art.ellipsePath(ctx, 0, 0, 30, 41); Art.fs(ctx, SH.body, LW);
    Art.ellipsePath(ctx, 0, 0, 30, 41); ctx.save(); ctx.clip(); ctx.translate(2.5, 2.5); Art.ellipsePath(ctx, 0, 0, 30, 41); ctx.strokeStyle = SH.rim; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    // glass
    const glass = (c) => Art.ellipsePath(c, 0, 0, 23, 33);
    Art.shape(ctx, glass, '#cfc6f0', '#9a8fd0', { lw: LWT });
    ctx.save(); glass(ctx); ctx.clip();
    // shimmering silver-violet sheen bands
    for (let i = 0; i < 3; i++) {
      const off = ((t * 28 + i * 26) % 90) - 45;
      ctx.fillStyle = i === 1 ? 'rgba(180,140,255,0.45)' : 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.moveTo(-30 + off, 40); ctx.lineTo(-30 + off + (i === 1 ? 14 : 7), 40); ctx.lineTo(off + 14, -40); ctx.lineTo(off + (i === 1 ? 0 : 7), -40); ctx.closePath(); ctx.fill();
    }
    // faint reflected party (tiny silhouettes) — reflection hint
    ctx.fillStyle = 'rgba(60,40,100,0.35)';
    for (const [x, h] of [[-10, 16], [0, 19], [10, 15]]) { Art.ellipsePath(ctx, x, 26 - h, 4, 5); ctx.fill(); ctx.fillRect(x - 4, 26 - h + 3, 8, h - 4); }
    ctx.restore();
    // sparkles
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const ph = (t * 0.9 + i * 0.27) % 1, a = Math.sin(ph * Math.PI);
      const x = Math.cos(i * 2.1) * 20, y = Math.sin(i * 1.7) * 28, z = 3 + 4 * a;
      ctx.globalAlpha = a * k; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(x, y - z); ctx.lineTo(x + z * 0.25, y); ctx.lineTo(x, y + z); ctx.lineTo(x - z * 0.25, y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - z, y); ctx.lineTo(x, y + z * 0.25); ctx.lineTo(x + z, y); ctx.lineTo(x, y - z * 0.25); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // handle knot at the bottom
    Art.roundRectPath(ctx, -5, 38, 10, 14, 3); Art.fs(ctx, SH.body, LWT);
  }

  function shadeSword(ctx, s, hot) {
    // ink blade with a violet edge, pointing along -y
    const t = s.t;
    const blade = (c) => { c.beginPath(); c.moveTo(-5, -6); c.quadraticCurveTo(-7 + Math.sin(t * 3) * 1.5, -40, -1, -70); c.lineTo(2, -74); c.quadraticCurveTo(7, -40, 5, -6); c.closePath(); };
    if (hot > 0) Art.glow(ctx, 0, -40, 50, 'rgba(170,120,255,0.6)', hot);
    inkShape(ctx, blade, SH.body, SH.bodySh, 1.6);
    ctx.beginPath(); ctx.moveTo(4, -8); ctx.quadraticCurveTo(6, -40, 1.5, -71);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = hot > 0 ? '#e6d4ff' : 'rgba(190,160,255,0.75)'; ctx.lineWidth = 1.6 + hot * 1.4; ctx.stroke(); ctx.restore();
    // drips off the blade
    for (let i = 0; i < 2; i++) { const ph = (t * 0.8 + i * 0.5) % 1; Art.ellipsePath(ctx, -5 + i * 9, -30 + i * 14 + ph * 18, 1.5, 2.5 + ph); ctx.fillStyle = SH.body; ctx.globalAlpha *= 1; ctx.fill(); }
    // crossguard + grip
    Art.roundRectPath(ctx, -12, -8, 24, 6, 3); inkShape(ctx, (c) => Art.roundRectPath(c, -12, -8, 24, 6, 3), SH.body, SH.bodySh, 1.4);
    Art.roundRectPath(ctx, -3, -2, 6, 12, 2); Art.fs(ctx, SH.bodySh, LWT);
  }

  function shadeBody(ctx, s) {
    const t = s.t, p = s.p, P = s.pose;
    const wu = P === 'windup' ? 1 : 0, guard = P === 'stance' ? 1 : 0, cast = P === 'cast' ? 1 : 0;
    const dk = P === 'die' ? ease(seg(p, 0, 0.75)) : 0;
    const bob = wave(t, 2.0) * 2.5;

    dreadAura(ctx, s, 0, -80, 100);
    Art.glow(ctx, 0, -70, 90, 'rgba(110,80,190,0.22)', 1 - dk);
    // ink puddle at the feet (grows as it melts)
    const pr = 38 + dk * 26 + Math.sin(t * 2) * 2;
    inkShape(ctx, (c) => Art.blobPath(c, wob([[-pr, 0], [-pr * 0.6, -6], [0, -7], [pr * 0.65, -5], [pr, 0], [pr * 0.5, 5], [-pr * 0.5, 5]], t, 1.2)), SH.body, SH.bodySh, 1.5);
    particles(ctx, s, 8, 0, -4, pr * 1.6, 60 + wu * 40, { c1: 'rgba(170,140,240,0.9)', c2: 'rgba(90,60,150,0.9)', speed: 0.45 + wu * 0.6, size: 2, alpha: 0.8, add: true });

    ctx.save();
    motion(ctx, s, { back: 10, lunge: 50, recoil: 18 });
    // melt: squash into the puddle
    ctx.scale(1 + dk * 0.5, 1 - dk * 0.94);
    const up = -bob - wu * 6 + guard * 2;
    const stretch = 1 + wu * 0.06 + s.wind * 0.05;
    ctx.scale(1 / Math.sqrt(stretch), stretch);

    // ---- cape (behind)
    const cw = Math.sin(t * 1.8);
    const capePts = wob([[-12, -94 + up], [20, -96 + up], [38, -72 + up], [52 + cw * 6, -40], [66 + cw * 9, -10], [52 + cw * 6, -16], [48 + cw * 5, -2], [34 + cw * 3, -12], [24, 0], [16, -14], [8, -40 + up]], t, 1.5);
    inkShape(ctx, (c) => Art.blobPath(c, capePts, 0.8), SH.cape, SH.capeSh, 1.6);

    // ---- legs (fade into the puddle)
    inkShape(ctx, (c) => Art.blobPath(c, [[2, -46 + up * 0.5], [18, -46 + up * 0.5], [18, -18], [17, -2], [3, -3], [2, -18]], 0.8), SH.bodySh, '#0d0816', 1.2);
    inkShape(ctx, (c) => Art.blobPath(c, [[-22, -46 + up * 0.5], [-4, -46 + up * 0.5], [-5, -16], [-8, -2], [-26, -3], [-22, -18]], 0.8), SH.body, SH.bodySh, 1.5);

    // ---- back arm (holds the mirror in stance)
    const SB = [14, -84 + up];
    let hb = [22, -54 + up];
    if (guard) hb = [-26, -70 + up];
    if (wu || s.wind || s.strike) hb = [lerp(hb[0], 2, Math.max(wu, s.wind)), lerp(hb[1], -112 + up, Math.max(wu, s.wind))];
    tube(ctx, (c) => { c.beginPath(); c.moveTo(SB[0], SB[1]); c.quadraticCurveTo((SB[0] + hb[0]) / 2 + 8, (SB[1] + hb[1]) / 2 + 4, hb[0], hb[1]); }, 12, SH.bodySh);

    // ---- torso (tabard silhouette echo)
    const torso = (c) => Art.blobPath(c, wob([[-22, -94 + up], [0, -98 + up], [22, -92 + up], [27, -64 + up * 0.6], [24, -38], [0, -32], [-24, -38], [-29, -64 + up * 0.6]], t, 0.8), 0.85);
    inkShape(ctx, torso, SH.body, SH.bodySh, 2);
    // belt glint + echo of the knight's tabard trim
    ctx.beginPath(); ctx.moveTo(-20, -52 + up * 0.5); ctx.quadraticCurveTo(0, -48 + up * 0.5, 19, -52 + up * 0.5); Art.strokeOnly(ctx, 4.5); ctx.strokeStyle = 'rgba(155,123,214,0.7)'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-6, -92 + up); ctx.lineTo(-6, -54 + up * 0.5); ctx.strokeStyle = 'rgba(155,123,214,0.3)'; ctx.lineWidth = 3; ctx.stroke();

    // ---- head: bucket-helm silhouette + smoky plume + mirror-shard face
    const hx = -4, hy = -128 + up;
    const tilt = -0.05 + s.hitK * 0.25 + wu * -0.08 + cast * Math.sin(t * 6) * 0.05;
    const crackGlow = Math.max(wu, s.hitK, cast * (0.6 + 0.4 * Art.pulse(p, 0.4)), s.wind);
    at(ctx, hx, hy, tilt, (c) => {
      // plume of smoke trailing back
      const pw = Math.sin(t * 2.2) * 5;
      const plume = (q) => Art.blobPath(q, wob([[-6, -30], [-2, -46], [12, -56], [34, -58], [56 + pw, -50], [72 + pw * 1.5, -36], [56 + pw, -40], [62 + pw * 1.2, -24], [42 + pw * 0.6, -34], [24, -32], [14, -28]], t, 1.2, 3), 0.9);
      inkShape(c, plume, SH.cape, SH.capeSh, 1.6);
      particles(c, s, 6, 66 + pw * 1.4, -34, 14, 36, { c1: 'rgba(170,140,240,0.9)', c2: 'rgba(90,60,150,0.9)', speed: 0.8, size: 2.4, drift: 12 });
      const helm = (q) => { q.beginPath(); q.moveTo(-32, -18); q.quadraticCurveTo(-32, -31, -18, -32); q.lineTo(18, -32); q.quadraticCurveTo(31, -31, 30, -16); q.lineTo(32, 20); q.quadraticCurveTo(32, 30, 18, 30); q.lineTo(-20, 30); q.quadraticCurveTo(-35, 30, -34, 18); q.closePath(); };
      inkShape(c, helm, SH.body, SH.bodySh, 2.2);
      // helm band echo
      c.beginPath(); c.moveTo(-31, -20); c.lineTo(29, -20); c.strokeStyle = 'rgba(155,123,214,0.45)'; c.lineWidth = 2; c.stroke();
      shadeFace(c, s, { crackGlow, eyeA: 1 - dk, eyeK: 1 + crackGlow * 0.4, blink: P === 'hit' ? s.hitK : blinkAt(t, 4.8, 0.4) });
    });

    // ---- front arm + sword
    const SF = [-16, -84 + up];
    let hf = [-32, -56 + up], sa = -0.25 + Math.sin(t * 1.2) * 0.04;
    if (wu || s.wind) { const k = Math.max(wu, s.wind); hf = [lerp(hf[0], -8, k), lerp(hf[1], -132 + up, k)]; sa = lerp(sa, 0.5, k); }
    if (s.strike) { hf = [lerp(hf[0], -54, s.strike), lerp(hf[1], -70, s.strike)]; sa = lerp(sa, -2.2, s.strike); }
    if (guard) { hf = [-40, -76 + up]; sa = -0.9; }
    if (P === 'hit') { hf = [hf[0] + 8 * s.hitK, hf[1] - 8 * s.hitK]; sa += 0.4 * s.hitK; }
    const swordHot = Math.max(wu, s.wind, s.strike);
    if (!guard) at(ctx, hf[0], hf[1], sa, (c) => shadeSword(c, s, swordHot));
    tube(ctx, (c) => { c.beginPath(); c.moveTo(SF[0], SF[1]); c.quadraticCurveTo((SF[0] + hf[0]) / 2 + 6, (SF[1] + hf[1]) / 2 + 6, hf[0], hf[1]); }, 12, SH.body);
    inkShape(ctx, (c) => Art.circlePath(c, hf[0], hf[1], 7.5), SH.body, SH.bodySh, 1.4);
    if (P === 'attack') { const k = s.p < 0.46 ? seg(s.p, 0.3, 0.46) : 1 - seg(s.p, 0.46, 0.68); swoosh(ctx, hf[0] + 10, hf[1] - 10, 66, -1.2, -3.3, 12, 'rgba(180,140,255,0.6)', k); }

    // ---- stance: the big reflecting mirror held up in front
    if (guard) at(ctx, -42, -86 + up, -0.08 + Math.sin(t * 1.6) * 0.03, (c) => shadeMirror(c, s, 1));
    // ---- cast: orbiting mirror shards
    if (cast) {
      const k = 0.6 + 0.4 * Art.pulse(p, 0.4);
      for (let i = 0; i < 5; i++) {
        const a = t * 2.2 + (i / 5) * TAU, x = hx + Math.cos(a) * 42, y = hy + 10 + Math.sin(a) * 14;
        at(ctx, x, y, a * 1.5, (c) => { Art.polyPath(c, [[-5, -7], [5, -3], [2, 7], [-4, 4]]); Art.fs(c, SH.mirror, 1.6); Art.glow(c, 0, 0, 14, SH.glow, k * 0.8); });
      }
    }
    ctx.restore();
    // die: the face shard falls into the puddle and splinters
    if (P === 'die' && p > 0.3) {
      const u = seg(p, 0.3, 0.75);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.6;
        const x = -10 + Math.cos(a) * u * 34 * (0.6 + Art.hash(i) * 0.6), y = lerp(-110, -6, eIn(u)) + Math.sin(a) * u * 10;
        at(ctx, x, Math.min(-3, y), u * (i - 2) * 2, (c) => { Art.polyPath(c, [[-5, -5], [5, -3], [1, 5]]); Art.fs(c, SH.mirror, 1.5); });
      }
    }
  }

  Art.registerEnemy('shade', {
    info: { height: 152, width: 110, fx: [-30, -96], head: [-2, -172] },
    draw(ctx, pose, opts) {
      const s = st(pose, opts);
      const alpha = s.pose === 'die' ? 1 - 0.97 * ease(seg(s.p, 0.35, 1)) : 1;
      fadeLayer(ctx, alpha, (c) => shadeBody(c, s));
    },
  });

  // ================================================================ MIMIC ミミック
  const MI = {
    wood: '#8a5530', woodSh: '#5c3418', woodDark: '#3f2312', iron: '#5d5a78', ironSh: '#38354f', ironHi: '#a9a6c8',
    mouth: '#2a0d1a', throat: '#12060c', tongue: '#d0507a', tongueSh: '#8f2a52', tooth: PAL.bone, toothSh: PAL.boneShade,
  };
  const HINGE = [40, -46];

  function mimicTeeth(ctx, x0, x1, y, dir, n, sz, jit) {
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, x = lerp(x0, x1, u), h = sz * (0.75 + 0.35 * Art.hash(i * 3.3 + jit)) * (i === 1 || i === n - 2 ? 1.35 : 1);
      const w = ((x1 - x0) / n) * 0.48;
      Art.shape(ctx, (c) => Art.polyPath(c, [[x - w, y], [x + w * 0.2, y + dir * h], [x + w, y]]), MI.tooth, MI.toothSh, { lw: 1.8, dx: -1.5, dy: -1.5 * dir });
    }
  }

  function mimicBody(ctx, s) {
    const t = s.t, p = s.p, P = s.pose;
    const wu = P === 'windup' ? 1 : 0, guard = P === 'stance' ? 1 : 0, cast = P === 'cast' ? 1 : 0;
    const dk = P === 'die' ? ease(seg(p, 0, 0.4)) : 0;
    const br = wave(t, 1.8);

    dreadAura(ctx, s, 0, -50, 80);
    ctx.save();
    ctx.scale(1.12, 1.12);
    motion(ctx, s, { back: 10, lunge: 46, recoil: 14, lean: 0.12 });
    // hop during the lunge
    if (P === 'attack') ctx.translate(0, -18 * Math.sin(Math.PI * seg(p, 0.24, 0.48)));
    // breathing squash (box squishes as lid breathes)
    const sq = br * 0.025 + guard * 0.06 + s.hitK * -0.05 + (wu ? Math.sin(t * 30) * 0.015 : 0);
    ctx.scale(1 + sq, 1 - sq);
    if (dk) { ctx.translate(0, 0); ctx.rotate(dk * 0.12); }

    // lid opening angle
    let th = 0.5 + br * 0.06;
    if (wu) th = 0.86 + Math.sin(t * 14) * 0.05;
    if (cast) th = 0.7 + Math.sin(t * 3) * 0.04;
    if (guard) th = 0.07 + Math.max(0, Math.sin(t * 2.4)) * 0.04;
    if (P === 'attack') th = p < 0.28 ? lerp(th, 1.0, eOut(p / 0.28)) : p < 0.46 ? lerp(1.0, 0.02, eIn((p - 0.28) / 0.18)) : lerp(0.02, 0.5 + br * 0.06, ease((p - 0.5) / 0.5) * (p > 0.5 ? 1 : 0));
    if (P === 'hit') th += 0.45 * s.hitK;
    if (dk) th = lerp(th, 0.0, dk);
    const tongueK = clamp(1 - (guard ? 1 : 0) - dk - (P === 'attack' && p > 0.3 && p < 0.55 ? 0.8 : 0), 0, 1);

    // ---- interior (behind lid): mouth cavity
    const fx = HINGE[0] - 86 * Math.cos(th), fy = HINGE[1] - 86 * Math.sin(th);
    Art.polyPath(ctx, [[-44, -46], [fx, fy], [HINGE[0] - 4, HINGE[1] - 8], [HINGE[0], HINGE[1]]]);
    Art.fs(ctx, MI.mouth, LWT);
    ctx.save();
    Art.polyPath(ctx, [[-44, -46], [fx, fy], [HINGE[0] - 4, HINGE[1] - 8], [HINGE[0], HINGE[1]]]); ctx.clip();
    Art.ellipsePath(ctx, 18, -54, 26, 18); ctx.fillStyle = MI.throat; ctx.fill();
    if (cast) { Art.glow(ctx, 0, -50, 50, 'rgba(255,210,90,0.7)', 0.7 + 0.3 * Math.sin(t * 4)); }
    // eyes peeking from the dark
    const gap = Math.sin(th);
    if (gap > 0.04 && dk < 0.9) {
      const tn = Math.tan(Math.min(th, 1.2)), look = Math.sin(t * 0.9) * 2;
      const eyY = (x) => -46 - (HINGE[0] - x) * tn * 0.5 - 2;
      const eo = Object.assign({ slit: 1, blink: P === 'hit' ? s.hitK : blinkAt(t, 3.3, 0.2) }, eyeOpts(s, { color: PAL.candleMid }));
      const ek = 1 + wu * 0.3;
      ctx.save(); ctx.globalAlpha *= 1 - dk;
      Art.enemyEye(ctx, -16 + look, eyY(-16), 3.8 * ek, Object.assign({ rot: 0.25 }, eo));
      Art.enemyEye(ctx, -1 + look, eyY(-1) - 1, 3.2 * ek, Object.assign({ rot: -0.2 }, eo));
      ctx.restore();
    }
    ctx.restore();

    // ---- lid (rotates about the back hinge), drawn in its own frame
    at(ctx, HINGE[0], HINGE[1], th, (c) => {
      c.translate(-HINGE[0], -HINGE[1]);
      const lid = (q) => { q.beginPath(); q.moveTo(-46, -46); q.lineTo(-47, -58); q.quadraticCurveTo(-4, -86, 42, -58); q.lineTo(42, -46); q.closePath(); };
      // upper teeth hanging from the lid rim (point toward the box)
      if (th > 0.06) mimicTeeth(c, -42, 30, -45, 1, 7, 9, 7);
      Art.shape(c, lid, MI.wood, MI.woodSh, { hi: { x: -20, y: -68, rx: 10, ry: 3, rot: -0.25, color: 'rgba(255,230,190,0.25)' } });
      c.save(); lid(c); c.clip();
      c.strokeStyle = 'rgba(26,18,34,0.55)'; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(-50, -58); c.quadraticCurveTo(-4, -76, 46, -60); c.stroke();
      // wood grain
      c.strokeStyle = 'rgba(26,18,34,0.3)'; c.lineWidth = 1;
      for (const y of [-52, -64]) { c.beginPath(); c.moveTo(-30, y); c.quadraticCurveTo(-18, y - 2, -6, y + 1); c.stroke(); }
      c.restore();
      // iron bands over the dome
      for (const bx of [-36, 30]) {
        c.beginPath(); c.moveTo(bx, -46); c.lineTo(bx, -58 - (bx < 0 ? 6 : 4)); Art.strokeOnly(c, 9); c.strokeStyle = MI.iron; c.lineWidth = 5.5; c.stroke();
        rivet(c, bx, -52, 1.5, MI.ironHi); rivet(c, bx, -60, 1.5, MI.ironHi);
      }
      c.beginPath(); c.moveTo(-46, -47.5); c.lineTo(42, -47.5); Art.strokeOnly(c, 6); c.strokeStyle = MI.ironSh; c.lineWidth = 3; c.stroke();
      // dangling lock hasp on the front edge
      const sw = Math.sin(t * 3.1) * 0.25 - th * 0.8;
      at(c, -46, -50, sw, (q) => {
        Art.roundRectPath(q, -5, -2, 10, 16, 2.5); Art.fs(q, PAL.brass, LWT);
        Art.circlePath(q, 0, 6, 2); q.fillStyle = PAL.ink; q.fill(); q.fillRect(-0.8, 6, 1.6, 4);
      });
    });

    // ---- box body (side panel)
    const box = (c) => Art.roundRectPath(c, -46, -46, 88, 46, 5);
    Art.shape(ctx, box, MI.wood, MI.woodSh, { dx: -5, dy: -4 });
    ctx.save(); box(ctx); ctx.clip();
    ctx.strokeStyle = 'rgba(26,18,34,0.6)'; ctx.lineWidth = 1.6;
    for (const y of [-31, -16]) { line(ctx, -46, y, 42, y + 1); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,230,190,0.18)'; ctx.lineWidth = 1;
    for (const [x, y] of [[-20, -39], [10, -24], [-10, -9]]) { ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.quadraticCurveTo(x, y - 2, x + 10, y); ctx.stroke(); }
    // knot hole + scratches
    Art.ellipsePath(ctx, 14, -38, 3, 2); ctx.fillStyle = MI.woodDark; ctx.fill();
    ctx.restore();
    // lower teeth on the rim (pointing up into the mouth)
    if (th > 0.06) mimicTeeth(ctx, -42, 28, -46, -1, 7, 8, 2);
    // rim band + corner brackets + vertical bands
    ctx.beginPath(); ctx.moveTo(-46, -44); ctx.lineTo(42, -44); Art.strokeOnly(ctx, 7); ctx.strokeStyle = MI.iron; ctx.lineWidth = 4; ctx.stroke();
    for (const bx of [-36, 30]) {
      Art.roundRectPath(ctx, bx - 4.5, -46, 9, 46, 2); Art.fs(ctx, MI.iron, LWT);
      ctx.beginPath(); ctx.moveTo(bx + 2.5, -44); ctx.lineTo(bx + 2.5, -2); ctx.strokeStyle = MI.ironSh; ctx.lineWidth = 2; ctx.stroke();
      for (const ry of [-38, -23, -8]) rivet(ctx, bx, ry, 1.6, MI.ironHi);
    }
    for (const [cx, cy, a] of [[-46, 0, 1], [42, 0, -1]]) {
      at(ctx, cx, cy, 0, (c) => { c.scale(a, 1); Art.polyPath(c, [[0, 0], [0, -12], [4, -12], [4, -4], [12, -4], [12, 0]]); Art.fs(c, MI.ironSh, LWT); });
    }
    // little clawed feet peeking under the box
    for (const fx2 of [-34, 24]) {
      Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(fx2 - 7, -2); c.quadraticCurveTo(fx2 - 9, 3, fx2 - 13, 2); c.lineTo(fx2 + 6, 2); c.lineTo(fx2 + 6, -2); c.closePath(); }, MI.woodDark, null, { lw: LWT });
    }

    // ---- tongue lolling over the front rim
    if (tongueK > 0.02) {
      const sw = Math.sin(t * 2.6) * 4 + (wu ? Math.sin(t * 11) * 9 : 0);
      const reach = tongueK;
      const pts = [[14, -47], [-20, -48 - gap * 3], [-44, -45], [-54 + sw * 0.3, lerp(-46, -28, reach)], [-58 + sw * 0.7, lerp(-44, -10, reach)], [-68 + sw, lerp(-44, -6, reach)], [-74 + sw * 1.2, lerp(-46, -16, reach)]];
      if (cast) { pts[3] = [-54, -60]; pts[4] = [-62 + sw, -74]; pts[5] = [-70 + sw, -78]; pts[6] = [-76 + sw, -72]; }
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      Art.curvePath(ctx, pts); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 14 + LW * 2; ctx.stroke();
      Art.curvePath(ctx, pts); ctx.strokeStyle = MI.tongue; ctx.lineWidth = 14; ctx.stroke();
      ctx.translate(1.5, 2.5); Art.curvePath(ctx, pts.slice(1)); ctx.strokeStyle = MI.tongueSh; ctx.lineWidth = 4.5; ctx.stroke();
      ctx.translate(-3, -4); Art.curvePath(ctx, pts.slice(2, 6)); ctx.strokeStyle = 'rgba(255,200,220,0.5)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
      // drool drop
      const dph = (t * 0.7) % 1;
      if (!cast) { Art.ellipsePath(ctx, -73 + sw * 1.2, lerp(-46, -16, reach) + 6 + dph * 10, 2, 2.6 + dph * 1.5); ctx.fillStyle = 'rgba(220,200,255,' + (0.7 * (1 - dph)).toFixed(3) + ')'; ctx.fill(); }
    }
    // gold coins spilled in front
    const coin = (x, y, r, a) => { Art.ellipsePath(ctx, x, y, r, r * 0.45, a); Art.fs(ctx, PAL.gold, 1.6); Art.ellipsePath(ctx, x - r * 0.25, y - r * 0.1, r * 0.35, r * 0.14, a); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill(); };
    coin(-60, -2, 5, 0); coin(-50, 0, 4, 0.1); coin(-84, -1, 4.5, -0.1);
    const gl = (t * 0.5) % 1;
    if (gl < 0.2) Art.glow(ctx, -60, -3, 12, 'rgba(255,230,140,0.8)', Math.sin((gl / 0.2) * Math.PI));
    if (cast) particles(ctx, s, 8, -10, -60, 50, 40, { c1: PAL.gold, c2: PAL.candle, speed: 0.6 });
    if (dk) for (let i = 0; i < 4; i++) { const ph = (t * 0.7 + i / 4) % 1; puff(ctx, -40 + i * 26, -8 - ph * 26, 6 + ph * 8, (1 - ph) * 0.6 * dk, '#b9a98f'); }
    ctx.restore();
  }

  Art.registerEnemy('mimic', {
    info: { height: 100, width: 118, fx: [-34, -50], head: [-4, -112] },
    draw(ctx, pose, opts) {
      const s = st(pose, opts);
      const alpha = s.pose === 'die' ? 1 - 0.97 * ease(seg(s.p, 0.35, 1)) : 1;
      fadeLayer(ctx, alpha, (c) => mimicBody(c, s));
    },
  });

  // ================================================================ ASHLORD 灰輪の主 (boss) — parts
  const AL = {
    stone: '#625b6c', stoneSh: '#403a4a', stoneHi: '#8c849a', ash: '#8f899b', ashSh: '#5f596d',
    mask: '#efe8de', maskSh: '#c6bcb0', voidC: '#0b0610', shroud: '#2a2232', shroudSh: '#18121e',
    ember: '#ff5a2a', hot: '#ffb347', claw: '#1d1424', iron: '#3e3a4c', ironHi: '#7c7892',
    gold: PAL.gold, goldSh: PAL.brass, goldDeep: PAL.brassDark,
  };
  const WR = 126, WCY = -190; // wheel radius / centre y
  // Light offset for Art.shape inside a rotated frame (keeps light from the upper-left).
  const litOff = (rot, d) => ({ dx: -d * (Math.cos(rot) + Math.sin(rot)), dy: -d * (Math.cos(rot) - Math.sin(rot)) });

  // Black flame: three dark tongues with a burning ember rim and a crimson core. Flickers with t.
  function blackFlame(ctx, x, y, size, t, seed, k) {
    if (size <= 1) return;
    k = k == null ? 1 : k;
    const fl = Math.sin(t * 9.1 + seed) * 0.1 + Math.sin(t * 5.3 + seed * 2.3) * 0.08;
    const h = size * (1 + fl), w = size * 0.42;
    const sway = Math.sin(t * 3.7 + seed) * size * 0.2;
    Art.glow(ctx, x, y - h * 0.35, size * 1.5, 'rgba(210,40,60,0.42)', 0.75 * k);
    const lobes = [
      [0, 1, 0],
      [-w * 0.55, 0.58 + 0.08 * Math.sin(t * 7 + seed), -0.45],
      [w * 0.5, 0.66 + 0.08 * Math.sin(t * 6.1 + seed * 1.7), 0.4],
    ];
    const lobe = (c, i) => {
      const [ox, sc, lean] = lobes[i], lh = h * sc, lw = w * (0.6 + sc * 0.4), sw = sway * sc + lean * size * 0.25;
      const bx = x + ox, tipX = bx + sw, tipY = y - lh;
      c.beginPath();
      c.moveTo(tipX, tipY);
      c.bezierCurveTo(bx + lw * 0.2 + sw * 0.6, y - lh * 0.62, bx + lw * 1.1, y - lh * 0.35, bx + lw * 0.8, y - lh * 0.08);
      c.quadraticCurveTo(bx, y + lw * 0.45, bx - lw * 0.8, y - lh * 0.08);
      c.bezierCurveTo(bx - lw * 1.1, y - lh * 0.35, bx - lw * 0.5 + sw * 0.3, y - lh * 0.55, tipX, tipY);
      c.closePath();
    };
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,70,40,0.35)'; ctx.lineWidth = 7;
    for (let i = 0; i < 3; i++) { lobe(ctx, i); ctx.stroke(); }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = AL.ember; ctx.lineWidth = 4;
    for (let i = 0; i < 3; i++) { lobe(ctx, i); ctx.stroke(); }
    ctx.fillStyle = '#11050e';
    for (let i = 0; i < 3; i++) { lobe(ctx, i); ctx.fill(); }
    // crimson core in the main tongue
    ctx.translate(x, y); ctx.scale(0.45, 0.42); ctx.translate(-x, -y + h * 0.05);
    lobe(ctx, 0); ctx.fillStyle = '#5c1230'; ctx.fill();
    ctx.restore();
  }

  function ashWheel(ctx, s, o) {
    const t = s.t, rot = o.rot, heat = o.heat, ph = o.phase;
    ctx.save();
    ctx.rotate(rot);
    // the dark void behind the spokes, lit from within
    Art.circlePath(ctx, 0, 0, 104); ctx.fillStyle = AL.voidC; ctx.fill();
    Art.glow(ctx, 0, 0, 104, ph >= 2 ? 'rgba(255,60,30,0.55)' : 'rgba(150,60,160,0.45)', 0.35 + heat * 0.55);
    // embers smouldering inside the gaps
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) * TAU / 8, r = 74, f = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
      Art.glow(ctx, Math.cos(a) * r, Math.sin(a) * r, 26, ph >= 2 ? 'rgba(255,80,40,0.55)' : 'rgba(170,70,150,0.45)', (0.35 + heat * 0.5) * (0.6 + 0.4 * f));
      ctx.fillStyle = ph >= 2 ? AL.hot : '#c06a9a';
      Art.circlePath(ctx, Math.cos(a) * (r + 6), Math.sin(a) * (r + 6), 1.6 + f); ctx.fill();
    }
    // spokes (bone-like stone bars)
    const lo = litOff(rot, 4);
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8;
      if (o.broken && (i === 2 || i === 5) && ph >= 3) continue;
      ctx.save(); ctx.rotate(a);
      Art.shape(ctx, (c) => { c.beginPath(); c.moveTo(40, -9); c.quadraticCurveTo(70, -6, 104, -13); c.lineTo(104, 13); c.quadraticCurveTo(70, 6, 40, 9); c.closePath(); }, AL.stone, AL.stoneSh, lo);
      ctx.beginPath(); ctx.moveTo(52, 0); ctx.lineTo(96, 0); Art.strokeOnly(ctx, 1.5, AL.stoneSh);
      Art.circlePath(ctx, 72, 0, 3.4); Art.fs(ctx, AL.stoneSh, 1.5);
      ctx.restore();
    }
    // outer toothed rim (ring with a hole)
    const rimPath = (c) => { gearPath(c, 0, 0, WR, 20, 0.08, 0.1); c.moveTo(101, 0); c.arc(0, 0, 101, 0, TAU, true); };
    Art.shape(ctx, rimPath, AL.stone, AL.stoneSh, litOff(rot, 7));
    ctx.beginPath(); ctx.arc(0, 0, 110, 0, TAU); Art.strokeOnly(ctx, 1.5, AL.stoneSh);
    // reverse runes carved into the rim (glow ember once the seals break)
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + 0.11;
      ctx.save(); ctx.rotate(a); ctx.translate(117, 0); ctx.rotate(Math.PI / 2); ctx.scale(-1, 1);
      glyph(ctx, 0, 0, 7, i + 40);
      if (heat > 0.05 && ph >= 2) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,90,40,' + (0.2 + 0.35 * heat).toFixed(3) + ')'; ctx.lineWidth = 3.5; ctx.stroke(); ctx.restore(); }
      ctx.strokeStyle = ph >= 2 ? '#ff8a50' : PAL.ink; ctx.lineWidth = ph >= 2 ? 1.5 : 1.8; ctx.stroke();
      ctx.restore();
    }
    // cracks through the rim and spokes
    const cg = ph >= 2 ? AL.ember : null, cga = ph >= 2 ? 0.4 + 0.6 * heat : 0;
    const polar = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
    crack(ctx, [polar(126, 0.6), polar(116, 0.66), polar(108, 0.62), polar(100, 0.7)], cg, 2, cga);
    crack(ctx, [polar(124, 2.4), polar(113, 2.33), polar(104, 2.4), polar(90, 2.36), polar(76, 2.42)], cg, 2, cga);
    crack(ctx, [polar(126, 4.1), polar(115, 4.18), polar(103, 4.12)], cg, 2, cga);
    crack(ctx, [polar(122, 5.3), polar(110, 5.25), polar(102, 5.33), polar(84, 5.27)], cg, 2, cga);
    // phase 3: chunks bitten out of the rim, glowing edges
    if (ph >= 3) {
      for (const a of [1.2, 3.5, 5.0]) {
        const pts = [polar(130, a - 0.12), polar(114, a - 0.08), polar(104, a - 0.02), polar(112, a + 0.05), polar(130, a + 0.1)];
        Art.polyPath(ctx, pts); ctx.fillStyle = AL.voidC; ctx.fill();
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,90,40,0.8)'; ctx.lineWidth = 3; Art.polyPath(ctx, pts.slice(1, 4), false); ctx.stroke(); ctx.restore();
      }
    }
    // hub ring + bolts
    const hubPath = (c) => { c.beginPath(); c.arc(0, 0, 54, 0, TAU); c.moveTo(42, 0); c.arc(0, 0, 42, 0, TAU, true); };
    Art.shape(ctx, hubPath, AL.stoneHi, AL.stone, litOff(rot, 4));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; rivet(ctx, Math.cos(a) * 48, Math.sin(a) * 48, 2.2, AL.ironHi); }
    ctx.restore();
  }

  function ashMask(ctx, s, o) {
    const t = s.t;
    // dark hub well
    Art.circlePath(ctx, 0, 0, 42); ctx.fillStyle = '#140c18'; ctx.fill();
    Art.glow(ctx, 0, 4, 60, o.phase >= 2 ? 'rgba(255,60,40,0.5)' : 'rgba(255,120,60,0.35)', 0.4 + o.eyeK * 0.3);
    at(ctx, -3, 2, o.tilt, (c) => {
      const m = (q) => { q.beginPath(); q.moveTo(0, -36); q.bezierCurveTo(23, -36, 28, -10, 24, 8); q.bezierCurveTo(20, 26, 9, 37, -1, 40); q.bezierCurveTo(-10, 37, -22, 26, -26, 8); q.bezierCurveTo(-30, -10, -23, -36, 0, -36); q.closePath(); };
      Art.shape(c, m, AL.mask, AL.maskSh, { hi: { x: -10, y: -22, rx: 7, ry: 4, rot: -0.4, color: 'rgba(255,255,255,0.5)' } });
      // sorrowful almond eye holes (angled down outward)
      const eyeHole = (x, a) => { at(c, x, -4, a, (q) => { q.beginPath(); q.moveTo(-9, 0); q.quadraticCurveTo(0, -7, 9, 0); q.quadraticCurveTo(0, 5, -9, 0); q.closePath(); q.fillStyle = PAL.ink; q.fill(); }); };
      eyeHole(-11, 0.28); eyeHole(9, -0.28);
      // ash tears
      c.save(); c.strokeStyle = 'rgba(40,28,48,0.75)'; c.lineCap = 'round';
      for (const [x, len] of [[-13, 22], [-8, 14], [10, 20]]) { c.lineWidth = 2.2; line(c, x, 2, x - 1, 2 + len); c.stroke(); Art.circlePath(c, x - 1, 3 + len, 1.6); c.fillStyle = 'rgba(40,28,48,0.75)'; c.fill(); }
      c.restore();
      // mouth: thin downturned slit
      c.beginPath(); c.moveTo(-11, 24); c.quadraticCurveTo(-1, 17, 9, 24); Art.strokeOnly(c, 2.4);
      // forehead sigil (reverse wheel)
      Art.circlePath(c, -1, -24, 5.5); Art.strokeOnly(c, 1.6, o.phase >= 2 ? AL.ember : '#7a6a80');
      for (let i = 0; i < 6; i++) { const a = -(i / 6) * TAU; line(c, -1, -24, -1 + Math.cos(a) * 5, -24 + Math.sin(a) * 5); Art.strokeOnly(c, 1.2, o.phase >= 2 ? AL.ember : '#7a6a80'); }
      // cracks
      crack(c, [[14, -34], [10, -22], [13, -14], [8, -6]], o.crack > 0.05 ? AL.ember : null, 1.3, o.crack);
      if (o.phase >= 3) crack(c, [[-26, 6], [-18, 10], [-14, 18], [-4, 20], [0, 30]], AL.ember, 1.3, 0.8);
      // glowing eyes
      if (o.eyeA > 0.02) {
        c.save(); c.globalAlpha *= o.eyeA;
        const eo = Object.assign({ slit: 1, blink: o.blink }, s.en || o.phase >= 2 ? RED_EYE : { color: PAL.candleMid, glowColor: 'rgba(255,120,50,0.6)' });
        Art.enemyEye(c, -11, -4, 4.2 * o.eyeK, Object.assign({ rot: 0.28 }, eo));
        Art.enemyEye(c, 9, -4, 4.2 * o.eyeK, Object.assign({ rot: -0.28 }, eo));
        c.restore();
      }
    });
  }

  // Golden seal-lock clamped on the rim at angle a (world frame, wheel centre origin).
  function ashSeal(ctx, s, a, intact, k) {
    const t = s.t;
    const x = Math.cos(a) * 114, y = Math.sin(a) * 114;
    ctx.save(); ctx.translate(x, y);
    if (intact) Art.glow(ctx, 0, 0, 46, 'rgba(255,210,90,0.6)', (0.55 + 0.25 * Math.sin(t * 3 + a)) * k);
    // shackle band wrapping the rim (radial direction)
    ctx.save(); ctx.rotate(a);
    if (intact) {
      Art.shape(ctx, (c) => Art.roundRectPath(c, -20, -8, 40, 16, 6), AL.gold, AL.goldSh, litOff(a, 3));
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(16, 0); Art.strokeOnly(ctx, 1.6, AL.goldDeep);
      rivet(ctx, -12, 0, 1.8, PAL.white); rivet(ctx, 12, 0, 1.8, PAL.white);
    } else {
      // snapped, dull halves
      Art.shape(ctx, (c) => Art.roundRectPath(c, -20, -8, 14, 16, 5), '#8a6a3a', AL.goldDeep);
      Art.shape(ctx, (c) => Art.roundRectPath(c, 8, -8, 12, 16, 5), '#8a6a3a', AL.goldDeep);
    }
    ctx.restore();
    if (intact) {
      // padlock hanging below the band (gravity-aligned)
      const sw = Math.sin(t * 1.7 + a * 3) * 0.12;
      at(ctx, Math.cos(a) * 16, Math.sin(a) * 16, sw, (c) => {
        c.beginPath(); c.arc(0, 6, 8, Math.PI, 0); Art.strokeOnly(c, 7); c.strokeStyle = AL.gold; c.lineWidth = 3.5; c.stroke();
        Art.shape(c, (q) => Art.roundRectPath(q, -13, 6, 26, 22, 6), AL.gold, AL.goldSh, { hi: { x: -6, y: 11, rx: 5, ry: 2.5, color: 'rgba(255,255,255,0.6)' } });
        // seal sigil + keyhole
        Art.circlePath(c, 0, 17, 6.5); Art.strokeOnly(c, 1.4, AL.goldDeep);
        Art.circlePath(c, 0, 15.5, 2.4); c.fillStyle = PAL.ink; c.fill();
        Art.polyPath(c, [[-1.6, 16], [1.6, 16], [2.2, 22], [-2.2, 22]]); c.fill();
        c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 0.5 + 0.5 * Math.sin(t * 4 + a);
        Art.circlePath(c, 0, 17, 6.5); c.strokeStyle = 'rgba(255,240,170,0.9)'; c.lineWidth = 2; c.stroke(); c.restore();
      });
    }
    ctx.restore();
  }

  // Great ash-grey arm. S shoulder, E elbow, W wrist; ha hand angle (fingers along +x); spread 0..1.
  function ashArm(ctx, s, S, E, W, ha, spread, back, heat, chainMode) {
    const col = back ? AL.ashSh : AL.ash, sh = back ? '#423d4e' : AL.ashSh;
    const limb = (A, B, w0, w1) => {
      const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      return (c) => Art.blobPath(c, [[A[0] + nx * w0, A[1] + ny * w0], [(A[0] + B[0]) / 2 + nx * (w0 + w1) * 0.56, (A[1] + B[1]) / 2 + ny * (w0 + w1) * 0.56], [B[0] + nx * w1, B[1] + ny * w1], [B[0] - nx * w1, B[1] - ny * w1], [(A[0] + B[0]) / 2 - nx * (w0 + w1) * 0.5, (A[1] + B[1]) / 2 - ny * (w0 + w1) * 0.5], [A[0] - nx * w0, A[1] - ny * w0]], 0.8);
    };
    Art.shape(ctx, limb(S, E, 24, 17), col, sh);
    // forearm with spines on the outer edge
    const dx = W[0] - E[0], dy = W[1] - E[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    let nx = -uy, ny = ux; if (ny > 0) { nx = -nx; ny = -ny; }
    for (let i = 0; i < 3; i++) {
      const u = 0.25 + i * 0.22, bx = E[0] + dx * u + nx * 15, by = E[1] + dy * u + ny * 15;
      Art.polyPath(ctx, [[bx - ux * 7, by - uy * 7], [bx + nx * 14 + ux * 6, by + ny * 14 + uy * 6], [bx + ux * 7, by + uy * 7]]);
      Art.fs(ctx, AL.claw, LWT);
    }
    Art.shape(ctx, limb(E, W, 18, 14), col, sh);
    // glowing cracks along the arm
    const cg = heat > 0.05 ? AL.ember : null;
    crack(ctx, [[S[0] + (E[0] - S[0]) * 0.2, S[1] + (E[1] - S[1]) * 0.2 + 4], [S[0] + (E[0] - S[0]) * 0.45 + 5, S[1] + (E[1] - S[1]) * 0.45], [S[0] + (E[0] - S[0]) * 0.7, S[1] + (E[1] - S[1]) * 0.7 + 3]], cg, 1.6, heat);
    crack(ctx, [[E[0] + dx * 0.3 - nx * 4, E[1] + dy * 0.3 - ny * 4], [E[0] + dx * 0.5 + nx * 3, E[1] + dy * 0.5 + ny * 3], [E[0] + dx * 0.68 - nx * 2, E[1] + dy * 0.68 - ny * 2]], cg, 1.6, heat);
    // elbow knob
    Art.circlePath(ctx, E[0], E[1], 13); Art.fs(ctx, col, LW);
    Art.circlePath(ctx, E[0], E[1], 13); ctx.save(); ctx.clip(); Art.circlePath(ctx, E[0] - 4, E[1] - 4, 13); ctx.lineWidth = 8; ctx.strokeStyle = sh; ctx.stroke(); ctx.restore();
    Art.circlePath(ctx, E[0], E[1], 13); Art.strokeOnly(ctx, LW);
    // wrist shackle
    const cx = E[0] + dx * 0.86, cy = E[1] + dy * 0.86;
    at(ctx, cx, cy, Math.atan2(dy, dx), (c) => {
      Art.roundRectPath(c, -7, -17, 14, 34, 4); Art.fs(c, AL.iron, LW);
      rivet(c, 0, -10, 2, AL.ironHi); rivet(c, 0, 10, 2, AL.ironHi);
    });
    // chain from the shackle: taut to the ground stake (phase 1) or a broken dangling end
    if (chainMode === 'bound') {
      const gx = cx + (back ? 40 : -40);
      chain(ctx, cx, cy + 6, gx, -4, 18, 9, '#77708a', '#48425a');
      Art.polyPath(ctx, [[gx - 7, -2], [gx + 7, -2], [gx + 3, 6], [gx - 3, 6]]); Art.fs(ctx, AL.iron, LWT);
    } else if (chainMode === 'broken') {
      const sw = Math.sin(s.t * 2.1 + (back ? 1 : 0)) * 10;
      chain(ctx, cx, cy + 6, cx + sw, cy + 52, 4, 9, '#77708a', '#48425a');
    }
    // hand
    at(ctx, W[0], W[1], ha, (c) => {
      const fingers = [[-0.55, 22], [-0.18, 28], [0.2, 27], [0.58, 21]];
      for (let i = 0; i < 4; i++) {
        const fa = fingers[i][0] * (0.7 + spread * 0.9), len = fingers[i][1];
        const k1x = 14 + Math.cos(fa) * len * 0.55, k1y = Math.sin(fa) * len * 0.55 + (i - 1.5) * 4;
        const fa2 = fa + 0.5 - spread * 0.45;
        const tx = k1x + Math.cos(fa2) * len * 0.5, ty = k1y + Math.sin(fa2) * len * 0.5;
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(6, (i - 1.5) * 6); c.lineTo(k1x, k1y); c.lineTo(tx, ty);
        c.strokeStyle = PAL.ink; c.lineWidth = 13; c.stroke(); c.strokeStyle = col; c.lineWidth = 7; c.stroke();
        // talon
        const ca = fa2 + 0.5;
        Art.polyPath(c, [[tx - Math.sin(fa2) * 4, ty + Math.cos(fa2) * 4], [tx + Math.cos(ca) * 14, ty + Math.sin(ca) * 14], [tx + Math.sin(fa2) * 4, ty - Math.cos(fa2) * 4]]);
        Art.fs(c, AL.claw, LWT);
      }
      Art.shape(c, (q) => Art.blobPath(q, [[-4, -14], [12, -16], [20, -6], [20, 8], [10, 16], [-4, 12]]), col, sh);
      // thumb
      c.beginPath(); c.moveTo(4, -12); c.lineTo(12, -24 - spread * 6); Art.strokeOnly(c, 12); c.strokeStyle = col; c.lineWidth = 6; c.stroke();
      Art.polyPath(c, [[9, -25 - spread * 6], [20, -32 - spread * 8], [15, -22 - spread * 6]]); Art.fs(c, AL.claw, LWT);
    });
  }

  // ================================================================ ASHLORD — body
  function ashlordBody(ctx, s) {
    const t = s.t, p = s.p, P = s.pose, o = s.opts;
    const phase = clamp(Math.round(num(o.phase, 1)), 1, 3);
    const seals = phase === 1 ? clamp(Math.round(num(o.seals, 3)), 0, 3) : 0;
    const wu = P === 'windup' ? 1 : 0, cast = P === 'cast' ? 1 : 0, guard = P === 'stance' ? 1 : 0, die = P === 'die';
    const dk = die ? ease(seg(p, 0, 0.8)) : 0;
    const bob = wave(t, 3.2) * 3;
    const heatBase = phase === 1 ? 0.12 : phase === 2 ? 0.55 : 0.8;
    const heat = clamp(heatBase + 0.15 * wave(t, 1.7) + wu * 0.5 + s.wind * 0.4 + s.hitK * 0.6 + cast * 0.2, 0, 1) * (1 - dk);
    const fireK = ((phase === 1 ? 0.7 : phase === 2 ? 1 : 1.45) + wu * 0.35) * (die ? 1 - seg(p, 0, 0.3) : 1);

    // ---- background light: doom glow (phase 3), windup charge, dread
    if (phase >= 3) { const pk = (0.6 + 0.4 * Math.sin(t * 2.6)) * (1 - dk); Art.glow(ctx, 0, WCY, 270, 'rgba(255,30,40,0.32)', pk); Art.glow(ctx, 0, WCY, 170, 'rgba(130,0,50,0.45)', pk); }
    if (wu) Art.glow(ctx, 0, WCY - 40, 240, 'rgba(255,70,30,0.45)', 0.7 + 0.3 * Math.sin(t * 10));
    dreadAura(ctx, s, 0, WCY, 210);

    ctx.save();
    motion(ctx, s, { back: 10, lunge: 26, recoil: 9, lean: 0.035 });
    const shake = wu ? Math.sin(t * 47) * 1.6 + (phase === 1 ? Math.sin(t * 61) * 1.4 : 0) : 0;
    ctx.translate(shake, 0);
    const up = -bob - wu * 6 + guard * 4;
    const cy = WCY + up;
    let rot = phase === 1 ? Math.sin(t * 0.7) * 0.015 + (wu ? Math.sin(t * 35) * 0.012 : 0) : -t * (phase === 2 ? 0.35 : 0.5);
    if (phase === 3) rot += Math.sin(t * 3.3) * 0.025;
    if (P === 'hit') rot += Math.sin(p * 40) * 0.03 * (1 - p);
    const wheelOpts = { rot, heat, phase, broken: phase >= 3 };

    // ---- arm targets
    const pose = (side) => {
      const sg = side; // -1 front(left), +1 back(right)
      let S = [108 * sg, cy - 30], E = [181 * sg, cy + 48 + Math.sin(t * 0.9 + sg) * 2], W = [167 * sg, -60 + Math.sin(t * 1.1 + sg) * 2.5], ha = Math.PI / 2 - 0.25 * sg, sp = 0.35;
      const mix = (E2, W2, ha2, sp2, k) => { E = [lerp(E[0], E2[0], k), lerp(E[1], E2[1], k)]; W = [lerp(W[0], W2[0], k), lerp(W[1], W2[1], k)]; ha = lerp(ha, ha2, k); sp = lerp(sp, sp2, k); };
      const wk = Math.max(wu, s.wind);
      if (wk) mix([178 * sg, cy - 84], [128 * sg, cy - 126 + Math.sin(t * 9) * 2], -Math.PI / 2 + 0.45 * sg, 1, wk);
      if (s.strike) {
        if (sg < 0) mix([-206, cy + 24], [-240, -42], Math.PI / 2 + 0.75, 0.8, s.strike);
        else mix([196, cy + 20], [178, -70], Math.PI / 2 - 0.3, 0.4, s.strike);
      }
      if (cast && sg > 0) mix([196, cy - 58], [176, cy - 140], -Math.PI / 2 - 0.1, 1, 1);
      if (cast && sg < 0) mix([-186, cy + 30], [-160, cy - 10], -0.3, 0.9, 0.6);
      if (guard) mix([150 * sg, cy + 76], [64 * sg, cy + 92], sg < 0 ? 0.15 : Math.PI - 0.15, 0.2, 1);
      if (P === 'hit') { E = [E[0] + 6, E[1] - 12 * s.hitK]; W = [W[0] + 10, W[1] - 24 * s.hitK]; sp += 0.4 * s.hitK; }
      if (die) { const u = eIn(seg(p, 0.1, 0.8)); E = [E[0] * (1 + u * 0.15), E[1] + u * 90]; W = [W[0] * (1 + u * 0.2), W[1] + u * 50]; S = [S[0], S[1] + u * 100]; sp *= 1 - u; }
      return { S, E, W, ha, sp };
    };
    const AF = pose(-1), AB2 = pose(1);
    const chainMode = phase === 1 ? 'bound' : 'broken';

    // ---- black flames crowning the wheel (behind)
    if (fireK > 0.02) {
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.37;
        blackFlame(ctx, Math.cos(a) * (WR - 10), cy + Math.sin(a) * (WR - 10) + 12, (34 + 24 * Art.hash(i * 5.3) + (i === 3 ? 22 : 0)) * fireK, t, i * 2.7, Math.min(1, fireK));
      }
    }
    // ---- great chains draped behind the wheel to the floor
    if (!die || p < 0.5) {
      chain(ctx, -80, cy - 70, -150, -2, 36, 12, '#6c6580', '#3f3a50');
      if (phase === 1) chain(ctx, 86, cy - 64, 156, -2, 36, 12, '#6c6580', '#3f3a50');
      else chain(ctx, 86, cy - 64, 128 + Math.sin(t * 1.4) * 6, cy + 40, 16, 12, '#6c6580', '#3f3a50');
    }

    // ---- ash shroud (lower body) + rubble
    ctx.save();
    if (die) { ctx.translate(0, 0); ctx.scale(1 + dk * 0.15, 1 - dk * 0.55); }
    const hem = [];
    for (let i = 0; i <= 12; i++) { const u = i / 12; hem.push([lerp(-132, 132, u) + Math.sin(t * 1.1 + i) * 2, (i % 2 ? -16 : 0) + Math.sin(t * 1.3 + i * 1.7) * 2.5]); }
    const shroud = (c) => { c.beginPath(); c.moveTo(-78, cy + 40); c.quadraticCurveTo(-118, -90, -134, -4); for (let i = 0; i < hem.length; i++) c.lineTo(hem[i][0], hem[i][1]); c.quadraticCurveTo(118, -90, 78, cy + 40); c.closePath(); };
    Art.shape(ctx, shroud, AL.shroud, AL.shroudSh, { dx: -8, dy: -4 });
    ctx.save(); shroud(ctx); ctx.clip();
    ctx.strokeStyle = AL.shroudSh; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const x of [-80, -40, 0, 44, 86]) { ctx.beginPath(); ctx.moveTo(x * 0.6, cy + 60); ctx.quadraticCurveTo(x + Math.sin(t + x) * 4, -60, x * 1.15, -6); ctx.stroke(); }
    ctx.restore();
    // embers smouldering in the shroud
    particles(ctx, s, 10, 0, -10, 230, 120, { speed: 0.35, size: 2, alpha: 0.9 * (1 - dk) });
    for (let i = 0; i < 4; i++) blackFlame(ctx, -96 + i * 64 + Math.sin(i * 7) * 8, -2, (22 + 10 * Art.hash(i + 9)) * fireK, t, i * 4.1 + 1, 0.6);
    ctx.restore();
    for (const [rx, ry, r, a] of [[-120, -2, 14, 0.2], [-92, 0, 9, 1], [98, -1, 13, -0.3], [128, 0, 9, 0.6], [-30, 2, 8, 0.4]]) {
      at(ctx, rx, ry, a, (c) => Art.shape(c, (q) => Art.polyPath(q, [[-r, 0], [-r * 0.7, -r * 0.8], [r * 0.2, -r], [r, -r * 0.4], [r * 0.9, 0]]), AL.stone, AL.stoneSh, { lw: LWT + 0.5 }));
    }

    if (cast) runeCircle(ctx, 0, cy, WR + 34, -t * 0.8, { line: '#ff7a4a', glow: 'rgba(255,70,40,0.45)' }, 0.6 + 0.4 * Art.pulse(p, 0.4), 1);
    // ---- back arm (behind the wheel unless bracing)
    if (!guard) ashArm(ctx, s, AB2.S, AB2.E, AB2.W, AB2.ha, AB2.sp, true, heat, chainMode);

    // ---- the wheel (or its shattering fragments)
    if (!die) {
      at(ctx, 0, cy, 0, (c) => ashWheel(c, s, wheelOpts));
    } else {
      const u = eOut(seg(p, 0.05, 0.85));
      const K = 7;
      for (let k = 0; k < K; k++) {
        const a0 = (k / K) * TAU + 0.3, a1 = ((k + 1) / K) * TAU + 0.3, am = (a0 + a1) / 2;
        const dist = u * (40 + 50 * Art.hash(k + 1)), fall = u * u * (110 + 60 * Art.hash(k + 7));
        ctx.save();
        ctx.translate(Math.cos(am) * dist, cy + Math.sin(am) * dist * 0.6 + fall);
        ctx.rotate((Art.hash(k + 3) - 0.5) * 1.6 * u);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, WR + 10, a0, a1); ctx.closePath(); ctx.clip();
        ashWheel(ctx, s, wheelOpts);
        ctx.restore();
      }
    }
    // ---- seals (phase 1): golden locks clamped on the rim
    if (phase === 1 && !die) {
      const angs = [Math.PI - 0.55, -Math.PI / 2 - 0.05, 0.55];
      at(ctx, 0, cy, 0, (c) => { for (let i = 0; i < 3; i++) ashSeal(c, s, angs[i], i < seals, 1 + wu * 0.4); });
    }
    // ---- black fire leaking from rim cracks
    if (!die && fireK > 0.05) {
      for (const [a, r, sz] of [[0.64, 118, 15], [2.38, 112, 13], [5.28, 114, 14], [4.15, 118, 11]]) {
        const wa = a + rot;
        blackFlame(ctx, Math.cos(wa) * r, cy + Math.sin(wa) * r, sz * fireK * (phase >= 2 ? 1.2 : 0.8), t, a * 5, 0.8);
      }
    }
    // ---- mask
    {
      const u = die ? eIn(seg(p, 0.15, 0.85)) : 0;
      at(ctx, -u * 30, cy + u * (170 + up), u * -0.7, (c) => ashMask(c, s, {
        phase, eyeK: 1 + wu * 0.6 + s.wind * 0.5 + (phase - 1) * 0.15 + cast * 0.3, eyeA: 1 - dk,
        crack: phase >= 2 ? heat : s.hitK, tilt: Math.sin(t * 0.6) * 0.04 + s.hitK * 0.15 + wu * -0.05,
        blink: P === 'hit' ? s.hitK * 0.8 : blinkAt(t, 6.3, 1.1) * 0.7,
      }));
    }
    // ---- front arm (and back arm when bracing)
    ashArm(ctx, s, AF.S, AF.E, AF.W, AF.ha, AF.sp, false, heat, chainMode);
    if (guard) ashArm(ctx, s, AB2.S, AB2.E, AB2.W, AB2.ha, AB2.sp, false, heat, chainMode);

    // ---- pose effects
    if (wu) { // energy gathering into the wheel: converging sparks + pulsing ring
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) {
        const ph = (t * 0.9 + i / 18) % 1, r = 250 * (1 - ph) + 40, a = (i / 18) * TAU + t * 0.4;
        ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.9;
        ctx.fillStyle = i % 2 ? AL.hot : AL.ember;
        Art.circlePath(ctx, Math.cos(a) * r, cy + Math.sin(a) * r * 0.85, 2.5 + ph * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const A of [AF, AB2]) { Art.glow(ctx, A.W[0], A.W[1] - 18, 46, 'rgba(255,80,40,0.7)', 0.8 + 0.2 * Math.sin(t * 12)); Art.glow(ctx, A.W[0], A.W[1] - 18, 16, 'rgba(255,230,160,0.9)', 0.9); }
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 8);
      Art.circlePath(ctx, 0, cy, WR + 18 + Math.sin(t * 8) * 4); ctx.strokeStyle = 'rgba(255,90,40,0.8)'; ctx.lineWidth = 4; ctx.stroke();
      ctx.restore();
    }
    if (P === 'attack') {
      const k = p < 0.46 ? seg(p, 0.3, 0.46) : 1 - seg(p, 0.46, 0.72);
      swoosh(ctx, -108, cy - 20, 170, -1.9, -3.5, 26, 'rgba(255,90,50,0.55)', k);
      if (p > 0.44) { const u = seg(p, 0.44, 0.9); ctx.save(); ctx.globalAlpha *= 1 - u; Art.ellipsePath(ctx, -236, -4, 30 + u * 90, 6 + u * 14); ctx.strokeStyle = 'rgba(255,140,80,0.8)'; ctx.lineWidth = 4; ctx.stroke(); ctx.restore();
        for (let i = 0; i < 6; i++) puff(ctx, -236 + (i - 2.5) * 26 * (0.5 + u), -8 - u * 20 * Art.hash(i), 8 + u * 8, (1 - u) * 0.7, '#8f8798'); }
    }
    if (cast) {
      particles(ctx, s, 22, 0, cy - 140, 360, -300, { c1: '#b8b0c4', c2: '#6f6880', size: 2.6, speed: 0.4, add: false, alpha: 0.9, drift: 14 });
    }
    if (phase >= 3 && !die) { // crumbling debris
      for (let i = 0; i < 6; i++) {
        const ph = (t * 0.5 + i / 6) % 1, a = Art.hash(i * 9.1) * TAU;
        at(ctx, Math.cos(a) * 120 + ph * 10, cy + Math.sin(a) * 100 + ph * ph * 160, ph * 6 + i, (c) => { Art.polyPath(c, [[-4, -3], [3, -4], [4, 3], [-3, 4]]); Art.fs(c, AL.stone, 1.5); });
      }
    }
    if (die) particles(ctx, s, 26, 0, cy + 60, 320, 260, { c1: '#b8b0c4', c2: AL.ember, size: 2.8, speed: 0.5, alpha: dk, add: false });
    ctx.restore();
  }

  Art.registerEnemy('ashlord', {
    info: { height: 322, width: 332, fx: [-30, -190], head: [0, -340] },
    draw(ctx, pose, opts) {
      const s = st(pose, opts);
      const alpha = s.pose === 'die' ? 1 - 0.97 * ease(seg(s.p, 0.35, 1)) : 1;
      fadeLayer(ctx, alpha, (c) => ashlordBody(c, s));
    },
  });
})();
