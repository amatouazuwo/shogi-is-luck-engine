# 100ms初回探索の準備試験

ゲーム側PR [#9](https://github.com/amatouazuwo/shogi-is-luck/pull/9) の `4f7cce30cba9fe610ffa2672281f4312d892878e` を一時領域に展開し、試験Workerに準備探索を追加する。ゲームの作業ツリーと配信には反映していない。同じ平手の初期局面で、条件ごとに新品のWorkerを使い、条件の順序を入れ替えた。Chromium 156.0.8078.79、Node.js 22.23.5、デスクトップとPixel 7相当。実機の測定には使わない。

| 条件 | 深さ0／試行 | 初回の初期化から合法手までの中央値 デスクトップ／Pixel 7 |
|---|---:|---:|
| 準備探索なし | 3/12 | 442ms／451ms |
| 100ms上限、深さ2まで | 0/12 | 618ms／547ms |
| 256ノード上限、深さ2まで | 0/12 | 558ms／513ms |

全36手が合法。256ノード版では準備探索の実測が最長211msだった。準備後の100ms探索は全24試行で115ms以内だったが、準備分を足した初回全体は長くなった。探索開始前に初期化に消費する処理時間は、エンジンの `elapsed_ms` と一致しない。局面は1種類で、キャッシュが共有される1台の測定。通常盤面100msの対局結果は準備なしで得ているため、この試験から準備ありの棋力は推定しない。採用前に実機、初回の多様な局面、初期化中の中断、端末制約を検証する。

```bash
CHROMIUM_EXECUTABLE=/usr/bin/chromium ./run-local.sh \
  /path/to/game /path/to/official-sdk /path/to/node_modules > /tmp/startup-prime.jsonl
python3 summarize.py /tmp/startup-prime.jsonl > /tmp/startup-prime-summary.json
```

Node.js 22、Git、Playwright、公式SDKが必要。SDKはさらにWASM SHA-256で照合する。番号を固定した記録を再集計する場合は `python3 summarize.py samples.jsonl`。 [生データ](samples.jsonl) · [集計](summary.json)
