
# rsshogi WASM再現性：単一コード生成・Cargo直列化の切り分け（2026-11-23）

## 結論

[GitHub Actions #45195381883](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45195381883)は**SUCCESS**。WASM SDKビルド2回、バイナリ構造監査、実NNUE探索比較はすべて完了した。

**Rustコード生成単位1・Cargo単一ジョブ・インクリメンタル無効・SOURCE_DATE_EPOCH=0を同時に適用しても、WASMはバイト単位で一致しなかった。** よってこれらを組み合わせるだけでは完全な再現性を確保できない。これは複数要因を一度に変更した実験なので、個別の要因の有効性・無効性を断定しない。

| 項目 | 実験1回目 | 実験2回目 | 判定 |
|---|---|---|---|
| WASMサイズ | 4,551,687 bytes | 4,551,687 bytes | 一致 |
| SHA256 | 505021560711910f16a8e12a627665a355b88aa6f39fb5adfc91d24be43bf9f8 | 9b773b3ab3d9196747f2e73302a7f3c8eae73267c31521a3b6794cceb817a972 | **不一致** |
| 型情報 / import / export | 同一 | 同一 | 一致 |
| function / element / code / data / custom:name | 差異あり | 差異あり | **不一致** |
| 実NNUE探索・合法手・指し手・ノード・深さ・評価値・PV | 6条件 | 同じ6条件 | **6/6一致** |

通常のビルドでは以前、type、function、element、code、data、custom:nameが不一致だったが、今回の単一コード生成実験では**typeの不一致は観測されなかった**。ただし2ビルド一組の観測結果であり、単一コード生成が因果的にtype差異を解消したとはまだ断定できない。

## 実験の制御

通常の[SDKビルドスクリプト](../scripts/build-obstacle-sdk.sh)は**一切変更していない**。切り分け専用の[実験用スクリプト](../scripts/build-obstacle-sdk-repro-single-codegen.sh)に限り以下を追加。

- `CARGO_BUILD_JOBS=1`
- `CARGO_INCREMENTAL=0`
- `SOURCE_DATE_EPOCH=0`
- `RUSTFLAGS`へ`-C codegen-units=1`を追加（既存パスremapは維持）

Rust 1.95.0、rsshogi/rsshogi-nnue-miniのソースコミット、障害物対応パッチ、公式埋込NNUEモデルの固定ハッシュ、GitHub Runnerは共通。独立の一時ディレクトリで2回ビルドして両SDKのSHA256SUMSを確認した。ワークフローは[wasm-repro-single-codegen-lab.yml](../.github/workflows/wasm-repro-single-codegen-lab.yml)。

この実験用フラグでは**生成WASMのサイズが通常の約4.96MBから約4.55MBへ変化**した。これはコンパイル条件の違う別バイナリであり、ゲーム側保存WASM（4,962,696 bytes、SHA256 `0aa92ee9c44cc31e82cf58e3338420d2efb75b60b7a14eb1a5c76d8b0c0d9108`）の代用品にしない。

## 実際の探索は同じだった

以下6条件を、新しいビルドAとBの両者で本物のrsshogi NNUE C-APIを通して比較。

| 盤面 | ノード上限 | AとBの選択手 | 深さ | 評価値 | 一致判定 |
|---|---:|---|---:|---:|---|
| 通常 | 5,000 | 5g5f | 8 | 78 | 一致 |
| 通常 | 25,000 | 5g5f | 12 | 261 | 一致 |
| 落とし穴 | 5,000 | 5i6h | 7 | 57 | 一致 |
| 落とし穴 | 25,000 | 5i6h | 12 | 63 | 一致 |
| ブラックホール | 5,000 | 5i6h | 11 | 67 | 一致 |
| ブラックホール | 25,000 | 5i6h | 17 | 69 | 一致 |

上記に加え各条件で合法手の集合、ノード数、読み筋も一致。**6例の一致は全局面・実際のゲーム時計やWorker・端末性能を保証しない**。また2本とも実験用に生成されたWASMであり、ゲームがコミットしているバイナリは未検証。

## 次に切り分ける原因

現時点では、関数の`type`は一致しても`function`・`element`・`code`・`data`に差がある。次の原因調査では**関数インデックスと名前セクションの対応**を比較して、関数の並び替え・インデックス再割当が起きているかを特定する。特定できたら、Rustコード生成・リンカ内部のどこから揺らぎが生じるかを調査する。

ただしゲーム側で優先すべき未完了の検証は、**プライベートゲームに実際に保存したWASMのブラウザ実行・ゲームUI・3分時計・特殊盤面**の動作確認。ビルドの非再現性が残ることだけを理由に、本番WASMを差し替えたり現行CPU設定を変えたりしない。

**保護事項:** 現行CPU難易度5段階、簡易CPU「ふつう」、仮段級位、ゲーム用main/develop、Render本番、マージ・デプロイはすべて無変更。実験と文書はエンジンDraft PR #3のみ。
