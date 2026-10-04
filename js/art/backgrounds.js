/* EMBERWHEEL — js/art/backgrounds.js
 * Parallax stage backdrops in the "Candlelit Paper Theater" style.
 *
 *   SD.Art.drawBackground(ctx, zone, { t, camX, W, H, depth })
 *   SD.Art.drawForeground(ctx, zone, { t, camX, W, H, depth })
 *   zones: 'cellar' | 'ossuary' | 'gearworks' | 'abyss' | 'camp' | 'title'
 *
 * Layers scroll with camX: far x0.25, mid x0.6, floor x1.0, foreground x1.35.
 * Every scrolling layer is a strip of period P built from fixed-width segments whose contents vary
 * deterministically (Art.hash of the segment index / curated sequences), so it tiles seamlessly for any camX.
 * The static paint of each strip is rendered ONCE into an offscreen canvas (browser only, lazily, LRU-capped);
 * flames, gears, drips, steam, fog, ash, water ripples and reflections are drawn live each frame.
 * In Node (no DOM) everything is painted directly (slow path, used by smoke tests only).
 */
(function () {
  'use strict';
  const SD = (globalThis.SD = globalThis.SD || {});
  const Art = (SD.Art = SD.Art || {});

  // ======================================================================= utils
  const TAU = Math.PI * 2;
  const INK = '#1a1222';
  const mod = (a, n) => ((a % n) + n) % n;
  const frac = (x) => x - Math.floor(x);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const hash = (n) => (Art.hash ? Art.hash(n) : frac(Math.sin(n * 127.1 + 311.7) * 43758.5453));
  const rnd = (seed) => { let i = 0; return () => hash(seed * 0.6180339 + ++i * 1.7320508); };
  const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

  const _rgb = Object.create(null);
  function rgbOf(col) {
    let v = _rgb[col];
    if (v) return v;
    let h = col.charAt(0) === '#' ? col.slice(1) : col;
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16) || 0;
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    _rgb[col] = v;
    return v;
  }
  function mix(a, b, t) {
    const A = rgbOf(a), B = rgbOf(b);
    const r = Math.round(lerp(A[0], B[0], t)), g = Math.round(lerp(A[1], B[1], t)), bl = Math.round(lerp(A[2], B[2], t));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }
  function rgba(hex, a) { const A = rgbOf(hex); return 'rgba(' + A[0] + ',' + A[1] + ',' + A[2] + ',' + a + ')'; }

  // ============================================================ canvases & light
  function hasDOM() { return typeof document !== 'undefined' && !!document && typeof document.createElement === 'function'; }
  function makeCanvas(w, h) {
    if (!hasDOM()) return null;
    try {
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil(w));
      cv.height = Math.max(1, Math.ceil(h));
      return cv.getContext('2d') ? cv : null;
    } catch (e) { return null; }
  }
  // One cached radial sprite per color: drawn scaled, so a light costs one drawImage (no per-frame gradients).
  const _soft = Object.create(null);
  function softStops(g, rgb) {
    g.addColorStop(0, 'rgba(' + rgb + ',1)');
    g.addColorStop(0.2, 'rgba(' + rgb + ',0.62)');
    g.addColorStop(0.5, 'rgba(' + rgb + ',0.2)');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
  }
  function softSprite(rgb) {
    if (rgb in _soft) return _soft[rgb];
    const cv = makeCanvas(128, 128);
    if (cv) {
      const g = cv.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      softStops(gr, rgb);
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }
    _soft[rgb] = cv;
    return cv;
  }
  // soft additive light (rgb = 'r,g,b'); sy squashes vertically (floor pools)
  function glow(c, x, y, r, rgb, a, sy, comp) {
    if (!(r > 0.5) || !(a > 0.003)) return;
    sy = sy || 1;
    const spr = softSprite(rgb);
    c.save();
    c.globalCompositeOperation = comp || 'lighter';
    c.globalAlpha *= Math.min(1, a);
    if (spr) c.drawImage(spr, x - r, y - r * sy, r * 2, r * 2 * sy);
    else {
      c.translate(x, y);
      c.scale(1, sy);
      const gr = c.createRadialGradient(0, 0, 0, 0, 0, r);
      softStops(gr, rgb);
      c.fillStyle = gr;
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    }
    c.restore();
  }
  const puff = (c, x, y, r, rgb, a, sy) => glow(c, x, y, r, rgb, a, sy, 'source-over');

  // ============================================================ path helpers
  function stroke(c, lw, col) {
    c.lineWidth = lw; c.strokeStyle = col || INK; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke();
  }
  /* House style for scenery: flat base + one crescent shade (offset copy) + optional rim light + ink outline. */
  function cut(c, path, base, shade, o) {
    o = o || {};
    const lw = o.lw == null ? 2.5 : o.lw, dx = o.dx == null ? -4 : o.dx, dy = o.dy == null ? -4 : o.dy;
    c.save();
    path(c);
    c.fillStyle = shade || base;
    c.fill();
    if (shade && shade !== base) {
      c.clip();
      c.translate(dx, dy);
      path(c);
      c.fillStyle = base;
      c.fill();
    }
    c.restore();
    if (o.rim) { // lit inner edge on the upper-left
      c.save();
      path(c); c.clip();
      c.translate(o.rimD || 2, o.rimD || 2);
      path(c);
      stroke(c, o.rimW || 2, o.rim);
      c.restore();
    }
    if (lw > 0) { path(c); stroke(c, lw, o.ink); }
  }
  const rectP = (x, y, w, h) => (g) => { g.beginPath(); g.rect(x, y, w, h); };
  const rrectP = (x, y, w, h, r) => (g) => { Art.roundRectPath(g, x, y, w, h, r); };
  const ellP = (x, y, rx, ry) => (g) => { Art.ellipsePath(g, x, y, rx, ry); };
  const blobP = (pts, ten) => (g) => { Art.blobPath(g, pts, ten == null ? 1 : ten); };
  const polyP = (pts) => (g) => { Art.polyPath(g, pts, true); };

  // round arch subpath (no beginPath): jambs from yb up to springline ys, semicircle on top
  function roundArch(c, x1, x2, ys, yb) {
    const r = (x2 - x1) / 2;
    c.moveTo(x1, yb); c.lineTo(x1, ys);
    c.arc(x1 + r, ys, r, Math.PI, TAU);
    c.lineTo(x2, yb); c.closePath();
  }
  // gothic pointed arch subpath; k = arc radius / opening width (0.5 = round)
  function pointArch(c, x1, x2, ys, yb, k) {
    const w = x2 - x1, r = w * k, h = Math.sqrt(Math.max(0, r * r - (r - w / 2) * (r - w / 2)));
    c.moveTo(x1, yb); c.lineTo(x1, ys);
    c.arc(x1 + r, ys, r, Math.PI, Math.atan2(-h, w / 2 - r) + TAU, false);
    c.arc(x2 - r, ys, r, Math.atan2(-h, r - w / 2), 0, false);
    c.lineTo(x2, yb); c.closePath();
  }
  function pointApex(x1, x2, ys, k) { const w = x2 - x1, r = w * k; return ys - Math.sqrt(Math.max(0, r * r - (r - w / 2) * (r - w / 2))); }

  function fadeRect(c, x, y0, w, y1, colA, colB) {
    const g = c.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, colA); g.addColorStop(1, colB);
    c.fillStyle = g; c.fillRect(x, y0, w, y1 - y0);
  }

  /* Brick / ashlar courses. Bricks are aligned to absolute multiples of bw (and rows to y1), so a strip whose
   * period is a multiple of bw tiles seamlessly. o: {cols, shade, hi, mortar, seed, period, gap, holes, holeCol, crack} */
  function bricks(c, x0, y0, x1, y1, bw, bh, o) {
    const gap = o.gap == null ? 2 : o.gap, cols = o.cols, nCol = o.period ? Math.round(o.period / bw) : 0;
    const sh = o.shadeW == null ? 2.5 : o.shadeW;
    c.save();
    c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip();
    if (o.mortar) { c.fillStyle = o.mortar; c.fillRect(x0, y0, x1 - x0, y1 - y0); }
    let row = 0;
    for (let y = y1 - bh; y > y0 - bh; y -= bh, row++) {
      const off = (row & 1) ? bw / 2 : 0;
      for (let ci = Math.floor((x0 - off) / bw) - 1; ci * bw + off < x1; ci++) {
        const bx = ci * bw + off;
        if (bx + bw < x0) continue;
        const cidx = nCol ? mod(ci, nCol) : ci;
        const h = hash((o.seed || 0) + row * 37.31 + cidx * 3.917);
        const X = bx + gap / 2, Y = y + gap / 2, w = bw - gap, hh = bh - gap;
        if (o.holes && h < o.holes) { c.fillStyle = o.holeCol || '#000'; c.fillRect(X + 1, Y + 1, w - 2, hh - 2); continue; }
        c.fillStyle = cols[Math.floor(hash(h * 91.3 + 0.7) * cols.length) % cols.length];
        c.fillRect(X, Y, w, hh);
        if (o.shade) { c.fillStyle = o.shade; c.fillRect(X, Y + hh - sh, w, sh); c.fillRect(X + w - sh, Y, sh, hh); }
        if (o.hi) { c.fillStyle = o.hi; c.fillRect(X + 1, Y, w - 4, 1.5); }
        if (o.crack && h > 1 - o.crack) {
          c.beginPath(); c.moveTo(X + w * 0.28, Y); c.lineTo(X + w * 0.42, Y + hh * 0.5); c.lineTo(X + w * 0.34, Y + hh);
          stroke(c, 1.2, o.crackCol || 'rgba(20,10,20,0.8)');
        }
      }
    }
    c.restore();
  }

  // voussoir ring around a round arch opening
  function archRing(c, cx, ys, r, band, n, base, shade, lw, seed, rim) {
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI + (i / n) * Math.PI, a1 = Math.PI + ((i + 1) / n) * Math.PI;
      const key = n % 2 === 1 && i === (n - 1) / 2;
      const ro = r + band + (key ? band * 0.5 : 0);
      const p = (g) => { g.beginPath(); g.arc(cx, ys, ro, a0, a1); g.arc(cx, ys, r, a1, a0, true); g.closePath(); };
      const col = seed != null ? mix(base, shade, hash(seed + i * 1.3) * 0.4) : base;
      cut(c, p, col, shade, { lw: lw, dx: -2, dy: -2, rim: rim, rimW: 1.5, rimD: 1.5 });
    }
  }

  // chain of links along a polyline [[x,y]...]; link = link length
  function chainAlong(c, pts, link, colA, colB, lw) {
    lw = lw || 2.5;
    let carry = 0, idx = 0;
    const step = link * 0.82;
    for (let s = 0; s < pts.length - 1; s++) {
      const [x1, y1] = pts[s], [x2, y2] = pts[s + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 0.01) continue;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      let d = carry;
      for (; d < len; d += step, idx++) {
        const px = x1 + (x2 - x1) * (d / len), py = y1 + (y2 - y1) * (d / len);
        c.save(); c.translate(px, py); c.rotate(ang);
        if (idx % 2 === 0) {
          Art.ellipsePath(c, 0, 0, link * 0.56, link * 0.3);
          stroke(c, lw + 2.5, INK); stroke(c, lw, colB);
        } else {
          c.beginPath(); c.moveTo(-link * 0.5, 0); c.lineTo(link * 0.5, 0);
          stroke(c, lw + 3, INK); stroke(c, lw + 0.5, colA);
        }
        c.restore();
      }
      carry = d - len;
    }
  }
  // points of a gently swaying hanging rope/chain from (x,y) of length len
  function hangPts(x, y, len, sway, n) {
    const pts = [];
    n = n || 8;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      pts.push([x + Math.sin(sway) * len * s + Math.sin(sway * 1.7) * len * 0.08 * s * s, y + Math.cos(sway) * len * s]);
    }
    return pts;
  }

  // ============================================================ prop painters
  const WAX_WARM = { wax: '#f3e4c2', shade: '#c9b088', hi: '#fff9e8' };
  const WAX_COLD = { wax: '#d9dccb', shade: '#a2a693', hi: '#f2f6ea' };
  const WAX_ASH = { wax: '#b9aeb8', shade: '#857886', hi: '#ddd4dc' };
  const WAX_TITLE = { wax: '#e6cda2', shade: '#a4855e', hi: '#f7e4c0' };

  function candleBody(c, x, baseY, h, w, seed, pal) {
    const r = rnd(seed), top = baseY - h, hw = w / 2, dip = 1.2 + r() * 2.2;
    const body = (g) => {
      g.beginPath();
      g.moveTo(x - hw, baseY);
      g.lineTo(x - hw, top + 2.5);
      g.quadraticCurveTo(x - hw, top - 0.5, x - hw + 2.5, top);
      g.quadraticCurveTo(x, top + dip, x + hw - 2.5, top);
      g.quadraticCurveTo(x + hw, top - 0.5, x + hw, top + 2.5);
      g.lineTo(x + hw, baseY);
      g.closePath();
    };
    cut(c, body, pal.wax, pal.shade, { lw: 2, dx: -Math.max(2, w * 0.3), dy: 0 });
    const nd = h > 13 ? 1 + Math.floor(r() * 2.4) : 0;
    for (let i = 0; i < nd; i++) {
      const dx = x + (r() - 0.5) * Math.max(1, w - 5);
      const len = h * (0.2 + r() * 0.42), dw = 1.3 + r() * 1.1;
      c.beginPath();
      c.moveTo(dx - dw, top + 1); c.lineTo(dx - dw, top + len); c.arc(dx, top + len, dw, Math.PI, 0, true); c.lineTo(dx + dw, top + 1);
      c.closePath(); c.fillStyle = pal.hi; c.fill();
      c.beginPath();
      c.moveTo(dx - dw, top + 3); c.lineTo(dx - dw, top + len); c.arc(dx, top + len, dw, Math.PI, 0, true); c.lineTo(dx + dw, top + 3);
      stroke(c, 1.1);
    }
    c.beginPath(); c.moveTo(x, top + dip * 0.5); c.quadraticCurveTo(x + 0.4, top - 2, x + 1, top - 3.5); stroke(c, 1.6);
  }
  // A candle cluster's geometry is decided at layout time so flames (live) and bodies (cached) agree.
  function makeCluster(seed, n, k, spread) {
    const r = rnd(seed), items = [];
    spread = spread || 9;
    for (let i = 0; i < n; i++) {
      const back = n > 2 && i % 2 === 0;
      items.push({
        ox: (i - (n - 1) / 2) * spread * k + (r() - 0.5) * 3 * k,
        oy: back ? -3 * k : 0,
        h: (back ? 22 + r() * 22 : 11 + r() * 17) * k,
        w: (7.5 + r() * 4) * k,
        seed: seed * 7 + i,
        back,
      });
    }
    items.sort((a, b) => (a.back === b.back ? 0 : a.back ? -1 : 1));
    const flames = items.map((it) => ({ ox: it.ox + 1, oy: it.oy - it.h - 2.5, s: 4.6 + it.w * 0.36, seed: it.seed, top: it.oy - it.h, len: it.h }));
    return { items, flames, k, half: ((n - 1) / 2) * spread * k + 7 * k };
  }
  function drawCluster(c, cl, x, baseY, pal) {
    for (const it of cl.items) candleBody(c, x + it.ox, baseY + it.oy, it.h, it.w, it.seed, pal);
    const hw = cl.half, k = cl.k;
    c.beginPath();
    c.moveTo(x - hw - 5, baseY + 1);
    c.quadraticCurveTo(x - hw - 1, baseY - 6 * k, x - hw * 0.4, baseY - 4 * k);
    c.quadraticCurveTo(x, baseY - 7.5 * k, x + hw * 0.5, baseY - 4 * k);
    c.quadraticCurveTo(x + hw + 2, baseY - 5 * k, x + hw + 6, baseY + 1);
    c.closePath();
    c.fillStyle = pal.wax; c.fill(); stroke(c, 2);
    c.beginPath(); c.moveTo(x - hw * 0.3, baseY - 4.5 * k); c.quadraticCurveTo(x, baseY - 6 * k, x + hw * 0.3, baseY - 4.5 * k); stroke(c, 1.5, pal.hi);
  }

  function barrelEnd(c, x, y, r, seed, P) {
    const rr = rnd(seed);
    Art.circlePath(c, x, y, r); c.fillStyle = P.iron; c.fill(); stroke(c, 2.5);
    const hr = r * 0.8;
    cut(c, (g) => Art.circlePath(g, x, y, hr), P.wood, P.woodShade, { lw: 2, dx: -hr * 0.2, dy: -hr * 0.2 });
    c.save(); Art.circlePath(c, x, y, hr); c.clip();
    c.beginPath();
    for (let k = -2; k <= 1; k++) { const px = x + (k + 0.5) * hr * 0.42; c.moveTo(px, y - hr); c.lineTo(px, y + hr); }
    stroke(c, 1.2, 'rgba(26,18,34,0.55)');
    c.restore();
    c.beginPath(); c.arc(x, y, r - 1.6, Math.PI * 1.05, Math.PI * 1.45); stroke(c, 1.6, P.ironHi);
    Art.circlePath(c, x, y, hr); stroke(c, 1.6);
    const v = rr();
    c.save();
    if (v < 0.3) { c.beginPath(); c.moveTo(x - 6, y - 6); c.lineTo(x + 5, y + 5); c.moveTo(x + 5, y - 6); c.lineTo(x - 5, y + 6); stroke(c, 1.6, 'rgba(240,232,215,0.7)'); }
    else if (v < 0.55) { c.beginPath(); for (let k = -1; k <= 1; k++) { c.moveTo(x + k * 4, y - 6); c.lineTo(x + k * 4 + 0.5, y + 5); } stroke(c, 1.6, 'rgba(240,232,215,0.7)'); }
    else if (v < 0.8) {
      cut(c, rectP(x - 3, y + hr * 0.3, 6, 9), P.woodDark, null, { lw: 1.6 });
      cut(c, rectP(x - 5, y + hr * 0.3 - 2, 10, 3), P.iron, null, { lw: 1.4 });
    }
    c.restore();
  }
  function barrelSide(c, x, by, w, h, P) {
    const hw = w / 2, bulge = w * 0.1, top = by - h;
    const path = (g) => {
      g.beginPath();
      g.moveTo(x - hw + bulge * 0.6, top);
      g.quadraticCurveTo(x - hw - bulge, top + h / 2, x - hw + bulge * 0.6, by);
      g.lineTo(x + hw - bulge * 0.6, by);
      g.quadraticCurveTo(x + hw + bulge, top + h / 2, x + hw - bulge * 0.6, top);
      g.closePath();
    };
    cut(c, path, P.wood, P.woodShade, { lw: 3, dx: -w * 0.18, dy: 0 });
    c.save(); path(c); c.clip();
    c.beginPath();
    for (const f of [-0.62, -0.22, 0.2, 0.6]) {
      c.moveTo(x + f * (hw - bulge * 0.6), top); c.quadraticCurveTo(x + f * (hw + bulge), top + h / 2, x + f * (hw - bulge * 0.6), by);
    }
    stroke(c, 1.2, 'rgba(26,18,34,0.5)');
    for (const fy of [0.17, 0.83]) {
      const y = top + h * fy, wa = hw + bulge * Math.sin(Math.PI * fy) * 0.9 - bulge * 0.4;
      c.beginPath(); c.moveTo(x - wa - 2, y); c.quadraticCurveTo(x, y + 3, x + wa + 2, y);
      stroke(c, 7, INK); stroke(c, 4, P.iron);
      c.beginPath(); c.moveTo(x - wa, y - 1); c.quadraticCurveTo(x - wa * 0.4, y + 0.5, x, y + 0.6); stroke(c, 1.2, P.ironHi);
    }
    c.restore();
    Art.ellipsePath(c, x, top + 1, hw - bulge * 0.6, 4.5); c.fillStyle = P.woodDark; c.fill(); stroke(c, 2);
  }
  function crate(c, x, by, w, h, P) {
    cut(c, rectP(x - w / 2, by - h, w, h), P.wood, P.woodShade, { lw: 2.5, dx: -4, dy: -3 });
    c.beginPath();
    for (let k = 1; k < 3; k++) { c.moveTo(x - w / 2 + 2, by - h + (k * h) / 3); c.lineTo(x + w / 2 - 2, by - h + (k * h) / 3); }
    stroke(c, 1.2, 'rgba(26,18,34,0.6)');
    c.beginPath(); c.moveTo(x - w / 2 + 6, by - 4); c.lineTo(x + w / 2 - 6, by - h + 4); stroke(c, 5.5, INK); stroke(c, 3, P.woodHi);
    for (const sx of [-1, 1]) cut(c, rectP(x + sx * (w / 2 - 4) - 3, by - h + 1, 6, h - 2), P.woodHi, P.wood, { lw: 1.6, dx: -2, dy: 0 });
    c.fillStyle = INK;
    for (const [nx, ny] of [[-w / 2 + 4, by - h + 5], [w / 2 - 4, by - h + 5], [-w / 2 + 4, by - 5], [w / 2 - 4, by - 5]]) { Art.circlePath(c, x + nx, ny, 1.1); c.fill(); }
  }
  function sack(c, x, by, w, h, col, shade) {
    const pts = [[x - w * 0.48, by - 1], [x - w * 0.54, by - h * 0.5], [x - w * 0.24, by - h * 0.82], [x - w * 0.12, by - h * 0.86],
      [x - w * 0.16, by - h * 1.02], [x + w * 0.04, by - h * 0.96], [x + w * 0.16, by - h * 1.04], [x + w * 0.14, by - h * 0.84],
      [x + w * 0.28, by - h * 0.8], [x + w * 0.52, by - h * 0.46], [x + w * 0.46, by - 1]];
    cut(c, blobP(pts, 0.9), col, shade, { lw: 2.5, dx: -w * 0.18, dy: -3 });
    c.beginPath(); c.moveTo(x - w * 0.15, by - h * 0.84); c.quadraticCurveTo(x, by - h * 0.78, x + w * 0.15, by - h * 0.84); stroke(c, 2.2);
    c.beginPath(); c.moveTo(x - w * 0.2, by - h * 0.45); c.lineTo(x - w * 0.05, by - h * 0.5); c.moveTo(x + w * 0.1, by - h * 0.3); c.lineTo(x + w * 0.24, by - h * 0.34); stroke(c, 1.2, 'rgba(26,18,34,0.5)');
  }
  function bottle(c, x, by, h, col, label) {
    const w = h * 0.38, nh = h * 0.34, nw = w * 0.4;
    const path = (g) => {
      g.beginPath();
      g.moveTo(x - w / 2, by); g.lineTo(x - w / 2, by - h + nh + 4);
      g.quadraticCurveTo(x - w / 2, by - h + nh, x - nw / 2, by - h + nh - 3);
      g.lineTo(x - nw / 2, by - h); g.lineTo(x + nw / 2, by - h); g.lineTo(x + nw / 2, by - h + nh - 3);
      g.quadraticCurveTo(x + w / 2, by - h + nh, x + w / 2, by - h + nh + 4);
      g.lineTo(x + w / 2, by); g.closePath();
    };
    cut(c, path, col, mix(col, '#000000', 0.45), { lw: 2, dx: -w * 0.3, dy: 0 });
    if (label) { c.beginPath(); c.rect(x - w / 2 + 0.5, by - h * 0.46, w - 1, h * 0.22); c.fillStyle = '#d9c9a5'; c.fill(); stroke(c, 1.2); }
    c.beginPath(); c.moveTo(x - w / 2 + 2.5, by - h + nh + 5); c.lineTo(x - w / 2 + 2.5, by - 4); stroke(c, 1.4, 'rgba(255,240,220,0.4)');
    cut(c, rectP(x - nw / 2 - 0.5, by - h - 3, nw + 1, 4), '#9a5a3a', null, { lw: 1.2 });
  }
  function jar(c, x, by, w, h, col, shade, cloth) {
    const path = (g) => {
      g.beginPath();
      g.moveTo(x - w * 0.34, by);
      g.bezierCurveTo(x - w * 0.62, by - h * 0.3, x - w * 0.6, by - h * 0.8, x - w * 0.3, by - h * 0.86);
      g.lineTo(x - w * 0.3, by - h); g.lineTo(x + w * 0.3, by - h); g.lineTo(x + w * 0.3, by - h * 0.86);
      g.bezierCurveTo(x + w * 0.6, by - h * 0.8, x + w * 0.62, by - h * 0.3, x + w * 0.34, by);
      g.closePath();
    };
    cut(c, path, col, shade, { lw: 2, dx: -w * 0.22, dy: -2 });
    if (cloth) {
      const cp = (g) => { g.beginPath(); g.moveTo(x - w * 0.42, by - h * 0.82); g.quadraticCurveTo(x, by - h * 1.22, x + w * 0.42, by - h * 0.82); g.lineTo(x + w * 0.3, by - h * 0.74); g.lineTo(x - w * 0.3, by - h * 0.74); g.closePath(); };
      cut(c, cp, cloth, mix(cloth, '#000000', 0.25), { lw: 1.8, dx: -2, dy: 0 });
      c.beginPath(); c.moveTo(x - w * 0.33, by - h * 0.8); c.lineTo(x + w * 0.33, by - h * 0.8); stroke(c, 1.5, '#7a3a2a');
    }
  }
  function cobweb(c, x, y, s, dir, col) {
    col = col || 'rgba(232,222,242,0.3)';
    const n = 5, angs = [];
    for (let i = 0; i < n; i++) angs.push((i / (n - 1)) * (Math.PI / 2));
    c.save(); c.translate(x, y); c.scale(dir, 1);
    c.beginPath();
    for (const a of angs) { c.moveTo(0, 0); c.lineTo(Math.cos(a) * s, Math.sin(a) * s); }
    for (let r = 1; r <= 4; r++) {
      const rr = (s * r) / 4.4;
      c.moveTo(Math.cos(angs[0]) * rr, Math.sin(angs[0]) * rr);
      for (let i = 0; i < n - 1; i++) {
        const a1 = angs[i + 1], am = (angs[i] + a1) / 2;
        c.quadraticCurveTo(Math.cos(am) * rr * 0.8, Math.sin(am) * rr * 0.8, Math.cos(a1) * rr, Math.sin(a1) * rr);
      }
    }
    c.lineWidth = 1; c.strokeStyle = col; c.lineCap = 'round'; c.stroke();
    c.restore();
  }
  function boneShape(c, x1, y1, x2, y2, w, col, shade) {
    const ang = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(ang) * w * 0.42, ny = Math.cos(ang) * w * 0.42;
    const knobs = [[x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny]];
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); stroke(c, w + 3, INK);
    for (const [kx, ky] of knobs) { Art.circlePath(c, kx, ky, w * 0.62 + 1.4); c.fillStyle = INK; c.fill(); }
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); stroke(c, w, col);
    for (const [kx, ky] of knobs) { Art.circlePath(c, kx, ky, w * 0.62); c.fillStyle = col; c.fill(); }
    c.beginPath(); c.moveTo(x1 - nx * 0.4, y1 - ny * 0.4 + 1); c.lineTo(x2 - nx * 0.4, y2 - ny * 0.4 + 1); stroke(c, Math.max(1, w * 0.3), shade);
  }
  // small skull, bottom of jaw at (x, y), cranium radius s
  function skull(c, x, y, s, bone, shade, socket) {
    const a0 = Math.PI * 0.78, a1 = Math.PI * 2.22, cy = y - s * 1.35;
    const path = (g) => {
      g.beginPath();
      g.arc(x, cy, s, a0, a1);
      g.quadraticCurveTo(x + s * 0.74, y - s * 0.45, x + s * 0.5, y);
      g.lineTo(x - s * 0.5, y);
      g.quadraticCurveTo(x - s * 0.74, y - s * 0.45, x + Math.cos(a0) * s, cy + Math.sin(a0) * s);
      g.closePath();
    };
    cut(c, path, bone, shade, { lw: Math.max(1.4, s * 0.2), dx: -s * 0.32, dy: -s * 0.26 });
    c.fillStyle = socket || '#120a10';
    Art.ellipsePath(c, x - s * 0.42, y - s * 1.12, s * 0.29, s * 0.33); c.fill();
    Art.ellipsePath(c, x + s * 0.42, y - s * 1.12, s * 0.29, s * 0.33); c.fill();
    c.beginPath(); c.moveTo(x, y - s * 0.8); c.lineTo(x - s * 0.13, y - s * 0.58); c.lineTo(x + s * 0.13, y - s * 0.58); c.closePath(); c.fill();
    if (s > 5) {
      c.beginPath();
      for (const k of [-0.24, 0, 0.24]) { c.moveTo(x + k * s, y - s * 0.36); c.lineTo(x + k * s, y - s * 0.04); }
      stroke(c, 1, socket || '#120a10');
    }
  }
  // faceted rock blob
  function rock(c, x, by, w, h, seed, base, shade, hi, lw) {
    const r = rnd(seed), pts = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1)) * Math.PI;
      const rr = 0.82 + r() * 0.22;
      pts.push([x + Math.cos(a) * w * 0.5 * rr, by + Math.sin(a) * h * rr]);
    }
    pts.push([x + w * 0.5, by + 1]); pts.push([x - w * 0.5, by + 1]);
    cut(c, polyP(pts), base, shade, { lw: lw == null ? 2.5 : lw, dx: -w * 0.16, dy: -h * 0.18, rim: hi, rimW: 1.5, rimD: 1.5 });
    c.beginPath(); c.moveTo(x - w * 0.1, by - h * 0.85); c.lineTo(x + w * 0.05, by - h * 0.35); c.lineTo(x + w * 0.25, by - h * 0.2);
    stroke(c, 1.2, 'rgba(10,6,14,0.5)');
  }

  /* Flagstone floor rows from G to H with perspective-ish growth; each row partitions the period P exactly. */
  function flagstones(c, P, G, H, o) {
    const seed = o.seed || 1;
    c.fillStyle = o.mortar; c.fillRect(0, G, P, H - G + 4);
    let y = G, h = o.h0 || 8, row = 0;
    const one = (x0, x1, ry, rh, hv) => {
      const g = o.gap || 1.6, X = x0 + g, Y = ry + g, w = x1 - x0 - 2 * g, hh = rh - 2 * g;
      if (w <= 1 || hh <= 1) return;
      const rad = Math.min(3.5, hh * 0.3);
      Art.roundRectPath(c, X, Y, w, hh, rad);
      c.fillStyle = o.cols[Math.floor(hv * o.cols.length) % o.cols.length]; c.fill();
      c.save(); c.clip();
      c.fillStyle = o.shade; c.fillRect(X, Y + hh - Math.max(2, hh * 0.24), w, hh); c.fillRect(X + w - 3, Y, 3, hh);
      if (hv > 0.55 && hv < 0.7) { Art.ellipsePath(c, X + w * 0.45, Y + hh * 0.45, w * 0.22, hh * 0.22); c.fillStyle = o.wear || 'rgba(255,230,200,0.05)'; c.fill(); }
      c.restore();
      if (o.hi) { c.fillStyle = o.hi; c.fillRect(X + 3, Y, w - 7, 1.5); }
      if (hv > 0.87) { c.beginPath(); c.moveTo(X + w * 0.3, Y + 1); c.lineTo(X + w * 0.38, Y + hh * 0.5); c.lineTo(X + w * 0.32, Y + hh - 1); stroke(c, 1.2, 'rgba(15,8,15,0.7)'); }
      if (o.ink) { Art.roundRectPath(c, X, Y, w, hh, rad); stroke(c, o.inkW || 1.3, o.ink); }
    };
    while (y < H + 2) {
      const avg = h * (o.aspect || 3.4) + 14;
      const n = Math.max(2, Math.round(P / avg));
      const b = [];
      for (let k = 0; k < n; k++) b.push((k + (hash(seed + row * 13.1 + k * 3.7) - 0.5) * 0.45) * (P / n));
      for (let k = 0; k < n; k++) {
        const x0 = b[k], x1 = k + 1 < n ? b[k + 1] : b[0] + P;
        const hv = hash(seed * 3 + row * 7.7 + k * 1.37);
        one(x0, x1, y, h, hv);
        if (x1 > P) one(x0 - P, x1 - P, y, h, hv);
        if (x0 < 0) one(x0 + P, x1 + P, y, h, hv);
      }
      y += h; h = Math.round(h * (o.grow || 1.3) + 1); row++;
    }
  }

  // ============================================================ gears
  function gearPath(c, r, n, d) {
    const rr = r - d, da = TAU / n;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const a = i * da;
      const ax = Math.cos(a - da * 0.27) * rr, ay = Math.sin(a - da * 0.27) * rr;
      if (i === 0) c.moveTo(ax, ay); else c.lineTo(ax, ay);
      c.lineTo(Math.cos(a - da * 0.16) * r, Math.sin(a - da * 0.16) * r);
      c.lineTo(Math.cos(a + da * 0.16) * r, Math.sin(a + da * 0.16) * r);
      c.lineTo(Math.cos(a + da * 0.27) * rr, Math.sin(a + da * 0.27) * rr);
      c.arc(0, 0, rr, a + da * 0.27, a + da * 0.73);
    }
    c.closePath();
  }
  // gear painted around (0,0), unshaded (fixed-direction shading is applied live so light stays upper-left)
  function paintGear(c, r, n, pal) {
    const d = Math.max(5, r * 0.13);
    gearPath(c, r, n, d); c.fillStyle = pal.base; c.fill(); stroke(c, r > 100 ? 3.5 : 3);
    const ri = r - d - Math.max(4, r * 0.1);
    Art.circlePath(c, 0, 0, ri + 1); stroke(c, 1.5, pal.line || 'rgba(26,18,34,0.6)');
    const spokes = pal.spokes || (r > 60 ? 6 : 4), rin = r * 0.32;
    if (r > 28) {
      for (let i = 0; i < spokes; i++) {
        const a0 = (i / spokes) * TAU, a1 = ((i + 1) / spokes) * TAU;
        const wo = Math.min(0.5, (r * 0.11) / ri), wi = Math.min(0.9, (r * 0.11) / rin);
        c.beginPath();
        c.arc(0, 0, ri - 3, a0 + wo, a1 - wo);
        c.arc(0, 0, rin, a1 - wi, a0 + wi, true);
        c.closePath();
        c.fillStyle = pal.hole; c.fill(); stroke(c, 2);
      }
    }
    Art.circlePath(c, 0, 0, r * 0.22); c.fillStyle = pal.hub || pal.base; c.fill(); stroke(c, 2.5);
    c.fillStyle = INK;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; Art.circlePath(c, Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15, Math.max(1, r * 0.022)); c.fill(); }
    Art.circlePath(c, 0, 0, r * 0.07); c.fill();
    if (pal.mark) { c.beginPath(); c.moveTo(ri * 0.55, -3); c.lineTo(ri * 0.85, -3); stroke(c, 2.5, pal.mark); }
  }
  const _gearSpr = Object.create(null);
  function gearSprite(r, n, pal, s) {
    const key = r + '|' + n + '|' + pal.base + '|' + pal.hole + '|' + s;
    if (key in _gearSpr) return _gearSpr[key];
    const R = r + 6, cv = makeCanvas(R * 2 * s, R * 2 * s);
    let out = null;
    if (cv) {
      const g = cv.getContext('2d');
      g.scale(s, s); g.translate(R, R);
      paintGear(g, r, n, pal);
      out = { cv, R };
    }
    _gearSpr[key] = out;
    return out;
  }
  function drawGear(c, x, y, r, n, ang, pal, S) {
    const spr = gearSprite(r, n, pal, S.scale || 1);
    c.save(); c.translate(x, y); c.rotate(ang);
    if (spr) c.drawImage(spr.cv, -spr.R, -spr.R, spr.R * 2, spr.R * 2); else paintGear(c, r, n, pal);
    c.restore();
    if (pal.shade) { // fixed crescent shade + rim light (does not rotate)
      const d = Math.max(5, r * 0.13);
      c.save();
      Art.circlePath(c, x, y, r - d); c.clip();
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.arc(x - r * 0.18, y - r * 0.18, r, 0, TAU);
      c.fillStyle = pal.shade; c.fill('evenodd');
      c.restore();
      if (pal.rim) { c.beginPath(); c.arc(x, y, r - d - 2, Math.PI * 1.02, Math.PI * 1.48); stroke(c, 2, pal.rim); }
    }
  }

  // ============================================================ layer infra
  function mkLayer(L, id, P, f, o) {
    const ly = Object.assign({ id, P, f, wrap: true, props: [], live: [], base: null, post: null, pre: null, after: null, y0: 0, y1: L.H }, o || {});
    if (ly.fg) L.fgLayers.push(ly); else L.layers.push(ly);
    L.byId[id] = ly;
    return ly;
  }
  function addProp(ly, x, hw, draw) { ly.props.push({ x: ly.wrap ? mod(x, ly.P) : x, hw, draw }); }
  function addLive(ly, x, hw, draw) { ly.live.push({ x: ly.wrap ? mod(x, ly.P) : x, hw, draw }); }

  function paintLayer(c, L, ly) {
    if (ly.base) ly.base(c, L, ly);
    const P = ly.P;
    for (const p of ly.props) {
      if (!ly.wrap) { p.draw(c, p.x); continue; }
      for (let k = -1; k <= 1; k++) {
        const x = p.x + k * P;
        if (x + p.hw < 0 || x - p.hw > P) continue;
        p.draw(c, x);
      }
    }
    if (ly.post) ly.post(c, L, ly);
  }
  function layerOffset(ly, S) { return ly.wrap ? -mod(S.camX * ly.f, ly.P) : 0; }
  function drawLayer(ctx, L, ly, S, C) {
    const cv = C ? C.layers[ly.id] : null;
    const P = ly.P, off = layerOffset(ly, S), h = ly.y1 - ly.y0;
    ctx.save();
    if (ly.alpha) ctx.globalAlpha *= clamp01(ly.alpha(S));
    if (ly.comp) ctx.globalCompositeOperation = ly.comp;
    for (let x = off; x < L.W; x += P) {
      if (cv) {
        const dx = Math.round(x * C.s) / C.s;
        ctx.drawImage(cv, dx, ly.y0, P, h);
      } else {
        ctx.save();
        ctx.beginPath(); ctx.rect(x, ly.y0, P, h); ctx.clip();
        ctx.translate(x, 0);
        paintLayer(ctx, L, ly);
        ctx.restore();
      }
      if (!ly.wrap) break;
    }
    ctx.restore();
  }
  function eachLive(ly, S, list, fn) {
    if (!ly.wrap) { for (const it of list) fn(it, it.x); return; }
    const P = ly.P, W = S.W, off = layerOffset(ly, S);
    for (const it of list) {
      const hw = it.hw || 60;
      for (let x = it.x + off - P; x < W + hw; x += P) if (x > -hw) fn(it, x);
    }
  }
  // screen x of a strip coordinate (first copy at or right of -margin)
  function screenXs(ly, S, xs, margin, fn) {
    const off = layerOffset(ly, S);
    for (let x = xs + off - ly.P; x < S.W + margin; x += ly.P) if (x > -margin) fn(x);
  }

  const _layouts = new Map();
  function getLayout(zone, W, H) {
    if (!ZONES[zone]) zone = 'cellar';
    W = Math.max(64, Math.round(W)); H = Math.max(64, Math.round(H));
    const key = zone + '|' + W + '|' + H;
    let L = _layouts.get(key);
    if (L) return L;
    const def = ZONES[zone];
    L = { key, zone, W, H, def, layers: [], fgLayers: [], byId: {}, atmos: [] };
    L.G = def.ground(W, H);
    def.build(L);
    _layouts.set(key, L);
    if (_layouts.size > 24) _layouts.delete(_layouts.keys().next().value);
    return L;
  }

  // offscreen caches (browser only): static paint of every layer, LRU over 2 zone/size/scale combos
  const _cache = new Map();
  function ctxScale(ctx) {
    let s = 1;
    try { if (ctx && ctx.getTransform) { const m = ctx.getTransform(); s = Math.hypot(m.a, m.b) || 1; } } catch (e) { s = 1; }
    return Math.min(1.5, Math.max(1, Math.round(s * 4) / 4));
  }
  function getCache(L, ctx) {
    if (!hasDOM()) return null;
    const s = ctxScale(ctx);
    const key = L.key + '|' + s;
    let C = _cache.get(key);
    if (C) { _cache.delete(key); _cache.set(key, C); return C; }
    C = { s, layers: {}, backdrop: null, corners: undefined, vignette: undefined };
    const mk = (w, h, y0, paint) => {
      const cv = makeCanvas(w * s, h * s);
      if (!cv) return null;
      const g = cv.getContext('2d');
      g.scale(s, s); g.translate(0, -y0);
      paint(g);
      return cv;
    };
    C.mk = mk;
    C.backdrop = mk(L.W, L.H, 0, (g) => L.def.backdrop(g, L));
    for (const ly of L.layers.concat(L.fgLayers)) if (ly.props.length || ly.base || ly.post) C.layers[ly.id] = mk(ly.wrap ? ly.P : L.W, ly.y1 - ly.y0, ly.y0, (g) => paintLayer(g, L, ly));
    _cache.set(key, C);
    while (_cache.size > 2) _cache.delete(_cache.keys().next().value);
    return C;
  }

  // ============================================================ shared live bits
  function flameLight(c, x, y, s, seed, S, o) {
    o = o || {};
    const t = S.t, k = S.lightK * (o.k || 1);
    const fl = 0.86 + 0.09 * Math.sin(t * 9.3 + seed * 3.1) + 0.06 * Math.sin(t * 17.9 + seed * 7.7);
    const rgb = o.rgb || '255,160,80';
    if (o.halo !== 0) glow(c, x, y - s * 0.7, s * (o.halo || 8) * fl, rgb, 0.17 * k);
    glow(c, x, y - s * 0.55, s * 2.6 * fl, o.core || '255,210,140', 0.42 * k);
    if (o.poolY != null) glow(c, x, o.poolY, s * (o.pool || 10) * fl, rgb, 0.3 * k, 0.2);
    Art.flame(c, x, y, s, t, { seed, glow: false, outer: o.outer, inner: o.inner });
  }
  function addFlame(ly, x, y, s, seed, o) {
    addLive(ly, x, 90, (c, sx, S) => flameLight(c, sx, y, s, seed, S, o));
  }
  // slow wax drip sliding down a candle (live)
  function addWaxDrip(ly, x, top, len, seed, pal) {
    addLive(ly, x, 6, (c, sx, S) => {
      const ph = frac(S.t * 0.09 + hash(seed) * 7);
      if (ph > 0.92) return;
      const y = top + 2 + len * 0.85 * (ph * ph);
      const r = 1.1 + Math.min(1, ph * 3) * 0.9;
      c.beginPath(); c.ellipse(sx, y, r, r * 1.25, 0, 0, TAU);
      c.fillStyle = pal.hi; c.fill(); stroke(c, 0.9, 'rgba(26,18,34,0.8)');
    });
  }
  function tinyLight(c, x, y, S, seed, rgb, core) {
    const fl = 0.75 + 0.25 * Math.sin(S.t * 7.1 + seed * 2.3) * Math.sin(S.t * 3.3 + seed);
    glow(c, x, y, 26 * fl, rgb || '255,150,70', 0.18 * S.lightK);
    glow(c, x, y, 6, core || '255,220,150', 0.65 * fl * S.lightK);
  }

  // ======================================================================
  // ZONE: CELLAR  蝋燭の地下蔵  — warm brick vaults, barrels, shelves, many dripping candles
  // ======================================================================
  const CEL = {
    far: ['#2f1f2d', '#33212f', '#2b1c29', '#36242f'], farShade: '#231622', farMortar: '#1a1019',
    wall: ['#4b3040', '#513444', '#472c3c', '#56384a', '#4d3242'], wallShade: '#37222f', wallHi: '#664555', mortar: '#22141d',
    recess: ['#38222f', '#3d2634', '#34202c'], recessShade: '#28161f', recessMortar: '#170d14',
    pillar: ['#5d3d4d', '#633f51', '#583848'], pillarShade: '#3f2734', pillarHi: '#7c5868',
    stone: '#715260', stoneShade: '#4b343f', stoneHi: '#94727c',
    wood: '#7a4a2b', woodShade: '#52301c', woodHi: '#a06b43', woodDark: '#2f1b11',
    iron: '#3d3448', ironShade: '#28212f', ironHi: '#675c7a',
    floor: ['#4a333f', '#503745', '#452f3b', '#553c49'], floorShade: '#31212c', floorHi: '#6c4d59', floorMortar: '#1d121a',
    bottles: ['#2f4d3b', '#5e2a3a', '#2d3756', '#6a4a1e', '#3e2c50'],
  };
  const WARM = '255,160,80';

  function cellarRecess(c, x, R, sp, G, seed) {
    c.save(); c.translate(x, 0);
    c.beginPath(); roundArch(c, -R, R, sp, G + 6); c.clip();
    bricks(c, -R - 40, sp - R - 30, R + 40, G + 6, 34, 16, { cols: CEL.recess, shade: CEL.recessShade, mortar: CEL.recessMortar, seed, gap: 2 });
    fadeRect(c, -R, sp - R, R * 2, sp - R + 90, 'rgba(12,6,12,0.7)', 'rgba(12,6,12,0)');
    c.fillStyle = 'rgba(12,6,12,0.35)'; c.fillRect(-R, sp - R, 18, G);
    c.fillStyle = 'rgba(12,6,12,0.18)'; c.fillRect(-R + 18, sp - R, 10, G);
    c.restore();
  }
  function cellarPillar(c, x, sp, G, seed, sconce) {
    const w = 62, x1 = -w / 2;
    c.save(); c.translate(x, 0);
    c.save(); c.beginPath(); c.rect(x1, -10, w, G + 14); c.clip();
    bricks(c, x1 - 31, -10, x1 + w + 31, G + 4, 31, 18, { cols: CEL.pillar, shade: CEL.pillarShade, hi: CEL.pillarHi, mortar: '#2a1922', seed, gap: 2.2 });
    c.fillStyle = 'rgba(25,12,22,0.45)'; c.fillRect(x1 + w - 13, -10, 13, G + 14);
    c.fillStyle = 'rgba(25,12,22,0.2)'; c.fillRect(x1 + w - 22, -10, 9, G + 14);
    c.fillStyle = 'rgba(255,200,150,0.07)'; c.fillRect(x1, -10, 8, G + 14);
    c.restore();
    c.beginPath(); c.moveTo(x1, -10); c.lineTo(x1, G + 4); c.moveTo(x1 + w, -10); c.lineTo(x1 + w, G + 4); stroke(c, 3);
    cut(c, rectP(x1 - 10, sp - 15, w + 20, 16), CEL.stone, CEL.stoneShade, { lw: 2.5, dx: -3, dy: -3, rim: CEL.stoneHi });
    cut(c, rectP(x1 - 4, sp + 1, w + 8, 7), CEL.stoneShade, null, { lw: 2 });
    cut(c, rectP(x1 - 8, G - 26, w + 16, 28), CEL.stone, CEL.stoneShade, { lw: 2.5, dx: -3, dy: -3, rim: CEL.stoneHi });
    c.beginPath(); c.moveTo(x1 - 8, G - 16); c.lineTo(x1 + w + 8, G - 16); stroke(c, 1.3, 'rgba(26,18,34,0.6)');
    if (sconce) {
      const y = sp - 36;
      // scroll bracket
      c.beginPath(); c.moveTo(0, y + 26); c.bezierCurveTo(-12, y + 22, -10, y + 8, 0, y + 6); stroke(c, 5, INK); stroke(c, 2.5, CEL.iron);
      c.beginPath(); c.arc(-3, y + 24, 4, 0, Math.PI * 1.6); stroke(c, 4.5, INK); stroke(c, 2, CEL.iron);
      cut(c, ellP(0, y + 26, 6, 5), CEL.iron, CEL.ironShade, { lw: 2, dx: -2, dy: -2 });
      // dish
      cut(c, (g) => { g.beginPath(); g.moveTo(-15, y); g.quadraticCurveTo(0, y + 12, 15, y); g.closePath(); }, CEL.iron, CEL.ironShade, { lw: 2.2, dx: -2, dy: -2 });
      candleBody(c, 0, y, 30, 11, seed + 3, WAX_WARM);
      c.beginPath(); c.ellipse(0, y, 15, 3.5, 0, 0, TAU); c.fillStyle = WAX_WARM.wax; c.fill(); stroke(c, 2);
      for (const [dx, len] of [[-10, 9], [8, 14]]) {
        c.beginPath(); c.moveTo(dx - 2, y + 1); c.lineTo(dx - 1.5, y + len); c.arc(dx, y + len, 1.6, Math.PI, 0, true); c.lineTo(dx + 2, y + 1);
        c.fillStyle = WAX_WARM.hi; c.fill(); stroke(c, 1.1);
      }
    }
    c.restore();
  }
  function cellarFarArch(c, x, v, fFl, fSp, fR) {
    const x1 = x - fR, x2 = x + fR;
    c.save();
    c.beginPath(); roundArch(c, x1, x2, fSp, fFl + 1); c.clip();
    fadeRect(c, x1, fSp - fR, fR * 2, fFl + 2, '#0a060b', '#1c111a');
    for (let j = 1; j <= 2; j++) {
      const s = j === 1 ? 0.62 : 0.36, rr = fR * s, by = fFl - 10 * j, sp = by - (fFl - fSp) * s;
      c.beginPath(); roundArch(c, x - rr, x + rr, sp, by);
      c.fillStyle = j === 1 ? '#0e080e' : '#070407'; c.fill();
      stroke(c, 2, j === 1 ? '#2c1c28' : '#1e131c');
    }
    c.beginPath(); c.moveTo(x1, fFl); c.lineTo(x - fR * 0.62, fFl - 10); c.moveTo(x2, fFl); c.lineTo(x + fR * 0.62, fFl - 10);
    c.moveTo(x1 + 30, fFl); c.lineTo(x - fR * 0.42, fFl - 10); c.moveTo(x2 - 30, fFl); c.lineTo(x + fR * 0.42, fFl - 10);
    stroke(c, 1.3, '#2a1b27');
    if (v === 0) {
      glow(c, x, fFl - 16, 70, WARM, 0.28);
      for (const o of [-26, -8, 14]) { c.fillStyle = '#4a3a3a'; c.fillRect(x + o - 2, fFl - 22 - (o === -8 ? 4 : 0), 4, 10); }
    } else if (v === 1) {
      c.beginPath();
      for (let bx = x1 + 12; bx < x2; bx += 17) { c.moveTo(bx, fSp - fR - 4); c.lineTo(bx, fFl); }
      for (const by of [fSp - 50, fSp + 20, fFl - 14]) { c.moveTo(x1, by); c.lineTo(x2, by); }
      stroke(c, 4.5, '#0b070b');
      c.beginPath();
      for (let bx = x1 + 12; bx < x2; bx += 17) { c.moveTo(bx - 1.2, fSp - fR); c.lineTo(bx - 1.2, fFl - 2); }
      stroke(c, 1.1, '#3c2a37');
    } else if (v === 2) {
      glow(c, x - 70, fSp - 40, 80, WARM, 0.22);
      for (let j = 0; j < 9; j++) {
        const sx = x + 62 - j * 15, sy = fFl - 4 - j * 10;
        cut(c, rectP(sx - 32, sy - 10, 64, 11), '#22151f', '#170e15', { lw: 1.5, dx: 0, dy: -3, ink: '#0d080c' });
        c.fillStyle = '#3a2732'; c.fillRect(sx - 31, sy - 10, 62, 1.5);
      }
    } else {
      for (let j = 0; j < 4; j++) { Art.circlePath(c, x - 54 + j * 36, fFl - 15, 15); c.fillStyle = '#2e1c22'; c.fill(); stroke(c, 2, '#140b10'); Art.circlePath(c, x - 54 + j * 36, fFl - 15, 10); stroke(c, 1.2, '#1c1116'); }
      for (let j = 0; j < 3; j++) { Art.circlePath(c, x - 36 + j * 36, fFl - 43, 15); c.fillStyle = '#2a1a20'; c.fill(); stroke(c, 2, '#140b10'); Art.circlePath(c, x - 36 + j * 36, fFl - 43, 10); stroke(c, 1.2, '#1c1116'); }
      glow(c, x + 70, fFl - 30, 50, WARM, 0.15);
    }
    c.restore();
    archRing(c, x, fSp, fR, 12, 9, '#3e2b38', '#2d1f2a', 2, 3, null);
    c.beginPath(); roundArch(c, x1, x2, fSp, fFl + 1); stroke(c, 2);
  }
  function cellarFarPier(c, x, fFl, fSp) {
    const w = 44;
    c.save(); c.translate(x, 0);
    cut(c, rectP(-w / 2, -6, w, fFl + 6), '#382533', '#2a1b26', { lw: 2, dx: -6, dy: 0 });
    c.save(); c.beginPath(); c.rect(-w / 2, -6, w, fFl); c.clip();
    c.beginPath();
    for (let y = fFl - 14, r = 0; y > -6; y -= 14, r++) { c.moveTo(-w / 2, y); c.lineTo(w / 2, y); c.moveTo(r % 2 ? -7 : 8, y); c.lineTo(r % 2 ? -7 : 8, y - 14); }
    stroke(c, 1.2, 'rgba(20,12,20,0.7)');
    c.restore();
    cut(c, rectP(-w / 2 - 6, fSp - 10, w + 12, 12), '#4a3442', '#33232e', { lw: 2, dx: -2, dy: -2 });
    cut(c, rectP(-w / 2 - 5, fFl - 15, w + 10, 16), '#412e3a', '#2f202a', { lw: 2, dx: -2, dy: -2 });
    c.restore();
  }
  function cellarShelfAlcove(c, x, G, mid) {
    // drawn in the alcove (behind the arch ring); x = segment center
    const P = CEL;
    c.save(); c.translate(x, 0);
    const shelf = (y, x1, x2) => {
      cut(c, rectP(x1, y, x2 - x1, 8), P.wood, P.woodShade, { lw: 2.5, dx: 0, dy: -3, rim: P.woodHi, rimW: 1.2, rimD: 1 });
      c.beginPath(); c.moveTo(x1 + 8, y + 4); c.lineTo(x1 + (x2 - x1) * 0.45, y + 4); stroke(c, 1, 'rgba(26,18,34,0.45)');
      for (const bx of [x1 + 16, x2 - 16]) {
        c.beginPath(); c.moveTo(bx, y + 8); c.lineTo(bx, y + 22); c.moveTo(bx, y + 21); c.lineTo(bx + (bx < x ? 12 : -12), y + 8);
        stroke(c, 4.5, INK); stroke(c, 2, P.iron);
      }
    };
    const y1 = G - 156, y2 = G - 94;
    shelf(y1, -104, 104);
    shelf(y2, -104, 104);
    // top shelf
    bottle(c, -86, y1, 30, P.bottles[0], true);
    bottle(c, -70, y1, 25, P.bottles[1], false);
    // books lying + standing
    cut(c, rectP(-56, y1 - 9, 34, 9), '#5a2e3a', '#3c1e27', { lw: 2, dx: 0, dy: -2 });
    cut(c, rectP(-53, y1 - 16, 30, 7), '#2e4a5a', '#1e3240', { lw: 2, dx: 0, dy: -2 });
    c.fillStyle = '#d9a441'; c.fillRect(-40, y1 - 8, 3, 7); c.fillRect(-36, y1 - 15, 3, 6);
    jar(c, -2, y1, 24, 26, '#8a5a40', '#603c2a', '#d8c9a8');
    c.beginPath(); c.ellipse(30, y1 - 1, 11, 3, 0, 0, TAU); c.fillStyle = P.iron; c.fill(); stroke(c, 1.8);
    candleBody(c, 30, y1 - 1, 13, 10, 911, WAX_WARM);
    bottle(c, 58, y1, 33, P.bottles[2], true);
    bottle(c, 75, y1, 27, P.bottles[3], false);
    bottle(c, 90, y1, 22, P.bottles[4], false);
    // lower shelf: cheese wheel, jars, candle
    const cx = -66, cy = y2;
    cut(c, (g) => { g.beginPath(); g.moveTo(cx - 20, cy - 12); g.lineTo(cx - 20, cy); g.quadraticCurveTo(cx, cy + 4, cx + 20, cy); g.lineTo(cx + 20, cy - 12); g.closePath(); }, '#d6a13c', '#a8782a', { lw: 2.2, dx: -5, dy: 0 });
    cut(c, (g) => { g.beginPath(); g.ellipse(cx, cy - 12, 20, 5, 0, 0, TAU); }, '#f1c763', null, { lw: 2.2 });
    c.beginPath(); c.moveTo(cx, cy - 12); c.lineTo(cx + 19, cy - 13.5); c.lineTo(cx + 12, cy - 8.5); c.closePath(); c.fillStyle = '#ffe9a8'; c.fill(); stroke(c, 1.6);
    jar(c, -28, y2, 20, 24, '#5a6a4a', '#3c4a30', '#c9b994');
    jar(c, -8, y2, 15, 17, '#8a5a40', '#603c2a', null);
    c.beginPath(); c.ellipse(20, y2 - 1, 11, 3, 0, 0, TAU); c.fillStyle = P.iron; c.fill(); stroke(c, 1.8);
    candleBody(c, 20, y2 - 1, 19, 10, 912, WAX_WARM);
    bottle(c, 50, y2, 28, P.bottles[1], true);
    bottle(c, 66, y2, 30, P.bottles[0], false);
    bottle(c, 84, y2, 24, P.bottles[2], false);
    // floor of the alcove
    crate(c, -58, G + 2, 54, 42, P);
    crate(c, -64, G - 40, 34, 26, P);
    sack(c, 34, G + 2, 48, 50, '#8b7152', '#5f4a35');
    sack(c, 74, G + 2, 34, 34, '#7d6448', '#55412e');
    cobweb(c, -104, y1 + 8, 26, 1);
    cobweb(c, 104, y2 + 8, 22, -1);
    c.restore();
  }
  function cellarShrine(c, x, G, cls) {
    c.save(); c.translate(x, 0);
    // brass emberwheel plaque on the recess wall
    const ey = G - 150;
    glow(c, 0, ey, 70, '255,190,90', 0.22);
    Art.circlePath(c, 0, ey, 22); c.fillStyle = '#7a5520'; c.fill(); stroke(c, 3);
    Art.circlePath(c, 0, ey, 16); c.fillStyle = '#2a1a14'; c.fill(); stroke(c, 2);
    c.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.26; c.moveTo(0, ey); c.lineTo(Math.cos(a) * 16, ey + Math.sin(a) * 16); } stroke(c, 4.5, INK); stroke(c, 2.5, '#c9953b');
    Art.circlePath(c, 0, ey, 5); c.fillStyle = '#ff8a3d'; c.fill(); stroke(c, 2);
    c.beginPath(); c.arc(0, ey, 20, Math.PI * 1.05, Math.PI * 1.5); stroke(c, 2, '#e8bf6a');
    // tiers
    const tiers = [[214, 28, G], [158, 26, G - 28], [104, 24, G - 54]];
    for (const [w, h, by] of tiers) {
      cut(c, rectP(-w / 2, by - h, w, h), CEL.stone, CEL.stoneShade, { lw: 2.5, dx: -4, dy: -4, rim: CEL.stoneHi });
      c.beginPath(); c.moveTo(-w / 2 + 4, by - h + 6); c.lineTo(w / 2 - 4, by - h + 6); stroke(c, 1, 'rgba(26,18,34,0.35)');
    }
    // wax curtains over the ledges
    const curtain = (x1, x2, y, seed) => {
      const r = rnd(seed);
      c.beginPath(); c.moveTo(x1, y - 1);
      let xx = x1;
      while (xx < x2) {
        const w = 5 + r() * 7, d = 4 + r() * 12;
        c.lineTo(xx + 1, y + d - 2); c.arc(xx + w * 0.5, y + d - 2, w * 0.4, Math.PI, 0, true); c.lineTo(xx + w, y + 1);
        xx += w;
      }
      c.lineTo(x2, y - 1); c.closePath();
      c.fillStyle = WAX_WARM.wax; c.fill(); stroke(c, 1.6);
    };
    curtain(-96, -40, G - 28, 21); curtain(40, 100, G - 28, 22); curtain(-70, -22, G - 54, 23); curtain(24, 70, G - 54, 24); curtain(-30, 30, G - 78, 25);
    for (const cl of cls) drawCluster(c, cl.cl, cl.x, cl.y, WAX_WARM);
    c.restore();
  }
  function cellarRack(c, x, G) {
    const P = CEL;
    c.save(); c.translate(x, 0);
    // cradle
    for (const sx of [-1, 1]) cut(c, rectP(sx * 92 - 6, G - 140, 12, 140), P.woodShade, P.woodDark, { lw: 2.5, dx: -3, dy: 0 });
    cut(c, rectP(-100, G - 9, 200, 10), P.wood, P.woodShade, { lw: 2.5, dx: 0, dy: -3 });
    const r = 27, pts = [[-58, G - 36], [0, G - 36], [58, G - 36], [-29, G - 86], [29, G - 86], [0, G - 136]];
    pts.forEach(([bx, by], i) => barrelEnd(c, bx, by, r, 70 + i, P));
    // chocks
    for (const bx of [-29, 29]) cut(c, polyP([[bx - 7, G - 9], [bx + 7, G - 9], [bx, G - 17]]), P.woodHi, P.wood, { lw: 1.8, dx: -2, dy: 0 });
    c.restore();
  }
  function cellarBarrels(c, x, G) {
    const P = CEL;
    c.save(); c.translate(x, 0);
    crate(c, -96, G + 2, 40, 34, P);
    barrelSide(c, -46, G + 2, 60, 80, P);
    barrelSide(c, 26, G + 2, 66, 88, P);
    // broom leaning on the jamb
    c.beginPath(); c.moveTo(70, G - 110); c.lineTo(96, G - 20); stroke(c, 5, INK); stroke(c, 2.6, P.woodHi);
    cut(c, polyP([[90, G - 26], [102, G - 28], [112, G + 2], [86, G + 2]]), '#b48a4a', '#7e5c2e', { lw: 2, dx: -3, dy: 0 });
    c.beginPath(); c.moveTo(92, G - 14); c.lineTo(91, G); c.moveTo(98, G - 16); c.lineTo(99, G); c.moveTo(104, G - 14); c.lineTo(106, G); stroke(c, 1, 'rgba(26,18,34,0.6)');
    // tin cup
    cut(c, rectP(-10, G - 9, 11, 10), '#8e9cb8', '#5f6a84', { lw: 1.8, dx: -2, dy: 0 });
    c.beginPath(); c.arc(3, G - 4, 3.5, -Math.PI / 2, Math.PI / 2); stroke(c, 1.6);
    c.restore();
  }
  function cellarLadder(c, x, G, sp) {
    const P = CEL;
    c.save(); c.translate(x, 0);
    const xa = 26, ya = G + 2, xb = 92, yb = sp - 38, w = 26;
    const ang = Math.atan2(yb - ya, xb - xa), nx = Math.sin(ang) * w * 0.5, ny = -Math.cos(ang) * w * 0.5;
    const len = Math.hypot(xb - xa, yb - ya);
    for (let d = 16; d < len - 6; d += 19) {
      const px = xa + (xb - xa) * (d / len), py = ya + (yb - ya) * (d / len);
      c.beginPath(); c.moveTo(px - nx, py - ny); c.lineTo(px + nx, py + ny); stroke(c, 5, INK); stroke(c, 2.6, P.woodHi);
    }
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(xa + nx * s, ya + ny * s); c.lineTo(xb + nx * s, yb + ny * s); stroke(c, 7, INK); stroke(c, 4, P.wood); }
    // bucket
    cut(c, (g) => { g.beginPath(); g.moveTo(-34, G - 26); g.lineTo(-8, G - 26); g.lineTo(-11, G + 1); g.lineTo(-31, G + 1); g.closePath(); }, P.wood, P.woodShade, { lw: 2.2, dx: -4, dy: 0 });
    c.beginPath(); c.moveTo(-33, G - 19); c.lineTo(-9, G - 19); c.moveTo(-32, G - 6); c.lineTo(-10, G - 6); stroke(c, 2.6, P.iron);
    c.beginPath(); c.arc(-21, G - 26, 12, Math.PI * 1.05, Math.PI * 1.95); stroke(c, 1.6);
    c.restore();
  }
  function drawChandelier(c, x, topY, len, S, seed, cls) {
    const sway = Math.sin(S.t * 0.8 + seed) * 0.03;
    c.save(); c.translate(x, topY); c.rotate(sway);
    chainAlong(c, [[0, 0], [0, len - 6]], 9, '#2a2230', '#5d5370', 1.8);
    // suspension arms
    c.beginPath(); c.moveTo(0, len - 8); c.lineTo(-40, len); c.moveTo(0, len - 8); c.lineTo(40, len); c.moveTo(0, len - 8); c.lineTo(0, len + 12);
    stroke(c, 4, INK); stroke(c, 2, CEL.ironHi);
    c.beginPath(); c.ellipse(0, len + 2, 46, 9, 0, Math.PI, TAU); stroke(c, 6, INK); stroke(c, 3, CEL.iron);
    for (const f of cls) if (f.back) { candleBody(c, f.x, len + f.y, f.h, 8, f.seed, WAX_WARM); }
    c.beginPath(); c.ellipse(0, len + 2, 46, 9, 0, 0, Math.PI); stroke(c, 6, INK); stroke(c, 3, CEL.iron);
    c.beginPath(); c.ellipse(0, len + 2, 46, 9, 0, 0.3, Math.PI - 0.3); stroke(c, 1.2, CEL.ironHi);
    for (const f of cls) if (!f.back) { candleBody(c, f.x, len + f.y, f.h, 9, f.seed, WAX_WARM); }
    // wax icicles under the ring + finial
    for (const dx of [-30, -12, 16, 34]) { c.beginPath(); c.moveTo(dx - 2, len + 9); c.lineTo(dx, len + 17 + (dx % 7)); c.lineTo(dx + 2, len + 9); c.fillStyle = WAX_WARM.hi; c.fill(); stroke(c, 1); }
    cut(c, polyP([[-4, len + 10], [4, len + 10], [0, len + 22]]), CEL.iron, null, { lw: 1.8 });
    for (const f of cls) flameLight(c, f.x + 1, len + f.y - f.h - 2.5, 6.5, f.seed, S, { halo: 10 });
    c.restore();
  }

  function buildCellar(L) {
    const G = L.G, H = L.H, P = CEL;
    // ---------------- FAR x0.25 : distant vaulted arcade
    const far = mkLayer(L, 'far', 1600, 0.25, { y0: 0, y1: G + 2 });
    const fS = 320, fFl = G - 26, fSp = G - 112, fR = 122;
    far.base = (c) => {
      bricks(c, 0, -20, far.P, fFl, 32, 14, { cols: P.far, shade: P.farShade, mortar: P.farMortar, seed: 11, period: far.P, gap: 1.6, shadeW: 2 });
      c.fillStyle = '#291a26'; c.fillRect(0, fFl, far.P, G - fFl + 2);
      c.beginPath();
      for (let y = fFl + 8, r = 0; y < G; y += 8 + r * 3, r++) { c.moveTo(0, y); c.lineTo(far.P, y); }
      for (let x = 0, k = 0; x < far.P; x += 50, k++) { c.moveTo(x + 9 + (k % 2) * 14, fFl); c.lineTo(x + 9 + (k % 2) * 14 - 5, G); }
      stroke(c, 1.2, 'rgba(18,10,18,0.75)');
      c.beginPath(); c.moveTo(0, fFl); c.lineTo(far.P, fFl); stroke(c, 2);
    };
    const fVar = [0, 1, 2, 0, 3];
    for (let i = 0; i < 5; i++) {
      const cx = i * fS + fS / 2, v = fVar[i];
      addProp(far, cx, fR + 26, (c, x) => cellarFarArch(c, x, v, fFl, fSp, fR));
      if (v === 0) for (const o of [-26, -8, 14]) addLive(far, cx + o, 30, (c, x, S) => tinyLight(c, x, fFl - 24 - (o === -8 ? 4 : 0), S, 3 + i + o));
      if (v === 2) addLive(far, cx - 70, 40, (c, x, S) => tinyLight(c, x, fSp - 50, S, 9 + i));
    }
    for (let i = 0; i < 5; i++) addProp(far, i * fS, 36, (c, x) => cellarFarPier(c, x, fFl, fSp));

    // ---------------- MID x0.6 : arcade of brick pillars with alcoves, racks and candles
    const mid = mkLayer(L, 'mid', 2240, 0.6, { y0: 0, y1: G + 4 });
    const mS = 320, mR = 118, mSp = G - 178;
    const kinds = ['open', 'rack', 'shelf', 'chand', 'barrels', 'shrine', 'ladder'];
    const hole = (k) => k !== 'shelf' && k !== 'shrine';
    mid.base = (c) => {
      c.save();
      c.beginPath(); c.rect(0, -10, mid.P, G + 14);
      kinds.forEach((k, i) => { if (hole(k)) { const cx = i * mS + mS / 2; roundArch(c, cx - mR, cx + mR, mSp, G + 6); } });
      c.clip('evenodd');
      bricks(c, 0, -10, mid.P, G + 4, 40, 18, { cols: P.wall, shade: P.wallShade, hi: P.wallHi, mortar: P.mortar, seed: 23, period: mid.P, gap: 2.2, holes: 0.012, holeCol: '#1a0f16', crack: 0.04 });
      c.fillStyle = 'rgba(16,7,16,0.3)'; c.fillRect(0, -10, mid.P, G + 14); // ambient darkness; candle pools are added on top
      fadeRect(c, 0, G - 70, mid.P, G + 4, 'rgba(22,10,18,0)', 'rgba(22,10,18,0.55)');
      c.restore();
    };
    const glows = [];
    kinds.forEach((k, i) => {
      const cx = i * mS + mS / 2, seed = 500 + i * 17;
      if (!hole(k)) addProp(mid, cx, mR + 10, (c, x) => cellarRecess(c, x, mR, mSp, G, seed));
      if (k === 'shelf') {
        addProp(mid, cx, mR, (c, x) => cellarShelfAlcove(c, x, G, mid));
        addFlame(mid, cx + 31, G - 157 - 13 - 3, 6, 41, { halo: 8 });
        addFlame(mid, cx + 21, G - 95 - 19 - 3, 6.5, 42, { halo: 8 });
        glows.push([cx + 20, G - 150, 120, 0.2]);
      }
      if (k === 'shrine') {
        const cls = [
          { x: -76, y: G - 28, cl: makeCluster(61, 3, 1, 12) }, { x: 76, y: G - 28, cl: makeCluster(62, 3, 1, 12) },
          { x: -48, y: G - 54, cl: makeCluster(63, 2, 1, 12) }, { x: 50, y: G - 54, cl: makeCluster(64, 2, 1, 12) },
          { x: 0, y: G - 78, cl: makeCluster(65, 3, 1.15, 12) }, { x: -92, y: G + 3, cl: makeCluster(66, 1, 1.5, 9) }, { x: 94, y: G + 3, cl: makeCluster(67, 1, 1.4, 9) },
        ];
        addProp(mid, cx, mR, (c, x) => cellarShrine(c, x, G, cls));
        for (const g of cls) for (const f of g.cl.flames) {
          addFlame(mid, cx + g.x + f.ox, g.y + f.oy, f.s, f.seed, { halo: 7 });
          if (hash(f.seed) > 0.5) addWaxDrip(mid, cx + g.x + f.ox - 2, g.y + f.top, f.len, f.seed, WAX_WARM);
        }
        glows.push([cx, G - 70, 190, 0.32]);
      }
      addProp(mid, cx, mR + 34, (c, x) => {
        archRing(c, x, mSp, mR, 17, 11, P.stone, P.stoneShade, 2.5, seed, P.stoneHi);
        c.beginPath(); roundArch(c, x - mR, x + mR, mSp, G + 8); stroke(c, 3);
      });
    });
    for (let i = 0; i < 7; i++) {
      const px = i * mS, sconce = i % 2 === 0;
      addProp(mid, px, 50, (c, x) => cellarPillar(c, x, mSp, G, 900 + i * 3, sconce));
      if (sconce) {
        addFlame(mid, px + 1, mSp - 36 - 30 - 2.5, 8, 80 + i, { halo: 10 });
        addWaxDrip(mid, px + 3, mSp - 66, 30, 80 + i, WAX_WARM);
        glows.push([px, mSp - 70, 150, 0.26]);
      }
    }
    kinds.forEach((k, i) => {
      const cx = i * mS + mS / 2;
      if (k === 'rack') {
        const cl = makeCluster(71, 3, 1, 11);
        addProp(mid, cx, 110, (c, x) => { cellarRack(c, x, G); drawCluster(c, cl, x, G - 162, WAX_WARM); });
        for (const f of cl.flames) addFlame(mid, cx + f.ox, G - 162 + f.oy, f.s, f.seed, { halo: 8 });
        glows.push([cx, G - 180, 110, 0.22]);
      } else if (k === 'barrels') {
        const cl = makeCluster(72, 4, 1, 10);
        addProp(mid, cx, 120, (c, x) => { cellarBarrels(c, x, G); drawCluster(c, cl, x + 26, G - 87, WAX_WARM); });
        for (const f of cl.flames) { addFlame(mid, cx + 26 + f.ox, G - 87 + f.oy, f.s, f.seed, { halo: 8, poolY: G + 6, pool: 12 }); }
        addWaxDrip(mid, cx + 26 + cl.flames[0].ox - 2, G - 87 + cl.flames[0].top, cl.flames[0].len, 72, WAX_WARM);
        glows.push([cx + 26, G - 110, 130, 0.26]);
      } else if (k === 'ladder') {
        addProp(mid, cx, 120, (c, x) => cellarLadder(c, x, G, mSp));
      } else if (k === 'chand') {
        const cls = [];
        for (let j = 0; j < 5; j++) { const a = (j / 5) * TAU + 0.3; cls.push({ x: Math.cos(a) * 40, y: Math.sin(a) * 8 + 1, h: 16 + hash(j + 3) * 8, seed: 300 + j, back: Math.sin(a) < 0 }); }
        addLive(mid, cx, 80, (c, x, S) => drawChandelier(c, x, mSp - mR - 4, 118, S, i, cls));
        glows.push([cx, mSp - mR + 100, 170, 0.3]);
      } else if (k === 'open') {
        addProp(mid, cx, mR + 10, (c, x) => { cobweb(c, x - mR + 2, mSp + 2, 34, 1); cobweb(c, x + mR - 2, mSp + 2, 24, -1); });
      }
    });
    // candle clusters at the bases of the odd pillars
    for (let i = 1; i < 7; i += 2) {
      const side = i % 4 === 1 ? 1 : -1, x0 = i * mS + side * 52;
      const cl = makeCluster(150 + i, 5, 1, 9);
      addProp(mid, x0, 40, (c, x) => drawCluster(c, cl, x, G + 2, WAX_WARM));
      for (const f of cl.flames) addFlame(mid, x0 + f.ox, G + 2 + f.oy, f.s, f.seed, { halo: 7, poolY: G + 8, pool: 9 });
      addWaxDrip(mid, x0 + cl.flames[1].ox - 1, G + 2 + cl.flames[1].top, cl.flames[1].len, 150 + i, WAX_WARM);
      glows.push([x0, G - 30, 130, 0.24]);
    }
    for (const [gx, gy, gr, ga] of glows) addProp(mid, gx, gr, (c, x) => { glow(c, x, gy, gr, '255,140,60', ga * 1.25); glow(c, x, gy, gr * 0.45, '255,190,110', ga * 0.8); });
    mid.post = (c) => fadeRect(c, 0, -10, mid.P, G * 0.42, 'rgba(14,7,14,0.72)', 'rgba(14,7,14,0)');

    // ---------------- FLOOR x1.0 : worn flagstones
    const flo = mkLayer(L, 'floor', 1440, 1.0, { y0: G - 8, y1: H });
    flo.base = (c) => {
      flagstones(c, flo.P, G, H, { cols: P.floor, shade: P.floorShade, hi: P.floorHi, mortar: P.floorMortar, seed: 7, h0: 9, grow: 1.32, aspect: 3.6, ink: 'rgba(26,18,34,0.85)' });
      fadeRect(c, 0, G, flo.P, H, 'rgba(255,170,100,0.05)', 'rgba(10,5,10,0.5)');
      fadeRect(c, 0, G, flo.P, G + 8, 'rgba(15,8,14,0.65)', 'rgba(15,8,14,0)');
      c.beginPath(); c.moveTo(0, G); c.lineTo(flo.P, G); stroke(c, 3);
    };
    for (let i = 0; i < 9; i++) {
      const x0 = i * 160 + 30 + hash(i * 5.1) * 100, v = hash(i * 2.3 + 0.7), y = G + 14 + hash(i * 1.9) * 30;
      if (v < 0.24) {
        const puddle = mix(WAX_WARM.wax, '#4a333f', 0.4);
        addProp(flo, x0, 30, (c, x) => {
          c.beginPath(); c.ellipse(x, y, 15, 4, 0, 0, TAU); c.fillStyle = puddle; c.fill(); stroke(c, 1.6);
          c.beginPath(); c.ellipse(x + 10, y + 3, 5, 1.8, 0, 0, TAU); c.fillStyle = puddle; c.fill(); stroke(c, 1.3);
          candleBody(c, x - 2, y, 9, 9, 400 + i, WAX_WARM);
        });
        if (v < 0.16) addFlame(flo, x0 - 1, y - 9 - 2.5, 5.5, 400 + i, { halo: 7, poolY: y + 2, pool: 8 });
      } else if (v < 0.55) {
        addProp(flo, x0, 30, (c, x) => {
          c.beginPath();
          for (let k = 0; k < 7; k++) { const a = hash(i * 9 + k) * 0.8 - 0.4, l = 6 + hash(i * 3 + k) * 8, sx = x + (k - 3) * 4; c.moveTo(sx, y + (k % 3)); c.lineTo(sx + Math.cos(a) * l, y + (k % 3) + Math.sin(a) * l * 0.3); }
          stroke(c, 1.6, '#b08a4a');
        });
      } else if (v < 0.75) {
        addProp(flo, x0, 20, (c, x) => { for (let k = 0; k < 3; k++) rock(c, x + k * 9 - 9, y + (k % 2) * 3, 8 + k * 2, 5 + k, 600 + i * 3 + k, '#5a4250', '#3c2a35', '#76596a', 1.6); });
      } else if (v < 0.85) {
        addProp(flo, x0, 20, (c, x) => { cut(c, rectP(x - 6, y - 4, 12, 6), '#b07a4a', '#7a502e', { lw: 1.6, dx: -2, dy: 0 }); });
      }
    }
    // ---------------- FOREGROUND x1.35 : hanging chains, roots, herbs + low rubble
    buildHangers(L, 1800, [
      { x: 150, kind: 'chain', len: 70 }, { x: 700, kind: 'roots', len: 56 }, { x: 1240, kind: 'herbs', len: 84 }, { x: 1560, kind: 'chain', len: 38 },
    ]);
    buildRubble(L, 1800, ['#2a1a22', '#1e1218'], '#4a3040');
    L.atmos.push((ctx, L2, S) => dust(ctx, L2, S, '255,190,120', 26));
    L.haze = ['#2a1823', 0.14];
    L.fgTint = { col: '#0c0710', rim: 'rgba(255,150,80,0.32)' };
  }

  // floating dust motes in warm light (atmos)
  function dust(ctx, L, S, rgb, n) {
    const W = S.W, t = S.t;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const h1 = hash(i * 3.1 + 1), h2 = hash(i * 7.7 + 2), h3 = hash(i * 1.3 + 5);
      const x = mod(h1 * (W + 200) - S.camX * 0.8 + Math.sin(t * 0.3 + i) * 24 + t * (4 + h3 * 6), W + 200) - 100;
      const y = 90 + h2 * (L.G - 110) + Math.sin(t * 0.45 + i * 1.7) * 18;
      const a = (0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 2.1))) * S.lightK;
      ctx.fillStyle = 'rgba(' + rgb + ',' + a.toFixed(3) + ')';
      ctx.fillRect(x, y, 1.6 + h3, 1.6 + h3);
    }
    ctx.restore();
  }

  // ======================================================================
  // ZONE: OSSUARY  水没した納骨堂 — teal stone, skull niches, flooded floor, cold fog
  // ======================================================================
  const OSS = {
    far: ['#172a35', '#1a2e3a', '#152631', '#1c3140'], farShade: '#10202a', farMortar: '#0b161d',
    wall: ['#2b4553', '#2f4b5a', '#28404d', '#33505e', '#2d4856'], wallShade: '#1d313d', wallHi: '#45707f', mortar: '#0f1c24',
    pillar: '#365868', pillarShade: '#223a48', pillarHi: '#5a8a99',
    stone: '#47697a', stoneShade: '#2c4756', stoneHi: '#6c98a6',
    panel: '#22394a', panelShade: '#182b38',
    niche: '#08121a',
    bone: '#d8d3bd', boneShade: '#a29e88', boneDim: '#75796c',
    water: '#11303b', waterDeep: '#071820', waterHi: '#9be0e0', sub: '#183a46',
    iron: '#2b343c', ironHi: '#5a6a76',
  };
  const TEAL = '110,230,210';
  const TEAL_FLAME = { outer: '#45d6c0', inner: '#e4fff8', rgb: TEAL, core: '190,255,240' };

  function ossNicheWall(c, x, G, seed, nicheFlames) {
    const O = OSS;
    c.save(); c.translate(x, 0);
    const cols = 7, pitch = 42, nw = 30, nh = 36, rows = 4, rp = 48, y0 = G - 324;
    const xL = -(cols * pitch) / 2;
    cut(c, rectP(xL - 10, y0 - 14, cols * pitch + 20, rows * rp + 16), O.panel, O.panelShade, { lw: 2.5, dx: -5, dy: -5 });
    const r = rnd(seed);
    for (let row = 0; row < rows; row++) {
      const dim = row / (rows - 1) * 0.5;
      const bone = mix(O.bone, O.niche, dim), shade = mix(O.boneShade, O.niche, dim);
      for (let col = 0; col < cols; col++) {
        const nx = xL + col * pitch + (pitch - nw) / 2, ny = y0 + row * rp;
        const cx = nx + nw / 2;
        const np = (g) => { g.beginPath(); roundArch(g, nx, nx + nw, ny + nw / 2, ny + nh); };
        np(c); c.fillStyle = O.niche; c.fill();
        c.save(); np(c); c.clip();
        c.fillStyle = 'rgba(80,140,150,0.16)'; c.fillRect(nx + nw - 5, ny, 5, nh);
        c.fillStyle = 'rgba(80,140,150,0.1)'; c.fillRect(nx, ny + nh - 4, nw, 4);
        c.restore();
        const v = r();
        if (nicheFlames && nicheFlames.has(row * cols + col)) {
          candleBody(c, cx, ny + nh - 1, 14, 9, seed + row * 7 + col, WAX_COLD);
        } else if (v < 0.5) {
          skull(c, cx, ny + nh - 1.5, 8.6, bone, shade);
        } else if (v < 0.66) {
          skull(c, cx - 6, ny + nh - 1.5, 6.4, bone, shade); skull(c, cx + 6, ny + nh - 1, 6.8, bone, shade);
        } else if (v < 0.86) {
          boneShape(c, nx + 5, ny + nh - 5, nx + nw - 5, ny + nh - 6, 3, bone, shade);
          boneShape(c, nx + 6, ny + nh - 10, nx + nw - 4, ny + nh - 9, 3, bone, shade);
          skull(c, cx, ny + nh - 12, 6.2, bone, shade);
        } else if (v < 0.94) {
          skull(c, cx + 3, ny + nh - 1.5, 7.4, bone, shade);
          boneShape(c, nx + 3, ny + nh - 3, nx + 10, ny + nh - 12, 2.5, bone, shade);
        } else {
          cobweb(c, nx + 1, ny + 8, 14, 1, 'rgba(200,230,230,0.3)');
        }
        np(c); stroke(c, 2);
        c.beginPath(); c.moveTo(nx + 2, ny + nw / 2 + 1); c.arc(cx, ny + nw / 2, nw / 2 - 2, Math.PI, Math.PI * 1.5); stroke(c, 1.2, 'rgba(120,180,190,0.25)');
      }
    }
    // carved string course below niches
    cut(c, rectP(xL - 18, y0 + rows * rp + 4, cols * pitch + 36, 12), O.stone, O.stoneShade, { lw: 2.5, dx: -3, dy: -3, rim: O.stoneHi });
    c.beginPath();
    for (let k = 0; k < 14; k++) { const bx = xL - 10 + k * 22; c.moveTo(bx, y0 + rows * rp + 9); c.lineTo(bx + 8, y0 + rows * rp + 13); }
    stroke(c, 1.2, 'rgba(10,20,26,0.6)');
    c.restore();
  }
  function ossPillar(c, x, G, sp) {
    const O = OSS, w = 58;
    c.save(); c.translate(x, 0);
    cut(c, rectP(-w / 2, -10, w, G + 14), O.pillar, O.pillarShade, { lw: 3, dx: -12, dy: 0 });
    c.beginPath(); for (const fx of [-16, -5, 6, 17]) { c.moveTo(fx, sp + 20); c.lineTo(fx, G - 30); } stroke(c, 1.6, 'rgba(10,22,30,0.6)');
    c.beginPath(); for (const fx of [-14, -3]) { c.moveTo(fx, sp + 22); c.lineTo(fx, G - 32); } stroke(c, 1, 'rgba(140,200,210,0.18)');
    // capital with skull corbel
    cut(c, rectP(-w / 2 - 10, sp - 6, w + 20, 18), O.stone, O.stoneShade, { lw: 2.5, dx: -3, dy: -3, rim: O.stoneHi });
    cut(c, (g) => { g.beginPath(); g.moveTo(-w / 2 - 4, sp + 12); g.lineTo(w / 2 + 4, sp + 12); g.lineTo(w / 2 - 6, sp + 26); g.lineTo(-w / 2 + 6, sp + 26); g.closePath(); }, O.stoneShade, null, { lw: 2.2 });
    skull(c, 0, sp + 30, 10, mix(O.bone, O.stone, 0.25), mix(O.boneShade, O.stoneShade, 0.3));
    cut(c, rectP(-w / 2 - 8, G - 30, w + 16, 32), O.stone, O.stoneShade, { lw: 2.5, dx: -3, dy: -3, rim: O.stoneHi });
    // iron ring
    c.beginPath(); c.arc(0, sp + 66, 9, 0, TAU); stroke(c, 5, INK); stroke(c, 2.5, O.ironHi);
    cut(c, ellP(0, sp + 57, 4, 3), O.iron, null, { lw: 1.6 });
    // moss
    c.beginPath(); for (let k = 0; k < 6; k++) { const mx = -22 + k * 9; c.moveTo(mx, G - 30); c.lineTo(mx + 1, G - 30 + 6 + (k % 3) * 5); } stroke(c, 2.2, 'rgba(70,150,115,0.55)');
    c.restore();
  }
  function ossArchFrame(c, x1, x2, ys, yb, k, band, O) {
    const p = (g) => { g.beginPath(); pointArch(g, x1, x2, ys, yb, k); };
    p(c); stroke(c, band + 5, INK);
    p(c); stroke(c, band, O.stone);
    c.save(); p(c); c.clip(); p(c); stroke(c, band, O.stoneShade); c.restore();
    // joints
    const w = x2 - x1, r = w * k, cl = x1 + r, cr = x2 - r, apex = pointApex(x1, x2, ys, k);
    c.beginPath();
    for (let i = 1; i < 7; i++) {
      const tt = i / 7;
      const aL = Math.PI + tt * (Math.atan2(apex - ys, (x1 + x2) / 2 - cl) + TAU - Math.PI);
      c.moveTo(cl + Math.cos(aL) * (r - band / 2), ys + Math.sin(aL) * (r - band / 2)); c.lineTo(cl + Math.cos(aL) * (r + band / 2), ys + Math.sin(aL) * (r + band / 2));
      const aR = Math.atan2(apex - ys, (x1 + x2) / 2 - cr) * (1 - tt);
      c.moveTo(cr + Math.cos(aR) * (r - band / 2), ys + Math.sin(aR) * (r - band / 2)); c.lineTo(cr + Math.cos(aR) * (r + band / 2), ys + Math.sin(aR) * (r + band / 2));
    }
    stroke(c, 1.8);
    c.beginPath(); c.moveTo(x1 - band / 2, ys + 30); c.lineTo(x1 + band / 2, ys + 30); c.moveTo(x2 - band / 2, ys + 30); c.lineTo(x2 + band / 2, ys + 30);
    c.moveTo(x1 - band / 2, ys + 90); c.lineTo(x1 + band / 2, ys + 90); c.moveTo(x2 - band / 2, ys + 90); c.lineTo(x2 + band / 2, ys + 90);
    stroke(c, 1.8);
    p(c); stroke(c, 2.5);
  }
  function ossSarco(c, x, G) {
    const O = OSS;
    c.save(); c.translate(x, 0);
    cut(c, rectP(-96, G - 52, 192, 60), O.stone, O.stoneShade, { lw: 3, dx: -8, dy: -4, rim: O.stoneHi });
    for (const px of [-82, 30]) { cut(c, rectP(px, G - 42, 52, 30), O.stoneShade, null, { lw: 2 }); c.fillStyle = 'rgba(140,200,210,0.12)'; c.fillRect(px + 2, G - 40, 48, 2); }
    skull(c, -6, G - 14, 10, mix(O.bone, O.stone, 0.3), mix(O.boneShade, O.stoneShade, 0.3));
    c.beginPath(); c.moveTo(-26, G - 26); c.lineTo(14, G - 26); stroke(c, 2, 'rgba(10,20,26,0.5)');
    // lid + effigy
    cut(c, rectP(-104, G - 64, 208, 13), O.stoneHi, O.stone, { lw: 2.5, dx: -3, dy: -3 });
    const ef = [[-90, G - 64], [-88, G - 76], [-76, G - 86], [-62, G - 80], [-50, G - 74], [-10, G - 78], [20, G - 82], [40, G - 76], [70, G - 74], [84, G - 82], [92, G - 72], [92, G - 64]];
    cut(c, blobP(ef, 0.6), O.stone, O.stoneShade, { lw: 2.5, dx: -4, dy: -3, rim: O.stoneHi });
    c.beginPath(); c.arc(-74, G - 77, 9, Math.PI * 0.9, Math.PI * 2.1); stroke(c, 1.8);
    c.beginPath(); c.moveTo(4, G - 79); c.quadraticCurveTo(14, G - 88, 22, G - 80); stroke(c, 1.8);
    // water line, moss
    c.fillStyle = 'rgba(8,24,30,0.45)'; c.fillRect(-96, G - 10, 192, 18);
    c.beginPath(); for (let k = 0; k < 12; k++) { const mx = -90 + k * 16; c.moveTo(mx, G - 10); c.lineTo(mx + 2, G - 10 - 3 - (k % 3) * 4); } stroke(c, 2, 'rgba(70,150,115,0.5)');
    c.restore();
  }
  function ossGate(c, x, G, x1, x2, sp, k) {
    const O = OSS;
    c.save(); c.translate(x, 0);
    c.beginPath(); pointArch(c, x1, x2, sp, G + 6, k); c.clip();
    const bottom = G - 118, top = pointApex(x1, x2, sp, k) - 4;
    c.beginPath();
    for (let bx = x1 + 10; bx < x2; bx += 19) { c.moveTo(bx, top); c.lineTo(bx, bottom); }
    for (let by = bottom - 10; by > top; by -= 34) { c.moveTo(x1, by); c.lineTo(x2, by); }
    stroke(c, 6, INK);
    c.beginPath();
    for (let bx = x1 + 10; bx < x2; bx += 19) { c.moveTo(bx, top); c.lineTo(bx, bottom); }
    for (let by = bottom - 10; by > top; by -= 34) { c.moveTo(x1, by); c.lineTo(x2, by); }
    stroke(c, 3, O.iron);
    c.beginPath(); for (let bx = x1 + 10; bx < x2; bx += 19) { c.moveTo(bx - 1, top); c.lineTo(bx - 1, bottom); } stroke(c, 1, O.ironHi);
    for (let bx = x1 + 10; bx < x2; bx += 19) cut(c, polyP([[bx - 3.5, bottom], [bx + 3.5, bottom], [bx, bottom + 11]]), O.ironHi, O.iron, { lw: 1.6, dx: -2, dy: 0 });
    // rust streaks
    c.beginPath(); for (let bx = x1 + 29; bx < x2; bx += 57) { c.moveTo(bx + 2, bottom - 30); c.lineTo(bx + 2, bottom - 8); } stroke(c, 2, 'rgba(150,80,50,0.4)');
    c.restore();
    // chains up from the gate corners
    chainAlong(c, [[x + x1 + 8, bottom - 10], [x + x1 + 30, top + 40]], 8, '#1e262c', O.ironHi, 1.6);
    chainAlong(c, [[x + x2 - 8, bottom - 10], [x + x2 - 30, top + 40]], 8, '#1e262c', O.ironHi, 1.6);
  }
  function cageLantern(c, x, y0, len, S, seed) {
    const O = OSS, sway = Math.sin(S.t * 0.7 + seed) * 0.05;
    c.save(); c.translate(x, y0); c.rotate(sway);
    chainAlong(c, [[0, 0], [0, len - 22]], 8, '#1e262c', O.ironHi, 1.6);
    const y = len;
    flameLight(c, 0, y + 6, 8, seed, S, { rgb: TEAL, core: TEAL_FLAME.core, outer: TEAL_FLAME.outer, inner: TEAL_FLAME.inner, halo: 12 });
    cut(c, polyP([[-13, y - 14], [13, y - 14], [7, y - 22], [-7, y - 22]]), O.iron, null, { lw: 2.2 });
    cut(c, ellP(0, y - 25, 4, 3), O.iron, null, { lw: 1.8 });
    c.beginPath(); for (const bx of [-12, -4, 4, 12]) { c.moveTo(bx, y - 14); c.quadraticCurveTo(bx * 1.15, y, bx, y + 14); } stroke(c, 3.8, INK); c.beginPath(); for (const bx of [-12, -4, 4, 12]) { c.moveTo(bx, y - 14); c.quadraticCurveTo(bx * 1.15, y, bx, y + 14); } stroke(c, 1.6, O.ironHi);
    cut(c, rectP(-14, y + 13, 28, 5), O.iron, null, { lw: 2 });
    cut(c, polyP([[-4, y + 18], [4, y + 18], [0, y + 26]]), O.iron, null, { lw: 1.6 });
    c.restore();
  }

  function buildOssuary(L) {
    const G = L.G, H = L.H, O = OSS;
    // ---------------- FAR : vast flooded crypt with pointed arcades
    const far = mkLayer(L, 'far', 1600, 0.25, { y0: 0, y1: G + 2 });
    const fS = 400, fFl = G - 30, fSp = G - 140, fHW = 104, fK = 0.78;
    far.base = (c) => {
      bricks(c, 0, -20, far.P, fFl, 50, 22, { cols: O.far, shade: O.farShade, mortar: O.farMortar, seed: 41, period: far.P, gap: 2 });
      for (let row = 0; row < 5; row++) {
        for (let k = 0; k < 80; k++) {
          const nx = k * 20 + 5, ny = fFl - 270 + row * 34;
          if (ny < -10) continue;
          c.beginPath(); roundArch(c, nx, nx + 11, ny + 5, ny + 15); c.fillStyle = '#0a151c'; c.fill();
          if (hash(k * 3.3 + row * 7.1) > 0.25) { c.fillStyle = 'rgba(190,200,185,' + (0.32 - row * 0.04).toFixed(2) + ')'; c.beginPath(); c.arc(nx + 5.5, ny + 12, 2.6, 0, TAU); c.fill(); }
        }
      }
      c.fillStyle = '#0c1d25'; c.fillRect(0, fFl, far.P, G - fFl + 2);
      c.beginPath();
      for (let k = 0; k < 40; k++) {
        const lx = hash(k * 1.7) * far.P, ly = fFl + 4 + hash(k * 2.9) * (G - fFl - 6), ll = 10 + hash(k * 5.3) * 30;
        c.moveTo(lx, ly); c.lineTo(lx + ll, ly);
        if (lx + ll > far.P) { c.moveTo(lx - far.P, ly); c.lineTo(lx + ll - far.P, ly); }
      }
      stroke(c, 1.2, 'rgba(120,200,205,0.18)');
      c.beginPath(); c.moveTo(0, fFl); c.lineTo(far.P, fFl); stroke(c, 1.5, 'rgba(140,220,220,0.3)');
    };
    for (let i = 0; i < 4; i++) {
      const cx = i * fS + fS / 2;
      addProp(far, cx, fHW + 30, (c, x) => {
        c.save();
        c.beginPath(); pointArch(c, x - fHW, x + fHW, fSp, fFl + 1, fK); c.clip();
        fadeRect(c, x - fHW, 0, fHW * 2, fFl + 2, '#03080c', '#0c1a22');
        c.beginPath(); pointArch(c, x - fHW * 0.55, x + fHW * 0.55, fFl - 10 - (fFl - fSp) * 0.5, fFl - 8, fK); c.fillStyle = '#050c11'; c.fill(); stroke(c, 2, '#1a2e3a');
        glow(c, x + (i % 2 ? 20 : -16), fFl - 18, 60, TEAL, 0.2);
        c.fillStyle = '#0a1820'; c.fillRect(x - fHW, fFl - 8, fHW * 2, 10);
        c.restore();
        ossArchFrameFar(c, x, fHW, fSp, fFl, fK);
      });
      addLive(far, cx + (i % 2 ? 20 : -16), 30, (c, x, S) => tinyLight(c, x, fFl - 20, S, 31 + i, TEAL, '200,255,240'));
    }
    for (let i = 0; i < 4; i++) {
      addProp(far, i * fS, 40, (c, x) => {
        cut(c, rectP(x - 22, -6, 44, fFl + 6), '#1d3442', '#152733', { lw: 2, dx: -8, dy: 0 });
        c.beginPath(); c.moveTo(x - 8, 0); c.lineTo(x - 8, fFl - 10); c.moveTo(x + 6, 0); c.lineTo(x + 6, fFl - 10); stroke(c, 1.2, 'rgba(8,16,22,0.7)');
        cut(c, rectP(x - 28, fSp - 8, 56, 12), '#24404f', '#19303d', { lw: 2, dx: -2, dy: -2 });
        cut(c, rectP(x - 26, fFl - 16, 52, 17), '#22394a', '#182b38', { lw: 2, dx: -2, dy: -2 });
      });
    }
    // ---------------- MID : skull-niche walls, pointed arches, sarcophagus, portcullis
    const mid = mkLayer(L, 'mid', 2400, 0.6, { y0: 0, y1: G + 4 });
    const mS = 400, kinds = ['niches', 'open', 'niches', 'sarco', 'niches', 'gate'];
    const oHW = 112, oSp = G - 160, oK = 0.72, oApex = pointApex(-oHW, oHW, oSp, oK);
    const isHole = (k) => k !== 'niches';
    mid.base = (c) => {
      c.save();
      c.beginPath(); c.rect(0, -10, mid.P, G + 14);
      kinds.forEach((k, i) => { if (isHole(k)) { const cx = i * mS + mS / 2; pointArch(c, cx - oHW, cx + oHW, oSp, G + 6, oK); } });
      c.clip('evenodd');
      bricks(c, 0, -10, mid.P, G + 4, 60, 28, { cols: O.wall, shade: O.wallShade, hi: O.wallHi, mortar: O.mortar, seed: 53, period: mid.P, gap: 3, crack: 0.06, crackCol: 'rgba(8,16,22,0.8)' });
      fadeRect(c, 0, G - 64, mid.P, G + 4, 'rgba(6,18,24,0)', 'rgba(6,18,24,0.6)');
      c.beginPath();
      for (let k = 0; k < 70; k++) { const mx = (k + hash(k * 3.7) * 0.8) * (mid.P / 70), ml = 8 + hash(k * 1.9) * 26; c.moveTo(mx, G - 58); c.lineTo(mx + 1, G - 58 + ml); }
      stroke(c, 2.2, 'rgba(70,150,115,0.4)');
      c.beginPath(); c.moveTo(0, G - 58); c.lineTo(mid.P, G - 58); stroke(c, 1.5, 'rgba(120,200,190,0.18)');
      c.restore();
    };
    const drips = [];
    const flamesM = [];
    kinds.forEach((k, i) => {
      const cx = i * mS + mS / 2, seed = 700 + i * 13;
      if (k === 'niches') {
        const nf = new Set([hash(seed) > 0.5 ? 9 : 17, 22]);
        addProp(mid, cx, 170, (c, x) => ossNicheWall(c, x, G, seed, nf));
        for (const idx of nf) {
          const row = Math.floor(idx / 7), col = idx % 7, nx = -147 + col * 42 + 6 + 15;
          const fy = G - 324 + row * 48 + 36 - 1 - 14 - 2.5;
          flamesM.push([cx + nx + 1, fy]);
          addFlame(mid, cx + nx + 1, fy, 5.5, seed + idx, { rgb: TEAL, core: TEAL_FLAME.core, outer: TEAL_FLAME.outer, inner: TEAL_FLAME.inner, halo: 9 });
        }
        drips.push(cx - 120, cx + 60);
      } else {
        addProp(mid, cx, oHW + 30, (c, x) => ossArchFrame(c, x - oHW, x + oHW, oSp, G + 6, oK, 18, O));
        drips.push(cx, cx - 40);
        if (k === 'open') {
          addLive(mid, cx, 60, (c, x, S) => cageLantern(c, x, oApex + 4, 112, S, i));
          flamesM.push([cx, oApex + 122]);
        } else if (k === 'sarco') {
          const cl = makeCluster(81, 3, 1, 10), cl2 = makeCluster(82, 2, 0.9, 10);
          addProp(mid, cx, 120, (c, x) => { ossSarco(c, x, G); drawCluster(c, cl, x + 62, G - 76, WAX_COLD); drawCluster(c, cl2, x - 92, G - 64, WAX_WARM); });
          for (const f of cl.flames) { addFlame(mid, cx + 62 + f.ox, G - 76 + f.oy, f.s, f.seed, { rgb: TEAL, core: TEAL_FLAME.core, outer: TEAL_FLAME.outer, inner: TEAL_FLAME.inner, halo: 9 }); flamesM.push([cx + 62 + f.ox, G - 76 + f.oy]); }
          for (const f of cl2.flames) { addFlame(mid, cx - 92 + f.ox, G - 64 + f.oy, f.s, f.seed, { halo: 8 }); flamesM.push([cx - 92 + f.ox, G - 64 + f.oy]); }
          addProp(mid, cx, 150, (c, x) => { glow(c, x + 62, G - 110, 120, TEAL, 0.2); glow(c, x - 92, G - 90, 90, WARM, 0.18); });
        } else if (k === 'gate') {
          addProp(mid, cx, oHW + 20, (c, x) => ossGate(c, x, G, -oHW, oHW, oSp, oK));
        }
      }
    });
    for (let i = 0; i < 6; i++) addProp(mid, i * mS, 50, (c, x) => ossPillar(c, x, G, oSp));
    mid.post = (c) => fadeRect(c, 0, -10, mid.P, G * 0.4, 'rgba(4,10,14,0.75)', 'rgba(4,10,14,0)');
    mid.flames = flamesM.map((f) => ({ x: mod(f[0], mid.P), y: f[1], hw: 40 }));

    // ---------------- FLOOR : shallow water over sunken flagstones
    const flo = mkLayer(L, 'floor', 1440, 1.0, { y0: G - 2, y1: H });
    flo.base = (c) => {
      fadeRect(c, 0, G, flo.P, H, '#1a3c48', '#08171e');
      c.save(); c.globalAlpha = 0.5;
      flagstones(c, flo.P, G + 2, H, { cols: ['#163540', '#183a45', '#14303a'], shade: '#0e252e', mortar: 'rgba(0,0,0,0)', seed: 17, h0: 9, grow: 1.32, aspect: 3.8, ink: 'rgba(5,14,18,0.7)', gap: 2 });
      c.restore();
    };
    const flo2 = mkLayer(L, 'floor2', 1440, 1.0, { y0: G - 30, y1: H });
    flo2.base = (c) => {
      c.beginPath(); c.moveTo(0, G + 0.5); c.lineTo(flo2.P, G + 0.5); stroke(c, 2.5, 'rgba(10,25,30,0.9)');
      c.beginPath(); c.moveTo(0, G + 2.5); c.lineTo(flo2.P, G + 2.5); stroke(c, 1.5, 'rgba(160,235,235,0.45)');
    };
    const floorItems = [];
    for (let i = 0; i < 6; i++) {
      const x0 = i * 240 + 40 + hash(i * 4.1) * 150, v = hash(i * 9.7 + 3), y = G + 20 + hash(i * 2.7) * 30;
      floorItems.push([x0, y]);
      if (v < 0.3) addProp(flo2, x0, 40, (c, x) => { rock(c, x, y, 40, 14, 700 + i, '#355866', '#223c48', '#5f8e9c'); rock(c, x + 20, y + 3, 22, 8, 710 + i, '#2f5260', '#1f3844', '#5f8e9c'); });
      else if (v < 0.5) addProp(flo2, x0, 30, (c, x) => { skull(c, x, y + 1, 9, O.bone, O.boneShade); c.fillStyle = 'rgba(14,44,54,0.75)'; c.fillRect(x - 14, y - 6, 28, 8); });
      else if (v < 0.7) addProp(flo2, x0, 50, (c, x) => {
        cut(c, (g) => { g.beginPath(); g.ellipse(x, y - 14, 26, 7, 0, 0, TAU); }, O.stoneHi, O.stone, { lw: 2.5, dx: -3, dy: -2 });
        cut(c, rectP(x - 26, y - 14, 52, 14), O.stone, O.stoneShade, { lw: 2.5, dx: -6, dy: 0 });
        c.beginPath(); c.ellipse(x, y - 14, 26, 7, 0, 0, TAU); stroke(c, 2.5);
        c.beginPath(); c.moveTo(x - 14, y - 12); c.lineTo(x - 10, y - 4); stroke(c, 1.4);
      });
      else if (v < 0.85) addProp(flo2, x0, 40, (c, x) => { boneShape(c, x - 18, y, x + 14, y - 3, 3.5, O.bone, O.boneShade); boneShape(c, x - 6, y + 4, x + 22, y + 6, 3, mix(O.bone, O.water, 0.4), O.boneShade); });
    }
    flo2.pre = (ctx, L2, S, C) => {
      waterReflection(ctx, L2, S, C, [L2.byId.far, L2.byId.mid], 0.36, 0.46);
      ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = O.water; ctx.fillRect(0, G, S.W, H - G); ctx.restore();
      fadeRect(ctx, 0, G, S.W, G + 14, 'rgba(120,210,215,0.16)', 'rgba(120,210,215,0)');
      // light streaks of the flames on the water
      eachLive(mid, S, mid.flames, (it, x) => {
        const yy = G + (G - it.y) * 0.36;
        if (yy > H + 10) return;
        const wob = Math.sin(S.t * 2.1 + it.x) * 2;
        glow(ctx, x + wob, Math.min(yy, H - 8), 9, it.y > G - 120 ? '255,170,100' : TEAL, 0.32 * S.lightK, 3.2);
      });
      ripples(ctx, flo2, S, G, H, 52);
    };
    flo2.after = (ctx, L2, S) => dripsLive(ctx, mid, S, drips, G, oApex);
    // ---------------- FG
    buildHangers(L, 1700, [
      { x: 120, kind: 'roots', len: 66 }, { x: 640, kind: 'chain', len: 58 }, { x: 1080, kind: 'roots', len: 44 }, { x: 1420, kind: 'cagechain', len: 92 },
    ]);
    buildRubble(L, 1700, ['#0f222a', '#0a181e'], '#2c5260');
    L.atmos.push((ctx, L2, S) => fog(ctx, L2, S, '150,205,210', 1.4));
    L.haze = ['#0f2530', 0.14];
    L.fgTint = { col: '#050c10', rim: 'rgba(120,220,210,0.28)' };
  }
  function ossArchFrameFar(c, x, hw, sp, fl, k) {
    const p = (g) => { g.beginPath(); pointArch(g, x - hw, x + hw, sp, fl + 1, k); };
    p(c); stroke(c, 14, '#0c1820'); p(c); stroke(c, 10, '#22394a'); p(c); stroke(c, 2, '#0c1820');
  }
  function waterReflection(ctx, L, S, C, layers, k, alpha) {
    if (!C) return;
    const G = L.G, H = L.H, depthPx = H - G, rows = 12, rh = depthPx / rows;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, G, S.W, depthPx); ctx.clip();
    ctx.globalAlpha *= alpha;
    for (const ly of layers) {
      const cv = ly && C.layers[ly.id];
      if (!cv) continue;
      const off = layerOffset(ly, S);
      for (let r = 0; r < rows; r++) {
        const sy1 = G - (r * rh) / k, sy0 = G - ((r + 1) * rh) / k;
        if (sy0 < ly.y0) break;
        const wob = Math.sin(S.t * 1.7 + r * 1.27) * (0.5 + r * 0.3) + Math.sin(S.t * 0.9 + r * 0.5) * 0.7;
        ctx.save();
        ctx.translate(0, G + (r + 1) * rh); ctx.scale(1, -1);
        for (let x = off; x < S.W; x += ly.P) {
          ctx.drawImage(cv, 0, (sy0 - ly.y0) * C.s, cv.width, (sy1 - sy0) * C.s, x + wob, 0, ly.P, rh + 0.6);
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }
  function ripples(ctx, ly, S, G, H, n) {
    const t = S.t;
    ctx.save();
    ctx.lineCap = 'round';
    const off = layerOffset(ly, S);
    for (let i = 0; i < n; i++) {
      const fy = hash(i * 2.31 + 0.4), y = G + 4 + fy * fy * (H - G - 6);
      const len = 5 + (y - G) * 0.32 + hash(i * 5.7) * 8;
      const xs = mod(hash(i * 1.13) * ly.P + Math.sin(t * 0.7 + i) * 5 + off, ly.P);
      const a = 0.14 + 0.16 * (0.5 + 0.5 * Math.sin(t * 1.9 + i * 2.7));
      ctx.strokeStyle = 'rgba(170,240,240,' + a.toFixed(3) + ')';
      ctx.lineWidth = 1.2 + (y - G) * 0.012;
      for (let x = xs - ly.P; x < S.W + len; x += ly.P) {
        if (x < -len) continue;
        ctx.beginPath(); ctx.moveTo(x - len / 2, y); ctx.lineTo(x + len / 2, y);
        ctx.moveTo(x - len * 0.2 + len * 0.6, y + 2.5); ctx.lineTo(x + len * 0.25 + len * 0.6, y + 2.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function dripsLive(ctx, ly, S, xs, G, y0) {
    xs.forEach((dx, i) => {
      const per = 2.2 + hash(i * 3.3) * 1.6, ph = frac(S.t / per + hash(i * 7.1));
      const fall = 0.42, startY = y0 + 10 + hash(i * 9.1) * 20;
      screenXs(ly, S, dx, 50, (x) => {
        if (ph < fall) {
          const q = ph / fall, y = startY + (G + 4 - startY) * q * q;
          ctx.beginPath(); ctx.ellipse(x, y, 1.6, 2.6 + q * 2, 0, 0, TAU);
          ctx.fillStyle = 'rgba(190,245,245,0.75)'; ctx.fill();
        } else {
          const q = (ph - fall) / (1 - fall), r = 3 + q * 26;
          ctx.beginPath(); ctx.ellipse(x, G + 6, r, r * 0.22, 0, 0, TAU);
          ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(180,240,240,' + (0.55 * (1 - q)).toFixed(3) + ')'; ctx.stroke();
          if (q < 0.5) { ctx.beginPath(); ctx.ellipse(x, G + 6, r * 0.45, r * 0.1, 0, 0, TAU); ctx.stroke(); }
        }
      });
    });
  }
  function fog(ctx, L, S, rgb, k) {
    const W = S.W, G = L.G, t = S.t;
    k = k || 1;
    for (let i = 0; i < 10; i++) {
      const sp = 6 + hash(i * 3.9) * 10;
      const x = mod(i * 233 + t * sp - S.camX * 0.7, W + 500) - 250;
      const y = G - 30 + hash(i * 1.7) * 44;
      puff(ctx, x, y, 150 + hash(i * 2.2) * 80, rgb, (0.075 + 0.03 * Math.sin(t * 0.4 + i)) * k, 0.26);
    }
    for (let i = 0; i < 4; i++) {
      const x = mod(i * 410 - t * 5 - S.camX * 0.4, W + 600) - 300;
      puff(ctx, x, 120 + hash(i * 5.1) * 60, 220, rgb, 0.04 * k, 0.3);
    }
  }

  // ======================================================================
  // ZONE: GEARWORKS  歯車の深淵 — bronze machinery, huge rotating gears, steam, furnace glow, iron grating
  // ======================================================================
  const GEA = {
    farGear: { base: '#24171a', hole: '#120b0d', hub: '#2e1e20', line: 'rgba(10,6,8,0.7)' },
    midGear: { base: '#94612e', hole: '#2a1a12', hub: '#b77e3d', shade: 'rgba(60,30,10,0.42)', rim: 'rgba(255,220,160,0.5)', mark: '#5e3b1a' },
    midGear2: { base: '#5a4a52', hole: '#1e171d', hub: '#75626c', shade: 'rgba(20,10,20,0.4)', rim: 'rgba(230,210,230,0.35)' },
    far: '#1f1517', farShade: '#170f11',
    iron: '#3c3139', ironShade: '#28212a', ironHi: '#64535f', ironDark: '#1c161d',
    bronze: '#8d5c2c', bronzeShade: '#5e3b1a', bronzeHi: '#c58f4a',
    copper: '#a35f38', copperShade: '#6b3a20', copperHi: '#dd935f',
    brick: ['#4c2a24', '#53302a', '#46261f', '#57342b'], brickShade: '#30181a', mortar: '#1a0d0c',
    panel: '#2c2228', panelShade: '#1e171c', panelHi: '#4a3a44',
  };
  const FIRE = '255,96,40';

  function rivets(c, x1, y1, x2, y2, step, r, col) {
    const len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.floor(len / step));
    for (let i = 0; i <= n; i++) {
      const x = x1 + ((x2 - x1) * i) / n, y = y1 + ((y2 - y1) * i) / n;
      Art.circlePath(c, x, y, r); c.fillStyle = col || GEA.ironHi; c.fill(); stroke(c, 1);
    }
  }
  // horizontal pipe from x1..x2 at y, radius r
  function pipeH(c, x1, x2, y, r, pal, flangeStep, phase) {
    cut(c, rectP(x1, y - r, x2 - x1, r * 2), pal[0], pal[1], { lw: 2.5, dx: 0, dy: -r * 0.55 });
    c.beginPath(); c.moveTo(x1, y - r * 0.45); c.lineTo(x2, y - r * 0.45); stroke(c, Math.max(1.5, r * 0.25), pal[2]);
    if (flangeStep) {
      for (let fx = x1 + (phase || 0); fx <= x2; fx += flangeStep) {
        cut(c, rectP(fx - 4, y - r - 3, 8, r * 2 + 6), pal[0], pal[1], { lw: 2, dx: -2, dy: 0 });
        Art.circlePath(c, fx, y - r, 1.5); c.fillStyle = INK; c.fill(); Art.circlePath(c, fx, y + r, 1.5); c.fill();
      }
    }
  }
  function pipeV(c, x, y1, y2, r, pal, flanges) {
    cut(c, rectP(x - r, y1, r * 2, y2 - y1), pal[0], pal[1], { lw: 2.5, dx: -r * 0.6, dy: 0 });
    c.beginPath(); c.moveTo(x - r * 0.45, y1); c.lineTo(x - r * 0.45, y2); stroke(c, Math.max(1.5, r * 0.25), pal[2]);
    for (const fy of flanges || []) cut(c, rectP(x - r - 3, fy - 4, r * 2 + 6, 8), pal[0], pal[1], { lw: 2, dx: -2, dy: 0 });
  }
  function elbow(c, x, y, r, pal, rot) {
    c.save(); c.translate(x, y); c.rotate(rot || 0);
    cut(c, (g) => { g.beginPath(); g.arc(0, 0, r * 2.2, -Math.PI / 2, 0); g.lineTo(r * 0.2, 0); g.arc(0, 0, r * 0.2, 0, -Math.PI / 2, true); g.closePath(); }, pal[0], pal[1], { lw: 2.5, dx: -2, dy: -2 });
    c.restore();
  }
  const COPPER = [GEA.copper, GEA.copperShade, GEA.copperHi];
  const IRONP = [GEA.iron, GEA.ironShade, GEA.ironHi];
  const BRONZEP = [GEA.bronze, GEA.bronzeShade, GEA.bronzeHi];

  function valveWheel(c, x, y, r, col) {
    Art.circlePath(c, x, y, r); stroke(c, 6, INK); stroke(c, 3, col);
    c.beginPath(); for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } stroke(c, 4, INK); stroke(c, 2, col);
    Art.circlePath(c, x, y, 3.5); c.fillStyle = GEA.bronzeHi; c.fill(); stroke(c, 1.6);
    c.beginPath(); c.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.45); stroke(c, 1.3, 'rgba(255,220,200,0.6)');
  }
  function gauge(c, x, y, r) {
    cut(c, ellP(x, y, r, r), GEA.bronze, GEA.bronzeShade, { lw: 2.5, dx: -2, dy: -2, rim: GEA.bronzeHi });
    Art.circlePath(c, x, y, r * 0.74); c.fillStyle = '#efe5cf'; c.fill(); stroke(c, 1.6);
    c.beginPath(); for (let i = 0; i <= 6; i++) { const a = Math.PI * 0.8 + (i / 6) * Math.PI * 1.4; c.moveTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6); c.lineTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7); } stroke(c, 1.2);
    c.beginPath(); c.arc(x, y, r * 0.62, Math.PI * 1.9, Math.PI * 2.2); stroke(c, 2, '#e0453f');
  }
  function gearFarProps(c, x, G, v) {
    const P = GEA;
    c.save(); c.translate(x, 0);
    if (v === 0) {
      // lattice tower
      for (const sx of [-26, 26]) cut(c, rectP(sx - 7, -10, 14, G), P.far, P.farShade, { lw: 2, dx: -3, dy: 0 });
      c.beginPath();
      for (let y = -10; y < G - 60; y += 60) { c.moveTo(-26, y); c.lineTo(26, y + 60); c.moveTo(26, y); c.lineTo(-26, y + 60); c.moveTo(-26, y); c.lineTo(26, y); }
      stroke(c, 6, INK); c.beginPath();
      for (let y = -10; y < G - 60; y += 60) { c.moveTo(-26, y); c.lineTo(26, y + 60); c.moveTo(26, y); c.lineTo(-26, y + 60); }
      stroke(c, 3, P.far);
    } else if (v === 1) {
      // smokestack with ember-lit vent
      cut(c, polyP([[-34, G], [-24, 40], [24, 40], [34, G]]), P.far, P.farShade, { lw: 2.5, dx: -6, dy: 0 });
      for (const by of [80, 150, 220]) { cut(c, rectP(-31 + (by / G) * 6, by, 62 - (by / G) * 12, 9), '#2a1c1e', P.farShade, { lw: 2, dx: 0, dy: -2 }); }
      cut(c, rectP(-30, 30, 60, 14), '#2a1c1e', P.farShade, { lw: 2, dx: 0, dy: -2 });
    } else if (v === 2) {
      // tanks & catwalk
      cut(c, rrectP(-70, G - 150, 80, 150, 30), '#221618', P.farShade, { lw: 2.5, dx: -6, dy: 0 });
      cut(c, rrectP(14, G - 110, 60, 110, 24), '#201517', P.farShade, { lw: 2.5, dx: -5, dy: 0 });
      c.beginPath(); c.moveTo(-90, G - 160); c.lineTo(90, G - 160); stroke(c, 7, INK); stroke(c, 3, '#2a1c1e');
      c.beginPath(); for (let k = -90; k <= 90; k += 18) { c.moveTo(k, G - 160); c.lineTo(k, G - 182); } c.moveTo(-90, G - 182); c.lineTo(90, G - 182); stroke(c, 2, '#2a1c1e');
    } else {
      // great beam crossing diagonally
      c.beginPath(); c.moveTo(-200, 30); c.lineTo(200, 150); stroke(c, 22, INK); stroke(c, 17, P.far);
      c.beginPath(); c.moveTo(-200, 24); c.lineTo(200, 144); stroke(c, 2, '#3a2420');
      for (let k = -180; k < 200; k += 30) { Art.circlePath(c, k, 30 + (k + 200) * 0.3, 2); c.fillStyle = '#3a2420'; c.fill(); }
    }
    c.restore();
  }
  function gearFurnace(c, x, G) {
    const P = GEA;
    c.save(); c.translate(x, 0);
    // chimney
    cut(c, rectP(-26, -10, 52, G - 200), P.iron, P.ironShade, { lw: 3, dx: -10, dy: 0, rim: P.ironHi });
    for (const by of [40, 110]) cut(c, rectP(-30, by, 60, 10), P.ironHi, P.iron, { lw: 2, dx: 0, dy: -3 });
    // body
    const body = (g) => { g.beginPath(); g.moveTo(-104, G + 2); g.lineTo(-104, G - 170); g.quadraticCurveTo(-104, G - 214, -60, G - 214); g.lineTo(60, G - 214); g.quadraticCurveTo(104, G - 214, 104, G - 170); g.lineTo(104, G + 2); g.closePath(); };
    c.save(); body(c); c.clip();
    bricks(c, -110, G - 220, 110, G + 2, 28, 14, { cols: P.brick, shade: P.brickShade, mortar: P.mortar, seed: 31, gap: 2, hi: '#6a3e30' });
    fadeRect(c, -104, G - 214, 208, G, 'rgba(10,4,6,0.5)', 'rgba(255,90,40,0.12)');
    c.fillStyle = 'rgba(10,4,6,0.35)'; c.fillRect(70, G - 220, 40, 230);
    c.restore();
    body(c); stroke(c, 3);
    cut(c, rectP(-112, G - 222, 224, 12), P.iron, P.ironShade, { lw: 2.5, dx: 0, dy: -3, rim: P.ironHi });
    // mouth
    c.beginPath(); roundArch(c, -46, 46, G - 66, G - 20); c.fillStyle = '#1a0604'; c.fill();
    c.save(); c.beginPath(); roundArch(c, -46, 46, G - 66, G - 20); c.clip();
    fadeRect(c, -46, G - 112, 92, G - 20, '#3a0e06', '#ff7a2f');
    c.restore();
    archRing(c, 0, G - 66, 46, 12, 7, '#5a3a32', '#3a2420', 2.2, 13, '#7a5040');
    c.beginPath(); roundArch(c, -46, 46, G - 66, G - 20); stroke(c, 3);
    // open door (hinged right)
    cut(c, polyP([[48, G - 108], [80, G - 100], [80, G - 28], [48, G - 22]]), P.iron, P.ironShade, { lw: 2.5, dx: -4, dy: 0, rim: P.ironHi });
    c.beginPath(); for (let k = 0; k < 4; k++) { c.moveTo(54 + k * 7, G - 96 + k); c.lineTo(54 + k * 7, G - 34 - k); } stroke(c, 2, P.ironDark);
    cut(c, rectP(-56, G - 22, 112, 10), P.iron, P.ironShade, { lw: 2.5, dx: 0, dy: -3 });
    // coal pile + shovel
    const coal = [[-90, G + 2], [-84, G - 10], [-70, G - 18], [-56, G - 14], [-46, G - 6], [-40, G + 2]];
    cut(c, blobP(coal, 0.8), '#241c22', '#141016', { lw: 2.2, dx: -4, dy: -3 });
    for (const [lx, ly] of [[-76, G - 10], [-62, G - 8], [-54, G - 2]]) { Art.circlePath(c, lx, ly, 1.6); c.fillStyle = '#ff8a3d'; c.fill(); }
    c.beginPath(); c.moveTo(-34, G - 4); c.lineTo(-12, G - 70); stroke(c, 5, INK); stroke(c, 2.5, '#6e4a2a');
    cut(c, polyP([[-40, G - 6], [-26, G], [-24, G - 14], [-34, G - 18]]), P.ironHi, P.iron, { lw: 2, dx: -2, dy: 0 });
    c.restore();
  }
  function gearPlate(c, x, G) {
    const P = GEA;
    c.save(); c.translate(x, 0);
    cut(c, rrectP(-130, G - 250, 260, 170, 14), P.panel, P.panelShade, { lw: 3, dx: -6, dy: -6, rim: P.panelHi });
    rivets(c, -120, G - 240, 120, G - 240, 20, 2.2);
    rivets(c, -120, G - 90, 120, G - 90, 20, 2.2);
    // control cabinet
    cut(c, rrectP(-84, G - 82, 168, 84, 6), P.iron, P.ironShade, { lw: 3, dx: -5, dy: -4, rim: P.ironHi });
    c.beginPath(); c.moveTo(-84, G - 58); c.lineTo(84, G - 58); stroke(c, 1.6);
    for (const lx of [-50, -20]) {
      c.beginPath(); c.moveTo(lx, G - 46); c.lineTo(lx + (lx < -30 ? -8 : 8), G - 76); stroke(c, 4.5, INK); stroke(c, 2.2, P.ironHi);
      Art.circlePath(c, lx + (lx < -30 ? -8 : 8), G - 78, 4.2); c.fillStyle = '#e0453f'; c.fill(); stroke(c, 1.8);
      cut(c, rectP(lx - 6, G - 48, 12, 6), P.ironDark, null, { lw: 1.6 });
    }
    gauge(c, 34, G - 32, 15);
    cut(c, rectP(10, G - 74, 54, 12), P.bronze, P.bronzeShade, { lw: 1.8, dx: 0, dy: -2 });
    c.beginPath(); c.moveTo(16, G - 68); c.lineTo(56, G - 68); stroke(c, 1, P.bronzeShade);
    c.restore();
  }
  function gearBoiler(c, x, G) {
    const P = GEA;
    c.save(); c.translate(x, 0);
    pipeV(c, 0, G - 300, G - 236, 9, COPPER, [G - 270]);
    const tank = (g) => { g.beginPath(); g.moveTo(-68, G); g.lineTo(-68, G - 190); g.bezierCurveTo(-68, G - 240, 68, G - 240, 68, G - 190); g.lineTo(68, G); g.closePath(); };
    cut(c, tank, P.bronze, P.bronzeShade, { lw: 3, dx: -22, dy: 0, rim: P.bronzeHi, rimW: 2.5 });
    c.save(); tank(c); c.clip();
    for (const by of [G - 190, G - 130, G - 70]) { c.beginPath(); c.moveTo(-70, by); c.lineTo(70, by); stroke(c, 5, INK); stroke(c, 2.5, P.bronzeShade); rivets(c, -60, by, 60, by, 10, 1.6, P.bronzeHi); }
    c.restore();
    // ladder on side
    c.beginPath(); c.moveTo(74, G); c.lineTo(74, G - 180); c.moveTo(90, G); c.lineTo(90, G - 180); stroke(c, 4.5, INK); stroke(c, 2, P.ironHi);
    c.beginPath(); for (let y = G - 10; y > G - 180; y -= 16) { c.moveTo(74, y); c.lineTo(90, y); } stroke(c, 3.5, INK); stroke(c, 1.6, P.ironHi);
    // gauge face (needle live), hatch, safety valve
    cut(c, ellP(0, G - 160, 21, 21), P.bronze, P.bronzeShade, { lw: 2.5, dx: -2, dy: -2, rim: P.bronzeHi });
    Art.circlePath(c, 0, G - 160, 16); c.fillStyle = '#efe5cf'; c.fill(); stroke(c, 1.6);
    c.beginPath(); for (let i = 0; i <= 8; i++) { const a = Math.PI * 0.75 + (i / 8) * Math.PI * 1.5; c.moveTo(Math.cos(a) * 12, G - 160 + Math.sin(a) * 12); c.lineTo(Math.cos(a) * 15, G - 160 + Math.sin(a) * 15); } stroke(c, 1.2);
    c.beginPath(); c.arc(0, G - 160, 13, Math.PI * 1.95, Math.PI * 2.25); stroke(c, 2.5, '#e0453f');
    cut(c, ellP(-24, G - 64, 20, 26), P.bronzeShade, P.brassShadow || '#4a3214', { lw: 2.5, dx: -3, dy: -3 });
    rivets(c, -24, G - 92, -24, G - 36, 9, 1.4, P.bronzeHi);
    pipeH(c, 30, 68, G - 210, 6, IRONP, 0);
    cut(c, rectP(-6, G - 238, 12, 14), P.ironHi, P.iron, { lw: 2, dx: -2, dy: 0 });
    cut(c, rectP(-11, G - 244, 22, 7), P.iron, null, { lw: 2 });
    c.restore();
  }
  function gearPistonHousing(c, x, G) {
    const P = GEA;
    c.save(); c.translate(x, 0);
    const cx = -40;
    // A-frame supports
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(cx + s * 110, G - 4); c.lineTo(cx + s * 40, G - 300); stroke(c, 12, INK); stroke(c, 8, P.ironShade); c.beginPath(); c.moveTo(cx + s * 110 - 2, G - 6); c.lineTo(cx + s * 40 - 2, G - 298); stroke(c, 1.5, P.ironHi); }
    cut(c, rectP(cx - 120, G - 26, 240, 28), P.iron, P.ironShade, { lw: 3, dx: 0, dy: -4, rim: P.ironHi });
    rivets(c, cx - 110, G - 14, cx + 110, G - 14, 22, 2);
    // bearing block behind the crank
    cut(c, rrectP(cx - 22, G - 132, 44, 108, 6), P.ironDark, null, { lw: 2.5 });
    // crosshead guides
    for (const gx of [cx - 15, cx + 15]) { c.beginPath(); c.moveTo(gx, G - 282); c.lineTo(gx, G - 158); stroke(c, 7, INK); stroke(c, 3.5, P.ironHi); }
    cut(c, rectP(cx - 24, G - 162, 48, 8), P.iron, null, { lw: 2 });
    // cylinder
    cut(c, rrectP(cx - 32, G - 356, 64, 70, 6), P.bronze, P.bronzeShade, { lw: 3, dx: -12, dy: 0, rim: P.bronzeHi });
    for (const by of [G - 350, G - 300]) { cut(c, rectP(cx - 36, by, 72, 9), P.bronzeShade, '#3a2410', { lw: 2, dx: 0, dy: -2 }); rivets(c, cx - 30, by + 4.5, cx + 30, by + 4.5, 12, 1.4, P.bronzeHi); }
    cut(c, rectP(cx - 10, G - 290, 20, 8), P.iron, null, { lw: 2 });
    pipeH(c, cx + 32, cx + 110, G - 330, 7, COPPER, 0);
    pipeV(c, cx + 110, -10, G - 330, 7, COPPER, [60]);
    elbow(c, cx + 110, G - 330, 7, COPPER, Math.PI / 2);
    c.restore();
  }
  function gearValves(c, x, G) {
    const P = GEA;
    c.save(); c.translate(x, 0);
    pipeV(c, -60, G - 296, G - 84, 11, COPPER, [G - 230, G - 140]);
    pipeV(c, 6, G - 252, G - 84, 8, IRONP, [G - 180]);
    elbow(c, 6, G - 252, 8, IRONP, Math.PI);
    valveWheel(c, -60, G - 186, 17, '#c0392b');
    valveWheel(c, 6, G - 130, 12, '#c0392b');
    // big lever switch
    cut(c, rectP(52, G - 170, 40, 60), P.panel, P.panelShade, { lw: 2.5, dx: -3, dy: -3, rim: P.panelHi });
    c.beginPath(); c.moveTo(72, G - 140); c.lineTo(96, G - 188); stroke(c, 6, INK); stroke(c, 3, P.ironHi);
    Art.circlePath(c, 97, G - 191, 5.5); c.fillStyle = '#e0453f'; c.fill(); stroke(c, 2);
    Art.circlePath(c, 72, G - 140, 4); c.fillStyle = P.bronzeHi; c.fill(); stroke(c, 1.6);
    // hazard plate
    cut(c, rectP(-110, G - 120, 34, 22), '#d9a441', '#a87a2a', { lw: 2, dx: -2, dy: -2 });
    c.save(); c.beginPath(); c.rect(-110, G - 120, 34, 22); c.clip();
    c.beginPath(); for (let k = -3; k < 6; k++) { c.moveTo(-110 + k * 9, G - 98); c.lineTo(-110 + k * 9 + 22, G - 120); } stroke(c, 4, INK); c.restore();
    c.restore();
  }
  function steam(c, x, y, S, seed, dir, size) {
    const t = S.t;
    for (let j = 0; j < 5; j++) {
      const ph = frac(t * 0.32 + j / 5 + seed * 0.37);
      const px = x + dir * ph * 26 * size + Math.sin(ph * 5 + seed * 3 + j) * 6;
      const py = y - ph * 76 * size;
      const r = (7 + ph * 30) * size;
      const a = (1 - ph) * Math.min(1, ph * 8) * 0.24;
      puff(c, px, py, r, '214,198,214', a);
    }
  }

  function buildGearworks(L) {
    const G = L.G, H = L.H, P = GEA;
    // ---------------- FAR : giant slow gears behind towers & stacks (gears live)
    const far = mkLayer(L, 'far', 1920, 0.25, { y0: 0, y1: G + 2 });
    const farGears = [
      { x: 260, y: G - 218, r: 170, n: 24, w: 0.07 }, { x: 470, y: G - 72, r: 100, n: 14, w: -0.07 * 170 / 100 },
      { x: 1180, y: G - 258, r: 210, n: 30, w: -0.05 }, { x: 932, y: G - 115, r: 90, n: 13, w: 0.05 * 210 / 90 },
      { x: 1640, y: G - 168, r: 150, n: 22, w: 0.06 }, { x: 1834, y: G - 98, r: 70, n: 10, w: -0.06 * 150 / 70 },
    ];
    far.base = (c) => {
      fadeRect(c, 0, G - 120, far.P, G + 2, 'rgba(120,40,20,0)', 'rgba(120,40,20,0.35)');
      // distant machinery skyline at the bottom
      const cw = far.P / 48;
      c.beginPath(); c.moveTo(-cw, G + 2);
      for (let k = -1; k <= 48; k++) { const x = k * cw, h = 30 + Math.round(hash(mod(k, 48) * 3.1 + 1) * 3) * 16; c.lineTo(x, G - h); c.lineTo(x + cw, G - h); }
      c.lineTo(far.P + cw, G + 2); c.closePath();
      c.fillStyle = '#1a1113'; c.fill(); stroke(c, 2);
      for (let k = 0; k < 48; k++) if (hash(k * 7.7) > 0.7) { c.fillStyle = 'rgba(255,120,50,0.5)'; c.fillRect((k / 48) * far.P + 10, G - 22, 6, 4); }
    };
    far.pre = (ctx, L2, S) => {
      for (const g of farGears) screenXs(far, S, g.x, g.r + 10, (x) => {
        drawGear(ctx, x, g.y, g.r, g.n, S.t * g.w + g.x, P.farGear, S);
        glow(ctx, x, g.y + g.r * 0.7, g.r * 0.9, FIRE, 0.06 * S.lightK, 0.5);
      });
    };
    [[80, 0], [700, 1], [1060, 0], [1500, 2], [1760, 1], [380, 3]].forEach(([x0, v], i) => addProp(far, x0, v === 3 ? 230 : 110, (c, x) => gearFarProps(c, x, G, v)));
    [[700, 34], [1760, 34]].forEach(([x0, y0], i) => addLive(far, x0, 60, (c, x, S) => { glow(c, x, y0, 46, FIRE, (0.25 + 0.1 * Math.sin(S.t * 2 + i)) * S.lightK); }));

    // ---------------- MID : pipes, wall gears, furnace, boiler, piston, valves
    const mid = mkLayer(L, 'mid', 2400, 0.6, { y0: 0, y1: G + 4 });
    const pY1 = G - 298, pY2 = G - 252;
    mid.base = (c) => {
      // hangers for the pipe runs
      c.beginPath(); for (let x = 80; x < mid.P; x += 160) { c.moveTo(x, -10); c.lineTo(x, pY2); } stroke(c, 4.5, INK); c.beginPath(); for (let x = 80; x < mid.P; x += 160) { c.moveTo(x, -10); c.lineTo(x, pY2); } stroke(c, 2, P.ironHi);
      // continuous pipe runs along the back wall (period-aligned flanges, drawn once so they tile)
      pipeH(c, -10, mid.P + 10, pY1, 13, COPPER, 160, 0);
      pipeH(c, -10, mid.P + 10, pY2, 8, IRONP, 240, 40);
      // riveted wainscot along the whole floor line
      cut(c, rectP(-10, G - 92, mid.P + 20, 96), P.panel, P.panelShade, { lw: 3, dx: 0, dy: -8 });
      c.beginPath(); for (let x = 0; x < mid.P; x += 120) { c.moveTo(x, G - 92); c.lineTo(x, G + 4); } stroke(c, 2);
      for (let x = 0; x < mid.P; x += 120) { rivets(c, x + 8, G - 84, x + 8, G - 6, 13, 1.7); rivets(c, x + 112, G - 84, x + 112, G - 6, 13, 1.7); }
      cut(c, rectP(-10, G - 98, mid.P + 20, 10), P.bronze, P.bronzeShade, { lw: 2.5, dx: 0, dy: -3, rim: P.bronzeHi });
      fadeRect(c, 0, G - 88, mid.P, G + 4, 'rgba(10,5,8,0.0)', 'rgba(10,5,8,0.5)');
    };
    const kinds = ['valves', 'gears', 'boiler', 'furnace', 'piston'];
    const mGears = [], steams = [], lamps = [];
    kinds.forEach((k, i) => {
      const cx = i * 480 + 240;
      if (k === 'furnace') {
        addProp(mid, cx, 130, (c, x) => { gearFurnace(c, x, G); glow(c, x, G - 50, 170, FIRE, 0.16); });
        addLive(mid, cx, 120, (c, x, S) => furnaceFire(c, x, G, S));
        steams.push([cx, -6, 0, 1.3, 1]);
      } else if (k === 'gears') {
        addProp(mid, cx, 140, (c, x) => gearPlate(c, x, G));
        mGears.push({ x: cx - 46, y: G - 168, r: 70, n: 16, w: 0.35, pal: P.midGear });
        mGears.push({ x: cx + 59, y: G - 146, r: 44, n: 10, w: -0.35 * 70 / 44, pal: P.midGear2 });
        mGears.push({ x: cx + 92, y: G - 203, r: 26, n: 7, w: 0.35 * 70 / 26, pal: P.midGear });
        addLive(mid, cx + 34, 30, (c, x, S) => needle(c, x, G - 32, 15, S, 2));
      } else if (k === 'boiler') {
        addProp(mid, cx, 110, (c, x) => gearBoiler(c, x, G));
        steams.push([cx, G - 246, -0.3, 0.9, 2]);
        addLive(mid, cx, 30, (c, x, S) => needle(c, x, G - 160, 16, S, 5));
        lamps.push([cx - 50, G - 120]);
      } else if (k === 'piston') {
        addProp(mid, cx, 170, (c, x) => gearPistonHousing(c, x, G));
        addLive(mid, cx, 190, (c, x, S) => pistonLive(c, x, G, S));
        steams.push([cx - 40 + 26, G - 352, 0.4, 0.7, 3]);
      } else {
        addProp(mid, cx, 130, (c, x) => gearValves(c, x, G));
        steams.push([cx - 60, G - 238, 1, 0.6, 4]);
        lamps.push([cx + 70, G - 210]);
      }
    });
    mid.post = (c) => fadeRect(c, 0, -10, mid.P, G * 0.45, 'rgba(8,4,6,0.7)', 'rgba(8,4,6,0)');
    mid.after = (ctx, L2, S) => {
      for (const g of mGears) screenXs(mid, S, g.x, g.r + 10, (x) => {
        drawGear(ctx, x, g.y, g.r, g.n, S.t * g.w + g.x * 0.01, g.pal, S);
      });
      for (const [lx, ly] of lamps) screenXs(mid, S, lx, 40, (x) => {
        const on = 0.5 + 0.5 * Math.sin(S.t * 3 + lx);
        Art.circlePath(ctx, x, ly, 6); ctx.fillStyle = on > 0.5 ? '#ff6a3d' : '#7a2a1a'; ctx.fill(); stroke(ctx, 2);
        glow(ctx, x, ly, 30, FIRE, 0.35 * on * S.lightK);
      });
      for (const [sx, sy, dir, size, seed] of steams) screenXs(mid, S, sx, 80, (x) => steam(ctx, x, sy, S, seed, dir, size));
    };

    // ---------------- FLOOR : iron grating over a glowing pit
    const flo = mkLayer(L, 'floor', 1440, 1.0, { y0: G - 4, y1: H });
    flo.pre = (ctx, L2, S) => {
      ctx.save();
      ctx.fillStyle = '#2a0b05'; ctx.fillRect(0, G + 8, S.W, H - G);
      const off = layerOffset(flo, S);
      for (let i = 0; i < 6; i++) {
        const bx = mod(i * 240 + 60 + off + Math.sin(S.t * 0.5 + i) * 30, flo.P);
        for (let x = bx - flo.P; x < S.W + 200; x += flo.P) if (x > -200) glow(ctx, x, H, 150, FIRE, (0.55 + 0.25 * Math.sin(S.t * 1.7 + i * 2)) * S.lightK, 0.45);
      }
      ctx.restore();
    };
    flo.base = (c) => {
      const Pp = flo.P, top = G + 12;
      // grating with real holes
      const slots = [];
      let y = top + 5, h = 4, row = 0;
      while (y < H + 4) {
        const n = 7, pw = 240, usable = pw - 36, sw = usable / n - (5 + row);
        for (let p = 0; p < Pp / pw; p++) for (let k = 0; k < n; k++) slots.push([p * pw + 18 + k * (usable / n) + (5 + row) / 2, y, sw, h]);
        y += h + 4 + row; h += 1.6; row++;
      }
      c.save();
      c.beginPath(); c.rect(0, top, Pp, H - top + 4);
      for (const [sx, sy, sw, sh] of slots) c.rect(sx, sy, sw, sh);
      c.fillStyle = P.iron; c.fill('evenodd');
      c.restore();
      c.beginPath(); for (const [sx, sy, sw, sh] of slots) c.rect(sx, sy, sw, sh); stroke(c, 1.3);
      c.beginPath(); for (const [sx, sy, sw, sh] of slots) { c.moveTo(sx + 1, sy + sh + 1.5); c.lineTo(sx + sw - 1, sy + sh + 1.5); } stroke(c, 1.2, P.ironHi);
      // support beams between panels
      for (let p = 0; p <= Pp / 240; p++) {
        cut(c, rectP(p * 240 - 9, top, 18, H - top + 4), P.ironShade, P.ironDark, { lw: 2.2, dx: -3, dy: 0 });
        rivets(c, p * 240, top + 8, p * 240, H, 16, 1.6, P.ironHi);
      }
      fadeRect(c, 0, top, Pp, H, 'rgba(0,0,0,0)', 'rgba(10,4,6,0.35)');
      // front beam
      cut(c, rectP(-10, G - 2, Pp + 20, 15), P.bronzeShade, '#3a2410', { lw: 3, dx: 0, dy: -4 });
      c.beginPath(); c.moveTo(0, G - 1); c.lineTo(Pp, G - 1); stroke(c, 2, P.bronzeHi);
      rivets(c, 6, G + 6, Pp - 6, G + 6, 24, 1.8, P.bronzeHi);
    };
    for (let i = 0; i < 6; i++) {
      const x0 = i * 240 + 90 + hash(i * 6.1) * 80, v = hash(i * 3.3 + 9), y = G + 30 + hash(i * 1.1) * 26;
      if (v < 0.25) addProp(flo, x0, 30, (c, x) => { for (let k = 0; k < 3; k++) { c.save(); c.translate(x + k * 10, y + (k % 2) * 4); c.rotate(k); cut(c, polyP([[-4, -2], [4, -2], [5, 0], [4, 2], [-4, 2], [-5, 0]]), P.ironHi, P.iron, { lw: 1.4, dx: -1, dy: -1 }); c.restore(); } });
      else if (v < 0.45) addProp(flo, x0, 30, (c, x) => {
        cut(c, (g) => { g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x - 9, y - 16); g.quadraticCurveTo(x, y - 22, x + 9, y - 16); g.lineTo(x + 9, y); g.closePath(); }, '#7a2a20', '#521a14', { lw: 2, dx: -3, dy: 0 });
        c.beginPath(); c.moveTo(x + 2, y - 20); c.lineTo(x + 12, y - 30); stroke(c, 3.5, INK); stroke(c, 1.6, '#8e9cb8');
      });
    }
    // ---------------- FG
    buildHangers(L, 1900, [
      { x: 160, kind: 'hook', len: 96 }, { x: 760, kind: 'pipe', len: 70 }, { x: 1260, kind: 'chain', len: 64 }, { x: 1640, kind: 'hook', len: 52 },
    ]);
    buildRubble(L, 1900, ['#1c1418', '#140e12'], '#5a3a2a');
    L.atmos.push(sparks);
    L.haze = ['#1e0f10', 0.14];
    L.fgTint = { col: '#0b0709', rim: 'rgba(255,110,50,0.36)' };
    L.fgGear = true;
  }
  function needle(c, x, y, r, S, seed) {
    const a = Math.PI * 1.55 + Math.sin(S.t * 2.3 + seed) * 0.25 + Math.sin(S.t * 13 + seed) * 0.04;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62); stroke(c, 2, '#c0392b');
    Art.circlePath(c, x, y, 2); c.fillStyle = INK; c.fill();
  }
  function furnaceFire(c, x, G, S) {
    const t = S.t, k = S.lightK;
    glow(c, x, G - 44, 150, FIRE, (0.24 + 0.06 * Math.sin(t * 5.3) + 0.04 * Math.sin(t * 11)) * k);
    glow(c, x, G - 30, 46, '255,200,110', 0.38 * k);
    for (let i = 0; i < 5; i++) Art.flame(c, x - 30 + i * 15, G - 24, 18 + 8 * Math.sin(t * 3 + i * 2), t, { seed: i * 3, glow: false, outer: '#ff6a2b', inner: '#ffd257' });
    for (let i = 0; i < 6; i++) {
      const ph = frac(t * 0.6 + i / 6), px = x - 30 + hash(i * 3) * 60 + Math.sin(ph * 6 + i) * 6, py = G - 30 - ph * 60;
      c.fillStyle = 'rgba(255,190,90,' + (1 - ph).toFixed(2) + ')'; c.fillRect(px, py, 2, 2);
    }
    glow(c, x, G + 10, 120, FIRE, 0.18 * k, 0.25);
  }
  function pistonLive(c, x, G, S) {
    // vertical engine: crank flywheel below, crosshead on guides, piston rod into the cylinder above
    const P = GEA, gx = x - 40, gy = G - 108, r = 78, a = S.t * 0.9;
    drawGear(c, gx, gy, r, 16, a, P.midGear, S);
    const pin = [gx + Math.cos(a) * r * 0.5, gy + Math.sin(a) * r * 0.5];
    const rodL = 112, dx = gx - pin[0];
    const cy = pin[1] - Math.sqrt(Math.max(0, rodL * rodL - dx * dx));
    c.beginPath(); c.moveTo(gx, cy - 12); c.lineTo(gx, G - 286); stroke(c, 9, INK); stroke(c, 5, '#d8e2f0');
    c.beginPath(); c.moveTo(gx - 1.5, cy - 12); c.lineTo(gx - 1.5, G - 286); stroke(c, 1.2, '#ffffff');
    c.beginPath(); c.moveTo(pin[0], pin[1]); c.lineTo(gx, cy); stroke(c, 11, INK); stroke(c, 7, P.ironHi);
    c.beginPath(); c.moveTo(pin[0] - 2, pin[1] - 1); c.lineTo(gx - 2, cy - 1); stroke(c, 1.5, 'rgba(255,230,220,0.45)');
    cut(c, rectP(gx - 19, cy - 13, 38, 24), P.bronze, P.bronzeShade, { lw: 2.5, dx: -3, dy: -3, rim: P.bronzeHi });
    Art.circlePath(c, pin[0], pin[1], 7); c.fillStyle = P.bronzeHi; c.fill(); stroke(c, 2);
    Art.circlePath(c, gx, cy, 4.5); c.fillStyle = P.bronzeShade; c.fill(); stroke(c, 2);
  }
  function sparks(ctx, L, S) {
    const W = S.W, H = L.H, t = S.t;
    ctx.save();
    for (let i = 0; i < 22; i++) {
      const per = 2.5 + hash(i * 2.2) * 3, ph = frac(t / per + hash(i * 9.1));
      const x = mod(hash(i * 4.4) * (W + 300) - S.camX + Math.sin(ph * 8 + i) * 14, W + 300) - 150;
      const y = H - ph * (H - 120);
      const a = (1 - ph) * 0.9;
      ctx.fillStyle = 'rgba(255,' + (150 + Math.floor(hash(i) * 80)) + ',70,' + a.toFixed(2) + ')';
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();
  }

  // ======================================================================
  // ZONE: ABYSS  灰輪の座 — void, falling ash, cracked circular dais, giant wheel silhouette
  // ======================================================================
  const ABY = {
    far: '#150e20', farShade: '#0e0917',
    pillar: '#2c2339', pillarShade: '#1d1729', pillarHi: '#463a5c',
    dais: '#3a2f48', daisShade: '#2a2236', daisHi: '#56476a', daisLine: '#1d1628',
    face: '#221b2e', faceShade: '#161120',
  };
  const EMBER = '255,104,48';

  function paintAshWheel(c, R, o) {
    o = o || {};
    const base = o.base || '#1d1529', hole = o.hole || '#0b0712', lw = o.lw || 4;
    // blunt cogs
    gearPath(c, R, 28, R * 0.07); c.fillStyle = base; c.fill(); stroke(c, lw);
    // ring cut-out between rim and hub with 8 spokes
    const ri = R * 0.8, rh = R * 0.26;
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * TAU + 0.07, a1 = ((i + 1) / 8) * TAU - 0.07;
      c.beginPath(); c.arc(0, 0, ri, a0, a1); c.arc(0, 0, rh, a1 - 0.12, a0 + 0.12, true); c.closePath();
      c.fillStyle = hole; c.fill(); stroke(c, lw * 0.7);
    }
    Art.circlePath(c, 0, 0, ri + 2); stroke(c, lw * 0.5, o.line || 'rgba(60,40,80,0.6)');
    Art.circlePath(c, 0, 0, rh); c.fillStyle = base; c.fill(); stroke(c, lw);
    Art.circlePath(c, 0, 0, rh * 0.45); c.fillStyle = hole; c.fill(); stroke(c, lw * 0.7);
    // runes on rim
    c.save();
    c.strokeStyle = o.rune || 'rgba(255,120,60,0.45)'; c.lineWidth = Math.max(1.5, R * 0.008); c.lineCap = 'round';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU, rr = (R * 0.86 + ri) / 2 + R * 0.02;
      c.save(); c.translate(Math.cos(a) * rr, Math.sin(a) * rr); c.rotate(a + Math.PI / 2);
      const v = i % 4, s = R * 0.025;
      c.beginPath();
      if (v === 0) { c.moveTo(-s, -s); c.lineTo(s, s); c.moveTo(s, -s); c.lineTo(-s, s); }
      else if (v === 1) { c.moveTo(0, -s * 1.2); c.lineTo(0, s * 1.2); c.moveTo(-s, 0); c.lineTo(s, -s); }
      else if (v === 2) { c.arc(0, 0, s, 0, Math.PI * 1.5); }
      else { c.moveTo(-s, s); c.lineTo(0, -s); c.lineTo(s, s); }
      c.stroke(); c.restore();
    }
    c.restore();
    // cracks
    c.beginPath();
    c.moveTo(R * 0.3, -R * 0.12); c.lineTo(R * 0.5, -R * 0.2); c.lineTo(R * 0.62, -R * 0.14); c.lineTo(R * 0.8, -R * 0.22);
    c.moveTo(-R * 0.82, R * 0.3); c.lineTo(-R * 0.66, R * 0.26); c.lineTo(-R * 0.55, R * 0.36);
    stroke(c, lw * 0.6, o.crack || 'rgba(255,100,50,0.35)');
  }
  const _wheel = Object.create(null);
  function wheelSprite(R, key, o, s) {
    const k = key + '|' + R + '|' + s;
    if (k in _wheel) return _wheel[k];
    const RR = R + 10, cv = makeCanvas(RR * 2 * s, RR * 2 * s);
    let out = null;
    if (cv) { const g = cv.getContext('2d'); g.scale(s, s); g.translate(RR, RR); paintAshWheel(g, R, o); out = { cv, R: RR }; }
    _wheel[k] = out;
    return out;
  }
  function drawWheel(c, x, y, R, ang, key, o, S, alpha) {
    const spr = wheelSprite(R, key, o, S.scale || 1);
    c.save(); c.globalAlpha *= alpha; c.translate(x, y); c.rotate(ang);
    if (spr) c.drawImage(spr.cv, -spr.R, -spr.R, spr.R * 2, spr.R * 2); else paintAshWheel(c, R, o);
    c.restore();
  }
  function abyssDais(c, x, G, H) {
    const P = ABY, rx = 720, ry = 56, cy = G + 24;
    c.save(); c.translate(x, 0);
    // side face visible at the far ends
    cut(c, (g) => { g.beginPath(); g.moveTo(-rx, cy); g.lineTo(-rx, cy + 90); g.ellipse(0, cy + 90, rx, ry, 0, Math.PI, 0, true); g.lineTo(rx, cy); g.ellipse(0, cy, rx, ry, 0, 0, Math.PI, false); g.closePath(); }, P.face, P.faceShade, { lw: 3, dx: 30, dy: 0 });
    // top surface
    const top = (g) => { g.beginPath(); g.ellipse(0, cy, rx, ry, 0, 0, TAU); };
    cut(c, top, P.dais, P.daisShade, { lw: 3, dx: 0, dy: 10 });
    c.save(); top(c); c.clip();
    // concentric paving rings (close values) and staggered radial joints
    for (const [k, col] of [[0.88, P.daisShade], [0.7, P.dais], [0.62, '#33293f'], [0.4, P.dais], [0.16, '#40344f']]) {
      c.beginPath(); c.ellipse(0, cy, rx * k, ry * k, 0, 0, TAU); c.fillStyle = col; c.fill(); stroke(c, 2.2, P.daisLine);
    }
    c.beginPath();
    const ringsK = [0.16, 0.4, 0.62, 0.7, 0.88, 1];
    for (let r = 0; r < ringsK.length - 1; r++) {
      if (r === 2) continue; // rune band has no joints
      const n = 12 + r * 8;
      for (let i = 0; i < n; i++) {
        const a = ((i + (r % 2) * 0.5) / n) * TAU;
        c.moveTo(Math.cos(a) * rx * ringsK[r], cy + Math.sin(a) * ry * ringsK[r]); c.lineTo(Math.cos(a) * rx * ringsK[r + 1], cy + Math.sin(a) * ry * ringsK[r + 1]);
      }
    }
    stroke(c, 1.5, P.daisLine);
    // worn highlights on the back edges of each ring
    for (const k of [0.97, 0.86, 0.68, 0.38]) { c.beginPath(); c.ellipse(0, cy, rx * k, ry * k, 0, Math.PI * 1.1, Math.PI * 1.9); stroke(c, 1.6, 'rgba(130,110,160,0.5)'); }
    // engraved rune band (glyphs between the 0.62 and 0.7 rings)
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU, px = Math.cos(a) * rx * 0.66, py = cy + Math.sin(a) * ry * 0.66, s = 3 + Math.max(0, Math.sin(a)) * 3;
      c.save(); c.translate(px, py); c.scale(1.6, 0.55);
      c.beginPath(); runeGlyph(c, i, s); stroke(c, 2.2, P.daisLine);
      c.restore();
    }
    // central engraved wheel sigil
    c.save(); c.translate(0, cy); c.scale(1, ry / rx);
    c.beginPath(); c.arc(0, 0, rx * 0.13, 0, TAU); stroke(c, 5, P.daisLine);
    c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; c.moveTo(Math.cos(a) * rx * 0.035, Math.sin(a) * rx * 0.035); c.lineTo(Math.cos(a) * rx * 0.13, Math.sin(a) * rx * 0.13); } stroke(c, 4, P.daisLine);
    c.beginPath(); c.arc(0, 0, rx * 0.035, 0, TAU); c.fillStyle = P.daisLine; c.fill();
    c.restore();
    // cracks (dark)
    abyssCracks(c, rx, ry, cy, P.daisLine, 2.2);
    c.restore();
    top(c); stroke(c, 3);
    // back rim lip
    c.beginPath(); c.ellipse(0, cy, rx, ry, 0, Math.PI, TAU); stroke(c, 2, P.daisHi);
    c.restore();
  }
  // small angular rune glyph (subpath only), variant by index
  function runeGlyph(c, i, s) {
    switch (i % 5) {
      case 0: c.moveTo(-s, -s); c.lineTo(s, s); c.moveTo(s, -s); c.lineTo(-s, s); break;
      case 1: c.moveTo(0, -s * 1.2); c.lineTo(0, s * 1.2); c.moveTo(0, -s * 0.2); c.lineTo(s, -s); break;
      case 2: c.moveTo(-s, s); c.lineTo(0, -s); c.lineTo(s, s); break;
      case 3: c.moveTo(-s, -s); c.lineTo(-s, s); c.lineTo(s, 0); c.closePath(); break;
      default: c.moveTo(-s, 0); c.lineTo(0, -s); c.lineTo(s, 0); c.lineTo(0, s); c.closePath();
    }
  }
  function abyssCracks(c, rx, ry, cy, col, lw) {
    const r = rnd(77);
    c.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + r() * 0.5;
      let k = 0.12 + r() * 0.2, px = Math.cos(a) * rx * k, py = cy + Math.sin(a) * ry * k;
      c.moveTo(px, py);
      for (let s = 0; s < 4; s++) {
        k += 0.12 + r() * 0.12;
        const aa = a + (r() - 0.5) * 0.25;
        px = Math.cos(aa) * rx * k; py = cy + Math.sin(aa) * ry * k;
        c.lineTo(px, py);
        if (k > 0.95) break;
      }
    }
    stroke(c, lw, col);
  }
  function abyssPillar(c, x, G, h, broken, seed) {
    const P = ABY, w = 64, top = G - h;
    c.save(); c.translate(x, 0);
    const r = rnd(seed);
    const pts = [[-w / 2, G + 4], [-w / 2, top + 20]];
    if (broken) { pts.push([-w / 2 + 8, top + 6], [-6, top + 16 + r() * 10], [6, top - 4], [w / 2 - 6, top + 10 + r() * 14]); }
    else { pts.push([-w / 2 - 10, top + 20], [-w / 2 - 10, top], [w / 2 + 10, top], [w / 2 + 10, top + 20]); }
    pts.push([w / 2, top + 20], [w / 2, G + 4]);
    cut(c, polyP(pts), P.pillar, P.pillarShade, { lw: 3, dx: -14, dy: 0, rim: P.pillarHi });
    c.beginPath(); for (const fx of [-16, -4, 8, 20]) { c.moveTo(fx, top + 30); c.lineTo(fx, G - 30); } stroke(c, 1.5, 'rgba(10,6,16,0.6)');
    c.beginPath(); c.moveTo(-w / 2, top + 70); c.lineTo(-8, top + 92); c.lineTo(-14, top + 120); stroke(c, 2);
    // ember underlight
    fadeRect(c, -w / 2, G - 90, w, G, 'rgba(255,100,50,0)', 'rgba(255,100,50,0.16)');
    cut(c, rectP(-w / 2 - 10, G - 26, w + 20, 28), P.pillar, P.pillarShade, { lw: 2.5, dx: -4, dy: -3, rim: P.pillarHi });
    c.restore();
  }
  function brazier(c, x, G) {
    const P = ABY;
    c.save(); c.translate(x, 0);
    c.beginPath(); c.moveTo(-18, G); c.lineTo(0, G - 70); c.lineTo(18, G); c.moveTo(-10, G - 30); c.lineTo(10, G - 30); stroke(c, 6, INK); stroke(c, 3, '#3a3048');
    cut(c, (g) => { g.beginPath(); g.moveTo(-30, G - 92); g.lineTo(30, G - 92); g.quadraticCurveTo(26, G - 66, 0, G - 64); g.quadraticCurveTo(-26, G - 66, -30, G - 92); g.closePath(); }, '#3a3048', '#241d30', { lw: 3, dx: -6, dy: -2, rim: '#5a4a70' });
    c.beginPath(); c.moveTo(-26, G - 84); c.lineTo(26, G - 84); stroke(c, 1.5, 'rgba(10,6,16,0.6)');
    cut(c, ellP(0, G - 92, 30, 6), '#120a10', null, { lw: 2.5 });
    c.restore();
  }
  function floatIsle(c, x, y, w, h, seed, ruin) {
    const P = ABY, r = rnd(seed);
    const pts = [[x - w / 2, y], [x - w * 0.3, y - 6 - r() * 6], [x + w * 0.2, y - 4 - r() * 6], [x + w / 2, y], [x + w * 0.3, y + h * 0.4], [x + w * 0.1, y + h * (0.8 + r() * 0.2)], [x - w * 0.05, y + h], [x - w * 0.2, y + h * 0.6], [x - w * 0.42, y + h * 0.3]];
    cut(c, polyP(pts), P.far, P.farShade, { lw: 2, dx: 6, dy: 6 });
    c.beginPath(); c.moveTo(x - w * 0.36, y + h * 0.3); c.lineTo(x - w * 0.05, y + h * 0.96); c.lineTo(x + w * 0.28, y + h * 0.42); stroke(c, 2, 'rgba(255,110,50,0.3)');
    if (ruin) {
      for (let k = 0; k < 3; k++) {
        const px = x - w * 0.3 + k * w * 0.26, ph = 20 + r() * 50;
        cut(c, polyP([[px - 7, y - 2], [px - 7, y - ph], [px - 2, y - ph - 6], [px + 7, y - ph + 2], [px + 7, y - 2]]), P.far, P.farShade, { lw: 2, dx: -3, dy: 0 });
      }
    }
  }

  function buildAbyss(L) {
    const G = L.G, H = L.H, P = ABY;
    // giant reverse-turning ash wheel far behind everything (live sprite, x0.1, period 2560)
    L.liveBack = (ctx, L2, S) => {
      const x = mod(700 - S.camX * 0.1 + 1280, 2560) - 1280;
      const R = 330, y = G - 150;
      if (x < -R - 20 || x > S.W + R + 20) return;
      glow(ctx, x, y, R * 1.25, '120,40,60', 0.22);
      drawWheel(ctx, x, y, R, -S.t * 0.05, 'abyss', { base: '#1c1428', hole: '#0a0611', rune: 'rgba(255,120,60,0.5)' }, S, 0.68);
      ctx.save(); Art.circlePath(ctx, x, y, R * 0.96); ctx.lineWidth = 8; ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,90,40,' + (0.08 + 0.05 * Math.sin(S.t * 0.9)).toFixed(3) + ')'; ctx.stroke(); ctx.restore();
    };
    // ---------------- FAR : floating ruined isles, chains into the void
    const far = mkLayer(L, 'far', 1600, 0.25, { y0: 0, y1: G + 2 });
    [[120, 160, 120, 40, true], [520, 250, 80, 30, false], [900, 120, 140, 46, true], [1260, 230, 100, 34, true], [1450, 90, 70, 24, false]].forEach(([x0, y0, w, h, ruin], i) => {
      addProp(far, x0, w, (c, x) => floatIsle(c, x, y0, w, h, 90 + i, ruin));
    });
    [[300, 150], [1080, 210], [1530, 120]].forEach(([x0, len], i) => addProp(far, x0, 30, (c, x) => {
      chainAlong(c, [[x, -10], [x + 6, len]], 10, '#120c18', '#2c2240', 2);
      cut(c, polyP([[x - 2, len], [x + 14, len], [x + 18, len + 26], [x + 2, len + 30], [x - 6, len + 20]]), P.far, P.farShade, { lw: 2, dx: -2, dy: 0 });
    }));
    // ---------------- MID : broken colossal pillars and braziers framing the dais
    const mid = mkLayer(L, 'mid', 2560, 0.6, { y0: 0, y1: G + 4 });
    const mp = [[44, 300, false], [1250, 330, true], [1640, 250, true], [2200, 280, false], [1920, 200, true]];
    mp.forEach(([x0, h, broken], i) => addProp(mid, x0, 60, (c, x) => abyssPillar(c, x, G - 30, h, broken, 120 + i)));
    const braz = [560, 1182, 1800, 2420];
    braz.forEach((x0) => {
      addProp(mid, x0, 40, (c, x) => brazier(c, x, G - 28));
      addLive(mid, x0, 140, (c, x, S) => {
        const k = S.lightK;
        glow(c, x, G - 130, 110, EMBER, (0.3 + 0.08 * Math.sin(S.t * 4.3 + x0)) * k);
        for (let j = 0; j < 3; j++) Art.flame(c, x - 12 + j * 12, G - 120, 18 + 6 * Math.sin(S.t * 3.3 + j * 2 + x0), S.t, { seed: j * 5 + x0, glow: false, outer: '#ff5a2b', inner: '#ffc15e' });
        glow(c, x, G - 30, 80, EMBER, 0.14 * k, 0.25);
      });
    });
    [[520, 170], [2000, 140]].forEach(([x0, len], i) => addProp(mid, x0, 40, (c, x) => chainAlong(c, [[x, -10], [x + 24, len * 0.5], [x + 30, len]], 13, '#18101e', '#3a2f4c', 2.6)));
    mid.post = (c) => fadeRect(c, 0, -10, mid.P, G * 0.45, 'rgba(4,2,8,0.7)', 'rgba(4,2,8,0)');
    // ---------------- FLOOR : cracked circular dais (centered at x=640 when camX=0) + broken causeway
    const flo = mkLayer(L, 'floor', 2560, 1.0, { y0: G - 40, y1: H });
    addProp(flo, 1920, 600, (c, x) => {
      cut(c, polyP([[x - 640, G + 4], [x - 600, G - 6], [x - 300, G - 4], [x - 260, G + 2], [x + 180, G - 2], [x + 240, G - 8], [x + 600, G - 4], [x + 640, G + 6], [x + 640, H + 4], [x - 640, H + 4]]), P.dais, P.daisShade, { lw: 3, dx: 0, dy: 8 });
      c.beginPath(); for (let k = -600; k < 640; k += 70) { c.moveTo(x + k, G); c.lineTo(x + k - 12, H); } stroke(c, 1.5, P.daisLine);
      rock(c, x - 300, G + 10, 50, 14, 3, P.pillar, P.pillarShade, P.pillarHi);
      rock(c, x + 220, G + 30, 40, 12, 4, P.pillar, P.pillarShade, P.pillarHi);
    });
    addProp(flo, 640, 760, (c, x) => abyssDais(c, x, G, H));
    const cr = mkLayer(L, 'cracks', 2560, 1.0, { y0: G - 40, y1: H, comp: 'lighter', alpha: (S) => (0.55 + 0.3 * Math.sin(S.t * 1.25) + 0.1 * Math.sin(S.t * 3.7)) * S.lightK });
    addProp(cr, 640, 760, (c, x) => {
      c.save(); c.translate(x, 0);
      c.beginPath(); c.ellipse(0, G + 24, 720, 56, 0, 0, TAU); c.clip();
      abyssCracks(c, 720, 56, G + 24, 'rgba(255,90,40,0.35)', 7);
      abyssCracks(c, 720, 56, G + 24, 'rgba(255,170,90,0.9)', 2);
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * TAU, px = Math.cos(a) * 720 * 0.66, py = G + 24 + Math.sin(a) * 56 * 0.66, s = 3 + Math.max(0, Math.sin(a)) * 3;
        c.save(); c.translate(px, py); c.scale(1.6, 0.55);
        c.beginPath(); runeGlyph(c, i, s); stroke(c, 1.6, 'rgba(255,130,70,0.7)');
        c.restore();
      }
      c.save(); c.translate(0, G + 24); c.scale(1, 56 / 720);
      c.beginPath(); c.arc(0, 0, 720 * 0.13, 0, TAU); stroke(c, 10, 'rgba(255,100,50,0.25)'); stroke(c, 3, 'rgba(255,150,80,0.6)');
      c.restore();
      c.restore();
    });
    cr.after = (ctx, L2, S) => embersRise(ctx, L2, S, cr);
    // ---------------- FG
    buildHangers(L, 1700, [{ x: 200, kind: 'shackle', len: 110 }, { x: 860, kind: 'chain', len: 50 }, { x: 1380, kind: 'shackle', len: 80 }]);
    buildRubble(L, 1700, ['#120c18', '#0c0812'], '#4a2a3a');
    L.atmos.push(ash);
    L.haze = ['#140c1c', 0.1];
    L.fgTint = { col: '#07040b', rim: 'rgba(255,100,50,0.3)' };
  }
  function ash(ctx, L, S) {
    const W = S.W, H = L.H, t = S.t;
    ctx.save();
    for (let i = 0; i < 70; i++) {
      const sp = 14 + hash(i * 3.3) * 22, ph = hash(i * 1.7) * (H + 40);
      const y = mod(ph + t * sp, H + 40) - 20;
      const x = mod(hash(i * 5.9) * (W + 100) + Math.sin(t * 0.6 + i) * 18 - S.camX * (0.3 + hash(i) * 0.9), W + 100) - 50;
      const s = 1.2 + hash(i * 2.9) * 2.2, a = 0.25 + hash(i * 8.1) * 0.4;
      ctx.fillStyle = 'rgba(165,150,170,' + a.toFixed(2) + ')';
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * (0.5 + hash(i)) + i); ctx.fillRect(-s, -s * 0.5, s * 2, s); ctx.restore();
    }
    ctx.restore();
  }
  function embersRise(ctx, L, S, ly) {
    const t = S.t, G = L.G;
    ctx.save();
    for (let i = 0; i < 26; i++) {
      const per = 3 + hash(i * 2.7) * 3, ph = frac(t / per + hash(i * 4.3));
      const xs = hash(i * 6.1) * ly.P;
      screenXs(ly, S, xs, 20, (x) => {
        const px = x + Math.sin(ph * 7 + i) * 10, py = G + 30 - ph * 220;
        const a = (1 - ph) * Math.min(1, ph * 6);
        ctx.fillStyle = 'rgba(255,' + (120 + Math.floor(hash(i) * 90)) + ',60,' + (a * 0.9).toFixed(2) + ')';
        ctx.fillRect(px, py, 2.2, 2.2);
      });
    }
    ctx.restore();
  }

  // ======================================================================
  // ZONE: CAMP  — night sky, dungeon mouth, tents, campfire (calm, safe)
  // ======================================================================
  const CMP = {
    rock: '#35315b', rockShade: '#25223f', rockHi: '#4f4a80',
    pine: '#0d1126', pineShade: '#090c1c',
    tent: '#6c577a', tentShade: '#4a3a5a', tentHi: '#8a74a0',
    wood: '#5f3d29', woodShade: '#3d2618', woodHi: '#86573a',
    ground: '#1b1a33', groundShade: '#13122a', grass: '#22264a',
  };
  function pine(c, x, by, h, seed, col, shade) {
    const r = rnd(seed), tiers = 4, w = h * 0.42;
    c.beginPath();
    c.moveTo(x, by - h);
    for (let i = 1; i <= tiers; i++) {
      const ty = by - h + (h * 0.86 * i) / tiers, tw = (w * i) / tiers;
      c.lineTo(x + tw * (0.9 + r() * 0.2), ty); c.lineTo(x + tw * 0.45, ty - h * 0.06);
    }
    c.lineTo(x + w * 0.12, by - h * 0.14); c.lineTo(x + w * 0.1, by); c.lineTo(x - w * 0.1, by); c.lineTo(x - w * 0.12, by - h * 0.14);
    for (let i = tiers; i >= 1; i--) {
      const ty = by - h + (h * 0.86 * i) / tiers, tw = (w * i) / tiers;
      c.lineTo(x - tw * 0.45, ty - h * 0.06); c.lineTo(x - tw * (0.9 + r() * 0.2), ty);
    }
    c.closePath();
    c.fillStyle = col; c.fill(); stroke(c, 2, shade || INK);
  }
  function tent(c, x, by, w, h, lit) {
    const P = CMP;
    // back panel
    cut(c, polyP([[x - w * 0.5, by], [x - w * 0.06, by - h], [x + w * 0.08, by - h], [x + w * 0.5, by]]), P.tent, P.tentShade, { lw: 3, dx: -w * 0.22, dy: 0, rim: P.tentHi });
    // doorway
    const door = polyP([[x - w * 0.2, by], [x, by - h * 0.78], [x + w * 0.2, by]]);
    door(c); c.fillStyle = lit ? '#3a2018' : '#120e1c'; c.fill();
    if (lit) { c.save(); door(c); c.clip(); fadeRect(c, x - w * 0.2, by - h * 0.78, w * 0.4, by, '#5a2c1a', '#e0904a'); c.restore(); }
    door(c); stroke(c, 2.5);
    // flaps tied back
    cut(c, polyP([[x, by - h * 0.78], [x - w * 0.22, by], [x - w * 0.3, by], [x - w * 0.12, by - h * 0.4]]), P.tentHi, P.tent, { lw: 2.2, dx: -2, dy: 0 });
    cut(c, polyP([[x, by - h * 0.78], [x + w * 0.22, by], [x + w * 0.3, by], [x + w * 0.1, by - h * 0.42]]), P.tent, P.tentShade, { lw: 2.2, dx: 2, dy: 0 });
    // seams, ridge pole, ropes & pegs
    c.beginPath(); c.moveTo(x - w * 0.27, by - h * 0.4); c.lineTo(x - w * 0.36, by); c.moveTo(x + w * 0.29, by - h * 0.4); c.lineTo(x + w * 0.38, by); stroke(c, 1.3, 'rgba(26,18,34,0.5)');
    c.beginPath(); c.moveTo(x + w * 0.01, by - h); c.lineTo(x + w * 0.01, by - h - 14); stroke(c, 3.5, INK); stroke(c, 1.8, P.woodHi);
    cut(c, polyP([[x + w * 0.01, by - h - 14], [x + w * 0.16, by - h - 10], [x + w * 0.01, by - h - 6]]), '#c0392b', '#8a2a20', { lw: 1.6, dx: 0, dy: 1 });
    c.beginPath(); c.moveTo(x - w * 0.05, by - h * 0.95); c.lineTo(x - w * 0.72, by); c.moveTo(x + w * 0.07, by - h * 0.95); c.lineTo(x + w * 0.72, by); stroke(c, 1.2, 'rgba(200,190,220,0.4)');
  }
  function caveMouth(c, x, G, seed) {
    const P = CMP, r = rnd(seed);
    c.save(); c.translate(x, 0);
    // cliff mass
    const cliff = [[-270, G + 4], [-262, G - 140], [-230, G - 210], [-170, G - 262], [-90, G - 300], [-20, G - 308], [60, G - 290], [140, G - 250], [200, G - 200], [250, G - 130], [270, G - 60], [276, G + 4]];
    cut(c, polyP(cliff), P.rock, P.rockShade, { lw: 3, dx: -26, dy: -10, rim: P.rockHi, rimW: 2.5 });
    // facets
    c.beginPath();
    c.moveTo(-200, G - 230); c.lineTo(-150, G - 170); c.lineTo(-190, G - 90);
    c.moveTo(-60, G - 296); c.lineTo(-40, G - 240); c.lineTo(10, G - 230);
    c.moveTo(130, G - 248); c.lineTo(100, G - 190); c.lineTo(150, G - 130); c.lineTo(140, G - 60);
    c.moveTo(-240, G - 60); c.lineTo(-200, G - 40);
    stroke(c, 2, 'rgba(14,10,26,0.7)');
    // mouth
    const mouth = [[-110, G + 4], [-112, G - 100], [-96, G - 160], [-60, G - 196], [-10, G - 206], [40, G - 196], [76, G - 166], [96, G - 110], [100, G + 4]];
    cut(c, blobP(mouth, 0.7), '#07060e', null, { lw: 3.5 });
    c.save(); blobP(mouth, 0.7)(c); c.clip();
    // stairs descending into darkness
    for (let k = 0; k < 7; k++) {
      const y = G - 4 - k * 11, w = 120 - k * 14;
      c.fillStyle = mix('#2e2a4c', '#07060e', k / 7); c.fillRect(-w / 2 - 6, y - 11, w, 11);
      c.fillStyle = mix('#4a4472', '#07060e', k / 7); c.fillRect(-w / 2 - 6, y - 11, w, 2);
    }
    glow(c, -6, G - 120, 90, '255,120,60', 0.12);
    c.restore();
    // timber frame
    for (const sx of [-92, 82]) cut(c, rectP(sx - 8, G - 170, 16, 174), P.wood, P.woodShade, { lw: 2.5, dx: -4, dy: 0, rim: P.woodHi });
    cut(c, rectP(-112, G - 186, 214, 20), P.wood, P.woodShade, { lw: 2.5, dx: 0, dy: -4, rim: P.woodHi });
    c.beginPath(); c.moveTo(-84, G - 166); c.lineTo(-60, G - 166 + 22); c.moveTo(74, G - 166); c.lineTo(50, G - 144); stroke(c, 6, INK); stroke(c, 3.5, P.woodShade);
    // lantern hook
    c.beginPath(); c.moveTo(60, G - 166); c.lineTo(60, G - 150); stroke(c, 2.5);
    // signpost with a carved down-arrow (no text)
    cut(c, rectP(142, G - 96, 10, 100), P.wood, P.woodShade, { lw: 2.5, dx: -3, dy: 0 });
    cut(c, polyP([[118, G - 92], [176, G - 92], [186, G - 78], [176, G - 64], [118, G - 64]]), P.woodHi, P.wood, { lw: 2.5, dx: -2, dy: -3 });
    c.beginPath(); c.moveTo(150, G - 88); c.lineTo(150, G - 70); c.moveTo(144, G - 76); c.lineTo(150, G - 69); c.lineTo(156, G - 76); stroke(c, 2.5, '#ffd257');
    // moss/vines
    c.beginPath(); for (let k = 0; k < 9; k++) { const vx = -100 + k * 22 + r() * 8; c.moveTo(vx, G - 186); c.quadraticCurveTo(vx + 4, G - 170, vx - 2, G - 150 - r() * 16); } stroke(c, 2, '#2f5a46');
    c.restore();
  }
  function campfireStatic(c, x, by) {
    const P = CMP;
    // ember bed & logs
    cut(c, ellP(x, by - 3, 36, 9), '#2a1410', null, { lw: 2.5 });
    for (const [a, l] of [[-0.35, 34], [0.4, 32], [Math.PI + 0.2, 30]]) {
      c.save(); c.translate(x, by - 8); c.rotate(a);
      cut(c, rrectP(-l / 2, -5, l, 10, 5), P.wood, P.woodShade, { lw: 2.5, dx: 0, dy: -3 });
      Art.circlePath(c, l / 2 - 3, 0, 4.2); c.fillStyle = '#c08a5a'; c.fill(); stroke(c, 1.5);
      c.restore();
    }
    // stone ring
    for (let i = 0; i < 11; i++) {
      const a = Math.PI * 0.95 + (i / 10) * Math.PI * 1.1 - Math.PI;
      const sx = x + Math.cos(a) * 46, sy = by - 2 + Math.sin(a) * 11;
      if (Math.sin(a) < -0.2) continue;
      rock(c, sx, sy + 4, 18, 11, 500 + i, '#4a4568', '#322e4c', '#6a64a0', 2);
    }
  }
  function campfireLive(c, x, by, S) {
    const t = S.t, k = S.lightK;
    glow(c, x, by - 30, 300, '255,140,60', (0.2 + 0.03 * Math.sin(t * 7) + 0.03 * Math.sin(t * 13)) * k);
    glow(c, x, by + 2, 210, '255,150,70', 0.22 * k, 0.24);
    glow(c, x, by - 20, 60, '255,210,140', 0.5 * k);
    const tongues = [[-14, 30, 0], [12, 34, 2], [0, 48, 4], [-6, 26, 6], [16, 22, 8]];
    for (const [dx, s, sd] of tongues) Art.flame(c, x + dx, by - 6, s * (1 + 0.12 * Math.sin(t * 5 + sd)), t, { seed: sd, glow: false, outer: '#ff6a2b', inner: '#ffc15e' });
    for (const [dx, s, sd] of [[-4, 22, 1], [6, 18, 3]]) Art.flame(c, x + dx, by - 7, s, t, { seed: sd, glow: false, outer: '#ffc15e', inner: '#fff1c8' });
    for (let i = 0; i < 10; i++) {
      const per = 1.6 + hash(i * 3.7) * 1.8, ph = frac(t / per + hash(i * 5.3));
      const px = x + (hash(i * 7.1) - 0.5) * 30 + Math.sin(ph * 6 + i) * 10 * ph, py = by - 20 - ph * 140;
      c.fillStyle = 'rgba(255,' + (170 + Math.floor(hash(i) * 70)) + ',90,' + (1 - ph).toFixed(2) + ')';
      c.fillRect(px, py, 2.2, 2.2);
    }
    for (let i = 0; i < 4; i++) {
      const ph = frac(t * 0.12 + i / 4);
      puff(c, x + Math.sin(ph * 4 + i) * 16 + ph * 30, by - 80 - ph * 200, 20 + ph * 50, '120,110,150', (1 - ph) * 0.08);
    }
  }
  function ridge(x, P, amp, seed) {
    let y = 0;
    const ks = [2, 3, 5, 7, 11, 17];
    for (let i = 0; i < ks.length; i++) y += Math.sin((x / P) * TAU * ks[i] + hash(seed + i) * TAU) * amp / (1 + i * 0.7);
    return y;
  }
  function buildCamp(L) {
    const G = L.G, H = L.H, W = L.W, P = CMP;
    L.stars = [];
    for (let i = 0; i < 28; i++) L.stars.push([hash(i * 11.3) * W, 20 + hash(i * 3.9) * (G * 0.5), 1 + hash(i * 2.2) * 1.5, i]);
    L.liveBack = (ctx, L2, S) => {
      for (const [sx, sy, sz, i] of L2.stars) {
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(S.t * (1 + hash(i) * 2) + i * 4.1));
        ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = '#fff6d8'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx - sz * 3, sy); ctx.lineTo(sx + sz * 3, sy); ctx.moveTo(sx, sy - sz * 3); ctx.lineTo(sx, sy + sz * 3); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.fillRect(sx - sz * 0.6, sy - sz * 0.6, sz * 1.2, sz * 1.2);
        ctx.restore();
      }
      const ph = frac(S.t / 11);
      if (ph < 0.08) {
        const q = ph / 0.08, x0 = W * 0.2 + hash(Math.floor(S.t / 11)) * W * 0.5, y0 = 40 + hash(Math.floor(S.t / 11) + 3) * 80;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(x0 + q * 220 - 80, y0 + q * 70 - 25, x0 + q * 220, y0 + q * 70);
        g.addColorStop(0, 'rgba(255,246,216,0)'); g.addColorStop(1, 'rgba(255,246,216,' + (0.8 * (1 - q)).toFixed(2) + ')');
        ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0 + q * 220 - 80, y0 + q * 70 - 25); ctx.lineTo(x0 + q * 220, y0 + q * 70); ctx.stroke();
        ctx.restore();
      }
    };
    // ---------------- FAR : mountain ranges
    const far = mkLayer(L, 'far', 2048, 0.25, { y0: Math.max(0, G - 330), y1: G + 2 });
    far.base = (c) => {
      const Pp = far.P;
      c.beginPath(); c.moveTo(0, G + 2);
      for (let x = 0; x <= Pp; x += 8) c.lineTo(x, G - 180 + ridge(x, Pp, 60, 3) - Math.abs(ridge(x, Pp, 30, 9)));
      c.lineTo(Pp, G + 2); c.closePath();
      c.fillStyle = '#1d1f4a'; c.fill(); stroke(c, 2, '#121433');
      // snow caps
      c.save(); c.clip();
      c.beginPath();
      for (let x = 0; x <= Pp; x += 8) c.lineTo(x, G - 180 + ridge(x, Pp, 60, 3) - Math.abs(ridge(x, Pp, 30, 9)) + 16 + Math.abs(Math.sin((x / Pp) * TAU * 36)) * 10);
      c.lineTo(Pp, 0); c.lineTo(0, 0); c.closePath();
      c.fillStyle = 'rgba(120,124,190,0.35)'; c.fill();
      c.restore();
      c.beginPath(); c.moveTo(0, G + 2);
      for (let x = 0; x <= Pp; x += 8) c.lineTo(x, G - 92 + ridge(x, Pp, 26, 21));
      c.lineTo(Pp, G + 2); c.closePath();
      c.fillStyle = '#15163a'; c.fill(); stroke(c, 2, '#0e0f2a');
      fadeRect(c, 0, G - 110, Pp, G + 2, 'rgba(60,50,110,0)', 'rgba(60,50,110,0.25)');
    };
    // ---------------- MID : forest line, cliff with the dungeon mouth, tent
    const mid = mkLayer(L, 'mid', 2560, 0.6, { y0: Math.max(0, G - 330), y1: G + 4 });
    mid.base = (c) => {
      const Pp = mid.P;
      c.beginPath(); c.moveTo(0, G + 4);
      for (let x = 0; x <= Pp; x += 10) c.lineTo(x, G - 40 + ridge(x, Pp, 10, 40));
      c.lineTo(Pp, G + 4); c.closePath(); c.fillStyle = '#10132c'; c.fill();
    };
    for (let i = 0; i < 64; i++) {
      const x0 = i * 40 + hash(i * 2.7) * 22;
      if ((x0 > 0 && x0 < 560) || (x0 > 2500)) continue;
      const h = 60 + hash(i * 5.1) * 70 + (i % 3 === 0 ? 30 : 0);
      addProp(mid, x0, 40, (c, x) => pine(c, x, G - 30 + hash(i) * 10, h, 300 + i, i % 2 ? P.pine : '#101530', INK));
    }
    addProp(mid, 270, 300, (c, x) => caveMouth(c, x, G, 7));
    addLive(mid, 270 + 60, 80, (c, x, S) => {
      const sway = Math.sin(S.t * 1.1) * 0.05;
      c.save(); c.translate(x, G - 150); c.rotate(sway);
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 8); stroke(c, 2);
      flameLight(c, 0, 26, 6, 5, S, { halo: 12 });
      cut(c, polyP([[-8, 8], [8, 8], [5, 4], [-5, 4]]), '#3d3448', null, { lw: 1.8 });
      c.beginPath(); for (const bx of [-7, 7]) { c.moveTo(bx, 8); c.lineTo(bx, 28); } stroke(c, 3, INK); c.beginPath(); for (const bx of [-7, 7]) { c.moveTo(bx, 8); c.lineTo(bx, 28); } stroke(c, 1.4, '#c9953b');
      cut(c, rectP(-9, 27, 18, 4), '#3d3448', null, { lw: 1.8 });
      c.restore();
    });
    addProp(mid, 640, 110, (c, x) => tent(c, x, G - 2, 150, 96, true));
    addLive(mid, 640, 80, (c, x, S) => glow(c, x, G - 24, 70, '255,160,80', (0.25 + 0.05 * Math.sin(S.t * 6)) * S.lightK));
    addProp(mid, 1500, 60, (c, x) => tent(c, x, G - 4, 110, 70, false));
    addProp(mid, 1960, 160, (c, x) => {
      for (let k = 0; k < 5; k++) rock(c, x - 120 + k * 55, G - 20 + (k % 2) * 6, 70 + (k % 3) * 20, 40 + (k % 2) * 30, 900 + k, P.rock, P.rockShade, P.rockHi);
    });
    mid.post = (c) => fadeRect(c, 0, G - 60, mid.P, G + 4, 'rgba(10,10,30,0)', 'rgba(10,10,30,0.4)');
    // ---------------- FLOOR : grass & dirt, campfire, logs, gear
    const flo = mkLayer(L, 'floor', 2560, 1.0, { y0: G - 150, y1: H });
    flo.base = (c) => {
      const Pp = flo.P;
      c.beginPath(); c.moveTo(0, H + 4); c.lineTo(0, G);
      for (let x = 0; x <= Pp; x += 5) { const xm = mod(x, Pp); c.lineTo(x, G - 2 + ridge(xm, Pp, 3, 50) - (xm % 20 < 6 ? 3 + hash(xm) * 4 : 0)); }
      c.lineTo(Pp, H + 4); c.closePath();
      c.fillStyle = P.ground; c.fill(); stroke(c, 2.5);
      fadeRect(c, 0, G, Pp, H, 'rgba(40,44,90,0.4)', 'rgba(5,5,15,0.4)');
      c.beginPath();
      for (let i = 0; i < 160; i++) { const gx = hash(i * 3.1) * Pp, gy = G + 6 + hash(i * 1.7) * (H - G - 10), gl = 3 + hash(i) * 5; c.moveTo(gx, gy); c.lineTo(gx - 1.5, gy - gl); c.moveTo(gx + 3, gy); c.lineTo(gx + 4, gy - gl * 0.8); }
      stroke(c, 1.4, 'rgba(70,80,140,0.45)');
      // dirt path toward the cave
      c.beginPath(); c.ellipse(560, G + 22, 380, 14, 0, 0, TAU); c.fillStyle = 'rgba(60,45,70,0.45)'; c.fill();
    };
    const fireX = 900;
    addProp(flo, fireX, 70, (c, x) => campfireStatic(c, x, G + 22));
    addProp(flo, fireX, 200, (c, x) => {
      for (const [dx, w, dy] of [[-150, 90, 22], [150, 100, 26]]) {
        cut(c, rrectP(x + dx - w / 2, G + dy - 16, w, 18, 9), P.wood, P.woodShade, { lw: 2.5, dx: 0, dy: -4, rim: P.woodHi });
        Art.ellipsePath(c, x + dx + w / 2 - 4, G + dy - 7, 6, 9); c.fillStyle = '#c08a5a'; c.fill(); stroke(c, 2);
        c.beginPath(); c.ellipse(x + dx + w / 2 - 4, G + dy - 7, 3, 5, 0, 0, TAU); stroke(c, 1.2);
      }
      // tripod with pot
      c.beginPath(); c.moveTo(x - 40, G + 26); c.lineTo(x, G - 74); c.lineTo(x + 40, G + 26); c.moveTo(x, G - 74); c.lineTo(x + 8, G + 30); stroke(c, 5, INK); stroke(c, 2.5, P.woodHi);
      c.beginPath(); c.moveTo(x, G - 72); c.lineTo(x, G - 46); stroke(c, 1.6);
      cut(c, (g) => { g.beginPath(); g.moveTo(x - 16, G - 46); g.lineTo(x + 16, G - 46); g.quadraticCurveTo(x + 18, G - 22, x, G - 22); g.quadraticCurveTo(x - 18, G - 22, x - 16, G - 46); g.closePath(); }, '#3d3448', '#28212f', { lw: 2.5, dx: -4, dy: -2, rim: '#675c7a' });
      c.beginPath(); c.arc(x, G - 46, 16, Math.PI, TAU); stroke(c, 1.5);
      // bedroll + pack
      cut(c, rrectP(x + 220, G + 18, 70, 18, 9), '#7a3a3a', '#542626', { lw: 2.5, dx: 0, dy: -4 });
      c.beginPath(); c.ellipse(x + 284, G + 27, 7, 9, 0, 0, TAU); c.fillStyle = '#9a5050'; c.fill(); stroke(c, 2);
      c.beginPath(); c.moveTo(x + 242, G + 18); c.lineTo(x + 242, G + 36); stroke(c, 2.5, '#3d2618');
      cut(c, rrectP(x - 290, G - 6, 40, 44, 10), '#6a5a3a', '#4a3e28', { lw: 2.5, dx: -6, dy: -3 });
      cut(c, rrectP(x - 286, G + 10, 32, 16, 5), '#7a6a48', '#5a4e34', { lw: 2, dx: 0, dy: -3 });
    });
    addLive(flo, fireX, 320, (c, x, S) => campfireLive(c, x, G + 22, S));
    addProp(flo, 1240, 120, (c, x) => tent(c, x, G + 30, 210, 140, true));
    addLive(flo, 1240, 90, (c, x, S) => glow(c, x, G, 90, '255,160,80', (0.24 + 0.05 * Math.sin(S.t * 5.3)) * S.lightK));
    addProp(flo, 420, 30, (c, x) => {
      c.beginPath(); c.moveTo(x, G + 30); c.lineTo(x, G - 110); c.lineTo(x + 22, G - 110); stroke(c, 6, INK); stroke(c, 3, P.woodHi);
    });
    addLive(flo, 420, 80, (c, x, S) => {
      const sway = Math.sin(S.t * 1.3 + 2) * 0.06;
      c.save(); c.translate(x + 20, G - 110); c.rotate(sway);
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 8); stroke(c, 2);
      flameLight(c, 0, 24, 5.5, 9, S, { halo: 12, poolY: 136, pool: 9 });
      cut(c, polyP([[-7, 8], [7, 8], [4, 4], [-4, 4]]), '#3d3448', null, { lw: 1.8 });
      c.beginPath(); for (const bx of [-6, 6]) { c.moveTo(bx, 8); c.lineTo(bx, 26); } stroke(c, 3, INK); c.beginPath(); for (const bx of [-6, 6]) { c.moveTo(bx, 8); c.lineTo(bx, 26); } stroke(c, 1.4, '#c9953b');
      cut(c, rectP(-8, 25, 16, 4), '#3d3448', null, { lw: 1.8 });
      c.restore();
    });
    L.atmos.push(fireflies);
    L.haze = null;
    L.fgTint = { col: '#05060f', rim: 'rgba(255,150,80,0.22)' };
  }
  function fireflies(ctx, L, S) {
    const W = S.W, G = L.G, t = S.t;
    for (let i = 0; i < 14; i++) {
      const x = mod(hash(i * 3.3) * W + Math.sin(t * 0.4 + i * 2) * 60 + Math.sin(t * 1.1 + i) * 14 - S.camX * 0.8, W + 40) - 20;
      const y = G - 30 - hash(i * 5.5) * 160 + Math.sin(t * 0.7 + i * 3) * 20;
      const a = Math.max(0, Math.sin(t * 1.6 + i * 2.3)) * 0.9;
      if (a < 0.05) continue;
      glow(ctx, x, y, 14, '200,255,140', a * 0.4);
      ctx.fillStyle = 'rgba(230,255,180,' + a.toFixed(2) + ')'; ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  // ======================================================================
  // ZONE: TITLE — staircase descending into the abyss toward a faint giant wheel (static composition)
  // ======================================================================
  function titleXf(L) { const s = L.H / 720; return { s, ox: (L.W - 1280 * s) / 2 }; }
  function titleStairs(c) {
    const VPY = 452, nb = 18;
    // stair geometry: edge k from bottom (k=0, y=720) to far end (k=nb, y=VPY)
    const edgeY = (k) => VPY + (720 - VPY) * Math.pow(1 - k / nb, 1.7);
    const halfW = (y) => 52 + (y - VPY) * 1.18;
    // side walls of the stairwell (balustrades) — converge toward the far end
    for (const s of [-1, 1]) {
      const inA = [640 + s * halfW(720), 720], inB = [640 + s * halfW(VPY), VPY];
      const topB = [640 + s * (halfW(VPY) + 8), VPY - 16], topA = [640 + s * (halfW(720) + 70), 720 - 120];
      cut(c, polyP([inA, inB, topB, topA, [topA[0], 724]]), '#1f1930', '#161125', { lw: 3, dx: s * 10, dy: 0 });
      // coping along the top of the balustrade
      cut(c, polyP([topB, topA, [topA[0] - s * 4, topA[1] + 16], [topB[0] - s * 1, topB[1] + 4]]), '#3a3058', '#2a2242', { lw: 2.5, dx: 0, dy: -2, rim: '#5a4c86' });
      // panel joints receding
      c.beginPath();
      for (let k = 1; k < 7; k++) { const q = Math.pow(k / 7, 1.6), px = lerp(inB[0], inA[0], q), py = lerp(inB[1], inA[1], q), tx = lerp(topB[0], topA[0], q), ty = lerp(topB[1], topA[1], q); c.moveTo(px, py); c.lineTo(tx, ty + 6 * q + 2); }
      stroke(c, 1.5, 'rgba(8,5,14,0.65)');
    }
    for (let k = 0; k < nb; k++) {
      const y0 = edgeY(k), y1 = edgeY(k + 1);
      const w0 = halfW(y0), w1 = halfW(y1);
      const tread = polyP([[640 - w0, y0], [640 + w0, y0], [640 + w1, y1], [640 - w1, y1]]);
      const shade = mix('#2c2542', '#0a0712', Math.pow(k / nb, 0.8));
      tread(c); c.fillStyle = shade; c.fill();
      // nosing (lit by the abyss glow from beyond)
      c.beginPath(); c.moveTo(640 - w1, y1); c.lineTo(640 + w1, y1);
      stroke(c, Math.max(1, 3 * (1 - k / nb)), INK);
      c.beginPath(); c.moveTo(640 - w1 + 2, y1 + 1.5); c.lineTo(640 + w1 - 2, y1 + 1.5);
      stroke(c, Math.max(0.8, 2 * (1 - k / nb)), 'rgba(255,150,90,' + (0.18 + 0.4 * (k / nb)).toFixed(2) + ')');
      if (k % 3 === 1) { c.beginPath(); c.moveTo(640 - w0 * 0.3, y0 - 2); c.lineTo(640 - w0 * 0.2, (y0 + y1) / 2); stroke(c, 1, 'rgba(10,6,16,0.5)'); }
    }
    return { VPY, edgeY, halfW, nb };
  }
  function titleWalls(c) {
    // massive carved walls framing the descent, converging toward the stair end
    for (const s of [-1, 1]) {
      const X = (x) => (s < 0 ? x : 1280 - x);
      const wall = [[X(-10), -10], [X(400), -10], [X(482), 150], [X(532), 420], [X(456), 600], [X(300), 730], [X(-10), 730]];
      cut(c, polyP(wall), '#1e1830', '#151024', { lw: 3, dx: s * -16, dy: 0, rim: '#2e2648' });
      c.save(); polyP(wall)(c); c.clip();
      // ashlar courses receding toward the vanishing point at the stair end (640,452)
      const VX = 640, VY = 452, yAt = (y0, x) => y0 + (VY - y0) * (x / VX);
      const courses = [];
      for (let k = -12; k <= 9; k++) courses.push(VY + k * Math.abs(k) * 7 + k * 26);
      c.beginPath();
      for (const y0 of courses) { c.moveTo(X(-10), yAt(y0, -10)); c.lineTo(X(600), yAt(y0, 600)); }
      for (let k = 0; k < courses.length - 1; k++) {
        for (let j = 0; j < 12; j++) {
          const x = VX * (1 - Math.pow(0.8, j + (k % 2) * 0.5)) - 20;
          c.moveTo(X(x), yAt(courses[k], x)); c.lineTo(X(x), yAt(courses[k + 1], x));
        }
      }
      stroke(c, 1.6, 'rgba(8,5,14,0.6)');
      c.beginPath();
      for (const y0 of courses) { c.moveTo(X(-10), yAt(y0, -10) + 2); c.lineTo(X(600), yAt(y0, 600) + 0.6); }
      stroke(c, 1, 'rgba(90,76,140,0.22)');
      // warm wash from the abyss near the stair end, cold darkness at the outer edge
      const gx0 = s < 0 ? 0 : 1280, gx1 = s < 0 ? 560 : 720;
      const gr = c.createLinearGradient(gx0, 0, gx1, 0);
      gr.addColorStop(0, 'rgba(6,4,12,0.45)'); gr.addColorStop(0.6, 'rgba(6,4,12,0)'); gr.addColorStop(1, 'rgba(255,110,60,0.14)');
      c.fillStyle = gr; c.fillRect(0, 0, 1280, 720);
      c.restore();
      // colossal column with capital
      const cx = X(330);
      cut(c, rectP(cx - 44, -10, 88, 640), '#2a2240', '#1a1530', { lw: 3, dx: s * -18, dy: 0, rim: '#43396a' });
      c.beginPath(); for (const fx of [-26, -10, 6, 22]) { c.moveTo(cx + fx, 110); c.lineTo(cx + fx, 600); } stroke(c, 1.6, 'rgba(8,5,14,0.55)');
      cut(c, rectP(cx - 60, 80, 120, 26), '#2e2646', '#1d1730', { lw: 3, dx: -3, dy: -4, rim: '#4a4070' });
      cut(c, rectP(cx - 62, 600, 124, 34), '#2e2646', '#1d1730', { lw: 3, dx: -3, dy: -4, rim: '#4a4070' });
      // tattered banner of the Emberwheel
      const bn = [[cx - 34, 104], [cx + 34, 104], [cx + 34, 300], [cx + 22, 318], [cx + 12, 300], [cx, 336], [cx - 12, 302], [cx - 24, 322], [cx - 34, 300]];
      cut(c, polyP(bn), '#6a1f2e', '#45131f', { lw: 3, dx: s * -10, dy: 0, rim: '#8e3040' });
      c.beginPath(); c.moveTo(cx - 34, 116); c.lineTo(cx + 34, 116); stroke(c, 1.5, 'rgba(10,4,8,0.6)');
      cut(c, rectP(cx - 42, 98, 84, 9), '#7a5520', '#4a3214', { lw: 2.5, dx: 0, dy: -2, rim: '#c9953b' });
      const ey = 196;
      Art.circlePath(c, cx, ey, 22); stroke(c, 4.5, INK); stroke(c, 2.5, '#c9953b');
      c.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; c.moveTo(cx, ey); c.lineTo(cx + Math.cos(a) * 22, ey + Math.sin(a) * 22); } stroke(c, 3.5, INK); stroke(c, 1.8, '#c9953b');
      Art.circlePath(c, cx, ey, 6); c.fillStyle = '#ff8a3d'; c.fill(); stroke(c, 2);
      c.beginPath(); c.moveTo(cx - 20, 250); c.lineTo(cx + 20, 250); c.moveTo(cx - 14, 262); c.lineTo(cx + 14, 262); stroke(c, 2, 'rgba(201,149,59,0.6)');
      // candle niches climbing down along the wall
      for (let k = 0; k < 3; k++) {
        const nx = X(470 - k * 50), ny = 250 + k * 110, nw = 34 - k * 2, nh = 46;
        c.beginPath(); roundArch(c, nx - nw / 2, nx + nw / 2, ny - nh + nw / 2, ny); c.fillStyle = '#0a0712'; c.fill(); stroke(c, 2.5);
      }
    }
    // ceiling rock with stalactites + chains
    const ceil = [[-10, -10], [1290, -10], [1290, 60]];
    for (let k = 26; k >= 0; k--) { const x = (k / 26) * 1280, d = 40 + hash(k * 4.3) * 50 + (k % 4 === 0 ? 60 : 0); ceil.push([x + 24, d * 0.4 + 20], [x, d + 20]); }
    ceil.push([-10, 60]);
    cut(c, polyP(ceil), '#130e20', '#0c0916', { lw: 3, dx: 0, dy: -6, rim: '#241c38' });
  }
  function buildTitle(L) {
    const xf = titleXf(L);
    const front = mkLayer(L, 'front', L.W, 0, { wrap: false, y0: 0, y1: L.H });
    front.base = (c) => {
      c.save(); c.translate(xf.ox, 0); c.scale(xf.s, xf.s);
      titleWalls(c);
      titleStairs(c);
      for (const [x, len] of [[520, 150], [770, 120], [880, 190], [420, 90]]) chainAlong(c, [[x, -10], [x + 4, len]], 11, '#100c18', '#2e2442', 2.2);
      c.restore();
    };
    // candles flanking the stairs (bodies cached in the front layer, flames live)
    const cands = [];
    for (let k = 0; k < 6; k++) {
      const kk = k * 3 + 1, VPY = 452, nb = 18;
      const y = VPY + (720 - VPY) * Math.pow(1 - kk / nb, 1.7);
      const hw = 52 + (y - VPY) * 1.18, sc = 0.45 + ((y - VPY) / (720 - VPY)) * 1.1;
      for (const s of [-1, 1]) cands.push({ x: 640 + s * (hw + 18 * sc), y: y - 6 * sc, sc, seed: k * 2 + (s > 0 ? 1 : 0) });
    }
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) cands.push({ x: s < 0 ? 470 - k * 50 : 1280 - (470 - k * 50), y: 250 + k * 110 - 3, sc: 1.0 - k * 0.05, seed: 40 + k * 2 + (s > 0 ? 1 : 0) });
    addProp(front, 0, 99999, (c) => {
      c.save(); c.translate(xf.ox, 0); c.scale(xf.s, xf.s);
      for (const cd of cands) drawCluster(c, makeCluster(cd.seed + 60, cd.sc > 1 ? 3 : 2, cd.sc, 10), cd.x, cd.y, WAX_TITLE);
      c.restore();
    });
    L.titleCands = cands.map((cd) => ({ x: cd.x, y: cd.y, cl: makeCluster(cd.seed + 60, cd.sc > 1 ? 3 : 2, cd.sc, 10) }));
    front.pre = (ctx, L2, S) => {
      ctx.save(); ctx.translate(xf.ox, 0); ctx.scale(xf.s, xf.s);
      const pulse = 0.85 + 0.15 * Math.sin(S.t * 0.8);
      glow(ctx, 640, 470, 520, '255,110,50', 0.3 * pulse);
      glow(ctx, 640, 500, 300, '255,140,70', 0.22 * pulse, 0.7);
      drawWheel(ctx, 640, 452, 262, S.t * 0.06, 'title', { base: '#2a1a24', hole: '#0c0610', rune: 'rgba(255,170,90,0.9)', crack: 'rgba(255,140,70,0.6)', line: 'rgba(255,120,60,0.35)' }, S, 0.95);
      ctx.save(); Art.circlePath(ctx, 640, 452, 247); ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(255,120,60,' + (0.16 * pulse).toFixed(3) + ')'; ctx.stroke(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,190,110,' + (0.25 * pulse).toFixed(3) + ')'; ctx.stroke(); ctx.restore();
      glow(ctx, 640, 452, 120, '255,170,90', 0.3 * pulse);
      ctx.restore();
    };
    front.after = (ctx, L2, S) => {
      ctx.save(); ctx.translate(xf.ox, 0); ctx.scale(xf.s, xf.s);
      for (const cd of L2.titleCands) for (const f of cd.cl.flames) flameLight(ctx, cd.x + f.ox, cd.y + f.oy, f.s, f.seed, S, { halo: 9 });
      // fog pooling at the stair end
      for (let i = 0; i < 6; i++) {
        const x = 640 + Math.sin(S.t * 0.15 + i * 1.7) * 160 + (i - 2.5) * 50;
        puff(ctx, x, 455 + (i % 2) * 10, 150, '90,70,120', 0.12, 0.25);
      }
      // embers rising out of the abyss
      for (let i = 0; i < 30; i++) {
        const per = 4 + hash(i * 2.7) * 4, ph = frac(S.t / per + hash(i * 4.3));
        const px = 640 + (hash(i * 6.1) - 0.5) * 520 + Math.sin(ph * 6 + i) * 18, py = 560 - ph * 520;
        const a = (1 - ph) * Math.min(1, ph * 5);
        ctx.fillStyle = 'rgba(255,' + (120 + Math.floor(hash(i) * 100)) + ',60,' + (a * 0.85).toFixed(2) + ')';
        ctx.fillRect(px, py, 2.4, 2.4);
      }
      ctx.restore();
    };
    L.haze = null;
    L.fgTint = { col: '#06040b', rim: 'rgba(255,120,60,0.25)' };
  }

  // ============================================================ shared fg builders
  function buildHangers(L, P, items) {
    const fg = mkLayer(L, 'fgHang', P, 1.35, { fg: true, y0: 0, y1: 170 });
    items.forEach((it, i) => addLive(fg, it.x, 60, (c, x, S) => hanger(c, x, it, S, i, L)));
  }
  function buildRubble(L, P, cols, rim) {
    const fg = mkLayer(L, 'fgLow', P, 1.35, { fg: true, y0: L.H - 34, y1: L.H });
    for (let i = 0; i < 7; i++) {
      const x0 = (i + hash(i * 3.3) * 0.6) * (P / 7), w = 50 + hash(i * 1.9) * 70, h = 10 + hash(i * 7.3) * 12;
      addProp(fg, x0, w, (c, x) => {
        rock(c, x, L.H + 6, w, h + 6, 1000 + i, cols[0], cols[1], rim, 2.5);
        rock(c, x + w * 0.4, L.H + 6, w * 0.5, h * 0.7 + 4, 1100 + i, cols[1], cols[0], rim, 2.5);
      });
    }
  }
  // dark foreground silhouette with a thin back-lit rim on its lower-right edges
  function sil2(c, pts, tint, ten) {
    cut(c, ten == null ? polyP(pts) : blobP(pts, ten), tint.col, null, { lw: 3, rim: tint.rim, rimW: 2, rimD: -2 });
  }
  function hanger(c, x, it, S, i, L) {
    const tint = L.fgTint || { col: '#0a0710', rim: 'rgba(255,150,80,0.3)' };
    const sway = Math.sin(S.t * (0.7 + i * 0.13) + i * 2) * 0.05 + Math.sin(S.camX * 0.003 + i) * 0.02;
    const len = it.len;
    if (it.kind === 'chain' || it.kind === 'hook' || it.kind === 'shackle' || it.kind === 'cagechain') {
      const pts = hangPts(x, -6, len, sway, 6);
      chainAlong(c, pts, 12, tint.col, mix(tint.col, '#ffffff', 0.12), 2.8);
      const [ex, ey] = pts[pts.length - 1];
      c.save(); c.translate(ex, ey); c.rotate(-sway);
      if (it.kind === 'hook') {
        c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 14); c.arc(-8, 14, 8, 0, Math.PI * 0.95); stroke(c, 7.5, INK); stroke(c, 4, tint.col);
        c.beginPath(); c.arc(-8, 14, 8, 0.1, Math.PI * 0.6); stroke(c, 1.5, tint.rim);
      } else if (it.kind === 'shackle') {
        c.beginPath(); c.arc(0, 12, 11, Math.PI * 1.15, Math.PI * 1.85, true); stroke(c, 8, INK); stroke(c, 4.5, tint.col);
        cut(c, rectP(-14, 10, 28, 8), tint.col, null, { lw: 2.5 });
        c.beginPath(); c.moveTo(-12, 18); c.lineTo(12, 18); stroke(c, 1.5, tint.rim);
      } else if (it.kind === 'cagechain') {
        cut(c, polyP([[-12, 0], [12, 0], [16, 8], [-16, 8]]), tint.col, null, { lw: 2.5 });
        c.beginPath(); for (const bx of [-14, -5, 5, 14]) { c.moveTo(bx, 8); c.quadraticCurveTo(bx * 1.2, 26, bx * 0.8, 44); } stroke(c, 5, INK); c.beginPath(); for (const bx of [-14, -5, 5, 14]) { c.moveTo(bx, 8); c.quadraticCurveTo(bx * 1.2, 26, bx * 0.8, 44); } stroke(c, 2.5, tint.col);
        cut(c, ellP(0, 45, 13, 4), tint.col, null, { lw: 2.5 });
        skull(c, 0, 42, 7, '#3a3a40', '#26262c', '#050508');
      } else {
        Art.circlePath(c, 0, 4, 5); stroke(c, 6, INK); stroke(c, 3, tint.col);
      }
      c.restore();
    } else if (it.kind === 'roots') {
      for (let k = 0; k < 6; k++) {
        const ln = len * (0.4 + hash(i * 3 + k) * 0.75), ox = (k - 2.5) * 9 + (hash(k * 5.5) - 0.5) * 6;
        const pts = [];
        for (let j = 0; j <= 6; j++) { const s = j / 6; pts.push([x + ox + Math.sin(sway * 1.6 + k) * ln * 0.2 * s * s + Math.sin(s * 4 + k * 1.3) * 3, 2 + ln * s]); }
        const w0 = 4.6 - k * 0.45;
        Art.curvePath(c, pts); stroke(c, w0 * 0.45 + 2.4, INK); Art.curvePath(c, pts); stroke(c, w0 * 0.45, tint.col);
        Art.curvePath(c, pts.slice(0, 4)); stroke(c, w0 + 2.6, INK); Art.curvePath(c, pts.slice(0, 4)); stroke(c, w0, tint.col);
        const [rx, ry] = pts[3];
        c.beginPath(); c.moveTo(rx, ry); c.quadraticCurveTo(rx + (k % 2 ? 7 : -7), ry + 4, rx + (k % 2 ? 9 : -9), ry + 12); stroke(c, 3, INK); stroke(c, 1.2, tint.col);
      }
      sil2(c, [[x - 40, -10], [x + 40, -10], [x + 36, 4], [x + 22, 10], [x + 10, 6], [x - 2, 13], [x - 16, 7], [x - 30, 9]], tint);
    } else if (it.kind === 'herbs') {
      const pts = hangPts(x, -6, len * 0.55, sway, 3);
      Art.curvePath(c, pts); stroke(c, 1.6, '#3a2a2a');
      const [ex, ey] = pts[pts.length - 1];
      c.save(); c.translate(ex, ey); c.rotate(-sway * 1.5);
      for (let k = 0; k < 7; k++) {
        const a = (k - 3) * 0.16, l = 24 + (k % 3) * 8;
        c.save(); c.rotate(a);
        cut(c, ellP(0, l * 0.55, 4.5, l * 0.5), '#1a2218', null, { lw: 2 });
        c.restore();
      }
      cut(c, rectP(-6, -2, 12, 6), '#3a2418', null, { lw: 2 });
      c.restore();
    } else if (it.kind === 'pipe') {
      pipeV(c, x, -10, len, 10, [tint.col, INK, 'rgba(255,140,80,0.25)'], [len - 30]);
      elbow(c, x + 22, len, 10, [tint.col, INK, ''], Math.PI / 2);
      const ph = frac(S.t * 0.5 + i * 0.3);
      if (ph < 0.6) { c.beginPath(); c.ellipse(x + 2, len + 14 + ph * 50, 2, 3, 0, 0, TAU); c.fillStyle = 'rgba(200,150,120,' + (0.6 * (1 - ph)).toFixed(2) + ')'; c.fill(); }
    }
  }

  // static corner silhouettes per zone (cached), drawn in drawForeground
  function paintCorners(c, L) {
    const W = L.W, H = L.H, z = L.zone, tint = L.fgTint || { col: '#0a0710', rim: 'rgba(255,150,80,0.3)' };
    const col = tint.col, rim = tint.rim;
    const sil = (pts, ten) => { cut(c, ten == null ? polyP(pts) : blobP(pts, ten), col, null, { lw: 3, rim, rimW: 2, rimD: -2 }); };
    if (z === 'cellar') {
      // heavy beam brace (top-left) + cobweb, arch fragment (top-right)
      sil([[-10, -10], [210, -10], [210, 14], [36, 14], [26, 90], [-10, 150]]);
      c.beginPath(); c.moveTo(14, 100); c.lineTo(150, -6); stroke(c, 16, INK); stroke(c, 11, col);
      c.beginPath(); c.moveTo(18, 92); c.lineTo(146, -10); stroke(c, 1.6, rim);
      cobweb(c, 36, 14, 60, 1, 'rgba(200,190,210,0.22)');
      c.save(); c.beginPath(); c.moveTo(W + 10, -10); c.lineTo(W - 240, -10); c.quadraticCurveTo(W - 120, 10, W - 40, 110); c.lineTo(W + 10, 150); c.closePath();
      c.fillStyle = col; c.fill(); stroke(c, 3); c.restore();
      c.beginPath(); c.moveTo(W - 236, -6); c.quadraticCurveTo(W - 118, 14, W - 38, 112); stroke(c, 2, rim);
      c.beginPath(); for (let k = 1; k < 6; k++) { const tt = k / 6, bx = (1 - tt) * (1 - tt) * (W - 240) + 2 * (1 - tt) * tt * (W - 120) + tt * tt * (W - 40), by = 2 * (1 - tt) * tt * 10 + tt * tt * 110; c.moveTo(bx, by); c.lineTo(bx + 30, by - 20); } stroke(c, 2);
    } else if (z === 'ossuary') {
      sil([[-10, -10], [260, -10], [220, 20], [150, 36], [96, 64], [60, 110], [30, 170], [-10, 190]], 0.6);
      sil([[W + 10, -10], [W - 220, -10], [W - 170, 26], [W - 90, 44], [W - 40, 90], [W + 10, 130]], 0.6);
      for (const [x, l] of [[140, 46], [176, 30], [W - 120, 54], [W - 150, 34], [70, 60]]) cut(c, polyP([[x - 7, 20], [x + 7, 20], [x, 20 + l]]), col, null, { lw: 2.5, rim, rimW: 1.5, rimD: -1.5 });
    } else if (z === 'gearworks') {
      pipeV(c, 40, -10, 180, 18, [col, INK, 'rgba(255,120,60,0.3)'], [60, 140]);
      pipeH(c, -10, 200, 30, 14, [col, INK, 'rgba(255,120,60,0.3)'], 60, 30);
      valveWheel(c, 40, 100, 20, mix(col, '#c0392b', 0.4));
      pipeV(c, W - 30, -10, 140, 14, [col, INK, 'rgba(255,120,60,0.3)'], [50]);
      pipeH(c, W - 260, W + 10, 54, 12, [col, INK, 'rgba(255,120,60,0.3)'], 80, 20);
    } else if (z === 'abyss') {
      sil([[-10, -10], [300, -10], [240, 18], [200, 10], [150, 46], [110, 40], [70, 96], [40, 90], [16, 150], [-10, 170]]);
      sil([[W + 10, -10], [W - 280, -10], [W - 230, 20], [W - 180, 14], [W - 130, 54], [W - 80, 48], [W - 40, 110], [W + 10, 140]]);
    } else if (z === 'camp') {
      // drooping pine boughs with fan-shaped needle tufts
      const tuft = (px, py, sz, dir, seed) => {
        const r = rnd(seed), pts = [[px - dir * sz * 0.25, py - sz * 0.15]];
        const n = 9;
        for (let k = 0; k <= n; k++) {
          const a = Math.PI * (0.12 + (k / n) * 0.62), rr = (k % 2 ? 0.55 : 1) * sz * (0.85 + r() * 0.3);
          pts.push([px + dir * Math.cos(a) * rr, py + Math.sin(a) * rr]);
        }
        pts.push([px - dir * sz * 0.1, py + sz * 0.1]);
        cut(c, polyP(pts), col, null, { lw: 2, rim: 'rgba(130,150,230,0.22)', rimW: 1.5, rimD: -1.5 });
      };
      const bough = (x0, y0, dir, len, droop, n, seed) => {
        const pts = [];
        for (let j = 0; j <= 8; j++) { const s = j / 8; pts.push([x0 + dir * len * s, y0 + droop * s * s + Math.sin(s * 3 + seed) * 4]); }
        for (let k = n; k >= 1; k--) {
          const s = k / (n + 0.5), px = x0 + dir * len * s, py = y0 + droop * s * s;
          tuft(px, py + 2, 30 - k * 1.5, dir, seed * 10 + k);
        }
        Art.curvePath(c, pts); stroke(c, 9 - (seed % 2) * 2, INK); Art.curvePath(c, pts); stroke(c, 5.5 - (seed % 2) * 2, '#1a1424');
      };
      bough(-20, 8, 1, 300, 70, 8, 1);
      bough(-20, 70, 1, 170, 50, 5, 2);
      bough(W + 20, -4, -1, 260, 80, 7, 3);
    } else if (z === 'title') {
      sil([[-10, -10], [380, -10], [300, 40], [200, 60], [140, 120], [80, 140], [40, 220], [-10, 260]], 0.7);
      sil([[W + 10, -10], [W - 380, -10], [W - 300, 40], [W - 200, 60], [W - 140, 120], [W - 80, 140], [W - 40, 220], [W + 10, 260]], 0.7);
    }
  }
  function paintVignette(c, L) {
    const W = L.W, H = L.H;
    c.save();
    c.translate(W / 2, H * 0.5);
    c.scale(1, Math.max(0.35, H / W) * 1.15);
    const g = c.createRadialGradient(0, 0, W * 0.38, 0, 0, W * 0.74);
    g.addColorStop(0, 'rgba(6,4,12,0)');
    g.addColorStop(0.6, 'rgba(6,4,12,0.32)');
    g.addColorStop(1, 'rgba(6,4,12,0.78)');
    c.fillStyle = g;
    c.fillRect(-W, -W, W * 2, W * 2);
    c.restore();
    fadeRect(c, 0, 0, W, Math.min(90, H * 0.2), 'rgba(6,4,12,0.45)', 'rgba(6,4,12,0)');
  }

  // overlays drawn at the end of the background: top darkness, actor-band haze, depth darkening
  function paintShade(ctx, L, S) {
    const W = S.W, H = L.H, G = L.G;
    if (L.zone !== 'title' && L.zone !== 'camp') {
      fadeRect(ctx, 0, 0, W, Math.min(170, G * 0.46), 'rgba(6,3,10,0.6)', 'rgba(6,3,10,0)');
      fadeRect(ctx, 0, G + 24, W, H, 'rgba(6,3,10,0)', 'rgba(6,3,10,0.35)');
    }
    if (L.haze) {
      const hz = L.haze, g = ctx.createLinearGradient(0, G - 190, 0, G + 4);
      g.addColorStop(0, rgba(hz[0], 0)); g.addColorStop(0.45, rgba(hz[0], hz[1])); g.addColorStop(1, rgba(hz[0], hz[1] * 0.5));
      ctx.fillStyle = g; ctx.fillRect(0, G - 190, W, 194);
    }
    if (S.depth > 0) {
      ctx.fillStyle = 'rgba(10,12,34,' + (0.3 * S.depth).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ============================================================ backdrops (static, cached)
  function bdCellar(c, L) {
    const W = L.W, H = L.H, G = L.G;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0710'); g.addColorStop(G / H * 0.6, '#1f1320'); g.addColorStop(G / H, '#33202a'); g.addColorStop(1, '#1a1016');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  function bdOssuary(c, L) {
    const W = L.W, H = L.H, G = L.G;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#04080c'); g.addColorStop(G / H * 0.6, '#0c1a22'); g.addColorStop(G / H, '#16303a'); g.addColorStop(1, '#07141a');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  function bdGearworks(c, L) {
    const W = L.W, H = L.H, G = L.G;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#08050a'); g.addColorStop(G / H * 0.55, '#1a0e10'); g.addColorStop(G / H, '#3a190f'); g.addColorStop(1, '#1a0806');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) glow(c, (i + 0.5) * (W / 4), G - 20, 260, '255,90,40', 0.08);
  }
  function bdAbyss(c, L) {
    const W = L.W, H = L.H, G = L.G;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#040209'); g.addColorStop(G / H * 0.6, '#100a1a'); g.addColorStop(G / H, '#2a1428'); g.addColorStop(1, '#0a0610');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    glow(c, W / 2, G + 40, W * 0.6, '255,80,50', 0.1, 0.35);
    for (let i = 0; i < 90; i++) { c.fillStyle = 'rgba(255,140,90,' + (0.1 + hash(i * 3.1) * 0.25).toFixed(2) + ')'; c.fillRect(hash(i * 1.3) * W, hash(i * 7.7) * G * 0.9, 1.5, 1.5); }
  }
  function bdCamp(c, L) {
    const W = L.W, H = L.H, G = L.G;
    const g = c.createLinearGradient(0, 0, 0, G);
    g.addColorStop(0, '#05071c'); g.addColorStop(0.55, '#10153c'); g.addColorStop(1, '#2d2b60');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // milky way band
    for (let i = 0; i < 12; i++) puff(c, W * 0.05 + i * W * 0.085, G * 0.12 + i * G * 0.035, 120, '130,120,210', 0.05, 0.5);
    for (let i = 0; i < 260; i++) {
      const band = i < 120, x = hash(i * 3.7) * W;
      const y = band ? G * 0.12 + (x / W) * G * 0.4 + (hash(i * 5.1) - 0.5) * 90 : hash(i * 9.3) * G * 0.85;
      const s = 0.6 + hash(i * 2.9) * (band ? 1 : 1.6);
      c.fillStyle = 'rgba(255,246,216,' + (0.25 + hash(i * 6.6) * 0.65).toFixed(2) + ')';
      c.fillRect(x, y, s, s);
    }
    // crescent moon
    const mx = W * 0.82, my = Math.max(60, G * 0.18), mr = 30;
    glow(c, mx, my, 160, '200,200,255', 0.16);
    c.save();
    c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.arc(mx + 13, my - 7, mr * 0.9, 0, TAU, true);
    c.fillStyle = '#f6ecd0'; c.fill('evenodd');
    c.restore();
    c.beginPath(); c.arc(mx, my, mr, Math.PI * 0.35, Math.PI * 1.55); stroke(c, 2, 'rgba(26,18,34,0.6)');
    glow(c, W * 0.5, G, W * 0.55, '120,90,170', 0.12, 0.3);
  }
  function bdTitle(c, L) {
    const W = L.W, H = L.H;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#050309'); g.addColorStop(0.5, '#120c1e'); g.addColorStop(0.7, '#2a1222'); g.addColorStop(1, '#0a0610');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) { c.fillStyle = 'rgba(255,150,100,' + (0.08 + hash(i * 3.1) * 0.2).toFixed(2) + ')'; c.fillRect(hash(i * 1.3) * W, H * 0.3 + hash(i * 7.7) * H * 0.5, 1.5, 1.5); }
  }

  // ============================================================ zone registry
  const battleGround = (W, H) => Math.round(Math.max(H * 0.6, H - 72));
  const ZONES = {
    cellar: { ground: battleGround, build: buildCellar, backdrop: bdCellar },
    ossuary: { ground: battleGround, build: buildOssuary, backdrop: bdOssuary },
    gearworks: { ground: battleGround, build: buildGearworks, backdrop: bdGearworks },
    abyss: { ground: battleGround, build: buildAbyss, backdrop: bdAbyss },
    camp: { ground: (W, H) => Math.round(H * 0.84), build: buildCamp, backdrop: bdCamp },
    title: { ground: (W, H) => Math.round(H * 0.8), build: buildTitle, backdrop: bdTitle },
  };
  Art.BG_ZONES = Object.keys(ZONES);

  function sceneState(L, opts, ctx, C) {
    const t = +opts.t || 0, camX = +opts.camX || 0, depth = clamp01(+opts.depth || 0);
    return { t, camX, depth, W: L.W, H: L.H, G: L.G, lightK: 1 - depth * 0.22, scale: C ? C.s : 1 };
  }

  /** Draw the full scene backdrop (behind actors). */
  Art.drawBackground = function (ctx, zone, opts) {
    opts = opts || {};
    const L = getLayout(zone, opts.W || 1280, opts.H || 440);
    const C = getCache(L, ctx);
    const S = sceneState(L, opts, ctx, C);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, L.W, L.H); ctx.clip();
    if (C && C.backdrop) ctx.drawImage(C.backdrop, 0, 0, L.W, L.H); else L.def.backdrop(ctx, L);
    if (L.liveBack) L.liveBack(ctx, L, S);
    for (const ly of L.layers) {
      if (ly.pre) ly.pre(ctx, L, S, C);
      drawLayer(ctx, L, ly, S, C);
      if (ly.live.length) eachLive(ly, S, ly.live, (it, x) => it.draw(ctx, x, S));
      if (ly.after) ly.after(ctx, L, S, C);
    }
    for (const fn of L.atmos) fn(ctx, L, S);
    paintShade(ctx, L, S);
    ctx.restore();
  };

  /** Draw sparse foreground silhouettes (top corners, hanging bits, low rubble) + vignette over the scene. */
  Art.drawForeground = function (ctx, zone, opts) {
    opts = opts || {};
    const L = getLayout(zone, opts.W || 1280, opts.H || 440);
    const C = getCache(L, ctx);
    const S = sceneState(L, opts, ctx, C);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, L.W, L.H); ctx.clip();
    for (const ly of L.fgLayers) {
      if (ly.props.length) drawLayer(ctx, L, ly, S, C);
      if (ly.live.length) eachLive(ly, S, ly.live, (it, x) => it.draw(ctx, x, S));
    }
    if (L.fgGear) {
      drawGear(ctx, L.W - 40, -30, 110, 16, -S.t * 0.12, { base: '#140d10', hole: '#07040a', hub: '#1c1216', rim: 'rgba(255,120,60,0.3)' }, S);
    }
    if (C) {
      if (C.corners === undefined) C.corners = C.mk(L.W, L.H, 0, (g) => paintCorners(g, L));
      if (C.vignette === undefined) C.vignette = C.mk(L.W, L.H, 0, (g) => paintVignette(g, L));
    }
    if (C && C.corners) ctx.drawImage(C.corners, 0, 0, L.W, L.H); else paintCorners(ctx, L);
    if (C && C.vignette) ctx.drawImage(C.vignette, 0, 0, L.W, L.H); else paintVignette(ctx, L);
    if (S.depth > 0) { ctx.fillStyle = 'rgba(8,8,26,' + (0.12 * S.depth).toFixed(3) + ')'; ctx.fillRect(0, 0, L.W, L.H); }
    ctx.restore();
  };

  /** Optional: pre-build caches for a zone (e.g. during a fade) so the first frame does not hitch. */
  Art.warmBackground = function (ctx, zone, opts) {
    opts = opts || {};
    const L = getLayout(zone, opts.W || 1280, opts.H || 440);
    getCache(L, ctx);
  };
})();
