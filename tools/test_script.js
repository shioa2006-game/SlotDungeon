/* EMBERWHEEL — tests for 灰輪の台本 (script band / 拍子木) and 借り火 (borrowing), plus a regression
 * check that the game is unchanged for players who have not lit the new 灯紋.
 *   node tools/test_script.js            (all)
 *   node tools/test_script.js unit       (unit tests only)
 *   node tools/test_script.js regress [runs]
 * The regression baseline is the vertical-slice commit (git 89b29f1); it is loaded side by side in its own VM context. */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const BASE_COMMIT = process.env.BASE_COMMIT || '89b29f1';
const CORE = ['util', 'data', 'meta', 'engine'];

function loadSD(sources, globals) {
  const ctx = Object.assign({ console }, globals || {});
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const [name, code] of sources) vm.runInContext(code, ctx, { filename: name });
  return ctx.SD;
}
const currentSD = (globals) => loadSD(CORE.map((f) => [f, fs.readFileSync(path.join(ROOT, 'js', 'core', f + '.js'), 'utf8')]), globals);
const baseSD = () => loadSD(CORE.map((f) => [f, execSync(`git show ${BASE_COMMIT}:js/core/${f}.js`, { cwd: ROOT, encoding: 'utf8' })]));

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + `  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(name) { console.log('• ' + name); }

// ------------------------------------------------------------------ helpers for building exact situations
function profileWith(SD, ids, extra) {
  const p = SD.Meta.newProfile();
  p.stats.runs = 8;
  for (const id of ids) p.unlocked[id] = true;
  if (extra) extra(p);
  return p;
}
// A run standing in a fight against `enemyId` on `floor`, idle, with the given sparks.
function fightRun(SD, ids, enemyId, floor, opts = {}) {
  const run = new SD.Run(SD.Meta.computeMods(profileWith(SD, ids, opts.profile)), { seed: opts.seed || 7, startFloor: floor });
  run.floor = floor;
  run.phase = 'start';
  run._startCombat(enemyId, {});
  if (opts.sparks != null) run.sparks = opts.sparks;
  if (opts.hp != null) run.hp = opts.hp;
  return run;
}
// Put a chosen payline on the reels (after spin): syms = ['blade','blade','ward'] etc. Finds a matching cell or rewrites one.
function setPayline(run, syms) {
  run.reels.forEach((r, i) => {
    let idx = r.strip.findIndex((c) => c.s === syms[i] && !c.temp);
    if (idx < 0) { idx = 0; r.strip[0].s = syms[i]; }
    r.pos = idx; r.echo = null;
  });
}
const strip = (it) => JSON.parse(JSON.stringify(it, (k, v) => (k === 'random' ? undefined : v)));

// ================================================================== unit tests
function unit() {
  const SD = currentSD();
  const D = SD.Data;

  section('script cursor vs turn: sending the script is not an enemy turn');
  {
    const run = fightRun(SD, ['nudge', 'respin', 'hyoshigi'], 'sentry', 6, { sparks: 3 });
    const e = run.enemy;
    eq([e.intent.k, e.intent.v], ['attack', 8], 'sentry starts with attack 8');
    run.spin();
    ok(run.canAdvance(), 'can send the script with a spark');
    const P = run.previewAdvance();
    const s0 = run.sparks;
    const ev = run.advance();
    eq(ev[0].t, 'scriptAdvance', 'advance emits scriptAdvance');
    eq([e.intent.k, e.intent.v], ['guard', 10], 'attack 8 -> guard 10 becomes "now"');
    eq(strip(P.intent), strip(e.intent), 'advance preview == result');
    eq([e.cursor, e.turn], [1, 0], 'cursor +1, turn unchanged');
    eq(run.sparks, s0 - 1, 'costs one spark');
    ok(!run.canAdvance() && run.advanceBlock() === 'used', 'once per turn');
    run.resolve();
    eq([e.cursor, e.turn, e.intent.k], [2, 1, 'charge'], 'after the enemy turn: charge (構え) is now');
    eq(e.block, 10, 'the guard cell that was brought forward was played');
    run.sparks = 3; run.spin();
    ok(run.canAdvance(), 'charge can be sent');
    run.advance();
    ok(e.intent.heavy && e.intent.v === 18, 'charge -> heavy 18 now (called early)');
    ok(!run.canAdvance() && run.advanceBlock() === 'locked', 'a wound-up heavy is locked: it cannot be sent away');
  }

  section('sending does not tick burn, growth or rage');
  {
    const run = fightRun(SD, ['nudge', 'hyoshigi'], 'slime', 2, { sparks: 3 });
    const e = run.enemy; e.burn = 5;
    run.spin();
    const hp0 = e.hp, atk0 = e.atkBonus;
    run.advance();
    eq([e.hp, e.burn, e.atkBonus], [hp0, 5, atk0], 'no burn tick, no growth from the skipped attack');
    const boss = fightRun(SD, ['nudge', 'hyoshigi'], 'ashlord', 12, { sparks: 3 });
    const b = boss.enemy; b.turn = 4; b.cursor = 4; boss._newIntent();
    eq([b.intent.label, b.intent.v], ['灰の一撃（加速）', 13], 'sealed boss: attack 9 + rage 4');
    boss.spin(); boss.advance();
    eq([b.intent.k, b.intent.v], ['hex', 2], 'sent to the next cell');
    // rage depends on real turns only
    const g = boss._ghostOf(b); g.cursor = 6; g.turn = 4;
    eq(D.ENEMIES.ashlord.ai(g, { rng: boss.rng, mostStocked: () => 'blade' }).v, 9, 'jam 5 + rage 4 (turn, not cursor)');
  }

  section('boss: reverse wheel marks and the doom countdown');
  {
    const run = fightRun(SD, ['nudge', 'hyoshigi'], 'ashlord', 12, { sparks: 4 });
    const e = run.enemy;
    e.seals = 0; e.phase = 2; e.markIdx = null; run._newIntent();
    eq(e.intent.now.sym, 'blade', 'phase 2 starts by sealing blade');
    run.spin(); run.advance();
    eq([e.intent.now.sym, e.intent.now.next], ['flame', 'ward'], 'sending: 剣封じ -> 焔封じ (next shows 盾)');
    run.resolve();
    eq(e.intent.now.sym, 'ward', 'the rotation continues from where it was sent');
    // phase 3: doom countdown
    e.phase = 3; e.doom = null; e.hp = Math.floor(e.maxHp * 0.25);
    run.fight.advanced = false; run.phase = 'idle';
    e.intent = run._nextCell(e); e.now = e.intent.now;
    eq([e.intent.label, e.intent.doomN], ['破滅の秒読み', 3], 'doom 3');
    run.sparks = 4; run.spin(); run.advance();
    eq(e.intent.doomN, 2, 'sending moves the countdown: 3 -> 2');
    run.resolve();
    eq(e.intent.k, 'doom', 'after the turn: 灰燼');
    run.sparks = 4; run.spin();
    ok(run.advanceBlock() === 'locked', '灰燼 cannot be sent away');
  }

  section('abbot: 蘇生 can be skipped, the mark follows the most-stocked symbol');
  {
    const run = fightRun(SD, ['nudge', 'hyoshigi'], 'abbot', 8, { sparks: 3 });
    const e = run.enemy;
    e.cursor = 3; e.intent = D.ENEMIES.abbot.ai(e, run); e.now = e.intent.now || null;
    eq([e.intent.k, e.intent.v], ['heal', 10], '蘇生 10');
    run.spin(); run.advance();
    eq([e.intent.label, e.intent.now.sym], ['封じ', run.mostStocked()], '蘇生 skipped -> 封じ (most-stocked symbol)');
  }

  section('shade: a reflect stance can be sent to an open attack turn');
  {
    const run = fightRun(SD, ['nudge', 'hyoshigi'], 'shade', 10, { sparks: 3 });
    const e = run.enemy;
    eq(e.now && e.now.k, 'reflect', 'shade opens with 鏡の構え');
    run.spin();
    const P = run.previewAdvance();
    ok(P && P.R && P.R.reflectIn === 0, 'preview: no reflection after sending');
    run.advance();
    ok(!e.now, 'after sending: the stance is gone this turn');
  }

  section('previews never touch the run or its RNG');
  {
    const run = fightRun(SD, ['nudge', 'respin', 'hyoshigi', 'borrow', 'echo', 'stasis', 'chain', 'bond'], 'rat', 2, { sparks: 0 });
    run.spin();
    const snap = () => JSON.stringify(run, (k, v) => (k === 'rng' || k === 'mods' ? undefined : v)) + '|' + run.rng.state();
    const s0 = snap();
    for (let i = 0; i < 20; i++) { run.scriptBand(); run.previewTurn(); run.previewAdvance(); run.previewBorrow(); run.needsDecision(); run.shouldAutoResolve(); run.borrowWorthwhile(); }
    eq(snap(), s0, 'state + RNG identical after 20 rounds of previews');
    const B = run.scriptBand();
    const idleRun = fightRun(SD, ['nudge'], 'rat', 2);
    idleRun.enemy.intent = { k: 'attack', v: 5 }; idleRun.enemy.lastK = 'attack';
    const IB = idleRun.scriptBand();
    ok(IB.cells.find((c) => c.role === 'next').unknown, 'the rat\'s dice-driven next cell is shown as unknown');
    idleRun.enemy.intent = { k: 'charge', label: '身構え', next: 10 };
    const IB2 = idleRun.scriptBand();
    const n = IB2.cells.find((c) => c.role === 'next');
    ok(!n.unknown && n.it.heavy && n.it.v === 10, 'after a charge, the rat\'s bite is certain and shown');
    void B;
  }

  section('borrowing (借り火): one turn, once per fight, paid with the script');
  {
    const run = fightRun(SD, ['nudge', 'respin', 'borrow'], 'sentry', 6, { sparks: 0 });
    const e = run.enemy;
    run.spin();
    ok(run.canBorrow(), 'can borrow at 0 sparks');
    ok(!run.canNudge(0, 1), 'no nudge without sparks');
    const PB = run.previewBorrow();
    const debtCell = PB.band.cells.find((c) => c.role === 'debt');
    ok(debtCell && debtCell.it.k === 'guard', 'the band shows the debt cell (guard 10) before borrowing');
    run.borrow();
    eq([run.sparks, run.sparkAvail()], [0, 1], 'one usable spark, none stored');
    ok(run.canNudge(0, 1), 'the borrowed spark pays for a nudge');
    ok(!run.canBorrow(), 'cannot borrow again while one is held');
    run.nudge(0, 1);
    eq(run.sparkAvail(), 0, 'spent');
    const ev = run.resolve();
    const debts = ev.filter((x) => x.t === 'debtAction');
    eq(debts.length, 1, 'the debt is paid once');
    eq(debts[0].intent.k, 'guard', 'the Ashwheel also took its next cell (guard)');
    eq([e.cursor, e.turn, e.intent.k], [2, 1, 'charge'], 'script moved two cells in one turn');
    run.spin();
    ok(!run.canBorrow(), 'once per fight');
    // an unused borrowed spark vanishes, and is never added to stored sparks by gains
    const r2 = fightRun(SD, ['nudge', 'borrow'], 'moth', 6, { sparks: 0 });
    r2.spin(); r2.borrow();
    setPayline(r2, ['lantern', 'lantern', 'lantern']);
    r2.resolve();
    ok(r2.fight.borrowed === 0, 'borrowed spark is gone after the turn');
    eq(r2.sparks, 1, 'gains this turn: only the lantern\'s own +1 is stored, the borrowed spark is not');
    // the next fight starts clean
    const r3 = fightRun(SD, ['nudge', 'borrow'], 'moth', 6, { sparks: 0 });
    r3.spin();
    ok(r3.canBorrow() && r3.fight.borrowed === 0 && !r3.fight.borrowUsed, 'a new fight: can borrow again, nothing carried');
    const r4 = fightRun(SD, ['nudge', 'borrow'], 'moth', 6, { sparks: 1 });
    r4.spin();
    ok(!r4.canBorrow(), 'cannot borrow while holding a spark');
  }

  section('debt + 怯み: the heavy is struck out, the Ashwheel takes the cell after it');
  {
    const run = fightRun(SD, ['nudge', 'respin', 'borrow'], 'sentry', 6, { sparks: 0 });
    const e = run.enemy;
    e.cursor = 2; e.intent = D.ENEMIES.sentry.ai(e, run); e.now = null;
    eq(e.intent.k, 'charge', 'sentry is winding up');
    run.spin();
    setPayline(run, ['ward', 'ward', 'flame']);
    run.borrow();
    const B = run.scriptBand();
    eq(B.cells.map((c) => c.role), ['now', 'skip', 'debt', 'next', 'next2'], 'band: now, struck heavy, debt, next, next2');
    const ev = run.resolve();
    ok(ev.some((x) => x.t === 'staggerCancel'), 'staggered');
    const d = ev.find((x) => x.t === 'debtAction');
    ok(d && d.intent.k === 'attack' && d.intent.v === 8, 'debt = the attack after the cancelled heavy');
  }

  section('zero sparks: what still decides the turn');
  {
    const plain = fightRun(SD, ['nudge', 'respin'], 'sentry', 6, { sparks: 0 });
    plain.fight.freeRespinUsed = true;
    plain.spin();
    ok(!plain.needsDecision() && plain.shouldAutoResolve(), 'no sparks, nothing free, no borrow: the turn resolves by itself');
    const b = fightRun(SD, ['nudge', 'respin', 'borrow'], 'sentry', 6, { sparks: 0 });
    b.fight.freeRespinUsed = true;
    b.spin();
    setPayline(b, ['blade', 'blade', 'ward']);
    // make the reel-3 cell below the payline a blade: a one-nudge trine
    const r = b.reels[2]; const below = (r.pos + 1) % r.strip.length; r.strip[below].s = 'blade';
    ok(b.borrowWorthwhile(), 'a one-nudge trine is worth borrowing for');
    ok(b.needsDecision() && !b.shouldAutoResolve(), 'so the 0-spark turn waits for the player');
    b.borrow(); b.nudge(2, 1);
    ok(b.shouldAutoResolve(), 'after the borrowed nudge: resolves');
    eq(b.stats.lockedTurns, 0, 'not a locked turn (borrowing was possible)');
    eq(plain.stats.lockedTurns, 1, 'the plain run counts a fully locked turn');
  }

  section('trine / bond auto-resolve');
  {
    const early = fightRun(SD, ['nudge', 'respin'], 'sentry', 6, { sparks: 2 });
    early.spin(); setPayline(early, ['flame', 'flame', 'flame']);
    ok(early.shouldAutoResolve(), 'early game: a trine fires at once');
    const late = fightRun(SD, ['nudge', 'respin', 'stasis'], 'sentry', 6, { sparks: 2 });
    late.spin(); setPayline(late, ['flame', 'flame', 'flame']);
    ok(!late.shouldAutoResolve() && late.comboPauseReason(), 'with 継ぎ留め: the trine waits while something can be done');
    const scr = fightRun(SD, ['nudge', 'respin', 'hyoshigi'], 'sentry', 6, { sparks: 2 });
    scr.spin(); setPayline(scr, ['heart', 'heart', 'heart']);
    ok(!scr.shouldAutoResolve(), 'with 拍子木: the trine waits');
    eq(scr.comboPauseReason(), 'overheal', 'reason: the heal would overflow');
    const kill = fightRun(SD, ['nudge', 'respin', 'hyoshigi'], 'sentry', 6, { sparks: 2 });
    kill.enemy.hp = 5; kill.spin(); setPayline(kill, ['blade', 'blade', 'blade']);
    ok(kill.shouldAutoResolve(), 'a killing trine still fires at once');
    const dry = fightRun(SD, ['nudge', 'hyoshigi'], 'sentry', 6, { sparks: 0 });
    dry.spin(); setPayline(dry, ['flame', 'flame', 'flame']);
    ok(dry.shouldAutoResolve(), 'nothing possible: fires at once');
    const off = profileWith(SD, ['stasis', 'hyoshigi', 'nudge'], (p) => { p.settings.comboPause = 'off'; });
    ok(!SD.Meta.computeMods(off).comboPause, 'setting "off" keeps the old behaviour');
  }

  section('boss act changes: the band never guesses');
  {
    const run = fightRun(SD, ['nudge', 'respin', 'hyoshigi'], 'ashlord', 12, { sparks: 3 });
    const e = run.enemy;
    e.seals = 1;
    const IB = run.scriptBand();
    eq(IB.cells.find((c) => c.role === 'next').cond, 'seal', 'idle, 1 seal left: next is conditional on the seals');
    run.spin(); setPayline(run, ['flame', 'flame', 'flame']);
    const B = run.scriptBand();
    const nx = B.cells.find((c) => c.role === 'next');
    ok(!nx.cond && nx.it.now && nx.it.now.k === 'mark', 'spun with a seal-breaking trine: next is exactly the reverse wheel');
    run.resolve();
    eq(strip(e.intent), strip(nx.it), 'and it is what came');
    eq(e.phase, 2, 'phase 2');
  }

  section('review fixes: 精妙, sparks for 拍子木, dice never leak, debts are always paid');
  {
    // sending the script is not a reel manipulation: a natural trine gets no 精妙
    const run = fightRun(SD, ['nudge', 'respin', 'hyoshigi', 'precision', 'stasis', 'wild'], 'sentry', 6, { sparks: 3 });
    run.spin(); setPayline(run, ['flame', 'flame', 'flame']);
    const before = run.forecast().flame;
    run.advance();
    eq(run.forecast().flame, before, 'a natural trine after sending the script is not multiplied by 精妙');
    // a hearth-only player who lit 拍子木 has sparks to use it
    const hearth = SD.Meta.computeMods(profileWith(SD, ['cloak', 'thorns', 'bulwark', 'hyoshigi']));
    ok(hearth.sparks && hearth.startSparks > 0 && hearth.script, '拍子木 bought through 蓄え lights the spark candles');
    // borrowWorthwhile also sees the fate key
    const k = fightRun(SD, ['nudge', 'respin', 'borrow', 'fatekey', 'echo', 'stasis', 'longpush', 'deft'], 'sentry', 6, { sparks: 0 });
    k.fight.freeRespinUsed = true; k.fight.freeNudgeLeft = 0; k.mods = Object.assign({}, k.mods, { nudge: false });
    k.spin(); setPayline(k, ['blade', 'blade', 'heart']);
    ok(k.borrowWorthwhile(), 'borrow + 運命の鍵 into a trine is worth stopping for');
    // a debt the fight ended before collecting is carried to the next enemy
    const c = fightRun(SD, ['nudge', 'respin', 'borrow'], 'moth', 6, { sparks: 0 });
    c.enemy.hp = 4;
    c.spin(); setPayline(c, ['blade', 'heart', 'ward']);
    c.borrow();
    const ev = c.resolve();
    ok(ev.some((x) => x.t === 'enemyDie') && c.debtCarry, 'enemy killed on the borrowing turn: the debt is carried');
    c.phase = 'start'; c.floor = 7;
    const ev2 = c._startCombat('sentry', {});
    ok(ev2.some((x) => x.t === 'debtCarried') && c.fight.debt && !c.debtCarry, 'the next enemy collects it');
    const IB = c.scriptBand();
    eq(IB.cells.map((x) => x.role), ['now', 'debt', 'next', 'next2'], 'and the band shows it before the first spin');
    c.spin();
    ok(!c.canBorrow(), 'no new borrowing while a debt is owed');
    const ev3 = c.resolve();
    eq(ev3.filter((x) => x.t === 'debtAction').length, 1, 'collected exactly once');
    // dice-drawn debt: the forecast does not reveal it
    const rat = fightRun(SD, ['nudge', 'respin', 'borrow'], 'rat', 2, { sparks: 0 });
    rat.enemy.intent = { k: 'attack', v: 5 }; rat.enemy.lastK = 'attack'; rat.enemy.cursor = 2;
    rat.spin(); rat.borrow();
    const P = rat.previewTurn();
    const B = rat.scriptBand();
    const dc = B.cells.find((x) => x.role === 'debt');
    ok(P.random && dc && dc.unknown && dc.dmg == null, 'a dice-drawn debt cell is unknown and its damage is not shown');
  }

  section('save / load: old saves load, new fields default safely');
  {
    const store = {};
    const fakeLS = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    const ctxSD = currentSD({ localStorage: fakeLS });
    // an old-format profile (as saved by the vertical slice)
    const B = baseSD();
    const old = B.Meta.newProfile();
    old.unlocked.nudge = true; old.unlocked.respin = true; old.unlocked.stasis = true; old.embers = 321; old.stats.runs = 6;
    store[ctxSD.Meta.SAVE_KEY] = JSON.stringify(old);
    // meta.js reads the global localStorage at call time
    const p = ctxSD.Meta.load();
    eq([p.embers, p.stats.runs, !!p.unlocked.stasis], [321, 6, true], 'progress kept');
    eq(p.settings.comboPause, 'smart', 'new setting defaults to "smart"');
    const m = ctxSD.Meta.computeMods(p);
    ok(m.comboPause === true && m.script === false && m.borrow === false, 'mods computed from an old save');
    p.unlocked.hyoshigi = true; p.unlocked.borrow = true; p.embers = 5;
    ctxSD.Meta.save(p);
    const p2 = ctxSD.Meta.load();
    ok(p2.unlocked.hyoshigi && p2.unlocked.borrow, 'new 灯紋 persist');
    // a run summary with the new stats folds into the profile
    const run = new ctxSD.Run(ctxSD.Meta.computeMods(p2), { seed: 3, startFloor: 5 });
    run.begin(); run._die(null);
    const res = ctxSD.Meta.applyRunResult(p2, run.summary);
    ok(res && p2.stats.runs === 7, 'applyRunResult with new stats');
    ok(JSON.parse(store[ctxSD.Meta.SAVE_KEY]).version === 1, 'save version unchanged (old saves are not wiped)');
  }
}

// ================================================================== regression: unchanged without the new 灯紋
function regress(N) {
  section(`regression vs ${BASE_COMMIT}: ${N} runs with random actions, new 灯紋 never lit`);
  const A = baseSD(), Bc = currentSD();
  const NEW = new Set(['borrow', 'hyoshigi']);
  const pick = SD_rng(9090);
  const proj = (run) => {
    const e = run.enemy;
    const it = (x) => (x ? JSON.parse(JSON.stringify(x, (k, v) => (k === 'random' ? undefined : v))) : null);
    return {
      phase: run.phase, hp: run.hp, maxHp: run.maxHp, block: run.block, sparks: run.sparks, embers: run.embers, floor: run.floor,
      reels: run.reels.map((r) => [r.pos, r.held, r.carried, r.jam, r.echo ? r.echo.s : null, r.strip.map((c) => c.s + (c.g ? '*' : '') + (c.temp ? '~' : '')).join(',')]),
      enemy: e ? { id: e.id, hp: e.hp, block: e.block, burn: e.burn, seals: e.seals, phase: e.phase, doom: e.doom, markIdx: e.markIdx, lastK: e.lastK, atk: e.atkBonus, intent: it(e.intent), now: it(e.now) } : null,
      offers: run.offers, doors: run.doors, event: run.event && run.event.id, relics: run.relics,
      stats: ['kills', 'triples', 'bonds', 'spins', 'respins', 'nudges', 'turns', 'damageTaken', 'selfDmg', 'nearMiss', 'zeroSpark', 'burnDealt'].map((k) => run.stats[k]),
    };
  };
  // fields that exist only in the new build (new stats in the run summary, the borrow/skip bookkeeping) are not compared
  const NEW_FIELDS = new Set(['random', 'borrowed', 'skipped', 'advances', 'borrows', 'debtTaken', 'enemyHealed', 'zeroTurns', 'lockedTurns']);
  const evProj = (evs) => JSON.stringify(evs, (k, v) => (NEW_FIELDS.has(k) ? undefined : v))
    .replace(/,"cost":"spark"(?=[,}])/g, '');
  const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
  let mismatches = 0, steps = 0;
  for (let n = 0; n < N; n++) {
    const pr = A.Meta.newProfile();
    pr.stats.runs = pick.int(10);
    if (pick.chance(0.6)) pr.stats.eliteKills.bellhound = 1;
    if (pick.chance(0.3)) pr.stats.eliteKills.abbot = 1;
    for (const s of Bc.Data.SKILLS) if (!NEW.has(s.id) && A.Data.SKILL_BY_ID[s.id] && pick.chance(0.45)) pr.unlocked[s.id] = true;
    const start = pick.pick([1, 1, 5, 5, 8, 12]);
    const seed = 50000 + n;
    const ra = new A.Run(A.Meta.computeMods(JSON.parse(JSON.stringify(pr))), { seed, startFloor: start });
    const rb = new Bc.Run(Bc.Meta.computeMods(JSON.parse(JSON.stringify(pr))), { seed, startFloor: start });
    let ea = ra.begin(), eb = rb.begin();
    let guard = 0;
    while (guard++ < 3000) {
      steps++;
      const pa = proj(ra), pb = proj(rb);
      if (JSON.stringify(pa) !== JSON.stringify(pb) || evProj(ea) !== evProj(eb)) {
        mismatches++;
        if (mismatches <= 3) {
          console.log(`  ✗ run ${n} seed ${seed} step ${guard} diverged`);
          const sa = JSON.stringify(pa) + evProj(ea), sb = JSON.stringify(pb) + evProj(eb), d = firstDiff(sa, sb);
          console.log('    base:', sa.slice(Math.max(0, d - 200), d + 200));
          console.log('    now :', sb.slice(Math.max(0, d - 200), d + 200));
        }
        break;
      }
      if (ra.phase === 'dead' || ra.phase === 'won') break;
      // the same random legal action on both
      const ph = ra.phase;
      if (ph === 'idle') { ea = ra.spin(); eb = rb.spin(); }
      else if (ph === 'spun') {
        const legal = {
          respin: ra.canRespin(), nudge: ra.canNudgeAny(), bless: ra.canBlessAny(), echo: ra.canEchoAny(), key: ra.canFateKey(), hold: ra.mods.holdMax > 0,
        };
        const legalB = { respin: rb.canRespin(), nudge: rb.canNudgeAny(), bless: rb.canBlessAny(), echo: rb.canEchoAny(), key: rb.canFateKey(), hold: rb.mods.holdMax > 0 };
        if (JSON.stringify(legal) !== JSON.stringify(legalB)) { mismatches++; console.log('  ✗ legal actions differ', JSON.stringify(legal), JSON.stringify(legalB)); break; }
        if (ra.needsDecision() !== rb.needsDecision()) { mismatches++; console.log('  ✗ needsDecision differs'); break; }
        // auto-resolve is unchanged once the (intended) combo pause of 継ぎ留め owners is switched off
        rb.mods.comboPause = false;
        if (ra.shouldAutoResolve() !== rb.shouldAutoResolve()) { mismatches++; console.log('  ✗ shouldAutoResolve differs'); break; }
        const k = pick.int(9);
        if (k === 0 && legal.respin) { const m = [0, 1, 2].filter(() => pick.chance(0.4)); for (const i of m) { ra.toggleHold(i); rb.toggleHold(i); } ea = ra.respin(); eb = rb.respin(); }
        else if (k === 1 && legal.nudge) { const i = pick.int(3), d = pick.chance(0.5) ? 1 : -1; ea = ra.nudge(i, d); eb = rb.nudge(i, d); }
        else if (k === 2 && legal.bless) { let i = 0; while (i < 3 && !ra.canBless(i)) i++; ea = ra.bless(i); eb = rb.bless(i); }
        else if (k === 3 && legal.echo) { let done = false; for (let a = 0; a < 3 && !done; a++) for (let b = 0; b < 3 && !done; b++) if (ra.canEcho(a, b)) { ea = ra.echo(a, b); eb = rb.echo(a, b); done = true; } }
        else if (k === 4 && legal.key) { const i = pick.int(3); const ci = pick.int(ra.reels[i].strip.length); ea = ra.fateKey(i, ci); eb = rb.fateKey(i, ci); }
        else if (k === 5 && legal.hold) { const i = pick.int(3); ea = ra.toggleHold(i); eb = rb.toggleHold(i); }
        else { ea = ra.resolve(); eb = rb.resolve(); }
      } else if (ph === 'crossroads') {
        const oi = ra.offers && ra.offers.length && pick.chance(0.85) ? pick.int(ra.offers.length) : null;
        const di = pick.int(ra.doors.length);
        ea = ra.choose(oi, di); eb = rb.choose(oi, di);
      } else if (ph === 'event') {
        const id = pick.pick(ra.event.options).id;
        ea = ra.chooseEvent(id); eb = rb.chooseEvent(id);
      } else if (ph === 'chisel') {
        if (pick.chance(0.2)) { ea = ra.finishChisel(); eb = rb.finishChisel(); }
        else { const ri = pick.int(3), ci = pick.int(ra.reels[ri].strip.length); ea = ra.chiselCell(ri, ci); eb = rb.chiselCell(ri, ci); }
      } else break;
    }
  }
  ok(mismatches === 0, `identical play without the new 灯紋 (${mismatches} diverged runs, ${steps} steps compared)`);
}
function SD_rng(seed) { const S = currentSD(); return S.Util.makeRng(seed); }

// ================================================================== boss fuzz: every act, with 拍子木 / 借り火, next AND next2 checked
function bossFuzz(N) {
  section(`boss fuzz: ${N} fights from random boss states (seals / phase / doom / mark), random play incl. sends and borrows`);
  const SD = currentSD();
  const R = SD.Util.makeRng(777);
  const clean = (x) => JSON.stringify(x, (k, v) => (k === 'random' ? undefined : v));
  let next1 = 0, next2 = 0, bad = 0, phases = { 1: 0, 2: 0, 3: 0 }, sends = 0, borrows = 0;
  for (let n = 0; n < N; n++) {
    const ids = SD.Data.SKILLS.filter(() => R.chance(0.55)).map((s) => s.id).concat(['nudge', 'respin', 'hyoshigi', 'borrow']);
    const run = fightRun(SD, ids, 'ashlord', 12, { seed: 300 + n });
    const e = run.enemy;
    // a random point in the fight
    e.seals = R.pick([3, 2, 1, 1, 0, 0, 0]);
    e.hp = Math.max(10, Math.round(e.maxHp * (0.08 + R.next() * 0.9)));
    if (e.seals === 0) { e.phase = e.hp <= e.maxHp * 0.3 ? 3 : 2; e.markIdx = R.int(4); e.doom = e.phase === 3 ? R.pick([null, 3, 2, 1]) : null; }
    e.turn = R.int(6); e.cursor = e.turn + R.int(3);
    e.intent = run._readCell(e); e.now = e.intent.now || null;
    run.sparks = R.int(run.maxSparks + 1);
    let pendingNext2 = null; // { it, turnsLeft }
    for (let t = 0; t < 40 && run.phase === 'idle' && run.enemy === e; t++) {
      phases[e.phase]++;
      run.spin();
      let touched = false;
      for (let a = 0; a < 3; a++) {
        const k = R.int(6);
        if (k === 0 && run.canAdvance()) { run.advance(); sends++; touched = true; }
        else if (k === 1 && run.canBorrow()) { run.borrow(); borrows++; touched = true; }
        else if (k === 2 && run.canNudgeAny()) { const i = R.int(3); if (run.canNudge(i, 1)) run.nudge(i, 1); }
      }
      if (run.phase !== 'spun') break;
      const B = run.scriptBand();
      const n1 = B && B.cells.find((c) => c.role === 'next'), n2 = B && B.cells.find((c) => c.role === 'next2');
      const ev = run.resolve();
      const scriptEv = ev.some((x) => x.t === 'staggerCancel' || x.t === 'debtAction');
      if (pendingNext2 && (touched || scriptEv)) pendingNext2 = null; // the script was moved: the old next2 no longer applies
      if (run.enemy !== e || run.phase !== 'idle') break;
      if (n1 && !n1.unknown && !n1.cond) { next1++; if (clean(n1.it) !== clean(e.intent)) { bad++; if (bad < 4) console.log('  ✗ boss next', clean(n1.it), clean(e.intent)); } }
      if (pendingNext2) { next2++; if (clean(pendingNext2) !== clean(e.intent)) { bad++; if (bad < 4) console.log('  ✗ boss next2', clean(pendingNext2), clean(e.intent)); } pendingNext2 = null; }
      if (n2 && !n2.unknown && !n2.cond && !scriptEv) pendingNext2 = n2.it;
    }
  }
  console.log(`  checked next ${next1}, next2 ${next2}; turns by act ${JSON.stringify(phases)}; sends ${sends}, borrows ${borrows}`);
  ok(bad === 0 && next2 > 100 && phases[2] > 100 && phases[3] > 100, `boss band honest across acts (${bad} mismatches)`);
}

const mode = process.argv[2] || 'all';
if (mode === 'all' || mode === 'unit') unit();
if (mode === 'all' || mode === 'regress') regress(+process.argv[3] || 400);
if (mode === 'all' || mode === 'boss') bossFuzz(+process.argv[3] || 600);
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
