# 技巧2・深さ8の終局近傍クラッシュ調査と最小修正（2026-11-23）

## 目的

ゲーム側CPUの正式難易度を触らず、技巧2 v2.0.2 を「アマ四段程度（仮）」の**開発専用**比較基準として、通常将棋で安定使用できるようにする。人間相手の段級位認定はしない。

## 原因の切り分けと一次証拠

- 最初の深さ8実対局では **SFEN** `6B1l/l4g+N1k/p4pspn/3P4p/7S1/3SP1P2/P2S1K1PP/5GG2/L7L b 2RB2N8Pg 127`（保存局面ID8・第118着手直前）で技巧2の標準出力が閉じた。[再現ログ](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45116911697)。
- ネイティブの孤立プロセスで、同局面の**深さ5は `B*2a` の1手詰を見つけ、深さ7でも詰みを報告するが、深さ8でSIGSEGV**。[孤立再現](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45117320351)。
- 元々の検証スクリプトは`params.bin`だけをコピーしており、公式ZIPに収録されている`progress.bin`（SHA256 `ddf60a3180f768d9756b83cd4fe50a18b9e93855d1ad7281566934fb7c53a042`）をコピーしていなかった。`main.cc`は`Progress::ReadWeightsFromFile()`を呼び、ファイル不足時はエラーを出す。従って**過去の技巧2の成績を正式な棋力校正の根拠にしない**。
- `progress.bin`をコピーしたデバッグビルドでも、詰み局面の分岐で`src/move_probability.cc:699`の`legal_moves.size() >= 1`アサーションが発火した。[デバッグログ](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45118188274)。
- Gikou2の`src/movepick.cc`では、深い探索（確率による指し手順序付け）で`kProbability0`ステージに進む際、`RemoveIllegalMoves`により手数0になっても、`MoveProbability::ComputeProbabilitiesWithCache`を無条件に呼んでいた。この関数は合法手が1件以上あると仮定し、空配列での`std::valarray::max()`等を使うため、終局近傍でメモリ上の未定義動作を起こし得る。

## 開発用の最小パッチ

`patches/gikou2-empty-legal-probability.patch` は公式ソースの`src/movepick.cc` **1か所だけ**に、合法手がゼロなら指し手の確率を計算せずステージを抜けるガードを加える。合法手が存在する場合の評価関数・探索深さ・探索ノード上限を変更しない。次の指し手取得は既存の`MovePicker::NextMove`の`kStop`ステージに委ねる。

修正した技巧2は**公式そのままのバイナリではなく、公式ソースに検証用の終局ガードを適用した派生ビルド**である。検証結果を報告するときはその違いを明示する。原作者のバイナリや評価データは再配布しない。該当パッチにはライセンス上のGPLv3-or-laterが適用されることに注意する。

## 検証順序

1. 公式のv2.0.2固定コミットからビルドし、SHA256で固定した`params.bin`と`progress.bin`を両方配置する。
2. 深さ5の比較局面、深さ8の通常局面、**深さ8のクラッシュ再現局面**を検証する（`gikou-depth8-isolated.yml`）。
3. 同じパッチ・評価データでrsshogiとの対局テストを再実施し、棋譜全手・合法性・持ち時間の監査を通す。
4. **これまでの技巧2比較は`progress.bin`欠落という再現性の問題があるため、修正後の比較とは混ぜない**。新しい条件で独立に再測定する。

正式な「アマ四段」の証明ではなく、ユーザー指定の「技巧2深さ8＝アマ四段程度（仮）」という比較ルールを維持する。

**保全条件**：この工程はエンジンDraft PR #3でのみ実施。ゲームPR #12、「ふつう」簡易CPU、ゲーム正式難易度、`main/develop`、Render本番は未変更。

## 修正後の実測結果

- [単独探索CI #45118620237](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45118620237)：**SUCCESS**。深さ5/8と通常局面・問題の詰み局面の全テストが成功。深さ8でも`B*2a`を返した。
- [rsshogi実対局CI #45118765575](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45118765575)：**SUCCESS**。2元局面・先後交換の4局すべて完走。独立審判による合法着手・時計・勝敗監査が成功。rsshogi10,000ノードが**2勝2敗**。
- これは安定性を確認した小規模試験であり、四段相当を証明する段級位実験ではない。今後は[公式評価ファイルを両方使用した再測定](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45118969180)に切り替える。

### 重要な再現性の注意
`progress.bin`の公式ZIP由来SHA256は`ddf60a3180f768d9756b83cd4fe50a18b9e93855d1ad7281566934fb7c53a042`。旧試験と新試験は技巧2内部の評価関数の入力が異なるため、過去の技術的な勝率値の連続性を仮定しない。公式Gikou2ソースには1か所のガードパッチを当てており、原作者配布バイナリとの同一性は主張しない。
