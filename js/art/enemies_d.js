/* EMBERWHEEL — enemies_d.js : 最深の間 (Candlelit Paper Theater style).
 * Registers: kurite 深淵の繰り手 (B17, the true final boss; docs/EXPANSION_4C_PLAN.md §1).
 * Two paper hands on purple sleeves come down from above the stage holding a cross-shaped control bar; four golden strings
 * run from the bar down to the stage (one per string of the HP bar — a snapped one hangs limp from the bar). Above them a
 * kintsugi mask: in shadow (the eyes shine out of it) at 糸の段, shown at 面の段, over a black paper kimono hung with little puppets of
 * the bosses it once worked (灰輪の主・修道院長・灰鐘の番人) from 祈りの段, cracked wide with blazing eyes at 終幕の段.
 * Contract (ARCH.md "Enemies"): draw(ctx, pose, opts) with origin = feet center, facing LEFT.
 * Poses: idle (fingers draw the strings in) · windup (吊り上げ: both hands high, strings taut) · attack(p) (落とし: slam) ·
 * cast (a finger flicks a string) · stance (the bar held level) · hit(p) (the hands jerk up) · die(p) (the strings snap in turn,
 * the hands fall, the mask splits along its gold). opts.phase 1..4 (the act); opts.cut = strings snapped (default phase - 1).
 */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  const Art = SD.Art;
  if (!Art || !Art.registerEnemy) return;
  const POSES = { idle: 1, windup: 1, attack: 1, cast: 1, stance: 1, hit: 1, die: 1 };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const ease = Art.easeInOut, eOut = Art.easeOut, eIn = Art.easeIn;
  const PAPER = '#efe5cf', PAPER_SH = '#c9b994', SLEEVE = '#3a1f52', SLEEVE_SH = '#22122f', GOLD = '#e8bf6a', STRING = '#ffd257';
  const WOOD = '#6b4a2a', WOOD_SH = '#4a3214', ROBE = '#3b2a50', ROBE_SH = '#251a34', RIVET = '#7a5520', DIM = 'rgba(184,137,58,0.85)';
  const ANCHORS = [-84, -28, 28, 84]; // where the four strings leave the bar (ブラム, ルゥ, トト, 最後の糸)

  function st(pose, opts) {
    opts = opts || {};
    const P = POSES[pose] ? pose : 'idle';
    const phase = clamp(Math.round(num(opts.phase, 1)), 1, 4);
    const s = { pose: P, t: num(opts.t, 0), p: clamp(num(opts.p, 0), 0, 1), phase, cut: clamp(Math.round(num(opts.cut, phase - 1)), 0, 4) };
    s.actK = clamp(num(opts.actK, 1), 0, 1); // (the act change unfolding: the mask lit, the kimono unrolled, the cracks spread)
    s.atk = P === 'attack' ? Art.pulse(s.p, 0.3) : 0;
    s.hitK = P === 'hit' ? 1 - eOut(s.p) : 0;
    s.dieP = P === 'die' ? s.p : 0;
    s.raise = P === 'windup' ? 1 : P === 'cast' ? 0.25 : 0;
    s.flick = P === 'cast' ? Art.pulse((s.t * 0.9) % 1, 0.25) : 0;
    s.spread = P === 'stance' ? 1 : 0;
    s.bob = Math.sin(s.t * 1.1) * 5;
    // the hands (and the bar) fall in the second half of die
    s.fall = P === 'die' ? eIn(seg(s.p, 0.22, 0.7)) : 0;
    s.lift = -62 * s.raise - 30 * s.hitK + 74 * s.atk;
    s.by = -205 + s.lift + s.bob + 250 * s.fall;
    s.tilt = 0.035 * Math.sin(s.t * 0.9) - 0.09 * s.hitK + 0.05 * s.atk + 0.35 * s.fall;
    s.tremble = P === 'windup' ? Math.sin(s.t * 38) * 1.4 : 0;
    return s;
  }

  // ------------------------------------------------------------------ the mask
  const SEAMS = [
    [[0, -58], [-5, -32], [6, -8], [-2, 20], [4, 50]],
    [[52, -30], [36, -14], [42, 6], [30, 24]],
    [[-58, 4], [-38, 12], [-32, 34]],
    [[-30, -50], [-20, -36], [-26, -22]],
    [[60, 18], [44, 30], [48, 46], [34, 54]],
  ];
  function maskFace(ctx, s, lit) {
    Art.shape(ctx, (c) => Art.ellipsePath(c, 0, 0, 64, 58), PAPER, PAPER_SH, { dx: -6, dy: -5 });
    // brows (Noh): two soft dabs high on the forehead
    for (const bx of [-24, 24]) { Art.ellipsePath(ctx, bx, -34, 9, 4); ctx.fillStyle = 'rgba(60,40,60,0.55)'; ctx.fill(); }
    // eye slits, a quiet smile
    for (const ex of [-24, 24]) {
      ctx.beginPath(); ctx.ellipse(ex, -8, 15, 6, ex < 0 ? 0.15 : -0.15, 0, Math.PI * 2); ctx.fillStyle = '#1a1222'; ctx.fill();
    }
    ctx.beginPath(); ctx.moveTo(-20, 28); ctx.quadraticCurveTo(0, s.phase >= 4 ? 40 : 35, 20, 28); Art.strokeOnly(ctx, 2.2);
    // kintsugi: the gold seams spread act by act (all five at 終幕の段)
    const n = s.phase >= 4 ? 3 + Math.round(2 * s.actK) : s.phase;
    SEAMS.slice(0, n).forEach((pts) => {
      ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.lineWidth = 2.6; ctx.strokeStyle = GOLD; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    });
    // 糸の段: the face is still in the shadow of the flies; only the eyes shine out of it
    if (lit < 1) { Art.ellipsePath(ctx, 0, 0, 66, 60); ctx.fillStyle = `rgba(12,7,20,${(0.66 * (1 - lit)).toFixed(3)})`; ctx.fill(); }
    const blaze = s.phase >= 4 ? s.actK : 0;
    for (const ex of [-24, 24]) {
      Art.enemyEye(ctx, ex, -8, 4 + blaze * 1.2, { color: blaze ? '#f4e4ff' : '#d9c4ff', glowColor: 'rgba(170,120,255,0.9)', glowAlpha: 0.8 + 0.5 * blaze, slit: 1, blink: s.hitK });
    }
  }
  function mask(ctx, s) {
    const y = -318 + s.bob * 0.4;
    const lit = s.phase === 1 ? 0 : s.phase === 2 ? s.actK : 1;
    Art.glow(ctx, 0, y, s.phase >= 4 ? 150 : 120, 'rgba(197,139,255,0.35)', (0.75 + 0.2 * Math.sin(s.t * 1.3)) * (1 - s.dieP));
    ctx.save(); ctx.translate(0, y); ctx.rotate(-0.08 * s.hitK + 0.02 * Math.sin(s.t * 0.6));
    // die: the mask splits down its first seam and the halves fall apart
    const sp = s.pose === 'die' ? ease(seg(s.p, 0.42, 0.95)) : 0;
    if (sp > 0) {
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * 40 * sp, 160 * sp * sp); ctx.rotate(side * 0.6 * sp);
        ctx.beginPath();
        if (side < 0) { ctx.moveTo(-80, -70); ctx.lineTo(0, -70); SEAMS[0].forEach(([px, py]) => ctx.lineTo(px, py)); ctx.lineTo(4, 70); ctx.lineTo(-80, 70); }
        else { ctx.moveTo(80, -70); ctx.lineTo(0, -70); SEAMS[0].forEach(([px, py]) => ctx.lineTo(px, py)); ctx.lineTo(4, 70); ctx.lineTo(80, 70); }
        ctx.closePath(); ctx.clip();
        ctx.globalAlpha *= 1 - seg(s.p, 0.85, 1);
        maskFace(ctx, s, lit);
        ctx.restore();
      }
    } else maskFace(ctx, s, lit);
    ctx.restore();
  }

  // ------------------------------------------------------------------ 祈りの段 on: the black paper kimono and its puppets
  function puppet(ctx, kind, x, y, t) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 1.7 + x * 0.05) * 0.18); ctx.scale(1.45, 1.45);
    ctx.beginPath(); ctx.moveTo(0, -34); ctx.lineTo(0, -10); ctx.strokeStyle = 'rgba(232,191,106,0.9)'; ctx.lineWidth = 1; ctx.stroke();
    if (kind === 'wheel') { // 灰輪の主: a little ash wheel with a crown
      Art.shape(ctx, (c) => Art.circlePath(c, 0, 4, 11), '#4a4256', '#2f2a3a', { lw: 1.6 });
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(Math.cos(a) * 10, 4 + Math.sin(a) * 10); ctx.lineWidth = 1.2; ctx.strokeStyle = '#1a1222'; ctx.stroke(); }
      Art.shape(ctx, (c) => Art.polyPath(c, [[-7, -7], [-4, -12], [0, -8], [4, -12], [7, -7]]), GOLD, null, { lw: 1.4 });
    } else if (kind === 'hood') { // 修道院長: a hooded figure with a lamp
      Art.shape(ctx, (c) => Art.blobPath(c, [[0, -10], [9, -2], [11, 16], [-11, 16], [-9, -2]], 1), '#3b3346', '#262030', { lw: 1.6 });
      Art.ellipsePath(ctx, 0, -2, 4, 3); ctx.fillStyle = '#1a1222'; ctx.fill();
      Art.glow(ctx, 0, -2, 5, 'rgba(255,190,90,0.7)', 0.6);
    } else { // 灰鐘の番人: a small bell
      Art.shape(ctx, (c) => Art.blobPath(c, [[0, -10], [7, -4], [10, 12], [-10, 12], [-7, -4]], 1), '#8a6a3a', '#5e4624', { lw: 1.6 });
      Art.circlePath(ctx, 0, 14, 2.5); ctx.fillStyle = '#1a1222'; ctx.fill();
    }
    ctx.restore();
  }
  function robe(ctx, s) {
    const k = s.phase >= 3 ? 1 : 0;
    if (!k) return;
    const y0 = -270 + s.bob * 0.4, a = 1 - seg(s.dieP, 0.55, 0.9);
    if (a <= 0) return;
    // 祈りの段 comes in: the kimono unrolls downwards from the mask, then the puppets drop into place
    const un = s.phase === 3 ? s.actK : 1;
    ctx.save(); ctx.globalAlpha *= a;
    if (un < 1) { ctx.beginPath(); ctx.rect(-200, y0 - 12, 400, 12 + 250 * ease(un)); ctx.clip(); }
    // three overlapping paper layers, the outer one with wide sleeves
    Art.shape(ctx, (c) => Art.polyPath(c, [[-36, y0], [36, y0], [118, y0 + 120], [96, y0 + 150], [60, y0 + 136], [70, y0 + 230], [-70, y0 + 230], [-60, y0 + 136], [-96, y0 + 150], [-118, y0 + 120]]), ROBE, ROBE_SH, { dx: -5, dy: -4 });
    Art.shape(ctx, (c) => Art.polyPath(c, [[-30, y0 + 8], [30, y0 + 8], [48, y0 + 228], [-48, y0 + 228]]), '#5a4470', '#3e2f50', { lw: 2.2 });
    // the collar: paper over gold
    ctx.beginPath(); ctx.moveTo(-30, y0 + 2); ctx.lineTo(0, y0 + 64); ctx.lineTo(30, y0 + 2); ctx.lineWidth = 9; ctx.strokeStyle = PAPER; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-30, y0 + 2); ctx.lineTo(0, y0 + 64); ctx.lineTo(30, y0 + 2); ctx.lineWidth = 2.5; ctx.strokeStyle = GOLD; ctx.stroke();
    // gold hems
    for (const [x1, y1, x2, y2] of [[-118, y0 + 120, -96, y0 + 150], [118, y0 + 120, 96, y0 + 150], [-70, y0 + 230, 70, y0 + 230]]) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineWidth = 3; ctx.strokeStyle = GOLD; ctx.stroke();
    }
    // a gold wheel crest on each sleeve (the Ashwheel was its puppet)
    for (const cx of [-86, 86]) {
      const cy = y0 + 112;
      Art.circlePath(ctx, cx, cy, 10); ctx.lineWidth = 2; ctx.strokeStyle = GOLD; ctx.stroke();
      for (let k = 0; k < 6; k++) { const an = k * Math.PI / 3 + 0.3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(an) * 10, cy + Math.sin(an) * 10); ctx.lineWidth = 1.2; ctx.stroke(); }
    }
    // the puppets it once worked, hung under its sleeves
    const pd = -70 * (1 - eOut(seg(un, 0.6, 1)));
    puppet(ctx, 'wheel', -108, y0 + 196 + pd, s.t);
    puppet(ctx, 'hood', -66, y0 + 206 + pd, s.t + 1.3);
    puppet(ctx, 'bell', 104, y0 + 198 + pd, s.t + 2.1);
    ctx.restore();
  }

  // ------------------------------------------------------------------ the control bar and its four strings
  // a taut string runs down to the stage floor and fades; a snapped one hangs limp from the bar and sways
  function strings(ctx, s, bx) {
    const bar = (x) => ({ x: bx(x).x, y: bx(x).y + 6 });
    ctx.save(); ctx.lineCap = 'round';
    ANCHORS.forEach((ax, i) => {
      const a = bar(ax);
      // die: the strings still taut snap one after another
      const snapAt = 0.06 + 0.07 * (i - s.cut);
      const snapped = i < s.cut || (s.pose === 'die' && s.p >= snapAt);
      if (snapped) {
        const sw = Math.sin(s.t * 1.8 + i * 1.7) * 10, len = 96 + i * 6;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(a.x + sw * 0.4, a.y + len * 0.5, a.x + sw, a.y + len);
        ctx.strokeStyle = DIM; ctx.lineWidth = 1.6; ctx.stroke();
        // the frayed end
        ctx.beginPath(); ctx.moveTo(a.x + sw, a.y + len); ctx.lineTo(a.x + sw - 4, a.y + len + 7); ctx.moveTo(a.x + sw, a.y + len); ctx.lineTo(a.x + sw + 3, a.y + len + 8);
        ctx.lineWidth = 1; ctx.stroke();
        if (s.pose === 'die' && i >= s.cut && s.p < snapAt + 0.06) Art.glow(ctx, a.x, a.y + 30, 34, 'rgba(255,214,120,0.95)', 1 - (s.p - snapAt) / 0.06);
        return;
      }
      // (down to the stage floor in front of it: the plaque and the band hang to the left)
      const ex = a.x * 0.45 - 46 - i * 8 + s.tremble, ey = -8;
      const cx = (a.x + ex) / 2 - 18 + 12 * s.raise, cy = (a.y + ey) / 2;
      const g = ctx.createLinearGradient(a.x, a.y, ex, ey);
      const on = 0.55 + 0.35 * s.raise + 0.25 * (s.pose === 'cast' && i === 3 - s.cut ? s.flick : 0);
      g.addColorStop(0, `rgba(255,214,120,${clamp(on, 0, 1)})`); g.addColorStop(0.75, 'rgba(255,210,87,0.35)'); g.addColorStop(1, 'rgba(255,210,87,0)');
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cx, cy, ex, ey);
      ctx.strokeStyle = 'rgba(255,210,87,0.18)'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.stroke();
      Art.glow(ctx, a.x, a.y, 10, 'rgba(255,210,87,0.8)', 0.5 + 0.4 * s.raise);
    });
    ctx.restore();
  }
  function controlBar(ctx, s) {
    const c = Math.cos(s.tilt), sn = Math.sin(s.tilt);
    const bx = (x) => ({ x: x * c, y: s.by + x * sn });
    const a = 1 - seg(s.dieP, 0.7, 0.95);
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a;
    strings(ctx, s, bx);
    ctx.save(); ctx.translate(0, s.by); ctx.rotate(s.tilt);
    Art.shape(ctx, (cc) => Art.roundRectPath(cc, -104, -8, 208, 16, 7), WOOD, WOOD_SH);
    Art.shape(ctx, (cc) => Art.roundRectPath(cc, -8, -46, 16, 92, 7), WOOD, WOOD_SH);
    for (const ax of ANCHORS) { Art.circlePath(ctx, ax, 0, 3.4); ctx.fillStyle = GOLD; ctx.fill(); }
    Art.circlePath(ctx, 0, 0, 6); ctx.fillStyle = GOLD; ctx.fill(); Art.strokeOnly(ctx, 1.6);
    ctx.restore();
    ctx.restore();
  }

  // ------------------------------------------------------------------ a paper hand on its sleeve, hanging from above
  // (x, y: the wrist; the fingers point down to the bar). curl: 0 open .. 1 clenched; each finger draws its string in turn.
  function hand(ctx, s, x, y, flip) {
    const fall = s.fall;
    // the sleeve (die: it is drawn back up into the dark while the paper hand drops on its own)
    ctx.save(); ctx.translate(x, y - 250 * fall - 260 * fall); if (flip) ctx.scale(-1, 1);
    ctx.globalAlpha *= 1 - fall;
    Art.shape(ctx, (c) => Art.roundRectPath(c, -36, -330, 72, 332, 16), SLEEVE, SLEEVE_SH);
    ctx.beginPath(); ctx.moveTo(-14, -300); ctx.lineTo(-10, -40); ctx.moveTo(16, -260); ctx.lineTo(12, -60); ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(16,8,24,0.6)'; ctx.stroke();
    Art.shape(ctx, (c) => Art.roundRectPath(c, -40, -12, 80, 13, 4), GOLD, '#b8893a', { lw: 2 });
    ctx.restore();
    ctx.save(); ctx.translate(x, y + 30 * fall); if (flip) ctx.scale(-1, 1);
    ctx.rotate(0.9 * fall);
    ctx.globalAlpha *= 1 - seg(s.dieP, 0.78, 0.97);
    // the palm (paper), its brass rivet
    Art.shape(ctx, (c) => Art.blobPath(c, [[-38, 0], [38, 0], [46, 46], [24, 74], [-22, 74], [-46, 46]], 1), PAPER, PAPER_SH, { dx: -4, dy: -4 });
    Art.circlePath(ctx, 0, 34, 3.2); ctx.fillStyle = RIVET; ctx.fill();
    // the thumb, then four two-jointed fingers
    ctx.save(); ctx.translate(-40, 40); ctx.rotate(0.5 - 0.3 * s.spread + 0.25 * s.raise);
    Art.shape(ctx, (c) => Art.roundRectPath(c, -7, 0, 14, 34, 7), PAPER, PAPER_SH, { lw: 2.2 }); ctx.restore();
    const F = [[-28, 40], [-9, 52], [10, 50], [28, 38]];
    F.forEach(([fx, len], i) => {
      // idle: the fingers draw the strings in one after another; windup: clenched; slam: thrown open; stance: spread
      const draw = 0.28 + 0.28 * Math.sin(s.t * 2.2 + i * 1.4);
      let curl = s.pose === 'idle' ? draw : s.pose === 'windup' ? 0.85 : s.pose === 'attack' ? 0.15 + 0.5 * (1 - s.atk) : s.pose === 'stance' ? 0.1 : 0.35;
      if (s.pose === 'cast' && i === 1) curl = 0.7 - 0.8 * s.flick;
      if (s.hitK) curl = 0.05;
      const splay = (i - 1.5) * (0.06 + 0.12 * s.spread + 0.14 * s.hitK);
      const l1 = len * 0.55, l2 = len * 0.5 * (1 - 0.3 * curl);
      ctx.save(); ctx.translate(fx, 68); ctx.rotate(splay + Math.sin(s.t * 1.6 + i) * 0.04);
      Art.shape(ctx, (c) => Art.roundRectPath(c, -7, 0, 14, l1 + 4, 7), PAPER, PAPER_SH, { lw: 2.2 });
      ctx.translate(0, l1); ctx.rotate(curl * 0.9 * (i < 2 ? 1 : -1));
      Art.shape(ctx, (c) => Art.roundRectPath(c, -6.5, -3, 13, l2, 6.5), PAPER, PAPER_SH, { lw: 2.2 });
      Art.circlePath(ctx, 0, 0, 2.4); ctx.fillStyle = RIVET; ctx.fill();
      ctx.restore();
    });
    ctx.restore();
  }

  // 終幕の段: paper flakes drift down from the cracked flies
  function flakes(ctx, s) {
    if (s.phase < 4) return;
    ctx.save();
    for (let i = 0; i < 9; i++) {
      const h1 = Art.hash(i + 3), h2 = Art.hash(i + 17);
      const y = ((s.t * (22 + 18 * h2) + h1 * 520) % 520) - 470;
      const x = -260 + 520 * h1 + Math.sin(s.t * 1.3 + i) * 14;
      ctx.save(); ctx.translate(x, y); ctx.rotate(s.t * (0.8 + h2) + i);
      ctx.globalAlpha *= 0.55;
      ctx.fillStyle = i % 3 ? PAPER : GOLD; ctx.fillRect(-4, -2.5, 8, 5);
      ctx.restore();
    }
    ctx.restore();
  }

  function body(ctx, s) {
    flakes(ctx, s);
    mask(ctx, s);
    robe(ctx, s);
    controlBar(ctx, s);
    const hy = s.by - 34 + s.tremble;
    hand(ctx, s, -122, hy + Math.sin(s.t * 1.4) * 3, false);
    hand(ctx, s, 122, hy + Math.sin(s.t * 1.4 + 1.1) * 3, true);
  }

  Art.registerEnemy('kurite', {
    info: { height: 330, width: 300, fx: [0, -190], head: [0, -390], stageDx: 44 }, // (stands a little right: the band hangs left of it)
    draw(ctx, pose, opts) {
      const s = st(pose, opts);
      ctx.save();
      if (s.hitK) ctx.translate(6 * s.hitK, 0);
      body(ctx, s);
      ctx.restore();
    },
  });
})();
