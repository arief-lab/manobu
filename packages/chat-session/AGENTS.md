# packages/chat-session

## Purpose

- Reusable chat-surface package: the state machine any chat-shaped view
  (`/ai`, `/dev/chat-history`, `/chat/history`, future thread / inline
  "ask sensei" widget / per-persona transcript) needs to render. Owns the localStorage
  write-through, the ACP catalog + slash-command fetch hooks, the persisted
  conversation-history reads over the fetch link (`./history`, TASK-101),
  the oRPC
  live-turn engine (`useChatEngine` over the WS link), the model-catalog
  reconciliation, the composer command lane (`./slash`, TASK-80.5), and
  the picker + composer handler wiring. Today only `apps/desktop` consumes it; future surfaces (other
  apps in the monorepo, third-party consumers) can mount
  `<ChatSessionProvider>` without duplicating any of this.

## Ownership

- Project contributors.

## Local Contracts

- Exports (subpaths matching the source filename):
  - `.` → `./src/index.ts` — barrel
  - (TASK-80.6: the `./chat-messages` subpath — `ChatUIMessage`/`ChatTools`/
    `isAskUserPart` seam — was deleted; ask-card typing now lives in the
    internal `chat-engine` module as `isAskCard` over `TMessageAsk`, not a
    package subpath.)
  - `./provider` → `<ChatSessionProvider>` + `useChatSession` hook. Props: `readOnly` (skip the persist effect) and `open: OpenConversationSeed | null` (TASK-101: seed the mount from a PAST conversation instead of the blob's current one; switching `open` mid-mount moves to that conversation).
  - `./chat-session-contract` → the context SLICE TYPES (TASK-83):
    `ChatSessionState` / `ChatSessionActions` / `ChatSessionMeta` /
    `ChatSessionApi` (also re-exported from `./provider` for compat).
    The slices are the implementable Provider contract
    (vercel-composition-patterns/state-context-interface); a future
    server-backed Provider implements the same interface. Keep the slice
    interfaces byte-stable — consumers destructure them everywhere.
    (internal module, no subpath) `provider-initial.ts` → the pure
    helpers `readInitialChatState` / `resolveAgentLabel` /
    `resolvePersonaLabel` / `resolveConversationKnown`; TASK-82's
    conversationId persistence extends
    `readInitialChatState` there, with provider-free tests in
    `provider-initial.test.ts`; TASK-101 adds `OpenConversationSeed` +
    `mergeOpenConversation` (opening a past conversation, pinned in
    `provider-initial.test.ts` and `provider-open.test.tsx`); TASK-157 adds
    `resolveConversationKnown` (the server-proof check behind the
    conversation-known gate, pinned in `provider-initial.test.ts`).
  - `./message-transcript` → `<MessageTranscript>` shared component + `ChatSuggestion` type (TASK-79.1: the empty state takes optional `suggestions` chips wired to `actions.send`; starter CONTENT stays call-site composition — `/ai` passes Japanese-learning prompts, the read-only viewer passes none; TASK-101 adds an optional `messages: TMessage[]` override so a DB-backed transcript (`cardsFromRows`) can render without a live engine; optional `onOpenPaper?: (examId: string) => void` is forwarded to paper-card actions)
  - `./fetcher` → `useAgentCatalog`, `usePersonaCatalog`, `useModelCatalog` + `useSlashCommands(conversationId, known)` (the authoritative `chat.slashCommands` snapshot; TASK-157: it does not ask at all until `known` says the SERVER holds this conversation, and it stays NOT_FOUND-tolerant for a known conversation whose session has not landed yet, so the menu falls back to the live overlay) + `agentCatalogQueryOptions`, `personaCatalogQueryOptions`, `modelCatalogQueryOptions(agentId)`, `slashCommandsQueryOptions(conversationId, known)` (`queryOptions` for `queryClient.ensureQueryData` loaders; `enabled: known`). Agent/persona/model queryFns use `safe()` + `isDefinedError` (TASK-80.8 AC#4): a typed `NOT_FOUND` (dead agent, no models yet) RESOLVES the empty catalog, only a network failure rethrows (TanStack `retry: 2` applies); `slashCommandsQueryOptions` stays `retry: 0` by design (NOT_FOUND-tolerant on a known conversation with no session yet). TASK-102 AC#4/#5: `modelCatalogQueryOptions` additionally resolves a defined `AUTH_REQUIRED` to the `AUTH_REQUIRED_MODEL_CATALOG` (`authRequired:true`, drives the picker's sign-in hint) — the server only 401s after a real session-open rejection, so this is an honest signed-out signal, never a guess; every other defined error stays `authRequired:false`. Pinned by `fetcher.test.ts` (mocks only `./orpc`; `safe`/`isDefinedError`/a genuine `createORPCErrorFromJson` run for real).
  - `./history` → the TASK-101 database side of the chat surface (see the conversation-history contract below): `conversationHistoryQueryOptions` (+ `conversationHistoryQueryKey`, `HISTORY_PAGE_SIZE`), `conversationQueryOptions`, `messageHistoryQueryOptions({ before, conversationId, known })` (+ `messageHistoryQueryKey`, the one place the row-window key is spelled, so an invalidation does not have to answer the `known` gate it is not gating), `cardsFromRows`, `mergeTranscript` (TASK-108: the persisted+live card union an opened `/ai` renders), the TASK-106 older-history path (`useOlderHistory` + `oldestRowId` + `flattenOlderPages` + `OLDER_PAGE_SIZE`), `storedStampToEpochMs`, and the row/summary types derived from `ContractClient` (`ConversationSummary`, `HistoryCursor`, `MessageRow`).
  - `./slash` → the composer's command lane (TASK-80.5, AionUi port): pure, React-free. `AcpCommand`/`SlashCommandItem` types, `acpCommandsToItems`, `mergeSlashCommands` (first-wins by name, source rank builtin > acp > skill), `filterCommands` + `highlightRanges` (char-subsequence fuzzy), `shouldApplyOverlay` (a live push wins only when its `created_at` is newer than the authoritative snapshot), and the menu controller: `slashMenuReducer` / `initialSlashMenuState` / `selectedInsertText` / `menuOwnsKey` (Enter/Tab accept inserts `/<name> ` as plain prompt text; no client-side execution). Config-option picker data: `hasModeOption`, `currentConfigValue`, `configOptionValues` over `ConfigOptionWire`.


  - `./orpc` → `orpc` (the fetch `/rpc` client, full `ContractClient`), `createFetchRpcClient()` (the ONE shared sidecar-URL fetch-link factory, re-exported by `apps/desktop/src/lib/orpc.ts`), `createKeepaliveFetchRpcClient()` (a generic fetch-link factory whose custom fetch sets `RequestInit.keepalive` to `true` for page-lifecycle calls), and `getChatWsClient()` (the `/ws` live-turn client, narrowed to `Pick<ContractClient, "chat">` so the link cannot reach non-chat procedures; lazy-created, no socket on import)
  - `./persistence` → `loadPersistedChat`, `persistChat`, `CHAT_STORAGE_KEY`
  - `./types` → `AgentOption`, `PersonaOption`, `ModelCatalog`, `PersistedChat`
  - (internal module, no subpath export) `chat-engine.ts` → the pure frame-fold
    reducer: `TMessage` union (text/thinking/plan/acp_tool_call/acp_permission/
    acp_permission_resolved/ask/drill_item/acp_terminal_output/error/user_created/
    acp_context_usage/retry_notice (client-only, TASK-104)),
    `transformFrame`, `deriveStatus`, `is*Card` guards,
    `sanitizeAcpToolUpdate` chokepoint, `TMessageDrillItem` plus its key-free
    `drill_item` fold, and the TASK-103 context-usage reading
    (`latestContextUsage` + `contextUsageView`, in `usage.ts`).
- **Context-usage card (TASK-103 AC#1–#6)**: `acp_context_usage` was a
  TRANSIENT frame type (folded to no card), so the agent's context-window
  reading reached the client and was dropped — the learner had no signal that
  a long conversation was quietly filling the window. It now folds to a
  DURABLE `TMessageContextUsage` card with a per-conversation singleton id
  `usage:{conversation_id}` (NOT `msg_id`-keyed): each turn's cumulative
  snapshot full-replaces the one card, and because it is a card,
  `cardsFromRows` re-folds the persisted row on reload / after an agent
  restart (AC#3). The engine already emitted it
  (`packages/acp/src/translator/context.ts`) and the server already persisted
  it (`apps/server/src/chat-persistence.ts`, a fresh row per emit); only the
  client fold changed. `usage.ts` derives the header value: `latestContextUsage`
  picks the newest usage card, `contextUsageView` computes `percent =
  round(used/size*100)` (clamped 0–100) and a `tier`
  (`normal` <70, `warning` 70–89, `danger` ≥90, AC#2). AC#4 is the load-bearing
  rule: `used`/`size` are the agent's OWN reported figures, the UI never divides
  by a guessed window, so a non-positive `size` yields `percent: null` /
  `tier: "unknown"` and the chip shows a raw token count, never a fabricated
  percentage. `<MessageTranscript>` filters `acp_context_usage` out of the
  bubble map (it is a header readout, not transcript content, and filtering
  keeps a usage-only conversation showing the empty state); `apps/desktop`
  renders the chip from the merged transcript. Pinned by
  `context-usage.test.ts` (live fold + singleton replace, persisted row →
  card → selector → percent/tier, the warning/danger edges, the no-guess
  zero-size case) and the golden snapshots.
- **Retry-once policy (TASK-104)**: a retryable agent failure is re-driven
  automatically ONCE before the turn is reported failed. The policy is pure
  and lives in `chat-engine/retry-policy.ts`: `classifyTerminalError` reads
  the terminal frame's error (`error` frame text, or `finish` with
  `stopReason:"error"` and `data.error`). Retryable classes are matched on
  the message text: **rate limit** (`rate limit`, `too many requests`,
  `429`), **timeout** (`timed out`, `timeout`, `deadline exceeded`),
  **empty response** (blank/absent message, `empty response`, `no
  content/response`), **connection reset** (`connection reset/closed`,
  `socket hangup`, `ECONNRESET`, `ECONNREFUSED`). Non-retryable by code,
  final immediately (AC#3, no loops): `AUTH_REQUIRED`,
  `CONFIG_SWITCH_FAILED` — a typed code wins over transient-looking text.
  Anything else is final. `use-chat-engine.ts`'s
  `createRetryOrchestrator` consumes the failed turn's terminal frames
  BEFORE the fold (status rule 1 would otherwise pin the turn as error),
  injects a client-only `retry_notice` card (singleton id
  `retry:{conversation_id}`, never persisted or replayed) via
  `beginRetryNotice`, and re-sends the last prompt text through the same
  `chat.send`. The retried turn's clean finish `settleRetryNotice`s the
  notice to `recovered` — the user's AC#2 signal; a second failure folds
  the real error card and `dropRetryingNotice`s the notice away. The budget
  is one retry per learner send (`noteSend` refills it) and starts at ZERO,
  so history replay of a stored error never fires an unsolicited turn.
  Known artifact: the re-drive is a real `chat.send`, so the server persists
  a SECOND `user_created` row — the same duplicate-bubble shape manual
  `regenerate()` already produces (TASK-107 server contract), accepted.
  Partial output is safe (AC#4): cards upsert by deterministic id and the
  retried turn carries different msg_ids; the list is never cleared.
  Pinned by `retry-policy.test.ts` (classification table, notice folds) and
  the `createRetryOrchestrator` suite (retry-once both directions, AC#5).
- **Finish-frame error fold (TASK-102 AC#4/#6)**: `finish` is normally a
  transient frame (no card). `transformFrame`'s `finish` arm calls
  `foldFinishError`, which folds an `err:{msg_id}` `TMessageError` card ONLY
  when the frame's `stopReason === "error"` AND `data.error.message` is
  present; a clean finish or an error with no message returns the list
  unchanged (never fabricate an empty bubble). The card carries
  `data.error.code`, so `<ErrorBubble>` (`chat-card-switch.tsx`,
  `ERROR_HEADINGS`) renders a distinct heading for `AUTH_REQUIRED`
  ("Sign-in required") / `CONFIG_SWITCH_FAILED` ("Model/mode switch
  rejected") vs a generic failure. `deriveStatus` already treats a present
  error card as terminal `error`. Pinned by `chat-engine.test.ts` "finish
  frame error" (card + code, clean-finish no-card, messageless-error no-card).
- Public surface lives in the JSDoc above each export; biome type
  checks per package; the workspace test suite (`bun run test`)
  runs any future `*.test.tsx` files added next to the lib.
  SSR component specs share ONE fixture: `installLocalStorageStub()` +
  `createTestQueryClient()` in `ssr-test-env.ts` (Bun's test env has no
  DOM and no localStorage; the three inline copies fellow flagged as a
  clone group — new specs import, never re-stub).
- **Accepted-send contract (TASK-100)**: a composer submission is either
  consumed by the engine or it stays put and says why, never both. The rule
  is data in `composer-send.ts` (internal module, no subpath):
  `classifySend({ isSending, text })` → `SendOutcome`
  (`accepted` | `refused-busy` | `refused-empty`, **blank checked before
  busy** so a whitespace draft during a turn is a no-op rather than a
  announced refusal), and `planComposerSend(outcome)` → `{ clearInput,
  notice }`. Ownership: `useChatEngine().send` **returns** the outcome (the
  engine is the single authority on "a turn is in flight"; it also protects
  `regenerate` and the transcript suggestion chips), and only
  `ChatSessionProvider.send` touches the draft — `setInput("")` when the
  plan says so, otherwise the text stays and `sendNotice` (the state slice,
  rendered by `send-notice.tsx`) carries the reason. `sendNotice` is a
  `ComposerNotice | null` — `{ text, tone }`, not a bare string: the lane was
  born for refused sends and painted everything `text-destructive`, but
  `setNotice` is now also how `/ai` reports a ready paper, a dry level and an
  offer receipt, so a hardcoded red made a success look like a failure. Before
  this the provider cleared unconditionally right after a refusal, so a learner
  typing ahead of a streaming turn lost the text AND lost it again on
  reload (the persist effect wrote the empty draft into the blob). Do not
  re-derive "busy" in a caller to decide whether to clear: read the
  outcome. Do not persist `sendNotice` either — it is a transient
  explanation of a draft that IS persisted; it clears on the next accepted
  send and on every identity reset (`reset`, `selectAgent`,
  `selectPersona`). `actions.setNotice(text, tone?)` is the explicit
  local-degradation escape hatch used by TASK-125 when an explicit drill has no
  reachable item; it never sends that text through the model. `tone` defaults to
  `error` (the refusal path and any caller that says nothing), and
  `noticeToneClass` in `send-notice.tsx` is the ONE pure map from tone to colour
  (`error`→destructive, `success`→success, `warning`→warning, `info`→muted) —
  pinned by `send-notice.test.tsx` and the `composer-notice-success-painted-as-error`
  seam, so a new tone cannot silently reuse the red.
- Persistence model (TASK-58 decision, TASK-101 correction): the blob is
  the CURRENT conversation's resume handle, not the conversation history.
  ONE shared persisted conversation across surfaces. Every writable `<ChatSessionProvider>`
  loads and writes the same versioned blob (`manobu:chat:v1`), last
  writer wins — the blob carries the composer draft too (`input`,
  TASK-66: `/` and `/learn/*` each mount their own shell, so cross-
  layout navigation remounts the provider; the draft must ride the blob) — a teacher conversation is one thread, and continuity
  between the rail/widget and `/ai` is the product intent. The blob
  also carries the CONVERSATION IDENTITY (`conversationId`, TASK-82):
  a reload reconnects to the same server-side conversation and the
  engine's connect-time replay restores the transcript — never mint a
  fresh id per mount again. `reset` (New Chat) is the ONLY id reset:
  it mints fresh + overwrites the blob, and since TASK-101 that orphans
  nothing — the chat it replaces stays reachable through the server's
  history list. Implausible persisted ids
  self-heal via `resolveConversationId` (UUID-shape guard in
  `provider-initial.ts`, unit-pinned). Replay window is the server's
  `limit: 200` in `chat.subscribe` (apps/server AGENTS.md). In-memory
  state stays per-instance (multi-mount.test.tsx); persistence.test.ts
  pins the storage contract. Read-only mounts (`readOnly` prop — e.g.
  `/dev/chat-history`) skip the persist effect entirely; a debug viewer
  must never join the write race. A schema change bumps to `:v2` and
  starts fresh; old blobs are left behind.
- **Conversation-history contract (TASK-101)**: the package owns the
  database side of "come back to an old chat", exported from the separate
  subpath `@manobu/chat-session/history` (never from the barrel — the
  history surface is fetch-link only, so a chat-less consumer must be able
  to import it without the engine). Three `queryOptions` builders
  (`conversationHistoryQueryOptions` — the infinite/keyset list, page size
  `HISTORY_PAGE_SIZE`; `conversationQueryOptions` — one conversation's
  identity, used by a route loader so an unknown id fails before mount;
  `messageHistoryQueryOptions` — the raw persisted rows, asked only for a
  conversation the server holds, see the conversation-known gate below), the pure
  `cardsFromRows` fold (rows → `TMessage[]`, replayed with `replace: true`
  through the SAME `transformFrame` the live turn uses, so a row the frame
  schema rejects is skipped rather than crashing the transcript), the pure
  `mergeTranscript` union (TASK-108: `mergeTranscript(persisted, live)` keeps
  the persisted cards as the chronological base and appends only the live cards
  whose deterministic id is absent from the database, so an opened chat renders
  its stored rows AND a send made after opening streams in without double-
  rendering the shared history), and
  `storedStampToEpochMs` (the UTC-safe parse for both stored timestamp
  shapes). Opening a conversation is a SEED, not a write: the provider
  takes an `open: OpenConversationSeed | null` prop and `mergeOpenConversation`
  (`provider-initial.ts`) decides what follows — the stored `agent`/
  `assistant` win (the ACP session belongs to the CLI that made it),
  `messages`/`input`/`model` are cleared (the draft belongs to the chat you
  left). TASK-108: an OPENED `/ai` transcript now comes from the DATABASE, not
  the engine's connect-time replay — the route folds `messageHistoryQueryOptions({
  conversationId: meta.conversationId, known: true })` (the loader confirmed that
  id, so it is known by definition) through `cardsFromRows` and passes `mergeTranscript
  (cards, chat.messages)` as `<MessageTranscript messages>`. The seed still
  clears `messages` because the route owns the DB render; a chat whose agent CLI
  is offline (no replay) or whose replay truncates opens to its persisted rows
  instead of the empty state. `meta.conversationId`
  exposes the active id so a reader (`/dev/chat-history`) never re-derives
  it from storage, `meta.conversationKnown` (TASK-157, see the
  conversation-known gate below) exposes the Provider's server-proof verdict
  so a reader gates its row fetch the same way rather than re-deriving it, and
  `<MessageTranscript messages>` is the override that
  lets a DB-backed transcript render without a live engine. Rename and
  delete are the caller's `useMutation` over `orpc.chat.*` — the desk
  invalidates `conversationHistoryQueryKey` (`["chat", "history"]`) rather
  than patching rows, because the server is the list's source. **TASK-107
  (persisted user-frame contract):** the rows an opened transcript folds now
  INCLUDE the learner's turns — the server's `chat.send` stores each prompt as a
  `user_created` row (`packages/api-contract` frame; folded client-side by
  `folds/simple.ts::foldUserCreated` to card id `user:{msg_id}`), so
  `cardsFromRows`/`mergeTranscript` render learner bubbles interleaved with agent
  frames, and the live `use-chat-engine` path relies on the SAME server-emitted
  `user_created` frame (no optimistic append). This package stays a pure
  CONSUMER of that persistence: it never writes the user row itself.
  **TASK-106 (older-history paging, relation to the connect-time replay):**
  `messageHistoryQueryOptions` and the engine's `chat.subscribe` replay are the
  SAME newest-200-row window (the server clamps both at `listMessages`' hard
  cap); neither ever reaches the first turns of a long chat. The older path is
  a strictly-older COMPLEMENT, not a second replay: `useOlderHistory` walks
  `chat.listMessages` with `before` = the oldest held row id (the store's keyset,
  strict `lt`, ascending pages), `flattenOlderPages` prepends the fetched pages
  (oldest page first) to the window, and the route's fold stays
  `mergeTranscript(cardsFromRows(rows), live)`. Ordering can never interleave:
  rows persisted after opening carry ids ABOVE the window, so an older page
  cannot pick them up, and live-only cards append after the persisted base.
  Paging ends at a short page (or a NOT_FOUND answer, which means the
  conversation has nothing older). `/dev/chat-history` keeps its single
  window: the walk is the `/ai` route's affordance.
- **Conversation-known gate (TASK-157, split by TASK-172)**: the two reads
  the server can answer `NOT_FOUND` for are gated separately, because the
  server's two failure modes are different.
  - `chat.listMessages` returns `NOT_FOUND` only for a conversation the
    server has never created. Gate: `resolveConversationKnown`
    (`provider-initial.ts`), true on either of the server's own claims:
    `open` names this id (the learner put it in the route and the loader
    awaited `chat.getConversation` for it before mount), or the engine's card
    list is non-empty (each card arrived on the connect-time replay of stored
    rows, on a live frame, or in the persisted transcript of a conversation
    that already had a turn). A stored conversation with no rows answers 200
    with an empty list, so `open` alone is enough.
  - `chat.slashCommands` (TASK-172) returns `NOT_FOUND` for a conversation
    the server created but never ran a turn on: the ACP session id
    (`storedSessionId`) is persisted only inside the first turn
    (`context.ts:386`, reached by `runTurn`), never at row creation. The
    exam paper chat (`apps/desktop/src/routes/exam/$examId.tsx`) reproduces
    this: the route always sets `open`, the paper is a server-built card, and
    no turn has run, so the mount 404s. Gate: `resolveSlashSnapshotReady`
    (`provider-initial.ts`), true only once the transcript holds a card a
    LIVE AGENT SESSION emits (`text`, `thinking`, `plan`, `acp_tool_call`,
    `acp_permission`, `acp_terminal_output`, `acp_context_usage`, `ask`).
    The session id is set synchronously at the head of `runTurn`, before any
    streamed frame, so any agent-produced card proves the session is stored.
    Deliberately excluded: `user_created` (emitted at `chat-rpc.ts:470`,
    BEFORE `runTurn` sets the id, so the same send's ack can carry it with no
    session), `paper` and `drill_item` (server-published, no session),
    `error` and `retry_notice` (a client-side notice and a pre-session
    AUTH_REQUIRED both surface without ever opening one).
  What is NOT evidence for either gate, and must never be used: the id itself
  (`resolveConversationId` mints `crypto.randomUUID()` for a fresh chat), its
  length or shape, and the localStorage blob — `persistChat` writes the minted
  id on mount, before any send, so a never-used id is indistinguishable from a
  real one. A `conversationId.length > 0` gate returned 404 twice on every
  fresh `/ai` before TASK-157, and `open`-only gating on slashCommands kept
  the exam-mount 404 alive after it. Mechanism: `enabled` inside both
  `queryOptions` factories (the house convention, `fetcher.tsx`'s
  `enabled: Boolean(agentId)`), with the boolean passed in by the Provider
  (`meta.conversationKnown` for history, `resolveSlashSnapshotReady(messages)`
  for the slash snapshot) or by a loader that already confirmed the row
  (`known: true`). The server's `NOT_FOUND` contract and both client
  degrade-to-empty paths stay exactly as they were: this removes calls, not
  errors. The TASK-157 note that "one honest window survives by design" for
  slashCommands is now closed for the slash read specifically: the menu falls
  back to the live `available_commands` overlay until the first agent card
  lands, then the snapshot fetches once. Do not reopen either gate by
  re-enabling speculative reads.
- Depends on `@tanstack/react-query` (`queryOptions` + `useQuery` with hierarchical keys `["agents"]`, `["assistants"]`, `["agents", agentId, "models"]`, `signal`, `enabled`, `staleTime 60s`/`gcTime 5m`/`retry 2`); host app must provide `QueryClientProvider` (`apps/desktop/src/lib/query-client.ts`) above `<ChatSessionProvider>`.
- ask_user card (TASK-80.4, replaces the TASK-79.4 pinned-card handoff): the agent's `ask_user` request arrives as the engine's `TMessageAsk` card (`type: "ask"`). `<MessageTranscript>` renders it inline via `<AcpAskPart>` (the @manobu/ui `AcpAskCard`), which submits answers through `chat.answerAsk` over the WS oRPC link — the old pinned `<QuestionCard>` + `actions.answerAskUser` next-user-message transport is deleted. TASK-86 terminal states: replayed ask rows carry `status` (`pending`/`finish`/`error`) from the server; `<AcpAskPart>` maps a settled row to the card's `resolution` prop so the reload renders the compact answered/declined/expired summary, never a re-tappable form. A live submit collapses the same way from the card's local state. `deriveStatus` treats a PARKED ask (status not finish/error) as `streaming` — the agent is blocked on the answer and Stop is the only way out, so the composer must keep showing Stop.
- Permission card replay state (TASK-109): the server now replays the lifecycle `status` for `acp_permission` rows too (was ask-only), so a park orphaned by a crash renders expired instead of tappable. The permission fold carries the replayed `status` through refresh (a later statusless re-issue must not erase the terminal state), and `<AcpPermissionPart>` renders `status === "error"` while NOT settled as a disabled "Permission request expired" card (a settled card still outranks: "Response sent"). A `pending` replay stays interactive — a reload while the park is still live must still answer.
- Drill item card (TASK-125): `drill_item` folds to `TMessageDrillItem` with deterministic id `drill:{request_id}`. The initial projection copies only `anchors`, `id`, `itemType`, `level`, `options`, `passage`, and `prompt`, so `answerIndex`, `correctIndex`, `script`, and FSRS keys never enter a pending card; `resolution` is attached only for the answered phase. `DrillItemPart` calls `chat.answerDrillItem` over the WS link, submits `chat.skipDrill`/`chat.stopDrill` from the live pending card, consumes the returned verdict for the immediate local settle, and passes `readOnly` through `ChatCardSwitch`; replayed pending rows are static, while answered, suspended, summary, and unavailable rows retain their semantic state. Error replay maps to an unavailable, non-tappable card. The shared `CHAT_CARD_MEASURE` (`max-w-2xl`) is owned by the transcript surface, and `drill_item` is in `STRETCHED_TYPES` beside ask so the two Card families cannot grow competing widths.
- Paper card (TASK-126/127/128): the `paper` wire frame folds to `TMessagePaper` with deterministic id `paper:{exam_id}`. `PaperPart` maps only the structural, key-free receipt/result/debrief projection into `@manobu/ui`'s `PaperCard`; its optional `onOpenPaper` callback supplies the card's `onStart` action with `card.examId` for ready, running, submitted, and raw-only cards; `paper` is a stretched Card family. Generation frames carry counts, section state, mode/floor labels, and no answer indexes, scripts, explanations, FSRS links, or option-source keys. Submitted frames may add saved weak-anchor facts, while `abandoned` carries the honest no-score end state; TASK-128's generated explanation, correct option, and dispute state stay in the submitted-only debrief/review surface, never the transcript card. The debrief fold carries `weakAnchorLabels` beside `weakAnchors` ids (TASK-160) but only when the frame has it: a paper stored before the field has no `weakAnchorLabels` key at all, and the card reads that absence as "show nothing" rather than printing the join key. Banded result folds keep the overall gate and section gates as separate facts, and each section's display name is DERIVED at fold time by `examScoringSectionLabelForMode({ id: section.id, level, mode })` from `@manobu/api-contract`: the `paper` frame's result sections carry the scoring `id` only (TASK-137), because `history.ts` re-parses stored rows and a name baked into a frame would outlive the naming rule. The fold needs the frame's `level` because `language-knowledge` is the split column at N1/N2 and the folded Language Knowledge·Reading one at N4/N5, and **TASK-173.3 added the frame's `mode`**: a `real` paper names its sections with the official Japanese 科目 while `shortened`/`exam-conditions` keep English, so `projectResult(level, result, mode)` threads the mode to every column label (the test `chat-engine/paper.test.ts` "names the folded result section by the paper's mode" pins both languages). The actual answer key remains server/debrief-only. `chat-card-switch.test.tsx` and `chat-engine/paper.test.ts` pin the fold and structural containment; `transcript-suggestions.test.tsx` and `parts/paper-part.test.tsx` pin the SSR callback/action, submitted navigation label, abandoned state, and key-free projection; `orpc.test.ts` pins the keepalive fetch option used when leaving a running paper.
- **A host tool never reaches the transcript as a raw tool card (TASK-110, completed by TASK-149).** `HOST_TOOL_NAMES` (`@manobu/acp`, `acp-events.ts`) is the list: `ask_user`, `next_drill_item`, `start_exam`. Add a host tool THERE, never to a fold. Two halves hold the property, and neither is redundant:
  - The sidecar's sink (`apps/server/src/chat-persistence.ts`) drops the whole call from BOTH planes — live ring and stored rows — and CLAIMS the `toolCallId` on the frame that names the tool. The claim is what makes the drop complete: ACP puts the title only on the frame that OPENS a call, so the follow-up `tool_call_update`s arrive with `title: null`, and a title-only filter leaked the raw JSON on that second frame both live and in `messages`.
  - `foldAcpToolCall` (`src/chat-engine/folds/tool-call.ts`) deletes an existing card when `isHostToolCallTitle(title)` claims the title (prefix-shaped, so `<server>_<host tool>` is claimed by design) — that is why a generic card that streamed first disappears when `manobu-host-tools_ask_user` arrives — AND refuses to INVENT a card from a `tool_call_update` that has no title and no card to update. That refusal is not belt-and-braces: the titled frame is dropped upstream, so the title-less update is the FIRST frame this reducer ever sees for a host call, live and on reopen (`cardsFromRows` re-folds stored rows through it). An update never builds a card, for any tool: an agent that opened a call with no title is rarer than a host call whose raw JSON would show, and a card with no name is not worth a leak.
  - The claim cannot live in the client: it needs a title the client never receives.
  - Pinned by `apps/server/test/host-tool-suppression.test.ts` (both planes, plus the non-host control that must still publish and store), `chat-engine.test.ts` and `history.test.ts`; mutation seams `host-tool-claim-not-carried` and `host-tool-update-invents-a-card`.
- Part components live in `src/parts/` (TASK-80.4 + 80.4.1): `acp-tool-call-part.tsx` (`<AcpToolCallPart>` → @manobu/ui `AcpToolCallCard`; it is also where TASK-160's `debug` decision lives — this package may read `@manobu/env/web` and `packages/ui` may not, so the part passes `env.VITE_DEBUG === "1"` and the raw tool-call id stays out of a learner's transcript), `acp-permission-part.tsx` (`<AcpPermissionPart>` → `AcpPermissionCard`, submits via `chat.confirm`), `acp-ask-part.tsx` (`<AcpAskPart>` → @manobu/ui `AcpAskCard`, submits via `chat.answerAsk`), `drill-item-part.tsx` (`<DrillItemPart>` → @manobu/ui `DrillCard`, submits via `chat.answerDrillItem`), `acp-terminal-part.tsx` (`<AcpTerminalPart>` → `AcpTerminalCard`, kill via `chat.killTerminal`), `text-part.tsx` (`<TextPart>`, the Streamdown wrapper) and `acp-thinking-part.tsx` (`<AcpThinkingPart>`, TASK-87: the collapsed-by-default thinking strip over @manobu/ui `Collapsible`; `readerChoice ?? followingStream` is the whole state — live turns read the reasoning expanded and collapse when the turn's answer card lands, replayed history starts collapsed, the strip never echoes raw reasoning). Card dispatch lives in `src/chat-card-switch.tsx` (TASK-81.5): `<ChatCardSwitch card isStreaming answered>` is the SINGLE documented dispatch site — a table keyed on the `type` discriminant (`CARD_BODIES`, one row per card family, each row re-asserting its engine guard) wrapped in the assistant bubble envelope (`<ChatCardRow>` adds the scroller item + key). The six `Card`-based families (`STRETCHED_TYPES`: tool-call, permission, ask, terminal, drill, paper) wrap in a STRETCHED ghost bubble (`w-full`, TASK-90): @manobu/ui `Card` carries `[container-type:inline-size]`, and inline-size containment contributes 0 to a fit-content parent, so a `w-full` Card inside the default `w-fit` bubble collapses to 0 width. New Card-based families must join `STRETCHED_TYPES` (pinned in `chat-card-switch.test.tsx`). `answered` is the msg_id set from `answeredTurnMsgIds(cards)` (computed once in `message-transcript.tsx`); only the thinking family reads it. `message-transcript.tsx` only maps cards to `<ChatCardRow>`; do NOT re-inline the dispatch (complexity suppressions lived here before and must not return). Order of the old guard chain is irrelevant now; unknown types render nothing (defensive). The old `AskUserPart` / `QuestionCard` are deleted; the pinned-card mechanism (`unansweredAskUserPart`) is gone.

## Work Guidance

- **Tailwind scan (found the hard way, TASK-87):** the classes this package
  renders are NOT picked up by `@manobu/ui`'s `globals.css` (it sources
  `apps/**` + `packages/ui/**` only). The host app must add its own
  `@source "../../../packages/chat-session/src/**/*.{ts,tsx}"` — done in
  `apps/desktop/src/index.css` next to the streamdown source. Without it a
  chat-session utility only styles by coincidence (some app/ui file happens
  to use the same class), so a new class silently renders unstyled.
- The Provider's `ChatSessionApi` interface is the load-bearing
  contract with consumers. Adding a new field is acceptable; renaming
  or removing one requires updating every chat surface that destructures
  it (currently `apps/desktop/src/routes/ai.tsx` and `dev.chat-history.tsx`).
- The provider's live-turn surface rides the oRPC WS link
  (`getChatWsClient()`, `src/orpc.ts`) against the sidecar's `/ws`;  Persisted-state + catalog reads ride the fetch link (`orpc`,
  `/rpc`).
- TASK-80.14 live-drain contract (supersedes the 80.7 lastEventId
  cursor): `useChatEngine`'s `runSubscribeLoop` treats a CLEAN stream
  close as "turn settled" — it resubscribes WITHOUT a lastEventId
  cursor; resume = server-side history + in-flight snapshot on the next
  connect. The wire envelope and reducer contract are unchanged
  (`replace:true` snapshots, ui_id card growth). Do not re-introduce a
  client-side seq cursor: server frames are the DB row seq only for
  persisted frames, and the stream-only `acp_terminal_output` lane has
  no stable seq at all. A clean close parks on a wake gate (accepted
  sends and retry acks notify it) with a 1s fallback; it must never
  recursively resubscribe an idle settled conversation. The regression
  is pinned by `use-chat-engine.test.tsx`'s idle-close case.
- Guard semantics (regression pinned 2026-09-20): `guard()` returns TRUE
  when the engine is ALIVE (`!disposedRef.current`), so the stale-frame
  drop is `if (!guard()) return;` — commit 585db4b's biome-ignore
  cleanup inverted it to `if (guard()) return;`, silently discarding
  every live frame for days (streaming status + empty transcript, zero
  errors). The fake-client unit tests did NOT catch it (they drive
  frames around `handleFrame`'s guard), so any change to frame
  delivery must be verified against the live UI (browser probe: raw
  oRPC WS link replay + a real send, compare transcript growth).
  Both derive their origin from `@manobu/env/web` (`VITE_SERVER_URL`),
  which the consumer must configure.
- TanStack Query: `.agents/skills/tanstack-query/SKILL.md` — `fetcher.tsx` exports `queryOptions` with hierarchical keys + `signal` + `enabled` + `staleTime`/`gcTime`; hooks are thin `useQuery` wrappers returning empty fallback so pickers stay resilient when server unreachable; loaders should `ensureQueryData(agentCatalogQueryOptions)` via `RouterAppContext.queryClient`.
- Do not put route-shaped UI (the Picker trio, the InputGroup composer)
  in here. Those are call-site composition; only share the
  route-independent parts (Provider, transcript, fetcher, persistence,
  types).

### Card-id scheme (regression pin, 2026-09-21)

Text/thinking card ids MUST be type-scoped (`text:{msg_id}` /
`thinking:{msg_id}`), mirroring the server's `ui_id` scheme
(chat-persistence `frameUiId`). Every frame in a turn shares ONE turn
`msg_id`; a bare-msg_id id collides across text/thinking and each later
chunk falls into the different-type fall-through, appending a duplicate
card per chunk (live UI showed 2000+ entries / 12 unique ids / duplicate
React keys). `foldText`'s regression test models the shared-msg_id
sequence; changing the id scheme requires regenerating the goldens AND a
live-UI smoke.

## Verification

- `bun run check-types` (from this directory, or via Turbo from repo root).
- `bun run check` (Ultracite) from repo root.
- Workspace end-to-end: `bun run test` runs `packages/ui` test suite
  (provider/types share the same `@manobu/ui` rendering layer). Add
  `*.test.tsx` files alongside the lib to cover any future hooks.
- `bun test packages/chat-session` — `composer-send.test.ts` pins the
  accepted-send decision table (TASK-100: refused send keeps the draft and
  explains it), `send-notice.test.tsx` the empty-notice markup through the
  real Provider. No DOM test env exists in this workspace
  (`use-chat-engine.test.tsx:5-7`), so the notice's shown branch and the
  composer's live behaviour are verified in the running app.
- `history.test.ts` pins the TASK-101 row fold (replace semantics, a bad
  row skipped instead of crashing the transcript, ask AND permission rows
  keeping `status` — TASK-109 parity with `toWireFrame`, and a saved
  ask_user turn rendering the ask card only — TASK-110) and
  `storedStampToEpochMs`'s two shapes; the TASK-106 block pins the paging
  primitives (`oldestRowId` reads the cursor, `flattenOlderPages` walks a
  longer-than-window transcript back to the first turn with no gaps or dups,
  older pages + window fold AHEAD of live-only cards);
  `provider-open.test.tsx`
  + `provider-initial.test.ts` pin the open-seed rules through the real
  Provider (stored agent/persona win, blob transcript/draft/model do not
  follow); `exports.test.ts` pins the `./history` subpath surface.
- **TASK-157 (conversation-known gate)** is pinned three ways:
  `provider-initial.test.ts` on the derivation (minted id → false, open seed →
  true, a transcript card → true, New Chat under an open seed → false),
  `fetcher.test.ts` and `history.test.ts` on `enabled` (false for an unknown
  conversation, true for a known one, and a known conversation with no session
  yet still folds to an empty menu rather than throwing). Load-bearing check:
  mutation seams `chat-history-reads-unconfirmed-conversation`,
  `chat-slash-snapshot-reads-unconfirmed-conversation`,
  `chat-conversation-known-everything`.
- `drill-item.test.ts`, `history.test.ts` drill cases, `chat-card-switch.test.tsx`, and `parts/drill-item-part.test.tsx` pin the TASK-125 key-free pending projection, five phase states, resolution settlement, replay/read-only rendering, WS adapter shape, and stretched dispatch. The shared transcript measure is `CHAT_CARD_MEASURE` (`max-w-2xl`) and must remain the only card-width token in this package.
- **Golden transcript snapshots (TASK-81 AC#2)**:
  `chat-engine-golden.test.ts` pins the COMPLETE `TMessage[]` output
  (card families, merge paths, deriveStatus sequence) for two realistic
  turn scripts under `src/goldens/chat-engine/` — the safety net for the
  TASK-81.2 folder-ization. Regenerate only on an intentional reducer
  change: `UPDATE_GOLDENS=1 bun test src/chat-engine-golden.test.ts`,
  review the diff.

## Child DOX Index

_None._
