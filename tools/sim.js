/* EMBERWHEEL — headless balance simulation.
 *   node tools/sim.js run1 [n]                 Run-1 spin-only stats (fresh profile)
 *   node tools/sim.js campaign <strategy> [n]  full progression from a fresh save (weave|valor|hearth|balanced|random|script)
 *   node tools/sim.js boss <kit> [n]           boss fight win-rate for a fixed kit
 *   node tools/sim.js metrics <strategy> [n]   campaign + agency metrics (locked turns, borrows, sends, fight-length p95)
 *   node tools/sim.js script [n]               灰輪の台本: what each build sends the script for, per enemy
 *   node tools/sim.js baseline <strategy> [n]  past the first clear until the whole tree is lit (+5 runs): tree left at the clear,
 *                                              embers/run after it, and per growth stage the fights' length, 1-turn kills and
 *                                              "decision turns" (turns the UI stops on: shouldAutoResolve() false). BASELINE_JSON=path saves raw data.
 *                                              After the clear the bot always takes 灰の底 (さらに降りる); [F] reports the descent.
 *   node tools/sim.js deep [n]                 灰の底: each kit against 重ね殻 / 返し鏡 / 深淵の修道院長 on a late-run board (which branch answers which enemy)
 *   ENTRY=b5|b9|mix node tools/sim.js baseline <strategy> [n]   where runs start after the clear (default b5 = as in stage 3a;
 *                                              b9 = 第三層から; mix = B9 and 灰の底から B13 in turn). [G] compares the starts.
 *   node tools/sim.js entry [n]                16 builds (4 strategies x 4 carving tastes), starts rotated B5 / B9 / B13 after the clear:
 *                                              boss wins by start and 灰の底 clears (B9 descent vs B13 direct), embers per minute
 *   node tools/sim.js b16 [n]                  灰鐘の番人 (B16) per strategy and growth stage: win rate, fight length, how each 大鐘 was
 *                                              answered (hits through the shell / two wards / it landed), and what the turns looked like
 *                                              (actions per turn, decision turns, which symbol led the line, how often the same lead repeats)
 *   node tools/sim.js b17 [n]                  深淵の繰り手「四本の糸」(B17) on boards from whole-tree runs that cleared B16 (entrance ①: a campfire,
 *                                              then B17), per carving taste, with the omniscient bot: win rate, fight length, the lifts (snapped /
 *                                              the 溜め broken / neither), how the acts ended, the blows that landed, sparks. Human-like policies:
 *                                              docs/EXPANSION_4B_PROMISE.md (gate B).
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
  if (LOG.hook && LOG.hook.spun) LOG.hook.spun(run);
  // baseline mode: would the game stop for the player on this spin? (pure previews: the run and its RNG are untouched)
  const M = LOG.measure && run.phase === 'spun' ? LOG.turn : null;
  if (M && !run.shouldAutoResolve()) M.dec++;
  for (let step = 0; step < 8; step++) {
    if (run.phase !== 'spun') return;
    const act = bestAction(run, smart);
    if (!act) break;
    doAct(run, act);
    if (LOG.hook) LOG.hook.act(run, act);
    if (M && step === 0) M.acted++;
  }
  // first turn of the fight: the damage the chosen line deals, vs the enemy's max HP (headroom for new enemies)
  if (M && run.phase === 'spun' && M.t++ === 0) M.dmg1 = run.forecast().totalDmg;
  if (run.phase === 'spun') {
    if (LOG.hook) { const e0 = run.enemy, it0 = e0 && e0.intent, R = run.forecast(); LOG.hook.resolve(run, run.resolve(), e0, it0, R); } // (forecast is pure)
    else run.resolve();
  }
}

// ------------------------------------------------------------------ between-room policy
function offerScore(run, o) {
  const hpPct = run.hp / run.maxHp;
  switch (o.kind) {
    case 'relic': return 5 + botRng.next();
    // LOG.symPref (optional, set by analysis scripts): a build's carving taste { blade: 6, flame: 2, ... }; unset = the default bot
    case 'add': if (LOG.symPref && LOG.symPref[o.sym] != null) return LOG.symPref[o.sym]; return { blade: 3, flame: 2.6, ward: 2, heart: 2, lantern: 0.5, wild: 6, skull: run.mods.skullPact ? 2 : -5 }[o.sym] || 0;
    case 'add2': return 4.5;
    case 'transmute': return (o.from === 'lantern' || o.from === 'skull' ? 3 : 0.5) + (LOG.symPref ? (LOG.symPref[o.to] || 0) * 0.3 : o.to === 'blade' ? 0.5 : 0);
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
  if (run.phase === 'descent') { run.chooseDescent(LOG.descend !== false); return; }
  if (run.phase === 'finalChoice') { run.chooseFinal(false); return; }
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
    let pref = run.chisel.mode === 'remove' ? ['skull', 'lantern', 'ward', 'heart', 'flame', 'blade'] : ['wild', 'blade', 'flame'];
    if (LOG.symPref) { const P = LOG.symPref, by = ['skull', 'lantern', 'ward', 'heart', 'flame', 'blade'].sort((a, b) => (P[a] || 0) - (P[b] || 0)); pref = run.chisel.mode === 'remove' ? by : ['wild'].concat(by.slice().reverse().filter((s) => s !== 'skull' && s !== 'lantern')); }
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
  let fightEnemy = null, fightTurns = 0, fightFloor = 0;
  const endFight = () => {
    if (fightEnemy) {
      LOG.fights.push({ enemy: fightEnemy.id, turns: fightTurns, kit: LOG.kit || '' });
      if (LOG.measure) {
        const E = SD.Data.ENEMIES[fightEnemy.id] || {};
        LOG.mfights.push(Object.assign({ enemy: fightEnemy.id, cat: E.boss ? 'boss' : E.elite ? 'elite' : 'normal', floor: fightFloor, turns: fightTurns,
          kill: fightEnemy.hp <= 0, stage: LOG.stage, tree: LOG.tree }, LOG.turn));
      }
    }
    fightEnemy = null; fightTurns = 0;
  };
  let settleDec = null;
  while (run.phase !== 'dead' && run.phase !== 'won' && guard++ < 5000) {
    if (run.phase === 'descent' && settleDec == null) settleDec = decisions;
    if (run.phase === 'idle') {
      if (run.enemy !== fightEnemy) { endFight(); fightEnemy = run.enemy; fightFloor = run.floor; if (LOG.measure) LOG.turn = { dec: 0, acted: 0, t: 0, dmg1: 0, maxHp: run.enemy.maxHp }; }
      fightTurns++;
      playTurn(run, opts.smart !== false);
    } else { endFight(); const fc = run.phase === 'finalChoice'; handleBetween(run); if (!fc) decisions++; } // (the bot never takes 最深の間: not a decision)
  }
  endFight();
  const s = run.summary;
  s.decisions = decisions;
  const manual = run.mods.sparks ? Math.round(s.stats.turns * 0.7) : 0;
  const est = (st, dec, floor) => Math.round(st.turns * 2.6 + (run.mods.sparks ? Math.round(st.turns * 0.7) : 0) * 2.0 + (st.triples + st.bonds) * 0.7 + (st.nudges + st.respins + (st.advances || 0) + (st.borrows || 0)) * 1.2 + dec * 6 + floor * 3.5 + 25);
  s.estSeconds = Math.round(s.stats.turns * 2.6 + manual * 2.0 + (s.stats.triples + s.stats.bonds) * 0.7 + (s.stats.nudges + s.stats.respins + (s.stats.advances || 0) + (s.stats.borrows || 0)) * 1.2 + decisions * 6 + s.floor * 3.5 + 25);
  if (s.deep && s.base) s.baseSeconds = est(s.base.stats, settleDec || decisions, s.base.floor);
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
    const start = pickStart(mods, 'b5', 0);
    const { summary } = playRun(profile, { seed: seed * 1000 + i, startFloor: start, smart: true });
    SD.Meta.applyFinishedRun(profile, summary);
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

// ------------------------------------------------------------------ baseline: the first clear, then on until the whole tree is lit
// After the clear the bot keeps its strategy order, then buys the cheapest reachable node (a player finishing the tree).
function buyNodesAll(profile, strategy) {
  const bought = buyNodes(profile, strategy);
  for (let guard = 0; guard < 60; guard++) {
    const opts = SD.Data.SKILLS.filter((s) => !profile.unlocked[s.id] && SD.Meta.isReachable(profile, s.id)).sort((a, b) => a.cost - b.cost);
    if (!opts.length || !SD.Meta.canUnlock(profile, opts[0].id)) break;
    SD.Meta.unlock(profile, opts[0].id);
    bought.push(opts[0].id);
  }
  return bought;
}
const treeOwned = (profile) => SD.Data.SKILLS.filter((s) => profile.unlocked[s.id]).length;
const treeLeftCost = (profile) => SD.Data.SKILLS.filter((s) => !profile.unlocked[s.id]).reduce((t, s) => t + s.cost, 0);
// Where a run starts. b5: the deepest pre-clear shortcut (as before the post-clear shortcuts existed); b9: 第三層から once open;
// mix: B9 and 灰の底から (B13) in turn once both are open; rotate: B5 / B9 / B13 in turn (to compare the starts on the same profiles).
function pickStart(mods, policy, k) {
  const pre = mods.shortcuts.filter((f) => !SD.Data.SHORTCUTS[f].postClear);
  const base = pre.length ? Math.max(...pre) : 1;
  const has = (f) => mods.shortcuts.indexOf(f) >= 0;
  if (policy === 'b9') return has(9) ? 9 : base;
  if (policy === 'mix') return has(13) && k % 2 === 1 ? 13 : has(9) ? 9 : base;
  if (policy === 'rotate') { const c = [base].concat([9, 13].filter(has)); return c[k % c.length]; }
  return base;
}
function baselineCampaign(strategy, seed, opts = {}) {
  const FULL_RUNS = opts.fullRuns || 5, CAP = opts.cap || 150;
  const policy = opts.entry || LOG.entry || 'b5';
  const profile = SD.Meta.newProfile();
  const runs = [];
  let clear = null, fullAt = null, sec = 0, postK = 0;
  for (let i = 0; i < CAP; i++) {
    const full = treeOwned(profile) === SD.Data.SKILLS.length;
    LOG.stage = !clear ? 'pre' : full ? 'full' : 'post';
    LOG.tree = treeOwned(profile);
    const mods = SD.Meta.computeMods(profile);
    const start = pickStart(mods, policy, clear ? postK++ : 0);
    const { summary } = playRun(profile, { seed: seed * 1000 + i, startFloor: start, smart: true });
    SD.Meta.applyFinishedRun(profile, summary);
    sec += summary.estSeconds;
    runs.push({ i: i + 1, stage: LOG.stage, tree: LOG.tree, start, floor: summary.floor, won: !!summary.won, embers: summary.embers, sec: summary.estSeconds, deepOnly: !!summary.deepOnly,
      deep: summary.deep ? { floor: summary.floor, cleared: summary.deep.cleared, embers: summary.deep.embers, sec: summary.deepOnly ? summary.estSeconds : summary.estSeconds - summary.baseSeconds } : null });
    if (summary.won && !clear) {
      clear = { runs: i + 1, min: sec / 60, owned: treeOwned(profile), leftNodes: SD.Data.SKILLS.length - treeOwned(profile), leftCost: treeLeftCost(profile), embersInHand: profile.embers };
    }
    // before the clear: exactly the campaign's buying; after it: finish the tree
    if (!clear || runs.length === clear.runs) buyNodes(profile, strategy); else buyNodesAll(profile, strategy);
    if (clear && !fullAt && treeOwned(profile) === SD.Data.SKILLS.length) fullAt = { runs: i + 1, min: sec / 60 };
    if (fullAt && i + 1 >= fullAt.runs + FULL_RUNS) break;
  }
  return { clear, fullAt, runs, min: sec / 60 };
}

module.exports = { playTurn, handleBetween, playRun, buyNodes, campaign, baselineCampaign, LOG };
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
    // (灰輪の主 beaten: 'descent' — the choice to go on into 灰の底 — is the win here, as 'won' was before G5)
    while (run.phase !== 'dead' && run.phase !== 'won' && run.phase !== 'descent' && g++ < 3000) {
      if (run.phase === 'idle') playTurn(run, kit !== 'spin' && !process.env.NOMANIP); else handleBetween(run);
    }
    if (run.phase === 'won' || run.phase === 'descent') wins++; else if (run.killer) hpLeft.push(run.killer.hpPct);
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
        if (run.phase === 'won' || run.phase === 'descent' || (run.enemy !== e && run.phase !== 'dead')) wins++;
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
if (mode === 'baseline') {
  const strategy = a1 || 'balanced', n = +a2 || 10;
  LOG.measure = true; LOG.mfights = []; LOG.kit = strategy; LOG.entry = process.env.ENTRY || 'b5';
  const res = [];
  for (let s = 1; s <= n; s++) res.push(baselineCampaign(strategy, s));
  const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-'), f0 = (x) => (Number.isFinite(x) ? x.toFixed(0) : '-');
  const mean = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : NaN);
  const C = res.filter((r) => r.clear), F = res.filter((r) => r.fullAt);
  console.log(`baseline ${strategy}: n=${n}  cleared ${C.length}/${n}  tree completed ${F.length}/${n}  (nodes ${SD.Data.SKILLS.length}, total cost ${SD.Data.SKILLS.reduce((t, s) => t + s.cost, 0)})`);
  console.log('\n[A] at the first clear (median)');
  console.log(`  runs ${median(C.map((r) => r.clear.runs))}  minutes ${f1(median(C.map((r) => r.clear.min)))}  nodes owned ${median(C.map((r) => r.clear.owned))}  nodes left ${median(C.map((r) => r.clear.leftNodes))}  cost left ${median(C.map((r) => r.clear.leftCost))}  embers in hand ${median(C.map((r) => r.clear.embersInHand))}`);
  console.log('\n[B] from the first clear to the whole tree');
  const post = C.flatMap((r) => r.runs.filter((x) => x.stage === 'post'));
  console.log(`  runs ${median(F.map((r) => r.fullAt.runs - r.clear.runs))}  minutes ${f1(median(F.map((r) => r.fullAt.min - r.clear.min)))}  embers/run mean ${f0(mean(post.map((x) => x.embers)))} (median ${median(post.map((x) => x.embers))})  win rate ${f0(mean(post.map((x) => (x.won ? 100 : 0))))}%  min/run ${f1(mean(post.map((x) => x.sec / 60)))}`);
  const pre = res.flatMap((r) => r.runs.filter((x) => x.stage === 'pre')), full = res.flatMap((r) => r.runs.filter((x) => x.stage === 'full'));
  console.log(`  (for scale) before the clear: embers/run mean ${f0(mean(pre.map((x) => x.embers)))}  min/run ${f1(mean(pre.map((x) => x.sec / 60)))};  full tree: win rate ${f0(mean(full.map((x) => (x.won ? 100 : 0))))}%  min/run ${f1(mean(full.map((x) => x.sec / 60)))}`);
  // fights by growth stage and kind
  const row = (label, fs) => {
    if (!fs.length) return console.log(`  ${label.padEnd(22)} (none)`);
    const kills = fs.filter((x) => x.kill);
    console.log(`  ${label.padEnd(22)} fights ${String(fs.length).padStart(5)}  turns med ${median(fs.map((x) => x.turns))} p90 ${pct(fs.map((x) => x.turns), 0.9)}  1-turn kill ${f0(kills.filter((x) => x.turns === 1).length / fs.length * 100).padStart(3)}%` +
      `  turn-1 dmg/maxHP med ${(median(fs.map((x) => x.dmg1 / x.maxHp)) || 0).toFixed(2)}  decision turns/fight ${f1(mean(fs.map((x) => x.dec)))}  fights with a decision ${f0(fs.filter((x) => x.dec > 0).length / fs.length * 100).padStart(3)}%  bot acted/fight ${f1(mean(fs.map((x) => x.acted)))}  lost ${f0(fs.filter((x) => !x.kill).length / fs.length * 100)}%`);
  };
  const MF = LOG.mfights;
  for (const [st, name] of [['pre', 'before the clear'], ['post', 'after the clear'], ['full', 'whole tree lit']]) {
    console.log(`\n[C] ${name}`);
    const runsAt = res.flatMap((r) => r.runs.filter((x) => x.stage === st));
    const fs = MF.filter((x) => x.stage === st);
    console.log(`  runs ${runsAt.length}  fights per run ${f1(fs.length / Math.max(1, runsAt.length))}  (normal ${f1(fs.filter((x) => x.cat === 'normal').length / Math.max(1, runsAt.length))})`);
    for (const cat of ['normal', 'elite', 'boss']) row(cat, fs.filter((x) => x.cat === cat));
  }
  console.log('\n[D] normal fights by share of the tree lit at the run start');
  const N = SD.Data.SKILLS.length;
  for (const [lo, hi] of [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1], [1, 1.01]]) {
    row(hi > 1 ? '100%' : `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`, MF.filter((x) => x.cat === 'normal' && x.tree / N >= lo && x.tree / N < hi));
  }
  console.log('\n[E] after the clear, per normal enemy: 1-turn kill % / decision turns per fight');
  const byE = {};
  for (const x of MF.filter((y) => y.stage !== 'pre' && y.cat === 'normal')) (byE[x.enemy] = byE[x.enemy] || []).push(x);
  console.log('  ' + Object.keys(byE).sort().map((k) => `${k} ${f0(byE[k].filter((x) => x.kill && x.turns === 1).length / byE[k].length * 100)}%/${f1(mean(byE[k].map((x) => x.dec)))} (n${byE[k].length})`).join('  '));
  console.log('\n[F] 灰の底 (the bot always descends after a settled boss win)');
  for (const [st, name, pick] of [['post', 'first 2 boss wins after the clear', (r) => r.runs.filter((x) => x.stage === 'post' && x.deep && !x.deepOnly).slice(0, 2)],
    ['post', 'after the clear (all)', (r) => r.runs.filter((x) => x.stage === 'post' && x.deep && !x.deepOnly)], ['full', 'whole tree lit', (r) => r.runs.filter((x) => x.stage === 'full' && x.deep && !x.deepOnly)]]) {
    const D = res.flatMap(pick);
    if (!D.length) { console.log(`  ${name.padEnd(34)} (no descents)`); continue; }
    const at = (f) => f0(D.filter((x) => x.deep.floor >= f || x.deep.cleared).length / D.length * 100);
    console.log(`  ${name.padEnd(34)} descents ${String(D.length).padStart(4)}  reached B14 ${at(14)}%  B15 ${at(15)}%  B16 ${at(16)}%  cleared ${f0(D.filter((x) => x.deep.cleared).length / D.length * 100)}%` +
      `  extra minutes ${f1(mean(D.map((x) => x.deep.sec / 60)))}  embers from the descent ${f0(mean(D.map((x) => x.deep.embers)))}`);
  }
  for (const [st, name] of [['post', 'after the clear'], ['full', 'whole tree lit']]) {
    console.log(`  -- fights in 灰の底, ${name}`);
    for (const id of ['husk', 'mirror', SD.Data.FLOORS[SD.Data.DEEP_LAST_FLOOR].enemy]) row(`${SD.Data.ENEMIES[id].name}`, MF.filter((x) => x.stage === st && x.enemy === id && x.floor >= 13));
  }
  if (LOG.entry && LOG.entry !== 'b5') {
    console.log(`\n[G] starts after the clear (ENTRY=${LOG.entry})`);
    for (const st of ['post', 'full']) for (const sf of [5, 9, 13]) {
      const A = res.flatMap((r) => r.runs.filter((x) => x.stage === st && x.start === sf));
      if (!A.length) continue;
      const D = A.filter((x) => x.deep);
      console.log(`  ${st.padEnd(4)} B${String(sf).padEnd(2)} runs ${String(A.length).padStart(4)}  boss won ${sf === 13 ? ' -' : f0(A.filter((x) => x.won).length / A.length * 100) + '%'}` +
        `  灰の底 reached ${f0(D.length / A.length * 100)}%  cleared ${D.length ? f0(D.filter((x) => x.deep.cleared).length / D.length * 100) + '%' : '-'}` +
        `  min/run ${f1(mean(A.map((x) => x.sec / 60)))}  embers/min ${f1(A.reduce((t, x) => t + x.embers, 0) / A.reduce((t, x) => t + x.sec / 60, 0))}`);
    }
  }
  if (process.env.BASELINE_JSON) require('fs').writeFileSync(process.env.BASELINE_JSON, JSON.stringify({ strategy, n, res: res.map((r) => ({ clear: r.clear, fullAt: r.fullAt, runs: r.runs })), fights: MF }));
}
if (mode === 'entry') {
  // B13 direct vs B9 + descent, per build (4 strategies x 4 carving tastes), on the same profiles (starts rotate after the clear)
  const n = +a1 || 8;
  LOG.entry = 'rotate';
  const TASTES = {
    default: null,
    blade: { blade: 6, flame: 2, ward: 1.5, heart: 1.5, lantern: 0.3, wild: 6, skull: -5 },
    flame: { flame: 6, blade: 2, ward: 1.5, heart: 1.5, lantern: 0.3, wild: 6, skull: -5 },
    ward: { ward: 6, heart: 3, blade: 1.5, flame: 1.5, lantern: 0.3, wild: 5, skull: -5 },
  };
  const all = [];
  let seedN = 1;
  for (const strat of ['balanced', 'valor', 'hearth', 'weave']) for (const taste of Object.keys(TASTES)) {
    LOG.symPref = TASTES[taste];
    for (let s = 0; s < n; s++) { const r = baselineCampaign(strat, 500 + seedN++, { fullRuns: 9 }); for (const x of r.runs) if (x.stage !== 'pre') all.push(Object.assign({ build: strat + '/' + taste }, x)); }
  }
  LOG.symPref = null;
  const pc = (a, f) => (a.length ? Math.round(a.filter(f).length / a.length * 100) : NaN);
  const show = (v) => (Number.isFinite(v) ? String(v).padStart(3) + '%' : '  - ');
  const line = (label, A) => {
    const b5 = A.filter((x) => x.start === 5), b9 = A.filter((x) => x.start === 9), b13 = A.filter((x) => x.start === 13);
    const d9 = b9.filter((x) => x.deep), d13 = b13.filter((x) => x.deep);
    const c9 = pc(d9, (x) => x.deep.cleared), c13 = pc(d13, (x) => x.deep.cleared);
    const epm = (B) => (B.length ? (B.reduce((t, x) => t + x.embers, 0) / B.reduce((t, x) => t + x.sec / 60, 0)).toFixed(0) : '-');
    console.log(`  ${label.padEnd(16)} boss won B5 ${show(pc(b5, (x) => x.won))} B9 ${show(pc(b9, (x) => x.won))}  |  灰の底 cleared: B9→ ${show(c9)} (n${String(d9.length).padStart(3)})  B13 ${show(c13)} (n${String(d13.length).padStart(3)})  diff ${Number.isFinite(c13 - c9) ? (c13 - c9 > 0 ? '+' : '') + (c13 - c9) : '-'}  |  embers/min B5 ${epm(b5)} B9 ${epm(b9)} B13 ${epm(b13)}  min/run B9 ${b9.length ? (b9.reduce((t, x) => t + x.sec, 0) / b9.length / 60).toFixed(1) : '-'} B5 ${b5.length ? (b5.reduce((t, x) => t + x.sec, 0) / b5.length / 60).toFixed(1) : '-'}`);
  };
  for (const st of ['post', 'full']) {
    console.log(`\n== ${st === 'post' ? 'after the clear, tree not complete' : 'whole tree lit'}`);
    const S = all.filter((x) => x.stage === st);
    line('ALL', S);
    for (const b of [...new Set(S.map((x) => x.build))]) line(b, S.filter((x) => x.build === b));
  }
}
if (mode === 'deep') {
  // Which branch answers which enemy: every kit fights each 灰の底 enemy on a rich late-run board (10 carvings + 3 relics).
  const n = +a1 || 150;
  const kits = ['valor', 'burn+A', 'thorns+A', 'weave+A', 'hearth', 'mastery+A'];
  // controls (this mode only): the same enemy without its own rule, to see what the rule costs each kit
  const E = SD.Data.ENEMIES;
  E.husk_ctl = Object.assign({}, E.husk, { name: '重ね殻（殻なしの対照）', startBlock: 0, ai: (e) => Object.assign({}, E.husk.ai(e), { guard: 0 }) });
  E.mirror_ctl = Object.assign({}, E.mirror, { name: '返し鏡（封じなしの対照）', mirror: false, ai: (e, r) => Object.assign({}, E.mirror.ai(e, r), { now: null }) });
  const foes = [['husk', 13], ['husk_ctl', 13], ['mirror', 14], ['mirror_ctl', 14], [SD.Data.FLOORS[SD.Data.DEEP_LAST_FLOOR].enemy, 16]];
  const by = {};
  for (const [foe, floor] of foes) {
    console.log(`\n${SD.Data.ENEMIES[foe].name} (${foe}, B${floor})`);
    for (const kit of kits) {
      let wins = 0, fights = 0, one = 0; const tl = [];
      for (let i = 0; i < n; i++) {
        botRng = SD.Util.makeRng(6000 + i);
        const run = new SD.Run(SD.Meta.computeMods(kitProfile(kit)), { seed: 9500 + i, startFloor: 9 });
        for (let k = 0; k < 10; k++) run.pending.push('carving');
        run.pending.push('relic', 'relic', 'relic');
        run.begin();
        let g = 0;
        while (run.phase !== 'idle' && run.phase !== 'dead' && run.phase !== 'won' && g++ < 80) handleBetween(run);
        if (run.phase !== 'idle') continue;
        run.event = null; run.chisel = null; run.offers = null; run.doors = null; run.pending = [];
        run.floor = floor; run.enemy = null; run.fight = null;
        run._startCombat(foe, {});
        run.hp = Math.round(run.maxHp * 0.85);
        fights++;
        const e = run.enemy; let t = 0;
        while (run.enemy === e && run.phase === 'idle' && t < 60) { playTurn(run, true); t++; }
        const won = run.phase === 'won' || (run.enemy !== e && run.phase !== 'dead') || e.hp <= 0;
        if (won) { wins++; tl.push(t); if (t === 1) one++; }
      }
      by[foe + '|' + kit] = { mean: tl.reduce((s, x) => s + x, 0) / Math.max(1, tl.length), win: wins / Math.max(1, fights) };
      console.log(`  ${kit.padEnd(10)} win ${(wins / Math.max(1, fights) * 100).toFixed(0).padStart(3)}%  turns to win: median ${median(tl)}  mean ${(tl.reduce((s, x) => s + x, 0) / Math.max(1, tl.length)).toFixed(2)}  1-turn kills ${(one / Math.max(1, fights) * 100).toFixed(0)}%`);
    }
  }
  console.log('\nwhat the rule costs each kit vs the control (extra turns to win, ratio, win-rate change)');
  for (const [foe, ctl] of [['husk', 'husk_ctl'], ['mirror', 'mirror_ctl']]) {
    console.log(`  ${E[foe].name}:`);
    for (const k of kits) { const a = by[foe + '|' + k], b = by[ctl + '|' + k]; console.log(`    ${k.padEnd(10)} +${(a.mean - b.mean).toFixed(1)} turns  ×${(a.mean / b.mean).toFixed(2)}  win ${Math.round((a.win - b.win) * 100)}%`); }
  }
}
if (mode === 'b16') {
  // 灰鐘の番人: per strategy (campaigns, starts as ENTRY, default mix) and stage — the B16 fights, the 大鐘 answers, the turns
  const n = +a1 || 40;
  const ID = SD.Data.FLOORS[SD.Data.DEEP_LAST_FLOOR].enemy;
  LOG.measure = true; LOG.entry = process.env.ENTRY || 'mix';
  const DMG = { blade: 1, flame: 1, skull: 1 };
  LOG.hook = {
    act(run, act) { const T = LOG.turn; if (T && run.enemy && run.enemy.id === ID) { T.acts = T.acts || {}; T.acts[act.k] = (T.acts[act.k] || 0) + 1; } },
    // the 構え turn as the reels first stopped: would that line have broken the stance already?
    spun(run) { const T = LOG.turn; if (T && run.enemy && run.enemy.id === ID && run.phase === 'spun') { const F = run.forecast(); T.spunBreak = !!F.staggerBreak; T.spunWard = !!F.staggerWard; } },
    resolve(run, ev, e0, it0, R) {
      const T = LOG.turn;
      if (!T || !e0 || e0.id !== ID || run.floor !== SD.Data.DEEP_LAST_FLOOR) return;
      T.bk = T.bk || { turns: 0, stance: 0, broke: 0, brokeMade: 0, wards: 0, wardsMade: 0, held: 0, landed: 0, wardTurns: 0, leads: [] };
      const B = T.bk, died = ev.some((x) => x.t === 'enemyDie');
      B.turns++;
      if (it0 && it0.k === 'charge' && !died) {
        B.stance++;
        // (…Made: the line the reels first stopped on would not have done it — the bot's actions or a 連鎖 made it)
        if (ev.some((x) => x.t === 'staggerCancel')) { if (ev.some((x) => x.t === 'stagger' && x.by === 'break')) { B.broke++; if (!T.spunBreak) B.brokeMade++; } else { B.wards++; if (!T.spunWard) B.wardsMade++; } }
        else B.held++;
      }
      B.landed += ev.filter((x) => x.t === 'enemyAttack' && x.heavy).length;
      const G = R.groups, act = Object.keys(G).filter((s) => s !== R.marked && s !== 'skull' && s !== 'wild');
      if (G.ward && G.ward.n >= 2 && R.marked !== 'ward') B.wardTurns++;
      let lead = null, ln = 0;
      for (const s of ['blade', 'flame', 'ward', 'heart', 'lantern']) if (act.indexOf(s) >= 0 && G[s].n > ln) { ln = G[s].n; lead = s; }
      B.leads.push(lead ? (DMG[lead] ? 'dmg' : lead) : 'none');
    },
  };
  const all = [];
  let seed = 1;
  const strategies = (process.env.STRATS || 'balanced,valor,hearth,weave').split(',');
  const gaps = {};
  for (const strat of strategies) {
    LOG.mfights = [];
    const res = [];
    for (let s = 0; s < n; s++) res.push(baselineCampaign(strat, 700 + seed++));
    for (const f of LOG.mfights) if (f.enemy === ID && f.floor === SD.Data.DEEP_LAST_FLOOR) all.push(Object.assign({ strat }, f));
    gaps[strat] = res.filter((r) => r.clear).map((r) => {
      const first = r.runs.find((x) => x.stage !== 'pre' && x.deep && x.deep.cleared);
      return { b16: first ? first.i - r.clear.runs : null, full: r.fullAt ? r.fullAt.runs - r.clear.runs : null,
        early: r.runs.filter((x) => x.stage === 'post' && x.deep).slice(0, 2) };
    });
  }
  LOG.hook = null;
  const f0 = (x) => (Number.isFinite(x) ? x.toFixed(0) : '-'), f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');
  const pc = (a, f) => (a.length ? a.filter(f).length / a.length * 100 : NaN);
  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  console.log(`灰鐘の番人 (${ID}) — ${n} campaigns per strategy, ENTRY=${LOG.entry}`);
  for (const st of ['post', 'full']) {
    console.log(`\n== ${st === 'post' ? 'after the clear, tree not complete' : 'whole tree lit'}`);
    for (const strat of strategies.concat(['ALL'])) {
      const A = all.filter((x) => x.stage === st && (strat === 'ALL' || x.strat === strat) && x.bk);
      if (!A.length) continue;
      const W = A.filter((x) => x.kill), turns = A.map((x) => x.bk.turns);
      const stance = sum(A, (x) => x.bk.stance), broke = sum(A, (x) => x.bk.broke), wards = sum(A, (x) => x.bk.wards), held = sum(A, (x) => x.bk.held);
      const tt = sum(A, (x) => x.bk.turns), acts = sum(A, (x) => Object.values(x.acts || {}).reduce((t, v) => t + v, 0));
      const leads = A.flatMap((x) => x.bk.leads), rep = A.reduce((t, x) => t + x.bk.leads.filter((l, i) => i > 0 && l === x.bk.leads[i - 1]).length, 0);
      const lead = (k) => f0(pc(leads, (l) => l === k));
      console.log(`  ${strat.padEnd(8)} fights ${String(A.length).padStart(4)}  win ${f0(pc(A, (x) => x.kill)).padStart(3)}%  turns med ${median(turns)} p90 ${pct(turns, 0.9)} >10: ${f0(pc(A, (x) => x.bk.turns > 10))}%` +
        `  | 大鐘: 構え ${stance} → hits ${f0(broke / Math.max(1, stance) * 100)}% (made ${f0(sum(A, (x) => x.bk.brokeMade) / Math.max(1, stance) * 100)}%) / wards ${f0(wards / Math.max(1, stance) * 100)}% (made ${f0(sum(A, (x) => x.bk.wardsMade) / Math.max(1, stance) * 100)}%) / held ${f0(held / Math.max(1, stance) * 100)}%  landed/fight ${f1(sum(A, (x) => x.bk.landed) / A.length)}` +
        `  | per turn: actions ${f1(acts / Math.max(1, tt))}  decision ${f0(sum(A, (x) => x.dec) / Math.max(1, tt) * 100)}%  lead dmg ${lead('dmg')}% ward ${lead('ward')}% heart ${lead('heart')}% lantern ${lead('lantern')}%  same lead as last turn ${f0(rep / Math.max(1, tt - A.length) * 100)}%`);
    }
  }
  console.log('\n== hearth fights by length (tree not complete): what the long ones do');
  for (const [lo, hi] of [[1, 5], [6, 10], [11, 99]]) {
    const A = all.filter((x) => x.stage === 'post' && x.strat === 'hearth' && x.bk && x.bk.turns >= lo && x.bk.turns <= hi);
    if (!A.length) continue;
    const tt = sum(A, (x) => x.bk.turns), leads = A.flatMap((x) => x.bk.leads), acts = sum(A, (x) => Object.values(x.acts || {}).reduce((t, v) => t + v, 0));
    const by = {};
    for (const x of A) for (const k in x.acts || {}) by[k] = (by[k] || 0) + x.acts[k];
    console.log(`  ${lo}-${hi === 99 ? '' : hi} turns: fights ${A.length}  win ${f0(pc(A, (x) => x.kill))}%  actions/turn ${f1(acts / tt)} (${Object.keys(by).map((k) => k + ' ' + f1(by[k] / tt)).join(', ')})  decision ${f0(sum(A, (x) => x.dec) / tt * 100)}%` +
      `  lead dmg ${f0(pc(leads, (l) => l === 'dmg'))}% ward ${f0(pc(leads, (l) => l === 'ward'))}% heart ${f0(pc(leads, (l) => l === 'heart'))}%  wards>=2 ${f0(sum(A, (x) => x.bk.wardTurns) / tt * 100)}%  大鐘 held ${sum(A, (x) => x.bk.held)}/${sum(A, (x) => x.bk.stance)}`);
  }
  console.log('\n== progress (runs after the clear): first B16 kill vs whole tree; the first 2 runs into 灰の底');
  for (const strat of strategies) {
    const G = gaps[strat], E = G.flatMap((g) => g.early);
    console.log(`  ${strat.padEnd(8)} first B16 kill: run ${median(G.filter((g) => g.b16 != null).map((g) => g.b16))} (never ${G.filter((g) => g.b16 == null).length})  whole tree: run ${median(G.filter((g) => g.full != null).map((g) => g.full))}  B16 after the tree ${f0(pc(G.filter((g) => g.full != null), (g) => g.b16 == null || g.b16 > g.full))}%` +
      `  | first 2 runs: reached B16 ${f0(pc(E, (x) => x.deep.floor >= 16 || x.deep.cleared))}%  cleared ${f0(pc(E, (x) => x.deep.cleared))}% (n${E.length})`);
  }
}
if (mode === 'b17') {
  // 深淵の繰り手 on real boards: whole-tree profile, runs from B9 (第三層から, then 灰の底) and B13 (灰の底から) in turn; every run
  // that clears B16 goes on as entrance ① will (a campfire: rest below 75% HP, else carve; one spark for the win) into B17.
  const n = +a1 || 60;
  const KD = SD.Data.ENEMIES.kurite;
  const full = SD.Meta.newProfile();
  for (const s of SD.Data.SKILLS) full.unlocked[s.id] = true;
  Object.assign(full.stats, { runs: 40, wins: 3, deepRuns: 3, deepClears: 1, eliteKills: { bellhound: 3, abbot: 3, ashlord: 3, bellkeeper: 1 } });
  const TASTES = {
    default: null,
    blade: { blade: 6, flame: 2, ward: 1.5, heart: 1.5, lantern: 0.3, wild: 6, skull: -5 },
    flame: { flame: 6, blade: 2, ward: 1.5, heart: 1.5, lantern: 0.3, wild: 6, skull: -5 },
    ward: { ward: 6, heart: 3, blade: 1.5, flame: 1.5, lantern: 0.3, wild: 5, skull: -5 },
    skull: { skull: 4, blade: 3, flame: 2.6, ward: 2, heart: 2, lantern: 0.5, wild: 6 },
  };
  const toB17 = (run) => {
    for (const r of run.reels) {
      const keep = r.strip[r.pos];
      r.strip = r.strip.filter((c) => !c.temp);
      const np = r.strip.indexOf(keep);
      r.pos = np >= 0 ? np : 0;
      r.held = false; r.carried = false; r.jam = false; r.echo = null;
    }
    run.block = 0;
    run._gainSparks(run.mods.sparkPerWin);
    run.phase = 'event'; run.event = { id: 'campfire', options: [{ id: 'rest' }, { id: 'carve' }] }; run.pending = [];
    if (run.hp < run.maxHp * 0.75) run.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * 0.35));
    else { run._beginChisel(1, 'remove', 'campfire'); handleBetween(run); }
    run.event = null; run.chisel = null; run.offers = null; run.doors = null; run.pending = [];
    run.floor = SD.Data.FINAL_FLOOR; run.enemy = null; run.fight = null;
    run._startCombat('kurite', {});
  };
  let F = null;
  LOG.hook = {
    spun(run) {
      if (!F || run.enemy !== F.e) return;
      const T = { ph: run.enemy.phase, sparks: run.sparkAvail(), acts: [], cell: run.enemy.intent.label, any: run._anyAction(true) };
      T.dec = !run.shouldAutoResolve();
      F.turns.push(T); F.cur = T;
    },
    act(run, act) {
      const T = F && F.cur;
      if (!T || run.enemy !== F.e) return;
      T.acts.push(act.k);
    },
    resolve(run, ev, e0, it0, R) {
      const T = F && F.cur;
      if (!T || e0 !== F.e) return;
      const G = R.groups, act = Object.keys(G).filter((s) => s !== R.marked && s !== 'skull' && s !== 'wild');
      let lead = null, ln = 0;
      for (const s of ['blade', 'flame', 'ward', 'heart', 'lantern']) if (act.indexOf(s) >= 0 && G[s].n > ln) { ln = G[s].n; lead = s; }
      if (!lead && G.skull) lead = R.reaper ? 'reaper' : 'skull';
      T.lead = lead || 'none';
      T.combo = R.combos.map((c) => c.k).join('+') || '-';
      T.dmg = R.totalDmg;
      T.heavyIn = it0 && it0.k === 'charge' ? it0.nextLabel : null;
      T.struck = ev.some((x) => x.t === 'staggerCancel');
      T.killed = ev.some((x) => x.t === 'enemyDie');
      T.bossHpAfter = e0.hp;
      T.heavyLanded = ev.filter((x) => x.t === 'enemyAttack' && x.heavy).map((x) => ({ raw: x.raw, dmg: x.dmg, guardian: x.guardian, back: x.thorns || 0 }));
      T.hpAfter = run.hp;
      T.lift = !!(it0 && it0.lift); T.snap = ev.some((x) => x.t === 'stringCut'); T.actUp = ev.some((x) => x.t === 'bossPhase');
      T.label = it0 ? it0.label : '';
      F.cur = null;
    },
  };
  const res = [];
  let k = 0;
  for (const taste of (process.env.TASTES || Object.keys(TASTES).join(',')).split(',')) {
    LOG.symPref = TASTES[taste];
    for (let s = 0; s < n; s++, k++) {
      const start = k % 2 ? 13 : 9;
      F = null;
      const { run, summary } = playRun(JSON.parse(JSON.stringify(full)), { seed: 17000 + k, startFloor: start });
      const cleared = summary.deep && summary.deep.cleared;
      if (!cleared) { res.push({ taste, start, reached: false }); continue; }
      toB17(run);
      const e = run.enemy;
      F = { e, turns: [], cur: null };
      const hp0 = run.hp, sp0 = run.sparks;
      let t = 0;
      while (run.enemy === e && run.phase === 'idle' && t < 60) { playTurn(run, true); t++; }
      const won = e.hp <= 0;
      res.push({ taste, start, reached: true, won, turns: t, hp0, maxHp: run.maxHp, sp0, phase: e.phase, enemyHpPct: e.hp / e.maxHp, T: F.turns,
        relics: run.relics.slice(), stats: run.stats });
      F = null;
    }
  }
  LOG.hook = null; LOG.symPref = null;
  const f0 = (x) => (Number.isFinite(x) ? x.toFixed(0) : '-'), f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');
  const pc = (a, f) => (a.length ? a.filter(f).length / a.length * 100 : NaN);
  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  console.log(`深淵の繰り手 (B17) — ${n} runs per taste; HP=${KD.hp} strings=${KD.strings.map((s) => s.hp).join('/')}`);
  const A = res.filter((x) => x.reached);
  console.log(`  reached B17 ${A.length}/${res.length}  (start HP med ${median(A.map((x) => Math.round(x.hp0 / x.maxHp * 100)))}%  maxHP med ${median(A.map((x) => x.maxHp))}  sparks med ${median(A.map((x) => x.sp0))})`);
  const row = (label, S) => {
    if (!S.length) return;
    const W = S.filter((x) => x.won), TT = S.flatMap((x) => x.T);
    console.log(`  ${label.padEnd(8)} fights ${String(S.length).padStart(4)}  win ${f0(pc(S, (x) => x.won)).padStart(3)}%  turns med ${median(S.map((x) => x.turns))} (wins ${median(W.map((x) => x.turns))}, p10-p90 ${pct(W.map((x) => x.turns), 0.1)}-${pct(W.map((x) => x.turns), 0.9)})` +
      `  lost at: act1 ${f0(pc(S.filter((x) => !x.won), (x) => x.phase === 1))}% act2 ${f0(pc(S.filter((x) => !x.won), (x) => x.phase === 2))}% act3 ${f0(pc(S.filter((x) => !x.won), (x) => x.phase === 3))}% act4 ${f0(pc(S.filter((x) => !x.won), (x) => x.phase === 4))}%  boss HP left on loss med ${f0(median(S.filter((x) => !x.won).map((x) => x.enemyHpPct * 100)))}%  turn-1 dmg max ${Math.max(0, ...S.map((x) => (x.T[0] && x.T[0].dmg) || 0))}`);
  };
  console.log('\n[1] outcome by carving taste');
  for (const tz of [...new Set(A.map((x) => x.taste))]) row(tz, A.filter((x) => x.taste === tz));
  row('ALL', A);
  const TT = A.flatMap((x) => x.T.map((t) => Object.assign({ won: x.won }, t)));
  { const W = A.filter((x) => x.won); console.log('  won fights, turns per act (median / p90): ' + [1, 2, 3, 4].map((p) => `act${p} ${median(W.map((x) => x.T.filter((t) => t.ph === p).length))} / ${pct(W.map((x) => x.T.filter((t) => t.ph === p).length), 0.9)}`).join('  ')); }
  const W = A.filter((x) => x.won);
  console.log('\n[2] 吊り上げ (the lifted hero\'s 三連 or 絆 snaps the string; two wards break the 溜め)');
  for (const ph of [1, 2, 3, 4]) {
    const S = TT.filter((t) => t.ph === ph && t.lift);
    if (!S.length) continue;
    console.log(`  act${ph}: lift turns ${S.length}  snapped ${f0(pc(S, (t) => t.snap))}%  broke the 溜め only ${f0(pc(S, (t) => t.struck && !t.snap))}%  neither ${f0(pc(S, (t) => !t.snap && !t.struck))}%  (sparks at the spin med ${median(S.map((t) => t.sparks))})`);
  }
  const ups = TT.filter((t) => t.actUp);
  console.log(`  acts ended ${ups.length}: by a lift snap ${f0(pc(ups, (t) => t.snap))}%  by damage ${f0(pc(ups, (t) => !t.snap))}%;  won fights finished by a lift snap ${f0(pc(W, (x) => x.T.length && x.T[x.T.length - 1].snap))}%`);
  console.log('\n[3] the blows (落とし / 終幕) and the sparks');
  for (const ph of [1, 2, 3, 4]) {
    const S = TT.filter((t) => t.ph === ph);
    if (!S.length) continue;
    const landed = S.flatMap((t) => t.heavyLanded || []);
    console.log(`  act${ph}: turns ${S.length}  heavy blows landed ${landed.length} (dmg taken med ${median(landed.map((h) => h.dmg))}, reflected by 守護 ${landed.filter((h) => h.guardian).length})  0 sparks at the spin ${f0(pc(S, (t) => t.sparks === 0))}%  decision turns ${f0(pc(S, (t) => t.dec))}%`);
  }
  console.log('\n[4] how the turns differ (all turns)');
  const leads = {}, acts = {};
  for (const t of TT) { leads[t.lead] = (leads[t.lead] || 0) + 1; for (const x of t.acts) acts[x] = (acts[x] || 0) + 1; }
  console.log(`  lead: ${Object.keys(leads).sort((x, y) => leads[y] - leads[x]).map((kk) => kk + ' ' + f0(leads[kk] / TT.length * 100) + '%').join('  ')}`);
  console.log(`  actions per turn ${f1(sum(TT, (t) => t.acts.length) / TT.length)}: ${Object.keys(acts).sort((x, y) => acts[y] - acts[x]).map((kk) => kk + ' ' + f1(acts[kk] / TT.length)).join('  ')}`);
  console.log(`  damage per turn med ${median(TT.map((t) => t.dmg))}`);
}
function median(a) { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }
