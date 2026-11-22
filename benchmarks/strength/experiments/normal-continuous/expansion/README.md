# 通常盤面の追加対局

100msの前回32局で使った番号0〜7を除外した。追加は各番号で平手系とゲーム固有ランダム陣形を各1局面生成し、各局面で先後を入れ替える。100msは番号8〜11、500msは12〜13、1500msは14〜15を使用する。`openings.jsonl` は対局前に凍結した局面、手順、SDK識別子、ゲームルールのSHA-256を記録する。条件ごとに局面集合が異なるため、時間設定間の結果は同一局面での比較とは扱わない。手数上限は100msが200手、500・1500msが100手で、上限に達した棋譜を未決着とする。

公式rsshogi-nnue-mini v0.4.0の公式WASMとモデルを両方式で共用する。前回と同じ連続探索のWorkerと公式Workerを比較する。ゲーム側の修正は探索結果を計測するコードには含めず、ゲームの合法手を固定コミットから参照する。Node.js 22.23.5、計時側はゲームの3分切れ負け、1スレッド、ハッシュ16 MiB。Worker内の `position` と `go` に使ったCPU時間を、経過時間と別に記録する。サンプル採取時のCPUアフィニティは1論理CPU。

```bash
GAME_COMMIT=17b41aa8959877be81dc86ecd3477a67a3139262
# GAME_REPO は当該コミットのゲームチェックアウト、SDK は公式WASM SDKの場所。
node normal-match.mjs --repo "$GAME_REPO" --game-commit "$GAME_COMMIT" --sdk "$SDK" --level 100 --family hirate,game --pair-offset 8 --pairs 4 --ply-cap 200 > match-stock-100.jsonl
node normal-match.mjs --repo "$GAME_REPO" --game-commit "$GAME_COMMIT" --sdk "$SDK" --level 500 --family hirate,game --pair-offset 12 --pairs 2 --ply-cap 100 > match-stock-500.jsonl
node normal-match.mjs --repo "$GAME_REPO" --game-commit "$GAME_COMMIT" --sdk "$SDK" --level 1500 --family hirate,game --pair-offset 14 --pairs 2 --ply-cap 100 > match-stock-1500.jsonl
```

同じ条件に `--validate-openings` を加えると、対局を行わずに局面を検証できる。記録より優劣を判断する場合は、先後の組を単位とし、未決着が結論に与える範囲を評価する。
