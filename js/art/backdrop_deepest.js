/* EMBERWHEEL — js/art/backdrop_deepest.js
 * 最深の間 (B17): the backstage of the Candlelit Paper Theater (docs/EXPANSION_4C_PLAN.md). Not a scrolling zone: one
 * fixed stage behind the final boss, drawn by acts (opts.act 1..4):
 *   1 糸の段   the dark backstage: fly ropes and sandbags sway, pulleys on the gallery, flats leaning on the wall, one
 *              hanging lamp, the old Ashwheel prop leaning in a corner
 *   2 面の段   the valance has come down: a heap of red cloth on the boards, more light from above
 *   3 祈りの段 a row of votive candles along the back wall, pale shafts of light
 *   4 終幕の段 the back wall torn open on the abyss, where the Ashwheel's shadow turns backwards; paper flakes fall,
 *              the proscenium is cracked
 * Hooks into SD.Art.drawBackground / drawForeground for zone 'deepest' only (every other zone goes on as before).
 * The static paint of each act is rendered once into an offscreen canvas (browser only); ropes, the lamp, flames, the
 * wheel and the flakes are drawn live.
 */
(function () {
  'use strict';
  const SD = (globalThis.SD = globalThis.SD || {});
  const Art = (SD.Art = SD.Art || {});
  const base = { bg: Art.drawBackground, fg: Art.drawForeground, warm: Art.warmBackground };
  if (!base.bg) return;
  const INK = '#1a1222', GOLD = '#e8bf6a', TAU = Math.PI * 2;
  const hash = (n) => (Art.hash ? Art.hash(n) : (Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1);
  const ROPES = [[150, 210, 1], [262, 150, 0], [470, 250, 1], [812, 190, 0], [930, 120, 1], [1150, 230, 1], [1222, 160, 0]];
  const PULLEYS = [150, 262, 470, 640, 812, 930, 1150, 1222];
  const HOLE = [[560, 70], [610, 46], [690, 58], [760, 40], [842, 66], [880, 130], [872, 210], [900, 286], [840, 330], [760, 318], [690, 340], [622, 316], [570, 300], [548, 220], [566, 150]];

  const stroke = (c, w, col) => { c.lineWidth = w; c.strokeStyle = col || INK; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); };
  function radial(c, x, y, r, rgb, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // ------------------------------------------------------------------ static paint (per act)
  function paintStatic(c, W, H, act) {
    const G = H - 72;
    // the back wall: dark planks
    const g = c.createLinearGradient(0, 0, 0, G);
    g.addColorStop(0, '#0b0710'); g.addColorStop(0.55, '#191120'); g.addColorStop(1, '#251a2c');
    c.fillStyle = g; c.fillRect(0, 0, W, G);
    for (let x = 0, i = 0; x < W; x += 54, i++) {
      c.fillStyle = `rgba(${hash(i) < 0.5 ? '40,26,44' : '30,20,36'},${0.35 + hash(i + 7) * 0.25})`; c.fillRect(x, 0, 52, G);
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, G); stroke(c, 2, 'rgba(8,4,12,0.7)');
      for (const ny of [70, 200, 320]) { c.beginPath(); c.arc(x + 26, ny + hash(i * 3 + ny) * 20, 1.8, 0, TAU); c.fillStyle = 'rgba(150,110,70,0.35)'; c.fill(); }
    }
    // 終幕の段: the back wall is torn open on the abyss (the wheel itself turns live)
    if (act >= 4) {
      c.save(); c.beginPath(); HOLE.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.clip();
      const v = c.createRadialGradient(720, 190, 10, 720, 190, 240);
      v.addColorStop(0, '#3a1a5a'); v.addColorStop(0.6, '#160a26'); v.addColorStop(1, '#07040c');
      c.fillStyle = v; c.fillRect(500, 20, 440, 340);
      for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(220,190,255,${0.2 + hash(i * 1.7) * 0.5})`; c.fillRect(540 + hash(i * 3.3) * 380, 40 + hash(i * 5.1) * 300, 1.6, 1.6); }
      c.restore();
      // the torn edge: curled paper lit from inside
      c.beginPath(); HOLE.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
      stroke(c, 4, 'rgba(239,229,207,0.55)'); stroke(c, 1.6, INK);
    }
    // the fly gallery: a beam with brass pulleys
    c.fillStyle = '#20151a'; c.fillRect(0, 14, W, 22); c.beginPath(); c.moveTo(0, 36); c.lineTo(W, 36); stroke(c, 2.5);
    for (const px of PULLEYS) {
      c.beginPath(); c.arc(px, 40, 11, 0, TAU); c.fillStyle = '#8a6a3a'; c.fill(); stroke(c, 2);
      c.beginPath(); c.arc(px, 40, 3.5, 0, TAU); c.fillStyle = INK; c.fill();
    }
    // flats leaning on the wall (their backs: frames and canvas; one shows a painted moon)
    flat(c, 36, G, 210, 250, -0.07, true);
    flat(c, 1040, G, 200, 270, 0.06, false);
    // the old Ashwheel prop leaning in the left corner
    c.save(); c.translate(318, G - 92); c.rotate(-0.18);
    c.beginPath(); c.arc(0, 0, 86, 0, TAU); c.fillStyle = '#3a2f36'; c.fill(); stroke(c, 3);
    c.beginPath(); c.arc(0, 0, 70, 0, TAU); stroke(c, 2, 'rgba(232,191,106,0.45)');
    for (let k = 0; k < 8; k++) { const a = k * TAU / 8; c.beginPath(); c.moveTo(Math.cos(a) * 14, Math.sin(a) * 14); c.lineTo(Math.cos(a) * 70, Math.sin(a) * 70); stroke(c, 2.5, 'rgba(26,18,34,0.9)'); }
    c.beginPath(); c.arc(0, 0, 14, 0, TAU); c.fillStyle = '#5a4630'; c.fill(); stroke(c, 2);
    c.restore();
    // 面の段 on: the valance lies in a heap on the right of the boards
    if (act >= 2) {
      c.beginPath(); c.moveTo(1040, G + 6); c.quadraticCurveTo(1070, G - 40, 1120, G - 28); c.quadraticCurveTo(1170, G - 62, 1220, G - 30); c.quadraticCurveTo(1262, G - 36, 1280, G - 10); c.lineTo(1280, G + 10); c.closePath();
      c.fillStyle = '#7a1e30'; c.fill(); stroke(c, 2.5);
      c.beginPath(); c.moveTo(1060, G - 6); c.quadraticCurveTo(1120, G - 24, 1180, G - 16); c.quadraticCurveTo(1230, G - 26, 1274, G - 12); stroke(c, 3, GOLD);
      for (let i = 0; i < 5; i++) { c.beginPath(); c.arc(1080 + i * 44, G - 14 - hash(i) * 10, 3, 0, TAU); c.fillStyle = GOLD; c.fill(); }
    }
    // 祈りの段 on: a low shelf for the votive candles (their flames are live)
    if (act >= 3) {
      c.fillStyle = '#3a2a22'; c.fillRect(380, G - 22, 520, 10); c.beginPath(); c.rect(380, G - 22, 520, 10); stroke(c, 2);
      for (let i = 0; i < 9; i++) { const x = 400 + i * 60; c.fillStyle = '#efe5cf'; c.fillRect(x - 5, G - 40, 10, 18); c.beginPath(); c.rect(x - 5, G - 40, 10, 18); stroke(c, 1.6); }
    }
    // the stage boards
    const f = c.createLinearGradient(0, G, 0, H);
    f.addColorStop(0, '#3a2a28'); f.addColorStop(1, '#1c1418');
    c.fillStyle = f; c.fillRect(0, G, W, H - G);
    c.beginPath(); c.moveTo(0, G); c.lineTo(W, G); stroke(c, 3);
    for (let k = 1; k < 5; k++) { const y = G + (H - G) * (k / 5) ** 1.3; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); stroke(c, 1.4, 'rgba(10,6,12,0.55)'); }
    for (let k = -8; k <= 8; k++) { c.beginPath(); c.moveTo(W / 2 + k * 90, G); c.lineTo(W / 2 + k * 150, H); stroke(c, 1.2, 'rgba(10,6,12,0.4)'); }
    c.beginPath(); c.rect(560, G + 22, 160, 30); stroke(c, 2, 'rgba(10,6,12,0.7)'); // a trapdoor
    // light from above: dim at 糸の段, brighter once the valance is down, shafts at 祈りの段
    if (act >= 2) radial(c, 640, 0, 520, '255,200,140', act >= 3 ? 0.1 : 0.07);
    if (act === 3) {
      for (const [x, w] of [[470, 60], [640, 80], [810, 60]]) {
        const s = c.createLinearGradient(0, 0, 0, G);
        s.addColorStop(0, 'rgba(255,240,200,0.10)'); s.addColorStop(1, 'rgba(255,240,200,0)');
        c.fillStyle = s; c.beginPath(); c.moveTo(x - w * 0.3, 36); c.lineTo(x + w * 0.3, 36); c.lineTo(x + w, G); c.lineTo(x - w, G); c.closePath(); c.fill();
      }
    }
  }
  function flat(c, x, G, w, h, rot, moon) {
    c.save(); c.translate(x + w / 2, G); c.rotate(rot);
    c.fillStyle = '#4a3a34'; c.fillRect(-w / 2, -h, w, h); c.beginPath(); c.rect(-w / 2, -h, w, h); stroke(c, 3);
    c.beginPath(); c.moveTo(-w / 2, -h / 2); c.lineTo(w / 2, -h / 2); c.moveTo(0, -h); c.lineTo(0, 0); c.moveTo(-w / 2, -h); c.lineTo(w / 2, 0); stroke(c, 5, '#6b4a2a'); stroke(c, 1.4);
    if (moon) { c.beginPath(); c.arc(w * 0.18, -h * 0.72, 26, 0.5, 5.2); c.fillStyle = 'rgba(239,229,207,0.55)'; c.fill(); stroke(c, 1.6); }
    c.restore();
  }

  // ------------------------------------------------------------------ live
  function drawLive(c, W, H, act, t, k, cl) {
    const G = H - 72;
    if (k == null) k = 1;
    cl = cl || 0;
    const fallY = (from) => (cl > from ? 700 * Math.pow((cl - from) / (1 - from), 2) : 0); // (the finale: things drop)
    // 面の段 comes in: the valance drops from the flies onto the right of the boards
    if (act === 2 && k < 0.75) {
      const f = Math.min(1, k / 0.75), y = -40 + (G - 70) * f * f;
      c.save(); c.translate(1160, y); c.rotate(0.25 * f);
      c.beginPath(); c.moveTo(-130, 0); c.quadraticCurveTo(0, 22, 130, 0); c.lineTo(120, 40); c.quadraticCurveTo(0, 60, -120, 40); c.closePath();
      c.fillStyle = '#7a1e30'; c.fill(); stroke(c, 2.5); c.beginPath(); c.moveTo(-120, 34); c.quadraticCurveTo(0, 52, 120, 34); stroke(c, 3, GOLD);
      c.restore();
    }
    // 終幕の段: the Ashwheel's shadow turns backwards in the abyss
    if (act >= 4) {
      c.save(); c.beginPath(); HOLE.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.clip();
      c.translate(720, 196); c.rotate(-t * 0.25);
      c.globalAlpha = 0.55 * k;
      c.beginPath(); c.arc(0, 0, 120, 0, TAU); stroke(c, 10, 'rgba(10,4,16,0.9)');
      for (let k = 0; k < 10; k++) { const a = k * TAU / 10; c.beginPath(); c.moveTo(Math.cos(a) * 24, Math.sin(a) * 24); c.lineTo(Math.cos(a) * 118, Math.sin(a) * 118); stroke(c, 7, 'rgba(10,4,16,0.9)'); }
      c.beginPath(); c.arc(0, 0, 26, 0, TAU); c.fillStyle = 'rgba(10,4,16,0.9)'; c.fill();
      c.restore();
      radial(c, 720, 196, 200, '150,90,220', 0.12 + 0.05 * Math.sin(t * 1.4));
    }
    // fly ropes and sandbags
    for (let i = 0; i < ROPES.length; i++) {
      const [x, len, bag] = ROPES[i], sw = Math.sin(t * (0.6 + hash(i) * 0.4) + i * 1.9) * (act >= 4 ? 9 : 5);
      c.beginPath(); c.moveTo(x, 40); c.quadraticCurveTo(x + sw * 0.4, 40 + len * 0.5, x + sw, 40 + len); stroke(c, 2.2, '#8a7458'); stroke(c, 0.8, 'rgba(26,18,34,0.6)');
      if (bag) {
        c.save(); c.translate(x + sw, 40 + len + fallY(0.1 + hash(i) * 0.4)); c.rotate(sw * 0.01);
        c.beginPath(); c.moveTo(-10, 0); c.quadraticCurveTo(-16, 22, -8, 30); c.lineTo(8, 30); c.quadraticCurveTo(16, 22, 10, 0); c.closePath();
        c.fillStyle = '#6a5a44'; c.fill(); stroke(c, 2); c.restore();
      }
    }
    // the hanging lamp
    const la = Math.sin(t * 0.7) * 0.05, lx = 640 + Math.sin(la) * 110, ly = 40 + Math.cos(la) * 110 + fallY(0.3);
    if (cl < 0.3) { c.beginPath(); c.moveTo(640, 40); c.lineTo(lx, ly); stroke(c, 1.6, '#5a4630'); }
    const fl = 0.85 + 0.15 * Math.sin(t * 9) * Math.sin(t * 5.3);
    radial(c, lx, ly + 14, 260, '255,190,110', 0.16 * fl * (act >= 2 ? 1.2 : 1));
    c.save(); c.translate(lx, ly); c.rotate(la);
    c.beginPath(); c.moveTo(-12, 0); c.lineTo(12, 0); c.lineTo(16, 22); c.lineTo(-16, 22); c.closePath(); c.fillStyle = '#5a4630'; c.fill(); stroke(c, 2);
    c.beginPath(); c.rect(-10, 4, 20, 14); c.fillStyle = `rgba(255,200,120,${0.75 * fl})`; c.fill();
    if (Art.flame) Art.flame(c, 0, 16, 7, t);
    c.restore();
    // 祈りの段 on: the votive candles burn
    // (祈りの段 comes in: the candles catch one after another)
    if (act >= 3 && Art.flame) for (let i = 0; i < 9; i++) { if (act === 3 && k < (i + 1) / 10) continue; const x = 400 + i * 60; Art.flame(c, x, G - 42, 6, t + i * 0.7); radial(c, x, G - 46, 22, '255,190,110', 0.25); }
    // dust in the lamp light; 終幕の段: paper flakes fall
    for (let i = 0; i < 14; i++) {
      const y = ((t * (8 + hash(i) * 10) + hash(i + 3) * 300) % 300) + 60, x = lx - 120 + hash(i + 9) * 240 + Math.sin(t + i) * 8;
      c.fillStyle = 'rgba(255,220,170,0.25)'; c.fillRect(x, y, 1.6, 1.6);
    }
    if (act >= 4) {
      for (let i = 0; i < 16 + Math.round(40 * cl); i++) {
        const h1 = hash(i + 40), h2 = hash(i + 80);
        const y = ((t * (26 + 20 * h2) + h1 * (G + 40)) % (G + 40)) - 20, x = 60 + h1 * (W - 120) + Math.sin(t * 1.2 + i) * 16;
        c.save(); c.translate(x, y); c.rotate(t * (0.6 + h2) + i); c.fillStyle = i % 4 ? 'rgba(239,229,207,0.7)' : 'rgba(232,191,106,0.8)'; c.fillRect(-4, -3, 8, 6); c.restore();
      }
    }
  }

  // ------------------------------------------------------------------ the proscenium (foreground) and vignette
  function drawFront(c, W, H, act, collapse) {
    const cl = collapse || 0;
    for (const [x0, flip] of [[0, false], [W, true]]) {
      c.save(); c.translate(x0, 0); if (flip) c.scale(-1, 1);
      // the finale: the proscenium gives way and falls outwards
      if (cl > 0) { c.translate(0, H); c.rotate(-1.2 * cl * cl); c.translate(0, -H); c.globalAlpha *= 1 - 0.6 * cl; }
      c.fillStyle = '#2a1a22'; c.fillRect(0, 0, 26, H); c.beginPath(); c.moveTo(26, 0); c.lineTo(26, H); stroke(c, 3);
      c.beginPath(); c.moveTo(20, 0); c.lineTo(20, H); stroke(c, 2, 'rgba(232,191,106,0.6)');
      if (act >= 4) { c.beginPath(); c.moveTo(26, 60); c.lineTo(12, 110); c.lineTo(22, 150); c.lineTo(6, 210); c.moveTo(26, 260); c.lineTo(10, 300); c.lineTo(18, 340); stroke(c, 2, 'rgba(10,4,16,0.9)'); }
      c.restore();
    }
    const v = c.createRadialGradient(W / 2, H * 0.55, H * 0.4, W / 2, H * 0.55, W * 0.72);
    v.addColorStop(0, 'rgba(5,3,10,0)'); v.addColorStop(1, `rgba(5,3,10,${act >= 4 ? 0.62 : 0.55})`);
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  }

  // ------------------------------------------------------------------ hooks
  const cache = new Map();
  function staticCanvas(W, H, act, ctx) {
    if (typeof document === 'undefined') return null;
    let s = 1;
    try { const m = ctx.getTransform(); s = Math.min(1.5, Math.max(1, Math.round(Math.hypot(m.a, m.b) * 4) / 4)); } catch (e) { s = 1; }
    const key = `${W}|${H}|${act}|${s}`;
    let cv = cache.get(key);
    if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = Math.ceil(W * s); cv.height = Math.ceil(H * s);
    const g = cv.getContext('2d'); g.scale(s, s); paintStatic(g, W, H, act);
    cache.set(key, cv);
    if (cache.size > 6) cache.delete(cache.keys().next().value);
    return cv;
  }
  const actOf = (opts) => Math.max(1, Math.min(4, Math.round(+opts.act || 1)));
  Art.drawBackground = function (ctx, zone, opts) {
    if (zone !== 'deepest') return base.bg.apply(this, arguments);
    opts = opts || {};
    const W = opts.W || 1280, H = opts.H || 446, act = actOf(opts), t = +opts.t || 0;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    // an act change unfolds (actK 0 -> 1): the last act's stage under the new one, fading in
    const k = act > 1 && opts.actK != null ? Math.max(0, Math.min(1, +opts.actK)) : 1;
    if (k < 1) {
      const pv = staticCanvas(W, H, act - 1, ctx);
      if (pv) ctx.drawImage(pv, 0, 0, W, H); else paintStatic(ctx, W, H, act - 1);
    }
    // the finale: the back of the theater tips and sinks
    const cl = +opts.collapse || 0;
    if (cl > 0) { ctx.fillStyle = '#05030a'; ctx.fillRect(0, 0, W, H); ctx.translate(W / 2, H); ctx.rotate(0.06 * cl * cl); ctx.translate(-W / 2, -H + 90 * cl * cl); }
    ctx.save(); ctx.globalAlpha *= k;
    const cv = staticCanvas(W, H, act, ctx);
    if (cv) ctx.drawImage(cv, 0, 0, W, H); else paintStatic(ctx, W, H, act);
    ctx.restore();
    drawLive(ctx, W, H, act, t, k, cl);
    ctx.restore();
  };
  Art.drawForeground = function (ctx, zone, opts) {
    if (zone !== 'deepest') return base.fg.apply(this, arguments);
    opts = opts || {};
    const W = opts.W || 1280, H = opts.H || 446;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    drawFront(ctx, W, H, actOf(opts), +opts.collapse || 0);
    if (+opts.collapse > 0) { ctx.fillStyle = `rgba(5,3,10,${(0.5 * opts.collapse).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  };
  Art.warmBackground = function (ctx, zone, opts) {
    if (zone !== 'deepest') return base.warm ? base.warm.apply(this, arguments) : undefined;
    opts = opts || {};
    for (let a = 1; a <= 4; a++) staticCanvas(opts.W || 1280, opts.H || 446, a, ctx);
  };
  if (Art.BG_ZONES && Art.BG_ZONES.indexOf('deepest') < 0) Art.BG_ZONES.push('deepest');
})();
