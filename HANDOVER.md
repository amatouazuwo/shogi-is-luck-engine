# 「将棋は運ゲー」AI検証の引継ぎ

## 保存先と対象

- ゲーム側の評価基点は `develop` の `28f365b3fb638a2a224eaf744cac65aea0dd84fa`。作業は両リポジトリの `codex/strength-evaluation` で管理する。ゲームの本番反映には利用者の明示承認が必要。 [ゲームの作業ブランチ](https://github.com/amatouazuwo/shogi-is-luck/tree/codex/strength-evaluation) · [ゲーム側の引継書](https://github.com/amatouazuwo/shogi-is-luck/blob/codex/strength-evaluation/docs/strength-evaluation/HANDOVER.md)
- 現行穴対応SDKのソース基点は `ae8d8effdb04b6b0e9f1a73a03cfafbd41843e67`。エンジン側ではビルド手順と棋力検証の資料を分けて保存した。ゲームのライセンスとAIの著作権表示・MIT原文・第三者通知は従来どおり維持する。 [穴対応SDKのビルドPR #1](https://github.com/amatouazuwo/shogi-is-luck-engine/pull/1) · [評価・実験のドラフトPR #2](https://github.com/amatouazuwo/shogi-is-luck-engine/pull/2)

## 採用判断

| 対象 | 判断と理由 |
|---|---|
| 穴対応の静的評価補正 | 現行SDKを継続。現行版に7勝4敗、9局打ち切り。未使用の攻め・受け問題には改善と一致が混在し、対局数に対して開始局面が少ない。 |
| 穴対応の探索スライス調整 | 現行Workerを継続。100msの未使用問題では改善した。現行版との100ms対局は4勝4敗、4局打ち切り。独立C++戦は同じ2開始局面に限られる。 |
| 強制負けを検出するガード | 初版は受け問題で悪化。修正版は反例を防いだが予算内に代替手を確定できず、どちらも試作に留めた。次回は本探索の読み筋を再利用し、代替手の追加探索量を下げられるか確認する。 [試作と不採用理由](benchmarks/strength/experiments/obstacle-tactical-guard/README.md) |
| 通常盤面の連続探索 | ゲーム側で100msだけをテスト環境の希望者向けに試す。100msの2つの開始局面群でそれぞれ12勝し、合計24勝7敗、1局打ち切り。通常の入口と500・1500msでは公式Workerを使う。 |

連続探索を試すときは、ゲーム側 [PR #9](https://github.com/amatouazuwo/shogi-is-luck/pull/9) の結果を確認し、該当ビルドがテスト環境に反映されていれば `?engine=continuous100` を付けて「普通」を選ぶ。穴ありは現行の穴対応Workerに切り替わる。ローカルのデスクトップ Chromium と Pixel 7 相当では、通常・特殊の切り替え、中断処理、応答停止時の合法手フォールバックを確認した。準備探索の比較36試行は別の実験として保存した。深さ0は準備なしで12回中3回、準備ありの2条件は各12回中0回で、初期化から初手までの時間は伸びた。 [試験対象と検証結果](benchmarks/strength/RESULTS.md) · [初回探索の比較](benchmarks/strength/experiments/normal-continuous/startup-prime/README.md) · [テスト環境](https://shogi-is-luck-test.onrender.com/)

## 再開時に参照する記録

- [棋力の集計と判断](benchmarks/strength/RESULTS.md) に候補ごとの対局数、未決着局、合法性、比較条件、戦術問題の採点範囲を記録した。旧射線問題の24不一致は1つの飛車モチーフに集中し、AIの王手を伴う成りの後も全応手で元の金取りが可能だった。即時の金取りだけを選ばせる調整は行わない。
- [再現手順](benchmarks/strength/README.md) で公式SDK、比較用C++、凍結した攻め24問・受け12問、対局開始局面、比較ごとのコードとフィクスチャを準備する。旧JavaScript AIとの200局は [従来JS戦の保存先](benchmarks/strength/experiments/old-js) にある。やねうら王・水匠5は比較用としてそれぞれの配布元から取得する。
- 対局を追加するときは、別の開始局面を使い先後1組を完了してから集計する。同じ開始局面を他の予算で使った場合は同じ局面として扱う。手数上限で止まった棋譜は未決着として残す。戦術問題は攻めと受けを分け、必要に応じて相手の全応手と短い勝ち筋を独立実装で確かめる。
