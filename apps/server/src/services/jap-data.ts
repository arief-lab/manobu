/*
 * Server-side service functions over @manobu/japanese data files — the
 * logic the legacy Hono routes (routes/jap-data.ts) call, extracted here
 * so the oRPC contract implementation (rpc.ts) and the legacy routes share
 * one implementation (TASK-71 phase 3). No Hono types in this module.
 */

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type {
  GrammarItem,
  KanjiListRow,
  StrokeNumber,
  StrokePath,
  VocabItem,
} from "@manobu/api-contract";
import { resolveDataDir } from "../data-dir";

// TASK-43: import.meta.dir is /$bunfs inside the compiled sidecar — the
// repo-relative walk only works in `bun run src/index.ts`. resolveDataDir()
// tries MANOBU_DATA_DIR (set by lib.rs to the resource-dir copy), the dev
// walk, cwd, and exe-parent candidates.
const DATA_DIR =
  resolveDataDir() ??
  join(import.meta.dir, "../../../../packages/japanese/data");

export interface StrokeOrderResponse {
  character: string;
  elementPath: string[];
  numbers: StrokeNumber[];
  strokes: StrokePath[];
  svg: string;
}

// Attribute-name boundary check for `attribute()` (hoisted per
// lint/performance/useTopLevelRegex).
const ATTRIBUTE_NAME_BOUNDARY = /[a-zA-Z0-9]/;

/**
 * Extract one XML attribute value from a tag string. Boundary-anchored:
 * `id="` also occurs inside `kvg:id="` and `d="` inside `id="`, so a bare
 * substring find returns the wrong attribute (the bug the Rust side hit
 * first — see engine.rs::attribute).
 */
function attribute(tag: string, name: string): string | null {
  const pattern = `${name}="`;
  let searchFrom = 0;
  let rel = tag.indexOf(pattern, searchFrom);
  while (rel >= 0) {
    const previous = rel === 0 ? "" : (tag[rel - 1] ?? "");
    const boundaryOk =
      !ATTRIBUTE_NAME_BOUNDARY.test(previous) && previous !== ":";
    if (boundaryOk) {
      const valueStart = rel + pattern.length;
      const end = tag.indexOf('"', valueStart);
      return end < 0 ? null : tag.slice(valueStart, end);
    }
    searchFrom = rel + 1;
    rel = tag.indexOf(pattern, searchFrom);
  }
  return null;
}

function parseStrokePaths(svg: string): StrokePath[] {
  const strokes: StrokePath[] = [];
  let rest = svg;
  let pathPos = rest.indexOf("<path ");
  while (pathPos >= 0) {
    rest = rest.slice(pathPos);
    const end = rest.indexOf("/>");
    if (end < 0) {
      break;
    }
    const tag = rest.slice(0, end);
    const d = attribute(tag, "d");
    if (d !== null) {
      strokes.push({
        d,
        id: attribute(tag, "id") ?? "",
        kind: attribute(tag, "kvg:type") ?? undefined,
      });
    }
    rest = rest.slice(end);
    pathPos = rest.indexOf("<path ");
  }
  return strokes;
}

function parseStrokeNumbers(svg: string): StrokeNumber[] {
  const numbers: StrokeNumber[] = [];
  const numbersStart = svg.indexOf("kvg:StrokeNumbers");
  if (numbersStart < 0) {
    return numbers;
  }
  let rest = svg.slice(numbersStart);
  let textPos = rest.indexOf("<text ");
  while (textPos >= 0) {
    rest = rest.slice(textPos);
    const close = rest.indexOf("</text>");
    if (close < 0) {
      break;
    }
    const tagEnd = rest.indexOf(">") + 1;
    if (tagEnd === 0 || tagEnd >= close) {
      break;
    }
    const transform = attribute(rest.slice(0, close), "transform") ?? "";
    const n = Number.parseInt(rest.slice(tagEnd, close).trim(), 10);
    if (Number.isFinite(n)) {
      numbers.push({ n, transform });
    }
    rest = rest.slice(close);
    textPos = rest.indexOf("<text ");
  }
  return numbers;
}

function parseElementPath(svg: string): string[] {
  const elements: string[] = [];
  let rest = svg;
  let pos = rest.indexOf('kvg:element="');
  while (pos >= 0) {
    rest = rest.slice(pos + 'kvg:element="'.length);
    const end = rest.indexOf('"');
    if (end < 0) {
      break;
    }
    elements.push(rest.slice(0, end));
    pos = rest.indexOf('kvg:element="');
  }
  return elements;
}

/**
 * Stream-scan kanjivg.jsonl for one character (no full-file parse — the
 * JSONL is 21 MB and the route serves one line).
 */
async function findKanjivgLine(character: string): Promise<string | null> {
  const stream = createReadStream(
    join(DATA_DIR, "kanjivg", "kanjivg.jsonl"),
    "utf-8"
  );
  const lines = createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: stream,
  });
  try {
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      // Cheap pre-filter before JSON.parse: the char rides in the first
      // bytes of every line ({"c":"<char>",…).
      if (line.includes(`"c":"${character}"`)) {
        return line;
      }
    }
    return null;
  } finally {
    lines.close();
    stream.destroy();
  }
}

function toJlpt(old: number | null): "N5" | "N4" | "N3" | "N2" | "N1" | null {
  switch (old) {
    case 4:
      return "N5";
    case 3:
      return "N4";
    case 2:
      return "N3";
    case 1:
      return "N2";
    default:
      return null;
  }
}

function getLevelFile(level: string): string {
  const lower = level.toLowerCase();
  if (["n5", "n4", "n3", "n2", "n1"].includes(lower)) {
    return join(DATA_DIR, `${lower}.json`);
  }
  return join(DATA_DIR, "n5.json");
}

function getGrammarFile(level: string): string {
  const lower = level.toLowerCase();
  if (["n5", "n4", "n3", "n2", "n1"].includes(lower)) {
    return join(DATA_DIR, "grammar", `${lower}.json`);
  }
  return join(DATA_DIR, "grammar", "n5.json");
}

// ── Service functions (one per contracted procedure) ──────────────

export interface KanjiLookupResult {
  character: string;
  frequency: number | null;
  grade: number | null;
  jlpt: string | null;
  kun: string[];
  meaningsEn: string[];
  on: string[];
  strokeCount: number;
}

export async function lookupKanjiService(
  character: string
): Promise<KanjiLookupResult | null> {
  const lower = character.toLowerCase();
  const upper = character.toUpperCase();

  const raw = await readFile(join(DATA_DIR, "kanji.json"), "utf-8");
  const data = JSON.parse(raw) as {
    kanji: Array<{
      character: string;
      frequency: number | null;
      grade: number | null;
      jlpt_old: number | null;
      jlpt_waller: string | null;
      meanings: { en?: string[] };
      readings: { on?: string[]; kun?: string[] };
      stroke_count: number;
    }>;
  };

  const entry = data.kanji.find(
    (k) =>
      k.character === character ||
      k.character === lower ||
      k.character === upper
  );

  if (!entry) {
    return null;
  }

  return {
    character: entry.character,
    frequency: entry.frequency,
    grade: entry.grade,
    jlpt: entry.jlpt_waller ?? toJlpt(entry.jlpt_old),
    kun: entry.readings.kun ?? [],
    meaningsEn: entry.meanings.en ?? [],
    on: entry.readings.on ?? [],
    strokeCount: entry.stroke_count,
  };
}

export async function listKanjiByLevelService(
  level: "N5" | "N4" | "N3" | "N2" | "N1"
): Promise<KanjiListRow[]> {
  const raw = await readFile(join(DATA_DIR, "kanji.json"), "utf-8");
  const data = JSON.parse(raw) as {
    kanji: Array<{
      character: string;
      jlpt_waller: string | null;
      meanings: { en?: string[] };
      stroke_count: number;
    }>;
  };
  return data.kanji
    .filter((k) => k.jlpt_waller === level)
    .map((k) => ({
      character: k.character,
      gloss: k.meanings.en?.[0] ?? "",
      jlpt: k.jlpt_waller,
      strokeCount: k.stroke_count,
    }));
}

export async function strokeOrderService(
  character: string
): Promise<StrokeOrderResponse | "no-data" | "corrupt"> {
  const line = await findKanjivgLine(character);
  if (line === null) {
    // Kyūjitai variants and non-JIS glyphs have no KanjiVG SVG.
    return "no-data";
  }
  const entry = JSON.parse(line) as { c: string; s: string };
  const strokes = parseStrokePaths(entry.s);
  if (strokes.length === 0) {
    return "corrupt";
  }
  return {
    character: entry.c,
    elementPath: parseElementPath(entry.s),
    numbers: parseStrokeNumbers(entry.s),
    strokes,
    svg: entry.s,
  };
}

export async function listGrammarService(
  level: "N5" | "N4" | "N3" | "N2" | "N1"
): Promise<GrammarItem[]> {
  const fileLevel = level.toLowerCase();
  const raw = await readFile(getGrammarFile(fileLevel), "utf-8");
  return JSON.parse(raw) as GrammarItem[];
}

export async function listVocabService(
  level: "N5" | "N4" | "N3" | "N2" | "N1"
): Promise<VocabItem[]> {
  const fileLevel = level.toLowerCase();
  const raw = await readFile(getLevelFile(fileLevel), "utf-8");
  const entries = JSON.parse(raw) as Array<{
    level: string;
    meaning: string;
    partOfSpeech?: string;
    reading: string;
    senses?: string[][];
    word: string;
  }>;
  // `gloss` is the first rendering of the first SENSE GROUP. Deriving it from
  // `meaning.split(";")` instead would mangle any gloss containing ";" inside
  // parentheses - アウト is "out (of a ball; in tennis, etc.)" and the split
  // yields "out (of a ball". Same rule as the /vocab route.
  return entries.map((entry) => ({
    gloss: entry.senses?.[0]?.[0] ?? "",
    level: entry.level,
    meaning: entry.meaning,
    partOfSpeech: entry.partOfSpeech,
    reading: entry.reading,
    word: entry.word,
  }));
}
