/* EMBERWHEEL — the Emberwheel view: reel drums, spin animation, strip ribbons, spark candles, lever, hit-testing. */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});

  const L3 = {
    x: 350, y: 446, w: 580, h: 268, rowH: 75, paylineY: 545, paylineH: 75,
    reels: [397, 565, 733].map((x) => ({ x, y: 470, w: 150, h: 225 })),
  };
  const LEVER = { x: 985, y: 640 };
  const SYM = 58;

  const mod = (n, m) => ((n % m) + m) % m;
  const easeOutBackS = (t, s) => { t = Math.max(0, Math.min(1, t)); const c3 = s + 1; return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };

  class ReelView {
    constructor() {
      this.L = L3;
      this.disp = [];      // per reel: { p, anim, vel }
      this.lever = { pull: 0, target: 0, hover: false };
      this.candleFlare = [];
      this.glowCells = null; // { reels:[i...], t, color }
      this.paylineGlow = 0;
      this.sweep = 0;
      this.hover = null;    // { kind:'cell', reel, row } | { kind:'ribbon', reel, index } | { kind:'lever' }
      this.flashReel = [0, 0, 0];
      this.anticipation = -1;
      this.time = 0;
    }

    sync(run) {
      this.run = run;
      this.disp = run.reels.map((r, i) => ({ p: r.pos, anim: null, vel: 0, last: r.pos, len: r.strip.length }));
    }

    // keep display aligned with strips that changed length (curses/carvings)
    _fix(i) {
      const r = this.run.reels[i], d = this.disp[i];
      if (!d) return;
      if (d.len !== r.strip.length && !d.anim) { d.p = r.pos; d.len = r.strip.length; }
    }

    busy() { return this.disp.some((d) => d.anim); }

    // Animate a spin. stops = engine positions, spun = which reels move. Returns a Promise.
    spin(stops, spun, opts = {}) {
      const speed = opts.speedMul || 1;
      const base = opts.respin ? [0.32, 0.42, 0.52] : [0.45, 0.6, 0.75];
      const proms = [];
      let order = 0;
      for (let i = 0; i < this.disp.length; i++) {
        const d = this.disp[i], r = this.run.reels[i];
        d.len = r.strip.length;
        if (!spun[i]) continue;
        const n = r.strip.length;
        let dur = base[Math.min(order, base.length - 1)] * speed;
        order++;
        const antic = opts.anticipation === i;
        if (antic) dur += 0.65 * speed;
        const laps = Math.max(2, Math.round((32 * dur) / n));
        const from = d.p;
        const dist = mod(from - stops[i], n) + laps * n;
        proms.push(new Promise((res) => {
          d.anim = { type: 'spin', from, dist, t: 0, dur, antic, done: res, n, reel: i };
        }));
      }
      if (opts.anticipation != null && opts.anticipation >= 0) this.anticipation = opts.anticipation;
      return Promise.all(proms).then(() => { this.anticipation = -1; });
    }

    nudge(i, dir, dur = 0.2) {
      const d = this.disp[i];
      const to = d.p + dir;
      return new Promise((res) => { d.anim = { type: 'nudge', from: d.p, to, t: 0, dur, done: res }; });
    }

    snapTo(i, pos) { const d = this.disp[i]; d.anim = null; d.p = pos; d.len = this.run.reels[i].strip.length; }

    update(dt) {
      this.time += dt;
      for (let i = 0; i < this.disp.length; i++) {
        const d = this.disp[i];
        const before = d.p;
        if (d.anim) {
          const a = d.anim;
          a.t += dt;
          const k = Math.min(1, a.t / a.dur);
          if (a.type === 'spin') {
            // long cruise, then a weighty landing with a small overshoot
            const e = a.antic ? (k < 0.55 ? (k / 0.55) * 0.86 : 0.86 + (easeOutBackS((k - 0.55) / 0.45, 0.6)) * 0.14)
              : easeOutBackS(k, 0.85);
            d.p = a.from - a.dist * e;
            if (k >= 1) {
              d.p = mod(Math.round(d.p), a.n);
              d.anim = null;
              this.flashReel[i] = 1;
              if (SD.Audio) SD.Audio.play(a.antic ? 'reel_stop' : 'reel_stop', { n: i });
              if (SD.FX) SD.FX.shake(a.antic ? 3 : 1.2);
              a.done();
            } else if (SD.Audio && Math.floor(before) !== Math.floor(d.p) && k < 0.85) {
              SD.Audio.play('reel_tick', { vol: 0.35 });
            }
          } else if (a.type === 'nudge') {
            d.p = a.from + (a.to - a.from) * easeOutBackS(k, 1.4);
            if (k >= 1) { d.p = mod(Math.round(a.to), this.run.reels[i].strip.length); d.anim = null; a.done(); }
          }
        }
        d.vel = dt > 0 ? Math.abs(d.p - before) / dt : 0;
        this.flashReel[i] = Math.max(0, this.flashReel[i] - dt * 4);
        this._fix(i);
      }
      this.lever.pull += (this.lever.target - this.lever.pull) * Math.min(1, dt * 18);
      for (let i = 0; i < this.candleFlare.length; i++) this.candleFlare[i] = Math.max(0, (this.candleFlare[i] || 0) - dt * 2.5);
      this.paylineGlow = Math.max(0, this.paylineGlow - dt * 1.2);
      this.sweep = Math.max(0, this.sweep - dt * 1.6);
      if (this.glowCells) { this.glowCells.t += dt; if (this.glowCells.t > this.glowCells.life) this.glowCells = null; }
    }

    // ---------------------------------------------------------------- hit testing
    hit(x, y) {
      const L = this.L;
      for (let i = 0; i < L.reels.length; i++) {
        const R = L.reels[i];
        if (x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h) {
          const row = y < L.paylineY ? -1 : y < L.paylineY + L.paylineH ? 0 : 1;
          return { kind: 'cell', reel: i, row };
        }
        // ribbon
        const rb = this.ribbonRect(i);
        if (rb && x >= rb.x - 2 && x < rb.x + rb.w + 2 && y >= rb.y && y < rb.y + rb.h) {
          const n = this.run.reels[i].strip.length;
          const idx = Math.floor((y - rb.y) / rb.cell);
          if (idx >= 0 && idx < n) return { kind: 'ribbon', reel: i, index: idx };
        }
      }
      if (Math.hypot(x - LEVER.x, y - (LEVER.y - 70)) < 95 && x > LEVER.x - 45) return { kind: 'lever' };
      return null;
    }

    ribbonRect(i) {
      if (!this.run) return null;
      const R = this.L.reels[i], n = this.run.reels[i].strip.length;
      const cell = Math.min(16, Math.floor(R.h / n));
      const h = cell * n;
      return { x: R.x + R.w + 2, y: R.y + (R.h - h) / 2, w: 14, h, cell };
    }

    // ---------------------------------------------------------------- drawing
    draw(ctx, st) {
      const Art = SD.Art, L = this.L, run = this.run;
      if (!run) return;
      const t = this.time;
      const held = run.reels.map((r) => r.held), jammed = run.reels.map((r) => r.jam);
      if (Art.drawDeviceBack) Art.drawDeviceBack(ctx, L, { t, runes: st.runes || 0, glow: this.paylineGlow, held, jammed, boss: !!st.boss });
      for (let i = 0; i < run.reels.length; i++) this._drawReel(ctx, i, st);
      if (Art.drawDeviceFront) Art.drawDeviceFront(ctx, L, { t, runes: st.runes || 0, glow: Math.max(this.paylineGlow, st.decision ? 0.25 : 0), held, jammed, boss: !!st.boss });
      // combo light sweep across the payline
      if (this.sweep > 0) {
        const k = 1 - this.sweep, x0 = L.reels[0].x, x1 = L.reels[L.reels.length - 1].x + L.reels[L.reels.length - 1].w;
        const bx = x0 - 80 + (x1 - x0 + 160) * k;
        ctx.save();
        ctx.beginPath(); for (const R of L.reels) ctx.rect(R.x, L.paylineY, R.w, L.paylineH); ctx.clip();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(bx - 70, 0, bx + 70, 0);
        g.addColorStop(0, 'rgba(255,230,160,0)'); g.addColorStop(0.5, `rgba(255,240,200,${0.75 * this.sweep + 0.2})`); g.addColorStop(1, 'rgba(255,230,160,0)');
        ctx.fillStyle = g; ctx.fillRect(bx - 70, L.paylineY, 140, L.paylineH);
        ctx.restore();
      }
      // overlays on top of the glass
      for (let i = 0; i < run.reels.length; i++) this._drawOverlay(ctx, i, st);
      for (let i = 0; i < run.reels.length; i++) this._drawRibbon(ctx, i, st);
      this._drawCandles(ctx, st);
      if (Art.drawLever) Art.drawLever(ctx, LEVER.x, LEVER.y, this.lever.pull, t, { hover: this.hover && this.hover.kind === 'lever' && st.leverActive, disabled: !st.leverActive });
    }

    _drawReel(ctx, i, st) {
      const Art = SD.Art, L = this.L, R = L.reels[i], run = this.run;
      const r = run.reels[i], d = this.disp[i];
      const n = r.strip.length;
      ctx.save();
      ctx.beginPath(); ctx.rect(R.x, R.y, R.w, R.h); ctx.clip();
      // drum face: warm bone stone with flat banded shading
      ctx.fillStyle = st.boss ? '#cfc6bd' : '#e8dcc0';
      ctx.fillRect(R.x, R.y, R.w, R.h);
      const bands = [[0, 0.12, 0.5], [0.12, 0.26, 0.28], [0.26, 0.33, 0.1], [0.67, 0.74, 0.1], [0.74, 0.88, 0.28], [0.88, 1, 0.5]];
      for (const [a, b, al] of bands) { ctx.fillStyle = `rgba(40,26,40,${al})`; ctx.fillRect(R.x, R.y + R.h * a, R.w, R.h * (b - a) + 0.5); }
      // vertical edge shading (drum roundness sideways)
      ctx.fillStyle = 'rgba(40,26,40,0.18)'; ctx.fillRect(R.x, R.y, 10, R.h); ctx.fillRect(R.x + R.w - 10, R.y, 10, R.h);
      if (this.anticipation === i && d.anim) {
        const pulse = 0.35 + 0.25 * Math.sin(this.time * 30);
        ctx.fillStyle = `rgba(255,200,90,${pulse})`; ctx.fillRect(R.x, R.y, R.w, R.h);
      }
      const p = d.p, base = Math.floor(p), frac = p - base;
      const cx = R.x + R.w / 2, cy0 = L.paylineY + L.paylineH / 2;
      const blur = Math.min(1, d.vel / 26);
      const fc = st.forecast;
      for (let k = -2; k <= 2; k++) {
        const idx = mod(base + k, n);
        const c = r.strip[idx];
        const y = cy0 + (k - frac) * L.rowH;
        if (y < R.y - 40 || y > R.y + R.h + 40) continue;
        const onLine = Math.abs(y - cy0) < L.rowH * 0.5;
        let cellObj = c;
        if (onLine && r.echo && !d.anim) cellObj = r.echo;
        const opts = { gilded: cellObj.g, cursed: cellObj.temp && cellObj.s === 'skull', t: this.time,
          dim: d.anim ? 0 : (onLine ? 0 : 0.35), glow: 0 };
        if (onLine && !d.anim && st.comboCells && st.comboCells[i]) opts.glow = 0.6 + 0.4 * Math.sin(this.time * 10);
        if (blur > 0.15) {
          ctx.save();
          ctx.globalAlpha = 0.45;
          for (const off of [-1, 1]) Art.drawSymbol(ctx, cellObj.s, cx, y + off * blur * 22, SYM, opts);
          ctx.restore();
          ctx.save(); ctx.translate(cx, y); ctx.scale(1, 1 + blur * 0.35); ctx.globalAlpha = 0.75;
          Art.drawSymbol(ctx, cellObj.s, 0, 0, SYM, opts); ctx.restore();
        } else {
          Art.drawSymbol(ctx, cellObj.s, cx, y, SYM, opts);
        }
        if (onLine && r.echo && !d.anim) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(197,139,255,0.22)';
          ctx.fillRect(R.x, L.paylineY, R.w, L.paylineH); ctx.restore();
        }
        // wild shows what it became
        if (onLine && !d.anim && cellObj.s === 'wild' && fc && fc.wildAs) {
          ctx.save(); ctx.globalAlpha = 0.9; Art.drawSymbol(ctx, fc.wildAs, R.x + R.w - 20, L.paylineY + 18, 22, {}); ctx.restore();
        }
      }
      // marked symbol: chains / dim
      if (st.marked && !d.anim) {
        const c = run.paylineCell(i);
        if (c.s === st.marked) {
          ctx.save(); ctx.fillStyle = 'rgba(80,40,110,0.45)'; ctx.fillRect(R.x, L.paylineY, R.w, L.paylineH);
          ctx.strokeStyle = 'rgba(200,160,255,0.85)'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(R.x + 20, L.paylineY + 12); ctx.lineTo(R.x + R.w - 20, L.paylineY + L.paylineH - 12);
          ctx.moveTo(R.x + R.w - 20, L.paylineY + 12); ctx.lineTo(R.x + 20, L.paylineY + L.paylineH - 12); ctx.stroke();
          ctx.restore();
        }
      }
      if (this.flashReel[i] > 0) { ctx.fillStyle = `rgba(255,240,200,${this.flashReel[i] * 0.35})`; ctx.fillRect(R.x, L.paylineY, R.w, L.paylineH); }
      ctx.restore();
    }

    _drawOverlay(ctx, i, st) {
      const L = this.L, R = L.reels[i], run = this.run, d = this.disp[i];
      if (d.anim) return;
      const t = this.time;
      // near-miss glow cells
      if (st.nearMiss) {
        for (const nm of st.nearMiss) {
          if (nm.reel !== i || Math.abs(nm.dir) !== 1) continue;
          const y = nm.dir < 0 ? R.y : L.paylineY + L.paylineH;
          const pulse = 0.55 + 0.45 * Math.sin(t * 6);
          ctx.save();
          ctx.strokeStyle = `rgba(255,214,110,${0.5 + pulse * 0.5})`; ctx.lineWidth = 4;
          SD.Art.roundRectPath(ctx, R.x + 5, y + 4, R.w - 10, L.rowH - 8, 10); ctx.stroke();
          SD.Art.glow(ctx, R.x + R.w / 2, y + L.rowH / 2, 70, 'rgba(255,200,90,0.5)', pulse * 0.6);
          // arrow toward the payline
          ctx.fillStyle = `rgba(255,230,160,${0.6 + pulse * 0.4})`;
          const ax = R.x + 16, ay = nm.dir < 0 ? y + L.rowH - 10 : y + 10, s = nm.dir < 0 ? 1 : -1;
          ctx.beginPath(); ctx.moveTo(ax - 8, ay - 6 * s); ctx.lineTo(ax + 8, ay - 6 * s); ctx.lineTo(ax, ay + 6 * s); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }
      // hover ghost
      const h = this.hover;
      if (h && h.reel === i && st.decision) {
        if (h.kind === 'cell' && h.row !== 0 && st.canNudge && st.canNudge(i, h.row)) {
          const y = h.row < 0 ? R.y : L.paylineY + L.paylineH;
          ctx.save(); ctx.fillStyle = 'rgba(125,240,180,0.18)'; ctx.fillRect(R.x, y, R.w, L.rowH);
          ctx.strokeStyle = 'rgba(125,240,180,0.9)'; ctx.lineWidth = 3; SD.Art.roundRectPath(ctx, R.x + 4, y + 3, R.w - 8, L.rowH - 6, 10); ctx.stroke();
          ctx.restore();
        }
        if (h.kind === 'cell' && h.row === 0 && st.canHold && st.canHold(i)) {
          ctx.save(); ctx.strokeStyle = 'rgba(232,191,106,0.95)'; ctx.lineWidth = 3;
          SD.Art.roundRectPath(ctx, R.x + 4, L.paylineY + 3, R.w - 8, L.paylineH - 6, 10); ctx.stroke(); ctx.restore();
        }
      }
      // held label
      if (run.reels[i].held) {
        ctx.save();
        ctx.font = `700 15px ${SD.Game.fontUI}`; ctx.textAlign = 'center';
        const label = run.reels[i].carried ? '継' : '留';
        const bx = R.x + R.w / 2, by = R.y + R.h - 14;
        ctx.fillStyle = 'rgba(26,18,34,0.85)'; SD.Art.roundRectPath(ctx, bx - 22, by - 13, 44, 22, 8); ctx.fill();
        ctx.strokeStyle = '#e8bf6a'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#ffe1a0'; ctx.fillText(label, bx, by + 4);
        ctx.restore();
      }
      // bless badge on payline skulls
      if (st.canBless && st.canBless(i)) {
        const bx = R.x + R.w - 22, by = L.paylineY + 20, pulse = 0.6 + 0.4 * Math.sin(t * 5);
        ctx.save(); SD.Art.glow(ctx, bx, by, 26, 'rgba(125,240,180,0.6)', pulse);
        ctx.fillStyle = '#1a1222'; ctx.beginPath(); ctx.arc(bx, by, 14, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#7df0b4'; ctx.lineWidth = 2; ctx.stroke();
        ctx.font = `700 15px ${SD.Game.fontUI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#7df0b4';
        ctx.fillText('祝', bx, by + 1); ctx.restore();
      }
      // mode targets (echo / key)
      if (st.mode && st.mode.kind === 'echo') {
        const sel = st.mode.src;
        ctx.save();
        if (sel == null || sel === i) {
          ctx.strokeStyle = sel === i ? '#c58bff' : 'rgba(197,139,255,0.7)'; ctx.lineWidth = sel === i ? 5 : 3;
        } else ctx.strokeStyle = 'rgba(197,139,255,0.95)', ctx.lineWidth = 3, ctx.setLineDash([8, 6]);
        SD.Art.roundRectPath(ctx, R.x + 3, L.paylineY + 2, R.w - 6, L.paylineH - 4, 10); ctx.stroke(); ctx.restore();
      }
    }

    _drawRibbon(ctx, i, st) {
      const rb = this.ribbonRect(i), run = this.run, r = run.reels[i], d = this.disp[i];
      const n = r.strip.length;
      ctx.save();
      ctx.fillStyle = 'rgba(20,14,30,0.92)';
      SD.Art.roundRectPath(ctx, rb.x - 1, rb.y - 3, rb.w + 2, rb.h + 6, 4); ctx.fill();
      for (let k = 0; k < n; k++) {
        const c = r.strip[k];
        const y = rb.y + k * rb.cell + rb.cell / 2;
        SD.Art.drawSymbol(ctx, c.s, rb.x + rb.w / 2, y, rb.cell + 2, { gilded: c.g, cursed: c.temp && c.s === 'skull' });
      }
      // window bracket (3 visible cells)
      if (!d.anim) {
        const pos = r.pos;
        ctx.strokeStyle = '#e8bf6a'; ctx.lineWidth = 2;
        for (const off of [-1, 0, 1]) {
          const k = mod(pos + off, n);
          const y = rb.y + k * rb.cell;
          if (off === 0) { ctx.fillStyle = 'rgba(255,210,120,0.28)'; ctx.fillRect(rb.x - 1, y, rb.w + 2, rb.cell); }
        }
        const k0 = mod(pos - 1, n);
        // bracket drawn as segments (it may wrap)
        const segs = [];
        for (const off of [-1, 0, 1]) segs.push(mod(pos + off, n));
        ctx.beginPath();
        for (const k of segs) { const y = rb.y + k * rb.cell; ctx.moveTo(rb.x - 2, y); ctx.lineTo(rb.x - 2, y + rb.cell); ctx.moveTo(rb.x + rb.w + 2, y); ctx.lineTo(rb.x + rb.w + 2, y + rb.cell); }
        ctx.stroke();
        void k0;
      }
      // ribbon interaction highlights (long push / fate key)
      const h = this.hover;
      if (h && h.kind === 'ribbon' && h.reel === i && st.ribbonActive && st.ribbonActive(i, h.index)) {
        const y = rb.y + h.index * rb.cell;
        ctx.strokeStyle = '#7df0b4'; ctx.lineWidth = 2; ctx.strokeRect(rb.x - 3, y - 1, rb.w + 6, rb.cell + 2);
      }
      if (st.mode && st.mode.kind === 'key') {
        ctx.strokeStyle = `rgba(255,214,110,${0.5 + 0.4 * Math.sin(this.time * 6)})`; ctx.lineWidth = 2;
        ctx.strokeRect(rb.x - 3, rb.y - 4, rb.w + 6, rb.h + 8);
      }
      ctx.restore();
    }

    candlePos(k, total) {
      const sp = 36;
      return { x: 628 - ((total - 1) * sp) / 2 + k * sp, y: 450 };
    }

    _drawCandles(ctx, st) {
      const run = this.run;
      if (!run.mods.sparks) return;
      const max = run.maxSparks, cur = st.sparks != null ? st.sparks : run.sparks;
      const pend = Math.min(cur, st.pendingCost || 0);
      // a little brass shelf so the currency never reads as background decor
      const p0 = this.candlePos(0, max), p1 = this.candlePos(max - 1, max);
      ctx.save();
      SD.Art.roundRectPath(ctx, p0.x - 24, 438, p1.x - p0.x + 92, 16, 6);
      ctx.fillStyle = '#3a2614'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1a1222'; ctx.stroke();
      ctx.fillStyle = 'rgba(232,191,106,0.6)'; ctx.fillRect(p0.x - 20, 440, p1.x - p0.x + 84, 2);
      ctx.restore();
      for (let k = 0; k < max; k++) {
        const p = this.candlePos(k, max);
        const lit = k < cur;
        const spending = lit && k >= cur - pend;
        ctx.save();
        if (spending) ctx.globalAlpha = 0.45 + 0.35 * Math.sin(this.time * 14);
        if (SD.Art.drawSparkCandle) SD.Art.drawSparkCandle(ctx, p.x, p.y, lit, this.time + k * 0.37, { flare: this.candleFlare[k] || 0, size: 34 });
        ctx.restore();
      }
      SD.StageDraw.numText(ctx, `${cur}/${max}`, p1.x + 40, 444, 15, cur ? '#ffe1a0' : '#a08a9a');
    }

    flareCandle(k) { this.candleFlare[k] = 1; }

    cellCenter(i, row = 0) {
      const R = this.L.reels[i];
      return { x: R.x + R.w / 2, y: this.L.paylineY + this.L.paylineH / 2 + row * this.L.rowH };
    }
  }

  SD.ReelView = ReelView;
  SD.REEL_LAYOUT = L3;
  SD.LEVER_POS = LEVER;
})();
