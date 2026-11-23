# 適応型Workerと既存Workerの直接対局

`adaptive-direct-100.jsonl` は、適応型の35/70/90msスライスと既存の35ms固定スライスを、同一の障害物WASM・内蔵評価モデルで比較した100ms対局の記録。候補をJSONLでは `nnue`、既存Workerを `baseline` と表記する。対局相手は既存Workerで、独立C++エンジンはルール照合に使用した。

ゲーム本体 `e8a26f16325c9f27b29fa37ba8d06a0cc70ddeec` のルールを使用。序盤、中盤、駒数を減らした盤面を各種類1局面ずつ用意し、同一SFEN・障害物配置で候補の先後を入れ替えた。落とし穴とブラックホール各6局、計12局。各エンジンは1スレッド、16 MiBの置換表、1手100msを要求し、持ち時間3分に探索の応答時間を計上した。対局中の運イベントは追加せず、100手で勝敗未確定として打ち切った。

| 盤面 | 候補が先手 勝–敗–分–上限 | 候補が後手 勝–敗–分–上限 | 合計 |
|---|---:|---:|---:|
| 落とし穴 | 1–2–0–0 | 2–0–0–1 | 3–2–0–1 |
| ブラックホール | 1–1–0–1 | 0–1–0–2 | 1–2–0–3 |
| 全体 | 2–3–0–1 | 2–1–0–3 | 4–4–0–4 |

| Worker | 記録手数 | 平均応答 | P95応答 | 最大応答 | 予算+50ms超過 | 平均深さ | 平均ノード |
|---|---:|---:|---:|---:|---:|---:|---:|
| 適応型 | 445 | 104.31ms | 110.16ms | 420.08ms | 1 | 5.85 | 10,456 |
| 既存 | 444 | 104.04ms | 108.32ms | 406.29ms | 2 | 5.72 | 10,795 |

違法手、応答タイムアウト、持ち時間切れは双方0件。8局が詰みで決着し、4局が手数上限。応答は局面設定の送信から探索結果を受け取るまでの実測で、P95は昇順に並べた値の95%順位。平均ノード数はWorkerから返った値を使用する。

この比較の対象は6局面の100ms条件。上限局に勝敗を割り当てた得点率の範囲は33.33〜66.67%で、先後ペア単位のHoeffding 95%区間は0〜100%だった。この標本から棋力の優劣や500・1500msでの効果は確定できない。

## 再現

Node 22とPython 3を使用し、エンジンリポジトリの `benchmarks/strength` で実行する。`GAME_REPO` は上記のゲーム本体コミットのチェックアウト、`OBSTACLE_SDK` は既存の障害物SDKのディレクトリを指定する。`build-worker.sh` が既存のWASMとWorkerのSHA-256を検証し、適応型Workerを生成する。

```bash
EXP=experiments/adaptive-obstacle
RUN=$(mktemp -d)
bash "$EXP/build-worker.sh" "$OBSTACLE_SDK" "$RUN/adaptive-sdk"
g++ -O3 -DNDEBUG -std=c++20 reference/obstacle-reference.cpp -o "$RUN/obstacle-reference"
node obstacle-matches.mjs --game-root "$GAME_REPO" --reference "$RUN/obstacle-reference" \
  --candidate-sdk "$RUN/adaptive-sdk" --baseline-sdk "$OBSTACLE_SDK" --opponent baseline \
  --holdout --offset 24 --pairs 3 --budgets 100 --kind both --ply-cap 100 \
  > "$RUN/adaptive-direct-100.jsonl"
python3 "$EXP/summarize-direct.py" "$RUN/adaptive-direct-100.jsonl" > "$RUN/adaptive-direct-summary.json"
```

手元で元の集計を再生成する場合は `python3 experiments/adaptive-obstacle/summarize-direct.py` を実行する。保存ログのSHA-256は `3cf422892ec6e8b017da2b198ce3400402842fbb1cb5955fa37086bcb5d558eb`。時間制限付き探索の着手と実測応答時間は、実行時の負荷でも変動する。
