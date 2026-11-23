# 障害物局面の敗着を検出するガード試験

配信済み穴対応エンジン `ae8d8effdb04b6b0e9f1a73a03cfafbd41843e67` のパッチを適用した後、`patches/obstacle-tactical-guard.patch` を適用する。モデル、MITライセンス原文、第三者通知は同じ入力を使用する。作業は独立した実験用SDKと局面データに限る。

## 初版の仕組みと時間

候補手を指した後、相手が5手以内にこちらの合法手をなくせるかを調べる。相手の候補は王手と、自玉から2マス以内の駒取り。相手の選んだ手に対して、こちらの全合法応手を確認する。最終手の王手による詰みには既存の `solve_mate_in_one` を使う。肯定は限定した相手候補から得た具体的な強制負けの証明。否定はこの探索範囲で証明が見つからなかったことを示す。12,000ノードと単調時計の上限を併用する。

時間指定で穴があり、評価値が−1,000以下、指定が80ms以上の対局で `min(24, floor(指定ms / 8))` を本探索から確保する。100msでは12ms、500msと1500msでは24ms。残り時間だけをガードに渡す。35msは独立したガード試験の条件。100msの設定から35msを確保する場合、本探索に残るのは65ms。処理の途中でOSに停止される場合や、詰み関数の1回の呼び出しは、壁時計の超過要因になる。

## 初版の検証結果

- 保存棋譜の `L*4a` と `9c9d` を入力したところ、前者を114ノード、後者を32ノードで強制負けと判定した。実測した証明時間は0〜1msで、12・24・35msの各試行で別手 `5a5b` と `6e6h+` を返した。両手は独立C++の全幅5手検証で回避手と確認済み。`exact-incumbent.jsonl` に復元した強制局面と時間結果を保存した。
- 保存局面2件の合法手84手を35msで個別に照合した。独立実装で判明していた強制負け50手と回避34手がすべて一致した。`full-move-proof-controls.jsonl` を参照。
- 保存局面2件と未使用の受け12件を合わせた実Worker A/Bは、100msで13→13/14、500msで12→11/14。保存した2件は両版とも全試行で回避した。100msの落とし穴局面ではガードが探索の `L*8e` を `6a5b` に置き換えた。500msの未使用ブラックホール局面では、ラベルで3手負けを避ける `6g5h` を、3手負けの `6g6f` に置き換えた。限定探索で相手の早い勝ち筋を拾わず、すでに詰み負けの評価値を持つ代替手を選んだ。`worker-controls.jsonl` を参照。
- 穴を省いた固定ノード探索14件で、現行SDKとの指し手・スコア・深さ・ノード数・読み筋が一致。Rustネイティブ検証1件、実WASMとWorkerの穴1・9のスモーク、SDKの全7ファイルのSHA-256照合に合格した。全体の棋力、未使用局面での安定性、長時間の試行は未評価。

## 再現

Rust 1.95.0、`wasm32-unknown-unknown`、Node 22、Python 3.11以上を使用する。

```sh
RUN_ENGINE_TESTS=1 ./build-obstacle-guard-sdk.sh /path/to/shogi-is-luck-engine /tmp/guard-sdk
node run-guard.mjs --mode exact-incumbent --baseline /path/to/base-sdk --candidate /tmp/guard-sdk --fixtures positions.jsonl --budgets 12,24,35
node run-guard.mjs --baseline /path/to/base-sdk --candidate /tmp/guard-sdk --fixtures positions.jsonl --heldout /path/to/heldout-escape.jsonl --budgets 100,500
```

初版パッチSHA-256 `cbf4ae3fbfb2dd37ddd453704f9f912a764a62c2675af303d67d7ba27d92f068`、試験WASM `b2844b1baac9b68400af08d6354dd15ecf26d85a34036adb9bf0df39aab634bb`、Worker `511bad73c72b05bf86b424a3e6b165e0e7c71b7c0c77d11d0c7edfacbe4bc986`。Rust最適化出力のバイト列はビルドディレクトリに依存し得る。個別の成果物はマニフェストとSHA-256で識別する。

### 100・500・1500msでの全問題比較

`run-guard.mjs` に `--heldout ../../forensics/heldout/heldout.jsonl --budgets 100,500,1500` を与え、初版を現行版と比較した。攻めと受けは固定ラベルで別々に数え、既知の敗局2件は表の右列に分けた。全228応答で違法手、応答タイムアウト、設定を50ms超える応答は0件。 [全応答](worker-all-heldout.jsonl)

| 制限 | 未使用攻め／24 | 未使用受け／12 | 既知の敗局／2 |
|---|---:|---:|---:|
| 100ms | 21 → 21 | 10 → 11 | 1 → 1 |
| 500ms | 22 → 22 | 10 → 9 | 2 → 2 |
| 1500ms | 22 → 23 | 11 → 9 | 1 → 2 |

## 代替手の3手検査を追加した修正版

初版のパッチを適用した後、`repair/patches/obstacle-tactical-guard-safety.patch` を重ねる。置換表に詰み負けの評価がある代替手を外す。残った代替手は、王手、静かな手、駒取りを含めて3手の全合法手を探索し、相手の強制勝ちが存在しないことを確定した場合だけ採用する。ノード上限や時間切れに達した場合、元の手を返す。

独立ラベルが3手以内の回避手とした `6g5h` と、3手負けとした `6g6f` を固定回帰テストに含めた。初版の限定探索で後者の敗北が見つからないことも再現し、全幅検査が後者を拒否することを確認する。

元の2敗着は引き続き114・32ノードで証明できた。一方、代替手の全幅確認は12・24・35・60msの試行ですべて予算か12,000ノード上限に達し、元の手を保持した。試行した予算の範囲で、2つの敗着を安全に置き換える効果は確認できなかった。

実Workerの短い対照は、100msで11→13/14、500msで12→11/14。修正版の28試行で実際の置換は0件。100msの差には探索時間の配分変更も含まれる。500msの回帰用ブラックホールでは `6g5h` を保持して3手負けを避けた。500msの保存棋譜ブラックホールでは `9c9d` の強制負けを検出した後、代替手を確定できず保持した。両版とも違法手や設定を50ms超える応答は0件だった。

```sh
RUN_ENGINE_TESTS=1 ./build-obstacle-guard-safety-sdk.sh /path/to/shogi-is-luck-engine /tmp/guard-safe-sdk
node run-guard.mjs --mode exact-incumbent --baseline /path/to/base-sdk --candidate /tmp/guard-safe-sdk --fixtures positions.jsonl --budgets 12,24,35,60
node run-guard.mjs --baseline /path/to/base-sdk --candidate /tmp/guard-safe-sdk --fixtures positions.jsonl --heldout /path/to/heldout-escape.jsonl --budgets 100,500
```

修正版パッチSHA-256 `ca54c1328fd35699c0025814a69dfb850e74d0fba1e0aa9f95a40f6fc3a8cbf6`。試験WASM `de1d5ec9aa4e75ea50f57ebd27dbf70452e0f3267da268f15fa359208f788f8f`、Workerは初版と同じ。`repair/exact-incumbent.jsonl`、`repair/worker-controls.jsonl`、`repair/zero-control.jsonl`、`repair/native.log`、`repair/smoke.log` に検証結果を保存する。
