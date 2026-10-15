# crates

## Purpose

- Rust workspace members for manobu. Currently one crate: `jlpt-mcp` — the stdio MCP server for the JLPT corpora, ported from the former TypeScript engine (`apps/jlpt-mcp` + `@manobu/japanese` lookup code) to shrink the bundled desktop binary (104 MB bun-compiled → ~5 MB) and cut runtime footprint.

## Ownership

- Project contributors.

## Local Contracts

- `jlpt-mcp` — stdio MCP server exposing lookup/search/list tools over vocabulary, grammar, conjugation, kanji, pitch-accent and sentences, plus deterministic `drill_candidates` corpus sources for the shared item engine. Bundled as a Tauri sidecar; data is embedded (gzipped) from `packages/japanese/data/` at build time via `build.rs`.
- Crates are standalone (no workspace `Cargo.toml` yet): each is built with `cargo build --release` inside its own directory, then synced by `apps/desktop/scripts/sidecar-dev.sh` and resolved by Tauri's `bundle.externalBin`. A Windows target needs no crate code (jlpt-mcp has no libc, no signals, and its `build.rs` only gzips JSON into `OUT_DIR`): `cargo xwin build --release --target x86_64-pc-windows-msvc` moves the output to `target/<triple>/release/jlpt-mcp.exe`, which `apps/desktop/scripts/sidecar-stage.sh` stages under the triple-named `externalBin` path (TASK-177).

## Work Guidance

- **Rust formatting is gated (TASK-97, widened to both crates by TASK-98)**: `crates/jlpt-mcp` and `apps/desktop/src-tauri` are rustfmt-clean and `.husky/pre-commit` runs `cargo fmt --check` for each whenever a `.rs` file under that crate is staged. The crates are standalone, so each is checked through its own `--manifest-path`. Run `cargo fmt --manifest-path <crate>/Cargo.toml` before committing; do not hand-format or suppress. The reformat revs are listed in `.git-blame-ignore-revs`; `git blame` needs `blame.ignoreRevsFile` configured locally to honor them.
- Data + engine parity: `crates/jlpt-mcp/tests/parity.rs` drives the built binary over raw JSON-RPC and diffs against `tests/golden.json` (captured from the original TS engine). Keep the crate byte-compatible with that golden — on both the default and `--features vaporetto` paths (TASK-23.1).
- Binary size is a first-class goal: `[profile.release]` uses `opt-level = "z"`, `lto`, `strip`, `panic = "abort"`, and data is gzipped at build time.
- Protocol hygiene: stdout is the MCP JSON-RPC channel — never write to stdout except via the transport; diagnostics go to stderr.

## Verification

- `cargo test` inside `crates/jlpt-mcp`.
- Live MCP smoke: pipe `initialize` → `tools/list` → `tools/call` NDJSON lines into the built binary.

## Child DOX Index

- `jlpt-mcp/AGENTS.md` — the JLPT stdio MCP server crate.
