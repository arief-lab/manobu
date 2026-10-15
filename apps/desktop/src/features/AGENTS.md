# apps/desktop/src/features

## Purpose

- Bulletproof feature slices (TASK-71 AC5): one directory per SCR surface,
  each owning its UI compound, data hooks, and local state. Routes in
  `src/routes/` compose features; features never import routes.
- **Sub-canonical** AGENTS.md per the DOX canonical-per-subtree rule
  (see root `AGENTS.md` § Canonical-per-subtree). The canonical doc
  for this subtree is `../AGENTS.md` (`apps/desktop/AGENTS.md`), which
  owns the full SCR-01..SCR-12 catalog row-by-row + the per-route
  loader/validateSearch/loaderDeps audit table + the `lib/` index.
  **This file is the features perspective** — it owns the
  data-fetching tier split (Tier 1 / 2 / 3) and the Vercel composition
  contract.

## Directory map

| Feature | Contents | SCR |
| --- | --- | --- |
| `dashboard/` | `dashboard.tsx` | SCR-01 |
| `setup/` | `setup.tsx` | SCR-13 (first-run bento) |
| `drill/` | `drill-lab.tsx`, `kana-chart.tsx` | SCR-03 |
| `listen-type/` | `listen-type.tsx` | SCR-04 |
| `reader/` | `reading-corner.tsx` | SCR-05 |
| `lesson/` | `worksheet.tsx` (SCR-08), `conjugate.tsx` (SCR-06) | SCR-06/08 |
| `kanji-detail/` | `kanji-detail.tsx` (stroke renderer in `shared/kanji-vg.tsx`) | SCR-09 |
| `mock/` | `jlpt-mock.tsx`, `kana-checkpoint-result.tsx`, `review-queue.tsx` | SCR-10/12, TASK-129 |
| `roleplay/` | `roleplay.tsx` | SCR-07 |
| `settings/` | `settings.tsx` + extracted section compounds (privacy, speech models, scheduled tasks, level + goal pickers) | SCR-11 |
| `ask-sensei/` | `widget.tsx`, `panel.tsx` (floating launcher + panel; the AppShell `rail.tsx` was deleted with the shell, router audit 2026-09-14; launcher hides itself on `/ai`, `/learn/conversation`, and `/exam/*` because those own their chat surface) | — |
| `chat/` | `chat-column.tsx` (shared full-height provider-consuming chat shell for `/ai` and the TASK-127 exam workspace) | — |
| `exam/` | `exam-paper-pane.tsx`, `exam-paper-scope.tsx`, `exam-question.tsx`, `exam-collapse.ts` | TASK-127/128 |
| `chat-history/` | `history-desk.tsx` (TASK-101: the server's conversation list + open/rename/delete; route `chat.history.tsx` is chrome-free) | — |

App chrome (`header`, `loader`) is in
`src/shared/` — see `../shared/AGENTS.md`. (`conversation-bubble.tsx`
was the shared chat bubble; deleted in TASK-80.6 with the learn-route
cutover — the route now mounts the `@manobu/chat-session` transcript.)
(`app-shell.tsx` + `level-selector.tsx` deleted with the `/learn` layout; SCR-02
`onboarding/` deleted too — see the canonical SCR table.)

## Local Contracts

### Data-fetching tier split (TASK-25.1)

The convention set in `apps/desktop/AGENTS.md` § Work Guidance: every async
data fetch goes through `queryOptions` + `useQuery` / `useMutation` + route
`loader` (with `ensureQueryData`) + `loaderDeps`. **No hand-rolled
`useState+useEffect` for async data.** Three tiers below; the only tier
that should grow is the first.

#### Tier 1 — async data, fully wired (the model)

| Feature | Async source | Hook | Route loader |
| --- | --- | --- | --- |
| `lesson/` (jlpt deck only) | `orpc.jap.vocab.list` (failure → empty deck, never a fake) | `useQuery` over `lessonVocabQueryOptions(level)` | `lesson.tsx` — `ensureQueryData` when `goal=jlpt`; curated goals (travel/anime/work) ship in-bundle, no fetch |
| `kanji-detail/` | `orpc.jap.kanji.find` + `orpc.jap.vocab.list` + `orpc.jap.kanji.stroke`, wrapped by `lib/kanji-queries.ts` / `lib/kanjivg-queries.ts` | `useKanji` / `useKanjiStrokes` / `useQuery(kanjiListQueryOptions)` | `kanji/$character.tsx` — `ensureQueryData(kanjiQueryOptions(params.character))`; `kanji/index.tsx` — loader-warm `ensureQueryData(kanjiListQueryOptions(level)).catch(→undefined)` (in-page KanjiError stays, router audit 2026-09-14) |
| `mock/` (jlpt-mock) | the route's own `SEED` questions (`src/routes/jlpt-mock.tsx:27`) served by `mockQueryOptions` = `Promise.resolve({ filter })`, no fetch (TASK-158 decided: INTERNAL-ONLY, no entry point and none may be added; `JlptMock` has exactly one consumer, that route) | `useQuery` over `mockQueryOptions(filter)` | `jlpt-mock.tsx` — `ensureQueryData(mockQueryOptions(filter))` |
| `mock/` (review desk, TASK-155) | `orpc.cards.due` read + `orpc.cards.grade` write, both in `lib/cards.ts` (read failure → `{ cards: [], dueCount: 0, deckCount: 0, nextDue: null }`; the write has `retry: 0` because an FSRS grade is not idempotent, and invalidates `["cards","due"]` on success, which is what advances the desk — there is no local index). The `usePersistCards`/`useGradeCard` hooks deleted 2026-09-15 were dead seeds; this `useGradeCard` answers `POST /cards/grade` | `useCardsDue` + `useGradeCard` | `review.tsx` — `ensureQueryData(cardsDueQueryOptions)`, shared key with the dashboard tile |
| `settings/` | Tauri `invoke`s: `speech_*` + `cron_*` (2026-09-14: ScheduledTasks moved onto the cache — `cronJobsQueryOptions`/`cronHistoryQueryOptions` + upsert/remove/run-now/clear mutations invalidating both keys) | `useQuery`/`useMutation` over `lib/tauri-queries.ts` | `settings.tsx` — `Promise.all([speechStatus…, speechModels…])` |
| `chat-history/` (TASK-101) | `chat.listConversations` (keyset-paged) over the package's `conversationHistoryQueryOptions`; rename/delete over `orpc.chat.renameConversation`/`deleteConversation` | `useInfiniteQuery` + `useMutation` (both invalidate `conversationHistoryQueryKey`) | `chat.history.tsx` — `ensureInfiniteQueryData` (note: the loader audit's `ensureQueryData` assertion does not cover it; it is in `test/route-loaders.test.ts`'s ROUTES list only) |
| `chat/` (TASK-127) | package catalog probes + `messageHistoryQueryOptions` (gated on `meta.conversationKnown`, TASK-157) + older-message paging | `useQuery` + `useOlderHistory` | mounted beneath each owning route; `/ai` and `/exam/$examId` warm their opened conversation in their route loaders |
| `exam/` (TASK-127/128) | `lib/exam-queries.ts` over fetch `/rpc` `exam.*`: 1s polling while in progress, submitted-only result/debrief/review queries, and cache-writing start/pause/resume/answer/advance/submit/abandon/dispute mutations; replay is the live `chat.startDrill` WS seam | `useSuspenseQuery` + `useQuery` + mutation hooks | `exam/$examId.tsx` warms the paper first, then the paper's conversation + message history |

TASK-71 phase 4 (complete): every `src/lib/` data fetcher calls the typed
oRPC client instead of hand-rolled `fetch` — `lib/next-cards.ts`,
`lib/kanji.ts`, `lib/lesson-cards.ts`, `lib/kanjivg.ts`, `lib/mock.ts` and
`lib/cards.ts` (last, the desk's due queue). `src/lib/orpc.ts` is the single
import point and re-exports `@manobu/chat-session/orpc`, which owns the link
and is the only place that reads `VITE_SERVER_URL`. One deliberate exception
remains: `lib/mock.ts` reads it once for the `hasServer` guard, which skips
the round trip when no sidecar is configured (an absent origin means
same-origin to the link, not absent).

Split note (TASK-32.1): `settings/settings.tsx` is a Root that imports back
its extracted section compounds; route files import `SettingsTab` from
`settings-scope.tsx`, not from `settings.tsx`.

### Shared chat and exam composition (TASK-127)

- `chat/chat-column.tsx` consumes an existing `useChatSession`; routes own the one `ChatSessionProvider` mount. The column owns the full-height header wrapper, offline notice, older-history control, merged transcript, `InputGroup` composer, the shared CLI/model/mode pickers (`chat/composer-pickers.tsx::AgentModelModePickers`), the New-session control, send/stop action, and slash reducer/menu. Because the pickers live on the shell, every ChatColumn route (`ai`, `exam/$examId`, `learn/conversation/$sessionId`) offers the CLI picker; `composerControls` is only for a route's EXTRA controls on top of them. The `ask-sensei` widget keeps its compact frame (own close header, no `ChatColumn` chrome) but reuses `AgentModelModePickers` directly in its composer.
- Switching the CLI does NOT wipe the conversation: `provider.tsx::selectAgent` keeps the transcript and only drops agent-scoped overlay state (model/config-option/slash-command), because the transcript is stored per conversation (agent-agnostic) and each turn carries the agent explicitly (`chat.send({ agent })` → `resolveHandle(agent, conversationId)`, pool key `agent::conversationId`). `actions.reset` (the New-session control) is the ONLY path that clears the transcript and mints a fresh `conversationId`.
- Its typed route seam is `header: ComponentType<ChatColumnHeaderProps>` plus `composerControls`, `onSubmit`, `onSuggestion`, `suggestions`, and `onOpenPaper`. The header receives the merged card list so route-only context UI stays derived from the same transcript.
- `composerBlockedMessage` disables the textarea, slash menu, and send path, but an already-sending turn still renders the working Stop action. Non-menu keys continue through `actions.onPromptKeyDown`, preserving the provider's IME-safe Enter rule.
- `exam/exam-paper-scope.tsx::PaperScopeRoot` is the paper's single async/state owner. `ExamPaperPane` composes `PaperScope` subs through `Object.assign`; `exam-question.tsx` owns the key-free radio projection, shortcuts, and the section's `ExamSpeechControl` — three states, and the readiness gate is PROACTIVE (TASK-173.8.2 AC#1): ListenButton renders only when a voice is proven, a `checking` mount renders nothing inside Tauri until `ensureTts` settles, and the honest `exam-speech-unavailable` line shows for every voice-less machine (outside Tauri the path stays reactive by design: nothing can install). The exam never offers a download (the owner's instruction: on exam no need to download); the Supertonic voice is fetched on `setup/setup.tsx` and in `settings/`, and `exam-speech-unavailable` points there. Nothing renders for no text; `exam-collapse.ts` owns the explicit-user-first persisted preference plus narrow-screen default.
- `PaperScope.Review` is submitted-only. It consumes the server debrief's key-free `item` plus post-submit `correctIndex`/`correctOption`, marks non-null prose as generated, prints each listening item's `speech` as the review script line (`reviewScriptLine`, TASK-173.8.2 AC#4: the control's "The script is in the review" promise is kept here), and keeps replay/dispute as explicit row actions. Replay uses `getChatWsClient().chat.startDrill({ itemId })`; dispute invalidates the debrief/review query and never patches the result. Banded result gates are rendered as separate total and section facts.
- Section chips are status, not navigation controls. Answers commit first-pick-only and the UI never receives or renders the item key. The visible timer is `aria-live="off"`; only 5-minute, 1-minute, and time-up thresholds enter the polite live region. Route/page exit sends `exam.pause` through the keepalive fetch client so an abandoned page cannot leave an unattended section countdown running. TASK-132 adds `questionStimuli` to the Tier 1 `exam-question.tsx` seams: a stimulus set renders one paragraph per passage in order, with the singular `passage` as the pre-set fallback. TASK-131 keeps the section-label/result projection level-agnostic: N1-N3 render three 60-point scoring sections (including the N1/N2 `reading` column) while N4/N5 retain their two-section model.

#### Tier 2 — local state (no async data; useState/useEffect is correct)

`dashboard.tsx` (mock data inline, `.Momentum` reads `lib/practice-days.ts`),
`listen-type.tsx`, `roleplay.tsx`, `conjugate.tsx`,
`ask-sensei/widget.tsx`,
`kana-chart.tsx`. `conjugate.tsx` (SCR-06 morph card, 2026-09-13) owns its
deck (bundled `verbs-n5.json` import) and its phases — no `initial` prop.
`setup.tsx` is Tier 2 for its own selection state
(goal + level in the compound's context); its async surfaces are the
sensei probe (`lib/sensei.ts` queryOptions + `useSenseiStatus` in the rail,
component-driven like `ask-sensei`, no route loader — `routes/index.tsx`
keeps its `data: local-state` marker) and the `VoiceStatusRow` download
(`lib/tauri-queries.ts` `useSpeechModels` + `useEnsureModel` +
`useSpeechDownloadProgress` + `TTS_MODEL_ID`). That row is the skippable
Supertonic install the exam relies on: it renders only inside Tauri, never
gates `Begin`, and warms `ensureTts` on success so a listening paper speaks
without a restart. Readiness comes from `speech_list_models` →
`ModelInfo.ready` (a disk scan), NOT `speech_status.tts_ready`: that flag
means "the engine object exists in this process", so a query answered before
boot warm-up lands reports an installed voice as missing and offers to
re-download 123 MB. On success the row invalidates both the models and the
speech-status queries, then `ensureTts()`.

#### Tier 3 — props-driven (`initial={{}}` from route)
`drill-lab.tsx`, `kanji-detail.tsx`, `listen-type.tsx` (as child),
`reading-corner.tsx` (story prop from the route's `?story=`),
`worksheet.tsx` (deck + goalLabel props from the route), `roleplay.tsx`,
`jlpt-mock.tsx` — full initial-contract table lives in the canonical
`../AGENTS.md`. (`kana-chart.tsx` still takes `initial={{cells, open}}` from
`drill.tsx?chart=1` / `listen.tsx?chart=1`; `conjugate.tsx` left this tier
with the 2026-09-13 morph-card redesign.)

### TASK-129 kana result and queue

- `mock/kana-checkpoint-result.tsx` is the only answer-key surface for a checkpoint. It renders only when `source="checkpoint"` and the submitted result exists, shows per-script group failures and review rows, and links through `lib/drill-search.ts` to `/drill` without invoking the mock CEFR, sectional, weak-pattern, or plan path.
- `lib/drill-search.ts` is the shared search contract for the checkpoint queue and future weak-pattern bridge: `cell` and `group` accept CSV or repeated values, unknown values degrade to empty selections, and `/drill` can filter a mixed kana/word queue while retaining the script base kind.

### TASK-130 worksheet romaji fade

- `lesson/worksheet.tsx` reads `getKanaCellState` from `lib/kana-mastery.ts`; only `solid` cells fade. Missing or corrupt storage remains `unseen`, and every word chip carries reveal romaji for tap restoration.
- `test/worksheet.test.tsx` covers unseen, shaky, solid, corrupt-store, and tap-reveal data states.

### Vercel composition contract

- Every Root + Sub compound follows `Object.assign(Root, { .Sub })` (no
  boolean prop explosion). Subcomponents share a `*Scope` context
  (`DrillScope`, `ListenScope`, `LessonContext`, `RoleplayProps`); the Root
  owns the state, Subcomponents consume via `useContext`.
- `__test__` exports where needed for source-presence tests.

## Work Guidance

- TTS playback rule (all ▶ surfaces): capture `ensurePlaybackAudioContext()`
  synchronously in the click/change handler, BEFORE any `await` (including the
  `await import("@manobu/speech/tts")` the dynamic surfaces use), then
  `playWavBytes(wav, ctx)` once `speak()` resolves. Never `new Audio(url).play()`
  and never call `speak()` for its side effect alone — Tauri's Linux WebKitGTK
  webview closes the user activation after the first await, so the old pattern
  produced the animated-silence bug the owner reported. Surfaces on this path:
  `shared/listen-button.tsx` (reader, worksheet, roleplay, kanji vocab),
  `listen-type/listen-type.tsx`, `drill/drill-lab.tsx` (kana + word),
  `kanji-detail/kanji-detail.tsx`, `settings/settings.tsx` (`playPreview`),
  `routes/dev.speech.tsx`, and `packages/speech` `useTts`. Mechanism + rationale
  live in `packages/speech/AGENTS.md`.
- Grading feedback (TASK-36, the doc-9 rule): NO silent grading anywhere.
  Every graded surface shows the result immediately and, on a wrong answer,
  reveals the correct one. Drill Lab is the reference pattern; Roleplay is
  exempt (live `rp-live` scores, not discrete grading).
- Use shadcn primitives from `@manobu/ui/components/*`. (The DS-constrained
  `components/ds/*` wrappers were deleted 2026-09-15 — zero consumers.)
- TASK-32.4 biome sweep: inline JSX handlers stay extracted into named
  `useCallback`s. One documented suppression remains:
  `routes/learn/conversation/$sessionId.tsx` `onChange={handleChange}`.

## Verification

- `bun run check-types` (from `apps/desktop`, or via Turbo from repo root).
- `bun run check` (Ultracite) from repo root.
- `bun run test` from `apps/desktop`.
- TASK-129 focused coverage: `test/drill-search.test.ts`, `test/kana-instrument.test.ts`, and `test/kana-checkpoint-result.test.tsx`.
- TASK-130 focused coverage: `test/worksheet.test.tsx`.
- TASK-128 focused coverage: `test/exam-workspace.test.ts` and `test/exam-queries.test.ts` pin post-submit review rows, generated explanation labeling, exact replay wiring, dispute query invalidation, and the submitted-only query gate.
- fallow boundaries: this directory is the `desktop-features` zone —
  allowed imports: `desktop-shared`, `api-contract`, `ui-ds`,
  `lib-japanese`, `lib-srs`, `lib-speech`, `lib-env`.

## Child DOX Index

_Empty — per-feature AGENTS.md files are added when a feature accumulates
enough contract to warrant one._
