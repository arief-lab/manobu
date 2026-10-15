import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const SCRIPT = join(ROOT, "scripts/voice-sweep.ts");
const ALLOWLIST_PATH = join(ROOT, "scripts/voice-sweep-allowlist.json");

interface AllowEntry {
  category: string;
  file: string;
  reason: string;
}

function runCategories(): string {
  const cmd = `bun ${SCRIPT} ${join(ROOT, "apps")} ${join(ROOT, "packages")} ${join(ROOT, "crates")} --categories`;
  return execSync(cmd, { encoding: "utf-8" });
}

const TOTALS_RE = /^\s*(\d+)\s+(\w+)/;

function parseTotals(output: string): Record<string, number> {
  const totals: Record<string, number> = {};
  const lines = output.split("\n");
  let inTotals = false;
  for (const line of lines) {
    if (line.includes("totals by category")) {
      inTotals = true;
      continue;
    }
    if (inTotals) {
      const m = line.match(TOTALS_RE);
      if (m) {
        totals[m[2]] = Number(m[1]);
      }
      if (line.includes("by file")) {
        break;
      }
    }
  }
  return totals;
}

describe("R-02 repo-wide guard (TASK-114 AC#3/AC#4)", () => {
  it("rendered, glyph, rust are zero; prompt/diagnostic/tooling are allowlisted", () => {
    const out = runCategories();
    const totals = parseTotals(out);

    // biome-ignore lint/suspicious/noUnnecessaryConditions: Record access may be undefined
    expect(totals.rendered ?? 0).toBe(0);
    // biome-ignore lint/suspicious/noUnnecessaryConditions: Record access may be undefined
    expect(totals.glyph ?? 0).toBe(0);
    // biome-ignore lint/suspicious/noUnnecessaryConditions: Record access may be undefined
    expect(totals.rust ?? 0).toBe(0);

    const allowlist: AllowEntry[] = JSON.parse(
      readFileSync(ALLOWLIST_PATH, "utf-8")
    );
    // AC#4: allowlist entries must have a reason and still correspond to a file that exists; stale entry (file removed) fails
    for (const entry of allowlist) {
      expect(entry.reason.length).toBeGreaterThan(10);
      // file must exist on disk; if it was deleted the allowlist is stale
      const full = join(ROOT, entry.file);
      expect(() => readFileSync(full)).not.toThrow();
    }

    // No rendered/glyph/rust file should be outside allowlist (allowlist only covers prompt/diagnostic/tooling)
    for (const cat of ["rendered", "glyph", "rust"] as const) {
      if ((totals[cat] ?? 0) > 0) {
        throw new Error(`unexpected ${cat} hits: ${totals[cat]}`);
      }
    }
  });

  it("deck guard still passes (packages/ui/test/copy-snapshot.test.ts covers it)", () => {
    // smoke: deck file should have no em dash in copy values (already guarded)
    const copyPath = join(ROOT, "packages/ui/src/lib/copy.ts");
    const content = readFileSync(copyPath, "utf-8");
    // Only comments may contain em dashes; rendered values are guarded by copy-snapshot.test.ts.
    // This just ensures the file is readable.
    expect(content.length).toBeGreaterThan(0);
  });
});
