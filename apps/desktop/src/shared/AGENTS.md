# apps/desktop/src/shared

## Purpose

- App chrome and cross-surface utilities with no SCR ownership:
  `header.tsx` (top chrome on the non-desk routes), `loader.tsx` (shared
  spinner), `listen-button.tsx` (shared [🔊] TTS affordance +
  `SoundBars`, extracted from setup's WordChip for the worksheet),
  `token-text.tsx` (shared tappable-Japanese + coverage-ladder popover),
  `kanji-vg.tsx` (shared KanjiVG stroke renderer + draw animation), and
  `chrome-free.ts` (canonical chrome-free pathname matcher).
  (`conversation-bubble.tsx` was the shared chat bubble — deleted with the
  learn-route cutover in TASK-80.6: the route now mounts the shared
  `@manobu/chat-session` transcript instead of a bespoke bubble, and the
  file had no remaining callers.)

## Ownership

- Project contributors.

## Local Contracts

- No async DATA: these are props-driven or local-state-only files. Any
  file that grows a query/fetch leaves this directory (per the
  data-fetching tier contract in `../features/AGENTS.md`). TTS invoke
  effects inside `listen-button.tsx` are a user-action affordance, not
  data fetching — the exception is deliberate.
- `app-shell.tsx` and `level-selector.tsx` are DELETED (router audit
  2026-09-14): the bento desk's tiles + per-surface `← desk` bars are
  the navigation, and level changes live in Settings (LevelPicker) +
  first-run setup over the same `lib/learner-level.ts` store.
- `listen-button.tsx` rides `@manobu/speech/tts` `speak()` + `useTtsPrefs`
  (both allowed by the zone); `onHeard` fires when the play attempt
  resolves — an affordance timer, not an audio-confirmation (see its
  header note). Playback goes through `ensurePlaybackAudioContext()`
  (called synchronously on the click turn) + `playWavBytes(wav, ctx)` —
  WebAudio, not `new Audio(url).play()`, because Tauri's Linux WebKitGTK
  webview closes user activation once `speak()` awaits and rejects the
  HTMLMediaElement path with NotAllowedError.
- `token-text.tsx` (TASK-73, extracted from the reading corner) renders
  any Japanese string through `segmentSentence` (`lib/reader-stories`)
  and owns the token machinery: hover romaji chip, viewport-clamped
  popover, Esc + outside-pointer dismiss, `tokenCapabilities`
  speak/save/link gate. Callers pass `text` + optional hand-authored
  `words`/`level` and their own testids (reader: `reader-tap` /
  `reader-popover`; roleplay: `rp-tap` / `rp-popover`). The save
  callback is the caller's — the component never touches FSRS itself.
  `ink` mode (reader): tokens render as plain ink; accent + underline
  appear on hover/focus or from state (popover open, saved).
  `seedFirst` colors the first token so touch users see the
  affordance (DESIGN.md motif 1). Roleplay omits `ink`: clerk lines
  stay colored as the tap invitation.
- `chrome-free.ts` owns `CHROME_FREE_PATHS` plus the exact `/kanji/` and
  `/exam/` descendant-prefix branches. `__root.tsx` is its only production
  consumer; parameterized workspace routes cannot be registered by equality
  alone, and a lookalike such as `/exambridge` must remain ordinary chrome.
- `kanji-vg.tsx` (extracted from `features/kanji-detail/kanjivg.tsx` for the
  SCR-03 redesign): pure presentation of `StrokeOrderData` (109 viewBox),
  `visible` prop owns the step, newest stroke reveals via the global
  `kanjivg-draw` keyframe (`pathLength=1` + dashoffset). The drill passes
  `guides` + per-role Tailwind classes (drawing/done/next-guide/guide) to
  color the sequence ai→sumi; kanji-detail keeps the defaults. No data,
  no fetch — the caller supplies `data`.
- fallow zone: `desktop-shared` — allowed imports: `ui-ds`,
  `api-contract`, `lib-*` leaf packages. Never imports
  `desktop-features` or `desktop-app`.

## Verification

- `bun run check-types`; `bun run check` (Ultracite).

## Child DOX Index

_Empty._
