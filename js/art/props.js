/* EMBERWHEEL — relic & event props ("Candlelit Paper Theater").
 *   SD.Art.drawRelic(ctx, id, cx, cy, size, opts)       ids: whetstone flint holywater buckler hourglass catbell twinring
 *                                                             fang candelabra mirror ironheart bonedie stardust hatwax
 *        opts: { t, glow 0..1, dim 0..1, alpha 0..1 }    size = glyph box; reads at 26-30px, detailed from ~44px up
 *   SD.Art.relicCanvas(id, size, res?)   -> cached <canvas> (size*res px, CSS size = size px) or null without a DOM
 *   SD.Art.drawEventProp(ctx, id, cx, cy, size, opts)   ids: blood_altar cursed_chest fate_offering ghost_carver mimic_chest campfire
 *        opts: { t, alpha 0..1 }   size ≈ 120 (box); the prop stands on its own ground shadow near the bottom of the box
 *   SD.Art.eventCanvas(id, size, res?)   -> cached <canvas> (rendered at t = 0) or null without a DOM
 *   SD.Art.drawChiselIcon(ctx, cx, cy, size)           carving chisel striking a stone chip (icon style)
 *   SD.Art.drawStairs(ctx, cx, cy, w, h, t, opts)     arched opening, stairs descending into warm light. opts{ hover 0..1 }
 *                                                       same footprint as Art.drawDoor (cx,cy = centre, ~116x150)
 *   SD.Art.RELIC_IDS, SD.Art.EVENT_PROP_IDS, SD.Art.RELIC_COLORS { id: '#hex' }
 * Everything is authored in a 100x100 design box centred on (0,0) and scaled to `size`.
 * Static relic layers are cached per (id, size, pixel-scale) on lazily created offscreen canvases with a paper-cut drop
 * shadow; flames / sparkles / glows are drawn live on top. Without a DOM everything is drawn directly (no shadow).
 * relicCanvas / eventCanvas: res defaults to max(devicePixelRatio, SD.Game.renderScale) (rounded up to 0.5, 1..4). If the
 * cached element is already attached to the document a cheap copy is returned, so the same relic can sit in two places.
 */
(function () {
  'use strict';
  const SD = (globalThis.SD = globalThis.SD || {});
  const Art = (SD.Art = SD.Art || {});
  const PAL = Art.PAL || {};
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const c01 = (v) => clamp(+v || 0, 0, 1);
  const num = (v) => (v === true ? 1 : c01(v));
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // local tones extending the shared palette
  const C = {
    shadow: 'rgba(6,4,14,0.5)',
    wood: '#9c5d31', woodShade: '#6b3b1d', woodDeep: '#3e2414', woodLine: '#4a2a16',
    post: '#6e3e22', postShade: '#47260f',
    oak: '#b27a44', oakShade: '#7a4c26', oakLine: '#5a3519',
    iron: '#6a6680', ironShade: '#423f54', ironLight: '#a29eb6', ironDark: '#2e2a38',
    steel: '#cfd8e8', steelLine: '#6d7a96', forge: '#8b88a2', forgeShade: '#55526a',
    whetTop: '#cdd3de', whetFine: '#9ea6b7', whetFineSh: '#737b8f', whetCoarse: '#686d82', whetCoarseSh: '#454a5d',
    flintCore: '#4a4f6a', flintShade: '#2d3045', flintFacet: '#727896', flintFacet2: '#5b6182', cortex: '#ddd0b4', cortexShade: '#b0a07e',
    glass: '#55798a', glassShade: '#3d5a68', glassLip: '#9cc0cc', healShade: '#3dbb86', healCore: '#c4ffe2',
    cork: '#c08a52', corkShade: '#86592f',
    hgGlass: '#d9e0f0', hgGlassShade: '#a4aecb', sand: '#ffc867', sandShade: '#df933a',
    cat: '#2e2645', catShade: '#1c162b', catRim: 'rgba(176,156,236,0.9)', catEar: '#7a4778', catEye: '#ffd257',
    collar: '#e0453f',
    gold: '#f2c14e', goldShade: '#b07c26', goldLight: '#fff0b0',
    silver: '#cdd5e4', silverShade: '#7f8aa4',
    ruby: '#e0435a', rubyShade: '#97223a', sapphire: '#4fb4f0', sapphireShade: '#2a6fb0',
    cord: '#7a3a28', blood: '#e8344a', bloodShade: '#a3172d', bloodDark: '#6e0f1f',
    wax: '#f4e9d4', waxShade: '#cdb98f',
    lacquer: '#55358a', lacquerShade: '#33205a', mirror: '#d3def8', mirrorShade: '#93a7d6', shardHole: '#21182f',
    heartIron: '#87859d', heartIronShade: '#55536b', heartBand: '#a9a7bf',
    boneTop: '#fbf4e2', boneLeft: '#e8d6b4', boneRight: '#bea883', pip: '#3a2630', pipRed: '#d8283a',
    night: '#323a9a', nightShade: '#1f2466', vialGlass: '#4b5689', vialGlassShade: '#353d6b', vialLip: '#8a95cf',
    hatWax: '#9c76d2', hatWaxShade: '#6c4aa4', hatBand: '#ffc15e',
    stone: '#5a5188', stoneSh: '#3c3566', slab: '#6c64a0', slabSh: '#4a4278',
  };

  // ---------------------------------------------------------------- path helpers (sub-paths, no beginPath)
  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function circ(c, x, y, r) { c.moveTo(x + Math.max(0.01, r), y); c.arc(x, y, Math.max(0.01, r), 0, TAU); c.closePath(); }
  function ell(c, x, y, rx, ry, rot) { rot = rot || 0; c.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); c.closePath(); }
  function poly(c, pts) { c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); }
  function roundPoly(c, pts, r) {
    const n = pts.length, a = pts[n - 1], b = pts[0];
    c.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; c.arcTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, r); }
    c.closePath();
  }
  const P = (fn) => (c) => { c.beginPath(); fn(c); };
  // house-style shape: base + crescent shade + ink (light from the upper-left)
  function sh(c, path, base, shade, lw, o) {
    o = o || {};
    Art.shape(c, path, base, shade, { lw: lw == null ? Art.LW : lw, dx: o.dx == null ? -6 : o.dx, dy: o.dy == null ? -6 : o.dy, hi: o.hi });
  }
  function fill(c, color) { c.fillStyle = color; c.fill(); }
  function stroke(c, lw, color) { Art.strokeOnly(c, lw, color || PAL.ink); }
  function line(c, x0, y0, x1, y1, lw, color) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); stroke(c, lw, color); }
  // thick stroked band with an ink border (rings, cords, arms)
  function band(c, build, color, w, lw) {
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath(); build(c); c.lineWidth = w + lw * 2; c.strokeStyle = PAL.ink; c.stroke();
    c.beginPath(); build(c); c.lineWidth = w; c.strokeStyle = color; c.stroke();
    c.restore();
  }
  // light rim along the upper-left inner edge of a dark silhouette (so black things read on dark tiles)
  function rimLight(c, path, color, lw, off) {
    c.save(); path(c); c.clip(); c.translate(off, off); path(c); stroke(c, lw, color); c.restore();
  }
  function sparklePath(c, x, y, r, k) {
    k = k || 0.26;
    c.moveTo(x, y - r); c.quadraticCurveTo(x + r * k, y - r * k, x + r, y); c.quadraticCurveTo(x + r * k, y + r * k, x, y + r);
    c.quadraticCurveTo(x - r * k, y + r * k, x - r, y); c.quadraticCurveTo(x - r * k, y - r * k, x, y - r); c.closePath();
  }
  function starPts(n, ro, ri, rot, cx, cy) {
    const pts = []; cx = cx || 0; cy = cy || 0;
    for (let i = 0; i < n * 2; i++) { const a = (rot == null ? -Math.PI / 2 : rot) + (i * Math.PI) / n; const r = i % 2 ? ri : ro; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return pts;
  }
  const crossPts = (cx, cy, a, b) => [[cx - a, cy - b], [cx + a, cy - b], [cx + a, cy - a], [cx + b, cy - a], [cx + b, cy + a], [cx + a, cy + a], [cx + a, cy + b], [cx - a, cy + b], [cx - a, cy + a], [cx - b, cy + a], [cx - b, cy - a], [cx - a, cy - a]];
  function twinkle(c, x, y, r, a, rot, color) {
    if (!(a > 0.02) || !(r > 0.1)) return;
    c.save(); c.globalAlpha *= Math.min(1, a); c.translate(x, y); c.rotate(rot || 0);
    c.beginPath(); sparklePath(c, 0, 0, r, 0.2); c.fillStyle = color || PAL.white; c.fill(); c.restore();
  }
  function rays(c, x, y, r, n, rot, color, alpha, width) {
    if (!(alpha > 0) || !(r > 0)) return;
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= alpha; c.translate(x, y); c.rotate(rot);
    const g = c.createRadialGradient(0, 0, r * 0.15, 0, 0, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath();
    const w = width || 0.12;
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; c.moveTo(0, 0); c.arc(0, 0, r, a - w, a + w); c.closePath(); }
    c.fill(); c.restore();
  }
  function hexRGB(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, f) {
    const A = hexRGB(a), B = hexRGB(b); f = c01(f);
    return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * f) + ',' + Math.round(A[1] + (B[1] - A[1]) * f) + ',' + Math.round(A[2] + (B[2] - A[2]) * f) + ')';
  }
  function groundShadow(c, x, y, rx, ry, a) {
    c.save(); c.globalAlpha *= a == null ? 0.5 : a; c.beginPath(); ell(c, x, y, rx, ry); c.fillStyle = '#05030a'; c.fill(); c.restore();
  }
  // candle flame with an optional ink outline (lw in current units) and optional hot core
  function flame(c, x, y, size, t, o) {
    o = o || {};
    const seed = o.seed || 0;
    const fl = Math.sin(t * 13.7 + seed) * 0.08 + Math.sin(t * 7.3 + seed * 2) * 0.06;
    const h = size * (1 + fl), w = size * (o.wide || 0.55), sway = Math.sin(t * 5.1 + seed) * size * 0.12;
    if (o.glow !== false) Art.glow(c, x, y - h * 0.4, size * (o.glowR || 2.6), o.glowColor || 'rgba(255,170,80,0.55)', o.glowA == null ? 0.9 : o.glowA);
    const tongue = (k, sk) => {
      c.beginPath();
      c.moveTo(x + sway * sk, y - h * k);
      c.bezierCurveTo(x + w * 0.9 * k, y - h * 0.45 * k, x + w * k, y, x, y);
      c.bezierCurveTo(x - w * k, y, x - w * 0.9 * k, y - h * 0.45 * k, x + sway * sk, y - h * k);
      c.closePath();
    };
    tongue(1, 1); c.fillStyle = o.outer || PAL.candleDeep; c.fill();
    if (o.lw) { c.lineWidth = o.lw; c.strokeStyle = PAL.ink; c.lineJoin = 'round'; c.stroke(); }
    tongue(0.62, 0.6); c.fillStyle = o.inner || PAL.candle; c.fill();
    if (o.core) { tongue(0.32, 0.3); c.fillStyle = o.core; c.fill(); }
  }

  // ---------------------------------------------------------------- caching (browser only)
  const cache = new Map();
  let domOK = null;
  function canDOM() {
    if (domOK !== null) return domOK;
    try {
      domOK = typeof document !== 'undefined' && !!document && typeof document.createElement === 'function' &&
        !!document.createElement('canvas').getContext('2d');
    } catch (e) { domOK = false; }
    return domOK;
  }
  function makeCanvas(px) { const cv = document.createElement('canvas'); cv.width = cv.height = Math.max(1, Math.ceil(px)); return cv; }
  function cacheGet(key, make) {
    let v = cache.get(key);
    if (!v) { if (cache.size > 600) cache.clear(); v = make(); cache.set(key, v); }
    return v;
  }
  function resOf(ctx) {
    let k = 1;
    try {
      if (ctx && typeof ctx.getTransform === 'function') {
        const m = ctx.getTransform(); const q = Math.sqrt(m.a * m.a + m.b * m.b);
        if (q > 0 && isFinite(q)) k = q;
      }
    } catch (e) { /* ignore */ }
    return clamp(Math.ceil(k * 4 - 0.01) / 4, 0.5, 4);
  }
  function defaultRes() {
    let r = 1;
    try { r = Math.max(+globalThis.devicePixelRatio || 1, +(SD.Game && SD.Game.renderScale) || 1); } catch (e) { r = 1; }
    return clamp(Math.ceil(r * 2) / 2, 1, 4);
  }
  const qSize = (size) => (size <= 24 ? Math.max(4, Math.round(size)) : size <= 96 ? Math.round(size / 2) * 2 : Math.round(size / 4) * 4);
  // paint into a temp canvas, lay down its silhouette as a soft-ink drop shadow, then the art on top
  function paintShadowed(c, px, k, paint, sdx, sdy) {
    const tmp = makeCanvas(px), g = tmp.getContext('2d');
    g.setTransform(k, 0, 0, k, px / 2, px / 2); paint(g);
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(tmp, sdx * k, sdy * k);
    c.globalCompositeOperation = 'source-in'; c.fillStyle = C.shadow; c.fillRect(0, 0, px, px);
    c.globalCompositeOperation = 'source-over'; c.drawImage(tmp, 0, 0);
    c.restore();
  }
  function darkSprite(key, spr) {
    return cacheGet(key + '|dark', () => {
      const cv = makeCanvas(spr.cv.width), c = cv.getContext('2d');
      c.drawImage(spr.cv, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = '#07050f'; c.fillRect(0, 0, cv.width, cv.height);
      return { cv, W: spr.W };
    });
  }
  // the cached element can only live in one spot of the document; hand out a copy when it is already placed
  function domCopy(cv) {
    if (!cv.isConnected) return cv;
    const cp = document.createElement('canvas'); cp.width = cv.width; cp.height = cv.height;
    cp.getContext('2d').drawImage(cv, 0, 0);
    cp.style.width = cv.style.width; cp.style.height = cv.style.height; cp.className = cv.className;
    return cp;
  }

  // ================================================================ RELICS
  const R = {};
  function relicLW(size) { const s = size / 100, px = clamp(size * 0.056, 1.5, 4.2); return { s, lw: px / s, thin: (px * 0.6) / s, small: size < 44 }; }

  // ---------------- whetstone 砥石: two-grit grey stone in a wooden holder, a short blade being honed across it
  R.whetstone = {
    col: '#aeb5c4', glow: 'rgba(216,226,240,0.85)',
    draw(c, L) {
      c.translate(-2, 9);
      c.beginPath(); poly(c, [[-44, 12], [-32, 0], [48, 0], [36, 12]]); Art.fs(c, C.woodDeep, L.thin);
      // stone: fine layer over coarse layer, oblique box
      c.beginPath(); poly(c, [[-36, -6], [26, -6], [26, 1], [-36, 1]]); fill(c, C.whetFine);
      c.beginPath(); poly(c, [[-36, 1], [26, 1], [26, 16], [-36, 16]]); fill(c, C.whetCoarse);
      c.beginPath(); poly(c, [[26, -6], [38, -18], [38, -11], [26, 1]]); fill(c, C.whetFineSh);
      c.beginPath(); poly(c, [[26, 1], [38, -11], [38, 4], [26, 16]]); fill(c, C.whetCoarseSh);
      c.beginPath(); poly(c, [[-36, -6], [-24, -18], [38, -18], [26, -6]]); fill(c, C.whetTop);
      c.beginPath(); poly(c, [[-27, -8], [-20, -15], [4, -15], [-3, -8]]); fill(c, 'rgba(255,255,255,0.7)');
      if (!L.small) {
        c.beginPath(); for (let i = 0; i < 18; i++) circ(c, -33 + hash(i * 3.1) * 57, 3.5 + hash(i * 7.7) * 11, 0.8 + hash(i) * 0.8); fill(c, 'rgba(36,40,56,0.55)');
        c.beginPath(); for (let i = 0; i < 10; i++) circ(c, -31 + hash(i * 5.3 + 2) * 54, 3.5 + hash(i * 2.9 + 1) * 11, 0.75); fill(c, 'rgba(205,210,225,0.6)');
      }
      c.beginPath(); c.moveTo(-36, -6); c.lineTo(26, -6); c.lineTo(38, -18); c.moveTo(26, -6); c.lineTo(26, 16); stroke(c, L.thin);
      c.beginPath(); c.moveTo(-36, 1); c.lineTo(26, 1); c.lineTo(38, -11); stroke(c, L.thin * 0.7, 'rgba(26,18,34,0.5)');
      c.beginPath(); poly(c, [[-36, -6], [-24, -18], [38, -18], [38, 4], [26, 16], [-36, 16]]); stroke(c, L.lw);
      // holder lip over the stone's foot
      sh(c, P((cc) => rr(cc, -44, 12, 80, 15, 3)), C.wood, C.woodShade, L.lw, { dx: -5, dy: -4 });
      c.beginPath(); poly(c, [[36, 12], [48, 0], [48, 15], [36, 27]]); Art.fs(c, C.woodShade, L.lw);
      line(c, -40, 15.5, 30, 15.5, L.thin * 0.7, 'rgba(255,220,180,0.4)');
      if (!L.small) { c.beginPath(); c.moveTo(-31, 20); c.quadraticCurveTo(-21, 18, -11, 21); c.moveTo(7, 22); c.quadraticCurveTo(17, 20, 27, 23); stroke(c, L.thin * 0.6, 'rgba(60,30,14,0.75)'); }
      // the blade, drawn across the stone
      c.save(); c.translate(-41, 19); c.rotate(-0.6);
      sh(c, P((cc) => rr(cc, 3, -4, 17, 8, 3)), '#7a4630', '#4e2a1d', L.thin * 1.2, { dx: 0, dy: -2.5 });
      if (!L.small) { c.beginPath(); for (let x = 7; x < 19; x += 4) { c.moveTo(x, -4); c.lineTo(x + 2.5, 4); } stroke(c, L.thin * 0.5, 'rgba(26,18,34,0.6)'); }
      sh(c, P((cc) => circ(cc, 1.5, 0, 4.6)), PAL.brassLight, PAL.brass, L.thin, { dx: 0, dy: -1.5 });
      const blade = (cc) => { cc.moveTo(23, -5); cc.lineTo(77, -4.5); cc.lineTo(92, 0); cc.lineTo(77, 4.5); cc.lineTo(23, 5); cc.closePath(); };
      c.save(); c.beginPath(); blade(c); fill(c, PAL.steel); c.clip(); c.fillStyle = PAL.steelShade; c.fillRect(20, 0.3, 80, 8);
      c.beginPath(); poly(c, [[23, -5], [77, -4.5], [92, 0], [80, -1.6], [23, -2.2]]); fill(c, PAL.white); c.restore();
      c.beginPath(); blade(c); stroke(c, L.lw);
      if (!L.small) line(c, 27, 0.3, 70, 0.3, L.thin * 0.6, '#6d7a96');
      sh(c, P((cc) => rr(cc, 19, -9, 5.5, 18, 2.5)), PAL.brass, PAL.brassDark, L.thin * 1.2, { dx: -1.5, dy: 0 });
      c.restore();
      // glint of a fresh edge
      c.beginPath(); sparklePath(c, 27, -36, 10.5); Art.fs(c, PAL.white, L.thin * 0.7);
      if (!L.small) { c.beginPath(); sparklePath(c, 40, -44, 4.5); Art.fs(c, PAL.white, L.thin * 0.5); }
    },
    live(c, L, t, vis) {
      c.translate(-2, 9);
      const tw = 0.5 + 0.5 * Math.sin(t * 3.1);
      Art.glow(c, 27, -36, 18, 'rgba(230,240,255,0.8)', tw * vis * 0.8);
      twinkle(c, 27, -36, 5 + tw * 4, tw * vis * 0.9, t * 0.8);
    },
  };

  // ---------------- flint 火打ち石: knapped flint nodule + C-shaped fire steel + spark
  const FLINT_SPARK = [-11, -14];
  const FLINT_NOD = [[-42, 20], [-37, -2], [-21, -14], [-1, -12], [13, 2], [11, 24], [-5, 38], [-30, 36]];
  R.flint = {
    col: '#ffb347', glow: 'rgba(255,150,60,0.9)',
    draw(c, L) {
      c.translate(-3, 5);
      const nod = P((cc) => poly(cc, FLINT_NOD));
      sh(c, nod, C.flintCore, C.flintShade, L.lw, { dx: -7, dy: -7 });
      c.save(); nod(c); c.clip();
      c.beginPath(); poly(c, [[-21, -14], [-1, -12], [-7, 5], [-25, 2]]); fill(c, C.flintFacet);
      c.beginPath(); poly(c, [[-1, -12], [13, 2], [4, 12], [-7, 5]]); fill(c, C.flintFacet2);
      const cortex = P((cc) => Art.blobPath(cc, [[-52, -10], [-37, -4], [-31, 10], [-19, 22], [-7, 31], [-2, 48], [-52, 48]], 0.7));
      Art.shape(c, cortex, C.cortex, C.cortexShade, { lw: L.thin, dx: -5, dy: -5 });
      if (!L.small) {
        c.beginPath(); for (let i = 0; i < 10; i++) circ(c, -38 + hash(i * 4.3) * 22, 14 + hash(i * 9.1) * 22, 0.9 + hash(i * 2.2) * 0.8); fill(c, 'rgba(120,100,70,0.6)');
        c.beginPath(); c.arc(-14, 17, 9, -1.9, -0.5); c.moveTo(-14 + Math.cos(-1.3) * 14, 17 + Math.sin(-1.3) * 14); c.arc(-14, 17, 14, -1.3, -0.35); stroke(c, L.thin * 0.5, 'rgba(170,180,220,0.55)');
      }
      c.restore();
      c.beginPath(); c.moveTo(-25, 2); c.lineTo(-7, 5); c.lineTo(4, 12); c.moveTo(-7, 5); c.lineTo(-1, -12); stroke(c, L.thin * 0.7, 'rgba(26,18,34,0.6)');
      c.beginPath(); c.moveTo(-34, -3); c.lineTo(-21, -11); c.lineTo(-4, -9.5); stroke(c, L.thin * 0.8, 'rgba(225,230,255,0.8)');
      nod(c); stroke(c, L.lw);
      // fire steel: flat striking bar with scroll-curled ends
      c.save(); c.translate(15, -28); c.rotate(-0.16);
      const curl = (cc, s) => {
        cc.moveTo(s * 18, 5);
        for (let i = 1; i <= 24; i++) {
          const f = i / 24, a = 1.25 - f * Math.PI * 1.75, r = 11 - f * 7.5;
          cc.lineTo(s * (15 + Math.cos(a) * r), -6 + Math.sin(a) * r);
        }
      };
      for (const s of [-1, 1]) band(c, (cc) => curl(cc, s), C.forge, L.small ? 7.5 : 6.4, L.lw * 0.9);
      if (!L.small) for (const s of [-1, 1]) { c.save(); c.beginPath(); c.arc(s * 15, -6, 9.6, Math.PI * 1.02, Math.PI * 1.42); c.lineWidth = 1.4; c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineCap = 'round'; c.stroke(); c.restore(); }
      sh(c, P((cc) => rr(cc, -23, 1, 46, L.small ? 12 : 11, 3.5)), C.forge, C.forgeShade, L.lw, { dx: 0, dy: -4 });
      line(c, -19, 10, 19, 10, L.thin * 1.1, '#eef3fb');
      c.restore();
      // spark burst at the strike
      c.beginPath(); poly(c, starPts(8, 11, 4.4, -Math.PI / 2 + 0.2, FLINT_SPARK[0], FLINT_SPARK[1])); Art.fs(c, PAL.flameHot, L.thin);
      c.beginPath(); poly(c, starPts(8, 5.6, 2.4, -Math.PI / 2 + 0.2, FLINT_SPARK[0], FLINT_SPARK[1])); fill(c, '#fff6d0');
    },
    live(c, L, t, vis) {
      c.translate(-3, 5);
      const f = 0.6 + 0.4 * Math.sin(t * 9.3) * Math.sin(t * 3.1);
      const sx0 = FLINT_SPARK[0], sy0 = FLINT_SPARK[1];
      Art.glow(c, sx0, sy0, 24, 'rgba(255,170,70,0.75)', (0.55 + f * 0.45) * vis);
      c.save(); c.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const ph = (t * 1.3 + i / 6) % 1, a = -Math.PI * 0.5 - 1.25 + i * 0.3 + Math.sin(i * 4.1) * 0.1;
        const d = 8 + ph * 28, x = sx0 + Math.cos(a) * d, y = sy0 + Math.sin(a) * d + ph * ph * 16;
        const tx = Math.cos(a) * 5, ty = Math.sin(a) * 5 + ph * 4;
        c.globalAlpha = (1 - ph) * vis;
        c.beginPath(); c.moveTo(x - tx, y - ty); c.lineTo(x, y); c.lineWidth = 2.6; c.strokeStyle = ph < 0.45 ? PAL.flameHot : PAL.candleDeep; c.stroke();
      }
      c.restore();
    },
  };

  // ---------------- holywater 聖水: round flask of glowing mint water with a holy cross
  const HWF = { cy: 13, r: 30, nw: 8, top: -29 };
  function flaskPath(c) {
    const cy = HWF.cy, r = HWF.r, nw = HWF.nw, dy = Math.sqrt(r * r - nw * nw);
    c.moveTo(-nw, HWF.top); c.lineTo(-nw, cy - dy);
    c.arc(0, cy, r, Math.atan2(-dy, -nw), Math.atan2(-dy, nw), true);
    c.lineTo(nw, HWF.top); c.closePath();
  }
  function waterSurf(c, wl) { c.moveTo(-40, wl); c.quadraticCurveTo(-20, wl - 3, 0, wl); c.quadraticCurveTo(20, wl + 3, 40, wl); }
  R.holywater = {
    col: '#7df0b4', glow: 'rgba(125,240,180,0.9)',
    draw(c, L) {
      c.translate(0, 3);
      const fl = P(flaskPath), wl = 0;
      sh(c, fl, C.glass, C.glassShade, 0, { dx: -6, dy: -6 });
      c.save(); fl(c); c.clip();
      c.beginPath(); waterSurf(c, wl); c.lineTo(40, 50); c.lineTo(-40, 50); c.closePath(); c.clip();
      c.fillStyle = C.healShade; c.fillRect(-40, -10, 80, 60);
      c.beginPath(); circ(c, -6, HWF.cy - 6, HWF.r); fill(c, PAL.heal);
      c.beginPath(); circ(c, -5, HWF.cy + 2, 14); fill(c, C.healCore);
      c.restore();
      c.save(); fl(c); c.clip(); c.beginPath(); waterSurf(c, wl); stroke(c, L.thin, '#e8fff3'); c.restore();
      sh(c, P((cc) => poly(cc, crossPts(-2, 17, L.small ? 4.4 : 3.6, 10.5))), '#ffffff', '#bff0d8', L.thin * 0.8, { dx: -1.5, dy: -1.5 });
      c.beginPath(); c.arc(0, HWF.cy, HWF.r - 6, Math.PI * 1.08, Math.PI * 1.38); stroke(c, L.thin * 1.2, 'rgba(255,255,255,0.85)');
      line(c, -4.5, -26, -4.5, -17, L.thin, 'rgba(255,255,255,0.6)');
      fl(c); stroke(c, L.lw);
      sh(c, P((cc) => rr(cc, -12, -33, 24, 7, 3)), C.glassLip, C.glass, L.thin, { dx: -2, dy: -2 });
      sh(c, P((cc) => rr(cc, -8, -46, 16, 14, 3)), C.cork, C.corkShade, L.lw, { dx: -3, dy: -3 });
      if (!L.small) {
        c.beginPath(); circ(c, -3, -41, 1.1); circ(c, 3, -37, 1.1); circ(c, 1.5, -42.5, 0.9); fill(c, C.corkShade);
        band(c, (cc) => { cc.moveTo(-8, -21); cc.quadraticCurveTo(0, -18, 8, -21); }, PAL.gold, 2.6, L.thin * 0.7);
      }
    },
    live(c, L, t, vis) {
      c.translate(0, 3);
      const f = 0.65 + 0.35 * Math.sin(t * 2.6);
      Art.glow(c, -2, HWF.cy + 6, 40, 'rgba(125,240,180,0.6)', f * vis);
      c.save(); c.beginPath(); flaskPath(c); c.clip();
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.45 + i / 3) % 1, x = -13 + i * 12 + Math.sin(t * 3 + i * 2) * 2, y = 38 - ph * 36;
        c.globalAlpha = Math.sin(ph * Math.PI) * 0.85 * vis;
        c.beginPath(); circ(c, x, y, 1.6 + i * 0.5); c.lineWidth = 1.2; c.strokeStyle = '#eafff4'; c.stroke();
      }
      c.restore();
      const tw = Math.max(0, Math.sin(t * 2.2 + 1));
      twinkle(c, 22, -16, 7 * tw, tw * vis, 0);
    },
  };

  // ---------------- buckler 樫の小盾: small round oak shield, iron rim, steel boss
  R.buckler = {
    col: '#b27a44', glow: 'rgba(111,211,255,0.85)',
    draw(c, L) {
      const r = 41, cy = -1;
      c.beginPath(); circ(c, 3, cy + 4, r); Art.fs(c, C.ironDark, L.lw);
      sh(c, P((cc) => circ(cc, 0, cy, r)), C.iron, C.ironShade, L.lw, { dx: -5, dy: -5 });
      const face = P((cc) => circ(cc, 0, cy, r - 8.5));
      sh(c, face, C.oak, C.oakShade, L.thin, { dx: -8, dy: -8 });
      c.save(); face(c); c.clip();
      c.beginPath(); for (const x of [-16, 0, 16]) { c.moveTo(x, -50); c.lineTo(x + 1.5, 50); } stroke(c, L.thin * 0.85, C.oakLine);
      if (!L.small) {
        c.beginPath();
        for (let i = 0; i < 4; i++) { const x = -24 + i * 16; c.moveTo(x - 2, -22 + i * 6); c.quadraticCurveTo(x + 3, -12 + i * 6, x - 1, 0 + i * 6); }
        stroke(c, L.thin * 0.5, 'rgba(255,222,170,0.4)');
        c.beginPath(); c.moveTo(8, 18); c.lineTo(19, 10); c.moveTo(-22, -15); c.lineTo(-15, -23); c.moveTo(-6, 24); c.lineTo(-1, 20); stroke(c, L.thin * 0.7, 'rgba(60,30,14,0.8)');
      }
      c.restore();
      c.beginPath(); c.arc(0, cy, r - 4, Math.PI * 1.02, Math.PI * 1.48); stroke(c, L.thin * 0.9, 'rgba(255,255,255,0.5)');
      if (!L.small) for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + TAU / 16; c.beginPath(); circ(c, Math.cos(a) * (r - 4.3), cy + Math.sin(a) * (r - 4.3), 2.4); Art.fs(c, C.ironLight, L.thin * 0.6); }
      sh(c, P((cc) => circ(cc, 0, cy, L.small ? 15 : 14)), PAL.steel, PAL.steelShade, L.lw, { dx: -4, dy: -4, hi: { x: -5, y: cy - 5, rx: 4.5, ry: 3, rot: -0.6, color: 'rgba(255,255,255,0.85)' } });
    },
    live(c, L, t, vis) {
      const ph = (t * 0.3) % 1;
      if (ph < 0.25) twinkle(c, -6, -7, 8 * Math.sin((ph / 0.25) * Math.PI), vis, ph * 3);
    },
  };

  // ---------------- hourglass 砂時計: wooden frame, pale glass, golden (spark-coloured) sand
  function hgGlass(c) {
    c.moveTo(-19, -35); c.lineTo(19, -35); c.bezierCurveTo(21, -12, 4, -7, 4, 0); c.bezierCurveTo(4, 7, 21, 12, 19, 35);
    c.lineTo(-19, 35); c.bezierCurveTo(-21, 12, -4, 7, -4, 0); c.bezierCurveTo(-4, -7, -21, -12, -19, -35); c.closePath();
  }
  R.hourglass = {
    col: '#ffc15e', glow: 'rgba(255,200,100,0.9)',
    draw(c, L) {
      const gP = P(hgGlass);
      sh(c, gP, C.hgGlass, C.hgGlassShade, 0, { dx: -5, dy: -5 });
      c.save(); gP(c); c.clip();
      sh(c, P((cc) => { cc.moveTo(-26, -15); cc.quadraticCurveTo(0, -20, 26, -15); cc.lineTo(26, 2); cc.lineTo(-26, 2); cc.closePath(); }), C.sand, C.sandShade, 0, { dx: -5, dy: -3 });
      sh(c, P((cc) => { cc.moveTo(-28, 40); cc.lineTo(-24, 33); cc.quadraticCurveTo(0, 6, 24, 33); cc.lineTo(28, 40); cc.closePath(); }), C.sand, C.sandShade, 0, { dx: -6, dy: -3 });
      if (!L.small) { c.beginPath(); for (let i = 0; i < 12; i++) circ(c, -14 + hash(i * 2.7) * 28, 22 + hash(i * 5.1) * 12, 0.7); fill(c, 'rgba(255,240,200,0.8)'); }
      c.restore();
      c.beginPath(); c.moveTo(-13, -29); c.quadraticCurveTo(-14, -16, -6, -8); stroke(c, L.thin, 'rgba(255,255,255,0.9)');
      c.beginPath(); c.moveTo(-13, 29); c.quadraticCurveTo(-14, 18, -8, 11); stroke(c, L.thin * 0.8, 'rgba(255,255,255,0.7)');
      gP(c); stroke(c, L.lw * 0.85);
      for (const s of [-1, 1]) {
        const x = s * 26;
        sh(c, P((cc) => rr(cc, x - 3.4, -38, 6.8, 76, 3)), C.post, C.postShade, L.thin, { dx: -2.5, dy: 0 });
        if (!L.small) for (const y of [-22, 0, 22]) { c.beginPath(); ell(c, x, y, 4.8, 3); Art.fs(c, C.post, L.thin * 0.8); }
      }
      for (const y of [-46, 35]) {
        sh(c, P((cc) => rr(cc, -33, y, 66, 11, 4)), C.wood, C.woodShade, L.lw, { dx: -4, dy: -4 });
        line(c, -28, y + 3.4, 28, y + 3.4, L.thin * 0.8, PAL.brassLight);
      }
    },
    live(c, L, t, vis) {
      c.save(); c.globalAlpha *= vis;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 21); c.lineWidth = 1.5 + Math.sin(t * 23) * 0.3; c.strokeStyle = C.sand; c.stroke();
      c.beginPath(); for (let i = 0; i < 4; i++) { const y = ((t * 46 + i * 5.5) % 22); circ(c, Math.sin(i * 3 + t * 9) * 0.8, y, 1.1); } fill(c, '#fff0c8');
      c.restore();
      Art.glow(c, 0, 22, 20, 'rgba(255,200,100,0.6)', (0.45 + 0.15 * Math.sin(t * 3)) * vis);
    },
  };

  // ---------------- catbell 黒猫の鈴: black cat-head charm with a red collar and a golden bell
  function catHead(c) {
    c.moveTo(-31, -4);
    c.quadraticCurveTo(-34, -16, -29, -23);
    c.lineTo(-26, -47);
    c.lineTo(-9, -31);
    c.quadraticCurveTo(0, -34, 9, -31);
    c.lineTo(26, -47);
    c.lineTo(29, -23);
    c.quadraticCurveTo(34, -16, 31, -4);
    c.bezierCurveTo(30, 14, 16, 21, 0, 21);
    c.bezierCurveTo(-16, 21, -30, 14, -31, -4);
    c.closePath();
  }
  R.catbell = {
    col: '#ffd257', glow: 'rgba(255,210,87,0.85)',
    draw(c, L) {
      c.translate(0, -1);
      const head = P(catHead);
      sh(c, head, C.cat, C.catShade, L.lw, { dx: -6, dy: -6 });
      rimLight(c, head, C.catRim, L.thin * 1.1, 2.4);
      c.beginPath(); poly(c, [[-24, -40], [-13, -30], [-25, -27]]); poly(c, [[24, -40], [13, -30], [25, -27]]); fill(c, C.catEar);
      for (const s of [-1, 1]) {
        const x = s * 12.5, y = -8;
        c.beginPath(); ell(c, x, y, L.small ? 8.4 : 7.6, L.small ? 6.8 : 6.1, s * 0.18);
        if (L.small) fill(c, C.catEye); else Art.fs(c, C.catEye, L.thin * 0.8);
        c.beginPath(); ell(c, x, y, 1.9, 5.2); fill(c, PAL.ink);
        c.beginPath(); circ(c, x - 2.8, y - 2.4, 1.5); fill(c, PAL.white);
      }
      c.beginPath(); poly(c, [[-3.2, 3], [3.2, 3], [0, 6.5]]); fill(c, '#f08aa6');
      if (!L.small) {
        c.beginPath(); c.moveTo(-5.5, 8.5); c.quadraticCurveTo(-2.7, 11.5, 0, 8.6); c.quadraticCurveTo(2.7, 11.5, 5.5, 8.5); stroke(c, L.thin * 0.7);
        c.beginPath(); for (const s of [-1, 1]) { c.moveTo(s * 19, 3); c.lineTo(s * 40, -1); c.moveTo(s * 19, 7); c.lineTo(s * 39, 9); }
        stroke(c, L.thin * 0.55, 'rgba(232,222,252,0.85)');
      }
      // collar, bell loop, bell
      band(c, (cc) => { cc.moveTo(-23, 12); cc.quadraticCurveTo(0, 25.5, 23, 12); }, C.collar, 6.5, L.thin);
      band(c, (cc) => { cc.moveTo(3, 19); cc.arc(0, 19, 3, 0, TAU); }, PAL.gold, 2.2, L.thin * 0.7);
      sh(c, P((cc) => circ(cc, 0, 30, L.small ? 12 : 10.5)), PAL.gold, PAL.brass, L.lw, { dx: -4, dy: -4, hi: { x: -4, y: 26, rx: 3.6, ry: 2.4, rot: -0.5, color: 'rgba(255,255,255,0.85)' } });
      c.beginPath(); c.moveTo(-10, 28.5); c.quadraticCurveTo(0, 31.5, 10, 28.5); stroke(c, L.thin * 0.8, PAL.brassDark);
      c.beginPath(); c.moveTo(-4.5, 34.5); c.lineTo(4.5, 34.5); stroke(c, L.thin * 1.3);
      c.beginPath(); circ(c, 0, 36.8, 1.7); fill(c, PAL.ink);
    },
    live(c, L, t, vis) {
      c.translate(0, -1);
      const f = 0.6 + 0.4 * Math.sin(t * 2.3);
      Art.glow(c, -12.5, -8, 12, 'rgba(255,220,100,0.8)', f * vis * 0.7);
      Art.glow(c, 12.5, -8, 12, 'rgba(255,220,100,0.8)', f * vis * 0.7);
      const tw = Math.max(0, Math.sin(t * 1.7));
      twinkle(c, 6, 25, 6 * tw, tw * vis, t);
    },
  };

  // ---------------- twinring 双子の指輪: interlocked gold + silver rings with ruby / sapphire
  const RA = { cx: -12, cy: 6, rx: 21, ry: 27, rot: -0.3 }, RB = { cx: 12, cy: -1, rx: 21, ry: 27, rot: 0.3 };
  const MET = {
    gold: { base: '#e8b44a', light: '#fff0b0', shade: '#a8742a' },
    silver: { base: '#c8d0e0', light: '#ffffff', shade: '#7d88a2' },
  };
  function ellPt(g, th, dr) {
    const rx = g.rx + (dr || 0), ry = g.ry + (dr || 0), cr = Math.cos(g.rot), sr = Math.sin(g.rot);
    const x = rx * Math.cos(th), y = ry * Math.sin(th);
    return [g.cx + x * cr - y * sr, g.cy + x * sr + y * cr];
  }
  let RING_X = null; // upper crossing of the two ring centre-lines (computed once)
  function ringCross() {
    if (RING_X) return RING_X;
    const inside = (p) => { const dx = p[0] - RB.cx, dy = p[1] - RB.cy, cr = Math.cos(-RB.rot), sr = Math.sin(-RB.rot); const x = dx * cr - dy * sr, y = dx * sr + dy * cr; return (x * x) / (RB.rx * RB.rx) + (y * y) / (RB.ry * RB.ry) - 1; };
    let best = null, prev = inside(ellPt(RA, 0)), prevP = ellPt(RA, 0);
    for (let i = 1; i <= 360; i++) {
      const p = ellPt(RA, (i / 360) * TAU), v = inside(p);
      if ((v < 0) !== (prev < 0)) { const m = [(p[0] + prevP[0]) / 2, (p[1] + prevP[1]) / 2]; if (!best || m[1] < best[1]) best = m; }
      prev = v; prevP = p;
    }
    RING_X = best || [0, -16];
    return RING_X;
  }
  function ringStroke(c, g, M, w, L) {
    c.save(); c.lineCap = 'round';
    const E = (dr, a0, a1) => { c.beginPath(); c.ellipse(g.cx, g.cy, Math.max(0.01, g.rx + dr), Math.max(0.01, g.ry + dr), g.rot, a0, a1); };
    E(0, 0, TAU); c.lineWidth = w + L.lw * 2; c.strokeStyle = PAL.ink; c.stroke();
    E(0, 0, TAU); c.lineWidth = w; c.strokeStyle = M.base; c.stroke();
    E(w * 0.22, -0.5, 1.9); c.lineWidth = w * 0.36; c.strokeStyle = M.shade; c.stroke();
    E(-w * 0.16, Math.PI * 1.0, Math.PI * 1.5); c.lineWidth = w * 0.24; c.strokeStyle = M.light; c.stroke();
    c.restore();
  }
  function gem(c, x, y, r, M, base, shade, L) {
    sh(c, P((cc) => circ(cc, x, y, r + 2.6)), M.base, M.shade, L.thin, { dx: -1.5, dy: -1.5 });
    sh(c, P((cc) => circ(cc, x, y, r)), base, shade, L.thin * 0.8, { dx: -2, dy: -2 });
    c.beginPath(); poly(c, [[x - r * 0.55, y - r * 0.1], [x - r * 0.1, y - r * 0.6], [x + r * 0.1, y - r * 0.2]]); fill(c, 'rgba(255,255,255,0.85)');
  }
  R.twinring = {
    col: '#e8b44a', glow: 'rgba(255,220,130,0.9)',
    draw(c, L) {
      const w = L.small ? 10 : 8.5;
      ringStroke(c, RA, MET.gold, w, L);
      ringStroke(c, RB, MET.silver, w, L);
      const X = ringCross();
      c.save(); c.beginPath(); circ(c, X[0], X[1], w * 1.25); c.clip(); ringStroke(c, RA, MET.gold, w, L); c.restore();
      const ga = ellPt(RA, -Math.PI / 2, w * 0.3), gb = ellPt(RB, -Math.PI / 2, w * 0.3);
      gem(c, ga[0], ga[1], L.small ? 6 : 5.2, MET.gold, C.ruby, C.rubyShade, L);
      gem(c, gb[0], gb[1], L.small ? 6 : 5.2, MET.silver, C.sapphire, C.sapphireShade, L);
    },
    live(c, L, t, vis) {
      const ga = ellPt(RA, -Math.PI / 2, 2.5), gb = ellPt(RB, -Math.PI / 2, 2.5);
      const a = Math.max(0, Math.sin(t * 2.1)), b = Math.max(0, Math.sin(t * 2.1 + Math.PI));
      twinkle(c, ga[0] - 3, ga[1] - 4, 7 * a, a * vis, t);
      twinkle(c, gb[0] - 3, gb[1] - 4, 7 * b, b * vis, -t);
    },
  };

  // ---------------- fang 吸血の牙: a long vampire fang with a gold cap on a leather cord, blood-tipped
  function fangPath(c) {
    c.moveTo(-11, -8); c.lineTo(13, -8);
    c.bezierCurveTo(17, 12, 11, 31, -4, 46);
    c.bezierCurveTo(-7, 33, -13, 15, -11, -8);
    c.closePath();
  }
  R.fang = {
    col: '#ff4f5e', glow: 'rgba(255,79,94,0.85)',
    draw(c, L) {
      c.translate(1, -1); c.rotate(0.1);
      band(c, (cc) => { cc.moveTo(-2, -26); cc.bezierCurveTo(-18, -30, -28, -37, -21, -43); cc.bezierCurveTo(-12, -48, 14, -48, 23, -43); cc.bezierCurveTo(30, -37, 20, -30, 4, -26); }, C.cord, 3.4, L.thin);
      if (!L.small) for (const [x, y] of [[-14, -31], [16, -31]]) { c.beginPath(); circ(c, x, y, 3.3); Art.fs(c, C.ruby, L.thin * 0.7); }
      band(c, (cc) => { cc.moveTo(5.5, -23); cc.arc(1, -23, 4.5, 0, TAU); }, PAL.gold, 2.6, L.thin * 0.8);
      const fp = P(fangPath);
      sh(c, fp, PAL.bone, PAL.boneShade, L.lw, { dx: -6, dy: -5 });
      c.save(); fp(c); c.clip();
      sh(c, P((cc) => { cc.moveTo(-20, 27); cc.quadraticCurveTo(-8, 22, 0, 29); cc.quadraticCurveTo(8, 34, 20, 28); cc.lineTo(20, 60); cc.lineTo(-20, 60); cc.closePath(); }), C.blood, C.bloodShade, L.thin * 0.8, { dx: -3, dy: -3 });
      c.restore();
      c.beginPath(); c.moveTo(-6, -3); c.quadraticCurveTo(-9, 12, -6, 26); stroke(c, L.thin * 1.1, 'rgba(255,255,255,0.85)');
      fp(c); stroke(c, L.lw);
      sh(c, P((cc) => rr(cc, -14, -19, 30, 12, 4)), PAL.gold, PAL.brass, L.lw, { dx: -3, dy: -3 });
      if (!L.small) { c.beginPath(); for (let x = -8; x <= 10; x += 4.5) { c.moveTo(x, -18); c.lineTo(x + 2.5, -8); } stroke(c, L.thin * 0.6, PAL.brassDark); }
      line(c, -10, -16, 4, -16, L.thin * 0.7, 'rgba(255,255,255,0.7)');
      c.beginPath(); c.moveTo(-5.6, 47); c.quadraticCurveTo(-4.4, 50, -4.4, 51.5); c.arc(-5.4, 51.8, 1.9, 0, Math.PI); c.quadraticCurveTo(-6.6, 50, -5.6, 47); c.closePath(); Art.fs(c, C.blood, L.thin * 0.6);
    },
    live(c, L, t, vis) {
      c.translate(1, -1); c.rotate(0.1);
      const ph = (t / 2.6) % 1;
      if (ph > 0.55) {
        const q = (ph - 0.55) / 0.45, y = 54 + q * q * 26;
        c.save(); c.globalAlpha *= (1 - q) * vis;
        c.beginPath(); c.moveTo(-5.4, y - 4.5); c.quadraticCurveTo(-3, y - 1, -3, y + 0.6); c.arc(-5.4, y + 0.6, 2.4, 0, Math.PI); c.quadraticCurveTo(-7.8, y - 1, -5.4, y - 4.5); c.closePath(); fill(c, C.blood);
        c.restore();
      }
      Art.glow(c, -2, 36, 14, 'rgba(255,60,80,0.6)', (0.35 + 0.25 * Math.sin(t * 2.4)) * vis);
    },
  };

  // ---------------- candelabra 燭台: three-armed brass candelabra, three lit candles
  const CANDLES = [{ x: -29, top: -26, cup: -4 }, { x: 0, top: -37, cup: -11 }, { x: 29, top: -26, cup: -4 }];
  R.candelabra = {
    col: '#ffc15e', glow: 'rgba(255,190,90,0.95)',
    draw(c, L) {
      const aw = L.small ? 7.5 : 6.5;
      for (const s of [-1, 1]) {
        band(c, (cc) => { cc.moveTo(0, 12); cc.bezierCurveTo(s * 10, 17, s * 29, 15, s * 29, -2); }, PAL.brass, aw, L.thin);
        c.beginPath(); c.moveTo(s * 6, 12.5); c.bezierCurveTo(s * 13, 13.5, s * 26, 12, s * 27, 0); stroke(c, aw * 0.28, PAL.brassLight);
      }
      sh(c, P((cc) => rr(cc, -4.5, -10, 9, 48, 3)), PAL.brass, PAL.brassDark, L.thin, { dx: -3, dy: 0 });
      sh(c, P((cc) => ell(cc, 0, 12, 8.5, 5.5)), PAL.brassLight, PAL.brass, L.thin, { dx: -2, dy: -2 });
      if (!L.small) sh(c, P((cc) => ell(cc, 0, 27, 6, 3.8)), PAL.brassLight, PAL.brass, L.thin, { dx: -2, dy: -2 });
      sh(c, P((cc) => { cc.moveTo(-23, 46); cc.quadraticCurveTo(-21, 36, -6, 34.5); cc.lineTo(6, 34.5); cc.quadraticCurveTo(21, 36, 23, 46); cc.closePath(); }), PAL.brass, PAL.brassDark, L.lw, { dx: -4, dy: -3, hi: { x: -10, y: 39, rx: 5, ry: 1.6, color: 'rgba(255,240,190,0.6)' } });
      for (const k of CANDLES) {
        sh(c, P((cc) => poly(cc, [[k.x - 7, k.cup - 1], [k.x + 7, k.cup - 1], [k.x + 3.5, k.cup + 5], [k.x - 3.5, k.cup + 5]])), PAL.brass, PAL.brassDark, L.thin, { dx: -2, dy: -1 });
        sh(c, P((cc) => rr(cc, k.x - 6, k.top, 12, k.cup - 2 - k.top, 2.5)), C.wax, C.waxShade, L.thin * 1.15, { dx: -3.5, dy: 0 });
        if (!L.small) { c.beginPath(); rr(c, k.x - 6.8, k.top + 1, 4, 9, 2); Art.fs(c, '#fffaf0', L.thin * 0.6); }
        sh(c, P((cc) => rr(cc, k.x - 10, k.cup - 4, 20, 5, 2.5)), PAL.brassLight, PAL.brass, L.thin, { dx: -2, dy: -1.5 });
        line(c, k.x, k.top, k.x + 0.6, k.top - 3.5, L.thin);
      }
    },
    live(c, L, t, vis) {
      CANDLES.forEach((k, i) => {
        flame(c, k.x + 0.6, k.top - 2.2, i === 1 ? 14 : 12.5, t, { seed: i * 2.3, lw: L.thin * 0.8, glowA: 0.8 * vis, glowR: 2.3 });
      });
    },
  };

  // ---------------- mirror 割れた鏡: violet-lacquer hand mirror with a gold inlay, cracked and chipped
  R.mirror = {
    col: '#d3def8', glow: 'rgba(200,190,255,0.85)',
    draw(c, L) {
      c.translate(2, 2); c.rotate(-0.5);
      sh(c, P((cc) => rr(cc, -5.5, 16, 11, 28, 5)), C.lacquer, C.lacquerShade, L.lw, { dx: -3, dy: 0 });
      sh(c, P((cc) => circ(cc, 0, 45, 6.5)), C.gold, C.goldShade, L.lw, { dx: -2, dy: -2 });
      sh(c, P((cc) => rr(cc, -9, 13, 18, 7, 3)), C.gold, C.goldShade, L.thin, { dx: -2, dy: -2 });
      if (!L.small) sh(c, P((cc) => poly(cc, [[0, -52], [6, -45], [0, -40], [-6, -45]])), C.gold, C.goldShade, L.thin, { dx: -1.5, dy: -1.5 });
      sh(c, P((cc) => ell(cc, 0, -12, 27, 31)), C.lacquer, C.lacquerShade, L.lw, { dx: -5, dy: -5 });
      c.beginPath(); ell(c, 0, -12, 23.8, 27.8); stroke(c, L.thin * 1.1, C.gold);
      const gl = P((cc) => ell(cc, 0, -12, 20, 24));
      sh(c, gl, C.mirror, C.mirrorShade, L.thin, { dx: 5, dy: 5 });
      c.save(); gl(c); c.clip();
      c.beginPath(); c.moveTo(-19, -1); c.lineTo(0, -36); stroke(c, L.thin * 1.5, 'rgba(255,255,255,0.95)');
      c.beginPath(); c.moveTo(-15, 7); c.lineTo(6, -32); stroke(c, L.thin * 0.8, 'rgba(255,255,255,0.8)');
      const ix = 5, iy = -6;
      c.beginPath(); poly(c, L.small ? [[ix - 1, iy + 1], [10, -26], [22, -12]] : [[ix, iy], [12, -22], [20, -13]]); Art.fs(c, C.shardHole, L.thin);
      const cracks = [[[ix, iy], [-2, -13], [-7, -22], [-10, -38]], [[ix, iy], [-6, -3], [-13, 2], [-23, 3]], [[ix, iy], [0, 6], [-3, 13], [-1, 26]], [[ix, iy], [10, 4], [13, 12], [21, 15]], [[ix + 6, iy - 5], [16, -4], [25, -5]]];
      if (L.small) cracks.length = 3;
      for (const cr of cracks) {
        c.beginPath(); c.moveTo(cr[0][0], cr[0][1]); for (let i = 1; i < cr.length; i++) c.lineTo(cr[i][0], cr[i][1]);
        stroke(c, L.thin * (L.small ? 1.3 : 1.05));
      }
      if (!L.small) for (const cr of cracks) {
        c.beginPath(); c.moveTo(cr[0][0] - 0.8, cr[0][1] - 0.8); for (let i = 1; i < cr.length; i++) c.lineTo(cr[i][0] - 0.8, cr[i][1] - 0.8);
        stroke(c, L.thin * 0.35, 'rgba(255,255,255,0.95)');
      }
      c.restore();
      gl(c); stroke(c, L.thin);
    },
    live(c, L, t, vis) {
      c.translate(2, 2); c.rotate(-0.5);
      const ph = (t * 0.22) % 1;
      if (ph < 0.3) {
        const q = ph / 0.3;
        c.save(); c.beginPath(); ell(c, 0, -12, 20, 24); c.clip();
        c.globalCompositeOperation = 'lighter'; c.globalAlpha *= Math.sin(q * Math.PI) * 0.6 * vis;
        c.beginPath(); const x = -30 + q * 60; poly(c, [[x - 4, 20], [x + 4, 20], [x + 16, -44], [x + 8, -44]]); fill(c, 'rgba(255,255,255,0.9)');
        c.restore();
      }
      const tw = Math.max(0, Math.sin(t * 1.9 + 2));
      twinkle(c, 12, -22, 7 * tw, tw * vis, t * 0.5, '#efe8ff');
    },
  };

  // ---------------- ironheart 鉄の心臓: riveted iron heart with pipes and a red-hot porthole core
  function heartPath(c, k) {
    c.moveTo(0, -25 * k);
    c.bezierCurveTo(6 * k, -36 * k, 14 * k, -41 * k, 22 * k, -41 * k);
    c.bezierCurveTo(35 * k, -41 * k, 44 * k, -30 * k, 44 * k, -15 * k);
    c.bezierCurveTo(44 * k, 10 * k, 20 * k, 28 * k, 0, 45 * k);
    c.bezierCurveTo(-20 * k, 28 * k, -44 * k, 10 * k, -44 * k, -15 * k);
    c.bezierCurveTo(-44 * k, -30 * k, -35 * k, -41 * k, -22 * k, -41 * k);
    c.bezierCurveTo(-14 * k, -41 * k, -6 * k, -36 * k, 0, -25 * k);
    c.closePath();
  }
  R.ironheart = {
    col: '#87859d', glow: 'rgba(255,79,94,0.85)',
    draw(c, L) {
      c.translate(0, 3);
      sh(c, P((cc) => rr(cc, -1, -46, 10, 24, 2)), C.heartIron, C.heartIronShade, L.thin, { dx: -3, dy: 0 });
      sh(c, P((cc) => rr(cc, -3.5, -50, 15, 6, 2)), C.heartBand, C.heartIronShade, L.thin, { dx: -2, dy: -2 });
      c.save(); c.translate(-14, -34); c.rotate(-0.45);
      sh(c, P((cc) => rr(cc, -4, -10, 8, 16, 2)), C.heartIron, C.heartIronShade, L.thin, { dx: -2.5, dy: 0 });
      sh(c, P((cc) => rr(cc, -6, -13, 12, 5, 2)), C.heartBand, C.heartIronShade, L.thin, { dx: -2, dy: -2 });
      c.restore();
      const hp = P((cc) => heartPath(cc, 0.98));
      sh(c, hp, C.heartIron, C.heartIronShade, L.lw, { dx: -8, dy: -8, hi: { x: -25, y: -25, rx: 8, ry: 5, rot: -0.7, color: 'rgba(255,255,255,0.45)' } });
      c.save(); hp(c); c.clip();
      c.beginPath(); c.moveTo(-50, -16); c.quadraticCurveTo(0, -9, 50, -16); c.lineTo(50, -7); c.quadraticCurveTo(0, 0, -50, -7); c.closePath(); Art.fs(c, C.heartBand, L.thin);
      line(c, -44, -12.5, 44, -12.5, L.thin * 0.6, 'rgba(255,255,255,0.45)');
      c.beginPath(); c.moveTo(0, 2); c.quadraticCurveTo(-2, 24, 0, 46); stroke(c, L.thin);
      if (!L.small) {
        for (const x of [-34, -21, 21, 34]) { c.beginPath(); circ(c, x, -11 + Math.abs(x) * -0.03, 2.3); Art.fs(c, '#d6d4e6', L.thin * 0.55); }
        for (const y of [30, 38]) { c.beginPath(); circ(c, -4.5, y, 1.9); circ(c, 4.5, y, 1.9); Art.fs(c, '#c4c2d6', L.thin * 0.5); }
        c.beginPath(); c.moveTo(-34, 6); c.quadraticCurveTo(-26, 16, -14, 24); stroke(c, L.thin * 0.6, 'rgba(26,18,34,0.5)');
      }
      c.restore();
      sh(c, P((cc) => circ(cc, 0, 12, L.small ? 13 : 12)), PAL.brass, PAL.brassDark, L.lw, { dx: -3, dy: -3 });
      c.beginPath(); circ(c, 0, 12, L.small ? 8.8 : 8.2); fill(c, '#7e1022');
      c.beginPath(); circ(c, -1.2, 13, 5.8); fill(c, C.blood);
      c.beginPath(); circ(c, -1.8, 12, 2.6); fill(c, '#ffb8a8');
      c.beginPath(); c.arc(0, 12, 6.2, Math.PI * 1.1, Math.PI * 1.45); stroke(c, L.thin * 0.7, 'rgba(255,255,255,0.85)');
    },
    live(c, L, t, vis) {
      c.translate(0, 3);
      const p = (t * 1.1) % 1, beat = Math.max(Math.exp(-p * 14), 0.75 * Math.exp(-Math.max(0, p - 0.18) * 14) * (p > 0.18 ? 1 : 0));
      Art.glow(c, 0, 12, 18 + beat * 14, 'rgba(255,70,80,0.85)', (0.45 + beat * 0.55) * vis);
    },
  };

  // ---------------- bonedie 骨の賽: carved bone die, red one-pip on top, three facing the light
  const DIE_T = [[0, -40], [36, -21], [0, -2], [-36, -21]], DIE_L = [[-36, -21], [0, -2], [0, 40], [-36, 21]], DIE_R = [[0, -2], [36, -21], [36, 21], [0, 40]];
  const DIE_SIL = [[0, -40], [36, -21], [36, 21], [0, 40], [-36, 21], [-36, -21]];
  const FACE = { T: [[0, -40], [36, 19], [-36, 19]], L: [[-36, -21], [36, 19], [0, 42]], R: [[0, -2], [36, -19], [0, 42]] };
  function facePip(c, F, u, v, r) {
    c.save(); c.transform(F[1][0], F[1][1], F[2][0], F[2][1], F[0][0], F[0][1]);
    c.moveTo(u + r, v); c.arc(u, v, r, 0, TAU); c.closePath();
    c.restore();
  }
  R.bonedie = {
    col: '#efe5cf', glow: 'rgba(255,240,210,0.85)',
    draw(c, L) {
      c.translate(0, 1);
      const sil = P((cc) => roundPoly(cc, DIE_SIL, 7));
      c.save(); sil(c); c.clip();
      c.beginPath(); poly(c, DIE_T); fill(c, C.boneTop);
      c.beginPath(); poly(c, DIE_L); fill(c, C.boneLeft);
      c.beginPath(); poly(c, DIE_R); fill(c, C.boneRight);
      if (!L.small) {
        c.beginPath(); for (let i = 0; i < 14; i++) circ(c, -30 + hash(i * 3.3) * 62, -30 + hash(i * 6.1) * 64, 0.7 + hash(i * 1.7) * 0.6); fill(c, 'rgba(120,92,60,0.35)');
        c.beginPath(); c.moveTo(-28, 18); c.lineTo(-22, 12); c.lineTo(-24, 6); c.moveTo(24, -12); c.lineTo(28, -4); stroke(c, L.thin * 0.5, 'rgba(90,60,40,0.55)');
      }
      const pr = L.small ? 0.13 : 0.105;
      c.beginPath(); facePip(c, FACE.T, 0.5, 0.5, L.small ? 0.2 : 0.17); fill(c, C.pipRed);
      if (!L.small) { c.beginPath(); facePip(c, FACE.T, 0.42, 0.42, 0.05); fill(c, 'rgba(255,220,220,0.85)'); }
      c.beginPath(); for (const q of [0.24, 0.5, 0.76]) facePip(c, FACE.L, q, q, pr); fill(c, C.pip);
      c.beginPath(); for (const q of [0.27, 0.73]) facePip(c, FACE.R, q, 1 - q, pr); fill(c, '#2a1a22');
      c.restore();
      c.beginPath(); c.moveTo(-36, -21); c.lineTo(0, -2); c.lineTo(36, -21); c.moveTo(0, -2); c.lineTo(0, 40); stroke(c, L.thin);
      c.beginPath(); c.moveTo(-30, -23.5); c.lineTo(-4, -37); stroke(c, L.thin * 0.9, 'rgba(255,255,255,0.9)');
      c.beginPath(); c.moveTo(-33, -14); c.lineTo(-33, 14); stroke(c, L.thin * 0.7, 'rgba(255,255,255,0.55)');
      sil(c); stroke(c, L.lw);
    },
    live(c, L, t, vis) {
      c.translate(0, 1);
      Art.glow(c, 0, -21, 12, 'rgba(255,60,70,0.7)', (0.25 + 0.2 * Math.sin(t * 2.7)) * vis);
    },
  };

  // ---------------- stardust 星屑の小瓶: little bottle of night sky, star-topped cork
  function bottlePath(c) {
    c.moveTo(-8, -26); c.lineTo(-8, -15);
    c.bezierCurveTo(-20, -13, -22, -6, -22, 4);
    c.lineTo(-22, 26); c.quadraticCurveTo(-22, 38, -10, 38);
    c.lineTo(10, 38); c.quadraticCurveTo(22, 38, 22, 26);
    c.lineTo(22, 4); c.bezierCurveTo(22, -6, 20, -13, 8, -15);
    c.lineTo(8, -26); c.closePath();
  }
  const SD_STARS = [[-9, 13, 6], [8, 26, 4.4], [12, 7, 3.4], [-8, 30, 3.2], [-14, -1, 2.6], [3, 1, 2.3], [16, 19, 2]];
  R.stardust = {
    col: '#fff6d8', glow: 'rgba(255,246,216,0.95)',
    draw(c, L) {
      c.translate(1, 6); c.rotate(0.24);
      const bp = P(bottlePath);
      sh(c, bp, C.vialGlass, C.vialGlassShade, 0, { dx: -5, dy: -5 });
      c.save(); bp(c); c.clip();
      const surf = (cc) => { cc.moveTo(-30, -5); cc.quadraticCurveTo(0, -2, 30, -5); };
      c.beginPath(); surf(c); c.lineTo(30, 50); c.lineTo(-30, 50); c.closePath(); c.clip();
      c.fillStyle = C.nightShade; c.fillRect(-30, -10, 60, 60);
      c.save(); c.translate(-6, -6); bp(c); fill(c, C.night); c.restore();
      const n = L.small ? 3 : SD_STARS.length;
      for (let i = 0; i < n; i++) { const s = SD_STARS[i]; c.beginPath(); sparklePath(c, s[0], s[1], s[2] * (L.small ? 1.45 : 1), 0.24); fill(c, i ? '#fff3c4' : PAL.star); }
      if (!L.small) { c.beginPath(); for (let i = 0; i < 9; i++) circ(c, -18 + hash(i * 4.4) * 36, -1 + hash(i * 8.3) * 36, 0.8); fill(c, 'rgba(255,255,255,0.75)'); }
      c.restore();
      c.save(); bp(c); c.clip(); c.beginPath(); c.moveTo(-30, -5); c.quadraticCurveTo(0, -2, 30, -5); stroke(c, L.thin, '#9aa3f0'); c.restore();
      line(c, -16, 0, -16, 24, L.thin * 1.2, 'rgba(255,255,255,0.7)');
      bp(c); stroke(c, L.lw);
      sh(c, P((cc) => rr(cc, -11, -29, 22, 6, 3)), C.vialLip, C.vialGlass, L.thin, { dx: -2, dy: -2 });
      sh(c, P((cc) => rr(cc, -7, -39, 14, 11, 2.5)), C.cork, C.corkShade, L.thin * 1.2, { dx: -2.5, dy: -2 });
      if (!L.small) band(c, (cc) => { cc.moveTo(-8, -19); cc.quadraticCurveTo(0, -16, 8, -19); }, '#c58bff', 2.6, L.thin * 0.7);
      sh(c, P((cc) => poly(cc, starPts(5, L.small ? 12 : 10.5, L.small ? 5.4 : 4.6, -Math.PI / 2, 0, -44))), PAL.gold, PAL.brass, L.thin * 1.2, { dx: -2, dy: -2 });
    },
    live(c, L, t, vis) {
      c.translate(1, 6); c.rotate(0.24);
      Art.glow(c, 0, 16, 34, 'rgba(150,160,255,0.45)', (0.5 + 0.2 * Math.sin(t * 1.7)) * vis);
      for (let i = 0; i < 4; i++) {
        const s = SD_STARS[i], tw = Math.max(0, Math.sin(t * 2.3 + i * 1.9));
        twinkle(c, s[0], s[1], s[2] * (1.2 + tw * 0.9), tw * 0.9 * vis, t * 0.4 + i, i % 2 ? '#fff3c4' : '#ffffff');
      }
      const tw = Math.max(0, Math.sin(t * 1.6 + 0.5));
      twinkle(c, 14, -44, 6 * tw, tw * vis, -t * 0.7, '#fff3c4');
    },
  };

  // ---------------- hatwax 帽子の蝋: a puddle of purple candle wax shaped like a crooked witch hat, still burning
  R.hatwax = {
    col: '#9c76d2', glow: 'rgba(190,140,255,0.85)',
    draw(c, L) {
      c.translate(-2, 6);
      const brim = P((cc) => Art.blobPath(cc, [[-42, 27], [-30, 21], [-10, 19], [10, 19], [30, 21], [43, 27], [36, 33], [20, 34], [12, 37], [2, 34], [-16, 35], [-26, 38], [-33, 33]], 1));
      sh(c, brim, C.hatWax, C.hatWaxShade, L.lw, { dx: -5, dy: -5 });
      if (!L.small) for (const [x, y, l] of [[-26, 37, 6], [12, 36, 7]]) {
        c.beginPath(); c.moveTo(x - 3, y - 1); c.lineTo(x + 3, y - 1); c.lineTo(x + 2.4, y + l); c.arc(x, y + l, 2.4, 0, Math.PI); c.closePath();
        Art.fs(c, C.hatWax, L.thin * 0.8);
      }
      const cone = P((cc) => { cc.moveTo(-21, 25); cc.bezierCurveTo(-15, 4, -8, -16, -2, -28); cc.quadraticCurveTo(5, -41, 21, -41); cc.quadraticCurveTo(11, -33, 8, -22); cc.bezierCurveTo(12, -4, 16, 12, 20, 25); cc.quadraticCurveTo(0, 30, -21, 25); cc.closePath(); });
      sh(c, cone, C.hatWax, C.hatWaxShade, L.lw, { dx: -6, dy: -5 });
      c.save(); cone(c); c.clip();
      c.beginPath(); c.moveTo(-30, 11); c.quadraticCurveTo(0, 16, 30, 11); c.lineTo(30, 19); c.quadraticCurveTo(0, 24, -30, 19); c.closePath(); Art.fs(c, C.hatBand, L.thin);
      c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(2, -31); c.quadraticCurveTo(-2, -24, -2, -12); c.moveTo(9, -24); c.quadraticCurveTo(9, -14, 11, -5);
      c.lineWidth = L.small ? 6 : 4.5; c.strokeStyle = C.wax; c.stroke();
      c.restore();
      c.beginPath(); circ(c, -2, -12, L.small ? 4 : 3.2); circ(c, 11, -5, L.small ? 3.6 : 2.8); fill(c, C.wax);
      c.beginPath(); c.moveTo(-10, -6); c.quadraticCurveTo(-13, 4, -12, 10); stroke(c, L.thin, 'rgba(255,255,255,0.45)');
      c.restore();
      cone(c); stroke(c, L.lw);
      line(c, 21, -41, 22.5, -47, L.thin * 1.2);
    },
    live(c, L, t, vis) {
      c.translate(-2, 6);
      flame(c, 22.8, -46.5, 11, t, { seed: 1.3, lw: L.thin * 0.8, glowA: 0.85 * vis, glowR: 2.4 });
    },
  };

  // ---------------- fallback: a little amulet
  R._unknown = {
    col: '#ffd257', glow: 'rgba(255,210,87,0.9)',
    draw(c, L) {
      band(c, (cc) => { cc.moveTo(-18, -40); cc.quadraticCurveTo(0, -14, 18, -40); }, PAL.brass, 3, L.thin);
      sh(c, P((cc) => poly(cc, starPts(8, 34, 27, -Math.PI / 2, 0, 6))), PAL.gold, PAL.brass, L.lw, { dx: -5, dy: -5 });
      sh(c, P((cc) => circ(cc, 0, 6, 16)), C.ruby, C.rubyShade, L.thin, { dx: 4, dy: 4 });
      c.beginPath(); poly(c, [[-9, -2], [-2, -7], [2, 0], [-5, 4]]); fill(c, 'rgba(255,255,255,0.75)');
    },
  };

  Art.RELIC_IDS = ['whetstone', 'flint', 'holywater', 'buckler', 'hourglass', 'catbell', 'twinring', 'fang', 'candelabra', 'mirror', 'ironheart', 'bonedie', 'stardust', 'hatwax'];
  Art.RELIC_COLORS = {};
  for (const id of Art.RELIC_IDS) Art.RELIC_COLORS[id] = R[id].col;
  const relicDef = (id) => (Object.prototype.hasOwnProperty.call(R, id) && id !== '_unknown' ? R[id] : R._unknown);

  const RELIC_PAD = 1.36;
  function relicSprite(id, size, res) {
    return cacheGet('r|' + id + '|' + size + '|' + res, () => {
      const px = Math.ceil(size * RELIC_PAD * res), cv = makeCanvas(px), c = cv.getContext('2d');
      const L = relicLW(size), k = L.s * res;
      paintShadowed(c, px, k, (g) => { g.save(); relicDef(id).draw(g, L); g.restore(); }, 3, 5);
      return { cv, W: px / res };
    });
  }

  Art.drawRelic = function (ctx, id, cx, cy, size, opts) {
    if (!ctx || !(size > 0)) return;
    opts = opts || {};
    const def = relicDef(id), key = def === R._unknown ? '_unknown' : id;
    const t = +opts.t || 0, glow = c01(opts.glow), dim = c01(opts.dim);
    cx = +cx || 0; cy = +cy || 0;
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha *= c01(opts.alpha);
    if (glow > 0) {
      const pul = 1 + Math.sin(t * 5) * 0.06;
      Art.glow(ctx, cx, cy, size * 0.85 * pul, def.glow, glow * 0.9);
      rays(ctx, cx, cy, size * (0.95 + glow * 0.25), 10, t * 0.6, def.glow, glow * 0.35, 0.09);
    }
    let drawn = false;
    if (canDOM() && typeof ctx.drawImage === 'function') {
      try {
        const qs = qSize(size), res = resOf(ctx), sk = 'r|' + key + '|' + qs + '|' + res;
        const spr = relicSprite(key, qs, res), W = spr.W * (size / qs);
        ctx.drawImage(spr.cv, cx - W / 2, cy - W / 2, W, W);
        if (dim > 0) { const d = darkSprite(sk, spr); ctx.save(); ctx.globalAlpha *= dim * 0.72; ctx.drawImage(d.cv, cx - W / 2, cy - W / 2, W, W); ctx.restore(); }
        drawn = true;
      } catch (e) { drawn = false; }
    }
    const L = relicLW(size);
    ctx.translate(cx, cy); ctx.scale(L.s, L.s);
    if (!drawn) {
      ctx.save(); def.draw(ctx, L); ctx.restore();
      if (dim > 0) { ctx.save(); ctx.globalAlpha *= dim * 0.6; ctx.beginPath(); circ(ctx, 0, 0, 46); ctx.fillStyle = '#07050f'; ctx.fill(); ctx.restore(); }
    }
    if (def.live) { ctx.save(); def.live(ctx, L, t, 1 - dim * 0.85); ctx.restore(); }
    ctx.restore();
  };

  const RELIC_FIT = 1.14; // relic glyph size inside a relicCanvas of `size` (leaves room for the shadow)
  Art.relicCanvas = function (id, size, res) {
    if (!canDOM() || !(size > 0)) return null;
    res = res > 0 ? clamp(+res, 0.25, 4) : defaultRes();
    const def = relicDef(id), key = def === R._unknown ? '_unknown' : id;
    const cv = cacheGet('R|' + key + '|' + size + '|' + res, () => {
      const px = Math.max(1, Math.round(size * res)), out = makeCanvas(px), c = out.getContext('2d');
      const L = relicLW(size / RELIC_FIT), k = L.s * res;
      paintShadowed(c, px, k, (g) => { g.save(); def.draw(g, L); g.restore(); }, 3, 5);
      if (def.live) { c.save(); c.setTransform(k, 0, 0, k, px / 2, px / 2); def.live(c, L, 0, 1); c.restore(); }
      out.style.width = size + 'px'; out.style.height = size + 'px'; out.className = 'relic-art';
      return out;
    });
    return domCopy(cv);
  };

  // ================================================================ EVENT PROPS
  const E = {};
  function eventLW(size) { const s = size / 100, px = clamp(size * 0.027, 1.2, 3.6); return { s, lw: px / s, thin: (px * 0.62) / s, small: size < 70 }; }

  // ---------------- blood_altar 血の祭壇
  const RUNES = [
    (c, x, y) => { c.moveTo(x, y + 7); c.lineTo(x, y - 7); c.moveTo(x - 5, y - 6); c.lineTo(x, y - 1); c.lineTo(x + 5, y - 6); },
    (c, x, y) => { c.moveTo(x, y - 7); c.lineTo(x + 5, y - 1); c.lineTo(x, y + 4); c.lineTo(x - 5, y - 1); c.closePath(); c.moveTo(x - 4, y + 7); c.lineTo(x, y + 4); c.lineTo(x + 4, y + 7); },
    (c, x, y) => { c.moveTo(x - 3, y - 7); c.lineTo(x - 3, y + 7); c.moveTo(x - 3, y - 4); c.lineTo(x + 4, y); c.lineTo(x - 3, y + 3); },
  ];
  function drip(c, x, y, len, w) { c.moveTo(x - w, y); c.lineTo(x + w, y); c.lineTo(x + w * 0.8, y + len); c.arc(x, y + len, w * 0.8, 0, Math.PI); c.closePath(); }
  E.blood_altar = function (c, L, t) {
    const f = 0.6 + 0.4 * Math.sin(t * 2.4);
    groundShadow(c, 0, 44, 48, 6.5, 0.55);
    Art.glow(c, 0, -6, 66, 'rgba(255,40,60,0.45)', 0.35 + f * 0.3);
    sh(c, P((cc) => rr(cc, -42, 35, 84, 10, 2.5)), C.stone, C.stoneSh, L.lw, { dx: -3, dy: -3 });
    const body = P((cc) => poly(cc, [[-33, 0], [33, 0], [36, 36], [-36, 36]]));
    sh(c, body, C.stone, C.stoneSh, L.lw, { dx: -6, dy: -5 });
    c.save(); body(c); c.clip();
    c.beginPath(); c.moveTo(-40, 13); c.lineTo(40, 13); c.moveTo(-40, 25); c.lineTo(40, 25);
    for (const [x, y0, y1] of [[-14, 0, 13], [16, 0, 13], [-24, 13, 25], [4, 13, 25], [26, 13, 25], [-8, 25, 37], [18, 25, 37]]) { c.moveTo(x, y0); c.lineTo(x, y1); }
    stroke(c, L.thin * 0.8, C.stoneSh);
    if (!L.small) { c.beginPath(); for (let i = 0; i < 12; i++) circ(c, -30 + hash(i * 3.7) * 60, 2 + hash(i * 8.1) * 32, 0.9); fill(c, 'rgba(255,255,255,0.13)'); }
    c.restore();
    // glowing blood runes
    for (let i = 0; i < 3; i++) {
      const x = -19 + i * 19, y = 19 + (i === 1 ? -1 : 0), g = 0.55 + 0.45 * Math.sin(t * 2.4 - i * 0.9);
      Art.glow(c, x, y, 13, 'rgba(255,50,70,0.8)', g);
      c.beginPath(); RUNES[i](c, x, y); stroke(c, L.thin * 2.2, '#2a0d16');
      c.save(); c.globalAlpha *= 0.55 + g * 0.45; c.beginPath(); RUNES[i](c, x, y); stroke(c, L.thin * 1.05, '#ff6a78'); c.restore();
    }
    // top slab
    sh(c, P((cc) => rr(cc, -45, -10, 90, 12, 3)), C.slab, C.slabSh, L.lw, { dx: -4, dy: -3, hi: { x: -26, y: -7, rx: 12, ry: 1.5, color: 'rgba(255,255,255,0.25)' } });
    // blood pool + drips over the front edge
    c.beginPath(); ell(c, 4, -9.5, 20, 2.6); fill(c, C.bloodDark);
    c.beginPath(); drip(c, -6, 1, 8, 2.2); drip(c, 9, 1, 13, 2.4); drip(c, 19, 1, 5, 1.8); Art.fs(c, C.bloodShade, L.thin * 0.8);
    c.beginPath(); c.moveTo(-8, 1.5); c.lineTo(22, 1.5); stroke(c, L.thin * 1.6, C.bloodShade);
    // candles at the ends
    for (const s of [-1, 1]) {
      const x = s * 36;
      sh(c, P((cc) => rr(cc, x - 4, -25, 8, 15, 2)), '#c9364a', '#8a1f30', L.thin, { dx: -2, dy: 0 });
      line(c, x, -25, x, -28, L.thin * 0.9);
    }
    // chalice
    sh(c, P((cc) => ell(cc, 0, -11, 10, 3)), PAL.gold, PAL.brass, L.thin, { dx: -2, dy: -1 });
    sh(c, P((cc) => rr(cc, -2.6, -25, 5.2, 14, 1.5)), PAL.gold, PAL.brass, L.thin, { dx: -1.5, dy: 0 });
    sh(c, P((cc) => ell(cc, 0, -19, 4.5, 2.6)), PAL.gold, PAL.brass, L.thin * 0.8, { dx: -1, dy: -1 });
    const bowl = P((cc) => { cc.moveTo(-14, -39); cc.quadraticCurveTo(-14, -24, 0, -24); cc.quadraticCurveTo(14, -24, 14, -39); cc.closePath(); });
    sh(c, bowl, PAL.gold, PAL.brass, L.lw, { dx: -4, dy: -3, hi: { x: -8, y: -33, rx: 2.4, ry: 4, rot: 0.3, color: 'rgba(255,255,255,0.6)' } });
    c.beginPath(); ell(c, 0, -39, 14, 3.6); Art.fs(c, '#8e1226', L.thin);
    c.beginPath(); ell(c, -4, -39.6, 5, 1.1); fill(c, 'rgba(255,120,130,0.8)');
    c.beginPath(); drip(c, 10, -38.5, 7, 1.5); fill(c, C.bloodShade);
    if (!L.small) for (const [x, y] of [[-10, -33], [-5, -27], [5, -27], [10, -33]]) { c.beginPath(); circ(c, x, y, 1.6); Art.fs(c, C.ruby, L.thin * 0.5); }
    // live: candle flames, a falling drop, a gleam on the blood
    for (const s of [-1, 1]) flame(c, s * 36, -27.5, 9, t, { seed: s * 2.1 + 3, lw: L.thin * 0.8, glowA: 0.75, glowR: 2.2 });
    const ph = (t / 1.9) % 1;
    if (ph > 0.4) { const q = (ph - 0.4) / 0.6; c.save(); c.globalAlpha *= 1 - q; c.beginPath(); circ(c, 9, 15 + q * q * 26, 1.7); fill(c, C.blood); c.restore(); }
  };

  // ---------------- shared chest pieces
  const CH_WOOD = { wood: '#9c5d31', woodSh: '#6b3b1d', line: 'rgba(40,20,10,0.6)', grain: 'rgba(255,215,160,0.3)', band: PAL.brass, bandSh: PAL.brassDark, hi: 'rgba(255,225,180,0.4)' };
  const CH_DARK = { wood: '#563832', woodSh: '#36201e', line: 'rgba(16,6,10,0.7)', grain: 'rgba(200,160,255,0.16)', band: '#4a4658', bandSh: '#2c2a36', hi: 'rgba(200,170,255,0.3)' };
  function chestBody(c, L, M) {
    sh(c, P((cc) => rr(cc, -40, -2, 80, 40, 4)), M.wood, M.woodSh, L.lw, { dx: -6, dy: -5 });
    c.beginPath(); c.moveTo(-40, 11); c.lineTo(40, 11); c.moveTo(-40, 24); c.lineTo(40, 24); stroke(c, L.thin * 0.8, M.line);
    if (!L.small) {
      c.beginPath();
      for (let i = 0; i < 8; i++) { const x = -34 + hash(i * 5.5) * 64, y = 3 + Math.floor(hash(i * 2.2) * 3) * 13 + 4; c.moveTo(x, y); c.quadraticCurveTo(x + 4, y - 1.5, x + 8, y); }
      stroke(c, L.thin * 0.6, M.grain);
    }
    for (const x of [-26, 26]) sh(c, P((cc) => rr(cc, x - 5, -2, 10, 40, 2)), M.band, M.bandSh, L.thin, { dx: -2.5, dy: 0 });
    for (const s of [-1, 1]) { c.beginPath(); poly(c, [[s * 40, 25], [s * 40, 38], [s * 27, 38]]); Art.fs(c, M.band, L.thin); }
  }
  function lidPath(c, lift) {
    const y = -lift;
    c.moveTo(-41, -2 + y); c.lineTo(-41, -16 + y); c.quadraticCurveTo(-41, -33 + y, -24, -33 + y); c.lineTo(24, -33 + y);
    c.quadraticCurveTo(41, -33 + y, 41, -16 + y); c.lineTo(41, -2 + y); c.closePath();
  }
  function chestLid(c, L, M, lift) {
    const lp = P((cc) => lidPath(cc, lift));
    sh(c, lp, M.wood, M.woodSh, L.lw, { dx: -6, dy: -5 });
    c.save(); lp(c); c.clip();
    line(c, -41, -18 - lift, 41, -18 - lift, L.thin * 0.8, M.line);
    for (const x of [-26, 26]) sh(c, P((cc) => rr(cc, x - 5, -40 - lift, 10, 40, 2)), M.band, M.bandSh, L.thin, { dx: -2.5, dy: 0 });
    c.beginPath(); rr(c, -45, -8 - lift, 90, 6, 1); Art.fs(c, M.band, L.thin);
    c.restore();
    lp(c); stroke(c, L.lw);
    line(c, -31, -29 - lift, -6, -29 - lift, L.thin, M.hi);
  }
  const CHAIN = { base: '#3f3b4d', light: '#a6a1bd' };
  function chain(c, x0, y0, x1, y1, link, L, col) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, n = Math.max(1, Math.round(len / (link * 0.8))), ang = Math.atan2(dy, dx);
    for (const pass of [0, 1]) {
      for (let i = pass; i <= n; i += 2) {
        const f = i / n;
        c.save(); c.translate(x0 + dx * f, y0 + dy * f); c.rotate(ang);
        if (pass === 0) {
          c.beginPath(); c.ellipse(0, 0, link * 0.56, link * 0.36, 0, 0, TAU);
          c.lineWidth = link * 0.26 + L.thin * 2; c.strokeStyle = PAL.ink; c.stroke();
          c.lineWidth = link * 0.26; c.strokeStyle = col.base; c.stroke();
          c.beginPath(); c.ellipse(0, 0, link * 0.56, link * 0.36, 0, Math.PI * 1.05, Math.PI * 1.65); c.lineWidth = link * 0.1; c.strokeStyle = col.light; c.stroke();
        } else {
          c.beginPath(); rr(c, -link * 0.5, -link * 0.14, link, link * 0.28, link * 0.14); Art.fs(c, col.base, L.thin);
          line(c, -link * 0.32, -link * 0.04, link * 0.3, -link * 0.04, link * 0.07, col.light);
        }
        c.restore();
      }
    }
  }

  // ---------------- cursed_chest 呪われた宝箱
  E.cursed_chest = function (c, L, t) {
    const f = 0.55 + 0.45 * Math.sin(t * 2.2);
    groundShadow(c, 0, 41, 47, 6.5, 0.55);
    Art.glow(c, 0, -6, 72, 'rgba(140,90,220,0.5)', 0.4 + f * 0.3);
    chestBody(c, L, CH_DARK);
    chestLid(c, L, CH_DARK, 0);
    // curse sigil on the lid
    c.save(); c.globalAlpha *= 0.6 + f * 0.4;
    Art.glow(c, 0, -19, 14, 'rgba(176,130,255,0.8)', f);
    c.beginPath(); c.moveTo(-10, -19); c.quadraticCurveTo(0, -27, 10, -19); c.quadraticCurveTo(0, -11, -10, -19); c.closePath(); stroke(c, L.thin * 1.1, '#c9a2ff');
    c.beginPath(); circ(c, 0, -19, 2.4); fill(c, '#efe0ff');
    c.restore();
    // violet light leaking from the seam
    c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createLinearGradient(0, -1, 0, -14); g.addColorStop(0, 'rgba(190,140,255,' + (0.6 * f).toFixed(3) + ')'); g.addColorStop(1, 'rgba(190,140,255,0)');
    c.fillStyle = g; c.fillRect(-40, -14, 80, 13);
    c.restore();
    line(c, -39, -2, 39, -2, L.thin * 1.6, PAL.ink);
    c.save(); c.globalAlpha *= 0.5 + f * 0.5; line(c, -38, -2, 38, -2, L.thin * 0.9, '#e2ccff'); c.restore();
    // chains + padlock
    const lk = L.small ? 11 : 8.5;
    chain(c, -43, -27, 43, 33, lk, L, CHAIN);
    chain(c, 43, -27, -43, 33, lk, L, CHAIN);
    if (!L.small) chain(c, -44, 18, 44, 18, 7, L, CHAIN);
    const px = 0, py = 6;
    band(c, (cc) => { cc.moveTo(px - 6.5, py); cc.lineTo(px - 6.5, py - 5); cc.arc(px, py - 5, 6.5, Math.PI, TAU); cc.lineTo(px + 6.5, py); }, '#6a6680', 3.4, L.thin);
    sh(c, P((cc) => rr(cc, px - 10, py - 1, 20, 18, 4)), '#4e4a5e', '#2c2a36', L.lw, { dx: -3, dy: -3, hi: { x: px - 5, y: py + 2, rx: 3, ry: 1.4, color: 'rgba(255,255,255,0.35)' } });
    Art.glow(c, px, py + 9, 12, 'rgba(190,140,255,0.9)', f);
    c.beginPath(); circ(c, px, py + 6.5, 2.6); poly(c, [[px - 1.5, py + 7.5], [px + 1.5, py + 7.5], [px + 2.4, py + 13], [px - 2.4, py + 13]]); fill(c, '#e2ccff');
    // rising curse wisps
    if (!L.small) for (let i = 0; i < 3; i++) {
      const ph = (t * 0.4 + i / 3) % 1, x0 = (i - 1) * 24, y0 = -6 - ph * 40;
      c.save(); c.globalAlpha *= Math.sin(ph * Math.PI) * 0.8;
      Art.curvePath(c, [[x0, y0 + 14], [x0 + Math.sin(t * 2 + i) * 5, y0 + 4], [x0 - Math.sin(t * 2.4 + i) * 6, y0 - 7], [x0 + 3, y0 - 16]], 1);
      c.lineCap = 'round'; c.lineWidth = 3.2; c.strokeStyle = 'rgba(155,123,214,0.9)'; c.stroke();
      c.lineWidth = 1.2; c.strokeStyle = 'rgba(232,214,255,0.9)'; c.stroke();
      c.restore();
    }
  };

  // ---------------- fate_offering 運命の賽銭: offering box with a tiny fortune wheel that wants to spin
  const WHEEL_COLS = [PAL.gold, PAL.heal, PAL.steel, PAL.curse, PAL.gold, PAL.heal, PAL.steel, PAL.curse];
  function shide(c, x, y, L) { // folded paper streamer (zigzag)
    band(c, (cc) => { cc.moveTo(x, y); cc.lineTo(x, y + 5); cc.lineTo(x + 3.4, y + 5); cc.lineTo(x + 3.4, y + 10.5); cc.lineTo(x, y + 10.5); cc.lineTo(x, y + 16); cc.lineTo(x + 3.4, y + 16); cc.lineTo(x + 3.4, y + 20); }, '#f6f1e4', L.small ? 3 : 2.4, L.thin * 0.6);
  }
  function monCoin(c, x, y, rx, L) {
    sh(c, P((cc) => ell(cc, x, y, rx, rx * 0.42)), PAL.gold, PAL.brass, L.thin, { dx: -1.5, dy: -1 });
    c.beginPath(); c.rect(x - rx * 0.22, y - rx * 0.1, rx * 0.44, rx * 0.2); fill(c, PAL.brassDark);
  }
  E.fate_offering = function (c, L, t) {
    groundShadow(c, 0, 44, 46, 6.5, 0.55);
    const wy = -26, wr = 19;
    Art.glow(c, 0, wy, 46, 'rgba(255,210,110,0.5)', 0.55 + 0.2 * Math.sin(t * 2));
    // little A-frame stand
    for (const sd of [-1, 1]) band(c, (cc) => { cc.moveTo(sd * 12, 1); cc.lineTo(0, wy); }, C.post, 3.6, L.thin);
    band(c, (cc) => { cc.moveTo(-8, -6); cc.lineTo(8, -6); }, C.post, 2.6, L.thin * 0.8);
    // box top (slatted grill) + coins
    c.beginPath(); poly(c, [[-39, 7], [-31, -2], [31, -2], [39, 7]]); Art.fs(c, '#5e3720', L.lw);
    c.save(); c.beginPath(); poly(c, [[-39, 7], [-31, -2], [31, -2], [39, 7]]); c.clip();
    c.beginPath(); for (let i = 1; i < 4; i++) { const y = -2 + i * 2.25, w = 31 + i * 2; rr(c, -w + 3, y - 0.6, (w - 3) * 2, 1.2, 0.6); } fill(c, '#1e0f08');
    c.restore();
    monCoin(c, -13, 1.5, 6, L); monCoin(c, 11, 3, 5.5, L);
    // box front
    const front = P((cc) => poly(cc, [[-39, 7], [39, 7], [35, 42], [-35, 42]]));
    sh(c, front, C.wood, C.woodShade, L.lw, { dx: -5, dy: -5 });
    c.save(); front(c); c.clip();
    c.beginPath(); c.moveTo(-40, 24); c.lineTo(40, 24); c.moveTo(-40, 33); c.lineTo(40, 33); stroke(c, L.thin * 0.8, 'rgba(40,20,10,0.6)');
    c.restore();
    for (const s of [-1, 1]) { c.beginPath(); poly(c, [[s * 39, 7], [s * 39, 15], [s * 32, 7]]); poly(c, [[s * 35, 42], [s * 36, 34], [s * 28, 42]]); Art.fs(c, PAL.brass, L.thin); }
    // shimenawa rope + paper streamers
    band(c, (cc) => { cc.moveTo(-38, 10); cc.quadraticCurveTo(0, 19, 38, 10); }, '#d9c08a', L.small ? 5 : 4.4, L.thin);
    if (!L.small) {
      c.beginPath(); for (let i = 0; i < 12; i++) { const f = (i + 0.5) / 12, x = -38 + f * 76, y = 10 + 18 * f * (1 - f); c.moveTo(x - 1.6, y - 1.8); c.lineTo(x + 1.6, y + 1.8); }
      stroke(c, L.thin * 0.6, '#9a7c44');
    }
    shide(c, -15, 15, L); shide(c, 15, 15, L);
    // the wheel
    const rot = t * 0.45 + Math.sin(t * 2.7) * Math.sin(t * 8.3) * 0.12;
    c.save(); c.translate(0, wy); c.rotate(rot);
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * TAU, a1 = ((i + 1) / 8) * TAU;
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, wr - 2, a0, a1); c.closePath(); fill(c, WHEEL_COLS[i]);
    }
    c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; c.moveTo(0, 0); c.lineTo(Math.cos(a) * (wr - 2), Math.sin(a) * (wr - 2)); } stroke(c, L.thin * 0.7);
    if (!L.small) { c.beginPath(); for (let i = 0; i < 8; i++) { const a = ((i + 0.5) / 8) * TAU; circ(c, Math.cos(a) * 11, Math.sin(a) * 11, 1.5); } fill(c, 'rgba(255,255,255,0.85)'); }
    // inner shade crescent (wheel is a shallow dish)
    c.save(); c.beginPath(); circ(c, 0, 0, wr - 2); c.clip(); c.rotate(-rot); c.beginPath(); circ(c, 0, 0, wr - 2); circ(c, -4, -4, wr - 2); c.fillStyle = 'rgba(26,18,34,0.28)'; c.fill('evenodd'); c.restore();
    band(c, (cc) => { cc.moveTo(wr, 0); cc.arc(0, 0, wr, 0, TAU); }, PAL.brass, 3.6, L.thin);
    if (!L.small) { c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; circ(c, Math.cos(a) * wr, Math.sin(a) * wr, 1.5); } fill(c, PAL.brassLight); }
    c.restore();
    c.beginPath(); c.arc(0, wy, wr, Math.PI * 1.05, Math.PI * 1.45); stroke(c, L.thin * 0.8, 'rgba(255,240,190,0.85)');
    sh(c, P((cc) => circ(cc, 0, wy, 4.2)), PAL.brassLight, PAL.brass, L.thin, { dx: -1.5, dy: -1.5 });
    // pointer
    sh(c, P((cc) => poly(cc, [[-5.5, wy - wr - 7], [5.5, wy - wr - 7], [0, wy - wr + 4]])), '#e0453f', '#a82d2f', L.thin, { dx: -1.5, dy: -1.5 });
    // ground coin + a twinkle
    monCoin(c, -27, 45.5, 5, L);
    const tw = Math.max(0, Math.sin(t * 2.4));
    twinkle(c, -9, -1, 6 * tw, tw, t);
  };

  // ---------------- ghost_carver 刻み師の幽霊: a friendly translucent ghost with a chisel and mallet
  function ghostBody(c) {
    c.moveTo(-27, 24);
    c.bezierCurveTo(-31, 2, -31, -41, 0, -42);
    c.bezierCurveTo(31, -41, 31, 2, 27, 24);
    c.quadraticCurveTo(22, 34, 14, 27);
    c.quadraticCurveTo(7, 36, 0, 28);
    c.quadraticCurveTo(-7, 36, -14, 27);
    c.quadraticCurveTo(-22, 34, -27, 24);
    c.closePath();
  }
  function chiselShape(c, L) { // local: handle base at (0,0), broad flat blade pointing to -y
    sh(c, P((cc) => rr(cc, -4.2, -17, 8.4, 20, 3.5)), C.wood, C.woodShade, L.thin * 1.1, { dx: -2, dy: 0 });
    sh(c, P((cc) => rr(cc, -5, -21, 10, 5, 1.8)), PAL.brassLight, PAL.brass, L.thin, { dx: -1.5, dy: 0 });
    sh(c, P((cc) => poly(cc, [[-3, -21], [3, -21], [6.5, -37], [6.5, -42], [-6.5, -42], [-6.5, -37]])), PAL.steel, PAL.steelShade, L.lw * 0.9, { dx: -3, dy: 0 });
    line(c, -6, -37.5, 6, -37.5, L.thin * 0.6, '#6d7a96');
    line(c, -2, -23, -4.2, -36, L.thin * 0.8, PAL.white);
  }
  E.ghost_carver = function (c, L, t) {
    const bob = Math.sin(t * 2.1) * 3, sway = Math.sin(t * 1.3) * 0.045;
    groundShadow(c, 0, 45, 25 - bob * 1.2, 4.2, 0.35);
    Art.glow(c, 0, -6 + bob, 58, 'rgba(170,255,230,0.35)', 0.75);
    c.save(); c.translate(0, bob); c.rotate(sway);
    // tools first (hands grip over them)
    c.save(); c.translate(-31, 4); c.rotate(-0.35);
    sh(c, P((cc) => rr(cc, -2, -22, 4, 24, 1.5)), C.wood, C.woodShade, L.thin, { dx: -1.5, dy: 0 });
    sh(c, P((cc) => rr(cc, -9.5, -32, 19, 11, 3.5)), '#b77a45', C.woodShade, L.lw, { dx: -3, dy: -3 });
    if (!L.small) line(c, -6, -29, 4, -29, L.thin * 0.7, 'rgba(255,230,190,0.6)');
    c.restore();
    c.save(); c.translate(32, 2); c.rotate(0.22); chiselShape(c, L); c.restore();
    // body (translucent toward the hem)
    const body = P(ghostBody);
    const gb = c.createLinearGradient(0, -42, 0, 34); gb.addColorStop(0, 'rgba(238,255,249,0.97)'); gb.addColorStop(0.6, 'rgba(214,250,238,0.9)'); gb.addColorStop(1, 'rgba(190,240,226,0.2)');
    const gs = c.createLinearGradient(0, -42, 0, 34); gs.addColorStop(0, 'rgba(150,214,200,0.95)'); gs.addColorStop(0.6, 'rgba(140,205,192,0.85)'); gs.addColorStop(1, 'rgba(140,205,192,0.15)');
    Art.shape(c, body, gb, gs, { lw: 0, dx: -6, dy: -6 });
    const og = c.createLinearGradient(0, -42, 0, 36); og.addColorStop(0, PAL.ink); og.addColorStop(0.68, 'rgba(26,18,34,0.85)'); og.addColorStop(1, 'rgba(26,18,34,0.08)');
    body(c); c.lineWidth = L.lw; c.strokeStyle = og; c.lineJoin = 'round'; c.stroke();
    // hachimaki headband
    c.save(); body(c); c.clip();
    c.beginPath(); c.moveTo(-40, -27); c.quadraticCurveTo(0, -38, 40, -29); c.lineTo(40, -22); c.quadraticCurveTo(0, -31, -40, -20); c.closePath(); Art.fs(c, '#3b5a9a', L.thin);
    if (!L.small) { c.beginPath(); for (let i = 0; i < 6; i++) { const x = -22 + i * 9; circ(c, x, -27.5 - Math.cos((x / 40) * 1.4) * 2.5, 1.3); } fill(c, 'rgba(255,255,255,0.85)'); }
    c.restore();
    const tl = Math.sin(t * 6) * 2;
    band(c, (cc) => { cc.moveTo(25, -27); cc.quadraticCurveTo(33, -30 + tl, 40, -26 + tl); }, '#3b5a9a', 3.4, L.thin * 0.8);
    band(c, (cc) => { cc.moveTo(25, -26); cc.quadraticCurveTo(32, -21 - tl * 0.6, 38, -18 - tl); }, '#3b5a9a', 3, L.thin * 0.8);
    c.beginPath(); circ(c, 25, -26.5, 3.4); Art.fs(c, '#4a6cb0', L.thin * 0.8);
    // face
    const blink = (((t + 1.6) % 3.7) < 0.12) ? 0.15 : 1;
    for (const s of [-1, 1]) {
      c.beginPath(); ell(c, s * 10, -14, 4.3, 5.6 * blink); fill(c, PAL.ink);
      if (blink > 0.5) { c.beginPath(); circ(c, s * 10 - 1.6, -16.2, 1.7); circ(c, s * 10 + 1.4, -12.4, 0.8); fill(c, PAL.white); }
      c.beginPath(); ell(c, s * 17, -6, 4.4, 2.4); fill(c, 'rgba(255,150,175,0.55)');
    }
    c.beginPath(); c.moveTo(-4.5, -7); c.quadraticCurveTo(0, -2, 4.5, -7); stroke(c, L.thin);
    // little arms (gripping the tools)
    const arm = (x, y, rot) => sh(c, P((cc) => ell(cc, x, y, 8, 5.4, rot)), 'rgba(232,254,247,0.97)', 'rgba(160,220,206,0.95)', L.thin, { dx: -2, dy: -2 });
    arm(-28, 0, 0.5); arm(30, -2, -0.5);
    c.restore();
    // sparkle on the chisel edge + floating motes
    const tw = Math.max(0, Math.sin(t * 2.9));
    const ex = 32 + Math.sin(0.22) * 42, ey = 2 - Math.cos(0.22) * 42 + bob;
    twinkle(c, ex, ey, 7 * tw, tw, t);
    if (!L.small) for (let i = 0; i < 4; i++) {
      const ph = (t * 0.3 + i / 4) % 1, x = (hash(i * 3.3) - 0.5) * 70 + Math.sin(t + i) * 4, y = 30 - ph * 70;
      c.save(); c.globalAlpha *= Math.sin(ph * Math.PI) * 0.8; c.beginPath(); circ(c, x, y, 1.4); fill(c, '#c8fff0'); c.restore();
    }
  };

  // ---------------- mimic_chest 古い宝箱: perfectly ordinary. (The lid breathes. The keyhole looks back.)
  E.mimic_chest = function (c, L, t) {
    const cyc = t % 5.4, br = cyc > 4.3 ? Math.sin(((cyc - 4.3) / 1.1) * Math.PI) : 0;
    const lift = 1.3 + br * 4.2;
    groundShadow(c, 0, 41, 47, 6.5, 0.55);
    if (!L.small) {
      c.beginPath(); for (let i = 0; i < 3; i++) { c.moveTo(22 + i * 4, 40.5); c.quadraticCurveTo(27 + i * 4, 43.5, 31 + i * 4, 46.5); }
      stroke(c, L.thin * 0.8, 'rgba(0,0,0,0.45)');
    }
    monCoin(c, -31, 44, 5, L);
    chestBody(c, L, CH_WOOD);
    // the "gap" under the lid
    c.beginPath(); rr(c, -38, -3 - lift, 76, lift + 2, 1); fill(c, '#14070a');
    if (br > 0.05) Art.glow(c, 0, -3, 34, 'rgba(255,60,50,0.55)', br * 0.7);
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const x = -31 + i * 8.9, hgt = 1.6 + lift * 0.55;
      c.moveTo(x - 2.4, -2); c.lineTo(x, -2 - hgt); c.lineTo(x + 2.4, -2);
      const ux = x + 4.4; c.moveTo(ux - 2.2, -2 - lift); c.lineTo(ux, -2 - lift + hgt * 0.9); c.lineTo(ux + 2.2, -2 - lift);
    }
    fill(c, '#efe5cf');
    if (br > 0.3) { c.beginPath(); c.moveTo(14, -2); c.quadraticCurveTo(16, 3 + br * 3, 15, 6 + br * 4); stroke(c, 1.2, 'rgba(220,235,255,0.7)'); }
    chestLid(c, L, CH_WOOD, lift);
    // hasp on the lid, lock plate on the body
    sh(c, P((cc) => rr(cc, -4, -8 - lift, 8, 9 + lift, 2)), PAL.gold, PAL.brass, L.thin, { dx: -1.5, dy: -1.5 });
    sh(c, P((cc) => rr(cc, -8.5, 1, 17, 16, 3.5)), PAL.gold, PAL.brass, L.thin * 1.2, { dx: -2, dy: -2, hi: { x: -4, y: 3.5, rx: 2.5, ry: 1.2, color: 'rgba(255,255,255,0.6)' } });
    c.beginPath(); circ(c, 0, 7, 2.6); poly(c, [[-1.5, 8], [1.5, 8], [2.3, 13.5], [-2.3, 13.5]]); fill(c, PAL.ink);
    // something in the keyhole looks out, now and then
    const lk = t % 3.9, look = lk > 2.9 && lk < 3.6 ? Math.sin(((lk - 2.9) / 0.7) * Math.PI) : 0;
    if (look > 0.05) {
      Art.glow(c, 0, 7, 8, 'rgba(255,170,60,0.9)', look);
      c.save(); c.globalAlpha *= look; c.beginPath(); ell(c, 0, 7, 1.7, 1.3); fill(c, '#ffb43c'); c.beginPath(); ell(c, 0, 7, 0.45, 1.1); fill(c, PAL.ink); c.restore();
    }
  };

  // ---------------- campfire 焚き火
  E.campfire = function (c, L, t) {
    const fl = 0.85 + Math.sin(t * 8.3) * 0.08 + Math.sin(t * 13.1) * 0.05;
    Art.glow(c, 0, 8, 86 * fl, 'rgba(255,140,60,0.45)', 0.75);
    c.beginPath(); ell(c, 0, 39, 44, 9); fill(c, '#2a1b18');
    c.beginPath(); ell(c, 0, 37, 27, 5.5); fill(c, '#5c2a14');
    Art.glow(c, 0, 36, 32, 'rgba(255,110,40,0.65)', fl * 0.8);
    const stones = [];
    for (let i = 0; i < 11; i++) { const a = (i / 11) * TAU + 0.15; stones.push({ x: Math.cos(a) * 39, y: 37 + Math.sin(a) * 8.5, r: 6.5 + hash(i + 2) * 2.6, back: Math.sin(a) < 0 }); }
    const stone = (s) => sh(c, P((cc) => ell(cc, s.x, s.y, s.r, s.r * 0.7)), '#6c6480', '#433d58', L.thin * 1.2, { dx: -2, dy: -2, hi: { x: s.x - s.r * 0.35, y: s.y - s.r * 0.3, rx: s.r * 0.35, ry: s.r * 0.18, color: 'rgba(255,190,130,0.35)' } });
    stones.filter((s) => s.back).forEach(stone);
    for (const a of [0.36, -0.36]) {
      c.save(); c.translate(0, 31); c.rotate(a);
      sh(c, P((cc) => rr(cc, -37, -6.5, 74, 13, 6.5)), '#8a5232', '#5c321c', L.lw, { dx: -4, dy: -4 });
      if (!L.small) { c.beginPath(); for (const x of [-24, -8, 10, 22]) { c.moveTo(x, -4); c.quadraticCurveTo(x + 4, 0, x + 1, 4); } stroke(c, L.thin * 0.6, 'rgba(40,18,8,0.7)'); }
      const ex = a > 0 ? 33 : -33;
      c.beginPath(); ell(c, ex, 0, 4.4, 6.3); Art.fs(c, '#d6a06a', L.thin * 0.8);
      if (!L.small) { c.beginPath(); ell(c, ex, 0, 1.8, 3); stroke(c, L.thin * 0.5, '#8a5232'); }
      c.restore();
    }
    // embers in the bed
    c.beginPath(); for (let i = 0; i < 9; i++) circ(c, -18 + hash(i * 3.9) * 36, 34 + hash(i * 6.2) * 5, 1.3 + hash(i) * 1); fill(c, PAL.candleMid);
    // flames
    const fo = { glow: false, lw: L.thin, outer: PAL.flame, inner: PAL.flameHot, core: '#fff3c4' };
    flame(c, -11, 33, 30, t, Object.assign({ seed: 1 }, fo));
    flame(c, 12, 33, 34, t, Object.assign({ seed: 2.7 }, fo));
    flame(c, 0, 34, 60 * (0.96 + fl * 0.05), t, Object.assign({ seed: 5, wide: 0.5 }, fo));
    Art.glow(c, 0, 12, 30, 'rgba(255,220,140,0.6)', fl * 0.6);
    stones.filter((s) => !s.back).forEach(stone);
    // sparks + a thread of smoke
    for (let i = 0; i < 8; i++) {
      const ph = (t * 0.6 + i / 8) % 1, x = Math.sin(i * 2.1 + t * 2) * 12 + (hash(i) - 0.5) * 10, y = -6 - ph * 50;
      c.save(); c.globalAlpha *= 1 - ph; c.beginPath(); circ(c, x, y, 1.6 * (1 - ph * 0.5)); fill(c, ph < 0.5 ? PAL.flameHot : PAL.candleDeep); c.restore();
    }
  };

  // ---------------- fallback: a stone pedestal with a glowing mystery orb
  E._unknown = function (c, L, t) {
    groundShadow(c, 0, 44, 30, 5, 0.5);
    sh(c, P((cc) => poly(cc, [[-16, 10], [16, 10], [20, 42], [-20, 42]])), C.stone, C.stoneSh, L.lw, { dx: -4, dy: -4 });
    sh(c, P((cc) => rr(cc, -22, 2, 44, 9, 2)), C.slab, C.slabSh, L.lw, { dx: -3, dy: -2 });
    Art.glow(c, 0, -14, 34, 'rgba(255,214,140,0.7)', 0.7 + 0.2 * Math.sin(t * 2));
    sh(c, P((cc) => circ(cc, 0, -14, 14)), PAL.candle, PAL.candleMid, L.lw, { dx: -3, dy: -3 });
  };

  Art.EVENT_PROP_IDS = ['blood_altar', 'cursed_chest', 'fate_offering', 'ghost_carver', 'mimic_chest', 'campfire'];
  const eventDef = (id) => (Object.prototype.hasOwnProperty.call(E, id) && id !== '_unknown' ? E[id] : E._unknown);

  Art.drawEventProp = function (ctx, id, cx, cy, size, opts) {
    if (!ctx || !(size > 0)) return;
    opts = opts || {};
    const t = +opts.t || 0, L = eventLW(size);
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha *= c01(opts.alpha);
    ctx.translate(+cx || 0, +cy || 0); ctx.scale(L.s, L.s);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    eventDef(id)(ctx, L, t);
    ctx.restore();
  };

  Art.eventCanvas = function (id, size, res) {
    if (!canDOM() || !(size > 0)) return null;
    res = res > 0 ? clamp(+res, 0.25, 4) : defaultRes();
    const key = eventDef(id) === E._unknown ? '_unknown' : id;
    const cv = cacheGet('E|' + key + '|' + size + '|' + res, () => {
      const px = Math.max(1, Math.round(size * res)), out = makeCanvas(px), c = out.getContext('2d');
      c.setTransform(res, 0, 0, res, 0, 0);
      Art.drawEventProp(c, key, size / 2, size / 2, size, { t: 0 });
      out.style.width = size + 'px'; out.style.height = size + 'px'; out.className = 'event-art';
      return out;
    });
    return domCopy(cv);
  };

  // ================================================================ CHISEL ICON
  function paintChisel(c, L) {
    const chip = P((cc) => poly(cc, [[-44, 22], [-37, 5], [-17, -1], [-4, 11], [-8, 36], [-31, 41]]));
    sh(c, chip, '#a49dc8', '#68619a', L.lw, { dx: -6, dy: -6 });
    c.beginPath(); c.moveTo(-37, 5); c.lineTo(-24, 14); c.lineTo(-4, 11); c.moveTo(-24, 14); c.lineTo(-26, 39); stroke(c, L.thin * 0.7, 'rgba(26,18,34,0.55)');
    c.beginPath(); c.moveTo(-14, 3); c.lineTo(-18, 10); c.lineTo(-15, 16); c.lineTo(-20, 24); stroke(c, L.thin * 1.1);
    c.beginPath(); c.moveTo(-35, 8); c.lineTo(-19, 2); stroke(c, L.thin * 0.8, 'rgba(255,255,255,0.6)');
    for (const [x, y, r, a] of [[-37, -13, 5.5, 0.3], [-24, -25, 4, 1.2], [-47, -2, 3.4, 2.1]]) {
      c.save(); c.translate(x, y); c.rotate(a);
      sh(c, P((cc) => poly(cc, [[-r, -r * 0.4], [r * 0.2, -r], [r, r * 0.3], [-r * 0.2, r * 0.8]])), '#b9b2dc', '#68619a', L.thin, { dx: -1.5, dy: -1.5 });
      c.restore();
    }
    c.save(); c.translate(-13, 2); c.rotate(-0.68);
    sh(c, P((cc) => rr(cc, 38, -9, 27, 18, 6)), C.wood, C.woodShade, L.lw, { dx: 0, dy: -3.5 });
    sh(c, P((cc) => rr(cc, 62, -7.5, 7, 15, 3)), '#5e3720', '#3e2414', L.thin, { dx: 0, dy: -2 });
    sh(c, P((cc) => rr(cc, 32, -8.5, 8, 17, 2)), PAL.brassLight, PAL.brass, L.thin, { dx: 0, dy: -2 });
    sh(c, P((cc) => poly(cc, [[0, -9.5], [8, -9.5], [34, -5.5], [34, 5.5], [8, 9.5], [0, 9.5]])), PAL.steel, PAL.steelShade, L.lw, { dx: 0, dy: -4.5 });
    line(c, 10, -5.2, 32, -3.2, L.thin * 0.8, PAL.white);
    line(c, 8, -9, 8, 9, L.thin * 0.7, C.steelLine);
    c.restore();
    c.beginPath(); poly(c, starPts(4, 14, 3.5, -Math.PI / 4, -13, 0)); Art.fs(c, '#fff6d0', L.thin * 0.8);
    c.beginPath(); for (const [a, r0, r1] of [[-2.4, 17, 25], [-1.75, 16, 23], [-3, 16, 22]]) { c.moveTo(-13 + Math.cos(a) * r0, Math.sin(a) * r0); c.lineTo(-13 + Math.cos(a) * r1, Math.sin(a) * r1); }
    stroke(c, L.thin * 1.1, PAL.flameHot);
    c.beginPath(); c.arc(44, -44, 9, Math.PI * 0.55, Math.PI * 0.95); c.moveTo(44 + Math.cos(Math.PI * 0.45) * 14, -44 + Math.sin(Math.PI * 0.45) * 14); c.arc(44, -44, 14, Math.PI * 0.45, Math.PI * 1.05);
    stroke(c, L.thin, 'rgba(255,240,210,0.75)');
  }
  function iconLW(size) { const s = size / 100, px = clamp(size * 0.068, 1.5, 3.2); return { s, lw: px / s, thin: (px * 0.62) / s, small: size < 44 }; }
  const CHISEL_PAD = 1.14;
  Art.drawChiselIcon = function (ctx, cx, cy, size, opts) {
    if (!ctx || !(size > 0)) return;
    opts = opts || {};
    cx = +cx || 0; cy = +cy || 0;
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha *= c01(opts.alpha);
    const glow = c01(opts.glow);
    if (glow > 0) Art.glow(ctx, cx, cy, size * 0.85, 'rgba(255,214,140,0.85)', glow);
    let drawn = false;
    if (canDOM() && typeof ctx.drawImage === 'function') {
      try {
        const qs = qSize(size), res = resOf(ctx);
        const spr = cacheGet('c|' + qs + '|' + res, () => {
          const px = Math.ceil(qs * CHISEL_PAD * res), cv = makeCanvas(px), c = cv.getContext('2d');
          const L = iconLW(qs), k = L.s * res; c.setTransform(k, 0, 0, k, px / 2, px / 2); paintChisel(c, L);
          return { cv, W: px / res };
        });
        const W = spr.W * (size / qs);
        ctx.drawImage(spr.cv, cx - W / 2, cy - W / 2, W, W);
        drawn = true;
      } catch (e) { drawn = false; }
    }
    if (!drawn) { const L = iconLW(size); ctx.translate(cx, cy); ctx.scale(L.s, L.s); paintChisel(ctx, L); }
    ctx.restore();
  };

  // ================================================================ STAIRS (the "continue / descend" door)
  const STAIR = { stone: '#5a5188', stoneSh: '#3c3566', light: 'rgba(255,190,110,0.95)', glow: 'rgba(255,190,110,0.7)' };
  function archPath(c, x0, x1, top, bottom) {
    const R2 = (x1 - x0) / 2, mx = (x0 + x1) / 2;
    c.moveTo(x0, bottom); c.lineTo(x0, top + R2); c.arc(mx, top + R2, Math.max(0.01, R2), Math.PI, TAU); c.lineTo(x1, bottom); c.closePath();
  }
  // The stairwell is a small 3D model projected through the opening: eye at the arch's spring line, a short
  // landing, then N steps dropping away. Treads are seen from above (risers face away), so each tread shows as a
  // dark band ending in a bright lip, and the tread/wall corners notch inward step by step.
  function stairwell(c, D, k, t, hov, fl) {
    const { ix0, it, ib, iw } = D, W = iw / 2, R = D.R;
    const hy = it + R, E = ib - hy, Hs = E;                 // horizon (eye level) and wall height to the spring line
    const Z0 = 40, Zs = Z0 + 5, run = 12, rise = 9, N = 15, Zend = Zs + N * run;
    const Yf = (Z) => (Z <= Zs ? 0 : -(Z - Zs) * (rise / run));
    const px = (X, Z) => (X * Z0) / Z, py = (Y, Z) => hy + ((E - Y) * Z0) / Z;
    c.fillStyle = '#120a0e'; c.fillRect(ix0 - 2, it - 2, iw + 4, ib - it + 4);
    // tunnel ribs, warmer and brighter toward the light below
    const ribZ = [Z0, Zs, Z0 * 1.45, Z0 * 1.9, Z0 * 2.5, Z0 * 3.3, Z0 * 4.3, Zend];
    const tones = ['#1c1320', '#221722', '#2e1d22', '#3f2522', '#583322', '#7a4724', '#a35f28', '#d48a34'];
    ribZ.forEach((Z, i) => {
      const s = Z0 / Z, yb = py(Yf(Z), Z), ysp = py(Yf(Z) + Hs, Z), r = R * s;
      c.beginPath(); archPath(c, -W * s, W * s, ysp - r, Math.max(yb, ysp) + 2); c.fillStyle = tones[i]; c.fill();
      if (i > 1) {
        c.lineWidth = Math.max(0.6, 1.5 * k * s * 2); c.strokeStyle = 'rgba(12,6,10,0.6)'; c.stroke();
        c.save(); c.beginPath(); c.arc(0, ysp, Math.max(0.01, r), Math.PI * 1.08, Math.PI * 1.92);
        c.lineWidth = Math.max(0.5, 1.1 * k * s * 2); c.strokeStyle = 'rgba(255,190,120,' + (0.1 + i * 0.06).toFixed(3) + ')'; c.stroke(); c.restore();
      }
    });
    // the light at the bottom of the stairs
    const lz = Zend, ls = Z0 / lz, lx = 0, ly = py(Yf(lz) + Hs * 0.45, lz), lr = W * ls * 3.2;
    const g = c.createRadialGradient(lx, ly, 0.5, lx, ly, lr);
    g.addColorStop(0, 'rgba(255,248,220,1)'); g.addColorStop(0.3, 'rgba(255,205,125,0.95)'); g.addColorStop(1, 'rgba(255,150,60,0)');
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 0.85 * fl + hov * 0.15; c.fillStyle = g; c.beginPath(); circ(c, lx, ly, lr); c.fill(); c.restore();
    // treads, far to near (nearer, higher steps cover the ones below)
    const tread = (Y, Zn, Zf, col, lip) => {
      c.beginPath(); poly(c, [[px(-W, Zn), py(Y, Zn)], [px(W, Zn), py(Y, Zn)], [px(W, Zf), py(Y, Zf)], [px(-W, Zf), py(Y, Zf)]]); fill(c, col);
      const yl = py(Y, Zf), x = px(W, Zf);
      c.beginPath(); c.moveTo(-x, yl); c.lineTo(x, yl); c.lineWidth = Math.max(0.7, 2.4 * k * Z0 / Zf); c.strokeStyle = lip; c.lineCap = 'butt'; c.stroke();
    };
    for (let j = N; j >= 1; j--) {
      const d = (j - 1) / (N - 1), Zn = Zs + (j - 1) * run;
      tread(-j * rise, Zn, Zn + run, mix('#33242a', '#a0602c', Math.pow(d, 0.9)), 'rgba(255,214,150,' + (0.45 + d * 0.5).toFixed(3) + ')');
      // the next step down hides in the lip's shadow
      const s0 = Z0 / (Zn + run), yl = py(-j * rise, Zn + run), sh2 = Math.max(0.6, 3.2 * k * s0);
      c.beginPath(); c.rect(px(-W, Zn + run), yl - sh2, 2 * W * s0, sh2); fill(c, 'rgba(10,4,8,' + (0.45 - d * 0.25).toFixed(3) + ')');
    }
    tread(0, Z0, Zs, '#2b2028', 'rgba(255,214,150,0.6)');
    c.beginPath(); c.moveTo(px(-W * 0.35, Z0), py(0, Z0)); c.lineTo(px(-W * 0.35, Zs), py(0, Zs)); c.moveTo(px(W * 0.4, Z0), py(0, Z0)); c.lineTo(px(W * 0.4, Zs), py(0, Zs));
    c.lineWidth = 0.9 * k; c.strokeStyle = 'rgba(8,4,8,0.55)'; c.stroke();
    // stone courses on the near walls (they run level, toward the horizon)
    c.beginPath();
    for (let j = 1; j < 5; j++) { const Y = Hs * (j / 5); for (const s of [-1, 1]) { c.moveTo(px(s * W, Z0), py(Y, Z0)); c.lineTo(px(s * W, Zs * 1.25), py(Y, Zs * 1.25)); } }
    c.lineWidth = 0.9 * k; c.strokeStyle = 'rgba(8,4,8,0.45)'; c.stroke();
    // wall sconce partway down
    const sz = Z0 * 1.7, ss = Z0 / sz, sx = px(-W, sz) + 3 * k * ss, sy = py(Yf(sz) + Hs * 0.62, sz);
    c.beginPath(); rr(c, sx - 2.4 * k * ss, sy, 4.8 * k * ss, 6 * k * ss, 1); fill(c, '#241820');
    flame(c, sx, sy, 10 * k * ss, t, { seed: 2.2, glowR: 3, glowA: 0.6, glowColor: 'rgba(255,160,70,0.5)' });
    // embers drifting up the stairwell toward us
    for (let i = 0; i < 7; i++) {
      const ph = (t * 0.16 + hash(i * 2.3)) % 1, Z = Zend - ph * (Zend - Z0 * 1.05), s = Z0 / Z;
      const x = (hash(i * 3.1) - 0.5) * W * 1.6 * s, y = py(Yf(Z) + Hs * (0.25 + hash(i * 7.7) * 0.6) + ph * 10, Z);
      c.save(); c.globalAlpha *= Math.sin(ph * Math.PI) * 0.9; c.beginPath(); circ(c, x, y, Math.max(0.4, 2.2 * k * s)); fill(c, ph < 0.5 ? PAL.candle : PAL.candleMid); c.restore();
    }
  }

  Art.drawStairs = function (ctx, cx, cy, w, h, t, opts) {
    if (!ctx) return;
    opts = opts || {}; t = +t || 0;
    w = +w || 116; h = +h || 150; cx = +cx || 0; cy = +cy || 0;
    const hov = num(opts.hover), k = w / 120;
    const hw = w / 2, hh = h / 2, ft = w * 0.15, stepH = h * 0.05;
    const D = { hw, hh, ft, ix0: -hw + ft, ix1: hw - ft, it: -hh + ft * 0.9, ib: hh - stepH };
    D.iw = D.ix1 - D.ix0; D.R = D.iw / 2;
    const S = STAIR, fl = 0.86 + Math.sin(t * 7.3) * 0.06 + Math.sin(t * 12.7) * 0.04;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.save(); ctx.globalAlpha *= 0.55 - hov * 0.15; ctx.beginPath(); ell(ctx, 0, hh + 3, hw * (1.08 - hov * 0.05), 8 * k); ctx.fillStyle = '#05030a'; ctx.fill(); ctx.restore();
    ctx.translate(0, -hov * 5);
    Art.glow(ctx, 0, hh * 0.3, w * (0.8 + hov * 0.3), S.glow, 0.2 + hov * 0.35);
    // ---- frame ----
    const outer = (c) => { c.beginPath(); archPath(c, -hw, hw, -hh, hh); };
    sh(ctx, outer, S.stone, S.stoneSh, Art.LW, { dx: -5 * k, dy: -5 * k });
    ctx.save(); outer(ctx); ctx.clip();
    ctx.beginPath();
    const acy = D.it + D.R, n = 7;
    for (let i = 1; i < n; i++) { const a = Math.PI + (i / n) * Math.PI; ctx.moveTo(Math.cos(a) * D.R, acy + Math.sin(a) * D.R); ctx.lineTo(Math.cos(a) * (hw + 4), acy + Math.sin(a) * (hw + 4)); }
    for (let y = acy + 4; y < hh - 6; y += h * 0.13) { ctx.moveTo(-hw, y); ctx.lineTo(D.ix0, y); ctx.moveTo(D.ix1, y); ctx.lineTo(hw, y); }
    stroke(ctx, 1.6 * k, S.stoneSh);
    for (let i = 0; i < 9; i++) { const a = Math.PI + hash(i + 7) * Math.PI; const r2 = D.R + ft * (0.3 + hash(i * 3) * 0.5); ctx.beginPath(); circ(ctx, Math.cos(a) * r2, acy + Math.sin(a) * r2, 1.2 * k); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill(); }
    // warm light from the stairwell washing the lower jambs
    const jg = ctx.createLinearGradient(0, D.ib, 0, D.ib - h * 0.45);
    jg.addColorStop(0, 'rgba(255,170,90,' + (0.3 * fl + hov * 0.15).toFixed(3) + ')'); jg.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = jg; ctx.fillRect(-hw, D.ib - h * 0.45, w, h * 0.45);
    ctx.restore();
    // keystone with a glowing "descend" chevron
    sh(ctx, P((c) => poly(c, [[-9 * k, -hh - 4 * k], [9 * k, -hh - 4 * k], [6.5 * k, D.it + 4 * k], [-6.5 * k, D.it + 4 * k]])), S.stone, S.stoneSh, 2.6, { dx: -2, dy: -2 });
    const ky = (-hh - 4 * k + D.it + 4 * k) / 2, rf = 0.6 + 0.4 * Math.sin(t * 2.2);
    Art.glow(ctx, 0, ky, 10 * k, 'rgba(255,190,110,0.8)', rf * (0.7 + hov * 0.3));
    const chev = (c) => { c.beginPath(); for (const o of [-3.2, 1.6]) { c.moveTo(-3.8 * k, ky + o * k - 1.8 * k); c.lineTo(0, ky + o * k + 1.8 * k); c.lineTo(3.8 * k, ky + o * k - 1.8 * k); } };
    chev(ctx); stroke(ctx, 2.6 * k, '#2a1a20');
    ctx.save(); ctx.globalAlpha *= 0.5 + rf * 0.5; chev(ctx); stroke(ctx, 1.2 * k, '#ffd9a0'); ctx.restore();
    // ---- stairwell ----
    const opening = (c) => { c.beginPath(); archPath(c, D.ix0, D.ix1, D.it, D.ib); };
    ctx.save(); opening(ctx); ctx.clip(); stairwell(ctx, D, k, t, hov, fl); ctx.restore();
    opening(ctx); stroke(ctx, 2.6 * Math.max(0.8, k));
    // ---- light spill over the threshold ----
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= (0.42 + hov * 0.3) * fl;
    const sg = ctx.createLinearGradient(0, D.ib, 0, D.ib + 26 * k); sg.addColorStop(0, S.light); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); poly(ctx, [[D.ix0 + 4, D.ib], [D.ix1 - 4, D.ib], [D.ix1 + 22 * k, D.ib + 26 * k], [D.ix0 - 22 * k, D.ib + 26 * k]]); ctx.fillStyle = sg; ctx.fill();
    ctx.restore();
    // ---- threshold step ----
    sh(ctx, P((c) => rr(c, -hw - 6 * k, hh - stepH, w + 12 * k, stepH + 5 * k, 3 * k)), S.stone, S.stoneSh, 2.6, { dx: -2, dy: -2 });
    line(ctx, D.ix0 + 2, hh - stepH + 1.5 * k, D.ix1 - 2, hh - stepH + 1.5 * k, 1.2 * k, 'rgba(255,200,130,' + (0.35 + hov * 0.3).toFixed(3) + ')');
    // ---- hover rim light ----
    if (hov > 0) {
      ctx.save(); ctx.globalAlpha *= hov;
      outer(ctx); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,225,160,0.9)'; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.4; outer(ctx); ctx.lineWidth = 9; ctx.strokeStyle = S.glow; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };
})();
