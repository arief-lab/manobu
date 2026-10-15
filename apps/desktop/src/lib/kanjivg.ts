/**
 * KanjiVG stroke-order lookup (TASK-23.5.2).
 *
 * Fetches parsed stroke data from the server (`GET /api/kanji/stroke`) —
 * the server reads `packages/japanese/data/kanjivg/kanjivg.jsonl` from
 * disk, so the desktop bundle never imports the 21 MB corpus (server
 * boundary, same pattern as `lib/kanji.ts`).
 *
 *
 * ## Response shape (mirrors the MCP `lookup_stroke_order` tool)
 *
 *   - `character` — the kanji the SVG draws
 *   - `svg`       — full SVG document (109×109 viewBox), prolog stripped
 *   - `strokes`   — `{ id, d, kind? }[]` in stroke order (document order)
 *   - `numbers`   — `{ n, transform }[]` StrokeNumbers labels
 *   - `elementPath` — kvg:element decomposition, outermost first
 *
 * 404 = no KanjiVG data for the character (kyūjitai variants etc.).
 */

import { orpc } from "./orpc";

export interface StrokePath {
  d: string;
  id: string;
  kind?: string;
}

export interface StrokeNumber {
  n: number;
  transform: string;
}

export interface StrokeOrderData {
  character: string;
  elementPath: string[];
  numbers: StrokeNumber[];
  strokes: StrokePath[];
  svg: string;
}

export async function lookupStrokes(
  character: string
): Promise<StrokeOrderData | null> {
  // TASK-71 phase 4: typed oRPC call replaces GET /api/kanji/stroke.
  // 404 semantics preserved: the typed NOT_FOUND error maps to null.
  try {
    return await orpc.jap.kanji.stroke({ character });
  } catch {
    return null;
  }
}
