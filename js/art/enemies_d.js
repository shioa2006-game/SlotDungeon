/* EMBERWHEEL — enemies_d.js : 最深の間 (Candlelit Paper Theater style).
 * Registers: kurite 深淵の繰り手 (B17, the true final boss) — TEMPORARY art for stage 4b (the battle). The finished
 * puppeteer (poses per act, the hanging puppets, the collapse) comes in stage 4c (docs/EXPANSION_4A_SPEC.md §3).
 * Two paper hands come down from above the stage holding a control bar; a kintsugi mask watches from the dark above.
 * Contract (ARCH.md "Enemies"): draw(ctx, pose, opts) with origin = feet center, facing LEFT.
 * Poses: idle · windup · attack(p) · cast · stance · hit(p) · die(p). Unknown pose -> idle. opts.phase 1..3 (the act).
 */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  const Art = SD.Art;
  if (!Art || !Art.registerEnemy) return;
  const POSES = { idle: 1, windup: 1, attack: 1, cast: 1, stance: 1, hit: 1, die: 1 };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const ease = Art.easeInOut, eOut = Art.easeOut;
  const PAPER = '#efe5cf', PAPER_SH = '#c9b994', SLEEVE = '#3a1f52', SLEEVE_SH = '#22122f', GOLD = '#e8bf6a', STRING = '#ffd257';

  function st(pose, opts) {
    opts = opts || {};
    const P = POSES[pose] ? pose : 'idle';
    const s = { pose: P, t: num(opts.t, 0), p: clamp(num(opts.p, 0), 0, 1), phase: num(opts.phase, 1) };
    s.atk = P === 'attack' ? Art.pulse(s.p, 0.35) : 0;
    s.hitK = P === 'hit' ? 1 - eOut(s.p) : 0;
    s.dieK = P === 'die' ? ease(seg(s.p, 0.05, 1)) : 0;
    s.raise = P === 'windup' ? 1 : P === 'cast' ? 0.4 : 0;
    return s;
  }

  // one paper hand on its sleeve, hanging from above (x: the wrist; fingers point down). flip mirrors it.
  function hand(ctx, x, y, s, flip, curl) {
    ctx.save(); ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
    Art.shape(ctx, (c) => Art.roundRectPath(c, -34, -260, 68, 262, 16), SLEEVE, SLEEVE_SH);
    ctx.fillStyle = GOLD; ctx.fillRect(-36, -8, 72, 8);
    Art.shape(ctx, (c) => Art.blobPath(c, [[-38, 0], [38, 0], [46, 48], [22, 78], [-22, 78], [-44, 48]], 1), PAPER, PAPER_SH, { dx: -4, dy: -4 });
    const fingers = [[-30, 44], [-10, 58], [10, 56], [30, 42]];
    fingers.forEach(([fx, len], i) => {
      const sway = Math.sin(s.t * 1.6 + i * 0.9) * 0.08 + curl * 0.5;
      ctx.save(); ctx.translate(fx, 70); ctx.rotate(sway * (i < 2 ? -1 : 1));
      Art.shape(ctx, (c) => Art.roundRectPath(c, -7, 0, 14, len, 7), PAPER, PAPER_SH, { lw: 2.2 });
      ctx.beginPath(); ctx.arc(0, len * 0.5, 2.6, 0, Math.PI * 2); ctx.fillStyle = '#7a5520'; ctx.fill();
      ctx.restore();
    });
    ctx.restore();
  }

  function mask(ctx, x, y, s) {
    Art.glow(ctx, x, y, 120, 'rgba(197,139,255,0.35)', 0.8 + 0.2 * Math.sin(s.t * 1.3));
    Art.shape(ctx, (c) => Art.ellipsePath(c, x, y, 62, 56), PAPER, PAPER_SH, { dx: -6, dy: -5 });
    for (const ex of [-24, 24]) {
      ctx.beginPath(); ctx.ellipse(x + ex, y - 8, 14, 6, ex < 0 ? 0.15 : -0.15, 0, Math.PI * 2); ctx.fillStyle = '#1a1222'; ctx.fill();
      Art.enemyEye(ctx, x + ex, y - 8, 4, { color: '#d9c4ff', glowColor: 'rgba(170,120,255,0.9)', slit: 1, blink: s.hitK });
    }
    ctx.beginPath(); ctx.moveTo(x - 20, y + 26); ctx.quadraticCurveTo(x, y + 34, x + 20, y + 26); Art.strokeOnly(ctx, 2.2);
    // kintsugi: gold seams that spread with each act
    const seams = [
      [[x, y - 56], [x - 5, y - 30], [x + 6, y - 6], [x - 2, y + 20]],
      [[x + 50, y - 30], [x + 34, y - 14], [x + 40, y + 6]],
      [[x - 56, y + 4], [x - 36, y + 12], [x - 30, y + 34]],
    ];
    seams.slice(0, Math.min(3, s.phase)).forEach((pts) => {
      ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.lineWidth = 2.6; ctx.strokeStyle = GOLD; ctx.lineJoin = 'round'; ctx.stroke();
    });
  }

  function body(ctx, s) {
    const lift = -36 * s.raise - 20 * s.hitK + 46 * s.atk;
    const bob = Math.sin(s.t * 1.1) * 5;
    // the mask watches from above (it comes down a little lower each act)
    mask(ctx, 0, -330 + (s.phase - 1) * 14 + bob * 0.4, s);
    // the control bar held between the hands, and its strings
    const by = -205 + lift + bob;
    ctx.save(); ctx.lineCap = 'round';
    const strings = s.phase >= 3 ? 3 : s.phase >= 2 ? 2 : 1;
    for (let k = 0; k < 3; k++) {
      const sx = -70 + k * 70, on = k < strings;
      ctx.strokeStyle = on ? 'rgba(255,210,87,0.35)' : 'rgba(255,210,87,0.12)'; ctx.lineWidth = on ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(sx, by + 8); ctx.quadraticCurveTo(sx - 20, by + 90, sx - 40 - k * 6, -24); ctx.stroke();
      if (on) { ctx.strokeStyle = STRING; ctx.lineWidth = 1.4; ctx.stroke(); Art.glow(ctx, sx - 40 - k * 6, -24, 12, 'rgba(255,210,87,0.8)', 0.7); }
    }
    ctx.restore();
    Art.shape(ctx, (c) => Art.roundRectPath(c, -100, by - 8, 200, 16, 7), '#6b4a2a', '#4a3214');
    Art.shape(ctx, (c) => Art.roundRectPath(c, -8, by - 40, 16, 84, 7), '#6b4a2a', '#4a3214');
    // the two hands
    hand(ctx, -122, by - 34 + Math.sin(s.t * 1.4) * 3, s, false, s.raise * 0.6);
    hand(ctx, 122, by - 34 + Math.sin(s.t * 1.4 + 1.1) * 3, s, true, s.raise * 0.6);
  }

  Art.registerEnemy('kurite', {
    info: { height: 330, width: 300, fx: [0, -190], head: [0, -390] },
    draw(ctx, pose, opts) {
      const s = st(pose, opts);
      ctx.save();
      if (s.hitK) ctx.translate(6 * s.hitK, 0);
      if (s.dieK > 0) { ctx.globalAlpha *= 1 - 0.95 * s.dieK; ctx.translate(0, s.dieK * 60); }
      body(ctx, s);
      ctx.restore();
    },
  });
})();
