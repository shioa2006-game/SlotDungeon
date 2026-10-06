/* EMBERWHEEL — headless balance simulation.
 *   node tools/sim.js run1 [n]                 Run-1 spin-only stats (fresh profile)
 *   node tools/sim.js campaign <strategy> [n]  full progression from a fresh save (weave|valor|hearth|balanced|random|script)
 *   node tools/sim.js boss <kit> [n]           boss fight win-rate for a fixed kit
 *   node tools/sim.js metrics <strategy> [n]   campaign + agency metrics (locked turns, borrows, sends, fight-length p95)
 *   node tools/sim.js script [n]               灰輪の台本: what each build sends the script for, per enemy
 * Bots play through the real engine (js/core). NOSCRIPT=1 keeps the bots from using 拍子木 / 借り火 even when lit. */
'use strict';
const path = require('path');
globalThis.SD = globalThis.SD || {};
for (const f of ['util', 'data', 'meta', 'engine']) if (!(f === 'util' && globalThis.SD.Util) && !(f === 'data' && globalThis.SD.Data)) require(path.join(__dirname, '..', 'js', 'core', f + '.js'));
const SD = globalThis.SD;

const SPARK_VALUE = +(process.env.SPARK_VALUE || 7);
let botRng = SD.Util.makeRng(12345);
// what the bots did with the script (filled while playing; read by the metrics / script modes)
const LOG = { advances: [], borrows: [], fights: [] };

// ------------------------------------------------------------------ in-combat policy
function cellsWith(run, i, cellObj) { const c = run.paylineCells(); c[i] = cellObj; return c; }

// Outcome of resolving now (from an exact turn preview), in HP-ish units: enemy HP removed, own HP kept.
function turnScore(run, T) {
  if (!T) return 0;
  const e0 = run.enemy ? run.enemy.hp : 0;
  const eAfter = T.enemyDies ? 0 : T.enemyAfter ? T.enemyAfter.hp : e0;
  let s = (e0 - eAfter) + (T.enemyDies ? 30 : 0) + (T.hpAfter - run.hp) * 1.15;
  if (T.partyDies) s -= 500;
  return s;
}
// Things a script cell does that HP does not show: enemy block, curses, stolen sparks, jams.
function sideCost(run, it) {
  if (!it) return 0;
  const burn = run.mods.burnPerFlame > 0 || run.hasRelic('flint');
  switch (it.k) {
    case 'guard': return it.v * (burn ? 0.25 : 0.55);
    case 'hex': return 5 * (it.v || 1);
    case 'drain': return run.sparks > 0 ? SPARK_VALUE : 0;
    case 'jam': return 4;
    default: return 0;
  }
}
const threat = (run, it) => (!it || it.unknown ? 6 : (run.cellDamage(it) || 0) + (it.k === 'heal' ? it.v : 0) + sideCost(run, it));

// 拍子木: value of sending the script now (vs resolving as is), net of the spark.
function advanceValue(run) {
  if (process.env.NOSCRIPT || !run.canAdvance()) return null;
  const P = run.previewAdvance();
  if (!P || P.unknown || !P.band) return null;
  const cur = run.scriptBand(), curNext = cur && cur.cells.find((c) => c.role === 'next');
  const advNext = P.band.cells.find((c) => c.role === 'next');
  let v = turnScore(run, P.band.outcome) - turnScore(run, run.previewTurn());
  v += sideCost(run, run.enemy.intent) - sideCost(run, P.intent);
  // the script is compressed by one cell: what came two turns away now comes next turn
  v -= 0.4 * (threat(run, advNext && advNext.it) - threat(run, curNext && curNext.it));
  // board effects of this turn (marks lifted, reflect gone, stagger lost/gained) are in the forecast utility
  v += 0.5 * ((P.R ? P.R.utility : 0) - run.forecast().utility);
  return v - SPARK_VALUE;
}

// 借り火: the best single action a borrowed spark buys, scored including the debt, vs not borrowing.
function borrowPlan(run) {
  if (process.env.NOSCRIPT || !run.canBorrow()) return null;
  const base = turnScore(run, run.previewTurn()) + run.forecast().utility * 0.3;
  const plan = run._sim((c) => {
    c.borrow();
    let best = { v: -1e9, act: null };
    const consider = (v, act) => { if (v > best.v) best = { v, act }; };
    const score = (P) => (P ? turnScore(c, P.turn) + P.R.utility * 0.3 : -1e9);
    if (c.mods.nudge) for (let i = 0; i < c.reels.length; i++) for (let d = 1; d <= c.mods.nudgeRange; d++) for (const dir of [-d, d]) {
      if (c.canNudge(i, dir)) consider(score(c.previewAfter((cc) => cc.nudge(i, dir))), { k: 'nudge', i, d: dir });
    }
    if (c.canEchoAny()) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (c.canEcho(a, b)) consider(score(c.previewAfter((cc) => cc.echo(a, b))), { k: 'echo', s: a, t: b });
    if (c.canAdvance()) { const P = c.previewAdvance(); if (P && !P.unknown && P.band) consider(turnScore(c, P.band.outcome) + P.R.utility * 0.3 - 0.4 * 6, { k: 'advance' }); }
    return best;
  });
  if (!plan || !plan.act) return null;
  return plan.v - base > 6 ? plan.act : null;
}

function bestAction(run, smart) {
  const base = run.forecast().utility;
  let best = { v: base + 0.5, act: null };
  const consider = (v, act) => { if (v > best.v) best = { v, act }; };
  if (run.awaken.ready) {
    for (let i = 0; i < run.reels.length; i++) for (const d of [-1, 1]) {
      if (!run.canNudge(i, d)) continue;
      const R = run.evaluate(cellsWith(run, i, run.cellAt(i, d)));
      consider(R.utility + 1, { k: 'nudge', i, d });
    }
    return best.act;
  }
  if (!smart) return null;
  // no sparks: borrow first if a borrowed spark is worth its debt
  if (run.sparks === 0 && run.mods.borrow) { const b = borrowPlan(run); if (b) return { k: 'borrow', then: b }; }
  const sparkCost = (c) => (c === 'spark' ? SPARK_VALUE : c === 'hp' ? 6 : 0);
  // nudges
  if (run.mods.nudge) {
    const range = run.mods.nudgeRange;
    for (let i = 0; i < run.reels.length; i++) for (let d = 1; d <= range; d++) for (const dir of [-d, d]) {
      if (!run.canNudge(i, dir)) continue;
      const R = run.evaluate(cellsWith(run, i, run.cellAt(i, dir)));
      consider(R.utility - sparkCost(run.nudgeCost()), { k: 'nudge', i, d: dir });
    }
  }
  // bless
  for (let i = 0; i < run.reels.length; i++) if (run.canBless(i)) {
    const c = Object.assign({}, run.paylineCell(i), { s: 'heart' });
    consider(run.evaluate(cellsWith(run, i, c)).utility, { k: 'bless', i });
  }
  // echo
  if (run.canEchoAny()) for (let s = 0; s < 3; s++) for (let t = 0; t < 3; t++) if (run.canEcho(s, t)) {
    const R = run.evaluate(cellsWith(run, t, run.paylineCell(s)));
    consider(R.utility - 2 * SPARK_VALUE, { k: 'echo', s, t });
  }
  // fate key
  if (run.canFateKey()) for (let i = 0; i < run.reels.length; i++) {
    if (!run.canFateKey(i)) continue;
    const r = run.reels[i];
    for (let ci = 0; ci < r.strip.length; ci++) {
      const R = run.evaluate(cellsWith(run, i, r.strip[ci]));
      consider(R.utility - 1 * SPARK_VALUE, { k: 'key', i, ci });
    }
  }
  // 拍子木
  const av = advanceValue(run);
  if (av != null) consider(base + av, { k: 'advance' });
  // respin with hold subsets (expected value by sampling)
  if (run.mods.respin && run.respinCost()) {
    const n = run.reels.length, subsets = [];
    for (let mask = 0; mask < (1 << n); mask++) {
      const cnt = [0, 1, 2].filter((b) => mask & (1 << b)).length;
      if (cnt <= run.mods.holdMax && cnt < n) subsets.push(mask);
    }
    for (const mask of subsets) {
      let tot = 0; const K = 36;
      for (let k = 0; k < K; k++) {
        const cells = run.paylineCells().map((c, i) => {
          const r = run.reels[i];
          if ((mask & (1 << i)) || r.jam) return c;
          return r.strip[botRng.int(r.strip.length)];
        });
        tot += run.evaluate(cells).utility;
      }
      consider(tot / K - sparkCost(run.respinCost()), { k: 'respin', mask });
    }
  }
  return best.act;
}

function doAct(run, act) {
  if (act.k === 'nudge') run.nudge(act.i, act.d);
  else if (act.k === 'bless') run.bless(act.i);
  else if (act.k === 'echo') run.echo(act.s, act.t);
  else if (act.k === 'key') run.fateKey(act.i, act.ci);
  else if (act.k === 'advance') {
    const e = run.enemy, from = e.intent;
    if (run.advance().length) LOG.advances.push({ enemy: e.id, from: from.label || from.k, fromK: from.k, heavyFrom: !!from.heavy, to: e.intent.label || e.intent.k, toK: e.intent.k, toHeavy: !!e.intent.heavy, kit: LOG.kit || '', floor: run.floor });
  } else if (act.k === 'borrow') {
    if (run.borrow().length) { LOG.borrows.push({ enemy: run.enemy.id, then: act.then.k, kit: LOG.kit || '' }); doAct(run, act.then); }
  } else if (act.k === 'respin') {
    for (let i = 0; i < run.reels.length; i++) {
      const want = !!(act.mask & (1 << i));
      if (run.reels[i].held !== want) run.toggleHold(i);
    }
    run.respin();
  }
}

function playTurn(run, smart) {
  run.spin();
  for (let step = 0; step < 8; step++) {
    if (run.phase !== 'spun') return;
    const act = bestAction(run, smart);
    if (!act) break;
    doAct(run, act);
  }
  if (run.phase === 'spun') run.resolve();
}

// ------------------------------------------------------------------ between-room policy
function offerScore(run, o) {
  const hpPct = run.hp / run.maxHp;
  switch (o.kind) {
    case 'relic': return 5 + botRng.next();
    case 'add': return { blade: 3, flame: 2.6, ward: 2, heart: 2, lantern: 0.5, wild: 6, skull: run.mods.skullPact ? 2 : -5 }[o.sym] || 0;
    case 'add2': return 4.5;
    case 'transmute': return (o.from === 'lantern' || o.from === 'skull' ? 3 : 0.5) + (o.to === 'blade' ? 0.5 : 0);
    case 'remove': return o.sym === 'skull' ? 5 : o.sym === 'lantern' ? 1.5 : 0.2;
    case 'gild': return 4;
    case 'heal': return hpPct < 0.5 ? 7 : hpPct < 0.75 ? 3 : 0.5;
    case 'spark': return run.mods.sparks ? 3 : 0;
    case 'chisel': return 2;
    default: return 0;
  }
}
function doorScore(run, d) {
  const hpPct = run.hp / run.maxHp;
  switch (d.kind) {
    case 'battle': return 3;
    case 'dread': return hpPct > 0.7 ? 4 : 0;
    case 'shrine': return 3.4;
    case 'campfire': return hpPct < 0.55 ? 6 : 1;
    default: return 3;
  }
}
function handleBetween(run) {
  if (run.phase === 'crossroads') {
    let oi = null;
    if (run.offers && run.offers.length) {
      let bs = -1e9;
      run.offers.forEach((o, i) => { const s = offerScore(run, o); if (s > bs) { bs = s; oi = i; } });
      if (bs <= 0) oi = null;
    }
    let di = 0, ds = -1e9;
    run.doors.forEach((d, i) => { const s = doorScore(run, d) + botRng.next() * 0.5; if (s > ds) { ds = s; di = i; } });
    run.choose(oi, di);
  } else if (run.phase === 'event') {
    const ev = run.event, hpPct = run.hp / run.maxHp;
    const has = (id) => ev.options.some((o) => o.id === id);
    let pick = 'leave';
    if (has('rest')) pick = hpPct < 0.75 ? 'rest' : 'carve';
    else if (has('pay') && hpPct > 0.6) pick = 'pay';
    else if (has('pay_hp') && hpPct > 0.6) pick = 'pay_hp';
    else if (has('open') && (run.mods.skullPact || hpPct > 0.5)) pick = 'open';
    else if (has('spin')) pick = 'spin';
    else if (has('chisel2')) pick = 'chisel2';
    else if (has('open_mimic') && hpPct > 0.6) pick = 'open_mimic';
    if (!has(pick)) pick = ev.options[ev.options.length - 1].id;
    run.chooseEvent(pick);
  } else if (run.phase === 'chisel') {
    // remove skulls, then lanterns, then the least useful symbol; duplicate: the most useful
    const pref = run.chisel.mode === 'remove' ? ['skull', 'lantern', 'ward', 'heart', 'flame', 'blade'] : ['wild', 'blade', 'flame'];
    let done = false;
    for (const s of pref) {
      for (let ri = 0; ri < run.reels.length && !done; ri++) {
        const ci = run.reels[ri].strip.findIndex((c) => c.s === s);
        if (ci >= 0 && run.canChiselCell(ri, ci)) { run.chiselCell(ri, ci); done = true; }
      }
      if (done) break;
    }
    if (!done) run.finishChisel();
  }
}

function playRun(profile, opts = {}) {
  if (opts.seed != null) botRng = SD.Util.makeRng(opts.seed * 7919 + 13);
  const mods = SD.Meta.computeMods(profile);
  const run = new SD.Run(mods, { seed: opts.seed, startFloor: opts.startFloor || 1 });
  run.begin();
  let guard = 0;
  let decisions = 0;
  let fightEnemy = null, fightTurns = 0;
  const endFight = () => { if (fightEnemy) LOG.fights.push({ enemy: fightEnemy.id, turns: fightTurns, kit: LOG.kit || '' }); fightEnemy = null; fightTurns = 0; };
  while (run.phase !== 'dead' && run.phase !== 'won' && guard++ < 5000) {
    if (run.phase === 'idle') {
      if (run.enemy !== fightEnemy) { endFight(); fightEnemy = run.enemy; }
      fightTurns++;
      playTurn(run, opts.smart !== false);
    } else { endFight(); handleBetween(run); decisions++; }
  }
  endFight();
  const s = run.summary;
  s.decisions = decisions;
  const manual = run.mods.sparks ? Math.round(s.stats.turns * 0.7) : 0;
  s.estSeconds = Math.round(s.stats.turns * 2.6 + manual * 2.0 + (s.stats.triples + s.stats.bonds) * 0.7 + (s.stats.nudges + s.stats.respins + (s.stats.advances || 0) + (s.stats.borrows || 0)) * 1.2 + decisions * 6 + s.floor * 3.5 + 25);
  return { run, summary: s };
}

// ------------------------------------------------------------------ strategies for buying nodes
// 借り火 sits next to 押し手 (bought when the bot keeps running dry); 拍子木 needs 継ぎ留め or 蓄え.
const ORDERS = {
  weave: ['nudge', 'respin', 'sparkjar', 'cloak', 'borrow', 'deft', 'whet', 'bond', 'stasis', 'hyoshigi', 'wild', 'precision', 'chisel', 'campfire', 'longpush', 'crossroads', 'echo', 'fatekey', 'thorns', 'secondwind', 'kindle', 'execute', 'twin'],
  valor: ['nudge', 'whet', 'bond', 'respin', 'kindle', 'cloak', 'execute', 'borrow', 'momentum', 'pyre', 'twin', 'trine', 'sparkjar', 'skullpact', 'chain', 'campfire', 'deft', 'secondwind'],
  hearth: ['nudge', 'cloak', 'campfire', 'thorns', 'respin', 'secondwind', 'bulwark', 'hyoshigi', 'borrow', 'bless', 'laststand', 'toughness', 'guardian', 'sparkjar', 'keeper', 'whet', 'bond', 'deft'],
  balanced: ['nudge', 'cloak', 'whet', 'respin', 'bond', 'thorns', 'sparkjar', 'campfire', 'kindle', 'borrow', 'deft', 'secondwind', 'execute', 'stasis', 'bulwark', 'hyoshigi', 'crossroads', 'chisel', 'wild', 'twin', 'laststand', 'longpush', 'echo', 'guardian', 'trine', 'fatekey'],
  // the pre-expansion orders (no 借り火 / 拍子木), for comparison
  legacy: ['nudge', 'cloak', 'whet', 'respin', 'bond', 'thorns', 'sparkjar', 'campfire', 'kindle', 'deft', 'secondwind', 'execute', 'stasis', 'bulwark', 'crossroads', 'chisel', 'wild', 'twin', 'laststand', 'longpush', 'echo', 'guardian', 'trine', 'fatekey'],
};
function buyNodes(profile, strategy) {
  const order = strategy === 'random' ? null : ORDERS[strategy];
  const bought = [];
  for (let guard = 0; guard < 40; guard++) {
    let id = null;
    if (order) id = order.find((x) => !profile.unlocked[x] && SD.Meta.isReachable(profile, x));
    else {
      const opts = SD.Data.SKILLS.filter((s) => !profile.unlocked[s.id] && SD.Meta.isReachable(profile, s.id));
      if (opts.length) id = opts[botRng.int(opts.length)].id;
    }
    if (!id) break;
    if (!SD.Meta.canUnlock(profile, id)) break; // save up for the next node in priority order
    SD.Meta.unlock(profile, id);
    bought.push(id);
  }
  return bought;
}

function campaign(strategy, seed) {
  const profile = SD.Meta.newProfile();
  const log = [];
  let total = 0;
  for (let i = 0; i < 30; i++) {
    const mods = SD.Meta.computeMods(profile);
    const start = mods.shortcuts.length ? Math.max(...mods.shortcuts) : 1;
    const { summary } = playRun(profile, { seed: seed * 1000 + i, startFloor: start, smart: true });
    SD.Meta.applyRunResult(profile, summary);
    total += summary.estSeconds;
    const bought = buyNodes(profile, strategy);
    const st = summary.stats;
    log.push({ run: i + 1, start, floor: summary.floor, won: summary.won, embers: summary.embers, sec: summary.estSeconds,
      boss: summary.bossHpPct == null ? '' : Math.round(summary.bossHpPct * 100) + '%', bought: bought.join(','),
      zero: st.zeroTurns || 0, locked: st.lockedTurns || 0, borrows: st.borrows || 0, advances: st.advances || 0, debt: st.debtTaken || 0, turns: st.turns });
    if (summary.won) break;
  }
  return { log, minutes: total / 60, won: log[log.length - 1].won, runs: log.length };
}

module.exports = { playTurn, handleBetween, playRun, buyNodes, campaign, LOG };
if (require.main !== module && !process.env.SIM_CLI) return;
// ------------------------------------------------------------------ CLI
const [, , mode = 'run1', a1, a2] = process.argv;
const KITS = {
  spin: [],
  run3: ['nudge', 'respin'],
  mid: ['nudge', 'respin', 'sparkjar', 'cloak', 'whet', 'bond', 'deft', 'campfire'],
  weave: ['nudge', 'respin', 'sparkjar', 'cloak', 'deft', 'whet', 'bond', 'stasis', 'wild', 'precision', 'longpush', 'echo', 'fatekey'],
  valor: ['nudge', 'whet', 'bond', 'respin', 'kindle', 'cloak', 'execute', 'momentum', 'pyre', 'twin', 'trine', 'sparkjar', 'chain'],
  hearth: ['nudge', 'cloak', 'campfire', 'thorns', 'respin', 'secondwind', 'bulwark', 'bless', 'laststand', 'toughness', 'guardian', 'sparkjar', 'keeper'],
  camp17: ['nudge', 'cloak', 'whet', 'respin', 'bond', 'thorns', 'sparkjar', 'campfire', 'kindle', 'deft', 'secondwind', 'execute', 'stasis', 'bulwark', 'crossroads', 'chisel', 'wild'],
  mastery: ['nudge', 'cloak', 'whet', 'respin', 'bond', 'thorns', 'sparkjar', 'campfire', 'kindle', 'deft', 'secondwind', 'execute', 'stasis', 'bulwark', 'crossroads', 'chisel', 'wild', 'twin', 'laststand', 'longpush', 'echo', 'guardian', 'trine', 'fatekey', 'precision'],
  // with the expansion: 拍子木 (+ the 継ぎ留め/蓄え it needs) and 借り火
  'mid+E': ['nudge', 'respin', 'sparkjar', 'cloak', 'whet', 'bond', 'deft', 'campfire', 'borrow'],
  'camp17+A': ['nudge', 'cloak', 'whet', 'respin', 'bond', 'thorns', 'sparkjar', 'campfire', 'kindle', 'deft', 'secondwind', 'execute', 'stasis', 'bulwark', 'crossroads', 'chisel', 'wild', 'hyoshigi', 'borrow'],
  'thorns+A': ['nudge', 'cloak', 'campfire', 'thorns', 'respin', 'secondwind', 'bulwark', 'bless', 'laststand', 'toughness', 'guardian', 'sparkjar', 'keeper', 'hyoshigi', 'borrow'],
  'burn+A': ['nudge', 'whet', 'bond', 'respin', 'kindle', 'cloak', 'execute', 'momentum', 'pyre', 'twin', 'trine', 'sparkjar', 'chain', 'stasis', 'hyoshigi', 'borrow'],
  'weave+A': ['nudge', 'respin', 'sparkjar', 'cloak', 'deft', 'whet', 'bond', 'stasis', 'wild', 'precision', 'longpush', 'echo', 'fatekey', 'hyoshigi', 'borrow'],
  'mastery+A': ['nudge', 'cloak', 'whet', 'respin', 'bond', 'thorns', 'sparkjar', 'campfire', 'kindle', 'deft', 'secondwind', 'execute', 'stasis', 'bulwark', 'crossroads', 'chisel', 'wild', 'twin', 'laststand', 'longpush', 'echo', 'guardian', 'trine', 'fatekey', 'precision', 'hyoshigi', 'borrow'],
};
function kitProfile(kit) {
  const profile = SD.Meta.newProfile();
  for (const id of KITS[kit]) profile.unlocked[id] = true;
  profile.stats.runs = 10;
  return profile;
}
// A fight of `kit` against one enemy on a typical late-run board: 6 carvings + 2 relics chosen by the bot.
function setFight(kit, enemyId, floor, seed, hpPct) {
  const run = new SD.Run(SD.Meta.computeMods(kitProfile(kit)), { seed, startFloor: floor });
  run.pending.push('carving', 'carving', 'carving', 'carving', 'carving', 'carving', 'relic', 'relic');
  run.begin();
  let g = 0;
  while (run.phase !== 'idle' && run.phase !== 'dead' && run.phase !== 'won' && g++ < 60) handleBetween(run);
  if (run.phase === 'dead' || run.phase === 'won') return null;
  // walk into the chosen fight instead of whatever the doors rolled
  run.event = null; run.chisel = null; run.offers = null; run.doors = null; run.pending = [];
  run.floor = floor;
  run.enemy = null; run.fight = null;
  run._startCombat(enemyId, {});
  run.hp = Math.round(run.maxHp * (hpPct || 0.8));
  return run;
}
const pct = (a, p) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

if (mode === 'run1') {
  const n = +a1 || 2000;
  const floors = {}; let dogWin = 0, dogHpLeft = [], embers = 0, triples = 0, noTrine = 0, secs = 0, awakened = 0;
  for (let i = 0; i < n; i++) {
    const { summary, run } = playRun(SD.Meta.newProfile(), { seed: i + 1, smart: false });
    floors[summary.floor] = (floors[summary.floor] || 0) + 1;
    if (summary.eliteKills.indexOf('bellhound') >= 0) dogWin++;
    else if (summary.killer && summary.killer.id === 'bellhound') dogHpLeft.push(summary.killer.hpPct);
    embers += summary.embers; triples += summary.stats.triples; if (!summary.stats.triples) noTrine++;
    secs += summary.estSeconds; if (run.awaken.done) awakened++;
  }
  dogHpLeft.sort((x, y) => x - y);
  console.log('Run 1 spin-only, n=' + n);
  console.log('death floor dist:', Object.keys(floors).map((k) => `B${k}:${(floors[k] / n * 100).toFixed(1)}%`).join(' '));
  console.log('dog win %:', (dogWin / n * 100).toFixed(1), ' median dog hp left on loss:', dogHpLeft.length ? (dogHpLeft[dogHpLeft.length >> 1] * 100).toFixed(0) + '%' : '-');
  console.log('avg embers:', (embers / n).toFixed(1), ' avg triples:', (triples / n).toFixed(2), ' no-trine %:', (noTrine / n * 100).toFixed(1),
    ' awakened %:', (awakened / n * 100).toFixed(1), ' avg est sec:', (secs / n).toFixed(0));
} else if (mode === 'campaign' || mode === 'metrics') {
  const strategy = a1 || 'balanced', n = +a2 || 20;
  const res = [];
  for (let s = 1; s <= n; s++) { LOG.kit = strategy; res.push(campaign(strategy, s)); }
  const won = res.filter((r) => r.won);
  console.log(`campaign ${strategy}: won ${won.length}/${n}; runs-to-win median ${median(won.map((r) => r.runs))}; minutes median ${median(won.map((r) => r.minutes)).toFixed?.(1)}`);
  if (mode === 'campaign') {
    const ex = res[0];
    for (const l of ex.log) console.log(`  run ${String(l.run).padStart(2)} start B${l.start} -> B${l.floor}${l.won ? ' WIN' : ''}  embers ${l.embers}  ${l.sec}s  boss ${l.boss}  bought: ${l.bought}`);
  } else {
    const runs = res.flatMap((r) => r.log);
    const sum = (k) => runs.reduce((s, l) => s + l[k], 0);
    const turns = sum('turns');
    console.log(`  per run: turns ${(turns / runs.length).toFixed(1)}  zero-spark turns ${(sum('zero') / runs.length).toFixed(2)}  fully locked turns ${(sum('locked') / runs.length).toFixed(2)} (${(sum('locked') / turns * 100).toFixed(1)}% of turns)`);
    console.log(`  per run: borrows ${(sum('borrows') / runs.length).toFixed(2)}  debt damage ${(sum('debt') / runs.length).toFixed(1)}  sends ${(sum('advances') / runs.length).toFixed(2)}`);
    const fl = LOG.fights.map((f) => f.turns);
    console.log(`  fight length: median ${pct(fl, 0.5)}  p95 ${pct(fl, 0.95)}  max ${Math.max(...fl)}  (n=${fl.length})`);
    const byE = {};
    for (const f of LOG.fights) (byE[f.enemy] = byE[f.enemy] || []).push(f.turns);
    console.log('  p95 by enemy: ' + Object.keys(byE).map((k) => `${k} ${pct(byE[k], 0.95)}`).join('  '));
    if (LOG.advances.length) {
      const kinds = {};
      for (const a of LOG.advances) kinds[a.fromK + (a.toHeavy ? '→heavy' : '')] = (kinds[a.fromK + (a.toHeavy ? '→heavy' : '')] || 0) + 1;
      console.log('  sent away (k): ' + Object.keys(kinds).sort((x, y) => kinds[y] - kinds[x]).map((k) => `${k} ${kinds[k]}`).join('  '));
    }
  }
} else if (mode === 'boss') {
  const kit = a1 || 'mid', n = +a2 || 400;
  const profile = kitProfile(kit);
  let wins = 0, hpLeft = [];
  for (let i = 0; i < n; i++) {
    const mods = SD.Meta.computeMods(profile);
    const run = new SD.Run(mods, { seed: 777 + i, startFloor: 12 });
    // give the run a typical late-run carving state: 6 carvings + 2 relics chosen by the bot
    run.pending.push('carving', 'carving', 'carving', 'carving', 'carving', 'carving', 'relic', 'relic');
    run.begin();
    run.hp = Math.round(run.maxHp * 0.8);
    let g = 0;
    while (run.phase !== 'dead' && run.phase !== 'won' && g++ < 3000) {
      if (run.phase === 'idle') playTurn(run, kit !== 'spin' && !process.env.NOMANIP); else handleBetween(run);
    }
    if (run.phase === 'won') wins++; else if (run.killer) hpLeft.push(run.killer.hpPct);
  }
  hpLeft.sort((x, y) => x - y);
  console.log(`boss kit=${kit}: win ${(wins / n * 100).toFixed(1)}%  median boss hp left on loss ${hpLeft.length ? (hpLeft[hpLeft.length >> 1] * 100).toFixed(0) + '%' : '-'}`);
} else if (mode === 'script') {
  // Same enemies, different builds: what does each build send the script for?
  const n = +a1 || 150;
  const kits = ['thorns+A', 'burn+A', 'weave+A'];
  const foes = [['sentry_deep', 10], ['abbot', 8], ['shade', 10], ['golem', 10], ['ashlord', 12]];
  for (const [foe, floor] of foes) {
    console.log(`\n${SD.Data.ENEMIES[foe].name} (${foe})`);
    for (const kit of kits) {
      LOG.advances.length = 0; LOG.borrows.length = 0; LOG.kit = kit;
      let wins = 0, turns = 0, fights = 0, sends = 0;
      for (let i = 0; i < n; i++) {
        botRng = SD.Util.makeRng(4000 + i);
        const run = setFight(kit, foe, floor, 9000 + i, foe === 'ashlord' ? 0.8 : 0.7);
        if (!run) continue;
        fights++;
        let g = 0;
        const e = run.enemy;
        while (run.enemy === e && run.phase === 'idle' && g++ < 80) { playTurn(run, true); turns++; }
        if (run.phase === 'won' || (run.enemy !== e && run.phase !== 'dead')) wins++;
        sends += run.stats.advances;
      }
      const tally = {};
      for (const a of LOG.advances) { const k = `${a.from}→${a.to}`; tally[k] = (tally[k] || 0) + 1; }
      const top = Object.keys(tally).sort((x, y) => tally[y] - tally[x]).slice(0, 5).map((k) => `${k} ×${tally[k]}`).join(', ');
      const heavyPull = LOG.advances.filter((a) => a.toHeavy).length;
      console.log(`  ${kit.padEnd(9)} win ${(wins / fights * 100).toFixed(0)}%  turns/fight ${(turns / fights).toFixed(1)}  sends/fight ${(sends / fights).toFixed(2)}  called a heavy early ${heavyPull}  borrows ${LOG.borrows.length}`);
      console.log(`            ${top || '(never sent)'}`);
    }
  }
}
function median(a) { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }
