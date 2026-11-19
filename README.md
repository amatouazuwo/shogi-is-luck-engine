# shogi-is-luck-engine

## Current direction (2026-11-19)

The YaneuraOu experiment is on hold. Preserving the game's independent license is mandatory; playing strength is the primary ranking criterion among eligible engines. No GPL engine integration is authorized for the game. Preserve the prior experiment for reference only.

Candidates: rsshogi-nnue-mini (MIT source, model and dependency terms pending), OpenShogiAI (WASM, license audit pending), Sekirei (MIT/Apache-2.0 source, separate model terms), Sunfish4 and lbase-shogi. Before integration, verify exact source revision, dependencies, model redistribution rights, provenance, browser build, legal moves, special rules, measured strength and mobile performance. Test environment only; production requires explicit approval.

## Archived experiment

# shogi-is-luck-engine

Experimental WebAssembly build of [YaneuraOu](https://github.com/yaneurao/YaneuraOu) for the browser game *将棋は運ゲー*.

## Status

- The first GitHub Actions build produced `yaneuraou.js` and `yaneuraou.wasm` (2026-11-18).
- The selected engine architecture is `SFNN_ka2_2048_8_64_progress8`, intended for **つようら王11micro**.
- The browser runtime, 11micro evaluation weights, search/USI move output, performance, and special-board behavior **are not yet verified**.
- The initial engine was built *without* `nn.bin`; its successful build does not establish playing strength.
- A follow-up workflow tests only the engine's USI identification response.

## Rebuild and test

Run GitHub Actions: [Experimental 11micro WASM build](../../actions/workflows/build-wasm.yml).

The workflow installs Emscripten, clones the upstream YaneuraOu source, compiles the engine, saves its source revision, and uploads build artifacts. The test invokes `usi` and requires the `usiok` response; it does not invoke `isready` or `go`.

Do not copy the experimental build to the production game until the following are verified: actual 11micro weights and license notice; browser Worker compatibility and cross-origin-isolation requirements; memory and speed on smartphones; USI search and legal moves; unusual initial boards and persistent special events; source-distribution obligations.

## Upstream and licenses

- [YaneuraOu](https://github.com/yaneurao/YaneuraOu) is under **GPLv3**. Redistribution of the WASM build requires the corresponding source and other applicable GPL compliance.
- [つようら王11micro official announcement](https://yaneuraou.yaneu.com/2026/10/14/tsuyou-11-mini-micro-released-under-mit-license/) describes its evaluation parameters as **MIT-licensed**. The evaluation file is distributed separately by its author and is **not** currently bundled here.
- Keeping the engine in a separate repository or communicating with it via a Worker does **not by itself** establish that other parts of an application are exempt from GPL obligations.

This is an experimental integration repository, not a confirmed GPL-compliant release package.

## Required cleanup after test integration

User requested removal of obsolete YaneuraOu / TuyouraOu workflows, scripts and assets after rsshogi test-environment integration and verification succeed. Inventory references first; retain shared code and legally required notices for any retained components. Do not rewrite history or modify production without approval.

## Release gate and special moves

As of 2026-11-19: SDK embeds model and includes MIT LICENSE; v0.4.0 release identifies same model as v0.3.0. Cargo metadata declares permissive dependencies. Explicit model redistribution rights and training provenance remain unconfirmed; no public deployment pending clarification. Game legal moves are authoritative: if any legal move captures the opposing king, select it before any engine search or fallback. Adapter fixture suite passed 40 simplified formations (run 44460044227); actual game generator and end-to-end testing remain pending.

User approved browser-first development with the unmodified official SDK. Continue isolated development and testing; unresolved model rights remain a release gate, and production deployment requires explicit approval.

Special rules: use the term 落とし穴 (pitfall), not rock. Never forecast untriggered random events. Search only the current granted move; two-move events do not require planning a pair before the lottery. At every CPU turn, across all present and future event types, any legal opposing-king capture takes priority before engine search or candidate pruning. The special tactical candidate cap of 12 is provisional pending performance and strength tests.
