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
    const trine = (ss, s) => ss.reduce((acc, arr) => acc * p(arr, s), 1);
    const anyTrine = (ss) => ['blade', 'flame', 'ward', 'heart', 'lantern'].reduce((acc, s) => acc + trine(ss, s), 0);
    const B = SD.Data.BOND_ORDER;
    const bond = (ss) => (run.mods.bond ? p(ss[0], B[0]) * p(ss[1], B[1]) * p(ss[2], B[2]) : null);
    return {
      anyBefore: anyTrine(strips), anyAfter: anyTrine(after), bondBefore: bond(strips), bondAfter: bond(after),
      sym: focus,
      before: p(strips[o.reel], focus), after: p(after[o.reel], focus),
      trineBefore: trine(strips, focus), trineAfter: trine(after, focus),
    };
  };

  UI.intentInfo = (run, it, e) => {
    if (!it) return null;
    const dmg = run.intentDamage(it);
    const I = { icon: 'attack', value: null, label: it.label || '攻撃', danger: false, sym: null, hint: null, now: null, width: 0 };
    switch (it.k) {
      case 'attack':
        I.icon = it.heavy ? 'heavy' : 'attack'; I.value = dmg; I.danger = !!it.heavy || dmg >= run.maxHp * 0.35;
        if (it.grow) I.label = (it.label || '攻撃') + '（強化）';
        if (it.doomTick) { I.icon = 'doom'; I.label = `破滅まで ${it.doomN}`; I.danger = true; }
        break;
      case 'doom': I.icon = 'doom'; I.value = dmg; I.label = it.label || '灰燼'; I.danger = true; break;
      case 'charge': I.icon = 'charge'; I.value = dmg || null; I.label = `${it.label || '溜め'} → 次は${it.nextLabel || '強撃'}`; I.danger = true; I.hint = '盾2つで怯ませて止める'; break;
      case 'guard': I.icon = 'guard'; I.value = it.v; I.label = '防御'; break;
      case 'hex': I.icon = 'hex'; I.value = it.v; I.label = it.label || '呪い'; break;
      case 'drain': I.icon = 'drain'; I.value = run.sparks > 0 ? null : it.v; I.label = run.sparks > 0 ? '火種を吸う' : '吸火（攻撃）'; break;
      case 'jam': I.icon = 'jam'; I.value = dmg || null; I.label = (it.label || '固着'); break;
      case 'heal': I.icon = 'heal'; I.value = it.v; I.label = it.label || '回復'; break;
      case 'none': I.icon = 'curl'; I.label = it.label || '構え'; break;
      default: I.icon = 'unknown'; break;
    }
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

  UI.intentExplain = (run, it) => {
    if (!it) return '';
    const dmg = run.intentDamage(it), S = (s) => UI.symName(s);
    const lines = [];
    switch (it.k) {
      case 'attack':
        lines.push(it.doomTick ? `破滅の秒読み（あと${it.doomN}）。攻撃 ${dmg}` : `${it.heavy ? '強撃' : '攻撃'}: ${dmg} ダメージ。盾で防げる`);
        if (it.grow) lines.push('攻撃のたびに強くなる');
        break;
      case 'doom': lines.push(`灰燼: ${dmg} ダメージの大技。盾を積むか、その前に倒せ`); break;
      case 'charge': lines.push('力を溜めている。次のターンに強撃'); lines.push('<b>このターン盾を2つ揃えると怯んで中断</b>'); break;
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
    return lines.join('<br>');
  };

  SD.UI = UI;
})();
