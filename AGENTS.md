# AGENTS.md

You are an expert in JavaScript, Rspack, Rsbuild, Rslib, and library development. You write maintainable, performant, and accessible code.

## Repository layout

This is a **pnpm workspace monorepo**. Engine-agnostic code lives in `core`; each engine gets its own adapter package which re-exports all of `@qframework/core`.

- `packages/core` (`@qframework/core`) — engine-agnostic core, no engine dependency
- `packages/laya` (`qframework-laya`) — LayaAir adapter
- `packages/fairygui-babylon` (`qframework-fairygui-babylon`) — FairyGUI on Babylon.js adapter
- `tests/` — Rstest suites; `tests/laya-stub.ts` injects a minimal global `Laya` before test modules load
- `docs/` — `GETTING-STARTED.md` (tutorial), `API.md` (API reference), `MIGRATION.md` (C# → TS). `README.md` is the overview.

Docs conventions:

- All code samples import from the engine package (`qframework-laya` / `qframework-fairygui-babylon`), because both re-export `@qframework/core`. `@qframework/core` is only used when no engine is involved.
- `tests/docs-examples.test.ts` verifies that the samples in `docs/GETTING-STARTED.md` actually run. Update it whenever those samples change.

## Commands

- `pnpm install` - Install workspace dependencies
- `pnpm run build` - Build every workspace package (recursive)
- `pnpm run dev` - Watch mode, rebuild all workspace packages in parallel
- `pnpm run typecheck` - Type check workspace packages and tests (strict)
- `pnpm run test` - Run tests
- `pnpm run test:watch` - Run tests in watch mode

## Docs

- Rslib: https://rslib.rs/llms.txt
- Rsbuild: https://rsbuild.rs/llms.txt
- Rspack: https://rspack.rs/llms.txt
- Rstest: https://rstest.rs/llms.txt
