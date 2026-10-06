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
    const cp = U.el('div', 'set-row');
    cp.appendChild(U.el('span', '', '三連で止まる<small style="display:block;color:#b9ad95">継ぎ留め・拍子木の後</small>'));
    const cw = U.el('div', 'speed-btns');
    for (const [v, lbl] of [['smart', '止まる'], ['off', 'すぐ発動']]) {
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
      Game.profile = SD.Meta.reset();
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
    const start = () => { Game.setScreen(new SD.Screens.TitleScreen()); requestAnimationFrame(frame); };
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
