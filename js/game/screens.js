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
        // a new save: 序の巻 first (once), then the first descent
        if (first && !G.profile.seen.prologue) { this.playScroll('prologue', {}, () => { G.profile.seen.prologue = true; G.save(); G.setScreen(new RunScreen({ startFloor: 1 })); }); return; }
        if (first) G.setScreen(new RunScreen({ startFloor: 1 }));
        else G.setScreen(new CampScreen());
      });
      box.appendChild(b);
      box.appendChild(U.el('div', 'title-hint', 'クリック または Space'));
      // the scrolls, to see again (終の巻 once 深淵の繰り手 has been beaten)
      if (!first || G.profile.seen.prologue) {
        const row = U.el('div', 'title-scrolls');
        row.appendChild(U.button('絵巻を見る', 'mini', () => { if (SD.Audio) SD.Audio.init(); this.playScroll('prologue', {}, () => G.setScreen(new TitleScreen())); }));
        if (G.profile.stats.finalClears > 0) row.appendChild(U.button('終の巻を見る', 'mini', () => { if (SD.Audio) SD.Audio.init(); this.playScroll('epilogue', { records: SD.Scroll.colophon(G.profile) }, () => G.setScreen(new TitleScreen())); }));
        box.appendChild(row);
      }
      this.box = box;
      root.appendChild(box);
      root.appendChild(G.settingsButton());
      if (SD.Audio) SD.Audio.setMusic('title');
    }
    // a scroll over the title (the title's own box steps aside while it plays)
    playScroll(kind, opts, then) {
      this.box.style.display = 'none';
      this.scroll = SD.Scroll.create(kind, Object.assign({}, opts, { onDone: () => { this.scroll = null; then(); } }));
      this.scroll.mount(UI().root());
    }
    onKey(e) {
      if (this.scroll) { if (e.code === 'Escape') this.scroll.finish(); else this.scroll.input(); return; }
      if (e.code === 'Space' || e.code === 'Enter') { const b = document.querySelector('.title-box .btn'); if (b) b.click(); }
    }
    onMouseDown() { if (this.scroll) this.scroll.input(); }
    update(dt) { this.t += dt; if (this.scroll) this.scroll.update(dt); }
    render(ctx) {
      if (this.scroll) { this.scroll.render(ctx); return; }
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
      // 灯輪の完成 / B17's notice, once each (a save from before stage 4 that already meets them gets them here)
      const fs = SD.Meta.finalState(this.profile);
      if (fs.tree.done && !this.profile.seen.treeComplete) this.startComplete();
      else if (fs.open && !this.profile.seen.b17Notice) {
        this.profile.seen.b17Notice = true; G.save();
        setTimeout(() => { SD.FX.banner('最深の間への道が開かれた', { sub: '出発のマスの4つ目「最深の間へ」から挑める', size: 48, y: 160, life: 3.2 }); if (SD.Audio) SD.Audio.play('relic'); }, 600);
      }
    }

    // ------------------------------------------------------------------ 灯輪の完成 (docs/EXPANSION_4A_SPEC.md §8.1)
    // The last 灯紋: the nodes light one by one from the centre outwards (0.08 s each), the lines after them, the wheel
    // glows, a chord of bells; then three vertical lines. Any input shows it all, the next one closes it.
    startComplete() {
      const p = this.profile, fs = SD.Meta.finalState(p);
      p.seen.treeComplete = true;
      if (fs.open) p.seen.b17Notice = true;
      SD.Game.save();
      const order = SD.Data.SKILLS.slice().sort((a, b) => (a.r - b.r) || (a.a - b.a));
      const at = {}; order.forEach((n, i) => { at[n.id] = 0.4 + i * 0.08; });
      const seqEnd = 0.4 + order.length * 0.08;
      const cols = fs.keeper ? ['すべての灯紋が灯った。', '灯輪は、最後の運命を指し示す。', '――最深の間への道が開かれた。']
        : ['すべての灯紋が灯った。', '灯輪は、最後の運命を指し示す。', '灯輪は完成した。だが、', '深淵の最奥へ至る道は、まだ閉ざされている。'];
      this.complete = { t: 0, at, seqEnd, cols, colAt: cols.map((c, i) => seqEnd + 0.6 + i * 0.9), sounded: false, ticks: 0 };
      this.complete.end = this.complete.colAt[cols.length - 1] + 1.2;
      for (const el of [this.left, this.right, this.desc, this.top]) if (el) { el.style.transition = 'opacity 0.6s'; el.style.opacity = '0'; el.style.pointerEvents = 'none'; }
      if (SD.Audio) SD.Audio.duck(0.75, this.complete.end + 1);
    }
    advanceComplete() {
      const c = this.complete;
      if (c.t < c.end) { c.t = c.end; if (!c.sounded && SD.Audio) { c.sounded = true; SD.Audio.play('tree_complete'); } return; }
      this.complete = null;
      for (const el of [this.left, this.right, this.desc, this.top]) if (el) { el.style.opacity = '1'; el.style.pointerEvents = ''; }
      this.refresh();
    }
    drawComplete(ctx) {
      const c = this.complete, Art = SD.Art, C = TREE_C, t = c.t;
      // the lines light after the nodes they join
      for (const n of SD.Data.SKILLS) for (const rq of n.req) {
        const m = SD.Data.SKILL_BY_ID[rq]; if (!m) continue;
        const k = t - Math.max(c.at[n.id], c.at[rq]);
        if (k < 0 || k > 0.6) continue;
        const a = nodePos(n), b = nodePos(m);
        ctx.save(); ctx.globalAlpha = 1 - k / 0.6; ctx.strokeStyle = '#fff6d8'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + (a.x - b.x) * Math.min(1, k / 0.25), b.y + (a.y - b.y) * Math.min(1, k / 0.25)); ctx.stroke(); ctx.restore();
      }
      // each node blooms as it lights
      for (const n of SD.Data.SKILLS) {
        const k = t - c.at[n.id];
        if (k < 0 || k > 0.8) continue;
        const q = nodePos(n);
        Art.glow(ctx, q.x, q.y, 40 + 60 * k, BRANCH_COL[n.branch], 1 - k / 0.8);
      }
      // the wheel: glowing, its rays turning
      const g = Math.max(0, Math.min(1, (t - c.seqEnd) / 1.0));
      if (g > 0) {
        Art.glow(ctx, C.x, C.y, 260 + 60 * Math.sin(t * 3), 'rgba(255,214,120,0.9)', 0.55 * g);
        ctx.save(); ctx.translate(C.x, C.y); ctx.rotate(t * 0.6); ctx.globalAlpha = 0.35 * g;
        for (let k = 0; k < 16; k++) { ctx.rotate(Math.PI / 8); ctx.fillStyle = '#ffe1a0'; ctx.fillRect(40, -2, 300, 4); }
        ctx.restore();
        ctx.save(); ctx.globalAlpha = 0.12 * g; ctx.fillStyle = '#ffdca0'; ctx.fillRect(0, 0, 1280, 720); ctx.restore(); // (the light of the camp rises a step)
      }
      // three vertical lines, right to left
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      c.cols.forEach((str, i) => {
        const a = Math.max(0, Math.min(1, (t - c.colAt[i]) / 0.6));
        if (a <= 0) return;
        const x = 1190 - i * 52, size = 26;
        ctx.globalAlpha = a; ctx.font = `900 ${size}px ${SD.Game.fontTitle}`;
        [...str].forEach((ch, j) => {
          const y = 70 + j * (size + 3);
          ctx.save(); ctx.translate(x, y);
          if (ch === '―' || ch === 'ー') ctx.rotate(Math.PI / 2);
          if (ch === '、' || ch === '。') ctx.translate(size * 0.35, -size * 0.35);
          ctx.lineWidth = 5; ctx.strokeStyle = '#1a1222'; ctx.strokeText(ch, 0, 0);
          ctx.fillStyle = i === 2 && c.cols.length === 3 ? '#ffd257' : '#fff6d8'; ctx.fillText(ch, 0, 0);
          ctx.restore();
        });
      });
      if (t >= c.end) { ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 3); ctx.font = `700 14px ${SD.Game.fontUI}`; ctx.fillStyle = '#efe5cf'; ctx.fillText('クリックで閉じる', C.x, 700); }
      ctx.restore();
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
        <div class="rec"><span>ボス最高</span><b>${s.bossKills ? '討伐 ' + s.bossKills + '回' : best}</b></div>` +
        (s.deepRuns ? `<div class="rec"><span>灰の底</span><b>最深 B${s.deepBest}</b></div><div class="rec"><span>踏破／挑戦</span><b>${s.deepClears || 0} / ${s.deepRuns}</b></div>` : '') +
        (s.finalRuns || SD.Meta.finalState(p).open ? `<div class="rec final"><span>真のクリア</span><b>${s.finalClears ? s.finalClears + ' 回' : '—'}</b></div>` +
          (s.finalClears ? `<div class="rec sub"><span>初めて ${s.firstFinalClear || '—'}</span><b>最少 ${s.finalBestTurns} ターン</b></div>` : '') : '');
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
      const post = mods.shortcuts.some((f) => SD.Data.SHORTCUTS[f].postClear);
      this.desc.classList.toggle('post', post);
      const has = (f) => mods.shortcuts.indexOf(f) >= 0;
      const relics5 = mods.abbotBonus ? 2 : 1;
      if (!post) {
        // before the clear: exactly as it always was
        if (has(5)) this.desc.appendChild(U.button(`第二層から <small>B5・刻印3+遺物${relics5}</small>`, 'secondary', () => G.setScreen(new RunScreen({ startFloor: 5 }))));
        return;
      }
      // after the clear: the starts as a 2-column grid under 降下する, so the column always fits under the 灯紋 detail
      // (a 4th cell is kept for a later start); the longer notes are on hover
      const grid = U.el('div', 'sc-grid');
      const cell = (f, name, sub, tip, cls) => {
        const b = U.button(`${name} <small>${sub}</small>`, 'secondary sc' + (cls ? ' ' + cls : ''), () => G.setScreen(new RunScreen({ startFloor: f })));
        U.bindTip(b, tip);
        grid.appendChild(b);
      };
      if (has(5)) cell(5, '第二層から', `B5・刻印3+遺物${relics5}`, `<b>第二層（B5）から</b><br>支度：刻印3＋遺物${relics5}`);
      if (has(9)) {
        const S = SD.Data.SHORTCUTS[9];
        cell(9, '第三層から', `B9・刻印${S.carvings}+遺物${S.relics}`, `<b>第三層（B9）から</b><br>支度：刻印${S.carvings}＋遺物${S.relics}<br>灰輪の主を倒すと、近道の残り火 +${S.bossEmbers}`);
      }
      if (has(13)) {
        const S = SD.Data.SHORTCUTS[13];
        cell(13, '灰の底から', `B13・刻印${S.carvings}+遺物${S.relics}`, `<b>灰の底（B13）から</b><br>支度：刻印${S.carvings}＋遺物${S.relics}<br>灰の底だけの挑戦。本編の記録（挑戦・勝利など）は付かない`, 'deep');
      }
      // the 4th start: 最深の間へ once B17 is open; until then a veiled cell with its two conditions (the last goal, in view)
      if (has(17)) {
        const S = SD.Data.SHORTCUTS[17];
        cell(17, '最深の間へ', `B17・刻印${S.carvings}+遺物${S.relics}`, `<b>最深の間（B17）へ</b><br>支度：刻印${S.carvings}＋遺物${S.relics}を選んで、深淵の繰り手に挑む<br>最深の間だけの挑戦。ほかの記録（挑戦・勝利など）は付かない`, 'final');
      } else {
        const fs = SD.Meta.finalState(this.profile);
        const v = U.el('div', 'btn secondary sc locked', '？？？ <small>まだ閉ざされている</small>');
        U.bindTip(v, `<b>？？？</b><br>${fs.tree.done ? '✓' : '・'} すべての灯紋を灯す（${fs.tree.lit} / ${fs.tree.all}）<br>${fs.keeper ? '✓' : '・'} 灰の底の${SD.UI.deepEliteName()}を倒す`);
        grid.appendChild(v);
      }
      this.desc.appendChild(grid);
    }

    nodeState(n) {
      const p = this.profile;
      if (p.unlocked[n.id]) return this.complete && this.complete.t < (this.complete.at[n.id] || 0) ? 'dim' : 'owned';
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
      if (SD.Meta.treeState(p).done && !p.seen.treeComplete) { this.refresh(); this.startComplete(); return; }
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
      if (this.complete) { this.advanceComplete(); return; }
      const h = this.hitNode(x, y);
      if (!h) return;
      if (this.sel === h && SD.Meta.canUnlock(this.profile, h)) { this.unlock(h); return; }
      this.sel = h; this.renderDetail();
      if (SD.Audio) SD.Audio.play('ui_click');
    }
    onKey(e) {
      if (this.complete) { this.advanceComplete(); return; }
      if (e.code === 'Space' || e.code === 'Enter') { const b = this.desc.querySelector('.btn'); if (b) b.click(); }
    }
    update(dt) {
      this.t += dt; for (const b of this.burst) b.t += dt; this.burst = this.burst.filter((b) => b.t < 1.5);
      const c = this.complete;
      if (c) {
        const t0 = c.t; c.t += dt;
        // a soft tick every few nodes as they light; the chord of bells when the wheel glows
        const lit = (tt) => Math.floor(Math.max(0, tt - 0.4) / 0.08);
        if (SD.Audio && c.t < c.seqEnd && lit(c.t) !== lit(t0) && lit(c.t) % 3 === 0) SD.Audio.play('ember', { vol: 0.5 });
        if (!c.sounded && c.t >= c.seqEnd) { c.sounded = true; if (SD.Audio) SD.Audio.play('tree_complete'); }
      }
    }

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
      const lbl = [['運', 'weave', -90, '操作'], ['猛', 'valor', 135, '火力・絆'], ['守', 'hearth', 45, '生存']];
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
          const lit = this.nodeState(n) === 'owned' && this.nodeState(m) === 'owned';
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
      if (this.complete) this.drawComplete(ctx);
    }
  }

  // =====================================================================================
  // RUN
  // =====================================================================================
  class RunScreen {
    // opts.kit { carvings, relics }: picked at the start, before the first door (the stage 4b test entrance to B17 uses it)
    constructor(opts = {}) { this.startFloor = opts.startFloor || 1; this.kit = opts.kit || null; this.act = opts.act || 1; }

    enter() {
      const G = SD.Game;
      this.profile = G.profile;
      this.mods = SD.Meta.computeMods(this.profile);
      this.run = new SD.Run(this.mods, { startFloor: this.startFloor });
      if (this.kit) {
        for (let i = 0; i < (this.kit.carvings || 0); i++) this.run.pending.push('carving');
        for (let i = 0; i < (this.kit.relics || 0); i++) this.run.pending.push('relic');
      }
      this.scene = new SD.Scene();
      this.reels = new SD.ReelView();
      this.reels.sync(this.run);
      this.director = new SD.Director(this);
      this.state = 'anim';
      this.mode = null;
      this.comboCells = null;
      this.intent = null;
      this.hoverPreview = null;
      this.band = null;          // 灰輪の台本 as currently readable (engine scriptBand())
      this.turnPrev = null;      // exact outcome of resolving the current payline now (engine previewTurn())
      this.hoverPrev = null;     // { R, turn, band, caption } while hovering an action
      this.bandSlide = 0;
      this.firstRun = this.profile.stats.runs === 0;
      // the next 灯紋 within reach: shown under the embers plaque, celebrated when this run pays for it
      const goal = SD.Meta.recommendedNode(this.profile, this.profile.seen.lastWhisper);
      this.goal = goal && goal.cost > this.profile.embers ? { id: goal.id, name: goal.name, cost: goal.cost, base: this.profile.embers, hit: false } : null;
      this.turnHints = {};
      this.V = {
        hp: this.run.hp, hpShown: this.run.hp, hpGhost: this.run.hp, maxHp: this.run.maxHp, block: 0,
        sparks: this.run.sparks, borrowed: 0, embers: 0, enemy: null,
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
      let ev = this.run.begin();
      if (this.kit && this.kit.auto) ev = this.autoKit(ev);
      this.play(ev);
    }

    // (test entrance) pick the kit without the crossroads screens, as the sim's bot would; returns the events that enter the fight
    autoKit(ev) {
      const run = this.run;
      const score = (o) => {
        switch (o.kind) {
          case 'relic': return 5;
          case 'add2': return 4.5;
          case 'gild': return 4;
          case 'add': return { blade: 3, flame: 2.6, ward: 2, heart: 2, lantern: 0.5, wild: 6, skull: run.mods.skullPact ? 2 : -5 }[o.sym] || 0;
          case 'transmute': return o.from === 'lantern' || o.from === 'skull' ? 3 : 0.5;
          case 'remove': return o.sym === 'skull' ? 5 : o.sym === 'lantern' ? 1.5 : 0.2;
          case 'spark': return 3;
          default: return -1; // (鑿 and the rest)
        }
      };
      let out = ev;
      for (let guard = 0; guard < 80 && run.phase !== 'idle' && run.phase !== 'dead'; guard++) {
        if (run.phase === 'chisel') out = run.finishChisel();
        else if (run.phase === 'crossroads') {
          let bi = null, bs = -1e9;
          (run.offers || []).forEach((o, i) => { const s = score(o); if (s > bs) { bs = s; bi = i; } });
          out = run.choose(bi, 0);
        } else if (run.phase === 'event') out = run.chooseEvent(run.event.options[0].id);
        else break;
      }
      this.updateRelics();
      this.V.hp = this.V.hpShown = this.V.hpGhost = run.hp; this.V.maxHp = run.maxHp; this.V.sparks = run.sparks;
      return out;
    }
    // (test entrance) start the final boss at 面の段 / 祈りの段 / 終幕の段 (its HP at that string), the act's first cell
    startAtAct(ev, act) {
      const run = this.run, e = run.enemy;
      if (!e || !SD.UI.isFinal(run)) return;
      const ED = SD.Data.ENEMIES[e.id];
      e.hp = ED.marks[act - 2];
      e.phase = act; e.phaseFor = act; e.phaseAt = e.cursor || 0;
      e.intent = run._readCell(e); e.now = e.intent.now || null;
      // as you would arrive there (measured, docs/EXPANSION_4B_PROMISE.md): hurt (面 75% HP, 祈り 55%, 終幕 50%), the sparks
      // full from the snapped string, and from 祈りの段 on the fight's free respin / nudge / 割れた鏡 already used
      run.hp = Math.max(1, Math.round(run.maxHp * (act === 2 ? 0.75 : act === 3 ? 0.55 : 0.5))); run.sparks = run.maxSparks;
      if (act >= 3 && run.fight) { run.fight.freeRespinUsed = true; run.fight.mirrorFree = 0; run.fight.freeNudgeLeft = 0; }
      this.V.hp = this.V.hpShown = this.V.hpGhost = run.hp; this.V.sparks = run.sparks;
      const c = ev.find((x) => x.t === 'combat');
      if (c) { c.enemy = run._enemySnap(); c.intent = e.intent; c.hp = run.hp; c.maxHp = run.maxHp; c.sparks = run.sparks; }
    }

    exit() { SD.UI.hideTip(); this.closePicker(); }

    play(events) {
      // (test entrance) start the final boss at a later act as soon as its fight begins
      if (this.act > 1 && !this._actDone && events.some((x) => x.t === 'combat')) { this._actDone = true; this.startAtAct(events, this.act); }
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
      // 灰輪の台本: send the script (拍子木) / borrow from the Ashwheel (借り火)
      this.dom.srow = U.el('div', 'btn-row script-row');
      this.dom.advance = U.button('台本送り', 'mini script', () => this.doAdvance());
      this.dom.borrow = U.button('灰輪に借りる', 'mini borrow', () => this.doBorrow());
      this.dom.srow.appendChild(this.dom.advance); this.dom.srow.appendChild(this.dom.borrow);
      this.dom.help = U.el('div', 'help-line');
      for (const [k, b] of [['respin', this.dom.respin], ['echo', this.dom.echo], ['key', this.dom.key], ['advance', this.dom.advance], ['borrow', this.dom.borrow]]) {
        b.addEventListener('mouseenter', () => { this.btnHover = k; if (k === 'advance' || k === 'borrow') this.previewButton(k); });
        b.addEventListener('mouseleave', () => { if (this.btnHover === k) this.btnHover = null; if (k === 'advance' || k === 'borrow') this.clearHoverPrev(); });
      }
      this.dom.right.appendChild(this.dom.primary);
      this.dom.right.appendChild(this.dom.respin);
      this.dom.right.appendChild(this.dom.row);
      this.dom.right.appendChild(this.dom.srow);
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
      const lastBead = Math.max(run.floor, run.startFloor) >= SD.Data.FINAL_FLOOR ? SD.Data.FINAL_FLOOR : run.deep || run.floor > SD.Data.LAST_FLOOR ? SD.Data.DEEP_LAST_FLOOR : SD.Data.LAST_FLOOR;
      for (let k = 1; k <= lastBead; k++) {
        const fl = SD.Data.FLOORS[k];
        const cls = ['bead', fl.type];
        if (k < run.floor) cls.push('done');
        if (k === run.floor) cls.push('cur');
        if (k === p.stats.bestFloor) cls.push('best');
        if (k === p.stats.lastFloor) cls.push('last');
        html += `<span class="${cls.join(' ')}" title="B${k}"></span>`;
      }
      html += `<span class="depth-lbl">${run.deep ? '灰の底' + (p.stats.deepBest ? ' 最深 B' + p.stats.deepBest : '') : p.stats.bestFloor ? '最深 B' + p.stats.bestFloor : ''}</span>`;
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

    // The HUD the DOM lays over the stage, in stage px (depth beads, next-灯紋 bar, relics, the two plaques). The enemy's
    // plaque and script band are drawn on the canvas below it and keep clear of these rects (QA-001). Re-read 5×/s.
    hudRects() {
      const now = performance.now();
      if (this._hud && now - this._hud.t < 200) return this._hud.rects;
      const root = UI().root(), d = this.dom || {}, rects = [];
      const add = (el, padBottom) => {
        if (!el || !el.isConnected || el.style.display === 'none' || !el.offsetWidth) return;
        let x = 0, y = 0;
        for (let n = el; n && n !== root; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
        rects.push({ x, y, w: el.offsetWidth, h: el.offsetHeight + (padBottom || 0) });
      };
      add(d.floor); add(d.depth, 8); add(d.embers); add(d.goal); add(d.relics); // (the depth beads' 前 marks hang below the box)
      this._hud = { t: now, rects };
      return rects;
    }

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
      if (snap.final) Object.assign(ev, { final: true, strings: (SD.Data.ENEMIES[snap.id] || {}).strings || null, acts: (SD.Data.ENEMIES[snap.id] || {}).acts || null });
      return ev;
    }

    setIntent(it, opts) {
      if (this._tipOn) { SD.UI.hideTip(); this._tipOn = false; }
      if (!(opts && opts.debt)) this.liftFree = false; // (a new cell: whoever it lifts hangs again)
      this.intent = it ? SD.UI.intentInfo(this.run, it, this.run.enemy, { band: SD.UI.bandVisible(this.run) }) : null;
      if (this.intent) { this.intent.born = this.scene.time; if (opts && opts.debt) this.intent.debt = true; }
      if (!(opts && opts.debt)) this.refreshBand();
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

    // Re-read the script band and the exact outcome of the current payline (only when the game state changed).
    refreshBand() {
      const run = this.run;
      this.band = null; this.turnPrev = null;
      if (!run.enemy || run.enemy.hp <= 0) return;
      if (SD.UI.bandVisible(run)) {
        this.band = run.scriptBand();
        if (this.band && this.band.spun) this.turnPrev = this.band.outcome || null;
      } else if (run.phase === 'spun') this.turnPrev = run.previewTurn();
      if (this.intent && run.enemy.intent) this.intent.locked = run.isLockedCell(run.enemy.intent);
    }
    clearHoverPrev() {
      if (!this.hoverPrev) return;
      this.hoverPrev = null;
      if (this.state === 'decision') this.renderLeft(this.run.forecast());
    }
    // Hovering 台本送り / 灰輪に借りる: show the script (and forecast) that would follow.
    previewButton(kind) {
      const run = this.run;
      if (this.state !== 'decision') return;
      if (kind === 'advance') {
        const P = run.previewAdvance();
        if (!P) return;
        const I = SD.UI.intentInfo(run, P.intent, run.enemy, { band: true });
        this.hoverPrev = { R: P.R, turn: P.band && P.band.outcome, band: P.band, caption: '送ると…', intentI: I, unknown: P.unknown, intent: P.unknown ? null : P.intent };
        this.renderLeft(P.R || run.forecast(), P.unknown ? '送ると…（何が来るかはサイコロ次第）' : '送ると…', P.R ? this.hoverPrev.turn : null);
      } else {
        const P = run.previewBorrow();
        if (!P) return;
        this.hoverPrev = { R: null, turn: P.turn, band: P.band, caption: '借りると…' };
        this.renderLeft(run.forecast(), '借りると…', P.turn);
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
      this.hoverPrev = null;
      this.reels.lever.target = 0;
      this.refreshBand();
      this.refreshButtons();
      this.renderLeft();
      if (this.firstRun && !this.turnHints.lever) {
        this.showHint('レバーを引く <kbd>Space</kbd>', 1150, 455, 0, 'down');
      }
      // the first time the enemy's script is readable: point at it once
      if (this.band && !this.profile.seen.band && this.scene.enemy) {
        this.profile.seen.band = true; SD.Game.save();
        const e = this.scene.enemy, boss = this.run.enemy.boss;
        // to the left of the plaque, so the band itself stays readable
        this.showHint('<b>灰輪の台本</b>：敵の予告は「今 → 次 → その次」と並んでいる（右の小札）。<br>盾2つで怯ませた強撃は、台本から消える。', boss ? 520 : e.x - 250, boss ? 330 : 262, 7);
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
        this.refreshBand();
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
      this.hoverPrev = null;
      this.refreshBand();
      this.refreshButtons();
      this.renderLeft(this.run.forecast());
      this.maybeVerbHint();
    }

    leaveDecision() { this.hideHint(); this.closePicker(); this.mode = null; this.hoverPreview = null; this.hoverPrev = null; }

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
      this.refreshBand();
      this.renderLeft(this.run.forecast());
      this.refreshButtons();
    }

    // 拍子木: send the Ashwheel's script one cell
    async doAdvance() {
      if (this.state !== 'decision' || !this.run.canAdvance()) { if (this.state === 'decision' && SD.Audio) SD.Audio.play('ui_deny'); return; }
      this.hoverPrev = null; this.btnHover = null;
      this.state = 'anim';
      await this.play(this.run.advance());
      this.afterManip();
    }
    // 借り火: borrow one spark for this turn; the Ashwheel takes its next cell too
    async doBorrow() {
      if (this.state !== 'decision' || !this.run.canBorrow()) { if (this.state === 'decision' && SD.Audio) SD.Audio.play('ui_deny'); return; }
      this.hoverPrev = null; this.btnHover = null;
      this.state = 'anim';
      await this.play(this.run.borrow());
      if (this.run.phase === 'spun') this.enterDecision();
    }

    afterManip() {
      if (this.run.phase !== 'spun') return;
      // a trine/bond, or nothing left to do, hands the turn to the auto-resolve (Run.firesAfterManip: the same rule the
      // hover preview uses to say "この操作で発動" beforehand)
      if (this.run.firesAfterManip()) this.afterSpin(true);
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
      if (m.script && this.run.canAdvance() && show('script', '【台本送り】火種1で灰輪の台本を1コマ送る。今の予告は行われず、<b>次の行動が今</b>になる。<br>強撃を早く呼ぶことも、蘇生を飛ばすこともできる', 960, 440)) return;
      if (m.borrow && this.run.canBorrow() && show('borrow', '火種が尽きた。【灰輪に借りる】と、このターンだけ一手動ける。<br>代わりに灰輪は<b>次の行動もこのターンに</b>行う（台本で確かめて）', 960, 440)) return;
      if (this.run.comboPauseReason() && show('comboPause', '揃った三連でも、すぐには発動しない。<br>継ぎ留め・台本送りを先に使える。そのまま発動は <kbd>Space</kbd>', 640, 440)) return;
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
    renderLeft(R, label, T) {
      const U = UI(), run = this.run, el = this.dom.left;
      el.classList.toggle('final', SD.UI.isFinal(run)); // (B17: the panel never grows over the stage)
      if (T === undefined) T = this.hoverPrev ? this.hoverPrev.turn : this.turnPrev;
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
            // (四本の糸: a lift has two rows, 断つ and 守る)
            for (const x of w ? [w].concat(w.also ? [w.also] : []) : []) {
              const row = U.el('div', 'wanted' + (x.avoid ? ' avoid' : '') + (x === w.also ? ' guard' : ''));
              row.appendChild(U.el('span', 'w-lbl', x.lbl || (x.avoid ? '避ける目' : '狙い目')));
              for (const sym of x.syms) row.appendChild(U.sym(sym, 24));
              row.appendChild(U.el('span', 'w-txt', x.text));
              el.appendChild(row);
            }
          }
        }
        if (this.state === 'idle') el.appendChild(U.el('div', 'cta', 'レバーを引いて運命を回す <kbd>Space</kbd>'));
        return;
      }
      const ph = U.el('div', 'ph', label || '発動の予測');
      if (label && this.hoverPrev && this.hoverPrev.fires) {
        // QA-004: the hovered manipulation fires the turn by itself (Run.firesAfterManip, the rule the UI then follows)
        const combo = R.combos.some((c) => c.k === 'trine' || c.k === 'bond' || c.k === 'quad');
        ph.appendChild(U.el('span', 'fires-tag', `この操作で発動<small>${combo ? '三連・絆' : '手が尽きる'}</small>`));
      }
      el.appendChild(ph);
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
      if (G.ward && R.marked !== 'ward') row('ward', G.ward.n, '+' + R.block, R.staggerWard ? '怯ませる！' : R.guardian ? '完全防御' : R.rampart ? '反射' : '', 'blk');
      if (G.heart && R.marked !== 'heart') {
        const eff = Math.min(R.heal, run.maxHp - run.hp);
        row('heart', G.heart.n, R.thirst ? '0' : '+' + eff, R.thirst ? '渇き' : eff < R.heal ? (eff ? `（${R.heal - eff}は溢れる）` : 'HP満タン') : R.cleanse ? '浄化' : '', 'heal');
      }
      if (G.lantern && R.marked !== 'lantern') row('lantern', G.lantern.n, '+' + (R.embers > 0 ? Math.max(1, Math.round(R.embers * (run.mods.emberMult || 1))) : 0), R.sparks ? `火種+${R.sparks}` : '', 'em');
      if (G.skull && R.marked !== 'skull') row('skull', G.skull.n, R.reaper ? R.reaper : R.skullDmg ? R.skullDmg : '-' + (G.skull.n * 3), R.reaper ? '死神' : R.skullDmg ? '敵へ' : '自分へ', 'self');
      if (R.marked && R.markedN) row(R.marked, R.markedN, '-' + R.markedN * 2, '封じ', 'self');
      el.appendChild(rows);
      if (R.combos.length) {
        const names = { trine: '三連', quad: '四連', bond: '絆の陣', reaper: '死神' };
        el.appendChild(U.el('div', 'fc-combo', R.combos.map((c) => names[c.k] + (c.s ? '・' + SD.Data.SYMBOLS[c.s].name : '')).join(' ＋ ')));
      }
      if (R.multNotes.length) el.appendChild(U.el('div', 'fc-mult', R.multNotes.join(' ')));
      // 四本の糸: this line snaps the lifted hero's string — or what would
      if (e && SD.UI.isFinal(run) && run.liftOf) {
        const lift = run.liftOf((label && this.hoverPrev && this.hoverPrev.intent) || e.intent);
        if (R.cut) {
          const c = R.combos.find((x) => x.k === 'bond') || R.combos.find((x) => (x.k === 'trine' || x.k === 'quad') && R.cut.syms.indexOf(x.s) >= 0);
          const cn = c && c.k === 'bond' ? '絆の陣' : c ? `${SD.Data.SYMBOLS[c.s].name}の${c.k === 'quad' ? '四連' : '三連'}` : '';
          el.appendChild(U.el('div', 'fc-in fc-thread', `<b class="three">${cn} → ${R.cut.name}を断つ</b>（あと${Math.max(0, e.hp - R.cutMark)}を一気に）`));
        } else if (lift) {
          const who = lift.syms.map((s) => SD.Data.SYMBOLS[s].name).join('か');
          const it0 = (label && this.hoverPrev && this.hoverPrev.intent) || e.intent, nx = (it0 && it0.nextLabel) || '強撃';
          el.appendChild(U.el('div', 'fc-in fc-thread', `${who}の三連か絆 → ${lift.name}を断てる`));
          // the other way out of a lift: two wards break the 溜め — and the string stays
          el.appendChild(U.el('div', 'fc-in', R.staggerWard ? `<b class="safe">盾${R.groups.ward.n}つ → ${nx}は消える</b>（糸は切れない）` : `盾2つ → ${nx}を崩せる（糸は切れない）`));
        }
      }
      // outcome
      if (e) {
        // the enemy's HP right after this 発動: exact from the turn preview when it is knowable (a 連鎖 spin is not),
        // else from the forecast (QA-003: the turn preview also knows the shell vs 死神 / 起爆, which go round it)
        const exact = T && !T.random && T.strikeHp != null;
        const after = exact ? T.strikeHp : Math.max(0, e.hp - Math.max(0, R.totalDmg - (e.block || 0)));
        const ED = SD.Data.ENEMIES[e.id], fin = !!(ED && ED.strings && ED.marks);
        // 四本の糸: does a string snap this turn (the act changes: the blow it was winding up never comes)?
        const mark = fin ? run.nextMark(e) : 0;
        const snaps = fin && (!!R.cut || after <= mark || !!(T && !T.random && T.phaseAfter != null && T.phaseAfter !== T.phaseBefore));
        const out = U.el('div', 'fc-out');
        out.innerHTML = after <= 0 ? (fin ? '<b class="kill">最後の糸が切れる → 勝ち</b>' : '<b class="kill">撃破できる！</b>') : `敵HP <b>${e.hp}</b> → <b>${after}</b> <small class="when">発動後</small>`;
        if (R.sealBreaks) out.innerHTML += ` <span class="seal">封印-${R.sealBreaks}</span>`;
        if (e.block > 0 && R.directDmg > 0 && after > 0) out.innerHTML += ` <span class="seal">殻${e.block}が先に受ける</span>`;
        U.bindTip(out, '<b>敵HPの予測</b><br><b>発動後</b>：このターンの剣・焔・髑髏・死神・起爆を受けた直後のHP。<br>そのあと敵の番に、<b>燃焼 → 敵の行動</b>（攻撃・回復・殻）の順で進む。変わるときは下の行に出る。');
        if (!fin || after <= 0) el.appendChild(out);
        // 四本の糸: the string this hit leaves (or snaps); a lift cut already said so above
        if (fin && after > 0 && !R.cut) {
          const S = ED.strings[Math.min(ED.strings.length - 1, (e.phase || 1) - 1)];
          if (after <= mark) el.appendChild(U.el('div', 'fc-in fc-thread', `<b class="three">${S.name}が切れる</b>（次の糸へ）`));
          else el.appendChild(U.el('div', 'fc-in fc-thread', `${S.name} あと ${e.hp - mark} → <b>${after - mark}</b>`));
        }
        // what the enemy's own turn then does to that number (only when it changes it)
        if (exact && after > 0 && !(fin && !T.diesBy)) {
          const why = [];
          if (T.burnTick) why.push(`燃焼 −${T.burnTick}`);
          if (T.healed) why.push(`回復 +${T.healed}`);
          if (T.thornsBack) why.push(`棘 −${T.thornsBack}`);
          if (T.diesBy === 'burn') el.appendChild(U.el('div', 'fc-in fc-after', '敵の番の初めに、<b class="kill">燃焼で倒れる</b>'));
          else if (T.diesBy) el.appendChild(U.el('div', 'fc-in fc-after', `敵の番に<b class="kill">倒れる</b>（${why.join('・') || '返したダメージ'}）`));
          else if (T.enemyAfter && T.enemyAfter.hp !== after) el.appendChild(U.el('div', 'fc-in fc-after', `敵の番の後 <b>${T.enemyAfter.hp}</b>（${why.join('・')}）`));
        }
        // 灰鐘の番人's 構え: does this line break the shell (and the stance)?
        const brk = SD.UI.breaksStance(run) && e.intent && e.intent.k === 'charge' && after > 0;
        if (brk && R.staggerBreak) el.appendChild(U.el('div', 'fc-in', `<b class="safe">殻${e.block ? e.block + 'を' : 'なし。直撃で'}割り切る → 構えが崩れ、${e.intent.nextLabel || '強撃'}は台本から消える</b>`));
        else if (brk && !R.staggerWard) el.appendChild(U.el('div', 'fc-in', `殻をあと <b>${R.shellNeed}</b> で割り切れる（盾2つでも崩れる）`));
        if (SD.Data.ENEMIES[e.id] && SD.Data.ENEMIES[e.id].mirror && !label && run.phase === 'spun') {
          const nx = this.band && this.band.cells.find((c) => c.role === 'next');
          const sym = nx && !nx.cond && !nx.unknown && nx.it.now && nx.it.now.sym;
          el.appendChild(U.el('div', 'fc-in', sym ? `次の封じ：<b>${SD.Data.SYMBOLS[sym].name}</b>（この列で発動した場合）` : '次の封じ：？（連鎖しだいで変わる）'));
        }
        const it = (fin && label && this.hoverPrev && this.hoverPrev.intent) || e.intent;
        // a trine that waits: say why, once the player can plan around it (the final boss: the send line says it already)
        let why = this.state === 'decision' && !label ? run.comboPauseReason() : null;
        if (fin && why === 'script') why = null;
        if (this.state === 'decision' && !label && run.canAdvance() && !snaps) {
          // the exact cell a send makes "now" (it can differ from the band's 次 when this resolve changes the boss's act)
          const PA = run.previewAdvance();
          if (PA) {
            const AI = SD.UI.cellInfo(run, { it: PA.intent, dmg: PA.unknown ? null : run.cellDamage(PA.intent) });
            const mk = PA.intent.now && PA.intent.now.k === 'mark' ? SD.Data.SYMBOLS[PA.intent.now.sym].name + '封じ・' : '';
            el.appendChild(U.el('div', 'fc-in', `台本送り → ${PA.unknown ? '？（サイコロ次第）' : mk + AI.label + (AI.value != null ? ' ' + AI.value : '')} <kbd>S</kbd>`));
          }
        } else if (this.state === 'decision' && !label && run.fight && run.fight.advanced && !why && !run.needsDecision()) {
          el.appendChild(U.el('div', 'fc-pause', '台本を送ったターンは、発動で確定 <kbd>Space</kbd>'));
        }
        if (why) {
          const txt = { overheal: '回復が溢れる三連。別の目にするか、このまま発動', idleWard: '受ける攻撃のない盾の三連。蓄えか、別の目か', script: '台本を送ってから発動することもできる', plan: '留め・継ぎ留めを決めてから発動できる' }[why];
          el.appendChild(U.el('div', 'fc-pause', txt + ' <kbd>Space</kbd>'));
        }
        if (after > 0 && T && !T.random && T.hits) {
          // exact: resolve-now outcome, including a debt to the Ashwheel and what blocks are left after reflection
          const main = T.hits.filter((h) => !h.debt), debt = T.hits.filter((h) => h.debt);
          const sum = (a, k) => a.reduce((s2, h) => s2 + h[k], 0);
          if (T.reflect) el.appendChild(U.el('div', 'fc-in', `反射 ${T.reflect.amount}${T.reflect.blocked ? '（盾で ' + T.reflect.blocked + '）' : ''}`));
          else if (R.reflectIn) el.appendChild(U.el('div', 'fc-in', `反射 ${R.reflectIn}`));
          if (T.debt) {
            const DI = SD.UI.cellInfo(run, { it: T.debt, dmg: null });
            el.appendChild(U.el('div', 'fc-in', `<b class="debt">借りの一手</b>：${DI.label}${T.debt.k === 'guard' || T.debt.k === 'heal' || T.debt.k === 'hex' ? ' ' + T.debt.v : ''} もこのターンに`));
          }
          if (main.length || debt.length) {
            const dmg = sum(main, 'dmg') + sum(debt, 'dmg') + (T.reflectTaken || 0);
            const lethal = T.partyDies || T.secondWind;
            const back = sum(main, 'back') + sum(debt, 'back');
            el.appendChild(U.el('div', 'fc-in', `予告 ${sum(main, 'raw')}${debt.length ? ` <b class="debt">＋借り ${sum(debt, 'raw')}</b>` : ''} − 盾 ${sum(main, 'blocked') + sum(debt, 'blocked')} → <b class="${lethal ? 'hurt lethal' : dmg ? 'hurt' : 'safe'}">${lethal ? '致命' : '被ダメ ' + dmg}</b>${back ? ` <b class="back">返す ${back}</b>` : ''}`));
          } else if (it && it.k === 'charge' && !snaps && !(fin && run.liftOf(it))) {
            if (SD.UI.breaksStance(run)) { if (R.staggerWard) el.appendChild(U.el('div', 'fc-in', `<b class="safe">盾2つで構えが崩れる（${it.nextLabel || '強撃'}は台本から消える）</b>`)); }
            else el.appendChild(U.el('div', 'fc-in', R.stagger ? '<b class="safe">強撃を阻止できる（台本から消える）</b>' : '次は強撃。盾2つで怯ませられる'));
          } else if (T.partyDies) el.appendChild(U.el('div', 'fc-in', '<b class="hurt lethal">致命</b>'));
        } else if (it && after > 0) {
          if (run.fight && run.fight.debt) el.appendChild(U.el('div', 'fc-in', '<b class="debt">借りの一手</b>：中身はサイコロ次第（このターンに行われる）'));
          const inc = run.intentDamage(it);
          if ((it.k === 'attack' || it.k === 'doom' || it.k === 'jam') && inc > 0) {
            let blk = run.block + R.block;
            const ra = Math.min(blk, R.reflectIn || 0);
            blk -= ra;
            const refl = (R.reflectIn || 0) - ra;
            const taken = (R.guardian ? 0 : Math.max(0, inc - blk)) + refl;
            if (R.reflectIn) el.appendChild(U.el('div', 'fc-in', `反射 ${R.reflectIn}${ra ? '（盾で ' + ra + '）' : ''}`));
            el.appendChild(U.el('div', 'fc-in', `予告 ${inc} − 盾 ${blk} → <b class="${taken ? 'hurt' : 'safe'}">被ダメ ${taken}</b>`));
          } else if (it.k === 'charge' && !snaps && !(fin && run.liftOf(it))) {
            if (SD.UI.breaksStance(run)) { if (R.staggerWard) el.appendChild(U.el('div', 'fc-in', `<b class="safe">盾2つで構えが崩れる（${it.nextLabel || '強撃'}を阻止できる）</b>`)); }
            else el.appendChild(U.el('div', 'fc-in', R.stagger ? '<b class="safe">強撃を阻止できる</b>' : '次は強撃。盾2つで怯ませられる'));
          }
        }
      }
      this.refreshHelp();
    }

    respinOdds() {
      const run = this.run;
      if (!run.reels.some((r) => !r.held && !r.jam)) return null;
      // exact, judged as the resolve judges (wilds / 封じ / 絆): Run.respinOdds()
      const { trine, bond } = run.respinOdds();
      const held = run.reels.filter((r) => r.held).length;
      let s = `再演すると 三連 <b>${SD.UI.pct(trine)}</b>`;
      if (run.mods.bond) s += ` ／ 絆 <b>${SD.UI.pct(bond)}</b>`;
      if (!held && !this.dom.right.classList.contains('dense')) s += '<br><small>発動列のマスで留められる</small>';
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
      // 灰輪の台本
      const f = run.fight;
      const showAdv = !!run.mods.script;
      const showBor = !!run.mods.borrow && !!f && (run.sparks === 0 || f.borrowUsed);
      d.srow.style.display = showAdv || showBor ? '' : 'none';
      // many verbs lit: a tighter panel so everything stays on the stage
      d.right.classList.toggle('dense', showAdv || showBor);
      d.advance.style.display = showAdv ? '' : 'none';
      d.borrow.style.display = showBor ? '' : 'none';
      if (showAdv) {
        const blk = run.phase === 'spun' ? run.advanceBlock() : 'none';
        d.advance.disabled = !(st === 'decision' && blk === null);
        d.advance.innerHTML = `台本送り <small>${blk === 'locked' ? (run.enemy && run.enemy.intent && run.enemy.intent.k === 'doom' ? '灰燼は送れない' : '強撃は送れない') : blk === 'used' ? '済' : run.borrowedSparks() ? '借り火' : '火種1'}</small> <kbd>S</kbd>`;
        d.advance.title = blk === 'locked' ? '溜め終えた一撃（強撃・灰燼）は台本から外せない' : blk === 'used' ? '台本送りは1ターン1回' : blk === 'spark' ? '火種が足りない' : '今の予告を飛ばし、次の行動を今にする（火種1）';
      }
      if (showBor) {
        d.borrow.disabled = !(st === 'decision' && run.canBorrow());
        d.borrow.innerHTML = f.borrowUsed ? (f.borrowed ? '借りた火種' : '借り済み') : '灰輪に借りる';
        d.borrow.classList.toggle('on', !!f.borrowed);
        d.borrow.title = '[B] 1戦1回、火種0のとき：このターンだけ使える火種を1つ借りる。代わりに灰輪は台本の次の行動もこのターンに行う';
      }
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
          const k = SD.Data.ZONES[z].deep ? 0 : Math.max(0, d.floor - SD.Data.ZONES[z].floors[0]);
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
    // 灰輪の主 beaten after a clear: the win is written to the profile now (once); then 帰還 / さらに降りる
    onBossSettled(summary) {
      const G = SD.Game, p = this.profile;
      this.settledPrev = { best: p.stats.bestFloor, last: p.stats.lastFloor, bossBest: p.stats.bossBestHpPct, embers: p.embers };
      this.settledRes = SD.Meta.applyRunResult(p, summary);
      G.save();
      this.showDescentChoice();
    }
    showDescentChoice() {
      const U = UI();
      this.state = 'modal';
      if (this.dom.right) this.dom.right.style.visibility = 'hidden';
      this.renderLeft();
      this.refreshButtons();
      const m = this.dom.modal;
      m.innerHTML = ''; m.classList.add('show');
      const box = U.el('div', 'event-box descent-box');
      box.appendChild(U.el('div', 'event-glyph', '灰'));
      box.appendChild(U.el('div', 'event-name', '灰輪の主を討った'));
      box.appendChild(U.el('div', 'event-text', '勝利は確定した（記録と残り火は保存済み）。<br>灰輪の下に、まだ<b>灰の底</b>が続いている。'));
      const opts = U.el('div', 'event-opts');
      const go = (down) => { if (this.run.phase !== 'descent') return; const evs = this.run.chooseDescent(down); this.closeModal(); this.play(evs); };
      opts.appendChild(U.button('さらに降りる<small>灰の底 B13〜B16。重ね殻と返し鏡に必ず出会う。倒れても勝利は失わない</small>', 'event-opt', () => go(true)));
      opts.appendChild(U.button('帰還する<small>ここで降下を終える</small>', 'event-opt', () => go(false)));
      box.appendChild(opts);
      m.appendChild(box);
    }

    // 灰鐘の番人 beaten with B17 open: the 灰の底 result is written to the profile now (once); then 帰還 / 最深の間へ
    onDeepSettled(summary, firstOpen) {
      const G = SD.Game, p = this.profile;
      this.settledDeepRes = summary.deepOnly ? SD.Meta.applyDeepResult(p, summary) : Object.assign({}, this.settledRes || {}, SD.Meta.applyDeepResult(p, summary));
      this.deepSettled = true;
      if (firstOpen) p.seen.b17Notice = true; // (B17 opened with this very kill: this choice is its notice)
      G.save();
      const U = UI();
      this.state = 'modal';
      if (this.dom.right) this.dom.right.style.visibility = 'hidden';
      this.renderLeft();
      this.refreshButtons();
      const m = this.dom.modal;
      m.innerHTML = ''; m.classList.add('show');
      const box = U.el('div', 'event-box descent-box final');
      box.appendChild(U.el('div', 'event-glyph', '糸'));
      box.appendChild(U.el('div', 'event-name', `${SD.UI.deepEliteName()}を討った`));
      box.appendChild(U.el('div', 'event-text', (firstOpen ? '<b>――最深の間への道が開かれた。</b><br>' : '') + '灰の底の踏破は記録した（残り火も保存済み）。<br>その下に、<b>最深の間</b>がある。'));
      const opts = U.el('div', 'event-opts');
      const go = (down) => { if (this.run.phase !== 'finalChoice') return; const evs = this.run.chooseFinal(down); this.closeModal(); this.play(evs); };
      opts.appendChild(U.button('最深の間へ降りる<small>B17 深淵の繰り手。焚き火で休んでから挑む。倒れても、ここまでの記録は失わない</small>', 'event-opt', () => go(true)));
      opts.appendChild(U.button('帰還する<small>ここで降下を終える</small>', 'event-opt', () => go(false)));
      box.appendChild(opts);
      m.appendChild(box);
    }

    onRunEnd(summary) {
      const G = SD.Game, p = this.profile;
      const settled = !!summary.settled;
      const prev = settled && this.settledPrev ? this.settledPrev : { best: p.stats.bestFloor, last: p.stats.lastFloor, bossBest: p.stats.bossBestHpPct, embers: p.embers };
      const prevBestVs = (p.stats.bestVs || {})[summary.killer ? summary.killer.id : ''];
      // a settled win was applied at the boss: 帰還 adds nothing, a descent adds only what it gained
      let res;
      // 最深の間: only the B17 part is new (what came before it was written when it was settled)
      if (summary.final) res = Object.assign({}, summary.finalOnly ? {} : this.settledDeepRes || {}, SD.Meta.applyFinalResult(p, summary, new Date().toISOString().slice(0, 10)));
      else if (this.deepSettled) res = this.settledDeepRes || {}; // (帰還 after the 灰の底 was settled: nothing more)
      else if (summary.deepOnly) res = SD.Meta.applyDeepResult(p, summary); // 灰の底から: the main-game record is untouched
      else if (!settled) res = SD.Meta.applyRunResult(p, summary);
      else if (summary.deep) res = Object.assign({}, this.settledRes || {}, SD.Meta.applyDeepResult(p, summary));
      else res = this.settledRes || {};
      G.save();
      this.state = 'end';
      this.refreshButtons();
      this.scene.curtainTarget = 1;
      this.fadePanels();
      if (summary.final && summary.final.won) {
        // 終の巻: the long one the first time, scenes 2-5 after that; the result comes after it
        const short = !!p.seen.epilogue;
        p.seen.epilogue = true; G.save();
        setTimeout(() => this.playScroll('epilogue', { short, records: SD.Scroll.colophon(p) }, () => this.showEndPanel(summary, res, prev, prevBestVs)), 600);
        return;
      }
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
      add('secondwind', s.heavyTaken >= 10 ? 1 : 0, 6, `溜めた一撃（強撃など）で受けた傷: <b>${s.heavyTaken}</b>`);
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
      add('guardian', s.heavyTaken >= 15 ? 1 : 0, 8, `溜めた一撃（強撃など）で受けた傷: <b>${s.heavyTaken}</b>。最大の一撃を跳ね返せたら…`);
      add('bulwark', s.heavyTaken >= 12 ? 1 : 0, 5, `溜めた一撃（強撃など）で受けた傷: <b>${s.heavyTaken}</b>。盾を前のターンから積めたら…`);
      add('longpush', s.markHits, 2, `封じられた目を <b>${s.markHits}</b> 回出してしまった。2つ先まで届けば…`);
      add('deft', s.zeroSpark >= 4 ? s.zeroSpark : 0, 1.2, `火種が尽きていたターン: <b>${s.zeroSpark}</b>`);
      add('keeper', k && k.boss ? 1 : 0, 3, '灰輪の主の前で、灯が持ちこたえられなかった');
      // 灰輪の台本
      add('borrow', (s.lockedTurns || 0) >= 2 || (summary.sparksLeft === 0 && s.zeroSpark >= 3) ? Math.max(s.lockedTurns || 0, s.zeroSpark) : 0, 1.5,
        `火種が尽き、回すしかなかったターン: <b>${Math.max(s.lockedTurns || 0, s.zeroSpark)}</b>。灰輪に一手を借りられたら…`);
      if ((s.enemyHealed || 0) >= 15) add('hyoshigi', Math.round(s.enemyHealed / 5), 1, `敵に取り戻されたHP: <b>${s.enemyHealed}</b>。台本の「蘇生」を飛ばせたら…`);
      else if (s.heavyTaken >= 12) add('hyoshigi', Math.round(s.heavyTaken / 6), 1, `溜めた一撃（強撃など）で受けた傷: <b>${s.heavyTaken}</b>。強撃が来る時を、自分で選べたら…`);
      if (k && k.boss && !k.seals) add('hyoshigi', 1, 6, '逆廻りの封じは、決まった順で巡ってくる。その順を自分で進められたら…');
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

    // a scroll over the run's screen (終の巻): the HUD steps aside; input goes to the scroll until it is done
    playScroll(kind, opts, then) {
      for (const el of [document.querySelector('.run-top'), this.dom.goal, this.dom.relics]) if (el) el.style.display = 'none';
      this.scroll = SD.Scroll.create(kind, Object.assign({}, opts, { onDone: () => { this.scroll = null; then(); } }));
      this.scroll.mount(UI().root());
    }

    // the curtain comes down over the stage: the side panels go with it (not after it)
    fadePanels() {
      for (const el of [this.dom.left, this.dom.right]) {
        if (!el) continue;
        el.style.transition = 'opacity 0.8s'; el.style.opacity = '0'; el.style.pointerEvents = 'none';
      }
    }

    showEndPanel(summary, res, prev, prevBestVs) {
      const U = UI(), G = SD.Game, p = this.profile;
      const m = this.dom.modal;
      m.innerHTML = ''; m.classList.add('show', 'end');
      this.dom.left.style.display = 'none'; this.dom.right.style.display = 'none';
      const topEl = document.querySelector('.run-top'); if (topEl) topEl.style.display = 'none'; if (this.dom.goal) this.dom.goal.style.display = 'none';
      if (this.dom.relics) this.dom.relics.style.display = 'none';
      const box = U.el('div', 'end-box');
      if (summary.deepOnly) {
        // 灰の底から: its own result (not a main-game win or death)
        const d = summary.deep;
        box.appendChild(U.el('div', 'end-title' + (d.cleared ? ' win' : ''), d.cleared ? '灰の底を越えた' : `灰の底 B${d.floor} で力尽きた`));
        box.appendChild(U.el('div', 'end-sub', d.cleared ? `${SD.UI.deepEliteName()}を討った。（灰の底からの挑戦・本編の記録には付かない）` : '灰の底からの挑戦。本編の記録には付かない。'));
        if (res.firstDeepElite) box.appendChild(U.el('div', 'win-note deep', `<b>${SD.UI.deepEliteName()}を初めて討った。</b>灰の底の鐘は、もう鳴らない。`));
        const k = summary.killer;
        if (k && !d.cleared) {
          const kb = U.el('div', 'killer');
          kb.innerHTML = `<div class="k-name">${k.name}</div><div class="k-bar"><div class="k-fill" style="width:${Math.round(k.hpPct * 100)}%"></div></div><div class="k-left">残り <b>${k.hp}</b> / ${k.maxHp}</div>`;
          box.appendChild(kb);
        }
      } else if (summary.final) {
        // 深淵の繰り手: 真のクリア, or a fall at 最深の間 (what came before it stays)
        const f = summary.final, st = p.stats;
        if (f.won) {
          box.appendChild(U.el('div', 'end-title win', '深淵の繰り手を討った'));
          box.appendChild(U.el('div', 'end-sub', '糸は断たれた。運命は、三人の手に。'));
          const tree = SD.Meta.treeState(p);
          const grid = U.el('div', 'win-grid');
          const cell = (k, v) => grid.appendChild(U.el('div', 'win-cell', `<span>${k}</span><b>${v}</b>`));
          cell('真のクリア', `${st.finalClears} 回目`);
          cell('この戦い', `${f.turns} ターン`);
          cell('最少', `${st.finalBestTurns} ターン`);
          cell('灯した灯紋', `${tree.lit} / ${tree.all}`);
          box.appendChild(grid);
          if (res.firstTrueClear) box.appendChild(U.el('div', 'win-note final', '<b>真のクリア。</b>灯輪は、もう誰の糸にも繋がれていない。'));
        } else {
          box.appendChild(U.el('div', 'end-title', '最深の間で灯が消えた'));
          box.appendChild(U.el('div', 'end-sub', summary.finalOnly ? '最深の間からの挑戦。ほかの記録には付かない。' : '灰の底までの記録は、そのまま残る。'));
          const k = summary.killer;
          if (k) {
            const kb = U.el('div', 'killer');
            kb.innerHTML = `<div class="k-name">${k.name}</div><div class="k-bar"><div class="k-fill" style="width:${Math.round(k.hpPct * 100)}%"></div></div><div class="k-left">残り <b>${k.hp}</b> / ${k.maxHp}</div>`;
            box.appendChild(kb);
          }
        }
      } else if (summary.won) {
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
        if (summary.deep) box.appendChild(U.el('div', 'win-note deep', summary.deep.cleared ? `<b>灰の底を越えた。</b>${SD.UI.deepEliteName()}を討った。${res.firstDeepElite ? '灰の底の鐘は、もう鳴らない。' : ''}` : `<b>灰の底 B${summary.deep.floor} で力尽きた。</b>灰輪の主を討った勝利は、そのまま残る。`));
        else if (st.bossKills <= 1) box.appendChild(U.el('div', 'win-note', '最初は祈るだけだった灯輪を、三人はいま自分の手で廻している。<br>灯紋はまだ残っている――別の道で、もう一度深淵へ。'));
        if (!summary.settled && st.wins === 1) box.appendChild(U.el('div', 'win-note deep', '<b>灰の底が開いた。</b>次の挑戦から、灰輪の主を倒した先へ降りられる。<br>近道「第三層から（B9）」も開いた。'));
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
      if (summary.deepOnly || summary.finalOnly) { /* 灰の底 / 最深の間 only: no main-game depth chip */ }
      else if (res.newBestFloor) rec.appendChild(U.el('span', 'chip new', `最深記録 B${summary.floor}`));
      else rec.appendChild(U.el('span', 'chip', `最深 B${p.stats.bestFloor}`));
      if (res.firstDeepRun) rec.appendChild(U.el('span', 'chip new', '近道「灰の底から」が開いた'));
      if (res.newBossRecord) rec.appendChild(U.el('span', 'chip new', 'ボス最高記録'));
      if (res.firstHound) rec.appendChild(U.el('span', 'chip new', '第二層への近道が開いた'));
      if (res.firstAbbot) rec.appendChild(U.el('span', 'chip new', '近道で選べる遺物 +1'));
      if (res.newDeepBest) rec.appendChild(U.el('span', 'chip new', `灰の底 最深 B${summary.floor}`));
      if (res.firstDeepClear) rec.appendChild(U.el('span', 'chip new', '灰の底 初踏破'));
      if (res.firstDeepElite) rec.appendChild(U.el('span', 'chip new', `${SD.UI.deepEliteName()} 初撃破`));
      if (res.firstTrueClear) rec.appendChild(U.el('span', 'chip new final', '真のクリア'));
      else if (res.newBestTurns) rec.appendChild(U.el('span', 'chip new', `最少 ${summary.final.turns} ターン`));
      if (!summary.deep && summary.floor > prev.last && prev.last > 0) rec.appendChild(U.el('span', 'chip up', `前回より ${summary.floor - prev.last} 階深く`));
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
      // whisper + node — only after a fall (a 灰の底-only run is never a "win", but clearing B16 is not a fall either)
      const fell = !summary.won && !(summary.deep && summary.deep.cleared);
      let primaryAction = null;
      if (fell) {
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
      // The buttons, the same shape after every fall: [灯して再挑戦 (when the whispered node can be lit)] [灯紋の輪へ]
      // [すぐ再挑戦 (small: the same start, nothing lit)]. A 灰の底 result without that offer leads with 灰の底から再挑戦
      // (a brand-new run: nothing carried over, the B13 kit chosen again).
      if (G.testMode) {
        const tb = U.el('div', 'end-btns');
        const go = (act) => () => { location.search = `?test=b17${act > 1 ? '&act=' + act : ''}${G.testOpts && G.testOpts.pick ? '&pick=1' : ''}`; };
        const again = U.button('もう一度（同じ条件） <kbd>Space</kbd>', 'primary big', () => location.reload(), { silent: true });
        tb.appendChild(again);
        tb.appendChild(U.button('最初から', 'mini', go(1)));
        tb.appendChild(U.button('面の段から', 'mini', go(2)));
        tb.appendChild(U.button('祈りの段から', 'mini', go(3)));
        tb.appendChild(U.button('終幕の段から', 'mini', go(4)));
        box.appendChild(tb);
        m.appendChild(box);
        this.endPrimary = again;
        this.endInputLock = performance.now() + 1000;
        return;
      }
      const btns = U.el('div', 'end-btns');
      const deepRetry = !!summary.deep && SD.Meta.computeMods(p).shortcuts.indexOf(13) >= 0;
      const finalRetry = !!summary.final && SD.Meta.computeMods(p).shortcuts.indexOf(17) >= 0;
      let lead = null;
      if (finalRetry && !summary.final.won) lead = U.button('最深の間から再挑戦 <small>B17・新しい支度から</small>', 'primary big', () => G.setScreen(new RunScreen({ startFloor: 17 })), { silent: true });
      else if (primaryAction) lead = U.button(primaryAction.label + ' <kbd>Space</kbd>', 'primary big', primaryAction.fn, { silent: true });
      else if (deepRetry) lead = U.button('灰の底から再挑戦 <small>B13・新しい支度から</small>', 'primary big', () => G.setScreen(new RunScreen({ startFloor: 13 })), { silent: true });
      const camp = U.button('灯紋の輪へ', lead ? 'secondary' : 'primary big', () => G.setScreen(new CampScreen()));
      if (lead) btns.appendChild(lead);
      btns.appendChild(camp);
      this.endPrimary = lead || camp;
      // a 灰の底-only fall that already leads with 灰の底から再挑戦 needs no second retry button
      if (finalRetry && summary.final.won) btns.appendChild(U.button('もう一度 最深の間へ', 'mini', () => G.setScreen(new RunScreen({ startFloor: 17 }))));
      if (fell && !summary.final && (primaryAction || !summary.deepOnly)) {
        const sf = this.defaultStart();
        btns.appendChild(U.button(summary.deepOnly ? `すぐ再挑戦（B${sf}から）` : 'すぐ再挑戦', 'mini', () => G.setScreen(new RunScreen({ startFloor: sf }))));
      }
      box.appendChild(btns);
      m.appendChild(box);
      this.endInputLock = performance.now() + 1000;
    }

    // Retry: a run started at 第三層から / 灰の底から starts there again; otherwise the deepest pre-clear shortcut (as before).
    defaultStart() {
      const mods = SD.Meta.computeMods(this.profile);
      const sf = this.run && this.run.startFloor, sc = SD.Data.SHORTCUTS[sf];
      if (sc && sc.postClear && mods.shortcuts.indexOf(sf) >= 0) return sf;
      const pre = mods.shortcuts.filter((f) => !SD.Data.SHORTCUTS[f].postClear);
      return pre.length ? Math.max(...pre) : 1;
    }

    // ------------------------------------------------------------------ input
    onKey(e) {
      if (this.scroll) { if (e.code === 'Escape') this.scroll.finish(); else this.scroll.input(); return; }
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
      if (e.code === 'KeyS') this.doAdvance();
      if (e.code === 'KeyB') this.doBorrow();
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
        borrowed: this.V.borrowed || 0,
        pendingCost: dec ? this.pendingCost() : 0,
        marked: run.enemy && run.enemy.now && run.enemy.now.k === 'mark' ? run.enemy.now.sym : null,
        forecast: this.fc,
        comboCells: this.comboCells,
        leverActive: this.state === 'idle' || this.state === 'decision',
        runes: Math.min(12, Object.keys(this.profile.unlocked).length - 1),
        boss: run.enemy && run.enemy.boss,
        ...this.liftState(dec),
      };
    }
    // 四本の糸: the heroes the current cell lifts (until their string snaps this turn), the nudges that would make the combo
    // that snaps it, and whether this line does
    liftState(dec) {
      const run = this.run, e = run.enemy;
      const lift = e && e.hp > 0 && this.intent ? this.intent.lift : null;
      if (!lift) return { lift: [] };
      const out = { lift: this.liftFree ? [] : lift.hero === 'all' ? ['priest', 'witch', 'knight'] : [lift.hero] };
      if (run.phase !== 'spun' || this.reels.busy() || this.liftFree) return out;
      out.cutNow = !!run.forecast().cut;
      if (!out.cutNow) {
        out.cutMiss = [];
        for (let i = 0; i < run.reels.length; i++) for (const dir of [-1, 1]) {
          if (dec ? !run.canNudge(i, dir) : (run.reels[i].jam || run.reels[i].held)) continue;
          const cells = run.paylineCells(); cells[i] = run.cellAt(i, dir);
          if (run.evaluate(cells).cut) out.cutMiss.push({ reel: i, dir });
        }
      }
      return out;
    }

    // how many sparks the hovered action would burn (the candles flicker)
    pendingCost() {
      const run = this.run, h = this.reels.hover;
      if (this.btnHover === 'respin') return run.respinCost() === 'spark' ? 1 : 0;
      if (this.btnHover === 'echo' || (this.mode && this.mode.kind === 'echo')) return 1;
      if (this.btnHover === 'key' || (this.mode && this.mode.kind === 'key')) return 1;
      if (this.btnHover === 'advance') return run.canAdvance() ? 1 : 0;
      if (h && h.kind === 'cell' && h.row !== 0 && run.canNudge(h.reel, h.row)) return run.nudgeCost() === 'spark' ? 1 : 0;
      if (h && h.kind === 'ribbon' && this.ribbonAction(h.reel, h.index)) return run.nudgeCost() === 'spark' ? 1 : 0;
      return 0;
    }

    predictedLoss() {
      const run = this.run, e = run.enemy;
      if (!e || !e.intent || !(this.state === 'idle' || this.state === 'decision' || this.state === 'auto')) return 0;
      const T = this.hoverPrev ? this.hoverPrev.turn : this.turnPrev;
      if (run.phase === 'spun' && T && !T.random) return T.partyDies || T.secondWind ? Math.max(T.damage, run.hp) : T.damage;
      const it = (SD.UI.isFinal(run) && this.hoverPrev && this.hoverPrev.intent) || e.intent;
      if (!(it.k === 'attack' || it.k === 'doom' || it.k === 'jam')) return 0;
      const R = this.hoverPreview || this.fc;
      let blk = run.block + (R ? R.block : 0);
      let refl = R ? R.reflectIn || 0 : 0;
      const ra = Math.min(blk, refl); blk -= ra; refl -= ra;
      if (R && R.totalDmg >= e.hp + (e.block || 0)) return 0; // the enemy falls first
      const self = R ? R.selfDmg : 0;
      return (R && R.guardian ? 0 : Math.max(0, run.intentDamage(it) - blk)) + refl + self;
    }

    // A manipulation being hovered: forecast + exact turn outcome + the script band that would follow.
    hoverManip(act, label) {
      const run = this.run;
      const P = act ? run.previewAfter(act) : null;
      if (!P) { this.hoverPreview = null; this.hoverPrev = null; this.renderLeft(run.forecast()); return; }
      this.hoverPreview = P.R;
      this.hoverPrev = { R: P.R, turn: P.turn, band: SD.UI.bandVisible(run) ? P.band : null, caption: null, fires: P.fires };
      this.renderLeft(P.R, label, P.turn);
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
      // the script band's cells
      const bandHit = (this.scene.bandRects || []).find((r) => x >= r.x - 3 && x <= r.x + r.w + 3 && y >= r.y - 3 && y <= r.y + r.h + 3);
      if (bandHit && this.run.enemy) {
        SD.UI.showTip(SD.UI.cellExplain(this.run, bandHit.cell), x, y);
        this._tipOn = true;
        this._bandTip = true;
      } else if (this._bandTip) { SD.UI.hideTip(); this._bandTip = false; this._tipOn = false; }
      // enemy / intent tooltip
      const en = this.scene.enemy, re = this.run.enemy;
      let onEnemy = false;
      if (en && re && y < 440 && !bandHit) {
        const info = en.info(), w = info.width || 120;
        const top = en.y + (info.head ? info.head[1] : -info.height) - 80;
        onEnemy = x > en.x - w / 2 - 40 && x < en.x + w / 2 + 90 && y > top && y < en.y + 40;
        if (onEnemy) {
          SD.UI.showTip(`<b>${re.name}</b>　HP ${re.hp}/${re.maxHp}${re.armor ? '　鎧 ' + re.armor : ''}${re.burn ? '　燃焼 ' + re.burn : ''}`
            + `<br><span style="color:#b9ad95">${re.tip || ''}</span><br>${SD.UI.intentExplain(this.run, re.intent)}`, x, y);
        }
      }
      if (!onEnemy && this._tipOn && !bandHit) SD.UI.hideTip();
      this._tipOn = onEnemy || !!bandHit;
      const h = this.reels.hit(x, y);
      const prev = this.reels.hover;
      this.reels.hover = h;
      let cursor = 'default';
      if (h && h.kind === 'lever' && (this.state === 'idle' || this.state === 'decision')) cursor = 'pointer';
      if (this.state === 'decision' && h) {
        const run = this.run;
        let preview = null;
        const changed = JSON.stringify(prev) !== JSON.stringify(h);
        let act = null, lbl = 'ずらすと…';
        if (h.kind === 'cell' && h.row !== 0 && !this.mode && run.canNudge(h.reel, h.row)) {
          cursor = 'pointer';
          act = (c) => c.nudge(h.reel, h.row);
        } else if (h.kind === 'cell' && h.row === 0) {
          if (this.mode || run.canHold(h.reel) || run.canBless(h.reel)) cursor = 'pointer';
          if (this.mode && this.mode.kind === 'echo' && this.mode.src != null && run.canEcho(this.mode.src, h.reel)) {
            const src = this.mode.src; act = (c) => c.echo(src, h.reel); lbl = '写すと…';
          }
        } else if (h.kind === 'ribbon') {
          const ra = this.ribbonAction(h.reel, h.index);
          if (ra) {
            cursor = 'pointer';
            act = ra.kind === 'key' ? (c) => c.fateKey(h.reel, h.index) : (c) => c.nudge(h.reel, ra.dir);
            if (ra.kind === 'key') lbl = '鍵で…';
          }
        }
        if (changed) this.hoverManip(act, lbl);
      } else if ((this.hoverPreview || (this.hoverPrev && !this.btnHover)) && this.state === 'decision') {
        this.hoverPreview = null; this.hoverPrev = null; this.renderLeft(this.run.forecast());
      }
      SD.Game.canvas.style.cursor = cursor;
    }

    onMouseDown(x, y) {
      if (this.scroll) { this.scroll.input(); return; }
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
            this.hoverManip(kind === 'key' ? (cc) => cc.fateKey(reel, idx) : (cc) => cc.nudge(reel, off), kind === 'key' ? '鍵で…' : 'ずらすと…');
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
    closePicker() { if (this.picker) { this.picker.remove(); this.picker = null; this.hoverPreview = null; this.hoverPrev = null; } }

    // ------------------------------------------------------------------ loop
    update(dt) {
      if (this.scroll) this.scroll.update(dt);
      this.scene.update(dt);
      this.reels.update(dt);
      this.joy = Math.max(0, (this.joy || 0) - dt * 1.3);
      this.bandSlide = Math.max(0, (this.bandSlide || 0) - dt * 4.5);
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
      this.scene.drawStage(ctx, { lift: st.lift });
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
      const hp = this.hoverPrev && this.hoverPrev.band ? this.hoverPrev : null;
      this.scene.drawHud(ctx, { V: this.V, showPartyBar: true, showEnemyBar: !!this.scene.enemy && !!this.V.enemy, ghostPct,
        intent: hp && hp.intentI ? Object.assign({}, hp.intentI, { born: null }) : this.intent,
        band: hp ? hp.band : this.band, bandCaption: hp ? hp.caption : null, bandSlide: this.bandSlide, run: this.run, script: !!this.run.mods.script,
        hudRects: () => this.hudRects(), intentBoxSink: (b) => { this.intentBox = b; } }); // (QA-001: keep the plaque clear of the HUD)
      // device band background
      SD.StageDraw.drawApron(ctx, this.scene.time);
      this.reels.draw(ctx, st);
      ctx.restore();
      SD.FX.draw(ctx);
      this.scene.drawZoneTitle(ctx);
      SD.FX.drawOverlay(ctx, 1280, 720);
      SD.StageDraw.drawCurtain(ctx, this.scene.curtain, this.scene.time);
      if (this.scroll) this.scroll.render(ctx); // (終の巻, over everything)
    }
  }

  SD.Screens = { TitleScreen, CampScreen, RunScreen };
})();
