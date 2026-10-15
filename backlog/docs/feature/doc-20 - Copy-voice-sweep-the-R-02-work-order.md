---
id: doc-20
title: 'Copy voice sweep: the R-02 work order'
type: specification
created_date: '2026-09-24 09:16'
updated_date: '2026-09-24 10:59'
---
# Copy voice sweep: the R-02 work order

> **Status:** draft v1
> **Date:** 2026-09-24
> **Type:** specification
> **Parent:** none. This is a cross-cutting cleanup, not part of the exam feature.
> **Companion:** `doc-19` (the wireframes. Every string they show obeys this rule).
> **Guard that exists today:** `packages/ui/test/copy-snapshot.test.ts` (the typed deck only)

This doc is written to become a Backlog task. §6 is the acceptance criteria; §5 is the checklist.

---

## 0. Why this doc exists

R-02 (no em dash in user-visible strings) is enforced today **only for the typed deck** (`packages/ui/src/lib/copy.ts`, 63 keys). Everything else is unguarded, so the app is in a half-swept state: the deck is clean, and the rest of the surface is not.

A scan of `apps`, `packages` and `crates` on 2026-09-24 counts:

| Bucket | Em dashes | Where |
| --- | --- | --- |
| Rendered copy (JSX text, UI strings, thrown error text) | **119** | feature code across 36 files |
| Missing-value glyphs (`"—"`) | **11** | kanji detail, review queue, speech settings, tool cards, dev route |
| Rust-side strings | **18** | tool result formats, tool descriptions, Tauri error strings |
| Prompt text (model-facing) | 15 | `apps/server/src/assistant-loader.ts` |
| Developer diagnostics | 14 | `console.*`, `log::info!`, `eprintln!`, server logs |
| Build and fetch tooling | 8 | `packages/japanese/scripts/*`, `packages/db/scripts/*`, `packages/db/src/migrate.ts` |
| Test names and fixtures | 36 | 17 test files |
| **Shipped corpus data** | **1229** | `packages/japanese/data/grammar/n1..n5.json` (1182), `kana.json` (51), `phrases.json` (1) |
| Comments (out of scope by definition) | 1095 | everywhere |
| **Non-comment total** | **221** | the sum of the categories above |

The 119 rendered strings are the actual work. The corpus number is the one that needs a decision (§7), because grammar explanations are learner-visible content rather than UI copy.

Why not leave it to "fix when touched": the touched string is always the one the author can see, so the tail never shrinks. This is the same reasoning that produced the deck guard.

---

## 1. What the rule governs

R-02 governs **any string a learner can read**. Applied to the scan:

| Category | In scope | Why |
| --- | --- | --- |
| Rendered copy: JSX text, empty states, hints, aria-labels, `title` attributes, toast and error strings | **yes** | the learner reads it |
| Missing-value glyphs (`?? "—"`, `: "—"`) | **yes, as a glyph** | the learner sees it, but it is a placeholder, not prose: use `–` (en dash) so the no-em-dash rule holds and the placeholder still reads as "no value" |
| Rust tool result formats (`engine.rs` `format!` strings) | **yes** | they render in the tool-call cards in the transcript |
| Rust tool descriptions (`main.rs`) and Tauri model descriptions (`speech/models.rs`) | **yes** | tool descriptions surface in the cards and in the model picker |
| Thrown error text in app code (`packages/speech/src/hooks.ts`, `tts.ts`) | **yes** | it reaches a toast or an error boundary |
| Rust error strings that reach the UI (`speech/error.rs`) | **yes** | the learner sees the message |
| `apps/desktop/src-tauri/src/lib.rs` diagnostics | no | `log::info!` and friends: developer-facing |
| Prompt text (`assistant-loader.ts`) | no, by decision | the model reads it, not the learner. Changing 15 prompt strings risks the agent's tone for zero learner benefit |
| Test names and fixtures | no, by decision | never rendered |
| Build and fetch tooling (`/scripts/`, migrations) | no, by decision | console output and thrown errors for whoever runs the tool |
| Corpus data (`grammar/*.json`, `kana.json`, `phrases.json`) | **decision needed** | see §7 |

Rust also carries one **copy key mirrored as a string**: `apps/desktop/src-tauri/src/speech/... ` is not the copy deck, but `apps/desktop/src-tauri/src/fsrs.rs:119` holds `"optimize.fail: <400 reviews — using defaults (better than SM-2) [Learn more]"`, which duplicates the deck's `review.optimize.fail` string (already fixed in the deck on 2026-09-24). Mirrored copy is the worst of both worlds: the guard cannot see it, and the two copies drift. Fold it into this sweep, or delete the Rust copy in favour of the deck.

---

## 2. Method (reproducible)

The scanner is committed at `scripts/voice-sweep.ts` so the checklist can be regenerated rather than trusted:

```bash
bun scripts/voice-sweep.ts apps packages crates --categories   # totals + per-file counts + the rendered list
bun scripts/voice-sweep.ts apps packages crates --lines        # every hit with its source line
bun scripts/voice-sweep.ts packages/japanese/data --lines       # corpus JSON, if §7 says to touch it
```

What it does, and why it is not a grep:

- **Comments are ignored.** 1095 of the 221 + 1095 em dashes in source are comments, which R-02 does not govern. A plain grep reports all of them and is useless as a work list.
- **Rust lifetimes are not string starts.** `'static` and `&'a str` would otherwise flip the scanner into a phantom string and mislabel whole files (it did, before the fix: Rust showed 63, the real number is 18).
- **Comment-shaped lines are comments.** An apostrophe in prose inside a block comment used to desynchronise the state machine and report the comment as copy; the scanner now drops any line whose trimmed start is `*`, `/*`, or that carries the dash after a `//`.
- **Categories are derived, not hand-kept.** Each hit is classified as rendered, glyph, rust, prompt, diagnostic or test by file and line evidence, so the categories can be audited instead of believed.
- The numbers in §0 are a **snapshot dated 2026-09-24**. Regenerate before starting, and expect the rendered count to have moved.

---

## 3. Replacement convention

Four substitutions cover almost everything, and they are the same four R-02 already names:

| Pattern | Replace with | Example |
| --- | --- | --- |
| `X — Y` where Y explains X | `X: Y` | `polite request — point and say it` → `polite request: point and say it` |
| `X — Y` where Y is a second sentence | `X. Y` | `Nothing due — you're ahead.` → `Nothing due. You're ahead.` |
| `X — Y` where Y is a tag or appositive | `X · Y` | `Start Lesson 1 — 10 min →` → `Start Lesson 1 · 10 min →` |
| A bare placeholder | `–` (en dash) | `?? "—"` → `?? "–"` |

Two rules that matter more than the table:

1. **Do not restructure the sentence to dodge the character.** If a string reads badly with `:`, the string was doing two jobs and should be two strings.
2. **Never let the fix change the claim.** `1 correct of 1 — 60/60 ✓` must become an honest raw-count line, not the same sentence with a colon. `TASK-113` owns that one.

---

## 4. The guard this task should ship first

Fixing 127 strings without a guard just resets the clock. The task's **first commit** should be the guard, so the sweep cannot regress while it runs:

- Extend the deck guard into a repo-wide check over `apps/*/src`, `packages/*/src` and `crates/*/src`: parse TS/TSX/RS, ignore comments, fail on an em dash in any string literal or JSX text.
- Keep a small, explicit **allowlist** for the two excluded categories (prompt text, diagnostics) with a one-line reason each, so the exclusion is reviewable rather than invisible. An allowlist entry that no longer matches should fail the test.
- Keep the existing deck assertion as-is: it is the stricter check, and it covers the fields (`edge`, `error`) the repo-wide pass would also see.
- Rust: either include it, or record the exclusion and the `fsrs.rs` mirrored-copy problem in the same place. Silence is what let the mirrored copy drift.

---

## 5. Inventory (the checklist)

Per file, from the 2026-09-24 snapshot, regenerated by `scripts/voice-sweep.ts`. These three columns are the work: the other categories are excluded in §1.

| File | rendered | glyph | rust | Where it shows |
| --- | --- | --- | --- | --- |
| `apps/desktop/src/features/listen-type/listen-type.tsx` | 16 | 1 |  | learner reads it |
| `apps/desktop/src/lib/lesson-cards.ts` | 14 |  |  | learner reads it |
| `apps/desktop/src/features/settings/settings-speech-models.tsx` | 8 | 3 |  | learner reads it |
| `apps/desktop/src/routes/dev.speech.tsx` | 8 | 1 |  | learner reads it |
| `apps/desktop/src/lib/today.ts` | 7 |  |  | learner reads it |
| `apps/desktop/src/features/kanji-detail/kanji-detail.tsx` | 4 | 2 |  | learner reads it |
| `apps/desktop/src/features/lesson/worksheet.tsx` | 6 |  |  | learner reads it |
| `packages/ui/src/components/tool-call-card.tsx` | 4 | 2 |  | learner reads it |
| `apps/desktop/src-tauri/src/speech/models.rs` |  |  | 5 | tool card, model picker, or error text |
| `apps/desktop/src/features/drill/drill-lab.tsx` | 5 |  |  | learner reads it |
| `apps/desktop/src/features/drill/kana-chart.tsx` | 5 |  |  | learner reads it |
| `apps/desktop/src/features/lesson/conjugate.tsx` | 5 |  |  | learner reads it |
| `apps/desktop/src/features/mock/jlpt-mock.tsx` | 5 |  |  | learner reads it |
| `apps/server/src/routes/learn-chat.ts` | 5 |  |  | learner reads it |
| `apps/desktop/src-tauri/src/speech/stt.rs` |  |  | 4 | tool card, model picker, or error text |
| `crates/jlpt-mcp/src/engine.rs` |  |  | 4 | tool card, model picker, or error text |
| `packages/speech/src/hooks.ts` | 4 |  |  | learner reads it |
| `apps/desktop/src/features/setup/setup.tsx` | 3 |  |  | learner reads it |
| `apps/desktop/src/routes/kanji/index.tsx` | 3 |  |  | learner reads it |
| `packages/acp/src/conversation-guard.ts` | 3 |  |  | learner reads it |
| `apps/desktop/src/features/dashboard/dashboard.tsx` | 2 |  |  | learner reads it |
| `apps/desktop/src/features/mock/review-queue.tsx` |  | 2 |  | missing-value placeholder |
| `crates/jlpt-mcp/src/main.rs` |  |  | 2 | tool card, model picker, or error text |
| `packages/ui/src/lib/clear.ts` | 2 |  |  | learner reads it |
| `apps/desktop/src-tauri/src/fsrs.rs` |  |  | 1 | tool card, model picker, or error text |
| `apps/desktop/src-tauri/src/speech/error.rs` |  |  | 1 | tool card, model picker, or error text |
| `apps/desktop/src-tauri/src/speech/vad.rs` |  |  | 1 | tool card, model picker, or error text |
| `apps/desktop/src/features/ask-sensei/panel.tsx` | 1 |  |  | learner reads it |
| `apps/desktop/src/features/settings/settings-goal.tsx` | 1 |  |  | learner reads it |
| `apps/desktop/src/features/settings/settings-privacy.tsx` | 1 |  |  | learner reads it |
| `apps/desktop/src/features/settings/settings-scheduled-tasks.tsx` | 1 |  |  | learner reads it |
| `apps/desktop/src/lib/conjugate.ts` | 1 |  |  | learner reads it |
| `apps/desktop/src/lib/reader-stories.ts` | 1 |  |  | learner reads it |
| `apps/desktop/src/routes/dev.chat-history.tsx` | 1 |  |  | learner reads it |
| `apps/desktop/src/routes/jlpt-mock.tsx` | 1 |  |  | learner reads it |
| `apps/desktop/src/routes/learn/conversation/$sessionId.tsx` | 1 |  |  | learner reads it |
| `packages/speech/src/tts.ts` | 1 |  |  | learner reads it |
| **37 files** | **119** | **11** | **18** | |

Excluded by §1, listed so the exclusions stay auditable: `apps/server/src/assistant-loader.ts` (15 prompt strings), the diagnostic-only files (`apps/server/src/index.ts`, `apps/server/src/context.ts`, `apps/desktop/src-tauri/src/lib.rs`, `packages/acp/src/mcp.ts`, `packages/db/src/migrate.ts`, `packages/speech/src/*`, `packages/japanese/scripts/*`), the server's parked-lane helper strings, and the 41 test-file hits.

---

## 6. Acceptance criteria (lift straight into the task)

1. `scripts/voice-sweep.ts` reports **zero** hits in category `rendered` across `apps`, `packages` and `crates`.
2. The same command reports zero in `glyph` and zero in `rust`, or the task records why a specific file is exempt, per file.
3. A committed automated check fails when an em dash is introduced into rendered copy in `apps/*/src`, `packages/*/src` or `crates/*/src`; the deck guard (`packages/ui/test/copy-snapshot.test.ts`) still passes unchanged.
4. The check's exclusions (prompt text, diagnostics) are an explicit allowlist with a reason per entry, and an entry that stops matching fails the test.
5. No string's **meaning** changes beyond the four substitutions in §3: every edit is `:` for an explanation, `.` for a second sentence, `·` for a tag, or `–` for a placeholder. Reviewable in one diff.
6. `bun run check-types`, `bun run check` and the test suites for the touched packages pass, and `apps/desktop/test/walkthrough-copies.test.ts` still passes (it asserts behavioural cues inside several of these strings).
7. Tests that assert a fixed string containing an em dash are updated in the same commit, never loosened to `toContain` a fragment that no longer exists.
8. The grammar corpus decision from §7 is recorded, either as completed work or as a deliberate exclusion with a reason.

---

## 7. Decisions needed before starting

| Question | Options | Recommendation |
| --- | --- | --- |
| Grammar corpus (1182 em dashes in `packages/japanese/data/grammar/n1..n5.json`) | (a) treat as content and leave, (b) sweep with the same four substitutions, (c) sweep only the English side of each explanation | (c). The English prose is copy read by a learner; the Japanese examples are content. Sweeping the Japanese text would be a corpus edit with corpus review requirements |
| `kana.json` (51) | as above | same answer as grammar, same reviewer |
| Prompt text (15) | leave, or fold in cosmetically | leave. Not learner-visible, and prompt strings are tuned as a unit |
| Diagnostics (15) | leave, or fold in cosmetically | leave. Log strings are for whoever reads logs |
| The Rust mirrored copy (`fsrs.rs:119`) | fix the string, or delete it and read the deck | delete it from Rust if nothing consumes it; otherwise fix, and note the duplication as a follow-up |
| Timing | one sweep, or per-surface as surfaces are touched | one sweep. Per-surface is what created the tail |

---

## 8. Verification

```bash
bun scripts/voice-sweep.ts apps packages crates --categories   # expect zero rendered/glyph/rust
bun test packages/ui                                            # deck guard still green
bun run check-types
bun run check
bun run test                                                    # turbo, affected packages
```

The guard added in §4 must be shown to fail on a deliberately introduced em dash and pass once it is removed: a guard nobody has seen fail is not evidence.

---

## 9. Revision log

**v1 (2026-09-24).** Written from a repo-wide scan after the deck itself was cleaned and guarded (`packages/ui/src/lib/copy.ts` 20 values, guard in `packages/ui/test/copy-snapshot.test.ts`). Records the 119 rendered strings, the 11 glyph placeholders, the 18 Rust strings, the exclusions (15 prompt, 14 diagnostic, 36 test) and the 1229-em-dash corpus question that this doc deliberately does not answer. `doc-19` is the companion: its frames show the copy that must satisfy this rule.
