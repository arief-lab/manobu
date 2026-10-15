# packages/env

## Purpose

- Zod-validated environment-variable adapter built on `@t3-oss/env-core`. Split into two entry points: server-side parsing of `process.env`, client-side parsing of `import.meta.env`.

## Ownership

- Project contributors.

## Local Contracts

- Exposes
  - `@manobu/env/server` — server env. Required: `DATABASE_URL`, `CORS_ORIGIN`. Optional: `NODE_ENV` (defaults `development`), `CONTENT_DATABASE_URL`, `ACP_AGENT_BIN`, `ACP_MCP_SERVERS`, plus `ASK_TIMEOUT_MS` / `CONFIRMATION_TIMEOUT_MS` as positive-integer-ms overrides for the host `ask_user` tool deadline and the engine park backstop (unset keeps the code defaults 25/30 min, TASK-88).
  - `@manobu/env/web` — web env (`VITE_*` prefixed; currently `VITE_SERVER_URL`).
- Depends on
  - `@t3-oss/env-core`, `zod`, `dotenv` (server entry).
- Validation rules
  - Both entries: `SKIP_ENV_VALIDATION=1` skips validation (CI escape hatch); `emptyStringAsUndefined: true`.
  - Server entry auto-loads `dotenv/config` and defaults `NODE_ENV` to `development`.
  - Web entry under `bun test` (TASK-52): bun sets `NODE_ENV=test` but supplies no Vite env, so `VITE_SERVER_URL` defaults to `http://127.0.0.1:4317` when unset under test — any test file importing `@manobu/env/web` validates regardless of invocation context (per-package, repo-root `bun test`, CI without `.env`). Outside test, unset `VITE_SERVER_URL` still throws (strictness unchanged). No test hits the network; per-package setups (desktop `test/setup.ts` preload, chat-session `.env.test`) still win when present.

## Work Guidance

- **One declaration per operator-set variable, and reads go through `env`.** Anything a human or the Tauri sidecar sets that the app reasons about gets a schema field here with a comment naming its default and consumer; call sites import `@manobu/env/server` (or `/web`) rather than touching `process.env`. A variable read both ways is the failure mode this prevents: the raw path skips validation and `emptyStringAsUndefined`, so `FOO=` means "empty string" at one site and "unset" at the other. `packages/db/src/index.ts` is the case this rule just closed: it imported this package for `env.DATABASE_URL` while `createContentDb` read `process.env.CONTENT_DATABASE_URL` raw.
- Legitimate exceptions, each carrying its reason at the site. Do not add a sixth family without one:
  - `BUN_PORT` (`apps/server/src/index.ts:195`): Bun's auto-serve owns it and an explicit `Bun.serve({port})` broke SSE, so declaring it here invites that mistake again.
  - Boot-boundary paths and plumbing in `apps/server`: `MANOBU_DATA_DIR` (`data-dir.ts:27`), `MANOBU_ASSISTANT_DIR` (`assistant-loader.ts:84`), `ACP_CHILD_REGISTRY` (`context.ts:54`), `MANOBU_HOST_TOOLS_URL` / `_TOKEN` (`ask-tool.ts:278`).
  - Workspace libraries, which must stay usable without the app's schema: `ACP_AGENT_BIN` and `PATH` in `packages/acp` (it does not depend on `@manobu/env` at all), the libsql extension and model paths in `packages/db/src/vaporetto.ts:106`.
  - `packages/db/drizzle.config.ts:10`: the drizzle-kit CLI loads `apps/server/.env` itself, and importing the server entry would fail on the required `CORS_ORIGIN`.
  - Test fixtures that assign `process.env.DATABASE_URL` before importing the module under test (`apps/server/test/harness.ts` note): the assignment is the fixture.
- `apps/server/.env.example` is the only discoverable list of what the server needs; update it in the same change as a schema field.

## Verification

- `bun run check-types` from repo root.
- `bun run check` (Ultracite) from repo root.

## Child DOX Index

_None._
