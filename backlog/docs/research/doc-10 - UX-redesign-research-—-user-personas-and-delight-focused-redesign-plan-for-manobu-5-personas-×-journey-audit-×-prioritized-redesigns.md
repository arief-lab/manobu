# UX Redesign Research — User Personas & Delight-Focused Redesign Plan for manobu

> **Status:** research / UX design proposal
> **Date:** 2026-09-10
> **Author:** exper UX-designer pass over the shipped surface (routes, compounds, copy, docs 1–6, QA doc-9)
> **Grounding:** every finding cites a shipped file/behavior. No aspirational fiction.
> **Method:** persona-based journey walkthrough — 5 distinct user types, each walked through the real route graph (`/` → `/onboarding` → `/learn/*` → `/review` → `/kanji` → `/settings` → `/ai`), then a redesign plan ranked by (delight × reach ÷ effort).

---

## 0. TL;DR

manobu's **interaction design is strong** (equal-path fallbacks, ethical copy, real FSRS, honest grading — all verified in code) but its **emotional design is nearly absent**: the app is correct, quiet, and cold. The five personas agree on one thing — nothing in the daily loop *rewards returning*. The dashboard says "No streaks" as a badge of honor (anti-manipulation done right), but offers **nothing else in its place**: no visible progress identity, no "you kept your promise" moment, no warmth. The redesign plan is therefore not "add features" — it is **give the existing features a voice and a face**: 8 prioritized redesigns, R1–R8, each small, each mapped to an existing SCR surface, none violating the frozen anti-pattern catalog in `nihongoai-spec-v1.md`.

**One-line strategy: manobu wins as the *calm teacher* — not the gamified app, not the flashcard drone. Every redesign below either (a) makes progress visible as identity, (b) closes a loneliness gap in the practice loop, or (c) removes a silent dead-end.**

---

## 1. The five personas

### P1 — "Kenji the Commuter Learner" (the daily-loop core)
- **Who:** 28, office worker, 2×25-min train rides/day, phone-grade patience, goal = `Travel` (picked in onboarding ★Recommended).
- **What he needs from manobu:** a session that *always fits the remaining time* and never makes him think about what to do next.
- **Journey audit (real surfaces):**
  - Opens app → Dashboard (`/`) shows Progress ring ○0/4 + steps + Welcome CTA + FSRS Due card. Good. But if `Due=0` the day-one state is *empty* — doc-5 already flagged "pre-seed 10–15 kana cards so Due isn't 0 on day 1" — still true today.
  - Enters `/learn/lesson` → wizard + numbers module (SCR-08) — solid, linear.
  - Practice → `/learn/drill` (kana canvas) → strong; then **dead-end**: after the drill set, where does he go? Nothing suggests the next surface. The app relies on him reading the sidebar.
  - Review → `/review` queue → grades → `ReviewQueue.LastGraded` confirm (TASK-36 ✓). After the batch: Empty state says "No cards due — great work!" — correct tone, but then the screen is blank; no bridge to "what now?".
- **Pain score: navigation orphaning.** The app is a set of well-built rooms with no corridors. **P1 quit-risk moment: the 3-second "what do I tap now?" pause.**
- **Wins him:** R1 (session spine), R5 (momentum line).

### P2 — "Sakura the Absolute Beginner" (zero-knowledge, anxiety-high)
- **Who:** 22, student, watched one anime too many, picked `Anime` goal; knows zero kana.
- **Journey audit:**
  - Onboarding: best-in-class (doc-5 verdict ✓) — 4 goal cards, adaptive placement, skip always visible, no confirm-shaming.
  - Then the **cliff**: doc-5's finding still stands — drill ships 5 of 92 kana; after `あ→お` she hits `食べる/です`-level content unless the drill fills the gap. The app *says* "Katakana (カ) — 15 min" on the dashboard step 2, but there's no dedicated full katakana set behind it.
  - Reader `/learn/reader` has 3 stories (`konbini`, `preN5`, `n5`) — the pre-N5 one is the right idea, too thin to live on.
- **Pain score: promised step, missing stairs.** The dashboard promises a path the content doesn't deliver.
- **Wins her:** R2 (the full 92-kana ladder, already spec'd in doc-5), R4 (romaji confidence bridge), R6 (first-session victory).

### P3 — "David the Exam Grinder" (JLPT deadline-driven)
- **Who:** 35, 4 months to JLPT N3, picked `JLPT` goal, uses `/jlpt-mock`, `/kanji`, `/review` heavily; wants numbers, not vibes.
- **Journey audit:**
  - Mock exam: real timer + pause + sectional score + weak patterns → plan scaffold. Excellent (doc-4).
  - Kanji: TASK-37 index grid → detail with strokes/vocab — good bones.
  - **Gap:** the mock produces "weak patterns" and then… the plan is a *scaffold*. The loop "mock → weakness → today's drills" is not closed in the UI; he re-derives his own study plan in his head or in Anki.
  - Review queue: FSRS grade previews ✓, but no "N3 readiness" framing anywhere — progress is invisible in *his* units (exam readiness, not steps-done).
- **Pain score: feedback loop truncation.** The app measures everything and reports it in the wrong unit.
- **Wins him:** R3 (weak-pattern → drill bridge), R7 (readiness framing on the dashboard).

### P4 — "Aiko theconversation-shy Speaker" (roleplay/AI-first)
- **Who:** 41, lives in Japan already, reading OK, speaking paralyzing. Picked `Work` goal. Lives in `/learn/roleplay`, `/ai`, `/learn/listen`.
- **Journey audit:**
  - Roleplay: live politeness/particle scores, keigo contrast cards, VAD/STT streaming (TASK-21.x) — genuinely differentiated.
  - AI chat: SSE streaming, agent/persona pickers, Ask Sensei rail (TASK-35/57).
  - **Gap:** the AI surfaces feel like *tools*; nothing accumulates. After 30 roleplay sessions, the app shows `saved 3/3` — her speaking journey has no visible history, no "you used to freeze on いただけますか, now it's automatic."
- **Pain score: no progress identity.** The app keeps her data but never reflects it back as growth.
- **Wins her:** R8 (practice memory — the "you've grown" surface), R5 (momentum).

### P5 — "Priya the Privacy-Minimalist" (the skeptic who bounces)
- **Who:** 31, tried 4 Japanese apps, deleted all for dark patterns. Picked `Travel`. Reads the settings page before the lesson.
- **Journey audit:**
  - Settings: telemetry OFF default, reset requires typed `RESET`, data export offered first, nudge capped 1/day — ethical review in the spec is real and shipped. She *stays*.
  - **Gap:** after trusting the app, the app gives her… nothing warm back. The tone is uniformly neutral-to-legalistic. Trust earned, delight never attempted.
- **Pain score: emotional flatness.** Nothing here *feels* like it was made by a person who loves Japanese.
- **Wins her:** R6 (first-session victory), R5 (momentum line — honest, no streaks, but visible).

---

## 2. Cross-persona findings (the diagnosis)

| # | Finding | Evidence | Personas hit |
|---|---|---|---|
| F1 | **No session spine** — surfaces are islands; after finishing any drill/review, nothing proposes the next step | drill/review/mock empty-ends; navigation is sidebar-only | P1 P3 P4 |
| F2 | **Progress is data, not identity** — FSRS state exists but the dashboard speaks in steps (○0/4) and due-counts, never in *capability* ("you can now order food") | `dashboard.tsx` STEPS + DueCard; roleplay `saved 3/3` | P3 P4 P5 |
| F3 | **First-session victory is unengineered** — day-1 Due=0, drill set ends silently (TASK-36 fixed *grading* feedback, not *session* feedback) | `dashboard DueCard` empty day-1; drill end → nothing | P2 P5 |
| F4 | **The weak-pattern loop truncates** — mock produces weak patterns + plan scaffold; no drill bridge | `jlpt-mock.tsx` finalize → Plan scaffold | P3 |
| F5 | **The 92-kana promise is unfulfilled** — dashboard step 2 promises Katakana; drill ships 5 of 92 | doc-5 (still true) | P2 |
| F6 | **Tone is uniform-neutral** — no delight moments anywhere in the loop; the anti-manipulation catalog (correctly) banned streaks/urgency but nothing was built in the vacuum | copy matrix; dashboard "No streaks" | P4 P5 |
| F7 | **Loneliness of practice** — roleplay/teacher interactions vanish into transcript scroll; no accumulation | `conversation-bubble`, `rp-scores saved 3/3` | P4 |

Everything above is verifiable in the repo today; none of it speculates on unreleased features.

---

## 3. The redesign plan (R1–R8, ranked by delight × reach ÷ effort)

### R1 — The Session Spine ⭐ (P1 P3 P4 · medium effort)
After ANY practice surface completes (drill set, review batch, mock, roleplay line-block), the ending state becomes a **"Next step" card** — one primary action, chosen by a tiny deterministic router:
`weak pattern due? → that drill · else due cards? → review · else lesson next step · else reader story`.
No gamification, no confetti — just the corridor between rooms. Implementation home: a `NextStep` compound fed by existing state (queue, FSRS due, lesson position). Closes F1.

### R2 — The full 92-kana ladder ⭐ (P2 · medium effort, already spec'd)
Doc-5's fix, unchanged: populate DrillLab from the full 46+46 (TASK-23.2.2 added the kind tab — finish populating it), keep week-on spacing, add the 20-phrase survival pack as pre-N5 reader stories. The dashboard's step 2 promise becomes true. Closes F5.

### R3 — Mock → weakness → drill bridge (P3 · small effort)
On the mock scored screen, each weak pattern gets a **"Drill this now"** action that deep-links into the matching surface (conjugate pattern → `/learn/conjugate`, kana confusion → `/learn/drill`, listening → `/learn/listen`). The plan scaffold becomes a plan *executor*. Closes F4.

### R4 — The romaji confidence bridge (P2 · small effort)
Settings has `romaji=off` as a learn-mode flag, but the *transition moment* is unhandled: when Sakura types correctly 10×, offer (never force) "Try without romaji?" — a one-tap toggle-in-context. Respects ask-first; closes the beginner's typing fear.

### R5 — The momentum line (all · small effort)
Replace the dashboard's "No streaks" line with an **honest momentum sentence**: "You practiced 4 of the last 7 days · 213 cards learned · next review tomorrow." No streak mechanics, no guilt for gaps (the spec's anti-pattern catalog stays respected — no streak manipulation, no fake urgency). Data all exists in `revlog`. Closes F2/F6 partially.

### R6 — First-session victory (P2 P5 · small effort)
Engineer the end of the FIRST session as a designed moment: "You just learned あいうえお — here's your first real word: あめ (rain)." One screen, one word that uses exactly what was learned, one [▶] audio. Deterministic from the drill set contents. Closes F3.

### R7 — Readiness framing (P3 · medium effort)
On the dashboard, for `JLPT`-goal users, reframe one card in exam units: "N3 mock: 58% → 64% (last 2 mocks) · weak: て-form, ~ば". Pure re-aggregation of existing mock + review data. Progress finally speaks his language.

### R8 — Practice memory (P4 · larger effort, flag for sequencing)
A "your growth" view fed by session history: first-attempt vs latest-attempt scores per pattern (data already in revlog + roleplay logs), rendered as a before/after list ("politeness 1/3 → 3/3 in 12 sessions"). This is the only R-item needing new aggregation; sequence it after R1–R7. Closes F7.

**Anti-goals (explicit):** no streaks, no daily-punishment mechanics, no confetti/spam, no anthropomorphic guilt ("Sensei misses you!"), no notification nagging. The spec's ethical catalog is a feature — this plan operates entirely inside it.

---

## 4. Suggested execution order

1. **R6 + R5** (smallest, highest emotional yield, zero new data) — one PR each.
2. **R3 + R1** (the loop-closers; R3 first — it's a deep-link, R1 builds the router).
3. **R2** (content-heavy, already spec'd in doc-5; unblock P2 completely).
4. **R7 + R4** (framing + bridge).
5. **R8** (aggregation surface; sequence last).

Each R-item is a standalone backlog task candidate with an existing SCR surface as its home — no new top-level routes required.

---

## 4a. Amendment (2026-09-10, post-filing)

- **R2 withdrawn** — F5 is stale: TASK-23.2 / 23.2.1 / 23.2.2 shipped the full 46+46 kana drill kinds (gojuon, katakana, dakuten, yoon + KanaChart drawer) and TASK-23.3 shipped the pre-N5 survival story (旅の一日, 8 sentences, `phrases.json`). The 92-kana ladder and survival pack exist; no R2 task was filed.
- **F1 landing-page gap** — the sharper form (the dashboard's header nav cannot reach any practice surface) is analyzed in **doc-11** and tracked as TASK-59 (Fix 1) + TASK-60 (Fix 2+3).
- Filed tasks from this doc: TASK-61 (R1 session spine), TASK-62 (R3 weakness bridge), TASK-63 (R7 readiness framing), TASK-64 (R4 romaji bridge), TASK-65 (R8 practice memory); TASK-60 carries R5+R6.

---

## 5. Verdict

manobu does not need a redesign of its screens. It needs a redesign of its **moments**: the end of a session, the first victory, the reflection of growth. The five personas converge on the same diagnosis from five different directions: **the app is a trustworthy teacher who never smiles.** R1–R8 are the smile — built from data the app already has, inside the ethics the spec already froze.
