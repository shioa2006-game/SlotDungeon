/* EMBERWHEEL — reel symbols & UI icons ("Candlelit Paper Theater").
 *   SD.Art.drawSymbol(ctx, id, cx, cy, size, opts)   ids: blade ward flame heart lantern skull wild
 *        opts: { gilded, cursed, t, glow 0..1, dim 0..1, alpha 0..1 }
 *   SD.Art.symbolCanvas(id, size, opts?, res?)  -> cached <canvas> (size*res px square, glyph fitted) or null (no DOM)
 *   SD.Art.SYMBOL_COLORS  { id: '#hex' }
 *   SD.Art.drawIcon(ctx, name, cx, cy, size, opts)    opts: { glow 0..1, dim 0..1, alpha 0..1, t }
 *   SD.Art.iconCanvas(name, size, res?)          -> cached <canvas> (size*res px square) or null (no DOM)
 * All glyphs are authored in a 100x100 design box centred on (0,0) and scaled to `size`.
 * Static parts are cached per (id,size,gilded,cursed,pixel-scale) on lazily created offscreen canvases;
 * glows / sparkles / wisps are drawn live on top. Without a DOM everything is drawn directly.
 */
(function () {
  'use strict';
  const SD = (globalThis.SD = globalThis.SD || {});
  const Art = (SD.Art = SD.Art || {});
  const PAL = Art.PAL || {};
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const c01 = (v) => clamp(+v || 0, 0, 1);

  // local tones that extend the shared palette (each is a shade/tint of a PAL color)
  const C = {
    steelHi: '#f6f9ff', steelLine: '#6d7a96',
    leather: '#7a4630', leatherShade: '#4e2a1d',
    wardShade: '#3a9cd0', wardLight: '#c6f1ff', wardField: '#2c5d9c', wardFieldShade: '#1d3f70',
    flameShade: '#d4401c', flameHotShade: '#ffb02e', flameCore: '#fff3c4',
    healShade: '#3dbb86', healDeep: '#22865c', crossShade: '#b7ecd6',
    goldShade: '#c9953b', glass: '#ffe7a4', glassCore: '#fff8dc',
    skullShade: '#b39dd8', socket: '#21142f',
    bloodShade: '#b8283a', rust: '#a9653a', rustShade: '#6e3b1f', iron: '#5c5870', ironShade: '#3a3648',
    wood: '#9c5d31', woodShade: '#6b3b1d', ruby: '#e0435a', rubyShade: '#97223a',
    coal: '#3b2630', coalShade: '#24161e', shadow: 'rgba(6,4,14,0.5)',
  };

  // ---------------------------------------------------------------- tiny path helpers (sub-paths, no beginPath)
  function rr(c, x, y, w, h, r) { // clockwise rounded rect sub-path
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function circ(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, Math.max(0.01, r), 0, TAU); c.closePath(); }
  function circCCW(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, Math.max(0.01, r), TAU, 0, true); c.closePath(); }
  function ell(c, x, y, rx, ry, rot) { rot = rot || 0; c.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); c.closePath(); }
  function poly(c, pts) { c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); }
  const P = (fn) => (c) => { c.beginPath(); fn(c); };
  // house-style shape: base + crescent shade + ink (dx/dy default for design space)
  function sh(c, path, base, shade, lw, o) {
    o = o || {};
    Art.shape(c, path, base, shade, { lw: lw, dx: o.dx == null ? -7 : o.dx, dy: o.dy == null ? -7 : o.dy, hi: o.hi });
  }
  // thick stroked band with ink border (rings, handles, chains, '?' glyph)
  function band(c, build, color, w, lw) {
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath(); build(c); c.lineWidth = w + lw * 2; c.strokeStyle = PAL.ink; c.stroke();
    c.beginPath(); build(c); c.lineWidth = w; c.strokeStyle = color; c.stroke();
    c.restore();
  }
  function line(c, x0, y0, x1, y1, lw, color) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); Art.strokeOnly(c, lw, color || PAL.ink); }
  function sparklePath(c, x, y, r, k) {
    k = k || 0.26;
    c.moveTo(x, y - r); c.quadraticCurveTo(x + r * k, y - r * k, x + r, y); c.quadraticCurveTo(x + r * k, y + r * k, x, y + r);
    c.quadraticCurveTo(x - r * k, y + r * k, x - r, y); c.quadraticCurveTo(x - r * k, y - r * k, x, y - r); c.closePath();
  }
  function starPts(n, ro, ri, rot) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) { const a = (rot || -Math.PI / 2) + (i * Math.PI) / n; const r = i % 2 ? ri : ro; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    return pts;
  }
  function gearPts(cx, cy, ro, ri, teeth, rot) {
    const pts = [], n = teeth * 4;
    for (let i = 0; i < n; i++) {
      const a = (rot || 0) + (i / n) * TAU; const r = (i % 4 === 0 || i % 4 === 1) ? ro : ri;
      const off = (i % 4 === 0 || i % 4 === 2) ? -0.12 / teeth * 2 : 0.12 / teeth * 2;
      pts.push([cx + Math.cos(a + off) * r, cy + Math.sin(a + off) * r]);
    }
    return pts;
  }
  // additive rotating light rays (combo / active glow)
  function rays(c, x, y, r, n, rot, color, alpha, width) {
    if (alpha <= 0) return;
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= alpha; c.translate(x, y); c.rotate(rot);
    const g = c.createRadialGradient(0, 0, r * 0.15, 0, 0, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath();
    const w = width || 0.12;
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; c.moveTo(0, 0); c.arc(0, 0, r, a - w, a + w); c.closePath(); }
    c.fill(); c.restore();
  }

  // ================================================================ SYMBOLS
  const SYM = {};

  // ---------------- blade 剣: bold broadsword, steel, diagonal (tip up-right)
  const BLADE_ROT = Math.PI / 4;
  const BL = { dx: -9.5, dy: 0 }; // in the rotated frame this keeps the light coming from the upper-left
  const bladeBlade = (c) => poly(c, [[0, -64], [13.5, -49], [14, 9], [-14, 9], [-13.5, -49]]);
  const bladeGuard = (c) => { rr(c, -31, 8, 62, 12, 6); };
  const bladeGrip = (c) => rr(c, -6.5, 18, 13, 22, 3);
  const bladePommel = (c) => circ(c, 0, 46, 8.5);
  SYM.blade = {
    sil(c) { c.save(); c.rotate(BLADE_ROT); c.beginPath(); bladeBlade(c); bladeGuard(c); bladeGrip(c); bladePommel(c); c.restore(); },
    draw(c, L) {
      c.save(); c.rotate(BLADE_ROT);
      // grip + leather wrap
      sh(c, P(bladeGrip), C.leather, C.leatherShade, L.lw, BL);
      c.beginPath(); for (let y = 22; y <= 38; y += 5.4) { c.moveTo(-6, y + 2.6); c.lineTo(6, y - 2.6); } Art.strokeOnly(c, L.thin * 0.8);
      // pommel
      sh(c, P(bladePommel), PAL.brassLight, PAL.brass, L.lw, { dx: -6, dy: 0, hi: { x: -3, y: 43, rx: 3, ry: 2, color: 'rgba(255,255,255,0.6)' } });
      // blade: two-tone ground steel with a bright bevel on the lit edge
      c.save(); c.beginPath(); bladeBlade(c); c.fillStyle = PAL.steel; c.fill(); c.clip();
      c.beginPath(); c.rect(0, -70, 22, 84); c.fillStyle = PAL.steelShade; c.fill();
      c.beginPath(); poly(c, [[-13.5, -49], [-7.5, -45], [-8, 10], [-14, 10]]); c.fillStyle = C.steelHi; c.fill();
      c.beginPath(); poly(c, [[0, -64], [-13.5, -49], [-7.5, -45], [0, -55]]); c.fillStyle = PAL.white; c.fill();
      c.restore();
      c.beginPath(); bladeBlade(c); Art.strokeOnly(c, L.lw);
      line(c, 0, -55, 0, 6, L.thin * 0.85, C.steelLine);
      // nicks in the edge (character)
      line(c, 13.6, -22, 9.5, -20, L.thin * 0.7);
      // guard with flared quillons
      sh(c, P(bladeGuard), PAL.brass, PAL.brassDark, L.lw, { dx: -8, dy: 0, hi: { x: -16, y: 12, rx: 10, ry: 2, color: 'rgba(255,240,190,0.55)' } });
      c.beginPath(); poly(c, [[0, 6.5], [7, 14], [0, 21.5], [-7, 14]]); Art.fs(c, PAL.knightPlume, L.thin);
      c.beginPath(); circ(c, -2, 12, 1.8); c.fillStyle = 'rgba(255,255,255,0.8)'; c.fill();
      c.restore();
    },
  };

  // ---------------- ward 盾: heater shield, sky-blue rim, chevron field
  function shieldPath(c, k, oy) {
    k = k || 1; oy = oy || 0;
    c.moveTo(-37 * k, -35 * k + oy); c.quadraticCurveTo(0, -46 * k + oy, 37 * k, -35 * k + oy);
    c.bezierCurveTo(38 * k, 4 * k + oy, 26 * k, 29 * k + oy, 0, 48 * k + oy);
    c.bezierCurveTo(-26 * k, 29 * k + oy, -38 * k, 4 * k + oy, -37 * k, -35 * k + oy); c.closePath();
  }
  SYM.ward = {
    sil(c) { c.beginPath(); shieldPath(c, 1, 0); },
    draw(c, L) {
      sh(c, P((cc) => shieldPath(cc, 1, 0)), PAL.ward, C.wardShade, L.lw, { dx: -8, dy: -8 });
      const field = P((cc) => shieldPath(cc, 0.74, -2));
      sh(c, field, C.wardField, C.wardFieldShade, 0, { dx: -6, dy: -6 });
      c.save(); field(c); c.clip();
      sh(c, P((cc) => poly(cc, [[-34, 10], [0, -20], [34, 10], [34, 24], [0, -5], [-34, 24]])), C.wardLight, PAL.ward, L.thin, { dx: -3, dy: -4 });
      c.restore();
      field(c); Art.strokeOnly(c, L.thin);
      // rim rivets
      for (const [x, y] of [[-31.5, -31.5], [31.5, -31.5], [0, 41], [-30, 4], [30, 4]]) { c.beginPath(); circ(c, x, y, 3.3); Art.fs(c, PAL.brassLight, L.thin * 0.75); }
      // rim highlight
      c.beginPath(); c.moveTo(-27, -38.5); c.quadraticCurveTo(-14, -41.5, -2, -41.5); Art.strokeOnly(c, L.thin, 'rgba(255,255,255,0.75)');
      c.beginPath(); c.moveTo(-34, -24); c.bezierCurveTo(-34.5, -10, -33, 0, -29, 12); Art.strokeOnly(c, L.thin * 0.8, 'rgba(255,255,255,0.55)');
    },
  };

  // ---------------- flame 焔: fat three-tongued fireball
  function flameOuter(c) {
    c.moveTo(2, -55);
    c.bezierCurveTo(9, -41, 21, -36, 20, -20);
    c.bezierCurveTo(26, -25, 31, -32, 30, -42);
    c.bezierCurveTo(42, -26, 43, -3, 38, 14);
    c.bezierCurveTo(33, 34, 18, 45, 0, 45);
    c.bezierCurveTo(-19, 45, -36, 33, -38, 12);
    c.bezierCurveTo(-39, -4, -34, -19, -24, -31);
    c.bezierCurveTo(-24, -21, -20, -14, -14, -11);
    c.bezierCurveTo(-17, -30, -9, -43, 2, -55);
    c.closePath();
  }
  function flameInner(c) {
    c.moveTo(4, -27);
    c.bezierCurveTo(9, -14, 23, -8, 23, 12);
    c.bezierCurveTo(23, 28, 13, 36, 0, 36);
    c.bezierCurveTo(-13, 36, -24, 28, -24, 14);
    c.bezierCurveTo(-24, 3, -18, -5, -11, -10);
    c.bezierCurveTo(-9, -2, -5, 2, 0, 3);
    c.bezierCurveTo(-3, -9, -2, -18, 4, -27);
    c.closePath();
  }
  function flameCore(c) {
    c.moveTo(1, 5); c.bezierCurveTo(7, 13, 12, 18, 12, 26); c.bezierCurveTo(12, 33, 6, 37, 0, 37);
    c.bezierCurveTo(-7, 37, -12, 33, -12, 26); c.bezierCurveTo(-12, 18, -5, 12, 1, 5); c.closePath();
  }
  SYM.flame = {
    sil(c) { c.beginPath(); flameOuter(c); },
    draw(c, L) {
      sh(c, P(flameOuter), PAL.flame, C.flameShade, L.lw, { dx: -8, dy: -7 });
      sh(c, P(flameInner), PAL.flameHot, C.flameHotShade, 0, { dx: -5, dy: -5 });
      c.beginPath(); flameCore(c); c.fillStyle = C.flameCore; c.fill();
      // licks of highlight on the tongues
      c.beginPath(); c.moveTo(-3, -42); c.quadraticCurveTo(-10, -30, -9, -20); Art.strokeOnly(c, L.thin, 'rgba(255,236,190,0.85)');
      c.beginPath(); c.moveTo(-31, -9); c.quadraticCurveTo(-33, 6, -27, 18); Art.strokeOnly(c, L.thin, 'rgba(255,236,190,0.7)');
      c.beginPath(); circ(c, -4, 18, 3.2); c.fillStyle = PAL.white; c.fill();
    },
  };

  // ---------------- heart 癒: mint heart with a healing cross
  function heartPath(c, k, oy) {
    k = k || 1; oy = oy || 0;
    c.moveTo(0, -25 * k + oy);
    c.bezierCurveTo(6 * k, -36 * k + oy, 14 * k, -41 * k + oy, 22 * k, -41 * k + oy);
    c.bezierCurveTo(35 * k, -41 * k + oy, 44 * k, -30 * k + oy, 44 * k, -15 * k + oy);
    c.bezierCurveTo(44 * k, 10 * k + oy, 20 * k, 28 * k + oy, 0, 45 * k + oy);
    c.bezierCurveTo(-20 * k, 28 * k + oy, -44 * k, 10 * k + oy, -44 * k, -15 * k + oy);
    c.bezierCurveTo(-44 * k, -30 * k + oy, -35 * k, -41 * k + oy, -22 * k, -41 * k + oy);
    c.bezierCurveTo(-14 * k, -41 * k + oy, -6 * k, -36 * k + oy, 0, -25 * k + oy);
    c.closePath();
  }
  const crossPts = (cx, cy, a, b) => [[cx - a, cy - b], [cx + a, cy - b], [cx + a, cy - a], [cx + b, cy - a], [cx + b, cy + a], [cx + a, cy + a], [cx + a, cy + b], [cx - a, cy + b], [cx - a, cy + a], [cx - b, cy + a], [cx - b, cy - a], [cx - a, cy - a]];
  SYM.heart = {
    sil(c) { c.beginPath(); heartPath(c); },
    draw(c, L) {
      sh(c, P((cc) => heartPath(cc)), PAL.heal, C.healShade, L.lw, { dx: -8, dy: -8, hi: { x: -25, y: -26, rx: 9, ry: 6, rot: -0.7, color: 'rgba(255,255,255,0.55)' } });
      // inner engraved rune line
      c.beginPath(); heartPath(c, 0.78, -1); Art.strokeOnly(c, L.thin * 0.8, 'rgba(34,134,92,0.55)');
      // cross
      sh(c, P((cc) => poly(cc, crossPts(0, -3, 6.8, 18))), '#f4fff9', C.crossShade, L.thin, { dx: -3.5, dy: -3.5 });
      // little sparkle
      c.beginPath(); sparklePath(c, 30, -36, 8); Art.fs(c, PAL.white, L.thin * 0.6);
    },
  };

  // ---------------- lantern 灯: little golden lantern with a glowing core
  const lanternRoof = (c) => poly(c, [[-13, -37], [13, -37], [28, -21], [-28, -21]]);
  const lanternBody = (c) => rr(c, -23, -21, 46, 47, 6);
  const lanternBase = (c) => poly(c, [[-27, 24], [27, 24], [20, 37], [-20, 37]]);
  SYM.lantern = {
    sil(c) { c.beginPath(); circ(c, 0, -45, 11); circ(c, 0, -36, 5.5); lanternRoof(c); lanternBody(c); lanternBase(c); },
    draw(c, L) {
      band(c, (cc) => { cc.arc(0, -45, 8, 0, TAU); }, PAL.gold, 4.2, L.thin);
      sh(c, P((cc) => circ(cc, 0, -36, 5.5)), PAL.gold, C.goldShade, L.thin, { dx: -2, dy: -2 });
      sh(c, P(lanternBody), PAL.gold, C.goldShade, L.lw, { dx: -6, dy: -6 });
      // glass window with the flame
      const glass = P((cc) => rr(cc, -15, -14, 30, 33, 4));
      c.save(); glass(c); c.fillStyle = C.glass; c.fill(); c.clip();
      c.beginPath(); ell(c, 0, 5, 13, 15); c.fillStyle = C.glassCore; c.fill();
      c.beginPath(); c.moveTo(0, -8); c.bezierCurveTo(6, 0, 8, 6, 7, 11); c.bezierCurveTo(6, 16, 3, 18, 0, 18);
      c.bezierCurveTo(-3, 18, -6, 16, -7, 11); c.bezierCurveTo(-8, 6, -6, 0, 0, -8); c.fillStyle = PAL.candleDeep; c.fill();
      c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(3, 5, 4, 9, 3, 12); c.bezierCurveTo(2, 15, -2, 15, -3, 12); c.bezierCurveTo(-4, 9, -3, 5, 0, 0); c.fillStyle = PAL.candle; c.fill();
      c.beginPath(); c.rect(-2, 18, 4, 4); c.fillStyle = PAL.brassDark; c.fill();
      // panes / glints
      c.beginPath(); c.moveTo(-10, -9); c.lineTo(-12, 3); Art.strokeOnly(c, L.thin, 'rgba(255,255,255,0.9)');
      c.restore();
      glass(c); Art.strokeOnly(c, L.thin);
      line(c, 0, -14, 0, -9, L.thin);
      sh(c, P(lanternRoof), PAL.gold, C.goldShade, L.lw, { dx: -6, dy: -5, hi: { x: -10, y: -32, rx: 6, ry: 2, color: 'rgba(255,255,255,0.6)' } });
      sh(c, P((cc) => rr(cc, -30, -24, 60, 6, 3)), PAL.brassLight, PAL.brass, L.thin, { dx: -3, dy: -2 });
      sh(c, P(lanternBase), PAL.gold, C.goldShade, L.lw, { dx: -5, dy: -4 });
      for (const [x, y] of [[-19, -16], [19, -16], [-19, 21], [19, 21]]) { c.beginPath(); circ(c, x, y, 2.1); c.fillStyle = PAL.brassDark; c.fill(); }
      c.beginPath(); c.moveTo(-19, -12); c.lineTo(-19, 14); Art.strokeOnly(c, L.thin * 0.8, 'rgba(255,255,255,0.6)');
    },
  };

  // ---------------- skull 髑髏: cursed bone skull, violet shade + glowing sockets
  function craniumPath(c) {
    c.moveTo(0, -47);
    c.bezierCurveTo(25, -47, 41, -30, 39, -6);
    c.bezierCurveTo(38, 8, 31, 14, 27, 18);
    c.lineTo(25, 27); c.lineTo(-25, 27); c.lineTo(-27, 18);
    c.bezierCurveTo(-31, 14, -38, 8, -39, -6);
    c.bezierCurveTo(-41, -30, -25, -47, 0, -47);
    c.closePath();
  }
  const jawPath = (c) => rr(c, -21, 15, 42, 30, 10);
  function skullFace(c, L, sockColor, pupil) {
    c.beginPath(); ell(c, -15, -4, 11.5, 12.5, -0.3); ell(c, 15, -4, 11.5, 12.5, 0.3); c.fillStyle = sockColor; c.fill(); Art.strokeOnly(c, L.thin);
    if (pupil) {
      c.beginPath(); circ(c, -13.5, -2, 5); circ(c, 13.5, -2, 5); c.fillStyle = pupil; c.fill();
      c.beginPath(); circ(c, -15, -3.6, 1.8); circ(c, 12, -3.6, 1.8); c.fillStyle = PAL.white; c.fill();
    }
    c.beginPath(); poly(c, [[0, 6], [5.5, 15], [-5.5, 15]]); c.fillStyle = sockColor; c.fill(); Art.strokeOnly(c, L.thin * 0.8);
  }
  SYM.skull = {
    sil(c) { c.beginPath(); jawPath(c); craniumPath(c); },
    draw(c, L) {
      sh(c, P(jawPath), PAL.bone, C.skullShade, L.lw, { dx: -6, dy: -5 });
      c.beginPath(); for (const x of [-11, -3.7, 3.7, 11]) { c.moveTo(x, 27); c.lineTo(x, 38); } Art.strokeOnly(c, L.thin * 0.85);
      sh(c, P(craniumPath), PAL.bone, C.skullShade, L.lw, { dx: -8, dy: -7, hi: { x: -19, y: -30, rx: 9, ry: 5, rot: -0.6, color: 'rgba(255,255,255,0.7)' } });
      c.beginPath(); c.moveTo(-25, 27); c.lineTo(25, 27); Art.strokeOnly(c, L.thin);
      c.beginPath(); for (const x of [-12, -4, 4, 12]) { c.moveTo(x, 20); c.lineTo(x, 27); } Art.strokeOnly(c, L.thin * 0.85);
      skullFace(c, L, C.socket, PAL.curse);
      // crack
      c.beginPath(); c.moveTo(13, -46); c.lineTo(9, -36); c.lineTo(15, -30); c.lineTo(11, -22); Art.strokeOnly(c, L.thin);
      // cheek hollows
      c.beginPath(); c.moveTo(-31, 8); c.quadraticCurveTo(-25, 14, -24, 20); Art.strokeOnly(c, L.thin * 0.8, 'rgba(26,18,34,0.55)');
      c.beginPath(); c.moveTo(31, 8); c.quadraticCurveTo(25, 14, 24, 20); Art.strokeOnly(c, L.thin * 0.8, 'rgba(26,18,34,0.55)');
    },
  };

  // ---------------- wild 星: radiant faceted 8-point star, white with prismatic facets
  const WILD_PTS = (() => {
    const pts = [];
    for (let i = 0; i < 16; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 8; const r = i % 4 === 0 ? 52 : i % 4 === 2 ? 31 : 16.5; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    return pts;
  })();
  const wildPath = (c) => poly(c, WILD_PTS);
  SYM.wild = {
    sil(c) { c.beginPath(); wildPath(c); },
    draw(c, L) {
      // prismatic halo ring behind the star
      c.beginPath(); c.arc(0, 0, 36, 0, TAU); Art.strokeOnly(c, 7 + L.thin * 2);
      for (let i = 0; i < 12; i++) {
        c.beginPath(); c.arc(0, 0, 36, (i / 12) * TAU - 0.02, ((i + 1) / 12) * TAU + 0.02);
        c.lineWidth = 7; c.lineCap = 'butt'; c.strokeStyle = 'hsl(' + ((i * 30 + 200) % 360) + ',85%,78%)'; c.stroke();
      }
      c.beginPath(); c.arc(0, 0, 37.5, Math.PI * 1.05, Math.PI * 1.45); Art.strokeOnly(c, 1.6, 'rgba(255,255,255,0.85)');
      c.beginPath(); wildPath(c); c.fillStyle = PAL.star; c.fill();
      for (let i = 0; i < 16; i += 2) {
        const tip = WILD_PTS[i];
        for (const v of [WILD_PTS[(i + 15) % 16], WILD_PTS[(i + 1) % 16]]) {
          const mx = (tip[0] + v[0]) / 3, my = (tip[1] + v[1]) / 3, len = Math.hypot(mx, my) || 1;
          const lit = (-mx * 0.7071 - my * 0.7071) / len;
          // facet normal side: which half of the point we are on
          const cross = tip[0] * v[1] - tip[1] * v[0];
          const facing = lit + (cross > 0 ? 0.35 : -0.35);
          const hue = ((Math.atan2(my, mx) * 180) / Math.PI + 400) % 360;
          const light = facing > 0.25 ? 97 : facing > -0.4 ? 89 : 79;
          c.beginPath(); c.moveTo(0, 0); c.lineTo(tip[0], tip[1]); c.lineTo(v[0], v[1]); c.closePath();
          c.fillStyle = 'hsl(' + hue.toFixed(0) + ',' + (facing > 0.25 ? 70 : 62) + '%,' + light + '%)'; c.fill();
        }
      }
      c.beginPath(); for (let i = 0; i < 16; i += 2) { c.moveTo(0, 0); c.lineTo(WILD_PTS[i][0] * 0.94, WILD_PTS[i][1] * 0.94); }
      Art.strokeOnly(c, L.thin * 0.6, 'rgba(120,96,150,0.55)');
      c.beginPath(); wildPath(c); Art.strokeOnly(c, L.lw);
      c.beginPath(); circ(c, 0, 0, 9); Art.fs(c, PAL.white, L.thin * 0.8);
      c.beginPath(); circ(c, -2.6, -2.6, 3); c.fillStyle = 'hsl(200,90%,80%)'; c.fill();
      c.beginPath(); c.moveTo(-4, -40); c.lineTo(-3, -18); Art.strokeOnly(c, L.thin, 'rgba(255,255,255,0.95)');
      c.beginPath(); c.moveTo(-40, -4); c.lineTo(-18, -3); Art.strokeOnly(c, L.thin, 'rgba(255,255,255,0.95)');
    },
  };

  // ---------------------------------------------------------------- symbol composition
  function symbolLW(size) {
    const s = size / 100, px = clamp(size * 0.052, 1.8, 4.4);
    return { s, lw: px / s, thin: (px * 0.62) / s };
  }
  function paintSymbol(c, id, gilded, cursed, L) {
    const def = SYM[id];
    // carved drop shadow (paper cut-out)
    c.save(); c.translate(3, 5); def.sil(c); c.fillStyle = C.shadow; c.fill(); c.restore();
    if (gilded) { // gold rim around the whole silhouette
      def.sil(c); c.lineJoin = 'round'; c.lineCap = 'round';
      c.lineWidth = 16 + L.lw * 2; c.strokeStyle = PAL.ink; c.stroke();
      c.lineWidth = 16; c.strokeStyle = PAL.brass; c.stroke();
      c.lineWidth = 11; c.strokeStyle = PAL.gold; c.stroke();
      c.lineWidth = 3; c.strokeStyle = '#fff3c0'; c.save(); c.translate(-1.5, -1.5); c.stroke(); c.restore();
    }
    def.draw(c, L);
    if (gilded) {
      c.save(); def.sil(c); c.clip();
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = 'rgba(255,205,90,0.16)'; c.fillRect(-70, -70, 140, 140);
      c.beginPath(); poly(c, [[-70, -18], [-18, -70], [-6, -70], [-70, -6]]); c.fillStyle = 'rgba(255,255,240,0.38)'; c.fill();
      c.restore();
      c.beginPath(); sparklePath(c, 37, -40, 10); Art.fs(c, PAL.white, L.thin * 0.7);
      c.beginPath(); sparklePath(c, -40, 34, 6.5); Art.fs(c, '#fff3c0', L.thin * 0.6);
    }
    if (cursed) {
      c.save(); def.sil(c); c.clip();
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = 'rgba(108,62,184,0.42)'; c.fillRect(-70, -70, 140, 140);
      c.restore();
      // hairline crack with violet light
      c.beginPath(); c.moveTo(-30, -30); c.lineTo(-20, -22); c.lineTo(-23, -12); c.lineTo(-12, -6);
      Art.strokeOnly(c, L.thin * 1.4); Art.strokeOnly(c, L.thin * 0.5, '#d9c2ff');
      // hex badge (marks an enemy-inserted temporary symbol)
      c.beginPath(); circ(c, 33, 33, 12.5); Art.fs(c, PAL.curseDeep, L.thin);
      c.beginPath(); c.moveTo(24.5, 33); c.quadraticCurveTo(33, 25.5, 41.5, 33); c.quadraticCurveTo(33, 40.5, 24.5, 33); c.closePath();
      c.fillStyle = PAL.curse; c.fill();
      c.beginPath(); ell(c, 33, 33, 1.8, 4.2); c.fillStyle = '#f3e6ff'; c.fill();
    }
  }

  // live (animated) overlays, drawn in design space; vis = visibility 0..1
  function liveSymbol(c, id, t, gilded, cursed, vis, L) {
    if (vis <= 0.02) return;
    if (id === 'lantern') {
      const f = 0.75 + Math.sin(t * 9.1) * 0.12 + Math.sin(t * 23.7) * 0.06;
      Art.glow(c, 0, 4, 34, 'rgba(255,214,120,0.75)', f * vis);
      Art.glow(c, 0, 6, 12, 'rgba(255,255,230,0.9)', f * vis);
    } else if (id === 'flame') {
      Art.glow(c, 0, 14, 40, 'rgba(255,150,60,0.45)', (0.6 + Math.sin(t * 7.3) * 0.2) * vis);
      for (let i = 0; i < 3; i++) { // rising sparks
        const ph = (t * 0.9 + i / 3) % 1;
        const x = Math.sin(i * 2.3 + t * 2) * 26 + (i - 1) * 10, y = -30 - ph * 34;
        c.save(); c.globalAlpha *= (1 - ph) * vis; c.beginPath(); circ(c, x, y, 3.2 * (1 - ph * 0.6));
        c.fillStyle = ph < 0.5 ? PAL.flameHot : PAL.candleDeep; c.fill(); c.restore();
      }
    } else if (id === 'skull') {
      const f = 0.7 + Math.sin(t * 4.2) * 0.3;
      Art.glow(c, -13.5, -2, 15, 'rgba(176,130,255,0.85)', f * vis);
      Art.glow(c, 13.5, -2, 15, 'rgba(176,130,255,0.85)', f * vis);
    } else if (id === 'wild') {
      const hue = (t * 70) % 360;
      Art.glow(c, 0, 0, 58, 'hsla(' + hue.toFixed(0) + ',90%,75%,0.35)', vis);
      c.save(); c.beginPath(); wildPath(c); c.clip();
      const sx = ((t * 0.55) % 1.6 - 0.3) * 140 - 70;
      const g = c.createLinearGradient(sx - 18, -60, sx + 18, 60);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 0.6 * vis; c.fillStyle = g; c.fillRect(-60, -60, 120, 120);
      c.restore();
      for (let i = 0; i < 4; i++) {
        const a = t * 0.8 + (i * TAU) / 4 + 0.4, tw = Math.max(0, Math.sin(t * 3.1 + i * 1.9));
        if (tw < 0.05) continue;
        const x = Math.cos(a) * 44, y = Math.sin(a) * 44;
        c.save(); c.globalAlpha *= tw * vis; c.beginPath(); sparklePath(c, x, y, 7 * tw + 2);
        c.fillStyle = 'hsl(' + ((hue + i * 90) % 360).toFixed(0) + ',100%,85%)'; c.fill(); c.restore();
      }
    }
    if (gilded) {
      const tw = Math.max(0, Math.sin(t * 2.6));
      if (tw > 0.02) {
        Art.glow(c, 37, -40, 22 * tw, 'rgba(255,230,140,0.9)', vis);
        c.save(); c.globalAlpha *= tw * vis; c.translate(37, -40); c.rotate(t * 1.5); c.beginPath(); sparklePath(c, 0, 0, 13 * tw, 0.2);
        c.fillStyle = PAL.white; c.fill(); c.restore();
      }
    }
    if (cursed) {
      for (let i = 0; i < 3; i++) { // violet wisps rising
        const ph = (t * 0.45 + i / 3) % 1;
        const x0 = (i - 1) * 22, y0 = -34 - ph * 30;
        c.save(); c.globalAlpha *= Math.sin(ph * Math.PI) * 0.8 * vis;
        Art.curvePath(c, [[x0, y0 + 14], [x0 + Math.sin(t * 2 + i) * 6, y0 + 4], [x0 - Math.sin(t * 2.4 + i) * 7, y0 - 8], [x0 + 3, y0 - 18]], 1);
        c.lineCap = 'round'; c.lineWidth = L.thin * 1.6; c.strokeStyle = 'rgba(155,123,214,0.9)'; c.stroke();
        c.lineWidth = L.thin * 0.6; c.strokeStyle = 'rgba(230,210,255,0.9)'; c.stroke();
        c.restore();
      }
      Art.glow(c, 33, 33, 20, 'rgba(155,123,214,0.6)', (0.5 + Math.sin(t * 3) * 0.3) * vis);
    }
  }

  const GLOW_COL = {
    blade: 'rgba(205,228,255,0.85)', ward: 'rgba(111,211,255,0.85)', flame: 'rgba(255,140,50,0.9)', heart: 'rgba(125,240,180,0.85)',
    lantern: 'rgba(255,210,87,0.95)', skull: 'rgba(155,123,214,0.9)', wild: 'rgba(255,246,216,0.95)',
  };

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
    if (!v) { if (cache.size > 900) cache.clear(); v = make(); cache.set(key, v); }
    return v;
  }
  // pixel scale of the current transform, quantised so animated zooms don't explode the cache
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
  const qSize = (size) => (size <= 24 ? Math.max(4, Math.round(size)) : size <= 96 ? Math.round(size / 2) * 2 : Math.round(size / 4) * 4);
  const SYM_PAD = 1.4;
  // returns { cv, W } : canvas + its logical width (centered on the glyph)
  function symbolSprite(id, size, g, cu, res) {
    return cacheGet('s|' + id + '|' + size + '|' + (g ? 1 : 0) + (cu ? 1 : 0) + '|' + res, () => {
      const px = Math.ceil(size * SYM_PAD * res), cv = makeCanvas(px), c = cv.getContext('2d');
      const L = symbolLW(size), k = L.s * res;
      c.setTransform(k, 0, 0, k, px / 2, px / 2);
      paintSymbol(c, id, g, cu, L);
      return { cv, W: px / res };
    });
  }
  function darkSprite(key, spr) {
    return cacheGet(key + '|dark', () => {
      const cv = makeCanvas(spr.cv.width), c = cv.getContext('2d');
      c.drawImage(spr.cv, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = '#07050f'; c.fillRect(0, 0, cv.width, cv.height);
      return { cv, W: spr.W };
    });
  }

  // ---------------------------------------------------------------- public: symbols
  Art.SYMBOL_IDS = ['blade', 'ward', 'flame', 'heart', 'lantern', 'skull', 'wild'];
  Art.SYMBOL_COLORS = {
    blade: PAL.steel || '#d8e2f0', ward: PAL.ward || '#6fd3ff', flame: PAL.flame || '#ff7a2f', heart: PAL.heal || '#7df0b4',
    lantern: PAL.gold || '#ffd257', skull: PAL.curse || '#9b7bd6', wild: PAL.star || '#fff6d8',
  };

  Art.drawSymbol = function (ctx, id, cx, cy, size, opts) {
    if (!ctx || !(size > 0)) return;
    opts = opts || {};
    if (!SYM[id]) { Art.drawIcon(ctx, 'unknown', cx, cy, size * 0.8, opts); return; }
    const t = +opts.t || 0, glow = c01(opts.glow), dim = c01(opts.dim), g = !!opts.gilded, cu = !!opts.cursed;
    const s = size / 100;
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha *= c01(opts.alpha);
    if (glow > 0) {
      const pul = 1 + Math.sin(t * 5) * 0.06;
      const col = cu ? GLOW_COL.skull : GLOW_COL[id];
      Art.glow(ctx, cx, cy, size * 0.85 * pul, col, glow * 0.9);
      rays(ctx, cx, cy, size * (0.95 + glow * 0.25), 10, t * 0.6, col, glow * 0.35, 0.09);
      if (g) Art.glow(ctx, cx, cy, size * 0.6, 'rgba(255,215,110,0.8)', glow * 0.5);
    }
    let drawn = false;
    if (canDOM() && typeof ctx.drawImage === 'function') {
      try {
        const qs = qSize(size), res = resOf(ctx), key = 's|' + id + '|' + qs + '|' + (g ? 1 : 0) + (cu ? 1 : 0) + '|' + res;
        const spr = symbolSprite(id, qs, g, cu, res), W = spr.W * (size / qs);
        ctx.drawImage(spr.cv, cx - W / 2, cy - W / 2, W, W);
        if (dim > 0) { const d = darkSprite(key, spr); ctx.save(); ctx.globalAlpha *= dim * 0.72; ctx.drawImage(d.cv, cx - W / 2, cy - W / 2, W, W); ctx.restore(); }
        drawn = true;
      } catch (e) { drawn = false; }
    }
    const L = symbolLW(size);
    ctx.translate(cx, cy); ctx.scale(s, s);
    if (!drawn) {
      ctx.save(); paintSymbol(ctx, id, g, cu, L); ctx.restore();
      if (dim > 0) { ctx.save(); SYM[id].sil(ctx); ctx.fillStyle = 'rgba(7,5,15,' + (dim * 0.72).toFixed(3) + ')'; ctx.fill(); ctx.restore(); }
    }
    liveSymbol(ctx, id, t, g, cu, 1 - dim * 0.85, L);
    ctx.restore();
  };

  // A DOM-friendly cached canvas: (size*res)px square, the whole glyph (incl. gilded rim) fitted inside.
  Art.symbolCanvas = function (id, size, opts, res) {
    if (!canDOM() || !(size > 0)) return null;
    opts = opts || {}; res = clamp(+res || 1, 0.25, 4);
    const g = !!opts.gilded, cu = !!opts.cursed;
    if (!SYM[id]) return Art.iconCanvas('unknown', size, res);
    return cacheGet('S|' + id + '|' + size + '|' + (g ? 1 : 0) + (cu ? 1 : 0) + '|' + res, () => {
      const px = Math.round(size * res), cv = makeCanvas(px), c = cv.getContext('2d');
      const gs = size / 1.3, L = symbolLW(gs), k = L.s * res;
      c.setTransform(k, 0, 0, k, px / 2, px / 2);
      paintSymbol(c, id, g, cu, L);
      return cv;
    });
  };

  // ================================================================ ICONS (simpler, same style)
  const ICON = {};
  const IC = { dx: -6, dy: -6 };
  function swordSmall(c, L) {
    sh(c, P((cc) => rr(cc, -5, 16, 10, 16, 2.5)), C.leather, C.leatherShade, L.lw, { dx: -7, dy: 0 });
    sh(c, P((cc) => circ(cc, 0, 37, 6.5)), PAL.brassLight, PAL.brass, L.lw, { dx: -5, dy: 0 });
    const bl = (cc) => poly(cc, [[0, -48], [11, -36], [11.5, 9], [-11.5, 9], [-11, -36]]);
    c.save(); c.beginPath(); bl(c); c.fillStyle = PAL.steel; c.fill(); c.clip();
    c.beginPath(); c.rect(0, -60, 20, 72); c.fillStyle = PAL.steelShade; c.fill(); c.restore();
    c.beginPath(); bl(c); Art.strokeOnly(c, L.lw);
    sh(c, P((cc) => rr(cc, -23, 8, 46, 10, 5)), PAL.brass, PAL.brassDark, L.lw, { dx: -7, dy: 0 });
  }
  ICON.attack = (c, L) => {
    sh(c, P((cc) => { cc.moveTo(-44, -24); cc.quadraticCurveTo(30, -34, 40, 40); cc.quadraticCurveTo(14, -6, -44, -24); cc.closePath(); }), PAL.blood, C.bloodShade, L.thin, { dx: -4, dy: -4 });
    c.beginPath(); c.moveTo(-30, -24); c.quadraticCurveTo(20, -24, 33, 22); Art.strokeOnly(c, L.thin * 0.7, 'rgba(255,220,220,0.85)');
    c.save(); c.translate(-4, 4); c.rotate(Math.PI / 4); c.scale(0.92, 0.92); swordSmall(c, L); c.restore();
  };
  function jagPts(x0, y0, x1, y1, w, n) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const a = [], b = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n, px = x0 + dx * f, py = y0 + dy * f, wf = Math.sin(Math.PI * f) * w * 0.5;
      const z = i > 0 && i < n ? (i % 2 ? w * 0.38 : 0) : 0;
      a.push([px + nx * (wf + z), py + ny * (wf + z)]);
      b.unshift([px - nx * wf, py - ny * wf]);
    }
    return a.concat(b);
  }
  ICON.heavy = (c, L) => {
    for (const o of [-14, 14]) {
      const pts = jagPts(30 + o, -42 + o * 0.15, -34 + o, 40 + o * 0.15, 22, 6);
      sh(c, P((cc) => poly(cc, pts)), PAL.blood, C.bloodShade, L.lw, { dx: -4, dy: -4 });
      c.beginPath(); c.moveTo(24 + o, -30); c.lineTo(-26 + o, 30); Art.strokeOnly(c, L.thin * 0.8, 'rgba(255,225,200,0.9)');
    }
    c.beginPath(); sparklePath(c, 36, 30, 9); Art.fs(c, PAL.flameHot, L.thin * 0.7);
  };
  ICON.charge = (c, L) => {
    for (const a0 of [0.35, 0.35 + Math.PI]) {
      band(c, (cc) => cc.arc(0, 2, 38, a0, a0 + 1.9), PAL.candleDeep, 8, L.thin);
      const a1 = a0 + 1.9, x = Math.cos(a1) * 38, y = 2 + Math.sin(a1) * 38, tx = -Math.sin(a1), ty = Math.cos(a1);
      c.beginPath(); poly(c, [[x + tx * 9, y + ty * 9], [x - ty * 9, y + tx * 9], [x + ty * 9, y - tx * 9]]); Art.fs(c, PAL.candleDeep, L.thin);
    }
    sh(c, P((cc) => poly(cc, [[-9, -40], [9, -40], [5.5, 10], [-5.5, 10]])), PAL.flameHot, PAL.candleDeep, L.lw, { dx: -4, dy: -4 });
    sh(c, P((cc) => circ(cc, 0, 27, 8)), PAL.flameHot, PAL.candleDeep, L.lw, { dx: -3, dy: -3 });
  };
  ICON.guard = (c, L) => {
    c.save(); c.scale(0.9, 0.9);
    sh(c, P((cc) => shieldPath(cc, 1, 0)), PAL.steel, PAL.steelShade, L.lw / 0.9, { dx: -8, dy: -8 });
    const field = P((cc) => shieldPath(cc, 0.7, -2));
    sh(c, field, C.wardField, C.wardFieldShade, L.thin / 0.9, { dx: -6, dy: -6 });
    c.save(); field(c); c.clip();
    sh(c, P((cc) => poly(cc, [[-34, 10], [0, -20], [34, 10], [34, 26], [0, -4], [-34, 26]])), PAL.ward, C.wardShade, L.thin / 0.9, { dx: -3, dy: -4 });
    c.restore(); field(c); Art.strokeOnly(c, L.thin / 0.9);
    c.restore();
  };
  ICON.block = (c, L) => {
    const outer = (cc) => { cc.moveTo(-42, -32); cc.quadraticCurveTo(0, -46, 42, -32); cc.bezierCurveTo(43, 4, 30, 30, 0, 45); cc.bezierCurveTo(-30, 30, -43, 4, -42, -32); cc.closePath(); };
    sh(c, P(outer), PAL.ward, C.wardShade, L.lw, { dx: -7, dy: -7 });
    c.save(); c.translate(0, -1); c.scale(0.74, 0.72);
    sh(c, P(outer), '#e6f7ff', '#b8dcef', L.thin / 0.73, { dx: -5, dy: -5 });
    c.restore();
  };
  ICON.curl = (c, L) => { // rolled-up armoured shell (pill-bug ball)
    const ball = P((cc) => circ(cc, 4, 2, 40));
    sh(c, ball, '#c08a52', '#7e4e2c', L.lw, { dx: -8, dy: -8 });
    c.save(); ball(c); c.clip();
    for (let i = 0; i < 7; i++) { // concentric plates rolling from the tucked head
      const r0 = 18 + i * 13, r1 = r0 + 13;
      c.beginPath(); c.arc(-46, 6, r1, -1.2, 1.2); c.arc(-46, 6, r0, 1.2, -1.2, true); c.closePath();
      c.fillStyle = i % 2 ? 'rgba(255,225,180,0.22)' : 'rgba(60,30,10,0.12)'; c.fill();
      c.beginPath(); c.arc(-46, 6, r1, -1.2, 1.2); Art.strokeOnly(c, L.thin);
      c.beginPath(); c.arc(-46, 6, r1 - 4.5, -0.75, -0.35); Art.strokeOnly(c, L.thin * 0.7, 'rgba(255,240,210,0.75)');
    }
    c.restore();
    ball(c); Art.strokeOnly(c, L.lw);
    // tucked head + antennae peeking out
    sh(c, P((cc) => circ(cc, -34, 10, 9)), '#8a5a34', '#5c381e', L.thin, { dx: -2, dy: -2 });
    c.beginPath(); c.moveTo(-38, 4); c.quadraticCurveTo(-46, -8, -42, -16); c.moveTo(-33, 3); c.quadraticCurveTo(-36, -10, -30, -15); Art.strokeOnly(c, L.thin);
  };
  ICON.grow = (c, L) => {
    sh(c, P((cc) => poly(cc, [[0, -45], [37, -6], [15, -6], [15, 42], [-15, 42], [-15, -6], [-37, -6]])), PAL.blood, C.bloodShade, L.lw, { dx: -6, dy: -6, hi: { x: -6, y: -26, rx: 4, ry: 10, rot: 0.75, color: 'rgba(255,255,255,0.45)' } });
    c.beginPath(); c.moveTo(-15, 12); c.lineTo(15, 12); c.moveTo(-15, 26); c.lineTo(15, 26); Art.strokeOnly(c, L.thin, 'rgba(26,18,34,0.55)');
  };
  ICON.hex = (c, L) => {
    c.beginPath(); for (const a of [-2.2, -1.57, -0.94]) { c.moveTo(Math.cos(a) * 32, Math.sin(a) * 32 - 2); c.lineTo(Math.cos(a) * 45, Math.sin(a) * 45 - 2); } Art.strokeOnly(c, L.thin * 1.2, PAL.curse);
    const eye = (cc) => { cc.moveTo(-45, 6); cc.quadraticCurveTo(0, -34, 45, 6); cc.quadraticCurveTo(0, 44, -45, 6); cc.closePath(); };
    sh(c, P(eye), PAL.curse, PAL.curseDeep, L.lw, { dx: -5, dy: -6 });
    c.beginPath(); circ(c, 0, 6, 16); Art.fs(c, PAL.curseDeep, L.thin);
    c.beginPath(); c.moveTo(0, -8); c.quadraticCurveTo(6, 6, 0, 20); c.quadraticCurveTo(-6, 6, 0, -8); c.closePath(); c.fillStyle = '#f2e2ff'; c.fill();
    c.beginPath(); circ(c, 9, -1, 2.6); c.fillStyle = 'rgba(255,255,255,0.75)'; c.fill();
  };
  ICON.drain = (c, L) => {
    sh(c, P((cc) => circ(cc, -4, 6, 38)), '#3a2752', '#24173a', L.lw, { dx: -5, dy: -5 });
    c.save(); c.beginPath(); circ(c, -4, 6, 36); c.clip();
    c.beginPath(); for (let i = 0; i <= 40; i++) { const a = i * 0.32, r = 2 + i * 0.85; const x = -4 + Math.cos(a) * r, y = 6 + Math.sin(a) * r; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    Art.strokeOnly(c, L.thin * 1.3, PAL.curse); c.restore();
    // ring of teeth
    c.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU, x = -4 + Math.cos(a) * 38, y = 6 + Math.sin(a) * 38, ix = -4 + Math.cos(a) * 29, iy = 6 + Math.sin(a) * 29, px = -Math.sin(a) * 5, py = Math.cos(a) * 5; c.moveTo(x + px, y + py); c.lineTo(ix, iy); c.lineTo(x - px, y - py); c.closePath(); }
    Art.fs(c, PAL.bone, L.thin * 0.8);
    // spark being sucked in
    c.save(); c.translate(30, -30); c.rotate(-0.8 + Math.PI);
    c.beginPath(); c.moveTo(0, -18); c.bezierCurveTo(8, -6, 9, 4, 0, 9); c.bezierCurveTo(-9, 4, -8, -6, 0, -18); c.closePath(); Art.fs(c, PAL.candleMid, L.thin);
    c.beginPath(); circ(c, 0, 2, 3.5); c.fillStyle = PAL.candle; c.fill();
    c.restore();
    c.beginPath(); c.moveTo(42, -18); c.lineTo(30, -12); c.moveTo(38, -38); c.lineTo(32, -24); Art.strokeOnly(c, L.thin, PAL.candleMid);
  };
  const dropPath = (c, k) => { k = k || 1; c.moveTo(0, -45 * k); c.bezierCurveTo(14 * k, -24 * k, 34 * k, -4 * k, 34 * k, 14 * k); c.bezierCurveTo(34 * k, 33 * k, 18 * k, 45 * k, 0, 45 * k); c.bezierCurveTo(-18 * k, 45 * k, -34 * k, 33 * k, -34 * k, 14 * k); c.bezierCurveTo(-34 * k, -4 * k, -14 * k, -24 * k, 0, -45 * k); c.closePath(); };
  ICON.thirst = (c, L) => {
    sh(c, P(dropPath), '#8fd9b8', '#4f9e80', L.lw, { dx: -7, dy: -7, hi: { x: -14, y: 4, rx: 5, ry: 10, rot: 0.3, color: 'rgba(255,255,255,0.5)' } });
    c.beginPath(); c.moveTo(6, -30); c.lineTo(-4, -12); c.lineTo(10, 0); c.lineTo(-6, 16); c.lineTo(4, 30); c.lineTo(-2, 44);
    Art.strokeOnly(c, L.lw); Art.strokeOnly(c, L.thin * 0.4, '#d9fff0');
    c.beginPath(); poly(c, [[24, -12], [36, -6], [30, 4]]); Art.fs(c, '#8fd9b8', L.thin);
  };
  ICON.jam = (c, L) => {
    const gp = gearPts(-6, 6, 38, 29, 9, 0.1);
    sh(c, P((cc) => { poly(cc, gp); circCCW(cc, -6, 6, 10); }), C.rust, C.rustShade, L.lw, { dx: -6, dy: -6 });
    c.beginPath(); circ(c, -6, 6, 19); Art.strokeOnly(c, L.thin, 'rgba(26,18,34,0.6)');
    for (const [x, y, r] of [[-20, -8, 4], [8, 20, 3], [-14, 22, 2.5]]) { c.beginPath(); circ(c, x, y, r); c.fillStyle = '#c98048'; c.fill(); }
    sh(c, P((cc) => poly(cc, [[18, -42], [42, -20], [-2, -6]])), C.iron, C.ironShade, L.lw, { dx: -4, dy: -4 });
    sh(c, P((cc) => poly(cc, [[14, -44], [23, -48], [45, -27], [40, -18]])), '#77748c', C.ironShade, L.thin, { dx: -2, dy: -2 });
    line(c, 22, -40, 6, -12, L.thin * 0.8, 'rgba(255,255,255,0.6)');
  };
  ICON.mark = (c, L) => {
    sh(c, P((cc) => { circ(cc, 0, 0, 42); circCCW(cc, 0, 0, 29); }), PAL.blood, C.bloodShade, L.lw, { dx: -5, dy: -5 });
    c.save(); c.beginPath(); circ(c, 0, 0, 30); c.clip();
    sh(c, P((cc) => { cc.save(); cc.rotate(Math.PI / 4); rr(cc, -7, -44, 14, 88, 2); cc.restore(); }), PAL.blood, C.bloodShade, L.lw, { dx: -4, dy: -4 });
    c.restore();
    c.beginPath(); circ(c, 0, 0, 42); Art.strokeOnly(c, L.lw);
  };
  ICON.reflect = (c, L) => {
    sh(c, P((cc) => rr(cc, -7, 24, 14, 22, 4)), PAL.brass, PAL.brassDark, L.lw, { dx: -4, dy: -3 });
    sh(c, P((cc) => ell(cc, -2, -8, 36, 38)), PAL.brass, PAL.brassDark, L.lw, { dx: -5, dy: -5 });
    sh(c, P((cc) => ell(cc, -2, -8, 26, 28)), '#c8ecff', '#8fc7e8', L.thin, { dx: 5, dy: 5 });
    c.save(); c.beginPath(); ell(c, -2, -8, 26, 28); c.clip();
    c.beginPath(); c.moveTo(-22, 0); c.lineTo(4, -32); c.moveTo(-14, 12); c.lineTo(16, -24); Art.strokeOnly(c, L.thin * 1.3, 'rgba(255,255,255,0.95)');
    c.restore();
    // glare rays bouncing off the glass
    c.beginPath(); c.moveTo(30, -30); c.lineTo(42, -38); c.moveTo(34, -18); c.lineTo(46, -18); c.moveTo(28, -42); c.lineTo(32, -48);
    Art.strokeOnly(c, L.thin * 2.2); Art.strokeOnly(c, L.thin, PAL.ward);
  };
  ICON.heal = (c, L) => {
    sh(c, P((cc) => poly(cc, crossPts(0, 0, 14, 40))), PAL.heal, C.healShade, L.lw, { dx: -7, dy: -7, hi: { x: -5, y: -26, rx: 3.5, ry: 8, color: 'rgba(255,255,255,0.55)' } });
    c.beginPath(); sparklePath(c, 30, -30, 9); Art.fs(c, PAL.white, L.thin * 0.7);
  };
  ICON.doom = (c, L) => {
    const glass = (cc) => { cc.moveTo(-24, -34); cc.lineTo(24, -34); cc.bezierCurveTo(24, -10, 5, -6, 5, 0); cc.bezierCurveTo(5, 6, 24, 10, 24, 34); cc.lineTo(-24, 34); cc.bezierCurveTo(-24, 10, -5, 6, -5, 0); cc.bezierCurveTo(-5, -6, -24, -10, -24, -34); cc.closePath(); };
    sh(c, P(glass), '#d8d0ec', '#a399c4', L.thin, { dx: -4, dy: -4 });
    c.save(); c.beginPath(); glass(c); c.clip();
    c.fillStyle = PAL.blood; c.fillRect(-30, -14, 60, 20);
    c.beginPath(); c.moveTo(-26, 36); c.quadraticCurveTo(0, 8, 26, 36); c.closePath(); c.fill();
    c.fillRect(-1.5, 0, 3, 30);
    c.restore();
    c.beginPath(); glass(c); Art.strokeOnly(c, L.thin);
    for (const x of [-28, 28]) sh(c, P((cc) => rr(cc, x - 3.5, -36, 7, 72, 3)), PAL.brass, PAL.brassDark, L.thin, { dx: -2, dy: 0 });
    sh(c, P((cc) => rr(cc, -36, -45, 72, 12, 5)), PAL.brassLight, PAL.brass, L.lw, { dx: -3, dy: -3 });
    sh(c, P((cc) => rr(cc, -36, 33, 72, 12, 5)), PAL.brassLight, PAL.brass, L.lw, { dx: -3, dy: -3 });
  };
  ICON.seal = (c, L) => {
    band(c, (cc) => { cc.moveTo(-19, 0); cc.lineTo(-19, -16); cc.arc(0, -16, 19, Math.PI, 0); cc.lineTo(19, 0); }, PAL.steelShade, 9, L.thin);
    c.beginPath(); c.moveTo(-21, -18); c.arc(0, -16, 21, Math.PI * 1.05, Math.PI * 1.45); Art.strokeOnly(c, L.thin * 0.8, 'rgba(255,255,255,0.7)');
    sh(c, P((cc) => rr(cc, -32, -6, 64, 50, 10)), PAL.gold, PAL.brass, L.lw, { dx: -6, dy: -6, hi: { x: -20, y: 2, rx: 6, ry: 3, color: 'rgba(255,255,255,0.5)' } });
    c.beginPath(); circ(c, 0, 12, 7); poly(c, [[-4, 14], [4, 14], [6, 32], [-6, 32]]); c.fillStyle = PAL.ink; c.fill();
    for (const [x, y] of [[-24, 2], [24, 2], [-24, 36], [24, 36]]) { c.beginPath(); circ(c, x, y, 2.6); c.fillStyle = PAL.brassDark; c.fill(); }
  };
  const teardrop = (c, k, oy) => { oy = oy || 0; c.moveTo(0, -45 * k + oy); c.bezierCurveTo(14 * k, -21 * k + oy, 30 * k, -3 * k + oy, 30 * k, 16 * k + oy); c.bezierCurveTo(30 * k, 34 * k + oy, 16 * k, 45 * k + oy, 0, 45 * k + oy); c.bezierCurveTo(-16 * k, 45 * k + oy, -30 * k, 34 * k + oy, -30 * k, 16 * k + oy); c.bezierCurveTo(-30 * k, -3 * k + oy, -14 * k, -21 * k + oy, 0, -45 * k + oy); c.closePath(); };
  ICON.spark = (c, L) => { // the spark candle: stubby wax + a fat flame
    const g = c.createRadialGradient(0, -14, 4, 0, -14, 40); g.addColorStop(0, 'rgba(255,190,90,0.5)'); g.addColorStop(1, 'rgba(255,170,80,0)');
    c.fillStyle = g; c.beginPath(); circ(c, 0, -14, 40); c.fill();
    sh(c, P((cc) => ell(cc, 0, 38, 30, 8)), PAL.brass, PAL.brassDark, L.thin, { dx: -3, dy: -2 });
    sh(c, P((cc) => rr(cc, -15, 8, 30, 30, 5)), '#f4e4c4', '#cfb486', L.lw, { dx: -5, dy: 0 });
    c.beginPath(); rr(c, -11, 6, 7, 16, 3.5); rr(c, 4, 6, 7, 11, 3.5); c.fillStyle = '#fcf1da'; c.fill();
    c.save(); c.translate(0, -2);
    c.beginPath(); c.moveTo(1, -44); c.bezierCurveTo(10, -30, 20, -18, 18, -4); c.bezierCurveTo(16, 8, 8, 12, 0, 12);
    c.bezierCurveTo(-9, 12, -17, 7, -17, -4); c.bezierCurveTo(-17, -16, -8, -24, -6, -34); c.bezierCurveTo(-2, -28, 0, -26, 1, -44); c.closePath();
    Art.fs(c, PAL.candleMid, L.lw);
    c.beginPath(); c.moveTo(0, -24); c.bezierCurveTo(6, -14, 10, -8, 9, 0); c.bezierCurveTo(8, 7, 4, 9, 0, 9); c.bezierCurveTo(-5, 9, -9, 6, -9, 0); c.bezierCurveTo(-9, -8, -3, -14, 0, -24); c.closePath();
    c.fillStyle = PAL.candle; c.fill();
    c.restore();
  };
  ICON.ember = (c, L) => {
    const g = c.createRadialGradient(0, 0, 8, 0, 0, 50); g.addColorStop(0, 'rgba(255,120,40,0.55)'); g.addColorStop(1, 'rgba(255,90,30,0)');
    c.fillStyle = g; c.beginPath(); circ(c, 0, 0, 50); c.fill();
    const pts = [[-6, -40], [22, -30], [38, -4], [30, 26], [4, 40], [-26, 32], [-38, 6], [-28, -26]];
    sh(c, P((cc) => poly(cc, pts)), PAL.ember, '#b8381c', L.lw, { dx: -6, dy: -6 });
    c.beginPath(); poly(c, [[-4, -26], [16, -18], [22, 2], [8, 18], [-14, 14], [-22, -6]]); c.fillStyle = PAL.candleMid; c.fill();
    c.beginPath(); poly(c, [[-2, -14], [10, -8], [10, 4], [-6, 6], [-10, -4]]); c.fillStyle = PAL.candle; c.fill();
    c.beginPath(); poly(c, [[22, -30], [38, -4], [30, -2], [20, -20]]); poly(c, [[-26, 32], [-38, 6], [-30, 8], [-20, 24]]); c.fillStyle = 'rgba(70,24,24,0.75)'; c.fill();
    c.beginPath(); c.moveTo(-28, -26); c.lineTo(-22, -6); c.moveTo(30, 26); c.lineTo(8, 18); c.moveTo(4, 40); c.lineTo(8, 18); Art.strokeOnly(c, L.thin * 0.7, 'rgba(120,30,20,0.7)');
    c.beginPath(); sparklePath(c, 34, -36, 7); Art.fs(c, PAL.candle, L.thin * 0.6);
  };
  ICON.hp = (c, L) => {
    sh(c, P((cc) => heartPath(cc, 0.98, 0)), PAL.blood, C.bloodShade, L.lw, { dx: -7, dy: -7, hi: { x: -24, y: -24, rx: 8, ry: 5, rot: -0.7, color: 'rgba(255,255,255,0.6)' } });
  };
  ICON.burn = (c, L) => {
    c.save(); c.scale(0.92, 0.92);
    sh(c, P(flameOuter), '#ff5b36', '#c62d24', L.lw / 0.92, { dx: -7, dy: -7 });
    c.beginPath(); flameInner(c); c.fillStyle = PAL.candleMid; c.fill();
    c.beginPath(); flameCore(c); c.fillStyle = PAL.candle; c.fill();
    c.restore();
  };
  ICON.armor = (c, L) => { // breastplate with pauldrons
    const plate = (cc) => { cc.moveTo(-24, -34); cc.quadraticCurveTo(-12, -38, -12, -40); cc.quadraticCurveTo(0, -24, 12, -40); cc.quadraticCurveTo(12, -38, 24, -34); cc.quadraticCurveTo(18, -14, 26, 2); cc.lineTo(24, 28); cc.quadraticCurveTo(0, 46, -24, 28); cc.lineTo(-26, 2); cc.quadraticCurveTo(-18, -14, -24, -34); cc.closePath(); };
    for (const s of [-1, 1]) sh(c, P((cc) => { cc.moveTo(s * 18, -38); cc.quadraticCurveTo(s * 44, -40, s * 44, -16); cc.quadraticCurveTo(s * 36, -12, s * 26, -6); cc.quadraticCurveTo(s * 22, -22, s * 18, -38); cc.closePath(); }), PAL.steelShade, '#6d7a96', L.lw, { dx: -4, dy: -4 });
    sh(c, P(plate), PAL.steel, PAL.steelShade, L.lw, { dx: -7, dy: -6 });
    c.beginPath(); c.moveTo(0, -26); c.lineTo(0, 37); Art.strokeOnly(c, L.thin, C.steelLine);
    c.beginPath(); c.moveTo(-24, 14); c.quadraticCurveTo(0, 26, 24, 14); Art.strokeOnly(c, L.thin);
    c.beginPath(); c.moveTo(-15, -24); c.quadraticCurveTo(-19, -8, -17, 6); Art.strokeOnly(c, L.thin, 'rgba(255,255,255,0.9)');
    for (const [x, y] of [[-34, -26], [34, -26], [-16, 24], [16, 24]]) { c.beginPath(); circ(c, x, y, 3.2); Art.fs(c, PAL.brassLight, L.thin * 0.6); }
  };
  ICON.stun = (c, L) => {
    c.beginPath(); c.ellipse(0, 14, 42, 15, -0.12, Math.PI, TAU); Art.strokeOnly(c, L.thin * 1.3, 'rgba(255,225,160,0.55)');
    band(c, (cc) => cc.ellipse(0, 14, 42, 15, -0.12, 0, Math.PI), PAL.candle, 4, L.thin * 0.7);
    for (const [x, y, r, rot] of [[-27, 2, 19, -0.3], [10, 22, 15, 0.2], [30, -18, 20, 0.15]]) {
      c.save(); c.translate(x, y - 6); c.rotate(rot);
      sh(c, P((cc) => poly(cc, starPts(5, r, r * 0.5))), PAL.gold, PAL.candleDeep, L.lw * 0.8, { dx: -3, dy: -3 });
      c.restore();
    }
  };
  ICON.unknown = (c, L) => {
    band(c, (cc) => { cc.moveTo(-17, -18); cc.bezierCurveTo(-17, -42, 21, -44, 21, -20); cc.bezierCurveTo(21, -4, 2, -4, 2, 14); }, PAL.candle, 14, L.lw);
    c.beginPath(); c.moveTo(-12, -24); c.bezierCurveTo(-8, -34, 6, -36, 12, -28); Art.strokeOnly(c, L.thin, PAL.white);
    sh(c, P((cc) => circ(cc, 2, 33, 9)), PAL.candle, PAL.candleMid, L.lw, { dx: -3, dy: -3 });
  };
  ICON.relic = (c, L) => {
    c.beginPath(); for (let i = 0; i < 4; i++) { const f = i / 3; ell(c, -26 + f * 18, -42 + f * 16, 4.5, 3, 0.7); ell(c, 26 - f * 18, -42 + f * 16, 4.5, 3, -0.7); }
    Art.strokeOnly(c, L.thin, PAL.brass); Art.strokeOnly(c, L.thin * 0.4, PAL.brassLight);
    sh(c, P((cc) => circ(cc, 0, -18, 6)), PAL.gold, PAL.brass, L.thin, { dx: -2, dy: -2 });
    sh(c, P((cc) => circ(cc, 0, 38, 6)), PAL.gold, PAL.brass, L.thin, { dx: -2, dy: -2 });
    sh(c, P((cc) => poly(cc, starPts(8, 30, 25, -Math.PI / 2).map(([x, y]) => [x, y + 8]))), PAL.gold, PAL.brass, L.lw, { dx: -5, dy: -5 });
    sh(c, P((cc) => circ(cc, 0, 8, 17)), C.ruby, C.rubyShade, L.thin, { dx: 4, dy: 4 });
    c.beginPath(); poly(c, [[-9, 0], [-2, -5], [2, 2], [-5, 6]]); c.fillStyle = 'rgba(255,255,255,0.75)'; c.fill();
  };
  ICON.chest = (c, L) => {
    const lid = (cc) => { cc.moveTo(-42, -6); cc.lineTo(-42, -20); cc.quadraticCurveTo(-42, -38, -22, -38); cc.lineTo(22, -38); cc.quadraticCurveTo(42, -38, 42, -20); cc.lineTo(42, -6); cc.closePath(); };
    sh(c, P((cc) => rr(cc, -42, -8, 84, 48, 4)), C.wood, C.woodShade, L.lw, { dx: -6, dy: -6 });
    c.beginPath(); c.moveTo(-42, 12); c.lineTo(42, 12); c.moveTo(-42, 26); c.lineTo(42, 26); Art.strokeOnly(c, L.thin * 0.7, 'rgba(26,18,34,0.6)');
    sh(c, P(lid), C.wood, C.woodShade, L.lw, { dx: -6, dy: -5 });
    c.beginPath(); c.moveTo(-36, -24); c.lineTo(36, -24); Art.strokeOnly(c, L.thin * 0.7, 'rgba(26,18,34,0.6)');
    for (const x of [-26, 26]) {
      sh(c, P((cc) => rr(cc, x - 5, -37, 10, 77, 2)), PAL.brass, PAL.brassDark, L.thin, { dx: -3, dy: 0 });
    }
    sh(c, P((cc) => rr(cc, -9, -16, 18, 22, 4)), PAL.gold, PAL.brass, L.thin, { dx: -3, dy: -3 });
    c.beginPath(); circ(c, 0, -7, 3); poly(c, [[-2, -6], [2, -6], [3, 2], [-3, 2]]); c.fillStyle = PAL.ink; c.fill();
  };
  ICON.campfire = (c, L) => {
    for (const [x, y] of [[-34, 38], [34, 38], [-20, 42], [20, 42]]) { c.beginPath(); ell(c, x, y, 9, 6); Art.fs(c, PAL.stoneLight, L.thin); }
    for (const a of [0.32, -0.32]) {
      c.save(); c.translate(0, 30); c.rotate(a);
      sh(c, P((cc) => rr(cc, -38, -7, 76, 14, 7)), '#8a5232', '#5c321c', L.lw, { dx: -4, dy: -4 });
      c.beginPath(); ell(c, a > 0 ? 32 : -32, 0, 4.5, 6.5); Art.fs(c, '#d6a06a', L.thin * 0.7);
      c.restore();
    }
    c.save(); c.translate(0, -8); c.scale(0.68, 0.72);
    sh(c, P(flameOuter), PAL.flame, C.flameShade, L.lw / 0.7, { dx: -8, dy: -7 });
    c.beginPath(); flameInner(c); c.fillStyle = PAL.flameHot; c.fill();
    c.beginPath(); flameCore(c); c.fillStyle = C.flameCore; c.fill();
    c.restore();
  };
  ICON.skull = (c, L) => {
    c.save(); c.scale(0.94, 0.94);
    sh(c, P(jawPath), PAL.bone, PAL.boneShade, L.lw / 0.94, { dx: -6, dy: -5 });
    c.beginPath(); for (const x of [-8, 0, 8]) { c.moveTo(x, 27); c.lineTo(x, 38); } Art.strokeOnly(c, L.thin / 0.94);
    sh(c, P(craniumPath), PAL.bone, PAL.boneShade, L.lw / 0.94, { dx: -8, dy: -7, hi: { x: -19, y: -30, rx: 9, ry: 5, rot: -0.6, color: 'rgba(255,255,255,0.7)' } });
    skullFace(c, { thin: L.thin / 0.94 }, PAL.ink, null);
    c.restore();
  };

  Art.ICON_NAMES = Object.keys(ICON);
  const ICON_GLOW = {
    spark: 'rgba(255,190,90,0.9)', ember: 'rgba(255,120,40,0.9)', burn: 'rgba(255,90,50,0.9)', hex: 'rgba(155,123,214,0.9)',
    drain: 'rgba(155,123,214,0.9)', heal: 'rgba(125,240,180,0.9)', hp: 'rgba(255,79,94,0.85)', block: 'rgba(111,211,255,0.85)',
    guard: 'rgba(111,211,255,0.85)', relic: 'rgba(255,210,87,0.9)', doom: 'rgba(255,79,94,0.85)', seal: 'rgba(255,210,87,0.85)',
  };
  function iconLW(size) { const s = size / 100, px = clamp(size * 0.068, 1.5, 3.2); return { s, lw: px / s, thin: (px * 0.62) / s }; }
  function paintIcon(c, name, L) { ICON[name](c, L); }
  const ICON_PAD = 1.12;

  Art.drawIcon = function (ctx, name, cx, cy, size, opts) {
    if (!ctx || !(size > 0)) return;
    opts = opts || {};
    if (!ICON[name]) name = 'unknown';
    const glow = c01(opts.glow), dim = c01(opts.dim), t = +opts.t || 0;
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha *= c01(opts.alpha);
    if (glow > 0) Art.glow(ctx, cx, cy, size * 0.85 * (1 + Math.sin(t * 5) * 0.05), ICON_GLOW[name] || 'rgba(255,214,140,0.85)', glow);
    let drawn = false;
    if (canDOM() && typeof ctx.drawImage === 'function') {
      try {
        const qs = qSize(size), res = resOf(ctx), key = 'i|' + name + '|' + qs + '|' + res;
        const spr = cacheGet(key, () => {
          const px = Math.ceil(qs * ICON_PAD * res), cv = makeCanvas(px), c = cv.getContext('2d');
          const L = iconLW(qs), k = L.s * res; c.setTransform(k, 0, 0, k, px / 2, px / 2); paintIcon(c, name, L);
          return { cv, W: px / res };
        });
        const W = spr.W * (size / qs);
        ctx.drawImage(spr.cv, cx - W / 2, cy - W / 2, W, W);
        if (dim > 0) { const d = darkSprite(key, spr); ctx.globalAlpha *= dim * 0.72; ctx.drawImage(d.cv, cx - W / 2, cy - W / 2, W, W); }
        drawn = true;
      } catch (e) { drawn = false; }
    }
    if (!drawn) {
      const L = iconLW(size);
      ctx.translate(cx, cy); ctx.scale(L.s, L.s); paintIcon(ctx, name, L);
      if (dim > 0) { ctx.globalAlpha *= dim * 0.6; ctx.fillStyle = '#07050f'; ctx.beginPath(); circ(ctx, 0, 0, 46); ctx.fill(); }
    }
    ctx.restore();
  };

  // A DOM-friendly cached canvas: (size*res)px square with the icon fitted inside.
  Art.iconCanvas = function (name, size, res) {
    if (!canDOM() || !(size > 0)) return null;
    if (!ICON[name]) name = 'unknown';
    res = clamp(+res || 1, 0.25, 4);
    return cacheGet('I|' + name + '|' + size + '|' + res, () => {
      const px = Math.round(size * res), cv = makeCanvas(px), c = cv.getContext('2d');
      const L = iconLW(size), k = L.s * res; c.setTransform(k, 0, 0, k, px / 2, px / 2); paintIcon(c, name, L);
      return cv;
    });
  };
})();
