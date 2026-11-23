
# 実Chromium Web Worker + rsshogi NNUE/WASM 統合検証（2026-11-23）

## 確定した実行結果

[Actions #45188420789](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45188420789)および[監査文言修正後 #45188961908](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45188961908)は、**どちらも実Chromiumブラウザ検証を含む全ジョブSUCCESS**。後者の独立監査は5件の確認すべてにPASSした。

- 通常将棋：1手最大1,500ms、実WASM探索から合法手を返す（後者の例：5i4h、1,056,729ノード、深さ23、約1,501ms）。
- 落とし穴1マス：25,000ノードの実探索で合法手を返す（例：5i6h、25,000ノード）。
- ブラックホール3×3：9マスを障害物として伝え、25,000ノード以内の合法手を返す。
- 探索中のWorkerをWebブラウザから強制終了し、実行中の検索結果を破棄する。
- 新しいWorkerを起動して同じWASM系を再ロードし、ブラックホール盤面の合法手を再び取得する。

[テストスクリプト](../benchmarks/strength/ci/browser-obstacle-worker-smoke.mjs)／[ワークフロー](../.github/workflows/browser-real-obstacle-wasm-smoke.yml)。新規テストを公のエンジンリポジトリの開発ブランチに置き、プライベートゲームのソースを公開リポジトリへ複製していない。

## バイナリ同一性：一致する部分と一致しない部分

プライベートゲームに保管された障害物対応SDKのmanifestを参照し、同じ固定Rust 1.95.0・ルール・エンジンの固定コミット・公式NNUEモデルでSDKを再ビルドした。

| 対象 | ゲーム側のSHA-256 | 今回の生成側との一致 |
|---|---|---|
| rsshogi_nnue_mini.wasm | 0aa92ee9c44cc31e82cf58e3338420d2efb75b60b7a14eb1a5c76d8b0c0d9108 | **不一致** |
| worker.js | fe9298706c23a1a7818d0c9f97e7b871fa5a239dfeb672a220d65d4e3c35d6b2 | 一致 |
| mini.js | 112294de3bbd5ee315a81da86a6aa85ab8e55725e13bca5f5b8e8268ba7306b1 | 一致 |
| obstacle-engine.patch | f8c433568dd6c85979a2fa98a7f24f16caf15650d236a9c8bb6dafb391ddc009 | 一致 |
| obstacle-rules.patch | e686a50abafc4e623fc245e874f1a73a0c2c002c5c0fea4c7f751824545b5fecc | 一致 |

- **ゲーム保管WASM：** 4,962,696バイト、上記SHA-256。
- **新ビルドA（#45188420789）：** 4,962,722バイト／SHA-256 bbda7877dcf75443083f175360ad161446af53d817a62a915499772df1ec9d31。
- **新ビルドB（#45188961908）：** 4,962,648バイト／SHA-256 e7bc087d98b1d3c082f14bbf4f1d4c85b2fb2d64520e7a5d140941be2b415f48。

**新ビルドAとBでもバイト数・ハッシュが異なった。** これは少なくとも**このビルド手順でバイト列が再現できていない**ことを示す。原因（非決定的なメタデータ・ビルド環境差・コンパイル出力差など）は未特定。差異が「コードの意味に影響しない」かもまだ未検証で、両者の機能・性能が完全同一とは保証しない。

[元の#45188420789](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45188420789)の独立監査に「exact private-game pinned NNUE WASM/Worker」という不正確な成功文言が残ったため、**#45188961908では修正**し、「実WASMブラウザ検証は成功。ただしゲームのWASMとバイト列不一致」と正しく表示する。

## 検証範囲の限界と開発判断

- **PASS：** 同じ固定ソースから生成されたSDKの本物のWASMと、本物のChromium Web Workerの通信・合法手・障害物・ノード上限・強制終了と再作成。
- **未検証：** ゲーム側にコミットされているWASMそのもののブラウザ挙動、ゲームの index.html／CPU難易度画面、3分時計、特殊1%イベント、端末差、実オンライン対局。
- **保護：** ゲームの現行CPU5段階、簡易CPU「ふつう」、仮段級位、main/develop、Render本番のいずれも変更しない。ゲームの保存済みWASMを再ビルド版に勝手に差し替えない。PRをマージ・デプロイしない。

次の技術課題は、**WASMのセクション差を比較してビルドの非再現性を調べる**こと、およびゲームプライベートリポジトリのRunner復旧後に保存済みWASMでブラウザ試験を行うこと。
