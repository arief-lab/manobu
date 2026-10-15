---
id: TASK-173.9.1
title: >-
  Exam (real mode): N3 語形成 and the grammar 大問 fill from sourced content or
  refuse (doc-26)
status: Done
assignee:
  - '@arif'
created_date: '2026-10-03 11:27'
updated_date: '2026-10-10 09:36'
labels: []
dependencies: []
parent_task_id: TASK-173.9
priority: medium
ordinal: 952000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
N3 slice of the TASK-173.9 umbrella (split by level, user-approved). CORRECTED after source research: N3 has NO 語形成, that is an N2/N1-only 語彙 format (doc-26 §3.3). The official N3 文法・読解 大問 are 文の文法1 (grammar-form, shipped), 文の文法2 文の組み立て (star-ordering, shipped via 173.6), 文章の文法, 内容理解（短文）, 内容理解（中文）, 内容理解（長文）, 情報検索. The N3 gaps beyond what 173.5/.6/.7 shipped are: 文章の文法, authentic 内容理解（長文） and 情報検索 (two-document compare). Real parity means each fills from licensed sourced content or the paper refuses (apps/server/src/services/exam-service.ts:2088). No audio dependency.
SUPERSEDED 2026-10-10: TASK-173.9.23 takes ownership of 用法 at N1/N2/N3 and 文章の文法 at N3 under the pattern-driven 語彙・文法 route (AI-authored sentence + 3 distractors over the licensed grammar/{level}.json pattern store, two-blind-pass certification per doc-27 §11). TASK-173.9.16/.18 already closed the N3 長文 and 情報検索 gaps (content read of TASK-173.9.17), so AC#1's remaining scope is empty. TASK-173.9.1 is not actionable in its original 'sourced or refuse' model because every block it names is now owned elsewhere; closing it as superseded to keep the backlog honest, not to claim its original ACs are met.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 N3 real mode fills 文章の文法, 内容理解（長文） and 情報検索 from licensed sourced content, or refuses each block with a named receipt; never fabricates (inherits umbrella AC#4)
- [ ] #2 語形成 is explicitly OUT of N3 scope (N2/N1-only, doc-26 §3.3); it belongs to TASK-173.9.2/.3
- [ ] #3 CONTENT GATE: filling any N3 読解 block requires a licensed per-level reading store (the way 173.7 sources from packages/japanese/data/reading/n5.json). No reading/n3.json exists, so until such content is vendored every higher N3 reading block refuses (doc-26:196)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Content-gate research FIRST (do not fabricate per doc-26 §0):
   a. Confirm 語形成 (word formation) needs a new ItemType: check packages/item-engine/src/types.ts ITEM_TYPES (currently none) + how N3 grammar blocks source today.
   b. Map the official N3 文法 大問 (文の文法1/2, 文章の文法, 語形成) to existing types vs new: grammar-form/context-cloze/star-ordering exist; 語形成 does not.
   c. Check shipped corpora for authentic N3 語形成 + grammar sentences; confirm whether content exists or must be transcribed from a pinned PDF (doc-26 §23/§251, N3 transitional wording band).
   If NO sourced N3 語形成 content: STOP, record content-gated in notes, report to user; do not invent items.
2. If content exists: add word-formation ItemType (contract EXAM_ITEM_TYPES + item-engine ITEM_TYPES), route into PAPER_BLUEPRINTS.N3 language-knowledge (paper.ts:57-63,157-197), add sourcing/validation in exam-service with real-mode refuse (isRefused :2088).
3. Tests: item-engine paper.test.ts (N3 block fills / refuses without content), server real-N3 assembly. No readFileSync/toContain source assertions (TASK-134).
4. Verify: check-types 14/14, targeted tests, ultracite, mutation-gate --check + seam if a fill/refuse property is pinned, check:dox. Single commit on approval, no push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Step-2 research outcome (content gate): repo vendors NO source PDFs (find *.pdf empty); the real-content model is a licensed per-level store JSON. Only packages/japanese/data/reading/n5.json exists; there is no n3 reading store, and no multi-document store for 情報検索. grammar/n3.json is a pattern reference (not paper items) and data/n3.json is a vocabulary list (no 語形成 derivational families). Per the standing never-fabricate rule and doc-26 §0, authentic N3 長文/情報検索/文章の文法 content cannot be authored in-code; it must be acquired/vendored like the CC-BY n5 store. Therefore 173.9.1 has no agent-doable code increment until a licensed N3 reading content store exists. Do not pre-build empty item-type scaffolding for absent content (half-finished implementation).

Also mis-scoped 語形成 originally; corrected: N2/N1-only.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-10 09:36
---
SUPERSEDED BY TASK-173.9.23 (2026-10-10).
Scope map at close:
- AC#1 N3 文章の文法 -> TASK-173.9.23 (pattern-driven 語彙・文法 route, same task owns 用法)
- AC#1 N3 内容理解（長文） -> TASK-173.9.16 (authored 長文 store at N3, shipped 2026-10-09)
- AC#1 N3 情報検索 -> TASK-173.9.18 (N3 読解 closeout, shipped 2026-10-09)
- AC#2 (語形成 out of N3 scope, belongs to N2/N1) -> no task owns it yet; parked, no change
- AC#3 (content gate: no licensed N3 reading store) -> gate satisfied: every N3 読解 大問 now has an authored store (173.9.16/.18), so the 'refuse' path no longer fires for reading blocks; a 用法 block still refuses while its store is absent, which is TASK-173.9.23's job
TASK-173.9.1 itself has no agent-doable code increment: the original model was 'sourced or refuse from a licensed N3 読解 store,' and that store does not exist (the 読解 work at N3 is now authored, not sourced, per doc-27 §10/§13). The task is closed as superseded, not as done-in-place: its ACs are redistributed across .16/.18/.23, not re-proven here.
---
<!-- COMMENTS:END -->
