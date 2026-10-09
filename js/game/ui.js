/* EMBERWHEEL — DOM UI helpers: elements, glyph images, tooltips, text formatting. */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});

  const UI = {};

  UI.el = (tag, cls, html, attrs) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  UI.root = () => document.getElementById('ui');
  UI.clear = () => { const r = UI.root(); while (r.firstChild) r.removeChild(r.firstChild); UI.hideTip(); };

  // Canvas element showing a symbol / icon (crisp at device scale).
  UI.glyph = (kind, name, size, opts = {}) => {
    const k = Math.max(2, Math.ceil((SD.Game && SD.Game.renderScale) || 2));
    const c = document.createElement('canvas');
    c.width = size * k; c.height = size * k;
    c.style.width = size + 'px'; c.style.height = size + 'px';
    c.className = 'glyph';
    const ctx = c.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    try {
      if (kind === 'sym' && SD.Art.drawSymbol) SD.Art.drawSymbol(ctx, name, size / 2, size / 2, size * 0.95, opts);
      else if (kind === 'icon' && SD.Art.drawIcon) SD.Art.drawIcon(ctx, name, size / 2, size / 2, size * 0.95, opts);
    } catch (e) { /* art not ready */ }
    return c;
  };
  UI.sym = (s, size = 28, opts) => UI.glyph('sym', s, size, opts);

  // Illustrated props (js/art/props.js) with a text fallback.
  UI.prop = (kind, id, size, fallbackText, cls) => {
    const k = Math.max(2, Math.ceil((SD.Game && SD.Game.renderScale) || 2));
    const drawFn = kind === 'relic' ? SD.Art.drawRelic : kind === 'event' ? SD.Art.drawEventProp : kind === 'chisel' ? SD.Art.drawChiselIcon : null;
    if (!drawFn) return UI.el('div', cls || '', fallbackText || '');
    const c = document.createElement('canvas');
    c.width = size * k; c.height = size * k; c.style.width = size + 'px'; c.style.height = size + 'px';
    c.className = 'glyph prop';
    const ctx = c.getContext('2d'); ctx.setTransform(k, 0, 0, k, 0, 0);
    try {
      if (kind === 'chisel') drawFn(ctx, size / 2, size / 2, size * 0.9);
      else drawFn(ctx, id, size / 2, size / 2, size * 0.92, { t: 0 });
    } catch (e) { return UI.el('div', cls || '', fallbackText || ''); }
    return c;
  };
  UI.icon = (n, size = 28, opts) => UI.glyph('icon', n, size, opts);

  // inline HTML for a symbol name with its color
  UI.symName = (s) => {
    const d = SD.Data.SYMBOLS[s];
    return `<b class="symname" style="color:${d.color}">${d.name}</b>`;
  };

  // ---------------------------------------------------------------- tooltip
  let tipEl = null;
  UI.showTip = (html, x, y) => {
    if (!tipEl) { tipEl = UI.el('div', 'tooltip'); document.getElementById('stage').appendChild(tipEl); }
    tipEl.innerHTML = html;
    tipEl.style.display = 'block';
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let tx = x + 18, ty = y + 18;
    if (tx + w > 1270) tx = x - w - 14;
    if (ty + h > 712) ty = y - h - 14;
    tipEl.style.left = Math.max(6, tx) + 'px'; tipEl.style.top = Math.max(6, ty) + 'px';
  };
  UI.hideTip = () => { if (tipEl) tipEl.style.display = 'none'; };
  UI.bindTip = (el, htmlFn) => {
    el.addEventListener('mousemove', (e) => { const p = SD.Game.toStage(e); UI.showTip(typeof htmlFn === 'function' ? htmlFn() : htmlFn, p.x, p.y); });
    el.addEventListener('mouseleave', () => UI.hideTip());
  };

  UI.button = (label, cls, onClick, opts = {}) => {
    const b = UI.el('button', 'btn ' + (cls || ''), label);
    b.addEventListener('mouseenter', () => { if (!b.disabled && SD.Audio) SD.Audio.play('ui_hover', { vol: 0.5 }); });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b.disabled) { if (SD.Audio) SD.Audio.play('ui_deny'); return; }
      if (SD.Audio && !opts.silent) SD.Audio.play('ui_click');
      onClick && onClick(e);
    });
    return b;
  };

  UI.pct = (x) => (x * 100 >= 10 ? Math.round(x * 100) : (Math.round(x * 1000) / 10)) + '%';

  // ---------------------------------------------------------------- carving / relic descriptions
  UI.offerText = (o, run) => {
    const S = (s) => UI.symName(s);
    switch (o.kind) {
      case 'relic': { const r = SD.Data.RELICS[o.id]; return { title: r.name, tag: '遺物', body: r.desc, glyph: r.glyph }; }
      case 'add': return { title: `リール${o.reel + 1}に ${S(o.sym)} を彫る`, tag: '刻む', sym: o.sym };
      case 'add2': return { title: `リール${o.reel + 1}に ${S(o.sym)} を2つ彫る`, tag: '刻む', sym: o.sym, sym2: o.sym };
      case 'transmute': return { title: `リール${o.reel + 1}の ${S(o.from)} を ${S(o.to)} に`, tag: '彫り直す', sym: o.from, to: o.to };
      case 'remove': return { title: `リール${o.reel + 1}から ${S(o.sym)} を削る`, tag: '削る', sym: o.sym, remove: true };
      case 'gild': return { title: `リール${o.reel + 1}の ${S(o.sym)} に金箔`, tag: '金箔', sym: o.sym, gild: true, body: '効果が2倍になる' };
      case 'heal': return { title: `HPを${o.amount}回復`, tag: '休む', icon: 'hp' };
      case 'spark': return { title: '火種の上限 +1', tag: '火種', icon: 'spark', body: 'このRunの間' };
      case 'chisel': return { title: '好きなコマを1つ削る', tag: '鑿', icon: 'chisel', body: 'リールを見て選ぶ' };
      default: return { title: '?', tag: '' };
    }
  };

  // Probability preview for a carving: per-symbol odds on that reel and trine odds before/after.
  UI.offerOdds = (o, run) => {
    if (o.reel == null || !run || o.kind === 'gild' || o.sym === 'skull') return null;
    const strips = run.reels.map((r) => r.strip.map((c) => c.s));
    const after = strips.map((s) => s.slice());
    const st = after[o.reel];
    if (o.kind === 'add') st.push(o.sym);
    if (o.kind === 'add2') st.push(o.sym, o.sym);
    if (o.kind === 'transmute') { const i = st.indexOf(o.from); if (i >= 0) st[i] = o.to; }
    if (o.kind === 'remove') { const i = st.indexOf(o.sym); if (i >= 0) st.splice(i, 1); }
    const p = (arr, s) => arr.filter((x) => x === s || x === 'wild').length / arr.length;
    const focus = o.kind === 'transmute' ? o.to : o.sym;
    if (!focus || focus === 'wild') return null;
    // 三連 / 絆 odds: exact, judged as the resolve judges (a wild completes a combo whenever it can): Run.comboOdds()
    const odds = (ss) => run.comboOdds(ss.map((arr) => arr.map((s) => ({ s }))));
    const ob = odds(strips), oa = odds(after);
    return {
      anyBefore: ob.trine, anyAfter: oa.trine, bondBefore: run.mods.bond ? ob.bond : null, bondAfter: run.mods.bond ? oa.bond : null,
      sym: focus,
      before: p(strips[o.reel], focus), after: p(after[o.reel], focus), // this reel shows the symbol (or a 星)
    };
  };

  // ---------------------------------------------------------------- 灰輪の台本 (the enemy's script band)
  // Shown from the second layer on (B5+), or as soon as a 灯紋 that works on the script is lit.
  UI.bandVisible = (run) => !!(run && run.enemy && (run.floor >= 5 || run.mods.script || run.mods.borrow));
  UI.BAND_ROLE = { now: '今', skip: '不発', debt: '借りの一手', next: '次', next2: 'その次' };
  // 灰鐘の番人 (breakStagger): its 構え breaks to direct hits through the shell as well as to two wards
  const breaks = (run) => { const D = run && run.enemy && SD.Data.ENEMIES[run.enemy.id]; return !!(D && D.breakStagger); };
  UI.breaksStance = breaks;
  UI.BAND_COND_BREAK = {
    stagger: '殻を割り切るか盾2つで構えを崩せば、この大鐘は台本から消える（その分、後ろが繰り上がる）',
    shift: '手前の大鐘を崩すと、ここは1コマ繰り上がる',
  };
  UI.BAND_COND = {
    seal: '封印が全て割れると、灰輪の台本は書き換わる',
    hp: '灰輪の主のHPが30%を切ると、台本は書き換わる（破滅の秒読み）',
    chain: '連鎖でもう一度回る目しだいで変わる',
    stagger: '盾2つで怯ませれば、この強撃は台本から消える（その分、後ろが繰り上がる）',
    shift: '盾2つで手前の強撃を不発にすると、ここは1コマ繰り上がる',
    mirror: '返し鏡の封じは、その前の発動で決まる（まだ決まっていない）',
  };
  // icon / value / corner badges for one script cell { role, it, dmg, unknown, cond, locked }
  UI.cellInfo = (run, c) => {
    const it = (c && c.it) || {};
    const I = { icon: 'attack', value: c ? c.dmg : null, sym: null, now: null, danger: false, label: it.label || '' };
    if ((c && c.unknown) || it.k === 'unknown') { I.icon = 'unknown'; I.value = null; I.label = '？'; return I; }
    switch (it.k) {
      case 'attack':
        I.icon = it.heavy ? 'heavy' : it.doomTick ? 'doom' : 'attack'; I.danger = !!it.heavy;
        I.label = it.doomTick ? `破滅まで ${it.doomN}` : it.label || (it.heavy ? '強撃' : '攻撃');
        break;
      case 'doom': I.icon = 'doom'; I.danger = true; I.label = it.label || '灰燼'; break;
      case 'charge': I.icon = 'charge'; I.value = null; I.label = it.label || '溜め'; break;
      case 'guard': I.icon = 'guard'; I.label = '防御'; break;
      case 'hex': I.icon = 'hex'; I.label = it.label || '呪い'; break;
      case 'drain': I.icon = 'drain'; I.value = null; I.label = it.label || '吸火'; break;
      case 'jam': I.icon = 'jam'; I.label = it.label || '固着'; break;
      case 'heal': I.icon = 'heal'; I.label = it.label || '回復'; break;
      case 'none': I.icon = 'curl'; I.value = null; I.label = it.label || '構え'; break;
      default: I.icon = 'unknown'; I.value = null; break;
    }
    const n = it.now;
    if (n) {
      if (n.k === 'mark') I.sym = n.sym;
      else I.now = n.k === 'reflect' ? 'reflect' : n.k === 'curl' ? 'armor' : n.k === 'thirst' ? 'thirst' : null;
    }
    if (c && c.cond === 'mirror') { I.sym = null; I.now = 'mark'; I.markUnknown = true; } // the seal is not decided yet
    if (it.guard && (it.k === 'attack' || it.k === 'charge')) I.guard = it.guard;
    return I;
  };
  UI.cellExplain = (run, c) => {
    const lines = [`<b>灰輪の台本 — ${UI.BAND_ROLE[c.role] || ''}</b>`];
    if (c.unknown || (c.it && c.it.k === 'unknown')) lines.push('サイコロしだい。この目はまだ決まっていない');
    else lines.push(UI.intentExplain(run, c.cond === 'mirror' ? Object.assign({}, c.it, { now: null }) : c.it, c.dmg)); // an undecided seal is not described as decided
    if (c.role === 'skip') lines.push(breaks(run) ? '<b>構えが崩れる</b>：この大鐘は台本から消え、行われない' : '<b>盾2つで怯ませる</b>：この強撃は台本から消え、行われない');
    if (c.role === 'debt') lines.push('<b>借りの代償</b>：灰輪はこの一手も、このターンのうちに行う');
    const enm = run.enemy ? SD.Data.ENEMIES[run.enemy.id].name : '返し鏡';
    if (c.cond === 'mirror') lines.push(`<span style="color:#e2c8ff"><b>封じ：？</b>　${enm}は、その前の発動でいちばん多く働いた記号を封じる。回した後は「次」の封じが確定して表示される</span>`);
    if (c.cond) lines.push(`<span style="color:#e2c8ff">？ ${c.cond === 'mirror' ? enm + 'の封じは、その前の発動で決まる（まだ決まっていない）' : (breaks(run) && UI.BAND_COND_BREAK[c.cond]) || UI.BAND_COND[c.cond] || '変わる可能性がある'}</span>`);
    if (c.locked && run.mods.script) lines.push('<span style="color:#e8bf6a">溜め終えた一撃は台本から外せない（早めることはできる）</span>');
    if (c.actChange) lines.push(`<span style="color:#e2c8ff"><b>幕</b>：この発動で灰輪は第${c.actChange}幕へ移り、台本が書き換わる。これは新しい幕のコマで、台本送りでは届かない（送ると今の幕の次のコマになる）</span>`);
    if (c.role === 'next' && !c.cond && !c.unknown) lines.push('<span style="color:#b9ad95">このまま発動すれば、次のターンはこれになる</span>');
    const e = run.enemy;
    if (e && e.boss && e.seals > 0 && c.role !== 'now' && !c.actChange && c.it && (c.it.k === 'attack' || c.it.k === 'jam'))
      lines.push('<span style="color:#b9ad95">封印中の灰輪は実ターンごとに加速する。台本送り・借りで早めたコマは、今の加速の値で行われる</span>');
    return lines.join('<br>');
  };

  // opts.band: the script band is on screen, so the plaque does not repeat what comes next
  UI.intentInfo = (run, it, e, opts) => {
    if (!it) return null;
    const dmg = run.intentDamage(it);
    const band = !!(opts && opts.band);
    const I = { icon: 'attack', value: null, label: it.label || '攻撃', danger: false, sym: null, hint: null, now: null, width: 0 };
    switch (it.k) {
      case 'attack':
        I.icon = it.heavy ? 'heavy' : 'attack'; I.value = dmg; I.danger = !!it.heavy || dmg >= run.maxHp * 0.35;
        if (it.grow) I.label = (it.label || '攻撃') + '（強化）';
        if (it.doomTick) { I.icon = 'doom'; I.label = `破滅まで ${it.doomN}`; I.danger = true; }
        break;
      case 'doom': I.icon = 'doom'; I.value = dmg; I.label = it.label || '灰燼'; I.danger = true; break;
      case 'charge': I.icon = 'charge'; I.value = dmg || null; I.label = band ? (it.label || '溜め') : `${it.label || '溜め'} → 次は${it.nextLabel || '強撃'}`; I.danger = true; I.hint = breaks(run) ? '殻を割り切るか、盾2つで崩す' : '盾2つで怯ませて止める'; break;
      case 'guard': I.icon = 'guard'; I.value = it.v; I.label = '防御'; break;
      case 'hex': I.icon = 'hex'; I.value = it.v; I.label = it.label || '呪い'; break;
      case 'drain': I.icon = 'drain'; I.value = run.sparks > 0 ? null : it.v; I.label = run.sparks > 0 ? '火種を吸う' : '吸火（攻撃）'; break;
      case 'jam': I.icon = 'jam'; I.value = dmg || null; I.label = (it.label || '固着'); break;
      case 'heal': I.icon = 'heal'; I.value = it.v; I.label = it.label || '回復'; break;
      case 'none': I.icon = 'curl'; I.label = it.label || '構え'; break;
      default: I.icon = 'unknown'; break;
    }
    if (it.k === 'unknown') { I.icon = 'unknown'; I.label = '？'; }
    if (it.guard && (it.k === 'attack' || it.k === 'charge')) I.label += ` ＋殻${it.guard}`;
    I.locked = run.isLockedCell ? run.isLockedCell(it) : false;
    if (it.now) {
      const n = it.now;
      if (n.k === 'curl') I.now = { icon: 'armor', label: '鎧+' + n.v, value: null, glow: 'rgba(160,190,255,0.6)' };
      if (n.k === 'thirst') I.now = { icon: 'thirst', label: '癒が効かない', glow: 'rgba(125,240,180,0.4)' };
      if (n.k === 'mark') I.now = { icon: 'mark', sym: n.sym, label: SD.Data.SYMBOLS[n.sym].name + 'を封じ', glow: 'rgba(197,139,255,0.7)' };
      if (n.k === 'reflect') I.now = { icon: 'reflect', label: '与ダメ半分反射', glow: 'rgba(220,220,255,0.6)' };
    }
    I.width = I.value != null ? (I.sym ? 140 : 108) : 96;
    if ((it.k === 'attack' || it.k === 'doom' || it.k === 'jam') && dmg >= run.hp + run.block) I.lethal = true;
    return I;
  };

  // What result does this intent ask for? (teaches "different enemies want different results")
  UI.wantedHint = (run, it) => {
    if (!it) return null;
    const n = it.now;
    // 灰鐘の番人's 構え: the way to stop 大鐘 comes before its seal (the seal still shows on the plaque)
    if (it.k === 'charge' && breaks(run)) {
      const sealed = n && n.k === 'mark' ? n.sym : null; // a sealed symbol neither hits nor wards this turn
      const wardOk = sealed !== 'ward';
      return { syms: ['blade', 'flame'].filter((s) => s !== sealed).concat(wardOk ? ['ward'] : []), text: wardOk ? 'で殻を割り切るか、盾2つで大鐘を崩す' : 'で殻を割り切って大鐘を崩す（盾は封じられている）' };
    }
    if (n && n.k === 'mark') return { syms: [n.sym], avoid: true, text: 'は出すと自分が傷つく。ずらして外す' };
    if (n && n.k === 'reflect') return { syms: ['ward', 'heart'], text: 'で受け流す（攻撃すると半分返る）' };
    if (n && n.k === 'curl') return { syms: ['flame'], text: 'は鎧を無視する' };
    if (n && n.k === 'thirst') return { syms: ['blade', 'flame'], text: 'で押し切る（癒は効かない）' };
    switch (it.k) {
      case 'charge': return { syms: ['ward'], text: 'を2つで怯ませ、強撃を止める' };
      case 'doom': return { syms: ['ward'], text: 'を積んで灰燼に備える' };
      case 'guard': return { syms: ['flame'], text: 'か三連で、次の防御ごと押し切る' };
      case 'hex': return { syms: ['heart'], text: 'の三連で呪いを清める／早く倒す' };
      case 'drain': return run.sparks > 0 ? { syms: [], text: '火種は吸われる前に使い切る' } : null;
      case 'heal': return { syms: ['blade', 'flame'], text: 'で回復を上回る' };
      case 'attack': if (it.heavy || run.intentDamage(it) >= run.maxHp * 0.25) return { syms: ['ward'], text: 'で大きな一撃を受け止める' }; return null;
      default: return null;
    }
  };

  UI.intentExplain = (run, it, dmgOverride) => {
    if (!it) return '';
    const dmg = dmgOverride != null ? dmgOverride : run.intentDamage(it), S = (s) => UI.symName(s);
    const lines = [];
    switch (it.k) {
      case 'attack':
        lines.push(it.doomTick ? `破滅の秒読み（あと${it.doomN}）。攻撃 ${dmg}` : `${it.heavy ? '強撃' : '攻撃'}: ${dmg} ダメージ。盾で防げる`);
        if (it.grow) lines.push('攻撃のたびに強くなる');
        break;
      case 'doom': lines.push(`灰燼: ${dmg} ダメージの大技。盾を積むか、その前に倒せ`); break;
      case 'charge':
        if (breaks(run)) {
          lines.push(`${it.label || '構え'}。次のターンに${it.nextLabel || '強撃'} ${it.next || ''}`);
          lines.push(`<b>このターン、剣・焔の直撃で殻を割り切るか、盾を2つ揃えると構えが崩れ、${it.nextLabel || '強撃'}は台本から消える</b>`);
          break;
        }
        lines.push('力を溜めている。次のターンに強撃'); lines.push('<b>このターン盾を2つ揃えると怯んで中断</b>'); break;
      case 'guard': lines.push(`次のターン、ブロック ${it.v} を得る（剣と焔を吸収）`); break;
      case 'hex': lines.push(`あなたのリールに髑髏を ${it.v} 個混ぜる（この戦闘中）`); break;
      case 'drain': lines.push(run.sparks > 0 ? '火種を1つ奪う。使うなら今のうちに' : `火種が無いので攻撃 ${it.v}`); break;
      case 'jam': lines.push('リール1本を噛ませ、次のターンそのリールは操作できない'); if (dmg) lines.push(`さらに攻撃 ${dmg}`); break;
      case 'heal': lines.push(`HPを ${it.v} 回復し、ブロック ${it.guard || 0} を得る`); break;
      case 'none': lines.push('攻撃はしてこない'); break;
      default: break;
    }
    if (it.now) {
      const n = it.now;
      if (n.k === 'curl') lines.push(`<b>このターン</b> 鎧+${n.v}（剣のダメージが減る。焔は鎧を無視）`);
      if (n.k === 'thirst') lines.push('<b>このターン</b> 癒の回復が0になる');
      if (n.k === 'mark') lines.push(`<b>このターン</b> ${S(n.sym)} は封じられ、発動列に出ると1つにつき2ダメージ${n.next ? '（次は ' + S(n.next) + '）' : ''}`);
      if (n.k === 'reflect') lines.push('<b>このターン</b> 与えたダメージの半分が返ってくる（ブロックで受けられる）');
    }
    if (it.guard && (it.k === 'attack' || it.k === 'charge')) lines.push(`同時に<b>殻（防御）${it.guard}</b>を得る。次の自分のターン、剣・焔の直撃を ${it.guard} まで受け止める（燃焼・棘・死神は素通り）`);
    const ED = run.enemy && SD.Data.ENEMIES[run.enemy.id];
    if (ED && ED.mirror && it.now && it.now.k === 'mark') lines.push(`<span style="color:#e2c8ff">${ED.name}：封じるのは、前のターンの発動でいちばん多く働いた記号（最初はいちばん多く彫った記号）。台本を送っても外れない</span>`);
    if (ED && ED.breakStagger && it.k !== 'charge') lines.push('<span style="color:#ffd9a8">灰鐘の番人：「大鐘の構え」のターンに殻を割り切るか盾を2つ揃えれば、大鐘は崩れる</span>');
    return lines.join('<br>');
  };

  // the 灰の底 B16 elite's name (the result screens and banners name it)
  UI.deepEliteName = () => { const D = SD.Data; const id = D.FLOORS[D.DEEP_LAST_FLOOR].enemy; return D.ENEMIES[id] ? D.ENEMIES[id].name : ''; };

  SD.UI = UI;
})();
