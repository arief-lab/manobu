---
id: doc-24
title: >-
  QA browser pass 2026-09-28: exam from the /ai conversation, and the AppImage
  release gate
type: specification
created_date: '2026-09-28 02:43'
updated_date: '2026-09-28 02:46'
tags:
  - qa
  - exam
  - chat
  - release
---
## Scope

Browser QA pass of TASK-147 (exam from the /ai conversation) on 2026-09-28, plus the
question the pass turned into: what still stands between this tree and a shipped AppImage.

Runtime: sidecar `bun run dev` (apps/server, BUN_PORT=4317 from apps/server/.env) + `bun run dev`
(apps/desktop, vite :3001), driven by `agent-browser --session qa` on its own chromium profile
(/tmp/agent-browser-chrome-*). Agent under test: opencode, authenticated, live session.

This is a CHROMIUM pass, not a WebKitGTK pass. Everything below about the sidecar, the transcript
and the exam service transfers to the desktop build; nothing about layout or WebKit behaviour does
(the same caveat doc-9 already recorded: browser-preview pass is not desktop pass).

## What passed, with evidence

1. The model-free leg works and involves no model. `/exam N5` and `/exam N2` typed in /ai produced
   a paper card, and the sidecar log for those turns contains only `POST /rpc/exam/request`,
   `POST /rpc/exam/assemble` and `POST /rpc/chat/listMessages`. No `chat/send`, no ACP session.
   Budgets were the level defaults, not the caller's: N5 = 30 items in 3 sections (10/10/10),
   N2 = 80 items in 2 sections (70/70 + 10/10). (AC#6, AC#2)
2. The paper binds to the live conversation. `messages` rows for both papers carry
   `conversation_id` = the browser's own uuid (`f5af3c8c-…`, `59ccee37-…`), never the
   `exam:<examId>` fallback (apps/server/src/services/exam-service.ts:1709). Zero fallback rows were
   created by this pass. (AC#1)
3. The agent chooses the tool unprompted. "can you set me a practice paper for N4?" - wording the two
   intent regexes miss - reached the agent as chat, and opencode called `start_exam` by itself. Its
   stored thinking names the tool and the description's rules ("call it with `level: \"N4\"` and not
   wait for answers"). This is the claim no unit test could make, and it holds. (AC#1)
4. The projection is shape-only and the agent stayed inside it. The tool result on screen is
   `{examId, level, mode, sections[{id, items, validated}], totalItems}` and the closing text is:
   "Your N4 paper is ready: 30 items across vocabulary (10), grammar and reading (10), and listening
   (10). It's on your screen now, so take your time with it and let me know when you've submitted."
   No stem, no option, no debrief narration, and the turn ended (`stopReason: end_turn`) while the
   paper was still `ready`. (AC#4, AC#5)
5. The chain completes. The card's "Start the paper" opened `/exam/exam-2738bdbe-…` at N4,
   "3 sections · 30 items", sections pending, with the originating conversation in the paper's chat
   rail. (AC#1's end-to-end)
6. The durable/live split behaves. After assemble, `chat/listMessages` returns 200 in the log, i.e.
   the desktop's invalidate fired and the card arrived through history, not only through the socket.

## Findings

### F-1 A host tool's raw JSON card comes back on the update frame (Medium-High, user-visible)

The N4 turn rendered BOTH the paper card and an "AI Assistant / ToolCompleted" card containing the
whole exam projection including the internal `examId`. That is precisely what TASK-110 ruled out for
`ask_user`.

Mechanism, verified rather than guessed: suppression is keyed on the tool title alone
(`foldAcpToolCall`, packages/chat-session/src/chat-engine/folds/tool-call.ts:100), and
`isHostToolCallTitle(null)` returns false by construction (packages/acp/src/acp-events.ts:42). The
stored row for this call (messages.id 19330) is a `sessionUpdate: "tool_call_update"` with
`"title": null` and no `kind`. So opencode's initial titled frame was suppressed correctly, then its
title-less update re-materialised the card under `tool:{toolCallId}`.

Scope: pre-existing shape, not introduced by TASK-147. It is newly visible because `start_exam`'s
result is exactly the object the paper card already shows. Any host tool whose agent sends a title-less
update leaks the same way, so `ask_user` and `next_drill_item` are exposed on other agents.

The hard part, so the task does not get solved shallowly: the fix needs a memory of which
`toolCallId`s were claimed as host tools, because a null title carries no information to match on.
That is cross-frame state, so it needs bounds, and the engine already has the precedent for exactly
that shape (the 64-entry / five-minute terminal-replay bounds in the ask and drill parks). Matching
the update's payload shape instead is fragile and would silently suppress a real tool that returns a
similar object.

### F-2 The AppImage would ship an 18-day-old sidecar (Blocker for release)

`apps/desktop/src-tauri/binaries/server-x86_64-unknown-linux-gnu` and
`jlpt-mcp-x86_64-unknown-linux-gnu` are both dated Sep 10 12:01. The tree is at Sep 28. Nothing in
the release path recompiles them: `bundle` in tauri.conf.json takes those two paths as given
(apps/desktop/src-tauri/tauri.conf.json:33-36) and `beforeBuildCommand` is only `bun run build`,
which is vite (apps/desktop/src-tauri/tauri.conf.json:10, apps/desktop/package.json `build`).
README.md:111 documents exactly that one command as the desktop build.

An AppImage built today would therefore ship a sidecar with no `start_exam`, no TASK-138 corpus
picker and none of the last three weeks of exam work, and it would start cleanly and look fine. The
compile step exists (`apps/server` `compile:linux`, apps/server/package.json:9) and the jlpt-mcp
release binary is missing entirely (`crates/jlpt-mcp/target/release/` is empty; only `debug/` and a
stale `dist/` copy exist). So the recipe needs: compile server for linux, `cargo build --release -p
jlpt-mcp`, stage both under `binaries/` with the target triple, then `tauri build`. And a freshness
guard that fails loudly, because the silent version of this failure is invisible: the app runs, the
chat works, the features are just not there.

### F-3 Personas: dev config is stale and the packaged path is unproven (Medium)

The sidecar boot log said: "[assistant] no assistant/*.md found (MANOBU_ASSISTANT_DIR unset, dev/binary
paths missed) - using embedded Sensei fallback". apps/server/.env sets
`MANOBU_ASSISTANT_DIR=/home/arif/Projects/mano/manobu-gg/assistant`, but the repo lives at
`/home/arif/Work/Projects/…`. So the dev persona picker is running on the embedded fallback and nobody
noticed, because the fallback looks like a persona.

`bundle.resources` does ship `../../../assistant` as `assistant`
(apps/desktop/src-tauri/tauri.conf.json:38) and `lib.rs` resolves bundle.resources first, so the
packaged path is probably right. Probably is not evidence: the same silent-fallback shape exists in
the release, where the persona list is the only signal. Needs one assertion inside the built artifact.

### F-4 Papers built without a conversation leave dead entries in chat history (Low-Medium)

`local.db` still holds four conversations whose id is `exam:<examId>` (titles "N5 paper", "N1 paper",
one with 0 messages, one with 12). `listConversations` (apps/server/src/chat-store.ts:261-288) has no
filter, and the history page in this pass showed an entry titled "N1 paper" that is one of them: it
looks like a conversation the learner never had, it has one card and no learner turn, and opening it
routes to `/ai?c=exam:…`, which has no agent binding.

Reachable whenever `exam.request` gets no `conversationId` (apps/server/src/services/exam-service.ts:2667).
Today the desktop always passes one and the host tool always has one, so the remaining callers are
tests and any future client. Either the fallback should stop being a conversation at all, or history
should filter synthetic ids. Note doc-21 §2's own rule applies here: a field with no reader is
decorative, and a conversation with no learner is junk data.

### F-5 The vite dev proxy is a trap on this machine (Low, dev-only)

apps/desktop/vite.config.ts:25-35 proxies `/rpc` and `/ws` to 127.0.0.1:3000, commented as making /ai
usable "without setting VITE_SERVER_URL" (TASK-116). apps/desktop/.env does set
`VITE_SERVER_URL=http://localhost:4317`, so the app never touches the proxy, and :3000 here belongs to
an unrelated next-server: a same-origin `/rpc` call from the page returns 502 with the portfolio's
HTML. Harmless while .env is set, actively confusing if someone relies on the comment. Either make the
proxy target follow `BUN_PORT` or drop the claim.

### F-6 Not covered by this pass (so nobody reads silence as evidence)

The exam lifecycle itself (answer, pause, reload, submit, review, dispute, abandon) was not re-run in
the browser; the paper was opened and left at "ready". WebKitGTK rendering was not exercised at all.
The drill-offer ordering negative (`/exam N5` typed while an offer is parked must resolve as the
offer) was not clicked through; it is pinned only by test/composer-routing.test.ts.

## Release gate for the AppImage

In order, each item producing evidence rather than a green feeling:

1. F-2: one release recipe that compiles and stages BOTH sidecars, and a freshness check that fails
   the build when `binaries/` is older than the tree. Decide whether `desktop:build` runs it or it is
   a separate documented step; the current README step is the trap.
2. F-1: fix the title-less update leak before shipping a surface where every agent tool call can
   show raw JSON next to its own card.
3. F-3: assert the persona list inside the built artifact, not in dev.
4. WebKitGTK smoke on the built AppImage: boot (sidecar health + `WEBKIT_DISABLE_DMABUF_RENDERER`
   path on this NVIDIA/Wayland box), /ai send, `/exam N5`, open the paper, answer one item, submit,
   review. Plus one conversation with the agent CLI absent, which is the F-1/F-2 freebie: it proves
   the model-free path in the packaging too.
5. A clean-database first run: the dev local.db carries junk (entries titled "fake" with 4160
   messages, the F-4 `exam:` rows), so a release run must start from an empty `app_data_dir` and the
   setup gate must still read correctly.
6. `docs/agent-stack-gaps-vs-aionui.md` Tier 3 was explicitly blocked on "AppImage is real": orphan
   agent process registry, parent-pid self-terminate, `MANOBU_DATA_DIR`, and PATH augmentation for the
   desktop entrypoint (an AppImage launched from a .desktop file has no shell PATH, which is the exact
   condition under which every ACP CLI in apps/server/src/... registry reports `installed: false`).
   Shipping without Tier 3 means shipping an app whose chat cannot find any agent. This is the item to
   decide on deliberately, not discover.

## Suggested tasks

- TASK "Stop a host tool's title-less update from resurrecting its raw card" - claims the toolCallId
  from the titled frame, bounded like the ask/drill parks; AC: folding [tool_call titled
  `start_exam`, tool_call_update title null] leaves no card, for all three host tools; mutation seam
  that reverts the claim.
- TASK "Make the desktop release build compile and stage both sidecars, or fail" - recipe + freshness
  guard + README correction.
- TASK "Prove the persona bundle inside the built AppImage" - fix apps/server/.env's stale
  MANOBU_ASSISTANT_DIR as a side effect.
- TASK "Keep papers without a learner conversation out of chat history" - decide fallback-gone vs
  history-filter, clean the existing `exam:` rows.
- TASK "AppImage Tier 3 hardening: agent PATH discovery and process ownership" - the four items in
  agent-stack-gaps §Tier 3, which is the real release blocker behind the release blocker.
