/* EMBERWHEEL — run & combat engine (pure, deterministic with a seed).
 *
 *   const run = new SD.Run(SD.Meta.computeMods(profile), { seed, startFloor });
 *   run.begin() -> events
 *   run.phase: 'chisel' | 'crossroads' | 'event' | 'idle' | 'spun' | 'dead' | 'won'
 *   combat:   spin() / toggleHold(i) / respin() / nudge(i, dir) / bless(i) / echo(src, dst) / fateKey(reel, cell)
 *             advance() (拍子木: send the enemy's script one cell) / borrow() (借り火: a one-turn spark, paid with the script)
 *             forecast() (pure preview of the payline) / shouldAutoResolve() / resolve()
 *   previews (never touch the real state or the RNG): scriptBand() / previewTurn() / previewAdvance() / previewBorrow()
 *   between:  choose(offerIdx|null, doorIdx)  (crossroads: carving/relic pick + next door on ONE screen)
 *             chooseEvent(optionId) / chiselCell(reel, cell) / finishChisel()
 *   end:      run.summary
 * Mutating methods return arrays of events { t: 'type', ... } that the presentation layer animates in order.
 */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  const U = () => SD.Util;
  const D = () => SD.Data;

  let UID = 1;
  const cell = (s, extra) => Object.assign({ s, g: false, temp: false, uid: UID++ }, extra || {});
  const COMBO_KINDS = { trine: 1, quad: 1, bond: 1, reaper: 1 };
  const UNKNOWN_CELL = { k: 'unknown', label: '？', unknown: true };

  class Run {
    constructor(mods, opts = {}) {
      const Data = D();
      this.mods = mods;
      this.seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 2147483647);
      this.rng = U().makeRng(this.seed);
      this.startFloor = opts.startFloor || 1;
      this.floor = 0;
      this.maxHp = mods.maxHp;
      this.hp = this.maxHp;
      this.block = 0;
      this.sparkBonus = 0;
      this.sparks = mods.startSparks;
      this.relics = [];
      this.embers = 0;
      this.emberLog = { kill: 0, lantern: 0, depth: 0, fight: 0, event: 0, shortcut: 0 };
      this.stats = {
        kills: 0, triples: 0, bonds: 0, reapers: 0, spins: 0, respins: 0, nudges: 0, turns: 0, maxHit: 0,
        damageTaken: 0, heavyTaken: 0, selfDmg: 0, lanterns: 0,
        // regrets (fate's whisper)
        nearMiss: 0, pairNoTrine: 0, armorLost: 0, wardShort: 0, bondNear: 0, markHits: 0, thirstLost: 0, zeroSpark: 0, burnDealt: 0,
        // the Ashwheel's script / borrowing
        advances: 0, borrows: 0, debtTaken: 0, enemyHealed: 0, zeroTurns: 0, lockedTurns: 0,
      };
      this.eliteKills = [];
      this.usedEvents = {};
      this.secondWindUsed = false;
      this.lastFightTurns = 99;
      this.phase = 'start';
      this.enemy = null;
      this.fight = null;
      this.offers = null;
      this.offerKind = null;
      this.doors = null;
      this.event = null;
      this.chisel = null;
      this.pending = [];
      this.summary = null;
      this.bossHpPct = null;
      this.killer = null;
      this.awaken = { done: !mods.awakening, ready: false };
      this.lastHeld = -1;
      this.reels = [];
      for (let i = 0; i < mods.reels; i++) {
        const strip = Data.START_STRIPS[i % Data.START_STRIPS.length].map((s) => cell(s));
        this.reels.push({ strip, pos: this.rng.int(strip.length), held: false, carried: false, jam: false, echo: null });
      }
      for (const ri of mods.wildStart) {
        const r = this.reels[ri];
        if (r) this._insertCell(ri, cell('wild'));
      }
    }

    get maxSparks() { return this.mods.maxSparks + this.sparkBonus; }
    hasRelic(id) { return this.relics.indexOf(id) >= 0; }
    zoneOf(floor) { return D().FLOORS[floor] ? D().FLOORS[floor].zone : 'abyss'; }
    _gainSparks(n) {
      if (!this.mods.sparks || n <= 0) return 0;
      const b = this.sparks;
      this.sparks = Math.min(this.maxSparks, this.sparks + n);
      return this.sparks - b;
    }
    // sparks usable right now: the stored ones plus a spark borrowed from the Ashwheel (this turn only, never stored)
    sparkAvail() { return this.sparks + (this.fight && this.fight.borrowed > 0 ? this.fight.borrowed : 0); }
    borrowedSparks() { return this.fight && this.fight.borrowed > 0 ? this.fight.borrowed : 0; }
    _paySpark() {
      if (this.fight && this.fight.borrowed > 0) { this.fight.borrowed -= 1; return 'borrowed'; }
      this.sparks -= 1;
      return 'spark';
    }

    // ================================================================== flow
    begin() {
      const ev = [{ t: 'runStart', floor: this.startFloor }];
      const sc = D().SHORTCUTS[this.startFloor];
      if (sc) {
        for (let i = 0; i < sc.carvings; i++) this.pending.push('carving');
        for (let i = 0; i < sc.relics + (this.mods.abbotBonus && this.startFloor === 5 ? 1 : 0); i++) this.pending.push('relic');
        // 灰の底から: a 灰の底-only run (no boss, no main-game record); B13 / B14 order is rolled now
        if (sc.deepOnly) {
          this.deep = { order: this.rng.shuffle(D().DEEP_PAIR.slice()) };
          this.deepOnly = true;
          this.settled = { embers: 0, depth: this._depthEmbers(this.startFloor), stats: Object.assign({}, this.stats), elites: 0, summary: null };
        }
        const sev = { t: 'shortcut', floor: this.startFloor, embers: sc.embers };
        if (sc.postClear) Object.assign(sev, { label: sc.label, bossEmbers: sc.bossEmbers || 0, deepOnly: !!sc.deepOnly }); // (B5's event is unchanged)
        ev.push(sev);
      }
      if (this.mods.chiselStart > 0) return ev.concat(this._beginChisel(this.mods.chiselStart, 'remove', 'start'));
      return ev.concat(this._continue());
    }

    // Decide what comes next after a room / step finishes.
    _continue() {
      if (this.pending.length) {
        const kind = this.pending.shift();
        this.offerKind = kind;
        this.offers = kind === 'relic' ? this._relicOffers() : this._carvings();
        if (kind === 'relic' && !this.offers.length) { this.offerKind = 'carving'; this.offers = this._carvings(); }
        this.doors = this.pending.length ? [{ kind: 'continue' }] : this._nextDoors();
        this.phase = 'crossroads';
        return [{ t: 'crossroads', offers: this.offers, offerKind: this.offerKind, doors: this.doors }];
      }
      const doors = this._nextDoors();
      if (!doors.length) return this._win();
      if (this.floor === 0) return this._takeDoor(doors[0]); // the first room of a run: walk straight in
      this.offers = null; this.offerKind = null;
      this.doors = doors;
      this.phase = 'crossroads';
      return [{ t: 'crossroads', offers: null, offerKind: null, doors }];
    }

    _nextDoors() {
      const next = this.floor === 0 ? this.startFloor : this.floor + 1;
      const f = D().FLOORS[next];
      if (!f) return [];
      if (f.deepSlot != null) return [{ kind: 'battle', floor: next, enemy: this.deep ? this.deep.order[f.deepSlot] : D().DEEP_PAIR[f.deepSlot] }];
      if (f.type !== 'normal') return [{ kind: f.type, floor: next, enemy: f.enemy }];
      if (!this.mods.doors || this.floor === 0) return [{ kind: 'battle', floor: next, enemy: this._rollEnemy(next) }];
      const n = this.mods.crossroads ? 3 : 2;
      const kinds = ['battle'];
      const weights = { dread: 3, shrine: this.mods.shrines ? 3 : 0, campfire: this.mods.campfire ? 2.4 : 0, battle: 1.2 };
      let guard = 0;
      while (kinds.length < n && guard++ < 60) {
        const k = this.rng.weighted(Object.keys(weights), (x) => weights[x]);
        if (k !== 'battle' && kinds.indexOf(k) >= 0) continue;
        if (k === 'battle' && kinds.filter((x) => x === 'battle').length >= 2) continue;
        kinds.push(k);
      }
      this.rng.shuffle(kinds);
      const used = {};
      return kinds.map((kind) => {
        const d = { kind, floor: next };
        if (kind === 'battle' || kind === 'dread') {
          let id = this._rollEnemy(next), tries = 0;
          while ((used[id] || (kind === 'dread' && id === 'shade')) && tries++ < 12) id = this._rollEnemy(next);
          used[id] = true;
          d.enemy = id;
        }
        if (kind === 'shrine') d.event = this._rollEvent();
        return d;
      });
    }

    _rollEnemy(n) {
      const f = D().FLOORS[n];
      let pool = f.pool.slice();
      if (this._lastEnemy && pool.length > 1) pool = pool.filter((p) => p !== this._lastEnemy);
      return this.rng.pick(pool);
    }

    _rollEvent() {
      const all = Object.keys(D().EVENTS).filter((k) => !this.usedEvents[k]);
      return this.rng.pick(all.length ? all : Object.keys(D().EVENTS));
    }

    // Crossroads: apply the chosen carving/relic (or skip with null) and walk through the chosen door.
    choose(offerIdx, doorIdx) {
      if (this.phase !== 'crossroads' || !this.doors) return [];
      const door = this.doors[doorIdx];
      if (!door) return [];
      const ev = [];
      const offers = this.offers;
      this.offers = null; this.doors = null;
      if (offers && offerIdx != null && offers[offerIdx]) {
        const res = this._applyOffer(offers[offerIdx]);
        ev.push(...res.ev);
        if (res.chisel) { this._afterChisel = door; return ev.concat(this._beginChisel(1, 'remove', 'reward')); }
      }
      return ev.concat(this._takeDoor(door));
    }

    _takeDoor(door) {
      if (door.kind === 'continue') return this._continue();
      return [{ t: 'door', door }].concat(this._enterFloor(door.floor, door));
    }

    _enterFloor(n, door) {
      this.floor = n;
      const f = D().FLOORS[n];
      const ev = [{ t: 'floor', floor: n, zone: f.zone, kind: door.kind, newZone: n === D().ZONES[f.zone].floors[0] }];
      if (door.kind === 'shrine') return ev.concat(this._startEvent(door.event || this._rollEvent()));
      if (door.kind === 'campfire') return ev.concat(this._startEvent('campfire'));
      const enemyId = door.enemy || f.enemy || this._rollEnemy(n);
      return ev.concat(this._startCombat(enemyId, { dread: door.kind === 'dread' }));
    }

    // ================================================================== events
    _startEvent(id) {
      this.usedEvents[id] = true;
      if (id === 'campfire') {
        this.event = { id: 'campfire', name: '焚き火', glyph: '焚', text: '小さな焚き火。しばし休める。', options: [
          { id: 'rest', label: '休む', desc: 'HPを35%回復' },
          { id: 'carve', label: '彫り直す', desc: '好きなコマを1つ削る' }] };
      } else {
        const def = D().EVENTS[id];
        const opts = def.options.filter((o) => (!o.needs || this.mods[o.needs]) && (!o.notNeeds || !this.mods[o.notNeeds]));
        this.event = { id, name: def.name, glyph: def.glyph, text: def.text, options: opts };
      }
      this.phase = 'event';
      return [{ t: 'event', event: this.event }];
    }

    chooseEvent(optId) {
      if (this.phase !== 'event' || !this.event) return [];
      const id = this.event.id;
      if (!this.event.options.some((o) => o.id === optId)) return [];
      const ev = [{ t: 'eventChoice', id, opt: optId }];
      this.event = null;
      const heal = (amt) => { const b = this.hp; this.hp = Math.min(this.maxHp, this.hp + amt); return this.hp - b; };
      switch (optId) {
        case 'rest': { const h = heal(Math.round(this.maxHp * 0.35)); ev.push({ t: 'heal', amount: h, hp: this.hp, src: 'rest' }); break; }
        case 'carve': return ev.concat(this._beginChisel(1, 'remove', 'campfire'));
        case 'pay': {
          this.hp = Math.max(1, this.hp - 10); this.sparkBonus += 1; this.sparks = this.maxSparks;
          ev.push({ t: 'selfHit', amount: 10, hp: this.hp, cause: 'altar' }, { t: 'sparks', delta: 1, total: this.sparks, max: this.maxSparks, src: 'altar' });
          break;
        }
        case 'pay_hp': {
          this.hp = Math.max(1, this.hp - 8); this.maxHp += 8; this.hp += 8;
          ev.push({ t: 'selfHit', amount: 8, hp: this.hp, cause: 'altar' }, { t: 'maxHp', maxHp: this.maxHp, hp: this.hp });
          break;
        }
        case 'open': {
          const rel = this._relicOffers()[0];
          if (rel) { this._addRelic(rel.id); ev.push({ t: 'relic', id: rel.id }); }
          const added = [];
          for (let ri = 0; ri < this.reels.length; ri++) added.push(this._insertCell(ri, cell('skull')));
          ev.push({ t: 'curse', cells: added, permanent: true });
          break;
        }
        case 'spin': {
          const roll = this.rng.next();
          let sym, result;
          if (roll < 0.25) { sym = 'lantern'; this._gainEmbers(30, 'event'); result = '残り火 +30'; }
          else if (roll < 0.45) { sym = 'heart'; heal(this.maxHp); result = 'HP 全回復'; }
          else if (roll < 0.65) { sym = 'blade'; const ri = this.rng.int(this.reels.length); this._insertCell(ri, cell('blade', { g: true })); result = `リール${ri + 1}に金箔の剣`; }
          else if (roll < 0.85) { sym = 'skull'; this.hp = Math.max(1, this.hp - 10); result = 'HP -10'; }
          else { sym = this.rng.pick(['ward', 'flame']); result = '何も起きなかった'; }
          ev.push({ t: 'fate', sym, result, hp: this.hp, embers: this.embers });
          break;
        }
        case 'chisel2': return ev.concat(this._beginChisel(2, 'remove', 'event'));
        case 'dup': return ev.concat(this._beginChisel(1, 'dup', 'event'));
        case 'open_mimic': {
          if (this.rng.chance(0.5)) {
            const rel = this._relicOffers()[0];
            if (rel) { this._addRelic(rel.id); ev.push({ t: 'relic', id: rel.id }); }
            break;
          }
          this.pending.unshift('relic');
          return ev.concat(this._startCombat('mimic', {}));
        }
        default: break; // leave
      }
      return ev.concat(this._continue());
    }

    // ================================================================== chisel (strip editing)
    _beginChisel(n, mode, reason) {
      this.chisel = { left: n, mode, reason };
      this.phase = 'chisel';
      return [{ t: 'chiselStart', left: n, mode, reason }];
    }

    canChiselCell(ri, ci) {
      if (this.phase !== 'chisel' || !this.chisel) return false;
      const r = this.reels[ri];
      if (!r || !r.strip[ci]) return false;
      if (this.chisel.mode === 'remove') return r.strip.length > D().STRIP_MIN;
      return r.strip.length < D().STRIP_MAX && r.strip[ci].s !== 'skull';
    }

    chiselCell(ri, ci) {
      if (!this.canChiselCell(ri, ci)) return [];
      const r = this.reels[ri];
      const ev = [];
      if (this.chisel.mode === 'remove') {
        const removed = r.strip.splice(ci, 1)[0];
        if (r.pos >= r.strip.length || ci < r.pos) r.pos = U().mod(r.pos - (ci < r.pos ? 1 : 0), r.strip.length);
        ev.push({ t: 'chiseled', reel: ri, cell: ci, sym: removed.s, mode: 'remove' });
      } else {
        const c = r.strip[ci];
        r.strip.splice(ci + 1, 0, cell(c.s, { g: c.g }));
        if (ci < r.pos) r.pos += 1;
        ev.push({ t: 'chiseled', reel: ri, cell: ci, sym: c.s, mode: 'dup' });
      }
      this.chisel.left -= 1;
      if (this.chisel.left <= 0) return ev.concat(this.finishChisel());
      return ev;
    }

    finishChisel() {
      if (this.phase !== 'chisel') return [];
      this.chisel = null;
      const ev = [{ t: 'chiselEnd' }];
      if (this._afterChisel) { const d = this._afterChisel; this._afterChisel = null; return ev.concat(this._takeDoor(d)); }
      return ev.concat(this._continue());
    }

    _insertCell(ri, c) {
      const r = this.reels[ri];
      // avoid placing identical symbols next to each other when possible
      const n = r.strip.length;
      const ok = [];
      for (let at = 0; at <= n; at++) {
        const prev = r.strip[U().mod(at - 1, n)], next = r.strip[at % n];
        if (n === 0 || ((!prev || prev.s !== c.s) && (!next || next.s !== c.s))) ok.push(at);
      }
      const at = ok.length ? this.rng.pick(ok) : this.rng.int(n + 1);
      r.strip.splice(at, 0, c);
      if (at <= r.pos && n > 0) r.pos = (r.pos + 1) % r.strip.length; // keep the payline symbol stable
      return { reel: ri, index: at, sym: c.s };
    }

    // ================================================================== offers
    _relicOffers() {
      const ids = Object.keys(D().RELICS).filter((id) => {
        if (this.hasRelic(id)) return false;
        const need = D().RELICS[id].needs;
        if (need === 'sparks' && !this.mods.sparks) return false;
        if (need === 'burn' && !(this.mods.burnPerFlame || this.hasRelic('flint'))) return false;
        return true;
      });
      this.rng.shuffle(ids);
      return ids.slice(0, 3).map((id) => ({ kind: 'relic', id }));
    }

    _addRelic(id) {
      this.relics.push(id);
      if (id === 'ironheart') { this.maxHp += 12; this.hp = Math.min(this.maxHp, this.hp + 12); }
      if (id === 'stardust') this._insertCell(this.rng.int(this.reels.length), cell('wild'));
    }

    mostStocked() {
      const counts = {};
      for (const r of this.reels) for (const c of r.strip) if (['blade', 'flame', 'ward', 'heart'].indexOf(c.s) >= 0 && !c.temp) counts[c.s] = (counts[c.s] || 0) + 1;
      let best = 'blade', bn = -1;
      for (const s of ['blade', 'flame', 'ward', 'heart']) if ((counts[s] || 0) > bn) { bn = counts[s] || 0; best = s; }
      return best;
    }

    _carvings() {
      const Data = D(), rng = this.rng, R = this.reels.length;
      const out = [], used = {};
      const stock = this.mostStocked();
      const attempt = (k) => {
        const ri = rng.int(R), r = this.reels[ri];
        switch (k) {
          case 'add': {
            if (r.strip.length >= Data.STRIP_MAX) return null;
            const table = { blade: 3, flame: 2.6, ward: 2.2, heart: 2.2, lantern: 0.9 };
            if (this.mods.wildUnlocked) table.wild = 0.8;
            if (this.mods.skullPact) table.skull = 1.2;
            if (this.mods.bond) { const want = D().BOND_ORDER[ri]; if (want) table[want] += 1.5; }
            if (out.some((o) => o.kind === 'add' && o.sym === stock)) table[stock] = 0; // at most one "more of your most-stocked"
            const s = rng.weighted(Object.keys(table), (x) => table[x]);
            return { kind: 'add', reel: ri, sym: s };
          }
          case 'add2': {
            if (r.strip.length >= Data.STRIP_MAX - 1) return null;
            const s = rng.pick(['blade', 'flame', 'ward', 'heart']);
            return { kind: 'add2', reel: ri, sym: s };
          }
          case 'transmute': {
            const cands = r.strip.filter((c) => !c.temp && c.s !== 'wild');
            if (!cands.length) return null;
            const prefer = cands.filter((c) => c.s === 'lantern' || c.s === 'skull');
            const from = (prefer.length && rng.chance(0.55)) ? rng.pick(prefer) : rng.pick(cands);
            const targets = ['blade', 'flame', 'ward', 'heart'].filter((s) => s !== from.s);
            return { kind: 'transmute', reel: ri, from: from.s, to: rng.pick(targets) };
          }
          case 'remove': {
            if (r.strip.length <= Data.STRIP_MIN) return null;
            const types = {};
            for (const c of r.strip) if (!c.temp) types[c.s] = (types[c.s] || 0) + 1;
            const keys = Object.keys(types);
            if (!keys.length) return null;
            const w = (s) => (s === 'skull' ? 6 : s === 'lantern' ? 2 : s === 'wild' ? 0.05 : 1);
            return { kind: 'remove', reel: ri, sym: rng.weighted(keys, w) };
          }
          case 'chisel': return { kind: 'chisel' };
          case 'gild': {
            const cands = r.strip.filter((c) => !c.g && !c.temp && ['blade', 'flame', 'ward', 'heart'].indexOf(c.s) >= 0);
            if (!cands.length) return null;
            return { kind: 'gild', reel: ri, sym: rng.pick(cands).s };
          }
          case 'heal': return this.hp < this.maxHp * 0.8 ? { kind: 'heal', amount: Math.round(this.maxHp * 0.3) } : null;
          case 'spark': return this.mods.sparks ? { kind: 'spark' } : null;
          default: return null;
        }
      };
      const kindW = { add: 4, add2: 0.9, transmute: 2.2, remove: 1.6, chisel: 0.9, gild: 1.3, heal: 1.4, spark: this.mods.sparks ? 0.6 : 0 };
      // Run 1's very first offer always contains a chunky option so the first pick is felt.
      if (this.mods.runNo === 1 && !this._firstOfferDone) {
        this._firstOfferDone = true;
        const g = attempt('gild') || attempt('add2');
        if (g) { out.push(g); used[g.kind] = 1; }
      }
      let guard = 0;
      while (out.length < 3 && guard++ < 100) {
        const k = rng.weighted(Object.keys(kindW), (x) => (x === 'add' ? (used.add >= 2 ? 0 : kindW[x]) : used[x] ? 0 : kindW[x]));
        const o = attempt(k);
        if (!o) continue;
        const key = JSON.stringify(o);
        if (out.some((p) => JSON.stringify(p) === key)) continue;
        used[k] = (used[k] || 0) + 1;
        out.push(o);
      }
      return out;
    }

    _applyOffer(o) {
      const ev = [{ t: 'offerTaken', offer: o }];
      const r = o.reel != null ? this.reels[o.reel] : null;
      switch (o.kind) {
        case 'relic': this._addRelic(o.id); ev.push({ t: 'relic', id: o.id }); break;
        case 'add': ev.push({ t: 'carved', ...this._insertCell(o.reel, cell(o.sym)) }); break;
        case 'add2':
          ev.push({ t: 'carved', ...this._insertCell(o.reel, cell(o.sym)) });
          ev.push({ t: 'carved', ...this._insertCell(o.reel, cell(o.sym)) });
          break;
        case 'transmute': {
          const n = r.strip.length;
          const cands = r.strip.map((c, i) => ({ c, i })).filter((x) => x.c.s === o.from && !x.c.temp);
          const clean = cands.filter((x) => r.strip[(x.i + 1) % n].s !== o.to && r.strip[(x.i - 1 + n) % n].s !== o.to);
          const pick = (clean.length ? clean : cands)[0];
          if (pick) { pick.c.s = o.to; ev.push({ t: 'carved', reel: o.reel, index: pick.i, sym: o.to }); }
          break;
        }
        case 'remove': {
          const idx = r.strip.findIndex((c) => c.s === o.sym && !c.temp);
          if (idx >= 0 && r.strip.length > D().STRIP_MIN) {
            r.strip.splice(idx, 1);
            if (idx < r.pos) r.pos -= 1;
            if (r.pos >= r.strip.length) r.pos = 0;
            ev.push({ t: 'chiseled', reel: o.reel, cell: idx, sym: o.sym, mode: 'remove' });
          }
          break;
        }
        case 'gild': {
          const c = r.strip.find((c) => c.s === o.sym && !c.g && !c.temp);
          if (c) { c.g = true; ev.push({ t: 'carved', reel: o.reel, index: r.strip.indexOf(c), sym: o.sym, gild: true }); }
          break;
        }
        case 'heal': { const b = this.hp; this.hp = Math.min(this.maxHp, this.hp + o.amount); ev.push({ t: 'heal', amount: this.hp - b, hp: this.hp, src: 'reward' }); break; }
        case 'spark': this.sparkBonus += 1; this.sparks = Math.min(this.maxSparks, this.sparks + 1); ev.push({ t: 'sparks', delta: 1, total: this.sparks, max: this.maxSparks, src: 'reward' }); break;
        case 'chisel': return { ev, chisel: true };
        default: break;
      }
      return { ev, chisel: false };
    }

    // Odds helpers for the UI: probability that reel ri shows symbol s on its payline after a spin.
    symbolOdds(ri, s) {
      const r = this.reels[ri];
      const n = r.strip.filter((c) => c.s === s || c.s === 'wild').length;
      return n / r.strip.length;
    }

    // ================================================================== combat setup
    _startCombat(enemyId, opts) {
      const Data = D();
      const def = Data.ENEMIES[enemyId];
      const zone = Data.FLOORS[this.floor] ? Data.FLOORS[this.floor].zone : 'abyss';
      const zStart = Data.ZONES[zone].floors[0];
      const k = Math.max(0, this.floor - zStart);
      const flat = !!Data.ZONES[zone].deep; // 灰の底: enemies keep their listed numbers
      const scale = def.elite || def.boss || !def.zone || flat ? 1 : 1 + 0.12 * k;
      const dread = !!opts.dread;
      const hp = Math.round(def.hp * scale * (dread ? (enemyId === 'golem' ? 1.2 : 1.5) : 1));
      const e = {
        id: enemyId, art: def.art || enemyId, variant: def.variant || null, name: (dread ? '怨念の' : '') + def.name,
        hp, maxHp: hp, armor: def.armor, block: def.startBlock || 0, atkBonus: (!def.elite && !def.boss && !flat && k >= 2) ? 1 : 0,
        atkMult: dread ? 1.5 : 1, burn: 0, turn: 0, cursor: 0, seals: def.seals || 0, maxSeals: def.seals || 0, phase: 1,
        stunned: false, staggered: false, doom: null, markIdx: null, dread, elite: !!def.elite, boss: !!def.boss,
        ember: def.ember * (dread ? 2 : 1), intent: null, now: null, lastK: null, tip: def.tip,
      };
      this.enemy = e;
      if (def.mirror) e.mirrorSym = this.mostStocked(); // 返し鏡: the first seal is the most carved symbol
      this._lastEnemy = enemyId;
      this.fight = {
        turn: 0, respinsThisTurn: 0, paidRespins: 0, freeNudgeLeft: this.mods.freeNudge, blessLeft: this.mods.bless ? 1 : 0,
        echoLeft: this.mods.echo ? 1 : 0, keyLeft: this.mods.fateKey ? 1 : 0, mirrorFree: this.hasRelic('mirror') ? 1 : 0,
        momentum: !!(this.mods.momentum && this.stats.kills > 0), resolves: 0, rampart: false, guardian: false,
        chainUsed: false, burnedThisTurn: false, lanternSparkThisTurn: false,
        advanced: false, borrowed: 0, borrowUsed: false, debt: false, threads: [], threadsPaid: false,
      };
      for (const r of this.reels) { r.held = false; r.carried = false; r.jam = false; r.echo = null; }
      const ev = [];
      if (dread) {
        const c = this._insertCell(this.rng.int(this.reels.length), cell('skull', { temp: true }));
        ev.push({ t: 'curse', cells: [c], permanent: false, dread: true });
      }
      this.block = 0;
      if (this.mods.keeper) this.block += Math.round(this.maxHp * 0.1);
      if (this.fight.momentum) this._gainSparks(1);
      if (this.hasRelic('buckler')) this.block += 2;
      if (this.hasRelic('hourglass')) this._gainSparks(1);
      this._newIntent();
      this.phase = 'idle';
      ev.unshift({ t: 'combat', enemy: this._enemySnap(), intent: e.intent, block: this.block, sparks: this.sparks, momentum: this.fight.momentum, hp: this.hp, maxHp: this.maxHp });
      return ev;
    }

    _enemySnap() {
      const e = this.enemy;
      const snap = { id: e.id, art: e.art, variant: e.variant, name: e.name, hp: e.hp, maxHp: e.maxHp, armor: e.armor, block: e.block,
        burn: e.burn, seals: e.seals, maxSeals: e.maxSeals, phase: e.phase, dread: e.dread, elite: e.elite, boss: e.boss, doom: e.doom };
      if (D().ENEMIES[e.id].final) Object.assign(snap, { final: true, cuts: e.cutCount || 0, need: D().THREADS.need });
      return snap;
    }

    // the first cell of a fight's script (cursor 0)
    _newIntent() {
      const e = this.enemy;
      const it = this._readCell(e);
      e.intent = it;
      e.now = it.now || null;
      return it;
    }

    // ================================================================== 灰輪の台本 (the enemy's script)
    // Reading a cell may roll the run's dice (e.g. the rat): such cells are flagged so previews never pretend to know them.
    _readCell(e) {
      const s0 = this.rng.state();
      const it = D().ENEMIES[e.id].ai(e, this);
      if (this.rng.state() !== s0) it.random = true;
      return it;
    }
    // Move the script on by one cell and read it. This is NOT an enemy turn: e.turn is untouched.
    _nextCell(e) {
      e.cursor = (e.cursor || 0) + 1;
      return this._readCell(e);
    }
    // What a played (or skipped) cell leaves behind in the script state.
    static scriptTick(e, it) {
      if (!it) return;
      if (it.doomTick) e.doom = (e.doom || 3) - 1;
      if (it.k === 'doom') e.doom = 0;
      e.lastK = it.k;
    }
    // A wound-up blow can be called early, never sent away: 強撃 and 灰燼 are locked in the script.
    isLockedCell(it) { return !!(it && (it.heavy || it.k === 'doom')); }

    // Display damage of a script cell for an enemy (or a read-only copy of one).
    cellDamage(it, g) {
      const e = g || this.enemy;
      if (!it || !e || it.unknown) return null;
      if (it.k === 'charge') return it.next ? Math.round((it.next + e.atkBonus) * e.atkMult) : null;
      if (it.v == null || it.k === 'drain') return null;
      if (it.k === 'attack' || it.k === 'doom' || it.k === 'jam') return Math.round((it.v + e.atkBonus) * e.atkMult);
      return it.v;
    }

    // Final damage an intent will deal (for UI bubbles).
    intentDamage(it) {
      const e = this.enemy;
      if (!it || !e) return 0;
      if (it.k === 'charge') return it.next ? Math.round((it.next + e.atkBonus) * e.atkMult) : 0;
      if (it.v == null) return 0;
      if (it.k === 'attack' || it.k === 'doom' || it.k === 'jam') return Math.round((it.v + e.atkBonus) * e.atkMult);
      if (it.k === 'drain') return this.sparks > 0 ? 0 : it.v;
      return it.v;
    }

    // ================================================================== reels & manipulation
    cellAt(ri, off = 0) { const r = this.reels[ri]; return r.strip[U().mod(r.pos + off, r.strip.length)]; }
    paylineCell(ri) { const r = this.reels[ri]; return r.echo || this.cellAt(ri, 0); }
    paylineCells() { return this.reels.map((_, i) => this.paylineCell(i)); }
    heldCount() { return this.reels.filter((r) => r.held).length; }

    spin() {
      if (this.phase !== 'idle') return [];
      const spun = [];
      for (const r of this.reels) {
        r.echo = null;
        const keep = r.held && r.carried;
        r.wasCarried = keep;
        if (!keep) { r.pos = this.rng.int(r.strip.length); r.held = false; r.carried = false; }
        spun.push(!keep);
      }
      this.fight.respinsThisTurn = 0;
      this.fight.paidRespins = 0;
      this.fight.manipulated = false;
      this.fight.advanced = false;
      this.fight.threads = [];
      this.fight.threadsPaid = false;
      this.stats.spins += 1;
      this.phase = 'spun';
      this._restring(this.enemy && this.enemy.intent);
      // Run 1: "the Emberwheel awakens" — guarantee one free, guided nudge into a trine early on.
      if (!this.awaken.done) {
        if (!this.awaken.rigged && !this.awakenTargets().length && (this.stats.spins >= 6 || this.floor >= 2)) {
          this.awaken.rigged = true;
          this._rigNearMiss(spun);
        }
        this.awaken.ready = this.awakenTargets().length > 0;
      }
      // agency bookkeeping: turns spent with no sparks, and turns where nothing at all could be done
      if (this.mods.sparks && this.sparkAvail() === 0) {
        this.stats.zeroTurns += 1;
        if (!this._anyAction(true)) this.stats.lockedTurns += 1;
      }
      const sev = { t: 'spin', stops: this.reels.map((r) => r.pos), spun, awaken: this.awaken.ready };
      if (this.fight.threads.length) sev.threads = this.fight.threads.map((t) => Object.assign({}, t));
      return [sev];
    }

    _rigNearMiss(spun) {
      for (let tries = 0; tries < 400; tries++) {
        const save = this.reels.map((r) => r.pos);
        this.reels.forEach((r, i) => { if (spun[i]) r.pos = this.rng.int(r.strip.length); });
        if (this.awakenTargets().length) return true;
        this.reels.forEach((r, i) => { r.pos = save[i]; });
      }
      return false;
    }

    // The Run-1 "awakening" only teaches with a near-miss that matters: an attacking trine that changes the outcome.
    awakenTargets() {
      const e = this.enemy;
      if (!e) return [];
      const cur = this.evaluate(this.paylineCells());
      if (cur.totalDmg >= e.hp + (e.block || 0)) return [];
      const it = e.intent || {};
      return this.nearMisses(1).filter((nm) => {
        const cells = this.paylineCells(); cells[nm.reel] = this.cellAt(nm.reel, nm.dir);
        const R = this.evaluate(cells);
        return R.combos.some((c) => c.k === 'trine' && (c.s === 'blade' || c.s === 'flame' || (c.s === 'ward' && (it.heavy || it.k === 'charge'))));
      });
    }

    // Is any action possible at all? (withBorrow: count borrowing from the Ashwheel as one)
    _anyAction(withBorrow) {
      return this.canRespin() || this.canNudgeAny() || this.canBlessAny() || this.canEchoAny() || this.canFateKey() || this.canAdvance() ||
        (withBorrow ? this.canBorrow() : false);
    }

    // Is there any meaningful action available after a spin?
    needsDecision() {
      if (this.phase !== 'spun') return false;
      if (this.awaken.ready) return true;
      return this._anyAction(false) || (this.canBorrow() && this.borrowWorthwhile());
    }

    // UI helper: resolve automatically after a short beat?
    // Early on a trine/bond fires at once (the joy of the early game). Once the player can plan around it
    // (継ぎ留め / 拍子木, mods.comboPause) a combo no longer forces the hand while something can still be done.
    shouldAutoResolve() {
      if (this.phase !== 'spun') return false;
      if (this.awaken.ready) return false;
      // 拍子木 changed what the enemy does this turn: the player reads the new board and confirms (no instant resolve)
      if (this.fight && this.fight.advanced) return false;
      if (!this.needsDecision()) return true;
      const R = this.forecast();
      const e = this.enemy;
      if (e && R.totalDmg >= e.hp + e.block && !(e.now && e.now.k === 'reflect') && !this.hangSaves(R)) return true;
      if (R.combos.some((c) => COMBO_KINDS[c.k] && c.k !== 'reaper')) {
        if (this.mods.comboPause) return false;
        // early game: a combo fires at once — unless the only thing left is a borrowed spark that would change the turn
        // (借り火: at 0 sparks the choice "borrow or accept" must not be skipped)
        return this._anyAction(false) || !this.canBorrow();
      }
      return false;
    }
    // After a manipulation (nudge / respin / 写し身 / 鍵 / 祝福 / 台本送り) the UI goes on like this: a trine/bond/quad, or
    // nothing meaningful left to do, hands the turn to shouldAutoResolve(); otherwise the player decides. True when the
    // turn will fire by itself right after the manipulation (QA-004: the hover preview says so before you act).
    firesAfterManip() {
      if (this.phase !== 'spun' || this.awaken.ready) return false;
      const R = this.forecast();
      const great = R.combos.some((c) => c.k === 'trine' || c.k === 'bond' || c.k === 'quad');
      return (great || !this.needsDecision()) && this.shouldAutoResolve();
    }
    // Why the turn stopped on a combo (for the UI): null when it would not have stopped.
    comboPauseReason() {
      if (this.phase !== 'spun' || !this.mods.comboPause) return null;
      const R = this.forecast();
      if (!R.combos.some((c) => COMBO_KINDS[c.k] && c.k !== 'reaper') || this.shouldAutoResolve()) return null;
      if (R.groups.heart && R.heal > this.maxHp - this.hp) return 'overheal';
      const it = this.enemy && this.enemy.intent;
      if (R.groups.ward && R.groups.ward.n >= 2 && !(it && (it.k === 'attack' || it.k === 'doom' || it.k === 'jam' || it.k === 'charge'))) return 'idleWard';
      if (this.canAdvance()) return 'script';
      return 'plan';
    }

    // ------------------------------------------------------------------ 糸 (深淵の繰り手, docs/EXPANSION_4A_SPEC.md §2.2)
    // fight.threads: this turn's strings [{ reel, s }]. A strung reel's payline is an override cell { thread: reel }; your own
    // hand on the reel replaces it, which cuts the string (a cut string stays in the list: its 反動 is paid at the resolve).
    // 再演 / 連鎖 never spin a strung reel and it cannot be held: only your own hand on it cuts the string.
    isStrung(i) { const r = this.reels[i]; return !!(r && r.echo && r.echo.thread === i); }
    // a string attached on this reel earlier this turn and cut since (for the stage: a snapped string)
    wasCut(i) { const f = this.fight; return !!(f && f.threads && f.threads.some((t) => t.reel === i) && !this.isStrung(i)); }
    // 深淵の繰り手 hangs by its strings: a line without 三本断ち does not take its last HP
    hangSaves(R) {
      const e = this.enemy, ED = e && D().ENEMIES[e.id];
      return !!(ED && ED.final && !(R && R.threeCut) && !(this.fight && this.fight.cutFree));
    }
    // Attach the strings of script cell `it` (at the spin, and again when 台本送り brings another cell): strings still attached
    // and not in the new cell are released; a reel freed this turn is not strung again.
    _restring(it) {
      const f = this.fight;
      if (!f || !f.threads) return;
      const want = (it && it.threads) || [];
      if (!want.length && !f.threads.length) return;
      f.threads = f.threads.filter((t) => {
        if (!this.isStrung(t.reel) || want.some((w) => w.reel === t.reel)) return true;
        this.reels[t.reel].echo = null;
        return false;
      });
      for (const w of want) {
        const r = this.reels[w.reel];
        if (!r) continue;
        const old = f.threads.find((t) => t.reel === w.reel);
        if (old && !this.isStrung(w.reel)) continue;
        if (old) old.s = w.s; else f.threads.push({ reel: w.reel, s: w.s });
        r.echo = cell(w.s, { echo: true, thread: w.reel });
        r.held = false; r.carried = false;
      }
    }

    respinCost() {
      if (!this.mods.respin) return null;
      if (!this.fight.freeRespinUsed) return 'free';
      if (this.fight.mirrorFree > 0) return 'free';
      if (this.sparkAvail() >= 1) return 'spark';
      if (this.mods.bloodPrice && this.hp > 4) return 'hp';
      return null;
    }

    canRespin() {
      if (this.phase !== 'spun' || !this.respinCost()) return false;
      return this.reels.some((r, i) => !r.held && !r.jam && !this.isStrung(i));
    }

    respin() {
      if (!this.canRespin()) return [];
      const cost = this.respinCost();
      let paid = cost;
      if (cost === 'free') { if (!this.fight.freeRespinUsed) this.fight.freeRespinUsed = true; else this.fight.mirrorFree -= 1; }
      else if (cost === 'spark') { paid = this._paySpark(); this.fight.paidRespins += 1; }
      else if (cost === 'hp') { this.hp -= 4; this.fight.paidRespins += 1; }
      const spun = [];
      this.reels.forEach((r, i) => {
        const go = !r.held && !r.jam && !this.isStrung(i);
        if (go) { r.pos = this.rng.int(r.strip.length); r.echo = null; }
        spun.push(go);
      });
      this.fight.respinsThisTurn += 1;
      this.fight.manipulated = true;
      this.stats.respins += 1;
      return [{ t: 'respin', stops: this.reels.map((r) => r.pos), spun, cost: paid, sparks: this.sparks, borrowed: this.borrowedSparks(), hp: this.hp }];
    }

    canHold(i) {
      const r = this.reels[i];
      if (!r || this.phase !== 'spun' || this.mods.holdMax <= 0 || r.jam) return false;
      if (!r.held && this.isStrung(i)) return false;
      return r.held || this.heldCount() < this.mods.holdMax;
    }

    toggleHold(i) {
      const r = this.reels[i];
      if (!r || this.phase !== 'spun' || this.mods.holdMax <= 0) return [];
      if (r.jam) return [{ t: 'deny', reason: 'jam', reel: i }];
      if (r.held) { r.held = false; r.carried = false; if (this.lastHeld === i) this.lastHeld = -1; return [{ t: 'hold', reel: i, held: false }]; }
      if (this.isStrung(i)) return [{ t: 'deny', reason: 'thread', reel: i }];
      if (this.heldCount() >= this.mods.holdMax) return [{ t: 'deny', reason: 'holdMax', reel: i }];
      r.held = true;
      this.lastHeld = i;
      return [{ t: 'hold', reel: i, held: true }];
    }

    nudgeCost() {
      if (this.awaken.ready) return 'free';
      if (!this.mods.nudge) return null;
      if (this.fight.freeNudgeLeft > 0 || this.fight.mirrorFree > 0) return 'free';
      if (this.sparkAvail() >= 1) return 'spark';
      return null;
    }
    canNudge(i, dir = 1) {
      const r = this.reels[i];
      if (!r || this.phase !== 'spun' || r.jam || r.held || !this.nudgeCost()) return false;
      const range = this.awaken.ready ? 1 : this.mods.nudgeRange;
      return Math.abs(dir) >= 1 && Math.abs(dir) <= range;
    }
    canNudgeAny() { return this.reels.some((_, i) => this.canNudge(i, 1)); }

    // dir < 0: a symbol ABOVE the payline moves onto it; dir > 0: a symbol BELOW moves onto it.
    nudge(i, dir) {
      if (!this.canNudge(i, dir)) return [];
      let cost = this.nudgeCost();
      const wasAwaken = this.awaken.ready;
      if (wasAwaken) { this.awaken.ready = false; this.awaken.done = true; }
      else if (cost === 'free') { if (this.fight.freeNudgeLeft > 0) this.fight.freeNudgeLeft -= 1; else this.fight.mirrorFree -= 1; }
      else cost = this._paySpark();
      const r = this.reels[i], cut = this.isStrung(i);
      r.pos = U().mod(r.pos + dir, r.strip.length);
      r.echo = null;
      this.stats.nudges += 1;
      this.fight.manipulated = true;
      const ev = [{ t: 'nudge', reel: i, dir, cost, sparks: this.sparks, borrowed: this.borrowedSparks(), pos: r.pos, awaken: wasAwaken }];
      if (cut) ev[0].cut = true;
      if (this.mods.gentle) {
        const b = this.hp; this.hp = Math.min(this.maxHp, this.hp + 2);
        if (this.hp > b) ev.push({ t: 'heal', amount: this.hp - b, hp: this.hp, src: 'gentle' });
      }
      return ev;
    }

    canBless(i) {
      return !!(this.phase === 'spun' && this.fight.blessLeft > 0 && this.reels[i] && (!this.reels[i].echo || this.isStrung(i)) && this.paylineCell(i).s === 'skull');
    }
    canBlessAny() { return this.reels.some((_, i) => this.canBless(i)); }
    bless(i) {
      if (!this.canBless(i)) return [];
      this.fight.blessLeft -= 1;
      const cut = this.isStrung(i), c = cut ? this.reels[i].echo : this.cellAt(i, 0);
      this.reels[i].echo = cell('heart', { g: c.g, echo: true, blessed: true });
      this.fight.manipulated = true;
      return [cut ? { t: 'bless', reel: i, cut: true } : { t: 'bless', reel: i }];
    }

    // Echo: copy the payline symbol of reel `src` onto reel `dst`'s payline (this turn only).
    canEcho(src, dst) {
      if (this.phase !== 'spun' || this.fight.echoLeft <= 0 || this.sparkAvail() < 1 || src === dst) return false;
      const a = this.reels[src], b = this.reels[dst];
      if (!a || !b || b.jam) return false;
      return this.paylineCell(src).s !== this.paylineCell(dst).s;
    }
    canEchoAny() {
      for (let i = 0; i < this.reels.length; i++) for (let j = 0; j < this.reels.length; j++) if (this.canEcho(i, j)) return true;
      return false;
    }
    echo(src, dst) {
      if (!this.canEcho(src, dst)) return [];
      this.fight.echoLeft -= 1;
      const paid = this._paySpark();
      const s = this.paylineCell(src), cut = this.isStrung(dst);
      this.reels[dst].echo = cell(s.s, { g: s.g, echo: true });
      this.fight.manipulated = true;
      const ev = { t: 'echo', reel: dst, from: src, sym: s.s, sparks: this.sparks, borrowed: this.borrowedSparks(), cost: paid };
      if (cut) ev.cut = true;
      return [ev];
    }

    canFateKey(ri) {
      if (this.phase !== 'spun' || this.fight.keyLeft <= 0 || this.sparkAvail() < 1) return false;
      if (ri == null) return this.reels.some((r) => !r.jam);
      return !!(this.reels[ri] && !this.reels[ri].jam);
    }
    fateKey(ri, ci) {
      if (!this.canFateKey(ri)) return [];
      const r = this.reels[ri];
      if (ci < 0 || ci >= r.strip.length) return [];
      this.fight.keyLeft -= 1;
      const paid = this._paySpark(), cut = this.isStrung(ri);
      r.pos = ci; r.echo = null;
      this.fight.manipulated = true;
      const ev = { t: 'fateKey', reel: ri, pos: ci, sym: r.strip[ci].s, sparks: this.sparks, borrowed: this.borrowedSparks(), cost: paid };
      if (cut) ev.cut = true;
      return [ev];
    }

    // ------------------------------------------------------------------ 拍子木: send the Ashwheel's script one cell
    // The current intent is struck out unplayed and the next cell becomes "now". No enemy turn passes
    // (no burn tick, no growth, no rage). 1 per turn, 1 spark. A locked cell (強撃 / 灰燼) cannot be sent.
    advanceBlock() {
      if (!this.mods.script || this.phase !== 'spun' || !this.fight) return 'none';
      const e = this.enemy;
      if (!e || e.hp <= 0 || !e.intent) return 'none';
      if (this.isLockedCell(e.intent)) return 'locked';
      if (this.fight.advanced) return 'used';
      if (this.sparkAvail() < 1) return 'spark';
      return null;
    }
    canAdvance() { return this.advanceBlock() === null; }
    advance() {
      if (!this.canAdvance()) return [];
      const e = this.enemy, f = this.fight;
      const paid = this._paySpark();
      const from = e.intent;
      Run.scriptTick(e, from);
      const it = this._nextCell(e);
      e.intent = it;
      e.now = it.now || null;
      f.advanced = true; // (not a reel manipulation: 精妙 only rewards trines you made yourself)
      this._restring(it);
      this.stats.advances += 1;
      const aev = { t: 'scriptAdvance', from, intent: it, enemy: this._enemySnap(), cost: paid, sparks: this.sparks, borrowed: this.borrowedSparks() };
      if (f.threads && f.threads.length) aev.threads = f.threads.map((t) => ({ reel: t.reel, s: t.s, cut: !this.isStrung(t.reel) }));
      return [aev];
    }

    // ------------------------------------------------------------------ 借り火: borrow one spark from the Ashwheel
    // Only with no sparks, once per fight. The spark lives for this turn only (never stored). The price: the Ashwheel
    // takes its NEXT script cell as well during this enemy turn (shown on the band before you borrow).
    canBorrow() {
      if (this.phase !== 'spun' || !this.mods.borrow || !this.mods.sparks || !this.fight) return false;
      const e = this.enemy, f = this.fight;
      if (!e || e.hp <= 0 || f.borrowUsed || f.debt || f.borrowed > 0 || this.sparks > 0) return false;
      return true;
    }
    borrow() {
      if (!this.canBorrow()) return [];
      const f = this.fight;
      f.borrowUsed = true;
      f.borrowed = 1;
      f.debt = true;
      this.stats.borrows += 1;
      return [{ t: 'borrow', borrowed: f.borrowed, sparks: this.sparks }];
    }
    // Would a borrowed spark materially change this turn? (decides whether a 0-spark turn waits for the player)
    // Every one-spark action (nudge — after releasing a hold if needed —, 写し身, 運命の鍵, 台本送り) is tried on a copy of
    // the run holding the borrowed spark but NOT the debt: the question is whether borrowing is a real choice; the
    // player weighs its price on the band. It counts when the action completes a trine/bond, wins the fight, avoids the
    // party's death, keeps ≥5 more HP, deals ≥8 more damage, or lifts the forecast utility by ≥7.
    // Dice are never consulted: respins and cells drawn from the dice do not count.
    borrowWorthwhile() {
      if (!this.canBorrow()) return false;
      const base = this._borrowOutcome(null);
      if (!base) return false;
      const tries = [];
      if (this.mods.nudge) {
        for (let i = 0; i < this.reels.length; i++) {
          if (this.reels[i].jam) continue;
          for (let d = 1; d <= this.mods.nudgeRange; d++) for (const dir of [-d, d]) {
            tries.push((c) => { if (c.reels[i].held) c.toggleHold(i); return c.nudge(i, dir); });
          }
        }
      }
      if (this.mods.echo && this.fight.echoLeft > 0) {
        for (let a = 0; a < this.reels.length; a++) for (let b = 0; b < this.reels.length; b++) if (a !== b) tries.push((c) => c.echo(a, b));
      }
      if (this.mods.script) tries.push((c) => { const ev = c.advance(); return ev.length && !c.enemy.intent.random ? ev : []; });
      if (this.mods.fateKey && this.fight.keyLeft > 0) {
        for (let i = 0; i < this.reels.length; i++) {
          if (this.reels[i].jam) continue;
          for (let ci = 0; ci < this.reels[i].strip.length; ci++) if (ci !== this.reels[i].pos) tries.push((c) => c.fateKey(i, ci));
        }
      }
      for (const act of tries) if (Run._material(base, this._borrowOutcome(act))) return true;
      return false;
    }
    // The outcome of this turn on a copy holding a borrowed spark (no debt), after `act` (or as it stands).
    _borrowOutcome(act) {
      return this._sim((c) => {
        c.fight.borrowed = 1;
        if (act) { const ev = act(c); if (!ev || !ev.length || c.phase !== 'spun') return null; }
        const R = c.forecast(), P = c.previewTurn();
        if (!P) return null;
        const combo = R.combos.some((x) => COMBO_KINDS[x.k] && x.k !== 'reaper');
        return { combo, util: R.utility, kills: P.enemyDies, dies: P.partyDies || P.secondWind, hp: P.hpAfter,
          enemyHp: P.enemyDies ? 0 : P.enemyAfter ? P.enemyAfter.hp : c.enemy.hp, random: P.random };
      });
    }
    static _material(base, alt) {
      if (!alt) return false;
      if (alt.combo && !base.combo) return true;
      if (alt.kills && !base.kills) return true;
      if (base.dies && !alt.dies) return true;
      if (alt.util - base.util >= 7) return true;
      if (alt.random || base.random) return false; // a 連鎖 bonus spin is not peeked: HP / damage are not compared
      if (!alt.dies && alt.hp - base.hp >= 5) return true;
      if (base.enemyHp - alt.enemyHp >= 8) return true;
      return false;
    }

    // Nudges (within `range`) that would complete a trine (or the Bond formation when unlocked).
    nearMisses(range) {
      range = range || (this.mods.nudge ? this.mods.nudgeRange : 1);
      const out = [];
      const cur = this.paylineCells();
      if (this._isGreat(cur)) return out;
      for (let i = 0; i < this.reels.length; i++) {
        if (this.reels[i].jam || this.reels[i].held) continue;
        for (let d = 1; d <= range; d++) {
          for (const dir of [-d, d]) {
            const cells = cur.slice();
            cells[i] = this.cellAt(i, dir);
            if (this._isGreat(cells)) out.push({ reel: i, dir, sym: cells[i].s });
          }
        }
      }
      return out;
    }
    // Does this line make a 三連 / 絆 when resolved? Without wilds this is a plain count (as it always was); with wilds it
    // asks evaluate(), so the hints (glows, 惜しい！, the slow last reel) never promise what the resolve would not do.
    _isGreat(cells) {
      if (cells.some((c) => c.s === 'wild')) return this.evaluate(cells).combos.some((c) => c.k !== 'reaper');
      const e = this.enemy, mk = e && e.now && e.now.k === 'mark' ? e.now.sym : null;
      const cnt = {};
      for (const c of cells) { if (c.s !== 'skull' && c.s !== mk) cnt[c.s] = (cnt[c.s] || 0) + 1; }
      let best = 0;
      for (const k in cnt) best = Math.max(best, cnt[k]);
      if (best >= 3) return true;
      if (mk && D().BOND_ORDER.indexOf(mk) >= 0) return false;
      return !!(this.mods.bond && this._bondOk(cells));
    }
    // Exact odds that a line drawn from `lists` (per reel: the cells it can show, each equally likely) resolves into a
    // 三連 and into a 絆, judged exactly as the resolve judges (wilds, the enemy's 封じ, 絆 unlocked or not).
    // Cells are grouped by symbol, so this is at most 7^3 evaluations.
    comboOdds(lists) {
      const groups = lists.map((list) => {
        const by = {};
        for (const c of list) by[c.s] = (by[c.s] || 0) + 1;
        return Object.keys(by).map((s) => ({ c: { s }, p: by[s] / list.length }));
      });
      let trine = 0, bond = 0;
      for (const a of groups[0]) for (const b of groups[1]) for (const c of groups[2]) {
        const R = this.evaluate([a.c, b.c, c.c]);
        const w = a.p * b.p * c.p;
        if (R.combos.some((x) => x.k === 'trine' || x.k === 'quad')) trine += w;
        if (R.combos.some((x) => x.k === 'bond')) bond += w;
      }
      return { trine, bond };
    }
    // 再演: the odds of the coming respin (held / jammed reels keep their cell).
    respinOdds() {
      return this.comboOdds(this.reels.map((r, i) => (r.held || r.jam || this.isStrung(i) ? [this.paylineCell(i)] : r.strip)));
    }
    _bondOk(cells, wildAs) {
      const order = D().BOND_ORDER;
      if (cells.length < 3) return false;
      for (let i = 0; i < 3; i++) {
        const s = cells[i].s === 'wild' ? (wildAs === undefined ? order[i] : wildAs) : cells[i].s;
        if (s !== order[i]) return false;
      }
      // with a concrete wildAs, all wilds must have been assigned the same symbol: at most one wild can fit
      return true;
    }

    // ================================================================== evaluation (pure)
    _matchMult(n) {
      if (n <= 1) return 1;
      if (n === 2) return this.mods.pairMult + (this.hasRelic('twinring') ? 0.5 : 0);
      if (n === 3) return this.mods.trineMult;
      return this.mods.trineMult + 1.5 * (n - 3);
    }

    _symBase(s) {
      let b = D().SYMBOLS[s].base;
      if (s === 'blade') b += this.mods.bladeBonus + (this.hasRelic('whetstone') ? 2 : 0);
      if (s === 'flame' && this.hasRelic('flint')) b += 1;
      if (s === 'heart' && this.hasRelic('holywater')) b += 2;
      return b;
    }

    evaluate(cells, wildAs) {
      if (cells == null) cells = this.paylineCells();
      const wilds = cells.filter((c) => c.s === 'wild').length;
      // 星 (wild): if the wilds can complete a combo (三連 / 絆), they always do — the best of those combos; only when no
      // assignment makes one do they become the symbol with the best result. (What looks like a trine is one.)
      if (wilds > 0 && wildAs === undefined) {
        let best = null, bestCombo = null;
        for (const cand of D().WILD_PRIORITY) {
          const r = this.evaluate(cells, cand);
          if (!best || r.utility > best.utility + 1e-9) best = r;
          if (r.combos.some((c) => c.k !== 'reaper') && (!bestCombo || r.utility > bestCombo.utility + 1e-9)) bestCombo = r;
        }
        return bestCombo || best;
      }
      const e = this.enemy || { hp: 1, maxHp: 1, armor: 0, now: null, seals: 0, block: 0, intent: null };
      const m = this.mods;
      const f = this.fight || { momentum: false, resolves: 1, paidRespins: 0, burnedThisTurn: false, lanternSparkThisTurn: false };
      const groups = {};
      const asCells = cells.map((c) => {
        const s = c.s === 'wild' ? (wildAs || 'blade') : c.s;
        if (!groups[s]) groups[s] = { n: 0, g: 0 };
        groups[s].n += 1;
        if (c.g) groups[s].g += 1;
        return { s: c.s, as: s, g: c.g, temp: c.temp, echo: !!c.echo };
      });
      const res = {
        cells: asCells, groups, wildAs: wilds ? wildAs : null, combos: [], bond: false,
        mult: 1, multNotes: [], marked: null, markedN: 0, thirst: false,
        bladeRaw: 0, bladeArmor: 0, blade: 0, flame: 0, skullDmg: 0, reaper: 0, selfDmg: 0,
        block: 0, heal: 0, embers: 0, sparks: 0, burn: 0, pyre: 0, cleanse: false, rampart: false, guardian: false,
        stagger: false, staggerWard: false, staggerBreak: false, shellNeed: 0, executed: false, sealBreaks: 0, sealedAfter: false, sealMult: 1, armor: 0,
        directDmg: 0, totalDmg: 0, utility: 0, threads: 0, threadCuts: 0, threeCut: false, threadDmg: 0, cutCount: 0,
      };
      if (f.momentum && f.resolves === 0) { res.mult *= 1.5; res.multNotes.push('追撃 ×1.5'); }
      if (m.lastStand && this.hp <= this.maxHp * 0.3) { res.mult *= 1.5; res.multNotes.push('背水 ×1.5'); }
      if (m.gambler && f.paidRespins > 0) { const gm = 1 + 0.2 * f.paidRespins; res.mult *= gm; res.multNotes.push(`賭博 ×${gm.toFixed(1)}`); }
      const now = e.now || null;
      if (now && now.k === 'mark') res.marked = now.sym;
      if (now && now.k === 'thirst') res.thirst = true;
      res.armor = (e.armor || 0) + (now && now.k === 'curl' ? now.v : 0);
      const nOf = (s) => (groups[s] ? groups[s].n : 0);
      // Bond formation: blade on reel 1, flame on reel 2, heart on reel 3
      res.bond = !!(m.bond && this._bondOk(cells, wilds ? wildAs : undefined) && wilds <= 1 &&
        res.marked !== 'blade' && res.marked !== 'flame' && res.marked !== 'heart');
      if (res.bond && wilds === 1) {
        // the single wild must sit on the reel whose symbol it was assigned
        const wi = cells.findIndex((c) => c.s === 'wild');
        if (D().BOND_ORDER[wi] !== wildAs) res.bond = false;
      }
      if (res.bond) res.combos.push({ k: 'bond' });
      for (const s in groups) {
        const n = groups[s].n;
        if (n >= 3 && s !== res.marked) res.combos.push({ k: s === 'skull' ? 'reaper' : n >= 4 ? 'quad' : 'trine', s, n });
      }
      if (m.precision && f.manipulated && res.combos.some((c) => c.k !== 'reaper')) { res.mult *= 1.5; res.multNotes.push('精妙 ×1.5'); }
      const amount = (s) => {
        const g = groups[s];
        if (!g) return 0;
        let v = this._symBase(s) * (g.n + g.g) * this._matchMult(g.n);
        if (g.n >= 3 && this.hasRelic('bonedie')) v *= 1.5;
        if (res.bond && (s === 'blade' || s === 'flame' || s === 'heart')) v *= 3;
        return v * res.mult;
      };
      for (const s in groups) {
        const n = groups[s].n;
        if (s === res.marked) { res.markedN = n; res.selfDmg += 2 * n; continue; }
        if (s === 'blade') {
          let raw = amount('blade');
          if (m.execute && e.hp <= e.maxHp * 0.3) { raw *= 2; res.executed = true; }
          raw = Math.round(raw);
          res.bladeRaw = raw;
          res.bladeArmor = n >= 3 ? 0 : Math.min(raw, res.armor); // 断罪 ignores armor
          res.blade = raw - res.bladeArmor;
        } else if (s === 'flame') {
          res.flame = Math.round(amount('flame'));
          const per = m.burnPerFlame + (this.hasRelic('flint') ? 1 : 0);
          res.burn += per * n;
          if (n >= 3) { res.burn += 4; if (m.pyre) res.pyre = 1; }
        } else if (s === 'ward') {
          res.block += Math.round(amount('ward'));
          if (n >= 2 && e.intent && e.intent.k === 'charge' && !e.intent.threadOnly) { res.stagger = true; res.staggerWard = true; }
          if (n >= 2 && m.guardian) res.wardReflect = true;
          if (n >= 3) { res.rampart = true; if (m.guardian) res.guardian = true; }
        } else if (s === 'heart') {
          res.heal += res.thirst ? 0 : Math.round(amount('heart'));
          if (n >= 3) res.cleanse = true;
        } else if (s === 'lantern') {
          const g = groups[s];
          const lb = this._symBase('lantern') + Math.floor(Math.max(1, this.floor) / 2);
          res.embers += Math.round(lb * (g.n + g.g) * this._matchMult(g.n) * (this.hasRelic('candelabra') ? 2 : 1));
          if (n >= 3) res.embers += 20;
          if (m.sparks && !f.lanternSparkThisTurn) res.sparks += 1;
        } else if (s === 'skull') {
          if (n >= 3) res.reaper = Math.round(30 * res.mult);
          else if (m.skullPact || this.hasRelic('catbell')) res.skullDmg += 5 * n;
          else res.selfDmg += 3 * n;
        }
      }
      if (m.sparks) res.sparks += res.combos.filter((c) => c.k !== 'reaper' && c.s !== 'lantern').length;
      if (e.seals > 0) {
        res.sealBreaks = Math.min(e.seals, res.combos.length);
        if (m.skullPact && res.combos.some((c) => c.k === 'reaper')) res.sealBreaks = e.seals;
        res.sealedAfter = e.seals - res.sealBreaks > 0;
        res.sealMult = res.sealedAfter ? 0.25 : 1;
      }
      res.directDmg = Math.round((res.blade + res.flame + res.skullDmg) * res.sealMult);
      res.totalDmg = res.directDmg + res.reaper;
      res.reflectIn = 0;
      if (now && now.k === 'reflect') {
        const dealt = Math.min(e.hp, Math.max(0, res.directDmg - (e.block || 0)) + res.reaper);
        if (e.hp - dealt > 0) res.reflectIn = Math.round(dealt * 0.5);
      }
      if (res.pyre) {
        let b = (e.burn || 0) + res.burn;
        if (this.hasRelic('hatwax')) b = Math.min(12, b);
        res.pyreDmg = Math.round(b * 2 * ((e.seals || 0) - res.sealBreaks > 0 ? 0.5 : 1));
        res.totalDmg += res.pyreDmg;
      }
      // 灰鐘の番人 (breakStagger): on the 構え turn, direct hits that get through the shell to the body break the stance.
      // Exact: the shell takes blade, flame and the pact's skulls in that order (as _resolveLine applies them).
      const ED = e.id && D().ENEMIES[e.id];
      if (ED && ED.breakStagger && e.intent && e.intent.k === 'charge' && e.hp > 0) {
        const direct = Math.round(res.blade * res.sealMult) + Math.round(res.flame * res.sealMult) + Math.round(res.skullDmg * res.sealMult);
        res.shellNeed = Math.max(0, (e.block || 0) + 1 - direct);
        if (direct > (e.block || 0)) { res.staggerBreak = true; res.stagger = true; }
      }
      // 糸: strings cut by your own hand this turn (反動 each); on 終幕の段's countdown they add up to THREADS.need (三本断ち)
      if (f.threads && f.threads.length && !f.threadsPaid && e.hp > 0) {
        const TR = D().THREADS, cut = (t) => !(cells[t.reel] && cells[t.reel].thread === t.reel);
        res.threads = f.threads.length;
        res.threadCuts = f.threads.filter(cut).length;
        // 終幕の段: the strings cut on the countdown add up (the same reel on another turn counts again)
        if (e.intent && e.intent.countdown) { res.cutCount = (e.cutCount || 0) + res.threadCuts; res.threeCut = res.cutCount >= TR.need; }
        res.threadDmg = res.threadCuts * TR.backlash + (res.threeCut ? TR.threeCut : 0);
        res.totalDmg += res.threadDmg;
        if (res.threeCut) res.stagger = true;
      }
      // utility: used for Wild assignment and by bots
      const incoming = e.intent && e.intent.k !== 'charge' ? this.intentDamage(e.intent) : 0;
      let dmgU = res.totalDmg;
      if (res.threads) {
        if (D().ENEMIES[e.id] && D().ENEMIES[e.id].final && !res.threeCut && !f.cutFree) dmgU = Math.min(dmgU, Math.max(0, e.hp - 1));
        if (e.intent && e.intent.countdown) dmgU += res.threadCuts * 12;
      }
      const blockUse = Math.min(res.block, Math.max(0, incoming - this.block)) + Math.max(0, res.block - incoming) * 0.15;
      const reflectPenalty = now && now.k === 'reflect' ? res.totalDmg * 0.5 : 0;
      res.utility = dmgU + blockUse * 0.9 + Math.min(res.heal, this.maxHp - this.hp) * 0.8 + res.embers * 0.2
        + res.sparks * 4 + res.burn * 1.5 + res.sealBreaks * 30 + (res.stagger ? 10 : 0) + (res.guardian ? incoming : 0)
        + (res.threeCut ? this.intentDamage(e.intent) : 0)
        - res.selfDmg * 1.2 - reflectPenalty;
      return res;
    }

    forecast() { return this.evaluate(this.paylineCells()); }

    // ================================================================== resolve
    resolve() {
      if (this.phase !== 'spun') return [];
      const ev = [];
      this.awaken.ready = false;
      if (this.fight) this.fight.borrowed = 0;
      const out = this._resolveLine(ev, false);
      if (out === 'end') return ev;
      // 連鎖: one bonus spin + resolve before the enemy acts
      if (this.mods.chain && this._lastHadCombo && !this.fight.chainUsed && this.enemy && this.enemy.hp > 0 && this.reels.some((r, i) => !r.held && !r.jam && !this.isStrung(i))) {
        this.fight.chainUsed = true;
        const spun = [];
        this.reels.forEach((r, i) => {
          const go = !r.held && !r.jam && !this.isStrung(i);
          if (go) { r.pos = this.rng.int(r.strip.length); r.echo = null; }
          spun.push(go);
        });
        ev.push({ t: 'chain' }, { t: 'spin', stops: this.reels.map((r) => r.pos), spun, chain: true });
        const out2 = this._resolveLine(ev, true);
        if (out2 === 'end') return ev;
      }
      this._endPlayerTurn();
      this._checkBossPhase(ev);
      return ev.concat(this._enemyTurn());
    }

    _endPlayerTurn() {
      const m = this.mods;
      if (this.fight) { this.fight.threads = []; this.fight.threadsPaid = false; this.fight.cutFree = false; }
      for (let i = 0; i < this.reels.length; i++) {
        const r = this.reels[i];
        r.jam = false; r.echo = null;
        if (m.stasis && r.held && !r.carried && !r.wasCarried && i === this.lastHeld) r.carried = true;
        else { r.held = false; r.carried = false; }
      }
      this.lastHeld = -1;
    }

    // Applies the current payline. Returns 'end' if the run or the fight ended.
    _resolveLine(ev, isChain) {
      const e = this.enemy, f = this.fight, m = this.mods;
      const R = this.evaluate(this.paylineCells());
      this.stats.turns += isChain ? 0 : 1;
      // regrets bookkeeping
      const nm = this.nearMisses(1);
      if (nm.length) this.stats.nearMiss += 1;
      if (m.sparks && this.sparks === 0) this.stats.zeroSpark += 1;
      const best = Math.max(0, ...Object.keys(R.groups).filter((s) => s !== 'skull').map((s) => R.groups[s].n));
      if (best === 2) this.stats.pairNoTrine += 1;
      const cells = this.paylineCells();
      const order = D().BOND_ORDER;
      if (!R.bond && cells.length >= 3 && cells.filter((c, i) => i < 3 && (c.s === order[i] || c.s === 'wild')).length === 2) this.stats.bondNear += 1;
      this.stats.armorLost += R.bladeArmor;
      if (R.thirst && R.groups.heart) this.stats.thirstLost += 1;
      this._lastHadCombo = R.combos.some((c) => c.k !== 'reaper');

      ev.push({ t: 'payline', cells: R.cells, combos: R.combos, wildAs: R.wildAs, mult: R.mult, multNotes: R.multNotes,
        marked: R.marked, nearMiss: nm.length > 0, chain: isChain });
      for (const c of R.combos) {
        if (c.k === 'trine' || c.k === 'quad') this.stats.triples += 1;
        if (c.k === 'bond') this.stats.bonds += 1;
        if (c.k === 'reaper') this.stats.reapers += 1;
        ev.push({ t: 'combo', combo: c });
      }
      if (R.sealBreaks > 0) {
        e.seals -= R.sealBreaks;
        ev.push({ t: 'sealBreak', n: R.sealBreaks, seals: e.seals });
      }
      if (R.staggerWard) { e.staggered = true; ev.push({ t: 'stagger' }); }
      // 1) wards
      if (R.block > 0) { this.block += R.block; ev.push({ t: 'act', hero: 'knight', sym: 'ward', block: R.block, total: this.block, big: R.groups.ward.n >= 3 }); }
      // 2) hearts
      if (R.heal > 0 || (R.groups.heart && R.thirst && R.marked !== 'heart')) {
        const b = this.hp;
        this.hp = Math.min(this.maxHp, this.hp + R.heal);
        let extra = 0;
        if (m.keeper) { extra = Math.round(R.heal * 0.5); this.block += extra; }
        ev.push({ t: 'act', hero: 'priest', sym: 'heart', heal: this.hp - b, hp: this.hp, block: extra, total: this.block, thirst: R.thirst, big: R.groups.heart && R.groups.heart.n >= 3 });
      }
      if (R.cleanse) {
        let removed = 0;
        for (const r of this.reels) {
          const keep = r.strip[r.pos];
          const before = r.strip.length;
          r.strip = r.strip.filter((c) => !(c.temp && c.s === 'skull') || c === keep);
          removed += before - r.strip.length;
          r.pos = Math.max(0, r.strip.indexOf(keep));
        }
        ev.push({ t: 'cleanse', removed });
      }
      // 3) self damage — ignores block; curses never deal the killing blow
      if (R.selfDmg > 0) {
        const before = this.hp;
        this.hp = Math.max(1, this.hp - R.selfDmg);
        this.stats.selfDmg += before - this.hp;
        this.stats.damageTaken += before - this.hp;
        if (R.markedN) this.stats.markHits += R.markedN;
        ev.push({ t: 'selfHit', amount: before - this.hp, hp: this.hp, cause: R.markedN ? 'mark' : 'skull', sym: R.marked });
      }
      // 4) damage to the enemy
      let dealt = 0, held = 0;
      const hit = (raw, kind) => {
        if (e.hp <= 0 || raw <= 0) return { dmg: 0, absorbed: 0 };
        let dmg = raw, absorbed = 0;
        if (kind !== 'burn' && kind !== 'thorns' && kind !== 'reaper' && kind !== 'thread' && e.block > 0) { absorbed = Math.min(e.block, dmg); e.block -= absorbed; dmg -= absorbed; }
        if (floor) { const d0 = dmg; dmg = Math.min(dmg, Math.max(0, e.hp - floor)); held += d0 - dmg; }
        e.hp = Math.max(0, e.hp - dmg);
        dealt += dmg;
        this.stats.maxHit = Math.max(this.stats.maxHit, dmg);
        return { dmg, absorbed };
      };
      const sm = R.sealMult;
      if (R.threeCut) f.cutFree = true; // (深淵の繰り手: this turn may take its last HP)
      const floor = this.hangSaves(R) ? 1 : 0;
      if (R.blade > 0 || R.bladeArmor > 0) {
        const r = hit(Math.round(R.blade * sm), 'blade');
        ev.push({ t: 'act', hero: 'knight', sym: 'blade', dmg: r.dmg, absorbed: r.absorbed, armor: R.bladeArmor, sealed: sm < 1,
          hp: e.hp, big: R.groups.blade.n >= 3, executed: R.executed });
        if (D().ENEMIES[e.id].crack && e.armor > 0 && e.hp > 0) {
          e.armor -= 1;
          ev.push({ t: 'crack', armor: e.armor });
        }
        if (this.hasRelic('fang') && r.dmg > 0) {
          const b = this.hp; this.hp = Math.min(this.maxHp, this.hp + Math.max(1, Math.round(r.dmg * 0.1)));
          if (this.hp > b) ev.push({ t: 'heal', amount: this.hp - b, hp: this.hp, src: 'fang' });
        }
      }
      if (R.flame > 0) {
        const r = hit(Math.round(R.flame * sm), 'flame');
        ev.push({ t: 'act', hero: 'witch', sym: 'flame', dmg: r.dmg, absorbed: r.absorbed, sealed: sm < 1, hp: e.hp, big: R.groups.flame.n >= 3 });
      }
      if (R.skullDmg > 0) {
        const r = hit(Math.round(R.skullDmg * sm), 'skull');
        ev.push({ t: 'act', hero: null, sym: 'skull', dmg: r.dmg, absorbed: r.absorbed, hp: e.hp, sealed: sm < 1 });
      }
      if (R.reaper > 0) { const r = hit(R.reaper, 'reaper'); ev.push({ t: 'reaper', dmg: r.dmg, hp: e.hp }); }
      if (R.threads > 0) {
        f.threadsPaid = true;
        this.stats.threadCuts = (this.stats.threadCuts || 0) + R.threadCuts;
        this.stats.threadsAccepted = (this.stats.threadsAccepted || 0) + R.threads - R.threadCuts;
        if (R.threeCut) this.stats.threeCuts = (this.stats.threeCuts || 0) + 1;
        const r = R.threadDmg > 0 ? hit(R.threadDmg, 'thread') : { dmg: 0 };
        const cd = !!(e.intent && e.intent.countdown);
        if (cd) e.cutCount = R.threeCut ? 0 : R.cutCount;
        // 三本断ち: the enemy loses this turn's action; a wound-up blow is struck out as by 怯み
        const tev = { t: 'threads', cut: R.threadCuts, of: R.threads, three: R.threeCut, dmg: r.dmg, hp: e.hp };
        if (cd) Object.assign(tev, { count: R.threeCut ? D().THREADS.need : R.cutCount, need: D().THREADS.need, reset: R.threeCut });
        ev.push(tev);
        if (R.threeCut && e.hp > 0) {
          e.staggered = true;
          // not on a wind-up: the action is lost, and the countdown goes back to its first cell
          if (!(e.intent && e.intent.k === 'charge')) { e.stunned = true; if (e.intent && e.intent.countdown) e.phaseAt = (e.cursor || 0) + 1; }
          ev.push({ t: 'stagger', by: 'threads' });
        }
      }
      // 灰鐘の番人: the hits broke through the shell on the 構え turn (two wards, when also there, already staggered it)
      if (R.staggerBreak && !R.staggerWard && e.hp > 0) { e.staggered = true; ev.push({ t: 'stagger', by: 'break' }); }
      // 5) reflect stance
      if (e.now && e.now.k === 'reflect' && dealt > 0 && e.hp > 0) {
        const refl = Math.round(dealt * 0.5);
        const absorbed = Math.min(this.block, refl);
        this.block -= absorbed;
        this.hp -= refl - absorbed;
        this.stats.damageTaken += refl - absorbed;
        ev.push({ t: 'reflect', amount: refl, blocked: absorbed, hp: this.hp, block: this.block });
      }
      // 6) lanterns / sparks / burn
      if (R.groups.lantern && R.marked !== 'lantern') this.stats.lanterns += R.groups.lantern.n;
      if (R.embers > 0) { this._gainEmbers(R.embers, 'lantern'); ev.push({ t: 'embers', amount: R.embers, total: this.embers, src: 'lantern', jackpot: R.groups.lantern.n >= 3 }); }
      if (R.groups.lantern && R.marked !== 'lantern') f.lanternSparkThisTurn = true;
      if (R.sparks > 0) { const d = this._gainSparks(R.sparks); if (d > 0) ev.push({ t: 'sparks', delta: d, total: this.sparks, max: this.maxSparks, src: 'combo' }); }
      if (R.burn > 0 && e.hp > 0) {
        e.burn += R.burn;
        if (this.hasRelic('hatwax')) e.burn = Math.min(12, e.burn);
        f.burnedThisTurn = true;
        ev.push({ t: 'burn', stacks: e.burn, add: R.burn });
      }
      if (R.pyre && e.hp > 0 && e.burn > 0) {
        const r = hit(Math.round(e.burn * 2 * (e.seals > 0 ? 0.5 : 1)), 'burn');
        ev.push({ t: 'pyre', dmg: r.dmg, hp: e.hp, stacks: e.burn });
      }
      // 深淵の繰り手: the line would have felled it, but without 三本断ち it hangs at 1 HP
      if (held > 0) ev.push({ t: 'hung', hp: e.hp, held });
      if (D().ENEMIES[e.id].mirror && e.hp > 0) this._mirrorAfter(R);
      f.rampart = f.rampart || R.rampart;
      f.wardReflect = f.wardReflect || R.wardReflect;
      f.guardian = f.guardian || R.guardian;
      if (!isChain) f.resolves += 1;
      // outcomes
      if (this.hp <= 0) {
        const sw = this._trySecondWind();
        if (sw) ev.push(sw); else { ev.push(...this._die(e)); return 'end'; }
      }
      if (e.hp <= 0) { ev.push(...this._enemyDefeated()); return 'end'; }
      return 'ok';
    }

    // 返し鏡: the symbol that acted most in this resolve (sealed and skull cells do not count; a wild counts as what it was
    // assigned; ties go blade > flame > ward > heart > lantern). Nothing acted: the seal stays as it is.
    _mirrorAfter(R) {
      let best = null, bn = 0;
      for (const s of D().WILD_PRIORITY) {
        const g = R.groups[s];
        if (!g || s === R.marked) continue;
        if (g.n > bn) { bn = g.n; best = s; }
      }
      if (best) this.enemy.mirrorSym = best;
    }

    // 深淵の繰り手 hangs by its strings: burn / thorns / reflected blows on the enemy's turn stop at 1 HP as well
    _hang(ev) {
      const e = this.enemy;
      if (!e || e.hp > 0 || !this.hangSaves(null)) return;
      e.hp = 1;
      ev.push({ t: 'hung', hp: 1 });
    }

    _checkBossPhase(ev) {
      const e = this.enemy;
      if (!e || !e.boss || e.hp <= 0) return;
      let np = e.phase;
      const PH = D().ENEMIES[e.id].phases;
      if (PH) np = Math.max(np, e.hp <= e.maxHp * PH[1] ? 3 : e.hp <= e.maxHp * PH[0] ? 2 : 1);
      else {
        if (e.seals <= 0 && np === 1) np = 2;
        if (e.seals <= 0 && e.hp <= e.maxHp * 0.3) np = 3;
      }
      if (np !== e.phase) {
        e.phase = np;
        const d = this._gainSparks(1);
        ev.push({ t: 'bossPhase', phase: np, sparks: this.sparks, gained: d });
      }
    }

    _trySecondWind() {
      if (this.mods.secondWind && !this.secondWindUsed) {
        this.secondWindUsed = true;
        this.hp = 1 + Math.round(this.maxHp * 0.15);
        return { t: 'secondWind', hp: this.hp };
      }
      return null;
    }

    _enemyTurn() {
      const e = this.enemy, f = this.fight;
      const ev = [{ t: 'enemyTurn' }];
      if (e.burn > 0) {
        const dmg = e.seals > 0 ? Math.ceil(e.burn / 2) : e.burn;
        e.hp = Math.max(0, e.hp - dmg);
        if (!this.hasRelic('hatwax')) e.burn -= 1;
        this.stats.burnDealt += dmg;
        ev.push({ t: 'burnTick', dmg, hp: e.hp, stacks: e.burn });
        this._hang(ev);
        if (e.hp <= 0) return ev.concat(this._enemyDefeated());
        this._checkBossPhase(ev);
      }
      f.burnedThisTurn = false;
      f.lanternSparkThisTurn = false;
      e.block = 0;
      const it = e.intent;
      if (e.stunned) { e.stunned = false; ev.push({ t: 'stunned' }); e.lastK = it.k; }
      else { ev.push(...this._executeIntent(it)); Run.scriptTick(e, it); }
      let over = this._afterEnemyAct(ev);
      if (over) return over;
      // 怯み: the heavy follow-up is struck from the script unplayed
      if (e.staggered) {
        e.staggered = false;
        if (it.k === 'charge' && !(it.ph && it.ph !== e.phase)) {
          const skipped = this._nextCell(e);
          Run.scriptTick(e, skipped);
          e.lastK = 'staggered';
          ev.push({ t: 'staggerCancel', skipped });
        }
      }
      // 借り火: the Ashwheel collects its debt — it plays its next script cell now as well
      if (f.debt) {
        f.debt = false;
        this._checkBossPhase(ev);
        const d = this._nextCell(e);
        const hp0 = this.hp;
        ev.push({ t: 'debtAction', intent: d, phase: e.phase });
        ev.push(...this._executeIntent(d));
        Run.scriptTick(e, d);
        this.stats.debtTaken += Math.max(0, hp0 - this.hp);
        over = this._afterEnemyAct(ev);
        if (over) return over;
      }
      // next turn
      e.turn += 1;
      f.turn += 1;
      f.rampart = false; f.guardian = false; f.wardReflect = false;
      if (f.chainReady) { f.chainUsed = false; f.chainReady = false; }
      f.echoLeft = this.mods.echo ? 1 : 0;
      f.keyLeft = this.mods.fateKey ? 1 : 0;
      if (f.turn % 2 === 0) f.chainReady = true;
      this._checkBossPhase(ev);
      const nx = this._nextCell(e);
      e.intent = nx;
      e.now = nx.now || null;
      const kept = this.mods.bulwark ? Math.floor(this.block * 0.5) : 0;
      this.block = kept + (this.hasRelic('buckler') ? 2 : 0);
      this.phase = 'idle';
      ev.push({ t: 'newTurn', intent: e.intent, block: this.block, enemy: this._enemySnap(), sparks: this.sparks,
        held: this.reels.map((r) => r.held), jam: this.reels.map((r) => r.jam) });
      return ev;
    }

    // Deaths after an enemy action. Returns the final event list if the fight or the run ended.
    _afterEnemyAct(ev) {
      const e = this.enemy;
      this._hang(ev);
      if (e.hp <= 0) {
        if (this.hp <= 0) { this.hp = 1; ev.push({ t: 'cling', hp: 1 }); }
        return ev.concat(this._enemyDefeated());
      }
      if (this.hp <= 0) {
        const sw = this._trySecondWind();
        if (sw) ev.push(sw); else return ev.concat(this._die(e));
      }
      return null;
    }

    _attackParty(raw, heavy) {
      const e = this.enemy, f = this.fight;
      let absorbed, dmg, back = 0;
      if (f.guardian) {
        absorbed = raw; dmg = 0; back += raw;
      } else {
        absorbed = Math.min(this.block, raw);
        this.block -= absorbed;
        dmg = raw - absorbed;
        if (f.rampart) back += Math.round(raw * 0.5);
      }
      if (f.wardReflect && absorbed > 0 && !f.guardian) back += absorbed;
      else if (this.mods.thorns && absorbed > 0 && !f.guardian) back += Math.round(absorbed * 0.6);
      if (e.seals > 0) back = Math.round(back / 2); // seals blunt even reflected harm
      this.hp -= dmg;
      this.stats.damageTaken += dmg;
      if (heavy) this.stats.heavyTaken += dmg;
      if (dmg > 0 && dmg <= 6) this.stats.wardShort += 1;
      const out = { t: 'enemyAttack', raw, blocked: absorbed, dmg, hp: this.hp, block: this.block, heavy: !!heavy, guardian: f.guardian };
      if (back > 0 && e.hp > 0) { e.hp = Math.max(0, e.hp - back); out.thorns = back; out.enemyHp = e.hp; }
      return out;
    }

    _executeIntent(it) {
      const e = this.enemy, ev = [];
      const atk = (v) => Math.round((v + e.atkBonus) * e.atkMult);
      switch (it.k) {
        case 'attack': {
          ev.push(this._attackParty(atk(it.v), it.heavy));
          if (it.finale) e.cutCount = 0;
          if (it.guard) { e.block += it.guard; ev.push({ t: 'enemyGuard', block: e.block }); }
          if (it.steal && this.sparks > 0) { const n = Math.min(this.sparks, it.steal); this.sparks -= n; ev.push({ t: 'drain', stolen: n, sparks: this.sparks }); }
          if (it.grow) { e.atkBonus += it.grow; ev.push({ t: 'enemyGrow', atkBonus: e.atkBonus }); }
          if (it.doomTick) ev.push({ t: 'doom', n: (e.doom || 3) - 1 });
          break;
        }
        case 'doom': ev.push(this._attackParty(atk(it.v), true)); ev.push({ t: 'doom', n: 0, fired: true }); break;
        case 'charge': ev.push({ t: 'enemyCharge', label: it.label }); if (it.guard) { e.block += it.guard; ev.push({ t: 'enemyGuard', block: e.block }); } break;
        case 'guard': e.block += it.v; ev.push({ t: 'enemyGuard', block: e.block }); break;
        case 'heal': {
          const b = e.hp; e.hp = Math.min(e.maxHp, e.hp + it.v);
          this.stats.enemyHealed += e.hp - b;
          if (it.guard) e.block += it.guard;
          ev.push({ t: 'enemyHeal', amount: e.hp - b, hp: e.hp, block: e.block });
          break;
        }
        case 'hex': {
          const cells = [];
          for (let k = 0; k < (it.v || 1); k++) cells.push(this._insertCell(this.rng.int(this.reels.length), cell('skull', { temp: true })));
          ev.push({ t: 'curse', cells, permanent: false });
          break;
        }
        case 'drain': {
          if (this.sparks > 0) { this.sparks -= 1; ev.push({ t: 'drain', stolen: 1, sparks: this.sparks }); }
          else ev.push(this._attackParty(it.v, false));
          break;
        }
        case 'jam': {
          const free = this.reels.map((r, i) => i).filter((i) => !this.reels[i].jam);
          const ri = this.rng.pick(free.length ? free : [0]);
          const r = this.reels[ri];
          r.jam = true; r.held = false; r.carried = false;
          ev.push({ t: 'jam', reel: ri });
          if (it.v) ev.push(this._attackParty(atk(it.v), false));
          break;
        }
        default: ev.push({ t: 'enemyIdle' }); break;
      }
      return ev;
    }

    // ================================================================== previews (pure: never touch the real run or its RNG)
    _clone() {
      const c = Object.create(Run.prototype);
      for (const k of Object.keys(this)) {
        if (k === 'rng' || k === 'mods') continue;
        const v = this[k];
        c[k] = v === undefined ? undefined : JSON.parse(JSON.stringify(v));
      }
      c.mods = this.mods;
      c.rng = U().makeRng(1);
      c.rng.setState(this.rng.state());
      c._preview = true;
      return c;
    }
    _sim(fn) {
      const uid = UID;
      try { return fn(this._clone()); } finally { UID = uid; }
    }

    // What resolving the current payline now would do (exact, by resolving a copy of the run) — damage the party
    // takes, the struck-out heavy (怯み), the debt cell (借り火), and the enemy's next intent.
    // random: a 連鎖 bonus spin rolled dice, so the outcome is not knowable in advance.
    previewTurn() {
      if (this.phase !== 'spun' || !this.enemy) return null;
      const chainArmed = !!(this.mods.chain && this.fight && !this.fight.chainUsed);
      return this._sim((c) => {
        // the copy resolves without the 連鎖 bonus spin: its dice are not peeked at
        if (chainArmed) c.mods = Object.assign({}, c.mods, { chain: false });
        const enemy0 = c.enemy;
        const ev = c.resolve();
        const firstKill = ev.some((x) => x.t === 'enemyDie');
        // the bonus spin happens iff the first line had a combo and did not end the fight (the turn reaches the enemy)
        const reachedEnemy = ev.some((x) => x.t === 'enemyTurn');
        const chain = chainArmed && !!c._lastHadCombo && reachedEnemy && this.reels.some((r, i) => !r.held && !r.jam && !this.isStrung(i));
        const P = { random: chain, chain, dice: false, damage: 0, debtRaw: 0, hits: [], reflect: null, skipped: null, debt: null, next: null, enemyAfter: null,
          partyDies: c.phase === 'dead', enemyDies: firstKill, secondWind: ev.some((x) => x.t === 'secondWind'), hpAfter: c.hp };
        void enemy0;
        // QA-003: the enemy's HP right after this 発動 (before its turn), and what its turn then does to that number
        P.strikeHp = this.enemy.hp; P.burnTick = 0; P.healed = 0; P.thornsBack = 0; P.diesBy = null;
        let enemyTurn = false, lastCause = 'strike';
        for (const x of ev) {
          if (x.t === 'enemyTurn') enemyTurn = true;
          if (!enemyTurn && x.hp != null && ((x.t === 'act' && (x.sym === 'blade' || x.sym === 'flame' || x.sym === 'skull')) || x.t === 'reaper' || x.t === 'pyre' || x.t === 'threads')) P.strikeHp = x.hp;
          if (enemyTurn && x.t === 'burnTick') { P.burnTick += x.dmg; lastCause = 'burn'; }
          if (enemyTurn && x.t === 'enemyHeal') P.healed += x.amount;
          if (enemyTurn && x.t === 'enemyAttack' && x.thorns) { P.thornsBack += x.thorns; lastCause = 'thorns'; }
          if (x.t === 'enemyDie' && !P.diesBy) P.diesBy = enemyTurn ? lastCause : 'strike';
        }
        if (P.diesBy === 'strike') P.strikeHp = 0;
        let inDebt = false;
        for (const x of ev) {
          if (x.t === 'staggerCancel') P.skipped = x.skipped || null;
          if (x.t === 'debtAction') { P.debt = x.intent; inDebt = true; }
          if (x.t === 'enemyAttack') {
            P.damage += x.dmg;
            P.hits.push({ raw: x.raw, blocked: x.blocked, dmg: x.dmg, heavy: !!x.heavy, debt: inDebt, back: x.thorns || 0 });
            if (inDebt) P.debtRaw += x.raw;
          }
          if (x.t === 'reflect') { P.damage += Math.max(0, x.amount - x.blocked); P.reflectTaken = (P.reflectTaken || 0) + Math.max(0, x.amount - x.blocked); P.reflect = { amount: x.amount, blocked: x.blocked }; }
          if (x.t === 'selfHit') P.damage += x.amount;
        }
        if (P.debt && P.debt.random) { P.dice = true; P.random = true; } // the debt cell came from the dice: damage / outcome are not knowable
        P.fightGoesOn = !P.enemyDies && !P.partyDies && !!c.enemy && c.phase === 'idle';
        if (P.fightGoesOn) { P.next = c.enemy.intent; P.enemyAfter = c._ghostOf(c.enemy); }
        // the boss's act after this turn (a seal break / HP 30% rewrites the script: such cells are not reachable by 台本送り)
        P.phaseBefore = this.enemy.phase;
        P.phaseAfter = c.enemy ? c.enemy.phase : null;
        const dA = ev.find((x) => x.t === 'debtAction');
        P.debtPhase = dA ? dA.phase : null;
        return P;
      });
    }
    // The script after sending it one cell (拍子木), with the forecast that would follow.
    previewAdvance() {
      if (!this.canAdvance()) return null;
      return this._sim((c) => {
        c.advance();
        const it = c.enemy.intent;
        if (it.random) return { intent: Object.assign({}, UNKNOWN_CELL), unknown: true, R: null, band: null };
        return { intent: it, unknown: false, R: c.forecast(), band: c.scriptBand() };
      });
    }
    // A deterministic action (nudge / echo / key / bless / hold) tried on a copy: the forecast, the turn's outcome and the
    // band that would follow it. Never used for respin (dice).
    previewAfter(act) {
      if (this.phase !== 'spun') return null;
      return this._sim((c) => {
        const ev = act(c);
        if (!ev || !ev.length || c.phase !== 'spun') return null;
        return { R: c.forecast(), turn: c.previewTurn(), band: c.scriptBand(), fires: c.firesAfterManip() };
      });
    }
    // The script and the turn's outcome after borrowing (借り火): the debt cell shows on the band.
    previewBorrow() {
      if (!this.canBorrow()) return null;
      return this._sim((c) => { c.borrow(); return { band: c.scriptBand(), turn: c.previewTurn() }; });
    }

    // A read-only copy of what ai() reads, for walking the script forward.
    _ghostOf(e) {
      return { id: e.id, boss: !!e.boss, hp: e.hp, maxHp: e.maxHp, turn: e.turn, cursor: e.cursor || 0, lastK: e.lastK, doom: e.doom,
        markIdx: e.markIdx, phase: e.phase, seals: e.seals, atkBonus: e.atkBonus, atkMult: e.atkMult, mirrorSym: e.mirrorSym,
        phaseFor: e.phaseFor, phaseAt: e.phaseAt };
    }
    // Read the next cell on a copy. Dice are never rolled: a cell that needs them comes back unknown.
    _ghostNext(g) {
      g.cursor += 1;
      let random = false;
      const roll = () => { random = true; return 0.5; };
      const rng = { next: roll, int: () => { roll(); return 0; }, chance: () => { roll(); return false; }, pick: (a) => { roll(); return a[0]; },
        range: (lo) => { roll(); return lo; }, weighted: (a) => { roll(); return a[0]; }, shuffle: (a) => { roll(); return a; } };
      const it = D().ENEMIES[g.id].ai(g, { rng, mostStocked: () => this.mostStocked(), floor: this.floor });
      return random ? Object.assign({}, UNKNOWN_CELL) : it;
    }
    _ghostPlay(g, it) { Run.scriptTick(g, it); if (it && it.grow) g.atkBonus += it.grow; }
    // Could a boss act change (all seals broken / HP under 30%) before a cell `turnsAhead` enemy turns away is read?
    _bossCond(g, turnsAhead) {
      if (!g.boss) return null;
      if (g.seals > 0) {
        const perTurn = this.mods.skullPact ? 99 : this.mods.chain ? 2 : 1;
        return g.seals <= perTurn * turnsAhead ? 'seal' : null;
      }
      return g.phase < 3 ? 'hp' : null;
    }

    // 灰輪の台本 as the player may read it: now + the next two cells, plus the struck-out heavy (怯み) and the debt cell
    // (借り火) when this turn's resolve will produce them. In 'spun' the next cell comes from resolving a copy of the run
    // with the current payline, so it is exactly what will happen. Cells are never guessed: dice -> unknown,
    // a possible boss act change -> cond ('seal' | 'hp'), a 連鎖 bonus spin -> cond 'chain'.
    scriptBand() {
      const e = this.enemy;
      if (!e || !e.intent || e.hp <= 0) return null;
      const cells = [];
      const add = (role, it, g, cond) => cells.push({ role, it, dmg: this.cellDamage(it, g), locked: this.isLockedCell(it),
        unknown: !!(it && it.unknown), cond: cond || null });
      add('now', e.intent, e, null);
      if (this.phase === 'spun') {
        const P = this.previewTurn();
        if (!P || !P.fightGoesOn) return { cells, spun: true, outcome: P, ends: P ? (P.enemyDies ? 'enemy' : P.partyDies ? 'party' : null) : null };
        const g = P.enemyAfter;
        const chainC = P.chain ? 'chain' : null;
        if (P.skipped) add('skip', P.skipped, g, chainC);
        if (P.debt) {
          if (P.debt.random) add('debt', Object.assign({}, UNKNOWN_CELL), g);
          else { add('debt', P.debt, g, chainC); if (!chainC) cells[cells.length - 1].dmg = P.debtRaw || cells[cells.length - 1].dmg; }
        }
        // after a dice-drawn debt cell, what follows depends on that roll too
        const nx = P.next.random || P.dice ? Object.assign({}, UNKNOWN_CELL) : P.next;
        const stag = nx.k === 'charge' ? 'stagger' : null; // a ward pair next turn would strike the heavy after it
        const cond2 = chainC || this._bossCond(g, 1) || stag;
        add('next', nx, g, chainC);
        this._ghostPlay(g, nx); g.turn += 1;
        const n2 = P.dice ? Object.assign({}, UNKNOWN_CELL) : this._ghostNext(g);
        add('next2', n2, g, cond2);
        // 返し鏡: the next cell's seal comes from this very line (exact); the one after depends on the next resolve
        if (D().ENEMIES[e.id].mirror) for (const c of cells) if (c.role === 'next2' && !c.cond && !c.unknown && c.it.now && c.it.now.k === 'mark') c.cond = 'mirror';
        // this resolve changes the boss's act: the cells after it belong to the new script (exact, but 台本送り cannot reach them)
        if (e.boss) for (const c of cells) {
          if ((c.role === 'next' || c.role === 'next2') && P.phaseAfter != null && P.phaseAfter !== P.phaseBefore) c.actChange = P.phaseAfter;
          if (c.role === 'debt' && P.debtPhase != null && P.debtPhase !== P.phaseBefore) c.actChange = P.debtPhase;
        }
        return { cells, spun: true, outcome: P };
      }
      const g = this._ghostOf(e);
      const stag1 = e.intent.k === 'charge' ? 'stagger' : null; // two wards on the coming spin strike the heavy out
      const c1 = this._bossCond(g, 1) || stag1, c2 = this._bossCond(g, 2) || (stag1 ? 'shift' : null);
      this._ghostPlay(g, e.intent);
      g.turn += 1;
      const n1 = this._ghostNext(g);
      add('next', n1, g, c1);
      this._ghostPlay(g, n1); g.turn += 1;
      add('next2', this._ghostNext(g), g, c2 || (n1.k === 'charge' ? 'stagger' : null));
      // 返し鏡: before the spin, the seals of the coming cells are decided by resolves still to come
      if (D().ENEMIES[e.id].mirror) for (const c of cells) if (c.role !== 'now' && !c.cond && !c.unknown && c.it.now && c.it.now.k === 'mark') c.cond = 'mirror';
      return { cells, spun: false };
    }

    _gainEmbers(n, src) {
      if (src !== 'event' && src !== 'shortcut' && this.mods.emberMult) n = Math.max(1, Math.round(n * this.mods.emberMult));
      this.embers += n;
      this.emberLog[src] = (this.emberLog[src] || 0) + n;
    }

    _enemyDefeated() {
      const e = this.enemy, m = this.mods;
      const ev = [{ t: 'enemyDie', id: e.id, boss: e.boss, elite: e.elite }];
      this.stats.kills += 1;
      this._gainEmbers(e.ember, 'kill');
      ev.push({ t: 'embers', amount: e.ember, total: this.embers, src: 'kill' });
      const sc = D().SHORTCUTS[this.startFloor];
      if (sc && sc.embers > 0 && !this._shortcutPaid) { this._shortcutPaid = true; this._gainEmbers(sc.embers, 'shortcut'); ev.push({ t: 'embers', amount: sc.embers, total: this.embers, src: 'shortcut' }); }
      if (e.elite || e.boss) this.eliteKills.push(e.id);
      this.lastFightTurns = this.fight.turn + 1;
      if (e.boss) {
        this.bossHpPct = 0;
        // 深淵の繰り手: the true final boss ends the run as won (the 真のクリア record and the ending come in stage 4d)
        if (D().ENEMIES[e.id].final) return ev.concat(this._win());
        // 第三層から: the skipped floors are paid back only when the run gets this far
        if (sc && sc.bossEmbers) { this._gainEmbers(sc.bossEmbers, 'shortcut'); ev.push({ t: 'embers', amount: sc.bossEmbers, total: this.embers, src: 'shortcut' }); }
        return ev.concat(this.mods.deepUnlocked && !this.deep ? this._settleBoss() : this._win());
      }
      if (this.deep && this.floor >= D().DEEP_LAST_FLOOR) return ev.concat(this._finishDeep(true));
      for (const r of this.reels) {
        const keep = r.strip[r.pos];
        r.strip = r.strip.filter((c) => !c.temp);
        const np = r.strip.indexOf(keep);
        r.pos = np >= 0 ? np : 0;
        r.held = false; r.carried = false; r.jam = false; r.echo = null;
      }
      this.block = 0;
      const d = this._gainSparks(m.sparkPerWin);
      if (d > 0) ev.push({ t: 'sparks', delta: d, total: this.sparks, max: this.maxSparks, src: 'win' });
      const wasMimic = e.id === 'mimic';
      this.enemy = null;
      this.fight = null;
      if (!wasMimic) this.pending.unshift(e.elite || e.dread ? 'relic' : 'carving');
      if (!e.elite && !e.dread && !wasMimic && this.hp < this.maxHp) {
        const b = this.hp; this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * (this.mods.runNo > 1 ? 0.08 : 0.04)));
        ev.push({ t: 'heal', amount: this.hp - b, hp: this.hp, src: 'rest' });
      }
      ev.push({ t: 'victory', floor: this.floor, elite: e.elite });
      return ev.concat(this._continue());
    }

    _die(e) {
      this.hp = 0;
      this.phase = 'dead';
      const ev = [{ t: 'partyDeath' }];
      if (e) {
        const pct = e.hp / e.maxHp;
        this.killer = { id: e.id, art: e.art, variant: e.variant, name: e.name, hp: e.hp, maxHp: e.maxHp, hpPct: pct, elite: e.elite, boss: e.boss, seals: e.seals };
        if (e.boss) { this.bossHpPct = pct; this._gainEmbers(Math.floor((1 - pct) * 60), 'fight'); }
        else if (e.elite) this._gainEmbers(Math.floor((1 - pct) * e.ember * 0.6), 'fight');
      }
      if (this.deep) return ev.concat(this._finishDeep(false)); // fallen in 灰の底: the run stays won
      this._finish(false);
      ev.push({ t: 'runEnd', summary: this.summary });
      return ev;
    }

    _win() {
      if (this.deep) return this._finishDeep(true);
      this.phase = 'won';
      this._finish(true);
      return [{ t: 'runWon' }, { t: 'runEnd', summary: this.summary }];
    }

    // Depth embers for reaching `floor`. A post-clear shortcut (第三層から / 灰の底から) pays only for the floors descended
    // below the floor it starts on: setting out and giving up at once earns nothing. B1 / B5 runs: floor x2 as always.
    _depthEmbers(floor) {
      const sc = D().SHORTCUTS[this.startFloor];
      return Math.max(0, floor * 2 - (sc && sc.postClear ? this.startFloor * 2 : 0));
    }
    _finish(won) {
      const dep = this._depthEmbers(this.floor), sc = D().SHORTCUTS[this.startFloor];
      if (dep > 0 || !(sc && sc.postClear)) this._gainEmbers(dep, 'depth'); // (a 0 gain still rounds up to 1: kept for B1 / B5 as before)
      this.summary = this._summaryNow(won);
    }
    _summaryNow(won) {
      return {
        won, floor: this.floor, startFloor: this.startFloor, zone: this.zoneOf(this.floor), embers: this.embers,
        emberLog: Object.assign({}, this.emberLog), stats: Object.assign({}, this.stats), sparksLeft: this.sparks,
        eliteKills: this.eliteKills.slice(), bossHpPct: this.bossHpPct, killer: this.killer, relics: this.relics.slice(), seed: this.seed,
      };
    }

    // ================================================================== 灰の底 (docs/EXPANSION_3A_SPEC.md §2)
    // 灰輪の主 beaten by a profile that has won before: the run is won and settled here. The UI writes this summary to the
    // profile at once (Meta.applyRunResult) and asks 帰還 / さらに降りる; nothing after this can take the win away.
    _settleBoss() {
      this._finish(true);
      this.summary.settled = true;
      this.settled = { embers: this.embers, depth: this._depthEmbers(this.floor), stats: Object.assign({}, this.stats), elites: this.eliteKills.length, summary: this.summary };
      this.phase = 'descent';
      return [{ t: 'runWon' }, { t: 'bossSettled', summary: this.summary }];
    }
    // false: 帰還 (the settled result, nothing more is counted). true: さらに降りる — a campfire, then B13.
    chooseDescent(go) {
      if (this.phase !== 'descent') return [];
      if (!go) { this.phase = 'won'; return [{ t: 'runEnd', summary: this.summary }]; }
      this.deep = { order: this.rng.shuffle(D().DEEP_PAIR.slice()) };
      for (const r of this.reels) {
        const keep = r.strip[r.pos];
        r.strip = r.strip.filter((c) => !c.temp);
        const np = r.strip.indexOf(keep);
        r.pos = np >= 0 ? np : 0;
        r.held = false; r.carried = false; r.jam = false; r.echo = null;
      }
      this.block = 0;
      this.enemy = null;
      this.fight = null;
      const ev = [{ t: 'descend', order: this.deep.order.slice() }];
      const d = this._gainSparks(this.mods.sparkPerWin);
      if (d > 0) ev.push({ t: 'sparks', delta: d, total: this.sparks, max: this.maxSparks, src: 'win' });
      return ev.concat(this._startEvent('campfire'));
    }
    // The descent ends (B16 cleared, fallen, or given up). summary.won stays true; summary.deep holds only what was gained
    // after the boss (Meta.applyDeepResult adds just that), summary.base is the settled summary (for a one-shot apply).
    _finishDeep(cleared) {
      const s0 = this.settled, st = this.stats, b = s0.stats;
      const dep = this._depthEmbers(this.floor) - s0.depth;
      if (dep > 0) this._gainEmbers(dep, 'depth');
      this.phase = cleared ? 'won' : 'dead';
      const sum = this._summaryNow(!this.deepOnly);
      if (this.deepOnly) sum.deepOnly = true; // started at 灰の底: not a main-game result (Meta.applyDeepResult only)
      else { sum.settled = true; sum.base = s0.summary; }
      sum.deep = {
        floor: this.floor, cleared: !!cleared, embers: this.embers - s0.embers,
        kills: st.kills - b.kills, triples: (st.triples || 0) - (b.triples || 0), bonds: (st.bonds || 0) - (b.bonds || 0),
        eliteKills: this.eliteKills.slice(s0.elites),
      };
      this.summary = sum;
      return (cleared ? [{ t: 'deepCleared' }] : []).concat([{ t: 'runEnd', summary: sum }]);
    }
  }

  SD.Run = Run;
})();
