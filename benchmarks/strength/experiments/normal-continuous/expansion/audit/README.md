# 通常盤面の未使用局面と先後ペアの監査

`audit-openings.py` はSFENの手数欄を除き、盤面、手番、持駒で照合する。左右反転、180度回転と先後・持駒の交換も同一とみなす。指定した過去の記録との照合で重複があれば終了コード2を返す。実戦ログを渡すと、同じ時間・陣形区分・局面番号で両先後の開始SFENが一致すること、各対局結果が開始ログと一致すること、同じ時間設定内でルール・Worker・探索設定がそろうことを検査する。

```bash
python3 audit-openings.py --preview "$EXPANSION/openings.jsonl" \
  --prior "$ARCHIVE"/experiments/normal-continuous/match-*.jsonl \
  "$ARCHIVE"/normal/normal-*.jsonl "$ARCHIVE"/switch/fixed.jsonl
```

対局が終わったら同じコマンドに `--matches "$EXPANSION"/match-stock-*-expansion.jsonl` を加える。完了した先後ペアだけを勝敗集計に使い、手数上限による打ち切りは点数0から1までの範囲として保持する。各時間のペアに対するHoeffding参考区間は、開始局面が独立と仮定したもの。同じ局面番号の異なる陣形区分を1組にまとめた感度分析も出す。法則に沿って選んだ局面を対局全体の無作為標本とみなすことはできない。

最初に固定した追加16局面は、過去の通常盤面27局面と完全一致・対称変換後とも重複0件だった。全局面の手番は先手。ランダム陣形は初期盤面、平手系は8または10手進めた局面。エンジンを置く先後は各局面を使って入れ替える。

## 中盤・後半の追加4開始局面

`supplemental-fixtures.jsonl` はこの16局面と過去27局面のいずれとも重ならない。平手とゲーム固有のランダム初期陣形をそれぞれ2つ用い、ゲーム本体の合法手だけで36・41・104・109手進めた。先手2局面、後手2局面。過去にエンジン同士で対局した棋譜からの抜き出しは用いず、4つの固定シードから合法なランダム棋譜を生成した。駒取りの選択重みを3、その他を1とし、成る手はさらに1を加えた。候補エンジンによる採点や対局は行っていない。

各シードから条件を満たす最初の局面を採用した。条件は持駒の最低数、指定手数までの最低駒取り数、駒価値差の上限、両玉が王手中でないこと、手番側の合法手12以上、両側の1手勝ちなし。後半2局面では両側合わせて少なくとも2つの王手が可能。駒価値差は盤と持駒を合わせた生成時の粗い指標。短い手数上限で実際に決着する割合は未計測で、後半2局面はこの合法な棋譜の経過手数と持駒の多さによる区分。

```bash
GAME_REPO=/path/to/pinned-game node supplemental-fixtures.mjs > /tmp/supplemental-fixtures.jsonl
cmp supplemental-fixtures.jsonl /tmp/supplemental-fixtures.jsonl
python3 verify-supplement.py supplemental-fixtures.jsonl /path/to/compiled-obstacle-reference
python3 audit-openings.py --preview supplemental-fixtures.jsonl \
  --prior "$EXPANSION/openings.jsonl" "$ARCHIVE"/experiments/normal-continuous/match-*.jsonl \
  "$ARCHIVE"/normal/normal-*.jsonl "$ARCHIVE"/switch/fixed.jsonl
```

独立C++と比較した4つの合法手集合と、両側の1手勝ちの有無8件はすべて一致した。生成元のゲームルールはJSONLのSHA-256、全ての手順は各行の `initial` と `sequence` で照合できる。
