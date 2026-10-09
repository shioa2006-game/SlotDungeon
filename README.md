# EMBERWHEEL ― 灯輪と深淵

三人の小さな探索者が運命装置「灯輪（ともしわ）」を回して深淵へ挑む、Run型インクリメンタル・スロット・ダンジョンRPG。
最初は祈るだけのスロットを、灯紋（スキルツリー）で「ずらし・留め・再演・写し身・運命の鍵」へと育て、
最後には自分で運命を組み立てる。

## 起動
- `index.html` をブラウザ（Chrome / Edge 推奨）で直接開くだけで遊べます（ビルド不要・依存なし）。
- ローカルサーバーで開く場合: `node tools/serve.js` → http://localhost:8080
- フォントは Google Fonts を使用（オフラインでもシステムフォントで動作）。

## 操作
| 操作 | 内容 |
|---|---|
| Space / レバー | 回す・発動 |
| 上下の段のマスをクリック | ずらし（灯紋【押し手】） |
| 発動列のマスをクリック / 1・2・3 | 留め（灯紋【再演と留め】） |
| R | 再演 |
| E / K | 写し身 / 運命の鍵（終盤の灯紋） |
| S | 台本送り（灯紋【拍子木】）: 敵の台本を1コマ送る |
| B | 灰輪に借りる（灯紋【借り火】）: 火種0のとき1戦1回 |
| Shift 長押し | 早送り |
| 敵にカーソル | 敵の特徴と次の行動の説明（台本の小札にも説明が出る） |

進行は自動保存（localStorage）。右下の ⚙ から音量・演出速度・進行リセット。

## 構成
- `js/core/` ゲームロジック（純粋・Nodeで実行可能）: `data.js` 数値と内容 / `engine.js` 戦闘とRun / `meta.js` 恒久成長と保存
- `js/art/` 手続き描画のアート（画像ファイル不使用） / `js/audio/` Web Audio 合成サウンド
- `js/game/` 演出・UI・画面
- `docs/GDD.md` 企画書、`docs/ARCH.md` モジュール契約
- `tools/sim.js` バランスシミュレーション（`node tools/sim.js campaign balanced 10`、`metrics balanced 20`、`script 150`、初クリア後〜全成長の基準値 `baseline balanced 40`、灰の底の敵とキットの相性 `deep 150`、入り口の比較 `entry 30`・`ENTRY=b9 baseline balanced 20` など）、`tools/fuzz.js` エンジンの不変条件テスト、`tools/test_script.js` 灰輪の台本・借り火のユニット／回帰（初期版との並走比較）／ボス試験
- `docs/PHASE2_ALITE_IMPLEMENTATION.md` Phase 2（灰輪の台本＋残り火の一手）の実装記録
- `docs/EXPANSION_BASELINE.md` 初クリア後の拡張に向けた段階0の決定と基準値
- `docs/EXPANSION_STAGE2_OPTIONS.md` 拡張の案の比較と決定（案A：灰輪の主の先へ降りる）
- `docs/EXPANSION_3A_SPEC.md` 段階3a「灰の底」（B13〜B16・重ね殻・返し鏡）の仕様・検証・結果
- `docs/EXPANSION_3A2_ENTRY_SPEC.md` 段階3a+ 灰の底への入り口（近道「第三層から」「灰の底から」・記録の分離）の仕様・検証・結果
- `playtests/` Dots のプレイテスト記録（ローカル専用。`.gitignore` で除外し、GitHub には上げない。ルールは `CLAUDE.md`）
