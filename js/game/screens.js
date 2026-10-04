/* EMBERWHEEL — screens: Title, Camp (灯紋の輪), Run (the descent). */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  const UI = () => SD.UI;

  // =====================================================================================
  // TITLE
  // =====================================================================================
  class TitleScreen {
    enter() {
      const G = SD.Game, U = UI();
      U.clear();
      this.t = 0;
      const root = U.root();
      const box = U.el('div', 'title-box');
      box.appendChild(U.el('div', 'title-en', 'EMBERWHEEL'));
      box.appendChild(U.el('div', 'title-jp', '灯輪と深淵'));
      box.appendChild(U.el('div', 'title-sub', '運に翻弄された灯は、やがて運命を組み立てる'));
      const first = G.profile.stats.runs === 0;
      const b = U.button(first ? '灯をともす' : '野営地へ', 'primary big', () => {
        if (SD.Audio) { SD.Audio.init(); SD.Audio.play('unlock'); }
        if (first) G.setScreen(new RunScreen({ startFloor: 1 }));
        else G.setScreen(new CampScreen());
      });
      box.appendChild(b);
      box.appendChild(U.el('div', 'title-hint', 'クリック または Space'));
      root.appendChild(box);
      root.appendChild(G.settingsButton());
      if (SD.Audio) SD.Audio.setMusic('title');
    }
    onKey(e) { if (e.code === 'Space' || e.code === 'Enter') { const b = document.querySelector('.title-box .btn'); if (b) b.click(); } }
    update(dt) { this.t += dt; }
    render(ctx) {
      const Art = SD.Art;
      if (Art.drawBackground) Art.drawBackground(ctx, 'title', { t: this.t, camX: this.t * 6, W: 1280, H: 720, depth: 0 });
      else { ctx.fillStyle = '#0d0b16'; ctx.fillRect(0, 0, 1280, 720); }
      // the wheel emblem glowing behind the title
      ctx.save();
      Art.glow(ctx, 640, 250, 300, 'rgba(255,170,80,0.35)', 0.8 + 0.2 * Math.sin(this.t * 1.3));
      ctx.translate(640, 250); ctx.rotate(this.t * 0.08);
      ctx.strokeStyle = 'rgba(232,191,106,0.35)'; ctx.lineWidth = 3;
      for (let r of [150, 175]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); }
      for (let k = 0; k < 12; k++) { ctx.rotate(Math.PI / 6); ctx.beginPath(); ctx.moveTo(150, 0); ctx.lineTo(175, 0); ctx.stroke(); }
      ctx.restore();
      if (Art.drawHero) {
        const xs = [560, 640, 720];
        ['priest', 'witch', 'knight'].forEach((id, i) => {
          ctx.save(); ctx.translate(xs[i], 560); Art.drawHero(ctx, id, 'idle', { t: this.t + i, p: 0 }); ctx.restore();
        });
      }
    }
  }

  // =====================================================================================
  // CAMP — the 灯紋 wheel
  // =====================================================================================
  const TREE_C = { x: 610, y: 388 };
  const RING_R = [0, 72, 128, 184, 242, 292];
const TREE_SX = 1.12;
  const BRANCH_COL = { weave: '#c58bff', valor: '#ff6a5a', hearth: '#4fe0a8', bridge: '#e8bf6a', core: '#ffd257' };
  const KIND_TAG = { verb: '新しい操作', rule: 'ルール', prob: '確率空間', stat: '数値', room: '部屋', core: '' };

  function nodePos(n) {
    const a = (n.a * Math.PI) / 180, r = RING_R[n.r] || 0;
    return { x: TREE_C.x + Math.cos(a) * r * TREE_SX, y: TREE_C.y + Math.sin(a) * r };
  }

  class CampScreen {
    constructor(opts = {}) { this.focus = opts.focus || null; this.t = 0; this.burst = []; }
    enter() {
      const G = SD.Game, U = UI();
      U.clear();
      this.profile = G.profile;
      this.hover = null;
      this.sel = this.focus || null;
      if (SD.Audio) SD.Audio.setMusic('camp');
      const root = U.root();
      // top bar
      this.top = U.el('div', 'camp-top');
      root.appendChild(this.top);
      // left: records
      this.left = U.el('div', 'panel camp-left');
      root.appendChild(this.left);
      // right: detail
      this.right = U.el('div', 'panel camp-right');
      root.appendChild(this.right);
      // descend
      this.desc = U.el('div', 'camp-descend');
      root.appendChild(this.desc);
      root.appendChild(G.settingsButton());
      this.refresh();
      if (!this.sel) {
        const rec = SD.Meta.recommendedNode(this.profile, this.profile.seen.lastWhisper);
        this.sel = rec ? rec.id : null;
        this.renderDetail();
      }
    }

    refresh() {
      const U = UI(), p = this.profile, s = p.stats;
      const aff = SD.Meta.nextGoals(p, 10).filter((g) => SD.Meta.canUnlock(p, g.id));
      const recNode = SD.Meta.recommendedNode(p, p.seen.lastWhisper);
      this.recommend = recNode && SD.Meta.canUnlock(p, recNode.id) ? recNode.id : (aff.find((g) => g.kind === 'verb') || aff[0] || {}).id || null;
      this.top.innerHTML = '';
      const em = U.el('div', 'plaque embers-big');
      em.appendChild(U.icon('ember', 30));
      em.appendChild(U.el('span', 'n', String(p.embers)));
      em.appendChild(U.el('span', 'lbl', '残り火'));
      this.top.appendChild(em);
      this.top.appendChild(U.el('div', 'camp-title', '灯紋の輪 <small>— 残り火で灯輪に新たな紋を灯す</small>'));
      // records
      const best = s.bossBestHpPct != null ? `灰輪の主 残り ${Math.round(s.bossBestHpPct * 100)}%` : '—';
      this.left.innerHTML = `<div class="ph">記録</div>
        <div class="rec"><span>降下</span><b>${s.runs} 回</b></div>
        <div class="rec"><span>最深</span><b>B${s.bestFloor || 0}</b></div>
        <div class="rec"><span>前回</span><b>B${s.lastFloor || 0}</b></div>
        <div class="rec"><span>三連</span><b>${s.triples}</b></div>
        <div class="rec"><span>ボス最高</span><b>${s.bossKills ? '討伐 ' + s.bossKills + '回' : best}</b></div>`;
      const recN = SD.Meta.recommendedNode(p, p.seen.lastWhisper);
      if (recN) {
        const g = recN;
        const need = g.cost - p.embers;
        this.left.appendChild(U.el('div', 'goal', need > 0 ? `次の目標: <b>${g.name}</b> まで あと <b class="em">${need}</b>` : `<b>${g.name}</b> を灯せる！`));
      }
      this.renderDetail();
      this.renderDescend();
    }

    renderDescend() {
      const U = UI(), G = SD.Game;
      this.desc.innerHTML = '';
      const mods = SD.Meta.computeMods(this.profile);
      const fresh = (this.profile.seen.fresh || []).map((id) => SD.Data.SKILL_BY_ID[id]).filter(Boolean);
      const verb = fresh.filter((n) => n.kind === 'verb' || n.kind === 'rule').pop();
      const b1 = U.button(verb ? `降下する <small>【${verb.name}】を試す・B1から</small>` : '降下する <small>B1から</small>', 'primary big', () => G.setScreen(new RunScreen({ startFloor: 1 })));
      this.desc.appendChild(b1);
      if (mods.shortcuts.indexOf(5) >= 0) {
        const b5 = U.button(`第二層から <small>B5・刻印3+遺物${mods.abbotBonus ? 2 : 1}</small>`, 'secondary', () => G.setScreen(new RunScreen({ startFloor: 5 })));
        this.desc.appendChild(b5);
      }
    }

    nodeState(n) {
      const p = this.profile;
      if (p.unlocked[n.id]) return 'owned';
      if (SD.Meta.isReachable(p, n.id)) return p.embers >= n.cost ? 'afford' : 'reach';
      // silhouette if any prerequisite is reachable (one ring of fog)
      if (n.req.some((r) => SD.Meta.isReachable(p, r))) return 'fog';
      return 'hidden';
    }

    renderDetail() {
      const U = UI(), p = this.profile;
      const id = this.hover || this.sel;
      this.right.innerHTML = '';
      const n = id && SD.Data.SKILL_BY_ID[id];
      if (!n) { this.right.innerHTML = '<div class="ph">灯紋</div><div class="muted">紋を選ぶと詳細が見える</div>'; return; }
      const st = this.nodeState(n);
      const col = BRANCH_COL[n.branch];
      const head = U.el('div', 'node-head');
      head.innerHTML = `<div class="node-glyph" style="border-color:${col};color:${col}">${st === 'fog' ? '?' : n.glyph}</div>
        <div><div class="node-name">${st === 'fog' ? '？？？' : n.name}</div><div class="node-tag" style="color:${col}">${KIND_TAG[n.kind] || ''}</div></div>`;
      this.right.appendChild(head);
      if (st === 'fog') { this.right.appendChild(U.el('div', 'muted', 'まだ霧の向こう。手前の紋を灯すと見える。')); return; }
      this.right.appendChild(U.el('div', 'node-desc', n.desc));
      if (n.next && st !== 'owned') this.right.appendChild(U.el('div', 'node-next', '次の降下で: ' + n.next));
      if (st === 'owned') { this.right.appendChild(U.el('div', 'owned', n.id === 'core' ? '' : '灯っている')); return; }
      const cost = U.el('div', 'node-cost', `<span>必要な残り火</span><b class="${p.embers >= n.cost ? 'ok' : 'ng'}">${n.cost}</b>`);
      this.right.appendChild(cost);
      if (st === 'afford') {
        const b = U.button('灯す', 'primary', () => this.unlock(n.id), { silent: true });
        this.right.appendChild(b);
      } else if (st === 'reach') {
        this.right.appendChild(U.el('div', 'muted', `あと ${n.cost - p.embers} の残り火`));
      }
    }

    unlock(id) {
      const p = this.profile;
      if (!SD.Meta.unlock(p, id)) { if (SD.Audio) SD.Audio.play('ui_deny'); return; }
      SD.Game.save();
      if (SD.Audio) SD.Audio.play('unlock');
      const n = SD.Data.SKILL_BY_ID[id], pos = nodePos(n);
      SD.FX.burst(pos.x, pos.y, 40, { color: [BRANCH_COL[n.branch], '#fff6d8', '#ffd257'], kind: 'star', speed: 360 });
      SD.FX.ring(pos.x, pos.y, { r1: 140, color: BRANCH_COL[n.branch], width: 8 });
      SD.FX.flash('rgba(255,220,150,1)', 0.25, 2);
      SD.FX.banner(n.name, { sub: '灯紋が灯った', size: 46, y: 120, life: 1.2 });
      this.burst.push({ id, t: 0 });
      this.refresh();
    }

    hitNode(x, y) {
      for (const n of SD.Data.SKILLS) {
        const st = this.nodeState(n);
        if (st === 'hidden') continue;
        const p = nodePos(n), r = n.id === 'core' ? 34 : 24;
        if (Math.hypot(x - p.x, y - p.y) <= r + 4) return n.id;
      }
      return null;
    }

    onMouseMove(x, y) {
      const h = this.hitNode(x, y);
      if (h !== this.hover) { this.hover = h; if (h && SD.Audio) SD.Audio.play('ui_hover', { vol: 0.4 }); this.renderDetail(); }
      SD.Game.canvas.style.cursor = h ? 'pointer' : 'default';
    }
    onMouseDown(x, y) {
      const h = this.hitNode(x, y);
      if (!h) return;
      if (this.sel === h && SD.Meta.canUnlock(this.profile, h)) { this.unlock(h); return; }
      this.sel = h; this.renderDetail();
      if (SD.Audio) SD.Audio.play('ui_click');
    }
    onKey(e) {
      if (e.code === 'Space' || e.code === 'Enter') { const b = this.desc.querySelector('.btn'); if (b) b.click(); }
    }
    update(dt) { this.t += dt; for (const b of this.burst) b.t += dt; this.burst = this.burst.filter((b) => b.t < 1.5); }

    render(ctx) {
      const Art = SD.Art, t = this.t;
      if (Art.drawBackground) Art.drawBackground(ctx, 'camp', { t, camX: 0, W: 1280, H: 720, depth: 0 });
      else { ctx.fillStyle = '#0d0b16'; ctx.fillRect(0, 0, 1280, 720); }
      ctx.fillStyle = 'rgba(8,6,14,0.45)'; ctx.fillRect(0, 0, 1280, 720);
      const C = TREE_C;
      // the wheel disc
      ctx.save();
      Art.glow(ctx, C.x, C.y, 380, 'rgba(255,170,90,0.16)', 1);
      ctx.translate(C.x, C.y); ctx.scale(TREE_SX, 1);
      ctx.beginPath(); ctx.arc(0, 0, 318, 0, Math.PI * 2); ctx.fillStyle = 'rgba(20,14,28,0.82)'; ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = '#7a5520'; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#c9953b'; ctx.stroke();
      // sector tints
      const sectors = [['weave', -150, -30], ['hearth', -30, 90], ['valor', 90, 210]];
      for (const [b, a0, a1] of sectors) {
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 314, (a0 * Math.PI) / 180, (a1 * Math.PI) / 180); ctx.closePath();
        ctx.fillStyle = BRANCH_COL[b] + '0e'; ctx.fill();
        ctx.save(); ctx.rotate((a0 * Math.PI) / 180); ctx.strokeStyle = 'rgba(201,149,59,0.25)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(40, 0); ctx.lineTo(314, 0); ctx.stroke(); ctx.restore();
      }
      for (const r of RING_R.slice(1)) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(201,149,59,0.12)'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.rotate(t * 0.02);
      for (let k = 0; k < 36; k++) { ctx.rotate(Math.PI / 18); ctx.fillStyle = 'rgba(232,191,106,0.35)'; ctx.fillRect(304, -1, 10, 2); }
      ctx.restore();
      // branch labels
      ctx.save(); ctx.font = `900 22px ${SD.Game.fontTitle}`; ctx.textAlign = 'center';
      const lbl = [['運', 'weave', -90, '操作'], ['猛', 'valor', 150, '火力・絆'], ['守', 'hearth', 30, '生存']];
      for (const [ch, b, a, sub] of lbl) {
        const rr = 336, x = C.x + Math.cos((a * Math.PI) / 180) * rr * TREE_SX, y = C.y + Math.sin((a * Math.PI) / 180) * rr;
        const ly = Math.max(28, Math.min(690, y));
        Art.roundRectPath(ctx, x - 40, ly - 16, 80, 46, 12); ctx.fillStyle = 'rgba(16,11,22,0.88)'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = BRANCH_COL[b]; ctx.stroke();
        ctx.fillStyle = BRANCH_COL[b]; ctx.font = `900 24px ${SD.Game.fontTitle}`; ctx.fillText(ch, x, ly + 7);
        ctx.font = `700 12px ${SD.Game.fontUI}`; ctx.fillStyle = '#d8ccb0'; ctx.fillText(sub, x, ly + 24);
      }
      ctx.restore();
      // edges
      const p = this.profile;
      for (const n of SD.Data.SKILLS) {
        const st = this.nodeState(n);
        if (st === 'hidden') continue;
        const a = nodePos(n);
        for (const rq of n.req) {
          const m = SD.Data.SKILL_BY_ID[rq]; if (!m) continue;
          if (this.nodeState(m) === 'hidden') continue;
          const b = nodePos(m);
          const lit = p.unlocked[n.id] && p.unlocked[rq];
          const live = !p.unlocked[n.id] && p.unlocked[rq];
          ctx.save();
          const bridge = n.branch === 'bridge' || m.branch === 'bridge' && m.id !== 'core';
          ctx.strokeStyle = lit ? BRANCH_COL[n.branch] : live ? 'rgba(232,191,106,0.55)' : 'rgba(150,130,170,0.18)';
          ctx.lineWidth = lit ? 3 : 2;
          if (bridge && !lit) { ctx.globalAlpha = 0.45; ctx.setLineDash([3, 7]); }
          if (!lit && !live) ctx.setLineDash([4, 6]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.restore();
          if (live) {
            const k = (t * 0.6 + (n.a + 360) / 90) % 1;
            Art.glow(ctx, b.x + (a.x - b.x) * k, b.y + (a.y - b.y) * k, 10, 'rgba(255,200,120,0.8)', 0.7);
          }
        }
      }
      // nodes
      for (const n of SD.Data.SKILLS) {
        const st = this.nodeState(n);
        if (st === 'hidden') continue;
        const q = nodePos(n), col = BRANCH_COL[n.branch];
        const r = n.id === 'core' ? 34 : 23;
        const hov = this.hover === n.id, sel = this.sel === n.id;
        ctx.save();
        if (st === 'owned') Art.glow(ctx, q.x, q.y, r * 2.6, col, 0.55);
        if (st === 'afford' && n.id === this.recommend) Art.glow(ctx, q.x, q.y, r * 2.8, 'rgba(255,214,120,0.9)', 0.5 + 0.35 * Math.sin(t * 4));
        else if (st === 'afford') Art.glow(ctx, q.x, q.y, r * 1.9, 'rgba(255,214,120,0.6)', 0.35);
        ctx.beginPath(); ctx.arc(q.x, q.y, r + (hov ? 3 : 0), 0, Math.PI * 2);
        ctx.fillStyle = st === 'owned' ? col : st === 'fog' ? '#141020' : '#1e1729';
        ctx.fill();
        ctx.lineWidth = sel ? 4 : 2.5;
        ctx.strokeStyle = st === 'fog' ? 'rgba(150,130,170,0.35)' : st === 'afford' ? '#ffd257' : st === 'owned' ? '#fff6d8' : col;
        ctx.stroke();
        if (n.kind === 'verb' && st !== 'fog') { ctx.beginPath(); ctx.arc(q.x, q.y, r + 6, 0, Math.PI * 2); ctx.strokeStyle = st === 'owned' ? col : 'rgba(232,191,106,0.35)'; ctx.lineWidth = 1.5; ctx.stroke(); }
        ctx.font = `900 ${n.id === 'core' ? 30 : 20}px ${SD.Game.fontTitle}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = st === 'owned' ? '#1a1222' : st === 'fog' ? 'rgba(150,130,170,0.4)' : st === 'afford' ? '#ffe9b8' : 'rgba(239,229,207,0.7)';
        ctx.fillText(st === 'fog' ? '?' : n.glyph, q.x, q.y + 1);
        ctx.restore();
      }
      // cost labels last, on pills, so no node can cover them
      for (const n of SD.Data.SKILLS) {
        const st = this.nodeState(n);
        if (st !== 'afford' && st !== 'reach') continue;
        const q = nodePos(n), r = 23;
        const ang = (n.a * Math.PI) / 180, ox = n.r ? Math.cos(ang) * (r + 15) : 0, oy = n.r ? Math.sin(ang) * (r + 13) : r + 13;
        const lx = q.x + ox, ly = q.y + oy, txt = String(n.cost);
        ctx.save();
        ctx.font = `700 12px ${SD.Game.fontUI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const w = ctx.measureText(txt).width + 10;
        Art.roundRectPath(ctx, lx - w / 2, ly - 8, w, 16, 8); ctx.fillStyle = 'rgba(14,10,22,0.88)'; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = st === 'afford' ? 'rgba(255,210,87,0.8)' : 'rgba(150,130,170,0.5)'; ctx.stroke();
        ctx.fillStyle = st === 'afford' ? '#ffd257' : 'rgba(239,229,207,0.75)'; ctx.fillText(txt, lx, ly + 0.5);
        ctx.restore();
      }
      for (const b of this.burst) {
        const n = SD.Data.SKILL_BY_ID[b.id], q = nodePos(n);
        Art.glow(ctx, q.x, q.y, 60 + b.t * 100, BRANCH_COL[n.branch], Math.max(0, 1 - b.t / 1.5));
      }
    }
  }

  // =====================================================================================
  // RUN
  // =====================================================================================
  class RunScreen {
    constructor(opts = {}) { this.startFloor = opts.startFloor || 1; }

    enter() {
      const G = SD.Game;
      this.profile = G.profile;
      this.mods = SD.Meta.computeMods(this.profile);
      this.run = new SD.Run(this.mods, { startFloor: this.startFloor });
      this.scene = new SD.Scene();
      this.reels = new SD.ReelView();
      this.reels.sync(this.run);
      this.director = new SD.Director(this);
      this.state = 'anim';
      this.mode = null;
      this.comboCells = null;
      this.intent = null;
      this.hoverPreview = null;
      this.firstRun = this.profile.stats.runs === 0;
      // the next 灯紋 within reach: shown under the embers plaque, celebrated when this run pays for it
      const goal = SD.Meta.recommendedNode(this.profile, this.profile.seen.lastWhisper);
      this.goal = goal && goal.cost > this.profile.embers ? { id: goal.id, name: goal.name, cost: goal.cost, base: this.profile.embers, hit: false } : null;
      this.turnHints = {};
      this.V = {
        hp: this.run.hp, hpShown: this.run.hp, hpGhost: this.run.hp, maxHp: this.run.maxHp, block: 0,
        sparks: this.run.sparks, embers: 0, enemy: null,
      };
      this.scene.curtain = 1; this.scene.curtainTarget = 1;
      SD.FX.clear();
      this.buildDom();
      setTimeout(() => { this.scene.curtainTarget = 0; }, 150);
      const fresh = (this.profile.seen.fresh || []).map((id) => SD.Data.SKILL_BY_ID[id]).filter(Boolean);
      if (fresh.length) {
        this.profile.seen.fresh = [];
        SD.Game.save();
        setTimeout(() => { SD.FX.banner(fresh.map((n) => n.name).join('・'), { sub: '新たな灯紋が灯っている', size: 50, y: 170, life: 2.0 }); if (SD.Audio) SD.Audio.play('relic'); }, 2100);
      }
      this.play(this.run.begin());
    }

    exit() { SD.UI.hideTip(); this.closePicker(); }

    play(events) {
      this.state = 'anim';
      this.refreshButtons();
      return this.director.play(events).then(() => {
        // the turn only opens once the whole sequence has played out
        if (this.run.phase === 'idle' && this.state === 'anim') this.toIdle();
        this.refreshButtons();
      });
    }

    // ------------------------------------------------------------------ DOM
    buildDom() {
      const U = UI(), G = SD.Game;
      U.clear();
      const root = U.root();
      this.dom = {};
      const top = U.el('div', 'run-top passthru');
      this.dom.floor = U.el('div', 'plaque floor');
      this.dom.depth = U.el('div', 'depth');
      this.dom.embers = U.el('div', 'plaque embers');
      top.appendChild(this.dom.floor); top.appendChild(this.dom.depth); top.appendChild(this.dom.embers);
      root.appendChild(top);
      this.dom.left = U.el('div', 'panel run-left');
      root.appendChild(this.dom.left);
      this.dom.right = U.el('div', 'run-right');
      this.dom.primary = U.button('回す', 'primary big', () => this.primary(), { silent: true });
      this.dom.respin = U.button('再演', 'secondary', () => this.doRespin());
      this.dom.row = U.el('div', 'btn-row');
      this.dom.echo = U.button('写し身', 'mini', () => this.toggleMode('echo'));
      this.dom.key = U.button('運命の鍵', 'mini', () => this.toggleMode('key'));
      this.dom.row.appendChild(this.dom.echo); this.dom.row.appendChild(this.dom.key);
      this.dom.help = U.el('div', 'help-line');
      for (const [k, b] of [['respin', this.dom.respin], ['echo', this.dom.echo], ['key', this.dom.key]]) {
        b.addEventListener('mouseenter', () => { this.btnHover = k; });
        b.addEventListener('mouseleave', () => { if (this.btnHover === k) this.btnHover = null; });
      }
      this.dom.right.appendChild(this.dom.primary);
      this.dom.right.appendChild(this.dom.respin);
      this.dom.right.appendChild(this.dom.row);
      this.dom.right.appendChild(this.dom.help);
      root.appendChild(this.dom.right);
      this.dom.hint = U.el('div', 'hint-bubble passthru');
      root.appendChild(this.dom.hint);
      this.dom.modal = U.el('div', 'modal-layer');
      root.appendChild(this.dom.modal);
      const gear = G.settingsButton(true, () => this.giveUp());
      root.appendChild(gear);
      this.updateTop();
      this.updateRelics();
      this.renderLeft();
      this.refreshButtons();
    }

    updateTop() {
      const run = this.run, p = this.profile, U = UI();
      const f = Math.max(run.floor, run.startFloor);
      const Z = SD.Data.ZONES[SD.Data.FLOORS[f] ? SD.Data.FLOORS[f].zone : 'abyss'];
      this.dom.floor.innerHTML = `<span class="b">B${f}</span><span class="z">${Z.name}</span>`;
      let html = '';
      for (let k = 1; k <= SD.Data.LAST_FLOOR; k++) {
        const fl = SD.Data.FLOORS[k];
        const cls = ['bead', fl.type];
        if (k < run.floor) cls.push('done');
        if (k === run.floor) cls.push('cur');
        if (k === p.stats.bestFloor) cls.push('best');
        if (k === p.stats.lastFloor) cls.push('last');
        html += `<span class="${cls.join(' ')}" title="B${k}"></span>`;
      }
      html += `<span class="depth-lbl">${p.stats.bestFloor ? '最深 B' + p.stats.bestFloor : ''}</span>`;
      this.dom.depth.innerHTML = html;
      this.dom.embers.innerHTML = '';
      this.dom.embers.appendChild(U.icon('ember', 26));
      this.dom.emberNum = U.el('span', 'n', String(this.V.embers));
      this.dom.embers.appendChild(this.dom.emberNum);
      this.dom.embers.appendChild(U.el('span', 'lbl', '持ち帰る残り火'));
      if (!this.dom.goal) { this.dom.goal = U.el('div', 'goal-bar passthru'); U.root().appendChild(this.dom.goal); }
      this.updateGoal();
    }

    emberTarget() { return { x: 1110, y: 28 }; }

    updateGoal() {
      const g = this.goal, el = this.dom && this.dom.goal;
      if (!el) return;
      if (!g) { el.style.display = 'none'; return; }
      const have = g.base + this.V.embers;
      const pct = Math.min(100, Math.round((have / g.cost) * 100));
      el.style.display = '';
      el.innerHTML = `<span class="g-lbl">次の灯紋</span><b>${g.name}</b><span class="g-bar"><i style="width:${pct}%"></i></span><span class="g-num">${Math.min(have, g.cost)}/${g.cost}</span>`;
      el.classList.toggle('ready', have >= g.cost);
      if (!g.hit && have >= g.cost) {
        g.hit = true;
        SD.FX.banner(`【${g.name}】を灯せる`, { sub: '今倒れても、持ち帰った残り火で灯せる', size: 40, y: 140, life: 1.8 });
        if (SD.Audio) SD.Audio.play('unlock', { vol: 0.7 });
      }
    }

    updateRelics() {
      const U = UI();
      if (!this.dom.relics) { this.dom.relics = U.el('div', 'relics'); U.root().appendChild(this.dom.relics); }
      this.dom.relics.innerHTML = '';
      for (const id of this.run.relics) {
        const r = SD.Data.RELICS[id];
        const t = U.el('div', 'relic');
        t.appendChild(SD.Art.drawRelic ? U.prop('relic', id, 26) : document.createTextNode(r.glyph));
        U.bindTip(t, `<b>${r.name}</b><br>${r.desc}`);
        this.dom.relics.appendChild(t);
      }
    }

    enemyView(snap, keep) {
      const prev = this.V.enemy;
      const ev = {
        name: snap.name, hp: snap.hp, maxHp: snap.maxHp, block: snap.block, burn: snap.burn, seals: snap.seals, maxSeals: snap.maxSeals,
        boss: snap.boss, elite: snap.elite, dread: snap.dread, phase: snap.phase, armor: snap.armor, armorNow: snap.armor,
        hpShown: keep && prev ? prev.hpShown : snap.hp, hpGhost: keep && prev ? prev.hpGhost : snap.hp,
      };
      return ev;
    }

    setIntent(it) {
      if (this._tipOn) { SD.UI.hideTip(); this._tipOn = false; }
      this.intent = it ? SD.UI.intentInfo(this.run, it, this.run.enemy) : null;
      if (this.intent) this.intent.born = this.scene.time;
      if (it && this.scene.enemy) {
        const danger = it.k === 'charge' || it.k === 'doom' || (it.heavy && it.k === 'attack');
        const stance = it.now && (it.now.k === 'curl' || it.now.k === 'reflect');
        this.scene.enemy.setHold(danger ? 'windup' : stance ? 'stance' : null);
      }
      if (this.V.enemy && this.run.enemy) {
        const now = this.run.enemy.now;
        this.V.enemy.armorNow = (this.run.enemy.armor || 0) + (now && now.k === 'curl' ? now.v : 0);
      }
    }

    lowHpMood() {
      const low = this.V.hp <= this.V.maxHp * 0.3;
      for (const h of this.scene.heroList()) h.mood = low ? 'worried' : 'normal';
    }

    spendCandle() { /* candles reflect V.sparks; flare handled on gain */ }

    // ------------------------------------------------------------------ states
    toIdle() {
      if (this.run.phase !== 'idle') return;
      this.state = 'idle';
      this.mode = null;
      this.hoverPreview = null;
      this.reels.lever.target = 0;
      this.refreshButtons();
      this.renderLeft();
      if (this.firstRun && !this.turnHints.lever) {
        this.showHint('レバーを引く <kbd>Space</kbd>', 1150, 455, 0, 'down');
      }
    }

    primary() {
      if (this.state === 'idle') this.doSpin();
      else if (this.state === 'decision') this.doResolve();
      else if (this.state === 'anim') this.director.skip = true;
    }

    async doSpin() {
      if (this.state !== 'idle' || this.run.phase !== 'idle') return;
      this.turnHints.lever = true;
      this.hideHint();
      const ev = this.run.spin();
      await this.play(ev);
      this.afterSpin();
    }

    async afterSpin(fromManip) {
      const run = this.run;
      if (run.phase !== 'spun') return;
      if (this.firstRun && !this.turnHints.payline) {
        this.turnHints.payline = true;
        this.showHint('中央の列（発動列）の目が、三人の行動になる', 640, 520, 2.4);
      }
      if (run.awaken.ready) { this.enterDecision(); this.showAwaken(); return; }
      const auto = run.shouldAutoResolve();
      if (auto) {
        this.state = 'auto';
        this.renderLeft(run.forecast());
        this.refreshButtons();
        let beat = fromManip ? 0.28 : 0.35;
        const nm = !fromManip && !run.mods.nudge ? run.nearMisses(1) : [];
        if (nm.length) {
          const c = this.reels.cellCenter(nm[0].reel, nm[0].dir < 0 ? -1 : 1);
          SD.FX.text(c.x, c.y, '惜しい！', { color: '#ffe1a0', size: 26, vy: -26, life: 1.1 });
          if (SD.Audio) SD.Audio.play('near_miss');
          beat = 0.75;
        }
        await SD.Game.wait(beat);
        if (run.phase === 'spun') this.doResolve();
        return;
      }
      this.enterDecision();
    }

    enterDecision() {
      this.state = 'decision';
      this.reels.lever.target = 0.45;
      this.refreshButtons();
      this.renderLeft(this.run.forecast());
      this.maybeVerbHint();
    }

    leaveDecision() { this.hideHint(); this.closePicker(); this.mode = null; this.hoverPreview = null; }

    async doResolve() {
      if (this.run.phase !== 'spun') return;
      const ev = this.run.resolve();
      await this.play(ev);
    }

    async doRespin() {
      if (this.state !== 'decision' || !this.run.canRespin()) return;
      this.state = 'anim';
      const ev = this.run.respin();
      await this.play(ev);
      this.afterManip();
    }

    async doNudge(i, dir) {
      if (this.state !== 'decision' || !this.run.canNudge(i, dir)) return;
      this.state = 'anim';
      const ev = this.run.nudge(i, dir);
      await this.play(ev);
      this.afterManip();
    }

    async doBless(i) {
      if (this.state !== 'decision' || !this.run.canBless(i)) return;
      this.state = 'anim';
      await this.play(this.run.bless(i));
      this.afterManip();
    }

    async doHold(i) {
      if (this.state !== 'decision') return;
      const ev = this.run.toggleHold(i);
      this.director.play(ev);
      this.renderLeft(this.run.forecast());
      this.refreshButtons();
    }

    afterManip() {
      if (this.run.phase !== 'spun') return;
      const R = this.run.forecast();
      const great = R.combos.some((c) => c.k === 'trine' || c.k === 'bond' || c.k === 'quad');
      const canMore = this.run.needsDecision();
      if (great || !canMore) this.afterSpin(true);
      else this.enterDecision();
    }

    toggleMode(kind) {
      if (this.state !== 'decision') return;
      if (this.mode && this.mode.kind === kind) { this.mode = null; }
      else if (kind === 'echo' && this.run.canEchoAny()) this.mode = { kind: 'echo', src: null };
      else if (kind === 'key' && this.run.canFateKey()) this.mode = { kind: 'key' };
      this.refreshButtons();
      this.renderLeft(this.run.forecast());
    }

    async giveUp() {
      if (this.run.phase === 'dead' || this.run.phase === 'won') return;
      SD.Game.closeSettings();
      this.director.abort();
      this.closeModal();
      this.mode = null;
      const ev = this.run._die(this.run.enemy);
      await this.play(ev);
    }

    // ------------------------------------------------------------------ awakening & hints
    showAwaken() {
      const nm = this.run.nearMisses(1)[0];
      if (!nm) return;
      const R = SD.REEL_LAYOUT.reels[nm.reel];
      this.showHint('<b>灯輪が目覚めた</b><br>光るマスに触れて、目をずらそう', R.x + R.w / 2, 436, 0, 'down');
      this.awakenCell = { reel: nm.reel, dir: nm.dir };
    }
    onAwakenUsed() {
      this.awakenCell = null;
      this.hideHint();
      SD.FX.text(640, 452, 'これが【ずらし】。灯紋【押し手】（残り火20）で、何度でも。', { color: '#7df0b4', size: 21, vy: -4, life: 3.2 });
    }

    maybeVerbHint() {
      const p = this.profile, m = this.mods, seen = p.seen;
      const show = (key, html, x, y) => {
        if (seen[key]) return false;
        seen[key] = true; SD.Game.save();
        this.showHint(html, x, y, 4.5);
        return true;
      };
      if (m.nudge && this.run.nearMisses().length && show('nudge', '光るマスを押すと、<b>火種1</b>でそのリールをずらせる', 640, 440)) return;
      if (m.respin && show('respin', '発動列のマスで<b>留め</b>（2本まで）→ <b>再演</b>で残りを回し直す', 1000, 440)) return;
      if (m.bless && this.run.canBlessAny() && show('bless', '髑髏の「祝」を押すと、トトが癒に変える', 640, 440)) return;
      if (m.echo && this.run.canEchoAny() && show('echo', '【写し身】発動列の記号を、別のリールへ写せる', 1000, 440)) return;
      if (m.fateKey && this.run.canFateKey() && show('key', '【運命の鍵】リボンから好きなコマを選べる', 1000, 440)) return;
    }

    showHint(html, x, y, life, arrow) {
      const h = this.dom.hint;
      h.innerHTML = html;
      h.style.display = 'block';
      h.classList.toggle('arrow-down', arrow === 'down');
      const w = h.offsetWidth;
      h.style.left = Math.max(10, Math.min(1270 - w, x - w / 2)) + 'px';
      h.style.top = Math.max(60, y - h.offsetHeight) + 'px';
      clearTimeout(this._hintTO);
      if (life) this._hintTO = setTimeout(() => this.hideHint(), life * 1000);
    }
    hideHint() { if (this.dom && this.dom.hint) this.dom.hint.style.display = 'none'; }

    onCombo() { /* the director handles the celebration */ }

    // ------------------------------------------------------------------ left panel (forecast)
    renderLeft(R, label) {
      const U = UI(), run = this.run, el = this.dom.left;
      el.innerHTML = '';
      const e = run.enemy;
      if (!R || (this.state !== 'decision' && this.state !== 'auto')) {
        if (!e) { this.renderSummary(el); return; }
        el.appendChild(U.el('div', 'ph', e.name));
        if (e) {
          el.appendChild(U.el('div', 'tip', e.tip || ''));
          const it = e.intent;
          if (it) {
            const I = SD.UI.intentInfo(run, it, e);
            el.appendChild(U.el('div', 'tip2', `次の行動: <b>${I.label}</b>${I.value != null ? ' ' + I.value : ''}`));
            const w = SD.UI.wantedHint(run, it);
            if (w) {
              const row = U.el('div', 'wanted' + (w.avoid ? ' avoid' : ''));
              row.appendChild(U.el('span', 'w-lbl', w.avoid ? '避ける目' : '狙い目'));
              for (const sym of w.syms) row.appendChild(U.sym(sym, 24));
              row.appendChild(U.el('span', 'w-txt', w.text));
              el.appendChild(row);
            }
          }
        }
        if (this.state === 'idle') el.appendChild(U.el('div', 'cta', 'レバーを引いて運命を回す <kbd>Space</kbd>'));
        return;
      }
      el.appendChild(U.el('div', 'ph', label || '発動の予測'));
      const rows = U.el('div', 'fc-rows');
      const row = (sym, n, val, note, cls) => {
        const r = U.el('div', 'fc-row ' + (cls || ''));
        r.appendChild(U.sym(sym, 26));
        r.appendChild(U.el('span', 'fc-n', `×${n}`));
        r.appendChild(U.el('b', 'fc-v', val));
        if (note) r.appendChild(U.el('small', 'fc-note', note));
        rows.appendChild(r);
      };
      const G = R.groups;
      if (G.blade && R.marked !== 'blade') row('blade', G.blade.n, R.blade, R.bladeArmor ? `鎧 -${R.bladeArmor}` : (G.blade.n >= 3 ? '鎧無視' : ''), 'dmg');
      if (G.flame && R.marked !== 'flame') row('flame', G.flame.n, R.flame, R.burn ? `燃焼+${R.burn}` : '', 'dmg');
      if (G.ward && R.marked !== 'ward') row('ward', G.ward.n, '+' + R.block, R.stagger ? '怯ませる！' : R.guardian ? '完全防御' : R.rampart ? '反射' : '', 'blk');
      if (G.heart && R.marked !== 'heart') {
        const eff = Math.min(R.heal, run.maxHp - run.hp);
        row('heart', G.heart.n, R.thirst ? '0' : '+' + eff, R.thirst ? '渇き' : eff < R.heal ? (eff ? `（${R.heal - eff}は溢れる）` : 'HP満タン') : R.cleanse ? '浄化' : '', 'heal');
      }
      if (G.lantern && R.marked !== 'lantern') row('lantern', G.lantern.n, '+' + R.embers, R.sparks ? `火種+${R.sparks}` : '', 'em');
      if (G.skull && R.marked !== 'skull') row('skull', G.skull.n, R.reaper ? R.reaper : R.skullDmg ? R.skullDmg : '-' + (G.skull.n * 3), R.reaper ? '死神' : R.skullDmg ? '敵へ' : '自分へ', 'self');
      if (R.marked && R.markedN) row(R.marked, R.markedN, '-' + R.markedN * 2, '封じ', 'self');
      el.appendChild(rows);
      if (R.combos.length) {
        const names = { trine: '三連', quad: '四連', bond: '絆の陣', reaper: '死神' };
        el.appendChild(U.el('div', 'fc-combo', R.combos.map((c) => names[c.k] + (c.s ? '・' + SD.Data.SYMBOLS[c.s].name : '')).join(' ＋ ')));
      }
      if (R.multNotes.length) el.appendChild(U.el('div', 'fc-mult', R.multNotes.join(' ')));
      // outcome
      if (e) {
        const after = Math.max(0, e.hp - Math.max(0, R.totalDmg - (e.block || 0)));
        const out = U.el('div', 'fc-out');
        out.innerHTML = after <= 0 ? '<b class="kill">撃破できる！</b>' : `敵HP <b>${e.hp}</b> → <b>${after}</b>`;
        if (R.sealBreaks) out.innerHTML += ` <span class="seal">封印-${R.sealBreaks}</span>`;
        el.appendChild(out);
        const it = e.intent;
        if (it && after > 0) {
          const inc = run.intentDamage(it);
          if ((it.k === 'attack' || it.k === 'doom' || it.k === 'jam') && inc > 0) {
            let blk = run.block + R.block;
            const ra = Math.min(blk, R.reflectIn || 0);
            blk -= ra;
            const refl = (R.reflectIn || 0) - ra;
            const taken = (R.guardian ? 0 : Math.max(0, inc - blk)) + refl;
            if (R.reflectIn) el.appendChild(U.el('div', 'fc-in', `反射 ${R.reflectIn}${ra ? '（盾で ' + ra + '）' : ''}`));
            el.appendChild(U.el('div', 'fc-in', `予告 ${inc} − 盾 ${blk} → <b class="${taken ? 'hurt' : 'safe'}">被ダメ ${taken}</b>`));
          } else if (it.k === 'charge') {
            el.appendChild(U.el('div', 'fc-in', R.stagger ? '<b class="safe">強撃を阻止できる</b>' : '次は強撃。盾2つで怯ませられる'));
          }
        }
      }
      this.refreshHelp();
    }

    respinOdds() {
      const run = this.run;
      const unheld = run.reels.map((r, i) => !r.held && !r.jam);
      if (!unheld.some(Boolean)) return null;
      const cells = run.paylineCells();
      const P = (i, s) => {
        if (!unheld[i]) return cells[i].s === s || cells[i].s === 'wild' ? 1 : 0;
        const st = run.reels[i].strip;
        return st.filter((c) => c.s === s || c.s === 'wild').length / st.length;
      };
      let trine = 0;
      const mk = run.enemy && run.enemy.now && run.enemy.now.k === 'mark' ? run.enemy.now.sym : null;
      for (const s of ['blade', 'flame', 'ward', 'heart', 'lantern']) if (s !== mk) trine += P(0, s) * P(1, s) * P(2, s);
      let bond = 0;
      if (run.mods.bond && mk !== 'blade' && mk !== 'flame' && mk !== 'heart') { const B = SD.Data.BOND_ORDER; bond = P(0, B[0]) * P(1, B[1]) * P(2, B[2]); }
      const held = run.reels.filter((r) => r.held).length;
      let s = `再演すると 三連 <b>${SD.UI.pct(Math.min(1, trine))}</b>`;
      if (run.mods.bond) s += ` ／ 絆 <b>${SD.UI.pct(bond)}</b>`;
      if (!held) s += '<br><small>発動列のマスで留められる</small>';
      return s;
    }

    refreshButtons() {
      const d = this.dom, run = this.run;
      if (!d) return;
      const st = this.state;
      d.primary.innerHTML = st === 'decision' ? '発動 <kbd>Space</kbd>' : st === 'auto' ? '発動…' : '回す <kbd>Space</kbd>';
      d.primary.disabled = !(st === 'idle' || st === 'decision');
      d.primary.classList.toggle('resolve', st === 'decision');
      const showRespin = !!run.mods.respin;
      d.respin.style.display = showRespin ? '' : 'none';
      if (showRespin) {
        const cost = run.phase === 'spun' ? run.respinCost() : null;
        const ctext = cost === 'free' ? '無料' : cost === 'hp' ? 'HP4' : '火種1';
        d.respin.innerHTML = `再演 <small>${ctext}</small> <kbd>R</kbd>`;
        d.respin.disabled = !(st === 'decision' && run.canRespin());
      }
      d.echo.style.display = run.mods.echo ? '' : 'none';
      d.key.style.display = run.mods.fateKey ? '' : 'none';
      d.echo.disabled = !(st === 'decision' && run.canEchoAny());
      d.key.disabled = !(st === 'decision' && run.canFateKey());
      d.echo.classList.toggle('on', !!(this.mode && this.mode.kind === 'echo'));
      d.key.classList.toggle('on', !!(this.mode && this.mode.kind === 'key'));
      d.row.style.display = run.mods.echo || run.mods.fateKey ? '' : 'none';
      d.echo.innerHTML = '写し身 <small>火種1</small> <kbd>E</kbd>';
      d.key.innerHTML = '運命の鍵 <small>火種1</small> <kbd>K</kbd>';
      this.refreshHelp();
    }

    refreshHelp() {
      const d = this.dom, run = this.run;
      if (!d || !d.help) return;
      const lines = [];
      if (this.state === 'decision') {
        if (this.mode && this.mode.kind === 'echo') lines.push(`<b class="mode">${this.mode.src == null ? '写し身: 写す元の発動列のマスを選ぶ' : '写し身: 写す先の発動列のマスを選ぶ'}</b>`);
        else if (this.mode && this.mode.kind === 'key') lines.push('<b class="mode">運命の鍵: 変えたいリールを押してコマを選ぶ</b>');
        else {
          const bits = [];
          if (run.mods.nudge || run.awaken.ready) bits.push('上下のマス: ずらす');
          if (run.mods.holdMax) bits.push('発動列のマス: 留め');
          if (bits.length) lines.push(bits.join(' ・ '));
          if (run.canRespin()) { const odds = this.respinOdds(); if (odds) lines.push(`<span class="odds">${odds}</span>`); }
        }
      }
      d.help.innerHTML = lines.join('<br>');
    }

    // ------------------------------------------------------------------ crossroads / events / chisel modals
    closeModal() {
      this.dom.modal.innerHTML = ''; this.dom.modal.classList.remove('show'); this.modalOpen = false; SD.UI.hideTip();
      if (this.dom.right) this.dom.right.style.visibility = '';
    }

    // between rooms: what the party carries (HP, sparks, relics) and what each reel holds
    renderSummary(el) {
      const U = UI(), run = this.run;
      el.appendChild(U.el('div', 'ph', '一行の様子'));
      const box = U.el('div', 'run-summary');
      box.appendChild(U.el('div', '', `HP <b>${run.hp}</b> / ${run.maxHp}${run.mods.sparks ? `　火種 <b>${run.sparks}</b> / ${run.maxSparks}` : ''}${run.relics.length ? `　遺物 ${run.relics.length}` : ''}`));
      const order = ['blade', 'flame', 'ward', 'heart', 'lantern', 'wild', 'skull'];
      run.reels.forEach((r, i) => {
        const row = U.el('div', 'strip');
        row.appendChild(U.el('span', 'rl', `リール${i + 1}`));
        const cnt = {};
        for (const c of r.strip) cnt[c.s] = (cnt[c.s] || 0) + 1;
        for (const s of order) if (cnt[s]) { row.appendChild(U.sym(s, 18)); row.appendChild(U.el('span', 'cnt', String(cnt[s]))); }
        box.appendChild(row);
      });
      el.appendChild(box);
    }

    showCrossroads(ev) {
      const U = UI(), run = this.run;
      this.state = 'modal';
      if (this.dom.right) this.dom.right.style.visibility = 'hidden';
      this.refreshButtons();
      this.renderLeft();
      this.modalOpen = true;
      const m = this.dom.modal;
      m.innerHTML = '';
      m.classList.add('show');
      const box = U.el('div', 'crossroads');
      const title = run.floor ? `B${run.floor} を越えた ― 分かれ道` : '降下の支度';
      box.appendChild(U.el('div', 'cr-title', title));
      let picked = null;
      const offers = ev.offers || [];
      const cardsWrap = U.el('div', 'cr-cards');
      if (offers.length) {
        cardsWrap.appendChild(U.el('div', 'cr-sub', ev.offerKind === 'relic' ? '遺物をひとつ選ぶ' : '刻印をひとつ選ぶ <small>（リールに彫る・このRunのみ）</small>'));
        const row = U.el('div', 'cr-row');
        offers.forEach((o, i) => {
          const tx = U.offerText(o, run);
          const card = U.el('div', 'card ' + (o.kind === 'relic' ? 'relic-card' : 'carve-card'));
          card.appendChild(U.el('div', 'card-tag', tx.tag));
          const art = U.el('div', 'card-art');
          if (tx.glyph) art.appendChild(SD.Art.drawRelic ? U.prop('relic', o.id, 68) : U.el('div', 'relic-glyph', tx.glyph));
          else if (tx.sym) {
            art.appendChild(U.sym(tx.sym, 52, { gilded: !!tx.gild }));
            if (tx.to) { art.appendChild(U.el('span', 'arrow', '→')); art.appendChild(U.sym(tx.to, 52)); }
            if (tx.sym2) art.appendChild(U.sym(tx.sym2, 52));
            if (tx.remove) art.classList.add('remove');
          } else if (tx.icon === 'chisel' && SD.Art.drawChiselIcon) art.appendChild(U.prop('chisel', null, 56));
          else if (tx.icon) art.appendChild(U.icon(tx.icon, 52));
          card.appendChild(art);
          card.appendChild(U.el('div', 'card-title', tx.title));
          if (tx.body) card.appendChild(U.el('div', 'card-body', tx.body));
          const odds = U.offerOdds(o, run);
          if (odds) {
            card.appendChild(U.el('div', 'card-odds',
              `リール${o.reel + 1}の${SD.Data.SYMBOLS[odds.sym].name} <b>${U.pct(odds.before)}→${U.pct(odds.after)}</b><br>三連のどれか <b>${U.pct(odds.anyBefore)}→${U.pct(odds.anyAfter)}</b>${odds.bondBefore != null ? `<br>絆の陣 <b>${U.pct(odds.bondBefore)}→${U.pct(odds.bondAfter)}</b>` : ''}`));
          }
          card.addEventListener('mouseenter', () => { if (SD.Audio) SD.Audio.play('ui_hover', { vol: 0.4 }); });
          card.addEventListener('click', () => {
            picked = picked === i ? null : i;
            [...row.children].forEach((c, k) => c.classList.toggle('picked', k === picked));
            if (SD.Audio) SD.Audio.play('ui_click');
            doorsWrap.classList.toggle('ready', picked != null);
            skip.classList.toggle('on', false);
          });
          row.appendChild(card);
        });
        cardsWrap.appendChild(row);
        const skip = U.el('div', 'cr-skip', ev.offerKind === 'relic' ? '遺物を取らずに進む' : '刻まずに進む');
        skip.addEventListener('click', () => { picked = -1; [...row.children].forEach((c) => c.classList.remove('picked')); skip.classList.add('on'); doorsWrap.classList.add('ready'); if (SD.Audio) SD.Audio.play('ui_click'); });
        cardsWrap.appendChild(skip);
        box.appendChild(cardsWrap);
      }
      const doorsWrap = U.el('div', 'cr-doors' + (offers.length ? '' : ' ready'));
      doorsWrap.appendChild(U.el('div', 'cr-sub', ev.doors[0].kind === 'continue' ? '' : '次の扉'));
      const drow = U.el('div', 'door-row');
      ev.doors.forEach((d, j) => {
        const dv = U.el('div', 'door');
        const c = document.createElement('canvas');
        const k = Math.max(2, Math.ceil(SD.Game.renderScale));
        c.width = 130 * k; c.height = 160 * k; c.style.width = '130px'; c.style.height = '160px';
        dv.appendChild(c);
        const info = this.doorInfo(d);
        dv.appendChild(U.el('div', 'door-name', info.name));
        if (info.sub) dv.appendChild(U.el('div', 'door-sub', info.sub));
        if (d.kind === 'dread') dv.appendChild(U.el('div', 'door-sub risk', '強敵×1.5 → <b>遺物</b>・残り火×2'));
        if (d.kind === 'battle') dv.appendChild(U.el('div', 'door-sub calm', '勝てば一息（HP回復）'));
        let hov = false, t0 = performance.now();
        const drawDoor = () => {
          if (!c.isConnected) return;
          const ctx = c.getContext('2d');
          ctx.setTransform(k, 0, 0, k, 0, 0); ctx.clearRect(0, 0, 130, 160);
          const tt = (performance.now() - t0) / 1000;
          if (d.kind === 'continue' && SD.Art.drawStairs) {
            SD.Art.drawStairs(ctx, 65, 82, 116, 150, tt, { hover: hov });
          } else if (d.kind === 'continue') {
            SD.Art.glow(ctx, 65, 80, 60, 'rgba(255,200,120,0.6)', 0.8);
            ctx.font = `900 54px ${SD.Game.fontTitle}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffe1a0'; ctx.fillText('次', 65, 80);
          } else if (SD.Art.drawDoor) SD.Art.drawDoor(ctx, d.kind, 65, 82, 116, 150, tt, { hover: hov, open: hov ? 0.25 : 0 });
          requestAnimationFrame(drawDoor);
        };
        requestAnimationFrame(drawDoor);
        dv.addEventListener('mouseenter', () => { hov = true; if (SD.Audio) SD.Audio.play('ui_hover', { vol: 0.4 }); });
        dv.addEventListener('mouseleave', () => { hov = false; });
        if (info.tip) U.bindTip(dv, info.tip);
        dv.addEventListener('click', () => {
          if (this.state !== 'modal' || run.phase !== 'crossroads') return;
          if (offers.length && picked == null) {
            if (SD.Audio) SD.Audio.play('ui_deny');
            cardsWrap.classList.remove('nudge'); void cardsWrap.offsetWidth; cardsWrap.classList.add('nudge');
            return;
          }
          if (SD.Audio) SD.Audio.play('ui_confirm');
          const oi = offers.length && picked >= 0 ? picked : null;
          const evs = run.choose(oi, j);
          this.closeModal();
          this.play(evs);
        });
        drow.appendChild(dv);
      });
      doorsWrap.appendChild(drow);
      box.appendChild(doorsWrap);
      m.appendChild(box);
    }

    doorInfo(d) {
      const E = SD.Data.ENEMIES;
      switch (d.kind) {
        case 'battle': return { name: '戦い', sub: E[d.enemy] ? E[d.enemy].name : '', tip: E[d.enemy] ? `<b>${E[d.enemy].name}</b><br>${E[d.enemy].tip}<br>報酬: 刻印` : '' };
        case 'dread': {
          const def = E[d.enemy], z = SD.Data.FLOORS[d.floor] ? SD.Data.FLOORS[d.floor].zone : 'cellar';
          const k = Math.max(0, d.floor - SD.Data.ZONES[z].floors[0]);
          const hp = Math.round(def.hp * (1 + 0.12 * k) * (d.enemy === 'golem' ? 1.2 : 1.5));
          return { name: '怨念の敵', sub: def.name, tip: `<b>怨念の${def.name}</b>　HP ${hp}・攻撃×1.5<br>戦闘中リールに髑髏1。<br>報酬: <b>遺物</b>3択・残り火2倍` };
        }
        case 'shrine': { const evd = SD.Data.EVENTS[d.event]; return { name: '祭壇', sub: evd ? evd.name : '何かが待つ', tip: evd ? `<b>${evd.name}</b><br>${evd.text}` : '小さな出来事。危険と見返り。' }; }
        case 'campfire': return { name: '焚き火', sub: '休息', tip: 'HPを35%回復するか、コマを1つ削る' };
        case 'elite': return { name: 'エリート', sub: E[d.enemy] ? E[d.enemy].name : '', tip: E[d.enemy] ? `<b>${E[d.enemy].name}</b><br>${E[d.enemy].tip}<br>報酬: 遺物` : '' };
        case 'boss': return { name: '灰輪の座', sub: '灰輪の主', tip: '最深部。封印は三連か絆で砕ける。' };
        case 'continue': return { name: '次へ', sub: '' };
        default: return { name: d.kind };
      }
    }

    showEvent(evt) {
      const U = UI();
      this.state = 'modal';
      if (this.dom.right) this.dom.right.style.visibility = 'hidden';
      this.renderLeft();
      this.refreshButtons();
      const m = this.dom.modal;
      m.innerHTML = ''; m.classList.add('show');
      const box = U.el('div', 'event-box');
      if (SD.Art.drawEventProp) {
        // a small living diorama of the event (candles flicker, the mimic's lid twitches...)
        const k = Math.max(2, Math.ceil(SD.Game.renderScale)), S = 130;
        const c = document.createElement('canvas');
        c.width = S * k; c.height = S * k; c.style.width = S + 'px'; c.style.height = S + 'px'; c.className = 'event-prop';
        const t0 = performance.now();
        const draw = () => {
          if (!c.isConnected) return;
          const ctx = c.getContext('2d');
          ctx.setTransform(k, 0, 0, k, 0, 0); ctx.clearRect(0, 0, S, S);
          try { SD.Art.drawEventProp(ctx, evt.id, S / 2, S / 2 + 4, S * 0.92, { t: (performance.now() - t0) / 1000 }); } catch (e) { return; }
          requestAnimationFrame(draw);
        };
        requestAnimationFrame(draw);
        box.appendChild(c);
      } else box.appendChild(U.el('div', 'event-glyph', evt.glyph));
      box.appendChild(U.el('div', 'event-name', evt.name));
      box.appendChild(U.el('div', 'event-text', evt.text));
      const opts = U.el('div', 'event-opts');
      for (const o of evt.options) {
        const b = U.button(`${o.label}${o.desc ? `<small>${o.desc}</small>` : ''}`, 'event-opt', () => {
          if (this.run.phase !== 'event') return;
          const evs = this.run.chooseEvent(o.id);
          this.closeModal();
          this.play(evs);
        });
        opts.appendChild(b);
      }
      box.appendChild(opts);
      m.appendChild(box);
    }

    showChisel(ev) {
      this.state = 'modal';
      if (this.dom.right) this.dom.right.style.visibility = 'hidden';
      this.renderLeft();
      this.refreshButtons();
      this.chiselEv = ev;
      this.refreshChisel();
    }

    refreshChisel() {
      const U = UI(), run = this.run;
      if (run.phase !== 'chisel') return;
      const m = this.dom.modal;
      m.innerHTML = ''; m.classList.add('show');
      const box = U.el('div', 'chisel-box');
      const dup = run.chisel.mode === 'dup';
      box.appendChild(U.el('div', 'cr-title', dup ? '複製するコマを選ぶ' : `削るコマを選ぶ（あと ${run.chisel.left}）`));
      box.appendChild(U.el('div', 'cr-sub', dup ? '同じリールに同じ記号が1つ増える' : 'リールから消えたコマは、このRunの間二度と出ない'));
      const cols = U.el('div', 'chisel-cols');
      run.reels.forEach((r, ri) => {
        const col = U.el('div', 'chisel-col');
        const counts = {};
        r.strip.forEach((c) => { counts[c.s] = (counts[c.s] || 0) + 1; });
        col.appendChild(U.el('div', 'chisel-head', `リール${ri + 1}<small>${r.strip.length}コマ</small>`));
        const grid = U.el('div', 'chisel-grid');
        r.strip.forEach((c, ci) => {
          const picked = this.chiselPick && this.chiselPick.ri === ri && this.chiselPick.ci === ci;
          const cell = U.el('div', 'chisel-cell' + (run.canChiselCell(ri, ci) ? '' : ' off') + (picked ? ' picked' : ''));
          cell.appendChild(U.sym(c.s, 38, { gilded: c.g, cursed: c.temp && c.s === 'skull' }));
          cell.addEventListener('click', () => {
            if (run.phase !== 'chisel') return;
            if (!run.canChiselCell(ri, ci)) { if (SD.Audio) SD.Audio.play('ui_deny'); return; }
            this.chiselPick = picked ? null : { ri, ci };
            if (SD.Audio) SD.Audio.play('ui_click');
            this.refreshChisel();
          });
          U.bindTip(cell, () => `${SD.Data.SYMBOLS[c.s].name}（このリールに${counts[c.s]}つ）`);
          grid.appendChild(cell);
        });
        col.appendChild(grid);
        cols.appendChild(col);
      });
      box.appendChild(cols);
      // the selected cell's effect on the odds, then an explicit confirm
      const pk = this.chiselPick && run.reels[this.chiselPick.ri] && run.reels[this.chiselPick.ri].strip[this.chiselPick.ci] ? this.chiselPick : null;
      const odds = U.el('div', 'chisel-odds');
      if (pk) {
        const r = run.reels[pk.ri], s = r.strip[pk.ci].s, n = r.strip.length, cnt = r.strip.filter((c) => c.s === s).length;
        const after = dup ? (cnt + 1) / (n + 1) : (cnt - 1) / (n - 1);
        odds.innerHTML = `リール${pk.ri + 1}の${U.symName(s)} <b>${U.pct(cnt / n)} → ${U.pct(after)}</b>`;
      } else odds.textContent = dup ? '複製するコマを選ぶ' : '削るコマを選ぶ';
      box.appendChild(odds);
      const row = U.el('div', 'btn-row');
      const go = U.button(dup ? '複製する' : '削る', 'primary', () => {
        if (run.phase !== 'chisel' || !pk) return;
        this.chiselPick = null;
        const evs = run.chiselCell(pk.ri, pk.ci);
        this.reels.sync(run);
        if (run.phase === 'chisel') { if (SD.Audio) SD.Audio.play('nudge'); this.refreshChisel(); }
        else { this.closeModal(); this.play(evs); }
      });
      go.disabled = !pk;
      const done = U.button(run.chisel.reason === 'start' ? 'これでよい（降りる）' : 'これでよい', 'secondary', () => { if (run.phase !== 'chisel') return; this.chiselPick = null; const evs = run.finishChisel(); this.reels.sync(run); this.closeModal(); this.play(evs); });
      row.appendChild(go); row.appendChild(done);
      box.appendChild(row);
      m.appendChild(box);
    }

    // ------------------------------------------------------------------ end of run
    onRunEnd(summary) {
      const G = SD.Game, p = this.profile;
      const prev = { best: p.stats.bestFloor, last: p.stats.lastFloor, bossBest: p.stats.bossBestHpPct, embers: p.embers };
      const prevBestVs = (p.stats.bestVs || {})[summary.killer ? summary.killer.id : ''];
      const res = SD.Meta.applyRunResult(p, summary);
      G.save();
      this.state = 'end';
      this.refreshButtons();
      this.scene.curtainTarget = 1;
      setTimeout(() => this.showEndPanel(summary, res, prev, prevBestVs), summary.won ? 400 : 900);
    }

    pickWhisper(summary) {
      const p = this.profile, s = summary.stats, owned = (id) => !!p.unlocked[id];
      const cands = [];
      const add = (node, n, w, text) => { if (n > 0 && !owned(node) && SD.Meta.isReachable(p, node)) cands.push({ node, score: n * w, text }); };
      add('nudge', s.nearMiss, 3, `1コマずらせば三連になった目が <b>${s.nearMiss}</b> 回あった`);
      add('respin', s.pairNoTrine, 1.2, `ペアのまま終わったターンが <b>${s.pairNoTrine}</b> 回。ペアを留めて1本だけ回し直せたら…`);
      add('bond', s.bondNear, 1.5, `あと1つで「絆の陣」になる並びが <b>${s.bondNear}</b> 回あった`);
      add('kindle', Math.round(s.armorLost / 3), 1, `鎧に弾かれた剣のダメージ: <b>${s.armorLost}</b>。焔は鎧を無視する`);
      add('thorns', s.wardShort, 1, `あと少しの盾で防げた攻撃が <b>${s.wardShort}</b> 回`);
      add('bless', Math.round(s.selfDmg / 3), 1.4, `髑髏や封じで自分が受けた傷: <b>${s.selfDmg}</b>`);
      add('cloak', Math.round(s.damageTaken / 12), 0.6, `このRunで受けた傷: <b>${s.damageTaken}</b>`);
      add('sparkjar', summary.sparksLeft >= 0 && this.mods.sparks ? s.nudges + s.respins : 0, 0.4, `ずらしと再演を <b>${s.nudges + s.respins}</b> 回使った。火種がもっとあれば…`);
      add('secondwind', s.heavyTaken >= 10 ? 1 : 0, 6, `強撃で受けた傷: <b>${s.heavyTaken}</b>`);
      add('crossroads', this.mods.doors ? 1 : 0, 1, '扉がもう1つあれば、別の道を選べた');
      const k = summary.killer;
      if (k && k.boss && k.seals > 0) {
        add('echo', k.seals, 9, `封印が <b>${k.seals}</b> つ残ったまま倒れた。揃えるための一手が足りない`);
        add('fatekey', k.seals, 10, `封印が <b>${k.seals}</b> つ残ったまま倒れた。運命を選べたら…`);
        add('precision', k.seals, 7, `封印が <b>${k.seals}</b> つ残った。自分で揃えた三連をもっと重く`);
      }
      if (k && k.boss && !k.seals && k.hpPct < 0.5) {
        add('chain', 1, 8, `灰輪の主は残り <b>${k.hp}</b>。あと一押しの火力が欲しい`);
        add('trine', 1, 7, `灰輪の主は残り <b>${k.hp}</b>。三連をもっと重く`);
        add('pyre', s.burnDealt > 0 ? 1 : 0, 7, `燃焼で与えた傷: <b>${s.burnDealt}</b>。溜めた火を爆ぜさせれば…`);
      }
      add('guardian', s.heavyTaken >= 15 ? 1 : 0, 8, `強撃と灰燼で受けた傷: <b>${s.heavyTaken}</b>。最大の一撃を跳ね返せたら…`);
      add('bulwark', s.heavyTaken >= 12 ? 1 : 0, 5, `強撃で受けた傷: <b>${s.heavyTaken}</b>。盾を前のターンから積めたら…`);
      add('longpush', s.markHits, 2, `封じられた目を <b>${s.markHits}</b> 回出してしまった。2つ先まで届けば…`);
      add('deft', s.zeroSpark >= 4 ? s.zeroSpark : 0, 1.2, `火種が尽きていたターン: <b>${s.zeroSpark}</b>`);
      add('keeper', k && k.boss ? 1 : 0, 3, '灰輪の主の前で、灯が持ちこたえられなかった');
      for (const c of cands) c.dataDriven = true;
      cands.sort((a, b) => {
        const ca = SD.Meta.canUnlock(p, a.node) ? 1 : 0, cb = SD.Meta.canUnlock(p, b.node) ? 1 : 0;
        if (ca !== cb) return cb - ca;
        return b.score - a.score;
      });
      if (cands.length) return cands[0];
      const g = SD.Meta.nextGoals(p, 1)[0];
      return g ? { node: g.id, text: '次の灯紋が、次の降下を変える', dataDriven: false } : null;
    }

    showEndPanel(summary, res, prev, prevBestVs) {
      const U = UI(), G = SD.Game, p = this.profile;
      const m = this.dom.modal;
      m.innerHTML = ''; m.classList.add('show', 'end');
      this.dom.left.style.display = 'none'; this.dom.right.style.display = 'none';
      const topEl = document.querySelector('.run-top'); if (topEl) topEl.style.display = 'none'; if (this.dom.goal) this.dom.goal.style.display = 'none';
      if (this.dom.relics) this.dom.relics.style.display = 'none';
      const box = U.el('div', 'end-box');
      if (summary.won) {
        box.appendChild(U.el('div', 'end-title win', '灰輪の主を討った'));
        box.appendChild(U.el('div', 'end-sub', '灯輪は再び正しく廻り始めた。けれど深淵の灯は、まだ呼んでいる。'));
        const st = p.stats;
        const lit = Object.keys(p.unlocked).length - 1, all = SD.Data.SKILLS.length - 1;
        const grid = U.el('div', 'win-grid');
        const cell = (k, v) => grid.appendChild(U.el('div', 'win-cell', `<span>${k}</span><b>${v}</b>`));
        cell('討伐までの降下', `${st.runs} 回`);
        cell('揃えた三連', st.triples);
        cell('最大の一撃', st.maxHit);
        cell('灯した灯紋', `${lit} / ${all}`);
        box.appendChild(grid);
        if (st.bossKills <= 1) box.appendChild(U.el('div', 'win-note', '最初は祈るだけだった灯輪を、三人はいま自分の手で廻している。<br>灯紋はまだ残っている――別の道で、もう一度深淵へ。'));
      } else {
        box.appendChild(U.el('div', 'end-title', `B${Math.max(summary.floor, summary.startFloor || 1)} で灯が消えた`));
        const k = summary.killer;
        if (k) {
          const kb = U.el('div', 'killer');
          const lost = Math.round(k.hpPct * 100);
          kb.innerHTML = `<div class="k-name">${k.name}</div>
            <div class="k-bar"><div class="k-fill" style="width:${lost}%"></div>${prevBestVs != null ? `<div class="k-ghost" style="left:${Math.round(prevBestVs * 100)}%"></div>` : ''}</div>
            <div class="k-left">残り <b>${k.hp}</b> / ${k.maxHp}${k.boss && k.seals > 0 ? `　封印 ${k.seals}` : ''}${k.elite || k.boss ? (lost <= 35 ? '　<b class="close">あと少し！</b>' : '') : ''}</div>`;
          box.appendChild(kb);
        }
      }
      const rec = U.el('div', 'records');
      if (res.newBestFloor) rec.appendChild(U.el('span', 'chip new', `最深記録 B${summary.floor}`));
      else rec.appendChild(U.el('span', 'chip', `最深 B${p.stats.bestFloor}`));
      if (res.newBossRecord) rec.appendChild(U.el('span', 'chip new', 'ボス最高記録'));
      if (res.firstHound) rec.appendChild(U.el('span', 'chip new', '第二層への近道が開いた'));
      if (res.firstAbbot) rec.appendChild(U.el('span', 'chip new', '近道で選べる遺物 +1'));
      if (summary.floor > prev.last && prev.last > 0) rec.appendChild(U.el('span', 'chip up', `前回より ${summary.floor - prev.last} 階深く`));
      if (summary.stats.triples) rec.appendChild(U.el('span', 'chip', `三連 ${summary.stats.triples}`));
      box.appendChild(rec);
      // embers tally
      const L = summary.emberLog;
      const em = U.el('div', 'end-embers');
      em.innerHTML = `<div class="em-big"><i class="em-ico"></i><span>持ち帰った残り火</span><b class="count">0</b></div>
        <div class="em-break">${[['撃破', L.kill], ['灯', L.lantern], ['深さ', L.depth], ['健闘', L.fight], ['出来事', L.event], ['近道', L.shortcut]].filter((x) => x[1]).map((x) => `<span>${x[0]} +${x[1]}</span>`).join('')}</div>
        <div class="em-total">所持 <b>${p.embers}</b></div>`;
      const ico = em.querySelector('.em-ico'); if (ico) ico.replaceWith(U.icon('ember', 34));
      box.appendChild(em);
      const cnt = em.querySelector('.count');
      const total = summary.embers; let shown = 0;
      const tick = () => { shown = Math.min(total, shown + Math.max(1, Math.ceil(total / 30))); cnt.textContent = '+' + shown; if (SD.Audio && shown % 3 === 0) SD.Audio.play('ember', { vol: 0.4 }); if (shown < total) setTimeout(tick, 28); };
      setTimeout(tick, 300);
      // whisper + node
      let primaryAction = null;
      if (!summary.won) {
        const w = this.pickWhisper(summary);
        p.seen.lastWhisper = w && w.dataDriven ? w.node : null;
        G.save();
        if (w) {
          const n = SD.Data.SKILL_BY_ID[w.node];
          const wb = U.el('div', 'whisper');
          wb.appendChild(U.el('div', 'w-label', '運命のささやき'));
          wb.appendChild(U.el('div', 'w-text', w.text));
          const card = U.el('div', 'w-node');
          const can = SD.Meta.canUnlock(p, n.id);
          card.innerHTML = `<div class="node-glyph sm">${n.glyph}</div><div class="w-node-body"><b>${n.name}</b><span>${n.next || n.desc}</span></div>
            <div class="w-cost ${can ? 'ok' : ''}">${can ? '灯せる' : `あと ${n.cost - p.embers}`}<small>${n.cost}</small></div>`;
          wb.appendChild(card);
          box.appendChild(wb);
          if (can && w.dataDriven) primaryAction = { label: `【${n.name}】を灯して再挑戦`, fn: () => { SD.Meta.unlock(p, n.id); G.save(); if (SD.Audio) SD.Audio.play('unlock'); G.setScreen(new RunScreen({ startFloor: this.defaultStart() })); } };
        }
      }
      const btns = U.el('div', 'end-btns');
      const camp = U.button('灯紋の輪へ', primaryAction ? 'secondary' : 'primary big', () => G.setScreen(new CampScreen()));
      if (primaryAction) {
        const pb = U.button(primaryAction.label + ' <kbd>Space</kbd>', 'primary big', primaryAction.fn, { silent: true });
        btns.appendChild(pb);
        this.endPrimary = pb;
      } else this.endPrimary = camp;
      btns.appendChild(camp);
      if (!summary.won) btns.appendChild(U.button('すぐ再挑戦', 'mini', () => G.setScreen(new RunScreen({ startFloor: this.defaultStart() }))));
      box.appendChild(btns);
      m.appendChild(box);
      this.endInputLock = performance.now() + 1000;
    }

    defaultStart() {
      const mods = SD.Meta.computeMods(this.profile);
      return mods.shortcuts.length ? Math.max(...mods.shortcuts) : 1;
    }

    // ------------------------------------------------------------------ input
    onKey(e) {
      if (this.state === 'end') {
        if ((e.code === 'Space' || e.code === 'Enter') && this.endPrimary && performance.now() > (this.endInputLock || 0)) this.endPrimary.click();
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.primary(); return; }
      if (this.state === 'anim' || this.state === 'auto') { if (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') this.director.skip = true; return; }
      if (this.state !== 'decision') return;
      if (e.code === 'KeyR') this.doRespin();
      if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') this.doHold(+e.code.slice(-1) - 1);
      if (e.code === 'KeyE') this.toggleMode('echo');
      if (e.code === 'KeyK') this.toggleMode('key');
      if (e.code === 'Escape') { this.closePicker(); this.mode = null; this.refreshButtons(); this.renderLeft(this.run.forecast()); }
    }

    stageState() {
      const run = this.run, dec = this.state === 'decision';
      const nm = dec ? (run.awaken.ready ? run.nearMisses(1) : run.mods.nudge ? run.nearMisses(1) : []) : (this.state === 'idle' || this.state === 'auto') && run.phase === 'spun' ? [] : [];
      // show near-miss glows even without the verb (desire), but only once the reels stopped
      let glow = nm;
      if (!dec && run.phase === 'spun' && !this.reels.busy()) glow = run.nearMisses(1);
      return {
        decision: dec,
        nearMiss: glow,
        canNudge: (i, dir) => dec && run.canNudge(i, dir),
        canHold: (i) => dec && run.canHold(i),
        canBless: (i) => dec && run.canBless(i),
        ribbonActive: (i, idx) => dec && this.ribbonAction(i, idx) != null,
        mode: this.mode,
        sparks: this.V.sparks,
        pendingCost: dec ? this.pendingCost() : 0,
        marked: run.enemy && run.enemy.now && run.enemy.now.k === 'mark' ? run.enemy.now.sym : null,
        forecast: this.fc,
        comboCells: this.comboCells,
        leverActive: this.state === 'idle' || this.state === 'decision',
        runes: Math.min(12, Object.keys(this.profile.unlocked).length - 1),
        boss: run.enemy && run.enemy.boss,
      };
    }

    // how many sparks the hovered action would burn (the candles flicker)
    pendingCost() {
      const run = this.run, h = this.reels.hover;
      if (this.btnHover === 'respin') return run.respinCost() === 'spark' ? 1 : 0;
      if (this.btnHover === 'echo' || (this.mode && this.mode.kind === 'echo')) return 1;
      if (this.btnHover === 'key' || (this.mode && this.mode.kind === 'key')) return 1;
      if (h && h.kind === 'cell' && h.row !== 0 && run.canNudge(h.reel, h.row)) return run.nudgeCost() === 'spark' ? 1 : 0;
      if (h && h.kind === 'ribbon' && this.ribbonAction(h.reel, h.index)) return run.nudgeCost() === 'spark' ? 1 : 0;
      return 0;
    }

    predictedLoss() {
      const run = this.run, e = run.enemy;
      if (!e || !e.intent || !(this.state === 'idle' || this.state === 'decision' || this.state === 'auto')) return 0;
      const it = e.intent;
      if (!(it.k === 'attack' || it.k === 'doom' || it.k === 'jam')) return 0;
      const R = this.hoverPreview || this.fc;
      let blk = run.block + (R ? R.block : 0);
      let refl = R ? R.reflectIn || 0 : 0;
      const ra = Math.min(blk, refl); blk -= ra; refl -= ra;
      if (R && R.totalDmg >= e.hp + (e.block || 0)) return 0; // the enemy falls first
      const self = R ? R.selfDmg : 0;
      return (R && R.guardian ? 0 : Math.max(0, run.intentDamage(it) - blk)) + refl + self;
    }

    previewEval(cells) {
      const f = this.run.fight, was = f ? f.manipulated : false;
      if (f) f.manipulated = true;
      const R = this.run.evaluate(cells);
      if (f) f.manipulated = was;
      return R;
    }

    ribbonAction(i, idx) {
      const run = this.run;
      if (run.phase !== 'spun') return null;
      const r = run.reels[i], n = r.strip.length;
      if (this.mode && this.mode.kind === 'key') return run.canFateKey(i) ? { kind: 'key', reel: i, index: idx } : null;
      let off = idx - r.pos;
      if (off > n / 2) off -= n; if (off < -n / 2) off += n;
      if (off !== 0 && Math.abs(off) <= run.mods.nudgeRange && run.canNudge(i, off)) return { kind: 'nudge', reel: i, dir: off };
      return null;
    }

    onMouseMove(x, y) {
      if (this.modalOpen || this.state === 'end') { this.reels.hover = null; return; }
      // enemy / intent tooltip
      const en = this.scene.enemy, re = this.run.enemy;
      let onEnemy = false;
      if (en && re && y < 440) {
        const info = en.info(), w = info.width || 120;
        const top = en.y + (info.head ? info.head[1] : -info.height) - 80;
        onEnemy = x > en.x - w / 2 - 40 && x < en.x + w / 2 + 90 && y > top && y < en.y + 40;
        if (onEnemy) {
          SD.UI.showTip(`<b>${re.name}</b>　HP ${re.hp}/${re.maxHp}${re.armor ? '　鎧 ' + re.armor : ''}${re.burn ? '　燃焼 ' + re.burn : ''}`
            + `<br><span style="color:#b9ad95">${re.tip || ''}</span><br>${SD.UI.intentExplain(this.run, re.intent)}`, x, y);
        }
      }
      if (!onEnemy && this._tipOn) SD.UI.hideTip();
      this._tipOn = onEnemy;
      const h = this.reels.hit(x, y);
      const prev = this.reels.hover;
      this.reels.hover = h;
      let cursor = 'default';
      if (h && h.kind === 'lever' && (this.state === 'idle' || this.state === 'decision')) cursor = 'pointer';
      if (this.state === 'decision' && h) {
        const run = this.run;
        let preview = null;
        if (h.kind === 'cell' && h.row !== 0 && !this.mode && run.canNudge(h.reel, h.row)) {
          cursor = 'pointer';
          const cells = run.paylineCells(); cells[h.reel] = run.cellAt(h.reel, h.row);
          preview = this.previewEval(cells);
        } else if (h.kind === 'cell' && h.row === 0) {
          if (this.mode || run.canHold(h.reel) || run.canBless(h.reel)) cursor = 'pointer';
          if (this.mode && this.mode.kind === 'echo' && this.mode.src != null && run.canEcho(this.mode.src, h.reel)) {
            const cells = run.paylineCells(); cells[h.reel] = run.paylineCell(this.mode.src);
            preview = this.previewEval(cells); preview._label = '写すと…';
          }
        } else if (h.kind === 'ribbon') {
          const act = this.ribbonAction(h.reel, h.index);
          if (act) {
            cursor = 'pointer';
            const cells = run.paylineCells(); cells[h.reel] = run.reels[h.reel].strip[act.kind === 'key' ? h.index : ((run.reels[h.reel].pos + act.dir) % run.reels[h.reel].strip.length + run.reels[h.reel].strip.length) % run.reels[h.reel].strip.length];
            preview = this.previewEval(cells);
          }
        }
        const changed = JSON.stringify(prev) !== JSON.stringify(h);
        if (changed) {
          this.hoverPreview = preview;
          this.renderLeft(preview || run.forecast(), preview ? (preview._label || 'ずらすと…') : null);
        }
      } else if (this.hoverPreview && this.state === 'decision') {
        this.hoverPreview = null; this.renderLeft(this.run.forecast());
      }
      SD.Game.canvas.style.cursor = cursor;
    }

    onMouseDown(x, y) {
      if (this.modalOpen) return;
      if (this.state === 'end') return;
      const h = this.reels.hit(x, y);
      if (this.state === 'anim' || this.state === 'auto') { this.director.skip = true; return; }
      if (!h) return;
      if (h.kind === 'lever') { this.primary(); return; }
      if (this.state !== 'decision') return;
      const run = this.run;
      if (this.mode && this.mode.kind === 'echo' && h.kind === 'cell' && h.row === 0) {
        if (this.mode.src == null) { this.mode.src = h.reel; if (SD.Audio) SD.Audio.play('ui_click'); this.renderLeft(run.forecast()); return; }
        if (run.canEcho(this.mode.src, h.reel)) {
          const src = this.mode.src; this.mode = null; this.state = 'anim';
          this.play(run.echo(src, h.reel)).then(() => this.afterManip());
        } else { this.mode.src = h.reel; if (SD.Audio) SD.Audio.play('ui_click'); }
        return;
      }
      if (this.mode && this.mode.kind === 'key' && (h.kind === 'cell' || h.kind === 'ribbon')) {
        if (run.canFateKey(h.reel)) this.openPicker(h.reel, 'key'); else if (SD.Audio) SD.Audio.play('ui_deny');
        return;
      }
      if (h.kind === 'cell') {
        if (h.row === 0) {
          if (run.canBless(h.reel)) { this.doBless(h.reel); return; }
          if (run.mods.holdMax) this.doHold(h.reel);
          return;
        }
        if (run.canNudge(h.reel, h.row)) this.doNudge(h.reel, h.row);
        else if (SD.Audio) SD.Audio.play('ui_deny');
        return;
      }
      if (h.kind === 'ribbon') {
        if (run.mods.nudgeRange > 1 && run.canNudge(h.reel, 1)) { this.openPicker(h.reel, 'push'); return; }
        const act = this.ribbonAction(h.reel, h.index);
        if (act && act.kind === 'nudge') this.doNudge(act.reel, act.dir);
      }
    }

    // A readable strip picker for 運命の鍵 (any stop) and 遠押し (±2), instead of 14px ribbon cells.
    openPicker(reel, kind) {
      const U = UI(), run = this.run, r = run.reels[reel], n = r.strip.length;
      this.closePicker();
      const el = U.el('div', 'strip-picker');
      el.appendChild(U.el('div', 'sp-title', kind === 'key' ? `運命の鍵 — リール${reel + 1}のどのコマを発動列に？ <small>火種1</small>` : `遠押し — リール${reel + 1}を2コマ先まで <small>火種1</small>`));
      const row = U.el('div', 'sp-row');
      const half = Math.floor(n / 2);
      for (let off = -half; off < n - half; off++) {
        const idx = ((r.pos + off) % n + n) % n, c = r.strip[idx];
        const ok = kind === 'key' ? off !== 0 : off !== 0 && Math.abs(off) <= run.mods.nudgeRange && run.canNudge(reel, off);
        const cell = U.el('div', 'sp-cell' + (off === 0 ? ' cur' : '') + (ok ? '' : ' off'));
        cell.appendChild(U.sym(c.s, 40, { gilded: c.g, cursed: c.temp && c.s === 'skull' }));
        cell.appendChild(U.el('span', 'sp-off', off === 0 ? '今' : off > 0 ? '下' + off : '上' + -off));
        if (ok) {
          cell.addEventListener('mouseenter', () => {
            const cells = run.paylineCells(); cells[reel] = c;
            const R = this.previewEval(cells); R._label = kind === 'key' ? '鍵で…' : 'ずらすと…';
            this.hoverPreview = R; this.renderLeft(R, R._label);
          });
          cell.addEventListener('click', () => {
            this.closePicker();
            if (kind === 'key') { if (!run.canFateKey(reel)) return; this.mode = null; this.state = 'anim'; this.play(run.fateKey(reel, idx)).then(() => this.afterManip()); }
            else this.doNudge(reel, off);
          });
        }
        row.appendChild(cell);
      }
      el.appendChild(row);
      const cancel = U.button('やめる <kbd>Esc</kbd>', 'mini', () => { this.closePicker(); this.mode = null; this.refreshButtons(); this.renderLeft(run.forecast()); });
      el.appendChild(cancel);
      U.root().appendChild(el);
      const R = SD.REEL_LAYOUT.reels[reel];
      el.style.left = Math.max(10, Math.min(1270 - el.offsetWidth, R.x + R.w / 2 - el.offsetWidth / 2)) + 'px';
      this.picker = el;
    }
    closePicker() { if (this.picker) { this.picker.remove(); this.picker = null; this.hoverPreview = null; } }

    // ------------------------------------------------------------------ loop
    update(dt) {
      this.scene.update(dt);
      this.reels.update(dt);
      this.joy = Math.max(0, (this.joy || 0) - dt * 1.3);
      const V = this.V;
      this.fc = this.run.phase === 'spun' ? this.run.forecast() : null;
      V.pred = this.predictedLoss();
      const tween = (cur, target, rate) => cur + (target - cur) * Math.min(1, dt * rate);
      V.hpShown = tween(V.hpShown, V.hp, 12);
      V.hpGhost = V.hpGhost > V.hpShown ? Math.max(V.hpShown, V.hpGhost - dt * V.maxHp * 0.6) : V.hpShown;
      V.maxHp = this.run.maxHp;
      if (V.enemy) {
        V.enemy.hpShown = tween(V.enemy.hpShown, V.enemy.hp, 12);
        V.enemy.hpGhost = V.enemy.hpGhost > V.enemy.hpShown ? Math.max(V.enemy.hpShown, V.enemy.hpGhost - dt * V.enemy.maxHp * 0.5) : V.enemy.hpShown;
      }
      if (this.dom && this.dom.emberNum) {
        const txt = String(V.embers);
        if (this.dom.emberNum.textContent !== txt) {
          this.dom.emberNum.textContent = txt;
          this.updateGoal();
          this.dom.embers.classList.remove('bump'); void this.dom.embers.offsetWidth; this.dom.embers.classList.add('bump');
        }
      }
    }

    render(ctx) {
      const st = this.stageState();
      const [sx, sy] = SD.FX.shakeOffset();
      ctx.save();
      ctx.translate(sx, sy);
      this.scene.drawStage(ctx, {});
      if (this.joy > 0) {
        // the whole stage glows warm for a moment when fate lines up
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 1280, 446); ctx.clip();
        SD.Art.glow(ctx, 640, 250, 760, 'rgba(255,196,110,0.55)', this.joy * 0.7);
        SD.Art.glow(ctx, 285, 300, 260, 'rgba(255,230,170,0.6)', this.joy * 0.6);
        ctx.restore();
      }
      SD.StageDraw.drawProscenium(ctx, this.scene.time);
      let ghostPct = null;
      const e = this.run.enemy;
      if (e && (e.elite || e.boss)) {
        const bv = (this.profile.stats.bestVs || {})[e.id];
        if (bv != null) ghostPct = bv;
      }
      this.scene.drawHud(ctx, { V: this.V, showPartyBar: true, showEnemyBar: !!this.scene.enemy && !!this.V.enemy, intent: this.intent, ghostPct });
      // device band background
      SD.StageDraw.drawApron(ctx, this.scene.time);
      this.reels.draw(ctx, st);
      ctx.restore();
      SD.FX.draw(ctx);
      this.scene.drawZoneTitle(ctx);
      SD.FX.drawOverlay(ctx, 1280, 720);
      SD.StageDraw.drawCurtain(ctx, this.scene.curtain, this.scene.time);
    }
  }

  SD.Screens = { TitleScreen, CampScreen, RunScreen };
})();
