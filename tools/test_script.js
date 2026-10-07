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
    eq(met[3][1], 'abbot_deep', 'B16: the elite');
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
    eq([p.stats.deepRuns, p.stats.deepBest, p.stats.deepClears, ctxSD.Meta.computeMods(p).deepUnlocked], [0, 0, 0, false], '灰の底 records default to 0; locked until a win');
    p.stats.wins = 1;
    ok(ctxSD.Meta.computeMods(p).deepUnlocked, 'a won save unlocks 灰の底');
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
