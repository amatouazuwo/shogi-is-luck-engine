# 棋力検証の再現手順

評価対象はゲーム本体 `28f365b3fb638a2a224eaf744cac65aea0dd84fa` のルールと、同コミットの `ai/obstacle-sdk` にある穴対応SDK。穴対応WASMのSHA-256は `0aa92ee9c44cc31e82cf58e3338420d2efb75b60b7a14eb1a5c76d8b0c0d9108`。通常版は公式v0.4.0 SDKで、WASMは `feb190263b48caed5a81e0009cda35f6d2a23548ccf61d785f019420b857222d`。

Node.js 22、C++20対応コンパイラ、Python 3が必要。ゲームとエンジンは隣接するディレクトリに置く。ゲームの実験用ブランチでも、ルールの比較には下記のコミットを指定する。各JSONLは一行に一試行または一対局。記録時のローカルパスがログに入る場合がある。

```bash
export GAME_REPO=/path/to/shogi-is-luck
git -C "$GAME_REPO" checkout --detach 28f365b3fb638a2a224eaf744cac65aea0dd84fa
(cd "$GAME_REPO" && bash scripts/prepare-rsshogi-sdk.sh)
export NORMAL_SDK="$GAME_REPO/ai/sdk"
export OBSTACLE_SDK="$GAME_REPO/ai/obstacle-sdk"
cd benchmarks/strength
g++ -O3 -flto -std=c++20 reference/obstacle-reference.cpp -o reference/obstacle-reference
cp reference/obstacle-reference reference/obstacle-reference-v1
export REFERENCE_BINARY="$PWD/reference/obstacle-reference"
node reference/parity.mjs
node tactics/verify-corpus.mjs
node tactics/score-worker.mjs > /tmp/obstacle-tactics.jsonl
node obstacle-matches.mjs --game-root "$GAME_REPO" --pairs 2 > /tmp/obstacle-matches.jsonl
python3 summarize-obstacle.py /tmp/obstacle-matches.jsonl
```

追加の問題は `TACTICS_CORPUS` に `$PWD/tactics/evade-supplement.jsonl` または `$PWD/tactics/mate-three-corpus.jsonl` を設定し、同じ検証コマンドを実行する。王手状態も独立確認する場合は `tactics/reference-check.cpp` を同じフラグでビルドし、`REFERENCE_BINARY` でその実行ファイルを指定する。旧問の駒得ラベルは、相手の即時応手を一手だけ入れた指標であり、その後の詰みを含む対局勝敗のラベルではない。

通常盤面の比較相手は [やねうら王のソース](https://github.com/yaneurao/YaneuraOu/tree/4453d83cf73081d3c75baebed11d0fe23bdb4666) の **8.30git**、Linux AVX2、NNUEビルド。比較実行ファイルを `normal/normal-match.mjs` の `--binary` に指定する。[水匠5公式配布](https://github.com/yaneurao/YaneuraOu/releases/tag/suisho5) の `Suisho5.7z` を展開し、`nn.bin` を `normal/eval/` に置く。実測の `nn.bin` はSHA-256 `768068f0d534a0603a5d38bcd143de6bbca820d5f1c95a14d40863e5b7892d76`。ソースと評価データは検証者が各配布元から取得する。ゲームへ配布するSDKの条件は[ビルド元](../../README.md)に記録している。

```bash
node normal/normal-match.mjs --binary /path/to/YaneuraOu --family hirate,game > /tmp/normal-matches.jsonl
node normal/normal-scorecard.mjs /tmp/normal-matches.jsonl
```

## 記録の場所

| 記録 | 場所 |
|---|---|
| 通常版と水匠5の比較、独立C++の校正 | `normal/normal-scorecard.json` と `normal/*.jsonl` |
| 特殊盤面の先後ペアの棋譜、探索と集計 | `obstacle-reference-*.jsonl`、`obstacle-summary.json` |
| 戦術問題と正解、深さ、ノード、時間 | `tactics/*corpus*.jsonl`、`tactics/tactical-scorecard.csv` |
| 射線遮断の反実仮想と3〜7手の探索 | `forensics/ray/ray-branches.jsonl`、`forensics/audit/proof-with-wasm.jsonl` |
| 駒得問題と敗局の局面・探索・証明 | `forensics/material/`、`forensics/losses/exact-scorecard.json` |
| 同一盤面の通常版・穴対応版対照とブラウザ経路 | `switch/` |

フォレンジックの再現は `forensics/losses/replay.mjs` など、各記録と同じディレクトリのソースを使う。C++プローブには実行バイナリを含めず、対応する `.cpp` をC++20でビルドする。ビルド、棋譜確認、候補の実験状況は [引継ぎ](../../HANDOVER.md) を参照。

## 改善候補と未使用データ

穴評価補正のビルド手順は `experiments/hole-eval/build-hole-aware-sdk.sh`。第1引数はこのエンジンリポジトリ、第2引数は生成先、第3引数は公式SDK ZIP（省略時は公式配布から取得）。マニフェストと元の計測バイナリのSHA-256は同ディレクトリに保存した。別ディレクトリでの再ビルドは過去にバイト差が出ているため、各試験は実行したSDKのSHAを記録する。

`forensics/heldout` の攻め24問・受け12問と `experiments/holdout-openings.jsonl` は候補による採点前に確定。受け問題は攻め問題の前駆局面を含むため、両者を独立標本とみなさない。

```bash
bash experiments/hole-eval/build-hole-aware-sdk.sh ../.. /tmp/hole-eval-sdk
node forensics/heldout/run-heldout.mjs --corpus forensics/heldout/heldout-attack.jsonl --sdk before="$OBSTACLE_SDK" --sdk after=/tmp/hole-eval-sdk --budget 100,500,1500
node obstacle-matches.mjs --candidate-sdk /tmp/hole-eval-sdk --opponent baseline --holdout --offset 21 --pairs 3 --ply-cap 120 > /tmp/hole-eval-games.jsonl
python3 summarize-obstacle.py /tmp/hole-eval-games.jsonl
```

独立C++との再対局では同じ局面のフラグに `--opponent reference` を指定する。`experiments/normal-continuous` は通常版公式WASMを使う連続探索Workerと水匠5のノード上限別検証。`experiments/old-js` は従来JS戦200局の保存データで、ゲーム本体の固定コミットにある `scripts/benchmark-rsshogi-obstacles.mjs` を使う。
