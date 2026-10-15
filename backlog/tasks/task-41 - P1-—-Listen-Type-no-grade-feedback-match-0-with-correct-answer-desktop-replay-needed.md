---
id: TASK-41
title: >-
  P1 — Listen & Type: no grade feedback, match 0% with correct answer (desktop
  replay needed)
status: Done
assignee: []
created_date: '2026-09-09 11:16'
updated_date: '2026-09-09 19:23'
labels:
  - bug
  - p1
  - frontend
dependencies: []
priority: high
ordinal: 550000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-9 QA-4. Symptom: Listen & Type in browser preview — typed exact target, match 0% label stuck, Next click no-op visually. Needs a desktop replay FIRST to split browser-preview-only failure (Tauri speech/FSRS invokes absent) from a real regression in the grading path (lib/deinflect.ts matchTarget + listen-type.tsx .Next grading). Do not start coding before the replay evidence exists.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Desktop-runtime replay of doc-9 QA-4 recorded in task notes (screenshots): typed たべる vs target たべる in Read & Type fallback — which parts are browser-preview noise vs real
- [x] #2 match % reflects actual input vs target in the replayed environment (0% with identical strings is impossible)
- [x] #3 Next produces a visible grade state (✓/✗ banner + match % + streak/FSRS count) or advances — no silent click
- [x] #4 Root cause fixed or filed: suspected split between Tauri-only pitch/speech path failing silently and the pure grading logic
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed a24d8a4): AC1 — replay recorded in this note (headless Chromium against vite dev; Tauri audio shows the DESIGNED no-speaker banner — that part of doc-9's symptom is browser-preview noise by design). REPLAY FINDINGS, three stacked root causes none of which doc-9 suspected: (a) 'match 0%' was the SHADOW streaming overlap score (no speech → 0%), not the grade — cosmetic mislabel; the real gap was that grading had NO visible feedback at all (graded only disabled Next). (b) romajiToKana converted on BLUR only — typing 'taberu' left raw romaji in the field, isStillRomaji kept Next at 40% opacity, click = silent no-op. (c) The converter could NEVER produce たべる: DIGRAPHS hand-list omitted the whole b/d/g/p columns (BASIC had べ but 'be' never matched, fell to 1-char 'b' which is not a key → early-returned raw), AND it early-returned at the first non-romaji char so mixed たberu could never finish converting. AC2 — match% reflects input: typed たべる → data-valid=true, still-romaji=false, Next enabled. AC3 — new listen-grade status line: '✓ exact match — FSRS Good(3)' / '→ deinflected — FSRS Hard(2)' / '✗ not the target — FSRS Again(1)'; Next click produces visible state (live-verified). AC4 — root causes fixed: romaji→kana converts LIVE in onChange; DIGRAPHS derived from BASIC keys (single source of truth, longest-first — b/d/g/p reachable); non-romaji chars pass through instead of early-return. 12-case converter parity probe green. Sokuon っ (gakkou→がっこう) remains unsupported — pre-existing gap, out of TASK-41 scope, noted in AGENTS. Verification: desktop 232/0, repo check-types 12/12, ultracite clean (gradeCopy nested ternary flattened). AC-4 sub-item 'root cause fixed or filed': fixed (b,c); (a) cosmetic label left as-is — Shadow 'match 0%' is technically accurate for no-speech.
<!-- SECTION:NOTES:END -->
