/* EMBERWHEEL — persistent profile, skill unlocks, and modifier computation (pure + guarded localStorage). */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  const D = () => SD.Data;
  const SAVE_KEY = 'emberwheel_save_v1';
  const VERSION = 1;

  function newProfile() {
    return {
      version: VERSION,
      embers: 0,
      unlocked: { core: true },
      stats: {
        runs: 0, deaths: 0, wins: 0,
        bestFloor: 0, lastFloor: 0,
        totalEmbers: 0, triples: 0, bonds: 0, kills: 0,
        bossBestHpPct: null,   // lowest remaining boss HP % ever seen (null = never reached)
        bossKills: 0,
        eliteKills: {},        // enemyId -> count
        maxHit: 0,
        lastRun: null,         // summary of last run (for death-screen comparisons)
        deepRuns: 0, deepBest: 0, deepClears: 0, deepFalls: 0, // 灰の底: runs there (descents + direct), deepest floor, B16 cleared, fallen
      },
      seen: {},                // tutorial / first-time flags
      // comboPause: 'smart' = once 継ぎ留め/拍子木 are lit, a trine/bond waits for you while something can still be done; 'off' = always fires
      settings: { master: 0.8, music: 0.55, sfx: 0.85, speed: 1, comboPause: 'smart' },
    };
  }

  function storage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* blocked */ }
    return null;
  }

  function load() {
    const st = storage();
    if (!st) return newProfile();
    try {
      const raw = st.getItem(SAVE_KEY);
      if (!raw) return newProfile();
      const p = JSON.parse(raw);
      if (!p || typeof p !== 'object') return newProfile();
      if (p.version !== VERSION) {
        // never silently destroy progress from another build: keep a backup copy
        try { st.setItem(SAVE_KEY + '_bak_v' + p.version, raw); } catch (e) { /* ignore */ }
        return newProfile();
      }
      const obj = (x) => x && typeof x === 'object' && !Array.isArray(x);
      if (!obj(p.stats)) p.stats = {};
      if (!obj(p.stats.eliteKills)) p.stats.eliteKills = {};
      if (p.stats.bestVs != null && !obj(p.stats.bestVs)) p.stats.bestVs = {};
      if (!obj(p.unlocked)) p.unlocked = {};
      if (!obj(p.seen)) p.seen = {};
      if (!obj(p.settings)) p.settings = {};
      // merge with defaults so new fields exist
      const base = newProfile();
      p.stats = Object.assign(base.stats, p.stats || {});
      p.settings = Object.assign(base.settings, p.settings || {});
      p.seen = p.seen || {};
      p.unlocked = Object.assign({ core: true }, p.unlocked || {});
      if (typeof p.embers !== 'number' || !isFinite(p.embers)) p.embers = 0;
      return p;
    } catch (e) {
      return newProfile();
    }
  }

  function save(profile) {
    const st = storage();
    if (!st) return false;
    try { st.setItem(SAVE_KEY, JSON.stringify(profile)); return true; } catch (e) { return false; }
  }

  function reset() {
    const st = storage();
    if (st) { try { st.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
    return newProfile();
  }

  // ---------------------------------------------------------------- skill tree logic
  function isUnlocked(profile, id) { return !!profile.unlocked[id]; }

  function gateOk(profile, node) {
    if (!node.gate) return true;
    return (profile.stats.eliteKills[node.gate] || 0) > 0;
  }

  // A node is "reachable" when any prerequisite is owned (and its gate is satisfied).
  function isReachable(profile, id) {
    const node = D().SKILL_BY_ID[id];
    if (!node) return false;
    if (isUnlocked(profile, id)) return true;
    if (!gateOk(profile, node)) return false;
    return node.req.some((r) => isUnlocked(profile, r));
  }

  function canUnlock(profile, id) {
    const node = D().SKILL_BY_ID[id];
    if (!node || isUnlocked(profile, id)) return false;
    return isReachable(profile, id) && profile.embers >= node.cost;
  }

  function unlock(profile, id) {
    if (!canUnlock(profile, id)) return false;
    const node = D().SKILL_BY_ID[id];
    profile.embers -= node.cost;
    profile.unlocked[id] = true;
    profile.seen = profile.seen || {};
    profile.seen.fresh = (profile.seen.fresh || []).concat(id);
    return true;
  }

  // The single node the game recommends next (in-run tracker, camp default, death screen).
  function recommendedNode(profile, hint) {
    if (hint && !isUnlocked(profile, hint) && isReachable(profile, hint)) return D().SKILL_BY_ID[hint];
    const goals = nextGoals(profile, 40);
    const verbs = goals.filter((n) => n.kind === 'verb' || n.kind === 'rule');
    const cheapVerb = verbs.find((n) => n.cost <= (goals[0] ? goals[0].cost * 2.5 : 0));
    const affordable = verbs.find((n) => n.cost <= profile.embers);
    return affordable || cheapVerb || goals[0] || null;
  }

  // Cheapest reachable-but-locked nodes (the "next goals").
  function nextGoals(profile, n = 3) {
    const out = [];
    for (const node of D().SKILLS) {
      if (isUnlocked(profile, node.id) || !isReachable(profile, node.id)) continue;
      out.push(node);
    }
    out.sort((a, b) => a.cost - b.cost);
    return out.slice(0, n);
  }

  // ---------------------------------------------------------------- modifiers
  // Everything the Run needs to know about permanent unlocks.
  function computeMods(profile) {
    const u = (id) => !!profile.unlocked[id];
    const st = profile.stats;
    const m = {
      maxHp: D().BASE_HP,
      reels: 3,
      // manipulation
      sparks: u('nudge') || u('respin') || u('hyoshigi'),
      startSparks: 0, maxSparks: 0, sparkPerWin: 0,
      nudge: u('nudge'),
      nudgeRange: u('longpush') ? 2 : 1,
      respin: u('respin'),
      holdMax: u('respin') ? 2 : 0,
      freeNudge: u('deft') ? 1 : 0,
      stasis: u('stasis'),
      echo: u('echo'),
      fateKey: u('fatekey'),
      script: u('hyoshigi'),            // 拍子木: send the Ashwheel's script one cell
      borrow: u('borrow'),              // 借り火: borrow a one-turn spark, paid with the script
      comboPause: (u('stasis') || u('hyoshigi')) && !(profile.settings && profile.settings.comboPause === 'off'),
      precision: u('precision'),
      wildStart: u('wild') ? [1] : [],
      wildUnlocked: u('wild'),
      chiselStart: u('chisel') ? 2 : 0,
      // valor
      bladeBonus: u('whet') ? 1 : 0,
      bond: u('bond'),
      burnPerFlame: u('kindle') ? 2 : 0,
      momentum: u('momentum'),
      execute: u('execute'),
      pyre: u('pyre'),
      skullPact: u('skullpact'),
      pairMult: u('twin') ? 2.0 : 1.5,
      trineMult: u('trine') ? 3.5 : 2.5,
      chain: u('chain'),
      // hearth
      campfire: u('campfire'),
      thorns: u('thorns'),
      bless: u('bless'),
      secondWind: u('secondwind'),
      bulwark: u('bulwark'),
      lastStand: u('laststand'),
      guardian: u('guardian'),
      keeper: u('keeper'),
      // bridges
      crossroads: u('crossroads'),
      gambler: u('gambler'),
      gentle: u('gentle'),
      bloodPrice: u('bloodprice'),
      // onboarding / structure
      runNo: st.runs + 1,
      emberMult: 0.85,
      awakening: st.runs === 0 && !u('nudge'),
      doors: st.runs >= 1,
      shrines: st.runs >= 2,
      shortcuts: Object.keys(D().SHORTCUTS).map(Number).filter((f) => {
        const sc = D().SHORTCUTS[f];
        if (sc.gate && !((st.eliteKills[sc.gate] || 0) > 0)) return false;
        if (sc.gateStat && !((st[sc.gateStat[0]] || 0) >= sc.gateStat[1])) return false;
        return true;
      }),
      abbotBonus: (st.eliteKills.abbot || 0) > 0,
      deepUnlocked: (st.wins || 0) > 0, // after the first clear, 灰輪の主 can be followed into 灰の底
    };
    if (m.sparks) { m.startSparks = 2; m.maxSparks = 3; m.sparkPerWin = 1; }
    if (!m.sparks) m.borrow = false;
    if (u('sparkjar')) { m.startSparks += 1; m.maxSparks += 1; }
    if (u('cloak')) m.maxHp += 10;
    if (u('toughness')) m.maxHp += 15;
    return m;
  }

  // 灰の底: fold in only what the descent added (the boss win was applied when it was settled). Never touches runs / wins /
  // deaths / boss kills. Returns { newDeepBest, firstDeepClear, firstDeepElite, ... }.
  function applyDeepResult(profile, summary) {
    const s = profile.stats, d = summary.deep;
    const res = { newDeepBest: summary.floor > (s.deepBest || 0), firstDeepClear: d.cleared && !(s.deepClears > 0), prevDeepBest: s.deepBest || 0, firstDeepRun: !(s.deepRuns > 0) };
    // the B16 elite (stage 3b) beaten for the first time — kills are kept per enemy id, so the stage 3a stand-in never counts
    const b16 = D().FLOORS[D().DEEP_LAST_FLOOR].enemy;
    res.firstDeepElite = d.eliteKills.indexOf(b16) >= 0 && !((s.eliteKills[b16] || 0) > 0);
    s.deepRuns = (s.deepRuns || 0) + 1;
    s.deepBest = Math.max(s.deepBest || 0, summary.floor);
    if (d.cleared) s.deepClears = (s.deepClears || 0) + 1; else s.deepFalls = (s.deepFalls || 0) + 1;
    s.kills += d.kills;
    s.triples += d.triples;
    s.bonds += d.bonds;
    s.maxHit = Math.max(s.maxHit || 0, summary.stats.maxHit || 0);
    for (const id of d.eliteKills) s.eliteKills[id] = (s.eliteKills[id] || 0) + 1;
    s.totalEmbers += d.embers;
    profile.embers += d.embers;
    // a run started at 灰の底 is not part of the main game: its 前回 stays the last main run
    if (!summary.deepOnly) s.lastRun = Object.assign({}, s.lastRun, { embers: ((s.lastRun && s.lastRun.embers) || 0) + d.embers, deepFloor: summary.floor, deepCleared: d.cleared });
    return res;
  }
  // A whole finished run in one call (tools / tests): a settled boss win plus its descent is applied exactly once.
  function applyFinishedRun(profile, summary) {
    if (summary.deepOnly) return applyDeepResult(profile, summary); // 灰の底 only: the main-game record is untouched
    if (summary.deep) { const res = applyRunResult(profile, summary.base); return Object.assign(res, applyDeepResult(profile, summary)); }
    return applyRunResult(profile, summary);
  }

  // Fold a finished run summary into the profile. Returns { newBestFloor, newBossRecord }.
  function applyRunResult(profile, summary) {
    const s = profile.stats;
    const res = { newBestFloor: false, newBossRecord: false, prevBest: s.bestFloor, prevLast: s.lastFloor, prevBossBest: s.bossBestHpPct,
      firstHound: !(s.eliteKills.bellhound > 0) && (summary.eliteKills || []).indexOf('bellhound') >= 0,
      firstAbbot: !(s.eliteKills.abbot > 0) && (summary.eliteKills || []).indexOf('abbot') >= 0 };
    s.runs += 1;
    if (summary.won) s.wins += 1; else s.deaths += 1;
    if (summary.floor > s.bestFloor) { s.bestFloor = summary.floor; res.newBestFloor = true; }
    s.lastFloor = summary.floor;
    s.totalEmbers += summary.embers;
    s.triples += summary.stats.triples || 0;
    s.bonds += summary.stats.bonds || 0;
    s.kills += summary.stats.kills || 0;
    s.maxHit = Math.max(s.maxHit || 0, summary.stats.maxHit || 0);
    for (const id of summary.eliteKills || []) s.eliteKills[id] = (s.eliteKills[id] || 0) + 1;
    if (summary.bossHpPct != null) {
      if (s.bossBestHpPct == null || summary.bossHpPct < s.bossBestHpPct) { s.bossBestHpPct = summary.bossHpPct; res.newBossRecord = true; }
    }
    if (summary.won) s.bossKills += 1;
    if (summary.killer) {
      s.bestVs = s.bestVs || {};
      const id = summary.killer.id, prev = s.bestVs[id];
      if (prev == null || summary.killer.hpPct < prev) s.bestVs[id] = summary.killer.hpPct;
    }
    profile.embers += summary.embers;
    s.lastRun = { floor: summary.floor, embers: summary.embers, won: !!summary.won };
    return res;
  }

  SD.Meta = {
    SAVE_KEY, newProfile, load, save, reset,
    isUnlocked, isReachable, canUnlock, unlock, nextGoals, recommendedNode, computeMods, applyRunResult, applyDeepResult, applyFinishedRun, gateOk,
  };
})();
