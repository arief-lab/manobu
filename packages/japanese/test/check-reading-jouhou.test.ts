/**
 * `check:reading-jouhou` is pinned with real data over the real vendored snapshot:
 * the valid row is built by the REAL generator (`buildJouhouRow`) and proven by the
 * REAL gate (`checkEntry`), so the two halves cannot drift, and every defect this
 * gate exists to catch comes back with its own issue code. A lost signature, a lost
 * validation flag, a lost construction tag, a foreign block, a level the block does
 * not print, a 素材 outside the band, a cell the document never printed, a distractor
 * sitting in the key line the stem names, an answer outside that key, a broken
 * obligation, an unpinned or undated snapshot, a judge rejection, and a distractor
 * readable from another 素材.
 *
 * The last two groups are this store's own. The obligations are not decoration:
 * PDL1.0 and the 準拠 wording these agencies use ask for the 出典 with the page URL,
 * a statement that the content was 編集・加工 and by whom, and an 取得日, because a
 * 令和8年度 fee table is a document about a year (AC#2, AC#3). And the cross-document
 * rule is what keeps a lookup a lookup: a distractor printed by a DIFFERENT 素材
 * would let a reader answer without finding this one, while a distractor taken from
 * another row of the SAME table is the genre (AC#6).
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkEntry,
  checkReadingFile,
  type EntryReport,
} from "../scripts/check-reading-jouhou";
import {
  buildJouhouRow,
  jouhouMaterials,
  jouhouSpecs,
} from "../scripts/gen-reading-jouhou";
import {
  compact,
  JOUHOU_AUTHORED_CONSTRUCTION,
  JOUHOU_BLOCK,
  JOUHOU_CONSTRUCTION,
  JOUHOU_LICENSE,
  JOUHOU_MIN_DISTINCT_PASSAGES,
  JOUHOU_SIGNER,
  type JouhouStoreRow,
  type JouhouUpstream,
  jouhouCrossRowIssues,
  jouhouPassageUnits,
  jouhouStorePath,
  readJouhouRejections,
  readJouhouUpstream,
} from "../scripts/reading-jouhou-corpus";

const DATA_DIR = join(import.meta.dir, "..", "data", "reading");
const upstreams = readJouhouUpstream(DATA_DIR);

const buildRow = (
  level: string,
  material: string,
  sequence: number
): JouhouStoreRow => {
  const spec = jouhouSpecs.find(
    (each) =>
      each.level === level &&
      each.material === material &&
      each.sequence === sequence
  );
  const source = jouhouMaterials.find((each) => each.slug === material);
  const upstream = upstreams.find((each) => each.id === source?.upstreamId);
  if (spec === undefined || upstream === undefined) {
    throw new Error(`${level} ${material}#${sequence} is not vendored`);
  }
  return buildJouhouRow(spec, upstream);
};

const inshi = buildRow("N2", "inshi", 1);
const inshiUpstream = upstreams.find((each) => each.id === "jh-1-7140");
if (inshiUpstream === undefined) {
  throw new Error("the 印紙税 snapshot is missing from jouhou-upstream.jsonl");
}

const issuesOf = (
  row: JouhouStoreRow,
  upstream: JouhouUpstream | undefined = inshiUpstream,
  rejections: ReadonlySet<string> = new Set()
): readonly string[] => checkEntry({ rejections, row, upstream });

const writeStore = (
  dir: string,
  level: string,
  rows: readonly JouhouStoreRow[]
): string => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "jouhou-upstream.jsonl"),
    readFileSync(join(DATA_DIR, "jouhou-upstream.jsonl"), "utf8"),
    "utf8"
  );
  const storePath = jouhouStorePath(dir, level);
  writeFileSync(storePath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  return storePath;
};

const failingOf = (reports: readonly EntryReport[]): string[] =>
  reports
    .filter((report) => report.issues.length > 0)
    .flatMap((report) =>
      report.issues.map((issue) => `${report.entryId}:${issue}`)
    );

describe("check:reading-jouhou", () => {
  it("passes a row the generator built", () => {
    expect(issuesOf(inshi)).toEqual([]);
  });

  it("rejects a row whose provenance chain is not this pipeline's", () => {
    expect(issuesOf({ ...inshi, provenance: "licensed" })).toContain(
      "wrong-provenance"
    );
    expect(issuesOf({ ...inshi, validated: false })).toContain("unvalidated");
    expect(issuesOf({ ...inshi, validatedBy: "llm:judge" })).toContain(
      "wrong-signer"
    );
    expect(issuesOf({ ...inshi, construction: "masked-slot" })).toContain(
      "wrong-construction"
    );
    expect(issuesOf({ ...inshi, block: "naiyou-rikai-choubun" })).toContain(
      "wrong-block"
    );
    expect(issuesOf({ ...inshi, level: "N3" })).toContain("level-not-n2-or-n1");
    expect(issuesOf({ ...inshi, sourceIds: [] })).toContain("no-source-ids");
  });

  it("rejects a 素材 outside the band the engine budgets for one", () => {
    const short = issuesOf({ ...inshi, passage: inshi.passage.slice(0, 300) });
    expect(short.some((issue) => issue.startsWith("passage-too-short:"))).toBe(
      true
    );
    const long = issuesOf({
      ...inshi,
      passage: `${inshi.passage}\n${"※".repeat(200)}`,
    });
    expect(long.some((issue) => issue.startsWith("passage-too-long:"))).toBe(
      true
    );
  });

  it("rejects a cell the vendored document never printed", () => {
    const tampered = {
      ...inshi,
      passage: inshi.passage.replace(
        "100万円を超え500万円以下",
        "100万円を超え900万円以下"
      ),
    };
    expect(issuesOf(tampered)).toContain(
      "printed-unit-not-in-upstream:100万円を超え900万円以下"
    );
  });

  it("keeps the whitespace, and the numbers, the snapshot carries", () => {
    // A `pdftotext -layout` page pads its grid; the row's markdown does not. The
    // verbatim check is whitespace-insensitive for exactly that reason, so a
    // reflowed row is still the document's own text.
    const reflowed = inshi.passage.replace(
      "10万円を超え50万円以下",
      "10万円 を 超え 50万円 以下"
    );
    expect(compact(reflowed)).toBe(compact(inshi.passage));
    expect(issuesOf({ ...inshi, passage: reflowed })).toEqual([]);
  });

  it("rejects a question the printed 素材 does not answer once", () => {
    expect(
      issuesOf({ ...inshi, options: ["400円", "1万円", "2千円"] })
    ).toContain("options-not-four");
    expect(
      issuesOf({ ...inshi, options: ["400円", "400円", "2千円", "1千円"] })
    ).toContain("duplicate-option");
    expect(
      issuesOf({ ...inshi, options: ["400円", "1000 yen", "2千円", "1千円"] })
    ).toContain("latin-in-japanese-item");
    // Written against the row's OWN answer slot, because the option order here is
    // authored to spread the key position, not pinned to index 2.
    const answerNotPrinted = [...inshi.options];
    answerNotPrinted[inshi.answerIndex] = "999万円";
    expect(issuesOf({ ...inshi, options: answerNotPrinted })).toContain(
      "answer-not-printed-in-passage"
    );
    expect(issuesOf({ ...inshi, key: [] })).toContain("key-empty");
    expect(issuesOf({ ...inshi, key: ["存在しない行 | 2千円"] })).toContain(
      "key-line-not-printed:存在しない行 | 2千円"
    );
    expect(
      issuesOf({ ...inshi, key: ["50万円を超え100万円以下 | 1千円"] })
    ).toContain("answer-not-in-key-line");
    expect(
      issuesOf({
        ...inshi,
        key: [
          "50万円を超え100万円以下 | 1千円",
          "100万円を超え500万円以下 | 2千円",
        ],
      })
    ).toContain("distractor-in-key-line:1千円");
  });

  it("rejects a row that drops one of the three obligations", () => {
    const issues = issuesOf({ ...inshi, sourceCredit: "出典：国税庁" });
    expect(issues).toContain("credit-missing-page-url");
    expect(issuesOf({ ...inshi, sourceCredit: "" })).toContain(
      "credit-missing"
    );
    expect(issuesOf({ ...inshi, sourceUrl: "https://example.com" })).toContain(
      "source-url-not-page-url"
    );
    expect(issuesOf({ ...inshi, editedCredit: "" })).toContain(
      "edit-statement-missing"
    );
    expect(
      issuesOf({
        ...inshi,
        editedCredit: "この素材は編集・加工したものです",
      })
    ).toContain("edit-actor-missing");
    expect(issuesOf({ ...inshi, acquiredAt: "2020-01-01" })).toContain(
      "acquired-at-not-the-snapshot"
    );
    expect(issuesOf({ ...inshi, license: "CC-BY-4.0" })).toContain(
      "license-not-pdl10"
    );
  });

  it("rejects a snapshot that cannot be attributed", () => {
    expect(issuesOf(inshi, { ...inshiUpstream, sha256: "todo" })).toContain(
      "snapshot-artifact-unpinned"
    );
    expect(issuesOf(inshi, { ...inshiUpstream, fetchedAt: "" })).toContain(
      "snapshot-undated"
    );
    expect(issuesOf(inshi, { ...inshiUpstream, text: "" })).toContain(
      "snapshot-empty"
    );
    // A row citing a document the snapshot does not hold has nothing to prove its
    // cells, so the gate names the missing snapshot rather than pass it. The id is
    // resolved from the row, which is what `checkReadingFile` does.
    const dir = mkdtempSync(join(tmpdir(), "jouhou-nosource-"));
    const storePath = writeStore(dir, "N2", [
      { ...inshi, sourceIds: ["jh-9-unknown"] },
      buildRow("N2", "shotoku", 1),
    ]);
    expect(failingOf(checkReadingFile({ level: "N2", storePath }))).toContain(
      `${inshi.id}:source-not-in-upstream`
    );
  });

  it("rejects a row the blind judge turned down", () => {
    expect(issuesOf(inshi, inshiUpstream, new Set([inshi.id]))).toContain(
      "row-judge-rejected"
    );
  });

  it("flags a distractor readable from another 素材, not from this one", () => {
    const kyuugaku = buildRow("N2", "kyuugaku", 1);
    // "400円" is a cell of the 印紙税 table. Printing it inside the 就学支援金
    // 素材 would let a reader answer the 印紙税 小問 out of the wrong document.
    const leaky = {
      ...kyuugaku,
      passage: `${kyuugaku.passage}\n> なお、400円の申請料はかかりません。`,
    };
    const issues = jouhouCrossRowIssues([inshi, leaky]);
    expect(issues.some((issue) => issue.includes(":400円"))).toBe(true);
    expect(jouhouCrossRowIssues([inshi, kyuugaku])).toEqual([]);
    // Two questions over ONE 素材 share their table by design, so a value the
    // sibling prints is not a cross-document leak.
    expect(jouhouCrossRowIssues([inshi, buildRow("N2", "inshi", 2)])).toEqual(
      []
    );
  });

  it("checks the whole shipped store, at both levels", () => {
    for (const level of ["N2", "N1"]) {
      const reports = checkReadingFile({
        level,
        storePath: jouhouStorePath(DATA_DIR, level),
      });
      expect(failingOf(reports)).toEqual([]);
      expect(reports.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("reports a store that cannot fill a 大問", () => {
    const dir = mkdtempSync(join(tmpdir(), "jouhou-store-"));
    const storePath = writeStore(dir, "N2", [inshi]);
    const reports = checkReadingFile({ level: "N2", storePath });
    const issues = failingOf(reports);
    expect(issues.some((issue) => issue.includes("too-few-items:1<4"))).toBe(
      true
    );
    expect(
      issues.some((issue) => issue.includes("too-few-materials:1<2"))
    ).toBe(true);
  });

  it("reports a store that repeats itself", () => {
    const dir = mkdtempSync(join(tmpdir(), "jouhou-dupe-"));
    const rows = [
      inshi,
      inshi,
      buildRow("N2", "shotoku", 1),
      buildRow("N2", "kyuugaku", 1),
    ];
    const storePath = writeStore(dir, "N2", rows);
    const reports = checkReadingFile({ level: "N2", storePath });
    const issues = failingOf(reports);
    expect(issues).toContain(`${inshi.id}:duplicate-id`);
    expect(issues).toContain(`${inshi.id}:duplicate-stem`);
  });

  it("reads the judge record only, and never invents one", () => {
    const dir = mkdtempSync(join(tmpdir(), "jouhou-reject-"));
    expect(readJouhouRejections(dir, "N2")).toEqual(new Set<string>());
    writeFileSync(
      join(dir, "n2-jouhou-rejected.json"),
      JSON.stringify({ rejectedIds: [inshi.id, "n2j-shotoku-1"] }),
      "utf8"
    );
    expect(readJouhouRejections(dir, "N2")).toEqual(
      new Set<string>([inshi.id, "n2j-shotoku-1"])
    );
  });

  it("takes its units from the rendered 素材, not the markdown furniture", () => {
    const units = jouhouPassageUnits(inshi.passage);
    expect(units).toContain(
      "No.7140 印紙税額の一覧表（その1）第1号文書から第4号文書まで"
    );
    expect(units).toContain("100万円を超え500万円以下");
    expect(units).toContain("2千円");
    expect(units).not.toContain("---");
    expect(units).not.toContain("");
    expect(inshi.block).toBe(JOUHOU_BLOCK);
    expect(inshi.construction).toBe(JOUHOU_CONSTRUCTION);
    expect(inshi.validatedBy).toBe(JOUHOU_SIGNER);
    expect(inshi.license).toBe(JOUHOU_LICENSE);
  });
});

/**
 * The second route into this block: N3's official ねらい is a 書き下ろした情報素材,
 * which is by definition not a document, so there is nothing to pin, no 出典 to
 * print and no sha256 to attribute. What is NOT relaxed is the property that makes
 * a 情報検索 item decidable: the stem names printed cells, the answer sits in those
 * cells, no distractor does, and no distractor is readable from a different 素材.
 * These tests run the REAL shipped N3 store through the REAL gate, so an authored
 * store and its screens cannot drift apart.
 */
describe("check:reading-jouhou: the authored route", () => {
  const authored = JSON.parse(
    readFileSync(jouhouStorePath(DATA_DIR, "N3"), "utf8")
  ) as JouhouStoreRow[];
  const [first] = authored;
  if (first === undefined) {
    throw new Error("the shipped N3 情報検索 store is empty");
  }

  const authoredIssuesOf = (
    row: JouhouStoreRow,
    rejections: ReadonlySet<string> = new Set()
  ): readonly string[] => checkEntry({ rejections, row, upstream: undefined });

  it("passes a written-down 素材 that claims no document", () => {
    expect(authoredIssuesOf(first)).toEqual([]);
    expect(first.construction).toBe(JOUHOU_AUTHORED_CONSTRUCTION);
    expect(first.sourceIds).toBeUndefined();
  });

  it("refuses an authored row that prints an attribution it cannot prove", () => {
    expect(
      authoredIssuesOf({ ...first, sourceCredit: "出典：某市" })
    ).toContain("authored-row-claims-an-attribution");
    expect(authoredIssuesOf({ ...first, license: "PDL-1.0" })).toContain(
      "authored-row-claims-an-attribution"
    );
    expect(authoredIssuesOf({ ...first, sourceIds: ["jh-1-7140"] })).toContain(
      "authored-row-cites-a-document"
    );
  });

  it("refuses the pipeline's stamp on a row no pipeline built", () => {
    expect(
      authoredIssuesOf({ ...first, validatedBy: JOUHOU_SIGNER })
    ).toContain("wrong-signer");
    // Re-tagging an authored row as `sourced-table` does not make it one: it now
    // owes a snapshot it cannot name, so both branches refuse it for their own
    // reason and neither silently passes it.
    const retagged = authoredIssuesOf({
      ...first,
      construction: JOUHOU_CONSTRUCTION,
    });
    expect(retagged).toContain("source-not-in-upstream");
    expect(retagged).toContain("level-not-n2-or-n1");
    expect(
      authoredIssuesOf({ ...first, construction: "masked-slot" })
    ).toContain("wrong-construction");
  });

  it("refuses an authored row at a level this block does not compose", () => {
    const issues = authoredIssuesOf({ ...first, level: "N2" });
    expect(issues).toContain("level-not-authored:N2");
    expect(issues).toContain("authored-band-unknown:N2");
  });

  it("measures an authored 素材 against the band its own level budgets", () => {
    // N3's ねらい says 600字程度; the sourced band's 600 floor belongs to the
    // 700字素材 of N2/N1, so an authored page below its own 500 must not inherit it.
    const short = authoredIssuesOf({
      ...first,
      passage: first.passage.slice(0, 400),
    });
    expect(short.some((issue) => issue.startsWith("passage-too-short:"))).toBe(
      true
    );
    const long = authoredIssuesOf({
      ...first,
      passage: `${first.passage}\n${"※".repeat(200)}`,
    });
    expect(long.some((issue) => issue.startsWith("passage-too-long:"))).toBe(
      true
    );
  });

  it("keeps the lookup screens on the authored branch, where they are the whole argument", () => {
    const answerOffKey = [...first.options];
    answerOffKey[first.answerIndex] = "999円";
    expect(authoredIssuesOf({ ...first, options: answerOffKey })).toContain(
      "answer-not-printed-in-passage"
    );
    expect(authoredIssuesOf({ ...first, key: [] })).toContain("key-empty");
    expect(
      authoredIssuesOf({ ...first, key: ["存在しない行 | 1人"] })
    ).toContain("key-line-not-printed:存在しない行 | 1人");
    expect(authoredIssuesOf({ ...first, key: [first.stem] })).toContain(
      "answer-not-in-key-line"
    );
  });

  it("checks the whole shipped N3 store, and counts its 素材 by the page", () => {
    const reports = checkReadingFile({
      level: "N3",
      storePath: jouhouStorePath(DATA_DIR, "N3"),
    });
    expect(failingOf(reports)).toEqual([]);
    expect(reports.length).toBeGreaterThanOrEqual(8);
    expect(
      new Set(authored.map((row) => row.passage)).size
    ).toBeGreaterThanOrEqual(JOUHOU_MIN_DISTINCT_PASSAGES);
    // Two questions over one authored 素材 share the page byte-for-byte, so the
    // page itself is the document identity and a sibling is not a leak.
    const [, sibling, third] = authored;
    if (sibling === undefined || third === undefined) {
      throw new Error(
        "the N3 store needs two rows per 素材 and a second 素材 to prove the leak rule"
      );
    }
    expect(sibling.passage).toBe(first.passage);
    expect(jouhouCrossRowIssues([first, sibling])).toEqual([]);
    // A value another 素材 prints and this page repeats IS a leak, decided by the
    // passage rather than a source id an authored row does not carry.
    const borrowed = third.options.find(
      (option, index) =>
        index !== third.answerIndex && compact(option).length >= 3
    );
    if (borrowed === undefined) {
      throw new Error(`${third.id} prints no usable distractor to leak`);
    }
    const leaked = {
      ...first,
      passage: `${first.passage}\n> なお、${borrowed}についても同じです。`,
    };
    const leaks = jouhouCrossRowIssues([leaked, third]);
    expect(leaks.some((issue) => issue.includes(`:${borrowed}`))).toBe(true);
    expect(
      leaks.every((issue) =>
        issue.startsWith("distractor-printed-in-another-material:")
      )
    ).toBe(true);
  });

  it("refuses a store too small to fill N3's 大問7", () => {
    const dir = mkdtempSync(join(tmpdir(), "jouhou-authored-"));
    writeFileSync(
      join(dir, "jouhou-upstream.jsonl"),
      readFileSync(join(DATA_DIR, "jouhou-upstream.jsonl"), "utf8"),
      "utf8"
    );
    const storePath = jouhouStorePath(dir, "N3");
    writeFileSync(
      storePath,
      `${JSON.stringify(authored.slice(0, 4), null, 2)}\n`,
      "utf8"
    );
    const issues = failingOf(checkReadingFile({ level: "N3", storePath }));
    expect(issues.some((issue) => issue.includes("too-few-items:4<8"))).toBe(
      true
    );
  });
});
