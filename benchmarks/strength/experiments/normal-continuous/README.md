# 通常盤面の連続探索プロトタイプ

公式 `rsshogi-nnue-mini v0.4.0` のWASMと内蔵モデルを共通に使い、公式Workerの35ms単位の呼び出しと、C APIを指定時間で一度呼び出す方式を比較する。両者の差分はWorkerの探索呼び出しにある。

- 公式SDKのWASM SHA-256は `feb190263b48caed5a81e0009cda35f6d2a23548ccf61d785f019420b857222d`。
- 公式WorkerのSHA-256は `7357552f5cf6bcea12fa6105f336cc612f790f1d1d6d01577856332584a5a0da`。
- C APIの実行中は同じWorkerに送ったメッセージを処理できない。探索の中断時はWorkerを終了し、次回は再初期化する。ゲーム側の試験実装では、Renderテスト環境の専用URLで100msを選んだときに使える。現行の公式SDKのWASM、JavaScriptモジュール、内蔵評価モデルは共通。

## 再現方法

Node 22、ゲーム本体のチェックアウト、公式 v0.4.0 SDKを準備する。`--repo` と `--sdk` にそれぞれのディレクトリを渡す。

```sh
node normal-match.mjs --repo /path/to/game --sdk /path/to/official-sdk --smoke > candidate-smoke.jsonl
node normal-match.mjs --repo /path/to/game --sdk /path/to/official-sdk --level 100 --family hirate,game > match-stock-100.jsonl
node normal-match.mjs --repo /path/to/game --sdk /path/to/official-sdk --level 100 --family hirate,game --pair-offset 1 --pairs 3 > match-stock-100-extension.jsonl
node normal-match.mjs --repo /path/to/game --sdk /path/to/official-sdk --level 100 --family hirate,game --pair-offset 4 --pairs 4 > match-stock-100-second-holdout.jsonl
node normal-match.mjs --repo /path/to/game --sdk /path/to/official-sdk --level 500 --family hirate --shared-nodes 15000 > match-stock-nodes-15000.jsonl
node normal-match.mjs --repo /path/to/game --sdk /path/to/official-sdk --level 500,1500 --family hirate > match-stock-hirate-high.jsonl
node summarize.mjs > summary.json
```

水匠5の比較には、参照用ディレクトリ内の `YaneuraOu-8.30git/source/YaneuraOu-by-gcc` と `eval/nn.bin` を使う。やねうら王のソースを固定コミット `4453d83cf73081d3c75baebed11d0fe23bdb4666` から取得し、`source` で以下のコマンドを実行する。評価ファイルは公式配布から手元で展開する。

```sh
make -j1 COMPILER=g++ TARGET_CPU=AVX2 YANEURAOU_EDITION=YANEURAOU_ENGINE_NNUE
```

```sh
for nodes in 5000 20000 80000; do
  node normal-match.mjs --repo /path/to/game --sdk /path/to/official-sdk \
    --reference-dir /path/to/reference --level 100 --family hirate \
    --opponent suisho5 --reference-nodes "$nodes" > "match-suisho5-$nodes-100.jsonl"
done
node summarize.mjs > summary.json
```

平手とランダム初期陣形を分け、同一局面ごとに先後を入れ替える。3分計時は探索と合法手確認にかかる処理時間を差し引く。思考時間は設定値、残り時間の20分の1、残り時間から150msを引いた値のうち最小。1スレッド、16 MiBの置換表、定跡と先読みなし。ゲーム本体の合法手と4回反復を用い、200手上限に達した局は未決着として別に集計する。エンジンのノード数と深さは実装ごとに集計定義が異なる。

水匠5の段階試験では、やねうら王に `movetime` と段階ノード上限を指定する。固定時間の両者同条件の試験とは別の対照条件。やねうら王の置換表は各局開始時の `isready` で初期化し、水匠5は配布案内の `FV_SCALE=24` で実行する。

[公式WASM SDK](https://github.com/nyoki-mtl/rsshogi-nnue-mini/releases/tag/v0.4.0) · [やねうら王の固定ソース](https://github.com/yaneurao/YaneuraOu/tree/4453d83cf73081d3c75baebed11d0fe23bdb4666) · [水匠5の公式配布](https://github.com/yaneurao/YaneuraOu/releases/tag/suisho5)
