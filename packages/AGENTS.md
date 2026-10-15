# packages

## Purpose

- Shared workspaces that apps (and other packages) consume. Each owns one slice of the system and carries its own canonical `AGENTS.md`.
- The roster is this file's `Child DOX Index` below: the only complete list of the `packages/*` docs. Read it to find a package rather than inferring the set from prose, and do not re-enumerate it in the root `AGENTS.md`.

## Ownership

- Project contributors.

## Local Contracts

- All packages extend `@manobu/config` (TS) and reuse the Zod dependency pinned in the root catalog.
- Catalog-pinned versions (React, Tailwind, Zod, ai, lucide-react, sonner, next-themes, etc.) live in the root `package.json` under `workspaces.catalog`.
- Tasks are wired through `turbo.json`; package-level scripts run via `bun run -F <pkg>` from the repo root.

## Work Guidance

_Empty — no package-wide standards documented yet._

## Verification

- `bun run check-types` from repo root — runs each package's `check-types` task via Turbo.
- `bun run check` (Ultracite) from repo root.
- Tests run per-package via `bun run test` (Turbo) — that is the canonical path. A bare repo-root `bun test` substring-matches test files across ALL packages (no --preload/--env-file), which is why `@manobu/env/web` defaults `VITE_SERVER_URL` under `NODE_ENV=test` (TASK-52). Any new test that imports env/web must pass in both invocations.
- `bun run check:dox` from repo root — fails when a `packages/*/AGENTS.md` exists but its directory is absent from the `Child DOX Index` below (same check covers `apps/` and `crates/`). Run it after adding, moving, renaming or deleting any child doc.

## Child DOX Index

- `acp/AGENTS.md` — version-isolated bridge between AI SDK v6 (mcpc provider) and the rest of manobu on AI SDK v7. Spawns agent CLIs over two transports: ACP (opencode, claude-code, gemini-cli, codex, copilot, kilo-code) on stdio JSON-RPC, and direct-cli (Antigravity `agy --print`) as a single-shot V3 model. TASK-22 adds the conversation guard (`conversation-guard.ts`: busy classification + per-session command queue + send-failure taxonomy) and the MCP catalog (`mcp.ts`: `mcp-servers.json` file-over-env, http/sse passthrough).
- `jlpt-mcp/` — publishable npx shim (`@manobu/jlpt-mcp`) resolving the Rust sidecar binary (TASK-22 Tier C3; manifest carries `manobu.acpRegistry` healthCheck metadata). The Rust MCP server itself lives in `crates/jlpt-mcp`.
- `agent/AGENTS.md` — Teacher Agent orchestrator (TASK-1.16). Routes a learner message to one of four sub-agents (ConversationCoach, GrammarExplainer, KanjiTutor, VocabSRS) via keyword intent classifier; provider registry (Google/OpenAI/Anthropic/Ollama) is an interface only in v1.
- `api-contract/AGENTS.md` — oRPC contract-first API surface (TASK-71): zod schemas + `oc` procedure contracts, implemented by `apps/server` and consumed by `apps/desktop`. A boundary leaf importing only zod and `@orpc/contract`, which is what keeps server runtime out of the webview bundle. Owns the single declaration of the JLPT level vocabulary and the exam item-type / section / mode enums, the `ChatFrame` union, and the ORPC error codes.
- `chat-session/AGENTS.md` — the chat-session deep module: ChatSessionProvider, useChatSession, message-transcript, fetcher (`queryOptions` + `useQuery` TanStack Query, hierarchical keys, `signal`), persistence, types. Any chat-shaped surface (`/ai`, `/chat/history`, `/dev/chat-history`, future inline widgets) mounts the Provider inside the host's `QueryClientProvider`. The persisted-conversation reads (history list, single conversation, transcript rows) live in the `./history` subpath (TASK-101).
- `config/AGENTS.md` — shared TS base.
- `db/AGENTS.md` — Drizzle ORM + libSQL data layer; content migrations + sqlite-vaporetto runtime (TASK-23.1/49/53 — patched extension, ext resolution that works inside compiled binaries, tokenizer upgrade unicode61→vaporetto on existing dbs), split build/typecheck tsconfigs (dist emits src only).
- `env/AGENTS.md` — Zod-validated env vars (server + desktop).
- `item-engine/AGENTS.md` — pure shared JLPT item contract: named-reason validation, deterministic due/weak/new selection and the single attempt-to-FSRS grade mapper.
- `japanese/AGENTS.md` — JLPT corpora (vocab, grammar, conjugation, kanji, pitch-accent) data + fetch scripts; consumed by the Rust MCP server `crates/jlpt-mcp` (no TS engine — lookup logic was ported to Rust); JSON files also exposed to TS apps via `@manobu/japanese/data/*` subpath exports.
- `skills/AGENTS.md` — Markdown skill loader (TASK-1.16). zod-validated frontmatter (`name`, `description`, `agent`); resolution order node_modules → `.manobu/skills/` → `~/.manobu/skills/`.
- `speech/AGENTS.md` — **speech domain** (screaming architecture): TTS / STT / VAD via sherpa-onnx, Tauri Rust `apps/desktop/src-tauri/src/speech/` + TS `@manobu/speech`. Offline, on-device.
- `srs/AGENTS.md` — FSRS math (params + interval logic) consumed by apps/desktop (`lib/review.ts`) and the Tauri `fsrs` commands.
- `ui/AGENTS.md` — shadcn/ui primitives + tokens.
