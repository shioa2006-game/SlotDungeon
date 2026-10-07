# EMBERWHEEL リポジトリのルール

## プレイテスト記録（Dots）の置き場所 — GitHub に上げない

- Dots のプレイテスト結果（報告書・詳細ログ・証拠画像）は、**`playtests/` の下に1回ごとのフォルダで置く**。
  - 例：`playtests/SlotDungeon_10Run/`、`playtests/SlotDungeon_AE_Playtest/`
  - 新しいプレイテストを受け取ったら、`docs/` ではなく `playtests/<名前>/` に入れる。
- `playtests/` は `.gitignore` で除外している。**コミット・プッシュしない**。
  - `git add -f` で強制的に追加しない。
  - `git add -A` や `git add .` の後は、`git status` で `playtests/` が入っていないことを確かめる。
- `docs/` などコミットする文書からプレイテストを参照するときは、パス（例：`playtests/SlotDungeon_AE_Playtest/`）だけを書き、「ローカル専用（GitHub には無い）」と添える。内容を丸ごと転記しない。
- 分析結果のまとめ（例：`docs/AE_AMBIGUOUS_BEHAVIOR_AUDIT.md`、`docs/VISUAL_ANALYSIS.md`）は `docs/` に置いてよく、GitHub に上げてよい。
