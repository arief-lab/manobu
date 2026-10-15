---
id: doc-3
title: >-
  EJU - Examination for Japanese University Admission - research and integration
  for manobu
type: specification
created_date: '2026-09-06 04:36'
---

# EJU — Examination for Japanese University Admission for International Students — Research & Integration for manobu

> **Status:** research / specification  
> **Date:** 2026-09-06  
> **Sources:** JASSO `jasso.go.jp/en/ryugaku/eju` (Guidelines 2025/2026 PDFs, Syllabuses 2026 Physics/Chemistry/Biology/Japan and the World/Mathematics, FAQ `faq_eju/examinee.html+score.html+revision`, Past Papers `pastpaper_sample/index.html`, Publication `examinee/publish.html`, Score `score/index.html` + `outline_of_results_e_2025-2.pdf`), `studyinjapan.go.jp` EJU Guide `2024/10/eju_guide_en.pdf`, `jpcampus.net/guide/eju-subjects` 2026, `open-exam-prep.com/practice/jp-eju` 100Q bank, `japaneselanguages.com/blog/eju-past-papers`, publishers `coach-pub.jp` (Kyo Gakuen) + `ask-books.com` (Isaji Yasunari), `japanese.sng.ac.jp` (SNG prep courses), `jasso.go.jp` notice `2025/02/13/notice_on_revised_syllabuses.pdf`  
> **Manobu context:** Tauri v2 `apps/desktop` SCR-01..12, `SCR-10 jlpt-mock` (`jlpt-mock.tsx` paused timer + weak-pattern queue), FSRS (`packages/srs`, `src-tauri/src/fsrs.rs`), `@manobu/japanese` corpora (8,505 vocab N5-N1 + 595 grammar + 3,511 conjugations + 13,108 kanji + 124k pitch via `jkindrix`), `crates/jlpt-mcp` 12-tool MCP sidecar, `@manobu/speech` sherpa-onnx, `doc-1` AionUi cron/ACP/MCP + `doc-2` datasets+`sqlite-vaporetto`  
> **Companion docs:** `backlog/docs/research/doc-1` (AionUi cron/ACP/MCP), `doc-2` (JMdict complements + `sqlite-vaporetto`), `packages/japanese/data/LICENSE.md` (CC BY-SA share-alike provenance)

---

## 0. TL;DR — Should manobu add EJU and how

**Yes — EJU is the only post-JLPT step that universities actually use for admission (>900 institutions).** JLPT measures language alone; EJU measures **academic Japanese + liberal-arts or science reasoning** required to study in Japan. Adding it turns manobu from a JLPT lab into a **university-prep** app: the learner's Funnel becomes `JLPT N5→N1` (`SCR-10` mock already exists) → `EJU` (`Japanese 400+50 + Japan and the World 200 *or* Science 200 (2 of Physics/Chemistry/Biology) + Mathematics 200 (Course 1/2)`) → university screening.

**Integration is smaller than it looks:** JASSO already publishes syllabus-structured tables, past-paper PDFs (one disclosure type per year, many years `out of stock` at publishers but available at `Study in Japan Resource Facilities`), and a new 2026 syllabus (high-school `Course of Study 2018→2022` revision) that aligns exactly with high-school textbook sources. The gap vs JLPT is **content, not infrastructure**: add an `EJU` data package (`packages/eju` or `packages/japanese/data/eju/`) + 4-6 new MCP tools + a `SCR-10`-shaped mock route (`/eju-mock`) reusing the paused timer + WAL `revlog` + weak-pattern → quiz wiring + `sqlite-vaporetto` FTS5.

**Do not confuse EJU with JLPT:** JLPT `N1` ≈ `EJU Japanese 280+/400` reading+listening ; `N5` learners cannot attempt EJU. Target EJU for `N2+` learners transitioning from `Lesson/Reading` (`SCR-08/05`) to academic discourse.

---

## 1. What EJU is — hard facts from JASSO

### 1.1 Definition and who uses it

* **Full name:** Examination for Japanese University Admission for International Students (日本留学試験, `EJU = Examination for Japanese University Admission`). Run by **JASSO** (Japan Student Services Organization) Testing Division, Meguro, Tokyo.
* **Purpose:** measure `Japanese language skills (Academic Japanese)` + `basic academic abilities` required to study as an undergraduate at Japanese institutions (universities, junior colleges, graduate schools, professional training colleges, KOSEN).
* **Scale:** `>900` institutions screen applicants with EJU scores (guidelines `2025/2026`).
* **Frequency & validity:** `Twice per year` — **1st Session mid-June**, **2nd Session early-mid November** (`2025: 6/15 Sun + 11/9 Sun`). Venue in **Japan 16 regions** (Hokkaido, Miyagi, Gunma, Saitama, Chiba, Tokyo, Kanagawa, Ishikawa/Toyama/Fukui, Shizuoka, Aichi, Kyoto/Shiga, Osaka, Hyogo, Okayama/Hiroshima, Kochi, Fukuoka, Okinawa) + **outside Japan 13 regions** (Hong Kong, India New Delhi, Indonesia Jakarta+Surabaya, Malaysia KL, Mongolia Ulaanbaatar, Myanmar Yangon, Philippines Manila, Korea Seoul+Busan, Singapore, Sri Lanka Colombo, Taiwan Taipei, Thailand Bangkok+Chiang Mai, Vietnam Hanoi+HCMC). Scores **valid 2 years** → max 4 sessions simultaneously usable; universities choose which session's best score counts.
* **Eligibility / repeats:** International students aiming for undergraduate level; **no limit** on retakes or age.
* **2026 changes (guideline `2025/10/22`):** (1) score-report notification for 2nd session **1 day earlier** than 2025, (2) fee increase for Japan + Korea + Hong Kong + Mongolia, (3) **revised syllabuses for Science, Japan and the World, Mathematics** from **2026 1st Session** (see §2).

### 1.2 Subject structure — the only decision the learner makes

> FAQ `What kind of test subjects are included in EJU?` — the critical constraint: **you cannot take Science and Japan and the World in the same session** (same time slot); you may take **1–3 subjects** per session, chosen per university faculty requirements.

| # | Subject | Blocks | Duration | Scale | Language choice | University asks |
|---|---|---|---|---|---|---|
| **A** | **Japanese as a Foreign Language** (日本語) — `Academic Japanese` | **Writing** (記述, `30 min`) + **Reading Comprehension** (読解, `40 min`) + **Listening-Reading Comprehension** + **Listening Comprehension** (`≈55 min` together) | **125 min** total | **Reading+Listening 0–400** + **Writing 0–50** | **Japanese only** | **All** applicants |
| **B1** | **Science** (理科) — *choose 2 of 3* | **Physics** *or* **Chemistry** *or* **Biology** — pick **2**; booklet combines the 3 (single booklet) but only 2 are graded (choosing 1 → **not graded**) | **80 min** | **0–200** (pair total) | **Japanese or English** per university | **STEM / Medicine / Pharmacy / Engineering** |
| **B2** | **Japan and the World** (総合科目) — *Alternative to Science* | **Politics/Economy/Society (Civics) + Geography + History** cross-disciplinary, unique to EJU — not a JP high-school subject itself but assembled from them | **80 min** | **0–200** | **Japanese or English** | **Humanities / Social Sciences** |
| **C** | **Mathematics** | **Course 1 (Basic)** *or* **Course 2 (Advanced)** — booklet combines both but choice is per applicant | **80 min** | **0–200** | **Japanese or English** | **Course 1:** Liberal arts / science-light; **Course 2:** math-heavy science/engineering |

*Combined booklets:* Science (Physics+Chemistry+Biology in one), Mathematics (Course 1+2 in one) — `pastpaper_sample` notes clarify combinational booklets. Math is **fill-in-the-box (mark-sheet)**, no partial credit; speed `80 min` is the skill.

### 1.3 Scoring — not raw, except writing

* **Equating (common scale):** All subjects **except Writing** are **scaled scores** via **Item Response Theory (IRT) equating** (`jasso.go.jp/en/ryugaku/eju/about/score/index.html`). Reason: different question types per venue/timezone (`Japan vs overseas` have different `types` for equating) and per session would otherwise be unfair. Hence `average 2025-2` is reported as `Japanese total 235.4/400 (58.9%) Reading 135.4/200 (67.7%) Writing 34.3/50, Science Physics 53.7 Chemistry 51.9 Biology 64.2, Japan and the World 122.7/200 (61.4%), Math C1 98.3/200 (49.2%) C2 109.0/200 (54.5%)` (`outline_of_results_e_2025-2.pdf`) — the % are_vs perfect score on the scale, not raw.
* **Writing:** graded on a **discrete standard** `0, 10, 20, 25, 30, 35, 40, 45, 50` (`faq_eju/score.html` + `Score Rating of Writing Section`), judged on task comprehension, argument/evidence, multi-perspective review, organization, and academic sentence/vocabulary expression. The task itself: **argue one/several concepts** or **explain a specific issue's current status → predict outcome / find solution** (`syllabus/japanese.html`). This is the only non-multiple-choice part; prompts require `400字` argumentative prose.

### 1.4 Logistics — dates, fees, publication rule

* **Application:** `Japan 2025` fees `¥10,000 (1 subject) / ¥19,000 (2-3 subjects) inc. tax`; overseas fees by region e.g. `HKD 500/950`, `KRW 50,000/80,000`, `MNT 50,000`, `INR 1,300`, `IDR 110,000`, `MYR 90`, `SGD 65`, `USD 20` (Myanmar) etc. (`guidelines 2025/10/31`). Period `Japan+Outside` `2025 1st: Feb 10–Mar 6 17:00`, `2nd: Jul 7–Jul 31 17:00` — `2026` shifted fee/report date (guideline `2025/11/13`).
* **Format:** All **multiple-choice mark-sheet** except Writing essay; **answer sheet samples** + **answering method** PDFs on `pastpaper_sample/index.html`; **no official references**, no JASSO-introduced textbooks (`FAQ Q. Are references available?` — use syllabus + past questions + Japanese high-school Civics/Geography/History + Contemporary Society/Politics/Economy textbooks).
* **Disclosure rule:** **not all questions are disclosed** (score equating confidentiality + timezone variants). **Special measure:** one type per year/session `until 2023` and **only one of 2 sessions from 2024 onward** is published as `EJU Question Booklet (with CD for Listening/Listening-Reading)` sold at major Japanese bookstores (`Pearson Kirihara 2002–2010 out of stock`, `BONJINSHA 2011–2015 except 2012-2 out of stock`) and at **Study in Japan Resource Facilities + EJU Overseas Representatives + JASSO overseas offices (ID, KR, TH, VN, MY)**; overseas may `browse` not purchase. Online sample: `pastpaper_sample/pastpaper_2021_1.html` etc. (`2019-2, 2020-1` not published; Japanese+Japan and the World PDFs `in preparation` for 2018-2021 on the EN site).

---

## 2. Syllabus — what `2026 1st Session` asks (high-school Course of Study 2018→2022 revision)

> Notice `2025/02/13` (`notice_on_revised_syllabuses.pdf`): high-school Course of Study revised `2018` (enforced `2022-04`), syllabuses for Science/Math since `2015-1` and Japan and the World since `2016-1` were finally aligned in `2024-10` proposals → feedback → final `2026-1`.

### 2.1 Japanese as a Foreign Language (`syllabus/japanese.html`) — the only syllabus not revised for 2026

**Structure**

* **Comprehension (`Reading + Listening + Listening-Reading`):** three abilities tested (i) **understand details/main idea** (`details, main ideas`), (ii) **comprehend relationships** (`distinguish important part, recognize relations, compare/contrast sound/text/graphic`), (iii) **utilize information** (`draw conclusion, generalize, apply general idea to particular, infer by complementarily combining sound/text/graphic`). Sources: **explanatory text, editorial, practical document (study/campus life)** for reading; **lecture/speech, presentation/discussion (exercise/survey), consultation/instruction/advice, practical conversation** for listening; reading tasks include **visuals (graph, chart, list)**, listening-reading mixes them.
* **Writing (記述):** judge ability to **follow instructions + argue with convincing reasons**: understand the task → present argument/conclusion → support with **appropriate evidence/examples** → **multi-perspective review** → **organize effectively** → **academic sentence/vocab/expression**. Tasks: `argue one/several concepts` or `explain current status → predict outcome / find solution`.

**For manobu:** maps to `Reader (SCR-05)` (explanatory/editorial/practical docs + chart/graph reading), `Listening (SCR-04)` `0.8×/1× + pitch fallback` for Listening/Listening-Reading, `Conjugate/Roleplay` pragmatic discourse, and a new `Writing` rubric (no auto-score; AI-assisted 0–50 on JASSO discrete scale).

### 2.2 Science — pick 2 of Physics/Chemistry/Biology

Scope covers **`Basic` + `Advanced` subject of the high-school Course of Study**, plus all elementary/junior-high prerequisite included. Each `2026_syllabus_*_e.pdf` groups contents by topic titles / key terms.

#### Physics (`2026_syllabus_phy_e.pdf`) — *no deleted/new items, minor wording revision*

| Block | Topics (exam scope) |
|---|---|
| **I Mechanics** | `1. Motion and force` (position/displacement/velocity/acceleration/relative, forces `gravity/friction/normal/tension/elastic/liquid-gas`, equilibrium `resultant/resolution/couples/torque/center-of-mass`, Newton's laws `F=ma`, `static/kinetic friction, air resistance→terminal velocity`), `2. Energy and momentum` (`W, P, K, U_g/U_e`, `mechanical energy conservation`, `momentum/impulse, fission/coalescence, e elastic/inelastic collisions`), `3. Various forces/motions` (`uniform circular v/ω/T/f centripetal/centrifugal, inertial force, SHM x/v/a/ω/A/T/φ energy spring+pendulum, universal gravitation Kepler/laws U=-GMm/r`) |
| **II Thermodynamics** | `1. Heat/temperature` (`thermal motion, equilibrium, absolute temperature, heat capacity/specific heat, conservation, first law, heat engine/thermal efficiency, second law; matter states melting/boiling/latent heat/thermal expansion`), `2. Ideal gas` (`Boyle, Charles, Boyle-Charles, state eq pV=nRT, molecular motion p↔T, U monatomic/diatomic, isochoric/isobaric/isothermal/adiabatic, molar specific heat`) |
| **III Waves** | `1. Wave props` (`transverse/longitudinal, A/T/f/λ/v, sinusoidal, phase, energy, superposition/Huygens reflection/refraction/diffraction`), `2. Sound` (`v reflection/refraction/diffraction/interference/beat, string/air-column resonance, Doppler moving source/observer/both`), `3. Light` (`visible/monochromatic/polarization, reflection/refraction/total-reflection/scattering, lens/spherical mirror, Young/diffraction grating/thin-film/air-wedge interference`) |
| **IV Electricity & Magnetism** | `1. Electric field` (`Coulomb, E point charge/superposition/field lines, potential/equipotential, capacitors C/dielectrics/U=Q²/2C`), `2. Current` (`I, Ohm, ρ, Joule Q=I²Rt, P/energy, DC circuits`), `3. Magnetic field` (`pole/charge →B, lines, magnetization, μ/B, flux; straight/circular/solenoid currents; force on current / between parallels; Lorentz + Hall`), `4. EM induction/waves` (`Lenz/Faraday, motional EMF, eddy, self/mutual L/U=½LI², transformer, AC generation V/I/φ/f effective values, X_L/X_C`); includes `semiconductors p-n, diodes` in some combos |
| **V Atoms** | `1. Electrons/light` (`discharge cathode, e/m, e charge, photoelectric/photon, X-ray/Compton/Bragg, matter waves, electron interference/diffraction`), `2. Atoms/nuclei` (`nucleus, H spectrum/Bohr/energy levels, isotopes/u/atomic weight, decay/radiation/half-life, nuclear reaction E=mc², elementary particles + 4 forces`) |

#### Chemistry (`2026_syllabus_chem_e.pdf`) — *revised wording/structure + moved items*

| Block | Topics | 2026 delta |
|---|---|---|
| **I Structure of Matter** | Atomic structure, periodic table, chemical bonding (`ionic/covalent/metallic, Lewis, electronegativity, polarity`), states of matter (`gas/liquid/solid, crystal lattices, intermolecular forces`) | Reworded per Course of Study |
| **II Chemical Reactions** | `II 2. (3) Solubility product` **new**, `II 3. (1) Enthalpy` **new** ← replaces old `II 3. (1) Thermochemical equation` **deleted** | `Thermochemical equation` deleted, `solubility product + enthalpy` added (Advanced Chemistry) |
| **III Inorganic** | Elements by group (`alkali, alkaline earth, halogens, chalcogens, transition metals` etc.), properties/reactions | Reordered |
| **IV Organic** | Properties/reactions of organic compounds, polymers, biochemical substances (`alkanes/alkenes/aromatics, alcohols/esters, proteins/carbohydrates`) | Reworded |

All scope includes elementary/junior-high prerequisite.

#### Biology (`2026_syllabus_bio_e.pdf`) — *new ecosystems item*

| Block | Topics | 2026 delta |
|---|---|---|
| **IX 2. (3) Ecosystems and human activities** | **new** | Basic Biology + Advanced Biology joint |
| Other blocks | `Cell structure/function, metabolism (respiration/photosynthesis/enzymes), genetics (Mendel, DNA→RNA→protein, gene expression), evolution, plant physiology, animal physiology (homeostasis/neural/immune), ecology` | Structure/order revised to new Course of Study, no other deleted items |

### 2.3 Japan and the World (総合科目) — unique cross-disciplinary

> Original: `Civics (politics+economics) + Geography + History` high-school sources measuring **basic knowledge + material/chart reading + logical judgment** about modern/international society. No single high-school subject equals it.

| Category (2026 revised) | Content |
|---|---|
| **I Politics, Economy, Society** (restructured; `Economy` + `Contemporary Society` added, `International Society` **heading removed** and terms **redistributed** to `Contemporary Politics / Modern Economy / Contemporary Society`; no net deletions, terms reworded to Course of Study) | `Contemporary Politics` (constitution, Diet/Cabinet/courts, local autonomy, civil rights, judiciary), `Modern Economy` (market, corporations, finance, fiscal policy, international economy/trade), `Contemporary Society` (social stratification, environment, information society, international society themes now here) |
| **II Geography** | `Modern world regions` **new topic**; `Thinking geographically about modern world/contemporary issues` reworded per Course of Study; map/chart reading, resource/distribution, population/urbanization, global interdependence |
| **III History** | Two topics relabeled `Modernization and its impact` + `Two world wars and their impact` + **new** `Post-Cold War world`; some terms from `Politics/Economy/Society` reassigned here; no significant net scope change |

For manobu: the least corpus-friendly — no `JMdict` equivalent; needs its own `Japan and the World` textbook corpus (chart/graph question bank + terminology list `重要用語リスト` tri-lingual `EN/ZH/KO`, Vietnam `planned` — `ask-books.com` note).

### 2.4 Mathematics — Course 1 vs Course 2 (80 min, 0–200, fill-in mark-sheet)

> `jasso.go.jp/en/ryugaku/eju/examinee/syllabus/math.html` (`2026_syllabus_math_e.pdf`): scope from high-school `Course of Study` (elementary/junior included).

| Course | Scope | 2026 delta |
|---|---|---|
| **Course 1** (liberal-arts) | **`Mathematics I + Mathematics A`** | `Expected value (5. (2) (5))` **new** (`Mathematics A`) |
| **Course 2** (science/engineering — **includes Course 1 plus**) | **`Mathematics I, A, II, B, III, C`** | `Expected value (5. (2) (5))` + `Probability distributions (13.)` **new** (`Mathematics A` + `Mathematics I / B`) |

**Course 1 + Course 2 common (Math I/A):** `Numbers & Sets (rational/irrational, logic, sets), Quadratic functions (graph, max/min, inequalities), Figures & Measurements (triangles/circles geometry, trig sine/cosine laws), Cases & Probability (permutations, counting, basic probability)`, plus `integer properties, probability` from Math A.

**Course 2 extensions (Math II/B/III/C):** `Complex plane + complex numbers, Vectors (plane/space), Sequences (arithmetic/geometric, induction, series), Logarithms/Exponentials, Trigonometric functions (expanded), Differentiation (polynomial/trig/exp/log), Integration (area/volume, indefinite/definite), Probability distributions` — the `2026` additions close the post-`Course of Study 2022` gap.

**Exam traits:** mark-sheet numeric answers, no partial credit, `80 min` demands speed; Japanese notation differs slightly from Western (`jpcampus.net` note — memorize `Japanese math notation`).

### 2.5 Inter-subject relation / 2026 impact summary

From `2025/02/13 notice Table §2`:

| Subject | Deleted | New | Meaning |
|---|---|---|---|
| Physics | — | — | Only wording alignment |
| Chemistry | `Thermochemical equation II 3.(1)` | `Solubility product II 2.(3)` + `Enthalpy II 3. (1)` | `Ksp` and `ΔH` become examinable |
| Biology | — | `Ecosystems and human activities IX 2.(3)` | Conservation/sustainability context |
| Japan and the World | — | Structure relabel only (no content deletion) | Chart-reading + Contemporary International Society → distributed |
| Math C1 | — | `Expected value` | Basic statistics on liberal track |
| Math C2 | — | `Expected value + Probability distributions` | Full stats/probability on science track |

If manobu already has a `Math I/A` corpus, `2026` requires **adding** `expected value` drills and `Course 2`-only `probability distributions`.

---

## 3. Resources — what exists, what to license, what to build

### 3.1 Official JASSO (authoritative, free but disclosure-limited)

| Resource | Location | What you get | Limitation |
|---|---|---|---|
| **Syllabuses 2026** (PDF, per subject) | `jasso.go.jp/en/ryugaku/eju/examinee/syllabus/` (`2026_syllabus_phy/chem/bio/math_e.pdf` + prints) + `jasso.go.jp/en/ryugaku/eju/about/revision/rev_basic.html` | Exam purpose + topic lists + examples; the only **authoritative** source JASSO recommends instead of textbooks (`FAQ: no official references`) | Japanese or English (except Japanese subject); check 2026 vs pre-2026 carefully |
| **Past questions (samples)** | `jasso.go.jp/en/ryugaku/eju/examinee/pastpaper_sample/index.html` (`pastpaper_2021_1/2020_2/…`) + `jasso.go.jp/ryugaku/eju/examinee/pastpaper_sample/index.html` (JA `2011-1` … `2018-1` etc.) | One **disclosure-limited** type per session until `2023`, **only one of 2 from 2024 onward** (equating confidentiality + timezone variants). Each page bundles `Science` (3 combined) + `Mathematics` (Course 1+2 combined) + Japanese (+ `Japan and the World`) when prepared; some years (`2019-2, 2020-1` + `2018-2~2021-1 Japanese/Japan and the World`) are **not published / in preparation** on EN site | Not a full archive — do not assume every session exists online; `CD for Listening/Listening-Reading` only in booklet form |
| **Answering method + answer sheets** | Same `pastpaper_sample/index.html` + `examinee/publish.html` | Mark-sheet sample, Writing sheet, timed order (`Writing 30 → Reading 40 → Listening-Reading+Listening 55`) | Layout only |
| **Score view** | `jasso.go.jp/en/ryugaku/eju/about/score/index.html` + `faq_eju/score.html` + `outline_of_results_e_2025-2.pdf` (avg/max/min/SD) | IRT equating explanation, Writing discrete `0/10/20/25/30/35/40/45/50` rubric, 2025-2 statistics table | Scale is not raw — do not compute cutoffs as raw % |
| **Guidelines 2025/2026 PDFs** | `jasso.go.jp/en/ryugaku/eju/about/eju_guide/__icsFiles/…/2025_e…guidelines_1.pdf` + `2026_e_eju_guidelines.pdf` + `studyinjapan.go.jp/en/_mt/2024/10/eju_guide_en.pdf` | Fees, venues, dates, subject selection rule (`Science vs Japan and the World` exclusive), language option, `1 vs 2-3 subject` pricing tiers | Updated yearly; `2026` fee increase for `Japan/Korea/Hong Kong/Mongolia` + report date shift |
| **EJU Booklets (with CD)** | `jasso.go.jp/en/ryugaku/eju/examinee/publish.html` (up to `2002-1` … `2025`) via **Bonjinsha/ Pearson Kirihara** in **major Japanese bookstores** (JA section); `2002-2010` Kirihara `out of stock`, `2011-2015 except 2012-2` Bonjinsha `out of stock`; `2024` onward **only once per year** | The only **complete** paper replica with listening CDs; overseas **browse** at `Study in Japan Resource Facilities`, `EJU Overseas Representatives`, `JASSO overseas offices (ID, KR, TH, VN, MY)` — contact publisher for stock | Physical purchase required; not under open license; copyrighted — **do not redistribute PDFs** |

### 3.2 Study-in-Japan infrastructure (access point overseas)

`EJU Overseas Representatives`, `JASSO Overseas Offices`, `Study in Japan Resource Facilities` — all listed on `jasso.go.jp` + `FAQ: Are past questions available overseas?`. For manobu's offline overseas users, these are the closest **free browse** points. `Study in Japan` official site (`studyinjapan.go.jp/en/planning/examination/`) repeats the `900+ institutions + 2-year validity` framing for international audiences.

### 3.3 Commercial publishers & prep schools (where most learners actually study)

| Publisher/School | Title examples | What to license vs emulate |
|---|---|---|
| **Gyo-chi Gakuen (行知学園) `coach-pub.jp`** | `完全マスター 総合科目` (textbook from past-paper analysis), `必修単語 12000語` (10-year frequency-ranked + audio + red-sheet, `音声データで聴解対策`), **mock-series** `模擬試験問題集 日本語 記述・読解 / 数学コース2` (China, Korea editions) | `12000語` shows the **frequency-ranked vocab** pattern manobu can replicate from the `JMdict+JLPT` corpus with `Tatoeba jpn_indices` (book `12000語` is `10-year` window; manobu corpus is JLPT `N5-N1`). Do not OCR-copy; build your own ranking from `doc-2`'s `JMdict+suffix` pipeline. |
| **ASK (`ask-books.com`) Isaji Yasunari** | `EJU模試と解説 総合科目` (6 mock + detailed commentary + mark-sheet, `2022-09`, `¥2,200`, `152p+138p`), `ハイレベル総合科目 改訂第三版` (`2024-03`, `312p+128p`, `¥2,530`) — `2002-present` past-paper research, `赤字 important terms` + `ふりがな on explanations`, `重要用語リスト EN/ZH/KO (+ Vietnam planned)` free download, `赤シート` review, `chapter past Qs + 1 mock` in supplement; **updated for 2026 new syllabus** | Closest to `manobu EJU` reference structure — chapter = syllabus topic, exercise = past Q. The `EN/ZH/KO term lists` are exactly what manobu's multilingual gloss layer should mirror (`JMdict` already has `lang` tags). |
| **SNG Shinjuku Japanese Language Institute (`japanese.sng.ac.jp`)** | 5 prep courses (winter/spring/summer/autumn, `13:30-15:10 weekly`, `Intermediate+`, `Basic Math vs Advanced Math` split, **original SNG EJU textbooks**, review + exercises) | Proves `Course 1 vs Course 2` split is taught as separate tracks — UI must force the choice at enrollment (`jlpt-mock` already has `filter all/N5/N4` — reuse pattern for `EJU/Course1/Course2`). |
| **Classic math backbone cited by learners** | `チャート式 基礎から数学 I+A` (`Chart-shiki`; Mongolia testimonial in `studyinjapan.go.jp eju_guide_en.pdf`: "started by answering Chart-shiki Math 1+A") + similar `II/B/III/C` | Chart-shiki is *the* high-school math spine — licensing is heavy; alternative is to license **open derivations + create original problems** aligned to the syllabus topics, not copy Chart typesetting. |

### 3.4 Free online question banks (emulation-safe, but not official)

* `open-exam-prep.com/practice/jp-eju` — `100+ original mixed` questions (`Japanese + Physics/Chemistry/Biology + Japan and the World + Math C1/C2`) aligned to **2026** syllabi, with AI tutor, declares **not JASSO** verbatim. Good **reference for original-problem shape** (multiple-choice + fill-in math + chart-based Japan and the World); must not be assumed official. Shows demand for mixed mock.
* `japaneselanguages.com/blog/eju-past-papers` — aggregator of JASSO links + subject-wise prep guide (math `3x+7=22` sample etc.). Aggregates but doesn't host booklets — same publication-rule caveat.

### 3.5 Open data / engineering assets for building EJU in manobu

| Asset | Status | How manobu builds from it |
|---|---|---|
| `jkindrix/japanese-language-data` (`grammar/n1..n5 595` + `conjugations 3,511` + `kanji 13,108` + `pitch 124k`) already in `packages/japanese` (`CC BY-SA 4.0`) | ✅ already | Japanese syllabus text types (explanatory/editorial/practical) overlap heavily with JLPT grammar/kanji/pitch corpora — **reuse verbatim** for EJU Japanese reading/listening vocab. |
| `Tatoeba jpn_indices + sentences.tar.bz2` (`13M+`, CC BY 2.0 FR) + `Tanaka 150k` (PD/ CC BY) from `doc-2` | ✅ researched | Supplies **sentence pairs** where the textbook corpora don't; required for Japanese `listening-reading` graphic+text cross info and for `Writing` argument examples. `doc-2 §5.2` pipeline (`fetch-sentences.ts`) already designs this. |
| `KanjiVG 13k SVG` + `Kanjium+Wiktionary 136k` | ✅ researched | Japanese kanji writing (Writing legibility) + pitch for Listening; already `doc-2`. |
| `sqlite-vaporetto` (`hotchpotch/sqlite-vaporetto`, MIT OR Apache-2.0 + model BSD-3, `5.7× KyTea`, `tokenize='vaporetto tags 名詞,動詞… keep_untagged'` + `vaporetto_and/or_query`, `bm25`, `highlight`) | ✅ researched | Makes syllabus/Japan-and-the-World terminology search usable (see §4). |
| No open EJU question bank under CC0 | ❌ none | **Must author original questions** (like `open-exam-prep` but offline, syllabus-cited, JP+EN where applicable) — JASSO disclosure is intentionally partial and copyrighted; books are paywalled. |
| `JASSO syllabuses PDFs` (new 2026) | ✅ free official | The only **authoritative** syllabus source; commit them under `packages/eju/data/syllabus/` (copyright attribute, no redistribution beyond fair citation of topic headings). Quote topics, don't inline full prose. |

---

## 4. App design — how EJU fits manobu's architecture

### 4.1 Where not to duplicate, what to add

```
JLPT today (SCR-01..12, doc-2)
  N5→N1 vocab/grammar/kanji/pitch + Reader + Listening + Mock (jlpt-mock.tsx) + Review (FSRS)

EJU new (post-JLPT)
  Bachelor-track: Japanese (Academic, 400+50) + (Japan and the World 200 | Science 2×100) + Mathematics 200 (C1/C2)
  Reuses: mock timer+queue, review FSRS, speech (listening), Tatoeba sentences, grammar corpora
  Adds:  science/math/japan-and-world  +  writing rubric  +  EJU-syllabus tagging
```

**File placement (mirrors `packages/japanese` pattern, per `AGENTS.md` child-ownership rule):**

```
packages/eju/                         # new shared workspace (like packages/japanese)
  AGENTS.md                           # Domain doc (screams "EJU", not "science")
  package.json  exports {"./data/*": "./data/*"}
  data/
    syllabus/physics.json             # derived from 2026_syllabus_phy_e.pdf  (topic tree, citation)
    syllabus/chemistry.json
    syllabus/biology.json
    syllabus/japan-and-world.json     # I/II/III categories
    syllabus/mathematics-c1.json
    syllabus/mathematics-c2.json
    syllabus/japanese.json            # writing + reading/listening abilities + text types
    questions/                        # authored original questions (not JASSO copies) — see §4.3
      japanese/
      science/physics/ | chemistry/ | biology/
      japan-and-world/
      mathematics/c1/ | c2/
    vocab/eju-12000.json              # optional 10-year frequency ranking (derived, CC BY-SA, not OCR of Gyo-chi book)
    LICENSE.md                        # provenance: JASSO syllabuses (citation only) + authored questions (manobu CC BY-SA)
  scripts/
    fetch-syllabus.ts                 # pins 2026 PDFs, extracts topic headings (no prose copy), writes syllabus/*.json
    generate-vocab.ts                 # from JMdict+suffix/tatoeba jpn_indices — analogous to fetch-vocab.ts:185 buildSurfaceIndex
  src/types.ts                        # EjuLevel? actually subject enums: Japanese | SciencePhysics | …

crates/jlpt-mcp/                      # keep jlpt-vocab identity; EJU questions live in a second sidecar OR same crate under new tools
  crates/eju-mcp/  (option A)         # preferred: standalone binary ~3 MB (AionUi pattern: many servers {stdio} → many agents)
  # or add to jlpt-mcp as 6 new tools (lighter): lookup_eju_syllabus, search_eju_questions, list_eju_by_subject …

packages/db/src/schema/content.ts    # add eju_syllabus + eju_questions + eju_questions_fts (vaporetto)  +  eju_attempts in src/schema/user.ts (WAL)
apps/desktop/src/components/
  eju/  (Vercel Object.assign)        # <Eju><Eju.Japan><Eju.JapanWriting><Eju.Science><Eju.JapanWorld><Eju.Math><Eju.Timer><Eju.Score><Eju.WritingRubric>
  eju-mock.tsx                        # <EjuMock> — clone jlpt-mock.tsx: Timer real+pausable, Progress Q {n}/{total}, Choices fieldset, Next opacity-40, Score + weak patterns, Plan scaffold, SubmitFail [Retry] with WAL note
apps/desktop/src/routes/eju-mock.tsx + eju-mock.lazy.tsx  # validateSearch (subject, course), loader ensureQueryData(ejuMockQueryOptions), pending/error/notFound + useSearch filter select (Science physics/chemistry/biology pick 2 vs Japan and the World exclusive; Math course switch)
apps/desktop/src/lib/
  eju.ts                              # score helpers: scaledScore(raw,equateTable?) + writingDiscreteGrade + formatTimer reuse
```

*The `EJU vs JLPT` routing rule (`Science vs Japan and the World` exclusive per session) becomes `validateSearch` Zod refinement `refine(data => !(data.science && data.japanWorld), exclusive)` + UI mutual-exclusion pills.*

### 4.2 UI — per-subject surfaces reusing SCR compounds

| EJU subject | Reuse SCR | What changes |
|---|---|---|
| **Japanese** | `ListenType` `0.8×/1×` + `Pitch たべ˥る` fallback (`listen-type.tsx:86`), `Reader` `Story/Overlay/Breadcrumb` (`reader.tsx:205`) for reading, `KanjiDetail.Hero` for writing kanji legibility | Add **Writing** `Eju.JapanWriting` — prompt (`argue concept` or `explain status→predict`) + `400字` textarea (char counter, not furigana), scored **manually** via JASSO discrete `45/40/35…` levels + Teacher AI `SenseiTip` fieldset `[This is wrong]` (mirrors `Lesson.Explain` / `KanjiDetail.SenseiTip`) generating diagnostic, not score. Reading/Listening sources reuse `Tatoeba` sentences (doc-2) typed as explanatory/editorial/practical + chart/graph pre-rendered SVG. |
| **Science** (pick 2) | `jlpt-mock` timer+choices + `question/state` FSRS-like queue | Each question carries `topicPath` (e.g. `Physics I Mechanics 1.(2) Various forces F=…`) so `deriveWeakPatterns` already extracts weak syllabus nodes; `buildWeakPatternQueue` maps back to drill. Add `English/Japanese` cryostat toggle per `Examination Language Option` (A Japanese vs EJU English); physics diagrams as SVG. |
| **Japan and the World** | Same `jlpt-mock` shell, but prompt type is **material/chart reading + logical judgment** (not vocab) | Use JASSO-style chart/table material; UI adds `MaterialPanel` (graph/choropleth/timeline) beside `Choices`; `重重要用語リスト` auto-links to `JMdict` term overlay. |
| **Mathematics** | New `Eju.Math` — `fill-in` numeric `input type=number` (no choices), `form.Field` `z.coerce.number` (`@tanstack/react-form` + `form-options.ts`) | `Course 1 vs Course 2` toggle filters syllabus (`Mathematics I/A` vs `I/A/II/B/III/C`) and adds `Probability distributions` etc. only on Course 2; `Expected value` shared (doc-2.sqlite pattern). Show Japanese notation variants where ambiguous (`jpcampus.net` note). |

### 4.3 Authoring questions — how to avoid JASSO copyright while being syllabus-faithful

* **Never OCR or redistribute JASSO booklets.** They are `Copyright, not disclosed, one type per year` and publishers' sets are `out of stock` but copyrighted. Treat JASSO PDFs like Adobe's spec: **cite topic headings, don't copy prose**.
* **Author original questions** with the same **topic granularity** as `2026_syllabus_*_e.pdf` (e.g. `Physics I Mechanics 1.(2) Various forces → normal force on an inclined plane with static friction` + `Chemistry II 2.(3) Solubility product Ksp` + `Math C2 13 Probability distributions`). Pattern is `ASK 6 mocks` (`exhaust 2002-present past papers`) and `open-exam-prep 100 original` — originality + syllabus citation is defensible.
* Store each question as `{ id, subject, block, topic, course, sourceSyllabus: "2026_physics I Mechanics 1.(2)", prompt: {en, ja}, diagramSvg?, choices: string[4?] | fillIn, answerIndex|answerNumeric, explanation: {en, ja}, tags: ["graph-reading"], source:"authored"}` — commit under `packages/eju/data/questions/` and embed gzipped into `eju-mcp` like `crates/jlpt-mcp/build.rs`.
* **Audio for Japanese Listening:** generate via `@manobu/speech` `speech_tts` (sherpa-onnx Piper Kokoro) from the authored script — keeps offline, avoids JASSO CD redistribution.

### 4.4 Scoring inside the app

* **Japanese Reading+Listening:** report `0–400` internally as **raw on authored questions**, document that official JASSO is scaled. Optionally calibrate locally (IRT stub: 2-param logistic per item difficulty) or just report raw + `percentile vs last mock` (“official would be scaled”).
* **Writing:** do **not** auto-score — expose the JASSO `0/10/20/25/30/35/40/45/50` rubric as a checklist + Teacher AI draft critique (grammar/organization/evidence). Score is `self-grade + Sensei hint`, consistent with `KanjiDetail`/`Lesson` `flagged` UX.
* **Science/Math/Japan and the World (`0–200`):** for mock use **raw / scaled-equivalent display** (`55→200` linear is misleading — show raw + `scaled approx via equating table` if available, else raw + `avg 2025-2` benchmark table from `outline_of_results_e_2025-2.pdf` §1.4).

### 4.5 FTS5 + MCP — why `doc-2`'s `sqlite-vaporetto` is prerequisite

All EJU subjects are **terminology-heavy**: `日本国憲法, 需給曲線,  solubility product, 等差数列, 正弦定理`. Default `unicode61` splits them poorly; Japanese `複合語` needs word-aware segmentation. Apply the `doc-2 §5.1` switch:

```sql
CREATE VIRTUAL TABLE eju_questions_fts USING fts5(
  prompt_ja, prompt_en, explanation, topic,
  tokenize='vaporetto tags 名詞,動詞,形容詞 keep_untagged'
);
-- query
SELECT *, bm25(eju_questions_fts) AS rank
FROM eju_questions_fts
WHERE eju_questions_fts MATCH vaporetto_or_query('溶解度積 期待値')
ORDER BY rank LIMIT 20;  -- finds new 2026 Chemistry/Math items
SELECT highlight(eju_questions_fts, 0, '[', ']') WHERE …;
```

Helpers `vaporetto_and_query` (all tokens `AND`) for strict syllabus-point lookup, `vaporetto_or_query+bm25` for broad candidate before ranking, `vaporetto_split` debug — same as `doc-2`'s `docs|sentences_fts`.

MCP tools (extend or new crate, 6-8 tools — mirror `src/main.rs:81` 12-tool pattern):

```
lookup_eju_syllabus(subject)          — topic tree for a subject
search_eju_syllabus(query,limit)      — substring over topic headings
lookup_eju_question(id)
search_eju_questions(query,subject?,course?,limit) — FTS5 + filter (Course 1 excludes III/C items)
list_eju_by_subject(subject,course?)
random_eju_question(subject,course?)  — mock builder
grade_eju_writing(draft)              — returns rubric checklist (not a score)
```

---

## 5. Resources — consolidated, citation-ready for `packages/eju/data/LICENSE.md`

### 5.1 Official (authoritative, free, non-redistributable beyond fair citation)

* **Syllabuses (2026 prints):** `jasso.go.jp/en/ryugaku/eju/examinee/syllabus/index.html` → `2026_syllabus_phy_e.pdf`, `_chem_e.pdf`, `_bio_e.pdf`, `syllabus/japanese.html`, `Notice 2025/02/13` `rev_basic.html` + `notice_on_revised_syllabuses.pdf` `2026 1st Session`. Anchor every `packages/eju/data/syllabus/*.json` entry with `source: "JASSO 2026_syllabus_phy_e.pdf I Mechanics 1.(2)"`.
* **Guidelines 2025/2026:** `eju_guide/__icsFiles/…/2025_e_eju_guidelines_1.pdf` (fields still current) + `2026_e_eju_guidelines.pdf` (`jasso.go.jp/ryugaku/eju/about/eju_guide/…`) — confirms `1-3 subjects/session`, fee tiers, dates/venues, language option, mark-sheet format, exclusive `Science vs Japan and the World`, validity 2 yrs.
* **Score:** `score/index.html` (IRT equating explanation) + `faq_eju/score.html` (Writing discrete `0/10…50`, equating theory) + `outline_of_results_e_2025-2.pdf` (2025-2 averages table for benchmarking).
* **Publication/past-paper rule:** `examinee/publish.html` (all sessions `2002–2025`, once/year from 2024) + `pastpaper_sample/index.html` / `pastpaper_2021_1.html` (partial online, `2019-2/2020-1` not published, some `in preparation`, combined booklets for Science/Math).

### 5.2 Study-in-Japan infrastructure (where overseas learners actually access booklets without purchase)

`EJU Overseas Representatives`, `JASSO overseas offices (Indonesia, Korea, Thailand, Vietnam, Malaysia)`, `Study in Japan Resource Facilities` (same list on every `publish.html`). Useful for `manobu` learner tip: "Browse locally, don't pay overseas shipping."

### 5.3 Commercial references (do not copy, emulate structure)

* **行知学園 (Gyo-chi Gakuen) `coach-pub.jp`:** `完全マスター 総合科目` (textbook from past-paper analysis) + `必修単語 12000語` (10-year frequency ranking, `週単位` goal partitions, `中国語対訳` on key entries, `音声データ` download, red-sheet) + **mock series** `模擬試験問題集 日本語 / 数学コース2` (+ China/Korea editions). Pattern to clone legally: `10-year frequency ranking` from manobu's own `JMdict+JLPT` corpus — **author your own 12000 list**, don't OCR.
* **ASK / 伊佐治康成 (`ask-books.com`):** `模試と解説 総合科目 (2022-09, ¥2,200, 152p+138p解説, 6 mocks + mark-sheet)` + `ハイレベル 総合科目 改訂第三版 (2024-03, ¥2,530, 312p+128p, 2002-present analysis, 赤字重要語, 漢字にふりがな on explanations, EN/ZH/KO `重要用語リスト` download, 赤シート, 別冊演習+1 mock)` — **updated for 2026 syllabus**. Models chapter = syllabus topic + exercise = past Q; terminology list download is free (respect that).
* **SNG Shinjuku Japanese Language Institute (`japanese.sng.ac.jp`):** `5` prep tracks (`13:30-15:10 weekly, Intermediate+, Basic Math vs Advanced Math` split, **original SNG textbooks**). Validates the Course 1/2 split as two tracks in UI.
* **Math spine:** `チャート式 基礎から数学 I+A` (Chart-shiki, cited by a Mongolia top-scorer in `studyinjapan.go.jp eju_guide_en.pdf`) — ubiquitous high-school reference; licensing is publisher-heavy, so `manobu` should author original math items per syllabus topic rather than adapt Chart typesetting.

### 5.4 Free online banks (shape reference, not source to scrape)

* `open-exam-prep.com/practice/jp-eju` — `100+ original mixed` across all subjects, **2026**-aligned, not JASSO verbatim, with explanation + AI tutor — useful **shape** (multiple-choice with chart material, fill-in math, listening stub) but not authoritative.
* `japaneselanguages.com/blog/eju-past-papers` — aggregator of JASSO links — **use JASSO directly**.

### 5.5 Open data for building EJU features (engineering path, mirrors `doc-2`)

| Already available | Gap for EJU |
|---|---|
| `jkindrix/japanese-language-data` 595 grammar + 3,511 conjugations + 13,108 kanji + 124k pitch (CC BY-SA 4.0) — covers Japanese | **Japan and the World needs a new curated corpus** (no JMdict equivalent; build `総合科目` term list — chart/table corpus). **Science/Math definitions** need a parallel `STEM` glossary (not in JMdict's liberal-arts bias). |
| `doc-2` Tatoeba/Tanaka + KanjiVG + Kanjium+Wiktionary + `sqlite-vaporetto` | Extend `vaporetto` FTS5 to `eju_questions_fts` + `eju_syllabus_fts`; reuse `buildSurfaceIndex` / `coarsePos` for syllabus term extraction. |
| No CC0 EJU question bank exists | **Author original questions** (like `open-exam-prep` but offline, syllabus-cited, JP+EN where needed). |

---

## 6. Manobu roadmap — v1 → v2 → v3 → Finale

> **Why not `v1` only.** EJU covers **5 domains** (Japanese, Japan and the World *or* 2×Science, Math C1/C2) across **6 new syllabuses** (`2026` prints). A single `v1` would either ship only language (and look like JLPT re-skin) or half-bake science/math without the data package, FTS5, or writing rubric that JASSO grades separately. Order below respects that EJU presupposes **written/listening + basic science/math literacy already in the app**, and isolates **copyright (authored questions) + binary size (`crates/AGENTS.md` `~5 MB`) + `doc-2` `sqlite-vaporetto`** risks to the PR that introduces them.

### v1 — Foundation (syllabus + 1 mock + schema) — *gates everything*

**Goal:** Prove the data package contract and ship one runnable mock clone (`jlpt-mock.tsx`) without committing to 500 authored questions.

* `packages/eju` `data/syllabus/*.json` derived from **2026** PDFs (topic trees `source: "JASSO 2026_syllabus_phy_e.pdf I Mechanics 1.(2)"`, `Japanese` text-type lists, `Japan and the World` `I/II/III` restructure, `Math C1/C2` blocks, `Science` 2026 deltas `Ksp/Enthalpy/Ecosystems+human`) + `_meta.json` (`revision date 2025/02/13`, PDF sha), `AGENTS.md` (screams `EJU`), `package.json` `exports {"./data/*": "./data/*"}`, `src/types.ts` (`EjuSubject`, `EjuCourse`), `scripts/fetch-syllabus.ts` pin. Cite, don't copy prose. `LICENSE.md` separate from `packages/japanese/data/LICENSE.md`.
* DB: `eju_syllabus` view (not FTS) + `eju_questions` + `eju_questions_fts` (`CREATE VIRTUAL TABLE … tokenize='vaporetto tags 名詞,動詞,形容詞 keep_untagged'` — `doc-2 §5.1`, `load_extension` fallback in `packages/db/src/index.ts:33`) + `revlog`→`cards` WAL reuse for attempts. `test/fts5-perf.test.ts` extended with `eju_questions_fts` `30k`-seed `<100 ms` assertion.
* MCP: **or** new `crates/eju-mcp` sidecar (preferred `stdio` `eju:stdio:<bin>` alongside `jlpt-vocab` per `doc-1 §5.2.3 C1` `mcp-servers.json` fan-out) **or** 3 tools added to `crates/jlpt-mcp/src/main.rs:81` (`lookup_eju_syllabus`, `search_eju_syllabus`, `list_eju_by_subject`). Keep `12→15` tools under `~5 MB`.
* Route: `apps/desktop/src/routes/eju-mock.tsx` (+ `.lazy.tsx`) reusing `jlpt-mock.tsx` shell — `validateSearch({subject: Japanese|JapanWorld|Science, sciencePick2?: [Physics,Chemistry,Biology] length 2, mathCourse?: C1|C2})` with `Zod.refine(exclusive)` for `Science vs Japan and the World`, `loader ensureQueryData(ejuMockQueryOptions)`, `pending/error/notFound`, `Timer` pausable `⏱ {mm}:{ss}`, `Progress Q {n}/{total}` + `Choices` fieldset + `Next` disabled `opacity-40` + `Score {pct}%` + `weak patterns → Plan` scaffold + `SubmitFail [Retry]` WAL note.

**v1 acceptance:** syllabus JSON `2026`-accurate with `source` per topic; one seeded mock per subject family (≥10 Japanese + ≥10 Science + ≥10 Math C1) passes `cargo test` + `bun run check-types`; route renders with `Science vs Japan and the World` mutual exclusion enforced.

### v2 — Mathematics + Science complete (the `STEM` track)

**Goal:** Unblock STEM faculties (the `Science (2×)` + `Math C2` applicants) — the hardest content but already spec'd.

* **Mathematics:** Course 1 (`Math I/A`) **and** Course 2 (`I/A/II/B/III/C`) as separate corpora. Course 1 unlocks liberal-arts track immediately (`P0` smallest delta vs Chart-shiki); Course 2 adds `vectors, complex plane, sequences, logs/trig expanded, calculus, probability distributions` (including `2026` `Expected value` `Math A` + `Probability distributions 13.` for C2). Add `Eju.Math` component `fill-in` numeric `input type=number` `form.Field z.coerce.number` (`@tanstack/react-form` `form-options.ts` pattern), `Course 1 vs 2` toggle filters syllabus, Japanese notation variants where ambiguous (`jpcampus.net` note).
* **Science pick-2:** Physics (Mechanics/Thermo/Waves/E&M/Atoms full `2026` table), Chemistry (Structure, `Ksp/Enthalpy`, Inorganic, Organic), Biology (+ `Ecosystems and human activities IX 2.(3)`). Each question carries `topicPath` (`Physics I Mechanics 1.(2) Various forces F=…`) so `engine.rs:deriveWeakPatterns`-style extraction yields weak syllabus nodes; `buildWeakPatternQueue` maps back to drills. `English/Japanese` language toggle per `Guidelines`.
* **Cross-cutting:** `Japanese` vocabulary for science texts reused from `jkindrix` + `Tatoeba jpn_indices`; term overlays (`重要用語リスト EN/ZH/KO`) via `JMdict` `lang` tags; diagrams as SVG; `vaporetto` FTS5 crucial here (`溶解度積`, `等差数列`) — do not ship Science without `doc-2 P0`.

**v2 acceptance:** ≥80 authored math items (40 `C1` + 40 `C2` with `Expected value` + 20 `Probability distributions` C2-only), ≥60 Science items spanning each `2026` block (incl. new `Ksp/Enthalpy/Ecosystems`), `validateSearch` enforces `choose exactly 2 of Physics/Chemistry/Biology` and rejects `pick-1 → not graded`, `eju_questions_fts` handles `溶解度積` via `vaporetto_and_query` + `bm25`, `open-exam-prep` shape not copied.

### v3 — Japanese + Japan and the World complete (the `Liberal-arts` track)

**Goal:** Ship the other half — `Academic Japanese` + the EJU-unique `Japan and the World` chart-reading subject.

* **Japanese:** Reuse `Reader (SCR-05)` explanatory/editorial/practical docs + chart/graph SVGs, `ListenType (SCR-04)` `0.8×/1× + Pitch たべ˥る` fallback, `KanjiDetail.Hero` kanji legibility, and new `Eju.JapanWriting` — prompt (`argue concept` or `explain status→predict`) + `400字` textarea char counter, **self-grade checklist** `0/10/20/25/30/35/40/45/50` (JASSO discrete ladder) + Teacher AI `SenseiTip` fieldset `[This is wrong]` (`Lesson.Explain` / `KanjiDetail.SenseiTip`, `aria-live=polite`) generating diagnostic, never auto-score (Writing is human-graded; LLM scoring diverges from equating).
* **Japan and the World:** The least corpus-friendly domain — no `JMdict` equivalent. Add `MaterialPanel` (graph/choropleth/timeline/table) beside `Choices`; term-linkoverlay reuses `ハイレベル 改訂第三版` `重要用語リスト EN/ZH/KO (+ Vietnam planned)` model but over a **new curated `総合科目 term list`** (chart corpus). Topics `I Contemporary Politics / Modern Economy / Contemporary Society (International Society redistributed) II Geography (Modern regions new) III History (Post-Cold War new)` all covered.
* **Review integration:** `weak syllabus patterns → Plan` (`mock.ts:deriveWeakPatterns` clone) + `filterNextCardsByWeakPatterns` → `next-cards.ts/queue.ts` so EJU weak topics refill Lesson queues; FSRS `previewIntervals 1d/4d/12d/28d` unchanged (`packages/srs`).

**v3 acceptance:** Japanese: reading `explanatory/editorial/practical (chart)` × 20 + listening `lecture/presentation/consultation` `0.8×/1×` × 15 + listening-reading × 10 + writing prompts × 10 with rubric checklist; Japan and the World: `I/II/III` chart/table items × 40 covering `Modern regions` + `Post-Cold War`; all items carry `materialSvg?` and `sourceSyllabus` citation; `[This is wrong]` flag toggles without throw.

### Finale — EJU 12000 Vocab + Full Mock + Production hardening

**Goal:** Close the loop — every learner weakness surfaces in Review FSRS and Teacher AI, and no JASSO copyright survives to ship.

* **EJU 12000 Vocab:** Own `data/vocab/eju-12000.json` frequency-ranked from `JMdict` 10-year window + syllabus `重要用語` (not OCR of Gyo-chi `必修単語12000語`), with `audio` via `@manobu/speech` `speech_tts` Piper Kokoro + `red-sheet` partitioned weekly goals (`週単位`) + `中国語対訳` on key entries via `JMdict gloss lang`. Push into FSRS `batchNext(20)` + `tauri-queries.ts:networkMode offlineFirst`.
* **Full mock sessions:** At least **6 authored sessions** (`~200 Q × 1 KB → ~200 KB → gzipped ~40 KB`) mixing all subjects per JASSO session combinatorics (`1–3 subjects/session`, `Science vs Japan and the World` exclusive). Keep gzipped in sidecar (`crates/eju-mcp/build.rs include_bytes!→flate2`) or lazy `app_data_dir/eju/questions.jsonl` (size tradeoff per `doc-2` `sentences.db` pattern). `Timer` × `Session` (120 + 80 + 80 min simulated; student may run `mockSession` chunked), `Score` reports `raw + scaled-approx + vs 2025-2 avg` table (never raw-as-scaled, writing labeled discrete).
* **Teacher AI grounding:** instruct `packages/agent` Coach (via `apps/server/src/sensei-prompt.ts`) to **prefer** `search_eju_questions` + `search_examples` (`doc-2` Tatoeba) over hallucination, cite `source: JASSO topic + Tatoeba #id` (same citation discipline as `Lesson.Explain Source: Grammar DB N4-12`).
* **Hygiene:** `LICENSE.md` pinned `SOURCE_PDF_sha` + SPDX per file (citation-only syllabus headings vs `CC BY-SA` derived vocab), `_meta.json` `syllabus outdated` warning, `Audio` via sherpa-onnx not JASSO CD redistribution, `ACP_MCP_SERVERS=eju:stdio:<bin>` alongside `jlpt-vocab` (`doc-1 C3` registry publish `npx @manobu/eju-mcp`), `crates/eju-mcp` `opt-level="z" lto strip` `~5 MB` (`crates/AGENTS.md`), `cargo test` + `parity.rs` golden + `bun run check-types/check` + `bun --filter @manobu/db test` `fts5-perf <100 ms`.

**Finale acceptance:** from a cold install `bun run dev` → `/eju-mock` → pick `Science (Physics+Chemistry)` + `Math C2` → timed mock → `Score` → weak topics `Plan` → `Review FSRS` populated → `Teacher Agent` cites syllabus topics — end-to-end offline, no network, no JASSO PDF committed, `backlog/docs/research/doc-2` + `doc-1 §5.2.5` ordering respected.

Each version is self-contained: `syllabus/*.json` diff + `build.rs/types.rs/golden.json` sync (if crate) + `db:push` FTS5 migration + `cargo test` + `bun run check`/`test`.

---

## 7. Risks & contracts

* **Copyright boundary:** `Booklets/past-paper PDFs` are **JASSO-publisher copyrighted, disclosure-limited** (`one type per year until 2023, one of 2 from 2024`). **Do not commit them.** Author original questions; cite JASSO syllabus topic paths as `source` strings. Keep `packages/eju/data/LICENSE.md` with every `SOURCE_PDF_sha` + SPDX distinct from `packages/japanese/data/LICENSE.md` (`CC BY-SA` for derived EJU vocab/gloss vs `citation-only` for syllabus headings).
* **Scale-vs-syllabus fidelity:** Syllabuses say `elementary/junior-high prerequisite included` — original questions must assume those foundations; don't scope EJU Math to only `Math I/A`.
* **Scaled vs raw disclosure:** never present app mock `235/400` as "JASSO score" without noting `scaled (`score/index.html` IRT) vs raw` and that writing is discrete `0–50`. Mimic `outline_of_results_e_2025-2.pdf` table with both `raw` and `avg%` context.
* **2026 syllabus currency:** future high-school revisions will move topics again — `fetch-syllabus.ts` must pin the **PDF revision date** (`2025/02/13 notice` + `2026_syllabus_*_e.pdf` prints) and record it in `data/syllabus/_meta.json` so the app can warn `syllabus outdated`.
* **Language option fidelity:** do not auto-translate Japanese `Japan and the World`/`Science` questions to English — JASSO's English phrasing differs by university; store both `prompt_ja` + `prompt_en` authored separately.
* **Size:** syllabus JSON is `~100 KB`; `6` authored mock sessions `~200 Q × 1 KB → ~200 KB` raw → gzipped `~40 KB`. Keep authored questions gzipped in the sidecar (`build.rs` `include_bytes! → flate2`) or in sibling `app_data_dir/eju/questions.jsonl` — same choice as `doc-2` sentences (`sentences.db` lazy-load vs embedded).
* **Binary size discipline:** `crates/AGENTS.md` `opt-level="z" lto strip` still applies — EJU sidecar `crates/eju-mcp` should mirror `jlpt-mcp` `~5 MB` profile; do not bloat the `jlpt-mcp` binary by merging all EJU data there if it crosses `10 MB`.

---

## 8. Acceptance — per version (checklists)

### v1 — Foundation

* **`packages/eju`** `data/syllabus/*.json` `2026`-accurate (Japanese + Science PT/Chem/Bio + Japan and the World I/II/III + Math C1/C2) with `source` citation per topic + `_meta.json` (`revision 2025/02/13`).
* **DB** `eju_questions` + `eju_questions_fts` (`vaporetto tags 名詞,動詞,形容詞 keep_untagged`) + `revlog`→`cards` WAL path for attempts.
* **Route** `apps/desktop/src/routes/eju-mock.tsx` (+ `.lazy.tsx`) clone of `jlpt-mock.tsx` — `validateSearch({subject, course, sciencePick2?})` (`Science vs Japan and the World` mutual exclusion, `Science` `pick exactly 2`), pausable `Timer ⏱ {mm}:{ss}`, mark-sheet `Choices` fieldset, `Next` disabled `opacity-40`, `Score {pct}%` + weak topics → plan scaffold, `SubmitFail [Retry]` WAL note.
* **Seed content** `≥30` authored questions covering each family (≥10 Japanese, ≥10 Science, ≥10 Math C1) `source: "JASSO 2026_…"` citation + MCP `lookup_eju_syllabus + search_eju_syllabus + list_eju_by_subject` (or `crates/eju-mcp` `eju:stdio:<bin>`).
* **Verification:** `cargo test` + `bun run check-types` + `bun --filter @manobu/db test` (`fts5-perf <100 ms`), `Science` pick-1 correctly refuses grading.

### v2 — Mathematics + Science

* **Mathematics** `C1 (Math I/A)` + `C2 (I/A/II/B/III/C)` corpora: ≥80 items (`40 C1 + 40 C2`, incl. `20 C2`-only `Probability distributions 13.` + `Expected value` `Math A` on both), `Eju.Math` fill-in numeric input (`@tanstack/react-form` `z.coerce.number`), `C1↔C2` toggle filters incompliants.
* **Science pick-2:** ≥60 items spanning each `2026` block incl. **new** `Ksp (Chem II 2.(3))` + `Enthalpy (II 3.(1))` + `Ecosystems and human activities (Bio IX 2.(3))`; each with `topicPath` for weak-pattern extraction; `JP/EN` toggle respected.
* **FTS5:** `溶解度積/等差数列` etc. HITs via `vaporetto_and_query + bm25`; no chart dependency yet.

### v3 — Japanese + Japan and the World

* **Japanese:** reading ×20 (explanatory/editorial/practical+chart), listening ×15 (`0.8×/1×` + `Pitch` fallback), listening-reading ×10, writing prompts ×10; `400字` textarea + discrete `0/10/20/25/30/35/40/45/50` checklist + `[This is wrong]` `aria-live=polite` flag; audio script via `@manobu/speech` `speech_tts`.
* **Japan and the World:** `I/II/III` chart/table items ×40 incl. **new** `Modern regions of the world` + `Post-Cold War world`; `MaterialPanel` (graph/choropleth/timeline) + term overlay `重要用語リスト` tri-lingual linkage.
* **Review:** weak syllabus patterns → `buildWeakPatternQueue` → `next-cards.ts/queue.ts` feeding Lesson Review; `weakPattern` derived per `2026` restructured headings (`Contemporary Politics/Modern Economy…`).

### Finale — 12000 Vocab + Full Mock + Hardening

* **`data/vocab/eju-12000.json`** frequency-ranked from `JMdict` 10-year window + syllabus terms (authored, not OCR of `coach-pub.jp` book) + `audio` (Piper Kokoro) + weekly `週単位` goal partitions; into FSRS `batchNext(20)` `offlineFirst`.
* **≥6 full mock sessions** (`~200 Q → gz `~40 KB`) covering every `1–3 subjects/session` combo with `Science vs Japan and the World` exclusion; `Score` reports `raw + scaled approx + vs 2025-2 avg` table (discrete Writing labeled); `6` sessions persist gzipped via `crates/eju-mcp/build.rs` or `app_data_dir/eju/questions.jsonl`.
* **Teacher AI:** prefers `search_eju_questions + search_examples` (`doc-2`) with citations (`JASSO topic + Tatoeba #id`); `MCP` full set `lookup_eju_question, search_eju_questions, random_eju_question, grade_eju_writing (checklist)`; `ACP_MCP_SERVERS=eju:stdio:<bin>` alongside `jlpt-vocab`.
* **Hardening:** `LICENSE.md` `SOURCE_PDF_sha` + SPDX per file (citation-only vs `CC BY-SA` derived), `_meta.json` outdated warning, `Audio` not JASSO CD copy, `crates/eju-mcp` `opt-level="z" lto strip ~5 MB`, full `cargo test + parity.rs` + `check-types/check + test` green; `doc-1 §5.2.5` ordering (`doc-2 P0 → EJU data`) respected, no JASSO PDF committed.

---

## 9. References — primary sources used

* **JASSO EJU hub:** `jasso.go.jp/en/ryugaku/eju/examinee/syllabus/index.html` (hub; hub links for every 2026 syllabus), `jasso.go.jp/en/ryugaku/eju/about/revision/index.html` + `2025/02/13 notice_on_revised_syllabuses.pdf` (Course of Study `2018→2022`, table of deleted/added items), `rev_basic.html` (revised syllabuses `Science, Japan and the World, Mathematics` `2026 1st Session`), `jasso.go.jp/en/ryugaku/eju/faq_eju/examinee.html` (4 subjects, pick-2 Science rule, `Science` vs `Japan and the World` exclusive, `Mathematics Course 1/2` split) + `score.html` (equating + Writing `0/10…50`) + `plan/…` etc.
* **Syllabus PDFs (2026 prints):** `2026_syllabus_phy_e.pdf` (Mechanics/Thermodynamics/Waves/E&M/Atoms scope `Basic+Advanced Physics`), `2026_syllabus_chem_e.pdf` (Structure/Matter, `solubility product`+`enthalpy` new, `thermochemical equation` deleted), `2026_syllabus_bio_e.pdf`, `syllabus/japanese.html` (Reading/Listening/Listening-Reading 3 abilities + text types explanatory/editorial/practical/lecture/presentation/consultation/practical-conversation + Writing task types), `syllabus/japan_world/math` prints (Japan and the World `I Politics/Economy/Society II Geography III History` restructure; Math `C1 Math I/A, C2 I/A/II/B/III/C + Expected value/Probability distributions`).
* **Guidelines + venues + scoring:** `jasso.go.jp/en/ryugaku/eju/about/eju_guide/__icsFiles/…/2025_e…guidelines_1.pdf` + `2026_e…guidelines.pdf`, `studyinjapan.go.jp/en/_mt/2024/10/eju_guide_en.pdf` (`16` Japan + `13` overseas venues, `>900` institutions, `2 yrs` validity, `HKD 500/950`, `MNT 50,000` …, mark-sheet format `Writing 30 → Reading 40 → Listening 55`), `jasso.go.jp/en/ryugaku/eju/about/score/index.html` + `outline_of_results_e_2025-2.pdf` (2025-2 avg table `Reading 135/200, Total 235/400, Writing 34/50, Japan and the World 122/200, Math C1 98/200 C2 109/200`).
* **Past-paper publication rule:** `examinee/publish.html` (2002–2025 booklets, `2024` `1/year`, Kirihara/Bonjinsha `out of stock` lineage), `examinee/pastpaper_sample/index.html` + per-year `pastpaper_2021_1.html etc.` + `publish.html` (one disclosure type per year until 2023, one of 2 from 2024; `2019-2/2020-1` not published, many `in preparation` on EN site; combined Science/Math booklets; answer sheets + CD for listening; Study in Japan Resource Facilities + overseas representatives + overseas offices as overseas access).
* **Free/aggregated banks (shape reference):** `open-exam-prep.com/practice/jp-eju` (`100+ original 2026`, not JASSO verbatim, `Japanese+Science+Japan and the World+Math C1/C2`), `japaneselanguages.com/blog/eju-past-papers` (aggregator), `jpcampus.net/guide/eju-subjects` (2026 Math `C1 vs C2` fill-in, course tables).
* **Japanese syllabus reform context:** `docs/4.2-acp…` n/a; instead `jasso.go.jp` `Notice 2025/02/13 Table §2` (deleted/added mapping + Course of Study correspondence `Basic/Advanced Physics/Chemistry/Biology, Contemporary Politics/Modern Economy…`) + `jasso.go.jp/en/ryugaku/eju/examinee/syllabus/{physics,chemistry,biology,math,revision}` prints.
* **Publishers / prep schools (structure model, not source to copy):** `coach-pub.jp/books/study-reference/0010+0009` (Kyo Gakuen `完全マスター 総合科目`, `必修単語 12000語` `10-year` ranking, `模擬試験問題集` CN/KR editions), `ask-books.com/book-details/?slug=9784866397108` (Isaji `ハイレベル 総合科目 改訂第三版 2024-03` `312p+128p`, `ask-books 9784866394770` `模試と解説 6回`), `japanese.sng.ac.jp/en/course/preparation-classes/eju.html` (SNG 5 courses `Basic/Advanced Math` split, original textbooks), `studyinjapan.go.jp` Chart-shiki `基礎から数学 I+A` testimonial (Mongolia top-score path).
* **Manobu architecture:** `apps/desktop/AGENTS.md` (`SCR-10 jlpt-mock` + `SCR-04/05/09` compounds), `packages/japanese/{AGENTS.md, data/LICENSE.md, data/n1..n5 8,505}`, `crates/jlpt-mcp/src/main.rs:81` (12 tools), `packages/db`, `doc-1` + `doc-2` (share-alike + `sqlite-vaporetto`).

