# DESIGN.md — manobu visual direction

Direction file for UI work. `AGENTS.md` routes here; `antislop.md`
filters on top. This captures the identity the app already has (desk,
worksheet, reader, exchange), so new surfaces are directed, not drifted.

## Identity

- Product: offline-first Japanese desk for a self-studying learner. The
  tool is quiet; the Japanese is the loud thing.
- Voice: a patient sensei. Lowercase UI labels ("say it →", "shelf",
  "desk"), Japanese faces in full size, English only on demand.
- Never: gamification, streaks, scores-as-shame, hype adjectives.

## Palette: 墨・紙・藍・朱 (tokens in `packages/ui/src/styles/globals.css`)

ONE theme, adopted 2026-09-13. The Edo craft reading of Japanese color,
not the tourist one: almost no color, and the little there is carries
meaning. No theme toggle, no `dark:` variants, no next-themes.

| role | name | hex | token |
|---|---|---|---|
| 地 ground | 生成り kibari (unbleached hemp) | `#f4efe3` | `--background` |
| | 胡粉 gofun (shell white) | `#fbf8f1` | `--card`/`--popover`/`--sidebar` |
| | 鼠 nezu (mouse grey, warm) | `#8b857a` | `--input` (hairlines, chrome) |
| 文 text | 墨 sumi (lamp black, never #000) | `#2b2a26` | `--foreground` |
| 作 work | 藍 ai (the vat-dyed workcloth) | `#26406e` | `--primary` |
| | 浅葱 asagi (diluted bath) | `#7ba7b0` | `--asagi` |
| 印 mark | 朱 shu (the seal, torii red) | `#c2402a` | `--mark` |
| 正/誤/慎 | 松 pine `#3d6b4a` · 赤錆 rust `#8a4a2e` · 山吹 kerria `#7f610f` | | `--success`/`--destructive`/`--warning` |

**The semantic split that makes it cohere:** ai is the *act* (practice,
tappable, progress, the learner's own output). shu is the *consequence*
(the mark that something is done, due, sealed, corrected). That is why
shu is rare — a seal loses meaning if everything is stamped.

**Area budget, enforced:** ink + paper ≥ 90% of any screen, ai ≤ 8%,
shu ≤ 2%. A component that breaks the budget changes shape, not hue.
The desk hero is a paper card with an ai rule, not a field of dye.

**Contrast contract (WCAG 2.2 AA, antislop audit-001):** computed, not
eyeballed — sumi on kibari 12.52 / gofun 13.54; ai on kibari 8.97,
white on ai 9.70; muted-foreground 5.38/5.82/4.92; `--input` 3.19 (≥3
for UI components). **shu is 4.51 on kibari: large numerals, marks,
hairlines, and solid fills with gofun text only — never 13px link
text.** Any new solid-fill token must clear 4.5:1 with its foreground;
verify with computed oklch→relative luminance.

**Traps, banned:** 桜 sakura pink (cute-app tell), 金 gold as UI color
(one place max, never a button), a red sun / rainbow gradient / gold
foil (tourist brochure), and the traffic-light ramp (review grades are
four materials, each named, not green-yellow-red-orange).

## Typography

- Inter Variable (`--font-sans`), chosen for CJK+Latin fallback quality
  at small sizes on a dense desk UI. Sizes are the token scale
  (`--font-size-xs..xl`); Japanese faces render at `text-base`+ so kana
  stays legible without zoom.
- No monospace as identity; `font-mono` only for data readouts (timers,
  ids).

## Layout language

- One column, `max-w-170`, centered. Focus surfaces (lesson, reader,
  exchange, setup, desk) are chrome-free: no global header, no floating
  widget, each carries its own `←` bar.
- Cards: `rounded-card` (0.5rem), `border-border`, `bg-card` (gofun —
  the warm tint step IS the elevation; washi has tooth, paper does not
  float). Chips: `rounded-chip`. The radius scale is the hierarchy:
  card 0.5rem, small controls `rounded-md`, dots full. Nothing
  pill-stacked.
- No shadows except elevation that means something: the token popover
  (`shadow-lg`) floats above the page because it IS above the page.
- No gradients, no glow, no background patterns.

## Motifs (the identity, repeated on purpose)

1. **The ladder**: Japanese first, help on request. Dotted line under a
   sentence = "translate this". Tap any word = popover. Never show the
   answer up front (no spoiler placeholders). On the reader the ladder
   extends to the ink itself: tokens render as plain sumi; the ai
   accent + underline appear on hover/focus or while the popover is
   open. A SAVED word is not colored text — it gets a 朱 stamp dot
   above-right, so the paragraph stays ink and your work is marked.
   The first word of the first sentence starts revealed so touch users
   see the affordance. Roleplay clerk lines stay ai-colored: short
   text, and there the blue IS the "tap to understand" invitation.
2. **Earned contrast**: the polished form appears only after the
   learner produces something flatter. Feedback, not posters. The
   sensei's-way line carries a 朱 hairline — the correction is a mark,
   not a wall of red.
3. **Honest counts**: every number on screen is real state (taps,
   saves, due). "Due tomorrow" is the FSRS default the toast itself
   prints. No XP, no streaks.
4. **Scene emoji** (🏪 💼 ⛩️) as referent icons, not decoration.

## Interaction

- Motion dial MOTION 1: hover/transition states only (color, 2px lift
  on shelf cards). No entrance animations. The typewriter on setup's
  rail is content, not decoration.
- Focus: 2px ring on every control (R-32), Escape closes every layer.
- Tap targets: 44px minimum hit area on interactive controls; small
  visual chips inflate via `after:-inset-*` pseudo overlays rather than
  growing the visual.
- States: every data surface ships empty/loading/error; local surfaces
  ship honest empty copy instead.

## Dials

ENERGY 1 / RHYTHM 2 / MOTION 1. Calm linear desk; composition varies
between surfaces (thread vs shelf vs worksheet) but never within a
screen; motion is hover-only.
