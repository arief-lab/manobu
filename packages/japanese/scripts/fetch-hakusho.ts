/**
 * Regenerate `data/reading/hakusho.jsonl` — the sourced corpus for the N2/N1
 * reading pipeline (TASK-173.9.2/173.9.3).
 *
 * Source: 令和6年版・令和5年版・令和7年版 環境白書 (白書, Ministry of the
 * Environment), 250 pinned pages. Reuse is
 * governed by the 公共データ利用規約 1.0 (PDL1.0, attribution-only), which
 * 環境省 confirms on its own 著作権 page (`https://www.env.go.jp/mail.html`);
 * the required credit is "出典：環境省ホームページ（当該ページのURL）". Unlike
 * the Tatoeba store (a sentence corpus), the 白書 register is the dense
 * non-fiction prose a real N2/N1 中文読解 passage is printed in.
 *
 * Why this corpus and not Aozora / ja.wikipedia: measured against the shipped
 * cumulative N5-N1 vocabulary, Aozora pre-war prose and jawiki were both under
 * the coverage bar while the 白書 pages cleared it. See
 * `data/LICENSE.md` §13 for the probe and the numbers.
 *
 * One JSONL line per PARAGRAPH (`<p>` block), because the pipeline's unit is a
 * passage, not a page: `{ id, pageId, pageUrl, title, license, source, text }`.
 * `pageUrl` is the attribution link the store must print; `source` is the
 * credit string with that link substituted.
 *
 * The upstream pages mix encodings (Shift-JIS and UTF-8), so a decode is scored
 * by how many real kana/kanji it recovers, not by "did it throw" — a Shift-JIS
 * page read as Latin-1 decodes "successfully" into mojibake. The ministry also
 * throttles burst traffic with HTTP 200 near-empty pages (then IP-wide 403s),
 * so a refused decode is RETRIED with backoff and pages are fetched in small
 * sequential batches, never one wide parallel sweep. That machinery is shared
 * with the source probes through `html-prose.ts`, so a candidate corpus is read
 * with the SAME extractor that built this one and the two numbers mean the same
 * thing.
 *
 * Run from this package: `bun run fetch:hakusho [--force]`.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  fetchHtmlPage,
  type ProseParagraph,
  proseParagraphsOf,
} from "./html-prose";

// --- Upstreams (pinned) ------------------------------------------------------

const CACHE_DIR = new URL("../.cache/hakusho/", import.meta.url);
const OUT_FILE = new URL("../data/reading/hakusho.jsonl", import.meta.url);

/** The attribution credit PDL1.0 asks for, with the page URL substituted. */
const creditFor = (pageUrl: string): string =>
  `出典：環境省ホームページ（${pageUrl}）`;

/**
 * The pinned page set — 250 pages: 84 section pages of 令和6年版 環境白書
 * (ids like `1-1-1`), 87 of 令和5年版 (`r05-...`) and 79 of 令和7年版
 * (`r07-...`), minus a handful of pages per year so short they tripped the
 * decode guard's 200-char floor (each ≤4 prose paragraphs): r06 `2-4-3` and 9
 * part-3 pages; r05 8 part-3 pages; r07 `2-4-6`, `2-4-7` and 12 part-3 pages.
 * The ORIGINAL 22 narrative pages are pinned FIRST so a regeneration keeps
 * every existing store row at the same corpus position and only appends new
 * candidates.
 */
const PAGES: readonly { id: string; year: string; path: string }[] = [
  { id: "1-1-1", path: "html/hj24010101.html", year: "r06" },
  { id: "1-1-2", path: "html/hj24010102.html", year: "r06" },
  { id: "1-2-1", path: "html/hj24010201.html", year: "r06" },
  { id: "1-2-2", path: "html/hj24010202.html", year: "r06" },
  { id: "1-2-3", path: "html/hj24010203.html", year: "r06" },
  { id: "1-2-4", path: "html/hj24010204.html", year: "r06" },
  { id: "1-3-1", path: "html/hj24010301.html", year: "r06" },
  { id: "1-3-2", path: "html/hj24010302.html", year: "r06" },
  { id: "1-3-3", path: "html/hj24010303.html", year: "r06" },
  { id: "1-3-4", path: "html/hj24010304.html", year: "r06" },
  { id: "1-4-1", path: "html/hj24010401.html", year: "r06" },
  { id: "1-4-2", path: "html/hj24010402.html", year: "r06" },
  { id: "1-4-3", path: "html/hj24010403.html", year: "r06" },
  { id: "1-4-4", path: "html/hj24010404.html", year: "r06" },
  { id: "1-4-5", path: "html/hj24010405.html", year: "r06" },
  { id: "2-1-1", path: "html/hj24020101.html", year: "r06" },
  { id: "2-1-2", path: "html/hj24020102.html", year: "r06" },
  { id: "2-6-1", path: "html/hj24020601.html", year: "r06" },
  { id: "2-6-2", path: "html/hj24020602.html", year: "r06" },
  { id: "2-6-3", path: "html/hj24020603.html", year: "r06" },
  { id: "2-6-5", path: "html/hj24020605.html", year: "r06" },
  { id: "2-6-6", path: "html/hj24020606.html", year: "r06" },
  { id: "2-1-3", path: "html/hj24020103.html", year: "r06" },
  { id: "2-2-1", path: "html/hj24020201.html", year: "r06" },
  { id: "2-2-2", path: "html/hj24020202.html", year: "r06" },
  { id: "2-2-3", path: "html/hj24020203.html", year: "r06" },
  { id: "2-2-4", path: "html/hj24020204.html", year: "r06" },
  { id: "2-2-5", path: "html/hj24020205.html", year: "r06" },
  { id: "2-2-6", path: "html/hj24020206.html", year: "r06" },
  { id: "2-2-7", path: "html/hj24020207.html", year: "r06" },
  { id: "2-2-8", path: "html/hj24020208.html", year: "r06" },
  { id: "2-3-1", path: "html/hj24020301.html", year: "r06" },
  { id: "2-3-2", path: "html/hj24020302.html", year: "r06" },
  { id: "2-3-3", path: "html/hj24020303.html", year: "r06" },
  { id: "2-3-4", path: "html/hj24020304.html", year: "r06" },
  { id: "2-3-5", path: "html/hj24020305.html", year: "r06" },
  { id: "2-3-6", path: "html/hj24020306.html", year: "r06" },
  { id: "2-3-7", path: "html/hj24020307.html", year: "r06" },
  { id: "2-3-8", path: "html/hj24020308.html", year: "r06" },
  { id: "2-4-1", path: "html/hj24020401.html", year: "r06" },
  { id: "2-4-2", path: "html/hj24020402.html", year: "r06" },
  { id: "2-4-4", path: "html/hj24020404.html", year: "r06" },
  { id: "2-4-5", path: "html/hj24020405.html", year: "r06" },
  { id: "2-4-6", path: "html/hj24020406.html", year: "r06" },
  { id: "2-4-7", path: "html/hj24020407.html", year: "r06" },
  { id: "2-5-1", path: "html/hj24020501.html", year: "r06" },
  { id: "2-5-2", path: "html/hj24020502.html", year: "r06" },
  { id: "2-5-3", path: "html/hj24020503.html", year: "r06" },
  { id: "2-5-4", path: "html/hj24020504.html", year: "r06" },
  { id: "2-5-5", path: "html/hj24020505.html", year: "r06" },
  { id: "2-6-4", path: "html/hj24020604.html", year: "r06" },
  { id: "2-6-7", path: "html/hj24020607.html", year: "r06" },
  { id: "2-6-8", path: "html/hj24020608.html", year: "r06" },
  { id: "2-6-9", path: "html/hj24020609.html", year: "r06" },
  { id: "3-1-1", path: "html/hj24030101.html", year: "r06" },
  { id: "3-1-2", path: "html/hj24030102.html", year: "r06" },
  { id: "3-2-1", path: "html/hj24030201.html", year: "r06" },
  { id: "3-2-2", path: "html/hj24030202.html", year: "r06" },
  { id: "3-2-4", path: "html/hj24030204.html", year: "r06" },
  { id: "3-2-5", path: "html/hj24030205.html", year: "r06" },
  { id: "3-2-6", path: "html/hj24030206.html", year: "r06" },
  { id: "3-2-7", path: "html/hj24030207.html", year: "r06" },
  { id: "3-3-1", path: "html/hj24030301.html", year: "r06" },
  { id: "3-3-2", path: "html/hj24030302.html", year: "r06" },
  { id: "3-3-3", path: "html/hj24030303.html", year: "r06" },
  { id: "3-3-4", path: "html/hj24030304.html", year: "r06" },
  { id: "3-3-5", path: "html/hj24030305.html", year: "r06" },
  { id: "3-3-6", path: "html/hj24030306.html", year: "r06" },
  { id: "3-4-2", path: "html/hj24030402.html", year: "r06" },
  { id: "3-4-4", path: "html/hj24030404.html", year: "r06" },
  { id: "3-4-5", path: "html/hj24030405.html", year: "r06" },
  { id: "3-5-1", path: "html/hj24030501.html", year: "r06" },
  { id: "3-5-2", path: "html/hj24030502.html", year: "r06" },
  { id: "3-5-3", path: "html/hj24030503.html", year: "r06" },
  { id: "3-5-4", path: "html/hj24030504.html", year: "r06" },
  { id: "3-5-5", path: "html/hj24030505.html", year: "r06" },
  { id: "3-6-1", path: "html/hj24030601.html", year: "r06" },
  { id: "3-6-2", path: "html/hj24030602.html", year: "r06" },
  { id: "3-6-3", path: "html/hj24030603.html", year: "r06" },
  { id: "3-6-4", path: "html/hj24030604.html", year: "r06" },
  { id: "3-6-5", path: "html/hj24030605.html", year: "r06" },
  { id: "3-6-6", path: "html/hj24030606.html", year: "r06" },
  { id: "3-6-7", path: "html/hj24030607.html", year: "r06" },
  { id: "3-6-8", path: "html/hj24030608.html", year: "r06" },
  { id: "r05-1-1-1", path: "html/hj23010101.html", year: "r05" },
  { id: "r05-1-1-2", path: "html/hj23010102.html", year: "r05" },
  { id: "r05-1-1-3", path: "html/hj23010103.html", year: "r05" },
  { id: "r05-1-1-4", path: "html/hj23010104.html", year: "r05" },
  { id: "r05-1-1-5", path: "html/hj23010105.html", year: "r05" },
  { id: "r05-1-2-1", path: "html/hj23010201.html", year: "r05" },
  { id: "r05-1-2-2", path: "html/hj23010202.html", year: "r05" },
  { id: "r05-1-2-3", path: "html/hj23010203.html", year: "r05" },
  { id: "r05-1-3-1", path: "html/hj23010301.html", year: "r05" },
  { id: "r05-1-3-2", path: "html/hj23010302.html", year: "r05" },
  { id: "r05-1-3-3", path: "html/hj23010303.html", year: "r05" },
  { id: "r05-1-4-1", path: "html/hj23010401.html", year: "r05" },
  { id: "r05-1-4-2", path: "html/hj23010402.html", year: "r05" },
  { id: "r05-1-4-3", path: "html/hj23010403.html", year: "r05" },
  { id: "r05-1-4-4", path: "html/hj23010404.html", year: "r05" },
  { id: "r05-1-4-5", path: "html/hj23010405.html", year: "r05" },
  { id: "r05-2-1-1", path: "html/hj23020101.html", year: "r05" },
  { id: "r05-2-1-2", path: "html/hj23020102.html", year: "r05" },
  { id: "r05-2-1-3", path: "html/hj23020103.html", year: "r05" },
  { id: "r05-2-2-1", path: "html/hj23020201.html", year: "r05" },
  { id: "r05-2-2-2", path: "html/hj23020202.html", year: "r05" },
  { id: "r05-2-2-3", path: "html/hj23020203.html", year: "r05" },
  { id: "r05-2-2-4", path: "html/hj23020204.html", year: "r05" },
  { id: "r05-2-2-5", path: "html/hj23020205.html", year: "r05" },
  { id: "r05-2-2-6", path: "html/hj23020206.html", year: "r05" },
  { id: "r05-2-2-7", path: "html/hj23020207.html", year: "r05" },
  { id: "r05-2-2-8", path: "html/hj23020208.html", year: "r05" },
  { id: "r05-2-3-1", path: "html/hj23020301.html", year: "r05" },
  { id: "r05-2-3-2", path: "html/hj23020302.html", year: "r05" },
  { id: "r05-2-3-3", path: "html/hj23020303.html", year: "r05" },
  { id: "r05-2-3-4", path: "html/hj23020304.html", year: "r05" },
  { id: "r05-2-3-5", path: "html/hj23020305.html", year: "r05" },
  { id: "r05-2-3-6", path: "html/hj23020306.html", year: "r05" },
  { id: "r05-2-3-7", path: "html/hj23020307.html", year: "r05" },
  { id: "r05-2-3-8", path: "html/hj23020308.html", year: "r05" },
  { id: "r05-2-4-1", path: "html/hj23020401.html", year: "r05" },
  { id: "r05-2-4-2", path: "html/hj23020402.html", year: "r05" },
  { id: "r05-2-4-3", path: "html/hj23020403.html", year: "r05" },
  { id: "r05-2-4-4", path: "html/hj23020404.html", year: "r05" },
  { id: "r05-2-4-5", path: "html/hj23020405.html", year: "r05" },
  { id: "r05-2-4-6", path: "html/hj23020406.html", year: "r05" },
  { id: "r05-2-4-7", path: "html/hj23020407.html", year: "r05" },
  { id: "r05-2-5-1", path: "html/hj23020501.html", year: "r05" },
  { id: "r05-2-5-2", path: "html/hj23020502.html", year: "r05" },
  { id: "r05-2-5-3", path: "html/hj23020503.html", year: "r05" },
  { id: "r05-2-5-4", path: "html/hj23020504.html", year: "r05" },
  { id: "r05-2-5-5", path: "html/hj23020505.html", year: "r05" },
  { id: "r05-2-6-1", path: "html/hj23020601.html", year: "r05" },
  { id: "r05-2-6-2", path: "html/hj23020602.html", year: "r05" },
  { id: "r05-2-6-3", path: "html/hj23020603.html", year: "r05" },
  { id: "r05-2-6-4", path: "html/hj23020604.html", year: "r05" },
  { id: "r05-2-6-5", path: "html/hj23020605.html", year: "r05" },
  { id: "r05-2-6-6", path: "html/hj23020606.html", year: "r05" },
  { id: "r05-2-6-7", path: "html/hj23020607.html", year: "r05" },
  { id: "r05-2-6-8", path: "html/hj23020608.html", year: "r05" },
  { id: "r05-2-6-9", path: "html/hj23020609.html", year: "r05" },
  { id: "r05-3-1-1", path: "html/hj23030101.html", year: "r05" },
  { id: "r05-3-1-2", path: "html/hj23030102.html", year: "r05" },
  { id: "r05-3-1-3", path: "html/hj23030103.html", year: "r05" },
  { id: "r05-3-2-2", path: "html/hj23030202.html", year: "r05" },
  { id: "r05-3-2-3", path: "html/hj23030203.html", year: "r05" },
  { id: "r05-3-2-5", path: "html/hj23030205.html", year: "r05" },
  { id: "r05-3-2-6", path: "html/hj23030206.html", year: "r05" },
  { id: "r05-3-2-7", path: "html/hj23030207.html", year: "r05" },
  { id: "r05-3-2-8", path: "html/hj23030208.html", year: "r05" },
  { id: "r05-3-3-1", path: "html/hj23030301.html", year: "r05" },
  { id: "r05-3-3-2", path: "html/hj23030302.html", year: "r05" },
  { id: "r05-3-3-3", path: "html/hj23030303.html", year: "r05" },
  { id: "r05-3-3-4", path: "html/hj23030304.html", year: "r05" },
  { id: "r05-3-3-5", path: "html/hj23030305.html", year: "r05" },
  { id: "r05-3-3-6", path: "html/hj23030306.html", year: "r05" },
  { id: "r05-3-3-7", path: "html/hj23030307.html", year: "r05" },
  { id: "r05-3-4-1", path: "html/hj23030401.html", year: "r05" },
  { id: "r05-3-4-2", path: "html/hj23030402.html", year: "r05" },
  { id: "r05-3-4-6", path: "html/hj23030406.html", year: "r05" },
  { id: "r05-3-4-7", path: "html/hj23030407.html", year: "r05" },
  { id: "r05-3-5-1", path: "html/hj23030501.html", year: "r05" },
  { id: "r05-3-5-2", path: "html/hj23030502.html", year: "r05" },
  { id: "r05-3-5-4", path: "html/hj23030504.html", year: "r05" },
  { id: "r05-3-5-5", path: "html/hj23030505.html", year: "r05" },
  { id: "r05-3-6-2", path: "html/hj23030602.html", year: "r05" },
  { id: "r05-3-6-3", path: "html/hj23030603.html", year: "r05" },
  { id: "r05-3-6-4", path: "html/hj23030604.html", year: "r05" },
  { id: "r05-3-6-5", path: "html/hj23030605.html", year: "r05" },
  { id: "r05-3-6-6", path: "html/hj23030606.html", year: "r05" },
  { id: "r05-3-6-7", path: "html/hj23030607.html", year: "r05" },
  { id: "r05-3-6-8", path: "html/hj23030608.html", year: "r05" },
  { id: "r07-1-1-1", path: "html/hj25010101.html", year: "r07" },
  { id: "r07-1-1-2", path: "html/hj25010102.html", year: "r07" },
  { id: "r07-1-1-3", path: "html/hj25010103.html", year: "r07" },
  { id: "r07-1-1-4", path: "html/hj25010104.html", year: "r07" },
  { id: "r07-1-2-1", path: "html/hj25010201.html", year: "r07" },
  { id: "r07-1-2-2", path: "html/hj25010202.html", year: "r07" },
  { id: "r07-1-2-3", path: "html/hj25010203.html", year: "r07" },
  { id: "r07-1-2-4", path: "html/hj25010204.html", year: "r07" },
  { id: "r07-1-3-1", path: "html/hj25010301.html", year: "r07" },
  { id: "r07-1-3-2", path: "html/hj25010302.html", year: "r07" },
  { id: "r07-1-3-3", path: "html/hj25010303.html", year: "r07" },
  { id: "r07-1-4-1", path: "html/hj25010401.html", year: "r07" },
  { id: "r07-1-4-2", path: "html/hj25010402.html", year: "r07" },
  { id: "r07-2-1-1", path: "html/hj25020101.html", year: "r07" },
  { id: "r07-2-1-2", path: "html/hj25020102.html", year: "r07" },
  { id: "r07-2-1-3", path: "html/hj25020103.html", year: "r07" },
  { id: "r07-2-2-1", path: "html/hj25020201.html", year: "r07" },
  { id: "r07-2-2-2", path: "html/hj25020202.html", year: "r07" },
  { id: "r07-2-2-3", path: "html/hj25020203.html", year: "r07" },
  { id: "r07-2-2-4", path: "html/hj25020204.html", year: "r07" },
  { id: "r07-2-2-5", path: "html/hj25020205.html", year: "r07" },
  { id: "r07-2-2-6", path: "html/hj25020206.html", year: "r07" },
  { id: "r07-2-2-7", path: "html/hj25020207.html", year: "r07" },
  { id: "r07-2-2-8", path: "html/hj25020208.html", year: "r07" },
  { id: "r07-2-3-1", path: "html/hj25020301.html", year: "r07" },
  { id: "r07-2-3-2", path: "html/hj25020302.html", year: "r07" },
  { id: "r07-2-3-3", path: "html/hj25020303.html", year: "r07" },
  { id: "r07-2-3-4", path: "html/hj25020304.html", year: "r07" },
  { id: "r07-2-3-5", path: "html/hj25020305.html", year: "r07" },
  { id: "r07-2-3-6", path: "html/hj25020306.html", year: "r07" },
  { id: "r07-2-3-7", path: "html/hj25020307.html", year: "r07" },
  { id: "r07-2-4-1", path: "html/hj25020401.html", year: "r07" },
  { id: "r07-2-4-2", path: "html/hj25020402.html", year: "r07" },
  { id: "r07-2-4-3", path: "html/hj25020403.html", year: "r07" },
  { id: "r07-2-4-4", path: "html/hj25020404.html", year: "r07" },
  { id: "r07-2-4-5", path: "html/hj25020405.html", year: "r07" },
  { id: "r07-2-4-8", path: "html/hj25020408.html", year: "r07" },
  { id: "r07-2-5-1", path: "html/hj25020501.html", year: "r07" },
  { id: "r07-2-5-2", path: "html/hj25020502.html", year: "r07" },
  { id: "r07-2-5-3", path: "html/hj25020503.html", year: "r07" },
  { id: "r07-2-5-4", path: "html/hj25020504.html", year: "r07" },
  { id: "r07-2-5-5", path: "html/hj25020505.html", year: "r07" },
  { id: "r07-2-5-6", path: "html/hj25020506.html", year: "r07" },
  { id: "r07-2-6-1", path: "html/hj25020601.html", year: "r07" },
  { id: "r07-2-6-2", path: "html/hj25020602.html", year: "r07" },
  { id: "r07-2-6-3", path: "html/hj25020603.html", year: "r07" },
  { id: "r07-2-6-4", path: "html/hj25020604.html", year: "r07" },
  { id: "r07-2-6-5", path: "html/hj25020605.html", year: "r07" },
  { id: "r07-2-6-6", path: "html/hj25020606.html", year: "r07" },
  { id: "r07-2-6-7", path: "html/hj25020607.html", year: "r07" },
  { id: "r07-2-6-8", path: "html/hj25020608.html", year: "r07" },
  { id: "r07-2-6-9", path: "html/hj25020609.html", year: "r07" },
  { id: "r07-3-1-1", path: "html/hj25030101.html", year: "r07" },
  { id: "r07-3-1-2", path: "html/hj25030102.html", year: "r07" },
  { id: "r07-3-2-1", path: "html/hj25030201.html", year: "r07" },
  { id: "r07-3-2-2", path: "html/hj25030202.html", year: "r07" },
  { id: "r07-3-2-4", path: "html/hj25030204.html", year: "r07" },
  { id: "r07-3-2-5", path: "html/hj25030205.html", year: "r07" },
  { id: "r07-3-2-6", path: "html/hj25030206.html", year: "r07" },
  { id: "r07-3-2-7", path: "html/hj25030207.html", year: "r07" },
  { id: "r07-3-3-2", path: "html/hj25030302.html", year: "r07" },
  { id: "r07-3-3-3", path: "html/hj25030303.html", year: "r07" },
  { id: "r07-3-3-4", path: "html/hj25030304.html", year: "r07" },
  { id: "r07-3-3-5", path: "html/hj25030305.html", year: "r07" },
  { id: "r07-3-3-6", path: "html/hj25030306.html", year: "r07" },
  { id: "r07-3-4-2", path: "html/hj25030402.html", year: "r07" },
  { id: "r07-3-4-5", path: "html/hj25030405.html", year: "r07" },
  { id: "r07-3-5-1", path: "html/hj25030501.html", year: "r07" },
  { id: "r07-3-5-2", path: "html/hj25030502.html", year: "r07" },
  { id: "r07-3-5-3", path: "html/hj25030503.html", year: "r07" },
  { id: "r07-3-5-4", path: "html/hj25030504.html", year: "r07" },
  { id: "r07-3-5-5", path: "html/hj25030505.html", year: "r07" },
  { id: "r07-3-6-2", path: "html/hj25030602.html", year: "r07" },
  { id: "r07-3-6-3", path: "html/hj25030603.html", year: "r07" },
  { id: "r07-3-6-4", path: "html/hj25030604.html", year: "r07" },
  { id: "r07-3-6-5", path: "html/hj25030605.html", year: "r07" },
  { id: "r07-3-6-6", path: "html/hj25030606.html", year: "r07" },
  { id: "r07-3-6-7", path: "html/hj25030607.html", year: "r07" },
  { id: "r07-3-6-8", path: "html/hj25030608.html", year: "r07" },
];

const BASE_ROOT = "https://www.env.go.jp/policy/hakusyo/";

// --- Fetch --------------------------------------------------------------------

const cachePathFor = (pageId: string): string =>
  join(CACHE_DIR.pathname, `${pageId}.html`);

const FETCH_BATCH = 4;
const MIN_PAGE_SCORE = 200;

// --- Main ---------------------------------------------------------------------

/** One pinned page's paragraphs, keyed by the pinned page id. */
const loadPage = async (
  page: { id: string; year: string; path: string },
  force: boolean
): Promise<{
  readonly id: string;
  readonly paragraphs: readonly ProseParagraph[];
}> => {
  const pageUrl = `${BASE_ROOT}${page.year}/${page.path}`;
  const html = await fetchHtmlPage({
    cachePath: cachePathFor(page.id),
    force,
    // Below this many recovered Japanese chars a page is either mojibake or the
    // ministry's throttle page, and BOTH are refused and retried rather than
    // written to the cache.
    minScore: MIN_PAGE_SCORE,
    url: pageUrl,
  });
  return {
    id: page.id,
    paragraphs: proseParagraphsOf({
      credit: creditFor(pageUrl),
      html,
      license: "PDL-1.0",
      pageId: page.id,
      pageUrl,
    }).paragraphs,
  };
};

if (import.meta.main) {
  const force = process.argv.includes("--force");
  // Fetched in SMALL BATCHES but assembled in pinned-page order: each batch's
  // `Promise.all` returns results in argument order, so the paragraph ids and
  // the output file never depend on which request finished first. The batch
  // cap exists because the ministry throttles burst traffic (see
  // `fetchHtmlPage`, which owns the retry/backoff this needed).
  // A cached run does no network at all, which is the normal case after one
  // successful fetch.
  const perPage: {
    readonly id: string;
    readonly paragraphs: readonly ProseParagraph[];
  }[] = [];
  for (let start = 0; start < PAGES.length; start += FETCH_BATCH) {
    // biome-ignore lint/performance/noAwaitInLoops: batches must complete before the next starts — small sequential batches are how the fetcher avoids the ministry's burst throttle
    const batch = await Promise.all(
      PAGES.slice(start, start + FETCH_BATCH).map((page) =>
        loadPage(page, force)
      )
    );
    for (const page of batch) {
      perPage.push(page);
    }
  }
  for (const page of perPage) {
    console.log(`${page.id}: ${page.paragraphs.length} paragraphs`);
  }
  const all = perPage.flatMap((page) => page.paragraphs);
  const lines = all.map((paragraph) => JSON.stringify(paragraph));
  writeFileSync(OUT_FILE, `${lines.join("\n")}\n`, "utf8");
  console.log(
    `hakusho.jsonl: ${all.length} paragraphs from ${PAGES.length} pages`
  );
}
