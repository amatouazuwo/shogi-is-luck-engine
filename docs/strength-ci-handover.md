# Public strength CI checkpoint (2026-11-22)

Base: codex/strength-evaluation at 56d5c1ca0e651bd73aaa717ca520b7f9309fb3e6.
Separate branch: chatgpt/strength-ci. No game repository or deployment changes.

## Current implementation
- .github/workflows/strength-independent.yml: standard ubuntu-24.04, Node 22, Rust 1.95, existing obstacle SDK build, archived attack/escape tactics and paired obstacle matches.
- benchmarks/strength/ci/referee.cpp: adapter around the existing public independent C++ reference. No private game checkout.
- benchmarks/strength/ci/match.mjs: frozen archived opening pairs, SFEN advancement by referee, equal search budgets, 3-minute clocks, both colors, JSONL logs and summaries. Repetition and ply caps remain undecided; this is not full live-game adjudication. No random luck events.
- Initial workflow run: https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/44998960921 . Check actual conclusion before claiming success.
- Default 100 ms, one opening pair per variant, 20-ply cap, four games. Smoke only, not strength evidence. Archived fixtures are not new unseen data.
- Logs and job summaries are recorded, artifacts retained 3 days. Permanent automated result commits are NOT yet implemented. Preserve important results before expiry.

## Next steps
1. Inspect CI and fix any build, serialization, protocol or legality failures. Verify independent legal move sets against SDK at each ply; validate SFEN round trips and completion.
2. Add permanent compact JSON/CSV summaries and replay records on dedicated results branch, with narrowly scoped write job and no secrets/private sources, unique run IDs, serialized pushes. Avoid publishing sensitive paths or data.
3. Add candidate/baseline build inputs with pinned commit SHA and hashes, independent comparison modes, frozen disjoint openings, paired confidence intervals, bounded sharding and resumable checkpoints. Runner accepts optional baseline SDK locally but CI does not yet build it.
4. Add normal-board official SDK versus continuous worker on standalone fixed public positions, and new untouched obstacle fixtures. Do not copy private game source.
5. Check public standard runner eligibility and storage settings; no paid runners, no additional fees without approval. Keep runs bounded. Do not change production or existing Codex branches.
6. PR is a draft against codex/strength-evaluation; merge only after verification. Manual dispatch may require workflow on default branch; do not merge main merely to enable it. Branch push smoke is available.

Prior development history remains in HANDOVER.md and benchmarks/strength/RESULTS.md. This checkpoint is a preliminary foundation, not a completed validated benchmark system.

## Follow-up checkpoint
- Run 44999465588 succeeded including archive job. Permanent records: chatgpt/strength-results, results/44999465588/1. 100ms, 120 plies, 7 wins / 4 losses / 1 undecided against independent reference, all six candidate-black games won. Archived openings, not new evidence of improvement.
- Legal set reconciliation added at 2eac0225; check run 44999479871 for actual outcome.
- Workflow c9886cce adds direct paired comparison versus a separately built pinned baseline (default 56d5c1ca0e651bd73aaa717ca520b7f9309fb3e6); push smoke 1 pair per variant, 60 plies, 100ms; identical engine source smoke is not evidence of improvement. Verify CI and results branch before adoption.
- Archive job now implemented and verified for earlier workflow; direct.jsonl and revisions.jsonl added to next archive schema. No normal-board comparison yet. Earlier TODOs above are historical; do not repeat completed work.
