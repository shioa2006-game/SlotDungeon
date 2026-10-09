/* EMBERWHEEL — Director: turns engine events into a timed, juicy performance on the stage. */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  const COMBO_NAMES = { trine: '三連', quad: '四連', bond: '絆の陣', reaper: '死神' };
  const SYM_HERO = { blade: 'knight', ward: 'knight', flame: 'witch', heart: 'priest' };

  class Director {
    constructor(rs) {
      this.rs = rs;        // run screen
      this.busy = false;
      this.skip = false;
      this.epoch = 0;
    }

    // stop any in-flight performance (used when a run is abandoned mid-animation)
    abort() { this.epoch++; this.busy = false; this.skip = false; }

    wait(sec) { return SD.Game.wait(sec * (this.skip ? 0.25 : 1)); }

    async play(events) {
      this.busy = true;
      const ep = this.epoch;
      try {
        for (const ev of events) {
          if (ep !== this.epoch) return;
          const h = this['on_' + ev.t];
          if (h) await h.call(this, ev);
        }
      } catch (err) {
        console.error('Director error', err);
      }
      this.busy = false;
      this.skip = false;
      this.epoch = 0;
    }

    // stop any in-flight performance (used when a run is abandoned mid-animation)
    abort() { this.epoch++; this.busy = false; this.skip = false; }

    // ---------------------------------------------------------------- helpers
    heroAt(id) { return this.rs.scene.heroes[id]; }
    enemyFx() {
      const e = this.rs.scene.enemy; if (!e) return { x: 930, y: 300 };
      const info = e.info(); const fx = info.fx || [0, -info.height / 2];
      return { x: e.x + fx[0], y: e.y + fx[1] };
    }
    heroFx(id) {
      const h = this.heroAt(id); const info = h.info(); const fx = info.fx || [20, -60];
      return { x: h.x + fx[0], y: h.y + fx[1] };
    }
    partyCenter() { return { x: 290, y: 300 }; }
    sfx(n, o) { if (SD.Audio) SD.Audio.play(n, o); }
    V() { return this.rs.V; }
    dmgEnemy(hp, amount, opts = {}) {
      const V = this.V(), FX = SD.FX;
      V.enemy.hp = hp;
      const p = this.enemyFx();
      const e = this.rs.scene.enemy;
      if (e && amount > 0) { e.flash = 1; e.play('hit', 0.35); }
      if (amount > 0) {
        FX.text(p.x + (Math.random() * 40 - 20), p.y - 30, amount, { color: opts.color || '#ffffff', size: opts.big ? 54 : 36, sub: opts.sub });
        FX.burst(p.x, p.y, opts.big ? 26 : 12, { color: opts.parts || ['#ffd257', '#ff8a3d', '#ffffff'], speed: opts.big ? 420 : 260 });
        if (opts.big) { FX.shake(7); FX.stop(90); } else FX.shake(2);
      } else if (opts.sub) {
        FX.text(p.x, p.y - 30, opts.zeroText || '0', { color: '#a9a9c0', size: 28, sub: opts.sub });
      }
    }

    // ---------------------------------------------------------------- run / room flow
    async on_runStart() { this.rs.scene.curtainTarget = 0; await this.wait(0.2); }
    async on_shortcut(ev) {
      if (ev.deepOnly) SD.FX.banner('灰の底から降下', { sub: '刻印と遺物を選べる・本編の記録には付かない', size: 44 });
      else if (ev.bossEmbers) SD.FX.banner(`${ev.label}降下`, { sub: `刻印と遺物を選べる・灰輪の主を倒すと残り火 +${ev.bossEmbers}`, size: 44 });
      else SD.FX.banner('第二層から降下', { sub: `刻印と遺物を選べる・最初の勝利で残り火 +${ev.embers}`, size: 44 });
      await this.wait(0.8);
    }

    async on_floor(ev) {
      const rs = this.rs;
      if (rs.scene.zone !== ev.zone && rs.run.floor > rs.run.startFloor) {
        // descend into a new layer: a short fade through darkness
        SD.FX.flash('rgba(5,3,10,1)', 1.25, 2.2, false);
        await this.wait(0.12);
      }
      rs.scene.zone = ev.zone;
      const Z = SD.Data.ZONES[ev.zone];
      rs.scene.depth = (ev.floor - Z.floors[0]) / Math.max(1, (Z.floors[1] - Z.floors[0] + 1));
      rs.updateTop();
      if (SD.Audio) SD.Audio.setMusic(Z.music);
      if (ev.newZone || ev.floor === rs.run.startFloor) {
        const layer = ev.zone === 'cellar' ? '第一層' : ev.zone === 'ossuary' ? '第二層' : ev.zone === 'gearworks' ? '第三層' : ev.zone === 'ashdeep' ? '第四層' : '最深部';
        rs.scene.title = { str: Z.name, sub: `${layer} ・ B${ev.floor}`, t: 0 };
      }
    }

    async on_door(ev) {
      const rs = this.rs;
      rs.closeModal();
      this.sfx('door');
      // walk to the next room: heroes walk, backdrop scrolls
      for (const h of rs.scene.heroList()) h.play('walk', 1.1);
      rs.scene.camTarget += 900;
      if (rs.scene.enemy) rs.scene.enemy = null;
      for (let k = 0; k < 4; k++) { this.sfx('step', { vol: 0.5 }); await this.wait(0.22); }
      await this.wait(0.1);
    }

    async on_combat(ev) {
      const rs = this.rs, V = this.V();
      const a = rs.scene.setEnemy(ev.enemy);
      V.enemy = rs.enemyView(ev.enemy);
      V.block = ev.block; V.sparks = ev.sparks;
      if (ev.hp != null) { V.hp = ev.hp; V.maxHp = ev.maxHp; }
      rs.intentNow = null;
      if (ev.enemy.boss) {
        rs.scene.bossDark = 1;
        a.alpha = 0;
        if (SD.Audio) { SD.Audio.setMusic('boss'); SD.Audio.play('boss_appear'); SD.Audio.duck(0.6, 2); }
        SD.FX.shake(6);
        for (let k = 0; k <= 20; k++) { a.alpha = k / 20; await this.wait(0.05); }
        SD.FX.banner(ev.enemy.name, { sub: '封印を三連か絆で砕け。封じたままでは灰輪が加速する', size: 60, color: '#e8d0ff', glow: 'rgba(150,90,255,0.6)', life: 2.2, y: 300 });
        await this.wait(1.4);
        rs.scene.bossDark = 0;
      } else {
        a.dx = 260; a.alpha = 0;
        for (let k = 0; k <= 12; k++) { a.dx = 260 * (1 - SD.Art.easeOut(k / 12)); a.alpha = Math.min(1, k / 8); await this.wait(0.025); }
        a.dx = 0; a.alpha = 1;
        if (ev.enemy.elite) { SD.FX.banner(ev.enemy.name, { sub: 'エリート', size: 50, life: 1.4 }); if (SD.Audio) SD.Audio.play('windup'); await this.wait(0.6); }
        if (ev.enemy.dread) { SD.FX.banner(ev.enemy.name, { sub: '怨念に満ちている', size: 44, color: '#ff8a8a', life: 1.2 }); await this.wait(0.4); }
      }
      if (ev.momentum) SD.FX.text(330, 230, '追撃 ×1.5', { color: '#ffd257', size: 26, vy: -30 });
      rs.setIntent(ev.intent);
    }

    async on_event(ev) { this.rs.showEvent(ev.event); }
    async on_crossroads(ev) {
      const rs = this.rs;
      for (const h of rs.scene.heroList()) h.play('idle', 0.1);
      rs.showCrossroads(ev);
    }
    async on_chiselStart(ev) { this.rs.showChisel(ev); }
    async on_chiselEnd() { this.rs.closeModal(); }
    async on_chiseled(ev) { this.sfx('nudge'); this.rs.refreshChisel && this.rs.refreshChisel(); }
    async on_offerTaken() { this.sfx('reward'); }
    async on_carved(ev) {
      const p = SD.REEL_LAYOUT.reels[ev.reel];
      SD.FX.burst(p.x + p.w + 9, p.y + p.h / 2, 14, { color: ['#ffd257', '#fff6d8'], speed: 160, gravity: 0 });
    }
    async on_cling() { SD.FX.text(290, 260, '踏みとどまった！', { color: '#ffe1a0', size: 30 }); this.V().hp = 1; await this.wait(0.4); }
    async on_relic(ev) { this.sfx('relic'); this.rs.updateRelics(); this.V().hp = this.rs.run.hp; SD.FX.text(640, 200, SD.Data.RELICS[ev.id].name, { color: '#ffd257', size: 30, sub: '遺物を得た', vy: -20, life: 1.4 }); await this.wait(0.3); }
    async on_eventChoice() { this.rs.closeModal(); }
    async on_fate(ev) {
      SD.FX.banner(SD.Data.SYMBOLS[ev.sym].name, { sub: ev.result, size: 56 });
      this.sfx(ev.sym === 'skull' ? 'skull' : ev.sym === 'lantern' ? 'jackpot' : 'reward');
      const V = this.V(); V.hp = ev.hp; V.embers = ev.embers;
      await this.wait(1.0);
    }
    async on_maxHp(ev) { const V = this.V(); V.maxHp = ev.maxHp; V.hp = ev.hp; }
    async on_curse(ev) {
      const rs = this.rs;
      const src = rs.scene.enemy ? this.enemyFx() : { x: 640, y: 200 };
      this.sfx('hex');
      for (const c of ev.cells) {
        const p = SD.REEL_LAYOUT.reels[c.reel];
        SD.FX.stream(src.x, src.y, p.x + p.w / 2, p.y + p.h / 2, 6, { color: '#b48cff', stagger: 0.02 });
      }
      if (rs.scene.enemy && !ev.permanent) rs.scene.enemy.play('cast', 0.5);
      await this.wait(0.55);
      rs.reels.sync(rs.run);
      for (const c of ev.cells) SD.FX.text(SD.REEL_LAYOUT.reels[c.reel].x + 75, 500, '髑髏が混ざった', { color: '#c9a8ff', size: 18, vy: -20 });
    }

    // ---------------------------------------------------------------- spin & manipulation
    async on_spin(ev) {
      const rs = this.rs;
      rs.reels.lever.target = 1;
      this.sfx('spin_start');
      // anticipation only when the final result is great or a 1-nudge near miss on the last reel
      let antic = -1;
      const run = rs.run;
      const lastSpun = ev.spun.lastIndexOf(true);
      if (lastSpun >= 1) {
        const R = run.forecast();
        const great = R.combos.some((c) => c.k === 'trine' || c.k === 'bond' || c.k === 'quad');
        const nm = run.nearMisses(1).some((n) => n.reel === lastSpun);
        if (great || nm) antic = lastSpun;
      }
      if (antic >= 0) setTimeout(() => this.sfx('anticipation'), 260);
      await rs.reels.spin(ev.stops, ev.spun, { anticipation: antic, speedMul: ev.chain ? 0.7 : 1 });
      rs.reels.lever.target = 0;
    }

    async on_respin(ev) {
      const rs = this.rs;
      this.heroAt('witch').play('manip', 0.5);
      this.sfx('respin');
      if (ev.cost === 'spark') { rs.spendCandle(); this.sfx('spark_use'); }
      if (ev.cost === 'hp') { this.V().hp = ev.hp; SD.FX.text(290, 320, '-4', { color: '#ff6a6a', size: 26, sub: '血の代価' }); }
      this.V().sparks = ev.sparks; this.V().borrowed = ev.borrowed || 0;
      const wf = this.heroFx('witch');
      for (let i = 0; i < 3; i++) if (ev.spun[i]) { const p = SD.REEL_LAYOUT.reels[i]; SD.FX.stream(wf.x, wf.y, p.x + p.w / 2, p.y + 40, 4, { color: '#c58bff', stagger: 0.02 }); }
      await this.wait(0.12);
      await rs.reels.spin(ev.stops, ev.spun, { respin: true });
    }

    async on_hold(ev) {
      this.sfx(ev.held ? 'hold' : 'unhold');
      if (ev.held) this.heroAt('knight').play('manip', 0.35);
    }
    async on_deny() { this.sfx('ui_deny'); }

    async on_nudge(ev) {
      const rs = this.rs;
      this.heroAt('priest').play('manip', 0.45);
      this.sfx('nudge');
      if (ev.cost === 'spark' || ev.cost === 'borrowed') { rs.spendCandle(); this.sfx('spark_use', { vol: 0.7 }); }
      this.V().sparks = ev.sparks; this.V().borrowed = ev.borrowed || 0;
      const pf = this.heroFx('priest'), p = SD.REEL_LAYOUT.reels[ev.reel];
      SD.FX.stream(pf.x, pf.y, p.x + p.w / 2, ev.dir < 0 ? p.y + 30 : p.y + p.h - 30, 4, { color: '#7df0b4', stagger: 0.02 });
      await rs.reels.nudge(ev.reel, ev.dir, Math.abs(ev.dir) > 1 ? 0.3 : 0.2);
      if (ev.awaken) rs.onAwakenUsed();
    }

    async on_bless(ev) {
      this.heroAt('priest').play('pray', 0.6);
      this.sfx('heal');
      const c = this.rs.reels.cellCenter(ev.reel, 0);
      SD.FX.burst(c.x, c.y, 18, { color: ['#7df0b4', '#ffffff'], kind: 'mote', speed: 140, gravity: 0 });
      SD.FX.text(c.x, c.y - 40, '祝福', { color: '#7df0b4', size: 24 });
      await this.wait(0.35);
    }

    async on_echo(ev) {
      this.heroAt('witch').play('cast', 0.5);
      this.sfx('reflect');
      this.V().sparks = ev.sparks; this.V().borrowed = ev.borrowed || 0; this.rs.spendCandle(); this.rs.spendCandle();
      const a = this.rs.reels.cellCenter(ev.from, 0), b = this.rs.reels.cellCenter(ev.reel, 0);
      SD.FX.stream(a.x, a.y, b.x, b.y, 10, { color: '#c58bff', stagger: 0.015 });
      await this.wait(0.45);
      SD.FX.burst(b.x, b.y, 16, { color: ['#c58bff', '#ffffff'], speed: 200 });
    }

    async on_fateKey(ev) {
      this.heroAt('knight').play('cheer', 0.5);
      this.sfx('unlock');
      this.V().sparks = ev.sparks; this.V().borrowed = ev.borrowed || 0; this.rs.spendCandle(); this.rs.spendCandle();
      const rs = this.rs;
      await rs.reels.spin(rs.run.reels.map((r) => r.pos), rs.run.reels.map((_, i) => i === ev.reel), { respin: true });
      const c = rs.reels.cellCenter(ev.reel, 0);
      SD.FX.ring(c.x, c.y, { color: '#ffd257', r1: 90 });
    }

    // 拍子木: the clappers strike, the Ashwheel's script slides one cell toward the party
    async on_scriptAdvance(ev) {
      const rs = this.rs, V = this.V();
      this.heroAt('knight').play('manip', 0.45);
      this.sfx('clack');
      if (ev.cost === 'spark' || ev.cost === 'borrowed') this.sfx('spark_use', { vol: 0.6 });
      V.sparks = ev.sparks; V.borrowed = ev.borrowed || 0;
      const e = rs.scene.enemy;
      const p = this.enemyFx();
      // the skipped cell burns away
      const it0 = ev.from || {};
      SD.FX.text(p.x - 40, p.y - 150, (it0.label || (it0.k === 'guard' ? '防御' : it0.k === 'heal' ? '回復' : '予告')) + '…', { color: '#a99ab8', size: 18, vy: -40, life: 0.8 });
      SD.FX.burst(p.x - 20, p.y - 130, 12, { color: ['#c58bff', '#e8bf6a', '#7a6a8a'], kind: 'ember', speed: 120, gravity: -40 });
      rs.bandSlide = 1;
      Object.assign(V.enemy, rs.enemyView(ev.enemy, true));
      rs.setIntent(ev.intent);
      if (e) {
        const it = ev.intent;
        e.setHold(it.k === 'charge' || it.k === 'doom' || (it.heavy && it.k === 'attack') ? 'windup' : it.now && (it.now.k === 'curl' || it.now.k === 'reflect') ? 'stance' : null);
        e.play('hit', 0.25);
      }
      SD.FX.text(640, 452, '台本を送った', { color: '#e8bf6a', size: 20, vy: -10, life: 1.0 });
      await this.wait(0.35);
    }

    // 借り火: an ash-red ember is lent from the Ashwheel for this turn
    async on_borrow(ev) {
      const rs = this.rs, V = this.V();
      this.sfx('drain', { pitch: 0.75 });
      setTimeout(() => this.sfx('spark_gain', { pitch: 0.8 }), 160);
      const e = rs.scene.enemy; if (e) e.play('cast', 0.5);
      const p = this.enemyFx(), c = rs.reels.borrowPos ? rs.reels.borrowPos() : { x: 700, y: 430 };
      SD.FX.stream(p.x, p.y, c.x, c.y - 20, 10, { color: '#ff7a6a', stagger: 0.02 });
      await this.wait(0.3);
      V.borrowed = ev.borrowed || 1; V.sparks = ev.sparks;
      SD.FX.text(c.x, c.y - 50, '灰輪に借りた', { color: '#ff9a8a', size: 20, vy: -24, sub: '次の行動も、このターンに' });
      await this.wait(0.2);
    }

    // the debt is collected: the Ashwheel plays its next cell right away
    async on_debtAction(ev) {
      const rs = this.rs;
      rs.bandSlide = 1;
      rs.setIntent(ev.intent, { debt: true });
      const p = this.enemyFx();
      SD.FX.text(p.x, p.y - 150, '借りの一手', { color: '#ff9a8a', size: 28, vy: -16 });
      this.sfx('clack', { pitch: 0.8 });
      if (rs.scene.enemy) rs.scene.enemy.setHold('windup');
      await this.wait(0.45);
    }

    async on_chain() {
      SD.FX.banner('連鎖', { sub: 'もう一度廻る', size: 54, color: '#ffb36b', life: 0.9 });
      this.sfx('combo_pair');
      await this.wait(0.5);
    }

    // ---------------------------------------------------------------- resolution
    async on_payline(ev) {
      const rs = this.rs;
      rs.leaveDecision();
      this.V().borrowed = 0; // an unused borrowed spark goes out with the turn
      this.sfx('resolve');
      rs.comboCells = null;
      if (ev.combos.length) {
        rs.comboCells = [true, true, true];
        rs.reels.paylineGlow = 1;
        rs.reels.sweep = 1;
      } else {
        rs.reels.paylineGlow = 0.5;
      }
      await this.wait(ev.combos.length ? 0.05 : 0.08);
    }

    async on_combo(ev) {
      const c = ev.combo, FX = SD.FX, rs = this.rs;
      const name = COMBO_NAMES[c.k] || '';
      const symName = c.s ? SD.Data.SYMBOLS[c.s].name : '';
      if (c.k === 'reaper') {
        FX.flash('rgba(120,60,200,1)', 0.5, 2.5, false);
        FX.banner('死神', { sub: '髑髏が三つ揃った', size: 70, color: '#d8b8ff', glow: 'rgba(150,80,255,0.7)' });
        this.sfx('reaper');
        await this.wait(0.7);
        return;
      }
      FX.stop(110);
      FX.flash('rgba(255,214,120,1)', 0.3, 2.6);
      FX.shake(5);
      for (const h of rs.scene.heroList()) h.play('cheer', 0.7);
      rs.joy = 1;
      for (let i = 0; i < 3; i++) { const p = rs.reels.cellCenter(i, 0); FX.burst(p.x, p.y, 16, { color: ['#ffd257', '#fff6d8', '#ff9a3c'], kind: 'star', speed: 340 }); FX.ring(p.x, p.y, { r1: 110, color: '#ffe1a0' }); }
      if (c.k === 'bond') {
        FX.banner('絆の陣', { sub: '三人がそれぞれの持ち場に揃った ×3', size: 66, color: '#ffe1a0' });
        this.sfx('combo_bond');
      } else {
        FX.banner(`${name}・${symName}`, { sub: c.s === 'lantern' ? '大当り！ 残り火が降る' : '', size: 72 });
        this.sfx(c.s === 'lantern' ? 'jackpot' : 'combo_triple');
      }
      if (SD.Audio) SD.Audio.duck(0.5, 1);
      rs.onCombo(c);
      await this.wait(c.k === 'bond' ? 0.75 : 0.6);
    }

    async on_sealBreak(ev) {
      const rs = this.rs, V = this.V();
      V.enemy.seals = ev.seals;
      if (rs.scene.enemy) rs.scene.enemy.seals = ev.seals;
      this.sfx('seal_break');
      const p = this.enemyFx();
      SD.FX.burst(p.x, p.y - 40, 40, { color: ['#ffd257', '#ffffff', '#c58bff'], kind: 'chunk', speed: 420 });
      SD.FX.ring(p.x, p.y - 40, { r1: 220, color: '#ffd257', width: 10 });
      SD.FX.shake(9); SD.FX.stop(120);
      SD.FX.banner(ev.seals > 0 ? `封印が割れた（残り${ev.seals}）` : '封印が全て砕けた！', { size: 46, color: '#ffe1a0', life: 1.2 });
      await this.wait(0.8);
    }

    async on_stagger() {
      const p = this.enemyFx();
      SD.FX.text(p.x, p.y - 80, '怯んだ！', { color: '#9fe8ff', size: 30, vy: -30 });
      if (this.rs.scene.enemy) { this.rs.scene.enemy.setHold(null); this.rs.scene.enemy.play('hit', 0.5); }
      this.sfx('block');
      await this.wait(0.25);
    }

    async on_act(ev) {
      const rs = this.rs, V = this.V(), FX = SD.FX;
      if (ev.sym === 'ward') {
        const k = this.heroAt('knight');
        k.play('block', 0.5);
        this.sfx('ward');
        V.block = ev.total;
        const c = this.partyCenter();
        FX.ring(k.x + 20, k.y - 60, { r1: 70, color: '#6fd3ff' });
        FX.text(k.x + 30, k.y - 130, '+' + ev.block, { color: '#9fe8ff', size: ev.big ? 44 : 30, sub: 'ブロック' });
        void c;
        await this.wait(0.12);
      } else if (ev.sym === 'heart') {
        const pr = this.heroAt('priest');
        pr.play('pray', 0.6);
        if (ev.thirst) { FX.text(pr.x, pr.y - 140, '渇き…', { color: '#a0a0b0', size: 24 }); this.sfx('ui_deny'); await this.wait(0.12); return; }
        this.sfx('heal');
        V.hp = ev.hp;
        if (ev.block) V.block = ev.total;
        for (const h of rs.scene.heroList()) FX.burst(h.x, h.y - 50, 6, { color: ['#7df0b4', '#c8ffe4'], kind: 'mote', speed: 60, gravity: 0, life: 1 });
        if (ev.heal > 0) FX.text(pr.x + 10, pr.y - 140, '+' + ev.heal, { color: '#7df0b4', size: ev.big ? 44 : 30 });
        else FX.text(pr.x + 10, pr.y - 140, '満タン', { color: '#a9c8b8', size: 18 });
        await this.wait(0.12);
      } else if (ev.sym === 'blade') {
        const k = this.heroAt('knight');
        k.play('attack', 0.42);
        await this.wait(0.13);
        this.sfx(ev.big ? 'blade_big' : 'blade');
        const p = this.enemyFx();
        FX.slash(p.x, p.y, { len: ev.big ? 260 : 170, width: ev.big ? 16 : 10, ang: -0.7 });
        let sub = null;
        if (ev.armor > 0) { sub = `鎧 -${ev.armor}`; this.sfx('armor_clank'); }
        if (ev.absorbed > 0) sub = (sub ? sub + ' ' : '') + `防御 -${ev.absorbed}`;
        if (ev.sealed) sub = (sub ? sub + ' ' : '') + '封印で軽減';
        if (ev.executed) sub = '処刑！';
        this.dmgEnemy(ev.hp, ev.dmg, { big: ev.big, sub, zeroText: '弾かれた' });
        if (ev.dmg > 0) this.sfx(ev.big ? 'enemy_hit_big' : 'enemy_hit');
        await this.wait(0.14);
      } else if (ev.sym === 'flame') {
        const w = this.heroAt('witch');
        w.play('cast', 0.45);
        this.sfx('flame');
        const s = this.heroFx('witch'), p = this.enemyFx();
        FX.stream(s.x, s.y, p.x, p.y, ev.big ? 10 : 5, { color: '#ff8a3d', stagger: 0.015 });
        await this.wait(0.3);
        FX.burst(p.x, p.y, ev.big ? 30 : 14, { color: ['#ff7a2f', '#ffd257', '#fff1c0'], kind: 'ember', speed: 300 });
        this.dmgEnemy(ev.hp, ev.dmg, { big: ev.big, color: '#ffd9a0', sub: ev.absorbed ? `防御 -${ev.absorbed}` : ev.sealed ? '封印で軽減' : null });
        await this.wait(0.1);
      } else if (ev.sym === 'skull') {
        const p = this.enemyFx();
        this.sfx('skull');
        FX.burst(p.x, p.y, 14, { color: ['#b48cff', '#efe5cf'], speed: 240 });
        this.dmgEnemy(ev.hp, ev.dmg, { color: '#e2c8ff', sub: '髑髏の契約' });
        await this.wait(0.15);
      }
    }

    async on_reaper(ev) {
      const p = this.enemyFx();
      SD.FX.slash(p.x, p.y - 20, { len: 360, width: 22, ang: 0.6, color: '#d8b8ff' });
      this.dmgEnemy(ev.hp, ev.dmg, { big: true, color: '#e2c8ff', sub: '死神の鎌' });
      await this.wait(0.4);
    }

    async on_selfHit(ev) {
      const V = this.V(), FX = SD.FX;
      V.hp = ev.hp;
      for (const h of this.rs.scene.heroList()) { h.flash = 0.8; h.play('hit', 0.35); }
      FX.flash('rgba(150,80,220,1)', 0.25, 3, false);
      FX.text(290, 260, '-' + ev.amount, { color: '#d6a8ff', size: 34, sub: ev.cause === 'mark' ? '封じられた目' : ev.cause === 'altar' ? '血の祭壇' : '髑髏の呪い' });
      this.sfx(ev.cause === 'mark' ? 'mark' : 'skull');
      await this.wait(0.3);
    }

    async on_reflect(ev) {
      const V = this.V();
      V.hp = ev.hp; V.block = ev.block;
      this.sfx('reflect');
      const p = this.enemyFx();
      SD.FX.stream(p.x, p.y, 300, 300, 8, { color: '#e6e6ff', stagger: 0.01 });
      await this.wait(0.35);
      for (const h of this.rs.scene.heroList()) { h.flash = 0.7; h.play('hit', 0.3); }
      SD.FX.text(290, 270, '-' + (ev.amount - ev.blocked), { color: '#ff9aa6', size: 32, sub: ev.blocked ? `反射（ブロック -${ev.blocked}）` : '反射' });
      await this.wait(0.2);
    }

    async on_embers(ev) {
      const V = this.V(), rs = this.rs;
      const from = ev.src === 'kill' ? this.enemyFx() : rs.reels.cellCenter(1, 0);
      const target = rs.emberTarget();
      const n = Math.min(24, 3 + Math.floor(ev.amount / 2));
      let arrived = 0;
      SD.FX.stream(from.x, from.y, target.x, target.y, n, { color: '#ffd257', stagger: 0.025, onArrive: () => {
        arrived++; V.embers = Math.round(rs.run.embers - ev.amount * (1 - arrived / n)); if (arrived % 3 === 0) this.sfx('ember', { vol: 0.5 });
      } });
      SD.FX.text(from.x, from.y - 60, '+' + ev.amount, { color: '#ffd257', size: ev.jackpot ? 44 : 26, sub: '残り火' });
      if (ev.src === 'lantern' && !ev.jackpot) this.sfx('lantern');
      if (ev.jackpot) this.sfx('jackpot');
      await this.wait(0.12);
    }

    async on_sparks(ev) {
      const rs = this.rs;
      const before = this.V().sparks;
      this.V().sparks = ev.total;
      for (let k = before; k < ev.total; k++) rs.reels.flareCandle(k);
      if (ev.delta > 0) { this.sfx('spark_gain'); }
      await this.wait(0.05);
    }

    async on_burn(ev) {
      this.V().enemy.burn = ev.stacks;
      const p = this.enemyFx();
      SD.FX.burst(p.x, p.y, 8, { color: ['#ff7a2f', '#ffd257'], kind: 'ember', speed: 120 });
      SD.FX.text(p.x + 50, p.y - 70, `燃焼 ${ev.stacks}`, { color: '#ffb070', size: 20, vy: -30 });
      this.sfx('burn');
      await this.wait(0.08);
    }

    async on_pyre(ev) {
      const p = this.enemyFx();
      this.V().enemy.burn = ev.stacks;
      SD.FX.ring(p.x, p.y, { r1: 180, color: '#ff8a3d', width: 12 });
      SD.FX.burst(p.x, p.y, 40, { color: ['#ff7a2f', '#ffd257', '#ffffff'], kind: 'ember', speed: 480 });
      this.dmgEnemy(ev.hp, ev.dmg, { big: true, color: '#ffc080', sub: '灰燼・起爆' });
      this.sfx('flame');
      await this.wait(0.45);
    }

    async on_cleanse(ev) {
      if (!ev.removed) return;
      this.sfx('heal');
      for (let i = 0; i < 3; i++) { const p = SD.REEL_LAYOUT.reels[i]; SD.FX.burst(p.x + 75, p.y + 110, 10, { color: ['#7df0b4', '#ffffff'], kind: 'mote', speed: 120, gravity: 0 }); }
      SD.FX.text(640, 500, '呪いが清められた', { color: '#7df0b4', size: 22, vy: -30 });
      this.rs.reels.sync(this.rs.run);
      await this.wait(0.3);
    }

    async on_crack(ev) {
      const p = this.enemyFx();
      SD.FX.text(p.x + 40, p.y - 50, '殻にひび', { color: '#c8d8ff', size: 18, sub: `鎧 ${ev.armor}`, vy: -24 });
      SD.FX.burst(p.x, p.y, 8, { color: ['#9fb8ff', '#e6e6f0'], kind: 'chunk', speed: 200 });
      if (this.V().enemy) this.V().enemy.armorNow = Math.max(0, (this.V().enemy.armorNow || 0) - 1);
    }
    async on_stun() { const p = this.enemyFx(); SD.FX.text(p.x, p.y - 90, '気絶', { color: '#ffe68a', size: 28 }); await this.wait(0.15); }
    async on_secondWind(ev) {
      this.V().hp = ev.hp;
      SD.FX.flash('rgba(255,255,220,1)', 0.7, 1.6);
      SD.FX.banner('起死回生', { sub: '灯はまだ消えない', size: 60 });
      this.sfx('second_wind');
      for (const h of this.rs.scene.heroList()) h.play('cheer', 0.7);
      await this.wait(1.0);
    }
    async on_heal(ev) {
      this.V().hp = ev.hp;
      if (ev.amount > 0) { SD.FX.text(290, 280, '+' + ev.amount, { color: '#7df0b4', size: 28, sub: ev.src === 'rest' ? '休息' : ev.src === 'fang' ? '吸血' : ev.src === 'gentle' ? '祈りの手' : '' }); this.sfx('heal', { vol: 0.6 }); }
      await this.wait(ev.src === 'rest' ? 0.6 : 0.05);
    }

    // ---------------------------------------------------------------- enemy turn
    async on_enemyTurn() {
      this.rs.comboCells = null;
      await this.wait(0.16);
    }

    async on_burnTick(ev) {
      this.V().enemy.burn = ev.stacks;
      const p = this.enemyFx();
      SD.FX.burst(p.x, p.y, 10, { color: ['#ff7a2f', '#ffd257'], kind: 'ember', speed: 140 });
      this.dmgEnemy(ev.hp, ev.dmg, { color: '#ffb070', sub: '燃焼' });
      this.sfx('burn');
      await this.wait(0.3);
    }

    async on_enemyAttack(ev) {
      const rs = this.rs, V = this.V(), FX = SD.FX;
      const e = rs.scene.enemy;
      if (e) { e.setHold(null); e.play('attack', 0.5); }
      await this.wait(0.2);
      V.hp = ev.hp; V.block = ev.block;
      const heroes = rs.scene.heroList();
      if (ev.dmg > 0) {
        for (const h of heroes) { h.flash = 1; h.play('hit', 0.4); }
        this.sfx('party_hit');
        const big = ev.dmg >= V.maxHp * 0.15;
        FX.shake(big ? Math.min(6, 2 + ev.dmg * 0.25) : 1.5);
        if (big) FX.stop(60);
        FX.flash('rgba(255,60,80,1)', big ? 0.22 : 0.1, 3, false);
        FX.burst(300, 300, 14, { color: ['#ff4f5e', '#ffd0a0'], kind: 'chunk', speed: 260 });
        FX.text(300, 250, '-' + ev.dmg, { color: '#ff6a78', size: big ? 50 : 36, sub: ev.blocked ? `ブロック ${ev.blocked}` : null, subColor: '#9fe8ff' });
      } else {
        const k = this.heroAt('knight'); k.play('block', 0.45);
        this.sfx('block');
        FX.ring(k.x + 20, k.y - 60, { r1: 80, color: '#6fd3ff' });
        FX.text(300, 250, ev.guardian ? '完全防御' : '防いだ！', { color: '#9fe8ff', size: 32, sub: `ブロック ${ev.blocked}`, subColor: '#9fe8ff' });
      }
      if (ev.thorns) {
        await this.wait(0.15);
        this.sfx('armor_clank');
        const p = this.enemyFx();
        FX.stream(390, 290, p.x, p.y, 6, { color: '#6fd3ff', stagger: 0.01 });
        await this.wait(0.25);
        this.dmgEnemy(ev.enemyHp, ev.thorns, { color: '#9fe8ff', sub: ev.guardian ? '守護の誓い' : '棘の盾' });
      }
      rs.lowHpMood();
      await this.wait(0.32);
    }

    async on_enemyGrow(ev) { const p = this.enemyFx(); SD.FX.text(p.x, p.y - 90, '攻撃↑', { color: '#ff9a8a', size: 22, vy: -30 }); }
    async on_enemyCharge(ev) {
      const e = this.rs.scene.enemy;
      if (e) e.setHold('windup');
      this.sfx('windup');
      const p = this.enemyFx();
      SD.FX.text(p.x, p.y - 110, ev.label || '溜め', { color: '#ff9a8a', size: 28, vy: -20 });
      SD.FX.shake(2);
      await this.wait(0.45);
    }
    async on_enemyGuard(ev) {
      this.V().enemy.block = ev.block;
      const e = this.rs.scene.enemy; if (e) e.play('stance', 0.5);
      this.sfx('ward');
      const p = this.enemyFx(); SD.FX.ring(p.x, p.y, { color: '#9fb8ff', r1: 90 });
      SD.FX.text(p.x, p.y - 90, '防御 ' + ev.block, { color: '#c8d8ff', size: 24 });
      await this.wait(0.3);
    }
    async on_enemyHeal(ev) {
      const V = this.V(); V.enemy.hp = ev.hp; V.enemy.block = ev.block;
      const e = this.rs.scene.enemy; if (e) e.play('cast', 0.6);
      this.sfx('enemy_heal');
      const p = this.enemyFx(); SD.FX.burst(p.x, p.y, 16, { color: ['#b48cff', '#7df0b4'], kind: 'mote', speed: 120, gravity: 0 });
      SD.FX.text(p.x, p.y - 90, '+' + ev.amount, { color: '#9df0c0', size: 30 });
      await this.wait(0.4);
    }
    async on_drain(ev) {
      const rs = this.rs; this.V().sparks = ev.sparks;
      const e = rs.scene.enemy; if (e) e.play('cast', 0.6);
      this.sfx('drain');
      const c = rs.reels.candlePos(ev.sparks, rs.run.maxSparks), p = this.enemyFx();
      SD.FX.stream(c.x, c.y - 20, p.x, p.y, 8, { color: '#ffc15e', stagger: 0.02 });
      SD.FX.text(c.x, c.y - 40, '火種を吸われた', { color: '#ffb070', size: 20, vy: -30 });
      await this.wait(0.45);
    }
    async on_jam(ev) {
      const rs = this.rs;
      const e = rs.scene.enemy; if (e) e.play('cast', 0.5);
      this.sfx('jam');
      const r = SD.REEL_LAYOUT.reels[ev.reel], p = this.enemyFx();
      SD.FX.stream(p.x, p.y, r.x + r.w / 2, r.y + r.h / 2, 6, { color: '#c9953b', stagger: 0.02 });
      await this.wait(0.35);
      SD.FX.text(r.x + r.w / 2, r.y + 30, '固着', { color: '#e8bf6a', size: 24, vy: -20 });
      SD.FX.shake(3);
    }
    async on_doom(ev) {
      this.sfx('doom_tick');
      if (ev.fired) return;
      const p = this.enemyFx();
      SD.FX.text(p.x, p.y - 140, `破滅まで ${ev.n}`, { color: '#ff7a7a', size: 34, vy: -20 });
      await this.wait(0.3);
    }
    async on_stunned() { const p = this.enemyFx(); SD.FX.text(p.x, p.y - 90, '動けない！', { color: '#ffe68a', size: 30 }); await this.wait(0.4); }
    async on_staggerCancel() {
      const p = this.enemyFx();
      SD.FX.text(p.x, p.y - 90, '強撃は不発', { color: '#9fe8ff', size: 28, sub: SD.UI.bandVisible(this.rs.run) ? '台本から消えた' : null });
      if (SD.UI.bandVisible(this.rs.run)) this.rs.bandSlide = 1;
      await this.wait(0.35);
    }
    async on_enemyIdle() { await this.wait(0.15); }
    async on_intent(ev) { this.rs.setIntent(ev.intent); this.V().enemy = Object.assign(this.V().enemy, this.rs.enemyView(ev.enemy, true)); }

    async on_bossPhase(ev) {
      const rs = this.rs;
      if (rs.scene.enemy) rs.scene.enemy.phase = ev.phase;
      this.V().enemy.phase = ev.phase;
      this.sfx('boss_phase');
      SD.FX.shake(10); SD.FX.flash('rgba(160,80,255,1)', 0.4, 1.5, false);
      SD.FX.banner(ev.phase === 2 ? '逆廻り' : '破滅の秒読み', { sub: ev.phase === 2 ? '封じが巡る。外して殴れ' : '灰燼が来る。盾で受けるか、削り切れ', size: 60, color: '#e8d0ff', glow: 'rgba(150,80,255,0.6)', life: 1.6 });
      if (ev.gained) { this.V().sparks = ev.sparks; rs.reels.flareCandle(ev.sparks - 1); this.sfx('spark_gain'); }
      await this.wait(1.1);
    }

    async on_newTurn(ev) {
      const rs = this.rs, V = this.V();
      V.block = ev.block; V.sparks = ev.sparks; V.borrowed = 0;
      Object.assign(V.enemy, rs.enemyView(ev.enemy, true));
      rs.setIntent(ev.intent);
      if (rs.scene.enemy) {
        const it = ev.intent;
        rs.scene.enemy.setHold(it.k === 'charge' || it.k === 'doom' || (it.heavy && it.k === 'attack') ? 'windup' : it.now && (it.now.k === 'curl' || it.now.k === 'reflect') ? 'stance' : null);
      }
    }

    // ---------------------------------------------------------------- endings
    async on_enemyDie(ev) {
      const rs = this.rs, e = rs.scene.enemy;
      this.sfx('enemy_die');
      if (e) { e.setHold(null); e.play('die', 0.8); }
      const p = this.enemyFx();
      SD.FX.burst(p.x, p.y, 36, { color: ['#ffd257', '#ff8a3d', '#fff6d8'], kind: 'ember', speed: 360 });
      SD.FX.stop(80); SD.FX.shake(4);
      rs.setIntent(null);
      await this.wait(0.55);
    }
    async on_victory(ev) {
      const rs = this.rs;
      for (const h of rs.scene.heroList()) h.play('cheer', 0.8);
      this.sfx('reward');
      await this.wait(0.55);
      if (rs.scene.enemy) rs.scene.enemy = null;
      rs.V.block = 0;
    }
    async on_momentum() { SD.FX.text(330, 220, '追撃の構え', { color: '#ffd257', size: 22, vy: -20 }); }

    async on_partyDeath() {
      const rs = this.rs;
      for (const h of rs.scene.heroList()) h.play('dead', 0.8);
      rs.setIntent(null);
      this.sfx('death');
      if (SD.Audio) SD.Audio.setMusic('none');
      await this.wait(1.0);
    }
    async on_runWon() {
      const rs = this.rs;
      this.sfx('victory');
      if (SD.Audio) SD.Audio.setMusic('victory');
      SD.FX.flash('rgba(255,240,200,1)', 0.8, 0.8);
      for (const h of rs.scene.heroList()) h.play('cheer', 1.2);
      SD.FX.banner('灰輪の主を討った', { sub: '灯輪は、再び正しく廻り始める', size: 56, life: 3 });
      for (let k = 0; k < 6; k++) { SD.FX.burst(200 + k * 180, 200, 30, { color: ['#ffd257', '#fff6d8', '#ff9a3c'], kind: 'star', speed: 380 }); await this.wait(0.3); }
      await this.wait(1.2);
    }
    async on_runEnd(ev) { this.rs.onRunEnd(ev.summary); }
    // 灰の底
    async on_bossSettled(ev) { this.rs.onBossSettled(ev.summary); }
    async on_descend() {
      SD.FX.flash('rgba(5,3,10,1)', 1.25, 2.2, false);
      SD.FX.banner('灰の底へ', { sub: '勝利は確定している。重ね殻と返し鏡が待つ', size: 50, life: 2.4 });
      await this.wait(1.4);
    }
    async on_deepCleared() {
      this.sfx('victory');
      SD.FX.flash('rgba(255,240,200,1)', 0.6, 0.8);
      for (const h of this.rs.scene.heroList()) h.play('cheer', 1.2);
      SD.FX.banner('灰の底を越えた', { sub: '深淵の修道院長を討った', size: 54, life: 3 });
      await this.wait(2.2);
    }
  }

  SD.Director = Director;
  SD.SYM_HERO = SYM_HERO;
})();
