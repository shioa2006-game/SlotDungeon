/* EMBERWHEEL — pure utilities (shared by browser + node sim). */
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});

  // mulberry32 seeded PRNG. Returns object with next() in [0,1).
  function makeRng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    const rng = {
      seed: a,
      next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      int(n) { return Math.floor(rng.next() * n); },          // 0..n-1
      range(lo, hi) { return lo + Math.floor(rng.next() * (hi - lo + 1)); }, // inclusive
      chance(p) { return rng.next() < p; },
      pick(arr) { return arr[Math.floor(rng.next() * arr.length)]; },
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(rng.next() * (i + 1));
          const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        return arr;
      },
      weighted(items, weightFn) {
        let total = 0;
        for (const it of items) total += Math.max(0, weightFn(it));
        if (total <= 0) return items[0];
        let r = rng.next() * total;
        for (const it of items) { r -= Math.max(0, weightFn(it)); if (r < 0) return it; }
        return items[items.length - 1];
      },
      state() { return a; },
      setState(s) { a = s >>> 0; },
    };
    return rng;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const mod = (n, m) => ((n % m) + m) % m;
  const deepClone = (o) => JSON.parse(JSON.stringify(o));
  const sum = (arr) => arr.reduce((s, x) => s + x, 0);

  SD.Util = { makeRng, clamp, lerp, mod, deepClone, sum };
})();
