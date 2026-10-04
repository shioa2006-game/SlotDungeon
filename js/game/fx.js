/* EMBERWHEEL — game-feel layer: particles, floating numbers, banners, shake, hit-stop, flashes. */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  const A = () => SD.Art;

  const FX = {
    parts: [],
    texts: [],
    banners: [],
    rings: [],
    shakeAmt: 0,
    shakeT: 0,
    hitstop: 0,
    flashes: [],      // { color, a, decay, add }
    slashes: [],
  };

  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------------------------------------------------------------- particles
  // kind: 'spark' (additive glow dot), 'ember' (rising glow), 'chunk' (ink-outlined debris), 'smoke', 'mote' (heal), 'star'
  FX.burst = (x, y, n, opts = {}) => {
    for (let i = 0; i < n; i++) {
      const ang = opts.angle != null ? opts.angle + rnd(-1, 1) * (opts.spread || Math.PI) : rnd(0, Math.PI * 2);
      const sp = rnd(opts.speedMin || 60, opts.speed || 260);
      FX.parts.push({
        x: x + rnd(-1, 1) * (opts.jitter || 4), y: y + rnd(-1, 1) * (opts.jitter || 4),
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp + (opts.vy || 0),
        g: opts.gravity == null ? 380 : opts.gravity, drag: opts.drag == null ? 2.2 : opts.drag,
        life: rnd(opts.lifeMin || 0.35, opts.life || 0.8), t: 0,
        size: rnd(opts.sizeMin || 2, opts.size || 5), color: Array.isArray(opts.color) ? opts.color[(Math.random() * opts.color.length) | 0] : (opts.color || '#ffc15e'),
        kind: opts.kind || 'spark', rot: rnd(0, 6.28), vr: rnd(-8, 8),
      });
    }
  };

  // Particles flying from (x,y) to a target (tx,ty) along a curve, then calling onArrive once per particle.
  FX.stream = (x, y, tx, ty, n, opts = {}) => {
    for (let i = 0; i < n; i++) {
      FX.parts.push({
        x, y, sx: x + rnd(-30, 30), sy: y + rnd(-30, 30), tx, ty,
        cx: (x + tx) / 2 + rnd(-140, 140), cy: Math.min(y, ty) - rnd(40, 180),
        life: rnd(0.55, 0.9) + i * (opts.stagger || 0.03), t: -i * (opts.stagger || 0.03), kind: 'seek',
        size: rnd(3, 5.5), color: opts.color || '#ffc15e', onArrive: opts.onArrive,
      });
    }
  };

  FX.text = (x, y, str, opts = {}) => {
    FX.texts.push({ x, y, str: String(str), t: 0, life: opts.life || 0.95, color: opts.color || '#ffffff',
      size: opts.size || 34, vy: opts.vy == null ? -70 : opts.vy, pop: opts.pop == null ? 1 : opts.pop, sub: opts.sub || null,
      subColor: opts.subColor || '#efe5cf', stroke: opts.stroke || '#1a1222' });
  };

  FX.banner = (str, opts = {}) => {
    for (const o of FX.banners) o.t = Math.max(o.t, o.life * 0.8);
    FX.banners.push({ str, sub: opts.sub || '', t: 0, life: opts.life || 1.1, color: opts.color || '#ffd257',
      y: opts.y || 210, size: opts.size || 64, glow: opts.glow || 'rgba(255,190,80,0.6)' });
  };

  FX.ring = (x, y, opts = {}) => {
    FX.rings.push({ x, y, t: 0, life: opts.life || 0.5, r0: opts.r0 || 10, r1: opts.r1 || 120, color: opts.color || '#ffd257', width: opts.width || 6 });
  };

  FX.slash = (x, y, opts = {}) => {
    FX.slashes.push({ x, y, t: 0, life: opts.life || 0.28, len: opts.len || 160, ang: opts.ang == null ? -0.6 : opts.ang, color: opts.color || '#ffffff', width: opts.width || 10 });
  };

  FX.shake = (amt) => { FX.shakeAmt = Math.min(14, Math.max(FX.shakeAmt, amt)); FX.shakeT = 0; };
  FX.stop = (ms) => { FX.hitstop = Math.max(FX.hitstop, ms / 1000); };
  FX.flash = (color, a = 0.6, decay = 3, add = true) => { FX.flashes.push({ color, a, decay, add }); };

  FX.clear = () => { FX.parts.length = 0; FX.texts.length = 0; FX.banners.length = 0; FX.rings.length = 0; FX.flashes.length = 0; FX.slashes.length = 0; };

  FX.update = (dt) => {
    for (let i = FX.parts.length - 1; i >= 0; i--) {
      const p = FX.parts[i];
      p.t += dt;
      if (p.kind === 'seek') {
        if (p.t >= p.life) { if (p.onArrive) p.onArrive(); FX.parts.splice(i, 1); continue; }
        continue;
      }
      if (p.t >= p.life) { FX.parts.splice(i, 1); continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k + p.g * dt;
      if (p.kind === 'ember' || p.kind === 'mote') p.vy -= (p.kind === 'mote' ? 260 : 320) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
    for (let i = FX.texts.length - 1; i >= 0; i--) { const t = FX.texts[i]; t.t += dt; t.y += t.vy * dt * Math.max(0, 1 - t.t / t.life); if (t.t >= t.life) FX.texts.splice(i, 1); }
    for (let i = FX.banners.length - 1; i >= 0; i--) { const b = FX.banners[i]; b.t += dt; if (b.t >= b.life) FX.banners.splice(i, 1); }
    for (let i = FX.rings.length - 1; i >= 0; i--) { const r = FX.rings[i]; r.t += dt; if (r.t >= r.life) FX.rings.splice(i, 1); }
    for (let i = FX.slashes.length - 1; i >= 0; i--) { const s = FX.slashes[i]; s.t += dt; if (s.t >= s.life) FX.slashes.splice(i, 1); }
    for (let i = FX.flashes.length - 1; i >= 0; i--) { const f = FX.flashes[i]; f.a -= f.decay * dt; if (f.a <= 0) FX.flashes.splice(i, 1); }
    FX.shakeT += dt;
    FX.shakeAmt = Math.max(0, FX.shakeAmt - dt * 40);
  };

  FX.shakeOffset = () => {
    if (FX.shakeAmt <= 0.05) return [0, 0];
    const a = FX.shakeAmt;
    return [Math.sin(FX.shakeT * 83) * a * 0.7 + rnd(-1, 1) * a * 0.3, Math.cos(FX.shakeT * 71) * a * 0.6 + rnd(-1, 1) * a * 0.3];
  };

  const bez = (a, b, c, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;

  FX.draw = (ctx) => {
    const Art = A();
    // rings
    for (const r of FX.rings) {
      const k = r.t / r.life, rr = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 3));
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = r.color; ctx.lineWidth = r.width * (1 - k * 0.7);
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath(); ctx.arc(r.x, r.y, rr, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    // slashes: crescent sweeps
    for (const s of FX.slashes) {
      const k = s.t / s.life;
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.ang);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - k;
      const L = s.len, w = s.width * (1 - k * 0.5), sweep = Math.min(1, k * 3.5);
      ctx.beginPath();
      ctx.moveTo(-L / 2, 0);
      ctx.quadraticCurveTo(0, -w * 2.2, -L / 2 + L * sweep, 0);
      ctx.quadraticCurveTo(0, -w * 0.6, -L / 2, 0);
      ctx.fillStyle = s.color; ctx.fill();
      ctx.restore();
    }
    // particles
    for (const p of FX.parts) {
      let x = p.x, y = p.y, a = 1;
      if (p.kind === 'seek') {
        if (p.t < 0) continue;
        const k = Math.min(1, p.t / p.life), e = k * k * (3 - 2 * k);
        x = bez(p.sx, p.cx, p.tx, e); y = bez(p.sy, p.cy, p.ty, e);
        Art && Art.glow(ctx, x, y, p.size * 3.2, p.color, 0.8);
        ctx.fillStyle = '#fff6d8'; ctx.beginPath(); ctx.arc(x, y, p.size * 0.6, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      a = 1 - p.t / p.life;
      if (p.kind === 'chunk') {
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.globalAlpha = Math.min(1, a * 2);
        ctx.fillStyle = p.color; ctx.strokeStyle = '#1a1222'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-p.size, -p.size * 0.6); ctx.lineTo(p.size, -p.size * 0.3); ctx.lineTo(p.size * 0.4, p.size); ctx.closePath();
        ctx.fill(); ctx.stroke(); ctx.restore();
      } else if (p.kind === 'smoke') {
        ctx.save(); ctx.globalAlpha = a * 0.35; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(x, y, p.size * (1 + (1 - a) * 2.5), 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else if (p.kind === 'star') {
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = p.color; const s = p.size;
        ctx.beginPath(); ctx.moveTo(0, -s * 1.6); ctx.lineTo(s * 0.35, -s * 0.35); ctx.lineTo(s * 1.6, 0); ctx.lineTo(s * 0.35, s * 0.35);
        ctx.lineTo(0, s * 1.6); ctx.lineTo(-s * 0.35, s * 0.35); ctx.lineTo(-s * 1.6, 0); ctx.lineTo(-s * 0.35, -s * 0.35); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter';
        if (Art) Art.glow(ctx, x, y, p.size * 2.6, p.color, 0.55);
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    // floating numbers
    for (const t of FX.texts) {
      const k = t.t / t.life;
      const pop = t.pop ? (k < 0.12 ? 0.6 + (k / 0.12) * 0.7 : k < 0.24 ? 1.3 - ((k - 0.12) / 0.12) * 0.3 : 1) : 1;
      const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(t.x, t.y); ctx.scale(pop, pop);
      ctx.font = `900 ${t.size}px ${SD.Game ? SD.Game.fontNum : 'sans-serif'}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(4, t.size * 0.18); ctx.strokeStyle = t.stroke;
      ctx.strokeText(t.str, 0, 0); ctx.fillStyle = t.color; ctx.fillText(t.str, 0, 0);
      if (t.sub) {
        ctx.font = `700 ${Math.round(t.size * 0.42)}px ${SD.Game ? SD.Game.fontUI : 'sans-serif'}`;
        ctx.lineWidth = 4; ctx.strokeText(t.sub, 0, t.size * 0.68); ctx.fillStyle = t.subColor; ctx.fillText(t.sub, 0, t.size * 0.68);
      }
      ctx.restore();
    }
  };

  // Banners and flashes are drawn over everything (screen space).
  FX.drawOverlay = (ctx, W, H) => {
    for (const f of FX.flashes) {
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, f.a));
      if (f.add) ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = f.color; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    for (const b of FX.banners) {
      const k = b.t / b.life;
      const inK = Math.min(1, k / 0.14), outK = k > 0.78 ? (k - 0.78) / 0.22 : 0;
      const sx = 1 + (1 - SD.Art.easeOutBack(inK)) * 0.6;
      const a = Math.min(1, inK * 1.4) * (1 - outK);
      ctx.save();
      ctx.globalAlpha = a;
      // ribbon behind
      const rw = 760, rh = b.size * (b.sub ? 1.7 : 1.25);
      ctx.translate(W / 2, b.y);
      ctx.fillStyle = 'rgba(13,11,22,0.72)';
      ctx.beginPath();
      ctx.moveTo(-rw / 2 * (0.6 + 0.4 * inK), -rh / 2); ctx.lineTo(rw / 2 * (0.6 + 0.4 * inK), -rh / 2);
      ctx.lineTo(rw / 2 * (0.6 + 0.4 * inK) - 30, 0); ctx.lineTo(rw / 2 * (0.6 + 0.4 * inK), rh / 2);
      ctx.lineTo(-rw / 2 * (0.6 + 0.4 * inK), rh / 2); ctx.lineTo(-rw / 2 * (0.6 + 0.4 * inK) + 30, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = b.color; ctx.lineWidth = 2; ctx.globalAlpha = a * 0.7; ctx.stroke(); ctx.globalAlpha = a;
      SD.Art.glow(ctx, 0, 0, 260, b.glow, 0.5 * a);
      ctx.scale(sx, 1 / Math.max(0.6, sx * 0.9));
      ctx.font = `900 ${b.size}px ${SD.Game ? SD.Game.fontTitle : 'serif'}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = 9; ctx.strokeStyle = '#1a1222';
      const ty = b.sub ? -b.size * 0.18 : 0;
      ctx.strokeText(b.str, 0, ty); ctx.fillStyle = b.color; ctx.fillText(b.str, 0, ty);
      if (b.sub) {
        ctx.font = `700 ${Math.round(b.size * 0.34)}px ${SD.Game ? SD.Game.fontUI : 'sans-serif'}`;
        ctx.lineWidth = 5; ctx.strokeText(b.sub, 0, b.size * 0.48); ctx.fillStyle = '#efe5cf'; ctx.fillText(b.sub, 0, b.size * 0.48);
      }
      ctx.restore();
    }
  };

  SD.FX = FX;
})();
