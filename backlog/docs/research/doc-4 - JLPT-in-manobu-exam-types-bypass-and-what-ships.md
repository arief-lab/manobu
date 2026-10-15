---
id: doc-4
title: 'JLPT in manobu - exam types, bypass and what ships'
type: specification
created_date: '2026-09-06 05:29'
---

# JLPT in manobu — Exam Types, Bypass, and What Ships (Repo + Internet)

> **Status:** research / specification  
> **Date:** 2026-09-06  
> **Sources:** JASSO/JEES `jlpt.jp` `2024` guideline PDFs (`info.jees-jlpt.jp/uploads/2024%E5%AE%9F%E6%96%BD%E8%A6%81%E9%A0%85.pdf`, `jlpt.jp/guideline/pdf/statistics 2024_2_9_revise.pdf`, `jlpt.jp/e/guideline/testsections.html`, `results.html`, `guide2011_e_05.pdf`, `understandingscorereport_2025_revise.pdf`, `faq` + `statistics/2024_2`), internet explainers (`jlptsamurai.com`, `jlptmastery.com`, `jlptbooks.com`, `japaneseexplorer.com.sg`, `japademy.com`), manobu `apps/desktop` SCR-10 `jlpt-mock.tsx:1`/`jlpt-mock.lazy.tsx:4`/`routes/jlpt-mock.tsx:1` + `lib/mock.ts:1` + `dashboard.tsx:65` `computeBranch` + `onboarding.tsx:187` `Placement` + `routeTree.gen.ts:17` + `AGENTS.md` Child DOX Index + `packages/japanese`/`crates/jlpt-mcp` corpora + `doc-3` EJU (`science vs Japan and the World` exclusive — contrast case)  
> **Companion docs:** `backlog/docs/research/doc-3` (EJU — JLPT's post-JLPT successor), `doc-2` (JMdict complements + `sqlite-vaporetto`), `doc-1` (AionUi cron/ACP/MCP — §5.2.5 amendment already cross-links doc-2), `packages/japanese/data/LICENSE.md`

---

## 0. TL;DR — Yes, your app has JLPT exams. Yes, levels can be bypassed. What kind ships is a `mock` (clones official JLPT structure) but simplified to `1 filter × 1 wizard`.

| Question | Answer | Where in repo / which internet rule |
|---|---|---|
| **Does manobu have a JLPT exam?** | **Yes — `SCR-10 JLPT Mock`**. `apps/desktop/src/components/jlpt-mock.tsx:1` sequential wizard with real+pausable timer, choices, score + weak patterns + 7-day plan scaffold; routed at `/jlpt-mock` (`routeTree.gen.ts:17` + `jlpt-mock.tsx:18` loader + `jlpt-mock.lazy.tsx:4` code-split). Questions from `lib/mock.ts:1` grammar+vocab corpora; grading mirrors JLPT's sectional idea (weak = `deriveWeakPatterns` `top-N` by mistake count). | `apps/desktop/AGENTS.md:73` — `SCR-10 Dashboard` Child DOX Index |
| **Can the user ask for an exam and bypass the level?** | **Yes, two bypass paths exist today; real JLPT also allows direct entry to any level.** Repo: `Onboarding.Placement` `onboarding.tsx:187` has explicit `Skip placement` (→ `Start Hiragana`) always visible + `GoalSwitchDialog pfQAB: Keep & adapt` keeps `SRS` while changing track; `jlpt-mock` has `?filter=all/N5/N4` `Zod.enum` `mockSearchSchema` so `/jlpt-mock?filter=N4` bypasses N5. Internet: JLPT has **no sequential prerequisite** — any level `N5..N1` independently (`jlptsamurai.com`: "you can take N4 without N5"; `jlptmastery.com`: no prerequisite, you may skip `N5→N4` `High` success `N5/N4→N3` `Moderate-High`, most popular skip is `N5/N4→N3` the first career-value level; `jlpt.jp` confirms `passing each level is not a condition to attempt the next`). | `onboarding.tsx:250` `data-testid="placement-skip"`, `jlpt-mock.tsx:8` `mockSearchSchema`, `jlpt.jp/faq` + 3 blogs |
| **What kinds of JLPT exams does the app (vs official) provide?** | **App:** single mock type (`jlpt-mock`) filtering by **grammar pattern id prefix** (`n5-` vs `n4-` in `mock.ts:90 grammarIdLevel` mapping `LOCAL_GRAMMAR n5/n4`), scoring `pct% + top-3 weak patterns` not `0–180` scaled. **Official:** **5 independent levels** `N1..N5` each with its own **test sections, time limits, item types, and 2-vs-3 scoring sections** (`N1/N2: LangKnow+Reading 110/105 min + Listening 55/50 min`; `N3: Vocab 30 + Grammar-Reading 70 + Listening 40`; `N4: 25+55+35`; `N5: 20+40+30`). Official has `vocab (kanji reading/context/usage) + grammar (sentential/text) + reading (short/mid/long/integrated/thematic/information retrieval) + listening (task/key-points/outline/verbal/quick/integrated)` — app mock covers grammar/vocab subset. | `mock.ts:54 LOCAL_GRAMMAR` `n5-desu, n4-conditional-ba…`, `jlpt.jp/e/guideline/testsections.html` + `results.html` + `2024 2_9_revise.pdf` |
| **Bottom line for `doc-3`'s `v1`:** `v1` shipped is already **the JLPT mock**; EJU `doc-3` should not duplicate it — extend it (see §7 `v2→v3` plan: expand mock to per-level JLPT `N3..N1` full sections + sectional 19/38 `vs` EJU's 5 domains). | `AGENTS.md` cross-index |

---

## 1. What "JLPT exam" means — official structure (internet)

### 1.1 Levels and eligibility

* **5 independent levels** `N5 (easiest) → N1 (hardest)`, run **twice per year** (`early July + early December`, `2024` `国内 7/7 + 12/1`, `47 prefectures`) — `info.jees-jlpt.jp 2024実施要項`.
* **No prerequisite or sequential requirement.** JLPT explicitly allows taking **any level directly** regardless of prior passes (`faq_eju` equivalent is `jlpt.jp/faq` + blogs: "you don't need to pass N5 before N4" — confirmed by Japan Foundation/JEES). Each level is a different `test booklet` with different `pass marks`.

### 1.2 Test sections and time (the only place that changed since 2010)

From `jlpt.jp/e/guideline/testsections.html` + `jlpt.jp/guideline/pdf/2024_2_9_revise.pdf` + `info.jees pdf`:

| Level | Test sections (in booklet) | Time | Notes |
|---|---|---|---|
| **N1** | `① Language Knowledge (Vocab/Grammar)·Reading` + `② Listening` | `110 min` + `55 min` (`55` from `Dec 2022`, was `60`; `Dec 2020` for N4/N5 reductions) | 2 sections |
| **N2** | `① Language Knowledge (Vocab/Grammar)·Reading` + `② Listening` | `105` + `50` | 2 sections |
| **N3** | `① Language Knowledge (Vocabulary)` + `② Language Knowledge (Grammar)·Reading` + `③ Listening` | `30` + `70` + `40` | **3 sections** — Vocab split off to avoid hinting (FAQ). N3 added `2010` between old L2–L3. |
| **N4** | `① Language Knowledge (Vocabulary)` + `② Language Knowledge (Grammar)·Reading` + `③ Listening` | `25` + `55` + `35` | 3 sections (`Dec 2020` time reduction) |
| **N5** | `① Language Knowledge (Vocabulary)` + `② Language Knowledge (Grammar)·Reading` + `③ Listening` | `20` + `40` + `30` | 3 sections |

Why the split differs N1/N2 vs N3–N5: fewer inventory items at `N3–N5` — mixing vocab+grammar+reading in one section would leak answers (`faq` `Why is the test section … divided for N3,N4,N5?`).

### 1.3 Composition of test items (what is asked per section)

`jlpt.jp/e/guideline/testsections.html` `Composition of test items` — each section is a set of `item types` (question intents), each containing multiple questions. Five levels share a core but diverge on long/integrated types:

| Section | Item type | N1 | N2 | N3 | N4 | N5 |
|---|---|---|---|---|---|---|
| **LangKnow·Reading / Vocab** | Kanji reading | ○ | ○ | ○ | ○ | ○ |
| | Contextually-defined expressions (`word-in-context`) | ○ | ○ | ○ | ○ | ○ |
| | Usage | ○ | ○ | ○ | ○ | ○ |
| **Grammar** | Sentential grammar 1 (select form) | ○ | ○ | ○ | ○ | ○ |
| | Sentential grammar 2 (sentence composition) | ○ | ○ | ○ | ○ | ○ |
| | Text grammar | ○ | ○ | ○ | ○ | ○ |
| **Reading** | Comprehension short passages | ○ | ○ | ○ | ○ | ○ |
| | Comprehension mid-size passages | ○ | ○ | ○ | ○ | ○ |
| | Comprehension long passages | ○ | ○ | — | ○ | — |
| | Integrated comprehension | ○ | ○ | — | — | — |
| | Thematic comprehension (long) | ○ | ○ | — | — | — |
| | Information retrieval | ○ | ○ | ○ | ○ | ○ |
| **Listening** | Task-based comprehension | ○ | ○ | ○ | ○ | ○ |
| | Comprehension of key points | ○ | ○ | ○ | ○ | ○ |
| | Comprehension of general outline | ○ | ○ | ○ | — | — |
| | Verbal expressions | — | — | ○ | ○ | ○ |
| | Quick response | ○ | ○ | ○ | ○ | ○ |
| | Integrated comprehension | ○ | ○ | — | — | — |

`Long/Integrated/Thematic` appear only `N1/N2` (and `N3` long) — lower levels omit because reading stamina is tiered. This table is what the **app mock must mirror when expanding beyond grammar** (today `mock.ts:66` only covers grammar patterns).

### 1.4 Scoring — to pass there are two gates

From `jlpt.jp/e/guideline/results.html` + `jlpt.jp/guideline/pdf/understandingscorereport_2025_revise.pdf` + `guide2011_e_05.pdf: How should I decide which test level to take?` (JEES 2011) — unchanged since **July 2010** (N4–N5 from Dec 2010); N1 listetime updated `Dec 2022` but **pass lines did not change with time reductions** — JEES emphasizes `equating` preserves reliability.

| Scoring | N1–N3 | N4–N5 |
|---|---|---|
| **Scoring sections (results columns)** | **3 columns:** `Language Knowledge (Vocab/Grammar) 0–60` + `Reading 0–60` + `Listening 0–60` = **Total 0–180** | **2 columns:** `Language Knowledge (Vocab/Grammar)·Reading 0–120` + `Listening 0–60` = **Total 0–180** |
| **Overall pass mark (total)** | `N1 100, N2 90, N3 95` | `N4 90, N5 80` |
| **Sectional pass mark (per column, must pass EACH)** | `19 per 0–60 column` | `38 per 0–120` + `19 per 0–60 Listening` |
| **Rule** | **Two gates:** (1) `total ≥ overall` **and** (2) **every** scoring section `≥ sectional`. "If even one scoring section is below its sectional pass mark, fail — no matter how high the total." Missing a required test section → **no scoring**, fails, all columns rendered `**/60` etc. (`understandingscorereport: * If an examinee misses a required test section… scores shown as asterisks*). |
| **Scale** | **Scaled scores** via **IRT equating** (like EJU `doc-3`) — not raw question counts. JEES: `does not [use] pre-determined [raw]` — "Please see the more detailed …" |
| **CEFR reference (pass only)** | `N1 100–141 → B2, 142+ → C1; N2 90–111 → B1, 112+ → B2; N3 95–103 → A2, 104+ → B1; N4 90+ → A2; N5 80+ → A1` (`understandingscorereport: § CEFR Level (Linguistic, Reception)`) |

**Practical meaning for bypass debate:** N5's `80/38+19` vs N4's `90/38+19` — +10 overall but same sectional 38+19 — N4 is not a higher section floor, just a higher total + harder items (`1,500 words/300 kanji vs 800/100`, faster listening, paragraph vs sentence reading — `jlptsamurai.com N4 listening/reading`). So skipping N5 is less punished by sectional gate than by **item difficulty**.

### 1.5 Choosing / skipping levels (official + internet guidance)

* **Official FAQ (`faq` + JEES):** there **is** a choice guide (`guide2011_e_05.pdf`) but **no mandate** to progress sequentially. Each level's certification estimate (`認定の目安`) is phrased as "can understand…" — the only decision variable is the learner's self-assessed reading/listening stamina, not prior passes.
* **Internet consensus (independent blogs, all agree):** `Can You Skip JLPT Levels?` (`jlptmastery.com 2025-10-30`): `no prerequisite for any level`, you can register for `any N5..N1` anytime; common successful skips `Skip N5→N4 High`, `Skip N5/N4→N3 Moderate-High`, `Skip →N2 Moderate`, `Skip →N1 Low-Moderate`; **most common and recommended skip is `N5/N4→N3` (first level with career value)**; N4's pass rate `~38%`, N3 `~36%` vs N5 `~49%`. `jlptsamurai.com 2025-08-15` self-check quiz: `hiragana/katakana fluent + ~100 kanji + daily convo + N5 です/ます/て/ない`, practice `70%+` on mock (also `JapaneseExplorer SG`: `70% to proceed to next level test`). `jlptbooks.com`: many N1 holders never took N5/N4/even N3 — study lower material, don't pay `4× fees (~$240 US)` sequentially.
* **Time cost:** JLPT runs `2× per year`; failing at a skipped-to-harder level costs `6 months` before next try (`jlptmastery`).

---

## 2. What ships in this repo — full inventory

### 2.1 SCR-10 JLPT Mock — the only "exam" surface

| Concern | Implementation | File |
|---|---|---|
| **Route** | `/jlpt-mock` `TanStack Router` file route, `Zod` `filter all\|N5\|N4` default `all` (`validateSearch mockSearchSchema`), `loader` `queryOptions ["mock", filter]  staleTime 30s` `ensureQueryData`, `loaderDeps filter`, `pendingComponent <Loader>`, `errorComponent` `Failed to load mock` + lazy split | `apps/desktop/src/routes/jlpt-mock.tsx:18` + `jlpt-mock.lazy.tsx:4` (`createLazyFileRoute`) + `routeTree.gen.ts:17` |
| **Compound** | `<JlptMock> provider → Timer / Progress / Choices / Next / Score / Plan / SubmitFail` Vercel `Object.assign(Root,{.Sub})` no boolean-prop explosion | `apps/desktop/src/components/jlpt-mock.tsx:1` (`JlptMockRoot + JlptMock = Object.assign…`) |
| **Timer + Progress** | Real interval `setInterval 1s` when `!paused && phase===running`, paused via `setPaused(true)`; `Timer` shows `mock.timer {mm}:{ss}` `aria-live=polite`, `Pause/Resume` `aria-pressed`; `Progress` `Q {n}/{total}` `role=progressbar` `mock.progress`; `formatTimer(s) → mm:ss` padded, negative clamped | `jlpt-mock.tsx:77` `Timer`, `111` `Progress`, `lib/mock.ts:169` `formatTimer` |
| **Choices + gating** | `Choices` fieldset `legend prompt`, radio as `button aria-pressed/data-picked data-correct` per `choiceId`; helper `Choose an answer to continue` until pick (`mock.helper`), `40% opacity` (`data-opacity-40`); `Next` button `→` / `Submit` last `disabled until chosenId!==null` `opacity-40 aria-disabled` + `onClick goNext` (current→next or finalize `computeMockResult`) | `jlpt-mock.tsx:127` `Choices`, `174` `Next`, `162` helper |
| **Grading** | `scoreQuestion(q,choice) → choice===correctId` + `computeMockResult(questions, answers) → {score,pct=round(score/total*100), mistakes: Mistake[]{grammarId,questionId,wrongChoiceId} for any non-null wrong pick, weak: deriveWeakPatterns(mistakes,3)}`; grammar pattern enrichment via `fetchGrammarLevel(level)` `GET /grammar?level=N5..N1` with `LOCAL_GRAMMAR n5: desu/past-ta/dewa-arimasen, n4: conditional-ba/passive` fallback (offline) | `lib/mock.ts:45` `scoreQuestion`, `109` `deriveWeakPatterns` (`Map grammarId→{total,wrong}` `sort wrong desc→id asc`, `top 3 slice`, `fetchGrammarLevel` pattern fill), `142` `computeMockResult` |
| **Weak patterns** | `WeakPattern {grammarId,pattern,total,wrong}` — same shape as `doc-3`'s `weak syllabus patterns → Plan` but pure grammar. Top-N `3`, tie-break `b.wrong desc, a.id asc`. Id level via `grammarIdLevel n5-/n4-/n3-…` | `mock.ts:30` `WeakPattern`, `90` `grammarIdLevel`, `109` `deriveWeakPatterns` |
| **Score view** | `Score {pct}% ({score}/{total})` + `Weak: {pattern} ({wrong}/{total}) · …` or `Perfect run`; `Plan` `Next 7 days: Focus on {weak.length} pattern · ul pattern — wrong/total` + buttons `[Start plan] mock.start_plan` (wired to `useChatSession` in `TASK-1.16` — seeds chat with `grammarId` list + `console.info`) + `[Review mistakes] mock.mistakes`; `SubmitFail` `role=alert aria-live=assertive` `mock.submit.fail` + `[Retry submit] → reset()` (WAL note in copy variant) | `jlpt-mock.tsx:195` `Score`, `229` `Plan` (`window.console.info`), `288` `SubmitFail` |
| **Shame-free copy** | `mock.test.ts` proves `Perfect run — no weak patterns`, `mock.mistakes` neutral; `doc1/mock.scope` no total-retake shaming — aligns with `AGENTS.md` Ethical CLEAR | `jlpt-mock.tsx:220`, `test/mock.test.ts:13` |
| **Limits vs official** | Only **grammar/vocab** (choices from `LOCAL_GRAMMAR` patterns); **no** distinct Reading/Listening split, no `110/105/70/55/40` timers, no `0–180 + 19/38` sectional pass logic, no `CEFR` badge, only `all|N5|N4` filter (no `N3..N1`); questions are **authored demo fallbacks** not `8MB` kanji row fetching (`loadVocab removed`, now server fetch `GET /grammar?level=`) | `mock.ts:62` `LOCAL_GRAMMAR` limited; compare `jlpt.jp/e/guideline/testsections.html` |

### 2.2 Onboarding placement — adaptive bypass

| Concern | Implementation | File |
|---|---|---|
| **Goal cards** | 4 cards `GOAL_CARDS: travel (★ Recommended) / jlpt (N5 in 3 months · 500 words) / anime / work` (`jlpt` title present, `travel` recommended) | `onboarding.tsx:48` `GOAL_CARDS` |
| **Placement quiz** | `HIRAGANA_BASIC ["あ","い","う","え","お"]` 5 inputs `romajiFor(c)→ a/i/u/e/o`; `hiraganaCorrect → skipHiragana` derived `every answers[c]===romaji` → `!skipHiragana && show list`; progress `{Object.keys(answers).length}/8`; loading skeleton `placement-skeleton-iZL4O` `useState loading` + `setTimeout 3000`; `verify` `bun test: placement skip logic` | `onboarding.tsx:187` `Placement`, `192` `HIRAGANA_BASIC`, `197` `hiraganaCorrect`, `250` `placement-skip`, `246` `placement-skeleton-iZL4O` |
| **Skip placement (bypass)** | Button `Skip placement` **always visible** (`data-testid="placement-skip"`, `onSkip` callback) → caller starts at Hiragana (`test-plan.md:27 Skip placement (Continue without placement test) → onboarding.keep Keep & adapt CTA NOT Reset`) | `onboarding.tsx:250`, `docs/test-plan.md:27`, `docs/feature/nihongoai-copy-deck.md:46 place.note` |
| **GoalSwitch bypass** | `GoalSwitchDialog pfQAB: Keep 42 / Add 18 / SRS preserved` with `Keep & adapt` primary (`goal-keep-adapt`), `Keep & add new path` (`goal-keep-add`), `Reset (irreversible)` (`goal-reset`); `Keep 42` etc. are test ids not magic numbers | `onboarding.tsx:143` `GoalSwitchDialog` |
| **What is NOT bypassed** | Placement is only `あ→お` kana — no listening/reading sectional placement, no level auto-assign `N4 vs N3`; after onboarding `Dashboard.computeBranch(kanaMastery)` chooses shell (`dashboard.tsx:65` `kanaMastery>=0.9→returning, ===0→beginner, else advanced`) — learners who skipped placement land as `beginner` until kana mastery rises. | `dashboard.tsx:65` `computeBranch` |

### 2.3 Ask-for-exam path — can a user "ask" and bypass?

**Two user-facing "ask" paths already exist, neither blocks:**

* **Route ask:** direct URL `/jlpt-mock?filter=N4` bypasses N5 without code — `validateSearch` default `all`, manual `N4` select in `jlpt-mock.lazy.tsx:49` `useSearch`+`useNavigate` filter chips + persisted `mockQueryOptions` (`staleTime 30s`).
* **Conversation ask:** `/ai` `POST /learn/chat` SSE `apps/desktop/src/routes/learn/conversation/$sessionId.tsx` `useMutation + AbortController` + Teacher Agent `packages/agent` (TASK-1.16 `ConversationCoach/GrammarExplainer/KanjiTutor/VocabSRS` keyword intent). Learner can type `give me N3 mock` and `Plan [Start plan]` seeds a chat session with the mock's `weak` `grammarId[]` — no level gate (`modelCatalog fetcher.tsx queryOptions` + `useChatSession` `offlineFirst`).
* **Dashboard bypass:** after `Onboarding.Placement` `Skip placement` → `Dashboard` `beginner` (`steps 0/4`) but `PrimaryCta` `Welcome — Step 1: Hiragana` is immediately clickable — no block (`AGENTS.md: placement` `Drills NEVER blocked by AI`, `AGENTS.md: Work Guidance` blocks). The learner who feels ready may also switch `GoalCard jlpt` at any time (goal is not level).

So the **answer to "ask and bypass level" is yes on three axes**: skip placement quiz, jump mock filter, ask chat — all preserve `SRS` (`GoalSwitchDialog pfQAB` shows `SRS preserved` vs `Reset irreversible` warning).

### 2.4 Repo's data shape vs official JLPT item types

| Official item type (`jlpt.jp testsections`) | Repo covers? | Where |
|---|---|---|
| **Kanji reading + Context + Usage (vocab)** | Partial (`LOOKUP_VOCAB/SEARCH_VOCAB/ LIST_VOCAB_BY_LEVEL` via `crates/jlpt-mcp` + `packages/japanese` 8,505 N5–N1 vocab). Mock's `LOCAL_GRAMMAR` is grammar-only — vocab comes from `vocabContaining` not from mock questions yet. | `crates/jlpt-mcp/src/main.rs:92` 12 tools; `apps/desktop/src/lib/kanji.ts` |
| **Sentential grammar 1/2 + Text grammar** | **Mock covers Sentential 1** (`desu/past-ta/dewa-arimasen` + `conditional-ba/passive`). `Text grammar` (mid-paragraph `が/けれども` insertion) deferred. | `mock.ts:62` |
| **Reading short/mid/long/integrated/thematic/information retrieval** | Deferred — `Reader SCR-05` (`reader.tsx: Story N5 コンビニで`) provides reader UI but mock does not pull `grammar/n*.json` reading passages; `Lesson` `kanji.ts vocabContaining` polyhierarchy rows are the nearest reading fabric. | `reader.tsx` |
| **Listening task/key-points/outline/verbal/quick/integrated** | **Not in mock** — listening would need `@manobu/speech` `speech_tts` (`tts.rs:98` `RIFF WAV` `speak`) + `speech_stt_file` — `TASK-21.1` TTS everywhere + `21.2` STT grading are `To Do` (`backlog/task-6` mock scope). `listen-type.tsx:86` exists as a dictation shape but not wired to mock. | `packages/speech/AGENTS.md` + `backlog/tasks/task-21.x` |
| **Scoring** | `pct%` only — not `0–180` scaled + `19/38` sectional. `Score {pct}% ({score}/{total})` + `Weak: pattern (wrong/total)` is the entire result. | `jlpt-mock.tsx:195` `Score` |

---

## 3. Comparison to EJU (`doc-3`) — why not ship a second mock the same way

| JLPT mock (ships today) | EJU `doc-3` (see `doc-3 §6 v1→Finale`) |
|---|---|
| `1 exam` (`Language Know+Reading + Listening`), **5 levels** `N5..N1` differing only in difficulty + 2-vs-3 section split, `valid lifelong`, **no choice** except level | `1 exam` (`Japanese 400+50 + Science 200 *or* Japan and the World 200 + Math 200`) with **intra-exam choices**: pick level `and` pick `Science vs Japan and the World` (mutual exclusion per session) and inside Science **pick 2/3** (Physics/Chemistry/Biology) and inside Math **pick C1 vs C2** (`Math I/A` vs `I/A/II/B/III/C`). `valid 2 years`, `twice/year` with `one disclosure type/year` rule. |
| Ran as **one sequential wizard** `jlpt-mock` (`Q {n}/{total}` `→` `Score`) | Same wizard shell is right (`eju-mock.tsx` clone), but `validateSearch` is a tree (`subject, course, pick2`) with cross-subject exclusivity (`Science vs Japan and the World Zod refine`). JLPT filter `all/N5/N4` is the prototype. |
| No cross-domain prerequisites beyond `あ→お` kana | Needs `doc-2` `sqlite-vaporetto` (`tokenize='vaporetto' vaporetto_and_query/bm25`) for terminology-heavy search (`溶解度積`, `需給曲線`) **before** substantive science/Japan and the World corpora ship. JLPT mock can stay on `unicode61` today but EJU cannot. |

---

## 4. Gaps — what the app doesn't have yet

| Gap | Impact | Reference |
|---|---|---|
| **N3..N1 not queryable** — `LOCAL_GRAMMAR n1/n2/n3 []` empty (`mock.ts:59` `n1: [], n2: [], n3: []`), server fetch `GET /grammar?level=` exists but no mock time slot (`N1 110+55` vs `N5 20+40+30` vs `N3 30+70+40`) mapped. | Advance learners can't take a level-matched mock (> `Skip N5→N4` path `High` per `jlptmastery` is blocked beyond N4). | `lib/mock.ts:58` |
| **Reading/Listening not exercised in mock** — `reader.tsx` SCR-05 collection is separate from `jlpt-mock`; listening has no audio path. | Scores undercount difficulty vs official `19/38` sectional; learner can pass mock grammar yet fail official reading. | `mock.ts` vs `jlpt.jp/e/guideline/testsections.html` |
| **No CEFR badge** `A1|A2|B1|B2|C1` mapping from `understandingscorereport_2025_revise.pdf §3` — not surfaced even for pass. | Misses motivational linkage (`N5 80→A1 … N1 142→C1`); easy add once scoring is sectional. | `understandingscorereport_2025_revise.pdf` |
| **No JLPT-scheduled cron** — `doc-1` cron (`ScheduledTasksPage CreateTaskDialog timer`) is for FSRS (`batchNext 20`, `applyLoadBalancer`), not for `JLPT mock → 7-day plan` cadence (`mock.plan Start plan` still `console.info` stub). | Learner must manually decide to re-mock; FSRS due nudge covers spaced repetition but not level-spaced reassessment. | `jlpt-mock.tsx:234` `window.console.info` |
| **Placement is kana-only** — there is no `Reading/Listening` sectional placement, no adaptive `CEFR`-gated branch (`computeBranch` is `kanaMastery` only). | Returning bilingual learners bypass placement and land `beginner` (`kanaMastery===0`) despite knowing `N3` reading, unless they `Skip placement` **and** switch filter to `N4` mock. | `dashboard.tsx:65` |

---

## 5. What to ship next — aligned with `doc-3`'s `v1→v2→v3→Finale` staging

### 5.1 Immediate (fix asymmetry with ≤2 files each)

1. **Fill `LOCAL_GRAMMAR n3,n2,n1`** non-empty seed (`fetch-vocab.ts:185 buildSurfaceIndex` pattern for JMdict `partOfSpeech coarsePos` + `jkindrix` 595 grammar points) — unblocks `formatTimer` path to real section lengths. Small PR similar to v1 shelf (`syllabus/*.json` diff + `build.rs/types.rs/golden` if any new file).
2. **Sectional score mirroring.** Add `deriveSectionalWeak` reusing `grammarIdLevel` + a `scoreBySection(part)` that returns `{lang, reading, listening}` vs official `60/60/60` vs `120/60` — then `Score` can render `Sectional pass` badge `19/38` alongside `pct%`. This is the `how government thinks about JLPT` surface (`guide2011_e_05.pdf`).
3. **Bypass polish:** surface `Skip placement` copy already in `nihongoai-copy-deck.md:46 place.note` (`Skips kana if you got あ→お correct`) as a visible helper under `Progress {n}/8` — already rendered but unstyled.

### 5.2 Next sprint (mock parity before EJU)

1. **`Reading` passage type in mock** — add one `information retrieval` and one `short passage` case per `N5/N4` (reusing `Reader`'s `N5_DEFAULT コンビニで` 12-sentence collection). Validates `jlpt-mock` `Choices` with `Text grammar` before EJU copies the same shell.
2. **`Listening` stub via `TASK-21.1 TTS`.** Wire `speak(text,{speed 0.8/1.0, sid ♀/♂})` (`packages/speech/src/tts.ts:29`) to a `Mock.Listening` card (audio `[▶]` + `choiceIds` same shape, `AnswerMethod` mock audio fallthrough). Keep `mock.submit.fail` `Retry submit` WAL note already there.
3. **Cron for mock.** One headless job `Bi-weekly JLPT mock → weak topology → 7-day Plan` (`doc-1 §5.2.2 B1` `ICronJob {cronExpr|interval|oneTime, tz, keepAwake}` `every 14d` + `newConversation` to avoid bleed) — reuses `MCP catalog` `C1` `mcp-servers.json` fan-out so the same plan tool reaches any agent.

---

## 6. How to answer "should I bypass?"

**Short answer for in-app guidance (under `Placement` + `GoalSwitchDialog` and inside `jlpt-mock` `filter` description):** `You may take any N level directly — JLPT has no prerequisite (JEES/Japan Foundation). Skip only if you can self-assess: 70%+ on the lower level's mock (JapaneseExplorer SG 70%) and can answer あ→お plus the current level's `kanji reading/context/usage` sample without guessing. The most useful skip the internet recommends is N5/N4→N3 (first career-value level). Skipping saves fees and waiting (2×/year, 6 months if you fail) but lowers pass rates (N5 ~49% → N3 ~36%).`

Do not claim that "N1 holders never took N4" inside the placement flow — the `jlptbooks.com` stat belongs in an explainer card, not a nudge, to avoid coerced skip. Use it as `Plan` footer when `mock.html` perfect run appears.

---

## 7. Roadmap tie-in — where doc-3's `v1→Finale` meets this doc

| Doc-3 version | JLPT counterpart in this doc | Relationship |
|---|---|---|
| `v1 Foundation` `doc-3 §6 v1` (syllabus package + `eju_questions_fts` + `eju-mock.tsx` clone) | `v1` already **ships** — `jlpt-mock` is `doc-3 v1`'s ancestor (`all/N5/N4` `mockSearchSchema`). Don't rewrite it; extend it (see §5.2). | `doc-3 v1` should ship once — it proves the `packages/*` data-embedding + `vaporetto` FTS5 contract. |
| `v2 STEM` `doc-3 §6 v2` (Math C1/C2 `80+` + Science `60+` Ksp/Enthalpy) | `v2` of **this doc** = `JLPT N3..N1 + Reading/Listening sectional parity + CEFR` (see §4 gaps / §5.1). Ship **after** `doc-3 v1` because both demand `sqlite-vaporetto` before term accuracy improves. | Joint `FTS5` migration (`packages/db/src/schema/content.ts` `tokenize='vaporetto tags 名詞…'`) covers both. |
| `v3 Liberal-arts` `doc-3 §6 v3` (Japanese + Japan and the World) | Depends on `Reading` passage pipeline (same `Reader N5 コンビニで`). The `MaterialPanel` (graph/choropleth) for `Japan and the World` is a sibling of `Reading integrated/thematic` in JLPT — implement them together. | |
| `Finale 12000 Vocab + 6 mocks` `doc-3 §6 Finale` | **Not** a JLPT finale — JLPT vocab is already `8,505` N5–N1 + 595 grammar (`packages/japanese` stable). Finale here should be **re-guiding level selection** (N3 vs N2 `19/38` sectional badge + CEFR badge `A1→C1` + skip cost `6 months`) — not more vocab. | |

---

## 8. Verification

* `bun run check-types` + `bun run check` (Ultracite) across `packages/japanese`, `crates/jlpt-mcp`, `apps/desktop` — `mock.ts:109` grammar fetch async doesn't break typing; `jlpt-mock` lazy chunks remain.
* `bun test` `mock.test.ts:13` (already `scoreQuestion, deriveWeakPatterns topN 3, grammarIdLevel`) → add cases for `N3/N2/N1` `LOCAL_GRAMMAR` + sectional branch + CEFR; `placement skip` `walkthrough-copies.test.ts` already gates `onboarding.keep Keep & adapt`.
* Manual: `bun run dev` → `Onboarding` `Skip placement` → `Dashboard` branch `beginner` (`kanaMastery===0` → `Max step 1: Hiragana`) → `/jlpt-mock?filter=N4` loads `5.0+` scoped grammar (not `all` fallback) → timer `Pause/Resume` → pick → `Score {pct}%` + `Weak: pattern (wrong/total)` → `Plan Next 7 days` → `Reset`.

---

## 9. References — primary sources used

* **JLPT official:** `jlpt.jp/e/guideline/testsections.html` (sections `110+55/105+50/30+70+40/25+55+35/20+40+30`, item types table), `jlpt.jp/e/guideline/results.html` + `jlpt.jp/guideline/pdf/understandingscorereport_2025_revise.pdf` (scoring 2-vs-3 sections `60/60/60 vs 120/60` `Total 0–180` `Overall 100/90/95/90/80` `Sectional 19/19/19/38/38+19` `CEFR A1..C1` + `* missing section → **/60`), `guide2011_e_05.pdf` (`How should I decide which test level to take?` + sectional logic `19/38`), `info.jees-jlpt.jp 2024実施要項` (`47 prefectures, 2×/year`, `N*認定の目安` long texts), `jlpt.mosai.org/test_guide_2024B` (mirrored guide), `jlpt.jp/faq`.
* **Internet explainers (skip/bypass consensus):** `jlptsamurai.com 2025-08-15 Can I Take JLPT N4 Without N5?` (`High/Medium` success table, self-check `70% + hiragana+100 kanji+です/ます/て/ない`), `jlptmastery.com 2025-10-30 Can You Skip JLPT Levels?` (`High/Skip N5→N4 … Low→N1`, most popular `N5/N4→N3`, `49%/38%/36%` rates, fee `$240`), `jlptbooks.com/faq/can-i-skip-jlpt-levels` (many N1 holders never took N5), `japaneseexplorer.com.sg/japanese-placement-test` (`70% to next level`), `japademy.com/jlpt/jlpt-n4-vs-n5` (skip framing).
* **Manobu:** `apps/desktop/src/components/jlpt-mock.tsx:1` (`JlptMockRoot + assign`, `Timer, Progress, Choices, Next, Score, Plan, SubmitFail`), `apps/desktop/src/routes/jlpt-mock.tsx:18` (`validateSearch all|N5|N4`), `routes/jlpt-mock.lazy.tsx:4` (`createLazyFileRoute`), `apps/desktop/src/components/onboarding.tsx:187` (`Placement HIRAGANA_BASIC`, `Skip placement  placement-skip`, `Goals 4`, `GoalSwitchDialog pfQAB`), `apps/desktop/src/lib/mock.ts:1` (`LOCAL_GRAMMAR, deriveWeakPatterns topN 3, grammarIdLevel, computeMockResult, formatTimer`), `apps/desktop/src/components/dashboard.tsx:65` (`computeBranch kanaMastery>=0.9 returning`), `docs/test-plan.md:27` (skip placement path), `routeTree.gen.ts:17` (jlpt-mock), `packages/japanese`, `crates/jlpt-mcp`, `doc-3` (`Science vs Japan and the World` exclusive — contrast case), `packages/speech`.
