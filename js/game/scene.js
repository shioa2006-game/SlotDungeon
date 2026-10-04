/* EMBERWHEEL — the stage: backdrop, proscenium, puppets (heroes/enemy), bars, intent bubbles, curtain. */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});

  const HERO_POS = { priest: { x: 175, y: 372 }, witch: { x: 285, y: 364 }, knight: { x: 395, y: 378 } };
  const ENEMY_POS = { x: 930, y: 376 };
  const BOSS_POS = { x: 960, y: 404 };

  // ---------------------------------------------------------------- actor (a puppet on the stage)
  class Actor {
    constructor(kind, id, x, y, opts = {}) {
      this.kind = kind; this.id = id; this.x = x; this.y = y; this.baseX = x; this.baseY = y;
      this.pose = 'idle'; this.p = 0; this.dur = 0; this.hold = null; // hold = persistent pose (windup/stance/dead)
      this.flash = 0; this.alpha = 1; this.variant = opts.variant || null; this.enraged = !!opts.enraged;
      this.phase = 1; this.seals = 0; this.mood = 'normal'; this.dx = 0; this.dy = 0; this.scale = opts.scale || 1;
      this.t0 = Math.random() * 10; this.visible = true;
    }
    play(pose, dur) { this.pose = pose; this.p = 0; this.dur = Math.max(0.05, dur || 0.5); }
    setHold(pose) { this.hold = pose; }
    update(dt) {
      if (this.pose !== 'idle' && this.dur > 0) {
        this.p += dt / this.dur;
        if (this.p >= 1) { this.p = 1; if (this.pose !== 'dead' && this.pose !== 'die') { this.pose = 'idle'; this.p = 0; } }
      }
      this.flash = Math.max(0, this.flash - dt * 5);
    }
    current() {
      if (this.pose !== 'idle') return { pose: this.pose, p: this.p };
      if (this.hold) return { pose: this.hold, p: 0.5 };
      return { pose: 'idle', p: 0 };
    }
    info() { return this.kind === 'hero' ? SD.Art.heroInfo(this.id) : SD.Art.enemyInfo(this.id); }
  }

  // draw with optional white flash via an offscreen buffer
  let buf = null, bctx = null;
  function drawActor(ctx, a, t) {
    if (!a.visible || a.alpha <= 0.01) return;
    const Art = SD.Art;
    const cur = a.current();
    const opts = { t: t + a.t0, p: cur.p, mood: a.mood, enraged: a.enraged, variant: a.variant, phase: a.phase, seals: a.seals };
    const info = a.info();
    // ground shadow
    ctx.save();
    ctx.globalAlpha = 0.45 * a.alpha;
    ctx.fillStyle = '#07050d';
    const sw = (info.width || 80) * 0.55 * a.scale;
    ctx.beginPath(); ctx.ellipse(a.x + a.dx, a.y + 2, sw, sw * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const draw = (c) => {
      if (a.kind === 'hero') Art.drawHero(c, a.id, cur.pose, opts);
      else Art.drawEnemy(c, a.id, cur.pose, opts);
    };
    if (a.flash > 0.02 && typeof document !== 'undefined') {
      const k = SD.Game.renderScale;
      const W = Math.ceil((info.width || 120) * a.scale + 260), H = Math.ceil((info.height || 120) * a.scale + 200);
      if (!buf) { buf = document.createElement('canvas'); bctx = buf.getContext('2d'); }
      if (buf.width < W * k || buf.height < H * k) { buf.width = Math.ceil(W * k); buf.height = Math.ceil(H * k); }
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, buf.width, buf.height);
      bctx.setTransform(k, 0, 0, k, (W / 2) * k, (H - 60) * k);
      bctx.save(); bctx.scale(a.scale, a.scale); draw(bctx); bctx.restore();
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.globalCompositeOperation = 'source-atop';
      bctx.fillStyle = `rgba(255,255,255,${Math.min(1, a.flash)})`;
      bctx.fillRect(0, 0, buf.width, buf.height);
      bctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.globalAlpha = a.alpha;
      ctx.drawImage(buf, 0, 0, W * k, H * k, a.x + a.dx - W / 2, a.y + a.dy - (H - 60), W, H);
      ctx.restore();
    } else {
      ctx.save(); ctx.globalAlpha = a.alpha; ctx.translate(a.x + a.dx, a.y + a.dy); ctx.scale(a.scale, a.scale); draw(ctx); ctx.restore();
    }
  }

  // ---------------------------------------------------------------- scene
  class Scene {
    constructor() {
      this.heroes = {
        priest: new Actor('hero', 'priest', HERO_POS.priest.x, HERO_POS.priest.y),
        witch: new Actor('hero', 'witch', HERO_POS.witch.x, HERO_POS.witch.y),
        knight: new Actor('hero', 'knight', HERO_POS.knight.x, HERO_POS.knight.y),
      };
      this.enemy = null;
      this.zone = 'cellar';
      this.depth = 0;
      this.camX = 0;
      this.camTarget = 0;
      this.time = 0;
      this.walking = 0;
      this.title = null;     // zone title card { str, sub, t }
      this.curtain = 0;      // 0 = up (hidden) .. 1 = fully down
      this.curtainTarget = 0;
      this.bossDark = 0;
    }

    heroList() { return [this.heroes.priest, this.heroes.witch, this.heroes.knight]; }

    setEnemy(snap) {
      if (!snap) { this.enemy = null; return; }
      const pos = snap.boss ? BOSS_POS : ENEMY_POS;
      const a = new Actor('enemy', snap.art, pos.x, pos.y, { variant: snap.variant, enraged: snap.dread });
      a.phase = snap.phase || 1; a.seals = snap.seals || 0;
      this.enemy = a;
      return a;
    }

    update(dt) {
      this.time += dt;
      for (const h of this.heroList()) h.update(dt);
      if (this.enemy) this.enemy.update(dt);
      this.camX += (this.camTarget - this.camX) * Math.min(1, dt * 2.2);
      if (this.title) { this.title.t += dt; if (this.title.t > 2.0) this.title = null; }
      this.curtain += (this.curtainTarget - this.curtain) * Math.min(1, dt * (this.curtainTarget > this.curtain ? 4.2 : 3));
      if (Math.abs(this.curtain - this.curtainTarget) < 0.002) this.curtain = this.curtainTarget;
    }

    drawStage(ctx, st) {
      const Art = SD.Art;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, 1280, 446); ctx.clip();
      if (Art.drawBackground) Art.drawBackground(ctx, this.zone, { t: this.time, camX: this.camX, W: 1280, H: 446, depth: this.depth });
      else { ctx.fillStyle = '#17142a'; ctx.fillRect(0, 0, 1280, 446); }
      if (this.bossDark > 0) { ctx.fillStyle = `rgba(5,3,10,${this.bossDark * 0.5})`; ctx.fillRect(0, 0, 1280, 446); }
      // stage lighting: the backdrop sits a step back, the wheel below is the footlight
      const g = ctx.createLinearGradient(0, 0, 0, 446);
      g.addColorStop(0, 'rgba(10,8,18,0.42)'); g.addColorStop(0.35, 'rgba(10,8,18,0.22)'); g.addColorStop(0.8, 'rgba(10,8,18,0.16)'); g.addColorStop(1, 'rgba(10,8,18,0.30)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 446);
      Art.glow(ctx, 640, 470, 640, 'rgba(255,170,90,0.16)', 1);
      // actors (enemy behind heroes' layer order doesn't matter much: they don't overlap)
      if (this.enemy) drawActor(ctx, this.enemy, this.time);
      for (const h of this.heroList()) drawActor(ctx, h, this.time);
      if (st && st.drawWorldFx) st.drawWorldFx(ctx);
      if (Art.drawForeground) Art.drawForeground(ctx, this.zone, { t: this.time, camX: this.camX, W: 1280, H: 446, depth: this.depth });
      ctx.restore();
    }

    // HUD that lives on the stage (bars, bubbles)
    drawHud(ctx, st) {
      const Art = SD.Art, G = SD.Game;
      // party bar
      const V = st.V;
      if (V && st.showPartyBar) drawPartyBar(ctx, V, this.time);
      if (this.enemy && V && V.enemy && st.showEnemyBar) {
        const e = this.enemy, info = e.info();
        if (V.enemy.boss) drawEnemyBar(ctx, V.enemy, 640, 104, this.time, st.ghostPct);
        else drawEnemyBar(ctx, V.enemy, e.x, 392, this.time, st.ghostPct);
        if (st.intent) {
          if (V.enemy.boss) drawIntent(ctx, st.intent, e.x - 250, 214, this.time, st);
          else drawIntent(ctx, st.intent, e.x + (info.head ? info.head[0] : 0), e.y + (info.head ? info.head[1] : -info.height) - 18, this.time, st);
        }
      }
      void Art; void G;
    }

    drawZoneTitle(ctx) {
      if (!this.title) return;
      const k = this.title.t, a = k < 0.25 ? k / 0.25 : k > 1.5 ? Math.max(0, 1 - (k - 1.5) / 0.5) : 1;
      ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(10,8,18,0.55)'; ctx.fillRect(0, 150, 1280, 110);
      ctx.font = `700 22px ${SD.Game.fontUI}`; ctx.fillStyle = '#c9b994'; ctx.fillText(this.title.sub, 640, 180);
      ctx.font = `900 46px ${SD.Game.fontTitle}`; ctx.lineWidth = 8; ctx.strokeStyle = '#1a1222'; ctx.lineJoin = 'round';
      ctx.strokeText(this.title.str, 640, 224); ctx.fillStyle = '#ffe1a0'; ctx.fillText(this.title.str, 640, 224);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- HUD pieces
  function bar(ctx, x, y, w, h, frac, ghost, colors) {
    ctx.save();
    SD.Art.roundRectPath(ctx, x - 2, y - 2, w + 4, h + 4, h / 2 + 2); ctx.fillStyle = '#1a1222'; ctx.fill();
    SD.Art.roundRectPath(ctx, x, y, w, h, h / 2); ctx.fillStyle = colors.bg; ctx.fill();
    if (ghost > frac) { SD.Art.roundRectPath(ctx, x, y, Math.max(h, w * ghost), h, h / 2); ctx.fillStyle = colors.ghost; ctx.fill(); }
    if (frac > 0) {
      SD.Art.roundRectPath(ctx, x, y, Math.max(h, w * frac), h, h / 2); ctx.fillStyle = colors.fg; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; SD.Art.roundRectPath(ctx, x + 3, y + 2, Math.max(h - 6, w * frac - 6), h * 0.35, h * 0.2); ctx.fill();
    }
    ctx.restore();
  }

  function numText(ctx, str, x, y, size, color, align = 'center') {
    ctx.save();
    ctx.font = `800 ${size}px ${SD.Game.fontNum}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size * 0.22); ctx.strokeStyle = '#1a1222';
    ctx.strokeText(str, x, y); ctx.fillStyle = color; ctx.fillText(str, x, y);
    ctx.restore();
  }

  function drawPartyBar(ctx, V, t) {
    const x = 150, y = 398, w = 270, h = 16;
    const frac = Math.max(0, V.hpShown / V.maxHp), ghost = Math.max(0, V.hpGhost / V.maxHp);
    const low = frac < 0.3;
    bar(ctx, x, y, w, h, frac, ghost, { bg: '#2b1622', fg: low ? (Math.sin(t * 8) > 0 ? '#ff5d6b' : '#e0404f') : '#e9485a', ghost: '#ffd0a0' });
    if (V.pred > 0) {
      const after = Math.max(0, V.hpShown - V.pred) / V.maxHp;
      const px = x + w * after, pw = Math.max(2, w * (frac - after));
      ctx.save();
      SD.Art.roundRectPath(ctx, x, y, w, h, h / 2); ctx.clip();
      ctx.fillStyle = `rgba(20,6,12,${0.55 + 0.2 * Math.sin(t * 6)})`; ctx.fillRect(px, y, pw, h);
      ctx.strokeStyle = 'rgba(255,120,130,0.9)'; ctx.lineWidth = 2;
      for (let k = px - h; k < px + pw; k += 6) { ctx.beginPath(); ctx.moveTo(k, y + h); ctx.lineTo(k + h, y); ctx.stroke(); }
      ctx.restore();
      if (V.pred >= V.hpShown) numText(ctx, '致命', x - 22, y + h / 2 + 1, 14, '#ff6a6a');
    }
    numText(ctx, `${Math.max(0, Math.round(V.hpShown))} / ${V.maxHp}`, x + w / 2, y + h / 2 + 1, 15, '#fff6e8');
    if (V.block > 0) {
      const bx = x + w + 22, by = y + h / 2;
      if (SD.Art.drawIcon) SD.Art.drawIcon(ctx, 'block', bx, by, 34, {});
      numText(ctx, String(V.block), bx, by + 1, 16, '#dff4ff');
    }
  }

  function drawEnemyBar(ctx, E, cx, y, t, ghostPct) {
    const w = E.boss ? 520 : 200, h = E.boss ? 16 : 14, x = cx - w / 2;
    const frac = Math.max(0, E.hpShown / E.maxHp), ghost = Math.max(0, E.hpGhost / E.maxHp);
    bar(ctx, x, y, w, h, frac, ghost, { bg: '#2a1520', fg: E.dread ? '#ff3b4e' : '#d8405a', ghost: '#ffd0a0' });
    if (ghostPct != null && ghostPct > 0 && ghostPct < 1) {
      const gx = x + w * ghostPct;
      ctx.save(); ctx.strokeStyle = '#ffe1a0'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(gx, y - 6); ctx.lineTo(gx, y + h + 6); ctx.stroke();
      ctx.setLineDash([]); ctx.font = `700 11px ${SD.Game.fontUI}`; ctx.fillStyle = '#ffe1a0'; ctx.textAlign = 'center';
      ctx.fillText('最高記録', gx, y + h + 17); ctx.restore();
    }
    numText(ctx, `${Math.max(0, Math.round(E.hpShown))}`, cx, y + h / 2 + 1, 14, '#fff6e8');
    // name (under the bar so it never covers the puppet)
    ctx.save(); ctx.font = `700 15px ${SD.Game.fontUI}`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    const ny = E.boss ? y - 10 : y + h + 15;
    ctx.lineWidth = 4; ctx.strokeStyle = '#1a1222'; ctx.strokeText(E.name, cx, ny);
    ctx.fillStyle = E.dread ? '#ff8a8a' : E.elite || E.boss ? '#ffd257' : '#efe5cf'; ctx.fillText(E.name, cx, ny); ctx.restore();
    // badges right of the bar
    let bx = x + w + 20;
    const badge = (icon, val, color) => {
      if (SD.Art.drawIcon) SD.Art.drawIcon(ctx, icon, bx, y + h / 2, 28, {});
      if (val != null) numText(ctx, String(val), bx + 1, y + h / 2 + 12, 13, color);
      bx += 30;
    };
    if (E.block > 0) badge('block', E.block, '#dff4ff');
    if (E.armorNow > 0) badge('armor', E.armorNow, '#e6e6f0');
    if (E.burn > 0) badge('burn', E.burn, '#ffb070');
    // seals for the boss
    if (E.boss && E.maxSeals) {
      for (let k = 0; k < E.maxSeals; k++) {
        const sx = x + 14 + k * 30, sy = y + h + 18;
        ctx.save(); ctx.globalAlpha = k < E.seals ? 1 : 0.25;
        if (SD.Art.drawIcon) SD.Art.drawIcon(ctx, 'seal', sx, sy, 26, {});
        ctx.restore();
      }
    }
  }

  // intent bubble: a small hanging lantern-like plaque
  function drawIntent(ctx, I, cx, by, t, st) {
    const Art = SD.Art;
    const w = Math.max(96, I.width || 0), h = 50;
    const x = cx - w / 2, y = Math.max(I.hint ? 76 : 54, by - h);
    const bob = Math.sin(t * 2.4) * 2;
    const age = I.born != null ? t - I.born : 9;
    const pop = (age < 0.3 ? 1 + 0.35 * (1 - SD.Art.easeOutBack(age / 0.3)) : 1) * (I.lethal ? 1.15 : 1);
    ctx.save(); ctx.translate(0, bob);
    if (pop !== 1) { ctx.translate(cx, y + h / 2); ctx.scale(pop, pop); ctx.translate(-cx, -(y + h / 2)); }
    // string
    ctx.strokeStyle = 'rgba(232,191,106,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, y + h); ctx.lineTo(cx, y + h + 10); ctx.stroke();
    if (I.danger) Art.glow(ctx, cx, y + h / 2, 90, 'rgba(255,80,60,0.55)', 0.5 + 0.3 * Math.sin(t * 6));
    Art.roundRectPath(ctx, x, y, w, h, 12); ctx.fillStyle = 'rgba(24,17,34,0.94)'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = I.danger ? '#ff6a5a' : '#c9953b'; ctx.stroke();
    const iconX = x + 26;
    if (Art.drawIcon) Art.drawIcon(ctx, I.icon, iconX, y + h / 2, 34, { t });
    if (I.sym && Art.drawSymbol) Art.drawSymbol(ctx, I.sym, iconX + 34, y + h / 2, 30, {});
    const tx = I.sym ? iconX + 56 : iconX + 26;
    if (I.value != null) numText(ctx, String(I.value), tx + 10, y + h / 2 + 1, 26, I.danger ? '#ff9a8a' : '#fff6e8', 'left');
    ctx.font = `700 13px ${SD.Game.fontUI}`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    ctx.lineWidth = 4; ctx.strokeStyle = '#1a1222';
    ctx.strokeText(I.label, cx, y - 9); ctx.fillStyle = I.danger ? '#ffb0a0' : '#efe5cf'; ctx.fillText(I.label, cx, y - 9);
    if (I.lethal) {
      Art.roundRectPath(ctx, x + w - 34, y - 12, 44, 20, 6); ctx.fillStyle = '#c8243a'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#1a1222'; ctx.stroke();
      ctx.font = `900 12px ${SD.Game.fontUI}`; ctx.fillStyle = '#fff0f0'; ctx.fillText('致命', x + w - 12, y + 3);
    }
    if (I.hint) {
      ctx.font = `700 13px ${SD.Game.fontUI}`;
      const hw = ctx.measureText(I.hint).width + 18;
      Art.roundRectPath(ctx, cx - hw / 2, y - 48, hw, 20, 10); ctx.fillStyle = 'rgba(16,40,52,0.95)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#6fd3ff'; ctx.stroke();
      ctx.fillStyle = '#bff0ff'; ctx.fillText(I.hint, cx, y - 33);
    }
    ctx.restore();
    // active stance badge (on the enemy, now)
    if (I.now) {
      const nx = cx + w / 2 + 34, ny = y + h / 2 + bob;
      Art.glow(ctx, nx, ny, 44, I.now.glow || 'rgba(197,139,255,0.6)', 0.6 + 0.3 * Math.sin(t * 5));
      Art.roundRectPath(ctx, nx - 30, ny - 24, 60, 48, 10); ctx.fillStyle = 'rgba(30,18,44,0.95)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#c58bff'; ctx.stroke();
      if (Art.drawIcon) Art.drawIcon(ctx, I.now.icon, nx - (I.now.sym ? 12 : 0), ny, 28, { t });
      if (I.now.sym && Art.drawSymbol) Art.drawSymbol(ctx, I.now.sym, nx + 13, ny, 24, {});
      if (I.now.value != null) numText(ctx, '+' + I.now.value, nx + 14, ny + 13, 13, '#e6e6f0');
      ctx.save(); ctx.font = `700 12px ${SD.Game.fontUI}`; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#1a1222'; ctx.lineJoin = 'round';
      ctx.strokeText(I.now.label, nx, ny - 31); ctx.fillStyle = '#e2c8ff'; ctx.fillText(I.now.label, nx, ny - 31); ctx.restore();
    }
  }

  // ---------------------------------------------------------------- proscenium & curtain
  function drawProscenium(ctx, t) {
    const Art = SD.Art, P = Art.PAL;
    ctx.save();
    // side pillars
    for (const side of [0, 1]) {
      const x = side ? 1280 - 24 : 0;
      ctx.fillStyle = '#140f1e'; ctx.fillRect(x, 0, 24, 446);
      ctx.fillStyle = '#2a1f33'; ctx.fillRect(x + (side ? 0 : 6), 0, 12, 446);
      ctx.fillStyle = P.brassDark; ctx.fillRect(x + (side ? 2 : 18), 0, 3, 446);
      ctx.fillStyle = P.brass; ctx.fillRect(x + (side ? 3 : 19), 0, 1, 446);
      for (let yy = 70; yy < 446; yy += 110) {
        ctx.fillStyle = P.brass; ctx.beginPath(); ctx.arc(x + 12, yy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = P.brassLight; ctx.beginPath(); ctx.arc(x + 11, yy - 1, 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    // valance with swags
    const swagN = 7, sw = 1280 / swagN;
    ctx.fillStyle = '#3a0f1c'; ctx.fillRect(0, 0, 1280, 18);
    for (let k = 0; k < swagN; k++) {
      const x0 = k * sw;
      ctx.beginPath(); ctx.moveTo(x0, 10); ctx.quadraticCurveTo(x0 + sw / 2, 52 + Math.sin(t * 0.6 + k) * 1.5, x0 + sw, 10);
      ctx.lineTo(x0 + sw, 0); ctx.lineTo(x0, 0); ctx.closePath();
      ctx.fillStyle = '#6a1a2c'; ctx.fill();
      // folds
      ctx.strokeStyle = 'rgba(20,4,10,0.45)'; ctx.lineWidth = 3;
      for (const f of [0.3, 0.5, 0.7]) { ctx.beginPath(); ctx.moveTo(x0 + sw * f, 2); ctx.quadraticCurveTo(x0 + sw * f, 26, x0 + sw * (0.5 + (f - 0.5) * 0.8), 40); ctx.stroke(); }
      // gold fringe
      ctx.beginPath(); ctx.moveTo(x0, 10); ctx.quadraticCurveTo(x0 + sw / 2, 52 + Math.sin(t * 0.6 + k) * 1.5, x0 + sw, 10);
      ctx.strokeStyle = P.brass; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = '#1a1222'; ctx.lineWidth = 1; ctx.stroke();
      // tassel
      ctx.fillStyle = P.brassLight; ctx.beginPath(); ctx.arc(x0, 12, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#1a1222'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.fillStyle = P.brassDark; ctx.fillRect(0, 0, 1280, 4);
    // stage lip
    const g = ctx.createLinearGradient(0, 432, 0, 448);
    g.addColorStop(0, '#3b2416'); g.addColorStop(1, '#170d08');
    ctx.fillStyle = g; ctx.fillRect(0, 434, 1280, 14);
    ctx.fillStyle = P.brass; ctx.fillRect(0, 433, 1280, 2);
    ctx.restore();
  }

  function drawCurtain(ctx, amt, t) {
    if (amt <= 0.001) return;
    const y = -720 + 720 * amt;
    ctx.save();
    ctx.translate(0, y);
    const g = ctx.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, '#4a0f1d'); g.addColorStop(1, '#2a0812');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 720);
    // vertical folds
    for (let x = 0; x < 1280; x += 64) {
      const sway = Math.sin(t * 0.8 + x * 0.05) * 3;
      const fg = ctx.createLinearGradient(x, 0, x + 64, 0);
      fg.addColorStop(0, 'rgba(0,0,0,0.38)'); fg.addColorStop(0.45, 'rgba(255,120,140,0.10)'); fg.addColorStop(0.55, 'rgba(255,120,140,0.10)'); fg.addColorStop(1, 'rgba(0,0,0,0.38)');
      ctx.fillStyle = fg; ctx.fillRect(x + sway, 0, 64, 720);
    }
    // fringe
    ctx.fillStyle = SD.Art.PAL.brass; ctx.fillRect(0, 700, 1280, 8);
    for (let x = 4; x < 1280; x += 12) { ctx.fillStyle = SD.Art.PAL.brassLight; ctx.fillRect(x, 708, 4, 12); }
    ctx.restore();
  }

  let apronCache = null;
  function drawApron(ctx, t) {
    const Art = SD.Art, P = Art.PAL;
    if (!apronCache && typeof document !== 'undefined') {
      const k = Math.max(1, Math.ceil(SD.Game.renderScale || 1));
      const c = document.createElement('canvas'); c.width = 1280 * k; c.height = 274 * k;
      const g = c.getContext('2d'); g.setTransform(k, 0, 0, k, 0, 0);
      const base = g.createLinearGradient(0, 0, 0, 274);
      base.addColorStop(0, '#2a1a14'); base.addColorStop(1, '#140c0a');
      g.fillStyle = base; g.fillRect(0, 0, 1280, 274);
      // planks
      for (let y = 0, row = 0; y < 274; y += 34, row++) {
        g.fillStyle = row % 2 ? 'rgba(255,220,180,0.025)' : 'rgba(0,0,0,0.10)'; g.fillRect(0, y, 1280, 34);
        g.fillStyle = 'rgba(8,4,4,0.55)'; g.fillRect(0, y, 1280, 2);
        for (let x = (row * 173) % 260; x < 1280; x += 260) { g.fillStyle = 'rgba(8,4,4,0.5)'; g.fillRect(x, y, 2, 34); }
        for (let i = 0; i < 26; i++) {
          const gx = (Art.hash(row * 31 + i) * 1280) | 0, gw = 30 + Art.hash(row * 7 + i * 3) * 90;
          g.fillStyle = 'rgba(255,210,170,0.03)'; g.fillRect(gx, y + 8 + Art.hash(i + row) * 18, gw, 1.5);
        }
      }
      // brass trim along the stage edge
      g.fillStyle = P.brassDark; g.fillRect(0, 0, 1280, 4); g.fillStyle = P.brass; g.fillRect(0, 1, 1280, 1.5);
      // brackets under the side panels
      for (const [x, w] of [[8, 336], [1028, 244]]) {
        Art.roundRectPath(g, x, 6, w, 264, 16); g.fillStyle = 'rgba(10,6,12,0.55)'; g.fill();
        g.lineWidth = 2; g.strokeStyle = 'rgba(122,85,32,0.8)'; g.stroke();
        for (const [bx, by] of [[x + 10, 16], [x + w - 10, 16], [x + 10, 260], [x + w - 10, 260]]) {
          g.fillStyle = P.brass; g.beginPath(); g.arc(bx, by, 3.2, 0, Math.PI * 2); g.fill();
          g.fillStyle = P.brassLight; g.beginPath(); g.arc(bx - 1, by - 1, 1.2, 0, Math.PI * 2); g.fill();
        }
      }
      apronCache = c;
    }
    if (apronCache) ctx.drawImage(apronCache, 0, 446, 1280, 274);
    else { ctx.fillStyle = '#140c0a'; ctx.fillRect(0, 446, 1280, 274); }
    // footlight spill from the wheel
    Art.glow(ctx, 640, 470, 520, 'rgba(255,170,90,0.20)', 0.85 + 0.15 * Math.sin(t * 1.7));
  }

  SD.Scene = Scene;
  SD.Actor = Actor;
  SD.StageDraw = { drawProscenium, drawCurtain, drawApron, numText, bar };
  SD.HERO_POS = HERO_POS;
})();
