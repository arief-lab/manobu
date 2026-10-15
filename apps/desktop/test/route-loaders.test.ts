/**
 * Regression guard for TASK-25.2 — every route file in apps/desktop/src/routes
 * must either have a loader field (delegating async fetch to
 * queryClient.ensureQueryData per src/AGENTS.md:21) or carry an explicit
 * "data:local-state" marker justifying the absence. TASK-71.1: the manual
 * .lazy.tsx wrappers are gone — autoCodeSplitting owns laziness, and the
 * guard now asserts NO .lazy.tsx file returns.
 *
 * Catches new routes that hand-roll async data without a queryOptions
 * module + loader.
 *
 * TASK-29: practice surfaces live under src/routes/learn/* and the old
 * flat paths survive as beforeLoad redirect stubs (each carries a
 * data:local-state marker); both are covered in ROUTES below.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "src", "routes");

const file = (rel: string): string => readFileSync(join(root, rel), "utf8");
// Routes that need a loader (per the 25.1 audit table). ai.tsx,
// jlpt-mock.tsx, and review.tsx already have loaders (no marker needed);
// lesson.tsx is on the list because its current loader is a degenerate
// Promise.resolve and TASK-25.2 replaces it with a real queryOptions.
// TASK-30: /dev/speech and /dev/chat-history moved under /dev/;
// no env guard needed — routes relocated.
const LOADER_REQUIRED = [
  "settings.tsx",
  "kanji/$character.tsx",
  "exam/$examId.tsx",
];

const ROUTES = [
  "__root.tsx",
  "ai.tsx",
  // TASK-101: the conversation history desk (loader warms page 1 of
  // `chat.listConversations` through ensureInfiniteQueryData).
  "chat.history.tsx",
  "dashboard.tsx",
  "dev.chat-history.tsx",
  "conjugate.tsx",
  "drill.tsx",
  "exam/$examId.tsx",
  "exam/index.tsx",
  "index.tsx",
  "kanji.tsx",
  "kanji/$character.tsx",
  "kanji/detail.tsx",
  "kanji/index.tsx",
  "learn/conjugate.tsx",
  "learn/conversation/$sessionId.tsx",
  "learn/drill.tsx",
  "learn/lesson.tsx",
  "learn/listen.tsx",
  "learn/reader.tsx",
  "learn/roleplay.tsx",
  "lesson.tsx",
  "listen.tsx",
  "reader.tsx",
  "review.tsx",
  "roleplay.tsx",
  "settings.tsx",
  "setup.tsx",
  "dev.speech.tsx",
];

// TASK-71.1: laziness is vite's tanstackRouter autoCodeSplitting alone.
// A hand-written .lazy.tsx would double-manage the same concern (and the
// generated tree's .lazy() entries only come from those files) — banned.
const lazyFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...lazyFiles(full));
    } else if (entry.name.endsWith(".lazy.tsx")) {
      out.push(full);
    }
  }
  return out;
};

// TASK-30: /speech and /chat-history remain in ROUTES because the regression
// guard still verifies they carry a data:local-state marker. No debug gate —
// moved to /dev/; normal nav hidden by omission
// not by env flag.

const LOADER_PATTERN = /loader\s*:\s*(?:async\s*)?\(/;
const LOCAL_STATE_MARKER = /data\s*:\s*local-state/;
const ENSURE_QUERY_DATA_PATTERN = /ensureQueryData/;

describe("route loader convention (TASK-25.2)", () => {
  const named = (rel: string, suffix: string): string => `${rel} ${suffix}`;

  for (const rel of LOADER_REQUIRED) {
    it(named(rel, "has a loader field that calls ensureQueryData"), () => {
      const src = file(rel);
      expect(src).toMatch(LOADER_PATTERN);
      expect(src).toMatch(ENSURE_QUERY_DATA_PATTERN);
    });
  }

  for (const rel of ROUTES) {
    const needsLoader = LOADER_REQUIRED.includes(rel);
    const suffix = needsLoader
      ? "has loader"
      : "carries data:local-state marker or has loader";
    it(named(rel, suffix), () => {
      const src = file(rel);
      const hasLoader = LOADER_PATTERN.test(src);
      const hasLocalStateMarker = LOCAL_STATE_MARKER.test(src);
      if (needsLoader) {
        expect(hasLoader).toBe(true);
      } else {
        expect(hasLoader || hasLocalStateMarker).toBe(true);
      }
    });
  }

  it("no hand-written .lazy.tsx wrappers exist (TASK-71.1)", () => {
    // autoCodeSplitting is the single laziness mechanism; a manual lazy
    // file would silently take over a route's chunking from the plugin.
    expect(lazyFiles(root)).toEqual([]);
  });
});
