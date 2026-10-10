/* EMBERWHEEL — bootstrap, stage scaling, main loop, timers, input routing, settings. */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});

  const Game = {
    fontUI: '"Zen Maru Gothic", "Yu Gothic UI", "Hiragino Maru Gothic ProN", "Meiryo", sans-serif',
    fontTitle: '"Kaisei Decol", "Yu Mincho", "Hiragino Mincho ProN", serif',
    fontNum: '"Zen Maru Gothic", "Yu Gothic UI", "Meiryo", sans-serif',
    renderScale: 1,
    scale: 1,
    time: 0,
    timers: [],
    shift: false,
    screen: null,
  };
  SD.Game = Game;

  Game.wait = (sec) => new Promise((res) => {
    if (sec <= 0) { res(); return; }
    Game.timers.push({ t: sec, res });
  });

  Game.timeScale = () => {
    const sp = (Game.profile && Game.profile.settings.speed) || 1;
    const scr = Game.screen;
    const skip = scr && scr.director && scr.director.skip ? 2.5 : 1;
    return sp * (Game.shift ? 2.5 : 1) * skip;
  };

  Game.save = () => SD.Meta.save(Game.profile);

  Game.setScreen = (scr) => {
    if (Game.screen && Game.screen.exit) Game.screen.exit();
    Game.timers.length = 0;
    SD.FX.clear();
    Game.closeSettings();
    Game.screen = scr;
    Game.canvas.style.cursor = 'default';
    scr.enter();
  };

  Game.toStage = (e) => {
    const r = Game.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 1280, y: ((e.clientY - r.top) / r.height) * 720 };
  };

  function resize() {
    const stage = document.getElementById('stage');
    const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    Game.scale = s;
    stage.style.transform = `scale(${s})`;
    stage.style.left = Math.round((window.innerWidth - 1280 * s) / 2) + 'px';
    stage.style.top = Math.round((window.innerHeight - 720 * s) / 2) + 'px';
    const dpr = window.devicePixelRatio || 1;
    const k = Math.max(1, Math.min(3, s * dpr));
    Game.renderScale = k;
    Game.canvas.width = Math.round(1280 * k);
    Game.canvas.height = Math.round(720 * k);
  }

  // ---------------------------------------------------------------- settings
  let settingsEl = null;
  Game.closeSettings = () => { if (settingsEl) { settingsEl.remove(); settingsEl = null; } };
  Game.settingsButton = (inRun, onGiveUp) => {
    const U = SD.UI;
    const b = U.el('button', 'gear-btn', '⚙');
    b.title = '設定';
    b.addEventListener('click', (e) => { e.stopPropagation(); Game.openSettings(inRun, onGiveUp); });
    return b;
  };
  Game.openSettings = (inRun, onGiveUp) => {
    const U = SD.UI, p = Game.profile;
    if (settingsEl) { Game.closeSettings(); return; }
    settingsEl = U.el('div', 'settings');
    const box = U.el('div', 'settings-box');
    box.appendChild(U.el('div', 'ph', '設定'));
    const slider = (label, key) => {
      const row = U.el('div', 'set-row');
      row.appendChild(U.el('span', '', label));
      const inp = U.el('input', '', null, { type: 'range', min: '0', max: '1', step: '0.05' });
      inp.value = p.settings[key];
      inp.addEventListener('input', () => { p.settings[key] = +inp.value; applyVolume(); });
      inp.addEventListener('change', () => Game.save());
      row.appendChild(inp);
      box.appendChild(row);
    };
    slider('全体の音量', 'master'); slider('音楽', 'music'); slider('効果音', 'sfx');
    const sp = U.el('div', 'set-row');
    sp.appendChild(U.el('span', '', '演出の速さ'));
    const sw = U.el('div', 'speed-btns');
    for (const v of [1, 1.5, 2]) {
      const bb = U.button('×' + v, 'mini' + (p.settings.speed === v ? ' on' : ''), () => { p.settings.speed = v; Game.save(); [...sw.children].forEach((c) => c.classList.toggle('on', c === bb)); });
      sw.appendChild(bb);
    }
    sp.appendChild(sw);
    box.appendChild(sp);
    box.appendChild(U.el('div', 'set-note', 'Shift を押している間は早送り'));
    // a trine/bond waits for the player once 継ぎ留め / 拍子木 are lit (can be turned off)
    const cp = U.el('div', 'set-row stack');
    const cpOn = !!(p.unlocked && (p.unlocked.stasis || p.unlocked.hyoshigi));
    cp.appendChild(U.el('span', '', `三連・絆で止まる<small style="display:block;color:#b9ad95">継ぎ留めか拍子木を灯した後、撃破しない三連で、まだ操作できる時だけ${cpOn ? '' : '（まだ未解放：今は常にすぐ発動）'}</small>`));
    const cw = U.el('div', 'speed-btns');
    for (const [v, lbl] of [['smart', '操作できる時は止まる'], ['off', '常にすぐ発動']]) {
      const bb = U.button(lbl, 'mini' + ((p.settings.comboPause || 'smart') === v ? ' on' : ''), () => {
        p.settings.comboPause = v; Game.save();
        [...cw.children].forEach((c) => c.classList.toggle('on', c === bb));
        const scr = Game.screen;
        if (scr && scr.run && scr.run.mods) scr.run.mods.comboPause = SD.Meta.computeMods(p).comboPause;
      });
      cw.appendChild(bb);
    }
    cp.appendChild(cw);
    box.appendChild(cp);
    if (inRun && onGiveUp) box.appendChild(U.button('この降下を終える', 'secondary', () => onGiveUp()));
    const reset = U.button('進行をリセット', 'danger', () => {
      if (!reset.dataset.armed) { reset.dataset.armed = '1'; reset.innerHTML = '本当に消す？（もう一度押す）'; return; }
      Game.profile = Game.testMode ? SD.Meta.newProfile() : SD.Meta.reset(); // (the test entrance never touches the save)
      Game.closeSettings();
      Game.setScreen(new SD.Screens.TitleScreen());
    });
    box.appendChild(reset);
    box.appendChild(U.button('閉じる', 'mini', () => Game.closeSettings()));
    settingsEl.appendChild(box);
    settingsEl.addEventListener('click', (e) => { if (e.target === settingsEl) Game.closeSettings(); });
    document.getElementById('stage').appendChild(settingsEl);
  };

  function applyVolume() {
    if (!SD.Audio || !SD.Audio.setVolume) return;
    const s = Game.profile.settings;
    SD.Audio.setVolume({ master: s.master, music: s.music, sfx: s.sfx });
  }
  Game.applyVolume = applyVolume;

  // ---------------------------------------------------------------- loop
  let last = 0;
  function frame(ts) {
    const raw = Math.min(0.05, Math.max(0, (ts - last) / 1000 || 0));
    last = ts;
    let dt = raw * Game.timeScale();
    // the play clock (in the profile; written with its next save). Not while the page is hidden, nor in a test entrance
    const ck = Game.profile && Game.profile.clock;
    if (ck && !Game.testMode && !(typeof document !== 'undefined' && document.hidden)) { ck.sec = (ck.sec || 0) + raw; if (!ck.since) ck.since = new Date().toISOString().slice(0, 10); }
    // hit-stop: freeze the world briefly
    if (SD.FX.hitstop > 0) { SD.FX.hitstop -= raw; dt = dt * 0.05; }
    Game.time += dt;
    for (let i = Game.timers.length - 1; i >= 0; i--) {
      const tm = Game.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { Game.timers.splice(i, 1); tm.res(); }
    }
    SD.FX.update(dt);
    const ctx = Game.ctx;
    ctx.setTransform(Game.renderScale, 0, 0, Game.renderScale, 0, 0);
    ctx.clearRect(0, 0, 1280, 720);
    if (Game.screen) {
      try {
        Game.screen.update(dt);
        Game.screen.render(ctx);
      } catch (err) {
        console.error(err);
      }
    }
    requestAnimationFrame(frame);
  }

  function boot() {
    Game.canvas = document.getElementById('game');
    Game.ctx = Game.canvas.getContext('2d');
    Game.profile = SD.Meta.load();
    // stage 4b test entrance (?test=b17): a whole-tree profile kept in memory only (the save is never read back or written),
    // then 深淵の繰り手. The kit (10 carvings + 6 relics, about a board that cleared B16) is picked automatically; &pick=1
    // picks them by hand; &kit=1 chooses one of 最深の間へ's 型 instead. &act=2 / 3 / 4 starts the fight at 面の段 / 祈りの段 /
    // 終幕の段. The real entrances come in stage 4d.
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    const test = q ? q.get('test') : null;
    if (test === 'b17') {
      Game.testMode = true;
      Game.testOpts = { pick: q.get('pick') === '1', kit: q.get('kit') === '1', act: Math.max(1, Math.min(4, +q.get('act') || 1)) }; // (act: applied when the fight starts)
      const p = SD.Meta.newProfile();
      for (const s of SD.Data.SKILLS) p.unlocked[s.id] = true;
      Object.assign(p.stats, { runs: 40, wins: 3, bestFloor: 16, deepRuns: 3, deepBest: 16, deepClears: 1, eliteKills: { bellhound: 3, abbot: 3, ashlord: 3, bellkeeper: 1 } });
      // (a whole-tree player has long seen the verb hints: only what is new in B17 shows)
      p.seen = { band: true, nudge: true, respin: true, bless: true, echo: true, key: true, script: true, borrow: true, comboPause: true };
      Game.profile = p;
      Game.save = () => false;
    }
    // stage 4d test entrance (?test=camp): the camp with one 灯紋 left to light (灯輪の完成), the B16 elite beaten unless
    // &keeper=0 (then the closed line, and 最深の間へ stays veiled). In memory only, like ?test=b17.
    // stage 4d test entrance (?test=emaki): the title with both scrolls to see (序の巻 / 終の巻), in memory only
    if (test === 'emaki') {
      Game.testMode = true;
      Game.testOpts = { title: true, act: 1 };
      const p = SD.Meta.newProfile();
      for (const s of SD.Data.SKILLS) p.unlocked[s.id] = true;
      Object.assign(p.stats, { runs: 40, wins: 3, bossKills: 3, deepRuns: 6, finalRuns: 2, finalClears: 1, finalBestTurns: 9, totalEmbers: 5200, eliteKills: { bellkeeper: 1 } });
      p.clock = { sec: 9 * 3600 + 12 * 60, fromStart: true, since: '2026-10-04' };
      p.seen = { prologue: true, epilogue: true };
      Game.profile = p;
      Game.save = () => false;
    }
    if (test === 'camp') {
      Game.testMode = true;
      Game.testOpts = { camp: true, act: 1 };
      const p = SD.Meta.newProfile();
      for (const s of SD.Data.SKILLS) p.unlocked[s.id] = s.id !== 'keeper';
      Object.assign(p.stats, { runs: 40, wins: 3, bossKills: 3, bestFloor: 16, deepRuns: 3, deepBest: 16, deepClears: 1, eliteKills: q.get('keeper') === '0' ? { bellhound: 3, abbot: 3, ashlord: 3 } : { bellhound: 3, abbot: 3, ashlord: 3, bellkeeper: 1 } });
      p.embers = 200;
      p.seen = { band: true, nudge: true, respin: true, bless: true, echo: true, key: true, script: true, borrow: true, comboPause: true };
      Game.profile = p;
      Game.save = () => false;
    }
    resize();
    window.addEventListener('resize', resize);
    const firstGesture = () => { if (SD.Audio) { SD.Audio.init(); applyVolume(); } };
    window.addEventListener('pointerdown', firstGesture, { once: true });
    window.addEventListener('keydown', firstGesture, { once: true });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') Game.shift = true;
      if (e.code === 'Space') e.preventDefault();
      if (e.repeat && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) return;
      if (Game.screen && Game.screen.onKey && !settingsEl) Game.screen.onKey(e);
      if (e.code === 'Escape' && settingsEl) Game.closeSettings();
    });
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') Game.shift = false; });
    window.addEventListener('blur', () => { Game.shift = false; });
    Game.canvas.addEventListener('mousemove', (e) => { const p = Game.toStage(e); if (Game.screen && Game.screen.onMouseMove) Game.screen.onMouseMove(p.x, p.y); });
    Game.canvas.addEventListener('mousedown', (e) => { const p = Game.toStage(e); if (Game.screen && Game.screen.onMouseDown) Game.screen.onMouseDown(p.x, p.y); });
    Game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // wait briefly for web fonts, then start
    const start = () => {
      const T = Game.testOpts;
      Game.setScreen(Game.testMode && T.title ? new SD.Screens.TitleScreen() : Game.testMode && T.camp ? new SD.Screens.CampScreen({ focus: 'keeper' }) : Game.testMode ? new SD.Screens.RunScreen({ startFloor: SD.Data.FINAL_FLOOR, act: T.act,
        kit: T.kit ? null : { auto: !T.pick } }) /* (the kit itself is 最深の間へ's: SHORTCUTS[17] / a 型) */ : new SD.Screens.TitleScreen());
      requestAnimationFrame(frame);
    };
    if (document.fonts && document.fonts.load) {
      Promise.race([
        Promise.all([document.fonts.load(`700 20px ${Game.fontUI}`), document.fonts.load(`900 30px ${Game.fontTitle}`)]),
        new Promise((r) => setTimeout(r, 1200)),
      ]).then(start, start);
    } else start();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
