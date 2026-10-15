# apps

## Purpose

- Deployable workspaces for manobu. Each app has its own build, dev loop, and runtime; depends on `@manobu/config` for TS base and `@manobu/env` for validated environment variables.

## Ownership

- Project contributors.

## Local Contracts

- `server` — Hono HTTP API on Bun.
- `desktop` — React 19 SPA on Vite + TanStack Router, also the Tauri desktop shell.
- Apps declare their dependencies on shared packages (`@manobu/db`, `@manobu/ui`, etc.) per tier boundary; never duplicate shared logic locally.

## Work Guidance

_Empty — no app-wide standards documented yet._

## Verification

- `bun run check-types` from repo root — runs each app's `check-types` task via Turbo.
- `bun run check` (Ultracite) from repo root.

## Child DOX Index

- `server/AGENTS.md` — Hono HTTP API.
- `desktop/AGENTS.md` — React SPA + Tauri shell.
  - `desktop/src/AGENTS.md` — SPA entry points, path aliases, subdir layout (components / hooks / lib / routes), per-route loader audit table (TASK-25.1).
  - `desktop/src/components/AGENTS.md` — SCR compounds grouped by data-fetching tier (Tier 1 async-wired / Tier 2 local-state / Tier 3 props-driven) per TASK-25.1; Vercel composition contract.
  - `desktop/src-tauri/AGENTS.md` — Tauri v2 shell (Rust binary + capability allowlist + Tauri commands registry).
