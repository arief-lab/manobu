#!/usr/bin/env bun
/**
 * Voice sweep: find em dashes that are NOT inside comments, with context.
 *
 * R-02 governs user-visible strings, not source prose, and ~1095 of this repo's
 * em dashes are comments. A plain grep therefore reports a number nobody can
 * act on. This tool separates the two, categorises each hit, and prints a list
 * the R-02 work order (`doc-20`) can be executed against.
 *
 * No compiler dependency: a small state machine tracks comment and string
 * forms, including Rust lifetimes, which a naive scanner reads as char
 * literals and mislabels whole files with.
 *
 * Usage:
 *   bun scripts/voice-sweep.ts <dir> [dir...] [--categories|--lines|--list]
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const EM_DASH = "—";
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "target",
  ".turbo",
  "build",
  // gitignored judge/authoring scratch, absent in CI: counting it would make
  // the repo-wide guard depend on local working files.
  ".cache",
]);
const EXTENSIONS = [".ts", ".tsx", ".rs"];

const LIFETIME_RE = /[A-Za-z_]/;
const DIAGNOSTIC_RE =
  /console\.(log|warn|error|info|debug)|eprintln!|println!|\[(acp|sidecar|ai|assistant|server|mcp|migrate|fetch|join|done)\]/;
const PROMPT_PATH_RE = /assistant-loader|\/prompts\//;
const GLYPH_BARE_RE = /"—"|"—"/;
const GLYPH_NEIGHBOUR_RE = /\?\?|"✓"|"○"|:\s*"—"/;
const PROMPT_LINE_RE = /^\s*-?\s*\\`/;

type Kind = "comment" | "string" | "code";
type Category =
  | "rendered"
  | "glyph"
  | "rust"
  | "prompt"
  | "diagnostic"
  | "tooling"
  | "test";

interface Hit {
  column: number;
  context: string;
  file: string;
  kind: Kind;
  line: number;
  text: string;
}

const collect = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
    } else if (EXTENSIONS.some((extension) => full.endsWith(extension))) {
      out.push(full);
    }
  }
  return out;
};

/** Index just past a single-line comment starting at `i`. */
const endOfLineComment = (text: string, i: number): number => {
  const end = text.indexOf("\n", i);
  return end === -1 ? text.length : end;
};

/** Index just past a block comment starting at `i`. */
const endOfBlockComment = (text: string, i: number): number => {
  const end = text.indexOf("*/", i + 2);
  return end === -1 ? text.length : end + 2;
};

/** Index just past the quoted run starting at `i` (escapes honoured). */
const endOfString = (text: string, i: number): number => {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === "\\") {
      j += 2;
      continue;
    }
    if (text[j] === quote) {
      break;
    }
    j += 1;
  }
  return Math.min(j + 1, text.length);
};

const markRange = (
  kinds: Kind[],
  from: number,
  to: number,
  kind: Kind
): void => {
  for (let index = from; index < to && index < kinds.length; index += 1) {
    kinds[index] = kind;
  }
};

const isQuote = (character: string | undefined): boolean =>
  character === '"' || character === "'" || character === "`";

const classifyAt = (text: string, kinds: Kind[], index: number): number => {
  const ch = text[index];
  const next = text[index + 1];

  if (ch === "/" && next === "/") {
    const end = endOfLineComment(text, index);
    markRange(kinds, index, end, "comment");
    return end;
  }
  if (ch === "/" && next === "*") {
    const end = endOfBlockComment(text, index);
    markRange(kinds, index, end, "comment");
    return end;
  }
  // Rust lifetimes (`'static`, `&'a str`) are not char literals.
  if (ch === "'" && LIFETIME_RE.test(next ?? "")) {
    return index + 1;
  }
  if (isQuote(ch)) {
    const end = endOfString(text, index);
    markRange(kinds, index, end, "string");
    return end;
  }
  return index + 1;
};

/**
 * Tag every character of `text` as comment, string, or code. JSX text and
 * anything else outside a comment or a string is "code": that is what R-02
 * governs in a .tsx file.
 */
const classify = (text: string): ((index: number) => Kind) => {
  const kinds: Kind[] = new Array(text.length).fill("code");

  let i = 0;
  while (i < text.length) {
    i = classifyAt(text, kinds, i);
  }

  return (index: number) => kinds[index] ?? "code";
};

const isTestPath = (file: string): boolean =>
  file.includes(".test.") ||
  file.includes("/test/") ||
  file.includes("/tests/");

/** Fetch and migration scripts are developer tooling, not learner surfaces. */
const isToolingPath = (file: string): boolean =>
  file.includes("/scripts/") || file.includes("/migrations/");

const isPromptHit = (hit: Hit): boolean =>
  PROMPT_PATH_RE.test(hit.file) || PROMPT_LINE_RE.test(hit.text);

const isGlyphHit = (hit: Hit): boolean =>
  GLYPH_BARE_RE.test(hit.text) && GLYPH_NEIGHBOUR_RE.test(hit.text);

const isCommentShaped = (fullLine: string, kind: Kind): boolean => {
  const trimmed = fullLine.trim();
  const slashSlash = fullLine.indexOf("//");
  return (
    kind === "comment" ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    (slashSlash !== -1 && slashSlash < fullLine.indexOf(EM_DASH))
  );
};

/** Which category a hit belongs to. `rendered` is what R-02 actually governs. */
const categoryOf = (hit: Hit): Category => {
  if (isTestPath(hit.file)) {
    return "test";
  }
  if (isToolingPath(hit.file)) {
    return "tooling";
  }
  if (DIAGNOSTIC_RE.test(hit.text)) {
    return "diagnostic";
  }
  if (hit.file.endsWith(".rs")) {
    return "rust";
  }
  if (isPromptHit(hit)) {
    return "prompt";
  }
  if (isGlyphHit(hit)) {
    return "glyph";
  }
  return "rendered";
};

interface Scan {
  commentCount: number;
  commentOnly: { file: string; count: number }[];
  hits: Hit[];
}

interface FileScan {
  commentsInFile: number;
  hits: Hit[];
  relativePath: string;
}

const scanFile = (file: string): FileScan => {
  const text = readFileSync(file, "utf8");
  if (!text.includes(EM_DASH)) {
    return { commentsInFile: 0, hits: [], relativePath: "" };
  }

  const kindAt = classify(text);
  const relativePath = relative(process.cwd(), file);
  const hits: Hit[] = [];
  let commentsInFile = 0;

  for (
    let index = text.indexOf(EM_DASH);
    index !== -1;
    index = text.indexOf(EM_DASH, index + 1)
  ) {
    const before = text.slice(0, index);
    const line = before.split("\n").length;
    const fullLine = text.split("\n")[line - 1] ?? "";
    const kind = kindAt(index);
    const hit: Hit = {
      column: index - (before.lastIndexOf("\n") + 1),
      context: text
        .slice(Math.max(0, index - 100), index + 100)
        .replaceAll("\n", "⏎"),
      file: relativePath,
      kind,
      line,
      text: fullLine.trim(),
    };
    if (isCommentShaped(fullLine, kind)) {
      commentsInFile += 1;
      continue;
    }
    hits.push(hit);
  }

  return { commentsInFile, hits, relativePath };
};

const scan = (roots: string[]): Scan => {
  const hits: Hit[] = [];
  const byFile = new Map<string, number>();
  let commentCount = 0;

  for (const root of roots) {
    for (const file of collect(root)) {
      const fileScan = scanFile(file);
      commentCount += fileScan.commentsInFile;
      hits.push(...fileScan.hits);
      if (fileScan.commentsInFile > 0) {
        byFile.set(fileScan.relativePath, fileScan.commentsInFile);
      }
    }
  }

  return {
    commentCount,
    commentOnly: [...byFile.entries()].map(([file, count]) => ({
      count,
      file,
    })),
    hits,
  };
};

const printByFile = (hits: Hit[]): void => {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    counts.set(hit.file, (counts.get(hit.file) ?? 0) + 1);
  }
  console.log("--- by file ---");
  for (const [file, count] of [...counts.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`${String(count).padStart(4)}  ${file}`);
  }
};

const printCategories = (hits: Hit[]): void => {
  const totals = new Map<Category, number>();
  const perFile = new Map<string, Map<Category, number>>();
  for (const hit of hits) {
    const category = categoryOf(hit);
    totals.set(category, (totals.get(category) ?? 0) + 1);
    const fileCounts = perFile.get(hit.file) ?? new Map<Category, number>();
    fileCounts.set(category, (fileCounts.get(category) ?? 0) + 1);
    perFile.set(hit.file, fileCounts);
  }

  console.log("--- totals by category ---");
  for (const [category, count] of [...totals.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`${String(count).padStart(4)}  ${category}`);
  }

  console.log("--- by file (category counts) ---");
  for (const [file, counts] of [...perFile.entries()].sort()) {
    const summary = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => `${category}:${count}`)
      .join(" ");
    console.log(`${file}  ${summary}`);
  }

  console.log("--- rendered hits ---");
  for (const hit of hits) {
    if (categoryOf(hit) === "rendered") {
      console.log(`${hit.file}:${hit.line}  ${hit.text.slice(0, 120)}`);
    }
  }
};

const main = (): void => {
  const args = process.argv.slice(2);
  const roots = args.filter((arg) => !arg.startsWith("--"));
  if (roots.length === 0) {
    console.log(
      "usage: bun scripts/voice-sweep.ts <dir> [dir...] [--categories]"
    );
    process.exit(2);
  }

  const { hits, commentCount } = scan(roots);
  console.log(
    `=== non-comment em dashes: ${hits.length} (plus ${commentCount} inside comments) ===`
  );
  printByFile(hits);

  if (args.includes("--categories")) {
    printCategories(hits);
  }
  if (args.includes("--list")) {
    console.log("--- hits ---");
    for (const hit of hits) {
      console.log(`[${hit.kind}] ${hit.file}:${hit.line}:${hit.column}`);
      console.log(`    ${hit.context}`);
    }
  }
  if (args.includes("--lines")) {
    console.log("--- lines (comments filtered) ---");
    for (const hit of hits) {
      console.log(
        `[${hit.kind}] ${hit.file}:${hit.line}:${hit.column}  ${hit.text}`
      );
    }
  }
};

main();
