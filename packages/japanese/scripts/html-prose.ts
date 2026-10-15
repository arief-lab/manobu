/**
 * Shared HTML→prose machinery for the corpus fetchers: the encoding-scored
 * decode, the `<p>` extraction and the throttled fetch-with-backoff that
 * `fetch-hakusho.ts` had to grow against env.go.jp.
 *
 * It lives in one module because the honesty of a source MEASUREMENT depends on
 * it: a probe that extracts paragraphs with its own second copy of the rules
 * reports a number that the shipped pipeline would not reproduce. `fetch-hakusho`
 * (the 白書 corpus) and `probe-n3-choubun-source` (the TASK-173.9.14 長文-register
 * arms) therefore run the SAME decoder, the SAME prose filter and the SAME
 * paragraph numbering.
 *
 * Why the decode is scored instead of tried: Japanese government pages mix
 * Shift-JIS and UTF-8 across one tree, and a Shift-JIS page read as Latin-1
 * decodes "successfully" into kanji-dense mojibake. Kanji count alone is the
 * wrong signal (UTF-8 bytes read as Shift-JIS land in the kanji ranges too), so
 * hiragana/kana runs minus 20× U+FFFD decide, and a low score is RETRIED rather
 * than trusted: a burst-throttled ministry page is HTTP 200 and near-empty.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type DecoderLabel = ConstructorParameters<typeof TextDecoder>[0];

/** A descriptive UA: several ministry/Wikimedia endpoints 403 a bare curl. */
export const USER_AGENT =
  "manobu-corpus-fetch/1.0 (+https://github.com/manobu/manobu-gg; contact: corpus)";

// --- Decoding -----------------------------------------------------------------

const KANA_RE = /[\u3040-\u30ff]/gu;
const REPLACEMENT_RE = /\ufffd/gu;
const CHARSET_RE = /charset=["']?([\w-]+)/iu;

/**
 * Score a decode candidate by how much REAL Japanese it recovers.
 *
 * Counting kanji alone is wrong: UTF-8 bytes read as Shift-JIS render into the
 * kanji ranges and scored higher than the correct UTF-8 decode, which is how
 * the first run shipped a fully mojibaked corpus. Kana (especially hiragana)
 * and the U+FFFD replacement char are the honest signal - mojibake is either
 * kanji-dense with no kana or littered with replacement chars.
 */
export const japaneseScore = (text: string): number =>
  (text.match(KANA_RE) ?? []).length -
  20 * (text.match(REPLACEMENT_RE) ?? []).length;

/** Map an HTML `charset=` token to a `TextDecoder` label, or null if unknown. */
const encodingLabel = (token: string): DecoderLabel | null => {
  const normalized = token.toLowerCase();
  if (
    normalized === "shift_jis" ||
    normalized === "shift-jis" ||
    normalized === "sjis"
  ) {
    return "shift_jis";
  }
  if (normalized === "utf-8" || normalized === "utf8") {
    return "utf-8";
  }
  if (normalized === "euc-jp" || normalized === "eucjp") {
    return "euc-jp";
  }
  return null;
};

/**
 * Decode a government/Wikimedia page. The declared `<meta charset>` wins when
 * the page is well-formed (it is ASCII-safe, so it is readable before
 * decoding); otherwise the best-scoring candidate does.
 */
export const decodePage = (bytes: Uint8Array): string => {
  const declared = encodingLabel(
    new TextDecoder("latin1")
      .decode(bytes.slice(0, 4096))
      .match(CHARSET_RE)?.[1] ?? ""
  );
  const candidates: readonly DecoderLabel[] = [
    ...(declared ? [declared] : []),
    "utf-8",
    "shift_jis",
    "euc-jp",
  ];
  let best = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const encoding of candidates) {
    let decoded: string;
    try {
      decoded = new TextDecoder(encoding, { fatal: false }).decode(bytes);
    } catch {
      continue;
    }
    const score = japaneseScore(decoded);
    if (score > bestScore) {
      best = decoded;
      bestScore = score;
    }
  }
  return best;
};

// --- Text extraction ----------------------------------------------------------

const SCRIPT_STYLE_RE = /<(script|style)[^>]*>[\s\S]*?<\/\1>/giu;
const PARAGRAPH_RE = /<p[^>]*>([\s\S]*?)<\/p>/giu;
const TAG_RE = /<[^>]+>/gu;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/iu;
const WHITESPACE_RE = /\s+/gu;

const decodeEntities = (text: string): string =>
  text
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#(\d+);/gu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replace(/&#x([\da-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    );

const stripTags = (html: string): string =>
  decodeEntities(html.replace(TAG_RE, "")).replace(WHITESPACE_RE, " ").trim();

/** The page heading from `<title>`, trimmed of the boilerplate suffix the
 * source itself puts in it. */
const titleOf = (html: string): string => {
  const matched = html.match(TITLE_RE);
  return matched ? stripTags(matched[1] ?? "") : "";
};

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/gu;

/** A kana/kanji bearing paragraph. A statistic table row flatten into a `<p>`
 * is mostly digits/units and is not prose, so it is dropped. */
const isProse = (text: string): boolean => {
  const chars = [...text];
  if (chars.length < 20) {
    return false;
  }
  const japanese = (text.match(CJK_RE) ?? []).length;
  return japanese / chars.length >= 0.3;
};

/** One extracted paragraph, in the shape every reading pipeline already reads
 * (`HakushoParagraph` in `reading-chuubun-corpus.ts`). */
export interface ProseParagraph {
  readonly id: string;
  readonly license: string;
  readonly pageId: string;
  readonly pageUrl: string;
  readonly source: string;
  readonly text: string;
  readonly title: string;
}

/** The page's prose paragraphs, numbered from 1 in document order so the
 * trailing `-<n>` of an id is the sequence position a multi-paragraph window
 * needs to prove it is CONSECUTIVE prose and not a collage. */
export const proseParagraphsOf = ({
  credit,
  html,
  license,
  pageId,
  pageUrl,
}: {
  /** The attribution line the license asks for, already resolved for this page. */
  credit: string;
  html: string;
  license: string;
  pageId: string;
  pageUrl: string;
}): {
  readonly paragraphs: readonly ProseParagraph[];
  readonly title: string;
} => {
  const title = titleOf(html);
  const body = html.replace(SCRIPT_STYLE_RE, " ");
  const out: ProseParagraph[] = [];
  let index = 0;
  for (const matched of body.matchAll(PARAGRAPH_RE)) {
    const text = stripTags(matched[1] ?? "");
    if (!isProse(text)) {
      continue;
    }
    index += 1;
    out.push({
      id: `${pageId}-${index}`,
      license,
      pageId,
      pageUrl,
      source: credit,
      text,
      title,
    });
  }
  return { paragraphs: out, title };
};

// --- Polite fetch -------------------------------------------------------------

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch one page through a cache, refusing a decode too thin to be real prose.
 *
 * The refusal RETRIES (4 attempts, growing backoff) rather than dropping the
 * page, because env.go.jp answers burst traffic with HTTP 200 plus a near-empty
 * throttle page, which is indistinguishable from a genuinely short page by score
 * alone: an unthrottled parallel fetch destroyed ~26 good pages before this was
 * understood. Only a page that scores low on EVERY attempt is short.
 */
export const fetchHtmlPage = async ({
  cachePath,
  force,
  minScore,
  url,
}: {
  cachePath: string;
  force: boolean;
  minScore: number;
  url: string;
}): Promise<string> => {
  if (!force && existsSync(cachePath)) {
    return readFileSync(cachePath, "utf8");
  }
  const attempts = 4;
  let lastError = "no attempt ran";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the backoff between attempts IS the throttle fix; firing retries in parallel would re-trigger the block
      await sleep(attempt * 1500);
    }
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
    }).catch((error: unknown) => {
      lastError = String(error);
      return null;
    });
    if (response === null) {
      continue;
    }
    if (!response.ok) {
      lastError = `-> HTTP ${response.status}`;
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const decoded = decodePage(bytes);
    const score = japaneseScore(decoded);
    if (score < minScore) {
      lastError = `decoded to ${score} Japanese chars`;
      continue;
    }
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, decoded, "utf8");
    return decoded;
  }
  throw new Error(`${url} ${lastError}; refusing after ${attempts} attempts`);
};
