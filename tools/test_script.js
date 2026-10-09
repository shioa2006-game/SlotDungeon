/* EMBERWHEEL — tests for 灰輪の台本 (script band / 拍子木) and 借り火 (borrowing), plus a regression
 * check that the game is unchanged for players who have not lit the new 灯紋.
 *   node tools/test_script.js            (all)
 *   node tools/test_script.js unit       (unit tests only)
 *   node tools/test_script.js regress [runs]
 *   node tools/test_script.js bell [fights]  灰鐘の番人: the 構え / 大鐘 previews against random play (sends, borrows, 連鎖)
 *   node tools/test_script.js kurite [fights] 深淵の繰り手「四本の糸」(B17): the lift cut, the strings of the HP bar — previews against random play
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
    // (the debt carry-over to the next fight was removed by the AE audit: see section "AE audit")
    // dice-drawn debt: the forecast does not reveal it
    const rat = fightRun(SD, ['nudge', 'respin', 'borrow'], 'rat', 2, { sparks: 0 });
    rat.enemy.intent = { k: 'attack', v: 5 }; rat.enemy.lastK = 'attack'; rat.enemy.cursor = 2;
    rat.spin(); rat.borrow();
    const P = rat.previewTurn();
    const B = rat.scriptBand();
    const dc = B.cells.find((x) => x.role === 'debt');
    ok(P.random && dc && dc.unknown && dc.dmg == null, 'a dice-drawn debt cell is unknown and its damage is not shown');
  }

  section('AE audit (2026-10-08): 0-spark stops, debt inside the fight, sends, act changes, combo pause');
  {
    // 1. 0 sparks + borrow unused + a borrowed nudge that keeps the party alive -> the turn waits
    const a = fightRun(SD, ['nudge', 'respin', 'borrow'], 'sentry', 6, { sparks: 0 });
    a.fight.freeRespinUsed = true;
    a.spin(); setPayline(a, ['ward', 'blade', 'flame']);
    { const r = a.reels[1]; r.strip[(r.pos + 1) % r.strip.length].s = 'ward'; }
    a.hp = 3;
    ok(a.previewTurn().partyDies, '(setup) lethal without borrowing');
    ok(a.borrowWorthwhile() && a.needsDecision() && !a.shouldAutoResolve(), '1. lethal turn, a borrowed ward pair saves: the turn waits (borrow / accept)');
    // 1b. same with a natural trine forecast (early game, no 継ぎ留め/拍子木): the trine no longer skips the choice
    const a2 = fightRun(SD, ['nudge', 'respin', 'borrow'], 'sentry', 6, { sparks: 0 });
    a2.fight.freeRespinUsed = true;
    a2.spin(); setPayline(a2, ['heart', 'heart', 'heart']);
    a2.hp = 30;
    const a2stop = a2.borrowWorthwhile();
    eq(a2.shouldAutoResolve(), !a2stop, '1b. a combo at 0 sparks waits exactly when a borrowed spark would change the turn');
    // 2. borrow already used: no needless stop
    const b = fightRun(SD, ['nudge', 'respin', 'borrow'], 'sentry', 6, { sparks: 0 });
    b.fight.freeRespinUsed = true; b.fight.borrowUsed = true;
    b.spin(); setPayline(b, ['ward', 'blade', 'flame']);
    ok(!b.canBorrow() && b.shouldAutoResolve(), '2. 0 sparks, borrow already used: resolves at once');
    // 3. 0 sparks, borrowing would change nothing material: no needless stop
    const c3 = fightRun(SD, ['nudge', 'respin', 'borrow'], 'moth', 6, { sparks: 0 });
    c3.fight.freeRespinUsed = true;
    c3.enemy.cursor = 0; c3.enemy.intent = c3._readCell(c3.enemy); c3.enemy.now = null; // hex: no attack this turn
    c3.spin();
    c3.reels.forEach((r) => { r.strip = r.strip.map((x) => Object.assign({}, x, { s: 'lantern', g: false })); r.pos = 0; });
    ok(!c3.borrowWorthwhile() && c3.shouldAutoResolve(), '3. 0 sparks, nothing a borrowed spark could change: resolves at once');
    // 4. a send (even with the last spark) leaves the turn open; the player confirms
    const d = fightRun(SD, ['nudge', 'respin', 'hyoshigi', 'borrow', 'stasis'], 'sentry', 6, { sparks: 1 });
    d.fight.freeRespinUsed = true; d.fight.freeNudgeLeft = 0;
    d.spin(); setPayline(d, ['blade', 'heart', 'ward']);
    d.advance();
    ok(d.sparks === 0 && !d.shouldAutoResolve(), '4. last spark spent on 台本送り: the turn waits for 発動');
    const d2 = fightRun(SD, ['nudge', 'respin', 'hyoshigi', 'stasis'], 'sentry', 6, { sparks: 2 });
    d2.fight.freeRespinUsed = true; d2.fight.freeNudgeLeft = 0;
    d2.spin(); setPayline(d2, ['blade', 'heart', 'ward']); d2.toggleHold(0); d2.toggleHold(1); d2.reels[2].jam = true;
    d2.advance();
    ok(!d2.shouldAutoResolve(), '4b. send with every reel held/jammed: still waits (holds can be released, then 発動)');
    d2.toggleHold(1);
    ok(d2.canNudge(1, 1), '4c. after the send the player can still release a hold and nudge');
    // 5. borrow, kill the enemy: nothing reaches the next fight
    const k5 = fightRun(SD, ['nudge', 'respin', 'borrow'], 'moth', 6, { sparks: 0 });
    k5.enemy.hp = 4;
    k5.spin(); setPayline(k5, ['blade', 'heart', 'ward']); k5.borrow();
    const ev5 = k5.resolve();
    ok(ev5.some((x) => x.t === 'enemyDie') && !k5.debtCarry, '5. borrow + kill: the debt ends with the fight');
    k5.phase = 'start'; k5.floor = 7;
    const ev5b = k5._startCombat('sentry', {});
    ok(!ev5b.some((x) => x.t === 'debtCarried') && !k5.fight.debt && !k5.fight.borrowed && !k5.fight.borrowUsed, '5b. the next fight starts clean (no debt, can borrow again)');
    eq(k5.scriptBand().cells.map((x) => x.role), ['now', 'next', 'next2'], '5c. its band shows no debt cell');
    // 6. borrow, the fight goes on: the debt is collected this enemy turn, once
    const g6 = fightRun(SD, ['nudge', 'respin', 'borrow'], 'sentry', 6, { sparks: 0 });
    g6.spin(); setPayline(g6, ['blade', 'heart', 'ward']); g6.borrow();
    const ev6 = g6.resolve();
    eq([ev6.filter((x) => x.t === 'debtAction').length, g6.enemy.cursor, g6.enemy.turn], [1, 2, 1], '6. debt collected once in the same fight (2 cells, 1 turn)');
    // 8. abbot: every step of its script, sent = shown
    for (let step = 0; step < 6; step++) {
      const ab = fightRun(SD, ['nudge', 'respin', 'hyoshigi'], 'abbot', 8, { sparks: 3 });
      ab.enemy.cursor = step; ab.enemy.intent = ab._readCell(ab.enemy); ab.enemy.now = ab.enemy.intent.now || null;
      ab.spin();
      const P = ab.previewAdvance();
      ab.advance();
      eq(strip(ab.enemy.intent), strip(P.intent), `8. abbot step ${step}: send preview == the intent that is now`);
      const B = ab.scriptBand(), nx = B.cells.find((x) => x.role === 'next');
      ab.resolve();
      if (ab.enemy && !nx.cond && !nx.unknown) eq(strip(ab.enemy.intent), strip(nx.it), `8. abbot step ${step}: band next == next intent after the send`);
    }
    // 10. the last seal breaks this turn: band next is flagged as the next act; a send gives the current act's next cell
    const bs = fightRun(SD, ['nudge', 'respin', 'hyoshigi'], 'ashlord', 12, { sparks: 3 });
    { const e = bs.enemy; e.seals = 1; e.turn = 4; e.cursor = 6; e.hp = 150; e.intent = bs._readCell(e); e.now = e.intent.now || null; }
    bs.spin(); setPayline(bs, ['flame', 'flame', 'flame']);
    const B10 = bs.scriptBand(), n10 = B10.cells.find((x) => x.role === 'next');
    const P10 = bs.previewAdvance();
    ok(n10.actChange === 3 && !n10.cond, '10. band next is an exact cell of act 3, flagged 幕');
    ok(P10.intent.k === 'attack' && !(P10.intent.now) && strip(P10.intent) !== strip(n10.it), '10b. sending gives the sealed act\'s next cell, not the 幕 cell');
    const bsc = bs._clone(); bsc.resolve();
    eq(strip(bsc.enemy.intent), strip(n10.it), '10c. resolving without a send: the 幕 cell is exactly what comes');
    bs.advance();
    eq(strip(bs.enemy.intent), strip(P10.intent), '10d. the send result == its preview');
    // 12. combo pause setting
    const cp = (ids, settings) => { const r = fightRun(SD, ids, 'sentry', 6, { sparks: 2, profile: (p) => Object.assign(p.settings, settings || {}) }); r.spin(); setPayline(r, ['flame', 'flame', 'flame']); return r; };
    ok(cp(['nudge', 'respin']).shouldAutoResolve(), '12. "止まる" before 継ぎ留め/拍子木: a trine fires (setting not active yet)');
    ok(!cp(['nudge', 'respin', 'stasis']).shouldAutoResolve(), '12b. with 継ぎ留め: the trine waits');
    ok(cp(['nudge', 'respin', 'stasis'], { comboPause: 'off' }).shouldAutoResolve(), '12c. setting "常にすぐ発動": the trine fires');
    const cpk = cp(['nudge', 'respin', 'stasis']); cpk.enemy.hp = 5;
    ok(cpk.shouldAutoResolve(), '12d. a killing trine always fires');
    // 13. a profile saved mid-fight carries no battle state
    const store = {};
    const fakeLS = { getItem: (k2) => (k2 in store ? store[k2] : null), setItem: (k2, v) => { store[k2] = String(v); }, removeItem: (k2) => { delete store[k2]; } };
    const S2 = currentSD({ localStorage: fakeLS });
    const prof = S2.Meta.newProfile(); prof.unlocked.nudge = true; prof.unlocked.borrow = true; prof.unlocked.hyoshigi = true;
    const live = new S2.Run(S2.Meta.computeMods(prof), { seed: 5, startFloor: 6 }); live.floor = 6; live.phase = 'start'; live._startCombat('sentry', {});
    live.sparks = 0; live.spin(); live.borrow();
    S2.Meta.save(prof);
    const raw = store[S2.Meta.SAVE_KEY];
    ok(raw && !/borrow(ed|Used)|"debt"|cursor/.test(raw), '13. the saved profile holds no borrow/debt/script battle state');
    const re = S2.Meta.load();
    const fresh = new S2.Run(S2.Meta.computeMods(re), { seed: 5, startFloor: 6 }); fresh.floor = 6; fresh.phase = 'start'; fresh._startCombat('sentry', {});
    ok(!fresh.fight.debt && !fresh.fight.borrowed && !fresh.fight.borrowUsed && fresh.enemy.cursor === 0, '13b. after load a new fight starts clean');
  }

  section('灰の底 (stage 3a): 重ね殻 — attack and shell in one turn, a thick shell at first');
  {
    const ids = ['nudge', 'respin', 'hyoshigi', 'borrow'];
    const h = fightRun(SD, ids, 'husk', 13, { sparks: 2, hp: 80 });
    eq([h.enemy.hp, h.enemy.maxHp, h.enemy.block], [250, 250, 200], 'B13: listed HP, a 200 shell at the start');
    const h15 = fightRun(SD, ids, 'husk', 15, {});
    eq([h15.enemy.hp, h15.enemy.atkBonus], [250, 0], 'B15: no depth scaling in 灰の底');
    // the shell takes direct hits; the preview knows it
    h.spin(); setPayline(h, ['blade', 'blade', 'blade']);
    const P = h.previewTurn();
    const raw = h.forecast().directDmg;
    const ev = h.resolve();
    eq(h.enemy.hp, P.enemyAfter.hp, 'shell: preview == actual');
    eq(h.enemy.hp, 250 - Math.max(0, raw - 200), 'shell absorbs the direct hits first');
    ok(ev.some((x) => x.t === 'enemyGuard') && h.enemy.block === 10, 'its turn: attack 12 and a new shell of 10 (the old one is gone)');
    eq(h.hp, P.hpAfter, 'party HP: preview == actual');
    // burn goes through the shell (a burn tick is not a hit)
    const b = fightRun(SD, ids, 'husk', 13, { sparks: 2, hp: 80 });
    b.enemy.burn = 10;
    b.spin(); setPayline(b, ['lantern', 'lantern', 'lantern']);
    b.resolve();
    eq(b.enemy.hp, 240, 'burn ticks through a 200 shell');
    // the wind-up raises a shell too, and a ward pair still strikes the heavy out
    const c = fightRun(SD, ids, 'husk', 13, { sparks: 2, hp: 80 });
    c.enemy.cursor = 1; c.enemy.intent = c._readCell(c.enemy); c.enemy.now = null; c.enemy.block = 0;
    c.spin(); setPayline(c, ['ward', 'ward', 'lantern']);
    c.resolve();
    eq([c.enemy.block, c.enemy.intent.label], [10, '殻を重ねる'], 'wind-up: shell 10, and two wards strike the heavy out (next comes 殻を重ねる)');
    // the band shows the shells to come
    const d = fightRun(SD, ids, 'husk', 13, { sparks: 2, hp: 80 });
    eq(d.scriptBand().cells.map((x) => x.it.guard || 0), [10, 10, 0], 'band: each cell carries its shell');
    // preview == actual on random lines
    let same = 0, tries = 0;
    for (let s = 1; s <= 30; s++) {
      const r = fightRun(SD, ids, 'husk', 13, { sparks: 2, hp: 80, seed: 100 + s });
      for (let t = 0; t < 4 && r.enemy && r.phase === 'idle'; t++) {
        r.spin();
        const Q = r.previewTurn();
        r.resolve();
        tries++;
        const okE = !r.enemy || r.phase === 'dead' || !Q.enemyAfter || r.enemy.hp === Q.enemyAfter.hp; // (enemyAfter is a read-ahead copy: block is checked in the exact cases above)
        if (okE && (r.hp === Q.hpAfter || (Q.partyDies && r.phase === 'dead'))) same++;
      }
    }
    eq(same, tries, '重ね殻: preview == actual over random turns');
  }

  section('灰の底: 返し鏡 — the seal and when it is decided');
  {
    const ids = ['nudge', 'respin', 'hyoshigi', 'borrow', 'bond'];
    const m = fightRun(SD, ids, 'mirror', 14, { sparks: 3, hp: 80 });
    eq([m.enemy.hp, m.enemy.intent.now && m.enemy.intent.now.k, m.enemy.intent.now && m.enemy.intent.now.sym], [280, 'mark', m.mostStocked()], 'turn 1: the most carved symbol is sealed from the start');
    // idle band: the seals of the coming cells are not decided yet
    eq(m.scriptBand().cells.map((x) => x.cond), [null, 'mirror', 'mirror'], 'before the spin: next / next2 flagged (decided by the coming resolve)');
    const first = m.enemy.intent.now.sym, other = first === 'flame' ? 'blade' : 'flame';
    m.spin(); setPayline(m, [other, other, 'ward']);
    const B = m.scriptBand(), nx = B.cells.find((x) => x.role === 'next');
    ok(!nx.cond && nx.it.now.sym === other, 'after the spin: the next seal is shown exactly (what this line would seal)');
    eq(B.cells.find((x) => x.role === 'next2').cond, 'mirror', 'the cell after: still decided later');
    m.resolve();
    eq(m.enemy.intent.now.sym, other, 'decided at 発動: the symbol that acted most is sealed next turn');
    // sealed cells do not count; nothing acted -> the seal stays
    const s = fightRun(SD, ids, 'mirror', 14, { sparks: 3, hp: 80 });
    s.enemy.mirrorSym = 'blade'; s.enemy.intent = s._readCell(s.enemy); s.enemy.now = s.enemy.intent.now;
    s.spin(); setPayline(s, ['blade', 'blade', 'flame']);
    s.resolve();
    eq(s.enemy.intent.now.sym, 'flame', 'the sealed blades do not count: flame is next');
    const z = fightRun(SD, ids, 'mirror', 14, { sparks: 3, hp: 80 });
    z.enemy.mirrorSym = 'blade'; z.enemy.intent = z._readCell(z.enemy); z.enemy.now = z.enemy.intent.now;
    z.spin(); setPayline(z, ['blade', 'skull', 'blade']);
    z.resolve();
    eq(z.enemy.intent.now.sym, 'blade', 'nothing acted: the seal stays');
    // ties: blade > flame > ward > heart > lantern
    const t = fightRun(SD, ids, 'mirror', 14, { sparks: 3, hp: 80 });
    t.enemy.mirrorSym = 'heart'; t.enemy.intent = t._readCell(t.enemy); t.enemy.now = t.enemy.intent.now;
    t.spin(); setPayline(t, ['ward', 'flame', 'lantern']);
    t.resolve();
    eq(t.enemy.intent.now.sym, 'flame', 'tie: flame before ward and lantern');
    // the seal is the enemy's state: 台本送り does not lift it
    const a = fightRun(SD, ids, 'mirror', 14, { sparks: 3, hp: 80 });
    const before = a.enemy.intent.now.sym;
    a.spin(); a.fight.freeRespinUsed = true; a.advance();
    eq([a.enemy.cursor, a.enemy.intent.now.sym], [1, before], '台本送り moves the script, the seal stays');
    // a borrowed spark (two cells this enemy turn) does not change how the seal is decided
    const w = fightRun(SD, ids, 'mirror', 14, { sparks: 0, hp: 80 });
    w.spin(); w.borrow(); const o2 = w.enemy.intent.now.sym === 'flame' ? 'blade' : 'flame';
    setPayline(w, [o2, o2, 'heart']);
    w.resolve();
    ok(w.enemy.cursor === 2 && w.enemy.intent.now.sym === o2, 'borrow: two cells taken, the seal is still this line\'s');
    // preview == actual (seal included) over random turns
    let same = 0, tries = 0;
    for (let k = 1; k <= 30; k++) {
      const r = fightRun(SD, ids, 'mirror', 14, { sparks: 2, hp: 80, seed: 300 + k });
      for (let u = 0; u < 4 && r.enemy && r.phase === 'idle'; u++) {
        r.spin();
        const Q = r.previewTurn(), nb = r.scriptBand().cells.find((x) => x.role === 'next');
        r.resolve();
        tries++;
        const okE = !r.enemy || r.phase === 'dead' || !Q.enemyAfter || (r.enemy.hp === Q.enemyAfter.hp && (!nb || nb.cond || JSON.stringify(strip(nb.it)) === JSON.stringify(strip(r.enemy.intent))));
        if (okE && (r.hp === Q.hpAfter || (Q.partyDies && r.phase === 'dead'))) same++;
      }
    }
    eq(same, tries, '返し鏡: preview and band == actual over random turns');
  }

  section('灰の底: the descent — offered after a clear, the win settled once, both enemies met');
  {
    const ids = ['nudge', 'respin'];
    const killNow = (r) => {
      const e = r.enemy; e.hp = 1; e.block = 0; e.seals = 0;
      r.spin();
      const mk = e.now && e.now.k === 'mark' ? e.now.sym : null;
      const sym = mk === 'blade' ? 'flame' : 'blade';
      setPayline(r, [sym, sym, sym]);
      return r.resolve();
    };
    // never cleared: the boss ends the run as before (also on the very run that clears)
    const n = fightRun(SD, ids, 'ashlord', 12, {});
    const evn = killNow(n);
    ok(n.phase === 'won' && !n.deep && evn.some((x) => x.t === 'runEnd') && !evn.some((x) => x.t === 'bossSettled'), 'not cleared before: the boss ends the run (no choice)');
    // cleared before: the win is settled, then the choice
    const winP = (p) => { p.stats.wins = 1; };
    const r = fightRun(SD, ids, 'ashlord', 12, { profile: winP });
    const ev = killNow(r);
    const settled = ev.find((x) => x.t === 'bossSettled');
    ok(r.phase === 'descent' && settled && settled.summary.won && settled.summary.settled && !ev.some((x) => x.t === 'runEnd'), 'cleared before: the win is settled, 帰還 / さらに降りる is asked');
    // 帰還: nothing more
    const home = fightRun(SD, ids, 'ashlord', 12, { profile: winP });
    const evh = killNow(home);
    const S1 = evh.find((x) => x.t === 'bossSettled').summary;
    const pUI = SD.Meta.newProfile(); pUI.stats.wins = 1;
    SD.Meta.applyRunResult(pUI, S1); // the UI writes the settled win at once
    const snap = JSON.stringify(pUI);
    const evb = home.chooseDescent(false);
    const end = evb.find((x) => x.t === 'runEnd');
    ok(home.phase === 'won' && end && end.summary === S1 && end.summary.settled, '帰還: the run ends with the settled summary');
    eq(JSON.stringify(pUI), snap, '帰還: the profile is not touched again');
    // さらに降りる: campfire, then B13 / B14 meet the two new enemies, B15 crossroads, B16 elite
    const go = r.chooseDescent(true);
    ok(go.some((x) => x.t === 'descend') && r.phase === 'event' && r.event.id === 'campfire', 'さらに降りる: a campfire first');
    eq(r.deep.order.slice().sort(), ['husk', 'mirror'], 'the order is a permutation of the pair');
    r.chooseEvent('rest');
    const met = [];
    for (let fl = 13; fl <= 16 && r.phase !== 'won' && r.phase !== 'dead'; fl++) {
      let g = 0;
      while (r.phase === 'crossroads' && g++ < 5) {
        const bi = r.doors.findIndex((d) => d.kind === 'battle' || d.kind === 'elite' || d.kind === 'continue');
        r.choose(null, bi >= 0 ? bi : 0);
      }
      if (r.phase === 'event') { r.chooseEvent(r.event.options[r.event.options.length - 1].id); fl--; continue; }
      if (r.phase !== 'idle') break;
      met.push([r.floor, r.enemy.id]);
      killNow(r);
    }
    eq(met.map((x) => x[0]), [13, 14, 15, 16], 'floors 13–16 in order');
    eq(met.slice(0, 2).map((x) => x[1]), r.deep.order, 'B13 / B14: the two new enemies, once each');
    eq(met[3][1], 'bellkeeper', 'B16: the elite (灰鐘の番人)');
    const fin = r.summary;
    ok(r.phase === 'won' && fin.won && fin.deep && fin.deep.cleared && fin.deep.floor === 16, 'B16 cleared: a won, settled run with the descent result');
    // the profile: the UI path (settle, then the descent delta) == one-shot apply; embers counted once
    const p1 = SD.Meta.newProfile(); p1.stats.wins = 1;
    SD.Meta.applyRunResult(p1, fin.base); SD.Meta.applyDeepResult(p1, fin);
    const p2 = SD.Meta.newProfile(); p2.stats.wins = 1;
    SD.Meta.applyFinishedRun(p2, fin);
    eq(JSON.stringify(p1), JSON.stringify(p2), 'settle + descent == one-shot apply');
    eq([p1.stats.runs, p1.stats.wins, p1.stats.deaths, p1.stats.bossKills, p1.stats.deepRuns, p1.stats.deepClears, p1.stats.deepBest], [1, 2, 0, 1, 1, 1, 16], 'one run, one win, one boss kill; one descent cleared');
    eq(p1.embers, r.embers, 'embers: the profile got exactly what the run earned');
    // fallen in 灰の底: still a win, no death counted
    const f = fightRun(SD, ids, 'ashlord', 12, { profile: winP });
    killNow(f); f.chooseDescent(true); f.chooseEvent('rest');
    f.choose(null, 0);
    f.hp = 1; f.block = 0; f.mods = Object.assign({}, f.mods, { secondWind: false });
    f.enemy.intent = { k: 'attack', v: 99 }; f.enemy.now = null;
    f.spin(); setPayline(f, ['lantern', 'lantern', 'lantern']);
    const evd = f.resolve();
    const sd = evd.find((x) => x.t === 'runEnd').summary;
    ok(f.phase === 'dead' && sd.won && sd.deep && !sd.deep.cleared && sd.deep.floor === 13, 'fallen at B13: the run stays won');
    const p3 = SD.Meta.newProfile(); p3.stats.wins = 1;
    SD.Meta.applyFinishedRun(p3, sd);
    eq([p3.stats.runs, p3.stats.wins, p3.stats.deaths, p3.stats.deepRuns, p3.stats.deepClears, p3.embers], [1, 2, 0, 1, 0, f.embers], 'fallen: no death, no clear; embers once');
  }

  section('灰の底 B16 (stage 3b): 灰鐘の番人 — the 構え breaks to hits through the shell, or to two wards');
  {
    const ids = ['nudge', 'respin', 'hyoshigi', 'borrow'];
    // a 灰鐘の番人 fight standing at a chosen script cell, shell and seal (heart sealed: blades and flames act)
    const at = (cursor, block, opts = {}) => {
      const r = fightRun(SD, opts.ids || ids, 'bellkeeper', 16, { sparks: opts.sparks == null ? 3 : opts.sparks, hp: 90, seed: opts.seed });
      const e = r.enemy;
      e.cursor = cursor; e.mirrorSym = opts.seal || 'heart'; e.intent = r._readCell(e); e.now = e.intent.now; e.block = block;
      return r;
    };
    const s0 = fightRun(SD, ids, 'bellkeeper', 16, {});
    eq([s0.enemy.hp, s0.enemy.block, s0.enemy.intent.label, s0.enemy.intent.now.sym], [400, 150, '打ち据え', s0.mostStocked()], 'turn 1: shell 150 and the most carved symbol sealed');
    eq(s0.scriptBand().cells.map((x) => [x.it.label, x.it.guard || 0]), [['打ち据え', 10], ['殻を張る', 60], ['大鐘の構え', 0]], 'band: 打ち据え +10, 殻を張る +60, then the 構え');
    // break: a blade trine (30) through a 20 shell on the 構え turn
    const a = at(2, 20);
    a.spin(); setPayline(a, ['blade', 'blade', 'blade']);
    const Fa = a.forecast(), Pa = a.previewTurn(), Ba = a.scriptBand();
    ok(Fa.staggerBreak && !Fa.staggerWard && Fa.stagger && Fa.shellNeed === 0, 'forecast: the hits break through (shellNeed 0)');
    ok(Pa.skipped && Pa.skipped.label === '大鐘' && Ba.cells.some((c) => c.role === 'skip'), 'preview + band: 大鐘 struck out');
    const eva = a.resolve();
    const iSt = eva.findIndex((x) => x.t === 'stagger'), iHit = eva.findIndex((x) => x.t === 'act' && x.sym === 'blade');
    ok(iSt > iHit && eva[iSt].by === 'break', 'the break shows after the hits (by: break)');
    ok(eva.some((x) => x.t === 'staggerCancel') && !eva.some((x) => x.t === 'enemyAttack' && x.heavy), '大鐘 is struck from the script');
    eq([a.enemy.intent.label, a.enemy.hp], ['打ち据え', 400 - 10], 'next comes 打ち据え; 10 of 30 reached the body');
    // not enough: 30 into a 60 shell — the stance holds and 大鐘 comes
    const b = at(2, 60);
    b.spin(); setPayline(b, ['blade', 'blade', 'blade']);
    const Fb = b.forecast();
    ok(!Fb.stagger && Fb.shellNeed === 31, 'forecast: 31 more needed');
    b.resolve();
    eq([b.enemy.intent.label, b.enemy.intent.heavy, b.enemy.hp], ['大鐘', true, 400], 'the stance held: 大鐘 next, nothing reached the body');
    b.spin(); setPayline(b, ['lantern', 'lantern', 'lantern']);
    const evb = b.resolve();
    ok(evb.some((x) => x.t === 'enemyAttack' && x.heavy && x.raw === 40), '大鐘 40 lands');
    // exactly the shell: nothing reaches the body, no break
    const c = at(2, 30);
    c.spin(); setPayline(c, ['blade', 'blade', 'blade']);
    ok(!c.forecast().stagger && c.forecast().shellNeed === 1, 'exactly the shell (30 vs 30): no break, 1 more needed');
    // no shell left (e.g. 殻を張る was sent away): a single blade reaching the body breaks it
    const d = at(2, 0);
    d.spin(); setPayline(d, ['blade', 'lantern', 'heart']);
    ok(d.forecast().staggerBreak, 'no shell: any direct hit that lands breaks the stance');
    // two wards: the old stagger, shown before the hits
    const w = at(2, 60);
    w.spin(); setPayline(w, ['ward', 'ward', 'lantern']);
    const Fw = w.forecast();
    ok(Fw.staggerWard && !Fw.staggerBreak, 'two wards: a ward stagger');
    const evw = w.resolve();
    ok(evw.find((x) => x.t === 'stagger') && !evw.find((x) => x.t === 'stagger').by && evw.some((x) => x.t === 'staggerCancel'), 'two wards: staggered, 大鐘 struck out');
    // wards and a break together: one stagger
    const wb = at(2, 0);
    wb.spin(); setPayline(wb, ['ward', 'ward', 'blade']);
    const evwb = wb.resolve();
    eq(evwb.filter((x) => x.t === 'stagger').length, 1, 'wards + break: one stagger');
    // what does not break the shell: burn ticks, a reaper (死神)
    const g = at(2, 60);
    g.enemy.burn = 30;
    g.spin(); setPayline(g, ['lantern', 'lantern', 'heart']);
    const evg = g.resolve();
    ok(!evg.some((x) => x.t === 'staggerCancel') && g.enemy.intent.label === '大鐘', 'burn goes round the shell: the stance holds');
    const rp = at(2, 60);
    rp.spin(); setPayline(rp, ['skull', 'skull', 'skull']);
    ok(rp.forecast().reaper > 0 && !rp.forecast().stagger, '死神 goes round the shell: no break');
    // the pact's skulls are direct hits: the shell takes them, and they can break it
    const sp = at(2, 5, { ids: ids.concat(['kindle', 'skullpact']) });
    sp.spin(); setPayline(sp, ['skull', 'skull', 'lantern']);
    ok(sp.forecast().staggerBreak, '髑髏の契約: 10 into a 5 shell breaks it');
    // only on the 構え turn
    const n = at(1, 10);
    n.spin(); setPayline(n, ['blade', 'blade', 'blade']);
    ok(!n.forecast().stagger, '殻を張る turn: hits through the shell do nothing to the script');
    // 台本送り: send 殻を張る away — the 構え comes now behind the thin 打ち据え shell (10), and a pair (12) breaks it
    const h = at(1, 10);
    h.spin(); setPayline(h, ['blade', 'blade', 'lantern']);
    h.advance();
    eq([h.enemy.intent.label, h.enemy.block], ['大鐘の構え', 10], 'sent: the 構え is now, behind the old 10 shell');
    const Ph = h.previewTurn();
    ok(h.forecast().staggerBreak && Ph.skipped && Ph.skipped.label === '大鐘', 'sent: the forecast and preview see the break');
    const evh = h.resolve();
    ok(evh.some((x) => x.t === 'stagger' && x.by === 'break') && evh.some((x) => x.t === 'staggerCancel') && h.enemy.intent.label === '打ち据え', 'sent: broken, 大鐘 struck out');
    // 借り火 on the 構え turn: broken, then the debt takes the cell after 大鐘 — exactly as previewed
    const br = at(2, 20, { sparks: 0 });
    br.spin(); br.borrow(); setPayline(br, ['blade', 'blade', 'blade']);
    const Pbr = br.previewTurn(), Bbr = br.scriptBand();
    const evbr = br.resolve();
    const dA = evbr.find((x) => x.t === 'debtAction');
    ok(Pbr.skipped && Pbr.debt && dA && JSON.stringify(strip(Pbr.debt)) === JSON.stringify(strip(dA.intent)) && dA.intent.label === '打ち据え', 'borrow + break: 大鐘 struck, the debt is 打ち据え (as previewed)');
    eq(br.enemy.intent.label, '殻を張る', 'borrow + break: then 殻を張る');
    eq(Bbr.cells.map((x) => x.role), ['now', 'skip', 'debt', 'next', 'next2'], 'borrow + break: the band shows skip and debt');
    // 借り火 the turn before: 殻を張る and the 構え both play now — there is no 構え turn to break, 大鐘 comes
    const bb = at(1, 10, { sparks: 0 });
    bb.spin(); bb.borrow(); setPayline(bb, ['lantern', 'lantern', 'heart']);
    const Pbb = bb.previewTurn();
    bb.resolve();
    ok(Pbb.debt && Pbb.debt.label === '大鐘の構え' && bb.enemy.intent.label === '大鐘' && bb.enemy.block === 60, 'borrow before: the 構え is played with the debt, 大鐘 next behind the 60 shell');
    // 連鎖: the first line chips the shell (30 of 40), the bonus line breaks the rest — judged on both lines together
    const ch = at(2, 40, { ids: ids.concat(['whet', 'bond', 'kindle', 'execute', 'pyre', 'twin', 'trine', 'chain', 'momentum']) });
    ch.mods = Object.assign({}, ch.mods, { bladeBonus: 0, trineMult: 2.5, pairMult: 1.5, burnPerFlame: 0, execute: false }); // keep the numbers simple
    ch.spin(); setPayline(ch, ['blade', 'blade', 'blade']);
    const Fch = ch.forecast(), Pch = ch.previewTurn();
    ok(!Fch.stagger && Pch.chain && Pch.random, '連鎖 armed: the first line alone does not break; the preview says the bonus spin decides');
    const want = ['blade', 'blade', 'lantern'];
    const q = ch.reels.map((r, i) => r.strip.findIndex((x) => x.s === want[i] && !x.temp));
    const realInt = ch.rng.int.bind(ch.rng); let qi = 0;
    ch.rng.int = (m) => (qi < 3 ? q[qi++] : realInt(m));
    const evch = ch.resolve();
    ok(evch.some((x) => x.t === 'chain') && evch.some((x) => x.t === 'stagger' && x.by === 'break') && evch.some((x) => x.t === 'staggerCancel'), '連鎖: the bonus line (12) breaks the 10 left — 大鐘 struck out');
    // records: the elite's kill is its own; the stage 3a stand-in's kills never count as its first kill
    const pk = SD.Meta.newProfile(); pk.stats.eliteKills.abbot_deep = 3;
    const dres = (kills) => ({ floor: 16, stats: { maxHit: 0 }, deep: { floor: 16, cleared: true, embers: 0, kills: 1, triples: 0, bonds: 0, eliteKills: kills } });
    const r1 = SD.Meta.applyDeepResult(pk, dres(['bellkeeper']));
    const r2 = SD.Meta.applyDeepResult(pk, dres(['bellkeeper']));
    ok(r1.firstDeepElite && !r2.firstDeepElite && pk.stats.eliteKills.bellkeeper === 2 && pk.stats.eliteKills.abbot_deep === 3, 'first kill flagged once; the stand-in kills are kept but separate');
  }

  section('灰の底への入り口 (stage 3a+): 第三層から / 灰の底から');
  {
    const ids = ['nudge', 'respin'];
    const cleared = (extra) => (p) => { p.stats.eliteKills = { bellhound: 1, ashlord: 1 }; p.stats.wins = 1; if (extra) extra(p); };
    // when the shortcuts open
    eq(SD.Meta.computeMods(profileWith(SD, ids, (p) => { p.stats.eliteKills.bellhound = 1; })).shortcuts, [5], 'before the clear: only 第二層から');
    eq(SD.Meta.computeMods(profileWith(SD, ids, cleared())).shortcuts, [5, 9], 'after the clear: 第三層から opens');
    eq(SD.Meta.computeMods(profileWith(SD, ids, cleared((p) => { p.stats.deepRuns = 1; }))).shortcuts, [5, 9, 13], 'after one 灰の底 run: 灰の底から opens');
    // the kits (spent inside the run, nothing owned at the start)
    const kitOf = (floor) => {
      const r = new SD.Run(SD.Meta.computeMods(profileWith(SD, ids, cleared())), { seed: 3, startFloor: floor });
      r.begin();
      const all = [r.offerKind].concat(r.pending);
      return [all.filter((k) => k === 'carving').length, all.filter((k) => k === 'relic').length, r.relics.length];
    };
    eq(kitOf(9), [4, 4, 0], 'B9 kit: 4 carvings + 4 relics');
    eq(kitOf(13), [4, 4, 0], 'B13 kit: 4 carvings + 4 relics, a fresh run (no relic owned)');
    const killNow = (r) => {
      const e = r.enemy; e.hp = 1; e.block = 0; e.seals = 0;
      r.spin();
      const mk = e.now && e.now.k === 'mark' ? e.now.sym : null;
      const sym = mk === 'blade' ? 'flame' : 'blade';
      setPayline(r, [sym, sym, sym]);
      return r.resolve();
    };
    const toFight = (r) => { let g = 0; while (r.phase !== 'idle' && r.phase !== 'dead' && r.phase !== 'won' && g++ < 30) {
      if (r.phase === 'crossroads') { const bi = r.doors.findIndex((d) => d.kind === 'battle' || d.kind === 'elite' || d.kind === 'continue'); r.choose(null, bi >= 0 ? bi : 0); }
      else if (r.phase === 'event') r.chooseEvent(r.event.options[r.event.options.length - 1].id);
      else if (r.phase === 'chisel') r.finishChisel();
      else break;
    } };
    // B9: setting out earns nothing; the 50 comes only with the boss
    const g0 = new SD.Run(SD.Meta.computeMods(profileWith(SD, ids, cleared())), { seed: 4, startFloor: 9 });
    g0.begin(); g0._die(null);
    eq(g0.summary.embers, 0, 'B9: set out and give up at once -> 0 embers');
    const g1 = new SD.Run(SD.Meta.computeMods(profileWith(SD, ids, cleared())), { seed: 4, startFloor: 9 });
    g1.begin(); toFight(g1);
    ok(g1.phase === 'idle' && g1.floor === 9, '(setup) B9 first fight');
    g1._die(g1.enemy);
    eq(g1.summary.embers, 0, 'B9: give up in the first fight -> 0 embers (no depth for the starting floor)');
    const g2 = new SD.Run(SD.Meta.computeMods(profileWith(SD, ids, cleared())), { seed: 4, startFloor: 9 });
    g2.begin(); toFight(g2); killNow(g2);
    eq(g2.emberLog.shortcut || 0, 0, 'B9: the first kill pays no shortcut embers');
    const b = new SD.Run(SD.Meta.computeMods(profileWith(SD, ids, cleared())), { seed: 5, startFloor: 9 });
    b.floor = 12; b.phase = 'start'; b._startCombat('ashlord', {});
    killNow(b);
    eq([b.phase, b.emberLog.shortcut, b.emberLog.depth], ['descent', 50, Math.round(6 * b.mods.emberMult)], 'B9: beating the boss pays the 50 (depth: B10–B12 only, x the ember rate)');
    // B5 is unchanged: 25 at the first kill, full depth
    const f5 = new SD.Run(SD.Meta.computeMods(profileWith(SD, ids, (p) => { p.stats.eliteKills.bellhound = 1; })), { seed: 4, startFloor: 5 });
    f5.begin(); toFight(f5); killNow(f5);
    eq(f5.emberLog.shortcut, 25, 'B5 shortcut unchanged (25 at the first kill)');
    // B13: a 灰の底-only run
    const P = () => profileWith(SD, ids, cleared((p) => { p.stats.deepRuns = 1; p.stats.runs = 9; p.stats.bestFloor = 12; p.stats.lastFloor = 12; p.stats.lastRun = { floor: 12, embers: 99, won: true }; }));
    const d = new SD.Run(SD.Meta.computeMods(P()), { seed: 6, startFloor: 13 });
    d.begin();
    ok(d.deepOnly && d.deep.order.slice().sort().join() === 'husk,mirror', 'B13: a 灰の底-only run, B13 / B14 order rolled at the start');
    const met = [];
    for (let k = 0; k < 6 && d.phase !== 'won' && d.phase !== 'dead'; k++) { toFight(d); if (d.phase !== 'idle') break; met.push([d.floor, d.enemy.id]); killNow(d); }
    eq(met.map((x) => x[0]), [13, 14, 15, 16], 'B13 run: floors 13–16');
    eq(met.slice(0, 2).map((x) => x[1]), d.deep.order, 'B13 run: both new enemies, once each');
    const s = d.summary;
    ok(s.deepOnly && !s.won && !s.settled && s.deep.cleared && s.deep.floor === 16, 'B13 run cleared: a 灰の底 result, not a main-game win');
    eq(s.emberLog.depth, Math.round(6 * d.mods.emberMult), 'B13 run: depth embers for B14–B16 only (x the ember rate)');
    const p = P(); const before = JSON.parse(JSON.stringify(p.stats)); const e0 = p.embers;
    SD.Meta.applyFinishedRun(p, s);
    eq([p.stats.runs, p.stats.wins, p.stats.deaths, p.stats.bossKills, p.stats.bestFloor, p.stats.lastFloor, JSON.stringify(p.stats.lastRun)],
      [before.runs, before.wins, before.deaths, before.bossKills, before.bestFloor, before.lastFloor, JSON.stringify(before.lastRun)], 'B13 run: the main-game record is untouched');
    eq([p.stats.deepRuns, p.stats.deepClears, p.stats.deepFalls, p.stats.deepBest], [2, 1, 0, 16], 'B13 run: 灰の底 record (runs, clears, falls, deepest)');
    eq(p.embers - e0, d.embers, 'B13 run: embers counted once');
    // fallen at B13: a 灰の底 fall, never a death
    const f = new SD.Run(SD.Meta.computeMods(P()), { seed: 7, startFloor: 13 });
    f.begin(); toFight(f);
    f.hp = 1; f.block = 0; f.mods = Object.assign({}, f.mods, { secondWind: false }); f.enemy.intent = { k: 'attack', v: 99 }; f.enemy.now = null;
    f.spin(); setPayline(f, ['lantern', 'lantern', 'lantern']); f.resolve();
    const pf = P(); SD.Meta.applyFinishedRun(pf, f.summary);
    eq([f.phase, f.summary.won, pf.stats.deaths, pf.stats.deepFalls, pf.stats.deepRuns], ['dead', false, 0, 1, 2], 'B13 run fallen: a 灰の底 fall, not a death');
    const z = new SD.Run(SD.Meta.computeMods(P()), { seed: 8, startFloor: 13 });
    z.begin(); z._die(null);
    eq(z.summary.embers, 0, 'B13: set out and give up at once -> 0 embers');
    // a descent fall counts as a 灰の底 fall too (and still no death)
    const pd = SD.Meta.newProfile(); pd.stats.wins = 1;
    SD.Meta.applyDeepResult(pd, { floor: 14, stats: { maxHit: 0 }, deep: { floor: 14, cleared: false, embers: 3, kills: 1, triples: 0, bonds: 0, eliteKills: [] } });
    eq([pd.stats.deepRuns, pd.stats.deepFalls, pd.stats.deaths], [1, 1, 0], 'a fall after a descent: 灰の底 fall +1, deaths unchanged');
  }

  section('星 (wild): a combo whenever it can make one; hints and odds judge exactly as the resolve');
  {
    const ids = ['nudge', 'respin', 'whet', 'cloak', 'sparkjar', 'wild'];
    const at = (line, opts) => {
      const r = fightRun(SD, (opts && opts.ids) || ids, (opts && opts.enemy) || 'husk', 13, { sparks: 2 });
      if (opts && opts.hp != null) r.hp = Math.round(r.maxHp * opts.hp);
      if (opts && opts.mark) { r.enemy.now = { k: 'mark', sym: opts.mark }; }
      r.spin(); setPayline(r, line);
      return r;
    };
    const kinds = (R) => R.combos.map((c) => c.k + ':' + c.s).join(',');
    // the reported case: heart / star / star at full HP
    const a = at(['heart', 'wild', 'wild'], { hp: 1 });
    const A = a.forecast();
    eq([A.wildAs, kinds(A)], ['heart', 'trine:heart'], 'heart/星/星 at full HP: a heart trine (it used to become a blade pair)');
    const ev = a.resolve();
    const pl = ev.find((x) => x.t === 'payline');
    eq([pl.wildAs, pl.combos.map((c) => c.k + ':' + c.s).join(',')], ['heart', 'trine:heart'], 'and the resolve does exactly that');
    eq(kinds(at(['heart', 'wild', 'heart'], { hp: 0.74 }).forecast()), 'trine:heart', 'heart/星/heart: a heart trine at any HP');
    eq(kinds(at(['lantern', 'wild', 'lantern'], { hp: 0.3 }).forecast()), 'trine:lantern', 'lantern/星/lantern: the lantern trine (a combo beats a better-looking pair)');
    // no combo possible: the best result, as before
    const n = at(['heart', 'wild', 'flame'], { hp: 0.5 });
    const N = n.forecast();
    let best = null;
    for (const c of SD.Data.WILD_PRIORITY) { const r = n.evaluate(n.paylineCells(), c); if (!best || r.utility > best.utility + 1e-9) best = r; }
    ok(!N.combos.length && N.wildAs === best.wildAs, 'no combo possible: the 星 takes the best result (' + N.wildAs + ')');
    // several combos possible: the best of them
    const t = at(['wild', 'wild', 'wild'], { hp: 1 });
    ok(t.forecast().combos.some((c) => c.k === 'trine'), '星/星/星: always a trine');
    // 絆 when it is the combo on offer
    const b = at(['heart', 'flame', 'wild'], { ids: ids.concat(['bond']), hp: 0.5 });
    eq(kinds(b.forecast()), 'bond:undefined', 'heart/flame/星 with 絆: the 絆 (星 as blade)');
    // a sealed symbol is no combo
    const m = at(['blade', 'wild', 'blade'], { enemy: 'sentry', mark: 'blade' });
    ok(!m.forecast().combos.length && m.forecast().wildAs !== 'blade', 'blade/星/blade under a blade 封じ: no combo, the 星 avoids the seal');
    // hints judge exactly as the resolve; odds are exact
    const GREAT = (R) => R.combos.some((c) => c.k !== 'reaper');
    let agree = 0, total = 0, promise = 0, kept = 0, oddsOk = 0, oddsN = 0;
    const R0 = SD.Util.makeRng(77), SYMS = ['blade', 'flame', 'ward', 'heart', 'lantern', 'skull', 'wild'];
    for (let k = 0; k < 400; k++) {
      const r = fightRun(SD, ids.concat(R0.chance(0.5) ? ['bond'] : []), ['sentry', 'abbot', 'husk', 'mirror'][k % 4], k % 4 >= 2 ? 13 : 8, { sparks: 3, seed: 700 + k });
      r.hp = Math.max(1, Math.round(r.maxHp * R0.next()));
      for (const x of r.reels) for (const c of x.strip) if (R0.chance(0.2)) c.s = SYMS[R0.int(SYMS.length)];
      r.spin();
      const cells = r.paylineCells();
      total++; if (r._isGreat(cells) === GREAT(r.forecast())) agree++;
      if (!GREAT(r.forecast())) for (const nm of r.nearMisses(1)) {
        promise++;
        if (r._sim((c) => { c.fight.freeNudgeLeft = 9; c.sparks = 9; c.nudge(nm.reel, nm.dir); return c.phase === 'spun' && GREAT(c.forecast()); })) kept++;
      }
      if (oddsN < 60) {
        oddsN++;
        const lists = r.reels.map((x, i) => (x.held || x.jam ? [r.paylineCell(i)] : x.strip));
        let hit = 0, all = 0;
        for (const p of lists[0]) for (const q of lists[1]) for (const s of lists[2]) { all++; if (r.evaluate([p, q, s]).combos.some((c) => c.k === 'trine' || c.k === 'quad')) hit++; }
        if (Math.abs(r.respinOdds().trine - hit / all) < 1e-9) oddsOk++;
      }
    }
    eq(agree, total, '_isGreat (glows, 惜しい！, the slow last reel) == what the resolve makes, over random lines');
    ok(promise > 0 && kept === promise, `every "nudge here for a combo" hint keeps its promise (${kept}/${promise})`);
    eq(oddsOk, oddsN, '再演 odds == brute force over the strips (the resolve\'s own judgement)');
  }

  section('QA audit 1 (2026-10-09): the manipulation that fires the turn; which moment the enemy-HP forecast is');
  {
    // a payline 癒・癒・剣 where reel 2's 癒 can be nudged to a 剣, and reel 1's 癒 also sits next to a 剣
    const setup = (ids, sparks) => {
      const r = fightRun(SD, ids, 'moth', 5, { sparks, hp: 40 });
      r.spin();
      const at = (ri, s, nb) => r.reels[ri].strip.findIndex((c, k, a) => c.s === s && (!nb || a[(k + 1) % a.length].s === nb || a[(k - 1 + a.length) % a.length].s === nb));
      r.reels[0].pos = at(0, 'heart', 'blade'); r.reels[1].pos = at(1, 'heart', 'blade'); r.reels[2].pos = at(2, 'blade');
      r.reels.forEach((x) => { x.echo = null; x.held = false; });
      const d = [-1, 1].find((k) => r.cellAt(1, k).s === 'blade');
      return { r, d, act: (c) => c.nudge(1, d) };
    };
    // Dots' case: the last spark goes on the nudge, nothing is left to do — the nudge fires the turn
    const A = setup(['nudge'], 1);
    const PA = A.r.previewAfter(A.act);
    ok(PA && PA.fires === true, 'last spark, nothing left: the hover preview says this nudge fires the turn');
    A.r.nudge(1, A.d);
    ok(A.r.sparks === 0 && !A.r.needsDecision() && A.r.firesAfterManip(), '…and after the nudge it does (same rule)');
    // a borrowed spark would still complete a 剣 trine: the turn waits, and the preview does not promise a fire
    const B = setup(['nudge', 'borrow'], 1);
    const PB = B.r.previewAfter(B.act);
    B.r.nudge(1, B.d);
    ok(PB.fires === false && B.r.canBorrow() && B.r.borrowWorthwhile() && !B.r.firesAfterManip(), '借り火 still worth it: no fire, no "この操作で発動"');
    // the free first 再演 is still there
    const C = setup(['nudge', 'respin'], 1);
    ok(C.r.previewAfter(C.act).fires === false, 'a free 再演 left: no fire');
    // a trine with sparks left: early game it fires at once; with 継ぎ留め (combo pause) it waits
    const tri = (ids) => {
      const r = fightRun(SD, ids, 'moth', 5, { sparks: 3, hp: 40 });
      r.spin();
      r.reels[0].pos = r.reels[0].strip.findIndex((c) => c.s === 'blade');
      r.reels[2].pos = r.reels[2].strip.findIndex((c) => c.s === 'blade');
      r.reels[1].pos = r.reels[1].strip.findIndex((c, k, a) => c.s !== 'blade' && (a[(k + 1) % a.length].s === 'blade' || a[(k - 1 + a.length) % a.length].s === 'blade'));
      const d = [-1, 1].find((k) => r.cellAt(1, k).s === 'blade');
      return r.previewAfter((c) => c.nudge(1, d)).fires;
    };
    ok(tri(['nudge']) === true, 'a nudge that makes a trine fires it (early game)');
    ok(tri(['nudge', 'respin', 'stasis']) === false, '…but waits once the combo pause is on (継ぎ留め)');
    // the rule is the UI flow it replaced: (trine/bond/quad or nothing left) → shouldAutoResolve, over random states
    const oldFlow = (r) => {
      if (r.phase !== 'spun') return false;
      const R = r.forecast();
      const great = R.combos.some((c) => c.k === 'trine' || c.k === 'bond' || c.k === 'quad');
      if (!(great || !r.needsDecision())) return false;
      if (r.awaken.ready) return false;
      return r.shouldAutoResolve();
    };
    const pick = SD.Util.makeRng(4321);
    let same = 0, tries = 0, preview = 0;
    for (let n = 0; n < 300; n++) {
      const ids = SD.Data.SKILLS.filter(() => pick.chance(0.5)).map((s) => s.id).concat(['nudge']);
      const r = fightRun(SD, ids, pick.pick(['moth', 'sentry', 'abbot', 'golem', 'husk', 'mirror', 'bellkeeper']), pick.pick([5, 8, 10, 13]), { sparks: pick.int(4), hp: 40, seed: 900 + n });
      r.spin();
      tries++; if (r.firesAfterManip() === oldFlow(r)) same++;
      const i = pick.int(3), d = pick.chance(0.5) ? 1 : -1;
      if (!r.canNudge(i, d)) continue;
      const P = r.previewAfter((c) => c.nudge(i, d));
      r.nudge(i, d);
      if (P && r.phase === 'spun') { preview++; tries++; if (P.fires === r.firesAfterManip() && r.firesAfterManip() === oldFlow(r)) same++; }
    }
    eq(same, tries, `random states: firesAfterManip == the old UI flow, and the hover preview == what happens (${preview} nudges)`);

    // QA-003: the enemy HP right after the 発動, then its own turn — 骨の修道院長's 蘇生 (+10) after 12 damage
    const h = fightRun(SD, ['nudge'], 'abbot', 8, { sparks: 2, hp: 40 });
    const e = h.enemy;
    e.hp = 138; e.cursor = 3; e.intent = h._readCell(e); e.now = e.intent.now || null;
    h.spin(); setPayline(h, ['blade', 'heart', 'lantern']);
    h.reels.forEach((x) => { x.echo = null; });
    const T = h.previewTurn();
    const strike = T.strikeHp, ev = h.resolve();
    const atTurn = (() => { let hp = 138; for (const x of ev) { if (x.t === 'enemyTurn') break; if (x.t === 'act' && x.sym === 'blade') hp = x.hp; } return hp; })();
    eq([strike, T.healed, T.enemyAfter.hp, e.hp], [atTurn, 10, Math.min(e.maxHp, atTurn + 10), Math.min(e.maxHp, atTurn + 10)], '蘇生: "発動後" is the HP at the end of the 発動, "敵の番の後" adds the heal — both as it happens');
    // burn takes the last HP at the start of the enemy turn
    const b = fightRun(SD, ['nudge'], 'moth', 5, { sparks: 2, hp: 40 });
    b.enemy.hp = 9; b.enemy.burn = 12;
    b.spin(); setPayline(b, ['lantern', 'lantern', 'heart']);
    const Tb = b.previewTurn();
    const evb = b.resolve();
    ok(Tb.strikeHp === 9 && Tb.diesBy === 'burn' && Tb.burnTick === 12 && evb.some((x) => x.t === 'enemyDie') && evb.findIndex((x) => x.t === 'burnTick') < evb.findIndex((x) => x.t === 'enemyDie'), 'burn kill: 発動後 9, then the burn at the start of its turn takes it');
    // a shell in front of a 死神: the reaper goes round it — the exact preview knows (the old estimate showed no damage)
    const s = fightRun(SD, ['nudge'], 'husk', 13, { sparks: 2, hp: 80 });
    s.enemy.hp = 200; s.enemy.block = 60;
    s.spin(); setPayline(s, ['skull', 'skull', 'skull']);
    const Ts = s.previewTurn(), Rs = s.forecast();
    const oldEst = Math.max(0, 200 - Math.max(0, Rs.totalDmg - 60));
    const evs = s.resolve();
    const rp = evs.find((x) => x.t === 'reaper');
    ok(rp && Ts.strikeHp === rp.hp && Ts.strikeHp === 200 - Rs.reaper && oldEst === 200, `死神 through a shell: 発動後 ${Ts.strikeHp} (exact), where the old estimate said ${oldEst}`);
  }

  section('深淵の繰り手「四本の糸」: the HP bar is four strings; on 吊り上げ the lifted hero\'s 三連 snaps the string');
  {
    const K = D.ENEMIES.kurite;
    eq([K.hp, K.marks, K.strings.map((s) => s.hp), K.strings.map((s) => s.syms.join('/'))], [1100, [900, 650, 500], [200, 250, 150, 500], ['blade', 'flame', 'heart', 'blade/flame/heart']], 'strings 200 / 250 / 150 / 500, snapping at 900 / 650 / 500; wards snap none');
    eq(K.acts, ['糸の段', '面の段', '祈りの段', '終幕の段'], 'four acts');
    const ALL3 = D.SKILLS.map((s) => s.id).filter((id) => id !== 'chain');
    const kur3 = (o) => fightRun(SD, ALL3, 'kurite', 17, Object.assign({ sparks: 2, seed: 71 }, o || {}));
    const at = (run, act, step, hp) => { const e = run.enemy; e.phase = act; e.phaseFor = act; e.phaseAt = 0; e.cursor = step; e.hp = hp; e.intent = run._readCell(e); e.now = e.intent.now || null; };
    const turn = (run, syms) => { run.spin(); setPayline(run, syms); const F = run.forecast(), P = run.previewTurn(); return { F, P, ev: run.resolve() }; };
    {
      const run = kur3(), e = run.enemy;
      eq([e.intent.label, !!e.intent.lift, e.now], ['糸引き', false, null], 'act 1 opens with 糸引き 28: no lift, no seal');
      run.spin();
      ok(run.canHold(0), 'holds work as everywhere');
    }
    {
      const run = kur3(), e = run.enemy;
      at(run, 1, 1, 1000);
      eq([e.intent.label, run.liftOf(e.intent).name], ['吊り上げ', 'ブラムの糸'], 'act 1 cell 2: 吊り上げ lifts Bram');
      const { F, P, ev } = turn(run, ['blade', 'blade', 'blade']);
      ok(F.cut && F.cut.name === 'ブラムの糸' && F.cutMark === 900, 'a blade 三連 on Bram\'s lift snaps his string (forecast)');
      const sc = ev.find((x) => x.t === 'stringCut');
      ok(sc && sc.string === 'ブラムの糸' && sc.hp === 900 && !sc.last, 'resolve: the string snaps at 900');
      eq([e.phase, e.intent.label, run.sparks], [2, '面打ち', run.maxSparks], 'act 2 starts at its first cell, sparks full');
      ok(!ev.some((x) => x.t === 'staggerCancel') && !ev.some((x) => x.t === 'enemyAttack' && x.heavy), 'the act changed: 落とし never comes');
      eq(P.enemyAfter && P.enemyAfter.hp, e.hp, 'preview == actual (HP)');
      eq(P.next && P.next.label, e.intent.label, 'preview == actual (the next cell is the new act\'s first)');
      const ch = ev.find((x) => x.t === 'enemyCharge');
      ok(ch && ch.stale === true, 'the old act\'s 吊り上げ still takes the boss\'s turn, marked stale (nothing is shown)');
    }
    {
      // 連鎖: the snap and the act change come before the bonus spin (the snap is read first)
      const run = fightRun(SD, D.SKILLS.map((s) => s.id), 'kurite', 17, { sparks: 2, seed: 91 }), e = run.enemy;
      at(run, 1, 1, 1000);
      const { ev } = turn(run, ['blade', 'blade', 'blade']);
      const iS = ev.findIndex((x) => x.t === 'stringCut'), iP = ev.findIndex((x) => x.t === 'bossPhase'), iC = ev.findIndex((x) => x.t === 'chain');
      ok(iS >= 0 && iP > iS && iC > iP, 'with 連鎖: stringCut, then the act change, then the bonus spin');
      ok(ev.filter((x) => x.t === 'stringCut').length === 1 && e.hp <= 900, '...and the bonus line never snaps the next string');
    }
    {
      const run = kur3({ seed: 73 }), e = run.enemy;
      at(run, 1, 1, 1000);
      const { F, ev } = turn(run, ['ward', 'ward', 'ward']);
      ok(!F.cut && F.staggerWard, 'a ward 三連 on Bram\'s lift: it breaks the 溜め — wards never snap a string');
      ok(!ev.some((x) => x.t === 'stringCut') && e.phase === 1 && ev.some((x) => x.t === 'staggerCancel' && x.skipped.label === '落とし'), '...落とし is struck out, the string stays (act 1 goes on)');
      const r3 = kur3({ seed: 74 });
      at(r3, 4, 2, 400);
      const t3 = turn(r3, ['ward', 'ward', 'ward']);
      ok(!t3.F.cut && r3.phase !== 'won' && r3.enemy.hp > 0 && t3.ev.some((x) => x.t === 'staggerCancel' && x.skipped.label === '終幕'), 'a ward 三連 on 最後の糸: no snap, no win — 終幕 is struck out');
    }
    {
      const run = kur3({ seed: 75 }), e = run.enemy;
      at(run, 1, 1, 1000);
      const { F, ev } = turn(run, ['flame', 'flame', 'flame']);
      ok(!F.cut && !ev.some((x) => x.t === 'stringCut') && e.phase === 1, 'a flame 三連 does not snap Bram\'s string (only damage)');
      const r2 = kur3({ seed: 77 });
      at(r2, 1, 1, 1000);
      const t2 = turn(r2, ['heart', 'flame', 'blade']);
      ok(t2.F.cut && t2.ev.some((x) => x.t === 'stringCut'), '絆の陣 snaps any lifted string');
    }
    {
      const run = kur3({ seed: 79 }), e = run.enemy;
      at(run, 1, 1, 1000);
      const { F, ev } = turn(run, ['ward', 'heart', 'ward']);
      const sk = ev.find((x) => x.t === 'staggerCancel');
      ok(!F.cut && F.staggerWard && sk && sk.skipped.label === '落とし', 'two wards (盾他盾) break 吊り上げ: 落とし is struck out');
      eq(e.intent.label, '糸引き', '...and the act goes on');
      const r2 = kur3({ seed: 81 });
      at(r2, 4, 2, 400);
      const t2 = turn(r2, ['blade', 'ward', 'ward']);
      ok(t2.F.staggerWard && t2.ev.some((x) => x.t === 'staggerCancel' && x.skipped.label === '終幕'), 'two wards break 最後の糸 too: no exceptions');
    }
    {
      const run = kur3({ seed: 83 }), e = run.enemy;
      at(run, 2, 1, 800);
      eq(run.liftOf(e.intent).name, 'ルゥの糸', 'act 2 cell 2 lifts Lu');
      const t1 = turn(run, ['blade', 'blade', 'blade']);
      ok(!t1.F.cut, 'a blade 三連 does not snap Lu\'s string');
      const r2 = kur3({ seed: 85 });
      at(r2, 2, 1, 800);
      const t2 = turn(r2, ['flame', 'flame', 'flame']);
      ok(t2.F.cut && r2.enemy.hp <= 650 && r2.enemy.phase === 3 && r2.enemy.intent.label === '吊り上げ' && r2.liftOf(r2.enemy.intent).name === 'トトの糸', 'a flame 三連 snaps Lu\'s string: 祈りの段 opens on トト\'s lift');
    }
    {
      // 祈りの段: トト is lifted on its first cell; 癒 snaps his string, a blade 三連 does not
      const run = kur3({ seed: 86 }), e = run.enemy;
      at(run, 3, 0, 600);
      eq([e.intent.label, run.liftOf(e.intent).name, run.liftOf(e.intent).syms], ['吊り上げ', 'トトの糸', ['heart']], 'act 3 (祈りの段) cell 1 lifts トト');
      ok(!turn(run, ['blade', 'blade', 'blade']).F.cut, 'a blade 三連 does not snap トト\'s string');
      const r2 = kur3({ seed: 88 });
      at(r2, 3, 0, 600);
      const t2 = turn(r2, ['heart', 'heart', 'heart']);
      ok(t2.F.cut && r2.enemy.hp <= 500 && r2.enemy.phase === 4 && r2.enemy.intent.label === '秒読み・三', 'a 癒 三連 snaps トト\'s string: 終幕の段 from 秒読み・三');
    }
    {
      const run = kur3({ seed: 87 }), e = run.enemy;
      at(run, 4, 2, 400);
      const { F, ev } = turn(run, ['heart', 'heart', 'heart']);
      ok(F.cut && F.cutMark === 0 && ev.some((x) => x.t === 'stringCut' && x.last) && e.hp === 0 && run.phase === 'won', '最後の糸: a 剣・焔・癒 三連 (here 癒) snaps it — the run is won');
    }
    {
      const run = kur3({ seed: 89 }), e = run.enemy;
      at(run, 1, 0, 520);
      const ev = turn(run, ['blade', 'blade', 'blade']).ev;
      ok(e.hp < 500 && e.phase === 4 && ev.filter((x) => x.t === 'bossPhase').length === 1 && run.sparks === run.maxSparks, 'damage runs on: crossing three marks goes straight to 終幕の段');
      const r2 = kur3({ seed: 91 }), e2 = r2.enemy;
      at(r2, 4, 0, 5);
      const ev2 = turn(r2, ['blade', 'blade', 'flame']).ev;
      ok(e2.hp === 0 && r2.phase === 'won', 'no HP floor: damage alone fells it');
      // a 連鎖 second line: the first line already took Bram's string below its mark (the act changes only after both lines)
      const r3 = kur3({ seed: 93 }), e3 = r3.enemy;
      at(r3, 1, 1, 1000); r3.spin(); e3.hp = 890;
      setPayline(r3, ['blade', 'blade', 'blade']);
      ok(!r3.forecast().cut, 'a string that damage already snapped is not cut again: the lift never reaches the next string');
    }
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
    eq([p.stats.deepRuns, p.stats.deepBest, p.stats.deepClears, p.stats.deepFalls, ctxSD.Meta.computeMods(p).deepUnlocked], [0, 0, 0, 0, false], '灰の底 records default to 0; locked until a win');
    ok(ctxSD.Meta.computeMods(p).shortcuts.indexOf(13) < 0 && ctxSD.Meta.computeMods(p).shortcuts.indexOf(9) < 0, 'an old save: 第三層から / 灰の底から closed');
    p.stats.wins = 1;
    ok(ctxSD.Meta.computeMods(p).deepUnlocked, 'a won save unlocks 灰の底');
  }
}

// ================================================================== regression: unchanged without the new 灯紋
function regress(N) {
  section(`regression vs ${BASE_COMMIT}: ${N} runs with random actions, new 灯紋 never lit`);
  const A = baseSD(), Bc = currentSD();
  const NEW = new Set(['borrow', 'hyoshigi', 'wild']); // 'wild' (星の欠片): the 星 rule was changed on purpose (2026-10-09)
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
  // The 星 rule changed on purpose (2026-10-09): evaluate() / _isGreat() judge a 星 differently, and the hints read the
  // cells a nudge can reach (±2). A run is compared step by step past any 星 on the reels; only when the two builds part
  // while a 星 sits on the payline or within reach of it (this step or the one before) is the run counted as parted by
  // the intended change, and its comparison ends there. Any other difference is a regression.
  let mismatches = 0, steps = 0, wildStops = 0, wildSteps = 0;
  const wildNear = (run) => run.reels.some((r) => {
    if (r.echo && r.echo.s === 'wild') return true;
    const L = r.strip.length;
    for (let d = -2; d <= 2; d++) if (r.strip[((r.pos + d) % L + L) % L].s === 'wild') return true;
    return false;
  });
  const hasWild = (run) => run.reels.some((r) => r.strip.some((c) => c.s === 'wild'));
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
    let guard = 0, nearBefore = false;
    while (guard++ < 3000) {
      steps++;
      const near = nearBefore || wildNear(ra) || wildNear(rb);
      if (hasWild(ra) || hasWild(rb)) wildSteps++;
      const pa = proj(ra), pb = proj(rb);
      if (JSON.stringify(pa) !== JSON.stringify(pb) || evProj(ea) !== evProj(eb)) {
        if (near) { wildStops++; break; } // parted by the intended 星 rule
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
      // the same random legal action on both (a 星 within reach now may make this action part the two builds)
      nearBefore = wildNear(ra) || wildNear(rb);
      const ph = ra.phase;
      if (ph === 'idle') { ea = ra.spin(); eb = rb.spin(); }
      else if (ph === 'spun') {
        const legal = {
          respin: ra.canRespin(), nudge: ra.canNudgeAny(), bless: ra.canBlessAny(), echo: ra.canEchoAny(), key: ra.canFateKey(), hold: ra.mods.holdMax > 0,
        };
        const legalB = { respin: rb.canRespin(), nudge: rb.canNudgeAny(), bless: rb.canBlessAny(), echo: rb.canEchoAny(), key: rb.canFateKey(), hold: rb.mods.holdMax > 0 };
        if (JSON.stringify(legal) !== JSON.stringify(legalB)) { mismatches++; console.log('  ✗ legal actions differ', JSON.stringify(legal), JSON.stringify(legalB)); break; }
        const nearNow = wildNear(ra) || wildNear(rb);
        if (ra.needsDecision() !== rb.needsDecision()) { if (nearNow) { wildStops++; break; } mismatches++; console.log('  ✗ needsDecision differs'); break; }
        // auto-resolve is unchanged once the (intended) combo pause of 継ぎ留め owners is switched off
        rb.mods.comboPause = false;
        if (ra.shouldAutoResolve() !== rb.shouldAutoResolve()) { if (nearNow) { wildStops++; break; } mismatches++; console.log('  ✗ shouldAutoResolve differs'); break; }
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
  ok(mismatches === 0, `identical play without the new 灯紋 (${mismatches} diverged runs, ${steps} steps compared; ${wildStops} runs parted where a 星 was in reach — its rule changed on purpose)`);
  console.log(`  compared ${steps} steps over ${N} runs (${wildSteps} of them with a 星 on the reels); ${wildStops} runs parted where a 星 was in reach (its rule changed on purpose)`);
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

// ================================================================== 灰鐘の番人 fuzz: the 構え breaks exactly as previewed
// Random fights from random states (script cell, shell, seal, HP, sparks) with random play: nudges, respins, holds, 写し身,
// 運命の鍵, 台本送り, 借り火, and 連鎖 when lit. Every resolve: the struck-out 大鐘, HP both sides and the band's next cell
// equal the preview (unless a 連鎖 spin rolls dice); the forecast's break equals the break that happens.
function bellFuzz(N) {
  section(`灰鐘の番人 fuzz: ${N} fights, random states and play (sends, borrows, 連鎖)`);
  const SD = currentSD();
  const R = SD.Util.makeRng(1616);
  const clean = (x) => JSON.stringify(x, (k, v) => (k === 'random' ? undefined : v));
  let bad = 0, resolves = 0;
  const tally = { stanceTurns: 0, brokenByHits: 0, brokenByWards: 0, held: 0, heavyLanded: 0, chainBreaks: 0, sends: 0, borrows: 0, chainTurns: 0 };
  const fail = (msg) => { bad++; if (bad <= 5) console.log('  ✗ ' + msg); };
  for (let n = 0; n < N; n++) {
    const ids = SD.Data.SKILLS.filter(() => R.chance(0.5)).map((s) => s.id).concat(['nudge', 'respin']);
    if (R.chance(0.6)) ids.push('hyoshigi'); if (R.chance(0.6)) ids.push('borrow'); if (R.chance(0.35)) ids.push('chain', 'twin', 'trine');
    const run = fightRun(SD, ids, 'bellkeeper', 16, { seed: 700 + n });
    const e = run.enemy;
    e.cursor = R.int(4); e.turn = R.int(e.cursor + 1);
    e.mirrorSym = R.pick(['blade', 'flame', 'ward', 'heart', 'lantern']);
    e.intent = run._readCell(e); e.now = e.intent.now || null;
    e.block = R.pick([0, 10, 60, 150, R.int(120)]);
    e.hp = Math.max(30, Math.round(e.maxHp * (0.2 + R.next() * 0.8)));
    run.hp = Math.max(20, Math.round(run.maxHp * (0.4 + R.next() * 0.6)));
    run.sparks = R.int(run.maxSparks + 1);
    for (let t = 0; t < 30 && run.phase === 'idle' && run.enemy === e; t++) {
      run.spin();
      for (let a = 0; a < 4 && run.phase === 'spun'; a++) {
        const k = R.int(9);
        if (k === 0 && run.canAdvance()) { run.advance(); tally.sends++; }
        else if (k === 1 && run.canBorrow()) { run.borrow(); tally.borrows++; }
        else if (k === 2 && run.canNudgeAny()) { const i = R.int(3), d = R.chance(0.5) ? 1 : -1; if (run.canNudge(i, d)) run.nudge(i, d); }
        else if (k === 3 && run.canRespin()) { for (let i = 0; i < 3; i++) if (R.chance(0.4) && run.canHold(i)) run.toggleHold(i); run.respin(); }
        else if (k === 4 && run.canEchoAny()) { for (let s = 0; s < 3; s++) for (let u = 0; u < 3; u++) if (run.phase === 'spun' && run.canEcho(s, u) && R.chance(0.3)) run.echo(s, u); }
        else if (k === 5 && run.canFateKey()) { const i = R.int(3); if (run.canFateKey(i)) run.fateKey(i, R.int(run.reels[i].strip.length)); }
      }
      if (run.phase !== 'spun') break;
      const it0 = e.intent, F = run.forecast(), P = run.previewTurn(), B = run.scriptBand();
      const nx = B && B.cells.find((c) => c.role === 'next');
      const ev = run.resolve();
      resolves++;
      const chained = ev.some((x) => x.t === 'chain');
      const sk = ev.some((x) => x.t === 'staggerCancel');
      const brk = ev.some((x) => x.t === 'stagger' && x.by === 'break');
      const died = ev.some((x) => x.t === 'enemyDie');
      if (chained) tally.chainTurns++;
      if (it0.k === 'charge' && !died) {
        tally.stanceTurns++;
        if (sk) { if (brk) tally.brokenByHits++; else tally.brokenByWards++; if (brk && chained && !F.staggerBreak) tally.chainBreaks++; }
        else tally.held++;
      }
      if (ev.some((x) => x.t === 'enemyAttack' && x.heavy)) tally.heavyLanded++;
      if (!P.random) {
        if (!!P.skipped !== sk) fail(`fight ${n} turn ${t}: 大鐘 struck in preview ${!!P.skipped}, actual ${sk}`);
        if (!died && brk !== (F.staggerBreak && !F.staggerWard)) fail(`fight ${n} turn ${t}: break forecast ${F.staggerBreak} actual ${brk}`);
        if (!(run.hp === P.hpAfter || (P.partyDies && run.phase === 'dead'))) fail(`fight ${n} turn ${t}: party HP preview ${P.hpAfter} actual ${run.hp}`);
        if (P.enemyAfter && run.enemy === e && e.hp !== P.enemyAfter.hp) fail(`fight ${n} turn ${t}: enemy HP preview ${P.enemyAfter.hp} actual ${e.hp}`);
        if (nx && !nx.cond && !nx.unknown && run.enemy === e && run.phase === 'idle' && clean(nx.it) !== clean(e.intent)) fail(`fight ${n} turn ${t}: band next ${clean(nx.it)} actual ${clean(e.intent)}`);
      }
      // a held 構え means 大鐘 next — unless a debt played it already
      if (it0.k === 'charge' && !sk && !died && run.enemy === e && run.phase === 'idle' && !ev.some((x) => x.t === 'debtAction') && !(e.intent.heavy && e.intent.label === '大鐘')) fail(`fight ${n} turn ${t}: the 構え held but 大鐘 is not next`);
    }
  }
  console.log(`  resolves ${resolves}; 構え turns ${tally.stanceTurns}: broken by hits ${tally.brokenByHits} (by the 連鎖 line ${tally.chainBreaks}), by wards ${tally.brokenByWards}, held ${tally.held}; 大鐘 landed ${tally.heavyLanded}; sends ${tally.sends}, borrows ${tally.borrows}, 連鎖 turns ${tally.chainTurns}`);
  ok(bad === 0 && tally.brokenByHits > 50 && tally.brokenByWards > 20 && tally.held > 50 && tally.chainBreaks > 0 && tally.sends > 50 && tally.borrows > 50, `灰鐘の番人: previews == actual (${bad} mismatches)`);
}

// ================================================================== 深淵の繰り手「四本の糸」 fuzz: the lift cut and the strings, exactly as previewed
function kuriteFuzz(N) {
  section(`深淵の繰り手「四本の糸」 fuzz: ${N} fights, random acts / HP and random play (nudges, 再演, holds, keys, 写し身, sends, borrows, 連鎖)`);
  const SD = currentSD();
  const D = SD.Data, K = D.ENEMIES.kurite;
  const R = SD.Util.makeRng(5151);
  const clean = (x) => JSON.stringify(x, (k, v) => (k === 'random' ? undefined : v));
  let bad = 0, resolves = 0;
  const T = { cuts: 0, cutByChain: 0, falls: 0, staggers: 0, acts: 0, sends: 0, borrows: 0, damageSnaps: 0 };
  const fail = (m) => { bad++; if (bad <= 6) console.log('  ✗ ' + m); };
  const actOf = (hp) => 1 + K.marks.filter((m) => hp <= m).length;
  for (let n = 0; n < N; n++) {
    const ids = D.SKILLS.filter(() => R.chance(0.85)).map((s) => s.id).concat(['nudge', 'respin', 'hyoshigi', 'borrow']);
    const run = fightRun(SD, ids, 'kurite', 17, { seed: 1900 + n });
    const e = run.enemy;
    e.hp = R.pick([1100, 1000, 900, 860, 800, 700, 600, 560, 500, 300, 120, 30]);
    e.phase = actOf(e.hp); e.phaseFor = e.phase; e.phaseAt = 0; e.cursor = R.int(8);
    e.intent = run._readCell(e); e.now = null;
    run.hp = Math.max(10, Math.round(run.maxHp * (0.3 + R.next() * 0.7)));
    run.sparks = R.int(run.maxSparks + 1);
    for (let t = 0; t < 30 && run.phase === 'idle' && run.enemy === e; t++) {
      run.spin();
      for (let a = 0; a < 4 && run.phase === 'spun'; a++) {
        const k = R.int(8);
        if (k === 0 && run.canAdvance()) { run.advance(); T.sends++; }
        else if (k === 1 && run.canBorrow()) { run.borrow(); T.borrows++; }
        else if (k === 2 && run.canNudgeAny()) { const i = R.int(3), d = R.pick([-2, -1, 1, 2]); if (run.canNudge(i, d)) run.nudge(i, d); }
        else if (k === 3 && run.canRespin()) { for (let i = 0; i < 3; i++) if (R.chance(0.4) && run.canHold(i)) run.toggleHold(i); run.respin(); }
        else if (k === 4 && run.canEchoAny()) { for (let s = 0; s < 3; s++) for (let u = 0; u < 3; u++) if (run.phase === 'spun' && run.canEcho(s, u) && R.chance(0.3)) run.echo(s, u); }
        else if (k === 5 && run.canFateKey()) { const i = R.int(3); if (run.canFateKey(i)) run.fateKey(i, R.int(run.reels[i].strip.length)); }
        else if (k === 6 && run.canBlessAny()) { for (let i = 0; i < 3; i++) if (run.canBless(i)) { run.bless(i); break; } }
      }
      if (run.phase !== 'spun') break;
      // (as a player would: on a lift, often line up the lifted hero's 三連 — random play alone rarely does)
      const lift0 = run.liftOf(e.intent);
      if (lift0 && R.chance(0.5)) { const sym = R.pick(lift0.syms); setPayline(run, [sym, sym, sym]); }
      const ph0 = e.phase, it0 = e.intent, F = run.forecast(), P = run.previewTurn(), B = run.scriptBand();
      const nx = B && B.cells.find((c) => c.role === 'next');
      const ev = run.resolve();
      resolves++;
      const sc = ev.filter((x) => x.t === 'stringCut'), chained = ev.some((x) => x.t === 'chain'), died = ev.some((x) => x.t === 'enemyDie');
      T.cuts += sc.length; if (died) T.falls++;
      if (ev.some((x) => x.t === 'staggerCancel')) T.staggers++;
      if (ev.some((x) => x.t === 'bossPhase')) { T.acts++; if (!sc.length) T.damageSnaps++; }
      if (sc.length > 1) fail(`fight ${n}: two strings snapped by lifts in one turn`);
      if (F.cut && !sc.length && !died) fail(`fight ${n} turn ${t}: the forecast snapped ${F.cut.name}, the resolve did not`);
      if (!F.cut && sc.length) { if (chained) T.cutByChain++; else fail(`fight ${n} turn ${t}: a string snapped that the forecast did not show`); }
      for (const x of sc) { const L0 = run.liftOf(it0, e), own = L0 ? (K.marks[it0.lift - 1] || 0) : 0; if (!L0 || x.string !== L0.name || (x.dmg > 0 && x.hp !== own)) fail(`fight ${n} turn ${t}: ${x.string} snapped to ${x.hp} on ${it0.label} (its own mark ${own})`); }
      if (sc.length && !run.liftOf(it0, Object.assign({}, e, { id: 'kurite' }))) fail(`fight ${n}: a string snapped on a cell that lifts no one (${it0.label})`);
      if (ev.some((x) => x.t === 'bossPhase') && run.enemy === e && run.sparks !== run.maxSparks) {
        // (sparks used after the act change cannot happen in the same resolve)
        fail(`fight ${n}: an act change did not fill the sparks (${run.sparks}/${run.maxSparks})`);
      }
      if (run.enemy === e && e.hp > 0 && run.phase !== 'dead' && e.phase !== Math.max(ph0, actOf(e.hp))) fail(`fight ${n}: act ${e.phase} at HP ${e.hp}`);
      if (!P.random) {
        if (P.enemyDies !== died) fail(`fight ${n} turn ${t}: dies preview ${P.enemyDies} actual ${died}`);
        if (!(run.hp === P.hpAfter || (P.partyDies && run.phase === 'dead'))) fail(`fight ${n} turn ${t}: party HP preview ${P.hpAfter} actual ${run.hp}`);
        if (P.enemyAfter && run.enemy === e && e.hp !== P.enemyAfter.hp) fail(`fight ${n} turn ${t}: enemy HP preview ${P.enemyAfter.hp} actual ${e.hp}`);
        if (nx && !nx.cond && !nx.unknown && run.enemy === e && run.phase === 'idle' && clean(nx.it) !== clean(e.intent)) fail(`fight ${n} turn ${t}: band next ${clean(nx.it)} actual ${clean(e.intent)}`);
      }
      if (run.enemy === e && run.phase === 'idle' && e.hp <= 0) fail(`fight ${n}: enemy hp ${e.hp} while the fight goes on`);
    }
  }
  console.log(`  resolves ${resolves}; strings snapped by lifts ${T.cuts} (by a 連鎖 line ${T.cutByChain}), acts changed ${T.acts} (by damage alone ${T.damageSnaps}), 溜め broken ${T.staggers}, falls ${T.falls}; sends ${T.sends}, borrows ${T.borrows}`);
  ok(bad === 0 && T.cuts > 200 && T.falls > 100 && T.staggers > 40 && T.damageSnaps > 60 && T.sends > 100 && T.borrows > 50, `深淵の繰り手「四本の糸」: previews == actual (${bad} mismatches)`);
}

const mode = process.argv[2] || 'all';
if (mode === 'all' || mode === 'unit') unit();
if (mode === 'all' || mode === 'regress') regress(+process.argv[3] || 400);
if (mode === 'all' || mode === 'boss') bossFuzz(+process.argv[3] || 600);
if (mode === 'all' || mode === 'bell') bellFuzz(+process.argv[3] || 1200);
if (mode === 'all' || mode === 'kurite') kuriteFuzz(+process.argv[3] || 1500);
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
