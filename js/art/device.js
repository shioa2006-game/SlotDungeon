/* EMBERWHEEL — the fate machine and its props ("Candlelit Paper Theater").
 *   SD.Art.drawDeviceBack(ctx, L, opts)   brass+stone body, rune rim, dark drum wells
 *   SD.Art.drawDeviceFront(ctx, L, opts)  (after reel contents) cylinder shading, payline window, bezels, held/jammed hardware
 *        L = { x, y, w, h, reels:[{x,y,w,h}], rowH, paylineY, paylineH }
 *        opts = { t, runes 0..12, glow 0..1, held:[bool], jammed:[bool], boss:bool }
 *   SD.Art.drawLever(ctx, x, y, pull 0..1, t, opts{ hover, disabled, mount=true, length=150 })
 *   SD.Art.drawSparkCandle(ctx, x, y, lit, t, opts{ flare 0..1, size=30 })   (x,y) = base of the candle dish
 *   SD.Art.drawDoor(ctx, kind, cx, cy, w, h, t, opts{ hover, open 0..1 })  kinds: battle dread shrine campfire elite boss
 */
(function () {
  'use strict';
  const SD = (globalThis.SD = globalThis.SD || {});
  const Art = (SD.Art = SD.Art || {});
  const PAL = Art.PAL || {};
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const c01 = (v) => clamp(+v || 0, 0, 1);
  const num = (v) => (v === true ? 1 : clamp(+v || 0, 0, 1));
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // ---------------------------------------------------------------- palettes
  function metal(boss) {
    return boss
      ? { base: '#8d8597', light: '#b9afc6', dark: '#4f4760', deep: '#2b2535', hi: '#e6def0', groove: '#1f1a27' }
      : { base: PAL.brass, light: PAL.brassLight, dark: PAL.brassDark, deep: PAL.brassShadow, hi: '#fff0c2', groove: '#2c1d0a' };
  }
  function stoneCols(boss) {
    return boss
      ? { face: '#241f2c', faceShade: '#16131c', line: '#3a3346', speck: '#463e52', drumEdge: '#100e15', drumMid: '#38323f' }
      : { face: '#2a2546', faceShade: '#1b1832', line: '#3d3764', speck: '#4d467c', drumEdge: '#15122a', drumMid: '#3f3962' };
  }

  // ---------------------------------------------------------------- path helpers (sub-paths)
  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function rrCCW(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    c.moveTo(x + r, y); c.arcTo(x, y, x, y + h, r); c.arcTo(x, y + h, x + w, y + h, r);
    c.arcTo(x + w, y + h, x + w, y, r); c.arcTo(x + w, y, x, y, r); c.closePath();
  }
  function circ(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, Math.max(0.01, r), 0, TAU); c.closePath(); }
  function circCCW(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, Math.max(0.01, r), TAU, 0, true); c.closePath(); }
  function ell(c, x, y, rx, ry, rot) { rot = rot || 0; c.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); c.closePath(); }
  function poly(c, pts) { c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); }
  const P = (fn) => (c) => { c.beginPath(); fn(c); };
  function sh(c, path, base, shade, lw, o) {
    o = o || {};
    Art.shape(c, path, base, shade, { lw: lw == null ? Art.LW : lw, dx: o.dx == null ? -4 : o.dx, dy: o.dy == null ? -4 : o.dy, hi: o.hi });
  }
  function stroke(c, lw, color) { Art.strokeOnly(c, lw, color || PAL.ink); }
  function line(c, x0, y0, x1, y1, lw, color) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); stroke(c, lw, color); }
  function rivet(c, x, y, r, M) {
    c.beginPath(); circ(c, x, y, r); Art.fs(c, M.light, Math.min(1.6, r * 0.6));
    c.beginPath(); circ(c, x - r * 0.3, y - r * 0.3, r * 0.35); c.fillStyle = M.hi; c.fill();
  }
  function gearPts(cx, cy, ro, ri, teeth, rot) {
    const pts = [], n = teeth * 4;
    for (let i = 0; i < n; i++) {
      const a = (rot || 0) + (i / n) * TAU, r = (i % 4 === 0 || i % 4 === 1) ? ro : ri;
      const off = ((i % 4 === 0 || i % 4 === 2) ? -1 : 1) * (0.24 / teeth);
      pts.push([cx + Math.cos(a + off) * r, cy + Math.sin(a + off) * r]);
    }
    return pts;
  }
  function rays(c, x, y, r, n, rot, color, alpha, width) {
    if (alpha <= 0 || r <= 0) return;
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= alpha; c.translate(x, y); c.rotate(rot);
    const g = c.createRadialGradient(0, 0, r * 0.1, 0, 0, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath();
    const w = width || 0.1;
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; c.moveTo(0, 0); c.arc(0, 0, r, a - w, a + w); c.closePath(); }
    c.fill(); c.restore();
  }
  function heaterPath(c, x, y, w, h) { // heater shield, top-left anchored box
    const hw = w / 2, cx = x + hw;
    c.moveTo(x, y + h * 0.04); c.quadraticCurveTo(cx, y - h * 0.08, x + w, y + h * 0.04);
    c.bezierCurveTo(x + w + 1, y + h * 0.48, cx + hw * 0.7, y + h * 0.78, cx, y + h);
    c.bezierCurveTo(cx - hw * 0.7, y + h * 0.78, x - 1, y + h * 0.48, x, y + h * 0.04); c.closePath();
  }
  function chainLine(c, x0, y0, x1, y1, link, col) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), n = Math.max(1, Math.floor(len / (link * 0.95))), a = Math.atan2(dy, dx);
    for (let i = 0; i <= n; i++) {
      const f = i / n, x = x0 + dx * f, y = y0 + dy * f;
      c.beginPath(); ell(c, x, y, link * 0.62, i % 2 ? link * 0.14 : link * 0.34, a);
      c.lineWidth = 4.2; c.strokeStyle = PAL.ink; c.stroke(); c.lineWidth = 2; c.strokeStyle = col || '#8f8ca0'; c.stroke();
    }
  }

  // ---------------------------------------------------------------- device geometry
  function geom(L) {
    const reels = L.reels && L.reels.length ? L.reels : [{ x: L.x + 40, y: L.y + 24, w: L.w - 80, h: L.h - 44 }];
    const r0 = reels[0], rN = reels[reels.length - 1];
    const X0 = L.x, X1 = L.x + L.w, Y0 = L.y - 4, Y1 = L.y + L.h + 3;
    let top = Infinity, bot = -Infinity;
    for (const r of reels) { top = Math.min(top, r.y); bot = Math.max(bot, r.y + r.h); }
    const sideL = r0.x - X0, sideR = X1 - (rN.x + rN.w);
    const sb = clamp(Math.min(sideL, sideR) - 22, 12, 22);
    const tb = clamp(top - Y0 - 8, 11, 18), bb = clamp(Y1 - bot - 6, 10, 16);
    const rowH = L.rowH || r0.h / 3;
    const py = L.paylineY != null ? L.paylineY : r0.y + rowH, ph = L.paylineH || rowH;
    return { reels, r0, rN, X0, X1, Y0, Y1, W: X1 - X0, H: Y1 - Y0, top, bot, sb, tb, bb, cx: (X0 + X1) / 2, py, ph, pyc: py + ph / 2, sideL, sideR };
  }

  // 12 rune glyphs as polylines in a [-1,1] x [-1.3,1.3] box
  const RUNES = [
    [[[-0.4, 1.2], [-0.4, -1.2]], [[-0.4, -0.6], [0.6, -1.1]], [[-0.4, 0.1], [0.6, -0.4]]],
    [[[-0.6, 1.2], [-0.6, -1.1], [0.6, -0.4], [0.6, 1.2]]],
    [[[-0.4, -1.2], [-0.4, 1.2]], [[-0.4, -0.55], [0.5, 0], [-0.4, 0.55]]],
    [[[-0.4, 1.2], [-0.4, -1.2], [0.5, -0.6]], [[-0.4, -0.3], [0.5, 0.3]]],
    [[[-0.5, 1.2], [-0.5, -1.2], [0.5, -0.6], [-0.5, 0], [0.5, 1.2]]],
    [[[0.5, -1.1], [-0.5, 0], [0.5, 1.1]]],
    [[[-0.6, -1.1], [0.6, 1.1]], [[0.6, -1.1], [-0.6, 1.1]]],
    [[[-0.4, 1.2], [-0.4, -1.2], [0.5, -0.6], [-0.4, 0]]],
    [[[-0.5, -1.2], [-0.5, 1.2]], [[0.5, -1.2], [0.5, 1.2]], [[-0.5, -0.4], [0.5, 0.4]]],
    [[[0, -1.2], [0, 1.2]], [[-0.5, -1.2], [0, -0.7]], [[0, 0.7], [0.5, 1.2]]],
    [[[0, 1.2], [0, -1.2]], [[-0.6, -1.0], [0, -0.25], [0.6, -1.0]]],
    [[[0, -1.2], [0.6, -0.4], [0, 0.4], [-0.6, -0.4], [0, -1.2]], [[0, 0.4], [0.6, 1.2]], [[0, 0.4], [-0.6, 1.2]]],
  ];
  function runePath(c, idx, x, y, sx, sy) {
    c.beginPath();
    for (const s of RUNES[idx % RUNES.length]) { c.moveTo(x + s[0][0] * sx, y + s[0][1] * sy); for (let i = 1; i < s.length; i++) c.lineTo(x + s[i][0] * sx, y + s[i][1] * sy); }
  }
  function drawRune(c, idx, x, y, h, lit, t, M, boss) {
    const w = h * 0.95 + 3;
    c.beginPath(); rr(c, x - w / 2, y - h / 2, w, h, 3);
    Art.fs(c, lit ? (boss ? '#2c1426' : '#3a170a') : M.deep, 1.5);
    const sx = h * 0.26, sy = h * 0.3;
    if (lit) {
      const f = 0.78 + Math.sin(t * 3.1 + idx * 1.7) * 0.14 + Math.sin(t * 11.3 + idx) * 0.06;
      Art.glow(c, x, y, h * 1.9, boss ? 'rgba(255,110,90,0.8)' : 'rgba(255,120,40,0.8)', f);
      runePath(c, idx, x, y, sx, sy); stroke(c, 2.6, PAL.ember);
      runePath(c, idx, x, y, sx, sy); stroke(c, 1.1, PAL.candle);
    } else {
      runePath(c, idx, x, y + 0.7, sx, sy); stroke(c, 1.2, M.dark);
      runePath(c, idx, x, y, sx, sy); stroke(c, 1.5, M.groove);
    }
  }
  function runeSlots(G) {
    const top = G.Y0 + G.tb / 2 + 1, bot = G.Y1 - G.bb / 2 - 1;
    const a0 = G.X0 + 46, a1 = G.cx - 105, b0 = G.cx + 105, b1 = G.X1 - 46;
    const c0 = G.X0 + 62, c1 = G.cx - 58, d0 = G.cx + 58, d1 = G.X1 - 62;
    const L3 = (p, q) => [p, (p + q) / 2, q];
    const tops = L3(a0, a1).concat(L3(b0, b1)).map((x) => [x, top, G.tb - 6]);
    const bots = L3(c0, c1).concat(L3(d0, d1)).map((x) => [x, bot, G.bb - 5]).reverse();
    return tops.concat(bots); // clockwise from top-left
  }

  // ================================================================ DEVICE BACK
  Art.drawDeviceBack = function (ctx, L, opts) {
    if (!ctx || !L) return;
    opts = opts || {};
    const t = +opts.t || 0, boss = !!opts.boss, runes = clamp(Math.floor(+opts.runes || 0), 0, 12), glow = c01(opts.glow);
    const M = metal(boss), S = stoneCols(boss), G = geom(L);
    ctx.save();
    // cast shadow onto the stage floor
    ctx.fillStyle = 'rgba(4,2,10,0.55)'; Art.roundRectPath(ctx, G.X0 + 5, G.Y0 + 9, G.W, G.H, 22); ctx.fill();

    // chunky brass frame
    const frame = (c) => Art.roundRectPath(c, G.X0, G.Y0, G.W, G.H, 20);
    sh(ctx, frame, M.base, M.dark, Art.LW, { dx: -5, dy: -6 });
    // bevel: bright lip on the top-left, engraved groove inset
    ctx.save(); frame(ctx); ctx.clip();
    ctx.beginPath(); ctx.moveTo(G.X0 + 6, G.Y1 - 22); ctx.lineTo(G.X0 + 6, G.Y0 + 20); ctx.arcTo(G.X0 + 6, G.Y0 + 6, G.X0 + 20, G.Y0 + 6, 14); ctx.lineTo(G.X1 - 22, G.Y0 + 6);
    stroke(ctx, 2.2, M.light);
    ctx.restore();
    ctx.beginPath(); rr(ctx, G.X0 + 9, G.Y0 + 9, G.W - 18, G.H - 18, 13); stroke(ctx, 1.3, M.dark);

    // recessed stone face plate
    const fx0 = G.X0 + G.sb, fy0 = G.Y0 + G.tb, fx1 = G.X1 - G.sb, fy1 = G.Y1 - G.bb;
    const face = (c) => Art.roundRectPath(c, fx0, fy0, fx1 - fx0, fy1 - fy0, 10);
    sh(ctx, face, S.face, S.faceShade, 2.5, { dx: 4, dy: 5 });
    ctx.save(); face(ctx); ctx.clip();
    // masonry joints + specks on the visible stone (sides, mullions)
    ctx.beginPath();
    const rows = 4, rh = (fy1 - fy0) / rows;
    for (let i = 1; i < rows; i++) { ctx.moveTo(fx0, fy0 + rh * i); ctx.lineTo(fx1, fy0 + rh * i); }
    for (let i = 0; i < rows; i++) { const off = i % 2 ? 0 : 18; for (let x = fx0 + off + 6; x < fx1; x += 36) { ctx.moveTo(x, fy0 + rh * i); ctx.lineTo(x, fy0 + rh * (i + 1)); } }
    stroke(ctx, 1.2, S.line);
    for (let i = 0; i < 40; i++) {
      const x = fx0 + hash(i * 3.1) * (fx1 - fx0), y = fy0 + hash(i * 7.7 + 1) * (fy1 - fy0);
      ctx.beginPath(); circ(ctx, x, y, 0.8 + hash(i) * 1.2); ctx.fillStyle = S.speck; ctx.fill();
    }
    ctx.restore();

    // ember vents on the side stone (3-reel layout has room)
    const ventW = G.r0.x - 9 - fx0 - 6;
    if (ventW >= 10) {
      for (const side of [0, 1]) {
        const vx = side ? G.rN.x + G.rN.w + 9 : fx0 + 4;
        for (const yy of [G.top + 14, G.top + 26, G.top + 38, G.bot - 40, G.bot - 28, G.bot - 16]) {
          ctx.beginPath(); rr(ctx, vx, yy - 2.5, ventW, 5, 2.5); Art.fs(ctx, '#0c0812', 1.2);
          const f = 0.45 + 0.25 * Math.sin(t * 2.3 + yy * 0.13 + side) + glow * 0.3;
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= clamp(f, 0, 1);
          ctx.beginPath(); rr(ctx, vx + 1.5, yy - 1, ventW - 3, 2, 1); ctx.fillStyle = boss ? '#b04a6a' : '#ff7a2f'; ctx.fill(); ctx.restore();
        }
      }
    }

    // drum wells
    for (const r of G.reels) {
      ctx.beginPath(); rr(ctx, r.x - 5, r.y - 5, r.w + 10, r.h + 10, 8); Art.fs(ctx, PAL.void, 2);
      const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      g.addColorStop(0, S.drumEdge); g.addColorStop(0.5, S.drumMid); g.addColorStop(1, S.drumEdge);
      ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
      // faint carved bands at the drum ends (rims of the stone cylinder)
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(r.x, r.y, 5, r.h); ctx.fillRect(r.x + r.w - 5, r.y, 5, r.h);
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(r.x + 5, r.y, 2, r.h); ctx.fillRect(r.x + r.w - 7, r.y, 2, r.h);
    }

    // corruption veins (boss): under the runes so progress stays readable
    if (boss) drawCorruption(ctx, G, t);

    // candle rail with old wax drips (spark candles sit here)
    const railW = Math.min(240, G.W * 0.42);
    sh(ctx, (c) => Art.roundRectPath(c, G.cx - railW / 2, G.Y0 - 3, railW, 9, 4), M.light, M.base, 2.2, { dx: -2, dy: -2 });
    for (let i = 0; i < 7; i++) {
      const x = G.cx - railW / 2 + 14 + (i / 6) * (railW - 28) + (hash(i + 9) - 0.5) * 10, len = 5 + hash(i + 3) * 9;
      ctx.beginPath(); ctx.moveTo(x - 3.2, G.Y0 - 3.5); ctx.lineTo(x + 3.2, G.Y0 - 3.5); ctx.lineTo(x + 2.4, G.Y0 + len - 2.4);
      ctx.arc(x, G.Y0 + len - 2.4, 2.4, 0, Math.PI); ctx.closePath();
      Art.fs(ctx, boss ? '#cfc6d6' : '#f2e4c6', 1.3);
    }

    // rune rim
    runeSlots(G).forEach((s, i) => drawRune(ctx, i, s[0], s[1], s[2], i < runes, t, M, boss));

    // bottom sigil: tiny wheel with the inner ember
    {
      const sx = G.cx, sy = G.Y1 - 9, sr = 13;
      sh(ctx, P((c) => circ(c, sx, sy, sr)), M.base, M.dark, 2.5, { dx: -2, dy: -2 });
      ctx.beginPath(); circ(ctx, sx, sy, sr - 4); Art.fs(ctx, M.deep, 1.5);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(boss ? -t * 0.4 : t * 0.25);
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3); ctx.lineTo(Math.cos(a) * 7.5, Math.sin(a) * 7.5); }
      stroke(ctx, 1.4, M.light); ctx.beginPath(); circ(ctx, 0, 0, 7.5); stroke(ctx, 1.2, M.light);
      ctx.restore();
      const f = 0.4 + (runes / 12) * 0.6;
      Art.glow(ctx, sx, sy, 12 + runes, boss ? 'rgba(190,120,255,0.7)' : 'rgba(255,140,60,0.75)', f);
      ctx.beginPath(); circ(ctx, sx, sy, 2.6); ctx.fillStyle = boss ? '#d6b8ff' : PAL.candle; ctx.fill();
    }

    // corner ornaments: diamond plates with ember gems
    const corners = [[G.X0 + 13, G.Y0 + 13], [G.X1 - 13, G.Y0 + 13], [G.X0 + 13, G.Y1 - 13], [G.X1 - 13, G.Y1 - 13]];
    corners.forEach(([x, y], i) => {
      sh(ctx, P((c) => poly(c, [[x, y - 21], [x + 21, y], [x, y + 21], [x - 21, y]])), M.base, M.dark, Art.LW, { dx: -3, dy: -3 });
      ctx.beginPath(); poly(ctx, [[x, y - 14], [x + 14, y], [x, y + 14], [x - 14, y]]); stroke(ctx, 1.2, M.dark);
      sh(ctx, P((c) => circ(c, x, y, 8.5)), M.light, M.base, 2.2, { dx: -2, dy: -2 });
      const gf = 0.35 + 0.15 * Math.sin(t * 2 + i * 1.6) + glow * 0.35;
      Art.glow(ctx, x, y, 14, boss ? 'rgba(170,110,255,0.8)' : 'rgba(255,110,40,0.8)', gf);
      ctx.beginPath(); circ(ctx, x, y, 4.4); Art.fs(ctx, boss ? '#8a5cc8' : '#e8552a', 1.5);
      ctx.beginPath(); circ(ctx, x - 1.4, y - 1.4, 1.4); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
    });
    // rivets down the side rails
    for (let i = 0; i < 4; i++) {
      const y = G.Y0 + 40 + (i / 3) * (G.H - 80);
      if (Math.abs(y - G.pyc) < 18) continue;
      rivet(ctx, G.X0 + G.sb / 2 - 0.5, y, 2.6, M); rivet(ctx, G.X1 - G.sb / 2 + 0.5, y, 2.6, M);
    }
    ctx.restore();
  };

  function drawCorruption(ctx, G, t) {
    ctx.save();
    Art.roundRectPath(ctx, G.X0, G.Y0, G.W, G.H, 20); ctx.clip();
    ctx.fillStyle = 'rgba(20,14,28,0.28)'; ctx.fillRect(G.X0, G.Y0, G.W, G.H);
    for (let k = 0; k < 9; k++) {
      let x = G.X0 + hash(k * 5.3) * G.W, y = hash(k * 2.9) < 0.5 ? G.Y0 + 3 : G.Y1 - 3;
      if (k % 3 === 0) { x = hash(k) < 0.5 ? G.X0 + 3 : G.X1 - 3; y = G.Y0 + hash(k * 1.7) * G.H; }
      const pts = [[x, y]];
      for (let s = 0; s < 6; s++) {
        const a = Math.atan2(G.Y0 + G.H / 2 - y, G.cx - x) + (hash(k * 13 + s) - 0.5) * 1.8;
        x += Math.cos(a) * 11; y += Math.sin(a) * 11; pts.push([x, y]);
      }
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]);
      stroke(ctx, 3, PAL.ink);
      const f = 0.45 + 0.35 * Math.sin(t * 2.2 + k);
      ctx.save(); ctx.globalAlpha *= f; stroke(ctx, 1.2, '#b48cff'); ctx.restore();
    }
    ctx.restore();
  }

  // ================================================================ DEVICE FRONT
  Art.drawDeviceFront = function (ctx, L, opts) {
    if (!ctx || !L) return;
    opts = opts || {};
    const t = +opts.t || 0, boss = !!opts.boss, glow = c01(opts.glow);
    const held = opts.held || [], jammed = opts.jammed || [];
    const M = metal(boss), G = geom(L);
    const py = G.py, ph = G.ph, pyc = G.pyc;
    ctx.save();

    // cylinder shading + glass
    G.reels.forEach((r) => {
      const d = r.h * 0.31;
      let g = ctx.createLinearGradient(0, r.y, 0, r.y + d);
      g.addColorStop(0, 'rgba(6,4,14,0.95)'); g.addColorStop(0.4, 'rgba(6,4,14,0.6)'); g.addColorStop(1, 'rgba(6,4,14,0)');
      ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, d);
      g = ctx.createLinearGradient(0, r.y + r.h, 0, r.y + r.h - d);
      g.addColorStop(0, 'rgba(6,4,14,0.95)'); g.addColorStop(0.4, 'rgba(6,4,14,0.6)'); g.addColorStop(1, 'rgba(6,4,14,0)');
      ctx.fillStyle = g; ctx.fillRect(r.x, r.y + r.h - d, r.w, d);
      // inner side shadow of the well
      g = ctx.createLinearGradient(r.x, 0, r.x + 14, 0); g.addColorStop(0, 'rgba(6,4,14,0.55)'); g.addColorStop(1, 'rgba(6,4,14,0)');
      ctx.fillStyle = g; ctx.fillRect(r.x, r.y, 14, r.h);
      g = ctx.createLinearGradient(r.x + r.w, 0, r.x + r.w - 10, 0); g.addColorStop(0, 'rgba(6,4,14,0.45)'); g.addColorStop(1, 'rgba(6,4,14,0)');
      ctx.fillStyle = g; ctx.fillRect(r.x + r.w - 10, r.y, 10, r.h);
      // glass glare
      ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      ctx.beginPath(); poly(ctx, [[r.x + r.w * 0.18, r.y], [r.x + r.w * 0.36, r.y], [r.x + r.w * 0.06, r.y + r.h], [r.x - r.w * 0.12, r.y + r.h]]);
      ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fill();
      line(ctx, r.x + r.w * 0.44, r.y, r.x + r.w * 0.2, r.y + r.h, 1.5, 'rgba(255,255,255,0.07)');
      ctx.restore();
    });

    // payline: warm light on the middle row
    const flick = 0.92 + Math.sin(t * 7.1) * 0.05 + Math.sin(t * 17.3) * 0.03;
    const A = (0.1 + glow * 0.22) * flick;
    G.reels.forEach((r) => {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(0, py, 0, py + ph);
      g.addColorStop(0, 'rgba(255,200,110,' + (A * 1.3).toFixed(3) + ')'); g.addColorStop(0.18, 'rgba(255,190,100,' + (A * 0.55).toFixed(3) + ')');
      g.addColorStop(0.82, 'rgba(255,190,100,' + (A * 0.55).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,200,110,' + (A * 1.3).toFixed(3) + ')');
      ctx.fillStyle = g; ctx.fillRect(r.x, py, r.w, ph);
      if (glow > 0.02) { // travelling sheen
        const span = G.rN.x + G.rN.w - G.r0.x, sx = G.r0.x + (((t * 0.55) % 1.3) - 0.15) * span;
        const sg = ctx.createLinearGradient(sx - 40, 0, sx + 40, 0);
        sg.addColorStop(0, 'rgba(255,230,160,0)'); sg.addColorStop(0.5, 'rgba(255,230,160,' + (glow * 0.28).toFixed(3) + ')'); sg.addColorStop(1, 'rgba(255,230,160,0)');
        ctx.beginPath(); ctx.rect(r.x, py, r.w, ph); ctx.fillStyle = sg; ctx.fill();
      }
      ctx.restore();
      // golden window rails
      for (const yy of [py, py + ph]) {
        line(ctx, r.x, yy, r.x + r.w, yy, 5, PAL.ink);
        line(ctx, r.x, yy, r.x + r.w, yy, 2.4, boss ? '#d9b97a' : PAL.gold);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.25 + glow * 0.6;
        line(ctx, r.x, yy, r.x + r.w, yy, 6, 'rgba(255,200,90,0.5)'); ctx.restore();
      }
    });

    // brass bezels
    G.reels.forEach((r) => drawBezel(ctx, r, M, pyc));

    // side payline markers
    const pulse = 0.55 + 0.25 * Math.sin(t * 4) + glow * 0.45;
    drawMarker(ctx, G.r0.x - 8, pyc, 1, M, pulse, glow, boss);
    drawMarker(ctx, G.rN.x + G.rN.w + 8, pyc, -1, M, pulse, glow, boss);

    // held clamps / jam gears
    G.reels.forEach((r, i) => {
      if (jammed[i]) drawJam(ctx, r, t, M, i);
      if (held[i]) drawClamp(ctx, r, t, M, pyc, i);
    });

    // boss: drifting ash over the whole machine
    if (boss) {
      for (let i = 0; i < 28; i++) {
        const x = G.X0 + hash(i * 1.3) * G.W + Math.sin(t * 0.7 + i) * 8;
        const ph2 = (t * (0.05 + hash(i + 4) * 0.06) + hash(i * 2.1)) % 1;
        const y = G.Y1 - ph2 * (G.H + 20);
        ctx.save(); ctx.globalAlpha *= Math.sin(ph2 * Math.PI) * 0.75;
        ctx.beginPath(); ell(ctx, x, y, 1.2 + hash(i) * 1.6, 0.9 + hash(i) * 0.8, t + i);
        ctx.fillStyle = i % 5 === 0 ? '#c79bff' : '#9d95a8'; ctx.fill(); ctx.restore();
      }
    }
    ctx.restore();
  };

  function drawBezel(ctx, r, M, pyc) {
    const o = 7, inn = 2;
    const path = (c) => { c.beginPath(); rr(c, r.x - o, r.y - o, r.w + o * 2, r.h + o * 2, 10); rrCCW(c, r.x + inn, r.y + inn, r.w - inn * 2, r.h - inn * 2, 5); };
    sh(ctx, path, M.base, M.dark, 2.5, { dx: -2.5, dy: -2.5 });
    line(ctx, r.x - o + 9, r.y - o + 1.8, r.x + r.w + o - 9, r.y - o + 1.8, 1.3, M.light);
    line(ctx, r.x - o + 1.8, r.y - o + 9, r.x - o + 1.8, r.y + r.h + o - 9, 1.3, M.light);
    for (const [x, y] of [[r.x - 2.5, r.y - 2.5], [r.x + r.w + 2.5, r.y - 2.5], [r.x - 2.5, r.y + r.h + 2.5], [r.x + r.w + 2.5, r.y + r.h + 2.5], [r.x + r.w / 2, r.y - 2.8], [r.x + r.w / 2, r.y + r.h + 2.8]]) rivet(ctx, x, y, 2.4, M);
    // payline tabs on the bezel
    for (const s of [1, -1]) {
      const x = s > 0 ? r.x + 1 : r.x + r.w - 1;
      ctx.beginPath(); poly(ctx, [[x - s * 2, pyc - 7], [x + s * 8, pyc], [x - s * 2, pyc + 7]]); Art.fs(ctx, PAL.gold, 1.8);
    }
  }

  function drawMarker(ctx, xTip, y, dir, M, pulse, glow, boss) {
    const len = 24, hh = 13, xb = xTip - dir * len;
    Art.glow(ctx, xTip - dir * 8, y, 26 + glow * 16, boss ? 'rgba(220,150,255,0.7)' : 'rgba(255,190,80,0.75)', clamp(pulse, 0, 1.2) * 0.8);
    sh(ctx, P((c) => poly(c, [[xb, y - hh], [xTip, y], [xb, y + hh]])), M.base, M.dark, 2.6, { dx: -2, dy: -2 });
    ctx.beginPath(); poly(ctx, [[xb + dir * 5, y - hh + 6], [xTip - dir * 7, y], [xb + dir * 5, y + hh - 6]]);
    Art.fs(ctx, boss ? '#e3c6ff' : PAL.gold, 1.4);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= clamp(pulse, 0, 1) * 0.6;
    ctx.beginPath(); poly(ctx, [[xb + dir * 5, y - hh + 6], [xTip - dir * 7, y], [xb + dir * 5, y + hh - 6]]); ctx.fillStyle = '#fff2c0'; ctx.fill(); ctx.restore();
    rivet(ctx, xb + dir * 3, y, 2.2, M);
  }

  function drawClamp(ctx, r, t, M, pyc, i) {
    const cx = r.x + r.w / 2;
    // warm brass light inside the held reel
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.55 + Math.sin(t * 3 + i) * 0.12;
    ctx.beginPath(); rr(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 5); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(232,191,106,0.5)'; ctx.stroke(); ctx.restore();
    // side latch pins at the payline
    for (const s of [-1, 1]) {
      const x = s < 0 ? r.x - 10 : r.x + r.w - 6;
      sh(ctx, P((c) => rr(c, x, pyc - 4.5, 16, 9, 3.5)), M.light, M.base, 2, { dx: -1.5, dy: -1.5 });
    }
    // top clamp bar with jaws
    const bx = r.x + 4, bw = r.w - 8, by = r.y - 13;
    for (const jx of [bx, bx + bw - 11]) sh(ctx, P((c) => rr(c, jx, by + 2, 11, 24, 4)), M.base, M.dark, 2.2, { dx: -2, dy: -2 });
    sh(ctx, P((c) => rr(c, bx, by, bw, 13, 5)), M.light, M.base, 2.4, { dx: -2, dy: -2.5 });
    line(ctx, bx + 6, by + 3.5, bx + bw - 6, by + 3.5, 1.2, M.hi);
    rivet(ctx, bx + 6, by + 6.5, 2.2, M); rivet(ctx, bx + bw - 6, by + 6.5, 2.2, M);
    // bottom latch bar with a lock plate
    const lb = r.y + r.h - 1;
    sh(ctx, P((c) => rr(c, bx, lb, bw, 11, 4.5)), M.light, M.base, 2.4, { dx: -2, dy: -2 });
    sh(ctx, P((c) => rr(c, cx - 8, lb - 4, 16, 16, 3.5)), M.base, M.dark, 2, { dx: -1.5, dy: -1.5 });
    ctx.beginPath(); circ(ctx, cx, lb + 2.5, 2); poly(ctx, [[cx - 1.4, lb + 3], [cx + 1.4, lb + 3], [cx + 2, lb + 8], [cx - 2, lb + 8]]); ctx.fillStyle = PAL.ink; ctx.fill();
    // brass padlock on the clamp bar, with Bram's red ribbon (the knight holds the reel)
    const ly = by - 10;
    ctx.beginPath(); ctx.arc(cx, ly + 2, 6.5, Math.PI, 0); ctx.lineWidth = 4.2; ctx.strokeStyle = PAL.ink; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, ly + 2, 6.5, Math.PI, 0); ctx.lineWidth = 2.2; ctx.strokeStyle = M.light; ctx.stroke();
    sh(ctx, P((c) => rr(c, cx - 10, ly + 1, 20, 15, 4)), M.light, M.base, 2.2, { dx: -1.8, dy: -1.8 });
    ctx.beginPath(); circ(ctx, cx, ly + 7, 2); poly(ctx, [[cx - 1.3, ly + 7.5], [cx + 1.3, ly + 7.5], [cx + 1.9, ly + 12], [cx - 1.9, ly + 12]]); ctx.fillStyle = PAL.ink; ctx.fill();
    const sway = Math.sin(t * 2.2 + i) * 2;
    for (const s of [-1, 1]) {
      ctx.beginPath(); poly(ctx, [[cx + s * 9, ly + 4], [cx + s * 22 + sway, ly + 1], [cx + s * 26 + sway, ly + 8], [cx + s * 20 + sway, ly + 6], [cx + s * 10, ly + 10]]);
      Art.fs(ctx, PAL.knightPlume, 1.6);
    }
    const gp = (t * 0.5 + i * 0.3) % 1.6;
    if (gp < 1) Art.glow(ctx, cx - 6 + gp * 12, ly + 6, 9, 'rgba(255,240,200,0.7)', 0.6);
  }

  function drawJam(ctx, r, t, M, i) {
    const jit = Math.sin(t * 37 + i) * 0.6;
    // rust stain on the glass + scratches
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.fillStyle = 'rgba(120,58,26,0.16)'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.beginPath();
    for (let k = 0; k < 4; k++) { const x = r.x + r.w * (0.15 + 0.22 * k); ctx.moveTo(x, r.y + r.h * 0.05); ctx.lineTo(x - 14, r.y + r.h * 0.22); }
    stroke(ctx, 1.2, 'rgba(201,128,72,0.35)');
    ctx.restore();
    const gx = r.x + r.w - 20 + jit, gy = r.y + r.h - 15;
    // rusty gear (the reel's drive gear), straining
    const rot = Math.sin(t * 9 + i) * 0.03;
    sh(ctx, P((c) => { poly(c, gearPts(gx, gy, 26, 19.5, 9, rot)); circCCW(c, gx, gy, 6); }), '#a9653a', '#6e3b1f', 2.6, { dx: -3, dy: -3 });
    ctx.beginPath(); circ(ctx, gx, gy, 12.5); stroke(ctx, 1.5, 'rgba(26,18,34,0.6)');
    for (const [dx, dy, rr2] of [[-9, -6, 3], [7, 8, 2.4], [10, -9, 2], [-4, 11, 1.8]]) { ctx.beginPath(); circ(ctx, gx + dx, gy + dy, rr2); ctx.fillStyle = '#c98048'; ctx.fill(); }
    ctx.beginPath(); circ(ctx, gx, gy, 6); ctx.fillStyle = '#120c10'; ctx.fill();
    // rust streaks running down from the gear
    for (const [dx, l] of [[-12, 10], [-4, 6]]) line(ctx, gx + dx, gy + 16, gx + dx - 1, gy + 16 + l, 2, 'rgba(150,72,34,0.7)');
    // iron wedge hammered into the teeth: tip in the gear, flat head sticking out over the bottom row
    const tipX = gx - 15, tipY = gy - 11, ax = gx - 50, ay = gy - 34;
    const ux = (tipX - ax), uy = (tipY - ay), ul = Math.hypot(ux, uy), dx = ux / ul, dy = uy / ul, nx = -dy, ny = dx;
    sh(ctx, P((c) => poly(c, [[ax + nx * 8, ay + ny * 8], [tipX, tipY], [ax - nx * 8, ay - ny * 8]])), '#6a6680', '#3a3648', 2.6, { dx: -2, dy: -2 });
    line(ctx, ax + nx * 3 + dx * 6, ay + ny * 3 + dy * 6, tipX - dx * 8 + nx * 0.8, tipY - dy * 8 + ny * 0.8, 1.2, 'rgba(255,255,255,0.5)');
    const hd = (a, b) => [ax + nx * a + dx * b, ay + ny * a + dy * b];
    sh(ctx, P((c) => poly(c, [hd(11, -6), hd(11, 3), hd(-11, 3), hd(-11, -6)])), '#8a87a0', '#4a4660', 2.4, { dx: -1.5, dy: -1.5 });
    line(ctx, hd(9, -4.5)[0], hd(9, -4.5)[1], hd(-9, -4.5)[0], hd(-9, -4.5)[1], 1, 'rgba(255,255,255,0.45)');
    // mushroomed (hammered) lip
    for (const s of [-1, 1]) { const p0 = hd(s * 11, -6), p1 = hd(s * 14, -8); line(ctx, p0[0], p0[1], p1[0], p1[1], 1.6, PAL.ink); }
    // strain sparks where the wedge bites
    const sp = (t * 1.7 + i * 0.37) % 1;
    if (sp < 0.35) {
      const k = sp / 0.35;
      for (let s = 0; s < 3; s++) {
        const a = -2.6 + s * 0.6, d = 5 + k * 14;
        ctx.save(); ctx.globalAlpha *= 1 - k; ctx.beginPath(); circ(ctx, tipX + Math.cos(a) * d, tipY + Math.sin(a) * d, 1.7);
        ctx.fillStyle = PAL.candleMid; ctx.fill(); ctx.restore();
      }
    }
  }

  // ================================================================ LEVER
  Art.drawLever = function (ctx, x, y, pull, t, opts) {
    if (!ctx) return;
    opts = opts || {}; t = +t || 0;
    const p = c01(pull), hov = num(opts.hover), dis = !!opts.disabled, M = metal(!!opts.boss);
    const len = opts.length || 150;
    const th = p * (110 * Math.PI / 180), near = Math.sin(th);
    const wob = !dis && hov && p < 0.02 ? Math.sin(t * 9) * 1.4 : 0;
    const kx = x + near * 16 + wob, ky = y - Math.cos(th) * len;
    ctx.save();

    // bracket bolting the lever to the machine (to the left)
    if (opts.mount !== false) {
      sh(ctx, P((c) => rr(c, x - 64, y - 10, 50, 20, 7)), M.base, M.dark, 2.6, { dx: -2, dy: -2.5 });
      line(ctx, x - 58, y - 6, x - 22, y - 6, 1.2, M.light);
      rivet(ctx, x - 54, y, 2.6, M); rivet(ctx, x - 38, y, 2.6, M);
    }
    // stone pedestal
    sh(ctx, P((c) => poly(c, [[x - 19, y + 6], [x + 19, y + 6], [x + 27, y + 66], [x - 27, y + 66]])), PAL.stone, PAL.dark2, 2.8, { dx: -4, dy: -3 });
    line(ctx, x - 22, y + 36, x + 23, y + 36, 1.2, PAL.stoneLight);
    sh(ctx, P((c) => rr(c, x - 29, y + 58, 58, 10, 4)), M.base, M.dark, 2.4, { dx: -2, dy: -2 });

    // ratchet drum (rotates with the pull)
    sh(ctx, P((c) => poly(c, gearPts(x, y, 25, 20, 12, -th * 1.5))), M.dark, M.deep, 2.6, { dx: -2, dy: -2 });
    sh(ctx, P((c) => circ(c, x, y, 19)), M.base, M.dark, 2.4, { dx: -3, dy: -3 });
    ctx.beginPath(); circ(ctx, x, y, 13.5); stroke(ctx, 1.3, M.dark);
    // pawl
    sh(ctx, P((c) => poly(c, [[x + 18, y - 26], [x + 27, y - 21], [x + 22, y - 15]])), M.light, M.base, 2, { dx: -1, dy: -1 });

    // arm
    const dx = kx - x, dy = ky - y, d = Math.hypot(dx, dy);
    if (d > 4) {
      const ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
      const wb = 6 * (1 + near * 0.25), wt = 4.2 * (1 + near * 0.35);
      const arm = (c) => { c.beginPath(); poly(c, [[x + nx * wb, y + ny * wb], [kx + nx * wt, ky + ny * wt], [kx - nx * wt, ky - ny * wt], [x - nx * wb, y - ny * wb]]); };
      sh(ctx, arm, dis ? '#8f7a5a' : M.base, M.dark, 2.8, { dx: nx * 3, dy: ny * 3 });
      line(ctx, x - nx * wb * 0.45 + ux * 10, y - ny * wb * 0.45 + uy * 10, kx - nx * wt * 0.45 - ux * 14, ky - ny * wt * 0.45 - uy * 14, 1.6, M.hi);
      if (d > 40) { // leather-wrapped grip below the knob
        const f0 = 0.6, f1 = 0.9, w0 = (wb + (wt - wb) * f0) + 1.5, w1 = (wb + (wt - wb) * f1) + 1.5;
        const gx0 = x + dx * f0, gy0 = y + dy * f0, gx1 = x + dx * f1, gy1 = y + dy * f1;
        const grip = (c) => { c.beginPath(); poly(c, [[gx0 + nx * w0, gy0 + ny * w0], [gx1 + nx * w1, gy1 + ny * w1], [gx1 - nx * w1, gy1 - ny * w1], [gx0 - nx * w0, gy0 - ny * w0]]); };
        sh(ctx, grip, dis ? '#5a4038' : '#7a4630', '#4e2a1d', 2.4, { dx: nx * 2.5, dy: ny * 2.5 });
        ctx.beginPath();
        const nW = Math.max(3, Math.floor((d * (f1 - f0)) / 6));
        for (let s = 1; s < nW; s++) { const f = f0 + ((f1 - f0) * s) / nW, ww = wb + (wt - wb) * f + 1.5, px = x + dx * f, py2 = y + dy * f; ctx.moveTo(px + nx * ww, py2 + ny * ww); ctx.lineTo(px - nx * ww + ux * 4, py2 - ny * ww + uy * 4); }
        stroke(ctx, 1.2);
      }
      for (const f of [0.2, 0.56]) { // collars
        const cxp = x + dx * f, cyp = y + dy * f, cw = (wb + (wt - wb) * f) + 3;
        sh(ctx, P((c) => poly(c, [[cxp + nx * cw - ux * 3, cyp + ny * cw - uy * 3], [cxp + nx * cw + ux * 3, cyp + ny * cw + uy * 3], [cxp - nx * cw + ux * 3, cyp - ny * cw + uy * 3], [cxp - nx * cw - ux * 3, cyp - ny * cw - uy * 3]])), M.light, M.base, 2, { dx: nx * 1.5, dy: ny * 1.5 });
      }
    }
    // hub cap
    sh(ctx, P((c) => circ(c, x, y, 9)), M.light, M.base, 2.4, { dx: -2, dy: -2 });
    ctx.beginPath(); poly(ctx, [[x - 3.5, y], [x, y - 3.5], [x + 3.5, y], [x, y + 3.5]]); ctx.fillStyle = M.deep; ctx.fill();

    // ember orb knob
    const kr = 16 * (1 + near * 0.3) * (1 + hov * 0.07);
    if (!dis) {
      const f = 0.62 + Math.sin(t * 3.3) * 0.1 + Math.sin(t * 11.7) * 0.04 + hov * 0.35 + p * 0.2;
      Art.glow(ctx, kx, ky, kr * (3.1 + hov), 'rgba(255,120,45,0.7)', clamp(f, 0, 1.2));
    }
    // ferrule
    sh(ctx, P((c) => rr(c, kx - kr * 0.45, ky + kr * 0.55, kr * 0.9, kr * 0.55, 3)), M.light, M.base, 2.2, { dx: -1.5, dy: -1.5 });
    const orb = P((c) => circ(c, kx, ky, kr));
    if (dis) {
      sh(ctx, orb, '#6e4f4a', '#45302f', Art.LW, { dx: -kr * 0.3, dy: -kr * 0.3 });
      ctx.beginPath(); circ(ctx, kx - kr * 0.1, ky + kr * 0.1, kr * 0.45); ctx.fillStyle = '#8a6455'; ctx.fill();
    } else {
      sh(ctx, orb, PAL.ember, '#b8301a', Art.LW, { dx: -kr * 0.3, dy: -kr * 0.3 });
      ctx.save(); orb(ctx); ctx.clip();
      const cf = 1 + Math.sin(t * 6.1) * 0.08;
      ctx.beginPath(); circ(ctx, kx - kr * 0.08, ky + kr * 0.08, kr * 0.58 * cf); ctx.fillStyle = PAL.candleMid; ctx.fill();
      ctx.beginPath(); circ(ctx, kx - kr * 0.1, ky + kr * 0.12, kr * 0.3 * cf); ctx.fillStyle = hov ? PAL.white : PAL.candle; ctx.fill();
      ctx.restore();
      orb(ctx); stroke(ctx, Art.LW);
    }
    ctx.beginPath(); ell(ctx, kx - kr * 0.42, ky - kr * 0.45, kr * 0.28, kr * 0.17, -0.7); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
    ctx.beginPath(); circ(ctx, kx + kr * 0.45, ky - kr * 0.05, kr * 0.08); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
    ctx.restore();
  };

  // ================================================================ SPARK CANDLE
  Art.drawSparkCandle = function (ctx, x, y, lit, t, opts) {
    if (!ctx) return;
    opts = opts || {}; t = +t || 0;
    const fl = c01(opts.flare), s = (+opts.size || 30) / 30, seed = opts.seed != null ? +opts.seed : x * 0.37;
    const M = metal(false);
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    if (fl > 0) {
      Art.glow(ctx, 0, -30, 20 + 44 * fl, 'rgba(255,200,110,0.95)', fl);
      rays(ctx, 0, -30, 34 + 34 * fl, 10, t * 1.2 + seed, 'rgba(255,225,160,0.95)', fl * 0.7, 0.08);
    }
    // dish
    sh(ctx, P((c) => ell(c, 0, -2, 13.5, 4.6)), M.base, M.dark, 2.2, { dx: -2, dy: -1.5 });
    ctx.beginPath(); c_arcHandle(ctx); stroke(ctx, 3.6, PAL.ink); ctx.beginPath(); c_arcHandle(ctx); stroke(ctx, 1.8, M.base);
    // wax body
    const wax = lit ? '#f4e4c4' : '#d8cbb4', waxSh = lit ? '#cfb486' : '#a99a80', drip = lit ? '#fcf1da' : '#e4d9c6';
    sh(ctx, P((c) => rr(c, -8, -24, 16, 22.5, 3)), wax, waxSh, 2.4, { dx: -3, dy: 0 });
    // top melt pool
    ctx.beginPath(); ell(ctx, 0, -23.6, 7, 2.4); ctx.fillStyle = lit ? '#ffe9a8' : '#efe4cf'; ctx.fill();
    // drips (soft wax runs with a shaded edge, outline only on the rounded tip)
    for (const [dx, len, w] of [[-4.6, 9, 3.2], [1.8, 5, 2.6], [6.2, 12, 2.8]]) {
      const path = () => { ctx.beginPath(); ctx.moveTo(dx - w, -24.8); ctx.lineTo(dx + w, -24.8); ctx.lineTo(dx + w, -24.5 + len); ctx.arc(dx, -24.5 + len, w, 0, Math.PI); ctx.closePath(); };
      path(); ctx.fillStyle = drip; ctx.fill();
      ctx.save(); path(); ctx.clip(); ctx.fillStyle = waxSh; ctx.globalAlpha *= 0.55; ctx.fillRect(dx + w * 0.35, -26, w, len + w + 2); ctx.restore();
      ctx.beginPath(); ctx.arc(dx, -24.5 + len, w, 0.15, Math.PI - 0.15); stroke(ctx, 1);
    }
    line(ctx, -6, -16, -6, -6, 1.2, 'rgba(255,255,255,0.6)');
    // wick
    ctx.beginPath(); ctx.moveTo(0, -24); ctx.quadraticCurveTo(0.2, -27, 0.9, -29); stroke(ctx, 1.7);
    if (lit) {
      Art.flame(ctx, 0.8, -28, 12.5 * (1 + fl * 0.5), t, { seed: seed, outline: true });
      if (fl > 0) Art.glow(ctx, 0.8, -33, 10 + fl * 10, 'rgba(255,255,230,0.9)', fl);
    } else {
      const e = 0.35 + 0.3 * Math.sin(t * 2.7 + seed);
      Art.glow(ctx, 0.9, -29, 4, 'rgba(255,110,40,0.8)', e);
      ctx.beginPath(); circ(ctx, 0.9, -29.2, 1.1); ctx.fillStyle = 'rgba(255,120,50,' + (0.4 + e).toFixed(2) + ')'; ctx.fill();
      // smoke wisp
      let px = 0.9, py0 = -30;
      ctx.lineCap = 'round';
      for (let i = 1; i <= 9; i++) {
        const nx = 0.9 + Math.sin(t * 1.7 + i * 0.75 + seed) * i * 0.55, ny = -30 - i * 3.6;
        ctx.beginPath(); ctx.moveTo(px, py0); ctx.lineTo(nx, ny);
        ctx.lineWidth = 1.1 + i * 0.22; ctx.strokeStyle = 'rgba(176,166,198,' + ((1 - i / 10) * 0.4).toFixed(3) + ')'; ctx.stroke();
        px = nx; py0 = ny;
      }
    }
    ctx.restore();
  };
  function c_arcHandle(ctx) { ctx.moveTo(11.5, -3.5); ctx.bezierCurveTo(18, -4, 18, 4, 11, 2); }

  // ================================================================ DOORS
  const DOOR_STYLE = {
    battle: { stone: '#5a5188', stoneSh: '#3c3566', interior: '#24160f', light: 'rgba(255,170,90,0.9)', glow: 'rgba(255,190,110,0.7)', leaf: 'single' },
    dread: { stone: '#4e2c3d', stoneSh: '#2e1824', interior: '#1c0709', light: 'rgba(255,60,70,0.9)', glow: 'rgba(255,70,80,0.7)', leaf: 'single' },
    shrine: { stone: '#544a8c', stoneSh: '#382f68', interior: '#1a1236', light: 'rgba(190,140,255,0.9)', glow: 'rgba(180,130,255,0.7)', leaf: null },
    campfire: { stone: '#5e4d61', stoneSh: '#3d3042', interior: '#1e1210', light: 'rgba(255,160,70,0.95)', glow: 'rgba(255,170,90,0.75)', leaf: null },
    elite: { stone: '#47445a', stoneSh: '#2b2938', interior: '#1d0f0a', light: 'rgba(255,150,60,0.9)', glow: 'rgba(255,170,80,0.7)', leaf: 'double' },
    boss: { stone: '#2e2836', stoneSh: '#18141e', interior: '#0e0a14', light: 'rgba(190,110,255,0.9)', glow: 'rgba(170,100,255,0.7)', leaf: 'double' },
  };
  function archPath(c, x0, x1, top, bottom) {
    const R = (x1 - x0) / 2, mx = (x0 + x1) / 2;
    c.moveTo(x0, bottom); c.lineTo(x0, top + R); c.arc(mx, top + R, R, Math.PI, TAU); c.lineTo(x1, bottom); c.closePath();
  }
  function leafPath(c, D, side) {
    const { ix0, ix1, it, ib, R, mx } = D;
    if (side === 'left') { c.moveTo(ix0, ib); c.lineTo(ix0, it + R); c.arc(mx, it + R, R, Math.PI, Math.PI * 1.5); c.lineTo(mx, ib); c.closePath(); }
    else if (side === 'right') { c.moveTo(mx, ib); c.lineTo(mx, it); c.arc(mx, it + R, R, Math.PI * 1.5, TAU); c.lineTo(ix1, ib); c.closePath(); }
    else archPath(c, ix0, ix1, it, ib);
  }

  Art.drawDoor = function (ctx, kind, cx, cy, w, h, t, opts) {
    if (!ctx) return;
    opts = opts || {}; t = +t || 0;
    const K = DOOR_STYLE[kind] ? kind : 'battle', S = DOOR_STYLE[K];
    w = +w || 120; h = +h || 170;
    const hov = num(opts.hover), open = c01(opts.open);
    const k = w / 120;
    const hw = w / 2, hh = h / 2, ft = w * 0.15, stepH = h * 0.05;
    const D = { hw, hh, ft, ix0: -hw + ft, ix1: hw - ft, it: -hh + ft * 0.9, ib: hh - stepH, mx: 0 };
    D.iw = D.ix1 - D.ix0; D.R = D.iw / 2;
    ctx.save();
    ctx.translate(cx, cy);
    // ground shadow stays on the floor while the door lifts
    ctx.save(); ctx.globalAlpha *= 0.55 - hov * 0.15; ctx.beginPath(); ell(ctx, 0, hh + 3, hw * (1.08 - hov * 0.05), 8 * k); ctx.fillStyle = '#05030a'; ctx.fill(); ctx.restore();
    ctx.translate(0, -hov * 5);
    if (hov > 0) Art.glow(ctx, 0, -hh * 0.1, w * 1.05, S.glow, hov * 0.45);

    // ---- frame (stone arch, voussoirs, keystone) ----
    const outer = (c) => { c.beginPath(); archPath(c, -hw, hw, -hh, hh); };
    if (K === 'boss') bossHorns(ctx, D, k, t);
    sh(ctx, outer, S.stone, S.stoneSh, Art.LW, { dx: -5 * k, dy: -5 * k });
    // voussoir joints
    ctx.save(); outer(ctx); ctx.clip();
    ctx.beginPath();
    const acy = D.it + D.R, n = 7;
    for (let i = 1; i < n; i++) { const a = Math.PI + (i / n) * Math.PI; ctx.moveTo(Math.cos(a) * D.R, acy + Math.sin(a) * D.R); ctx.lineTo(Math.cos(a) * (hw + 4), acy + Math.sin(a) * (hw + 4)); }
    for (let j = 0, y = acy + 4; y < hh - 6; j++, y += h * 0.13) { ctx.moveTo(-hw, y); ctx.lineTo(D.ix0, y); ctx.moveTo(D.ix1, y); ctx.lineTo(hw, y); }
    stroke(ctx, 1.6 * k, S.stoneSh);
    // chips / cracks for texture
    for (let i = 0; i < 9; i++) { const a = Math.PI + hash(i + K.length) * Math.PI; const rr2 = D.R + ft * (0.3 + hash(i * 3) * 0.5); ctx.beginPath(); circ(ctx, Math.cos(a) * rr2, acy + Math.sin(a) * rr2, 1.2 * k); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill(); }
    ctx.restore();
    // keystone
    sh(ctx, P((c) => poly(c, [[-9 * k, -hh - 4 * k], [9 * k, -hh - 4 * k], [6.5 * k, D.it + 4 * k], [-6.5 * k, D.it + 4 * k]])), S.stone, S.stoneSh, 2.6, { dx: -2, dy: -2 });
    if (K === 'elite') eliteSpikes(ctx, D, k);
    if (K === 'shrine') shrineRunes(ctx, D, k, t);
    if (K === 'dread') dreadFrameCracks(ctx, D, k, t);
    if (K === 'boss') { // violet rim light so the black arch still reads against the dark, plus glowing fissures
      ctx.save(); outer(ctx); ctx.clip();
      ctx.translate(2.5 * k, 2.5 * k); outer(ctx); stroke(ctx, 2.2 * k, 'rgba(176,120,255,0.55)');
      ctx.restore();
      const f = 0.5 + 0.4 * Math.sin(t * 2.3);
      for (const s of [-1, 1]) {
        const cr = [[s * (D.hw - 3 * k), D.hh * 0.05], [s * (D.hw - 9 * k), D.hh * 0.16], [s * (D.hw - 5 * k), D.hh * 0.27], [s * (D.hw - 12 * k), D.hh * 0.4]];
        ctx.beginPath(); ctx.moveTo(cr[0][0], cr[0][1]); for (const p of cr) ctx.lineTo(p[0], p[1]); stroke(ctx, 2.6 * k);
        ctx.save(); ctx.globalAlpha *= f; ctx.beginPath(); ctx.moveTo(cr[0][0], cr[0][1]); for (const p of cr) ctx.lineTo(p[0], p[1]); stroke(ctx, 1 * k, '#c9a2ff'); ctx.restore();
      }
    }

    // ---- opening / interior ----
    const opening = (c) => { c.beginPath(); archPath(c, D.ix0, D.ix1, D.it, D.ib); };
    ctx.save(); opening(ctx); ctx.fillStyle = S.interior; ctx.fill(); ctx.clip();
    const lightAmt = S.leaf ? open : 0.55 + open * 0.45;
    if (lightAmt > 0) {
      const g = ctx.createRadialGradient(0, D.ib, 2, 0, D.ib - D.iw * 0.2, h * 0.9);
      g.addColorStop(0, S.light); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha *= lightAmt; ctx.fillStyle = g; ctx.fillRect(-hw, -hh, w, h); ctx.globalAlpha = 1;
    }
    if (K === 'shrine') shrineInterior(ctx, D, k, t, open);
    if (K === 'campfire') campInterior(ctx, D, k, t, open);
    if (S.leaf && open > 0) roomSilhouette(ctx, D, k, K);
    ctx.restore();

    // ---- door leaves ----
    if (S.leaf) {
      const ang = open * 1.35, sx = Math.max(0.02, Math.cos(ang));
      const sides = S.leaf === 'double' ? ['left', 'right'] : ['single'];
      ctx.save(); opening(ctx); ctx.clip();
      for (const side of sides) {
        const hinge = side === 'right' ? D.ix1 : D.ix0;
        ctx.save(); ctx.translate(hinge, 0); ctx.scale(sx, 1); ctx.translate(-hinge, 0);
        paintLeaf(ctx, K, D, side, k, t);
        if (open > 0) { ctx.beginPath(); leafPath(ctx, D, side); ctx.fillStyle = 'rgba(4,2,10,' + (open * 0.55).toFixed(3) + ')'; ctx.fill(); }
        ctx.restore();
      }
      ctx.restore();
    }
    opening(ctx); stroke(ctx, 2.6 * Math.max(0.8, k));

    // ---- light spill on the floor when opened ----
    if (open > 0 || !S.leaf) {
      const a = S.leaf ? open : 0.5 + open * 0.5;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= a * 0.55;
      const g = ctx.createLinearGradient(0, D.ib, 0, D.ib + 30 * k);
      g.addColorStop(0, S.light); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath(); poly(ctx, [[D.ix0 + 4, D.ib], [D.ix1 - 4, D.ib], [D.ix1 + 26 * k, D.ib + 30 * k], [D.ix0 - 26 * k, D.ib + 30 * k]]); ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      if (S.leaf) rays(ctx, 0, D.ib - D.iw * 0.3, h * 0.55 * open, 7, -Math.PI / 2 + Math.sin(t * 0.5) * 0.05, S.light, open * 0.35, 0.07);
    }

    // ---- threshold step ----
    sh(ctx, P((c) => rr(c, -hw - 6 * k, hh - stepH, w + 12 * k, stepH + 5 * k, 3 * k)), S.stone, S.stoneSh, 2.6, { dx: -2, dy: -2 });

    if (K === 'battle') { wallTorch(ctx, -hw - 2 * k, -hh * 0.05, k, t, 0); wallTorch(ctx, hw + 2 * k, -hh * 0.05, k, t, 1); }
    if (K === 'boss') bossFlames(ctx, D, k, t);

    // ---- hover rim light ----
    if (hov > 0) {
      ctx.save(); ctx.globalAlpha *= hov;
      outer(ctx); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,225,160,0.9)'; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.4; outer(ctx); ctx.lineWidth = 9; ctx.strokeStyle = S.glow; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };

  function paintLeaf(c, K, D, side, k, t) {
    const lp = (cc) => { cc.beginPath(); leafPath(cc, D, side); };
    const { ix0, ix1, it, ib, R, iw } = D;
    const lx0 = side === 'right' ? 0 : ix0, lx1 = side === 'left' ? 0 : ix1;
    const acy = it + R;
    if (K === 'battle' || K === 'dread') {
      const dread = K === 'dread';
      sh(c, lp, dread ? '#4c2329' : '#8a5532', dread ? '#2c1218' : '#5e3720', 2.4, { dx: -5 * k, dy: -4 * k });
      c.save(); lp(c); c.clip();
      // planks + grain
      c.beginPath(); for (let i = 1; i < 5; i++) { const x = ix0 + (iw * i) / 5; c.moveTo(x, it - 4); c.lineTo(x, ib); } stroke(c, 1.6 * k, dread ? '#1a0a0e' : '#4a2a16');
      c.beginPath();
      for (let i = 0; i < 10; i++) { const x = ix0 + (iw * (i % 5 + 0.5)) / 5 + (hash(i * 7) - 0.5) * 6 * k, y = acy - R * 0.3 + hash(i * 3.3) * (ib - acy); c.moveTo(x - 3 * k, y); c.quadraticCurveTo(x, y - 4 * k, x + 2 * k, y + 6 * k); }
      stroke(c, 1 * k, dread ? 'rgba(120,40,50,0.6)' : 'rgba(190,120,70,0.6)');
      // iron bands
      for (const y of [acy + 2 * k, ib - 24 * k]) {
        c.beginPath(); rr(c, ix0 - 2, y, iw + 4, 9 * k, 2); Art.fs(c, dread ? '#2a2430' : '#3b3646', 2);
        line(c, ix0, y + 2.2 * k, ix1, y + 2.2 * k, 1, 'rgba(255,255,255,0.18)');
        for (let i = 0; i < 5; i++) { c.beginPath(); circ(c, ix0 + iw * (0.1 + i * 0.2), y + 4.5 * k, 1.8 * k); c.fillStyle = '#8a8598'; c.fill(); }
      }
      c.restore();
      lp(c); stroke(c, 2.4);
      if (!dread) {
        // ring pull
        c.beginPath(); c.arc(ix1 - 12 * k, acy + 30 * k, 6 * k, 0, TAU); stroke(c, 4.5 * k); c.beginPath(); c.arc(ix1 - 12 * k, acy + 30 * k, 6 * k, 0, TAU); stroke(c, 2 * k, '#8a8598');
        // crossed swords on a brass roundel
        const ex = 0, ey = acy - R * 0.12;
        sh(c, P((cc) => circ(cc, ex, ey, 15 * k)), PAL.brass, PAL.brassDark, 2.4, { dx: -2, dy: -2 });
        for (const s of [-1, 1]) {
          c.save(); c.translate(ex, ey); c.rotate(s * Math.PI / 4); c.scale(k, k);
          c.beginPath(); poly(c, [[0, -26], [4, -21], [4, 8], [-4, 8], [-4, -21]]); Art.fs(c, PAL.steel, 2);
          line(c, 0, -20, 0, 6, 1, PAL.steelShade);
          c.beginPath(); rr(c, -9, 7, 18, 4.5, 2); Art.fs(c, PAL.brassLight, 1.8);
          c.beginPath(); rr(c, -2.2, 11, 4.4, 9, 1.5); Art.fs(c, '#6b3b23', 1.6);
          c.restore();
        }
      } else {
        dreadLeafExtras(c, D, k, t, lp);
      }
    } else if (K === 'elite') {
      sh(c, lp, '#4b4a5c', '#2f2e3c', 2.4, { dx: -4 * k, dy: -4 * k });
      c.save(); lp(c); c.clip();
      c.beginPath(); for (const y of [acy - R * 0.4, acy + 22 * k, ib - 20 * k]) { rr(c, ix0 - 2, y, iw + 4, 10 * k, 2); } Art.fs(c, '#5d5b70', 2);
      for (const y of [acy - R * 0.4, acy + 22 * k, ib - 20 * k]) for (let i = 0; i < 6; i++) { const x = lx0 + (lx1 - lx0) * (0.12 + i * 0.16); c.beginPath(); circ(c, x, y + 5 * k, 2.4 * k); Art.fs(c, '#9a97ab', 1); }
      c.beginPath(); for (let i = 1; i < 3; i++) { const x = lx0 + ((lx1 - lx0) * i) / 3; c.moveTo(x, it); c.lineTo(x, ib); } stroke(c, 1.4, '#24232e');
      beastEmblem(c, 0, acy + 4 * k, k, t);
      c.restore();
      lp(c); stroke(c, 2.4);
    } else if (K === 'boss') {
      sh(c, lp, '#1f1a26', '#110e16', 2.4, { dx: -4 * k, dy: -4 * k });
      c.save(); lp(c); c.clip();
      c.beginPath(); for (const y of [it + R * 0.45, ib - 22 * k]) rr(c, ix0 - 2, y, iw + 4, 8 * k, 2); Art.fs(c, '#4a4352', 2);
      c.beginPath(); for (let i = 0; i < 14; i++) { const x = ix0 + hash(i * 4.1) * iw, y = it + hash(i * 9.2) * (ib - it); circ(c, x, y, 1.6 * k); } c.fillStyle = '#5b5366'; c.fill();
      ashWheel(c, 0, acy + 8 * k, Math.min(iw * 0.38, 30 * k), k, t);
      c.restore();
      lp(c); stroke(c, 2.4);
    }
  }

  function dreadLeafExtras(c, D, k, t, lp) {
    const { ix0, ix1, it, ib, R } = D, acy = it + R;
    // glowing cracks
    const cracks = [[[ix0 + 6 * k, acy - 6 * k], [ix0 + 16 * k, acy + 6 * k], [ix0 + 12 * k, acy + 18 * k], [ix0 + 24 * k, acy + 30 * k]], [[ix1 - 4 * k, ib - 34 * k], [ix1 - 16 * k, ib - 26 * k], [ix1 - 12 * k, ib - 12 * k], [ix1 - 22 * k, ib - 2 * k]], [[-4 * k, it + 8 * k], [3 * k, it + 18 * k], [-2 * k, it + 26 * k]]];
    const f = 0.6 + 0.4 * Math.sin(t * 3.3);
    c.save(); lp(c); c.clip();
    for (const cr of cracks) {
      c.beginPath(); c.moveTo(cr[0][0], cr[0][1]); for (const p of cr) c.lineTo(p[0], p[1]); stroke(c, 3.2 * k);
      c.save(); c.globalAlpha *= f; c.beginPath(); c.moveTo(cr[0][0], cr[0][1]); for (const p of cr) c.lineTo(p[0], p[1]); stroke(c, 1.2 * k, '#ff6a6a'); c.restore();
      Art.glow(c, cr[1][0], cr[1][1], 12 * k, 'rgba(255,50,60,0.7)', f * 0.7);
    }
    // crossing chains
    chainLine(c, ix0 - 2, it + R * 0.55, ix1 + 2, ib - 14 * k, 9 * k);
    chainLine(c, ix1 + 2, it + R * 0.55, ix0 - 2, ib - 14 * k, 9 * k);
    c.restore();
    lp(c); stroke(c, 2.4);
    // skull emblem with red eyes where the chains cross
    const ex = (ix0 + ix1) / 2, ey = (it + R * 0.55 + ib - 14 * k) / 2 - 2 * k;
    c.save(); c.translate(ex, ey); c.scale(k * 0.36, k * 0.36);
    c.beginPath(); rr(c, -19, 14, 38, 26, 9); Art.fs(c, PAL.bone, 6);
    Art.shape(c, (cc) => { cc.beginPath(); cc.moveTo(0, -42); cc.bezierCurveTo(24, -42, 38, -27, 36, -6); cc.bezierCurveTo(35, 8, 28, 14, 24, 18); cc.lineTo(22, 26); cc.lineTo(-22, 26); cc.lineTo(-24, 18); cc.bezierCurveTo(-28, 14, -35, 8, -36, -6); cc.bezierCurveTo(-38, -27, -24, -42, 0, -42); cc.closePath(); }, PAL.bone, PAL.boneShade, { lw: 6, dx: -7, dy: -7 });
    c.beginPath(); ell(c, -13, -4, 10, 11, -0.3); ell(c, 13, -4, 10, 11, 0.3); c.fillStyle = PAL.ink; c.fill();
    c.beginPath(); poly(c, [[0, 6], [5, 14], [-5, 14]]); c.fill();
    c.restore();
    Art.enemyEye(c, ex - 13 * k * 0.36, ey - 3 * k * 0.36, 2.2 * k, { color: '#ff5560', glowColor: 'rgba(255,40,60,0.7)', glowAlpha: f });
    Art.enemyEye(c, ex + 13 * k * 0.36, ey - 3 * k * 0.36, 2.2 * k, { color: '#ff5560', glowColor: 'rgba(255,40,60,0.7)', glowAlpha: f });
    // blood light under the door
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 0.5 + 0.3 * f;
    const g = c.createLinearGradient(0, ib, 0, ib - 16 * k); g.addColorStop(0, 'rgba(255,40,50,0.8)'); g.addColorStop(1, 'rgba(255,40,50,0)');
    c.fillStyle = g; c.fillRect(ix0, ib - 16 * k, ix1 - ix0, 16 * k); c.restore();
  }

  function dreadFrameCracks(c, D, k, t) {
    const f = 0.5 + 0.4 * Math.sin(t * 2.7 + 1);
    const cr = [[-D.hw + 4 * k, -D.hh * 0.1], [-D.hw + 10 * k, -D.hh * 0.02], [-D.hw + 6 * k, D.hh * 0.12], [-D.hw + 13 * k, D.hh * 0.22]];
    c.beginPath(); c.moveTo(cr[0][0], cr[0][1]); for (const p of cr) c.lineTo(p[0], p[1]); stroke(c, 2.6 * k);
    c.save(); c.globalAlpha *= f; c.beginPath(); c.moveTo(cr[0][0], cr[0][1]); for (const p of cr) c.lineTo(p[0], p[1]); stroke(c, 1 * k, '#ff5a64'); c.restore();
    // drips of red from the keystone
    for (const [x, l] of [[-5 * k, 8], [4 * k, 13]]) {
      c.beginPath(); c.moveTo(x - 1.6 * k, D.it + 3 * k); c.lineTo(x + 1.6 * k, D.it + 3 * k); c.lineTo(x + 1.4 * k, D.it + (3 + l) * k); c.arc(x, D.it + (3 + l) * k, 1.4 * k, 0, Math.PI); c.closePath();
      Art.fs(c, '#c22a3a', 1.2);
    }
  }

  function eliteSpikes(c, D, k) {
    const acy = D.it + D.R;
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * 1.18 + (i / 4) * Math.PI * 0.64, r0 = D.hw - 2 * k, r1 = D.hw + 14 * k, wa = 0.07;
      const pts = [[Math.cos(a - wa) * r0, acy + Math.sin(a - wa) * r0], [Math.cos(a) * r1, acy + Math.sin(a) * r1], [Math.cos(a + wa) * r0, acy + Math.sin(a + wa) * r0]];
      sh(c, P((cc) => poly(cc, pts)), '#77748c', '#45435a', 2.4, { dx: -1.5, dy: -1.5 });
    }
  }

  function beastEmblem(c, x, y, k, t) {
    c.save(); c.translate(x, y); c.scale(k, k);
    // ring knocker (behind head)
    c.beginPath(); c.arc(0, 22, 10, 0, TAU); stroke(c, 6); c.beginPath(); c.arc(0, 22, 10, 0, TAU); stroke(c, 3, PAL.brass);
    // ears
    for (const s of [-1, 1]) sh(c, P((cc) => poly(cc, [[s * 7, -14], [s * 20, -27], [s * 18, -5]])), PAL.brass, PAL.brassDark, 2.4, { dx: -1.5, dy: -1.5 });
    // head
    sh(c, P((cc) => Art.blobPath(cc, [[-17, -13], [0, -18], [17, -13], [19, 2], [10, 15], [0, 19], [-10, 15], [-19, 2]])), PAL.brass, PAL.brassDark, 2.6, { dx: -3, dy: -3 });
    sh(c, P((cc) => ell(cc, 0, 9, 9, 7)), PAL.brassLight, PAL.brass, 2, { dx: -1.5, dy: -1.5 });
    c.beginPath(); poly(c, [[-3.5, 4.5], [3.5, 4.5], [0, 8]]); c.fillStyle = PAL.ink; c.fill();
    c.beginPath(); c.moveTo(-6, 13); c.quadraticCurveTo(0, 17, 6, 13); stroke(c, 1.6);
    for (const s of [-1, 1]) { c.beginPath(); poly(c, [[s * 4, 13.5], [s * 2.5, 18.5], [s * 1, 14.5]]); Art.fs(c, PAL.bone, 1); }
    // angry brows
    c.beginPath(); c.moveTo(-13, -8); c.lineTo(-3, -3); c.moveTo(13, -8); c.lineTo(3, -3); stroke(c, 2.2);
    c.restore();
    const f = 0.7 + Math.sin(t * 2.4) * 0.3;
    Art.enemyEye(c, x - 7.5 * k, y - 1 * k, 2.4 * k, { color: PAL.candleMid, slit: 1, glowAlpha: f });
    Art.enemyEye(c, x + 7.5 * k, y - 1 * k, 2.4 * k, { color: PAL.candleMid, slit: 1, glowAlpha: f });
  }

  function ashWheel(c, x, y, r, k, t) {
    Art.glow(c, x, y, r * 1.6, 'rgba(150,90,230,0.55)', 0.6 + Math.sin(t * 1.7) * 0.2);
    c.save(); c.translate(x, y); c.rotate(-t * 0.25); // the reverse-turning twin
    sh(c, P((cc) => { poly(cc, gearPts(0, 0, r, r * 0.84, 12, 0)); circCCW(cc, 0, 0, r * 0.62); }), '#8c8494', '#5b5463', 2.4, { dx: -2, dy: -2 });
    c.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; rr(c, -2.4 * k, -r * 0.64, 4.8 * k, r * 0.5, 2); c.rotate(TAU / 6); } Art.fs(c, '#7a7284', 1.6);
    sh(c, P((cc) => circ(cc, 0, 0, r * 0.22)), '#9a92a3', '#5b5463', 2.2, { dx: -1.5, dy: -1.5 });
    c.restore();
    // violet cracks + ember core
    const f = 0.55 + 0.45 * Math.sin(t * 2.9);
    c.save(); c.globalAlpha *= f;
    c.beginPath(); c.moveTo(x - r * 0.9, y - r * 0.2); c.lineTo(x - r * 0.62, y - r * 0.05); c.lineTo(x - r * 0.7, y + r * 0.2);
    c.moveTo(x + r * 0.4, y - r * 0.85); c.lineTo(x + r * 0.32, y - r * 0.62); c.lineTo(x + r * 0.45, y - r * 0.5);
    stroke(c, 1.4 * k, '#c9a2ff'); c.restore();
    Art.glow(c, x, y, r * 0.5, 'rgba(200,140,255,0.9)', f);
    c.beginPath(); circ(c, x, y, r * 0.09); c.fillStyle = '#f0e2ff'; c.fill();
  }

  function bossHorns(c, D, k, t) {
    for (const s of [-1, 1]) {
      const bx = s * D.hw * 0.55, by = -D.hh + D.hw * 0.25;
      sh(c, P((cc) => { cc.moveTo(bx - s * 10 * k, by + 8 * k); cc.quadraticCurveTo(bx + s * 6 * k, by - 26 * k, bx + s * 26 * k, by - 34 * k); cc.quadraticCurveTo(bx + s * 12 * k, by - 16 * k, bx + s * 12 * k, by + 10 * k); cc.closePath(); }), '#4a4352', '#26212d', 2.6, { dx: -2, dy: -2 });
    }
    // jagged crown stones
    for (let i = -2; i <= 2; i++) {
      const x = i * 11 * k, y = -D.hh + 1;
      sh(c, P((cc) => poly(cc, [[x - 6 * k, y + 4 * k], [x, y - (8 + (i === 0 ? 8 : 2 * Math.abs(i))) * k], [x + 6 * k, y + 4 * k]])), '#3a3343', '#1f1a26', 2.2, { dx: -1.5, dy: -1.5 });
    }
  }

  function bossFlames(c, D, k, t) {
    // black-violet flames licking up the jambs
    for (let i = 0; i < 6; i++) {
      const s = i % 2 ? 1 : -1, x = s * (D.hw - 4 * k - (i >> 1) * 6 * k), y = D.hh - 4 * k;
      Art.flame(c, x, y, (16 + (i >> 1) * 5) * k, t, { seed: i * 2.3, outer: '#2a1838', inner: '#8a5cc8', glowColor: 'rgba(140,80,220,0.45)' });
    }
    for (let i = 0; i < 10; i++) { // ash flakes
      const ph = (t * 0.12 + hash(i * 3.7)) % 1;
      const x = (hash(i * 1.9) - 0.5) * D.hw * 2.4 + Math.sin(t + i) * 6, y = D.hh - ph * D.hh * 2.4;
      c.save(); c.globalAlpha *= Math.sin(ph * Math.PI) * 0.7; c.beginPath(); circ(c, x, y, 1.3 * k); c.fillStyle = '#a49bb0'; c.fill(); c.restore();
    }
  }

  function shrineRunes(c, D, k, t) {
    const acy = D.it + D.R, rr2 = (D.R + D.hw) / 2, n = 7;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + ((i + 0.5) / n) * Math.PI, x = Math.cos(a) * rr2, y = acy + Math.sin(a) * rr2;
      const f = 0.55 + 0.45 * Math.sin(t * 2.2 - i * 0.7);
      Art.glow(c, x, y, 9 * k, 'rgba(190,140,255,0.8)', f);
      runePath(c, i + 3, x, y, 2.6 * k, 3 * k); stroke(c, 2.6 * k, '#2a1f4a');
      c.save(); c.globalAlpha *= 0.5 + f * 0.5; runePath(c, i + 3, x, y, 2.6 * k, 3 * k); stroke(c, 1.2 * k, '#e2ccff'); c.restore();
    }
  }

  function shrineInterior(c, D, k, t, open) {
    const { ix0, ix1, it, ib, iw } = D;
    // light shafts
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const x = -iw * 0.25 + i * iw * 0.25 + Math.sin(t * 0.6 + i) * 3;
      const g = c.createLinearGradient(0, it, 0, ib); g.addColorStop(0, 'rgba(200,160,255,0.28)'); g.addColorStop(1, 'rgba(200,160,255,0)');
      c.beginPath(); poly(c, [[x - 4 * k, it], [x + 4 * k, it], [x + 12 * k, ib], [x - 2 * k, ib]]); c.fillStyle = g; c.globalAlpha = 0.6 + open * 0.4; c.fill();
    }
    c.restore();
    // altar
    const aw = iw * 0.56, ah = 26 * k, ay = ib - ah;
    sh(c, P((cc) => poly(cc, [[-aw / 2 + 4 * k, ay], [aw / 2 - 4 * k, ay], [aw / 2, ib + 1], [-aw / 2, ib + 1]])), '#4a4078', '#2e2754', 2.4, { dx: -2, dy: -2 });
    sh(c, P((cc) => rr(cc, -aw / 2 - 2 * k, ay - 5 * k, aw + 4 * k, 7 * k, 2)), '#6a5fa4', '#4a4078', 2.2, { dx: -1.5, dy: -1.5 });
    const f = 0.6 + 0.4 * Math.sin(t * 2.5);
    Art.glow(c, 0, ay + ah * 0.5, 14 * k, 'rgba(190,140,255,0.8)', f);
    runePath(c, 11, 0, ay + ah * 0.55, 4 * k, 5.5 * k); stroke(c, 1.8 * k, '#e2ccff');
    // altar candles
    for (const s of [-1, 1]) {
      const x = s * (aw / 2 - 5 * k);
      c.beginPath(); rr(c, x - 2.5 * k, ay - 14 * k, 5 * k, 9 * k, 1.5); Art.fs(c, PAL.bone, 1.4);
      Art.flame(c, x, ay - 14 * k, 6 * k, t, { seed: s * 3 });
    }
    // floating crystal
    const bob = Math.sin(t * 1.8) * 4 * k, cy = ay - 30 * k + bob;
    Art.glow(c, 0, cy, 30 * k * (1 + open * 0.3), 'rgba(180,120,255,0.85)', 0.75 + open * 0.25);
    sh(c, P((cc) => poly(cc, [[0, cy - 15 * k], [9 * k, cy], [0, cy + 15 * k], [-9 * k, cy]])), '#c9a8ff', '#8a64d4', 2.4, { dx: -2, dy: -2 });
    c.beginPath(); poly(c, [[0, cy - 15 * k], [-9 * k, cy], [0, cy + 2 * k]]); c.fillStyle = 'rgba(255,255,255,0.45)'; c.fill();
    c.save(); c.globalAlpha *= 0.4; c.beginPath(); ell(c, 0, ay - 6 * k, 8 * k, 2 * k); c.fillStyle = '#05030a'; c.fill(); c.restore();
  }

  function campInterior(c, D, k, t, open) {
    const { ix0, ix1, it, ib, iw } = D;
    // floor
    c.beginPath(); ell(c, 0, ib + 2 * k, iw * 0.62, 12 * k); c.fillStyle = '#3a221a'; c.fill();
    // bedroll + pot silhouette
    c.beginPath(); rr(c, ix0 + 4 * k, ib - 9 * k, 22 * k, 8 * k, 4 * k); Art.fs(c, '#2f6f8f', 1.6);
    c.beginPath(); rr(c, ix0 + 4 * k, ib - 9 * k, 7 * k, 8 * k, 3 * k); Art.fs(c, '#e0453f', 1.4);
    const fx = 4 * k, fy = ib - 6 * k;
    const f = 1 + Math.sin(t * 8.3) * 0.06;
    Art.glow(c, fx, fy - 14 * k, 60 * k * f, 'rgba(255,150,60,0.75)', 0.8 + open * 0.2);
    // hanging pot on a tripod (behind the fire)
    c.beginPath(); c.moveTo(fx - 26 * k, fy + 2 * k); c.lineTo(fx, fy - 68 * k); c.lineTo(fx + 26 * k, fy + 2 * k); stroke(c, 2.6 * k, '#2a1a14');
    c.beginPath(); c.moveTo(fx, fy - 68 * k); c.lineTo(fx, fy - 56 * k); stroke(c, 1.2 * k, '#2a1a14');
    c.beginPath(); c.moveTo(fx - 10 * k, fy - 56 * k); c.lineTo(fx + 10 * k, fy - 56 * k); c.quadraticCurveTo(fx + 11 * k, fy - 43 * k, fx, fy - 42 * k); c.quadraticCurveTo(fx - 11 * k, fy - 43 * k, fx - 10 * k, fy - 56 * k); c.closePath();
    Art.fs(c, '#3b3646', 1.8);
    c.beginPath(); c.moveTo(fx - 7 * k, fy - 54 * k); c.lineTo(fx - 7 * k, fy - 47 * k); stroke(c, 1 * k, 'rgba(255,190,120,0.6)');
    // stones
    for (const [dx, dy] of [[-21, 1], [-12, 5], [0, 6.5], [12, 5], [21, 1]]) { c.beginPath(); ell(c, fx + dx * k, fy + dy * k, 6 * k, 4 * k); Art.fs(c, '#6c6480', 1.6); }
    // logs
    for (const a of [0.42, -0.42]) {
      c.save(); c.translate(fx, fy - 2 * k); c.rotate(a);
      c.beginPath(); rr(c, -19 * k, -4 * k, 38 * k, 8 * k, 4 * k); Art.fs(c, '#6e3e22', 1.8);
      c.beginPath(); ell(c, a > 0 ? 17 * k : -17 * k, 0, 2.6 * k, 3.6 * k); Art.fs(c, '#c98a52', 1);
      c.restore();
    }
    // the fire
    Art.flame(c, fx - 7 * k, fy - 4 * k, 20 * k, t, { seed: 1, glow: false });
    Art.flame(c, fx + 8 * k, fy - 4 * k, 22 * k, t, { seed: 2.7, glow: false });
    Art.flame(c, fx, fy - 3 * k, 34 * k * (1 + open * 0.12), t, { seed: 5, glow: false, outline: true });
    // sparks
    for (let i = 0; i < 7; i++) {
      const ph = (t * 0.7 + i / 7) % 1, x = fx + Math.sin(i * 2.1 + t * 2) * 10 * k, y = fy - 30 * k - ph * 56 * k;
      c.save(); c.globalAlpha *= 1 - ph; c.beginPath(); circ(c, x, y, 1.5 * k); c.fillStyle = PAL.candleMid; c.fill(); c.restore();
    }
  }

  function roomSilhouette(c, D, k, K) {
    // a hint of the room beyond: floor line + a distant pillar silhouette
    const { ib, iw } = D;
    c.beginPath(); rr(c, -iw * 0.32, ib - 52 * k, 9 * k, 52 * k, 2); rr(c, iw * 0.22, ib - 46 * k, 8 * k, 46 * k, 2);
    c.fillStyle = 'rgba(5,3,10,0.6)'; c.fill();
    if (K === 'elite' || K === 'dread' || K === 'boss') { // eyes in the dark
      c.save(); c.globalAlpha *= 0.85;
      c.beginPath(); circ(c, -4 * k, ib - 30 * k, 1.6 * k); circ(c, 4 * k, ib - 30 * k, 1.6 * k);
      c.fillStyle = K === 'boss' ? '#d6b0ff' : '#ff5560'; c.fill(); c.restore();
    }
  }

  function wallTorch(c, x, y, k, t, seed) {
    c.beginPath(); rr(c, x - 4 * k, y, 8 * k, 10 * k, 2); Art.fs(c, '#3b3646', 2);
    c.save(); c.translate(x, y + 2 * k); c.rotate(seed ? 0.25 : -0.25);
    c.beginPath(); rr(c, -2.5 * k, -16 * k, 5 * k, 18 * k, 2); Art.fs(c, '#6e3e22', 1.8);
    c.beginPath(); rr(c, -4 * k, -19 * k, 8 * k, 5 * k, 2); Art.fs(c, PAL.brassDark, 1.6);
    Art.flame(c, 0, -19 * k, 13 * k, t, { seed: seed * 4.1 + 1 });
    c.restore();
  }
})();
