/**
 * Regenerate `data/reading/jouhou-upstream.jsonl` — the vendored document
 * snapshots behind the N2/N1 情報検索 store (TASK-173.9.13).
 *
 * This is the ONLY reading pipeline that touches the network at authoring time,
 * and nothing here runs in CI: `gen-reading-jouhou.ts` and
 * `check-reading-jouhou.ts` read the JSONL this script writes, so a row can be
 * audited offline. Each line is one document: its 出典 page, the artifact it was
 * read out of, the sha256 of the bytes that were fetched, the 取得日, and the
 * deterministic extraction (a PDF through `pdftotext -layout`, an HTML page with
 * its tags stripped and each table row flattened to `cell | cell`).
 *
 * Every agency here was read on 2026-10-08 and states PDL1.0 (適用 or 準拠) plus
 * 「コンテンツを編集・加工等して利用する場合は、上記出典とは別に、編集・加工等を行った
 * ことを記載してください」 on its own terms page. Two agencies the earlier probe
 * reached are deliberately NOT here: 日本年金機構 grants 「原則リンクフリー、
 * 転載フリーです」 (https://www.nenkin.go.jp/info/aboutweb/aboutsite.html) but says
 * nothing about 改変, and this store's whole use IS 改変, so its 前納金額一覧 stays
 * out; 日本学生支援機構 refuses 無断転用 outright. 出入国在留管理庁 is included for
 * one document read out of its 別表 pages, and the poster/リーフレット PDFs it links
 * carry a 「別紙のコンテンツについては…この利用ルールとは別のルールが適用されます」
 * caveat, so the fee figures here come from the PDF the ministry itself posts as
 * the 料金表 and the row says so.
 *
 * Run from this package: `bun run fetch:reading-jouhou [--force]`. Without
 * `--force` an existing snapshot line is kept verbatim, so a regeneration cannot
 * silently re-date or re-word a shipped row's source.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  JOUHOU_UPSTREAM_FILE,
  type JouhouUpstream,
} from "./reading-jouhou-corpus";

const CACHE_DIR = new URL("../.cache/jouhou/", import.meta.url).pathname;
const OUT_FILE = new URL(
  `../data/reading/${JOUHOU_UPSTREAM_FILE}`,
  import.meta.url
).pathname;

/** The 取得日 pinned into the data. A regeneration that needs a new date is a
 * deliberate edit, not a side effect of the clock. */
const FETCHED_AT = "2026-10-08";

/** The artifact's extension, dropped from the snapshot id. */
const ARTIFACT_EXTENSION = /\.[a-z]+$/u;

/** The id one snapshot line carries: the document's position in the pinned set
 * plus its artifact stem, so re-ordering the set shows up as a changed id rather
 * than a silent re-keying. */
const docId = (index: number, spec: DocSpec): string =>
  `jh-${index + 1}-${spec.artifact.replace(ARTIFACT_EXTENSION, "")}`;

interface DocSpec {
  readonly agency: string;
  readonly artifact: string;
  /** `html` reads the page's own text; `pdf` runs it through `pdftotext -layout`. */
  readonly kind: "html" | "pdf";
  readonly license: string;
  /** The 出典 page the credit points at. */
  readonly pageUrl: string;
  readonly sha256: string;
  readonly title: string;
  readonly url: string;
}

/** The pinned document set. `sha256` is the artifact the 2026-10-08 extraction
 * was taken from; a mismatch is a changed upstream, which is a decision to
 * re-snapshot rather than a silent re-fetch. */
const DOCS: readonly DocSpec[] = [
  {
    agency: "国税庁",
    artifact: "7140.htm",
    kind: "html",
    license: "PDL-1.0",
    pageUrl: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7140.htm",
    sha256: "5af4db0c1ee3b1d1ae5da8c81d062d20e0562c6dd8cea3fbe3c45c5d865237b6",
    title: "No.7140 印紙税額の一覧表（その1）第1号文書から第4号文書まで",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7140.htm",
  },
  {
    agency: "国税庁",
    artifact: "2260.htm",
    kind: "html",
    license: "PDL-1.0",
    pageUrl: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm",
    sha256: "df00bbd87d20914e8e082d9a1ea5e9ab8d0ad732ffd8d9f81ed1f50aed4d2408",
    title: "No.2260 所得税の税率",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm",
  },
  {
    agency: "厚生労働省",
    artifact: "001753404.pdf",
    kind: "pdf",
    license: "PDL-1.0",
    pageUrl:
      "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/minimumichiran/index.html",
    sha256: "625c6e1fa951f1e6d4291131bfef1a1b3f0b901af8d10c2316be1cc2e7664438",
    title: "令和8年度 地域別最低賃金 全国一覧",
    url: "https://www.mhlw.go.jp/content/11200000/001753404.pdf",
  },
  {
    agency: "厚生労働省",
    artifact: "001630661.pdf",
    kind: "pdf",
    license: "PDL-1.0",
    pageUrl: "https://www.mhlw.go.jp/content/12512000/001630661.pdf",
    sha256: "5c9f4218200fe18d471bf5b61bf2700423cf783dfc2de270887f7705fcf2cade",
    title: "令和8年度における国民年金保険料の前納額について",
    url: "https://www.mhlw.go.jp/content/12512000/001630661.pdf",
  },
  {
    agency: "文部科学省",
    artifact: "1342600.htm",
    kind: "html",
    license: "PDL-1.0",
    pageUrl: "https://www.mext.go.jp/a_menu/shotou/mushouka/1342600.htm",
    sha256: "d563436b4f716d0f0fb6f395d34980b7027b5e8d29fd1bdc36eea8a876fab57b",
    title: "高等学校等就学支援金制度に関するQ＆A",
    url: "https://www.mext.go.jp/a_menu/shotou/mushouka/1342600.htm",
  },
  {
    agency: "出入国在留管理庁",
    artifact: "qaq5.html",
    kind: "html",
    license: "PDL-1.0",
    pageUrl: "https://www.moj.go.jp/isa/applications/status/qaq5.html",
    sha256: "9d1e6b47d096b77507ff7e625225100dd8621976049e161eb7b26221487280a6",
    title: "在留資格一覧表",
    url: "https://www.moj.go.jp/isa/applications/status/qaq5.html",
  },
];

const sha256Of = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const fetchBytes = async (
  url: string,
  artifact: string
): Promise<Uint8Array> => {
  const cached = join(CACHE_DIR, artifact);
  if (existsSync(cached)) {
    return readFileSync(cached);
  }
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; manobu-content-fetch)" },
  });
  if (!response.ok) {
    throw new Error(`fetch ${url} -> HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cached, bytes);
  return bytes;
};

/** Any kana or kanji at all: the proof a page decoded as UTF-8 rather than
 * arriving as Shift_JIS mojibake. */
const JAPANESE_SCRIPT = /[\u3040-\u30ff\u4e00-\u9faf]/u;

const decode = (bytes: Uint8Array): string => {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // 国税庁 and 文科省 still serve Shift_JIS pages; a decode that recovers no
  // Japanese is the signal to try the legacy encoding rather than mojibake.
  if (JAPANESE_SCRIPT.test(utf8)) {
    return utf8;
  }
  return new TextDecoder("shift_jis", { fatal: false }).decode(bytes);
};

/** An HTML page to text: every table row becomes one `cell | cell` line, and
 * prose outside tables keeps its paragraph breaks. Tags go, so the extraction is
 * what a reader of the page sees, not its markup. */
const htmlToText = (markup: string): string => {
  const withoutScript = markup.replace(/<(script|style)[^>]*>.*?<\/\1>/gsu, "");
  const blocks: string[] = [];
  const tableRe = /<table[^>]*>.*?<\/table>/gsu;
  let cursor = 0;
  for (const match of withoutScript.matchAll(tableRe)) {
    blocks.push(textRuns(withoutScript.slice(cursor, match.index ?? 0)));
    const rows: string[] = [];
    for (const row of (match[0] ?? "").matchAll(/<tr[^>]*>.*?<\/tr>/gsu)) {
      const cells = [
        ...(row[0] ?? "").matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/gsu),
      ].map((cell) => collapse(htmlToPlain(cell[1] ?? "")));
      if (cells.length > 0) {
        rows.push(cells.join(" | "));
      }
    }
    blocks.push(rows.join("\n"));
    cursor = (match.index ?? 0) + (match[0] ?? "").length;
  }
  blocks.push(textRuns(withoutScript.slice(cursor)));
  return blocks
    .filter((block) => block.trim().length > 0)
    .join("\n")
    .trim();
};

const htmlToPlain = (markup: string): string =>
  markup.replace(/<[^>]+>/gu, " ");

const collapse = (text: string): string =>
  text.replace(/[\s\u3000]+/gu, " ").trim();

/** Prose with each block on its own line, empty blocks dropped. */
const textRuns = (markup: string): string => {
  const withBreaks = markup
    .replace(/<\/(p|div|li|h[1-6]|dd|dt|section|header)>/giu, "\n")
    .replace(/<(br|hr)[^>]*>/giu, "\n");
  return withBreaks
    .split("\n")
    .map((line) => collapse(htmlToPlain(line)))
    .filter((line) => line.length > 0)
    .join("\n");
};

const pdfToText = async (artifact: string): Promise<string> => {
  const path = join(CACHE_DIR, artifact);
  const proc = Bun.spawn(["pdftotext", "-layout", path, "-"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  const status = await proc.exited;
  if (status !== 0) {
    throw new Error(`pdftotext failed for ${artifact} (${status})`);
  }
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\u3000]+/gu, " ").trimEnd())
    .join("\n")
    .trim();
};

const snapshotFor = async (
  spec: DocSpec,
  index: number
): Promise<JouhouUpstream> => {
  const bytes = await fetchBytes(spec.url, spec.artifact);
  const digest = sha256Of(bytes);
  const text =
    spec.kind === "pdf"
      ? await pdfToText(spec.artifact)
      : htmlToText(decode(bytes));
  return {
    agency: spec.agency,
    docUrl: spec.url,
    fetchedAt: FETCHED_AT,
    id: docId(index, spec),
    license: spec.license,
    pageUrl: spec.pageUrl,
    sha256: digest,
    text,
    title: spec.title,
  };
};

const existing = (): Map<string, JouhouUpstream> => {
  if (!existsSync(OUT_FILE)) {
    return new Map();
  }
  const map = new Map<string, JouhouUpstream>();
  for (const line of readFileSync(OUT_FILE, "utf8").split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const row = JSON.parse(line) as JouhouUpstream;
    map.set(row.id, row);
  }
  return map;
};

const force = process.argv.includes("--force");
const kept = existing();
mkdirSync(CACHE_DIR, { recursive: true });
const lines: string[] = [];
for (const [index, spec] of DOCS.entries()) {
  const id = docId(index, spec);
  const prior = kept.get(id);
  if (prior !== undefined && !force) {
    lines.push(JSON.stringify(prior));
    console.log(`kept ${id} (${prior.text.length} runes)`);
    continue;
  }
  // biome-ignore lint/performance/noAwaitInLoops: one ministry document at a time is the politeness this script is written for; firing six fetches (and six `pdftotext` runs) in parallel at 国税庁 or 厚労省 is the burst behaviour `fetch-hakusho.ts` had to back off from
  const snapshot = await snapshotFor(spec, index);
  if (spec.sha256.length > 0 && snapshot.sha256 !== spec.sha256) {
    throw new Error(
      `${id}: the fetched artifact is ${snapshot.sha256}, not the pinned ${spec.sha256}`
    );
  }
  lines.push(JSON.stringify(snapshot));
  console.log(`wrote ${id} (${snapshot.text.length} runes)`);
}
writeFileSync(OUT_FILE, `${lines.join("\n")}\n`, "utf8");
console.log(
  `${JOUHOU_UPSTREAM_FILE}: ${lines.length} document snapshot(s), 取得日 ${FETCHED_AT}`
);
