/* EMBERWHEEL — game data (pure). Numbers here are the main balance surface (tuned with tools/sim.js). */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});

  // ---------------------------------------------------------------- symbols
  const SYMBOLS = {
    blade:   { id: 'blade',   name: '剣',   hero: 'knight', base: 4, color: '#d8e2f0', desc: '敵にダメージ（鎧で減る）' },
    flame:   { id: 'flame',   name: '焔',   hero: 'witch',  base: 3, color: '#ff8a3d', desc: '敵にダメージ（鎧を無視）' },
    ward:    { id: 'ward',    name: '盾',   hero: 'knight', base: 4, color: '#6fd3ff', desc: 'このターン受けるダメージを防ぐ' },
    heart:   { id: 'heart',   name: '癒',   hero: 'priest', base: 3, color: '#7df0b4', desc: 'HPを回復' },
    lantern: { id: 'lantern', name: '灯',   hero: null,     base: 2, color: '#ffd257', desc: '残り火を得る。火種+1（1ターン1回）' },
    skull:   { id: 'skull',   name: '髑髏', hero: null,     base: 3, color: '#b48cff', desc: '自分に3ダメージ。三つ揃うと「死神」' },
    wild:    { id: 'wild',    name: '星',   hero: null,     base: 0, color: '#fff6d8', desc: '三連か絆を作れるなら必ず作る。作れないときは、結果が最も良くなる記号に化ける' },
  };
  const WILD_PRIORITY = ['blade', 'flame', 'ward', 'heart', 'lantern'];
  const BOND_ORDER = ['heart', 'flame', 'blade']; // reel 1 = Toto, reel 2 = Lu, reel 3 = Bram (matches the stage line-up)
  const MATCH_MULT = [0, 1, 1.5, 2.5, 3.5, 5];

  // Starting strips (10 stops each). Same composition, different order, no identical neighbours (circular).
  const START_STRIPS = [
    ['blade', 'ward', 'flame', 'heart', 'blade', 'lantern', 'flame', 'ward', 'blade', 'heart'],
    ['flame', 'blade', 'heart', 'ward', 'blade', 'flame', 'lantern', 'heart', 'blade', 'ward'],
    ['heart', 'blade', 'ward', 'flame', 'lantern', 'blade', 'heart', 'ward', 'flame', 'blade'],
  ];
  const STRIP_MIN = 6, STRIP_MAX = 14;
  const BASE_HP = 32;

  // ---------------------------------------------------------------- heroes
  const HEROES = {
    knight: { id: 'knight', name: 'ブラム', title: '騎士', reel: 2, symbols: ['blade', 'ward'], verb: '留め' },
    witch:  { id: 'witch',  name: 'ルゥ',   title: '魔女', reel: 1, symbols: ['flame'], verb: '再演' },
    priest: { id: 'priest', name: 'トト',   title: '僧',   reel: 0, symbols: ['heart'], verb: 'ずらし' },
  };

  // ---------------------------------------------------------------- zones / floors
  const ZONES = {
    cellar:    { id: 'cellar',    name: '蝋燭の地下蔵',   music: 'cellar',    floors: [1, 4] },
    ossuary:   { id: 'ossuary',   name: '水没した納骨堂', music: 'ossuary',   floors: [5, 8] },
    gearworks: { id: 'gearworks', name: '歯車の深淵',     music: 'gearworks', floors: [9, 11] },
    abyss:     { id: 'abyss',     name: '灰輪の座',       music: 'boss',      floors: [12, 12] },
    // 第四層 (after the boss, once the game has been cleared): enemies keep their listed numbers (no depth scaling)
    ashdeep:   { id: 'ashdeep',   name: '灰の底',         music: 'gearworks', floors: [13, 16], deep: true },
  };
  const FLOORS = {
    1:  { zone: 'cellar', type: 'normal', pool: ['rat', 'slime'] },
    2:  { zone: 'cellar', type: 'normal', pool: ['rat', 'slime', 'shellback'] },
    3:  { zone: 'cellar', type: 'normal', pool: ['shellback', 'slime', 'rat'] },
    4:  { zone: 'cellar', type: 'elite', enemy: 'bellhound' },
    5:  { zone: 'ossuary', type: 'normal', pool: ['moth', 'sentry', 'wisp'] },
    6:  { zone: 'ossuary', type: 'normal', pool: ['moth', 'sentry', 'wisp'] },
    7:  { zone: 'ossuary', type: 'normal', pool: ['moth', 'sentry', 'wisp'] },
    8:  { zone: 'ossuary', type: 'elite', enemy: 'abbot' },
    9:  { zone: 'gearworks', type: 'normal', pool: ['golem', 'shade', 'sentry_deep'] },
    10: { zone: 'gearworks', type: 'normal', pool: ['golem', 'shade', 'sentry_deep'] },
    11: { zone: 'gearworks', type: 'normal', pool: ['golem', 'shade', 'sentry_deep'] },
    12: { zone: 'abyss', type: 'boss', enemy: 'ashlord' },
    // 灰の底: B13 / B14 meet 重ね殻 and 返し鏡 once each (order rolled when the descent starts), B15 is a normal crossroads
    13: { zone: 'ashdeep', type: 'battle', deepSlot: 0 },
    14: { zone: 'ashdeep', type: 'battle', deepSlot: 1 },
    15: { zone: 'ashdeep', type: 'normal', pool: ['husk', 'mirror'] },
    16: { zone: 'ashdeep', type: 'elite', enemy: 'abbot_deep' },
  };
  const LAST_FLOOR = 12;
  const DEEP_FIRST_FLOOR = 13, DEEP_LAST_FLOOR = 16;
  const DEEP_PAIR = ['husk', 'mirror'];
  // Shortcut starts (free milestones): what you receive instead of the skipped floors.
  const SHORTCUTS = {
    5: { gate: 'bellhound', carvings: 3, relics: 1, embers: 25, label: '第二層から' },
    // after the first clear (docs/EXPANSION_3A2_ENTRY_SPEC.md). The kit (carvings / relics) is spent inside the run only;
    // B9's 50 embers are paid only when that run beats 灰輪の主 (bossEmbers), never for just setting out.
    9: { gate: 'ashlord', carvings: 4, relics: 4, embers: 0, bossEmbers: 50, label: '第三層から', postClear: true },
    // 灰の底 only (no boss, no main-game record): opens once a 灰の底 run has been finished
    // kit tuned by sim (tools/sim.js entry): with 4 relics 灰の底 clears match the B9 route (+1 pt overall, every build within ±15)
    13: { gateStat: ['deepRuns', 1], carvings: 4, relics: 4, embers: 0, label: '灰の底から', postClear: true, deepOnly: true },
  };

  // ---------------------------------------------------------------- enemies
  // ai(e, run) -> intent { k, v, heavy, grow, doomTick, now:{k,v,sym}, label }
  //   k: 'attack' | 'charge' | 'guard' | 'hex' | 'drain' | 'jam' | 'heal' | 'doom' | 'none'
  //   now (active during the CURRENT player turn): 'curl' (armor+v) | 'thirst' | 'mark' (sym) | 'reflect'
  // 灰輪の台本 (the script): e.cursor is the position in the enemy's script, e.turn the real enemy turns elapsed.
  // Advancing the script (拍子木) moves the cursor without a turn passing, so time-based effects read e.turn.
  // ai() is also called on read-only copies to preview the script: it may only read e.* and run.rng / run.mostStocked(),
  // and anything drawn from run.rng is shown as unknown ("？") in the preview.
  const cyc = (e, list) => list[e.cursor % list.length];
  const ENEMIES = {
    rat: {
      name: '燭ネズミ', hp: 16, armor: 0, ember: 5, zone: 'cellar',
      tip: '溜めの後の噛みつきは痛い。溜めの間に盾を2つ揃えれば怯む。',
      ai(e, run) {
        if (e.lastK === 'charge') return { k: 'attack', v: 10, heavy: true, label: '噛みつき' };
        const r = run.rng.next();
        if (e.cursor > 0 && r < 0.3) return { k: 'charge', label: '身構え', next: 10 };
        return { k: 'attack', v: r < 0.65 ? 5 : 6 };
      },
    },
    slime: {
      name: '澱スライム', hp: 20, armor: 0, ember: 6, zone: 'cellar',
      tip: '殴るたびに強くなる。早く倒せ。',
      ai() { return { k: 'attack', v: 4, grow: 1 }; },
    },
    shellback: {
      name: '殻ムシ', hp: 22, armor: 3, ember: 7, zone: 'cellar', crack: true,
      tip: '鎧が剣を弾く。焔は鎧を無視する。剣で打つたびに殻が割れていく。',
      ai(e) { return cyc(e, [{ k: 'attack', v: 7 }, { k: 'attack', v: 6 }, { k: 'none', now: { k: 'curl', v: 6 }, label: '丸まり' }]); },
    },
    bellhound: {
      name: '鐘つき犬', hp: 72, armor: 0, ember: 25, zone: 'cellar', elite: true,
      tip: '咆哮の間に盾2つで怯ませるか、鐘撃を盾で受けろ。',
      ai(e) {
        return cyc(e, [
          { k: 'attack', v: 6, label: '噛みつき' },
          { k: 'attack', v: 6, label: '噛みつき' },
          { k: 'charge', label: '咆哮', next: 21, nextLabel: '鐘撃' },
          { k: 'attack', v: 21, heavy: true, label: '鐘撃' },
        ]);
      },
    },
    moth: {
      name: '呪い蛾', hp: 44, armor: 0, ember: 10, zone: 'ossuary',
      tip: 'リールに髑髏を混ぜてくる。',
      ai(e) { return cyc(e, [{ k: 'hex', v: 1, label: '呪いの鱗粉' }, { k: 'attack', v: 7 }]); },
    },
    sentry: {
      name: '骸骨衛兵', hp: 54, armor: 3, ember: 11, zone: 'ossuary',
      tip: '構えの後に強撃が来る。',
      ai(e) {
        return cyc(e, [
          { k: 'attack', v: 8 }, { k: 'guard', v: 10 },
          { k: 'charge', label: '構え', next: 18, nextLabel: '強撃' }, { k: 'attack', v: 18, heavy: true, label: '強撃' },
        ]);
      },
    },
    wisp: {
      name: '吸い火', hp: 42, armor: 0, ember: 10, zone: 'ossuary',
      tip: '火種を吸う。使うなら先に使え。',
      ai(e) {
        return cyc(e, [
          { k: 'drain', v: 6, label: '吸火' },
          { k: 'attack', v: 6, now: { k: 'thirst' }, label: '渇き' },
          { k: 'attack', v: 8 },
        ]);
      },
    },
    abbot: {
      name: '骨の修道院長', hp: 160, armor: 0, ember: 40, zone: 'ossuary', elite: true,
      tip: '封じは最も多く彫った記号を狙う。ずらして外せ。',
      ai(e, run) {
        const step = e.cursor % 6;
        if (step === 0 || step === 4) return { k: 'attack', v: 6, now: { k: 'mark', sym: run.mostStocked() }, label: '封じ' };
        if (step === 1) return { k: 'attack', v: 12, label: '断罪' };
        if (step === 2) return { k: 'hex', v: 2, label: '呪詛' };
        if (step === 3) return { k: 'heal', v: 10, guard: 6, label: '蘇生' };
        return { k: 'attack', v: 14, label: '断罪' };
      },
    },
    golem: {
      name: '歯車ゴーレム', hp: 88, armor: 7, ember: 16, zone: 'gearworks',
      tip: '分厚い鎧。リールを噛ませて固める。',
      ai(e) { return cyc(e, [{ k: 'attack', v: 11 }, { k: 'jam', v: 6, label: '噛み込み' }, { k: 'attack', v: 13 }]); },
    },
    shade: {
      name: '影の写し身', hp: 74, armor: 0, ember: 16, zone: 'gearworks',
      tip: '鏡の構えは与えた傷の半分を返す。',
      ai(e) {
        return cyc(e, [
          { k: 'attack', v: 7, now: { k: 'reflect' }, label: '鏡の構え' },
          { k: 'attack', v: 10 }, { k: 'attack', v: 10 },
        ]);
      },
    },
    sentry_deep: {
      name: '深淵の衛兵', art: 'sentry', variant: 'deep', hp: 84, armor: 4, ember: 16, zone: 'gearworks',
      tip: '構えの後に強撃が来る。',
      ai(e) {
        return cyc(e, [
          { k: 'attack', v: 11 }, { k: 'guard', v: 12 },
          { k: 'charge', label: '構え', next: 24, nextLabel: '強撃' }, { k: 'attack', v: 24, heavy: true, label: '強撃' },
        ]);
      },
    },
    mimic: {
      name: 'ミミック', hp: 60, armor: 0, ember: 30, zone: null,
      tip: '宝箱のふりをしていた。',
      ai(e) { return cyc(e, [{ k: 'attack', v: 8, label: '噛みつき' }, { k: 'guard', v: 6 }]); },
    },
    ashlord: {
      name: '灰輪の主', hp: 420, armor: 0, ember: 150, zone: 'abyss', boss: true, seals: 3,
      tip: '封印は三連か絆でしか割れない。封印が残るほど灰輪は加速する。燃焼と反射は封印越しでも半分通る。',
      ai(e, run) {
        if (e.seals > 0) {
          // the sealed wheel spins faster every real turn (sending the script does not speed it up)
          const rage = e.turn;
          const it = cyc(e, [
            { k: 'attack', v: 9, label: '灰の一撃' },
            { k: 'hex', v: 2, label: '灰撒き' },
            { k: 'jam', v: 5, label: '逆廻り' },
            { k: 'attack', v: 11, label: '灰の一撃' },
          ]);
          return rage > 0 && (it.k === 'attack' || it.k === 'jam') ? Object.assign({}, it, { v: it.v + rage, label: it.label + (rage >= 3 ? '（加速）' : '') }) : it;
        }
        const order = ['blade', 'flame', 'ward', 'heart'];
        e.markIdx = (e.markIdx == null ? 0 : e.markIdx + 1);
        const sym = order[e.markIdx % 4], next = order[(e.markIdx + 1) % 4];
        if (e.phase < 3) return { k: 'attack', v: (e.markIdx % 2) ? 10 : 12, now: { k: 'mark', sym, next }, label: '逆廻り' };
        if (e.doom == null || e.doom <= 0) e.doom = 3;
        if (e.doom === 1) return { k: 'doom', v: 36, heavy: true, now: { k: 'mark', sym, next }, label: '灰燼' };
        return { k: 'attack', v: 6, doomTick: true, doomN: e.doom, now: { k: 'mark', sym, next }, label: '破滅の秒読み' };
      },
    },
  };

  // ---------------------------------------------------------------- 第四層「灰の底」 (docs/EXPANSION_3A_SPEC.md)
  Object.assign(ENEMIES, {
    // attacks and raises its shell (block) in the same turn; arrives behind a thick shell. Burn / thorns / reaper go through it.
    husk: {
      name: '重ね殻', hp: 250, armor: 0, ember: 20, zone: 'ashdeep', startBlock: 200,
      tip: '分厚い殻（防御）をまとって現れ、攻めながら殻を重ねる。燃焼・棘・死神は殻を素通りする。',
      ai(e) {
        return cyc(e, [
          { k: 'attack', v: 15, guard: 10 },
          { k: 'charge', label: '構え', next: 32, nextLabel: '強撃', guard: 10 },
          { k: 'attack', v: 32, heavy: true, label: '強撃' },
          { k: 'attack', v: 10, guard: 40, label: '殻を重ねる' },
        ]);
      },
    },
    // seals the symbol that led the player's last resolve (at first: the most carved one). The seal is the enemy's state,
    // not a script cell: sending the script never lifts it. e.mirrorSym is set by the engine (Run._mirrorAfter).
    mirror: {
      name: '返し鏡', hp: 280, armor: 0, ember: 22, zone: 'ashdeep', mirror: true,
      tip: '前のターンに主役だった記号を封じる（最初はいちばん多く彫った記号）。台本を送っても封じは外れない。',
      ai(e, run) {
        const it = cyc(e, [{ k: 'attack', v: 14 }, { k: 'attack', v: 16 }, { k: 'hex', v: 1, label: '呪い' }]);
        return Object.assign({}, it, { now: { k: 'mark', sym: e.mirrorSym || run.mostStocked() } });
      },
    },
    // stage 3a stand-in elite: the abbot's script with deeper numbers (replaced in stage 3b)
    abbot_deep: {
      name: '深淵の修道院長', art: 'abbot', variant: 'deep', hp: 380, armor: 0, ember: 60, zone: 'ashdeep', elite: true,
      tip: '封じは最も多く彫った記号を狙う。ずらして外せ。',
      ai(e, run) {
        const step = e.cursor % 6;
        if (step === 0 || step === 4) return { k: 'attack', v: 9, now: { k: 'mark', sym: run.mostStocked() }, label: '封じ' };
        if (step === 1) return { k: 'attack', v: 18, label: '断罪' };
        if (step === 2) return { k: 'hex', v: 2, label: '呪詛' };
        if (step === 3) return { k: 'heal', v: 18, guard: 9, label: '蘇生' };
        return { k: 'attack', v: 21, label: '断罪' };
      },
    },
  });

  // ---------------------------------------------------------------- relics (run only)
  const RELICS = {
    whetstone:  { name: '砥石',       glyph: '砥', desc: '剣の基礎ダメージ+2' },
    flint:      { name: '火打ち石',   glyph: '燧', desc: '焔の基礎ダメージ+1。焔1つにつき燃焼1' },
    holywater:  { name: '聖水',       glyph: '聖', desc: '癒の回復+2' },
    buckler:    { name: '樫の小盾',   glyph: '樫', desc: '毎ターン、ブロック2を得る' },
    hourglass:  { name: '砂時計',     glyph: '砂', desc: '戦闘開始時、火種+1', needs: 'sparks' },
    catbell:    { name: '黒猫の鈴',   glyph: '鈴', desc: '髑髏は自分ではなく敵に5ダメージ' },
    twinring:   { name: '双子の指輪', glyph: '双', desc: 'ペアの倍率+0.5' },
    fang:       { name: '吸血の牙',   glyph: '牙', desc: '剣で与えたダメージの10%回復' },
    candelabra: { name: '燭台',       glyph: '燭', desc: '灯の残り火が2倍', },
    mirror:     { name: '割れた鏡',   glyph: '鏡', desc: '各戦闘、最初のずらしか再演は無料', needs: 'sparks' },
    ironheart:  { name: '鉄の心臓',   glyph: '鉄', desc: '最大HP+12、HP12回復' },
    bonedie:    { name: '骨の賽',     glyph: '賽', desc: '三連の効果+50%' },
    stardust:   { name: '星屑の小瓶', glyph: '星', desc: 'ランダムなリールに星を1つ彫る' },
    hatwax:     { name: '帽子の蝋',   glyph: '蝋', desc: '燃焼が減衰しない（燃焼は最大12）', needs: 'burn' },
  };

  // ---------------------------------------------------------------- events (altar rooms)
  const EVENTS = {
    blood_altar:   { name: '血の祭壇',     glyph: '血', text: '祭壇が血を求めている。', options: [
      { id: 'pay', label: 'HPを10捧げる', desc: 'このRunの火種の上限+1、火種全回復', needs: 'sparks' },
      { id: 'pay_hp', label: 'HPを8捧げる', desc: 'このRunの最大HP+8', notNeeds: 'sparks' },
      { id: 'leave', label: '立ち去る', desc: '' }] },
    cursed_chest:  { name: '呪われた宝箱', glyph: '呪', text: '黒い鎖に巻かれた宝箱。', options: [
      { id: 'open', label: '開ける', desc: '遺物を得る。全リールに髑髏が1つずつ混ざる（このRun中）' },
      { id: 'leave', label: '立ち去る', desc: '' }] },
    fate_offering: { name: '運命の賽銭',   glyph: '賽', text: '小さな運命の輪が、ひとりでに回りたがっている。', options: [
      { id: 'spin', label: '回す', desc: '灯25%=残り火+30 / 癒20%=全回復 / 剣20%=金箔の剣 / 髑髏20%=HP-10 / 外れ15%' },
      { id: 'leave', label: '立ち去る', desc: '' }] },
    ghost_carver:  { name: '刻み師の幽霊', glyph: '鑿', text: '「どの目を彫り直す？」', options: [
      { id: 'chisel2', label: '2つ削る', desc: '好きなコマを2つ削る' },
      { id: 'dup', label: '複製する', desc: '好きなコマを1つ、同じリールに複製する' }] },
    mimic_chest:   { name: '古い宝箱',     glyph: '箱', text: '何の変哲もない宝箱。', options: [
      { id: 'open_mimic', label: '開ける', desc: '中身を得る（…本当に宝箱なら）' },
      { id: 'leave', label: '立ち去る', desc: '' }] },
  };

  // ---------------------------------------------------------------- 灯紋 tree
  // branch: core | weave | valor | hearth | bridge ; a: angle deg (0 right, -90 up) ; r: ring 0..5
  // kind: verb (new action) | rule (changes rules/combos) | prob (probability space) | stat (numbers) | room
  const SKILLS = [
    { id: 'core', branch: 'core', name: '灯輪', glyph: '灯', cost: 0, req: [], a: 0, r: 0, kind: 'core',
      desc: '古き運命装置。残り火で灯紋を灯すほど、運命は思い通りに廻る。', next: '' },

    // ---- 運 Weave: manipulation ----
    { id: 'nudge', branch: 'weave', name: '押し手', glyph: '押', cost: 20, req: ['core'], a: -90, r: 1, kind: 'verb',
      desc: '【ずらし】を得る。上下の段のマスを押すと、火種1でそのリールを1コマずらす。火種は2つで始まり（上限3）、勝利・灯・三連で増える。',
      next: '光るマスを押して、自分の手で三連を揃えられる。' },
    { id: 'respin', branch: 'weave', name: '再演と留め', glyph: '演', cost: 45, req: ['nudge'], a: -106, r: 2, kind: 'verb',
      desc: '【再演】と【留め】を得る。留め金で2本まで固定し、残りを回し直す。各戦闘の最初の再演は無料、以後は火種1。',
      next: 'ペアを留めて、残り1本だけを回し直せる。' },
    { id: 'sparkjar', branch: 'weave', name: '火種壺', glyph: '壺', cost: 45, req: ['nudge'], a: -74, r: 2, kind: 'stat',
      desc: '火種の上限+1、開始時の火種+1。', next: '介入の回数が増える。' },
    { id: 'deft', branch: 'weave', name: '手慣れ', glyph: '慣', cost: 60, req: ['respin'], a: -122, r: 3, kind: 'stat',
      desc: '各戦闘、最初のずらしは火種を使わない。', next: '毎戦、1回は無料でずらせる。' },
    { id: 'stasis', branch: 'weave', name: '継ぎ留め', glyph: '継', cost: 110, req: ['respin'], a: -100, r: 3, kind: 'verb',
      desc: '発動しても、最後に留めた1本は次のターンまで留まったままになる（1ターン限り）。',
      next: '次のターンの目を、今から組み立てられる。' },
    { id: 'wild', branch: 'weave', name: '星の欠片', glyph: '星', cost: 80, req: ['sparkjar'], a: -80, r: 3, kind: 'prob',
      desc: 'リール2に【星】を1つ彫った状態で始まる。星は三連か絆を作れるなら必ず作り、作れないときは結果が最も良くなる記号に化ける。刻印にも星が現れる。',
      next: 'どの記号にもなれる星が回り始める。' },
    { id: 'chisel', branch: 'weave', name: '鑿', glyph: '鑿', cost: 70, req: ['sparkjar'], a: -58, r: 3, kind: 'prob',
      desc: 'Run開始時、好きなコマを2つ削れる。焚き火でも削れる。',
      next: '降りる前に、リールの中身を自分で設計できる。' },
    { id: 'longpush', branch: 'weave', name: '遠押し', glyph: '遠', cost: 90, req: ['deft'], a: -126, r: 4, kind: 'verb',
      desc: 'ずらしが2コマ先まで届く（リボンのマスを押す。火種1）。',
      next: '2つ先の目まで手が届く。' },
    { id: 'precision', branch: 'weave', name: '精妙', glyph: '精', cost: 120, req: ['stasis', 'wild'], a: -74, r: 4, kind: 'rule',
      desc: 'ずらし・再演・写し身・鍵・祝福を使ったターンに三連か絆を出すと、その効果1.5倍。', next: '自分の手で揃えた目は、より強い。' },
    { id: 'echo', branch: 'weave', name: '写し身', glyph: '写', cost: 120, req: ['stasis', 'longpush'], a: -112, r: 4, kind: 'verb',
      desc: '【写し身】1ターン1回、火種1で、発動列のある記号を別のリールの発動列に写す。',
      next: 'ペアから確定の三連が作れる。' },
    { id: 'borrow', branch: 'weave', name: '借り火', glyph: '借', cost: 55, req: ['nudge'], a: -145, r: 2, kind: 'verb',
      desc: '【灰輪に借りる】火種が0のとき、1戦1回、このターンだけ使える火種を1つ借りる。代わりに灰輪は台本を1コマ先取りし、次の行動もこのターンのうちに行う。',
      next: '火種が尽きても、敵の未来を担保に一手だけ動ける。' },
    { id: 'hyoshigi', branch: 'weave', name: '拍子木', glyph: '拍', cost: 100, req: ['stasis', 'bulwark'], a: -90, r: 4, kind: 'verb',
      desc: '【台本送り】1ターン1回、火種1で、灰輪の台本を1コマ送る。今の予告は行われず、次の行動が今になる。溜め終えた強撃と灰燼は送れない（早めることはできる）。',
      next: '敵に何をさせるかを、自分で選べる。' },
    { id: 'fatekey', branch: 'weave', name: '運命の鍵', glyph: '鍵', cost: 170, req: ['echo'], a: -96, r: 5, kind: 'verb',
      desc: '【運命の鍵】1ターン1回、火種1で、1本のリールを好きなコマに合わせる（リールのリボンから選ぶ）。',
      next: '運命を、自分で選ぶ。' },

    // ---- 猛 Valor: power & combos ----
    { id: 'whet', branch: 'valor', name: '研ぎ', glyph: '研', cost: 15, req: ['core'], a: 150, r: 1, kind: 'stat',
      desc: '剣の基礎ダメージ+1。', next: '剣が少し重くなる。' },
    { id: 'bond', branch: 'valor', name: '絆の陣', glyph: '絆', cost: 40, req: ['whet'], a: 164, r: 2, kind: 'rule',
      desc: '【絆の陣】リール1（トト）に癒・リール2（ルゥ）に焔・リール3（ブラム）に剣が揃うと、三人の効果がそれぞれ3倍。火種+1、ボスの封印も割れる。',
      next: '三人がそれぞれの持ち場に揃う、もう一つの大技。' },
    { id: 'kindle', branch: 'valor', name: '燎原', glyph: '燎', cost: 50, req: ['whet'], a: 136, r: 2, kind: 'rule',
      desc: '【燃焼】焔1つにつき燃焼2。敵ターンごとに燃焼の数だけダメージ（鎧・封印無視）し、1減る。',
      next: '焔が残り続ける火になる。' },
    { id: 'momentum', branch: 'valor', name: '追撃', glyph: '追', cost: 55, req: ['bond'], a: 178, r: 3, kind: 'rule',
      desc: '敵を倒した次の戦闘、最初の発動が1.5倍になり火種+1。', next: '勝つたびに次の戦いが加速する。' },
    { id: 'execute', branch: 'valor', name: '処刑人', glyph: '刑', cost: 70, req: ['bond'], a: 158, r: 3, kind: 'rule',
      desc: 'HP30%以下の敵に、剣のダメージ2倍。', next: '弱った敵を確実に仕留める。' },
    { id: 'pyre', branch: 'valor', name: '灰燼', glyph: '燼', cost: 90, req: ['kindle'], a: 138, r: 3, kind: 'rule',
      desc: '焔の三連で、敵の燃焼を起爆し燃焼×2のダメージ（燃焼は残る）。', next: '溜めた火を一気に爆ぜさせる。' },
    { id: 'skullpact', branch: 'valor', name: '髑髏の契約', glyph: '契', cost: 90, req: ['kindle'], a: 118, r: 3, kind: 'rule',
      desc: '髑髏は自分ではなく敵に5ダメージ。死神はボスの封印を全て砕く。刻印に髑髏が現れる。',
      next: '呪いを、力に変える。' },
    { id: 'twin', branch: 'valor', name: '双の誓い', glyph: '誓', cost: 110, req: ['momentum', 'execute'], a: 170, r: 4, kind: 'prob',
      desc: 'ペアの倍率 1.5→2.0。', next: 'ペアだけでも十分に重い。' },
    { id: 'trine', branch: 'valor', name: '三連の極意', glyph: '極', cost: 120, req: ['execute', 'pyre'], a: 146, r: 4, kind: 'stat',
      desc: '三連の倍率 2.5→3.5。', next: '三連がさらに跳ね上がる。' },
    { id: 'chain', branch: 'valor', name: '連鎖', glyph: '連', cost: 160, req: ['twin', 'trine'], a: 158, r: 5, kind: 'rule',
      desc: '三連か絆を出すと、敵が動く前にもう一度だけ灯輪が回り、続けて発動する（2ターンに1回）。',
      next: '揃えるたびに、もう一度。' },

    // ---- 守 Hearth: survival ----
    { id: 'cloak', branch: 'hearth', name: '厚き外套', glyph: '套', cost: 15, req: ['core'], a: 30, r: 1, kind: 'stat',
      desc: '最大HP+10。', next: '少しだけ長く戦える。' },
    { id: 'campfire', branch: 'hearth', name: '焚き火', glyph: '焚', cost: 30, req: ['cloak'], a: 46, r: 2, kind: 'room',
      desc: '分かれ道に【焚き火】が現れる: HP35%回復、または好きなコマを1つ削る。', next: '道中で休める場所が見つかる。' },
    { id: 'thorns', branch: 'hearth', name: '棘の盾', glyph: '棘', cost: 50, req: ['cloak'], a: 14, r: 2, kind: 'rule',
      desc: 'ブロックで受け止めたダメージの60%を敵に返す（鎧・封印無視）。', next: '守りがそのまま攻めになる。' },
    { id: 'bless', branch: 'hearth', name: '祝福', glyph: '祝', cost: 60, req: ['campfire'], a: 62, r: 3, kind: 'verb',
      desc: '【祝福】1戦1回、発動列の髑髏を押すと癒に変える（無料）。', next: 'トトが呪いを清める。' },
    { id: 'secondwind', branch: 'hearth', name: '起死回生', glyph: '起', cost: 80, req: ['campfire'], a: 40, r: 3, kind: 'rule',
      desc: '1Run1回、致死ダメージを受けてもHP1で耐え、最大HPの15%回復。', next: '一度だけ、倒れずに立ち上がる。' },
    { id: 'bulwark', branch: 'hearth', name: '蓄え', glyph: '蓄', cost: 70, req: ['thorns'], a: 14, r: 3, kind: 'rule',
      desc: '使われなかったブロックの半分を次のターンへ持ち越す。', next: '盾を前のターンから積める。' },
    { id: 'laststand', branch: 'hearth', name: '背水', glyph: '背', cost: 90, req: ['secondwind', 'bulwark'], a: 24, r: 4, kind: 'rule',
      desc: 'HP30%以下の間、全ての効果1.5倍。', next: '追い詰められるほど強くなる。' },
    { id: 'toughness', branch: 'hearth', name: '不屈', glyph: '屈', cost: 110, req: ['secondwind', 'bless'], a: 50, r: 4, kind: 'stat',
      desc: '最大HP+15。', next: 'さらに長く戦える。' },
    { id: 'guardian', branch: 'hearth', name: '守護の誓い', glyph: '護', cost: 110, req: ['laststand'], a: 22, r: 5, kind: 'rule',
      desc: '盾が2つ以上揃ったターン、ブロックで受けた攻撃をそのまま全て跳ね返す（封印無視）。盾の三連なら攻撃を完全に防ぐ。',
      next: '最大の一撃を、そのまま返す。' },
    { id: 'keeper', branch: 'hearth', name: '灯守り', glyph: '守', cost: 150, req: ['guardian', 'toughness'], a: 40, r: 5, kind: 'rule',
      desc: '各戦闘の開始時、最大HPの10%のブロックを得る。癒は回復の半分のブロックも与える。',
      next: '倒れない灯になる。' },

    // ---- bridges ----
    { id: 'crossroads', branch: 'bridge', name: '分かれ道', glyph: '岐', cost: 40, req: ['nudge', 'whet', 'cloak'], a: 90, r: 1, kind: 'room',
      desc: '扉の選択肢が3つになる。', next: '道を選ぶ幅が広がる。' },
    { id: 'gambler', branch: 'bridge', name: '賭博師の目', glyph: '賭', cost: 100, req: ['respin', 'bond'], a: -150, r: 3, kind: 'rule',
      desc: '火種で再演するたびに、このターンの効果+20%（累積）。', next: '回すほど、賭けは大きくなる。' },
    { id: 'gentle', branch: 'bridge', name: '祈りの手', glyph: '祈', cost: 80, req: ['deft', 'bless'], a: -30, r: 4, kind: 'rule',
      desc: 'ずらすたびにHPを2回復。', next: 'ずらしが癒しになる。' },
    { id: 'bloodprice', branch: 'bridge', name: '血の代価', glyph: '代', cost: 90, req: ['execute', 'bulwark'], a: 90, r: 4, kind: 'verb',
      desc: '火種が無いとき、HP4を払って再演できる。', next: '命を削って運命を回す。' },
  ];

  const SKILL_BY_ID = {};
  for (const s of SKILLS) SKILL_BY_ID[s.id] = s;

  SD.Data = {
    SYMBOLS, WILD_PRIORITY, BOND_ORDER, MATCH_MULT, START_STRIPS, STRIP_MIN, STRIP_MAX, BASE_HP,
    HEROES, ZONES, FLOORS, LAST_FLOOR, DEEP_FIRST_FLOOR, DEEP_LAST_FLOOR, DEEP_PAIR, SHORTCUTS, ENEMIES, RELICS, EVENTS, SKILLS, SKILL_BY_ID,
  };
})();
