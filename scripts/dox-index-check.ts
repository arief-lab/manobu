#!/usr/bin/env bun
/**
 * DOX index check: every child AGENTS.md must be named by its parent's
 * `## Child DOX Index`.
 *
 * The DOX contract is that a change is understandable from the nearest
 * AGENTS.md plus every parent above it. That fails silently when a parent omits
 * a child: the child doc exists and is correct, and nothing points at it, so a
 * top-down read never reaches it. `packages/AGENTS.md` listed 12 of 13 and the
 * missing one was `api-contract`, whose doc already answered "why can't the
 * contract import X" in prose. The omission cost an investigation the doc had
 * settled.
 *
 * Exit 0 and stay quiet when the tree is complete; name every gap and exit 1.
 *
 * Usage:
 *   bun run check:dox
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT_DOC = "AGENTS.md";
const SUBTREES = ["apps", "crates", "packages"];
const INDEX_HEADING = "## Child DOX Index";

/** The text of a doc's Child DOX Index section: heading to the next `## `. */
const indexSection = (doc: string): string => {
  const text = readFileSync(doc, "utf8");
  const start = text.indexOf(INDEX_HEADING);
  if (start === -1) {
    return "";
  }
  const rest = text.slice(start);
  const next = rest.indexOf("\n## ", INDEX_HEADING.length);
  return next === -1 ? rest : rest.slice(0, next);
};

/** Direct child dirs of `subtree` that carry a canonical AGENTS.md. */
const indexedChildren = (subtree: string): string[] =>
  readdirSync(subtree, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(subtree, name, "AGENTS.md")))
    .sort();

const collectGaps = (): string[] => {
  const gaps: string[] = [];

  const rootIndex = indexSection(ROOT_DOC);
  for (const subtree of SUBTREES) {
    if (!rootIndex.includes(`${subtree}/`)) {
      gaps.push(`${subtree}/AGENTS.md is not listed in ${ROOT_DOC}`);
    }
  }

  for (const subtree of SUBTREES) {
    const parent = join(subtree, "AGENTS.md");
    if (!existsSync(parent)) {
      gaps.push(`${subtree}/ has no AGENTS.md to index its children`);
      continue;
    }
    const index = indexSection(parent);
    for (const child of indexedChildren(subtree)) {
      if (!index.includes(`${child}/`)) {
        gaps.push(`${child}/AGENTS.md is not listed in ${parent}`);
      }
    }
  }

  return gaps;
};

const gaps = collectGaps();

if (gaps.length > 0) {
  for (const gap of gaps) {
    console.log(`unindexed: ${gap}`);
  }
  process.exit(1);
}

console.log(
  `DOX index complete: every ${SUBTREES.join(", ")} child AGENTS.md is named by its parent.`
);
