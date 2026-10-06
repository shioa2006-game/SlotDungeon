/* Dev-only capture harness: drives the game into a named state for headless screenshots.
 *   tools/capture.html?scene=decision   (scenes: title run1 decision picker crossroads chisel event death camp boss charge)
 * Not linked from the game. */
(function () {
  const SD = globalThis.SD;
  const q = new URLSearchParams(location.search);
  const scene = q.get('scene') || 'title';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = performance.now(); while (!fn() && performance.now() - t0 < ms) await wait(50); };
  const profile = (ids, runs, embers) => {
    const p = SD.Meta.newProfile();
    p.stats.runs = runs || 0; p.embers = embers || 0; p.stats.bestFloor = runs ? 6 : 0; p.stats.lastFloor = runs ? 4 : 0;
    if (runs) p.stats.eliteKills = { bellhound: 1 };
    for (const id of ids || []) p.unlocked[id] = true;
    p.seen = { nudge: 1, respin: 1, bless: 1, echo: 1, key: 1 };
    SD.Game.profile = p;
    return p;
  };
  const MID = ['nudge', 'respin', 'sparkjar', 'whet', 'bond', 'cloak', 'deft', 'kindle'];
  const MASTER = MID.concat(['stasis', 'longpush', 'echo', 'fatekey', 'campfire', 'thorns', 'secondwind', 'chisel', 'wild', 'precision']);
  const run = () => SD.Game.screen;
  const spinToDecision = async () => {
    for (let k = 0; k < 8; k++) {
      await until(() => run().state === 'idle');
      run().primary();
      await until(() => run().state === 'decision' || run().state === 'idle' || run().state === 'modal');
      if (run().state === 'decision') return true;
    }
    return false;
  };

  const errs = [];
  window.addEventListener('error', (e) => errs.push(e.message));
  const oe = console.error; console.error = (...a) => { errs.push(a.map((x) => (x && x.stack) || String(x)).join(' ').slice(0, 300)); oe(...a); };
  setInterval(() => { if (errs.length) { let d = document.getElementById('caperr'); if (!d) { d = document.createElement('pre'); d.id = 'caperr'; d.style.cssText = 'position:fixed;left:0;top:0;z-index:999;background:#300;color:#fff;font:11px monospace;max-width:900px;white-space:pre-wrap'; document.body.appendChild(d); } d.textContent = errs.slice(0, 6).join(' | '); } }, 200);
  async function go() {
    await until(() => SD.Game && SD.Game.screen);
    await wait(300);
    switch (scene) {
      case 'title': break;
      case 'run1': {
        profile([], 0, 0);
        SD.Game.setScreen(new SD.Screens.RunScreen({ startFloor: 1 }));
        await until(() => run().state === 'idle');
        run().primary();
        await wait(650);
        break;
      }
      case 'decision': {
        profile(MID, 4, 30);
        SD.Game.setScreen(new SD.Screens.RunScreen({ startFloor: 1 }));
        await spinToDecision();
        run().onMouseMove(472, 505);
        break;
      }
      case 'picker': {
        profile(MASTER, 9, 0);
        SD.Game.setScreen(new SD.Screens.RunScreen({ startFloor: 5 }));
        for (let k = 0; k < 6 && run().run.phase !== 'idle'; k++) {
          await until(() => run().state === 'modal' || run().state === 'idle');
          if (run().state === 'modal') { const c = document.querySelector('.card'); if (c) c.click(); const d = document.querySelector('.door'); if (d) d.click(); await wait(400); }
        }
        await spinToDecision();
        run().toggleMode('key');
        run().onMouseDown(640, 580);
        await wait(100);
        const cell = document.querySelector('.sp-cell:not(.off):not(.cur)');
        if (cell) cell.dispatchEvent(new MouseEvent('mouseenter'));
        break;
      }
      case 'crossroads': {
        profile(['nudge', 'whet', 'cloak', 'campfire', 'crossroads'], 3, 0);
        SD.Game.setScreen(new SD.Screens.RunScreen({ startFloor: 1 }));
        for (let k = 0; k < 40 && run().state !== 'modal'; k++) {
          await until(() => run().state === 'idle' || run().state === 'decision' || run().state === 'modal');
          if (run().state !== 'modal') run().primary();
          await wait(80);
        }
        await wait(300);
        const c = document.querySelector('.card'); if (c) c.click();
        break;
      }
      case 'chisel': {
        profile(['nudge', 'sparkjar', 'chisel'], 3, 0);
        SD.Game.setScreen(new SD.Screens.RunScreen({ startFloor: 1 }));
        await until(() => document.querySelector('.chisel-cell'));
        const cells = document.querySelectorAll('.chisel-cell'); if (cells[5]) cells[5].click();
        break;
      }
      case 'event': {
        profile(['nudge'], 3, 0);
        SD.Game.setScreen(new SD.Screens.RunScreen({ startFloor: 1 }));
        await until(() => run().state === 'idle');
        const r = run().run; r.enemy = null; r.fight = null;
        run().play(r._startEvent(q.get('id') || 'cursed_chest'));
        break;
      }
      case 'death': {
        profile(['nudge'], 1, 10);
        SD.Game.setScreen(new SD.Screens.RunScreen({ startFloor: 1 }));
        await until(() => run().state === 'idle');
        const r = run().run; r.stats.nearMiss = 5; r.floor = 4;
        run().giveUp();
        await wait(2600);
        break;
      }
      case 'camp': {
        profile(MID.concat(['campfire', 'thorns']), 6, 140);
        SD.Game.setScreen(new SD.Screens.CampScreen());
        await wait(400);
        break;
      }
      case 'boss': {
        profile(MASTER, 10, 0);
        SD.Game.setScreen(new SD.Screens.RunScreen({ startFloor: 12 }));
        await until(() => run().state === 'idle', 12000);
        await wait(2300);
        break;
      }
      case 'charge': {
        profile(MID, 4, 0);
        SD.Game.setScreen(new SD.Screens.RunScreen({ startFloor: 4 }));
        await until(() => run().state === 'idle', 12000);
        const e = run().run.enemy; e.turn = 2; e.cursor = 2; run().run._newIntent(); run().setIntent(e.intent);
        await wait(400);
        break;
      }
      default: break;
    }
    document.title = 'READY';
  }
  window.addEventListener('load', () => { go().catch((e) => { document.title = 'ERR ' + e.message; console.error(e); }); });
})();
