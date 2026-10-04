/* EMBERWHEEL — art style kit ("Candlelit Paper Theater").
 * Shared palette + drawing helpers so every procedural drawing stays cohesive.
 * Conventions:
 *  - Logical stage is 1280x720. Actors are drawn with (0,0) at the FEET CENTER, y grows downward
 *    (so the body is at negative y). The caller translates/scales before calling.
 *  - Ink outline: PAL.ink, width LW (3) for silhouettes, LW_THIN (2) for inner details. Round joins/caps.
 *  - Flat base fill + ONE shade tone (crescent on the lower-right, light comes from upper-left) +
 *    optional small highlight. No soft gradients on characters (gradients are for light/glow/backgrounds).
 *  - Heroes: big friendly eyes with white sclera. Enemies: glowing eyes/slits, no sclera.
 */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  const Art = (SD.Art = SD.Art || {});

  const PAL = {
    ink: '#1a1222',
    void: '#0d0b16', dark1: '#17142a', dark2: '#231f3d',
    stone: '#3a3460', stoneLight: '#514a7d', stoneHi: '#6c64a0',
    candle: '#ffe1a0', candleMid: '#ffc15e', candleDeep: '#ff8a3d', ember: '#ff6a2b',
    brass: '#c9953b', brassLight: '#e8bf6a', brassDark: '#7a5520', brassShadow: '#4a3214',
    bone: '#efe5cf', boneShade: '#c9b994',
    blood: '#ff4f5e', heal: '#7df0b4', ward: '#6fd3ff', flame: '#ff7a2f', flameHot: '#ffd257',
    steel: '#d8e2f0', steelShade: '#8e9cb8', gold: '#ffd257', curse: '#9b7bd6', curseDeep: '#4c3a6e',
    star: '#fff6d8', white: '#ffffff',
    // hero accents
    knightTabard: '#2f6f8f', knightTabardShade: '#1f4a63', knightPlume: '#e0453f', knightPlumeShade: '#a82d2f',
    witchRobe: '#6a3fa0', witchRobeShade: '#472a72', witchHat: '#4b2f7a', witchHatShade: '#331f57',
    priestRobe: '#eadfc4', priestRobeShade: '#bfae88', priestTrim: '#d9a441', skin: '#ffd9b8', skinShade: '#e8a98a',
  };
  Art.PAL = PAL;
  Art.LW = 3;
  Art.LW_THIN = 2;

  // ---------- math helpers ----------
  Art.lerp = (a, b, t) => a + (b - a) * t;
  Art.clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  Art.easeOut = (t) => 1 - Math.pow(1 - Art.clamp01(t), 3);
  Art.easeIn = (t) => Math.pow(Art.clamp01(t), 3);
  Art.easeInOut = (t) => { t = Art.clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  Art.easeOutBack = (t) => { t = Art.clamp01(t); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  // 0 -> 1 -> 0 over p in [0,1]; peak at `peak`
  Art.pulse = (p, peak = 0.35) => { p = Art.clamp01(p); return p < peak ? Art.easeOut(p / peak) : 1 - Art.easeInOut((p - peak) / (1 - peak)); };
  Art.breathe = (t, period = 1.6, amp = 0.02) => 1 + Math.sin((t * Math.PI * 2) / period) * amp;
  // deterministic pseudo-random from integer seed (for backgrounds / texture placement)
  Art.hash = (n) => { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // ---------- path helpers ----------
  Art.ellipsePath = (ctx, x, y, rx, ry, rot = 0) => { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2); };
  Art.circlePath = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, Math.max(0.01, r), 0, Math.PI * 2); };
  Art.roundRectPath = (ctx, x, y, w, h, r) => {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  // Smooth closed curve through points [[x,y],...] (Catmull-Rom converted to Beziers).
  Art.blobPath = (ctx, pts, tension = 1) => {
    const n = pts.length;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension, c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
      const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension, c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
    }
    ctx.closePath();
  };
  // Open smooth curve (for tails, plumes, chains)
  Art.curvePath = (ctx, pts, tension = 1) => {
    const n = pts.length;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
      const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension, c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
      const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension, c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
    }
  };
  Art.polyPath = (ctx, pts, close = true) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (close) ctx.closePath();
  };

  // ---------- fill / stroke ----------
  // Fill the current path with `fill`, then stroke with ink.
  Art.fs = (ctx, fill, lw = Art.LW, stroke = PAL.ink) => {
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (lw > 0) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
  };
  Art.strokeOnly = (ctx, lw = Art.LW, stroke = PAL.ink) => {
    ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  };

  /* Draw a shape with the house style: base fill, crescent shade (clipped), ink outline.
   * pathFn(ctx) must build the path (beginPath ... ) — it is called up to 3 times.
   * shadeDX/DY: how far the "lit" copy is offset; the shade shows where the offset copy doesn't cover.
   * Default light from upper-left => shade crescent at lower-right.
   */
  Art.shape = (ctx, pathFn, base, shade, opts = {}) => {
    const lw = opts.lw == null ? Art.LW : opts.lw;
    const dx = opts.dx == null ? -4 : opts.dx, dy = opts.dy == null ? -4 : opts.dy;
    ctx.save();
    pathFn(ctx);
    ctx.fillStyle = shade || base;
    ctx.fill();
    if (shade) {
      ctx.clip();
      ctx.translate(dx, dy);
      pathFn(ctx);
      ctx.fillStyle = base;
      ctx.fill();
    }
    ctx.restore();
    if (opts.hi) { // small highlight dab: {x,y,rx,ry,color}
      ctx.save();
      pathFn(ctx); ctx.clip();
      Art.ellipsePath(ctx, opts.hi.x, opts.hi.y, opts.hi.rx, opts.hi.ry, opts.hi.rot || 0);
      ctx.fillStyle = opts.hi.color || 'rgba(255,255,255,0.35)';
      ctx.fill();
      ctx.restore();
    }
    if (lw > 0) { pathFn(ctx); Art.strokeOnly(ctx, lw); }
  };

  // Additive radial glow (light sources, magic).
  Art.glow = (ctx, x, y, r, color, alpha = 1) => {
    if (r <= 0 || alpha <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= alpha;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };

  // A small candle-flame teardrop (used on hats, candles, rats, etc). Flickers with t.
  Art.flame = (ctx, x, y, size, t, opts = {}) => {
    const fl = Math.sin(t * 13.7 + (opts.seed || 0)) * 0.08 + Math.sin(t * 7.3 + (opts.seed || 0) * 2) * 0.06;
    const h = size * (1 + fl), w = size * 0.55;
    const sway = Math.sin(t * 5.1 + (opts.seed || 0)) * size * 0.12;
    if (opts.glow !== false) Art.glow(ctx, x, y - h * 0.4, size * 3.2, opts.glowColor || 'rgba(255,170,80,0.55)', 0.9);
    const outer = opts.outer || PAL.candleDeep, inner = opts.inner || PAL.candle;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + sway, y - h);
    ctx.bezierCurveTo(x + w * 0.9, y - h * 0.45, x + w, y, x, y);
    ctx.bezierCurveTo(x - w, y, x - w * 0.9, y - h * 0.45, x + sway, y - h);
    ctx.fillStyle = outer; ctx.fill();
    if (opts.outline) Art.strokeOnly(ctx, Art.LW_THIN);
    ctx.beginPath();
    ctx.moveTo(x + sway * 0.6, y - h * 0.62);
    ctx.bezierCurveTo(x + w * 0.5, y - h * 0.3, x + w * 0.5, y, x, y);
    ctx.bezierCurveTo(x - w * 0.5, y, x - w * 0.5, y - h * 0.3, x + sway * 0.6, y - h * 0.62);
    ctx.fillStyle = inner; ctx.fill();
    ctx.restore();
  };

  // Friendly hero eyes. look: [-1..1] horizontal glance. blink: 0 open .. 1 closed. mood: 'normal'|'happy'|'hurt'|'worried'|'focus'|'dead'
  Art.heroEyes = (ctx, x, y, spacing, size, opts = {}) => {
    const look = opts.look || 0, blink = Art.clamp01(opts.blink || 0), mood = opts.mood || 'normal';
    for (const s of [-1, 1]) {
      const ex = x + s * spacing / 2;
      ctx.save();
      if (mood === 'happy') { // ^ ^
        ctx.beginPath(); ctx.moveTo(ex - size * 0.7, y + size * 0.25); ctx.quadraticCurveTo(ex, y - size * 0.75, ex + size * 0.7, y + size * 0.25);
        Art.strokeOnly(ctx, Art.LW);
      } else if (mood === 'hurt') { // > <
        ctx.beginPath();
        ctx.moveTo(ex - s * size * 0.6, y - size * 0.55); ctx.lineTo(ex + s * size * 0.45, y); ctx.lineTo(ex - s * size * 0.6, y + size * 0.55);
        Art.strokeOnly(ctx, Art.LW);
      } else if (mood === 'dead') { // x x
        ctx.beginPath();
        ctx.moveTo(ex - size * 0.5, y - size * 0.5); ctx.lineTo(ex + size * 0.5, y + size * 0.5);
        ctx.moveTo(ex + size * 0.5, y - size * 0.5); ctx.lineTo(ex - size * 0.5, y + size * 0.5);
        Art.strokeOnly(ctx, Art.LW_THIN);
      } else {
        const ry = size * (1 - blink * 0.92);
        Art.ellipsePath(ctx, ex, y, size * 0.72, ry);
        Art.fs(ctx, PAL.white, Art.LW_THIN);
        if (ry > size * 0.25) {
          const pr = size * (mood === 'focus' ? 0.36 : 0.42);
          Art.ellipsePath(ctx, ex + look * size * 0.25, y + size * 0.08, pr, Math.min(pr, ry * 0.85));
          ctx.fillStyle = PAL.ink; ctx.fill();
          Art.circlePath(ctx, ex + look * size * 0.25 - pr * 0.35, y - pr * 0.3, pr * 0.32);
          ctx.fillStyle = PAL.white; ctx.fill();
        }
        if (mood === 'worried') { // tilted brows
          ctx.beginPath(); ctx.moveTo(ex - s * size * 0.1 - size * 0.55 * s, y - size * 1.05); ctx.lineTo(ex + s * size * 0.55, y - size * 1.3);
          Art.strokeOnly(ctx, Art.LW_THIN);
        }
        if (mood === 'focus') {
          ctx.beginPath(); ctx.moveTo(ex - size * 0.7, y - size * 1.0 - s * size * 0.0); ctx.lineTo(ex + size * 0.7, y - size * 0.85 + (s > 0 ? -size * 0.25 : size * 0.25) * -1);
          Art.strokeOnly(ctx, Art.LW_THIN);
        }
      }
      ctx.restore();
    }
  };

  // Glowing enemy eye (slit or dot) — no sclera. color defaults to ember.
  Art.enemyEye = (ctx, x, y, size, opts = {}) => {
    const color = opts.color || PAL.candleMid, slit = opts.slit || 0, blink = Art.clamp01(opts.blink || 0);
    Art.glow(ctx, x, y, size * 3, opts.glowColor || 'rgba(255,140,60,0.5)', opts.glowAlpha == null ? 0.8 : opts.glowAlpha);
    ctx.save();
    const ry = size * (1 - blink * 0.9) * (slit ? 0.55 : 1);
    Art.ellipsePath(ctx, x, y, size * (slit ? 1.1 : 0.85), Math.max(0.6, ry), opts.rot || 0);
    ctx.fillStyle = color; ctx.fill();
    Art.ellipsePath(ctx, x - size * 0.2, y - size * 0.2, size * 0.3, Math.max(0.3, ry * 0.3));
    ctx.fillStyle = 'rgba(255,255,230,0.9)'; ctx.fill();
    ctx.restore();
  };

  // ---------- registries ----------
  Art.heroes = Art.heroes || {};      // id -> { draw(ctx, pose, opts), info: {height,width,...} }
  Art.enemies = Art.enemies || {};    // id -> { draw(ctx, pose, opts), info: {height,width,...} }
  Art.registerHero = (id, def) => { Art.heroes[id] = def; };
  Art.registerEnemy = (id, def) => { Art.enemies[id] = def; };
  Art.heroInfo = (id) => (Art.heroes[id] ? Art.heroes[id].info : { height: 110, width: 70 });
  Art.enemyInfo = (id) => (Art.enemies[id] ? Art.enemies[id].info : { height: 100, width: 90 });

  Art.drawHero = (ctx, id, pose, opts = {}) => {
    const def = Art.heroes[id];
    if (!def) return Art._missing(ctx, 110, 70);
    ctx.save(); def.draw(ctx, pose || 'idle', opts); ctx.restore();
  };
  Art.drawEnemy = (ctx, id, pose, opts = {}) => {
    const def = Art.enemies[id];
    if (!def) return Art._missing(ctx, 100, 90);
    ctx.save(); def.draw(ctx, pose || 'idle', opts); ctx.restore();
  };
  Art._missing = (ctx, h, w) => {
    ctx.save();
    Art.roundRectPath(ctx, -w / 2, -h, w, h, 12);
    Art.fs(ctx, '#552244');
    ctx.restore();
  };
})();
