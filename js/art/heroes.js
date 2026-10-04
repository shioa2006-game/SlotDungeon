/* EMBERWHEEL — heroes.js : ブラム (knight) / ルゥ (witch) / トト (priest)
 * Contract (docs/ARCH.md "Heroes"): SD.Art.registerHero(id, { draw(ctx, pose, opts), info }).
 *  - Origin (0,0) = feet centre, facing RIGHT, body at negative y. No ground shadow / hit flash (caller does those).
 *  - pose: idle | walk | attack | cast | pray | block | hit | cheer | manip | dead
 *  - opts: { t: seconds (global clock), p: 0..1 one-shot progress, mood: 'normal' | 'worried' | 'happy' }
 * Implementation: every pose is turned into a "rig" (plain numbers from keyframe tracks + t-driven loops);
 * one renderer per hero draws the paper puppet from that rig. Secondary motion (plume, hat, censer chain,
 * pigtail, tassels) is driven by t plus a velocity "lag" estimated by sampling the rig slightly in the past.
 * One-shot poses return to the idle stance at p = 1 (except 'dead', which stays down).
 */
(function () {
  'use strict';
  const SD = (globalThis.SD = globalThis.SD || {});
  const Art = SD.Art;
  if (!Art || !Art.PAL || !Art.registerHero) return;

  const PAL = Art.PAL, LW = Art.LW, LT = Art.LW_THIN;
  const PI = Math.PI, TAU = PI * 2, sin = Math.sin, cos = Math.cos, abs = Math.abs;
  const clamp01 = Art.clamp01, lerp = Art.lerp;
  const frac = (v) => v - Math.floor(v);
  const seg = (p, a, b) => clamp01((p - a) / (b - a));

  // local colours (everything else comes from Art.PAL)
  const C = {
    mail: '#8d91ad', mailShade: '#5f627f', mailLine: '#3f4159', mailBack: '#6a6d88', mailBackShade: '#45475f',
    leather: '#6b4128', leatherShade: '#46291a',
    sabaton: '#7e88a6', sabatonShade: '#535b78', sabatonBack: '#5c6585', sabatonBackShade: '#3e4560',
    steelBack: '#a9b5cc', steelBackShade: '#6f7c99',
    brow: '#3b2418', blush: 'rgba(255,100,120,0.42)',
    hair: '#e0703a', hairShade: '#a8482a', freckle: '#c0613a',
    wood: '#8a5631', woodShade: '#5a3420',
    boot: '#5a3524', bootShade: '#3a2016', bootCuff: '#7a4a30',
    stockA: '#2b1d3d', stockB: '#b9a0e6',
    sash: '#3a2350', ribbon: '#e0453f', ribbonShade: '#a82d2f', hatBand: '#d0602f', hatBandShade: '#9a3f1f',
    patch: '#7d56b5', capelet: '#3d2763', capeletShade: '#2a1a47',
    lining: '#8c7a58', rope: '#b07c43', ropeShade: '#6e4a26', sandal: '#7a4a2a', sandalShade: '#4f2e1a',
    bead: '#6e3f2a', mouth: '#7a2330', tongue: '#ff8a8a',
    sweat: '#a9e6ff', slash: '#fff6d8', mint: '#bfffe0', dust: '#9088bb', dustShade: '#6c6496',
  };

  // ---------------------------------------------------------------------------------------------
  // transform bookkeeping: ROT tracks the accumulated rotation so the crescent shade can stay lit
  // from the upper-left in WORLD space even on rotated parts (swinging arms, falling bodies).
  // ---------------------------------------------------------------------------------------------
  let ROT = 0;
  const RSTK = [];
  function sv(ctx) { ctx.save(); RSTK.push(ROT); }
  function rs(ctx) { ctx.restore(); ROT = RSTK.length ? RSTK.pop() : 0; }
  function rot(ctx, a) { if (a) { ctx.rotate(a); ROT += a; } }
  // Art.shape with world-consistent light direction
  function S(ctx, path, base, shade, o) {
    const k = (o && o.k) || 3.5, c = cos(-ROT), s = sin(-ROT);
    const opts = { dx: -k * c + k * s, dy: -k * s - k * c };
    if (o) { if (o.lw != null) opts.lw = o.lw; if (o.hi) opts.hi = o.hi; }
    Art.shape(ctx, path, base, shade, opts);
  }

  // ---------------------------------------------------------------------------------------------
  // keyframe tracks
  // ---------------------------------------------------------------------------------------------
  const EASE = {
    lin: (u) => u, out: Art.easeOut, in: Art.easeIn, io: Art.easeInOut, back: Art.easeOutBack,
    in2: (u) => u * u, out2: (u) => 1 - (1 - u) * (1 - u),
  };
  // K(p, ease-into-this-key, fields, base?) — missing fields are carried from the previous key.
  const K = (p, e, o, base) => Object.assign({}, base || null, o, { p, e });
  function track(p, keys) {
    const n = keys.length;
    for (let i = 1; i < n; i++) { const a = keys[i - 1], b = keys[i]; for (const f in a) if (!(f in b)) b[f] = a[f]; }
    let a = keys[0], b = keys[0], u = 0;
    if (p >= keys[n - 1].p) { a = b = keys[n - 1]; }
    else if (p > keys[0].p) {
      for (let i = 0; i < n - 1; i++) {
        if (p <= keys[i + 1].p) { a = keys[i]; b = keys[i + 1]; u = (p - a.p) / Math.max(1e-6, b.p - a.p); break; }
      }
    }
    const e = (EASE[b.e] || EASE.io)(u);
    const out = {};
    for (const f in b) {
      if (f === 'p' || f === 'e') continue;
      const va = a[f], vb = b[f];
      out[f] = typeof va === 'number' && typeof vb === 'number' ? va + (vb - va) * e : u < 0.5 ? va : vb;
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // rig geometry helpers
  // ---------------------------------------------------------------------------------------------
  const armPt = (sh, a, l) => [sh[0] + l * sin(a), sh[1] + l * cos(a)];   // a: 0 = down, + = forward (right)
  const along = (pt, a, d) => [pt[0] + d * sin(a), pt[1] - d * cos(a)];   // a: 0 = up,   + = forward
  function applyRoot(ctx, r) {
    ctx.translate(r.x + r.px, r.y + r.py);
    rot(ctx, r.rot);
    ctx.translate(-r.px, -r.py);
    ctx.scale(r.sx, r.sy);
  }
  function rootPt(r, X, Y) {
    const lx = X * r.sx - r.px, ly = Y * r.sy - r.py, c = cos(r.rot), s = sin(r.rot);
    return [lx * c - ly * s + r.x + r.px, lx * s + ly * c + r.y + r.py];
  }
  const isLoopPose = (pose) => pose === 'idle' || pose === 'walk';
  // How far a body point "was" a moment ago (local frame): drives drag on plumes, hats, chains.
  function lagOf(rigFn, pose, t, p, o, r, pt) {
    const q = isLoopPose(pose) ? rigFn(pose, t - 0.06, p, o) : rigFn(pose, t - 0.06, Math.max(0, p - 0.045), o);
    const a = rootPt(r, pt[0] + r.hx, pt[1] + r.hy), b = rootPt(q, pt[0] + q.hx, pt[1] + q.hy);
    const dx = b[0] - a[0], dy = b[1] - a[1], c = cos(-r.rot), s = sin(-r.rot);
    const cl = (v) => Math.max(-14, Math.min(14, v));
    return [cl(dx * c - dy * s), cl(dx * s + dy * c)];
  }
  function blinkAt(t, seed, dur) {
    dur = dur || 0.15;
    const period = 3.3 + seed * 1.1;
    const ph = frac((t + seed * 1.71) / period) * period;
    if (ph < dur) return sin((ph / dur) * PI);
    if (seed > 0.5 && ph > dur + 0.12 && ph < dur * 2 + 0.12) return sin(((ph - dur - 0.12) / dur) * PI);
    return 0;
  }

  // ---------------------------------------------------------------------------------------------
  // path helpers
  // ---------------------------------------------------------------------------------------------
  function roundPoly(ctx, pts, rad) {
    const n = pts.length, a0 = pts[n - 1], b0 = pts[0];
    ctx.beginPath();
    ctx.moveTo((a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], r = Array.isArray(rad) ? rad[i] : rad;
      ctx.arcTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, r);
    }
    ctx.closePath();
  }
  // Outline around a spine with per-point half widths. L side = left of travel (outer side of a back-curl).
  function spineOutline(pts, hw, mulL, mulR) {
    const n = pts.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const nx = -ty, ny = tx;
      const wl = hw[i] * (mulL ? mulL[i] : 1), wr = hw[i] * (mulR ? mulR[i] : 1);
      L.push([pts[i][0] + nx * wl, pts[i][1] + ny * wl]);
      R.push([pts[i][0] - nx * wr, pts[i][1] - ny * wr]);
    }
    return { L, R };
  }
  function capsule(ctx, x1, y1, x2, y2, w, base, shade, lw) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    sv(ctx); ctx.translate(x1, y1); rot(ctx, a);
    S(ctx, (c) => Art.roundRectPath(c, -w / 2, -w / 2, len + w, w, w / 2), base, shade, { k: 2.5, lw: lw == null ? LW : lw });
    rs(ctx);
  }
  // Bell sleeve that rotates with the arm but whose cuff droops toward WORLD-down (cloth hangs).
  function bellSleeve(ctx, sh, a, l, w0, w1, base, shade, cuff) {
    sv(ctx); ctx.translate(sh[0], sh[1]); rot(ctx, -a);
    const dl = [sin(ROT), cos(ROT)], s = dl[0], D = 7 * abs(s);
    const add = (q, k) => [q[0] + dl[0] * k, q[1] + dl[1] * k];
    const downL = s < 0, wl = w1 * (downL ? 1.15 : 0.8 + 0.2 * (1 - abs(s))), wr = w1 * (downL ? 0.8 + 0.2 * (1 - abs(s)) : 1.15);
    let P = [[-w0, -3], [w0, -3], [wr * 0.78, l * 0.55], [wr, l + 1], [0, l + 2.6], [-wl, l + 1], [-wl * 0.78, l * 0.55]];
    P[3] = add(P[3], D * (downL ? 0.25 : 1)); P[4] = add(P[4], D * 0.55); P[5] = add(P[5], D * (downL ? 1 : 0.25));
    P[2] = add(P[2], D * (downL ? 0 : 0.45)); P[6] = add(P[6], D * (downL ? 0.45 : 0));
    const path = (c) => Art.blobPath(c, P, 0.9);
    S(ctx, path, base, shade, { k: 2.6 });
    if (cuff) {
      sv(ctx); path(ctx); ctx.clip();
      const c0 = [P[5][0] - 3, P[5][1] - 2.4], c1 = [P[3][0] + 3, P[3][1] - 2.4], cm = [P[4][0], P[4][1] - 1.2];
      ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.quadraticCurveTo(cm[0], cm[1] + 1, c1[0], c1[1]);
      ctx.lineWidth = 3.4; ctx.strokeStyle = cuff; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c0[0], c0[1] - 2); ctx.quadraticCurveTo(cm[0], cm[1] - 1, c1[0], c1[1] - 2); Art.strokeOnly(ctx, 1);
      rs(ctx);
      path(ctx); Art.strokeOnly(ctx, LW);
    }
    rs(ctx);
  }
  function rivet(ctx, x, y, r, col) {
    Art.circlePath(ctx, x, y, r); ctx.fillStyle = col || PAL.white; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = PAL.ink; ctx.stroke();
  }
  // stroke-built limb (ink outline + colour core): good for thin props (staff, cords)
  function inkStroke(ctx, pathFn, w, col, outline) {
    pathFn(ctx); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = w + (outline == null ? 3 : outline); ctx.strokeStyle = PAL.ink; ctx.stroke();
    pathFn(ctx); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
  }

  // ---------------------------------------------------------------------------------------------
  // faces
  // ---------------------------------------------------------------------------------------------
  function eyesOpen(ctx, x, y, sp, size, o) {
    o = o || {};
    const look = o.look || 0, blink = clamp01(o.blink || 0), lid = o.lid || 0;
    const rx = size * 0.72, ry = size * (1 - blink * 0.92);
    for (const s of [-1, 1]) {
      const ex = x + (s * sp) / 2;
      ctx.save();
      Art.ellipsePath(ctx, ex, y, rx, ry); ctx.fillStyle = PAL.white; ctx.fill();
      if (ry > size * 0.22) {
        ctx.save();
        Art.ellipsePath(ctx, ex, y, rx, ry); ctx.clip();
        const pr = size * (o.pupil || 0.46), px = ex + look * size * 0.28, py = y + size * 0.1;
        Art.ellipsePath(ctx, px, py, pr, pr * 1.08); ctx.fillStyle = PAL.ink; ctx.fill();
        Art.circlePath(ctx, px - pr * 0.36, py - pr * 0.36, pr * 0.38); ctx.fillStyle = PAL.white; ctx.fill();
        Art.circlePath(ctx, px + pr * 0.36, py + pr * 0.42, pr * 0.16); ctx.fill();
        ctx.restore();
      }
      Art.ellipsePath(ctx, ex, y, rx, ry); Art.strokeOnly(ctx, LT);
      if (lid > 0 && ry > size * 0.22) { // heavy, sleepy upper lid drawn over the outline
        const ly = y - ry + 2 * ry * lid;
        ctx.save(); Art.ellipsePath(ctx, ex, y, rx + 1.8, ry + 1.8); ctx.clip();
        ctx.fillStyle = o.lidColor || PAL.skin; ctx.fillRect(ex - rx - 3, y - ry - 3, rx * 2 + 6, ly - (y - ry) + 3);
        ctx.restore();
        ctx.beginPath(); ctx.moveTo(ex - rx - 0.4, ly + 1.1); ctx.quadraticCurveTo(ex, ly - 1.8, ex + rx + 0.4, ly + 1.1);
        Art.strokeOnly(ctx, 1.8);
      }
      if (o.brow) browStroke(ctx, ex, y - size * 1.25, s, size, o.brow, o.browW || LT, o.browC || PAL.ink);
      ctx.restore();
    }
  }
  function browStroke(ctx, ex, by, s, size, kind, w, col) {
    const ix = ex - s * size * 0.55, ox = ex + s * size * 0.75;
    ctx.beginPath();
    if (kind === 'worried') { ctx.moveTo(ix, by - size * 0.32); ctx.lineTo(ox, by + size * 0.18); }
    else if (kind === 'focus') { ctx.moveTo(ix, by + size * 0.28); ctx.lineTo(ox, by - size * 0.22); }
    else { ctx.moveTo(ix, by); ctx.quadraticCurveTo((ix + ox) / 2, by - size * 0.3, ox, by); }
    Art.strokeOnly(ctx, w, col);
  }
  function closedEyes(ctx, x, y, sp, size, lw) {
    for (const s of [-1, 1]) {
      const ex = x + (s * sp) / 2;
      ctx.beginPath(); ctx.moveTo(ex - size * 0.7, y - size * 0.05); ctx.quadraticCurveTo(ex, y + size * 0.65, ex + size * 0.7, y - size * 0.05);
      Art.strokeOnly(ctx, lw || LT);
    }
  }
  // kind: open | happy | hurt | dead | closed
  function eyes(ctx, x, y, sp, size, kind, o) {
    if (kind === 'happy' || kind === 'hurt' || kind === 'dead') { Art.heroEyes(ctx, x, y, sp, size, { mood: kind }); return; }
    if (kind === 'closed') { closedEyes(ctx, x, y, sp, size, o && o.closedW); return; }
    eyesOpen(ctx, x, y, sp, size, o);
  }
  function mouth(ctx, x, y, kind, s) {
    s = s || 1;
    ctx.save();
    if (kind === 'open') {
      ctx.beginPath();
      ctx.moveTo(x - 3.6 * s, y - 1.2 * s); ctx.quadraticCurveTo(x, y - 0.2 * s, x + 3.6 * s, y - 1.2 * s);
      ctx.quadraticCurveTo(x + 3 * s, y + 4.4 * s, x, y + 4.4 * s); ctx.quadraticCurveTo(x - 3 * s, y + 4.4 * s, x - 3.6 * s, y - 1.2 * s);
      ctx.closePath(); ctx.fillStyle = C.mouth; ctx.fill();
      ctx.save(); ctx.clip(); Art.ellipsePath(ctx, x + 0.6 * s, y + 4.3 * s, 2.6 * s, 1.9 * s); ctx.fillStyle = C.tongue; ctx.fill(); ctx.restore();
      Art.strokeOnly(ctx, 1.6);
    } else if (kind === 'o') {
      Art.ellipsePath(ctx, x, y + s, 1.9 * s, 2.5 * s); ctx.fillStyle = C.mouth; ctx.fill(); Art.strokeOnly(ctx, 1.6);
    } else if (kind === 'wavy') {
      ctx.beginPath(); ctx.moveTo(x - 3.2 * s, y + 0.8 * s); ctx.quadraticCurveTo(x - 1.6 * s, y - 0.9 * s, x, y + 0.6 * s);
      ctx.quadraticCurveTo(x + 1.6 * s, y + 2 * s, x + 3.2 * s, y + 0.2 * s); Art.strokeOnly(ctx, 1.6);
    } else if (kind === 'flat') {
      ctx.beginPath(); ctx.moveTo(x - 2.4 * s, y + 0.8 * s); ctx.lineTo(x + 2.4 * s, y + 0.2 * s); Art.strokeOnly(ctx, 1.8);
    } else if (kind === 'cat') {
      ctx.beginPath(); ctx.moveTo(x - 3.4 * s, y); ctx.quadraticCurveTo(x - 1.7 * s, y + 2.8 * s, x, y + 0.4 * s);
      ctx.quadraticCurveTo(x + 1.7 * s, y + 2.8 * s, x + 3.4 * s, y); Art.strokeOnly(ctx, 1.6);
    } else {
      ctx.beginPath(); ctx.moveTo(x - 2.8 * s, y); ctx.quadraticCurveTo(x, y + 2.6 * s, x + 2.8 * s, y); Art.strokeOnly(ctx, 1.7);
    }
    ctx.restore();
  }
  function blush(ctx, x, y, rx, ry) { Art.ellipsePath(ctx, x, y, rx, ry); ctx.fillStyle = C.blush; ctx.fill(); }
  function sweat(ctx, x, y, s, a) {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a;
    ctx.beginPath(); ctx.moveTo(x, y - 4.2 * s);
    ctx.bezierCurveTo(x + 3.2 * s, y, x + 3 * s, y + 3.6 * s, x, y + 3.6 * s);
    ctx.bezierCurveTo(x - 3 * s, y + 3.6 * s, x - 3.2 * s, y, x, y - 4.2 * s);
    Art.fs(ctx, C.sweat, 1.6);
    Art.circlePath(ctx, x - 0.9 * s, y + 1.3 * s, 0.9 * s); ctx.fillStyle = PAL.white; ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------------------------
  // fx helpers (world space)
  // ---------------------------------------------------------------------------------------------
  function spark4(ctx, x, y, r, color, a, ang) {
    if (a <= 0 || r <= 0) return;
    ctx.save(); ctx.globalAlpha *= Math.min(1, a); ctx.translate(x, y); ctx.rotate(ang || 0);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 ? r * 0.26 : r, an = (i * PI) / 4 - PI / 2;
      if (i) ctx.lineTo(cos(an) * rr, sin(an) * rr); else ctx.moveTo(cos(an) * rr, sin(an) * rr);
    }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }
  function puff(ctx, x, y, r, a) {
    if (a <= 0 || r <= 0) return;
    ctx.save(); ctx.globalAlpha *= Math.min(1, a);
    const cs = [[x - r * 0.62, y - r * 0.32, r * 0.58], [x, y - r * 0.55, r * 0.72], [x + r * 0.6, y - r * 0.28, r * 0.52]];
    ctx.fillStyle = PAL.ink;
    for (const c of cs) { Art.circlePath(ctx, c[0], c[1], c[2] + 1.5); ctx.fill(); }
    ctx.fillStyle = C.dust;
    for (const c of cs) { Art.circlePath(ctx, c[0], c[1], c[2]); ctx.fill(); }
    ctx.fillStyle = C.dustShade;
    Art.circlePath(ctx, x + r * 0.15, y - r * 0.2, r * 0.42); ctx.fill();
    ctx.restore();
  }
  function soulEmber(ctx, x, y, t, a) {
    if (a <= 0) return;
    for (let i = 0; i < 2; i++) {
      const ph = frac(t * 0.32 + i * 0.5), k = sin(ph * PI) * a;
      const ex = x + sin(t * 1.9 + i * 2) * 4 + (i ? 7 : -5), ey = y - ph * 34;
      ctx.save(); ctx.globalAlpha *= k;
      Art.flame(ctx, ex, ey, 4.2, t + i * 3, { seed: i * 5, glowColor: 'rgba(255,150,70,0.6)' });
      ctx.restore();
    }
  }
  function polyRibbon(ctx, outer, inner, fill, alpha, edge) {
    if (outer.length < 2) return;
    ctx.save(); ctx.globalAlpha *= alpha;
    ctx.beginPath(); ctx.moveTo(outer[0][0], outer[0][1]);
    for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i][0], outer[i][1]);
    for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i][0], inner[i][1]);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (edge) { Art.curvePath(ctx, outer, 1); ctx.lineWidth = 2; ctx.strokeStyle = edge; ctx.lineCap = 'round'; ctx.stroke(); }
    ctx.restore();
  }

  // =============================================================================================
  // KNIGHT — ブラム : stout, bucket helm with a wide visor showing big friendly eyes, red plume,
  // teal tabard over chainmail, oversized sword (near hand), round ember shield (far arm).
  // =============================================================================================
  const KN = {
    shN: [15, -47], shF: [-15, -47], neck: [3, -50], head: [3, -72],
    hipB: [-9, -15], hipF: [9, -15], footB: -9, footF: 9,
    torso: [[-18, -56], [3, -58], [21, -55], [25, -42], [26, -27], [22, -13], [3, -10], [-19, -13], [-25, -27], [-24, -42]],
    tabard: [[-9, -55], [15, -55], [18, -32], [21, -15], [16, -9], [11, -12.5], [5, -6], [-1, -12.5], [-6, -9], [-12, -15], [-11, -32]],
    helm: [[-16, -92], [3, -95.5], [22, -92], [27, -53], [3, -49.5], [-21, -53]],
    helmR: [8, 40, 8, 5, 40, 5],
    base: { x: 0, y: 0, rot: 0, px: 0, py: 0, sx: 1, sy: 1, hr: 0, hx: 0, hy: 0,
      aN: 0.42, lN: 19, w: 0.3, aF: -0.55, lF: 19, shS: 1, shR: 0, shDX: -4, shDY: -2,
      fbx: 0, fby: 0, ffx: 0, ffy: 0 },
  };

  function knightRig(pose, t, p, o) {
    const B = KN.base, mood = (o && o.mood) || 'normal';
    let r, eye = 'open', brow = 0, shF = false;
    switch (pose) {
      case 'walk': {
        const ph = (t * TAU) / 0.56, s = sin(ph), c = cos(ph);
        r = Object.assign({}, B, {
          y: -abs(c) * 2.6, rot: 0.05, ffx: 6 * s, ffy: -Math.max(0, c) * 4, fbx: -6 * s, fby: -Math.max(0, -c) * 4,
          aN: B.aN - 0.18 * s, aF: B.aF + 0.22 * s, w: B.w - 0.08 * s, hr: 0.025 * s,
        });
        break;
      }
      case 'attack': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.1, 'io', { sy: 1.02, rot: -0.02 }),
          K(0.3, 'out', { rot: -0.15, x: -5, sx: 1.05, sy: 0.92, aN: 3.75, lN: 24, w: -0.72, aF: 0.4, lF: 17, hr: -0.1, ffx: -2 }),
          K(0.42, 'in', { rot: 0.12, x: 15, sx: 0.95, sy: 1.07, aN: 1.3, lN: 21, w: 1.8, aF: -1.0, hr: 0.1, ffx: 9, fbx: -4 }),
          K(0.56, 'out', { rot: 0.1, x: 13, sx: 1.04, sy: 0.95, aN: 1.1, lN: 20, w: 1.92, hr: 0.05 }),
          K(1, 'io', {}, B)]);
        if (p > 0.08 && p < 0.7) brow = 1;
        break;
      }
      case 'cast': { // non-signature: rally — sword raised to the sky
        r = track(p, [K(0, 'lin', {}, B),
          K(0.12, 'out', { sx: 1.05, sy: 0.93, aN: 0.2 }),
          K(0.32, 'back', { aN: 2.45, lN: 24, w: 0.02, sy: 1.06, sx: 0.96, hr: -0.08, aF: -0.95 }),
          K(0.75, 'io', { sy: 1.04 }),
          K(1, 'io', {}, B)]);
        if (p > 0.1 && p < 0.85) brow = 1;
        break;
      }
      case 'pray': { // non-signature: a knightly vow — sword upright, helm bowed, eyes closed
        r = track(p, [K(0, 'lin', {}, B),
          K(0.25, 'out', { aN: 2.0, lN: 14, w: 0.0, hr: 0.1, hy: 1.5, aF: 0.15, sy: 0.98 }),
          K(0.75, 'io', {}),
          K(1, 'io', {}, B)]);
        if (p > 0.2 && p < 0.85) eye = 'closed';
        break;
      }
      case 'block': {
        shF = p > 0.03 && p < 0.93;
        r = track(p, [K(0, 'lin', {}, B),
          K(0.16, 'back', { aF: 1.75, lF: 33, shS: 1.12, shDX: 3, shDY: 4, rot: -0.07, x: -3, sx: 1.05, sy: 0.93, aN: 2.4, lN: 22, w: 0.3, hr: -0.04 }),
          K(0.4, 'io', { x: -2 }),
          K(0.48, 'out', { x: -8, rot: -0.12, sy: 0.89, sx: 1.07 }),
          K(0.62, 'io', { x: -3, rot: -0.07, sy: 0.93, sx: 1.05 }),
          K(0.86, 'io', {}),
          K(1, 'io', {}, B)]);
        brow = 1;
        break;
      }
      case 'hit': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.1, 'out', { x: -13, px: -10, rot: -0.22, sx: 1.1, sy: 0.88, hr: -0.16, aN: 1.0, w: 1.0, aF: -1.1, ffx: 3 }),
          K(0.3, 'out', { x: -10, rot: -0.12, sx: 0.98, sy: 1.03, hr: -0.06 }),
          K(1, 'io', {}, B)]);
        eye = p < 0.55 ? 'hurt' : 'open';
        brow = -1;
        break;
      }
      case 'cheer': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.14, 'out', { sx: 1.1, sy: 0.85, aN: 0.15, aF: -0.2, w: 0.5 }),
          K(0.42, 'out', { y: -30, sx: 0.94, sy: 1.09, aN: 2.45, lN: 24, w: 0.05, aF: -2.5, lF: 22, hr: -0.08, ffy: -4, fby: -6, ffx: 3, fbx: -3 }),
          K(0.62, 'in', { y: 0, sx: 0.97, sy: 1.04, ffy: 0, fby: 0, ffx: 0, fbx: 0 }),
          K(0.72, 'out', { sx: 1.09, sy: 0.88 }),
          K(0.86, 'io', { sx: 0.98, sy: 1.02 }),
          K(1, 'io', {}, B)]);
        if (p > 0.06 && p < 0.97) { eye = 'happy'; brow = 2; }
        break;
      }
      case 'manip': { // Hold: the shield slams down like a clamp
        shF = p > 0.04 && p < 0.94;
        r = track(p, [K(0, 'lin', {}, B),
          K(0.28, 'out', { aF: 2.4, lF: 26, shS: 1.1, shDX: 22, shDY: -25, y: -3, sx: 0.96, sy: 1.06, rot: -0.07, aN: 0.85, lN: 15, w: 1.75, hr: -0.08 }),
          K(0.4, 'in', { aF: 1.3, lF: 33, shS: 1.12, shDX: 6, shDY: 12, y: 0, sx: 1.1, sy: 0.86, rot: 0.1, x: 6, hr: 0.08, ffx: 4, w: 1.95 }),
          K(0.48, 'out', { sx: 1.05, sy: 0.92 }),
          K(0.8, 'io', {}),
          K(1, 'io', {}, B)]);
        brow = 1;
        break;
      }
      case 'dead': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.18, 'out', { sx: 1.1, sy: 0.84, hr: 0.14, aN: 0.7, w: 1.0, aF: -0.2, py: -45 }),
          K(0.6, 'in', { rot: -1.5, y: 20, sx: 1, sy: 1, hr: -0.08, aN: 1.7, lN: 17, aF: -1.6, lF: 17 }),
          K(0.72, 'out', { rot: -1.36, y: 15 }),
          K(0.84, 'in', { rot: -1.5, y: 20 }),
          K(0.92, 'out', { rot: -1.46, y: 18.6 }),
          K(1, 'io', { rot: -1.5, y: 20 })]);
        eye = p < 0.5 ? 'hurt' : 'dead';
        brow = p < 0.5 ? -1 : 0;
        break;
      }
      default:
        r = Object.assign({}, B);
    }
    if (eye === 'open' && isLoopPose(pose)) {
      if (mood === 'happy') { eye = 'happy'; brow = 2; }
    }
    if (mood === 'worried' && eye === 'open' && brow === 0) brow = -1;
    if (pose !== 'dead') {
      const b = sin((t * TAU) / 1.9);
      r.sy *= 1 + 0.018 * b; r.sx *= 1 - 0.01 * b;
      r.hy += sin((t * TAU) / 1.9 - 0.7) * 0.7;
    }
    r.blink = eye === 'open' ? blinkAt(t, 0.2) : 0;
    r.eye = eye; r.brow = brow; r.shF = shF;
    r.nBack = pose === 'attack' && r.aN > 2.62;
    r.worried = mood === 'worried';
    return r;
  }

  function knPauldron(ctx, x, y, rx, ry, a, back) {
    sv(ctx); ctx.translate(x, y); rot(ctx, a);
    const base = back ? C.steelBack : '#c3cee2', shade = back ? C.steelBackShade : PAL.steelShade;
    S(ctx, (c) => { c.beginPath(); c.ellipse(0, ry * 0.5, rx * 0.84, ry * 0.68, 0, -0.1, PI + 0.1); c.closePath(); }, base, shade, { k: 2, lw: LT });
    const dome = (c) => { c.beginPath(); c.ellipse(0, 0, rx, ry, 0, PI, TAU); c.quadraticCurveTo(0, ry * 0.9, -rx, 0); c.closePath(); };
    S(ctx, dome, base, shade, { k: 2.4 });
    sv(ctx); dome(ctx); ctx.clip();
    ctx.beginPath(); ctx.moveTo(-rx, 0.4); ctx.quadraticCurveTo(0, ry * 0.92, rx, 0.4); ctx.lineWidth = 3.2; ctx.strokeStyle = PAL.brass; ctx.stroke();
    rs(ctx);
    dome(ctx); Art.strokeOnly(ctx, LW);
    rivet(ctx, -rx * 0.36, -ry * 0.3, 1.3, back ? C.steelBack : PAL.white);
    rs(ctx);
  }
  function knGauntlet(ctx, x, y, a, back) {
    sv(ctx); ctx.translate(x, y); rot(ctx, a);
    S(ctx, (c) => Art.roundRectPath(c, -6, -5.5, 12, 11, 4.6), back ? C.steelBack : PAL.steel, back ? C.steelBackShade : PAL.steelShade, { k: 2 });
    ctx.beginPath(); ctx.moveTo(-4.8, -1.2); ctx.lineTo(4.8, -1.2); Art.strokeOnly(ctx, 1.4);
    rs(ctx);
  }
  function knSword(ctx, x, y, a) {
    sv(ctx); ctx.translate(x, y); rot(ctx, a);
    S(ctx, (c) => Art.roundRectPath(c, -2.7, 1, 5.4, 11, 2), C.leather, C.leatherShade, { k: 1.4, lw: LT });
    ctx.beginPath(); ctx.moveTo(-2.4, 5); ctx.lineTo(2.4, 3.5); ctx.moveTo(-2.4, 9); ctx.lineTo(2.4, 7.5); Art.strokeOnly(ctx, 1, C.leatherShade);
    S(ctx, (c) => Art.circlePath(c, 0, 13.8, 3.7), PAL.brass, PAL.brassDark, { k: 1.4, lw: LT });
    const blade = (c) => Art.polyPath(c, [[-5.6, -9], [-5, -58], [0, -72], [5, -58], [5.6, -9]]);
    S(ctx, blade, PAL.steel, PAL.steelShade, { k: 2.3 });
    ctx.beginPath(); ctx.moveTo(0.2, -14); ctx.lineTo(0.2, -54); Art.strokeOnly(ctx, 1.4, PAL.steelShade);
    ctx.beginPath(); ctx.moveTo(-3.3, -12); ctx.lineTo(-2.9, -56); Art.strokeOnly(ctx, 1.2, 'rgba(255,255,255,0.9)');
    S(ctx, (c) => Art.roundRectPath(c, -12.5, -11.2, 25, 5.6, 2.8), PAL.brass, PAL.brassDark, { k: 1.5, lw: LT });
    for (const s of [-1, 1]) { Art.circlePath(ctx, s * 13.2, -8.4, 2.7); Art.fs(ctx, PAL.brassLight, LT); }
    Art.circlePath(ctx, 0, -8.4, 2.5); Art.fs(ctx, PAL.ember, 1.2);
    Art.circlePath(ctx, -0.7, -9.2, 0.8); ctx.fillStyle = PAL.candle; ctx.fill();
    rs(ctx);
  }
  function emberEmblem(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.15, y - s);
    ctx.bezierCurveTo(x + s * 0.4, y - s * 0.55, x + s * 0.85, y - s * 0.25, x + s * 0.75, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.68, y + s * 0.72, x + s * 0.3, y + s * 0.85, x, y + s * 0.85);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.85, x - s * 0.8, y + s * 0.5, x - s * 0.7, y + s * 0.05);
    ctx.bezierCurveTo(x - s * 0.62, y - s * 0.3, x - s * 0.35, y - s * 0.4, x - s * 0.3, y - s * 0.62);
    ctx.bezierCurveTo(x - s * 0.1, y - s * 0.4, x + s * 0.05, y - s * 0.6, x + s * 0.15, y - s);
    ctx.closePath();
    Art.fs(ctx, PAL.flame, 1.6);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.05, y - s * 0.28);
    ctx.bezierCurveTo(x + s * 0.45, y + s * 0.05, x + s * 0.4, y + s * 0.6, x, y + s * 0.6);
    ctx.bezierCurveTo(x - s * 0.4, y + s * 0.6, x - s * 0.42, y + s * 0.1, x + s * 0.05, y - s * 0.28);
    ctx.fillStyle = PAL.candle; ctx.fill();
  }
  function knShield(ctx, x, y, R, a) {
    sv(ctx); ctx.translate(x, y); rot(ctx, a || 0);
    S(ctx, (c) => Art.circlePath(c, 0, 0, R), PAL.brass, PAL.brassDark, { k: 3 });
    const fr = R - 4.6;
    S(ctx, (c) => Art.circlePath(c, 0, 0, fr), PAL.knightTabard, PAL.knightTabardShade,
      { k: 3.5, lw: LT, hi: { x: -fr * 0.42, y: -fr * 0.5, rx: fr * 0.38, ry: fr * 0.16, rot: -0.7, color: 'rgba(255,255,255,0.2)' } });
    sv(ctx); Art.circlePath(ctx, 0, 0, fr); ctx.clip();
    ctx.beginPath(); ctx.moveTo(-fr * 0.4, -fr); ctx.lineTo(-fr * 0.4, fr); ctx.moveTo(fr * 0.4, -fr); ctx.lineTo(fr * 0.4, fr);
    Art.strokeOnly(ctx, 1.3, PAL.knightTabardShade);
    rs(ctx);
    for (let i = 0; i < 8; i++) { const an = (i * TAU) / 8 + 0.39; rivet(ctx, cos(an) * (R - 2.3), sin(an) * (R - 2.3), 1.15, PAL.brassLight); }
    Art.circlePath(ctx, 0, 0.5, fr * 0.6); ctx.fillStyle = PAL.knightTabardShade; ctx.fill();
    Art.strokeOnly(ctx, 3.4); Art.circlePath(ctx, 0, 0.5, fr * 0.6); Art.strokeOnly(ctx, 1.6, PAL.brassLight);
    emberEmblem(ctx, 0, 0.8, fr * 0.48);
    // a battle notch in the rim
    ctx.beginPath(); ctx.moveTo(R * 0.62, -R * 0.72); ctx.lineTo(R * 0.5, -R * 0.62); ctx.lineTo(R * 0.7, -R * 0.6); Art.strokeOnly(ctx, 1.4);
    rs(ctx);
  }
  function knLeg(ctx, hip, fx, fy, back) {
    capsule(ctx, hip[0], hip[1], fx, fy - 6, 10, back ? C.steelBack : PAL.steel, back ? C.steelBackShade : PAL.steelShade);
    const boot = (c) => Art.blobPath(c, [[fx - 6.5, fy], [fx + 9, fy], [fx + 10.8, fy - 4], [fx + 5, fy - 8.8], [fx - 6, fy - 9.6]], 0.75);
    S(ctx, boot, back ? C.sabatonBack : C.sabaton, back ? C.sabatonBackShade : C.sabatonShade, { k: 2.5 });
    ctx.beginPath(); ctx.moveTo(fx + 2.4, fy - 8.7); ctx.quadraticCurveTo(fx + 5.6, fy - 4.6, fx + 3, fy - 0.8); Art.strokeOnly(ctx, 1.4);
  }
  function knTorso(ctx) {
    const body = (c) => Art.blobPath(c, KN.torso, 1);
    S(ctx, body, C.mail, C.mailShade, { k: 4 });
    sv(ctx); body(ctx); ctx.clip();
    ctx.lineWidth = 1; ctx.strokeStyle = C.mailLine; ctx.globalAlpha *= 0.45;
    for (let row = 0; row < 12; row++) {
      const y = -58 + row * 4.2;
      ctx.beginPath();
      for (let x = -28 + (row % 2) * 2.5; x < 30; x += 5) { ctx.moveTo(x - 2.4, y); ctx.arc(x, y, 2.4, PI, 0, true); }
      ctx.stroke();
    }
    rs(ctx);
    const tab = (c) => roundPoly(c, KN.tabard, 2.5);
    S(ctx, tab, PAL.knightTabard, PAL.knightTabardShade, { k: 3.5, hi: { x: -5, y: -42, rx: 2.6, ry: 9, color: 'rgba(255,255,255,0.13)' } });
    sv(ctx); ctx.setLineDash([2.6, 2.2]);
    ctx.beginPath(); ctx.moveTo(-7.4, -50); ctx.lineTo(-9.4, -17.5); ctx.moveTo(12.8, -50); ctx.lineTo(17.4, -17.5);
    Art.strokeOnly(ctx, 1.3, '#7cc0da');
    ctx.setLineDash([]);
    rs(ctx);
    // emberwheel insignia
    const ix = 5, iy = -42.5;
    Art.circlePath(ctx, ix, iy, 4.6); Art.strokeOnly(ctx, 3.6); Art.circlePath(ctx, ix, iy, 4.6); Art.strokeOnly(ctx, 1.8, PAL.brassLight);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) { const an = (i * PI) / 3 + 0.3; ctx.moveTo(ix + cos(an) * 4.4, iy + sin(an) * 4.4); ctx.lineTo(ix - cos(an) * 4.4, iy - sin(an) * 4.4); }
    Art.strokeOnly(ctx, 1.1, PAL.brassLight);
    Art.circlePath(ctx, ix, iy, 1.7); Art.fs(ctx, PAL.ember, 1);
    // belt
    sv(ctx); body(ctx); ctx.clip();
    ctx.beginPath(); ctx.moveTo(-30, -35); ctx.quadraticCurveTo(3, -31.5, 32, -35); ctx.lineTo(32, -28.6); ctx.quadraticCurveTo(3, -25, -30, -28.6); ctx.closePath();
    Art.fs(ctx, C.leather, LT);
    ctx.beginPath(); ctx.moveTo(-30, -33.4); ctx.quadraticCurveTo(3, -29.9, 32, -33.4); Art.strokeOnly(ctx, 1, '#8c5a3a');
    rs(ctx);
    S(ctx, (c) => Art.roundRectPath(c, 2.5, -35.5, 8.5, 9, 2), PAL.brass, PAL.brassDark, { k: 1.5, lw: LT });
    ctx.beginPath(); ctx.moveTo(5, -31); ctx.lineTo(9.5, -31); Art.strokeOnly(ctx, 1.4);
    body(ctx); Art.strokeOnly(ctx, LW);
    knPauldron(ctx, -14, -51, 10, 8, -0.3, true);
  }
  function knBrows(ctx, kind) {
    const L = [[-4.5, -77.5], [3.5, -78]], R = [[11, -78], [18.5, -77.5]];
    let a = 0, b = 0, c = 0, d = 0;
    if (kind === 1) { a = -1.6; b = 1.7; c = 1.7; d = -1.6; }
    else if (kind === -1) { a = 1.4; b = -1.6; c = -1.6; d = 1.4; }
    else if (kind === 2) { a = -1.2; b = -1.8; c = -1.8; d = -1.2; }
    ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1] + a); ctx.lineTo(L[1][0], L[1][1] + b);
    ctx.moveTo(R[0][0], R[0][1] + c); ctx.lineTo(R[1][0], R[1][1] + d);
    Art.strokeOnly(ctx, 2.8, C.brow);
  }
  function knPlume(ctx, t, lag) {
    const bx = 3, by = -95;
    const SP = [[0, 0], [1.5, -8], [-1, -15.5], [-8, -20], [-17, -19.5], [-24.5, -14.5]];
    const HW = [3.6, 6.2, 7.6, 6.8, 5, 2.2];
    const WT = [0, 0.1, 0.3, 0.55, 0.8, 1];
    const swx = sin(t * 2.3) * 2.2 + lag[0] * 0.9, swy = cos(t * 2.3 + 0.5) * 1 + lag[1] * 0.7;
    const pts = SP.map((q, i) => [bx + q[0] + swx * WT[i], by + q[1] + swy * WT[i]]);
    const { L, R } = spineOutline(pts, HW, null, [1, 1.12, 0.9, 1.12, 0.92, 1]);
    const outline = L.concat(R.slice().reverse());
    S(ctx, (c) => Art.blobPath(c, outline, 1), PAL.knightPlume, PAL.knightPlumeShade, { k: 3 });
    // feather strands
    const strand = (off, col, w) => {
      const sp = pts.slice(1).map((q, i) => {
        const j = i + 1, a = pts[j - 1], b = pts[Math.min(pts.length - 1, j + 1)];
        let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        return [q[0] - ty * HW[j] * off, q[1] + tx * HW[j] * off];
      });
      Art.curvePath(ctx, sp, 1); Art.strokeOnly(ctx, w, col);
    };
    strand(0.45, '#ff8a76', 1.5);
    strand(-0.15, PAL.knightPlumeShade, 1.4);
    strand(-0.6, PAL.knightPlumeShade, 1.2);
  }
  function knHead(ctx, r, t, lag) {
    sv(ctx);
    ctx.translate(r.hx + KN.neck[0], r.hy + KN.neck[1]); rot(ctx, r.hr); ctx.translate(-KN.neck[0], -KN.neck[1]);
    knPlume(ctx, t, lag);
    S(ctx, (c) => Art.roundRectPath(c, -1, -99.5, 8, 7.5, 2.5), PAL.brass, PAL.brassDark, { k: 2, lw: LT });
    const helm = (c) => roundPoly(c, KN.helm, KN.helmR);
    S(ctx, helm, PAL.steel, PAL.steelShade, { k: 5, hi: { x: -11.5, y: -73, rx: 3, ry: 15, color: 'rgba(255,255,255,0.65)' } });
    sv(ctx); helm(ctx); ctx.clip();
    ctx.beginPath(); ctx.moveTo(-26, -85.5); ctx.quadraticCurveTo(3, -84, 32, -85.5);
    ctx.moveTo(-26, -56.5); ctx.quadraticCurveTo(3, -52.5, 32, -56.5);
    Art.strokeOnly(ctx, LT);
    ctx.beginPath(); ctx.moveTo(4, -97); ctx.lineTo(4, -85); Art.strokeOnly(ctx, LT);
    ctx.beginPath(); ctx.moveTo(2.2, -94); ctx.lineTo(2.2, -87); Art.strokeOnly(ctx, 1.2, 'rgba(255,255,255,0.85)');
    ctx.beginPath(); ctx.moveTo(-16, -66); ctx.quadraticCurveTo(-13.5, -64, -11.5, -64.6); Art.strokeOnly(ctx, 1.3, PAL.steelShade);
    rs(ctx);
    for (const x of [-12, -3.5, 12, 20]) rivet(ctx, x, -88.8, 1.3);
    for (const x of [-15, -6, 4, 13, 22]) rivet(ctx, x, -52.3 - ((x - 3) / 24) * ((x - 3) / 24) * 2.2, 1.3);
    ctx.fillStyle = PAL.ink;
    for (const x of [12, 15.6, 19.2]) { Art.circlePath(ctx, x, -59, 0.95); ctx.fill(); }
    // visor opening with Bram's face
    const slot = (c) => Art.roundRectPath(c, -9, -81, 32, 19, 7);
    slot(ctx); ctx.fillStyle = PAL.skin; ctx.fill();
    sv(ctx); slot(ctx); ctx.clip();
    ctx.fillStyle = PAL.skinShade;
    ctx.beginPath(); ctx.moveTo(-10, -82); ctx.lineTo(24, -82); ctx.lineTo(24, -77.5); ctx.quadraticCurveTo(7, -75.8, -10, -77.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(26,18,34,0.2)'; ctx.fillRect(-10, -82, 3.2, 22);
    blush(ctx, -5, -65.2, 3.2, 1.7); blush(ctx, 20, -65.2, 2.8, 1.6);
    const ek = r.eye;
    if (ek === 'open') eyesOpen(ctx, 7, -71.5, 16, 6, { look: 0.35, blink: r.blink, pupil: r.brow === 1 ? 0.4 : 0.46 });
    else eyes(ctx, 7, -71.5, 16, 6, ek, { closedW: 2.4 });
    if (ek !== 'dead') knBrows(ctx, r.brow);
    rs(ctx);
    slot(ctx); Art.strokeOnly(ctx, 2.6);
    ctx.beginPath(); ctx.moveTo(-6, -61.6); ctx.lineTo(20, -61.6); Art.strokeOnly(ctx, 1.1, 'rgba(255,255,255,0.7)');
    if (r.worried && r.eye === 'open') sweat(ctx, -17.5, -79 + sin(t * 3) * 0.6, 1, 1);
    rs(ctx);
  }
  function knArmN(ctx, r, h, withSword) {
    const sh = KN.shN;
    capsule(ctx, sh[0], sh[1], h[0], h[1], 11, C.mail, C.mailShade);
    knPauldron(ctx, sh[0] + 1.5, sh[1] + 0.5, 9.6, 7, 0.32 + (r.aN - 0.42) * 0.14, false);
    if (withSword) knSword(ctx, h[0], h[1], r.w);
    knGauntlet(ctx, h[0], h[1], withSword ? r.w : r.aN, false);
  }
  function knArmF(ctx, r, h) {
    capsule(ctx, KN.shF[0], KN.shF[1], h[0], h[1], 10, C.mailBack, C.mailBackShade);
    knGauntlet(ctx, h[0], h[1], 0, true);
  }
  const knSwordTip = (r, d) => { const h = armPt(KN.shN, r.aN, r.lN); const q = along(h, r.w, d); return rootPt(r, q[0], q[1]); };
  const knShieldC = (r) => { const h = armPt(KN.shF, r.aF, r.lF); return [h[0] + r.shDX, h[1] + r.shDY]; };

  function knProps(ctx, t, p, o, layer) {
    if (p < 0.2) return;
    const r0 = knightRig('dead', t, 0.2, o);
    const e = Art.easeIn(seg(p, 0.2, 0.5));
    if (layer === 'back') {
      // shield tumbles behind him and comes to rest standing on its rim
      const c0l = knShieldC(r0), c0 = rootPt(r0, c0l[0], c0l[1]);
      const sx = lerp(c0[0], -30, e), sy = lerp(c0[1], -19, e) - sin(e * PI) * 12;
      const wob = p > 0.5 ? sin((p - 0.5) * 38) * 0.18 * (1 - seg(p, 0.5, 0.85)) : 0;
      knShield(ctx, sx, sy, 19, lerp(0, -0.28, e) + wob);
    } else {
      // sword spins once and plants itself point-down beside him
      const h0 = armPt(KN.shN, r0.aN, r0.lN), s0 = rootPt(r0, h0[0], h0[1]);
      const gx = lerp(s0[0], 63, e), gy = lerp(s0[1], -61, e) - sin(e * PI) * 22;
      const a = lerp(r0.w + r0.rot, PI + 0.17 + TAU, e);
      const wob = p > 0.5 ? sin((p - 0.5) * 46) * 0.07 * (1 - seg(p, 0.5, 0.8)) : 0;
      sv(ctx);
      ctx.beginPath(); ctx.rect(-400, -400, 800, 400); ctx.clip();
      knSword(ctx, gx, gy, a + wob);
      rs(ctx);
      if (p > 0.48) {
        const k = 1 - seg(p, 0.48, 0.8);
        puff(ctx, 50, 0, 6 + (1 - k) * 4, k); puff(ctx, 61, 1, 5 + (1 - k) * 3, k * 0.8);
      }
    }
  }

  // the slash arc is drawn BEHIND the knight so his silhouette stays readable
  function knSwoosh(ctx, t, p, o) {
    if (p <= 0.31) return;
    const pa = Math.max(0.3, p - 0.11), pb = Math.min(p, 0.47), fade = 1 - seg(p, 0.43, 0.62);
    if (pb <= pa + 0.004 || fade <= 0) return;
    const N = 14, outer = [], inner = [], core = [];
    for (let i = 0; i <= N; i++) {
      const pp = pa + ((pb - pa) * i) / N, q = knightRig('attack', t, pp, o), u = i / N;
      outer.push(knSwordTip(q, 78));
      inner.push(knSwordTip(q, 78 - 22 * Math.pow(u, 0.75)));
      core.push(knSwordTip(q, 78 - 9 * Math.pow(u, 0.75)));
    }
    sv(ctx); ctx.globalCompositeOperation = 'lighter';
    polyRibbon(ctx, outer, inner, 'rgba(255,170,90,0.45)', fade);
    rs(ctx);
    polyRibbon(ctx, outer, inner, 'rgba(255,236,200,0.55)', fade);
    polyRibbon(ctx, outer, core, C.slash, 0.95 * fade, 'rgba(255,255,255,0.95)');
    const tip = outer[outer.length - 1];
    Art.glow(ctx, tip[0], tip[1], 30, 'rgba(255,230,170,0.7)', fade);
  }
  function knFx(ctx, pose, t, p, o, r) {
    if (pose === 'attack' && p > 0.3) {
      if (p > 0.4 && p < 0.6) {
        const k = 1 - seg(p, 0.4, 0.6), tip = knSwordTip(r, 72);
        for (let i = 0; i < 4; i++) spark4(ctx, tip[0] + 6 + i * 7 * (1 - k), tip[1] - 6 - i * 5 * (1 - k), 4.5 * k, PAL.candle, k, i);
      }
    } else if (pose === 'cast') {
      const k = Art.pulse(seg(p, 0.22, 0.95), 0.25);
      if (k > 0) {
        const tip = knSwordTip(r, 73);
        Art.glow(ctx, tip[0], tip[1], 34 * k, 'rgba(255,225,160,0.75)', k);
        spark4(ctx, tip[0], tip[1], 13 * k, PAL.star, k, t * 1.5);
        spark4(ctx, tip[0], tip[1], 7 * k, PAL.white, k, PI / 4 + t * 1.5);
      }
    } else if (pose === 'pray') {
      const k = Art.pulse(seg(p, 0.15, 0.95), 0.3);
      if (k > 0) {
        const g = knSwordTip(r, 8.4);
        Art.glow(ctx, g[0], g[1], 30 * k, 'rgba(255,170,80,0.7)', k);
        const tip = knSwordTip(r, 60 * k + 10);
        spark4(ctx, tip[0], tip[1], 5 * k, PAL.candle, k, t);
      }
    } else if (pose === 'manip' && p > 0.38) {
      const k = 1 - seg(p, 0.38, 0.85), c = knShieldC(r), w = rootPt(r, c[0], c[1] + 19 * r.shS);
      const gx = w[0], ex = 1 - k;
      puff(ctx, gx - 14 - ex * 14, -1, 6 + ex * 5, k);
      puff(ctx, gx + 16 + ex * 16, -1, 6 + ex * 5, k);
      sv(ctx); ctx.globalAlpha *= k;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const an = -PI * (0.12 + i * 0.19), r0 = 22 + ex * 10, r1 = r0 + 10;
        ctx.moveTo(gx + cos(an) * r0, -2 + sin(an) * r0 * 0.75); ctx.lineTo(gx + cos(an) * r1, -2 + sin(an) * r1 * 0.75);
      }
      Art.strokeOnly(ctx, 2.4, PAL.brassLight);
      rs(ctx);
      const sc = rootPt(r, c[0], c[1]);
      sv(ctx); ctx.globalAlpha *= k;
      Art.ellipsePath(ctx, sc[0], sc[1], 22 + ex * 18, 22 + ex * 18); Art.strokeOnly(ctx, 3 * k + 0.5, PAL.gold);
      rs(ctx);
      Art.glow(ctx, sc[0], sc[1], 40, 'rgba(255,210,87,0.55)', k);
    } else if (pose === 'block' && p > 0.42 && p < 0.75) {
      const k = 1 - seg(p, 0.44, 0.75), c = knShieldC(r), w = rootPt(r, c[0] + 18, c[1]);
      Art.glow(ctx, w[0], w[1], 34, 'rgba(111,211,255,0.6)', k);
      sv(ctx); ctx.globalAlpha *= k;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath(); ctx.arc(w[0] - 6, w[1], 12 + i * 8 + (1 - k) * 10, -0.9, 0.9); Art.strokeOnly(ctx, 2.6 - i * 0.8, PAL.ward);
      }
      rs(ctx);
      for (let i = 0; i < 3; i++) spark4(ctx, w[0] + 4 + i * 6 * (1 - k + 0.4), w[1] - 10 + i * 9, 4 * k, PAL.white, k, i);
    } else if (pose === 'cheer') {
      const k = Art.pulse(seg(p, 0.25, 0.9), 0.3), hd = rootPt(r, 3, -100);
      for (let i = 0; i < 4; i++) {
        const an = t * 2 + i * 1.6;
        spark4(ctx, hd[0] + cos(an) * 30, hd[1] + sin(an) * 12 - 6, 5 * k, i % 2 ? PAL.gold : PAL.star, k, an);
      }
    } else if (pose === 'hit' && p < 0.55) {
      const k = 1 - seg(p, 0.05, 0.55), hd = rootPt(r, -12, -86);
      sweat(ctx, hd[0] - (1 - k) * 10, hd[1] - (1 - k) * 8, 1, k);
    } else if (pose === 'dead' && p > 0.82) {
      soulEmber(ctx, -4, -62, t, seg(p, 0.82, 1));
    }
  }

  function drawKnight(ctx, pose, o) {
    o = o || {};
    const t = +o.t || 0, p = clamp01(+o.p || 0), dead = pose === 'dead';
    const r = knightRig(pose, t, p, o);
    const lag = lagOf(knightRig, pose, t, p, o, r, KN.head);
    ROT = 0; RSTK.length = 0;
    sv(ctx);
    const inHand = !dead || p < 0.2;
    if (dead) knProps(ctx, t, p, o, 'back');
    if (pose === 'attack') knSwoosh(ctx, t, p, o);
    sv(ctx);
    applyRoot(ctx, r);
    const hN = armPt(KN.shN, r.aN, r.lN), hF = armPt(KN.shF, r.aF, r.lF), shC = [hF[0] + r.shDX, hF[1] + r.shDY];
    knArmF(ctx, r, hF);
    if (!r.shF && inHand) knShield(ctx, shC[0], shC[1], 19 * r.shS, r.shR);
    knLeg(ctx, KN.hipB, KN.footB + r.fbx, r.fby, true);
    knLeg(ctx, KN.hipF, KN.footF + r.ffx, r.ffy, false);
    knTorso(ctx);
    if (r.nBack) knArmN(ctx, r, hN, inHand);
    knHead(ctx, r, t, lag);
    if (!r.nBack) knArmN(ctx, r, hN, inHand);
    if (r.shF && inHand) {
      const R = 19 * r.shS;
      knShield(ctx, shC[0], shC[1], R, r.shR + (pose === 'manip' ? 0.1 : -0.05));
      knGauntlet(ctx, shC[0] - R * 0.8, shC[1] + R * 0.45, -0.9, false);   // fist gripping the rim
    }
    rs(ctx);
    knFx(ctx, pose, t, p, o, r);
    if (dead) knProps(ctx, t, p, o, 'front');
    rs(ctx);
  }

  // =============================================================================================
  // WITCH — ルゥ : tiny, round face, GIGANTIC floppy hat with a candle on its tip, bell sleeves,
  // striped stockings, curly boots, gnarled staff with a glowing ember crystal.
  // =============================================================================================
  const WI = {
    shN: [9, -44], shF: [-6, -44], neck: [3, -46], head: [3, -61], hatBase: [2, -78],
    hipB: [-6, -21], hipF: [6, -21], footB: -6, footF: 6,
    dress: [[-7, -48], [10, -48], [14, -39], [18, -28.5], [23, -19], [16, -15.8], [9, -18], [1, -14.8], [-7, -18], [-14, -14.8], [-20, -19], [-16, -29], [-11, -39]],
    capelet: [[-12, -49.5], [14, -49.5], [17, -41.5], [11.5, -37.5], [5.5, -41], [-0.5, -37], [-6.5, -41], [-12.5, -38]],
    base: { x: 0, y: 0, rot: 0, px: 0, py: 0, sx: 1, sy: 1, hr: 0, hx: 0, hy: 0,
      aN: 0.6, lN: 16, w: 0.15, aF: -0.25, lF: 14, fbx: 0, fby: 0, ffx: 0, ffy: 0, hatY: 0, hatR: 0, chg: 0 },
  };
  const WI_STAFF_UP = 56, WI_STAFF_DOWN = 27;

  function witchRig(pose, t, p, o) {
    const B = WI.base, mood = (o && o.mood) || 'normal';
    let r, eye = 'open', brow = '', mth = 'smile';
    switch (pose) {
      case 'walk': {
        const ph = (t * TAU) / 0.46, s = sin(ph), c = cos(ph);
        r = Object.assign({}, B, {
          y: -abs(c) * 3.4, rot: 0.04, ffx: 5 * s, ffy: -Math.max(0, c) * 4, fbx: -5 * s, fby: -Math.max(0, -c) * 4,
          aN: B.aN - 0.12 * s, w: B.w + 0.1 * s, aF: B.aF + 0.3 * s, hr: 0.03 * c,
        });
        break;
      }
      case 'attack':
      case 'cast': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.1, 'io', { sy: 1.02 }),
          K(0.3, 'out', { rot: -0.13, x: -4, sx: 1.06, sy: 0.92, aN: -0.35, lN: 14, w: -0.55, aF: 0.9, lF: 15, hr: -0.08, chg: 1, ffx: -1 }),
          K(0.4, 'in', { rot: 0.15, x: 11, sx: 0.95, sy: 1.07, aN: 1.75, lN: 19, w: 1.2, aF: -0.9, hr: 0.08, chg: 0, ffx: 7, fbx: -3 }),
          K(0.5, 'out', { rot: 0.11, x: 9, sx: 1.03, sy: 0.96, w: 1.05 }),
          K(0.75, 'io', {}),
          K(1, 'io', {}, B)]);
        if (p > 0.08 && p < 0.38) { brow = 'focus'; mth = 'flat'; }
        else if (p >= 0.38 && p < 0.72) { brow = 'focus'; mth = 'open'; }
        break;
      }
      case 'manip': { // Re-spin: swirl the staff in a sparkling circle
        const u = seg(p, 0.15, 0.85), th = Art.easeInOut(u) * TAU * 1.5;
        const env = Math.min(Art.easeOut(seg(p, 0, 0.15)), 1 - Art.easeIn(seg(p, 0.85, 1)));
        r = track(p, [K(0, 'lin', {}, B), K(0.15, 'out', { aN: 1.35, lN: 18, w: 0.75, sy: 1.04, aF: -0.6, hr: -0.05 }), K(0.85, 'io', {}), K(1, 'io', {}, B)]);
        r.aN += env * 0.5 * sin(th); r.lN += env * 5 * cos(th); r.w += env * 0.75 * sin(th + 0.9);
        r.rot += env * 0.05 * sin(th); r.x += env * 2 * cos(th); r.hr += env * 0.04 * sin(th + 1);
        if (p > 0.1 && p < 0.9) { eye = 'happy'; mth = 'open'; }
        break;
      }
      case 'pray': {
        r = track(p, [K(0, 'lin', {}, B), K(0.25, 'out', { aN: 0.25, lN: 12, w: 0.0, aF: 0.9, lF: 13, hr: 0.1, hy: 1.5, chg: 0.5 }), K(0.75, 'io', {}), K(1, 'io', {}, B)]);
        if (p > 0.2 && p < 0.85) eye = 'closed';
        break;
      }
      case 'block': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.15, 'back', { sx: 1.09, sy: 0.85, rot: -0.06, x: -3, hr: 0.14, hy: 3, aF: 1.0, aN: 0.95, lN: 12, w: 0.6, hatY: 3.5, hatR: 0.1 }),
          K(0.85, 'io', {}),
          K(1, 'io', {}, B)]);
        if (p > 0.12 && p < 0.88) r.x += sin(t * 46) * 0.6;
        if (p > 0.08 && p < 0.9) { eye = 'hurt'; mth = 'wavy'; }
        break;
      }
      case 'hit': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.1, 'out', { x: -12, px: -8, rot: -0.24, sx: 1.1, sy: 0.86, hr: -0.18, aN: 1.1, w: 0.7, aF: -1.2, hatY: -7, hatR: -0.22, ffx: 3 }),
          K(0.32, 'out', { x: -9, rot: -0.12, sx: 0.97, sy: 1.04, hr: -0.06, hatY: -2, hatR: -0.05 }),
          K(1, 'io', {}, B)]);
        if (p < 0.55) { eye = 'hurt'; mth = 'o'; } else brow = 'worried';
        break;
      }
      case 'cheer': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.14, 'out', { sx: 1.1, sy: 0.84, aN: 0.3, w: 0.2, aF: 0 }),
          K(0.42, 'out', { y: -28, sx: 0.93, sy: 1.1, aN: 2.3, lN: 20, w: 0.12, aF: -2.15, lF: 20, hr: -0.08, hatY: -5, ffy: -3, fby: -5 }),
          K(0.62, 'in', { y: 0, sx: 0.97, sy: 1.04, hatY: -2, ffy: 0, fby: 0 }),
          K(0.72, 'out', { sx: 1.1, sy: 0.86, hatY: 2 }),
          K(0.86, 'io', { sx: 0.98, sy: 1.02, hatY: 0 }),
          K(1, 'io', {}, B)]);
        if (p > 0.06 && p < 0.97) { eye = 'happy'; mth = 'open'; }
        break;
      }
      case 'dead': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.18, 'out', { sx: 1.1, sy: 0.84, hr: 0.15, aN: 0.8, w: 0.8, py: -36 }),
          K(0.58, 'in', { rot: -1.5, y: 14, sx: 1, sy: 1, hr: -0.1, aN: 1.8, aF: -1.6 }),
          K(0.7, 'out', { rot: -1.38, y: 10 }),
          K(0.82, 'in', { rot: -1.5, y: 14 }),
          K(0.9, 'out', { rot: -1.47, y: 13 }),
          K(1, 'io', { rot: -1.5, y: 14 })]);
        eye = p < 0.5 ? 'hurt' : 'dead'; mth = p < 0.5 ? 'o' : 'wavy';
        break;
      }
      default:
        r = Object.assign({}, B);
    }
    if (eye === 'open' && isLoopPose(pose) && mood === 'happy') { eye = 'happy'; mth = 'open'; }
    if (mood === 'worried' && eye === 'open' && !brow) { brow = 'worried'; if (mth === 'smile') mth = 'wavy'; }
    if (pose !== 'dead') {
      const b = sin((t * TAU) / 1.7 + 0.8);
      r.sy *= 1 + 0.02 * b; r.sx *= 1 - 0.012 * b;
      r.hy += sin((t * TAU) / 1.7) * 0.8;
    }
    r.blink = eye === 'open' ? blinkAt(t, 0.75) : 0;
    r.eye = eye; r.brow = brow; r.mouth = mth; r.worried = mood === 'worried';
    return r;
  }

  function wiSleeve(ctx, sh, a, l, back) {
    bellSleeve(ctx, sh, a, l, 4.3, 8.4, back ? PAL.witchRobeShade : PAL.witchRobe, back ? '#33204f' : PAL.witchRobeShade, back ? PAL.witchHat : '#9a72d2');
  }
  function wiStaff(ctx, x, y, a, t, chg, lit) {
    sv(ctx); ctx.translate(x, y); rot(ctx, a);
    const pulse = 0.5 + 0.5 * sin(t * 3.1);
    const glowK = lit === false ? 0.3 : 1;
    Art.glow(ctx, 0, -56, (16 + pulse * 5 + chg * 22) * glowK, 'rgba(255,150,60,0.6)', 0.9 * glowK);
    const shaft = (c) => { c.beginPath(); c.moveTo(0.5, WI_STAFF_DOWN); c.bezierCurveTo(-2.2, 10, 2.6, -10, -0.6, -27); c.bezierCurveTo(-2.2, -36, 1.6, -40, 0, -46); };
    inkStroke(ctx, shaft, 4.4, C.wood, 3.4);
    sv(ctx); ctx.translate(1.3, 0.4); shaft(ctx); ctx.lineWidth = 1.4; ctx.strokeStyle = C.woodShade; ctx.stroke(); rs(ctx);
    for (const k of [[1.6, 8, 2.3], [-1.8, -20, 2.1]]) { Art.circlePath(ctx, k[0], k[1], k[2]); Art.fs(ctx, C.wood, 1.5); }
    S(ctx, (c) => Art.roundRectPath(c, -2.8, WI_STAFF_DOWN - 4.5, 5.6, 5.5, 1.6), PAL.brass, PAL.brassDark, { k: 1.2, lw: 1.6 });
    // claws
    const claws = (c) => {
      c.beginPath();
      c.moveTo(-0.4, -45); c.quadraticCurveTo(-8.2, -50, -5.6, -61);
      c.moveTo(0.4, -45); c.quadraticCurveTo(8.2, -50, 5.6, -61);
    };
    // ribbon tails (behind the claws)
    const sw = sin(t * 3.4) * 2;
    const tail1 = (c) => { c.beginPath(); c.moveTo(0, -44); c.quadraticCurveTo(-5, -40, -7 + sw, -33); };
    const tail2 = (c) => { c.beginPath(); c.moveTo(0, -44); c.quadraticCurveTo(-2, -38, -2 + sw * 0.7, -31); };
    inkStroke(ctx, tail1, 2.6, C.ribbon, 2.8); inkStroke(ctx, tail2, 2.6, C.ribbonShade, 2.8);
    inkStroke(ctx, claws, 2.6, C.wood, 3);
    // crystal
    const cry = (c) => Art.polyPath(c, [[0, -66.5], [5.3, -59.8], [4.5, -51], [0, -47], [-4.5, -51], [-5.3, -59.8]]);
    S(ctx, cry, PAL.flame, PAL.candleDeep, { k: 2 });
    ctx.beginPath(); ctx.moveTo(-5.3, -59.8); ctx.lineTo(0, -56.5); ctx.lineTo(5.3, -59.8); ctx.moveTo(0, -56.5); ctx.lineTo(0, -47.5);
    Art.strokeOnly(ctx, 1, PAL.candleMid);
    Art.polyPath(ctx, [[-2.2, -62.5], [-0.6, -60.5], [-2.2, -58.6], [-3.6, -60.5]]); ctx.fillStyle = PAL.white; ctx.fill();
    Art.glow(ctx, 0, -57, 7 + chg * 6, 'rgba(255,240,200,0.7)', (0.45 + pulse * 0.3) * glowK);
    // ribbon bow
    for (const s of [-1, 1]) { Art.ellipsePath(ctx, s * 3.2, -44.2, 3, 1.9, s * 0.5); Art.fs(ctx, C.ribbon, 1.4); }
    Art.circlePath(ctx, 0, -44.2, 1.5); Art.fs(ctx, C.ribbonShade, 1.2);
    rs(ctx);
  }
  // origin = cone base centre (brim centre at (-1, 3.5)); sway = tip displacement
  function wiHat(ctx, t, sway, lit, smokeT) {
    const brim = [];
    for (let i = 0; i < 16; i++) {
      const an = (i / 16) * TAU;
      const bx = cos(an) * 32 - 1;
      let by = sin(an) * 7.6 + 3.5;
      by += (bx < 0 ? (bx / 32) * (bx / 32) * 3.8 : 0) + sin(an * 3 + 0.5) * 0.7 + sway[1] * 0.06 * (bx / 32);
      brim.push([bx, by]);
    }
    S(ctx, (c) => Art.blobPath(c, brim, 1), PAL.witchHat, PAL.witchHatShade, { k: 3 });
    // brim stitching
    sv(ctx); ctx.setLineDash([2.2, 2.4]);
    ctx.beginPath(); ctx.ellipse(-1, 4.4, 28, 5.6, 0, 0.25, PI - 0.25); Art.strokeOnly(ctx, 1, '#7a5bb0');
    ctx.setLineDash([]); rs(ctx);
    const SP = [[0, 0], [-1, -14.5], [-3.5, -27.5], [-10.5, -37], [-20, -41], [-28, -42.5]];
    const HW = [16.5, 12, 8.2, 5.4, 3.7, 2.7];
    const WT = [0, 0.05, 0.2, 0.45, 0.75, 1];
    const pts = SP.map((q, i) => [q[0] + sway[0] * WT[i], q[1] + sway[1] * WT[i]]);
    const { L, R } = spineOutline(pts, HW);
    const outline = [[0, 3.4]].concat(L, R.slice().reverse());
    const cone = (c) => Art.blobPath(c, outline, 1);
    S(ctx, cone, PAL.witchHat, PAL.witchHatShade, { k: 3.5, hi: { x: -8, y: -12, rx: 2.4, ry: 8, rot: 0.15, color: 'rgba(255,255,255,0.14)' } });
    sv(ctx); cone(ctx); ctx.clip();
    // patch
    sv(ctx); ctx.translate(6, -21); rot(ctx, 0.25);
    Art.roundRectPath(ctx, -3.6, -3.4, 7.2, 6.8, 1); Art.fs(ctx, C.patch, 1.5);
    ctx.setLineDash([1.2, 1.4]); Art.roundRectPath(ctx, -2.2, -2, 4.4, 4, 0.5); Art.strokeOnly(ctx, 0.9, PAL.ink); ctx.setLineDash([]);
    rs(ctx);
    // wrinkles at the bend
    ctx.beginPath();
    ctx.moveTo(pts[2][0] - 6, pts[2][1] + 1); ctx.quadraticCurveTo(pts[2][0] - 2, pts[2][1] - 2, pts[2][0] + 1, pts[2][1] - 6);
    ctx.moveTo(pts[3][0] - 1, pts[3][1] + 5); ctx.quadraticCurveTo(pts[3][0] + 1, pts[3][1] + 1, pts[3][0] + 0.5, pts[3][1] - 3);
    Art.strokeOnly(ctx, 1.5, PAL.witchHatShade);
    // band
    ctx.beginPath(); ctx.moveTo(-20, -2.2); ctx.quadraticCurveTo(0, 1.6, 20, -2.2); ctx.lineTo(20, -8.6); ctx.quadraticCurveTo(0, -4.8, -20, -8.6); ctx.closePath();
    Art.fs(ctx, C.hatBand, LT);
    ctx.beginPath(); ctx.moveTo(-20, -3.6); ctx.quadraticCurveTo(0, 0.2, 20, -3.6); Art.strokeOnly(ctx, 1.2, C.hatBandShade);
    rs(ctx);
    cone(ctx); Art.strokeOnly(ctx, LW);
    // buckle
    Art.roundRectPath(ctx, 3, -8.6, 7.2, 7.6, 1.5); Art.strokeOnly(ctx, 3.6); Art.roundRectPath(ctx, 3, -8.6, 7.2, 7.6, 1.5); Art.strokeOnly(ctx, 1.8, PAL.brassLight);
    // candle on the tip (stays upright in world space)
    const tp = pts[pts.length - 1];
    sv(ctx); ctx.translate(tp[0], tp[1]); rot(ctx, -ROT);
    Art.ellipsePath(ctx, 0, 0.3, 4.6, 1.9); Art.fs(ctx, PAL.brass, 1.6);
    S(ctx, (c) => Art.roundRectPath(c, -2.5, -8, 5, 8.1, 1.4), PAL.bone, PAL.boneShade, { k: 1.4, lw: 1.8 });
    ctx.beginPath(); ctx.moveTo(1.2, -7.8); ctx.quadraticCurveTo(2.9, -6, 2.4, -3.6); Art.strokeOnly(ctx, 1.8, PAL.bone);
    ctx.beginPath(); ctx.moveTo(0, -7.9); ctx.lineTo(0.3, -9.6); Art.strokeOnly(ctx, 1.2);
    if (lit) Art.flame(ctx, 0.2, -9, 5.6, t, { seed: 3, glowColor: 'rgba(255,170,80,0.6)' });
    else if (smokeT != null) {
      for (let i = 0; i < 3; i++) {
        const ph = frac(t * 0.5 + i / 3), yy = -10 - ph * 22, xx = sin(ph * 5 + t * 2 + i) * 3 * ph;
        ctx.save(); ctx.globalAlpha *= (1 - ph) * 0.55;
        Art.circlePath(ctx, xx, yy, 1.6 + ph * 3); ctx.fillStyle = '#c9c0e0'; ctx.fill();
        ctx.restore();
      }
    }
    rs(ctx);
  }
  const wiHatSway = (t, lag) => [sin(t * 1.9) * 2.2 + lag[0] * 1.15, cos(t * 1.9 + 0.4) * 0.7 + lag[1] * 0.85];

  function wiLeg(ctx, hip, fx, fy, back) {
    const ax = fx - 0.5, ay = fy - 7;
    const dx = ax - hip[0], dy = ay - hip[1], len = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    sv(ctx); ctx.translate(hip[0], hip[1]); rot(ctx, a);
    const leg = (c) => Art.roundRectPath(c, -3, -3.2, len + 6, 6.4, 3.2);
    leg(ctx); ctx.fillStyle = back ? '#1f1530' : C.stockA; ctx.fill();
    sv(ctx); leg(ctx); ctx.clip();
    ctx.fillStyle = back ? '#8a73b3' : C.stockB;
    for (let x = 0; x < len + 6; x += 4.4) ctx.fillRect(x, -4, 2.1, 8);
    rs(ctx);
    leg(ctx); Art.strokeOnly(ctx, LT);
    rs(ctx);
    const boot = (c) => Art.blobPath(c, [[fx - 5, fy], [fx + 6.5, fy], [fx + 10, fy - 2.8], [fx + 11.5, fy - 7.4], [fx + 8.5, fy - 5.2], [fx + 4.2, fy - 6.8], [fx + 3.6, fy - 9.6], [fx - 4.8, fy - 9.6]], 0.7);
    S(ctx, boot, back ? C.bootShade : C.boot, back ? '#24130d' : C.bootShade, { k: 2.2 });
    Art.roundRectPath(ctx, fx - 5.4, fy - 11, 9.6, 3.6, 1.6); Art.fs(ctx, back ? C.bootShade : C.bootCuff, 1.6);
    Art.circlePath(ctx, fx + 11.3, fy - 7.6, 1.2); ctx.fillStyle = PAL.brassLight; ctx.fill();
  }
  function wiBody(ctx, t, lag) {
    const dress = (c) => Art.blobPath(c, WI.dress, 0.9);
    S(ctx, dress, PAL.witchRobe, PAL.witchRobeShade, { k: 3.5, hi: { x: -7, y: -30, rx: 2.2, ry: 8, rot: 0.2, color: 'rgba(255,255,255,0.12)' } });
    sv(ctx); dress(ctx); ctx.clip();
    const hem = WI.dress.slice(4, 11).map((q) => [q[0], q[1] - 3.6]);
    Art.curvePath(ctx, hem, 1); Art.strokeOnly(ctx, 1.6, PAL.brassLight);
    // folds
    ctx.beginPath(); ctx.moveTo(-4, -30); ctx.quadraticCurveTo(-6, -22, -8, -15); ctx.moveTo(10, -30); ctx.quadraticCurveTo(12, -22, 13, -15);
    Art.strokeOnly(ctx, 1.4, PAL.witchRobeShade);
    // embroidered moon & stars
    ctx.beginPath(); ctx.arc(-9, -26.5, 3, 0.6, PI * 1.6); ctx.arc(-8.1, -27.3, 2.3, PI * 1.55, 0.7, true); ctx.closePath();
    ctx.fillStyle = PAL.brassLight; ctx.fill();
    spark4(ctx, 6, -25.5, 2.4, PAL.brassLight, 1); spark4(ctx, 15, -30, 1.8, PAL.brassLight, 1); spark4(ctx, -1, -21.8, 1.6, PAL.brassLight, 1);
    // sash
    ctx.beginPath(); ctx.moveTo(-20, -36.5); ctx.quadraticCurveTo(3, -32.5, 24, -36.5); ctx.lineTo(24, -32); ctx.quadraticCurveTo(3, -28, -20, -32); ctx.closePath();
    Art.fs(ctx, C.sash, LT);
    rs(ctx);
    dress(ctx); Art.strokeOnly(ctx, LW);
    // sash knot + tails
    const sw = sin(t * 2.6 + 1) * 1.3 + lag[0] * 0.25;
    const tl = (c) => { c.beginPath(); c.moveTo(12, -33); c.quadraticCurveTo(14 + sw * 0.5, -27, 13 + sw, -21.5); };
    inkStroke(ctx, tl, 2.6, C.sash, 2.8);
    Art.circlePath(ctx, 12, -33.6, 2.4); Art.fs(ctx, C.sash, 1.6);
    // potion vial hanging from the sash
    const vx = -12 + sin(t * 2.2) * 0.8, vy = -27;
    ctx.beginPath(); ctx.moveTo(-11.5, -32.5); ctx.lineTo(vx, vy - 4.5); Art.strokeOnly(ctx, 1.2);
    Art.circlePath(ctx, vx, vy, 3.6); ctx.fillStyle = 'rgba(200,240,255,0.55)'; ctx.fill();
    sv(ctx); Art.circlePath(ctx, vx, vy, 3.6); ctx.clip(); ctx.fillStyle = PAL.heal; ctx.fillRect(vx - 4, vy - 0.6, 8, 5); rs(ctx);
    Art.circlePath(ctx, vx, vy, 3.6); Art.strokeOnly(ctx, 1.6);
    Art.roundRectPath(ctx, vx - 1.6, vy - 6.4, 3.2, 3.2, 0.8); Art.fs(ctx, C.wood, 1.2);
    Art.circlePath(ctx, vx - 1.2, vy - 1.2, 0.8); ctx.fillStyle = PAL.white; ctx.fill();
    // capelet
    const cap = (c) => roundPoly(c, WI.capelet, 2.4);
    S(ctx, cap, C.capelet, C.capeletShade, { k: 2.6 });
    Art.circlePath(ctx, 3.5, -46.8, 2.6); Art.fs(ctx, PAL.brass, 1.6);
    Art.circlePath(ctx, 3.5, -46.8, 1); ctx.fillStyle = PAL.ember; ctx.fill();
  }
  function wiHead(ctx, r, t, lag, hatOn) {
    sv(ctx);
    ctx.translate(r.hx + WI.neck[0], r.hy + WI.neck[1]); rot(ctx, r.hr); ctx.translate(-WI.neck[0], -WI.neck[1]);
    // pigtail (back) — sways
    const pg = sin(t * 2.6) * 1.5 + lag[0] * 0.6, pgy = lag[1] * 0.3;
    S(ctx, (c) => Art.blobPath(c, [[-9, -61], [-17, -57], [-23 + pg * 0.6, -48 + pgy], [-22 + pg, -38.5 + pgy], [-16.5 + pg * 0.8, -44 + pgy * 0.5], [-11, -52]], 1), C.hair, C.hairShade, { k: 2.5 });
    ctx.beginPath(); ctx.moveTo(-18 + pg * 0.6, -50); ctx.quadraticCurveTo(-20 + pg * 0.8, -45, -20 + pg, -41); Art.strokeOnly(ctx, 1.2, C.hairShade);
    // hair mass
    S(ctx, (c) => Art.circlePath(c, 0, -63, 18), C.hair, C.hairShade, { k: 3 });
    // tie
    for (const s of [-1, 1]) { Art.ellipsePath(ctx, -16 + s * 2.6, -55.5 + s * 1.2, 2.6, 1.7, 0.6 + s * 0.4); Art.fs(ctx, PAL.ember, 1.3); }
    // face
    const face = (c) => Art.ellipsePath(c, 4, -60.5, 16, 15);
    S(ctx, face, PAL.skin, PAL.skinShade, { k: 3 });
    sv(ctx); face(ctx); ctx.clip();
    ctx.beginPath(); ctx.moveTo(-14, -82); ctx.lineTo(24, -82); ctx.lineTo(24, -64.5);
    const zz = [[18, -68], [13, -63.6], [8, -68.6], [3, -64.2], [-2, -69], [-7, -64.8], [-12, -68.5], [-14, -66]];
    for (const q of zz) ctx.lineTo(q[0], q[1]);
    ctx.closePath();
    Art.fs(ctx, C.hair, LT);
    rs(ctx);
    face(ctx); Art.strokeOnly(ctx, LW);
    // side lock in front of the ear
    S(ctx, (c) => Art.blobPath(c, [[16, -70], [21.5, -64], [21, -55], [18.6, -50.5], [17.6, -57], [15, -63]], 1), C.hair, C.hairShade, { k: 1.8, lw: LT });
    // face details
    blush(ctx, -0.5, -51.8, 3.3, 1.8); blush(ctx, 18.2, -51.8, 2.6, 1.7);
    ctx.fillStyle = C.freckle;
    for (const q of [[-3, -54.3], [-0.6, -55.2], [1.6, -54.2], [16.4, -54.6], [18.6, -55.4]]) { Art.circlePath(ctx, q[0], q[1], 0.55); ctx.fill(); }
    const ek = r.eye;
    if (ek === 'open') eyesOpen(ctx, 8.6, -58.5, 12.6, 5.5, { look: 0.35, blink: r.blink, brow: r.brow, pupil: r.brow === 'focus' ? 0.4 : 0.46 });
    else eyes(ctx, 8.6, -58.5, 12.6, 5.5, ek);
    mouth(ctx, 10.6, -50.2, r.mouth, 0.95);
    if (r.worried && ek === 'open') sweat(ctx, -6, -66 + sin(t * 3) * 0.5, 0.9, 1);
    if (hatOn) {
      sv(ctx); ctx.translate(WI.hatBase[0], WI.hatBase[1] + r.hatY); rot(ctx, r.hatR);
      wiHat(ctx, t, wiHatSway(t, lag), true);
      rs(ctx);
    }
    rs(ctx);
  }
  const wiCrystal = (r, d) => { const h = armPt(WI.shN, r.aN, r.lN); const q = along(h, r.w, d == null ? WI_STAFF_UP : d); return rootPt(r, q[0], q[1]); };

  function wiProps(ctx, t, p, o, layer) {
    if (p < 0.2) return;
    const r0 = witchRig('dead', t, 0.2, o);
    const e = Art.easeIn(seg(p, 0.2, 0.52));
    if (layer === 'back') {
      // staff clatters down behind her
      const h0 = armPt(WI.shN, r0.aN, r0.lN), s0 = rootPt(r0, h0[0], h0[1]);
      const hx = lerp(s0[0], 2, e), hy = lerp(s0[1], -5, e) - sin(e * PI) * 10;
      const a = lerp(r0.w + r0.rot, PI / 2 - 0.03, e) + (p > 0.52 ? sin((p - 0.52) * 40) * 0.05 * (1 - seg(p, 0.52, 0.8)) : 0);
      wiStaff(ctx, hx, hy, a, t, 0, false);
    } else {
      // hat pops off, flips, and lands upright beside her with its candle snuffed
      const hb = rootPt(r0, WI.hatBase[0] + r0.hx, WI.hatBase[1] + r0.hy + r0.hatY);
      const e2 = Art.easeInOut(seg(p, 0.2, 0.62));
      const hx = lerp(hb[0], -57, e2), hy = lerp(hb[1], -11, e2) - sin(e2 * PI) * 30;
      const land = p > 0.62 ? 1 - seg(p, 0.62, 0.85) : 0;
      sv(ctx); ctx.translate(hx, hy); rot(ctx, lerp(r0.rot + r0.hr, -0.22, e2) + land * sin((p - 0.62) * 40) * 0.12);
      ctx.scale(1 + land * 0.08, 1 - land * 0.08);
      wiHat(ctx, t, [sin(t * 1.6) * 1.2 + land * 4, land * 4], p < 0.4, p >= 0.4 ? t : null);
      rs(ctx);
    }
  }

  function wiFx(ctx, pose, t, p, o, r) {
    if (pose === 'cast' || pose === 'attack') {
      if (p > 0.06 && p < 0.36) { // gathering embers
        const u = seg(p, 0.06, 0.34), c = wiCrystal(r);
        for (let i = 0; i < 6; i++) {
          const an = i * 1.05 + t * 2.5, d = (1 - u) * 26 + 5;
          spark4(ctx, c[0] + cos(an) * d, c[1] + sin(an) * d, 2.6 + u * 1.6, i % 2 ? PAL.flameHot : PAL.candle, Math.min(1, u * 2), an);
        }
      }
      if (p > 0.37 && p < 0.8) {
        const u = seg(p, 0.37, 0.8), k = Art.pulse(u, 0.12), c = wiCrystal(r);
        Art.glow(ctx, c[0], c[1], 58 * k, 'rgba(255,140,50,0.75)', k);
        sv(ctx); ctx.translate(c[0], c[1]); ctx.rotate(0.3 + u * 0.6);
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const rr = i % 2 ? 6 * k : (i % 4 ? 15 : 24) * k, an = (i * PI) / 8;
          if (i) ctx.lineTo(cos(an) * rr, sin(an) * rr); else ctx.moveTo(cos(an) * rr, sin(an) * rr);
        }
        ctx.closePath(); ctx.fillStyle = PAL.flameHot; ctx.globalAlpha *= Math.min(1, k * 1.4); ctx.fill();
        Art.circlePath(ctx, 0, 0, 7 * k); ctx.fillStyle = PAL.white; ctx.fill();
        rs(ctx);
        sv(ctx); ctx.globalAlpha *= 1 - u;
        Art.circlePath(ctx, c[0], c[1], 8 + u * 34); Art.strokeOnly(ctx, 3.2 * (1 - u) + 0.6, PAL.flame);
        rs(ctx);
        for (let i = 0; i < 7; i++) {
          const an = -0.9 + Art.hash(i + 3) * 1.6, d = 10 + u * (30 + Art.hash(i) * 30);
          spark4(ctx, c[0] + cos(an) * d, c[1] + sin(an) * d + u * u * 10, 3.4 * (1 - u), i % 2 ? PAL.flame : PAL.candleMid, 1 - u, an);
        }
      }
    } else if (pose === 'manip') {
      const pa = Math.max(0.12, p - 0.2), pb = Math.min(p, 0.88), fade = 1 - seg(p, 0.86, 1);
      if (pb > pa + 0.004) {
        const N = 18, pts = [];
        for (let i = 0; i <= N; i++) pts.push(wiCrystal(witchRig(pose, t, pa + ((pb - pa) * i) / N, o)));
        sv(ctx); ctx.lineCap = 'round';
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 1; i <= N; i++) {
          const a = i / N;
          ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.lineWidth = 2 + a * 7; ctx.strokeStyle = 'rgba(155,123,214,' + (0.55 * a * fade).toFixed(3) + ')'; ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 1; i <= N; i++) {
          const a = i / N;
          ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.lineWidth = 0.8 + a * 2.2; ctx.strokeStyle = 'rgba(255,230,160,' + (0.9 * a * fade).toFixed(3) + ')'; ctx.stroke();
        }
        rs(ctx);
        for (let i = 0; i <= N; i += 3) {
          const tw = 0.5 + 0.5 * sin(t * 18 + i * 1.7);
          spark4(ctx, pts[i][0] + sin(i * 2.1) * 4, pts[i][1] + cos(i * 1.7) * 4, (2 + (i / N) * 3) * tw, i % 2 ? PAL.gold : PAL.star, fade * (i / N + 0.2), t * 3 + i);
        }
      }
      const env = Art.pulse(seg(p, 0.1, 0.95), 0.2), c = wiCrystal(r);
      Art.glow(ctx, c[0], c[1], 30, 'rgba(197,139,255,0.6)', env);
    } else if (pose === 'pray') {
      const k = Art.pulse(seg(p, 0.15, 0.95), 0.3), c = wiCrystal(r);
      Art.glow(ctx, c[0], c[1], 34 * k, 'rgba(255,190,110,0.6)', k);
      for (let i = 0; i < 5; i++) {
        const ph = frac(t * 0.6 + i * 0.2), x = c[0] + sin(i * 2.3 + t) * 10, y = c[1] - ph * 30;
        spark4(ctx, x, y, 2.4, i % 2 ? PAL.candle : PAL.flameHot, k * sin(ph * PI), t + i);
      }
    } else if (pose === 'cheer') {
      const k = Art.pulse(seg(p, 0.25, 0.9), 0.3), hd = rootPt(r, 2, -90);
      for (let i = 0; i < 5; i++) {
        const an = -t * 2.2 + i * 1.26;
        spark4(ctx, hd[0] + cos(an) * 34, hd[1] + sin(an) * 13, 5 * k, i % 2 ? PAL.curse : PAL.gold, k, an);
      }
    } else if (pose === 'block' && p > 0.1 && p < 0.88) {
      const k = Art.pulse(seg(p, 0.1, 0.88), 0.2), hd = rootPt(r, -14, -66);
      sweat(ctx, hd[0], hd[1], 0.9, k);
      sv(ctx); ctx.globalAlpha *= k;
      ctx.beginPath(); ctx.moveTo(hd[0] + 36, hd[1] - 4); ctx.lineTo(hd[0] + 40, hd[1] - 9); ctx.moveTo(hd[0] + 38, hd[1] + 3); ctx.lineTo(hd[0] + 44, hd[1] + 1);
      Art.strokeOnly(ctx, 1.8);
      rs(ctx);
    } else if (pose === 'hit' && p < 0.55) {
      const k = 1 - seg(p, 0.05, 0.55), hd = rootPt(r, -10, -70);
      sweat(ctx, hd[0] - (1 - k) * 10, hd[1] - (1 - k) * 8, 0.9, k);
    } else if (pose === 'idle' || pose === 'walk') {
      const c = wiCrystal(r), ph = frac(t * 0.45);
      spark4(ctx, c[0] + sin(t * 1.3) * 6, c[1] - 8 - ph * 22, 2.2, PAL.candle, sin(ph * PI) * 0.8, t);
    } else if (pose === 'dead' && p > 0.82) {
      soulEmber(ctx, -2, -46, t + 1.3, seg(p, 0.82, 1));
    }
  }

  function drawWitch(ctx, pose, o) {
    o = o || {};
    const t = +o.t || 0, p = clamp01(+o.p || 0), dead = pose === 'dead';
    const r = witchRig(pose, t, p, o);
    const lag = lagOf(witchRig, pose, t, p, o, r, WI.head);
    ROT = 0; RSTK.length = 0;
    sv(ctx);
    const inHand = !dead || p < 0.2;
    if (dead) wiProps(ctx, t, p, o, 'back');
    sv(ctx);
    applyRoot(ctx, r);
    const hN = armPt(WI.shN, r.aN, r.lN), hF = armPt(WI.shF, r.aF, r.lF);
    // far arm
    Art.circlePath(ctx, hF[0], hF[1] + 1.5, 3.4); Art.fs(ctx, PAL.skinShade, LT);
    wiSleeve(ctx, WI.shF, r.aF, r.lF - 1, true);
    wiLeg(ctx, WI.hipB, WI.footB + r.fbx, r.fby, true);
    wiLeg(ctx, WI.hipF, WI.footF + r.ffx, r.ffy, false);
    wiBody(ctx, t, lag);
    wiHead(ctx, r, t, lag, !dead || p < 0.2);
    if (inHand) wiStaff(ctx, hN[0], hN[1], r.w, t, r.chg);
    wiSleeve(ctx, WI.shN, r.aN, r.lN - 3.5, false);
    if (inHand) { // little fist wrapped around the staff
      S(ctx, (c) => Art.circlePath(c, hN[0], hN[1], 3.7), PAL.skin, PAL.skinShade, { k: 1.2, lw: LT });
    }
    rs(ctx);
    wiFx(ctx, pose, t, p, o, r);
    if (dead) wiProps(ctx, t, p, o, 'front');
    rs(ctx);
  }

  // =============================================================================================
  // PRIEST — トト : round chubby monk in a cream hooded robe with gold trim, rosy cheeks, sleepy
  // kind eyes; a censer-lantern swings on a chain from his near hand (mint/gold glow).
  // =============================================================================================
  const PR = {
    shN: [18, -49], shF: [-15, -50], neck: [6, -56], head: [11, -72],
    footB: -10, footF: 12,
    robe: [[-14, -62], [4, -66], [20, -60], [28, -43], [31, -23], [29.5, -10], [16, -4.5], [0, -3.5], [-16, -4.5], [-28.5, -10], [-30, -23], [-27, -43]],
    hood: [[-23, -58], [-27, -73], [-22, -89], [-10, -98], [6, -100.5], [20, -94], [27, -80], [28, -64], [21, -55], [4, -52], [-13, -53]],
    base: { x: 0, y: 0, rot: 0, px: 0, py: 0, sx: 1, sy: 1, hr: 0, hx: 0, hy: 0,
      aN: 1.15, lN: 17, aF: 0.95, lF: 16, fF: 1, ch: 0, chL: 13, swing: 1, glow: 0, palm: 0,
      fbx: 0, fby: 0, ffx: 0, ffy: 0 },
  };

  function priestRig(pose, t, p, o) {
    const B = PR.base, mood = (o && o.mood) || 'normal';
    let r, eye = 'open', brow = 'soft', mth = 'smile', lid = 0.44;
    switch (pose) {
      case 'walk': {
        const ph = (t * TAU) / 0.62, s = sin(ph), c = cos(ph);
        r = Object.assign({}, B, {
          y: -abs(c) * 2.2, rot: 0.06 * s, ffx: 4 * s, ffy: -Math.max(0, c) * 3, fbx: -4 * s, fby: -Math.max(0, -c) * 3,
          aN: B.aN + 0.1 * s, hr: -0.04 * s, swing: 1.4,
        });
        break;
      }
      case 'pray': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.25, 'out', { aN: 2.45, lN: 22, aF: -2.25, lF: 24, fF: 0, sy: 1.05, sx: 0.97, y: -2, hr: -0.12, glow: 1, swing: 0.3 }),
          K(0.75, 'io', { sy: 1.03 }),
          K(1, 'io', {}, B)]);
        if (p > 0.15 && p < 0.9) { eye = 'closed'; mth = 'smile'; }
        break;
      }
      case 'cast': { // non-signature: a small blessing — censer offered forward
        r = track(p, [K(0, 'lin', {}, B), K(0.3, 'back', { aN: 1.95, lN: 21, glow: 0.6, sy: 1.03, hr: -0.06, swing: 0.4 }), K(0.7, 'io', {}), K(1, 'io', {}, B)]);
        if (p > 0.2 && p < 0.8) eye = 'closed';
        break;
      }
      case 'attack': { // non-signature: censer flail swing
        r = track(p, [K(0, 'lin', {}, B),
          K(0.28, 'out', { aN: 0.2, lN: 15, ch: -1.3, chL: 15, rot: -0.08, x: -3, sy: 0.95, sx: 1.04, hr: -0.05, swing: 0 }),
          K(0.42, 'in', { aN: 1.85, lN: 20, ch: 2.2, chL: 20, rot: 0.12, x: 9, sy: 1.05, sx: 0.97, hr: 0.06, ffx: 5 }),
          K(0.58, 'out', { ch: 1.3, rot: 0.08, x: 7 }),
          K(1, 'io', {}, B)]);
        if (p > 0.1 && p < 0.65) { brow = 'focus'; lid = 0.18; mth = p > 0.36 ? 'open' : 'flat'; }
        break;
      }
      case 'manip': { // Nudge: push with an open palm
        r = track(p, [K(0, 'lin', {}, B),
          K(0.26, 'out', { aN: 0.1, lN: 14, palm: 1, rot: -0.09, x: -3, sy: 0.96, sx: 1.03, hr: -0.05, swing: 0.5 }),
          K(0.4, 'in', { aN: 1.62, lN: 23, rot: 0.1, x: 8, sy: 1.04, sx: 0.97, hr: 0.05, ffx: 4 }),
          K(0.75, 'io', { x: 7 }),
          K(0.9, 'io', {}),
          K(1, 'io', {}, B)]);
        if (p > 0.1 && p < 0.85) { brow = 'focus'; lid = 0.2; mth = 'cat'; }
        break;
      }
      case 'block': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.15, 'back', { sx: 1.08, sy: 0.86, rot: -0.07, x: -3, hr: 0.14, hy: 3, aN: 2.3, lN: 12, aF: 1.3, swing: 0.4 }),
          K(0.85, 'io', {}),
          K(1, 'io', {}, B)]);
        if (p > 0.12 && p < 0.88) r.x += sin(t * 44) * 0.5;
        if (p > 0.08 && p < 0.9) { eye = 'hurt'; mth = 'wavy'; }
        break;
      }
      case 'hit': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.1, 'out', { x: -11, px: -10, rot: -0.2, sx: 1.12, sy: 0.85, hr: -0.15, aN: 1.6, ch: -0.8 }),
          K(0.3, 'out', { x: -8, rot: -0.1, sx: 0.96, sy: 1.05, ch: -0.3 }),
          K(1, 'io', {}, B)]);
        const wob = Math.exp(-5 * p) * sin(p * 42) * 0.05;
        r.sy += wob; r.sx -= wob * 0.6;
        if (p < 0.55) { eye = 'hurt'; mth = 'o'; } else brow = 'worried';
        break;
      }
      case 'cheer': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.14, 'out', { sx: 1.12, sy: 0.84 }),
          K(0.42, 'out', { y: -20, sx: 0.95, sy: 1.08, aN: 2.6, lN: 20, aF: -2.25, lF: 24, fF: 0, hr: -0.08, ffy: -3, fby: -3 }),
          K(0.62, 'in', { y: 0, sx: 0.98, sy: 1.03, ffy: 0, fby: 0 }),
          K(0.72, 'out', { sx: 1.12, sy: 0.85 }),
          K(0.86, 'io', { sx: 0.98, sy: 1.02 }),
          K(1, 'io', {}, B)]);
        if (p > 0.06 && p < 0.97) { eye = 'happy'; mth = 'open'; }
        break;
      }
      case 'dead': {
        r = track(p, [K(0, 'lin', {}, B),
          K(0.18, 'out', { sx: 1.1, sy: 0.85, hr: 0.12, py: -40 }),
          K(0.58, 'in', { rot: -1.5, y: 10, sx: 1, sy: 1, aN: 1.9, aF: 0.4, fF: 1 }),
          K(0.7, 'out', { rot: -1.36, y: 6 }),
          K(0.82, 'in', { rot: -1.5, y: 10 }),
          K(0.9, 'out', { rot: -1.46, y: 9 }),
          K(1, 'io', { rot: -1.5, y: 10 })]);
        eye = p < 0.5 ? 'hurt' : 'dead'; mth = p < 0.5 ? 'o' : 'wavy';
        break;
      }
      default:
        r = Object.assign({}, B);
    }
    if (eye === 'open' && isLoopPose(pose) && mood === 'happy') { eye = 'happy'; mth = 'open'; }
    if (mood === 'worried' && eye === 'open' && brow === 'soft') { brow = 'worried'; lid = 0.2; if (mth === 'smile') mth = 'wavy'; }
    if (pose !== 'dead') {
      const b = sin((t * TAU) / 2.1 + 1.6);
      r.sy *= 1 + 0.024 * b; r.sx *= 1 - 0.016 * b;
      r.hy += sin((t * TAU) / 2.1 + 1.0) * 0.7;
    }
    r.blink = eye === 'open' ? blinkAt(t, 0.4, 0.28) : 0;
    r.eye = eye; r.brow = brow; r.mouth = mth; r.lid = lid; r.worried = mood === 'worried';
    return r;
  }

  // world-space chain angle → censer placement (local frame)
  function prCenserPose(r, t, lagH, pose) {
    const h = armPt(PR.shN, r.aN, r.lN);
    const per = pose === 'walk' ? 0.62 : 2.6;
    const swingA = (pose === 'walk' ? 0.42 * sin((t * TAU) / per + 1.2) : 0.3 * sin(t * 2.4)) * r.swing;
    const phiW = Math.max(-2.6, Math.min(2.6, r.ch + swingA + lagH[0] * 0.07));
    const phi = phiW - r.rot;
    const ring = [h[0] + r.chL * sin(phi), h[1] + r.chL * cos(phi)];
    return { h, ring, phi, center: [ring[0] + 12 * sin(phi), ring[1] + 12 * cos(phi)] };
  }
  function prChain(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); Art.strokeOnly(ctx, 3.4);
    ctx.save(); ctx.setLineDash([2.2, 1.5]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineWidth = 1.6; ctx.lineCap = 'butt'; ctx.strokeStyle = PAL.brassLight; ctx.stroke();
    ctx.restore();
  }
  function prCenser(ctx, x, y, a, t, glow, lit) {
    const pulse = 0.5 + 0.5 * sin(t * 2.7), g = lit ? 1 : 0.3;
    sv(ctx); ctx.translate(x, y); rot(ctx, a);
    Art.glow(ctx, 0, 13, (22 + pulse * 5) * (1 + glow * 1.4), 'rgba(125,240,180,0.55)', (0.5 + glow * 0.5) * g);
    Art.glow(ctx, 0, 13, 11 + glow * 12, 'rgba(255,210,87,0.6)', 0.65 * g);
    Art.circlePath(ctx, 0, 0.6, 2.3); Art.strokeOnly(ctx, 3.4); Art.circlePath(ctx, 0, 0.6, 2.3); Art.strokeOnly(ctx, 1.4, PAL.brassLight);
    S(ctx, (c) => { c.beginPath(); c.moveTo(-7, 8.6); c.bezierCurveTo(-7, 3.4, -3, 2.8, 0, 2.8); c.bezierCurveTo(3, 2.8, 7, 3.4, 7, 8.6); c.closePath(); }, PAL.brass, PAL.brassDark, { k: 1.8, lw: LT });
    const body = (c) => Art.blobPath(c, [[-8, 8.6], [8, 8.6], [8.9, 13], [5.6, 18.6], [0, 20.2], [-5.6, 18.6], [-8.9, 13]], 0.9);
    S(ctx, body, PAL.brass, PAL.brassDark, { k: 2.2, hi: { x: -4.6, y: 11.5, rx: 1.4, ry: 2.6, color: 'rgba(255,255,255,0.5)' } });
    for (const wx of [-3.9, 0, 3.9]) {
      Art.roundRectPath(ctx, wx - 1.2, 10.6, 2.4, 5.4, 1.2);
      ctx.fillStyle = lit ? '#e2fff2' : '#5a4a2a'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = PAL.ink; ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(-8.4, 9); ctx.lineTo(8.4, 9); Art.strokeOnly(ctx, LT);
    ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(0, 22.6); Art.strokeOnly(ctx, LT);
    Art.circlePath(ctx, 0, 23.6, 1.8); Art.fs(ctx, PAL.brassLight, 1.2);
    if (lit) Art.glow(ctx, 0, 13, 8, 'rgba(220,255,240,0.85)', 0.55 + 0.35 * pulse);
    rs(ctx);
  }
  // incense: two curling wisps that rise in world space and fade, plus a few soft puffs
  function prSmoke(ctx, x, y, t, amt) {
    if (amt <= 0) return;
    const ga = ctx.globalAlpha; ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let w = 0; w < 2; w++) {
      const N = 10, ph0 = t * 1.6 + w * 2.4, H = 30 - w * 6, pts = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        pts.push([x + sin(u * 6 + ph0 - u * 2) * (1.2 + u * 5) * (w ? -1 : 1) + u * 3, y - u * H - w * 2]);
      }
      const g = ctx.createLinearGradient(x, y, x, y - H);
      g.addColorStop(0, 'rgba(210,255,235,' + (0.5 * amt).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(210,255,235,0)');
      ctx.globalAlpha = ga;
      Art.curvePath(ctx, pts, 1); ctx.lineWidth = w ? 1.6 : 2.2; ctx.strokeStyle = g; ctx.stroke();
    }
    ctx.restore();
  }
  function prSleeve(ctx, sh, a, l, back) {
    bellSleeve(ctx, sh, a, l, 5.5, 9.2, back ? PAL.priestRobeShade : PAL.priestRobe, back ? '#9a8a68' : PAL.priestRobeShade, PAL.priestTrim);
  }
  function prPalm(ctx, x, y) {
    sv(ctx); ctx.translate(x, y); rot(ctx, -ROT);
    const path = (c) => { c.beginPath(); c.moveTo(-3.6, 4.5); c.lineTo(-4, -3); c.quadraticCurveTo(-4, -9, 0.2, -9); c.quadraticCurveTo(4.4, -9, 4.4, -3); c.lineTo(4.2, 4.5); c.quadraticCurveTo(0.3, 7, -3.6, 4.5); c.closePath(); };
    S(ctx, path, PAL.skin, PAL.skinShade, { k: 1.6, lw: LT });
    Art.ellipsePath(ctx, -4.6, 0.6, 2.2, 3.3, -0.5); Art.fs(ctx, PAL.skin, LT);
    ctx.beginPath(); ctx.moveTo(-1.2, -8.4); ctx.lineTo(-1.2, -4.2); ctx.moveTo(1.6, -8.4); ctx.lineTo(1.6, -4.2); Art.strokeOnly(ctx, 1.1);
    rs(ctx);
  }
  function prBeads(ctx, hx, hy, t, lagX) {
    const sw = sin(t * 2.1 + 0.5) * 1.6 + lagX * 0.3;
    ctx.save();
    const pts = [];
    for (let i = 0; i <= 10; i++) { const u = i / 10; pts.push([hx + (u - 0.5) * 7 + sw * sin(u * PI), hy + 2 + sin(u * PI) * 12]); }
    Art.curvePath(ctx, pts, 1); Art.strokeOnly(ctx, 1);
    for (let i = 1; i < 10; i++) { Art.circlePath(ctx, pts[i][0], pts[i][1], 1.75); ctx.fillStyle = C.bead; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = PAL.ink; ctx.stroke(); }
    const mx = pts[5][0], my = pts[5][1] + 4;
    ctx.beginPath(); ctx.moveTo(pts[5][0], pts[5][1]); ctx.lineTo(mx, my); Art.strokeOnly(ctx, 1);
    Art.circlePath(ctx, mx, my + 1.8, 2.4); Art.fs(ctx, PAL.brass, 1.3);
    Art.circlePath(ctx, mx, my + 1.8, 0.9); ctx.fillStyle = PAL.heal; ctx.fill();
    ctx.restore();
  }
  function prFeet(ctx, r) {
    for (const [fx, fy, back] of [[PR.footB + r.fbx, r.fby, true], [PR.footF + r.ffx, r.ffy, false]]) {
      S(ctx, (c) => Art.blobPath(c, [[fx - 5, fy], [fx + 8, fy], [fx + 9.5, fy - 3], [fx + 5, fy - 6.5], [fx - 4.5, fy - 6]], 0.8),
        back ? C.sandalShade : PAL.skin, back ? '#3a2214' : PAL.skinShade, { k: 1.8, lw: LT + 0.5 });
      if (!back) { ctx.beginPath(); ctx.moveTo(fx + 2, fy - 6); ctx.lineTo(fx + 3.6, fy - 0.5); Art.strokeOnly(ctx, 2, C.sandal); }
    }
  }
  function prBody(ctx, t, lag) {
    const robe = (c) => Art.blobPath(c, PR.robe, 1);
    S(ctx, robe, PAL.priestRobe, PAL.priestRobeShade, { k: 5, hi: { x: -14, y: -42, rx: 4, ry: 10, rot: 0.3, color: 'rgba(255,255,255,0.35)' } });
    sv(ctx); robe(ctx); ctx.clip();
    // folds
    ctx.beginPath(); ctx.moveTo(-14, -28); ctx.quadraticCurveTo(-17, -16, -18, -6); ctx.moveTo(22, -28); ctx.quadraticCurveTo(24, -17, 23, -8);
    Art.strokeOnly(ctx, 1.5, PAL.priestRobeShade);
    // hem band
    ctx.beginPath(); ctx.moveTo(-34, -13.5); ctx.quadraticCurveTo(0, -4.5, 34, -13.5); ctx.lineTo(34, 10); ctx.lineTo(-34, 10); ctx.closePath();
    Art.fs(ctx, PAL.priestTrim, LT);
    for (let x = -22; x <= 24; x += 7.5) {
      const y = -9.6 + (x / 34) * (x / 34) * 4 - 2.2 * (1 - (x / 34) * (x / 34)) + 2;
      Art.polyPath(ctx, [[x, y - 2], [x + 1.6, y], [x, y + 2], [x - 1.6, y]]); ctx.fillStyle = PAL.priestRobe; ctx.fill();
    }
    // front trim band
    ctx.beginPath(); ctx.moveTo(5.5, -66); ctx.quadraticCurveTo(7.5, -36, 6.5, -2); ctx.lineTo(13, -2); ctx.quadraticCurveTo(14, -36, 12, -66); ctx.closePath();
    Art.fs(ctx, PAL.priestTrim, LT);
    // rope belt
    ctx.beginPath(); ctx.moveTo(-34, -39); ctx.quadraticCurveTo(0, -33.5, 34, -39); ctx.lineTo(34, -34.2); ctx.quadraticCurveTo(0, -28.7, -34, -34.2); ctx.closePath();
    Art.fs(ctx, C.rope, LT);
    ctx.beginPath();
    for (let x = -30; x < 32; x += 3.4) { const y = -36.4 + (x / 34) * (x / 34) * -2.6 + 2.4 * (1 - (x / 34) * (x / 34)) - 0.4; ctx.moveTo(x - 1.2, y - 1.8); ctx.lineTo(x + 1.2, y + 1.8); }
    Art.strokeOnly(ctx, 1, C.ropeShade);
    rs(ctx);
    robe(ctx); Art.strokeOnly(ctx, LW);
    // knot + hanging cords
    const sw = sin(t * 2.3 + 0.4) * 1.4 + lag[0] * 0.3;
    for (const [dx, len, ph] of [[-1.5, 15, 0], [2.5, 12, 0.9]]) {
      const ex = 18 + dx + sw * (ph ? 0.8 : 1), ey = -33 + len;
      inkStroke(ctx, (c) => { c.beginPath(); c.moveTo(18, -33); c.quadraticCurveTo(18 + dx, -33 + len * 0.6, ex, ey); }, 1.9, C.rope, 2.6);
      S(ctx, (c) => Art.blobPath(c, [[ex - 2, ey - 1], [ex + 2, ey - 1], [ex + 2.4, ey + 3.5], [ex, ey + 5], [ex - 2.4, ey + 3.5]], 0.8), C.rope, C.ropeShade, { k: 1.2, lw: 1.5 });
    }
    Art.circlePath(ctx, 18, -33.6, 3.2); Art.fs(ctx, C.rope, 1.8);
  }
  function prHead(ctx, r, t, lag) {
    sv(ctx);
    ctx.translate(r.hx + PR.neck[0], r.hy + PR.neck[1]); rot(ctx, r.hr); ctx.translate(-PR.neck[0], -PR.neck[1]);
    const sw = sin(t * 1.8) * 1.2 + lag[0] * 0.5, swy = lag[1] * 0.3;
    S(ctx, (c) => Art.blobPath(c, [[-2, -99], [-14, -102.5 + swy], [-24 + sw, -105 + swy], [-26.5 + sw, -99.5 + swy], [-17, -93], [-6, -92]], 1), PAL.priestRobe, PAL.priestRobeShade, { k: 2.5 });
    S(ctx, (c) => Art.blobPath(c, PR.hood, 1), PAL.priestRobe, PAL.priestRobeShade, { k: 4, hi: { x: -13, y: -84, rx: 3.6, ry: 8, rot: 0.4, color: 'rgba(255,255,255,0.4)' } });
    ctx.beginPath(); ctx.moveTo(-19, -72); ctx.quadraticCurveTo(-16, -62, -10, -56.5); ctx.moveTo(-12, -92); ctx.quadraticCurveTo(-17, -86, -19, -79);
    Art.strokeOnly(ctx, 1.5, PAL.priestRobeShade);
    Art.ellipsePath(ctx, 11, -72, 17, 17.5, 0.08); Art.fs(ctx, PAL.priestTrim, LT);
    ctx.save(); ctx.setLineDash([1.6, 2.6]); Art.ellipsePath(ctx, 11, -72, 15.6, 16.1, 0.08); Art.strokeOnly(ctx, 1.1, '#fff0c0'); ctx.restore();
    Art.ellipsePath(ctx, 11.5, -71.5, 14.2, 14.8, 0.08); ctx.fillStyle = C.lining; ctx.fill(); Art.strokeOnly(ctx, 1.6);
    const face = (c) => Art.ellipsePath(c, 12.2, -69.6, 12.8, 12.2);
    S(ctx, face, PAL.skin, PAL.skinShade, { k: 2.4, lw: LT });
    // little tuft of hair peeking from the hood
    ctx.beginPath(); ctx.moveTo(6, -81); ctx.quadraticCurveTo(9.5, -84, 11.5, -80.5); ctx.quadraticCurveTo(13.5, -83.5, 16.5, -80.6);
    Art.strokeOnly(ctx, 2.4, '#8a5a36');
    blush(ctx, 3.8, -64.3, 3.6, 2.3); blush(ctx, 21, -64.3, 2.9, 2.1);
    const ek = r.eye;
    if (ek === 'open') eyesOpen(ctx, 12.6, -70.6, 11, 5, { look: 0.3, blink: r.blink, lid: r.lid, pupil: r.lid > 0.4 ? 0.38 : 0.44, brow: r.brow, browC: '#8a5a36', browW: 1.7 });
    else eyes(ctx, 12.6, -70.6, 11, 4.6, ek);
    ctx.beginPath(); ctx.arc(15.2, -66.4, 1.6, 0.2, PI - 0.2); Art.strokeOnly(ctx, 1.2, PAL.skinShade);
    mouth(ctx, 13.4, -62.6, r.mouth, 0.85);
    if (r.worried && ek === 'open') sweat(ctx, -2, -79 + sin(t * 3) * 0.5, 0.9, 1);
    rs(ctx);
  }
  function prFarArm(ctx, r, t, lag) {
    const h = armPt(PR.shF, r.aF, r.lF);
    Art.circlePath(ctx, h[0], h[1] + 1, 4.4); Art.fs(ctx, PAL.skin, LT);
    prSleeve(ctx, PR.shF, r.aF, r.lF - 3, r.fF < 0.5);
    prBeads(ctx, h[0], h[1] + 2, t, lag[0]);
  }

  function prProps(ctx, t, p, o) {
    if (p < 0.2) return;
    const r0 = priestRig('dead', t, 0.2, o);
    const c0 = prCenserPose(r0, t, [0, 0], 'dead'), w0 = rootPt(r0, c0.ring[0], c0.ring[1]);
    const e = Art.easeIn(seg(p, 0.2, 0.5));
    const x = lerp(w0[0], 44, e), y = lerp(w0[1], -12, e) - sin(e * PI) * 10;
    const a = lerp(-c0.phi - r0.rot, -1.2, e) + (p > 0.5 ? sin((p - 0.5) * 36) * 0.15 * (1 - seg(p, 0.5, 0.8)) : 0);
    prCenser(ctx, x, y, a, t, 0, p < 0.6);
    if (p > 0.48) { const k = 1 - seg(p, 0.48, 0.8); puff(ctx, 48, 0, 5 + (1 - k) * 4, k); }
  }

  function prFx(ctx, pose, t, p, o, r, cp) {
    const cw = rootPt(r, cp.center[0], cp.center[1]), cap = rootPt(r, cp.ring[0], cp.ring[1]);
    if (pose !== 'dead') prSmoke(ctx, cap[0], cap[1] - 2, t, 1);
    if (pose === 'pray' || pose === 'cast') {
      const k = Art.pulse(seg(p, 0.12, 0.95), 0.25) * (pose === 'cast' ? 0.65 : 1);
      if (k > 0) {
        sv(ctx); ctx.globalCompositeOperation = 'lighter'; ctx.translate(cw[0], cw[1]);
        const L = 64 * k, rg = ctx.createRadialGradient(0, 0, 4, 0, 0, L);
        rg.addColorStop(0, 'rgba(225,255,235,' + (0.42 * k).toFixed(3) + ')');
        rg.addColorStop(0.45, 'rgba(125,240,180,' + (0.16 * k).toFixed(3) + ')');
        rg.addColorStop(1, 'rgba(125,240,180,0)');
        ctx.fillStyle = rg; ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const an = t * 0.35 + (i * TAU) / 10, len = L * (i % 2 ? 0.7 : 1), hw = i % 2 ? 0.05 : 0.08;
          ctx.moveTo(0, 0); ctx.lineTo(cos(an - hw) * len, sin(an - hw) * len); ctx.lineTo(cos(an + hw) * len, sin(an + hw) * len); ctx.closePath();
        }
        ctx.fill();
        rs(ctx);
        Art.glow(ctx, cw[0], cw[1], 72 * k, 'rgba(125,240,180,0.55)', k);
        Art.glow(ctx, cw[0], cw[1], 28 * k, 'rgba(255,240,190,0.8)', k);
        for (let i = 0; i < 9; i++) {
          const ph = frac(t * 0.45 + i * 0.111), x = -34 + Art.hash(i + 11) * 76 + sin(t + i) * 3, y = -12 - ph * 96;
          spark4(ctx, x + r.x, y, 1.8 + Art.hash(i) * 2.2, i % 2 ? PAL.heal : PAL.gold, k * sin(ph * PI), t + i);
        }
        if (pose === 'pray') {
          const hd = rootPt(r, 5, -110);
          sv(ctx); ctx.globalAlpha *= k;
          Art.ellipsePath(ctx, hd[0], hd[1], 13, 3.6); Art.strokeOnly(ctx, 4.6); Art.ellipsePath(ctx, hd[0], hd[1], 13, 3.6); Art.strokeOnly(ctx, 2.4, PAL.gold);
          rs(ctx);
          Art.glow(ctx, hd[0], hd[1], 26, 'rgba(255,210,87,0.6)', k);
        }
      }
    } else if (pose === 'attack' && p > 0.3) {
      const pa = Math.max(0.3, p - 0.14), pb = Math.min(p, 0.5), fade = 1 - seg(p, 0.44, 0.66);
      if (pb > pa + 0.004 && fade > 0) {
        const N = 12, outer = [], inner = [];
        for (let i = 0; i <= N; i++) {
          const q = priestRig(pose, t, pa + ((pb - pa) * i) / N, o), c = prCenserPose(q, t, [0, 0], pose);
          outer.push(rootPt(q, c.center[0] + 9 * sin(c.phi), c.center[1] + 9 * cos(c.phi)));
          inner.push(rootPt(q, c.center[0] - lerp(0, 8, i / N) * sin(c.phi), c.center[1] - lerp(0, 8, i / N) * cos(c.phi)));
        }
        sv(ctx); ctx.globalCompositeOperation = 'lighter';
        polyRibbon(ctx, outer, inner, 'rgba(125,240,180,0.55)', fade);
        rs(ctx);
        polyRibbon(ctx, outer, inner, 'rgba(225,255,240,0.75)', 0.7 * fade);
      }
    } else if (pose === 'manip' && p > 0.34 && p < 0.9) {
      const u = seg(p, 0.34, 0.9), h = armPt(PR.shN, r.aN, r.lN + 3), w = rootPt(r, h[0], h[1]);
      for (let i = 0; i < 3; i++) {
        const d = 10 + i * 9 + u * 18, a = (1 - u) * (1 - i * 0.22);
        sv(ctx); ctx.globalAlpha *= Math.max(0, a);
        ctx.beginPath(); ctx.arc(w[0] + d - 8, w[1] - 3, 9 + i * 3, -0.95, 0.95);
        Art.strokeOnly(ctx, 4.4); ctx.beginPath(); ctx.arc(w[0] + d - 8, w[1] - 3, 9 + i * 3, -0.95, 0.95); Art.strokeOnly(ctx, 2.4, PAL.heal);
        rs(ctx);
      }
      Art.glow(ctx, w[0] + 6, w[1] - 3, 26, 'rgba(125,240,180,0.6)', 1 - u);
    } else if (pose === 'cheer') {
      const k = Art.pulse(seg(p, 0.25, 0.9), 0.3), hd = rootPt(r, 6, -96);
      for (let i = 0; i < 4; i++) {
        const an = t * 2.4 + i * 1.57;
        spark4(ctx, hd[0] + cos(an) * 30, hd[1] + sin(an) * 11, 4.6 * k, i % 2 ? PAL.heal : PAL.gold, k, an);
      }
    } else if (pose === 'block' && p > 0.1 && p < 0.88) {
      const k = Art.pulse(seg(p, 0.1, 0.88), 0.2), hd = rootPt(r, -10, -84);
      sweat(ctx, hd[0], hd[1], 1, k); sweat(ctx, hd[0] + 36, hd[1] - 4, 0.75, k);
    } else if (pose === 'hit' && p < 0.55) {
      const k = 1 - seg(p, 0.05, 0.55), hd = rootPt(r, -8, -88);
      sweat(ctx, hd[0] - (1 - k) * 10, hd[1] - (1 - k) * 8, 1, k);
    } else if (pose === 'dead' && p > 0.82) {
      soulEmber(ctx, 2, -52, t + 2.6, seg(p, 0.82, 1));
    }
  }

  function drawPriest(ctx, pose, o) {
    o = o || {};
    const t = +o.t || 0, p = clamp01(+o.p || 0), dead = pose === 'dead';
    const r = priestRig(pose, t, p, o);
    const lag = lagOf(priestRig, pose, t, p, o, r, PR.head);
    const lagH = lagOf(priestRig, pose, t, p, o, r, armPt(PR.shN, r.aN, r.lN));
    const cp = prCenserPose(r, t, lagH, pose);
    ROT = 0; RSTK.length = 0;
    sv(ctx);
    sv(ctx);
    applyRoot(ctx, r);
    if (r.fF < 0.5) prFarArm(ctx, r, t, lag);
    prFeet(ctx, r);
    prBody(ctx, t, lag);
    if (r.fF >= 0.5) prFarArm(ctx, r, t, lag);
    prHead(ctx, r, t, lag);
    const inHand = !dead || p < 0.2;
    if (inHand) {
      prChain(ctx, cp.h[0], cp.h[1], cp.ring[0], cp.ring[1]);
      prCenser(ctx, cp.ring[0], cp.ring[1], -cp.phi, t, r.glow, true);
    }
    if (r.palm > 0.5) {
      prSleeve(ctx, PR.shN, r.aN, r.lN - 2, false);
      const hp = armPt(PR.shN, r.aN, r.lN + 3);
      prPalm(ctx, hp[0], hp[1]);
    } else {
      prSleeve(ctx, PR.shN, r.aN, r.lN - 4, false);
      S(ctx, (c) => Art.circlePath(c, cp.h[0], cp.h[1] + 0.5, 4.4), PAL.skin, PAL.skinShade, { k: 1.4, lw: LT });
      ctx.beginPath(); ctx.arc(cp.h[0] + 0.6, cp.h[1] + 0.8, 2.2, -0.4, 1.4); Art.strokeOnly(ctx, 1.1);   // curled fingers
    }
    rs(ctx);
    prFx(ctx, pose, t, p, o, r, cp);
    if (dead) prProps(ctx, t, p, o);
    rs(ctx);
  }

  // =============================================================================================
  // registration + info (effect origins measured from the idle rig at t = 0)
  // =============================================================================================
  function round1(v) { return Math.round(v * 10) / 10; }
  const kr = knightRig('idle', 0, 0, {}), wr = witchRig('idle', 0, 0, {}), pr = priestRig('idle', 0, 0, {});
  const kFx = knSwordTip(kr, 72), wFx = wiCrystal(wr), pCp = prCenserPose(pr, 0, [0, 0], 'idle'), pFx = rootPt(pr, pCp.center[0], pCp.center[1]);

  // height/width/bounds = idle silhouette (bounds = [minX, minY, maxX, maxY] relative to the feet, glows excluded).
  // head = top of the head incl. headgear (helm / hat crown / hood), excluding plume & candle; face = face centre;
  // top = highest point (plume tip / candle flame); fx = sword tip / staff crystal / censer centre in idle.
  Art.registerHero('knight', {
    draw: drawKnight,
    info: { name: 'ブラム', height: 122, width: 94, bounds: [-49, -124, 45, 0], fx: [round1(kFx[0]), round1(kFx[1])], head: [3, -96], face: [7, -72], top: [-8, -124] },
  });
  Art.registerHero('witch', {
    draw: drawWitch,
    info: { name: 'ルゥ', height: 131, width: 68, bounds: [-33, -131, 35, 0], fx: [round1(wFx[0]), round1(wFx[1])], head: [-6, -118], face: [8, -58], top: [-26, -136] },
  });
  Art.registerHero('priest', {
    draw: drawPriest,
    info: { name: 'トト', height: 108, width: 82, bounds: [-32, -108, 50, 0], fx: [round1(pFx[0]), round1(pFx[1])], head: [6, -101], face: [12, -70], top: [-24, -108] },
  });
  Art.HERO_POSES = ['idle', 'walk', 'attack', 'cast', 'pray', 'block', 'hit', 'cheer', 'manip', 'dead'];
})();
