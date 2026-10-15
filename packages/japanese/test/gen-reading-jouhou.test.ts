/**
 * The 情報検索 generator is pinned with real data, not source-text reads (TASK-134):
 * these tests build rows through the REAL `buildJouhouRow` against the REAL vendored
 * snapshot, and assert that the shipped store files are exactly what that build
 * produces. That is the property a composed store needs: the JSON a paper prints is
 * the JSON this script writes, and the material in it is the document in
 * `jouhou-upstream.jsonl`.
 *
 * The guards are pinned too, because a generator that only ever succeeds proves
 * nothing. An authored unit the snapshot does not print stops the build, an option
 * that sits inside the key line the stem names stops it, an answer outside the key
 * stops it, and a 素材 outside the 600-800 rune band stops it, so a row can only
 * ship if the printed cells really answer the question.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertJouhouVerbatim,
  buildJouhouRow,
  type JouhouSpec,
  jouhouMaterials,
  jouhouSpecs,
} from "../scripts/gen-reading-jouhou";
import {
  JOUHOU_MAX_PASSAGE_LENGTH,
  JOUHOU_MIN_DISTINCT_PASSAGES,
  JOUHOU_MIN_PASSAGE_LENGTH,
  type JouhouStoreRow,
  type JouhouUpstream,
  jouhouBandIssues,
  jouhouSourceIssues,
  jouhouStorePath,
  readJouhouUpstream,
  renderJouhouPassage,
} from "../scripts/reading-jouhou-corpus";

const DATA_DIR = join(import.meta.dir, "..", "data", "reading");
const upstreams = readJouhouUpstream(DATA_DIR);

const specOf = (
  level: string,
  material: string,
  sequence: number
): JouhouSpec => {
  const spec = jouhouSpecs.find(
    (each) =>
      each.level === level &&
      each.material === material &&
      each.sequence === sequence
  );
  if (spec === undefined) {
    throw new Error(`no ${level} spec for ${material}#${sequence}`);
  }
  return spec;
};

const upstreamOf = (materialSlug: string): JouhouUpstream => {
  const material = jouhouMaterials.find((each) => each.slug === materialSlug);
  const upstream = upstreams.find((each) => each.id === material?.upstreamId);
  if (material === undefined || upstream === undefined) {
    throw new Error(`${materialSlug} is not vendored in jouhou-upstream.jsonl`);
  }
  return upstream;
};

const rowOf = (
  level: string,
  material: string,
  sequence: number
): JouhouStoreRow =>
  buildJouhouRow(specOf(level, material, sequence), upstreamOf(material));

describe("gen:reading-jouhou", () => {
  it("writes exactly the store the shipped files hold", () => {
    for (const level of ["N2", "N1"]) {
      const rows = jouhouSpecs
        .filter((spec) => spec.level === level)
        .map((spec) => buildJouhouRow(spec, upstreamOf(spec.material)));
      const shipped = JSON.parse(
        readFileSync(jouhouStorePath(DATA_DIR, level), "utf8")
      ) as readonly JouhouStoreRow[];
      expect(shipped).toEqual(rows);
    }
  });

  it("supplies a 大問's two 小問 from two distinct 素材 per level", () => {
    for (const level of ["N2", "N1"]) {
      const rows = jouhouSpecs
        .filter((spec) => spec.level === level)
        .map((spec) => buildJouhouRow(spec, upstreamOf(spec.material)));
      const materials = new Set(rows.map((row) => row.sourceIds?.[0] ?? ""));
      expect(rows.length).toBeGreaterThanOrEqual(4);
      expect(materials.size).toBeGreaterThanOrEqual(
        JOUHOU_MIN_DISTINCT_PASSAGES
      );
    }
  });

  it("prints every 素材 inside the band the engine budgets for one", () => {
    for (const spec of jouhouSpecs) {
      const row = buildJouhouRow(spec, upstreamOf(spec.material));
      const runes = [...row.passage].length;
      expect(runes).toBeGreaterThanOrEqual(JOUHOU_MIN_PASSAGE_LENGTH);
      expect(runes).toBeLessThanOrEqual(JOUHOU_MAX_PASSAGE_LENGTH);
      expect(jouhouBandIssues(row.passage)).toEqual([]);
    }
  });

  it("proves every authored unit against the snapshot it cites", () => {
    for (const spec of jouhouSpecs) {
      expect(() =>
        assertJouhouVerbatim(spec, upstreamOf(spec.material))
      ).not.toThrow();
    }
  });

  it("prints the same document to both questions asked of it", () => {
    const first = rowOf("N2", "inshi", 1);
    const second = rowOf("N2", "inshi", 2);
    expect(second.passage).toBe(first.passage);
    expect(second.id).not.toBe(first.id);
    expect(second.stem).not.toBe(first.stem);
  });

  it("stops on a key line the 素材 answers twice", () => {
    const spec = specOf("N2", "inshi", 1);
    const tampered: JouhouSpec = {
      ...spec,
      // "1千円" is the cell directly above the answer's, so the same key row
      // would answer the stem twice.
      key: [
        "50万円を超え100万円以下 | 1千円",
        "100万円を超え500万円以下 | 2千円",
      ],
    };
    expect(() => buildJouhouRow(tampered, upstreamOf("inshi"))).toThrow(
      "distractor-in-key-line"
    );
  });

  it("stops on an answer the printed cells do not hold", () => {
    const spec = specOf("N2", "shotoku", 1);
    const tampered: JouhouSpec = {
      ...spec,
      key: ["1,000円 から 1,949,000円まで | 5％ | 0円"],
    };
    expect(() => buildJouhouRow(tampered, upstreamOf("shotoku"))).toThrow(
      "answer-not-in-key-line"
    );
  });

  it("stops on a 素材 outside the band", () => {
    const upstream = upstreamOf("zenno");
    const tooShort = renderJouhouPassage({
      header: [],
      lines: ["前納制度"],
      notes: [],
      rows: [],
      title: upstream.title,
    });
    expect(
      jouhouBandIssues(tooShort).some((issue) =>
        issue.startsWith("passage-too-short:")
      )
    ).toBe(true);
    const material = jouhouMaterials.find((each) => each.slug === "zenno");
    if (material === undefined) {
      throw new Error("zenno material is missing");
    }
    const tooLong = renderJouhouPassage({
      ...material,
      notes: [...material.notes, ...material.lines],
    });
    expect(
      jouhouBandIssues(tooLong).some((issue) =>
        issue.startsWith("passage-too-long:")
      )
    ).toBe(true);
  });

  it("refuses a cell the snapshot never printed", () => {
    const material = jouhouMaterials.find((each) => each.slug === "inshi");
    if (material === undefined) {
      throw new Error("inshi material is missing");
    }
    const assembly = {
      ...material,
      rows: [["100万円を超え500万円以下", "999万円"]],
    };
    const issues = jouhouSourceIssues({
      assembly,
      passage: renderJouhouPassage(assembly),
      upstream: upstreamOf("inshi"),
    });
    expect(issues).toContain("printed-unit-not-in-upstream:999万円");
  });
});
