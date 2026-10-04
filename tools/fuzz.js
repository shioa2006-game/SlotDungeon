/* EMBERWHEEL — engine fuzz test: random unlocks + random legal actions, checking invariants.
 *   node tools/fuzz.js [runs] */
'use strict';
const path = require('path');
globalThis.SD = {};
for (const f of ['util', 'data', 'meta', 'engine']) require(path.join(__dirname, '..', 'js', 'core', f + '.js'));
const SD = globalThis.SD;
const N = +process.argv[2] || 3000;
const R = SD.Util.makeRng(4242);
const VALID = new Set(['chisel', 'crossroads', 'event', 'idle', 'spun', 'dead', 'won']);
let fails = 0, phases = {}, events = {}, actions = {};

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
  }
  if (!isFinite(run.embers) || run.embers < 0) fail('embers bad @' + where, run);
}

function randomProfile() {
  const p = SD.Meta.newProfile();
  p.stats.runs = R.int(6);
  if (R.chance(0.4)) p.stats.eliteKills.bellhound = 1;
  for (const s of SD.Data.SKILLS) if (R.chance(0.45)) p.unlocked[s.id] = true;
  return p;
}

for (let n = 0; n < N; n++) {
  const profile = randomProfile();
  const mods = SD.Meta.computeMods(profile);
  const start = mods.shortcuts.length && R.chance(0.5) ? 5 : 1;
  const run = new SD.Run(mods, { seed: 1000 + n, startFloor: start });
  let ev;
  try { ev = run.begin(); } catch (e) { fail('begin threw ' + e.stack, run); continue; }
  let guard = 0;
  while (run.phase !== 'dead' && run.phase !== 'won' && guard++ < 4000) {
    phases[run.phase] = (phases[run.phase] || 0) + 1;
    try {
      if (run.phase === 'idle') { ev = run.spin(); actions.spin = (actions.spin || 0) + 1; }
      else if (run.phase === 'spun') {
        // forecast consistency: the preview must predict the payline that resolve() uses
        const before = run.forecast();
        const k = R.int(10);
        if (k === 0 && run.canRespin()) { for (let i = 0; i < 3; i++) if (R.chance(0.4)) run.toggleHold(i); ev = run.respin(); actions.respin = (actions.respin || 0) + 1; }
        else if (k === 1 && run.canNudgeAny()) { const i = R.int(3), d = R.chance(0.5) ? 1 : -1; ev = run.nudge(i, d); actions.nudge = (actions.nudge || 0) + 1; }
        else if (k === 2 && run.canBlessAny()) { for (let i = 0; i < 3; i++) if (run.canBless(i)) { ev = run.bless(i); break; } actions.bless = (actions.bless || 0) + 1; }
        else if (k === 3 && run.canEchoAny()) { for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (run.phase === 'spun' && run.canEcho(a, b) && R.chance(0.5)) { ev = run.echo(a, b); actions.echo = (actions.echo || 0) + 1; } }
        else if (k === 4 && run.canFateKey()) { const i = R.int(3); if (run.canFateKey(i)) { ev = run.fateKey(i, R.int(run.reels[i].strip.length)); actions.key = (actions.key || 0) + 1; } }
        else if (k === 5 && run.mods.holdMax) { run.toggleHold(R.int(3)); }
        else {
          const hpBefore = run.hp, block0 = run.block;
          const e0 = run.enemy ? { hp: run.enemy.hp, block: run.enemy.block, seals: run.enemy.seals } : null;
          ev = run.resolve();
          actions.resolve = (actions.resolve || 0) + 1;
          // compare predicted vs actual direct damage when nothing else interferes
          const acts = ev.filter((x) => x.t === 'act' && (x.sym === 'blade' || x.sym === 'flame' || x.sym === 'skull'));
          const dealt = acts.reduce((s, x) => s + (x.dmg || 0) + (x.absorbed || 0), 0);
          if (e0 && before.directDmg > 0 && !ev.some((x) => x.t === 'enemyDie' || x.t === 'chain') && Math.abs(dealt - before.directDmg) > 1)
            fail(`forecast mismatch predicted ${before.directDmg} actual ${dealt}`, run, JSON.stringify(acts.map((a) => [a.sym, a.dmg, a.absorbed])));
          void hpBefore; void block0;
        }
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
    SD.Meta.applyRunResult(profile, s);
  }
}
console.log(`fuzz: ${N} runs, ${fails} failures`);
console.log('actions', actions);
console.log('events seen', Object.keys(events).length, Object.keys(events).sort().join(' '));
