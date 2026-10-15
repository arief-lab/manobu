---
id: doc-1
title: >-
  AionUi deep dive - Cron, ACP agent workflow, MCP and Zed ACP - adoption for
  manobu
type: specification
created_date: '2026-09-06 04:04'
---

# AionUi Deep Dive — Cron, ACP Agent Workflow, MCP and Zed ACP — Research and Adoption for manobu

> **Status:** research / specification  
> **Date:** 2026-09-06  
> **Sources:** `iOfficeAI/AionUi` `main` @ `5de292e` (GitHub + DeepWiki), `zed-industries/zed` `main`, `zed.dev/docs/ai/external-agents`, `zed.dev/acp`, `agent-client-protocol` spec  
> **Manobu context:** `manobu-gg` Tauri v2 desktop (`apps/desktop` Vite+React 19 + `src-tauri` Rust), Hono server sidecar (`apps/server`), `@manobu/acp` + `@manobu/speech` (sherpa-onnx), `crates/jlpt-mcp` Rust MCP sidecar, `@manobu/japanese` corpora  
> **Companion docs:** `docs/agent-switching-like-aionui.md`, `docs/agent-stack-gaps-vs-aionui.md`, `backlog/docs/research/doc-2 - Japanese-datasets-sqlite-vaporetto…md` (datasets + `sqlite-vaporetto` FTS5 tokenizer — interacts with this doc, see §5.3)

---

## 0. TL;DR — What AionUi does that manobu should steal

AionUi is not a chat UI — it is a **Cowork OS**: Electron `packages/desktop` + Rust `aioncore` (`aionrs` embedded agent + process supervisor) hosting many long-lived agent processes and surfacing them in **one** window, with **cron** turning chat into daemon jobs, **ACP (Agent Client Protocol)** turning vendor CLIs into plug-in runtimes, **MCP (Model Context Protocol)** turning tools into shared config, and **Team MCP** turning one instruction into parallel sub-agents. Zed validates the same ACP contract from the editor side: editor hosts the UI, agent owns runtime/auth/model — connected by `stdio JSON-RPC`.

For manobu the value is not "clone AionUi". It is three concrete upgrades already scaffolded but thin:

| AionUi subsystem | What manobu has today | Highest-leverage adoption |
|---|---|---|
| **Cron — 24/7 unattended** | Nothing. FSRS reviews, weak-pattern queues, JLPT mocks are manual. | Add **cron-shaped scheduled runs**: daily review nudge, weekly JLPT mock generation, nightly weak-pattern → quiz rebuild — bound to a conversation so context carries. |
| **ACP agent workflow — 3-layer V2** | `packages/acp` single-bridge (`packages/acp/src/registry.ts` 6 agents, `packages/acp/src/launch-policy.ts`, `packages/acp/src/mcp.ts` capability negotiation, `apps/server/src/index.ts` single `let acp` session + `GET /agents/:id/models` hot-switch). No per-conversation pool, no command queue, no busy/error classification. | Harden to **per-conversation session pool + command queue + `session_active` state machine** exactly like ACP V2 — then agent switching is not a restart. |
| **MCP — 4 transports + unified mgmt** | One stdio Rust sidecar `crates/jlpt-mcp` (gzipped corpora, 5 MB) exposed via `ACP_MCP_SERVERS=jlpt-vocab:stdio:<bin>` in `src-tauri/src/lib.rs`. Works, but single server, no HTTP/SSE, no OAuth, no browser CDP bridge. | Adopt **unified MCP catalog**: declare JLPT + future speech/tools servers once, sync to every ACP backend per `mcpCapabilities.stdio/http/sse`; capability-filter at `initialize` (already done in `packages/acp/src/mcp.ts:negotiateMcpServers`). |
| **Zed/ACP contract** | Zed's ACP is the open standard manobu already speaks (`@mcpc-tech/acp-ai-provider`, `unstable_setSessionModel`). Manobu never exposes it as a registry install. | Publish an **ACP registry entry** for the JLPT MCP so Zed/Neovim and AionUi can reuse the same sidecar — free distribution. |

---

## 1. Cron & Scheduled Tasks — How AionUi Turns Chat Into a Daemon

### 1.1 What the user sees

README `Scheduled Tasks — Cowork on Autopilot` (`AionUi/readme.md`): one schedule definition → AI agent runs autonomously `24/7` while the app is awake. Three scheduling modes, two execution modes, natural-language creation via `/cron` skill, and full management UI.

| Dimension | Details | Reference |
|---|---|---|
| **Scheduling modes** | (1) **Cron expression** 5-field standard with **timezone** (e.g. `0 9 * * 1` + `Asia/Shanghai`), (2) **Fixed interval** every N `minutes`/`hours`, (3) **One-time** datetime then auto-disable | `CreateTaskDialog.tsx:61-110` |
| **Execution modes** | (1) **Continue in existing conversation** — each run **appends** to the bound `conversationId`, full history retained (good for follow-ups), (2) **Create new conversation each time** — fresh session per trigger (good for independent reports) | `CreateTaskDialog.tsx:101-105`, `TaskDetailPage.tsx:149-160` |
| **AI-created tasks** | Any agent can create a scheduled task during a live conversation (the `/cron` skill). Prompt text + workspace + agent/model are task fields. | `cron.json:16`, `ScheduledTasksPage/index.tsx:65-67` |
| **Power management** | `Keep Awake` toggle calls OS power-save blocker while tasks are armed; on wake it **detects missed triggers** and fires them. Banner warns `tasks only run while computer is awake`. | `ScheduledTasksPage/index.tsx:43-53,168-181` |
| **Persistence** | Tasks + run history stored in SQLite via `ipcBridge.cron` (`createJob / updateJob / runNow / deleteHistory`). Search/filter over `name, description, prompt, agent type`. | `useCronJobs.ts:135-153`, `index.tsx:74-99` |
| **Lifecycle controls** | `enabled` pause/resume, `Run Now` (manual invoke → poll `15s` for conversation init → title `formatCronRunConversationTitle` with timestamp), execution history + batch delete, optional **queue protection** (`skip if previous run still running`). | `TaskDetailPage.tsx:10-11,107-164`, `cron.json:86-88` |

### 1.2 How it is built

```
Renderer (CreateTaskDialog / ScheduledTasksPage)
   │  ipcBridge.cron.{createJob,updateJob,runNow,deleteHistory}
   ▼
Main process (aioncore cron scheduler)
   │  ICronJob {id, prompt, cronExpr|interval|oneTime, tz, workspace, agent, model, executionMode, enabled, keepAwake}
   │  cron parser ← parseCronExpr / parseCustomSchedule (reverse-engineer "*/5 * * * *" → 5 min)
   │  timezone repair ← repairCronJobTimeZone (Intl.DateTimeFormat().resolvedOptions().timeZone on tz missing/invalid)
   │  ticker → at trigger: resolve conversation (existing vs new) → send message → await agent runtime
   ▼
Conversation runtime (per agent — gemini / acp / aionrs)
```

Key invariants from `4.9-cron-and-scheduled-tasks`:

* **Conversation-bound, not global.** Each `ICronJob` holds a `conversationId`. The run is just `sendMessage(conversationId, prompt)` — so history, workspace, model, and permission mode are inherited.
* **Timezone-anchored.** `tz` is stored. `repairCronJobTimeZone.ts:14-22` + `cronUtils.ts:77-84` rewrite stale jobs to the current system zone on every load — prevents `9am Shanghai` drifting after travel.
* **Keep-awake is explicit.** Not "always on". Toggle via `powerSaveBlocker` in Electron main; UI surfaces the invariant.
* **Queue protection is a user setting.** Without it, overlapping runs interleave in the same conversation; with it, `cron.json:86-88` skips the tick if `conversationBusy`.
* **Parsing is reversible.** `parseCronExpr` ↔ `buildCronExpr` let the visual builder (`daily/weekly/monthly` checkboxes) round-trip an advanced raw cron string.

### 1.3 Relevance to manobu

Manobu already has the *jobs* — it just runs them manually:

| Manobu job that wants to be a cron | AionUi mode to copy | Why it wins |
|---|---|---|
| **FSRS due nudge** — `review.ts:batchNext` + `previewGradeIntervals` + `srs-optimize` | Interval `every 24h 8:00 Asia/Tokyo` → `Continue in existing conversation` with Sensei persona | Offline, no server. Tauri can `setTimeout` + `powerSaveBlocker` same as AionUi; notification via `sonner` toast. |
| **Weekly JLPT mock generation** — `mock.ts:deriveWeakPatterns` → `weak-pattern-queue.ts:buildWeakPatternQueue` | Cron `0 9 * * 1` → `Create new conversation each time` | Each mock is independent; fresh conversation avoids leaking prior answers. |
| **Nightly weak-pattern → quiz rebuild** — `queue.ts:pickCardsWithFallback` + `next-cards.ts:loadLocalNextCards` | `Every 6 hours` interval, `Continue` mode | Keeps `lesson.tsx` queue warm without user tap. |
| **Daily sentence shadowing** — future `TASK-21.5` Zipformer live loop | `Daily 19:00` with `aionrs`-like on-device STT | Requires manobu's offline speech stack — no AionUi equivalent. |

**Adoption sketch (Tauri-shaped):** reuse AionUi's `ICronJob` shape in `packages/cron` (or `apps/desktop/src/lib/cron.ts`) with `tauri-plugin-autostart` + Rust `cron` crate ticks, `app_data_dir/cron/jobs.json` persistence, `ipcBridge` → `invoke("cron_create_job")`. UI is a single `ScheduledTasksPage` clone (table + `CreateTaskDialog` with `cronUtils` presets). Keep-awake via `tauri-plugin-power`.

---

## 2. Agent Workflow — ACP (Agent Client Protocol)

### 2.1 What ACP is (Zed-grade definition)

ACP is a **bidirectional `JSON-RPC 2.0` over `stdio`** open spec (`zed.dev/acp`, `github.com/zed-industries/agent-client-protocol`, Apache-2.0). Roles:

* **Client** = editor/host (Zed, AionUi Electron renderer → `aioncore` / `acp_thread`). Initiates `initialize`, creates `sessions`, sends `prompt`.
* **Agent** = CLI process (`claude`, `codex`, `gemini`, `opencode`, `aionrs` …). Owns runtime/auth/model/tools, speaks ACP over `stdin/stdout`.

Version is negotiated once (`protocolVersion: uint16`), then frozen — only breaking changes bump it. All transports are `UTF-8` `stdio`; HTTP/SSE appear only for **MCP** (see §3), not for ACP itself.

### 2.2 AionUi's ACP Agent Architecture V2 (three layers)

`docs/4.2-acp-agent-architecture-(v2)` — the post-legacy refactor. Layers are explicit:

**Layer 1 — Infrastructure (process)**

* Main Rust process spawns the CLI via `ShellBuilder` + `Stdio::piped()` (`agent_servers/src/acp.rs:27-31`), captures `stdin/stdout/stderr`, logs via `AcpDebugLog` (`acp.rs:193-199`), parses each line as `Request | Response | Notification` (`AcpDebugMessage::parse_line 84-105`).

**Layer 2 — Session (protocol state)**

* `AcpRuntime` owns many sessions across many conversations.
* **State machine per session** (tracked in renderer as `acpStatus` in `useAcpMessage.ts:114-116`):
  `connecting` → `connected` (transport handshake OK) → `authenticated` (credentials accepted) → `session_active` (ready for prompts) → `disconnected | error`.
* `available_commands` + `config_options` + `config_options.model` are negotiated at `initialize` and can change mid-session via `session/update` notifications — forwarded to the UI catalog.

**Layer 3 — Application/Runtime (renderer)**

* `useAcpMessage` (`useAcpMessage.ts:23-43`) — streaming + status + token accounting; thought throttling `50ms` (`120-149`), thinking block lifecycle (`activeThinkingRef 160-189`, `status: 'done'` on tool arrival), slash-command mapping (`available_commands → "/" 47-64`).
* `useAcpConfigOptions` (`useAcpConfigOptions.ts:18-21`) + `AcpSendBox` (`AcpSendBox.tsx:106-114`) — model selector + thought-level dropdown.
* `ConversationRuntimeViewStore` (`conversationRuntimeViewStore.ts:9-20,66-70`) — single source for `isProcessing / canSend` per conversation.
* `useConversationCommandQueue` (`useConversationCommandQueue.ts:82-86,216-230`) — validation (length/file-count/state-size) + enqueue + **auto-drain when runtime becomes idle** — prevents `prompt` race when the agent is still streaming.

**Model switching is hot, not a restart:**

```
user picks model in AcpModelSelector (3 states: disabled / read-only / dropdown useAcpModelInfo.ts:69-72)
 → selectModel(modelId) → provider.setModel → connection.unstable_setSessionModel({sessionId, modelId})
 → observed confirmation → ConversationRuntimeViewStore update (193-198) → toast switchSuccess
 → if agent kills process on switch, ChatConversation.tsx:152-161 rebuilds it transparently
```

`AcpConnection` lifecycle (`acp_thread/src/connection.rs:91-260`): `new_session(sessionId)`, `load_session` (replay history), `resume_session` (attach without replay), `close_session`, `prompt(promptRequest)`, `cancel()`, `authenticate(authMethodId)`. `SessionStore` (`agent/src/agent.rs:203-212` + `thread.rs:143-149`) tracks `ref_count` and `SubagentContext {parent_thread_id, depth, MAX_SUBAGENT_DEPTH=1}` for Team delegation.

### 2.3 Zed's ACP contract (editor side)

`zed.dev/docs/ai/external-agents` + `crates/acp_thread` + `crates/agent_servers`:

* Host = Zed `Agent Panel + Threads Sidebar`. External Agent is a separate OS process (billing/auth/model between user and provider; `Zed never stores code without consent`).
* Install via `ACP Registry` (`zed: acp registry` → `agent: open settings` → `External Agents → Add Agent → Install from Registry`). Each entry is `agent_servers` JSON: `command, args, --acp` flag, `mcpCapabilities`, `healthCheck.versionCommand`.
* Import threads: poll listed agents via `session_list` (`connection.rs:252-255`), add missing archived sessions.
* MCP forwarding: Zed-configured `context_servers` (MCP) forwarded over ACP; native agent MCP config also read.
* Permissions: `AllowOnce / AllowThread / AllowAlways / Deny` sandbox (`acp_thread.rs:136-141`); tool cancel returns `TOOL_CANCELED_MESSAGE`.
* Compaction: `ThreadStore` (`thread_store.rs:1-27`) auto-compacts at `MIN_COMPACTION_CONTEXT_WINDOW 80_000 tokens`, retaining `COMPACTION_RETAINED_USER_MESSAGES_BYTE_BUDGET`.

### 2.4 Manobu's current ACP vs the V2 shape

| Concern | AionUi / Zed V2 | Manobu today (`packages/acp`) | Gap |
|---|---|---|---|
| **Registry** | JSON/extension manifests, health-check `versionCommand`, `connectionType cli/stdio/http`, `apiKeyFields` | `registry.ts` `AgentSpec[]` (opencode, claude-code, gemini-cli, codex-cli, gh-copilot, kilo-code) + `listAgentCandidates()` PATH scan | Type-checked and fine — but not pluggable without a rebuild. Already sufficient for Tier 1. |
| **Launch policy** | `acp_launch_policy.rs` → `CommandSpec` per `{agent, mode, resume, cwd}` | `launch-policy.ts:applyLaunchPolicy` ✅ landed | Parity achieved. |
| **MCP negotiation** | Capability-filter at `initialize` against `mcpCapabilities {stdio,http,sse}` | `mcp.ts:negotiateMcpServers` ✅ landed, warn-skip on mismatch | Parity achieved for stdio; `http/sse` unused (no server). |
| **Session lifecycle** | Per-conversation `Session` + `ref_count` + `resume/load/close` + state machine | Single module-level `let acp: AcpModelResource` in `apps/server/src/index.ts` (warm-TTFT optimization) | ** Biggest gap — agent switch = restart server**; no `acpStatus` state machine in UI, no `close_session` on switch. |
| **Command queue** | `useConversationCommandQueue` enqueue + auto-drain on idle + validation | Direct `POST /learn/chat` SSE `useMutation` + `AbortController` in `$sessionId.tsx` | No queue — overlapping sends can interleave; add a thin queue if cron or rapid taps fire. |
| **Error taxonomy** | `buildSendFailureError` → `{code, owner, resolution: reconnect_agent|wait|fix_path|retry}` | Raw `throw Error` from `acp` bridge | Needs a `classifyBusyError` guard + localized error card. |
| **Thinking blocks** | `activeThinkingRef` with `50ms` throttle, `thinking status done` on tool arrival | `streamdown` renders thinking as markdown | Low priority for manobu's Sensei, but reuse throttle if streaming gets long. |

**What already landed toward AionUi parity:** `docs/agent-stack-gaps-vs-aionui.md` Tier 1 (1.1 registry table ✅ `90c7981`, 1.2 launch policy ✅, 1.3 MCP negotiation ✅) and Tier 2 (2.1 `direct-cli` route `routeFor()` for Antigravity `agy` ✅, 2.2 model catalog forwarder partial — `GET /agents/:id/models` + header dropdown). Tier 3 (orphan registry, parent-pid self-terminate, `MANOBU_DATA_DIR`, nvm PATH augmentation) blocked on AppImage being a real target.

---

## 3. MCP — How AionUi Shares Tools Across Every Agent

### 3.1 The data model

`IMcpServer` in `common/config/storage.ts:11-25` — persisted via `ConfigStorage`:

```ts
IMcpServer { id, name, command, args, env, transport: 'stdio'|'sse'|'http'|'streamable_http', url, auth, enabled }
```

* **Transports:** `stdio → StdioClientTransport`, `sse → SSEClientTransport`, `http/streamable_http → StreamableHTTPClientTransport` (all from `@modelcontextprotocol/sdk`). `testMcpConnection` (bridged via `ipcBridge.mcp.testConnection`) resolves `npx` paths for `stdio` and validates handshake before saving.
* **Auth:** OAuth for remote MCPs — UI detects `requires_auth` during `testConnection` and opens the redirect flow; token stored per server.
* **Scope:** Tool announcement is at `initialize` — the agent advertises `mcpCapabilities {stdio, http, sse}`; the host filters the user's enabled server list through `negotiateMcpServers` and passes only the transport the agent claims to support. A stdio JLPT server only reaches agents that advertised `stdio`.

### 3.2 Unified multi-agent orchestration

`LocalAgents` (`LocalAgents.tsx:47-53,175-180`) + `useManagedAgents` (`fetch agent catalog`):

* One MCP config panel. Save once → `aioncore` fans it out to every enabled backend (`Claude, Qwen, Gemini, Codex, aionrs, Opencode …`), each under its own context key. Zed does the same: `context_servers` forwarded over ACP plus native config.
* Per-agent overrides exist but are not per-agent *re-entry*. Adding `jlpt-mcp` once makes it available to whatever the user picks next without touching each agent's `mcp.json`.

### 3.3 The Single-Target CDP Bridge bonus

`process/resources/builtinMcp/cdpBridge.ts:21-47,106-147` + `browserServer.ts`, `cdpTargetProtocol.ts`:

* Instead of exposing `Chrome --remote-debugging-port` to the whole browser, the bridge scopes a **single `webContents` (webview)**: bind `127.0.0.1` only (`:36`), random token (`:22`), fixed `SINGLE_SESSION_ID` routing to the page session (`:124-136`), not the browser. Agent gets `page.navigate / evaluate / screenshot` tools without host pwnage. See `tests/unit/cdpBridgeSessionRouting.test.ts`.

### 3.4 Built-in image-gen MCP

`BUILTIN_IMAGE_GEN_ID` (`storage.ts:11`) — a first-class MCP that any agent can call (`image.generate`), localized keys `acp.image.*` (`i18n-keys.d.ts 13-17`).

### 3.5 What it means for manobu

Manobu's JLPT corpora path is cleaner than AionUi's generic tool: `packages/japanese/data/*.json` (vocab, grammar, conjugation, kanji, pitch) → `crates/jlpt-mcp` Rust binary (gzipped embed via `build.rs`, `parity.rs` golden vs old TS engine) → Tauri sidecar `bundle.externalBin` + `ACP_MCP_SERVERS=jlpt-vocab:stdio:<path>` in `apps/desktop/src-tauri/src/lib.rs`. That is a correct special case of AionUi's fan-out:

```
manobu today (specialized, correct but narrow)
  one stdio server  → negotiateMcpServers (stdio only) → one agent at a time (single acp)

AionUi (generic, reusable)
  many servers {stdio,sse,http} → negotiate per agent → many agents in parallel (per-conversation runtimes) + CDP image/browser tools
```

**Concrete bumps for manobu:**

* Keep stdio as primary (offline, Tauri-friendly, zero port conflicts inside `bundle.externalBin`), but add `streamable_http` as an opt-in for the future server-hosted corpora or remote dictonary APIs — already plumbed in `negotiateMcpServers` if you expose `mcpCapabilities.http`.
* Adopt the **single-config fan-out**: move the hard-coded `ACP_MCP_SERVERS=jlpt-vocab:stdio:<path>` string into a `mcp-servers.json` (analog of `IMcpServer[]`) in `app_data_dir`, watched by both `apps/server` and `packages/acp`. Then adding `sherpa-onnx` tools or a future `pitch-accent` MCP is config.
* CDP is not needed in Tauri (no `webContents` webview), but the isolation principle translates: manobu's speech sidecars (`speech_tts`, `speech_stt_file`, `speech_vad_detect`) already scope to `app_data_dir/speech/models/<id>` via `capabilities/default.json` — keep that narrow, as AionUi scoped CDP to one page.
* Consider exposing the JLPT MCP on the **ACP Registry** (even as a `npx @manobu/jlpt-mcp` stub that shells to the Tauri sidecar path when inside the app) — then other Zed/AionUi users can install the same Japanese corpora without Tauri.

---

## 4. Zed / ACP — The Open Standard That Makes AionUi Work in Any Editor

### 4.1 Why ACP exists

Quoted from `zed.dev/blog/bring-your-own-agent-to-zed` (2025-08-27): *"Just as LSP unbundled language intelligence from monolithic IDEs, ACP unbundles agent intelligence from editors."* Gemini CLI is the reference impl; JetBrains + Zed co-own the spec; OpenAI Codex ships a community adapter — all speak the same `stdio JSON-RPC` so any client can host any agent.

### 4.2 The wire contract

From `agent-client-protocol` spec + `crates/acp_thread/src/connection.rs`:

* Transport: `stdin/stdout`, `UTF-8`, `JSON-RPC 2.0`, `protocolVersion uint16`.
* Handshake: `Client → initialize {protocolVersion, clientCapabilities:{filesystem, terminal}}` → `Agent → initializeResponse {agentCapabilities:{mcp, prompt, auth}, authMethods[]}` → `capability negotiation` → `new_session {cwd, mcpServers, mode}` → `sessionId`.
* Content: `ContentBlock[]` (baseline `text + resource_link` required; optional `image + audio` behind capability flags; `embedded_resource` for zero round-trip context).
* Progress: `SessionNotification {SessionUpdate}` variants — `thinking`, `content_streaming`, `tool_call {pending,in_progress,completed,failed}`, `plan`, `mode_switch`, `available_commands`.
* Tools: `ToolCall {id, kind: read|edit|delete|move|search|execute|think|fetch|switch_mode|other, status, title, content: ToolCallContent}`, with `diff {path, oldText, newText}` and `terminal {terminalId}` content types.
* Cancellation: `cancel()` → agent must cancel pending permissions + respond `PromptResponse {stopReason: "cancelled"}`.
* Thread safety: `SubagentContext {parent_thread_id, depth}` capped by `MAX_SUBAGENT_DEPTH=1` (`thread.rs:77`) to avoid fork bombs.

### 4.3 How Zed hosts it (and why AionUi is not special)

| Step | Zed | AionUi | Manobu (`@manobu/acp`) |
|---|---|---|---|
| Declares agent | `agent_servers` entry or ACP Registry `command + args + --acp` | Extension `contributes.acpAdapters` JSON | `registry.ts` `AgentSpec` TS array |
| Spawns | `ShellBuilder + Stdio::piped()` in `agent_servers/src/acp.rs` | Same, via `aioncore` (Node `spawn` bridged over `ipcBridge`) | `Bun.spawn` / `spawn` in `packages/acp/src/index.ts:ensureAcp` |
| Negotiates | `initialize` → `agentCapabilities.mcpCapabilities` | Same | `mcp.ts:negotiateMcpServers` already ✅ |
| Sends prompt | `prompt {sessionId, prompt: ContentBlock[]}` | Same | `generateText` via AI SDK `acp-ai-provider` |
| Streams | `SessionNotification` → `AcpThread` turn state machine | `useAcpMessage` streaming → `MessageList` | `POST /learn/chat` SSE → `useMutation` + `AbortController` in `$sessionId.tsx` |
| Tools & perms | `AllowOnce / AllowThread / AllowAlways / Deny`, thread-compaction at `80_000` tokens | Granular per-agent permission dialog + sidebar badge | No sandbox — Tauri `capabilities/default.json` is the sandbox |
| Extras | Model/mode switch mid-session, thread list/import (`session_list`, `resume_session`) | Team Mode (Leader → Teammates via Team MCP + async mailbox + shared task board) | `unstable_setSessionModel` hot-switch via `GET /agents/:id/models` ✅ partial |

**Team Mode** (`readme.md 138-147`, `TeamPage.tsx:85-88`): Leader agent picks the user's instruction, decomposes, delegates via a **built-in Team MCP Server** (`task_board.json`), each Teammate is its own ACP session with its own model, all sharing one folder. Isolated workspaces, per-agent permission prompts, file attachment pass-through. Manobu has no Team Mode — and should not clone it — but the pattern maps to **parallel weak-pattern rebuilds** if ever needed (multiple weak segments → multiple `buildWeakPatternQueue` shards).

### 4.4 Why this matters for manobu

Manobu already speaks ACP. The missing piece is **host maturity**, not protocol:

* Reuse the protocol tax that Zed/AionUi paid: spec is stable, adapters for Claude/Codex/Gemini/opencode exist upstream — manobu benefits without writing them.
* The `.agents/skills/agent-browser/SKILL.md` + `.agents/skills/tailwind/SKILL.md` + `shadcn` guidance already covers UI-side integration — follow the Zed `ACP Registry` install story (`agent_servers` JSON) instead of hand-spawning binaries.
* AionUi's Team Mode proves a Teacher Agent can decompose one Japanese lesson into parallel `VocabTutor / GrammarTutor / ConjugationTutor` sub-tasks — exactly `packages/agent`'s four-sub-agent router (`ConversationCoach, GrammarExplainer, KanjiTutor, VocabSRS`) but executed in parallel rather than keyword-routed sequentially.

---

## 5. Manobu-Specific Synthesis — Where We Are, Where to Go

### 5.1 Current manobu shape (accurate as of `2026-09-06`)

* **Desktop:** Tauri v2 `1440×900` (`apps/desktop`), SPA routed by TanStack Router (`apps/desktop/AGENTS.md`). Bundles two sidecars (`bundle.externalBin`): `apps/server/dist/server` (Hono, `127.0.0.1:4317`) + `crates/jlpt-mcp/dist/jlpt-mcp` (Rust stdio MCP, 5 MB). `src-tauri/src/lib.rs` boots both, injects `DATABASE_URL=file:<app_data_dir>/manobu.db`, `MANOBU_ASSISTANT_DIR`, `ACP_MCP_SERVERS`, health-polls via `ureq` on a background thread, kills children on `RunEvent::Exit`. CSP strict in `tauri.conf.json` (`connect-src ipc: + http://localhost:4317`), capabilities scoped (`capabilities/default.json`).
* **ACP bridge:** `packages/acp` (isolated from AI SDK v7 on `@manobu/*`) spawns `opencode` (default), `claude-code`, `gemini-cli`, `codex-cli`, `gh-copilot`, `kilo-code` via `registry.ts`, applies launch policy via `launch-policy.ts`, negotiates MCP via `mcp.ts`, hot-switches models via `route.ts:routeFor→acp|direct-cli` and `direct-cli.ts` (`agy --print` V3 hand-roll). `apps/server` holds one session; header pickers (`agent`, `persona`, `model`) in `apps/desktop/src/routes/ai.tsx` hit `GET /agents/:id/models` and send `body.model` per message — hidden when the agent advertises no switchable models (kilo).
* **MCP:** `crates/jlpt-mcp` embeds corpora (`build.rs` gzip from `packages/japanese/data/`) and exposes `lookup/search/list` over vocab/grammar/kanji/conjugation/pitch-accent. ` parity.rs + golden.json` guarantee byte-compatibility with the deleted TS engine. Bundled TA-side.
* **Speech:** `packages/speech` (TS) + `src-tauri/src/speech/` (Rust sherpa-onnx) — `tts.rs` `speech_tts` → WAV, `stt.rs` `speech_stt_file`, `vad.rs` `speech_vad_detect`, `models.rs` `KNOWN_MODELS` + `speech_auto_download` tiered by `detect_pc_tier` (low/medium/high from `sysinfo` + `navigator.deviceMemory`). Today `speech_version/status` + `/speech` debug route only — stub WAV.
* **Learning:** FSRS (`packages/srs`, `src-tauri/src/fsrs.rs`), `queue.ts`/`next-cards.ts`/`weak-pattern-queue.ts`, `apps/desktop/src/components/*` (SCR-01..12 compounds, Vercel `Object.assign(Root,{.Sub})`), TanStack Query (`tauri-queries.ts:networkMode offlineFirst`), Form, Router. Test plan (`docs/test-plan.md`) guards perf + copy invariants.
* **Docs:** `docs/agent-stack-gaps-vs-aionui.md` already prioritized Tier 1/2/3 gaps (many ✅ landed), `docs/agent-switching-like-aionui.md` traced the `assistants as markdown` vs `agents as TS` split.

### 5.2 Adopting AionUi — Ranked recommendations

Priority respects AionUi's proven order: **make switching real → make scheduling real → make tools shared → make optics nice.** Nothing here duplicates Tier 1/2 work already landed — it completes it.

#### 5.2.1 Tier A — Close the agent-workflow last mile (do with next ship)

**A1. Per-conversation ACP session pool.**  
Replace `let acp` singleton in `apps/server/src/index.ts` with `Map<conversationId-or-agentId, AcpModelResource>` LRU cap ~3 (AionUi `AcpRuntime`). `ensureAcp(agentId)` resolves via `resolveSpawnTarget` + `applyLaunchPolicy({agent, mode, resume, cwd})`. Switching agent = `close_session` on the old pool entry + fresh `getAcpModel` for the new `id`; keep per-agent `persistSession` buckets. This is AionUi `acp_thread/src/connection.rs` `new_session/close_session` + Zed `AgentConnection` contract — not a new abstraction.

**A2. Busy + queue guard.**  
Add thin `classifyConversationBusyError` (`conversationBusyError.ts:1-10` analog) and `useConversationCommandQueue` auto-drain (validate length/file-count, enqueue `prompt`, drain on `session_active` idle). Prevents duplicate cron ticks or rapid `Next` taps from interleaving in one session. Validate with a unit test that two rapid `prompt` calls queue rather than clash.

**A3. Structured error taxonomy.**  
Port `buildSendFailureError.ts:35-48` error codes (`USER_AGENT_DISCONNECTED → reconnect_agent`, `AIONUI_CONVERSATION_BUSY → wait`, `WORKSPACE_PATH_RUNTIME_UNAVAILABLE → fix_path`, `UNKNOWN_UPSTREAM → retry`) into `@manobu/acp`. Drive the existing `/ai` `errorComponent` and conversation error cards from it — not generic `String(e)`.

*Why A now:* The registry, launch policy, MCP negotiation, and model hot-switch are already ✅; without A1/A2 the picker is a mock — switching still restarts the server. A1/A2 make the picker real.

#### 5.2.2 Tier B — Add cron that actually matters (next sprint)

**B1. Minimal cron scheduler in the Tauri shell.**  
Create `packages/cron` (or `apps/desktop/src/lib/cron.ts` + `src-tauri/src/cron.rs`) that stores `ICronJob[]` in `app_data_dir/cron/jobs.json`, ticks via `cron` crate (Rust side) or `setInterval` + `parseCronExpr` (TS), repairs zone on load (`repairCronJobTimeZone` pattern), supports `cronExpr | intervalMinutes | oneTime` and `executionMode: continueInConversation | newConversation` + `keepAwake` (Tauri `powerSaveBlocker`). Persist via `invoke("cron_*")` matching AionUi `ipcBridge.cron.*`.

**B2. Ship three default jobs (disabled until user opts in).**  
`Morning review nudge (8:00 Asia/Tokyo, continue)` — pings Sensei in the last review conversation; `Weekly JLPT mock (Mon 09:00, newConversation)` — asks Teacher Agent for a fresh 20Q from `deriveWeakPatterns`; `Nightly weak-pattern rebuild (every 360m, continue)` — warms `next-cards.ts` cache. Create them via the same natural-language path AionUi uses: `/cron` skill that writes an `ICronJob`.

**B3. Single management UI.**  
Clone `ScheduledTasksPage` in scope, not in bulk: table (search `name|prompt|agent`), `CreateTaskDialog` (presets `Hourly/Daily/Weekly/Weekdays` + advanced raw cron), `TaskDetailPage` (history, `Run Now`, pause/resume, delete, batch delete history, queue-protection toggle, keep-awake banner: "Tasks only run while your computer is awake").

*Why B next:* AionUi's thesis is correct — cron is what separates a chat app from a cowork app. For a language learner, `FSRS due` and `weak-pattern → quiz` are the highest-frequency tasks; cron is their natural form. No server needed — Tauri's app_data_dir + local cron ticks cover it; WebUI/remote comes later if ever.

#### 5.2.3 Tier C — Make MCP a catalog (when adding the second server)

**C1. MCP catalog file.**  
Replace the single `ACP_MCP_SERVERS` env literal with `app_data_dir/config/mcp-servers.json` (`IMcpServer[]` analogue) watched by `packages/acp/src/mcp.ts` and `src-tauri/src/lib.rs`. Declares `jlpt-mcp` once; future `speech-mcp` or HTTP dictionary servers are appended without changing spawn code.

**C2. `http` / `streamable_http` capability.**  
Expose `mcpCapabilities.http = true` for any server that sets `transport: http`; extend `negotiateMcpServers` to pass through `http` entries to agents that advertise it. Keep stdio default — Tauri sidecars remain `stdio` (`bundle.externalBin`, no port collision).

**C3. Registry publish.**  
Package the Rust sidecar as `npx @manobu/jlpt-mcp` (thin Node shim that resolves to `./src-tauri/binaries/jlpt-mcp` inside Tauri and `npx` outside) and register it as `Hello Stdio Agent`-style ACP Registry entry (scoped `acpArgs ["--stdio"]`, `healthCheck: {versionCommand: "jlpt-mcp --version"}`) so Zed (`zed: acp registry`) and AionUi users can `Add → Install from Registry` without Tauri.

*Why C after B:* One stdio MCP is already done right (`parity.rs` golden matters more than generality). Wait for a second server (speech tools, pitch-accent, or remote corpora) before generalizing.

#### 5.2.4 Tier D — Zed-level polish (low priority, high reassurance)

* Import the thinking-throttle `50ms` and `MeasureTextOverrun` guard from `useAcpMessage.ts:120-189` if Sensei streams long marker-graph explanations — avoids React thrash on large `SessionUpdate` bursts.
* Surface the session state machine (`connecting/connected/authenticated/session_active/disconnected`) as a subtle header dot (Zed does it, AionUi does it, manobu currently has no busy indicator beyond `isPending`).
* Consider a `Team Mode`-inspired decomposition: route one lesson prompt in parallel to `VocabSRS + GrammarExplainer + KanjiTutor` via `Promise.all`, then Coach synthesizes — analogous to `Team MCP Server → async mailbox`, but without adding the mailbox process yet.

#### 5.2.5 Amendment — Interaction with doc-2 (Japanese datasets + sqlite-vaporetto)

> **Added 2026-09-06 after `doc-2`.** `doc-2` adds the data layer that this doc's orchestration consumes. No structural change to Tiers A–D — only cross-links and ordering.

* **Data → MCP catalog (Tier C).** `doc-2 §5.2–5.3/§4` adds `sentences_fts` (`lookup_examples/search_examples` via Tatoeba/Tanaka `jpn_indices`), `KanjiVG` (`lookup_stroke_order` via `109×109` SVG `Kanjivg`), and deferred `names_fts` (`JMnedict`) — all indexed with `sqlite-vaporetto` `tokenize='vaporetto tags 名詞,動詞… keep_untagged'` + `vaporetto_and_query/or_query/bm25/highlight`. Tier C1 `mcp-servers.json` should declare them as future `IMcpServer[]` entries alongside `jlpt-vocab:stdio` so `negotiateMcpServers` (`packages/acp/src/mcp.ts:1`) doesn't need revisiting. Keep `stdio` primary (Tauri `bundle.externalBin`); `http/streamable_http` (C2) only for remote dictionary APIs.
* **Tokenizer → search (prerequisite).** `doc-2 P0` `sqlite-vaporetto` (`packages/db/src/schema/content.ts` + `crates/jlpt-mcp/src/engine.rs` `search_*` → `bm25()`) is a **prerequisite** for Tier A's session pool to be useful — more sessions without word-aware segmentation (`東京特許許可局 → 東京/特許/許可/局`) still returns poor hits. Order: `doc-2 P0 → doc-1 Tier A/B`.
* **Cron → data refresh (Tier B).** In addition to the 3 learner jobs (`§5.2.2 B2`: review nudge `8:00 Asia/Tokyo continue`, weekly mock `Mon 09:00 newConversation`, nightly weak-pattern `every 360m`), add 2 **headless data-maintenance jobs**: `Weekly JMdict/jkindrix refresh` (`packages/japanese/scripts/fetch-vocab.ts:37` pins `JMDICT_TAG 3.6.2+…` + `fetch-kanji-pitch.ts`) and `Sentences rebuild` (`fetch-sentences.ts` `jpn_indices`). They share the same `ICronJob {cronExpr|interval|oneTime, tz, keepAwake}` shape (`repairCronJobTimeZone.ts:14`, `cronUtils.ts:77`) but run headless (`executionMode` = background, no conversation) — extend `Tier B1` `packages/cron`/`src-tauri/src/cron.rs` accordingly. See `doc-2 §5.2/§6` (share-alike `CC BY-SA 4.0` + `build.rs/types.rs/golden.json` commit contract).
* **Pitch/SVG already covered.** `doc-2` confirms `KANJIDIC2 13,108` and `Kanjium 124k + Wiktionary 12.8k` are already shipped (`packages/japanese/data/kanji.json`, `pitch-accent.json`) — no new MCP, just wider `src/types.rs` fields and `KanjiVG.tsx` when C1 lands.

---

## 6. Implementation Notes — Keep the AionUi invariants

* **Single copy per data.** Same lesson AionUi repeated three times: cron jobs, MCP servers, and assistant contexts each have a single source of truth (`jobs.json`, `mcp-servers.json`, `assistant/*.md`); every backend reads it. Do not duplicate `AgentSpec` per route.
* **One backend owns all sub-processes.** Today `apps/server` does — keep it that way (like `aioncore`), even when sessions become plural. Tauri `lib.rs` must still `SIGTERM+SIGKILL` the whole process group on `RunEvent::Exit` (orphan registry, `Tier 3.1`).
* **Capability negotiation before session.** Never pass an MCP server to an agent that did not advertise the transport — warn-skip, do not crash the session (`mcp.ts` already does this; extend it to `http`).
* **Queue before concurrency.** If two triggers (cron tick + user send) contend for one `session_active` session, queue — do not fail. AionUi `useConversationCommandQueue:82-86` drains on idle for exactly this.
* **Standard cron, not bespoke.** Five-field `* * * * *` + `IANA timezone` string is the only durable cron shape — visual builders are just sugar over it (`cronUtils.ts` pattern).
* **Marko's rule:** do not bring Rust/Axum/JWT over. `Hono + Bun.compile` + `core:default` capability + `app_data_dir` is the Tauri-idiomatic analog of AionCore's stack.

---

## 7. Concluding Mapping — From AionUi Modules to manobu Files

| AionUi module | Location | Manobu analog | Action |
|---|---|---|---|
| `ScheduledTasksPage + CreateTaskDialog + useCronJobs + cronUtils + repairCronJobTimeZone` | `packages/desktop/src/renderer/pages/cron/**` | `(new) packages/cron` or `apps/desktop/src/lib/cron.ts` + `src-tauri/src/cron.rs` + `app_data_dir/cron/jobs.json` | **New** — Tier B |
| `AcpAgentManager / AcpAgent / AcpConnection` + `acp_thread / agent_servers` | `packages/desktop/src/renderer/pages/conversation/platforms/acp/**` + `crates/acp_thread`, `crates/agent_servers` | `packages/acp/src/{registry,launch-policy,mcp,index}` + `apps/server/src/index.ts` session pool | **Harden** — Tier A1/A2/A3 |
| `IMcpServer + AbstractMcpAgent + testMcpConnection + cdpBridge + LocalAgents` | `common/config/storage.ts:11-25` + `process/resources/builtinMcp/**` + `renderer/pages/settings/AgentSettings/LocalAgents.tsx` | `crates/jlpt-mcp` + `packages/speech` + `apps/desktop/src-tauri/src/speech/models.rs` | **Catalog-ize** — Tier C1/C2, registry publish C3 |
| `AcpModelSelector + useAcpModelInfo + Assistant` (`contributes/acp-adapters.json`, `assistants/*-context.md`) | `renderer/components/agent/AcpModelSelector.tsx` + `common/types/agent/assistantTypes.ts` | `GET /agents/:id/models` + header dropdown in `apps/desktop/src/routes/ai.tsx`; personas in `assistant/*.md` (`agent-switching-like-aionui.md` §Tier B) | Already partial ✅; finish Tier A1 to make picker real, Tier B in that doc to make markdown personas real |
| `Team Mode Leader→Teammates via Team MCP + async mailbox` | `renderer/pages/team/TeamPage.tsx:85-88` + `docs/4.10-team-mode` | `packages/agent` 4-sub-agent router + `weak-pattern-queue.ts:buildWeakPatternQueue` | **Defer** — Tier D, only if lesson decomposition needs parallelism |
| `Datasets + sqlite-vaporetto` (`Tatoeba/Tanaka jpn_indices`, `KanjiVG 109×109`, `Kanjium+Wiktionary`, `JMnedict`, `sqlite-vaporetto vaporetto tags keep_untagged bm25`) | `hotchpotch/sqlite-vaporetto` + `daac-tools/vaporetto` `arxiv:2406.17185` | `packages/japanese/data/*` + `packages/db/src/schema/content.ts` (`vocab_fts/sentences_fts`) + `crates/jlpt-mcp/src/engine.rs` (`search_*`, `lookup_stroke_order/examples`) — see `doc-2` | **doc-2 P0→P2** — tokenizer first, then sentences/KanjiVG, then JMnedict; feeds Tier C catalog and Tier B data-refresh crons (see §5.2.5) |

---

## 8. References — Primary sources used

* `iOfficeAI/AionUi` — `readme.md` (Cowork, Built-in Agent, Multi-Agent, Team Mode), `docs/4.9-cron-and-scheduled-tasks` (relevant files `ScheduledTasksPage/CreateTaskDialog.tsx`, `TaskDetailPage.tsx`, `index.tsx`, `useCronJobs.ts`, `cronUtils.ts`, `repairCronJobTimeZone.ts`, `jobAgentMeta.ts`, `cron.json` locales), `docs/4.3-acp-agent-integration`, `docs/4.2-acp-agent-architecture-(v2)` (three layers, state machine, queue, error taxonomy), `docs/4.6-mcp-integration` (`IMcpServer`, 4 transports, `useMcpConnection`, `cdpBridge.ts:21-47`, `browserServer.ts`, `cdpTargetProtocol.ts`, `BUILTIN_IMAGE_GEN_ID`), `docs/4.10-team-mode`, `docs/4.11-aionrs-agent`, `4.8-assistant-presets-and-skills` (`contributes/assistants.json`, `assistants/*-context.md`), `wiki/ACP-Setup`.
* `zed-industries/zed` — `zed.dev/docs/ai/external-agents`, `zed.dev/acp`, `zed.dev/blog/bring-your-own-agent-to-zed` (2025-08-27, ACP+RSP lineage), `agent-client-protocol` spec `2-protocol-specification` (`InitializeRequest/Response`, `SessionId`, `ContentBlock`, `SessionNotification/SessionUpdate`, `ToolKind/ToolCallStatus`), `8.2-acp-protocol-and-connection` (`acp_thread/src/connection.rs:91-260`, `acp_thread.rs:14-17`, `agent/src/agent.rs:203-212`, `thread.rs:77 MAX_SUBAGENT_DEPTH`, `agent_servers/src/acp.rs:27-31`), `ThreadStore` compaction.
* Manobu — `packages/acp/src/registry.ts`, `launch-policy.ts`, `mcp.ts`, `route.ts`, `direct-cli.ts`, `index.ts`, `apps/server/src/index.ts`, `apps/desktop/src-tauri/src/lib.rs`, `crates/jlpt-mcp/src/main.rs, build.rs, parity.rs`, `packages/speech/AGENTS.md`, `apps/desktop/AGENTS.md`, `docs/agent-switching-like-aionui.md`, `docs/agent-stack-gaps-vs-aionui.md`.
* Datasets + tokenizer — `backlog/docs/research/doc-2 - Japanese-datasets-sqlite-vaporetto…md` (`JMdict 214k`, `KANJIDIC2 13,108`, `Tatoeba 13M+/JP ~250k + Tanaka 150k/jpn_indices`, `JMnedict 400k`, `KanjiVG 13k 109×109`, `Kanjium 124k+12.8k`, `jkindrix` glue, `hotchpotch/sqlite-vaporetto` `tokenize='vaporetto' vaporetto_and_query/bm25`, `daac-tools/vaporetto` `5.7× KyTea`, `packages/japanese/{data/LICENSE.md, scripts/fetch-vocab.ts:37, data/kanji.json, pitch-accent.json}`, `packages/db/{src/schema/content.ts, test/fts5-perf.test.ts}`, `crates/jlpt-mcp/{src/main.rs:81, AGENTS.md}`).

