/**
 * `probe:n3-choubun` — measure whether any licensed-at-birth source OTHER than
 * the 環境白書 can back the N3 大問6 内容理解（長文） store (TASK-173.9.14).
 *
 * This is a MEASUREMENT, not a build step: it writes no store, no corpus file and
 * no code the CI gate runs, and nothing outside this script imports it. What it
 * answers is the one question doc-27 D-3 left open — the 白書 is a GENRE failure at
 * N3, not an instrument failure, so the bar stays where it is and a different
 * prose source has to clear it: 0 of 1747 in-band 白書 windows reach 0.80 at N3
 * while the official N3 長文 itself measures 88.9% (`packages/japanese/data/
 * LICENSE.md` §17, doc-26 §4).
 *
 * The question is CLOSED, and this script is the record of closing it, not an open
 * route. TASK-173.9.14 answered it (1 disjoint buildable row where the 大問 prints
 * 4) and doc-27 §10 resolved the shortage by WRITING the N3 長文 rows instead of
 * sourcing them or lowering `CHOUBUN_COVERAGE_FLOOR`. Since TASK-173.9.21 the same
 * holds of the level this probe measures against: `data/reading/n1-choubun.json` is
 * authored too, so no shipped 長文 store anywhere reads a 白書 window, and a
 * refetch of these three arms cannot change a row. Re-run it only to re-measure the
 * claim, never to refill a store.
 *
 * The official 大問6 ねらい, read from the pinned レベル別 大問のねらい PDF
 * (`https://www.jlpt.jp/guideline/pdf/n3.pdf`, `pdftotext -layout`) and quoted
 * here rather than paraphrased: 「解説、エッセイ、手紙など550字程度のテキストを
 * 読んで、概要や論理の展開などが理解できるかを問う」. TWO obligations follow, and
 * both are what this probe screens: 550字程度 gives the BAND (500-700 runes, the
 * same window the task's AC names), and 解説・エッセイ・手紙 gives the GENRE, which
 * is why the arms below are general-audience publications rather than more
 * ministry prose.
 *
 * The three arms:
 *  - `jawiki` — 150 namespace-0 articles drawn by the MediaWiki random endpoint
 *    with a PINNED seed (`seed=173914`), so the sample is a property of this
 *    script and not of which pages a human liked. **CC BY-SA 4.0.** Hand-picking
 *    easy articles would be the fastest way to make a store ship that the corpus
 *    does not support, so the sample is deliberately unbiased: this draw holds 2
 *    曖昧さ回避 pages and articles nobody would pick for a reading test, and the
 *    extractability rate is reported as part of the answer.
 *  - `soumu` — 情報通信白書 令和6年版 HTML版 (総務省). **公共データ利用規約 1.0**,
 *    read today from `https://www.soumu.go.jp/menu_kyotsuu/policy/tyosaku.html`:
 *    「特記されていない限り総務省に帰属し、権利表記の記載がない限り「公共データ
 *    利用規約（第1.0版）」に準拠した利用条件の下で利用することができます」, credit
 *    「出典：総務省ホームページ（当該ページのURL）」. Section pages are enumerated
 *    by following the links inside the publication itself (TASK-173.9.9 recorded
 *    the section tree as JS-driven and unenumerable; the per-page nav links are
 *    plain `<a href>` and a bounded walk reaches them).
 *  - `npa` — 警察白書 令和6年版 本文 HTML (警察庁), 113 section pages listed by
 *    `https://www.npa.go.jp/hakusyo/r06/honbun/menu.html`. A second non-環境省
 *    ministry's HTML publication, measured because a 白書 is exactly the genre
 *    this level cannot use, which makes it the most informative NULL result. Its
 *    reuse terms are NOT verified here: no rights statement was found on the
 *    白書 pages or the site-policy pages this probe looked at, so an arm that
 *    cleared the bar would still have to answer for its licence before shipping.
 *
 * Every page is read with the pipeline's OWN extractor (`html-prose.ts`, the code
 * `fetch-hakusho.ts` uses) and scored with its OWN instrument (`coverageOf` over
 * `readCumulativeVocabIndex(dataDir, levelsUpTo("N3"))`), and windows are built by
 * `choubunWindowsFor` with the adjacency rules the 長文 gate enforces — 2 to 5
 * consecutive prose paragraphs from one page, each at least 150 runes — so the
 * number printed here is the number the generator would have to live with.
 *
 * Two floors are reported because two different claims ride on them. The 中文
 * family's level floor `COVERAGE_FLOOR.N3` = 0.8 is what the task's AC asks for
 * and what doc-27 D-3's 白書 number is stated against. `CHOUBUN_COVERAGE_FLOOR` =
 * 0.85 is what the 長文 gate actually enforces at ANY level
 * (`check-reading-choubun.ts:333`), so a store that clears 0.8 and not 0.85 could
 * not ship without a new number being declared and justified. A row also has to be
 * BUILDABLE, not just readable, and it has to be DISJOINT from its neighbours: a
 * real 大問 prints 4 different passages asking 4 different things, so the supply
 * that matters is counted by `buildChoubunBatch` (the shipped masked slot, frame,
 * distractor-pool, paragraph-disjointness and distinct-answer rules, with only the
 * floor overridden) at BOTH bars, not by how many windows individually read well.
 *
 * Cached under `.cache/n3-choubun/<arm>/`, one file per page plus the cached page
 * list of each arm, fetched sequentially with a polite delay, so a second run does
 * no network at all. `--force` refetches: the 総務省 walk reads the nav links out of
 * every page body, so a forced run pays for those pages twice, once to enumerate
 * and once to measure, which is why `--force` is for a suspected throttle page and
 * not for routine use.
 *
 * Run from this package: `bun run probe:n3-choubun [--force]`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildChoubunBatch } from "./gen-reading-choubun";
import {
  fetchHtmlPage,
  type ProseParagraph,
  proseParagraphsOf,
  USER_AGENT,
} from "./html-prose";
import {
  CHOUBUN_COVERAGE_FLOOR,
  CHOUBUN_MAX_PASSAGE_LENGTH,
  CHOUBUN_MIN_PARAGRAPH_RUNES,
  CHOUBUN_MIN_PASSAGE_LENGTH,
  type ChoubunWindow,
  choubunWindowsFor,
} from "./reading-choubun-corpus";
import {
  buildFrameFillers,
  COVERAGE_FLOOR,
  coverageOf,
  LEVEL_RANKS,
  levelsUpTo,
  type PassageBand,
  readCumulativeVocabIndex,
  splitSentences,
} from "./reading-chuubun-corpus";

const CACHE_DIR = new URL("../.cache/n3-choubun/", import.meta.url);

/** The level being supplied, and the rank every coverage number is measured at. */
const PROBE_LEVEL = "N3";

/** The official N3 大問6 band: 550字程度, from the pinned n3.pdf ねらい quoted in
 * this file's header. The shipped 900-1200 window is N1's 1000字程度 target and
 * searching it for N3 would answer a question nobody asked. */
const N3_BAND: PassageBand = { max: 700, min: 500 };

/** N1's own window, reported beside the N3 band so the two levels' supply is
 * comparable against the store that already shipped (`n1-choubun.json`). */
const N1_BAND: PassageBand = {
  max: CHOUBUN_MAX_PASSAGE_LENGTH,
  min: CHOUBUN_MIN_PASSAGE_LENGTH,
};

/** How far to walk each publication's page list, and how many Wikipedia articles
 * to draw. The walk is bounded because the answer must be reachable in minutes,
 * not because the corpus is small. */
const PAGE_CAP = 100;

/** A page decoding to fewer recovered Japanese chars than this is a throttle page
 * or mojibake and is retried, never measured. Wikipedia stubs are short but real,
 * so this sits below the 白書 fetcher's 200. */
const MIN_PAGE_SCORE = 100;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const cachePathFor = (...parts: readonly string[]): string =>
  join(CACHE_DIR.pathname, ...parts);

/**
 * One page of one arm. The id is minted by the arm's own page list and is safe
 * as a cache filename, and BOTH the enumeration walk and the measurement pass
 * address a page through it (`cachePathFor(arm.name, `${id}.html`)), so a page
 * the walk fetched is found in the cache by the pass that measures it instead of
 * being fetched twice.
 */
interface ProbePage {
  readonly id: string;
  readonly url: string;
}

const safeId = (raw: string): string =>
  raw.replace(/[^0-9A-Za-z]+/gu, "-").slice(0, 60);

/** Last path segment of a publication page, without its extension. */
const HTML_EXT_RE = /\.html?$/iu;
const fileNameOf = (url: string): string =>
  url.slice(url.lastIndexOf("/") + 1).replace(HTML_EXT_RE, "");

const get = async (url: string): Promise<Response | null> =>
  fetch(url, { headers: { "user-agent": USER_AGENT } }).catch(() => null);

// --- Page lists ---------------------------------------------------------------

/** The shape of a `list=random` API reply, from cache or from the wire. */
interface RandomReply {
  query?: { random?: { title?: string }[] };
}

/** The article titles of a `list=random` reply; both sources read it the same
 * way, and a second copy of the walk could drift. */
const randomTitles = (parsed: RandomReply): string[] =>
  (parsed.query?.random ?? [])
    .map((row) => row.title)
    .filter((title): title is string => typeof title === "string");

/**
 * The seeded Wikipedia sample, cached as JSON so a re-run measures the SAME 150
 * articles the first run drew. `list=random` honours `seed`, which is what makes
 * an unbiased sample reproducible.
 */
const jawikiPages = async (force: boolean): Promise<readonly ProbePage[]> => {
  const listPath = cachePathFor("jawiki", "sample.json");
  let titles: string[] = [];
  if (!force && existsSync(listPath)) {
    titles = randomTitles(
      JSON.parse(readFileSync(listPath, "utf8")) as RandomReply
    );
  }
  if (titles.length === 0) {
    const response = await get(
      "https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=150&seed=173914&format=json"
    );
    if (response === null || !response.ok) {
      throw new Error("jawiki: the random-article endpoint is unreachable");
    }
    const parsed = (await response.json()) as RandomReply;
    titles = randomTitles(parsed);
    // The list is written before any page fetch, so nothing has created this
    // arm's directory yet.
    mkdirSync(dirname(listPath), { recursive: true });
    writeFileSync(listPath, JSON.stringify(parsed), "utf8");
  }
  return titles.map((title, position) => ({
    // The position leads the id: sanitising a title to a filename can make two
    // different articles share one id, and a shared id means one article's cache
    // file standing in for the other's.
    id: safeId(`${String(position + 1).padStart(4, "0")}-${title}`),
    url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  }));
};

/** Every `href` in one page's own navigation, resolved against that page. A
 * ministry whitepaper links its section pages from every section page, so a
 * bounded walk over those links enumerates the publication without a browser. */
const linksMatching = (
  html: string,
  pattern: RegExp,
  baseUrl: string
): string[] => {
  const out = new Set<string>();
  for (const [, href] of html.matchAll(pattern)) {
    if (href === undefined) {
      continue;
    }
    out.add(new URL(href, baseUrl).href);
  }
  return [...out];
};

const soumuPages = async (force: boolean): Promise<readonly ProbePage[]> => {
  const listPath = cachePathFor("soumu", "pages.json");
  if (!force && existsSync(listPath)) {
    return JSON.parse(readFileSync(listPath, "utf8")) as ProbePage[];
  }
  const entry =
    "https://www.soumu.go.jp/johotsusintokei/whitepaper/ja/r06/html/nb000000.html";
  const seen = new Set<string>();
  const queue = [entry];
  const pages: ProbePage[] = [];
  while (queue.length > 0 && pages.length < PAGE_CAP) {
    const url = queue.shift();
    if (url === undefined || seen.has(url)) {
      continue;
    }
    seen.add(url);
    const id = safeId(fileNameOf(url));
    let html: string;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: the walk reads the nav links out of each page body, so the next page is unknown until this one arrives, and one request at a time is what the ministry throttle requires
      html = await fetchHtmlPage({
        cachePath: cachePathFor("soumu", `${id}.html`),
        force,
        minScore: MIN_PAGE_SCORE,
        url,
      });
    } catch {
      continue;
    }
    pages.push({ id, url });
    queue.push(
      ...linksMatching(html, /href="((?:n|nd)[a-z0-9]{6,8}\.html)"/giu, url)
    );
  }
  mkdirSync(dirname(listPath), { recursive: true });
  writeFileSync(listPath, JSON.stringify(pages), "utf8");
  return pages;
};

const npaPages = async (force: boolean): Promise<readonly ProbePage[]> => {
  const menu = "https://www.npa.go.jp/hakusyo/r06/honbun/menu.html";
  const html = await fetchHtmlPage({
    cachePath: cachePathFor("npa", "menu.html"),
    force,
    minScore: MIN_PAGE_SCORE,
    url: menu,
  });
  return linksMatching(html, /href="(html\/aa[a-z0-9]{7}\.html)"/giu, menu)
    .slice(0, PAGE_CAP)
    .map((url) => ({ id: safeId(fileNameOf(url)), url }));
};

// --- Arms ---------------------------------------------------------------------

interface Arm {
  readonly credit: (pageUrl: string) => string;
  readonly license: string;
  readonly name: string;
  /** Enumerate this arm's pages. The ids are stable across runs (the lists are
   * cached), so a body that any earlier pass wrote into this arm's cache
   * directory is found again by `measureArm`. */
  readonly pages: (force: boolean) => Promise<readonly ProbePage[]>;
}

const ARMS: readonly Arm[] = [
  {
    credit: (pageUrl) => `出典：Wikipedia（${pageUrl}）`,
    license: "CC BY-SA 4.0",
    name: "jawiki",
    pages: jawikiPages,
  },
  {
    credit: (pageUrl) => `出典：総務省ホームページ（${pageUrl}）`,
    license: "PDL1.0",
    name: "soumu",
    pages: (force) => soumuPages(force),
  },
  {
    credit: (pageUrl) => `出典：警察庁ホームページ（${pageUrl}）`,
    license: "licence unverified",
    name: "npa",
    pages: (force) => npaPages(force),
  },
];

// --- Measurement --------------------------------------------------------------

/** One arm's whole measurement: fetch, extract, window, score, try to build. */
interface ArmReport {
  readonly arm: string;
  readonly clearChoubunFloor: number;
  readonly clearLevelFloor: number;
  /** Greedy mutually-disjoint buildable rows at the 0.85 bar the 長文 gate
   * enforces, and the distinct pages behind them. */
  readonly disjointRowsAtChoubunFloor: number;
  readonly disjointRowsAtChoubunFloorPages: number;
  /** The same two counts at the level's own 0.8 bar. A 大問 of 4 小問 needs 4 of
   * the row count and 4 un-repeated texts, so the page count is what says
   * whether the rows are one document wearing four masks. */
  readonly disjointRowsAtLevelFloor: number;
  readonly disjointRowsAtLevelFloorPages: number;
  readonly fetchedPages: number;
  readonly paragraphs: number;
  readonly prosePages: number;
  readonly requestedPages: number;
  readonly topWindows: readonly string[];
  readonly windowsInBand: number;
  readonly windowsInN1Band: number;
}

const measureArm = async ({
  arm,
  fillersFor,
  force,
  index,
  maxRank,
}: {
  arm: Arm;
  fillersFor: (
    paragraphs: readonly ProseParagraph[]
  ) => ReturnType<typeof buildFrameFillers>;
  force: boolean;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  maxRank: number;
}): Promise<ArmReport> => {
  const pages = await arm.pages(force);
  const paragraphs: ProseParagraph[] = [];
  let fetched = 0;
  const failures: string[] = [];
  for (const page of pages) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one page at a time is the whole point, the ministry endpoints this walks throttle burst traffic and a parallel sweep would report refused pages as missing prose
      const html = await fetchHtmlPage({
        cachePath: cachePathFor(arm.name, `${page.id}.html`),
        force,
        minScore: MIN_PAGE_SCORE,
        url: page.url,
      });
      fetched += 1;
      paragraphs.push(
        ...proseParagraphsOf({
          credit: arm.credit(page.url),
          html,
          license: arm.license,
          pageId: page.id,
          pageUrl: page.url,
        }).paragraphs
      );
    } catch (error) {
      failures.push(
        `${page.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    // One page at a time, always: the ministry throttle that forced this design
    // is IP-wide, and a burst at a Wikimedia endpoint is the same discourtesy.
    await sleep(120);
  }
  if (failures.length > 0) {
    console.log(
      `${arm.name}: ${failures.length} page(s) refused: ${failures.slice(0, 3).join(" | ")}`
    );
  }

  // A page with at least one window-eligible paragraph in it: the extractability
  // rate. A well-licensed source can still yield nothing if its HTML breaks the
  // prose up below the 長文 paragraph floor.
  const prosePages = new Set(
    paragraphs
      .filter(
        (paragraph) => [...paragraph.text].length >= CHOUBUN_MIN_PARAGRAPH_RUNES
      )
      .map((paragraph) => paragraph.pageId)
  );
  const windows = choubunWindowsFor({
    band: N3_BAND,
    paragraphs,
    spent: new Set(),
  });
  const n1Windows = choubunWindowsFor({
    band: N1_BAND,
    paragraphs,
    spent: new Set(),
  });
  const fillers = fillersFor(paragraphs);
  const levelFloor = COVERAGE_FLOOR[PROBE_LEVEL] ?? 0;
  const scores: { coverage: number; window: ChoubunWindow }[] = [];
  let clearLevel = 0;
  let clearChoubun = 0;
  for (const window of windows) {
    const coverage = coverageOf(window.text, index, maxRank);
    scores.push({ coverage, window });
    if (coverage >= levelFloor) {
      clearLevel += 1;
    }
    if (coverage >= CHOUBUN_COVERAGE_FLOOR) {
      clearChoubun += 1;
    }
  }
  scores.sort((left, right) => right.coverage - left.coverage);
  // The DISJOINT row supply, counted through the shipped batch builder rather
  // than a second copy of its rules: a store is not a pile of readable windows,
  // it is N passages that share no paragraph and ask no repeated answer word.
  // Only the floor is overridden, so each bar reports the rows THAT bar would
  // accept, and the two numbers are the same algorithm run twice.
  const rowsAt = (floor: number) => {
    const rows = buildChoubunBatch({
      band: N3_BAND,
      count: windows.length,
      fillers,
      floor,
      index,
      level: PROBE_LEVEL,
      paragraphs,
      rejections: new Set<string>(),
      spent: new Set<string>(),
    });
    return {
      count: rows.length,
      pages: new Set(rows.map((row) => row.sourceUrl)).size,
    };
  };
  const atChoubunFloor = rowsAt(CHOUBUN_COVERAGE_FLOOR);
  const atLevelFloor = rowsAt(levelFloor);
  return {
    arm: arm.name,
    clearChoubunFloor: clearChoubun,
    clearLevelFloor: clearLevel,
    disjointRowsAtChoubunFloor: atChoubunFloor.count,
    disjointRowsAtChoubunFloorPages: atChoubunFloor.pages,
    disjointRowsAtLevelFloor: atLevelFloor.count,
    disjointRowsAtLevelFloorPages: atLevelFloor.pages,
    fetchedPages: fetched,
    paragraphs: paragraphs.length,
    prosePages: prosePages.size,
    requestedPages: pages.length,
    topWindows: scores
      .slice(0, 5)
      .map(
        (each) =>
          `  ${each.window.ids.join("+")} ${String(each.window.runes)} runes ${(
            each.coverage * 100
          ).toFixed(1)}%`
      ),
    windowsInBand: windows.length,
    windowsInN1Band: n1Windows.length,
  };
};

const main = async (): Promise<void> => {
  const force = process.argv.includes("--force");
  const dataDir = join(import.meta.dir, "..", "data");
  const index = readCumulativeVocabIndex(dataDir, levelsUpTo(PROBE_LEVEL));
  const maxRank = LEVEL_RANKS[PROBE_LEVEL] ?? 0;
  const fillersFor = (paragraphs: readonly ProseParagraph[]) =>
    buildFrameFillers(
      paragraphs.flatMap((paragraph) =>
        splitSentences({
          id: paragraph.id,
          license: paragraph.license,
          pageId: paragraph.pageId,
          pageUrl: paragraph.pageUrl,
          source: paragraph.source,
          text: paragraph.text,
          title: paragraph.title,
        })
      ),
      index,
      maxRank
    );
  console.log(
    `probe:n3-choubun: ${PROBE_LEVEL} rank ${maxRank}, band ${N3_BAND.min}-${N3_BAND.max} runes, floors ${
      COVERAGE_FLOOR[PROBE_LEVEL]
    } (level) and ${CHOUBUN_COVERAGE_FLOOR} (長文 gate)`
  );
  for (const arm of ARMS) {
    // biome-ignore lint/performance/noAwaitInLoops: the arms share one IP with the ministries being measured, so an arm finishes fetching before the next one starts
    const report = await measureArm({ arm, fillersFor, force, index, maxRank });
    console.log(
      `${report.arm}: pages ${report.fetchedPages}/${report.requestedPages}, prose pages ${report.prosePages}, paragraphs ${report.paragraphs}, windows ${report.windowsInBand} in ${N3_BAND.min}-${N3_BAND.max} (${report.windowsInN1Band} in ${N1_BAND.min}-${N1_BAND.max}), clear ${COVERAGE_FLOOR[PROBE_LEVEL]} = ${report.clearLevelFloor}, clear ${CHOUBUN_COVERAGE_FLOOR} = ${report.clearChoubunFloor}`
    );
    console.log(
      `  disjoint buildable rows at ${CHOUBUN_COVERAGE_FLOOR} (the 長文 gate): ${report.disjointRowsAtChoubunFloor} from ${report.disjointRowsAtChoubunFloorPages} page(s); at ${
        COVERAGE_FLOOR[PROBE_LEVEL]
      } (the level bar): ${report.disjointRowsAtLevelFloor} from ${report.disjointRowsAtLevelFloorPages} page(s)`
    );
    for (const line of report.topWindows) {
      console.log(line);
    }
  }
};

if (import.meta.main) {
  await main();
}
