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
