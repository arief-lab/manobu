---
id: TASK-39
title: >-
  P0 — /lesson route crashes: Node Buffer global in browser bundle
  (grounded-examples.ts)
status: Done
assignee: []
created_date: '2026-09-09 11:15'
updated_date: '2026-09-09 17:36'
labels:
  - bug
  - p0
  - frontend
dependencies: []
priority: high
ordinal: 552000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-9 QA-2. Symptom: /lesson shows error boundary 'Something went wrong: Buffer is not defined', content pane dead. Proven chain: routes/lesson.tsx → components/lesson.tsx:38 imports pickGroundedExample from lib/grounded-examples.ts → line 46 Buffer.from(seed, utf8). Node global referenced in a vite browser bundle. Fix: replace with TextEncoder + DataView FNV loop — behavior-identical seeds (the function is pure). ~1h fix.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Navigating /lesson renders the lesson UI — no 'Buffer is not defined' error boundary
- [x] #2 pseudoRandomIndex in src/lib/grounded-examples.ts uses no Node globals (TextEncoder/DataView or charcode loop); bun tests for the module still pass
- [x] #3 grep -rn 'Buffer.from' apps/desktop/src returns no browser-bundle hits (mic-stt.ts AudioWorklet context checked separately if applicable)
- [x] #4 bun run test + bunx ultracite check clean
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 888eadc): AC2 — pseudoRandomIndex now iterates SEED_ENCODER.encode(seed) (module-level TextEncoder) instead of Buffer.from(seed,'utf8'); the FNV-1a bigint loop is untouched. Byte-parity proven across 7 seeds incl. multibyte JP, empty string, and 500-char ASCII (Buffer vs TextEncoder produce identical hashes), so picks stay deterministic and aligned with the Rust sidecar's random_example scheme. Rationale carried in a code-site comment (browser bundle: Buffer is undefined). AC3 — grep Buffer in apps/desktop/src: only remaining hit is Web Audio's e.inputBuffer (AudioWorklet event field) in mic-stt.ts — not a Node global. AC1 — browser smoke via headless Chromium against the vite dev server: /lesson renders the full lesson UI (食べる with furigana, grounded example 例: すぐに戻ります。 Tatoeba #4709), zero error-boundary text, zero 'Buffer is not defined'. AC4 — desktop suite 232/0, tsc 0 errors, ultracite clean repo-wide (278 files). DOX pass: implementation-only one-function fix; no contract/purpose/workflow change → apps/desktop AGENTS intentionally unchanged; rationale lives at the code site.
<!-- SECTION:NOTES:END -->
