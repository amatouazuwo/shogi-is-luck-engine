# Codex resume brief — 2026-11-27 (draft, verify before using)

## First action: read actual GitHub state
1. Inspect engine draft PR #3 (`chatgpt/strength-ci` based on `codex/strength-evaluation`), latest Actions conclusions and `docs/strength-ci-handover.md`. Inspect results branch `chatgpt/strength-results`. Never assume an in-progress CI has passed.
2. Inspect original work on `codex/strength-evaluation`, engine `HANDOVER.md`, `benchmarks/strength/RESULTS.md`, prior tests and game-side `codex/strength-evaluation`/develop. The user's source-of-truth baseline is the deployed test version, not this new experimental benchmark branch. Read `benchmarks/strength/ci/baselines.json` for named comparison commits, but verify against actual current released binaries.
3. The user should **not** need to remember any SHA. Use documented named baselines, reproducible build hashes and GitHub refs.

## Delegation split
- Codex: determine authentic AI mistakes, implement candidate improvements, inspect tactical proof, decide whether empirical evidence supports promotion.
- Public standard GitHub Actions: build obstacle WASM, run archived attack/escape tests, independent C++ obstacle matches, pinned baseline A/B and normal-board candidate continuous vs stock. Preserve logs and conservative scorecards on dedicated results branch. `report.mjs` explicitly avoids auto-promotion.
- Private game repository: test UI, Worker routing, actual gameplay and Render **test** environment only. No private source copied into the public engine repository.

## Highest-value next experiments
1. **Special boards first**: analyze verified losses and causal root cause rather than old labels that rewarded immediate captures; prove counterexamples across all opponent replies; evaluate candidate versus frozen baseline on new, non-leaked positions for pit and 3x3 blackhole, with color-swapped pairs and capped 100/500/1500ms.
2. **Normal boards next**: isolate the real gain from 100ms continuous search (older reported 33W/14L/1 unfinished but a later cohort was 9W/7L); test new opening families, equal thinking budgets and account for cold start and Worker lifecycle. Consider 500/1500ms only with supporting evidence.
3. **Improve benchmark fidelity**: independent C++ referee intentionally lacks random luck events and treats some repetition/ply-cap outcomes as unresolved. Validate representative legal move and SFEN-transition equivalence versus private live game rules; never publish private assets.
4. **Make comparisons reproducible**: exact pinned source/artifact hash, opening fixture hash, seeded independent starts, representative middle/endgames, distinct train/validation/held-out groups, no redundant budget cohorts counted as independent positions.
5. **Strength is not speed**: log actual wall time and nodes/depth, check matched compute budgets and how behavior responds to time pressure. Record confidence and limitations; no unsupported 'amateur 4-dan' conclusion.

## Safety/operation
- Stay on experimental branches and draft PRs until approved. **Never modify game main or production Render.** Respect engine MIT/third-party notices and game licensing.
- Do not expand into paid GitHub Actions minutes, enhanced runners or services without user's express authorization. Billing information is not accessible from this code workspace; bounded smoke tests only until explicitly cleared.
- Avoid lingering in Codex while tests run. Trigger Actions and return when useful; inspect results next session.
- Commit and push each meaningful checkpoint, complete logs, aborted candidates and negative findings; record run links and handover docs. Update naming in `baselines.json` only after an independently reviewed promotion decision.
- Do not conflate testing two builds from the same algorithm with evidence of strength change. Rust compilation differences can produce distinct WASM binary hashes even with same source and behavior.

## Work to verify before feature-complete claim
- Confirm normal-board CI and conservative scorecard job succeeded, output persisted; if not, fix.
- Validate standing result attribution and A/B symmetry; inspect all games from paired colors.
- Provide configurable, low-budget staged evaluation with true disjoint new positions; full self-play and meaningful human-dan calibration not yet complete.
- Inspect GitHub Actions `workflow_dispatch` visibility on a draft nondefault branch. Do not merge to default solely to enable manual dispatch.

## Diagnostic replay additions (2026-11-22; experimental)
- `benchmarks/strength/ci/match.mjs` now logs `sfenBefore` for every move so exact pre-move positions can be replayed.
- `replay-check.mjs` independently checks logged move legality and SFEN transitions, and extracts up to three non-forced candidate decisions per loss.
- `reply-probes.mjs` investigates up to four such decision points; each checks the played move and at most two unranked legal alternatives, following with bounded 100ms reference responses and one further reference continuation.
- `codex-review.mjs` converts those into `results/codex-review.json`, sorted by rule-terminal condition and differences in reference replies, not by estimated chess strength. The `chatgpt/strength-results` branch archives the full inputs and intermediate reports by run ID once GitHub Actions completes.
- Earlier verified run [45004381190](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45004381190) generated 4 positions and 11 branches for one-reference-reply probes. It does NOT demonstrate move superiority. Recent commits may still be awaiting verification: always check the newest workflow run associated with the PR head before using generated archives.
- **Codex next:** inspect verified `codex-review.json` with `reply-probes.json` and `replay-checkpoints.json`. Identify one real tactical failure, verify against *all* relevant opponent replies, propose a minimal engine candidate change, and test against the pinned baseline on new unseen cases. Do not interpret a different reference reply or forced move as a proven blunder; do not promote an AI based on these diagnostic outputs.

## Proof and fresh-holdout gate (experimental; check CI before trusting)
- `terminal-proof.mjs` is a bounded exhaustive AND/OR verifier for independent referee `no legal moves` terminal outcomes, with repetition, node cap, and search horizon treated as UNKNOWN unless a valid forced result is already proved. Depth is limited to 3 plies after the candidate move in CI (max 300 visited nodes per branch).
- `prove-checkpoints.mjs` compares recorded practical moves with up to two candidate alternatives on at most two archived diagnostic positions. It writes `results/terminal-proofs.json`. Only `SHORT_HORIZON_FORCED_LOSS_VS_WIN` indicates a certified contrast **under this limited referee and horizon**, not full live-game correctness or generic blunder status. Most cases will rightly remain `NOT_PROVEN`.
- `holdout-admit.mjs` provides an intake gate for independently sourced sealed new SFENs with mandatory origin, source ID, timestamp and exact-key deduplication against archived opening sets. **No genuinely new held-out corpus has been obtained or admitted yet.** Exact deduplication is not sufficient to establish unseen training exposure; cases must be independently sourced, checked for legality and kept sealed.
- GitHub Actions tests both the proof logic and holdout admission. Verify the latest successful CI and archived proof results, then inspect potential proof contrasts against complete live-game adjudication, repetition, special events and longer tactical horizons.
- Separate smoke testing from proof, and proof of a tactic from statistical evidence of general chess strength. Require genuinely unseen holdouts, sufficient paired games and explicit approval before proposing promotion.
