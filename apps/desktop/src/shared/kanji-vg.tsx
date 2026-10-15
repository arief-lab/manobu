/**
 * KanjiVG stroke renderer (shared — kanji-detail stepper + drill ghost).
 *
 * Extracted from `features/kanji-detail/kanjivg.tsx` (TASK-23.5.2) when the
 * SCR-03 drill redesign needed the same draw animation for its ghost strokes.
 * Pure presentation: stroke data comes from `lib/kanjivg.ts` (server-backed);
 * visibility is controlled by the `visible` prop so the parent owns the step.
 *
 * Animation: each `<path>` gets `pathLength="1"` so its length normalizes to
 * 1; the newest stroke reveals via the global `kanjivg-draw` keyframe
 * (`src/index.css`) — dashoffset 1→0, no rAF loop.
 *
 * Per-stroke coloring (drill only): the done/drawing/guide class props map to
 * the 墨・紙・藍・朱 roles — the stroke being drawn is ai, the next guide is
 * ai, finished guides are faint sumi. kanji-detail keeps the defaults (one
 * currentColor for everything); the API is purely additive.
 */

import { useMemo } from "react";

import type { StrokeOrderData } from "@/lib/kanjivg";

export const KANJIVG_VIEWBOX = 109;

/** Stroke draw animation duration in ms per stroke. */
export const STROKE_DURATION_MS = 420;

interface StrokeClassArgs {
  doneClassName?: string;
  drawing: boolean;
  drawingClassName?: string;
  guideClassName?: string;
  guides: boolean;
  index: number;
  nextGuideClassName?: string;
  visible: number;
}

/** Resolve the Tailwind class for one stroke by its role in the sequence. */
const strokeClass = ({
  doneClassName,
  drawing,
  drawingClassName,
  guideClassName,
  guides,
  index,
  nextGuideClassName,
  visible,
}: StrokeClassArgs): string | undefined => {
  if (drawing) {
    return drawingClassName;
  }
  if (guides && index === visible) {
    return nextGuideClassName;
  }
  if (index >= visible) {
    return guideClassName;
  }
  return doneClassName;
};

interface KanjiVgProps {
  /** Animate the newly revealed stroke instead of showing it instantly. */
  animate?: boolean;
  /** Parsed stroke data (null while loading / on miss). */
  data: StrokeOrderData | null;
  /** Tailwind class for revealed strokes (default: inherit currentColor). */
  doneClassName?: string;
  /** Tailwind class for the stroke being drawn (index `visible` - 1). */
  drawingClassName?: string;
  /** Tailwind class for guide strokes past the next one. */
  guideClassName?: string;
  /** Render strokes past `visible` as faint guides (the drill ghost). */
  guides?: boolean;
  /** Tailwind class for the NEXT guide (index `visible`) — the one to draw. */
  nextGuideClassName?: string;
  /** Show the gray stroke-number labels (kanji-detail; off in the drill). */
  numbers?: boolean;
  /** css size (square). Defaults to 109. */
  size?: number;
  /** How many strokes are visible (0..strokes.length). Parent-owned step. */
  visible: number;
}

export function KanjiVg({
  animate = true,
  doneClassName,
  drawingClassName,
  guideClassName,
  guides = false,
  nextGuideClassName,
  data,
  numbers = true,
  size = KANJIVG_VIEWBOX,
  visible,
}: KanjiVgProps) {
  const strokeCount = data?.strokes.length ?? 0;
  const rendered = useMemo(
    () =>
      data
        ? data.strokes.slice(
            0,
            guides ? strokeCount : Math.min(visible, strokeCount)
          )
        : [],
    [data, guides, strokeCount, visible]
  );
  const shownNumbers = useMemo(
    () => data?.numbers.slice(0, visible) ?? [],
    [data, visible]
  );

  if (!data) {
    return (
      <svg
        aria-hidden="true"
        data-testid="kanjivg-empty"
        height={size}
        role="img"
        viewBox={`0 0 ${KANJIVG_VIEWBOX} ${KANJIVG_VIEWBOX}`}
        width={size}
      />
    );
  }

  return (
    <svg
      aria-label={`Stroke order for ${data.character}: ${Math.min(visible, strokeCount)} of ${strokeCount} strokes`}
      data-testid="kanjivg-svg"
      height={size}
      role="img"
      viewBox={`0 0 ${KANJIVG_VIEWBOX} ${KANJIVG_VIEWBOX}`}
      width={size}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      >
        {rendered.map((stroke, index) => {
          const drawing = animate && visible > 0 && index === visible - 1;
          const className = strokeClass({
            doneClassName,
            drawing,
            drawingClassName,
            guideClassName,
            guides,
            index,
            nextGuideClassName,
            visible,
          });
          return (
            <path
              className={className}
              d={stroke.d}
              data-stroke-index={index}
              key={stroke.id || index}
              pathLength="1"
              strokeDasharray={drawing ? "1" : undefined}
              strokeDashoffset={drawing ? 1 : undefined}
              style={
                drawing
                  ? { animationDuration: `${STROKE_DURATION_MS}ms` }
                  : undefined
              }
            />
          );
        })}
      </g>
      {numbers ? (
        <g fill="#808080" fontSize="8">
          {shownNumbers.map((number) => (
            <text key={number.n} transform={number.transform}>
              {number.n}
            </text>
          ))}
        </g>
      ) : null}
    </svg>
  );
}
