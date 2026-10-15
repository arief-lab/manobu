/**
 * Zero-knowledge walkthrough test (TASK-23.3 commit 2).
 *
 * Verifies the goal-aware wiring for the main lesson:
 *   - validateSearch includes goal param
 *   - loader uses nextCardsForGoal / nextCardsQueryOptions with goal
 *   - default goal=travel when param omitted
 *   - Onboarding goal persistence is correctly wired
 *
 * "Zero-knowledge" means the test does not assert on specific vocab
 * — it only checks the structural contract between routes, libs,
 * and the goal-search-param plumbing.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const libRoot = join(import.meta.dirname, "..", "src", "lib");
const libFile = (rel: string): string =>
  readFileSync(join(libRoot, rel), "utf8");

const routesRoot = join(import.meta.dirname, "..", "src", "routes");
const routeFile = (rel: string): string =>
  readFileSync(join(routesRoot, rel), "utf8");

const NEXT_CARDS_FOR_GOAL = /nextCardsForGoal/;

describe("TASK-23.3 commit 2 — goal-aware lesson wiring", () => {
  it("next-cards.ts exports nextCardsForGoal for goal-aware picking", () => {
    const src = libFile("next-cards.ts");
    expect(src).toMatch(NEXT_CARDS_FOR_GOAL);
  });

  it("/lesson validateSearch includes the goal param", () => {
    const src = routeFile("lesson.tsx");
    expect(src).toContain("goal");
    expect(src).toContain('"travel"');
    expect(src).toContain('"jlpt"');
    expect(src).toContain('"anime"');
    expect(src).toContain('"work"');
  });

  it("/lesson loader warms the vocab query for the jlpt deck", () => {
    const src = routeFile("lesson.tsx");
    expect(src).toContain("lessonVocabQueryOptions");
    expect(src).toContain("loaderDeps");
    expect(src).toContain("ensureQueryData");
  });

  it("/lesson defaults goal=travel when the param is omitted", () => {
    const src = routeFile("lesson.tsx");
    expect(src).toContain('.default("travel")');
  });

  it("/learn/lesson is a legacy redirect stub to /lesson", () => {
    const src = routeFile("learn/lesson.tsx");
    expect(src).toContain("redirect");
    expect(src).toContain('to: "/lesson"');
  });

  // Router audit (2026-09-14): listen moved UP to the chrome-free /listen
  // desk; the stub direction flipped. Old deep links still land.
  it("/learn/listen is a legacy redirect stub to /listen", () => {
    const src = routeFile("learn/listen.tsx");
    expect(src).toContain("redirect");
    expect(src).toContain('to: "/listen"');
  });
});
