# packages/acp — native agent-CLI session engine (ACP + direct-cli)

## Purpose

The agent-spawn surface for `apps/server`: one `SessionController` per
process drives every agent CLI the chat surface reaches. Two wire dialects
(declared per-agent on `AgentSpec.transport`), each a `*_conn`-shaped
adapter into one normalized `AcpStreamEvent` frame stream (the AionUi
AionCore model: one orchestrator, many wire dialects):

- **`acp`** — ACP-speaking CLIs (`opencode`, `claude-code`, `gemini-cli`,
  `codex-cli`, `gh-copilot`, `kilo-code`) driven over NDJSON JSON-RPC by
  `session.ts`'s `ClientSideConnection` (`@agentclientprotocol/sdk@^0.21`).
- **`direct-cli`** — non-ACP CLIs that have no ACP server mode. First
  consumer: Google Antigravity (`agy --print "<prompt>"`, Tier 2.1). The
  `DirectCliSession` facade (`direct-cli-session.ts`) wraps
  `runSingleShot` (`direct-cli.ts`) into the ACP frame vocabulary
  (`turn_start` → one-block `text` → `turn_end`); the shared
  `SessionController` dispatches to it by session id, exactly as it
  dispatches to the ACP `*_conn` adapters.

Zero AI SDK. The old `@mcpc-tech/acp-ai-provider` bridge (`getAcpModel` /
`AcpModelResource` / `acpTools` / the V3 model layer, built on
`@ai-sdk/provider@^3` + `ai@^6`) was deleted in TASK-80.6: the native
engine speaks `@agentclientprotocol/sdk` wire frames directly, and the
desktop chat surface consumes them through `@manobu/chat-session` over the
oRPC WS link, not through AI-SDK parts.

## Ownership

- Owns the only `@agentclientprotocol/sdk` install in the repo.
- Public surface: `SessionController` (`session` subpath), the direct-cli
  facade + single-shot runner (`direct-cli-session` / `direct-cli`
  subpaths), and the registry + `$PATH` discovery helpers (`.` subpath:
  `resolveSpawnTarget`, `listAgentCandidates`, `AgentCandidate`).
- Does **not** own UI, transport selection, routing, or the chat frame
  contract (`packages/api-contract`'s `chatContract` is the wire surface;
  `AcpStreamEvent` in `acp-events.ts` is the engine-internal vocabulary
  the server persists + projects to it).

## Local Contracts

- `resolveSpawnTarget(bin?)` — canonical `AgentSpec` resolution for the
  warm session pool (`apps/server/src/context.ts::poolKeyFor`).
  Precedence: `bin` arg → `ACP_AGENT_BIN` env → `DEFAULT_AGENT_ID` if on
  `$PATH` → first installed registry entry → throw. Unrecognized handles
  spawn as a generic `AgentSpec` (`makeFallbackSpec`) so
  `ACP_AGENT_BIN=my-custom-fork` is never stranded.
- `listAgentCandidates()` — `$PATH` probe of every registry `command`
  (ACP and direct-cli alike) for the agent picker (`GET /agents`) and boot
  diagnostics. `which()` is a hand-rolled `$PATH` walk (deliberate: no
  `which` npm dep). It is platform-aware, not POSIX-only: `pathCandidates(bin, pathEnv, platform, pathExt)` splits on `:`/`;` and joins with `path.posix`/`path.win32` for the stated platform, and on win32 it appends the `PATHEXT` suffixes (default `.EXE;.CMD;.BAT`) because `opencode` never matches `opencode.exe` otherwise. `pathCandidates` is the test seam — `test/path-candidates.test.ts` passes the platform explicitly instead of faking `process.platform`.
- `child-registry.ts` splits its reap targets the same way: every signal goes
  through `killTarget(pgid, platform)` (POSIX `-pgid` reaches the group, win32
  takes the bare pid because a negative pid is an invalid argument there),
  `commandBaseName` cuts on both separators so a `C:\…\opencode.exe` marker
  matches instead of reaping nothing, and `windowsGroupReapWarning(platform)`
  is what `killGroupQuiet`'s swallowing catch prints once per process on win32
  — without it a reap that reached the child but not its grandchildren looked
  identical to a reap that worked. Job Objects are the real fix and stay
  deferred (TASK-177 Stage 5), so a Windows run leaks what a Linux run reaps.
- `DirectCliSession` facade: `prompt()` emits `turn_start` → `text` (the
  full single-shot reply as ONE block) → `turn_end`. Two invariants the
  server's drain depends on (a broken one = frames the client never sees):
  - Every `sink(...)` call is **awaited in order** — the drain exits on
    the terminal row, so an un-awaited `text` sink races its own persist
    and the content row can commit *after* the `finish` row (out-of-order
    `seq`), which the live drain never replays.
  - The `text` block is ACP-shaped (`{ type: "text", text }`) so the wire
    frame validates against the contract's `ContentBlockSchema` (`type`
    is required — a bare `{ text }` fails oRPC validation on the
    client side, surfacing as `AsyncIteratorObject validation failed`).
  Accepted degradation vs the ACP path (documented, not bugs): no
  streaming (one-block text), no tools / permission cards (agy's
  proprietary `agentapi` sidecar protocol is not bridged), no hosted
  terminals (`killTerminal` reports not-found — there is no child to
  kill between turns), no session resume (single-shot; every prompt
  carries the full conversation in one `--print` body).
- `SessionController` (native engine): `ensureSession`/`prompt`/`cancel`/
  `confirm`/`answerAsk`/`killTerminal`/`configOptions`/`dispose` +
  `registerDirectCli` (TASK-80.6). NDJSON JSON-RPC over child stdio;
  parked permissions keyed by `toolCallId` with the aioncore optionId echo
  (an unknown `optionId` falls back to the nearest REAL offered option by
  kind — reject-ish → `reject_once`/`reject_always`, else
  `allow_once`/`allow_always`); replay suppression on `session/load`;
  ask parking via public `parkAsk()` for the host MCP tool server
  (TASK-86: returns `{ promise, requestId }` — the requestId is the ask
  frame's correlation id so the server can settle the persisted row to
  error when the park rejects: expiry, cancel, dead child). The park
  expiry is the engine's `confirmationTimeoutMs` (constructor option;
  TASK-88: apps/server feeds it `CONFIRMATION_TIMEOUT_MS`, default 30
  min) and also governs parked permission cards). TASK-92: an optional
  third `key` (content hash the host tool computes from the questions)
  makes the park a resumable long-poll: a re-call attaches to the LIVE
  park (same promise + requestId, no duplicate frame) and, after settle,
  replays the TERMINAL outcome from a FIFO-bounded (64), TTL-bounded
  (5 min from settle, TASK-94; test seam: parkAsk 4th arg) cache — a
  verbatim re-ask past the window parks fresh;
  `retireAsk(requestId)` (TASK-94) kills a LIVE park without answering it —
  rejects through the same wrapper (timer cleared, live index released,
  terminal replay armed), so `answerAsk` returns false afterwards and the
  host's tool-side deadline is authoritative over the engine's longer
  backstop. Keyed
  settles move through the `ask.resolve`/`ask.reject` wrappers only (all
  force paths rely on this). Unkeyed parks keep the one-shot behaviour.
  TASK-125 adds a parallel drill host-call seam: `parkDrillItem()` emits a
  pending `drill_item` containing only the key-free `AcpDrillItem`, while
  `answerDrillItem()` emits the answered frame with `AcpDrillResolution` before
  resolving the host promise. `stopDrillItem()` settles a stop/skip as an
  explicit `skipped` result rather than a false grade, and `retireDrillItem()`
  applies the same host-deadline authority as `retireAsk()`. Drill
  live/stable-key/terminal maps are separate from the ask maps, but share
  `confirmationTimeoutMs` and the 64-entry, five-minute terminal-replay bounds.
  Pending drill frames are included in `listConfirmations()`; ask APIs and
  semantics are unchanged. `isHostToolCallTitle()` is the shared suppression
  predicate for `ask_user`, `next_drill_item` and `start_exam` tool-card
  frames (TASK-147 adds the third: its paper card is published by the
  assembly, so the raw call card would be a duplicate on screen).
  `prompt()` accepts `input.turnId` (TASK-86): the armed turn adopts the
  caller's id (`chat.send`'s ack id), because `chat.cancel` guards on an
  exact turnId match — an engine-minted UUID makes Stop dead on arrival;
  omit it and the engine mints one. Turn settle/fail clears
  `handle.activeTurn` (`#settleTurn`/`#failTurn`, TASK-86): without it the
  busy race guard rejects every subsequent prompt on the session.
  Lifecycle shape (TASK-81.4): `#openSession` is a linear orchestration
  over step methods `#initialize` → `#negotiateMcp` → `#openChannel`; no
  step swallows errors — every failure propagates to `ensureSession`'s
  teardown (child killed, no leaked session; pinned by the handshake
  failure-table test). `cancel` is a guard chain: `#cancelDirectCli` →
  `#canCancel` (connection + stale `turnId` race) → `#forceResolveParks`
  → the wire notification. Keep it that way; complexity suppressions
  lived here before and must not return.
  `direct-cli` sessions route `prompt`/`configOptions`/`cancel` to the
  registered facade (`#directCli` map) and `dispose` to the shared
  teardown (no ACP child to reap — the handle's `child`/`connection`
  stay null, so the pool's health/evict path works unchanged).
- `session-child.ts` (TASK-99, internal module — no package subpath): the
  child-transport hygiene layer between the spawned agent and
  `ndJsonStream`. Four jobs, none of them visible to the wire contract:
  - `agentChildEnv()` — spawn env for every ACP child: strips `CLAUDECODE`,
    `FORCE_COLOR`, `NODE_DEBUG`, `NODE_INSPECT_RESUME_ON_START` and
    `NODE_OPTIONS` (inherited debug/colour flags make an agent CLI print
    non-JSON to the protocol stream) and sets `NO_COLOR=1` + `TERM=dumb`.
    Copies, never mutates `process.env`.
  - `tolerantStdout(child.stdout)` — the NDJSON line framer: reassembles
    split lines, drops blanks, forwards protocol lines verbatim, and
    *counts* non-protocol lines. The SDK's `ndJsonStream` already tolerates
    junk (it logs a parse failure and keeps reading), so the engine's job is
    a bound, not a crash: more than `DEFAULT_MAX_JUNK_LINES` (50) inside
    `DEFAULT_JUNK_WINDOW_MS` (5s) fails the transport with
    `AcpStdoutJunkError`, which reaches the in-flight request
    through the SDK's `readable`-error path. Each junk *kind* is warned once
    (`[acp] dropping non-protocol agent stdout line #N: …`, 160 chars).
    Invariant: the source must keep reading inside `pull` until it enqueues,
    errors or closes — the spec does not re-invoke a `pull` that enqueued
    nothing, so a filter that returns early stalls on a junk-only chunk
    (pinned by `child-transport.test.ts`).
  - `captureStderr(child.stderr)` — a 64 KiB ring of the child's last lines,
    redacted on push (`redactSecrets`: `*_api_key`/`token`/`secret`/
    `password`/`authorization` assignments and `Bearer …`), so the ring can
    never hold a secret. `failureDetail()` appends `| stderr: <tail ≤2000
    chars>`; `handle.stderrTail` feeds it to `#markDead` and the handshake
    failure path so a dead child explains itself in the status frame / error
    row instead of the bare `connection closed`.
  - `withTimeout({ms, work, onTimeout})` + the `handshakeTimeoutMs` engine
    option (default `DEFAULT_HANDSHAKE_TIMEOUT_MS` 30s): bounds
    `initialize` + `session/new|load`. Expiry throws
    `AcpHandshakeTimeoutError` (child stderr attached) and
    `ensureSession`'s catch tears the child down, so the server's `acpInit`
    pool key settles in its `finally` rather than wedging that conversation
    for the process lifetime.
  - Turn-failure codes (TASK-102 AC#4/#6): a session-open auth rejection and
    a rejected cold model/mode switch both surface as a tagged `Error` the
    server projects onto the terminal frame. `isAuthRejection(err)` classifies
    on the agent's OWN WORDS (a message regex: `auth(entication)? required`,
    `not authenticated`, `unauthoriz`, `please/must/need(s|ed) to log|sign[-\s]?in`)
    — NEVER on the mere presence of advertised `authMethods`, because
    opencode-like agents list methods yet chat anonymously, so presence-only
    detection would show a false sign-in prompt (pinned non-regressive by
    `auth-errors.test.ts`). `acpAuthRequiredError(agentId, methods, cause)` and
    `acpConfigSwitchError(kind, value, detail, cause)` are FACTORY FUNCTIONS
    returning `Object.assign(new Error(msg, { cause }), { code })`, not
    classes: the server reads these structurally via `.code`, so a subclass
    name nothing checks is dead weight (repo style: functions over classes).
    `code` is `"AUTH_REQUIRED"` / `"CONFIG_SWITCH_FAILED"`; `cause` preserves
    the agent's rejection. In `session.ts`, `#openChannel` wraps
    `newSession`/`loadSession` and re-throws an `isAuthRejection` hit as the
    auth error; `#applyRequestedSwitches` FAILS LOUDLY (throws the switch
    error) instead of warn-swallowing, so an answer is never silently
    attributed to a model the learner did not pick. `handle.authMethodNames`
    (retained from `#initialize`) only names the sign-in methods in the auth
    message — it is an advertised capability, not a verdict.
- `direct-cli.ts` spawns via a minimal `SpawnedProcess` cast — bun-types'
  `node:child_process` module lacks the EventEmitter `.on` overloads.
  Don't "fix" the cast back to `ChildProcess`; the structural type is
  deliberate. `buildArgs` is deliberately ONLY `--print` + the prompt
  (agy v1.1.11 breaks single-shot answers when extra flags are present —
  verified 2026-08-07; see the in-file note).
- `probeAgyModels` runs `agy models` (a subcommand, NOT `--print`); fails
  return `[]` — the chat must never fail because the model picker list is
  empty.

## Work Guidance

- `registry.ts` is the single source of truth for every agent CLI
  (`id` = public handle, `command` = what's resolved against `$PATH`; they
  may differ, e.g. `id: "claude-code"` / `command: "claude"`). Add new
  agents as config rows there — display order = priority order.
  `findAgent` matches `id` OR `command`, exact + case-sensitive.
- The model layer is gone: do NOT reintroduce `@ai-sdk/provider`,
  `ai`, or `@mcpc-tech/acp-ai-provider` deps, or a `streamText`-shaped
  surface. Frames flow `AcpStreamEvent` (engine) →
  `apps/server` persistence → the `chatContract` wire frames
  (`content`/`finish`/`acp_tool_call`/`acp_permission`/`ask`/…) →
  `@manobu/chat-session` fold (`frameDataText`, `transformFrame`).
- Host MCP tools (`mcp.ts` subpath) are negotiated as `mcpServers` on
  `session/new`: capability-filtered at `initialize` (warn-skip on
  transport mismatch, never fail the session). The host `ask_user` MCP
  server endpoint rides `apps/server`'s `sidecarOrigin()` + the
  per-conversation pool key.
- **Per-server env (`ACP_MCP_SERVERS` grammar, TASK-96).** A
  `RequestedMcpServer` may carry `env: Record<string, string>`: extra
  environment for **that server's stdio child only** (the debug gate in
  `crates/jlpt-mcp` is the motivating case). The wire needs nothing new —
  ACP's `McpServerStdio.env` is already `Array<EnvVariable>`, and
  `toMcpServer` emits name-sorted pairs; `http`/`sse` have no env field on
  the ACP type, so their map is warn-dropped, never fatal.
  - Literal form: comma-separated `<id>:<transport>:<target>` entries, where
    an entry may append `|KEY=VAL;KEY2=VAL2`. `|` is the reserved delimiter
    (`:` is already split twice for the transport and can appear in a URL or
    a PATH-like value, `,` separates entries). Rejected pair → warn + drop
    that pair only; rejected entry → warn + drop that entry only. A value
    containing `|`, `;` or a control character is illegal because it could
    forge a second entry.
  - **A stdio target may be a quoted path (TASK-177).** Only the first two
    `:` of an entry split the spec, so a Windows target keeps its drive letter,
    but `toMcpServer` has to turn the target into command + args and a bare
    `C:\Program Files\manobu\jlpt-mcp.exe` would split at the space and spawn
    `C:\Program`. `splitStdioTarget` therefore takes a leading `"..."` token as
    the command verbatim and only whitespace-splits the remainder; an unclosed
    quote or an empty quoted command **throws** rather than handing the agent a
    half path. The producer side is `apps/desktop/src-tauri/src/mcp.rs::quote_stdio_target`,
    which quotes any whitespace-bearing stdio target it renders into the literal.
  - Catalog form: an optional `env` map per `mcp-servers.json` server. The
    file is read by the Tauri shell, which folds enabled entries into the
    literal, so `apps/desktop/src-tauri/src/mcp.rs::render_entry` must keep
    the suffix in sync with `parseMcpServers` (its `is_valid_env_key` /
    `is_illegal_env_value` mirror `ENV_KEY` / `isIllegalEnvValue` here).
    One bad entry voids the whole file — the existing `isMcpCatalog` rule.
  - **The consumer is `apps/server/src/context.ts`**, which parses
    `env.ACP_MCP_SERVERS` once into the `applyLaunchPolicy` spec. The
    provider-era reader (`resolveMcpServersFromDisk`) was deleted in
    TASK-80.6 and nothing replaced it, which left the literal and the whole
    catalog write-only — no configured server reached any session, while
    `assistant/sensei.md` claimed the `jlpt-vocab` tools were attached.
    Never re-sever that leg; `parseMcpServers` has no production callers
    outside it.
  - Regression pin: `session.test.ts`'s TASK-96 case drives the real
    `fake-agent` child and asserts the verbatim `session/new` `mcpServers`
    payload (the fake script's `dumpMcpServers` option).

## Verification

- `bunx tsc -p packages/acp/tsconfig.json --noEmit` — exit 0.
- `bun test packages/acp` — the surviving suites (`conversation-guard`,
  `mcp-catalog`, `path-candidates` + `windows-process-target` (TASK-177: the
  win32 `$PATH`/`PATHEXT` walk and `killTarget`/`baseName`/
  `windowsGroupReapWarning`, all driven by an explicit `platform` argument
  because nothing here fakes `process.platform`),
  `acp-events` (TASK-110 host-tool title predicate), `session`
  including TASK-125 drill park/answer, key
  containment, keyed replay, timeout/retire/cancel, `child-transport`
  (TASK-99: spawn env, stdout framing + junk bounds, stderr ring/redaction,
  `withTimeout`), and the `fake-agent` harness; the provider-era
  `index`/`wire-contract` suites were deleted with the bridge in
  TASK-80.6). **Run this before adding an agent CLI**: the guardrail
  tests (unique id/command, cross-id collision, argv derivation for every
  spec) fail the moment a new `AgentSpec` breaks a shape the router or
  picker depends on.
- **Golden-frame suites (TASK-81 AC#2)**: `translator-golden.test.ts`
  (every `sessionUpdate` family + dual-case + unknown-variant paths,
  one JSON per case under `test/goldens/translator/`) and
  `folds-golden.test.ts` (`foldLegacyModelMode` shapes + TerminalRegistry
  spawn/env/cwd behavior). These pin the CURRENT wire output so the
  TASK-81.1 refactor cannot change behavior. Regenerate only when the
  contract changes intentionally: `UPDATE_GOLDENS=1 bun test
  test/translator-golden.test.ts` — and review the diff, regeneration is
  a contract change, not a test fix.
- **Accepted complexity (TASK-81.6)**: `test/fake-agent.ts`'s `handle` /
  `handleTurn` carry `fallow-ignore complexity` suppressions that are
  ACCEPTED-BY-DESIGN, not debt: the scripted fixture mirrors the real
  agent's wire surface one method per branch, and splitting it scatters
  the script across files for zero production value. Future audits
  inherit this verdict — do not re-flag, do not refactor, do not strip
  the suppressions.
- End-to-end: `bun run smoke:mcp` (root) — boots a throwaway server,
  drives the 4-conversation suite over the oRPC WS chat surface, and
  asserts real `jlpt-mcp` child spawns (proof of tool calls) + non-zero
  `content` frames per turn. Needs `crates/jlpt-mcp/target/release/jlpt-mcp`
  built and the agent CLIs (opencode, kilo, agy) on `$PATH`. Last run with
  the TASK-99 transport: `MANOBU_SMOKE_AGENT=opencode bun run smoke:mcp` →
  all turns PASS, and zero `[acp] dropping non-protocol agent stdout line`
  warnings (real opencode speaks clean NDJSON).

## Child DOX Index

_None — `packages/acp` is a leaf workspace. Key modules: `session.ts`
(TASK-80.1 native ACP engine: `SessionController` + TASK-80.6
`registerDirectCli` dispatch; NDJSON JSON-RPC over child stdio via
`@agentclientprotocol/sdk@^0.21` `ClientSideConnection`, zero AI SDK;
parked permissions keyed by `toolCallId` with aioncore optionId echo;
replay suppression on `session/load`; ask parking via public `parkAsk()`
and drill parking via `parkDrillItem()` for host MCP tools), `session-child.ts`
(TASK-99 child-transport
hygiene: `agentChildEnv` spawn env, `tolerantStdout` line framer + junk
bounds, `captureStderr`/`redactSecrets` ring, `withTimeout` + the two typed
transport errors; TASK-102: `isAuthRejection` + the `acpAuthRequiredError`/
`acpConfigSwitchError` turn-failure factories — `Object.assign(new Error,
{ code })`, functions not classes),
`direct-cli-session.ts` (TASK-80.6 the agy dialect adapter: `DirectCliSession` facade + `flattenDirectCliPrompt`),
`direct-cli.ts` (single-shot runner: `runSingleShot` + `probeAgyModels`),
`acp-events.ts` (the `AcpStreamEvent` frame union = the engine-internal
wire contract; TASK-125 key-free `AcpDrillItem` / snapshot / resolution /
`drill_item` event; dual-case `sanitizeAcpToolUpdate` + 64KiB inline-image
strip; `AcpTurnEndEvent.error = { code?, message }` carries the terminal
failure so it reaches the client instead of a bare error stop-reason),
`session-types.ts` (`AcpSessionHandle` + option/result shapes; `authMethodNames`
retained from `initialize` = advertised methods for the auth message only,
never an auth verdict),
`session-normalize.ts` (pure wire→shape folds: config options, legacy
models/modes), `registry.ts` (the agent `AgentSpec` roster + `findAgent`/
`listAgents`), `launch-policy.ts` (`applyLaunchPolicy` → `CommandSpec`),
`mcp.ts` (MCP transport capability negotiation), `conversation-guard.ts`
(`SessionCommandQueue` send-failure taxonomy), `index.ts` (the
registry/`$PATH` discovery surface: `resolveSpawnTarget` +
`listAgentCandidates`)._
