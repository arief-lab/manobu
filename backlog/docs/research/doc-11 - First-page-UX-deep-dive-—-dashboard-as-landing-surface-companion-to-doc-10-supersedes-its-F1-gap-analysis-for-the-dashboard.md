# First-Page UX Deep Dive — the `/` Dashboard as Landing Surface

> **Status:** research / UX design proposal (companion to doc-10; supersedes doc-10's F1 gap analysis for the dashboard specifically)
> **Date:** 2026-09-10
> **Grounding:** `src/routes/index.tsx`, `src/components/dashboard.tsx`, `src/components/header.tsx`, `src/routes/__root.tsx` + `learn.tsx` (TASK-29 AppShell contract), doc-9 QA screenshots.
> **Question answered:** "Is our current first page good?" — Verdict: **no, not yet.** Structure and ethics are strong; three concrete defects make it fail as a landing surface.

---

## 1. What the first page is today

Rendered at `/` for every visit (after onboarding). Composition, top to bottom:

1. Global `Header` (from `__root.tsx`) — links: **Home, AI Chat** + theme toggle. This is the ONLY navigation rendered on `/` (the AppShell sidebar is scoped to `/learn/*` per TASK-29).
2. `h1` "Dashboard" + subtitle: *"All offline · Tap any word for help · No streaks · Your data stays here"*
3. `Dashboard` compound (SCR-01):
   - `.Progress` — ring ○n/4 + the four STEPS chips (Hiragana/Katakana/First Words/First Sentences)
   - `.Primary` — one CTA ("Welcome / Continue: {lesson}")
   - `.Continue` — resume card
   - `.Due` — FSRS due card (empty state: "0 due")
   - `.Weak` — weak-pattern card (beginner branch: absent)
   - `.Nudge` — capped 1/day, dismissible
4. No footer, no next-step suggestion, no nav to practice surfaces beyond the header.

## 2. The three concrete defects

### D1 — The landing page cannot navigate to the app (structural, highest severity)
A first-session user who finishes onboarding lands on `/` and the visible UI offers exactly two click targets: **Home (the page they're on) and AI Chat**. Lesson, Drill, Listen, Reader, Conjugate, Roleplay, Review, Kanji — the entire core — are unreachable by clicking until they either know the `/learn/*` URL scheme or find the sidebar (which only exists under `/learn/`). The dashboard's own cards (`Continue`, `Due`) link to one or two destinations at best; the rest of the app is invisible.

This is the sharp form of doc-10's F1: not "surfaces are islands" but "**the island you land on has no boats**."

### D2 — Day-one canvas is mostly empty (emotional, doc-10 F3 confirmed)
Beginner branch renders: ring ○0/4, step chips, Welcome CTA, Due "0 due". Nudge and Weak are absent, Continue has nothing to resume. Roughly **70% of the vertical space is blank on first run** — and the 30% that exists talks in statuses, not invitations. The page answers "what's my state?" before answering "what do I do?" — backwards for a first page.

### D3 — The subtitle leads with limitations (tonal, doc-10 F6 confirmed)
`"All offline · Tap any word for help · No streaks · Your data stays here"` — three reassurances and one instruction. For P5 (privacy skeptic) this is perfect. For P1/P2/P3/P4 it reads as a disclaimer block. The ethics must stay; the *position* is wrong — limitations don't belong in the first line of the first page.

## 3. The redesign — D1/D2/D3 → one composition change + two content changes

### Fix 1 — Give `/` the AppShell (structural; small code, large effect)
Extend the TASK-29 decision: mount the AppShell on `/` too (or equivalently, route the dashboard inside the `/learn` layout). The sidebar's grouped nav (Learn/Practice/Review — TASK-35) becomes the corridor the landing page is missing, and the AI pane arrives for free. Non-learn chrome-free routes (`/onboarding`, `/settings`) keep their current treatment. This single change resolves D1 entirely and makes every later doc-10 item (R1 session spine, R5 momentum) actionable from the first page.

- Implementation sketch: `__root.tsx` currently wraps `Header` globally; move the dashboard under a layout that renders `<AppShell>` (same wrapper `learn.tsx` uses), keeping `/onboarding` + `/settings` outside it. `components/AGENTS.md` + `apps/desktop/AGENTS.md` route notes updated accordingly.

### Fix 2 — The first page answers "what now?" (content; small)
Reorder the beginner branch to lead with **action, not state**:
1. `.Primary` CTA moved visually first ("Start Hiragana — 15 min")
2. `.Progress` ring + steps demoted below the CTA (state after action)
3. Day-one empty states get copy with a job: `Due` reads "Your first review lands tomorrow — learn something first" + a link into the drill; `Continue` day-one reads "Lesson 1 of First Words is waiting" (not "nothing to resume").

### Fix 3 — Flip the subtitle order (tonal; trivial)
Limitations move from line 1 to a quieter home (footer line or settings' trust section). New first line states the promise: *"Learn Japanese at your pace — private by default, works offline."* Same facts (offline, private), opposite framing: capability first, constraint second. Priya's reassurances survive intact one layer down.

## 4. Verdict & relation to doc-10

- doc-10 diagnosed the app-wide loop (F1–F7, R1–R8); it treated `/` as a journey start and missed D1 because the walkthrough assumed the sidebar was present.
- This doc scopes to the first page and finds the landing-surface defect: **the dashboard is a state report where a front door should be.**
- Fix 1 (AppShell on `/`) is the prerequisite; Fix 2 + Fix 3 are the doc-10 R5/R6 landing zone. Recommended task split: **one task = Fix 1** (structural, own PR), **one task = Fix 2 + Fix 3** (content pass, pairs with R5).
