# EMBERWHEEL — Architecture & Module Contracts

Vanilla JS, **classic scripts** (no ES modules, so `index.html` works by double-click from `file://`).
Every file is wrapped as:
```js
(function () {
  const SD = (globalThis.SD = globalThis.SD || {});
  // ... attach to SD.X
})();
```
No external libraries. Only external resource allowed: Google Font `DotGothic16` (with system fallback).
Node (v24) is available for headless tests of pure-logic files (`js/core/*`), loaded with `require()` after `globalThis.SD = {}`.

## Folder layout
```
index.html
css/style.css
js/core/util.js        SD.Util       rng, math, helpers (pure)
js/core/data.js        SD.Data       symbols, enemies, floors, relics, events, skill tree nodes, text (pure)
js/core/engine.js      SD.Run        run + combat rules, emits event lists (pure, deterministic w/ seed)
js/core/meta.js        SD.Meta       profile, save/load, unlocks, computeMods (pure except localStorage guard)
js/art/art_core.js     SD.Art        palette + style helpers + registries (DONE — read it, use it)
js/art/heroes.js       SD.Art        registerHero('knight'|'witch'|'priest')
js/art/enemies_a.js    SD.Art        registerEnemy(...) zone 1-2 small enemies
js/art/enemies_b.js    SD.Art        registerEnemy(...) big enemies + boss
js/art/symbols.js      SD.Art        drawSymbol, drawIcon
js/art/device.js       SD.Art        drawDeviceBack/Front, drawLever, drawSparkCandle, drawDoor
js/art/backgrounds.js  SD.Art        drawBackground, drawForeground
js/audio/audio.js      SD.Audio      synthesized SFX + ambient music
js/game/*.js           integration (fx, scene, reels, ui, screens, main)
tools/*.html           standalone preview pages for art/audio (not linked from the game)
tools/sim.js           node balance simulation
```

## Stage & layout (logical 1280 × 720)
- `#stage` is a 1280×720 box scaled to fit the window (letterboxed). Canvas `#game` covers it; DOM UI overlays it.
- **Scene band**: y 0 → 440. Ground/floor line ≈ y 368. Actors are drawn with feet at:
  - priest (トト) x=175 y=372 · witch (ルゥ) x=285 y=364 · knight (ブラム) x=395 y=378 (all face RIGHT)
  - enemy feet x=930 y=376 (enemies face LEFT). Boss feet x=960 y=404 (may extend up to y≈50).
- **Device band**: y 440 → 720. Emberwheel frame centered at x=640.
  - 3 reels: each 150w × 225h (3 rows × 75), gap 18 → reels x = 397, 565, 733; y = 470..695. Payline row y = 545..620.
  - 4 reels (late game): each 126w, gap 14 → x = 367, 507, 647, 787.
  - Frame outer rect ≈ x 350..930, y 446..714. Spark candles sit on the top rim (y≈450). Lever pivot ≈ (985, 640), arm up to y≈480.

## Art contracts (all drawing in logical px; caller sets transforms)
### Heroes — `SD.Art.registerHero(id, { draw(ctx, pose, opts), info })`
- ids: `knight`, `witch`, `priest`. Origin (0,0) = feet center, facing right, body at negative y. Height ≈ 105–125px at scale 1.
- `pose`: `idle` (loop on opts.t) · `walk` (loop on opts.t) · `attack` (knight sword swing) · `cast` (witch fireball cast) ·
  `pray` (priest heal) · `block` (raise shield / brace) · `hit` (recoil) · `cheer` (jump, happy) · `manip` (hero's fate gesture:
  knight thrusts shield down = Hold; witch swirls staff = Re-spin; priest pushes with open palm = Nudge) · `dead` (collapsed).
- `opts`: `{ t: seconds (global clock, drives idle/blink), p: 0..1 progress of a one-shot pose, mood: 'normal'|'worried'|'happy' }`.
- `info`: `{ height, width, fx: [x,y] (effect origin e.g. sword tip / staff tip / censer), head: [x,y] }`.
- Flash-white on hit and ground shadows are done by the caller — do NOT draw them.

### Enemies — `SD.Art.registerEnemy(id, { draw(ctx, pose, opts), info })`
- ids: `rat` 燭ネズミ, `slime` 澱スライム, `shellback` 殻ムシ, `bellhound` 鐘つき犬 (elite), `moth` 呪い蛾, `wisp` 吸い火,
  `sentry` 骸骨衛兵 (opts.variant==='deep' → darker zone-3 recolor), `abbot` 骨の修道院長 (elite), `golem` 歯車ゴーレム,
  `shade` 影の写し身, `mimic` ミミック, `ashlord` 灰輪の主 (boss).
- Origin = feet center, facing LEFT (toward the party). Body at negative y.
- `pose`: `idle` · `windup` (charging a heavy attack — must read clearly as "danger next turn") · `attack` (lunge left, p 0..1) ·
  `cast` (hex/drain/heal/mark/jam spellcasting) · `stance` (an active defensive/special stance: shellback curl, sentry raise shield,
  shade mirror-reflect, others: brace) · `hit` (recoil, p) · `die` (p 0..1: collapse/dissolve; nearly invisible at p=1).
- `opts`: `{ t, p, enraged: bool (Dread variant: red glowing eyes + red aura), variant, phase: 1|2|3 (boss), seals: 0..3 (boss) }`.
- `info`: `{ height, width, fx: [x,y] (hit/projectile point), head: [x,y] (top, where the intent bubble goes) }`.

### Symbols & icons — `js/art/symbols.js`
- `SD.Art.drawSymbol(ctx, id, cx, cy, size, opts)` ids: `blade` 剣, `ward` 盾, `flame` 焔, `heart` 癒, `lantern` 灯, `skull` 髑髏, `wild` 星.
  `opts: { gilded, cursed (enemy-added temp skull: purple tint), t, glow: 0..1 (active/combo glow), dim: 0..1 (inactive rows) }`.
  Drawn as bold carved-and-painted glyphs readable at 40–70px. Each symbol has a unique silhouette AND color.
- `SD.Art.SYMBOL_COLORS = { blade, ward, flame, heart, lantern, skull, wild }` (hex) for UI text/particles.
- `SD.Art.drawIcon(ctx, name, cx, cy, size, opts)` names:
  `attack, heavy, charge, guard, curl, grow, hex, drain, thirst, jam, mark, reflect, heal, doom, seal, spark, ember, hp, block, burn, armor, stun, unknown, relic, chest, campfire, skull`.

### Device — `js/art/device.js`
- `SD.Art.drawDeviceBack(ctx, L, opts)` — the brass+stone body of the Emberwheel and the dark wells behind the reels.
- `SD.Art.drawDeviceFront(ctx, L, opts)` — drawn AFTER the reel contents: brass window frames, cylinder shading
  (dark top/bottom fade on each reel so it reads as a rotating drum), glowing payline window, side payline markers.
- `L = { x, y, w, h, reels: [{x,y,w,h}], rowH, paylineY, paylineH }`. `opts = { t, runes: 0..12 lit rune count on rim,
  glow: 0..1 (payline excitement), held: [bool...] (draw a brass clamp/shield-lock on held reels), jammed: [bool...] (gear wedge),
  boss: bool (corrupted ash tint) }`.
- `SD.Art.drawLever(ctx, x, y, pull 0..1, t, opts{ hover, disabled })` — pivot at (x,y), arm points up, knob = glowing ember orb.
- `SD.Art.drawSparkCandle(ctx, x, y, lit, t, opts{ flare 0..1, size })` — small candle, flame when lit.
- `SD.Art.drawDoor(ctx, kind, cx, cy, w, h, t, opts{ hover, open 0..1 })` kinds: `battle, dread, shrine, campfire, elite, boss`.

### Backgrounds — `js/art/backgrounds.js`
- `SD.Art.drawBackground(ctx, zone, opts{ t, camX, W:1280, H:440, depth: 0..1 })` zones: `cellar`, `ossuary`, `gearworks`, `abyss`, `camp`, `title`.
  Must tile seamlessly for any camX (parallax walking). Keep the actor band (y 200–390) readable.
- `SD.Art.drawForeground(ctx, zone, opts)` — sparse foreground silhouettes / vignette over the scene band.

## Audio contract — `js/audio/audio.js`
- `SD.Audio.init()` (call on first user gesture; idempotent) · `SD.Audio.play(name, opts{ pitch, vol, n })` ·
  `SD.Audio.setMusic(track)` tracks: `title, camp, cellar, ossuary, gearworks, boss, victory, none` (crossfade) ·
  `SD.Audio.setVolume({ master, music, sfx })` · `SD.Audio.duck(amount, seconds)`.
- SFX names: `spin_start, reel_tick, reel_stop (opts.n = reel index), anticipation, hold, unhold, respin, nudge, resolve,
  blade, blade_big, flame, heal, ward, lantern, skull, enemy_hit, enemy_hit_big, party_hit, block, armor_clank, burn,
  enemy_die, combo_pair, combo_triple, combo_bond, jackpot, seal_break, reaper, hex, drain, jam, mark, reflect, enemy_heal,
  windup, doom_tick, ui_hover, ui_click, ui_confirm, ui_deny, unlock, ember, spark_gain, spark_use, door, step, reward,
  relic, second_wind, death, boss_appear, boss_phase, victory, near_miss`.

## Core logic contracts
See `js/core/engine.js` header (written by the lead). The engine is pure: methods mutate run state and return arrays of
event objects `{ t: 'type', ... }` which the UI animates in order.
