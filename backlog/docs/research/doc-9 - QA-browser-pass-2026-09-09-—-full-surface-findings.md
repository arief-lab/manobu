---
id: doc-9
title: QA browser pass 2026-09-09 — full-surface findings
type: other
created_date: '2026-09-09 10:56'
---

# QA browser pass — 2026-09-09

Role: QA end-user pass over `bun run desktop:dev`, driving every surface, screenshotting each route, exercising the interactive flows. Method note: the Wayland/NVIDIA box blocks native window capture, so the UI was driven through the vite dev server (`:3001`) in a real Chromium tab — same code, same routes; Tauri-only invokes (`speech::*`, `fsrs::*`, `cron::*`) are out of reach there and marked below. Screenshots referenced as `#N`.

## Environment

- `bun run desktop:dev` in `apps/desktop` (tauri dev, vite :3001, sidecar :4317)
- Runtime: Linux (Hyprland/Wayland, NVIDIA), bun 1.4.0, Tauri v2
- Sidecar ACP: `ACP_MCP_SERVERS=jlpt-vocab:stdio:…/target/debug/jlpt-mcp`

## P0 — boot blockers (must fix before any demo)

### QA-1: bundled `server` sidecar crashes on boot — `Cannot find module '@libsql/linux-x64-gnu'` (#1)

- Symptom: every launch, `[sidecar stderr] error: Cannot find module '@libsql/linux-x64-gnu' from '/$bunfs/root/server-x86_64-unknown-linux-gnu'` → sidecar `terminated code=1` → health check times out after 30 s → **all `/ai` + API routes dead** in the packaged app window.
- Repro: `apps/desktop/scripts/sidecar-dev.sh` output binary `dist/server-x86_64-unknown-linux-gnu` run directly → same error. `bun run compile:linux` reproduces it fresh.
- Root cause: `@manobu/db` → `libsql` 0.5.29 has a platform native dep `@libsql/linux-x64-gnu`; bun's single-file compile does not inline the `.node` native module and the module resolution fails inside `/$bunfs` because the package is hoisted in `node_modules/.bun/…` store, not linked where the compiler expects. `node_modules/@libsql` does not exist at the workspace root.
- Note: this is a REGRESSION the user has not seen — last known-good run predates some bun/npm store state change; `bun.lock` untouched since af534e5. Likely bun 1.4.0-canary update changed hoisting.
- Fix directions: pin bun to the previously working version, or add `@libsql/linux-x64-gnu` as a direct devDependency of `apps/server` so the compiler resolves it, or compile with `--external libsql` + ship the native module next to the binary.

### QA-2: `/lesson` crashes the route — `Buffer is not defined` (#3)

- Symptom: navigating to `/lesson` shows the error boundary "Something went wrong: Buffer is not defined"; the whole content pane is dead.
- Root cause chain (proven): `routes/lesson.tsx` → `components/lesson.tsx:38` imports `pickGroundedExample` from `lib/grounded-examples.ts` → line 46 `Buffer.from(seed, "utf8")` — Node global used in a vite browser bundle.
- Fix: replace the Buffer-based FNV-ish seed hash with a pure-TypedArray loop (or `TextEncoder` + `DataView`), no Node global. Test file `deinflect.test.ts`-style guard optional.

## P1 — functional bugs

### QA-3: JLPT mock submit fails silently — always lands in `submit-failed` (#4)

- Symptom: answer any mock (All/N5), the result phase flips to `mock-submit-fail` ("FSRS write failed. Progress saved locally") deterministically. `Retry submit` button does NOT retry — it calls `reset()` which wipes the whole mock (`components/jlpt-mock.tsx:514`).
- Investigation: all chain functions verified working when imported directly in the page: `computeMockResult` (score+weak), `scoreBySection`, `cefrForScore` — OK with the full 9-question seed incl. section tags. The real exception is swallowed by `catch {}` (components/jlpt-mock.tsx:587) so the browser console shows nothing. Suspects left: something inside the `finalize` effect closure capturing stale state, or an FSRS/tauri invoke unavailable in browser preview (would make this a false positive in the browser-only environment — needs a desktop replay).
- Also a UX bug regardless: "Retry submit" wiping the mock is mislabeled — it should re-run the submit, not reset.
- Fix directions: log the caught error (`catch (e) { console.error(e) }`), reproduce on the desktop runtime, fix the real throw, make Retry actually retry.

### QA-4: Listen & Type grading gives no feedback (#5)

- Symptom: typed たべる against target たべる (Read & Type fallback mode, no speaker) → `match 0%` label stuck, `Next` click produces no visible grade state (no ✓/✗ banner, no streak change, no advance).
- Likely: grading needs the Tauri speech/Fsrs state or the pitch diagram path errors silently in browser preview. Needs desktop replay to confirm which half is browser-only noise vs a real regression. The `match 0%` while input === target is suspicious even for preview.

## P2 — polish / UX observations

### QA-5: Conjugate lab — no visible correctness feedback (#6)

- Typed て for 食べる→て-form (ichidan tag visible); no ✓/✗, no color change, no advance prompt, Enter does nothing visible. The correctness signal exists only as a tiny `ichidan` hint chip. A learner cannot tell they got it right.

### QA-6: `/kanji` parent route renders an empty content pane (#2)

- `routes/kanji.tsx` is a deliberate layout wrapper (per source comment), but landing on `/kanji` directly shows a blank main pane — no index/grid, no redirect to `/kanji/detail`, no empty-state text. Either redirect or render an index.

### QA-7: dev-only chrome visible during normal use

- TanStack Router devtools bubble bottom-left; "AI Pane (width ≥1200)" placeholder rail; sidebar debug numbers (`240`, `xl`, `1440px`) as literal sidebar content — that last one looks like debug output committed into the sidebar component. Grep `1440px` in `components/` to find it.

## What worked

- AI Chat: streams a real teacher answer to 「What does 食べる mean?」with the Sensei persona (#2 flow) — model Default, agent Sensei; two POST /ai round-trips clean.
- Drill Lab: kana choice drill full loop — prompt, 4 choices, correct-answer flash (#5 flow), visual feedback on selection.
- Review, Reader, Roleplay, Conjugate, Onboarding, Settings (AI & Model tab with FSRS slider/correction/voice sections), dev/speech — all render, no console errors (#3, #6).
- API surface: `/`, `/api/vocab|grammar|kanji|kanji/stroke|learn/next-cards|review/next`, `/assistants`, `/agents`, `POST /ai` — all responding (when the server is run from source).
- MCP sidecar: `jlpt-mcp` compiled + synced by sidecar-dev.sh each boot (release, 19.05 MB incl. TASK-24.2 cache path).

## QA method limits (read before re-running)

- Browser-preview pass ≠ desktop pass: `speech::*`, `fsrs::*`, `cron::*`, window chrome, single-instance, AppImage packaging untested here. QA-3/QA-4 need one desktop replay to split browser-only vs real.
- Do NOT use the computer-tool accessibility tree on the WebKitGTK window — AX probing crashed the app once (GTK ATK assertion cascade). The vite/browser route is the reliable UI harness.

## Tracking (all findings filed as tasks)

| Finding | Task | Note |
|---|---|---|
| QA-1 sidecar libsql crash | TASK-38 | P0, blocks packaged runs |
| QA-2 /lesson Buffer crash | TASK-39 | P0, ~1h fix |
| QA-3 mock submit + Retry label | TASK-40 | P1; instrument-first |
| QA-4 Listen&Type grading | TASK-41 | P1; desktop replay first |
| QA-5 conjugate feedback | TASK-36 | merged into UI pass 2 (feedback pattern propagation) |
| QA-6 /kanji blank + contrast | TASK-37 | merged into UI pass 3 |
| QA-7 dev chrome / shell stubs | TASK-35 | merged into UI pass 1 (AppShell composition) |
| AX-crash method finding | TASK-42 | P2 tooling; possible real a11y bug |

## Suggested fix order

1. TASK-38 (QA-1, sidecar libsql) — blocks every packaged run
2. TASK-39 (QA-2, lesson Buffer) — one-line-ish, route-dead bug
3. TASK-40 (QA-3, mock submit + Retry label) — core study loop broken
4. TASK-36 (QA-5 + QA-4) — feedback pattern; QA-4 replay inside it
5. TASK-35 (QA-7) — AppShell composition
6. TASK-37, TASK-42 — polish + tooling
