/* EMBERWHEEL — engine fuzz test: random unlocks + random legal actions, checking invariants.
 *   node tools/fuzz.js [runs]
 * Also checks the Ashwheel's script (灰輪の台本) and borrowing (借り火):
 *   - previews (scriptBand / previewTurn / previewAdvance / previewBorrow / auto-resolve helpers) never change the run or its RNG
 *   - the band's "next" cell is exactly the intent the enemy shows next turn (unless marked unknown / conditional)
 *   - the predicted damage of a turn equals the damage actually taken (unless a 連鎖 spin rolled dice)
 *   - a borrowed spark never survives the turn, is taken at most once per fight, and its debt is paid exactly once
 *   - a locked cell (強撃 / 灰燼) is never sent away, and the script is sent at most once per turn
 *   - borrow state never crosses a fight; a turn in which the script was sent never auto-resolves
 *   - a 0-spark turn never auto-resolves while a borrowed spark could have saved the party (AE audit 2026-10-08) */
'use strict';
const path = require('path');
globalThis.SD = {};
for (const f of ['util', 'data', 'meta', 'engine']) require(path.join(__dirname, '..', 'js', 'core', f + '.js'));
const SD = globalThis.SD;
const N = +process.argv[2] || 3000;
const R = SD.Util.makeRng(4242);
const VALID = new Set(['descent', 'chisel', 'crossroads', 'event', 'idle', 'spun', 'dead', 'won']);
let fails = 0, phases = {}, events = {}, actions = {}, checks = {};
const count = (k) => { checks[k] = (checks[k] || 0) + 1; };

function fail(msg, run, extra) {
  fails++;
  if (fails <= 12) console.log('FAIL:', msg, 'seed', run && run.seed, 'floor', run && run.floor, extra || '');
}

function check(run, where) {
  if (!VALID.has(run.phase)) fail('bad phase ' + run.phase + ' @' + where, run);
  if (!(run.hp <= run.maxHp)) fail('hp>max ' + run.hp + '/' + run.maxHp + ' @' + where, run);
  if (run.phase !== 'dead' && run.hp <= 0 && run.phase !== 'won') fail('alive with hp<=0 @' + where, run);
  if (run.mods.sparks && (run.sparks < 0 || run.sparks > run.maxSparks)) fail('sparks out of range ' + run.sparks + '/' + run.maxSparks + ' @' + where, run);
  for (const r of run.reels) {
    if (!(r.pos >= 0 && r.pos < r.strip.length)) fail('bad reel pos @' + where, run);
    if (r.strip.length < 3) fail('strip too short @' + where, run);
  }
  if (run.enemy) {
    const e = run.enemy;
    if (!isFinite(e.hp) || e.hp < 0 || e.hp > e.maxHp) fail('enemy hp bad ' + e.hp + '/' + e.maxHp + ' @' + where, run);
    if (!e.intent) fail('no intent @' + where, run);
    if (!(e.cursor >= e.turn)) fail('script cursor behind the turn count @' + where, run);
  }
  if (run.fight) {
    const f = run.fight;
    if (!(f.borrowed === 0 || f.borrowed === 1)) fail('borrowed spark count ' + f.borrowed + ' @' + where, run);
    if (run.phase === 'idle' && f.borrowed) fail('a borrowed spark survived the turn @' + where, run);
    if (run.phase === 'idle' && f.debt) fail('an unpaid debt survived the enemy turn @' + where, run);
    if (run.phase === 'spun' && f.advanced && run.shouldAutoResolve()) fail('a turn with a script send auto-resolved @' + where, run);
  }
  if (!isFinite(run.embers) || run.embers < 0) fail('embers bad @' + where, run);
}

function randomProfile() {
  const p = SD.Meta.newProfile();
  p.stats.runs = R.int(6);
  if (R.chance(0.4)) p.stats.eliteKills.bellhound = 1;
  for (const s of SD.Data.SKILLS) if (R.chance(0.45)) p.unlocked[s.id] = true;
  // the new verbs get extra coverage
  if (R.chance(0.5)) p.unlocked.hyoshigi = true;
  if (R.chance(0.5)) p.unlocked.borrow = true;
  if (R.chance(0.2)) p.settings.comboPause = 'off';
  if (R.chance(0.5)) p.stats.wins = 1; // 灰の底 opens after a clear
  return p;
}

// everything a preview could disturb (the run's own state and its dice)
const snap = (run) => JSON.stringify(run, (k, v) => (k === 'rng' || k === 'mods' ? undefined : v)) + '|' + run.rng.state();
const sameIntent = (a, b) => {
  const clean = (x) => JSON.stringify(x, (k, v) => (k === 'random' ? undefined : v));
  return clean(a) === clean(b);
};

function purity(run) {
  const before = snap(run);
  run.scriptBand(); run.previewTurn(); run.previewAdvance(); run.previewBorrow();
  run.needsDecision(); run.shouldAutoResolve(); run.borrowWorthwhile(); run.comboPauseReason(); run.forecast();
  if (snap(run) !== before) fail('a preview changed the run or its RNG', run);
  count('purity');
}

const START = [1, 1, 5, 5, 8, 12, 9, 13]; // 9 / 13: the post-clear shortcuts (第三層から / 灰の底から)

for (let n = 0; n < N; n++) {
  const profile = randomProfile();
  const mods = SD.Meta.computeMods(profile);
  const start = R.pick(START);
  const run = new SD.Run(mods, { seed: 1000 + n, startFloor: start });
  let ev;
  try { ev = run.begin(); } catch (e) { fail('begin threw ' + e.stack, run); continue; }
  let guard = 0;
  let fightKey = null, borrowsThisFight = 0, idleBand = null;
  while (run.phase !== 'dead' && run.phase !== 'won' && guard++ < 4000) {
    phases[run.phase] = (phases[run.phase] || 0) + 1;
    try {
      // per-fight bookkeeping
      const fk = run.enemy ? run.floor + ':' + run.enemy.id + ':' + run.stats.kills : null;
      if (fk !== fightKey) {
        fightKey = fk; borrowsThisFight = 0;
        // coverage for 灰の底: random play rarely beats the boss, so a cleared profile often meets a weakened one
        if (run.enemy && run.enemy.boss && run.mods.deepUnlocked && R.chance(0.7)) { run.enemy.hp = Math.min(run.enemy.hp, 30); run.enemy.seals = 0; run.enemy.phase = 2; count('boss-weakened'); }
        if (run.deep && run.enemy && run.phase === 'idle') {
          run._deepMet = run._deepMet || {};
          run._deepMet[run.enemy.id] = true;
          if (run.floor === 13 || run.floor === 14) { if (run.enemy.id !== run.deep.order[run.floor - 13]) fail('B' + run.floor + ' is not the rolled new enemy', run); }
        }
      }
      if (run.phase === 'idle') {
        if (R.chance(0.3)) purity(run);
        const B = run.scriptBand();
        idleBand = B ? { next: B.cells.find((c) => c.role === 'next'), intent: run.enemy.intent, cursor: run.enemy.cursor, boss: run.enemy.boss } : null;
        ev = run.spin(); actions.spin = (actions.spin || 0) + 1;
      } else if (run.phase === 'spun') {
        if (R.chance(0.25)) purity(run);
        // E: an auto-resolving 0-spark turn must not hide a borrowed action that would keep the party alive
        if (R.chance(0.3) && run.sparks === 0 && run.canBorrow() && run.shouldAutoResolve()) {
          const dies = run.previewTurn();
          if (dies && dies.partyDies && !dies.random && run.mods.nudge) {
            for (let i = 0; i < 3; i++) for (const d of [-1, 1]) {
              if (run.reels[i].jam) continue;
              const alive = run._sim((c) => { c.fight.borrowed = 1; if (c.reels[i].held) c.toggleHold(i); if (!c.nudge(i, d).length || c.phase !== 'spun') return false; const T = c.previewTurn(); return T && !T.partyDies && !T.secondWind; });
              if (alive) fail('0-spark turn auto-resolved although a borrowed nudge avoided death', run);
            }
          }
          count('zero-auto');
        }
        // forecast consistency: the preview must predict the payline that resolve() uses
        const before = run.forecast();
        const k = R.int(13);
        if (k === 0 && run.canRespin()) { for (let i = 0; i < 3; i++) if (R.chance(0.4)) run.toggleHold(i); ev = run.respin(); actions.respin = (actions.respin || 0) + 1; }
        else if (k === 1 && run.canNudgeAny()) { const i = R.int(3), d = R.chance(0.5) ? 1 : -1; ev = run.nudge(i, d); actions.nudge = (actions.nudge || 0) + 1; }
        else if (k === 2 && run.canBlessAny()) { for (let i = 0; i < 3; i++) if (run.canBless(i)) { ev = run.bless(i); break; } actions.bless = (actions.bless || 0) + 1; }
        else if (k === 3 && run.canEchoAny()) { for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (run.phase === 'spun' && run.canEcho(a, b) && R.chance(0.5)) { ev = run.echo(a, b); actions.echo = (actions.echo || 0) + 1; } }
        else if (k === 4 && run.canFateKey()) { const i = R.int(3); if (run.canFateKey(i)) { ev = run.fateKey(i, R.int(run.reels[i].strip.length)); actions.key = (actions.key || 0) + 1; } }
        else if (k === 5 && run.mods.holdMax) { run.toggleHold(R.int(3)); }
        else if ((k === 6 || k === 7) && run.mods.script) {
          // 拍子木: the preview must be exactly what happens; locked cells and a second send are refused
          const e = run.enemy, locked = run.isLockedCell(e.intent), used = run.fight.advanced;
          const P = run.previewAdvance();
          const cur0 = e.cursor, turn0 = e.turn, burn0 = e.burn, atk0 = e.atkBonus, hp0 = e.hp;
          ev = run.advance();
          if ((locked || used) && ev.length) fail('a locked/used script cell was sent', run, JSON.stringify(e.intent));
          if (ev.length) {
            actions.advance = (actions.advance || 0) + 1;
            if (e.cursor !== cur0 + 1 || e.turn !== turn0) fail('advance must move the cursor by one and not pass a turn', run);
            if (e.burn !== burn0 || e.atkBonus !== atk0 || e.hp !== hp0) fail('advance must not tick burn / growth / hp', run);
            if (P && !P.unknown && !sameIntent(P.intent, e.intent)) fail('advance preview != result', run, JSON.stringify([P.intent, e.intent]));
            if (P && P.unknown && !e.intent.random) fail('advance preview unknown but the cell was not drawn from dice', run);
            if (run.canAdvance()) fail('advance allowed twice in a turn', run);
            count('advance');
          }
        }
        else if (k === 8 && run.canBorrow()) {
          if (run.sparks !== 0) fail('borrow offered with sparks left', run);
          ev = run.borrow();
          borrowsThisFight++;
          if (borrowsThisFight > 1) fail('borrowed twice in one fight', run);
          if (run.sparkAvail() !== 1 || run.sparks !== 0) fail('borrow must give exactly one usable, unstored spark', run);
          actions.borrow = (actions.borrow || 0) + 1;
          count('borrow');
        }
        else {
          // the band's promises, recorded before resolving
          const B = run.scriptBand();
          const nextCell = B && B.cells.find((c) => c.role === 'next');
          const debtCell = B && B.cells.find((c) => c.role === 'debt');
          const skipCell = B && B.cells.find((c) => c.role === 'skip');
          const P = run.previewTurn();
          const hadDebt = !!(run.fight && run.fight.debt);
          const e = run.enemy, fightBefore = run.fight;
          const hpBefore = run.hp, block0 = run.block;
          const e0 = run.enemy ? { hp: run.enemy.hp, block: run.enemy.block, seals: run.enemy.seals } : null;
          ev = run.resolve();
          actions.resolve = (actions.resolve || 0) + 1;
          // compare predicted vs actual direct damage when nothing else interferes
          const acts = ev.filter((x) => x.t === 'act' && (x.sym === 'blade' || x.sym === 'flame' || x.sym === 'skull'));
          const dealt = acts.reduce((s, x) => s + (x.dmg || 0) + (x.absorbed || 0), 0);
          if (e0 && before.directDmg > 0 && !ev.some((x) => x.t === 'enemyDie' || x.t === 'chain') && Math.abs(dealt - before.directDmg) > 1)
            fail(`forecast mismatch predicted ${before.directDmg} actual ${dealt}`, run, JSON.stringify(acts.map((a) => [a.sym, a.dmg, a.absorbed])));
          // pyre forecast (exact now: hatwax cap and seals)
          const py = ev.find((x) => x.t === 'pyre');
          if (py && before.pyreDmg != null && !ev.some((x) => x.t === 'chain') && py.dmg !== Math.min(before.pyreDmg, e0.hp)) {
            const killedBefore = ev.findIndex((x) => x.t === 'enemyDie') >= 0 && ev.findIndex((x) => x.t === 'enemyDie') < ev.indexOf(py);
            if (!killedBefore && py.dmg < before.pyreDmg && py.hp > 0) fail(`pyre forecast ${before.pyreDmg} actual ${py.dmg}`, run);
          }
          // debt paid exactly once
          const debts = ev.filter((x) => x.t === 'debtAction').length;
          const ended = ev.some((x) => x.t === 'enemyDie' || x.t === 'partyDeath');
          if (hadDebt && !ended && debts !== 1) fail('a debt was not paid exactly once (' + debts + ')', run);
          if (!hadDebt && debts) fail('a debt was paid without borrowing', run);
          // a new fight never starts with borrow state from the last one
          if (ev.some((x) => x.t === 'combat') && run.fight && (run.fight.debt || run.fight.borrowed || run.fight.borrowUsed)) fail('borrow state leaked into the next fight', run);
          if (fightBefore && fightBefore.borrowed) fail('borrowed spark survived resolve', run);
          // damage prediction (the HP bar's striped forecast)
          if (P && !P.random) {
            let took = 0;
            for (const x of ev) { if (x.t === 'enemyAttack') took += x.dmg; if (x.t === 'reflect') took += Math.max(0, x.amount - x.blocked); if (x.t === 'selfHit') took += x.amount; }
            if (took !== P.damage) fail(`turn damage preview ${P.damage} actual ${took}`, run);
            count('damage');
          }
          // the band: next / debt / struck-out heavy
          const sameFight = run.enemy && run.enemy === e && run.phase === 'idle';
          if (sameFight && nextCell && !nextCell.unknown && !nextCell.cond) {
            if (!sameIntent(nextCell.it, run.enemy.intent)) fail('band "next" != the intent that came', run, JSON.stringify([nextCell.it, run.enemy.intent]));
            count('band-next');
          }
          if (debtCell && !debtCell.unknown) {
            const d = ev.find((x) => x.t === 'debtAction');
            if (d && !sameIntent(debtCell.it, d.intent)) fail('band debt cell != the debt action', run);
            if (d) count('band-debt');
          }
          if (skipCell && !skipCell.cond) {
            const sk = ev.find((x) => x.t === 'staggerCancel');
            if (!sk) fail('band showed a struck-out heavy but no stagger happened', run);
            count('band-skip');
          }
          // the idle (before-spin) reading of the band, when nothing on the payline touched the script this turn
          if (idleBand && sameFight && idleBand.next && !idleBand.next.unknown && !idleBand.next.cond &&
              !ev.some((x) => x.t === 'staggerCancel' || x.t === 'debtAction') && run.stats.advances === (run._advSeen || 0)) {
            if (!sameIntent(idleBand.next.it, run.enemy.intent)) fail('idle band "next" != the intent that came', run, JSON.stringify([idleBand.next.it, run.enemy.intent]));
            count('band-idle');
          }
          run._advSeen = run.stats.advances;
          idleBand = null;
          void hpBefore; void block0;
        }
      } else if (run.phase === 'descent') {
        const go = R.chance(0.8);
        ev = run.chooseDescent(go);
        count(go ? 'descent' : 'return');
        if (go && R.chance(0.6)) { run.maxHp = Math.max(run.maxHp, 400); run.hp = run.maxHp; count('deep-hp-boost'); }
      } else if (run.phase === 'crossroads') {
        const oi = run.offers && run.offers.length && R.chance(0.85) ? R.int(run.offers.length) : null;
        ev = run.choose(oi, R.int(run.doors.length));
      } else if (run.phase === 'event') {
        ev = run.chooseEvent(R.pick(run.event.options).id);
      } else if (run.phase === 'chisel') {
        if (R.chance(0.2)) ev = run.finishChisel();
        else { const ri = R.int(3); ev = run.chiselCell(ri, R.int(run.reels[ri].strip.length)); if (!ev.length && R.chance(0.5)) ev = run.finishChisel(); }
      }
      for (const x of ev || []) events[x.t] = (events[x.t] || 0) + 1;
      check(run, run.phase);
    } catch (e) {
      fail('threw in ' + run.phase + ': ' + e.stack.split('\n').slice(0, 3).join(' | '), run);
      break;
    }
  }
  if (guard >= 4000) fail('stuck', run);
  if (run.summary) {
    const s = run.summary;
    if (!isFinite(s.embers)) fail('summary embers NaN', run);
    // 灰の底: a settled boss win is counted once, however the descent ends
    const before = JSON.parse(JSON.stringify(profile.stats)), e0 = profile.embers;
    SD.Meta.applyFinishedRun(profile, s);
    const st = profile.stats;
    if (s.deepOnly) {
      // 灰の底から: the main-game record never moves
      count('deep-only-run');
      if (s.won || st.runs !== before.runs || st.wins !== before.wins || st.deaths !== before.deaths || st.bossKills !== before.bossKills || st.bestFloor !== before.bestFloor) fail('a 灰の底-only run touched the main-game record', run);
      if (st.deepRuns !== before.deepRuns + 1 || (st.deepClears - before.deepClears) + (st.deepFalls - before.deepFalls) !== 1) fail('a 灰の底-only run was not counted exactly once', run);
    } else if (st.runs !== before.runs + 1 || st.wins - before.wins > 1 || st.bossKills - before.bossKills > 1) fail('a run was counted more than once', run);
    if (profile.embers - e0 !== s.embers) fail('embers not counted exactly once: +' + (profile.embers - e0) + ' vs ' + s.embers, run);
    if (run.deep) {
      count('deep-run');
      if (!s.deepOnly && (!s.won || !s.deep || !s.settled)) fail('a descent ended without the settled win', run);
      if (st.deaths !== before.deaths) fail('a fall in 灰の底 counted as a death', run);
      if (s.deep.floor >= 14 && !(run._deepMet && run._deepMet.husk && run._deepMet.mirror)) fail('reached B14 without meeting both new enemies', run);
      if (s.deep.cleared) count('deep-clear');
    }
  }
}
console.log(`fuzz: ${N} runs, ${fails} failures`);
console.log('actions', actions);
console.log('checks', checks);
console.log('events seen', Object.keys(events).length, Object.keys(events).sort().join(' '));
process.exitCode = fails ? 1 : 0;
