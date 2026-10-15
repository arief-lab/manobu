---
id: doc-25
title: 'QA pass 2026-09-29: desktop surfaces, exam flow, discoverability'
type: other
created_date: '2026-09-29 06:21'
updated_date: '2026-09-29 06:35'
---
# QA pass 2026-09-29 (re-design branch)

Full-surface QA of the desktop learner app: 14 surfaces rendered live
(headless Chromium over the Vite web build, returning-user state seeded
with goal=jlpt), plus an end-to-end run of the flagship scored-exam flow.
Screenshots and console capture: all surfaces render real content with
zero console errors except one stray 404 asset on the exam surface.

## 1. Do the features work as intended?

Mostly yes. Verified working:
- Setup goal picker, dashboard bento hub, review desk, drill lab
  (pick/draw/say modes + kana charts), lesson (listen-first), reader
  (story cards), listen & type (with offline fallback), roleplay
  (scenario cards), conjugate (MCQ + type-it), kanji (grid + detail),
  settings (Learning/App tabs), chat history, AI chat.
- Scored exam end-to-end: asked /ai for a paper -> built -> "Start the
  paper" -> /exam/<uuid> -> answered 3 sections -> Submit paper ->
  real score (Overall 6/180, per-section bands, Not passed) -> answer
  review with correct/your-choice, "Try this one again", "Report a
  wrong answer". This is the deepest feature and it completes.

Defects (each is task-sized):

### D1. JLPT Mock timer counts UP but is labelled "remaining"
`apps/desktop/src/features/mock/jlpt-mock.tsx:118` feeds `elapsedSeconds`
(into `formatTimer`, line 134) but `packages/ui/src/lib/copy.ts:294`
renders "⏱ {mm}:{ss} remaining". A learner sees "⏱ 00:02 remaining"
ticking up to 00:03, 00:04... It reads as a countdown about to expire,
then makes no sense. Fix: relabel to elapsed, or drive a real budget
countdown.

### D2. JLPT Mock calls itself an "Internal surface" to learners
`apps/desktop/src/routes/jlpt-mock.tsx:193` renders "Internal surface ·
built-in seed questions, not a generated paper. The scored exam is the
one the server assembles at /exam." A user-facing page should not
announce that it is internal, and it points at /exam the reader cannot
navigate to (see D5). Wrong register for shipped copy.

### D3. Design annotation leaked into learner copy
`packages/ui/src/lib/copy.ts:276` renders "Choose an answer to continue
· 40% opacity until choice". "40% opacity until choice" is a spec note
for the implementer, not guidance for a student. Cut it to "Choose an
answer to continue".

### D4. Review and JLPT Mock have no "back to desk" path
`/review` and `/jlpt-mock` are absent from `CHROME_FREE_PATHS`
(`apps/desktop/src/shared/chrome-free.ts`), so they render the shared
`Header` (`apps/desktop/src/shared/header.tsx:11`), whose only element
is a bare "AI Chat" link top-left. Two problems: (a) "AI Chat" sits
where a page title belongs, so it reads as the page name, not a link;
(b) it is the ONLY nav, and it leaves the surface for /ai rather than
returning to the dashboard. Every other practice surface carries a
"← desk" pill. These two are dead-ends except for browser-back.

### D5. Exam and JLPT Mock are undiscoverable from the hub
`BROWSE_LINKS` in `apps/desktop/src/features/dashboard/dashboard.tsx`
lists Lesson, Reader, Listen, Roleplay, Drill, Conjugate, Kanji,
Settings. Neither the scored Exam nor the JLPT Mock appears. `/exam` is
reachable only by asking in /ai chat (`ai.tsx:668` openPaper is the sole
inbound link); `/jlpt-mock` has zero inbound links anywhere (orphan).
A learner who was never told these exist will never find them.

### D6. "shortened paper" is 30 items, contradicting the ask
Prompt: "short N5 paper with 2 vocabulary questions and 1 grammar
question". Result card: "N5 · shortened paper · 3 sections · 30 items".
The agent does explain the override in chat ("sized by the host from
the N5 default budget"), but the label "shortened" next to 30 items is
misleading, and there is no visible way to honour a small explicit
count. Decide whether "shortened" should mean fewer items or be renamed.

### D7. Audio degradation reads as an error
Outside Tauri (and on any machine without the voice), /listen shows a
red prohibition icon "🚫 No speaker detected" and /settings shows
"No audio output". The behaviour is a correct fallback, but the red
error glyph signals breakage. Consider a neutral info treatment so the
fallback does not look like a fault.

### D8. Minor: stray 404 on the exam surface
One "Failed to load resource: 404" during the exam run. Cosmetic, but
worth identifying the missing asset.

## 2. Is the UI usable as a desktop app?

Yes for the practice surfaces: drill, conjugate, kanji, reader,
roleplay, settings are clean, well-labelled, and keyboard-friendly
(conjugate/drill expose number + letter shortcuts; exam fieldsets
declare `aria-keyshortcuts`). The exam split-view (chat left, paper
right, "Hide chat" toggle) is a genuinely good desktop layout.

Weaknesses:
- Dashboard bento leaves large dead space in the Due / Momentum / Ask
  tiles at wide viewports; the grid does not fill a desktop window
  confidently.
- /listen is dense: "pcvtp", pitch in parens, shadow-streaming match %,
  auto-convert note, and a red speaker error all stack before the one
  action (type + Next). Heavy for a first visit.
- Chat surfaces (/ai empty state, /review, /jlpt-mock) leave the whole
  middle of a large window empty; they are built mobile-first and do
  not use desktop width.

## 3. How each persona uses it, and what they likely feel

Beginner: setup goal picker and dashboard hero ("Start Lesson 1 · 10
min") are welcoming and clear; they will happily use Lesson, Drill,
Reader, Kanji. They will NOT find Exam or Mock (D5). If they land on
/JLPT Mock they hit "Internal surface" + a timer counting up "remaining"
(D1, D2) and the red "No speaker detected" (D7) - these read as
something being broken and will shake trust. On /review they may not
find their way back (D4).

Moderate: comfortable across the practice surfaces and the AI chat. The
Exam flow is the standout and works. Mild friction: the size mismatch
(D6) and the missing hub links (D5) mean they must already know to ask
for an exam in chat.

Advanced / test-taker: the scored exam with bands and answer review is
exactly the high-value path and it lands well. Their main gap is
discoverability and control: no direct Exam entry from the desk (D5),
no way to request a genuinely small paper (D6), and the orphaned Mock
(D2) is not a useful surface for them anyway.

## 4. Will users understand how to use the app?

For the eight surfaces in BROWSE_LINKS: yes, each is self-explanatory
with a "← desk" pill and a clear first action. The gaps in
understanding are:
- The two exam/mock surfaces are invisible from the hub (D5), so the
  single strongest feature is the hardest to learn exists.
- "AI Chat" as the lone chrome on /review and /jlpt-mock is misread as
  a title and strands the user (D4).
- The Mock's "Internal surface" / "remaining" / "40% opacity" copy
  (D1-D3) tells the learner the tool is unfinished or broken.

## Suggested task split (for follow-up)
- Task A (copy, low risk): fix D1, D2, D3 in the mock surface + copy deck.
- Task B (navigation): fix D4 (give /review and /jlpt-mock a ← desk,
  or add them to CHROME_FREE_PATHS with their own return pill).
- Task C (discoverability): fix D5 (surface Exam, and decide Mock's
  fate: link it or remove the route).
- Task D (product): decide D6 paper-size semantics.
- Task E (polish): D7 audio-fallback tone, D8 the 404.

## Screenshots
All captured live at 1440x950 (desktop viewport). Relative paths resolve
in the Backlog browser UI.

### Surfaces
| Setup | Dashboard | AI chat | Review |
|---|---|---|---|
| ![setup](images/00-setup.png) | ![dashboard](images/01-dashboard.png) | ![ai](images/02-ai.png) | ![review](images/03-review.png) |
| **Drill** | **Lesson** | **Reader** | **Listen** |
| ![drill](images/04-drill.png) | ![lesson](images/05-lesson.png) | ![reader](images/06-reader.png) | ![listen](images/07-listen.png) |
| **Roleplay** | **Conjugate** | **Kanji** | **Settings** |
| ![roleplay](images/08-roleplay.png) | ![conjugate](images/09-conjugate.png) | ![kanji](images/10-kanji.png) | ![settings](images/11-settings.png) |
| **Chat history** | **JLPT Mock (D1/D2/D3)** |
| ![history](images/12-chat-history.png) | ![mock](images/13-jlpt-mock.png) |

### Scored exam flow (verified end-to-end)
| Paper ready at /exam | Scored result + review |
|---|---|
| ![exam ready](images/14-exam-ready.png) | ![exam result](images/15-exam-result.png) |
