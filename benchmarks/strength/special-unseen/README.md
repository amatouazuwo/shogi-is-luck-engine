# 未使用の特殊盤面36局面

落とし穴1マスとブラックホール3×3について、最短3・5・7手で相手の合法手をなくす攻めを各4局面、相手の3・5・7手以内の強制勝ちを防ぐ受けを各2局面収録しています。各区分で先後を均等にしました。攻めは盤上10〜15駒、受けは10〜11駒です。受けの9局面は開始時に王手がかかっています。

攻めと受けを別の乱数シードで直接生成し、候補選別には独立したC++の限定探索を使いました。正答は全合法手と全応手を含む独立C++全幅探索で確定しています。攻めでは全ての最短勝ち初手を、受けでは規定手数の強制負けを避ける全ての初手と、誤答ごとの最短負け手数を記録しています。ゲーム本体のJavaScriptでも根の合法手を照合しました。

保存された54ファイルの特殊盤面614局面を比較対象にしました。手数を除いたSFENと穴配置を左右反転および先後反転で正規化したうえで、過去局面との重複と今回の集合内の重複は0件でした。候補WASMやNNUEの結果を使う前に局面と正答を固定しました。既存の対局記録とは別に集計できる人工局面です。

## 検証と再生成

このディレクトリは、AIリポジトリの `benchmarks/strength/special-unseen` に配置します。隣接する `../tactics/rules.mjs` は `GAME_REPO` を読む版を使います。Node 22、C++20対応のg++、ゲーム本体のチェックアウトを用意します。元のJavaScript判定のコミットは `unseen-special.jsonl.metadata.json` の `gameRulesCommit` に記録されています。

```sh
export GAME_REPO=/path/to/shogi-is-luck
RUN=$(mktemp -d)
g++ -std=c++20 -O3 -DNDEBUG ../forensics/heldout/solve.cpp -o "$RUN/solve"
sha256sum -c SHA256SUMS

node ../forensics/heldout/verify.mjs --solver "$RUN/solve" \
  --corpus unseen-attack.jsonl --corpus unseen-defense.jsonl > "$RUN/proof.json"
cmp proof-recheck.json "$RUN/proof.json"
node audit-freeze.mjs --verify-only
node verify-defense-archive.mjs unseen-attack.jsonl

node generate-attack.mjs --solver "$RUN/solve" --output "$RUN/attack.jsonl"
DEFENSE_SOLVER="$RUN/solve" DEFENSE_OUTPUT="$RUN/defense.jsonl" \
  node generate-defense.mjs generate
cmp unseen-attack.jsonl "$RUN/attack.jsonl"
cmp unseen-defense.jsonl "$RUN/defense.jsonl"
```

固定した照合対象は `prior-special-identities.json` です。`position-audit.mjs` で別の照合元を取り直す場合は、`SPECIAL_ARCHIVE_ROOT` と `SPECIAL_RESULTS_ROOT` で探索範囲を指定できます。元の生成スクリプトと移植版のSHA-256は `source-provenance.json` にあります。

WASMの採点には既存の `../forensics/heldout/run-heldout.mjs` を使います。

```sh
node ../forensics/heldout/run-heldout.mjs --corpus unseen-special.jsonl \
  --sdk baseline=/path/to/baseline-sdk --sdk candidate=/path/to/candidate-sdk \
  --budget 100,500,1500
```

`unseen-special.jsonl` のSHA-256は `ec1fa261bb12d1d836ecb9f56890802f35ca330d5e13d1c57b8632d8558d1a20` です。全36局面の再証明は14,889,442ノードでした。
