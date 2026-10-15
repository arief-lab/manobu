/**
 * Shared screens for the four 聴解 (listening) block gates
 * (`check-listening-{kadai,point,hatsuwa,sokuji}.ts`, TASK-173.8.1 AC#4).
 * NO LLM runs here.
 *
 * A 聴解 小問 prints ONE spoken scenario (the `script` stimulus the paper plays
 * once), ONE Japanese prompt, and FOUR options, exactly one of which keeps what
 * the scenario says. The four blocks differ in the scenario's SHAPE — 課題理解 and
 * ポイント理解 are short DIALOGUES, 場面対応 is a single spoken SITUATION, 即時応答 is
 * a single spoken PHRASE — and in the floor (小問数 × 4 papers), so the shared
 * screens live here and each block's own gate file adds only its block id, its
 * band choice and its floor.
 *
 * What the screens prove, mechanically, per row:
 *
 *   1. provenance: an AUTHORED row carries `construction: "authored"` +
 *      `provenance: "composed"` + `validated: true` +
 *      `validatedBy: "authored:agent-blind-judged"` (the two-blind-pass cert
 *      record) and is NOT listed in `{level}-{block}-rejected.json`; a VENDORED
 *      row (`provenance: "licensed"`, the JLPTSuccess CC BY-SA 4.0 dialogues,
 *      LICENSE §29) clears this screen on its license tag alone and carries no
 *      cert trio and no `validated`,
 *   2. the scenario is the right SHAPE for the block (a dialogue or a single
 *      line, inside the block's rune band for the level), carrying no 「　」 and
 *      no ＿＿ — a bracket or a blank is a row from another block (a 中文 cloze, a
 *      表記 sentence) filed here,
 *   3. the four options are DISTINCT, inside the level's option band, and
 *      orthographically Japanese. They are NOT required to be full sentences: a
 *      real N5 課題理解 asks どこ and the options are places (カフェの 前), and a
 *      time option prints ８時. The engine's leak rule exempts the 聴解 types
 *      (`STIMULUS_ANSWER_TYPES`, packages/item-engine/src/validation.ts) because
 *      a dialogue ANSWERS with words the dialogue SAYS — カフェの 前で 会いましょう
 *      is spoken verbatim in the very 小問 above — so there is deliberately no
 *      option-in-scenario screen here, and the same is true of the real exam.
 *      What IS screened is the prompt: the question may not print its own answer,
 *   4. the key is `options[0]` with `answerIndex: 0` and `key` repeating exactly
 *      that one string, so these files stay OUT of `check:reading-answers` (the
 *      page order comes from `shuffleQuestionItemOptions`, not from the store),
 *   5. the block id and the level stamp, and clean Japanese orthography (no
 *      Latin letters, no simplified-only hanzi, no hangul, no ASCII punctuation)
 *      in scenario, prompt and options — with NUMBERS excused, because ８時 and
 *      2000円 are legitimate listening options (the digits, both widths, are
 *      stripped before the shared screen judges), and with the vendored A/B
 *      SPEAKER LABELS excused, because a transcript whose speakers' genders are
 *      unknown labels them A： and B： and that is the only Latin shape the
 *      screen lets through,
 *   6. for an AUTHORED row only: a one-sentence Japanese `evidence` naming the
 *      answer, so the row carries its own justification. A licensed row's
 *      justification is its upstream item itself — the same contract as the
 *      licensed 短文 store, which carries no `evidence` field at all,
 *   7. the store floor (小問数 × 4 papers per block per level), and across the
 *      whole store: no scenario and no answer reused, because a scenario the
 *      store already asked is not a new 小問.
 *
 * What the screens CANNOT see is whether the answer option actually keeps what
 * the scenario says — a dialogue the learner hears once, and no word list decides
 * it. That is what the two blind judge passes certify on top of the cert trio
 * (for authored rows), and why no option is screened for meaning here. Exits 0
 * when every shipped row clears every screen; exits 1 naming the failing rows.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  loadRejectedLedger,
  orthographyIssues,
  runes,
} from "./check-word-shared";

const DATA_DIR = join(import.meta.dir, "..", "data");

/** The row is the listening 小問's record: one spoken scenario (the `script`),
 * one Japanese prompt (`stem`), four options, the frozen key slot and, for an
 * authored row, the cert trio and the `evidence`. */
export interface ListeningRow {
  answerIndex: number;
  block: string;
  construction?: string;
  evidence?: string;
  id: string;
  key: string[];
  level: string;
  options: string[];
  passage: string;
  provenance?: "licensed" | "composed";
  stem: string;
  validated?: boolean;
  validatedBy?: string;
}

/** The block's scenario shape. 課題理解/ポイント理解 print a multi-line dialogue
 * with a lead-in that restates the question; 場面対応 prints one situation
 * sentence; 即時応答 prints one spoken phrase; 概要理解 (TASK-173.9.4.1) prints
 * one longer COHERENT TEXT spoken by a single voice - the official ねらい asks
 * what the text as a whole says (話者の意図や主張, n3.pdf p.1), so a monologue
 * is the block's own shape and the length is what separates it from a ポイント理解
 * dialogue. */
export type ScenarioShape =
  | "dialogue"
  | "long-dialogue"
  | "monologue"
  | "phrase"
  | "situation";

/** Per-shape, per-level rune bands for the scenario: [min, max]. The numbers are
 * measured off the shipped content: the licensed N5 課題理解 dialogues run
 * 61-144 runes including the speaker prefixes and line breaks, the licensed 場面対応
 * situations 13-48, and the authored 即時応答 phrases sit under 40. N4's real
 * papers run longer, and its authored rows owe more. N3's band (TASK-173.9.4.1)
 * opens above N4's: an N3 dialogue carries more kanji and one more turn, and
 * the 概要理解 monologue is a single coherent talk the ねらい measures as a
 * TEXT (話者の意図や主張), not as an exchange. */
const SCENARIO_BANDS: Readonly<
  Record<ScenarioShape, Readonly<Record<string, readonly [number, number]>>>
> = {
  // TASK-173.9.4.3: the N1 lines open ONE STEP above N2's by decision, not by
  // measurement off shipped content — nothing has shipped at N1 yet. The
  // official ねらい (n1.pdf) runs the same five 大問 with more 小問 (6/7/6/14/4)
  // and N1's register is the densest kanji pace the family prints, so an N1
  // dialogue carries a longer exchange, a 概要理解 talk and a 統合理解 長めの話
  // run longer than N2's, and a 即時応答 response sentence may be longer. The
  // band is the floor the authored rows must clear, restated per level so an
  // N2-length row cannot quietly ship as N1.
  // TASK-173.9.4.2: N2 dialogues run one turn longer than N3's; the N2
  // 概要理解 monologue carries the same ねらい (話者の意図や主張, n2.pdf p.1)
  // at a slightly longer length.
  dialogue: {
    N1: [70, 340],
    N2: [60, 300],
    N3: [60, 260],
    N4: [50, 240],
    N5: [40, 180],
  },
  // TASK-173.9.4.2: 聴解統合理解's 長めの話 (n2.pdf p.1 ねらい), one long
  // dialogue backing TWO 小問 (N2L.pdf 問題5: 二つの質問).
  "long-dialogue": { N1: [180, 650], N2: [150, 600] },
  monologue: { N1: [120, 420], N2: [100, 400], N3: [100, 340] },
  phrase: { N1: [8, 65], N2: [8, 60], N3: [8, 60], N4: [8, 60], N5: [6, 45] },
  situation: { N3: [14, 90], N4: [12, 90], N5: [10, 70] },
};

/** The option band [min, max] per level. A 課題理解 option can be one kanji
 * (本, 雨) because the real exam offers places, seasons and objects; the top is
 * a full 即時応答 response sentence. N3's top opens past N4's for the same
 * reason its scenario band does. */
const OPTION_BANDS: Readonly<Record<string, readonly [number, number]>> = {
  N1: [1, 90],
  N2: [1, 80],
  N3: [1, 70],
  N4: [1, 60],
  N5: [1, 45],
};

export const BLOCK_SHAPES: Readonly<Record<string, ScenarioShape>> = {
  "choukai-tougou-rikai": "long-dialogue",
  "gaiyou-rikai": "monologue",
  "hatsuwa-hyougen": "situation",
  "kadai-rikai": "dialogue",
  "point-rikai": "dialogue",
  "sokuji-outou": "phrase",
};

/** One-sentence Japanese for the `evidence`: a full stop at the end, no other
 * inside. Options are NOT screened as sentences — see screen 3. */
const isOneSentence = (text: string): boolean => {
  const t = text.trimEnd();
  return t.endsWith("。") && t.slice(0, -1).indexOf("。") === -1;
};

/** Screen 2's marking half: a bracket is a 中文 cloze or a 表記 sentence filed
 * under a 聴解 heading, and a blank is a grammar row. */
const SCENARIO_BRACKETS = /[「」]/u;
const SCENARIO_BLANK = /＿/u;

/** Orthography with the NUMBERS excused (screen 5): ８時 and 2000円 are legitimate
 * listening options and stems, and the shared screen would refuse both widths of
 * digit. Everything else a stripped digit leaves behind (Latin letters, ASCII
 * punctuation, simplified hanzi, hangul) still fails.
 *
 * The two speaker-label tokens are excused too: a vendored transcript whose
 * speakers' genders are unknown labels them A and B (`A：`, `B さんの…`), and
 * those are the ONLY Latin shapes the screen lets through — a row that is
 * actually another language's still drowns in Latin letters everywhere else.
 * Authoring never leans on this: the authored rows label 男：/女：. */
const listeningOrthography = (where: string, text: string): string[] =>
  orthographyIssues(
    where,
    text
      .replace(/[0-9０-９]/g, "")
      .replace(/(^|\n)[AB](?=[：:])/g, "$1")
      .replace(/[AB](?= さん)/g, "")
  );

/** Screen 2: the scenario is the block's own shape and is marked nothing. */
const scenarioIssues = (
  scenario: string,
  sMin: number,
  sMax: number
): string[] => {
  const issues: string[] = [];
  if (SCENARIO_BRACKETS.test(scenario)) {
    issues.push("scenario-carries-brackets");
  }
  if (SCENARIO_BLANK.test(scenario)) {
    issues.push("scenario-carries-blank");
  }
  const scenarioLength = runes(scenario);
  if (scenarioLength < sMin || scenarioLength > sMax) {
    issues.push(`scenario-${scenarioLength}runes-outside-${sMin}-${sMax}`);
  }
  return issues;
};

/** Screen 3's option half: four distinct options inside the band, none blank. A
 * dialogue that SPEAKS its answer is the construction (screen 3's docblock), so
 * there is no option-in-scenario check. */
const optionBandIssues = (
  options: readonly string[],
  oMin: number,
  oMax: number
): string[] => {
  const issues: string[] = [];
  if (options.length !== 4) {
    issues.push(`options-count-${options.length}`);
  }
  if (new Set(options).size !== options.length) {
    issues.push("options-not-distinct");
  }
  options.forEach((option, index) => {
    if (option.trim().length === 0) {
      issues.push("option-blank");
      return;
    }
    const optionLength = runes(option);
    if (optionLength < oMin || optionLength > oMax) {
      issues.push(
        `option${index}-${optionLength}runes-outside-${oMin}-${oMax}`
      );
    }
  });
  return issues;
};

/** Screen 4 plus the prompt half of screen 3: the frozen key slot is
 * `options[0]`, and the question may not print its own answer — for a
 * stimulus-answered type the prompt is the only surface `hasStemLeak` reads. */
const answerSlotIssues = (row: ListeningRow): string[] => {
  const issues: string[] = [];
  if (row.answerIndex !== 0) {
    issues.push(`answerIndex-${row.answerIndex}`);
  }
  const answer = row.options[0] ?? "";
  if (row.key.length !== 1 || row.key[0] !== answer) {
    issues.push("key-not-one-answer-matching-options-0");
  }
  if (answer && row.stem.includes(answer)) {
    issues.push(`answer-in-stem:${answer}`);
  }
  return issues;
};

/** Screen 6's licensed half: a vendored row carries no evidence, because the
 * upstream item is its own justification. */
const licensedEvidenceIssues = (row: ListeningRow): string[] =>
  row.evidence !== undefined && row.evidence.length > 0
    ? ["licensed-row-carries-evidence"]
    : [];

/** Screen 6's authored half: a one-sentence Japanese `evidence` naming the
 * answer, or the row was written without a reason. */
const authoredEvidenceIssues = (row: ListeningRow): string[] => {
  if (row.evidence === undefined || row.evidence.length === 0) {
    return ["authored-row-lacks-evidence"];
  }
  if (!isOneSentence(row.evidence)) {
    return ["evidence-not-one-japanese-sentence"];
  }
  const answer = row.options[0] ?? "";
  if (answer && !row.evidence.includes(answer)) {
    return [`evidence-names-not-answer:${answer}`];
  }
  return [];
};

/** Screen 6: an AUTHORED row owes a one-sentence Japanese `evidence` naming the
 * answer; a licensed row carries none (the upstream item is its justification). */
const evidenceIssues = (row: ListeningRow): string[] =>
  row.provenance === "licensed"
    ? licensedEvidenceIssues(row)
    : authoredEvidenceIssues(row);

/** The shared content screens (2-6): the scenario shape, the four options, the
 * prompt leak, the answer slot and the evidence. */
export const listeningContentIssues = (
  row: ListeningRow,
  shape: ScenarioShape,
  level = row.level
): string[] => {
  const band = SCENARIO_BANDS[shape][level];
  if (band === undefined) {
    return [`listening-band-unknown:${shape}:${level}`];
  }
  const [sMin, sMax] = band;
  const [oMin, oMax] = OPTION_BANDS[level] ?? [0, 0];

  const scenario = row.passage;
  const issues = [
    ...scenarioIssues(scenario, sMin, sMax),
    ...optionBandIssues(row.options, oMin, oMax),
    ...answerSlotIssues(row),
  ];

  // Screen 5: clean Japanese orthography across scenario, prompt, options and
  // (when present) evidence.
  for (const [where, text] of [
    ["scenario", scenario],
    ["stem", row.stem],
    ...(row.evidence === undefined ? [] : [["evidence", row.evidence]]),
  ] as const) {
    issues.push(...listeningOrthography(where, text));
  }
  row.options.forEach((option, index) => {
    issues.push(...listeningOrthography(`option${index}`, option));
  });

  issues.push(...evidenceIssues(row));
  return issues;
};

/** Screen 1's VENDORED half: the row may not fake the authored branch's cert
 * trio; the license tag itself is the row's proven claim. */
const licensedProofIssues = (row: ListeningRow): string[] => {
  const issues: string[] = [];
  // A vendored row is trusted as verbatim licensed content (CC BY-SA 4.0,
  // LICENSE §29), so it carries no cert trio and no `validated`. It still must
  // not fake the authored branch's fields.
  if (row.validated === true) {
    issues.push("licensed-row-claims-validated");
  }
  if (row.construction === "authored") {
    issues.push("licensed-row-claims-authored-construction");
  }
  return issues;
};

/** Screen 1's AUTHORED half: the full cert trio, each piece named with what it
 * found missing rather than with one shared refusal code. */
const composedProofIssues = (row: ListeningRow): string[] => {
  const issues: string[] = [];
  if (row.construction !== "authored") {
    issues.push(`construction-is-${row.construction ?? "missing"}`);
  }
  if (row.provenance !== "composed") {
    issues.push(`provenance-is-${row.provenance ?? "missing"}`);
  }
  if (row.validated !== true) {
    issues.push("not-validated");
  }
  if (row.validatedBy !== "authored:agent-blind-judged") {
    issues.push(`validatedBy-is-${row.validatedBy ?? "missing"}`);
  }
  return issues;
};

/** Screen 1: the cert trio for an AUTHORED row, or the license tag for a
 * VENDORED one, and the row is not one the two blind passes rejected. A row
 * that is neither composed-and-validated nor licensed fails the whole screen. */
export const listeningProvenanceIssues = (
  row: ListeningRow,
  rejectedIds: ReadonlySet<string>
): string[] => [
  ...(rejectedIds.has(row.id) ? ["row-judge-rejected"] : []),
  ...(row.provenance === "licensed"
    ? licensedProofIssues(row)
    : composedProofIssues(row)),
];

/** The shipped store for one block at one level, read by the block's FILE STEM
 * (`kadai`, `point`, `hatsuwa`, `sokuji` — the short names `packages/item-engine/src/paper.ts`
 * promises in its per-block comments, not the 大問 id). A missing file is
 * reported by the floor check, not a stack trace. */
export const loadListeningLevel = (level: string, fileStem: string) => {
  const file = join(
    DATA_DIR,
    "reading",
    `${level.toLowerCase()}-${fileStem}.json`
  );
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ListeningRow[];
  } catch {
    return null;
  }
};

/** The burned-id ledger for one block's store, read from
 * `{level}-{fileStem}-rejected.json`. A missing file is an empty set: zero rows
 * burned is a legitimate outcome, and the gate still honours the record if one
 * ever ships. */
export const loadListeningRejectedLedger = (
  level: string,
  fileStem: string
): ReadonlySet<string> =>
  loadRejectedLedger(
    join(
      DATA_DIR,
      "reading",
      `${level.toLowerCase()}-${fileStem}-rejected.json`
    )
  );

/** Both screens over one row, the shape every block's gate feeds it. */
export const listeningRowIssues = (
  row: ListeningRow,
  rejectedIds: ReadonlySet<string> = new Set<string>()
): string[] => {
  const shape = BLOCK_SHAPES[row.block];
  if (shape === undefined) {
    return [`block-unknown:${row.block}`];
  }
  return [
    ...listeningProvenanceIssues(row, rejectedIds),
    ...listeningContentIssues(row, shape),
  ];
};

/** The store's rows bucketed by the exact scenario text they print, in first-
 * encounter order. */
const groupsByScript = (
  rows: readonly ListeningRow[]
): Map<string, ListeningRow[]> => {
  const byScript = new Map<string, ListeningRow[]>();
  for (const row of rows) {
    const group = byScript.get(row.passage) ?? [];
    group.push(row);
    byScript.set(row.passage, group);
  }
  return byScript;
};

/** Two 小問 of one dialogue are two distinct questions: a group that repeats a
 * stem is one question aired twice under two keys. */
const scriptGroupReuseIssue = (
  group: readonly ListeningRow[]
): string | null => {
  const stems = new Set(group.map((row) => row.stem));
  if (stems.size === group.length) {
    return null;
  }
  const first = group[0]?.id ?? "?";
  return `script-group-reused-stem:${first}`;
};

/** Screen 7's store-wide half: no scenario spent twice, no answer text spent
 * twice within a block. Distractors may repeat (real papers re-offer the same
 * places and seasons); the scenario and the ANSWER are the item's identity. */
export const listeningReuseClashes = (
  rows: readonly ListeningRow[],
  scriptGroupSize?: number
): string[] => {
  const issues: string[] = [];
  if (scriptGroupSize !== undefined) {
    // TASK-173.9.4.2: 聴解統合理解 INVERTS the scenario screen. The official
    // form hears ONE long dialogue once and asks TWO 小問 of it (二つの質問),
    // so each script must appear EXACTLY `scriptGroupSize` times in the store
    // (one paper's worth of its 小問), never once (an unservable orphan) and
    // never more (a dialogue two papers would re-air). The ANSWER stays unique
    // per row: two 小問 of one talk are still two distinct questions.
    for (const group of groupsByScript(rows).values()) {
      if (group.length !== scriptGroupSize) {
        const first = group[0]?.id ?? "?";
        issues.push(
          `script-group-wrong-size:${first}:${group.length}x-of-${scriptGroupSize}`
        );
      }
      const reuse = scriptGroupReuseIssue(group);
      if (reuse !== null) {
        issues.push(reuse);
      }
    }
    return [...issues, ...answerClashes(rows)];
  }
  return [...scenarioClashes(rows), ...answerClashes(rows)];
};

/** The scenario half of the reuse screen: no two rows of one block share a
 * spoken scenario. (The 統合理解 gate replaces this with its group-size
 * rule above.) */
const scenarioClashes = (rows: readonly ListeningRow[]): string[] => {
  const issues: string[] = [];
  const scenarios = new Map<string, string>();
  for (const row of rows) {
    const first = scenarios.get(row.passage);
    if (first !== undefined && first !== row.id) {
      issues.push(`reused-scenario:${row.id}:${first}`);
    }
    if (first === undefined) {
      scenarios.set(row.passage, row.id);
    }
  }
  return issues;
};

/** The answer half of the reuse screen: the key is the item's identity, so no
 * two rows of one block print the same answer text. */
const answerClashes = (rows: readonly ListeningRow[]): string[] => {
  const issues: string[] = [];
  const answers = new Map<string, string>();
  for (const row of rows) {
    const key = row.options[0] ?? "";
    const first = answers.get(key);
    if (first !== undefined && first !== row.id) {
      issues.push(`reused-answer:${row.id}:${first}`);
    }
    if (first === undefined) {
      answers.set(key, row.id);
    }
  }
  return issues;
};

/** Every level this family could ever ship at. A store file that exists for a
 * level the gate does not list fails (`store-shipped-but-not-checked`), so the
 * N4 commit cannot land an unjudged file by forgetting to extend the floor
 * table, and a bare run at the N5-only commit is honest about checking N5.
 * N3 joins under TASK-173.9.4.1, which is also why every band table above
 * names it. */
const KNOWN_LEVELS: readonly string[] = ["N1", "N2", "N3", "N4", "N5"];

/** The per-row half of screen 7's level loop: both content screens plus the
 * block id and level stamp, one printed line per failing row. Returns the count. */
const screenStoreRows = ({
  block,
  ledger,
  level,
  rows,
}: {
  block: string;
  ledger: ReadonlySet<string>;
  level: string;
  rows: readonly ListeningRow[];
}): number => {
  let failing = 0;
  for (const row of rows) {
    const issues = [...listeningRowIssues(row, ledger)];
    if (row.block !== block) {
      issues.push(`block-is-${row.block}`);
    }
    if (row.level !== level) {
      issues.push(`level-is-${row.level}`);
    }
    if (issues.length > 0) {
      failing += 1;
      console.log(`  ${level} ${row.id}: ${issues.join(", ")}`);
    }
  }
  return failing;
};

/** The whole gate, run by each block's thin entry file with its own block id
 * and floors: per-row screens, the two identity stamps, the reuse screen and
 * the floor, with one printed line per level and exitCode 1 on any failure. */
export const runListeningGate = (
  block: string,
  fileStem: string,
  minRowsByLevel: Readonly<Record<string, number>>,
  scriptGroupSize?: number
): void => {
  console.log(`check:listening-${fileStem}`);
  const allRows: ListeningRow[] = [];
  for (const level of KNOWN_LEVELS) {
    const floor = minRowsByLevel[level];
    if (floor === undefined) {
      const early = loadListeningLevel(level, fileStem);
      if (early !== null) {
        console.log(
          `  ${level}: store-shipped-but-not-checked (${early.length} rows in a file no floor table names)`
        );
        process.exitCode = 1;
      }
      continue;
    }
    const rows = loadListeningLevel(level, fileStem);
    if (rows === null) {
      console.log(
        `  ${level}: no data/reading/${level.toLowerCase()}-${fileStem}.json store file`
      );
      process.exitCode = 1;
      continue;
    }
    const failing = screenStoreRows({
      block,
      ledger: loadListeningRejectedLedger(level, fileStem),
      level,
      rows,
    });
    if (rows.length < floor) {
      console.log(
        `  ${level}: store holds ${rows.length} rows, below the ${floor} required (小問数 x 4 papers)`
      );
      process.exitCode = 1;
    } else if (failing > 0) {
      console.log(`${level}: ${failing} row(s) failed the 聴解 screens`);
      process.exitCode = 1;
    } else {
      console.log(
        `${level}: ${rows.length} 聴解 ${block} rows pass all screens`
      );
    }
    allRows.push(...rows);
  }
  const clashes = listeningReuseClashes(allRows, scriptGroupSize);
  if (clashes.length > 0) {
    for (const clash of clashes) {
      console.log(`  ${clash}`);
    }
    process.exitCode = 1;
  }
};
