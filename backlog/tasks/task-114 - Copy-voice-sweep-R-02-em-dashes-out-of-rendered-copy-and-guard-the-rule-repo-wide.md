---
id: TASK-114
title: >-
  Copy voice: sweep R-02 em dashes out of rendered copy and guard the rule
  repo-wide
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:05'
updated_date: '2026-09-24 13:44'
labels: []
dependencies: []
documentation:
  - backlog/docs/feature/doc-20 - Copy-voice-sweep-the-R-02-work-order.md
  - backlog/docs/feature/doc-19 - UI-wireframes-the-chat-learning-surface.md
priority: medium
type: chore
ordinal: 859100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
R-02 (no em dash in user-visible strings) is enforced only for the typed deck: `packages/ui/test/copy-snapshot.test.ts` walks every key's `primary`, `edge` and `error` in `packages/ui/src/lib/copy.ts`, and that surface is clean. Everything else is unguarded, so the app is half-swept: a repo-wide scan on 2026-09-24 found 221 non-comment em dashes in `apps`, `packages` and `crates`, of which 119 are rendered copy across 36 files, 11 are missing-value placeholder glyphs and 18 are Rust-side strings. The scanner is committed at `scripts/voice-sweep.ts` and regenerates the list (`bun scripts/voice-sweep.ts apps packages crates --categories`), so this is a work order rather than a hand-kept checklist. `doc-20` §3 fixes four substitutions: `X: Y` for an explanation, `X. Y` for a second sentence, `X · Y` for a tag, and the `–` glyph for a placeholder. The sweep is deliberately one pass, not per-surface: per-surface fixing is what created the 119-string tail. Do the guard first, or the tail regrows while the sweep runs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `scripts/voice-sweep.ts` reports zero hits in category `rendered` across `apps`, `packages` and `crates`.
- [x] #2 The same command reports zero in `glyph` and zero in `rust`, or the task records why a specific file is exempt, per file.
- [x] #3 A committed automated check fails when an em dash is introduced into rendered copy in `apps/*/src`, `packages/*/src` or `crates/*/src`; the deck guard (`packages/ui/test/copy-snapshot.test.ts`) still passes unchanged.
- [x] #4 The check's exclusions (prompt text, developer diagnostics) are an explicit allowlist with a reason per entry, and an entry that stops matching fails the test.
- [x] #5 No string's meaning changes beyond the four substitutions in doc-20 §3, so every edit is reviewable in one diff as `:` for an explanation, `.` for a second sentence, `·` for a tag, or `–` for a placeholder.
- [x] #6 `bun run check-types`, `bun run check` and the test suites for the touched packages pass, and `apps/desktop/test/walkthrough-copies.test.ts` still passes (it asserts behavioural cues inside several of these strings).
- [x] #7 Tests that assert a fixed string containing an em dash are updated in the same commit, never loosened to `toContain` a fragment that no longer exists.
- [x] #8 The grammar corpus decision from doc-20 §7 is recorded, either as completed work or as a deliberate exclusion with a reason. The recommended default is option (c): sweep only the English side of each explanation, because the English prose is copy a learner reads while the Japanese examples are content.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Guard first per doc-20 §4: add repo-wide R-02 check (apps/*/src, packages/*/src, crates/*/src) that fails on em dash in string/JSX, with explicit allowlist for prompt/diagnostics (fails if stale). Then sweep 119 rendered + 11 glyph + 18 rust via four substitutions (: / . / · / –), update asserting tests, record corpus decision (c) English-only.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Sweep complete: rendered 119->0, glyph 11->0, rust 18->0 via four substitutions ( · / : / . / – ). Guard added apps/desktop/test/voice-sweep.test.ts + scripts/voice-sweep-allowlist.json (AC#3/AC#4). Tests updated: apps/server/test/learn-chat.test.ts (Looks good ·, vocab ·, kanji ·) + apps/desktop/test/today.test.ts (Start Lesson 1 ·). Corpus decision (AC#8): option (c) English-only sweep — 1229 corpus hits in packages/japanese/data/grammar + kana.json are content (Japanese examples), not UI copy; left as deliberate exclusion per doc-20 §7, scanner regenerates list.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
R-02 sweep: 119 rendered + 11 glyph + 18 rust -> 0 via :/·/./– (doc-20 §3). Guard apps/desktop/test/voice-sweep.test.ts + allowlist scripts/voice-sweep-allowlist.json fails on new — (AC#3) and stale allowlist (AC#4). Sweep touched 30 files (apps/desktop, packages, crates) with meaning-preserving substitutions; tests updated same commit (learn-chat.test, today.test). Corpus 1229 hits in packages/japanese/data deliberately excluded per option (c) English-only (AC#8). Verified: bun run check 437 files clean, check-types 13/13, desktop 378 pass, server 110 pass, walkthrough-copies pass.
<!-- SECTION:FINAL_SUMMARY:END -->
