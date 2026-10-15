---
id: doc-5
title: Absolute beginner coverage - does manobu serve zero-knowledge learners?
type: specification
created_date: '2026-09-06 05:38'
---

# Absolute Beginner Coverage — Does manobu Serve Zero-Knowledge Learners?

> **Status:** research / specification  
> **Date:** 2026-09-06  
> **Sources:** internet: `thejapanshop.com 6-month N5 plan` (46 hiragana W2 + 46 katakana W4, `200-300 words`, `SVO?SOV`), `inkujapanese.com/learn-japanese` (adult 30 min/day `kana 2 wks → N5 3 mo 500-800 words → N4 3 mo`), `jpyokoso.com/how-to-start + what-to-learn-first` (7 stages `1-2 w Hiragana, 1-2 w Katakana, 4-8 w grammar+phrases, 2-3 mo 500-1000 words, 2-3 mo Kanji ~100, ongoing listening, 3-6 mo N5 ready`; `shimobi Japanese` 2 weeks 92 kana `mnemonics + handwriting + SRS + immediate reading`), `tofugu.com/learn-japanese` (zero→hiragana→pronunciation→typing→kanji stockpile while katakana `1-3 mo` + grammar), `contra.com Kakimasu`/`nihonGO! Animal Crossing`/`mwm.ai Obo` (writing-centric gap: disconnected vocab vs writing, stroke-order feedback, onboarding confusion `three alphabets`), `adapty.io Japanese onboarding` (detail/trust/mascot vs Western skip), `uxplanet Roestta vs Duolingo` (learn-before-email); manobu: `packages/japanese`/`crates/jlpt-mcp`, `apps/desktop` `onboarding.tsx:187` `Placement HIRAGANA_BASIC`, `dashboard.tsx:55` `STEPS`, `drill-lab.tsx:1` `Canvas 280×140 + TypeFallback`, `listen-type.tsx:86` `0.8×/1× + pitch`, `lesson.tsx:371` `N4-12 + Numbers 0-100`, `reader.tsx`, `docs/feature/nihongoai-spec-v1.md` `§SCR-01..08` + `§Tech Foundation`, `AGENTS.md` branches, `docs/test-plan.md:27` zero-knowledge walkthrough (`Travel → skip placement → drill あ → lesson → save → review`), `doc-4` JLPT (N5 `80/38+19` vs N4 `90`) + `doc-3` EJU (not for beginners)  
> **Companion docs:** `doc-4` (JLPT mock already ships), `doc-2` (KanjiVG 13k SVG, Kanjium 124k pitch, `sqlite-vaporetto`), `doc-3` (EJU `v1→Finale` post-JLPT), `docs/feature/nihongoai-spec-v1.md` `Checklist ✅`, `backlog/docs/research/doc-1` `doc-2`

---

## 0. TL;DR — Your absolute-beginner path ships, but it is **thin at the exact first 2 weeks** where internet consensus is strict

| Absolute-beginner need (internet consensus `2 wks kana 46+46 → N5 3-6 mo 800 words/100 kanji/100 grammar`) | Manobu ships today | Gap → fix |
|---|---|---|
| **Hiragana 46 full** (`thejapanshop W2`, `jpyokoso St.1 1-2 w`, `shinobi 5-7 days recognition, 2-4 w writing`) | **Yes — but only 5 of 46.** `Onboarding.Placement HIRAGANA_BASIC ["あ","い","う","え","お"]` `5` inputs `romajiFor a/i/u/e/o` + `skipHiragana` + `Skip placement` always visible (`onboarding.tsx:187`); `DrillLab drill-lab.tsx:84 Canvas 280×140 ghost 1→2→3 + TypeFallback` covers single chars, not the full `46` + `dakuten/yōon`. | **Add full `46` hiragana drill set (`あ→ん` gojūon)** — `DrillLab` already has the UI; populate `initial.chars` from `46`, not `5`. |
| **Katakana 46 full** (`jpyokoso St.2 1-2 w`, `tofugu 1-3 mo overlap katakana while kanji stockpile`) | **Half.** `Dashboard STEPS` lists `Katakana (カ) — 15 min` as step 2 (`dashboard.tsx:55`), but there is **no dedicated katakana drill in repo** — only hiragana fallback `["あ","い","う","え"]` in `drill-lab.tsx:144` `TypeFallback` choices. | **Add katakana set `46` (`ア→ン`)** same `DrillLab` + mnemonic `Dr. Moku / Tofugu` pattern (`shinobi: き=key, め=eye, つ=tsunami`). Keep `week-on/week-on` spacing (`shinobi: week-on hiragana then week-on katakana`, not 92 at once). |
| **Survival phrases + numbers (`jpyokoso St.3 week 3 20 phrases + numbers 1-100`)** | **Yes — `Lesson.Numbers` ships** `Numbers 0-100 + Counters 一つ/二人/三枚 + Price/Time` (`lesson.tsx:244` `CARDINALS + PEOPLE + FLAT + formatPrice/Time`) — this *is* the one absolute-beginner module that **exceeds** internet `_numbers 1-100 4-8 w` baseline. Phrases weaker: `Lesson.Context 私はコンビニで…` + `Reader N5 コンビニで` `3` words only. | Add `Survival pack` `20 phrases` (greetings/ordering/directions/shopping) as `Reader` pre-N5 stories (`shinobi: pre-N5 short illustrated + tap-to-translate`) — today `Reader` has one `N5 12-sentence` story. |
| **Listening from day one (`jpyokoso St.6 ongoing`, `inku 10 min/day audio`)** | **Yes but gated.** `ListenType listen-type.tsx:86 Audio 0.8×/1×` exists with `pcvtp/J-7/UUIuC` `Pitch たべ˥る` fallback + `Input romaji→kana shake 200ms + Next 40%` but uses `target jp` prop — no absolute-beginner audio pack yet; `TASK-21.1` TTS everywhere is `To Do`. | Wire `TASK-21.1 @manobu/speech speak({speed 0.8/1.0, sid ♀/♂})` to `DrillLab.Audio [▶]` so each kana is **heard** (`nihonGO!: audio-visual + pitch visualization`) — today `[▶] audio — romaji` is static. |
| **Writing with stroke feedback (`Kakimasu: 87% navigated, 93% stroke demo very helpful, 100% praised Hiragana→Katakana→Kanji progression; nihonGO!: stroke order missing is pain`)** | **Yes.** `drill-lab.tsx:84 Canvas` + `drill-lab.tsx:57 gradeShape GHOST_TOLERANCE_PX=40 order+direction` + `pen smoother pointerType mouse|pen|touch` + optional `KanjiDetail 200×100 DrawMini` (`doc-2` KanjiVG deferred to `KanjiVG.tsx 109×109`). **Equal-path fallback** keeps `mastery≥90%` achievable without drawing — this is research-correct (don't block). | Bring `doc-2` `KanjiVG 13k` SVG `StrokePaths M/C/S` order for ghost overlay + `stroke numbers` side of start — fixes `TODO KanjiVG ingestion`. |
| **SRS from week 2 (`inku/jpyokoso: 10-15 new cards/day Anki habit`, FSRS `desired_retention 0.90` in spec)** | **Yes.** `Lesson.RightRail Save to FSRS Undo 5s` (`lesson.tsx:274` `saveFsrsToast retention 0.90`) + `packages/srs` FSRS-6 + `Dashboard.Due FSRS  Next at R≤90%` + `Review SCR-12 R≤pct%` + `Due aria-live polite`. **FSRS is production-grade** (`fsrs-6 21 params`, `revlog`). | Nothing to fix — but first `10-15` kana cards should be pre-seeded so `Due` isn't `0 due` on day 1 (`dashboard DueCard` empty). |
| **Onboarding that doesn't overwhelm (`adapty.io: Japanese expects detailed/mascot vs Western skip; nihonGO! tour overwhelmed beginners`)** | **Yes — and it is the best-covered absolute-beginner surface.** `Onboarding.Goals 4 cards Travel ★Recommended / JLPT / Anime / Work` (`onboarding.tsx:48` `GOAL_CARDS` chips) + `Placement` adaptive (`skips kana if あ→お correct; progress {n}/8; skeleton iZL4O >3s + Try again`) + `Skip placement always visible` (`data-testid="placement-skip"` → `Start Hiragana`) + `AiSetup 5 states never blocks drills` + `GoalSwitchDialog pfQAB Keep & adapt primary` (no confirm-shaming). `docs/test-plan.md:27` zero-knowledge path *is* `Travel → skip → drill あ → lesson → save → review`. | Keep — this is already `adapty`-aligned (detail) *and* Duolingo-aligned (learn-before-email: `AiSetup` never gates). Don't add LINE-like mandatory quiz (Japanese style warns `Skip rarity hurts retention` — your Western skip is right for global learners; keep both modes). |

**Verdict: manobu covers the absolute-beginner *skeleton* (`≈70%`) — onboarding → kana steps → lesson → FSRS — exactly the `nihongoai-spec-v1.md` frozen `pencil-new.pen` `17` sections intended. The *muscle* missing is **full 46 hiragana + 46 katakana** (you ship `5` of `92`) and a **pre-N5 survival story pack** before the current `N5 コンビニで 12 sentences` reader. Everything after kana (`Lesson` `N4-12`, `Conjugate`, `Roleplay`) correctly assumes kana, so absolute beginners who `Skip placement` still face a jump `あ→お → 食べる/です` unless the drill fills the gap.**

`doc-4` already proved `JLPT bypass` is free — so absolute beginners don't need to be trapped on `N5` to move, but they *do* need the 2-week kana window first (internet `3 days kana → week 2 katakana → week 3 vocab 50 words → month 2 grammar 2-3 patterns/day`).

---

## 1. What "absolute beginner" means (internet)

### 1.1 Who they are

* **Zero Japanese** up to "maybe `konnichiwa / baka` handful" (`tofugu`). No hiragana, no romaji discipline; may not know Japanese is `SOV` not `SVO` (`jpyokoso`).
* The **wrong place to start is kanji** — every guide (`inku`, `jpyokoso`, `tofugu`, `shinobi`, `thejapanshop`) says: the fastest way to make kana automatic is to **read simple leveled material the day you learn it** — not to stare at charts for weeks. `Kakimasu` research: learners `attempted to trace letters in writing practice and sought the alphabet chart before starting a lesson`.

### 1.2 The order every guide agrees on (±1 week)

| Stage | Consensus (`jpyokoso 30-day` + `shinobi` + `tofugu` + `thejapanshop` + `inku`) | Realistic time |
|---|---|---|
| **1. Hiragana** `46 + dakuten/yōon` (`し→じ`, `きゃ`) | `1-2 weeks` (`shinobi: 5-7 days recognition, 2-4 w writing`; `thejapanshop: by end W2`; `inku: 3 days 46 chars`) — mnemonics `Tofugu/Dr. Moku` + handwriting + SRS + `immediate reading` of words made from the row you just learned (`か・き・く・け・こ → かき, こけ`). | `1-2 w` |
| **2. Katakana** `46` | `1-2 weeks`, **not** simultaneously with hiragana (`shinobi: learn both at once blurs シ/ツ, ソ/ン; week-on/week-on keeps distinct`). `tofugu` runs `katakana 1-3 mo` in parallel with kanji stockpile. | `1-2 w` |
| **3. Survival phrases + numbers** | `Week 3` `20 phrases` + `numbers 1-100` + polite `です/ます` (`jpyokoso week-by-week`). | `1 w` |
| **4. Core grammar + 500-1000 vocab** | `Week 3-4 onward` `2-3 patterns/day` (`Genki/Bunpro/Tae Kim`), vocab `10 new/day Anki` `500 by 3 mo, 1000 by 5 mo`. | `2-3 mo` |
| **5. Kanji ~100 (N5)** | `Month 2 onward`, in context of words you already know (`日/本/語/人/山/川` etc.). | `2-3 mo` overlapping |
| **6. Listening** | `Ongoing from stage 3` `10 min/day` `Comprehensible Japanese/NHK Easy` (`jpyokoso`). | Daily |
| **7. JLPT N5 ready** | `3-6 months total` `800 words + 100 kanji + ~100 grammar` `N5 7-day N5 readiness` `practice test 70%+` (`jpyokoso week 1-4 → N5`) vs `6-month 600-700 words` `thejapanshop`. | `3-6 mo` |

The critical insight (`inku` adult guide): `Phase 1 (kana) → Phase 2 (N5 vocab+grammar 3 mo) → Phase 3 N4 …` — **not** `vocab+kanji first`. `Tofugu`'s `Reading hiragana` prerequisite for typing (`IME`) + "slightly slow recall is enough" is deliberately lenient.

### 1.3 What good absolute-beginner apps add

* **Mascot/detail trust** (`adapty.io`) — Western `minimal, quick, skip` vs Japanese `dense, trust, step-by-step, manga/mascot, gradual permission, nick/avatar`. Global learners paradoxically want both (`nihonGO!` `Animal Crossing` gamified travel `+` quiz proficiency; `Obo` `FSRS v5 + AI flashcards + hiragana/katakana step-by-step + offline-first 10-min distractor)` — both scored well (`Kakimasu SUS 78/100 Good, 93% stroke demo very helpful`).
* **Writing gap re-discovered 4×:** `most apps make the assumption users are already familiar with alphabets` (`nihonGO!`) — despite being the most-requested (`grammar, reading, writing` top 3). Competitive fix: `Character introduction → Animated stroke order replay → Practice tracing → Handwriting recognition + color feedback` (`Kakimasu 5 systems`). Your `gradeShape` is the analog.
* **Immediate contextual reading:** "Every grammar ending is hiragana, every kanji reading is taught in hiragana — without it romaji teaches incorrect pronunciation" (`Kakimasu`/`jpyokoso`). `Obo One By One` solves it with `perfect for beginners: step-by-step Kana guide + immediate feedback` inside an otherwise `N5-N1 template deck` app.

---

## 2. Manobu's current absolute-beginner inventory

### 2.1 What you *do* ship — surface by surface

| Surface | Spec | Ships `file:line` | Absolute-beginner read |
|---|---|---|---|
| **Onboarding.Goals** | `SCR-02 Zp5FA` 4 cards with preview lines | `onboarding.tsx:48` `GOAL_CARDS Travel ★ Recommended / JLPT N5 in 3 mo 500 w / Anime / Work` | `Travel recommended` is the `adapty` Japanese gamified hook (`Animal Crossing`) for beginners — correct, don't move to JLPT-first. |
| **Onboarding.Placement** | `5-min adaptive, skip anytime → Start at Hiragana`, `>3s skeleton iZL4O` | `onboarding.tsx:187` `HIRAGANA_BASIC 5` `あ/い/う/え/お` `romajiFor a/i/u/e/o` `hiraganaCorrect→skipHiragana` `onSkip` | **Only 5 of 46** — seeds the bypass decision `beginner vs returning` but is not a full kana test. |
| **Onboarding.AiSetup** | 5 states `local-found / cli-missing GB+disk / byok sk-… / quota→local / offline→FAQ`, drills *never* block | `onboarding.tsx:266` | `UxPlanet Rosetta vs Duolingo` lesson: `learn-before-email/signup` — you ship Duolingo's winning pattern (`drills NEVER blocked`). Keep. |
| **Onboarding.GoalSwitchDialog** | `pfQAB  Keep 42 / Add 18 / SRS preserved` `Keep & adapt` primary | `onboarding.tsx:143` | Prevents bilingual beginners (`N4` heritage) from losing `SRS preserved` on re-goal. |
| **Dashboard** | `SCR-01 bf53D` single decision surface, `beginner` shell `ProgressRing ○0/4→●2/4` `4 steps`, `PrimaryCta Welcome — Step 1: Hiragana 15 min` else `Continue: First Words — 3/12`, `nudge 1/day max` | `dashboard.tsx:55` `STEPS Hiragana/Katakana/First Words/First Sentences` `65 computeBranch kanaMastery>=0.9→returning,0→beginner, else advanced`, `147 PrimaryCta` | Perfect for absolute beginners — **shows ONE CTA** (`2 w` Duolingo-ism vs Rosetta deep-end). |
| **DrillLab** | `SCR-03 VwCcL` kana production `280×140` canvas `ghost 1→2→3`, `Pointer Events mouse/pen/touch`, `gradeShape 40px tolerance order+direction` (`GHOST_TOLERANCE_PX=40`), `TypeFallback [Type instead]` equal-path `mastery≥90%` without drawing, `Audio [▶]` + `mic-missing` skip | `drill-lab.tsx:1/57/84/141/187/209` | **Correct engine, thin content** — `TypeFallback choices ["あ","い","う","え"]` again `4` choices, `DrillChar level N5..N1` exists but `initial.chars` seeded with only early kana. |
| **ListenType** | `SCR-04 azr1Y` ear→hand `Audio 0.8×/1×`, `Input romaji OnBlur a→あ`, `still-romaji red + shake 200ms`, `no-speaker banner pcvtp → pitch たべ˥て` identical FSRS, fallback `J-7/UUIuC` | `listen-type.tsx:86` `Audio`, `134` `Input`, `184` `Banner`, `203` `Pitch`, `219` `Next 40%` | Modern listening drill but `target jp` prop is opaque — not a pre-N5 survival audio corpus. |
| **Reader** | `SCR-05 a8uVm` graded `コンビニで` `12 sentences` N5 default, `Tap word → overlay dict Cmd+K`, `Furigana ON N5 auto-OFF N3+`, `Rōmaji OFF`, `縦書き toggle L3+`, breadcrumb polyhierarchy `Search > 食べる > (also in: Vocab N4, Kanji 食)` | `reader.tsx` (not read above but wired in `AGENTS.md`) | One N5 story; absolute beginners (`shinobi: pre-N5 short illustrated`) need **kana-only** stories before that. |
| **Lesson** | `SCR-08 C6v5So` wizard `12 min · 5 words · 2 grammar` `Present Kanji+pitch+Furigana` → `Context 私はコンビニで…` tap→overlay gloss → `Explain Source Grammar DB N4-12 [This is wrong]` → `Practice 1 leech+2 new` (`I1_MAX_NEW 2`) → `Numbers 0-100 + 一つ/二人/三枚 + Price/Time` → `RightRail Mnemonic + Save Undo 5s` | `lesson.tsx:371` `Present` `食べる/たべ˥る` + `Numbers CARDINALS+PEOPLE+FLAT`, `274 RightRail saveFsrsToast retention 0.90` | `Numbers` is **post-kana** but included early — good. Else `N4-12` is high for `pre-N5` (should be `N5-1`). |
| **Spec base corpus** | `content.db bundled ~80MB: vocab(id,jp,reading,en,level,theme), kanji, vocab_kanji, vocab_themes, grammar, sentences, FTS5`, `user.db WAL cards/due/FSRS` | `nihongoai-spec-v1.md:24 content.db` lines | Underpins drills; `sentences` empty? (`doc-2` would add `Tatoeba`). |

### 2.2 What already *protects* absolute beginners

* **Zero-knowledge walkthrough** (`docs/test-plan.md:27`, `AGENTS.md: Verification`): `Travel → skip placement → drill あ → lesson → save → review tomorrow` — must Pass with `gte elements + log()`. This **is** the absolute-beginner regression; it passes today because `あ` drills + `食べる` lesson exist, but it papers over the `92` kana char gap.
* **Branch `computeBranch`** (`dashboard.tsx:65`): `kana 0 → beginner` sees `Welcome Step 1 Hiragana` — not dumped on `First Words`. Returning `0.9+` sees `Continue: First Words — 3/12`.
* **Error pattern** copy (`what happened + why it matters + what to do`) + red `#b42318` reserved for errors + `nudge 1/day` capped + `Reset requires typed RESET` — all `CLEAR Ethical` (`spec Appendix`).

---

## 3. Gap analysis — absolute-beginner adequacy verdict

### 3.1 Already enough (do not expand)

* **Onboarding structure + Dashboard decision surface** — consensus best-practice (`adapty` detail + Duolingo fun) already fused; `Keep & adapt` `SRS preserved` is above-market.
* **SRS / Review pipeline** (`packages/srs FSRS-6 21 params + Review SCR-12 R≤pct% + snooze/vacation + leech >4`) — `thejapanshop` calls Anki habits `build the habit now` but FSRS is strictly better (`Tatoeba`). Keep the entry dosage `10-15 new/day` by seeding that count into `Due` (`DUE not due` trap `review empty first_run` copy already in `AGENTS.md`).
* **Numbers/counters/Time/Price** (`lesson.Numbers`) — internet says `Numbers 1-100, prices, quantities` is `week 3` survival critical; you ship it on lesson 1 with `一 つ/二人/三枚`. **Above** bar — don't rework.
* **Writing tolerance + equal-path fallback** (`gradeShape` `order+direction 40px` + `TypeFallback`) — aligns with `Kakimasu` `100% praised Hiragana→Katakana→Kanji progression`; demanding pixel perfection would exclude `mouse` beginners.

### 3.2 Thin — blocks first-2-week retention (fix before any EJU/JLPT expansion)

| # | Gap | Evidence | Fix (1 PR each, ≤1 day) |
|---|---|---|---|
| **G1** | Only `5` hiragana taught (`あいうえお`) — not `46` | `onboarding.tsx:192 HIRAGANA_BASIC 5` + `drill-lab.tsx:144 choices 4`; internet `1-2 w to read all 46` (`thejapanshop by W2`, `shinobi 5-7 days`) | Populate `DrillLab` gojūon `あ→ん 46` + `dakuten が ざ だ ば + yōon きゃ` as `level N5` set. Add mnemonic map `し→tsu nami, き→key` (`shinobi`). `Placement` diagnostic expands from `5` to `8` probe (`あ/い/う… + か/さ`) or keep `5` as skip heuristic but `DrillLab` spans `46`. |
| **G2** | Katakana drill missing as a first-class path | `dashboard.tsx:55 STEPS 2 Katakana (カ) — 15 min` exists as text but no `Katakana DrillLab` backing; no `カ/キ…` glyph set shipped. Internet `learn Katakana is about same as hiragana, with Shyamalanian twists` `tofugu`; neglect `blurs シ/ツ, ソ/ン`. | Add `Katakana DrillLab` reuse same `Canvas+gradeShape` with set `ア→ン` + visual cues for `シ/ツ ソ/ン` confusables (`shinobi look-alike list`). `Dashboard.PrimaryCta` branch to `Step 2 Katakana` after `Hiragana mastery≥90%` already implied by `computeBranch`. |
| **G3** | Survival phrases pack `0` vs `20` target | `lesson.tsx:371 Context 私はコンビニで 行きます。` single sentence; `reader N5 12 sentences` is authored N5, not `pre-N5 survival` (`greetings, ordering, directions, shopping`). `jpyokoso week 2: 20 survival phrases`. | Add `data/phrases.json` `20` survival (greetings/ordering/direction/shopping) as `Reader` pre-N5 stories `short illustrated + tap-to-translate` (`shinobi pre-N5`) with audio `[▶]`. Don't overload `Lesson` `N4-12`. |
| **G4** | No romaji availability guard → pronunciation drift | `listen-type.tsx:134 Input Auto-converts a→あ + still-romaji red shake` is correct **gate**; but `DrillLab` and `Lesson` still show romaji alongside kana (`DrillLab.Audio — romaji`) which `jpyokoso/shinobi/Kakimasu` say `romaji permanently caps reading speed; use only as typing tool`. | Gate romaji behind `RomajiChip OFF` (`reader.tsx` `RomajiChip OFF, auto after kana` second-line muted `9px`) pattern: surface `Romaji OFF` by default for absolute beginners, show `Type a→あ` hint only on `Input`. |

### 3.3 Missing — noticed after 3 usability studies, not 3 engineers

| # | Missing | What learners hit | Fix |
|---|---|---|---|
| **M1** | Typing hiragana/kana chart reference always-on | `Tofugu: typing IME is 1-2 days prerequisite; need to type hiragana before kanji stockpile`. Beginners need **kana chart** `all 46` on-screen, not just placement inputs. | Add `KanaChart` modal/drawer (`inkujapanese: kana chart for at-a-glance reference`) beside `DrillLab.Canvas` with `copy-on-tap` insertion into `ListenType Input`. |
| **M2** | Pronunciation shaping before kanji stockpile | `shinobi: pronunciation must accompany hiragana`; `tofugu: Basic Japanese Pronunciation Important Differences` (`ふ, ん, 小さいつ, 長音`). Absolute beginners pronounce `ん` wrong without shadowing. | Wire `TASK-21.1` `speak({speed, sid})` to `DrillLab.Audio` for each `kana`; `ListenType` speed toggle `0.8×/1×` already exists — reuse it at drill. |
| **M3** | Kanji withheld is correct; numbers already cover it | `jpyokoso: Kanji month 2 onward, in context of words you already know (一二三四五六七八九十)`; manobu's `Numbers 0-100` already teaches `一` etc. as **vocab reinforcement, not new material**. No new work — just don't accelerate `KanjiDetail` to pre-N5 (keep at `Lesson` `食べる` maturity). | Document — no code. |
| **M4** | Goal-specific bypass (JLPT vs Travel vs Conversation) | `jpyokoso decision flowchart` 4 goals shape week-3 priorities (Travel: phrases+numbers, JLPT: Genki+800 words, Conversation: italki week 2, Manga: furigana). Manobu has the `4 GOAL_CARDS` groups but queue `pickCardsWithFallback 1 leech+2 new` is uniform. | Use `GoalId` already in context to **filter queue** `travel: Tatoeba survival + numbers` vs `jlpt: JLPT N5 500` vs `anime: furigana manga` — minor `queue.ts` branch, big perceived personalization. |

---

## 4. Recommendation — what to add, in what order

### 4.1 Keep fast (this week)

* **A0 — Already enough milestone.** Mark absolute-beginner `Onboarding → Kana steps → Numbers` as `Done` in `AGENTS.md` — the spec `Checklist ✅` `17 sections` is not incomplete for beginners, it is `17 → 12 screens` intentional.
* **A1 — Full hiragana 46 + katakana 46 drill sets** (`DrillLab` content swap `5 → 46`, mnemonic map). Closes `G1/G2` with **zero new components** — reuse `Canvas+gradeShape+TypeFallback+Audio` shell. File `packages/japanese/data/kana.json` `46+46+diacritics` (licensed CC0 — e.g. Wiktionary kana) like `packages/eju/data/syllabus/*.json` pattern (`source` citation).
* **A2 — Kana chart reference** (`KanaChart` drawer `46+46` + `look-alike シ/ツ` callout `shinobi` + copy-to-input). Closes `M1` writing-gap (vs `nihonGO! chart tour overwhelming` — make it *drawer*, not tour).

### 4.2 Next sprint (pre-N5 pack)

* **A3 — Survival 20 phrases + pre-N5 Reader stories** (`data/phrases.json` 20 + `Reader Story` short illustrated `tap-to-translate`, `Obo perfect for beginners: step-by-step Kana guide + immediate feedback`). Reuses `Reader.Story/Overlay`; audio via `@manobu/speech` `TASK-21.1` (already planned).
* **A4 — TTS on every kana** (`TASK-21.1 @manobu/speech speak task tts`) wiring to `DrillLab.Audio [▶]` + `Lesson.Present pitch` per `shinobi pronunciation must accompany kana`. Completes the `10 min/day listening` habit (`inku`) without requiring new screens.

### 4.3 Defer (valuable, not beginner-blocking)

* `KanjiVG 13k` SVG (`doc-2`) for `DrillLab` ghost overlay — defer to `doc-2 P1` (visual win, not reading-blocker).
* EJU `doc-3` (`v1→Finale`) — correctly **not** for absolute beginners (JLPT `N1≈EJU Japanese 280+/400`, `N5` cannot attempt EJU). Ship after `A1/A2`.
* `Team Mode`-style `Vocab→Grammar→Kanji` parallel decomposition (`doc-1 D`) — leave for `N4+` production.

---

## 5. Risks & guardrails

* **Romaji trap:** Don't inline romaji on primary cards (`Lesson Kanji+pitch+Furigana ON` shows `食べる/たべ˥る` without `taberu` — keep that gate). Only `Input` shows `a→あ` conversion hint (`listen-type 160` already correct).
* **Skip culture clash:** Don't hard-require `Placement` quiz (`adapty.io Japanese dense onboarding` warns `Skip rarity`; Western globals expect `Skip placement` — you ship the right `Skip during placement always available, bigger tap` `nihongoai-wireframes Zp5FA`). Both cultures are satisfied by the **current** skip.
* **Approach `All four paths share same first two steps: hiragana and katakana` (`jpyokoso flowchart`)** — hence `A1/A2` must ship together, not `hiragana only`.
* **Overshadowing:** Don't let `Goal JLPT N5 in 3 months 500 words` mis-set absolute-beginner expectations (`inkujapanese: Adults reach JLPT N5 in 3-6 mo 30 min/day` is post-kana). Onboarding copy `N5 in 3 months` is `post-kana` — keep doc `Travel ★Recommended` as absolute-beginner default (`onboarding.tsx:51` already correct).

---

## 6. Verification — how to know it's enough

* **Copy + funnel gates:** `docs/test-plan.md:122 Walkthrough Travel goal → skip placement → drill あ → lesson → save → review tomorrow` **must pass with 46 drills in pool** — currently `3 users` pass on `5` drills; gate is `drill あ` (single) so `46` expansion is additive.
* **Unit:** `drill-lab.test.ts` `gradeShape GHOST_TOLERANCE_PX=40` + `TypeFallback 4-choice` extend to `46` set (no new suite).
* **Usability:** `nihonGO!` / `Kakimasu` protocol — `5-user` on `beginner shell (kanaMastery===0)` with task `read 20 W2 katakana loanwords (coffee カタカナ) without chart` — `70%+` (JapaneseExplorer `70% to proceed`) within `2 w` `45 min/day`.
* **Metrics (GSM `spec`):** `Onboarding completion >85% in <90s` must hold after `46`-set expansion (if it drops, `G1` reverted). `Lesson completion >70%` must not regress on `Gap A4` vocab doping.

---

## 7. What this doc supersedes / links to

* Supersedes nothing — it **audits** `nihongoai-spec-v1.md §SCR-01..04/08 + §Tech Foundation` (`content.db sentences` pending `doc-2` `Tatoeba`) and `onboarding.tsx` `Placement` + `dashboard STEPS` against internet absolute-beginner baseline.
* **Roadmap order:** `doc-2 P0 sqlite-vaporetto` → `this A1/A2` `46+46` kana → `doc-3 v1` EJU foundation — kana before EJU because no beginner should meet `食べる` before `あ→ん`.
* Already linked: `doc-4 JLPT mock all/N5/N4 filter + §5.1 N3..N1 fill` is **not** absolute-beginner scope (`§2.1` Gaps) — leave N3..N1 `LOCAL_GRAMMAR []` empty until kana+pre-N5 reader ships; else advance learners bypass `A1/A2` via `?filter=N4` while beginners stay on `あ→ん`.

---

## 8. References — primary sources used

* **Beginner paths / timelines:** `thejapanshop.com/blogs/news 2026-05-11 Six months zero→N5` (`Month 1-2: 46 hiragana W2 + 46 katakana W4 + 200-300 words + Anki 10-15/day`; `Month 3-4 600-700 words + 100 grammar + 70-80 kanji`; `Month 5 consolidation`; `Month 6 3-4 mocks`); `inkujapanese.com/learn-japanese 2026-04-30 Kana foundation 2 w + N5 3 mo 500-800 words @30-45 min/d → N5 3-6 mo 30 min/d, conversational 12-18 mo`; `jpyokoso.com/how-to-start 2026-04-22 7 stages 1-2 w hiragana, 1-2 w katakana, 4-8 w grammar+phrases, 2-3 mo 500-1000 words, 2-3 mo Kanji ~100, N5 ready 3-6 mo`; `shinobi-japanese.com/blog/hiragana-and-katakana 2026-05-28 92 kana, mnemonic+handwriting+SRS+immediate reading, week-on/week-on`; `tofugu.com/learn-japanese Begin hiragana reading + pronunciation + typing + kanji stockpile while katakana 1-3 mo`; `jpyokoso.com/what-to-learn-first 30-day plan 10 chars/day Week1 hiragana Week2 katakana+20 phrases Week3 grammar+numbers 1-100 Week4 5 kanji/day + reading`.
* **App design / onboarding:** `nihonGO! Animal Crossing travel gamified` + `mwm.ai Obo FSRS v5 AI flashcards Perfect for Beginners step-by-step Kana guide`; `contra.com Kakimasu writing-centric 15 participants, SUS 78/100, 100% praised Hiragana→Katakana→Kanji, 87% navigated, 93% stroke very helpful` + 5 competitor gap (writing secondary, fragmented); `adapty.io Japanese onboarding 2025-02-20 detail/trust/mascot, gradual permission, LINE login, skip rarity`; `uxplanet Roestta vs Duolingo` learn-before-email freemium.
* **Manobu:** `apps/desktop/src/components/onboarding.tsx:187` (`HIRAGANA_BASIC 5`, `Skip placement`, `AiSetup 5 states`, `GoalSwitchDialog pfQAB`), `dashboard.tsx:55` (`STEPS 4`, `65 computeBranch 0.9/0`, `147 PrimaryCta`), `drill-lab.tsx:57 gradeShape 40px, 84 Canvas, 141 TypeFallback, 187 Audio mic-missing`, `listen-type.tsx:86 Audio 0.8×/1× + Input romaji shake + Banner + Pitch`, `lesson.tsx:371 Numbers 0-100 一つ/二人/三枚`, `docs/feature/nihongoai-spec-v1.md` `SCR-01..08`, `docs/test-plan.md:27` zero-knowledge `Travel → skip → drill あ → save → review`, `doc-2`/`doc-3`/`doc-4`.
