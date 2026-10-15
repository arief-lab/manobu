/**
 * The authored 読解 screens, in one place.
 *
 * TASK-173.9.16 built these inside `check-reading-choubun.ts` for one block, and
 * doc-27 §10 makes them the route for every comprehension 大問 the 白書 cannot
 * back. A second gate copying the branch is the clone disease TASK-173.14
 * documents, so a gate that wants the authored route imports it and passes its
 * own block's numbers in: the passage band, the option count, the evidence
 * bounds, the paragraph minimum and the ねらい table.
 *
 * What a threshold is NOT here is the point. 短文 prints one 100-240 rune
 * paragraph and 長文 prints a multi-paragraph document, so `minParagraphs` is
 * a parameter rather than a constant, and a screen hardening the 中文 band would
 * refuse the 短文 store for a reason that has nothing to do with the item.
 *
 * Every screen is decidable without reading Japanese: length, paragraph count,
 * option shape, a stem matching a known ねらい pattern, and a quoted span
 * occurring verbatim in the passage it cites. What they cannot decide is whether
 * the cited sentence actually entails the key. That residue is the blind-judge
 * record and doc-27 §11, and `coverageOf` stays a diagnostic the CALLER prints,
 * never a screen: the official N3 長文 itself scores below every floor in this
 * repo (doc-27 §1).
 */

import { BLANK } from "./reading-n4-corpus";

/** The construction tag a written row carries. */
export const AUTHORED_CONSTRUCTION = "authored";

/** The signer an authored row carries. It says what actually certified the key:
 * not a human who read the Japanese (nobody in this project can, so no row here
 * has a human reader behind it), and not the coverage floor, but two independent
 * blind judge passes over a key-less packet whose verdicts freeze in
 * `{level}-{block}-rejected.json`. It names no reviewer that does not exist,
 * because this string is the only provenance a reader of the JSON sees, and it is
 * the SAME string for every block that takes the authored route: what certifies a
 * written 短文 and a written 長文 is the same procedure at different length. */
export const AUTHORED_SIGNER = "authored:agent-blind-judged";

/** Is this row written rather than windowed? An untagged row is NOT authored, so
 * it falls to the corpus branch and its stricter proof: an untagged row can never
 * slip through on the easier screens. */
export const isAuthoredConstruction = (
  construction: string | undefined
): boolean => construction === AUTHORED_CONSTRUCTION;

/** The 内容理解 ねらい a written stem can ask for, checked in order and first
 * match wins. These are the exam's own comprehension asks (指すこと、気持ち、依頼、
 * 理由、筆者の考え、説明、内容), so the same table serves 短文, 中文, 長文, 主張理解 and
 * 統合理解: which 大問 asks is a length and shape question the CALLING gate owns,
 * not a different set of intents.
 *
 * The order matters where a stem names two aspects (「理由について…説明として」 is an
 * 説明 question that happens to mention 理由), so the more specific shape comes
 * first. `reason` is checked before `opinion` for the same reason: a 理由 stem
 * hedges itself as 「〜と考えられているのはなぜか」, and there 考え is the passive
 * ("it is thought that"), not 筆者の考え. The bare substring 考え is the LOOSER match
 * of the two, so the ask that names itself (なぜ) wins it.
 *
 * An unclassifiable stem FAILS the gate rather than passing uncounted: that is
 * what makes adding a new ねらい a deliberate edit to this table. */
export const COMPREHENSION_INTENTS: Readonly<
  readonly { readonly intent: string; readonly marker: string }[]
> = [
  { intent: "reference", marker: "指している" },
  { intent: "feeling", marker: "気持ち" },
  { intent: "request", marker: "頼んでいる" },
  { intent: "reason", marker: "なぜ" },
  { intent: "opinion", marker: "考え" },
  { intent: "explanation", marker: "説明として" },
  { intent: "content", marker: "内容に合っている" },
];

/** The ねらい a stem asks for, or null when this table does not know it. */
export const comprehensionIntentFor = (stem: string): string | null => {
  for (const { intent, marker } of COMPREHENSION_INTENTS) {
    if (stem.includes(marker)) {
      return intent;
    }
  }
  return null;
};

/** The row fields these screens read, as a structural type so each gate can pass
 * its own entry interface without widening it into a union nobody reads. */
export interface AuthoredRow {
  readonly answerIndex: number;
  readonly construction?: string;
  readonly evidence?: string;
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passage: string;
  readonly sourceIds?: readonly string[];
  readonly stem: string;
}

/** The shortest evidence span an authored row may print. Anything smaller is a
 * label, not the sentence that decides the key. */
export const AUTHORED_MIN_EVIDENCE_RUNES = 20;

/** The largest fraction of the passage an evidence span may cover. A row that
 * quotes the whole document back is not citing a deciding sentence, it is
 * restating the passage, and the screen has to refuse that. */
export const AUTHORED_MAX_EVIDENCE_RATIO = 0.5;

/** A 大問 trains several ねらい, and a store whose rows all ask "what does the
 * passage say" is one ねらい printed several times. Every stem must classify into
 * exactly one intent and the store must span at least this many of them. Four is
 * the 小問 count of one real 大問 at N3 and N4, and the 長文, 短文 and 中文 blocks
 * all print at least four, so the same floor serves every block that takes this
 * route. */
export const AUTHORED_MIN_INTENTS = 4;

/** One block's authored configuration. Every field is a number or a predicate
 * the owning block has already measured; none of them is shared. */
export interface AuthoredConfig {
  /** The passage band per level, or undefined for a level this block does not
   * write at. A config that never names the row's level refuses the row rather
   * than passing it unmeasured. */
  readonly bandFor: (
    level: string
  ) => { readonly max: number; readonly min: number } | undefined;
  readonly evidence: { readonly maxRatio: number; readonly minRunes: number };
  /** The ねらい a stem asks for, or null when this table does not know it. An
   * unclassifiable stem fails, which is what makes adding a ねらい a deliberate
   * edit to the caller's table. */
  readonly intentFor: (stem: string) => string | null;
  /** The distinct ねらい a whole store must span. */
  readonly minIntents: number;
  /** The paragraphs a passage must carry. 0 disables the screen for a block whose
   * real 小問 prints one short paragraph. */
  readonly minParagraphs: number;
  readonly optionCount: number;
}

/** The option shape a 小問 is: exactly this many options, none empty, none
 * repeated, and a key that points at one of them. */
export const optionShapeIssues = (
  entry: AuthoredRow,
  optionCount: number
): string[] => {
  const issues: string[] = [];
  if (entry.options.length !== optionCount) {
    issues.push(`options-count-not-${optionCount}`);
    return issues;
  }
  if (entry.options.some((option) => option.length === 0)) {
    issues.push("option-empty");
  }
  if (new Set(entry.options).size !== entry.options.length) {
    issues.push("options-not-distinct");
  }
  const answer = entry.options[entry.answerIndex];
  if (answer === undefined) {
    issues.push("answer-index-out-of-range");
  } else if (answer.length === 0) {
    issues.push("answer-empty");
  }
  return issues;
};

/** A written row claims no source window and no slot. Either present means the
 * wrong branch was tagged, which is how a row escapes the other branch's
 * restore-to-source proof. */
const authoredWindowIssues = (entry: AuthoredRow): string[] => {
  const issues: string[] = [];
  if ((entry.sourceIds?.length ?? 0) > 0) {
    issues.push("authored-row-carries-sourceIds");
  }
  if (entry.passage.includes(BLANK) || entry.stem.includes(BLANK)) {
    issues.push("authored-row-carries-blank");
  }
  return issues;
};

/** The passage against the level's own band, and against the paragraph count
 * the block's genre demands. */
const authoredPassageBandIssues = ({
  band,
  config,
  entry,
  runes,
}: {
  readonly band: { readonly max: number; readonly min: number };
  readonly config: AuthoredConfig;
  readonly entry: AuthoredRow;
  readonly runes: number;
}): string[] => {
  const issues: string[] = [];
  if (runes > band.max) {
    issues.push("passage-too-long");
  }
  if (runes < band.min) {
    issues.push("passage-too-short");
  }
  if (
    config.minParagraphs > 0 &&
    entry.passage.split("\n").length < config.minParagraphs
  ) {
    issues.push("passage-single-paragraph");
  }
  return issues;
};

/** The evidence span must be a sentence the passage prints verbatim, long
 * enough to decide the key and short enough to not be the document. */
const authoredEvidenceIssues = ({
  config,
  entry,
  runes,
}: {
  readonly config: AuthoredConfig;
  readonly entry: AuthoredRow;
  readonly runes: number;
}): string[] => {
  const evidence = entry.evidence ?? "";
  const evidenceRunes = [...evidence].length;
  if (evidenceRunes === 0) {
    return ["evidence-missing"];
  }
  if (!entry.passage.includes(evidence)) {
    // An evidence span that is not verbatim is a summary of the item, not the
    // reason the key holds.
    return ["evidence-not-in-passage"];
  }
  if (evidenceRunes < config.evidence.minRunes) {
    return ["evidence-too-short"];
  }
  if (evidenceRunes > runes * config.evidence.maxRatio) {
    return ["evidence-covers-whole-passage"];
  }
  return [];
};

/** One authored 小問: the screens a written comprehension item can be held to,
 * none of which touch a corpus. `level` is the level the GATE was run for, not
 * the row's own claim: a row mislabelling itself is caught by the caller's field
 * check and must not be measured against the band it asks for. */
export const authoredRowIssues = (
  entry: AuthoredRow,
  level: string,
  config: AuthoredConfig,
  rejections: ReadonlySet<string>
): string[] => {
  const band = config.bandFor(level);
  if (band === undefined) {
    return ["authored-band-unknown"];
  }
  const runes = [...entry.passage].length;
  const issues = [
    ...authoredWindowIssues(entry),
    ...authoredPassageBandIssues({ band, config, entry, runes }),
    ...optionShapeIssues(entry, config.optionCount),
  ];
  if (config.intentFor(entry.stem) === null) {
    issues.push("stem-intent-unclassified");
  }
  issues.push(...authoredEvidenceIssues({ config, entry, runes }));
  if (rejections.has(entry.id)) {
    issues.push("row-judge-rejected");
  }
  return issues;
};

/** What no single authored row can satisfy or break: the ねらい spread is counted
 * over the store, so a row cannot pass itself by asking one novel question.
 * `intents` is the tally the caller keeps while walking its own rows. */
export const authoredFileIssues = (
  intents: ReadonlySet<string>,
  config: AuthoredConfig
): string[] => {
  const issues: string[] = [];
  if (intents.size < config.minIntents) {
    issues.push(`intents-below-floor:${intents.size}<${config.minIntents}`);
  }
  return issues;
};

/** A store may not carry both constructions: the two branches prove different
 * things about a row, and a mixed file would let one row choose its easier proof.
 * `hasAuthored` is the caller's own tag read, so this stays honest for a gate
 * whose rows are typed by its own store. */
export const mixedConstructionIssue = (
  entries: readonly { readonly construction?: string }[]
): string | null => {
  const hasAuthored = entries.some((entry) =>
    isAuthoredConstruction(entry.construction)
  );
  return hasAuthored &&
    entries.some((entry) => !isAuthoredConstruction(entry.construction))
    ? "mixed-constructions"
    : null;
};

/** The file-level tail the composed stores repeat: one store may not mix the
 * two proof branches, and a store with written rows must spread its ねらい over
 * the block's own floor. `extras` is what a block adds INSIDE the authored
 * branch (only 中短問 ships it, the reason spread) and stays unrun for a pure
 * corpus store, which is the same guard `authoredFileIssues` has always had:
 * tallying nothing against a floor of zero would fail a masked store for the
 * wrong reason. */
export const mixedAndAuthoredFileIssues = ({
  config,
  entries,
  extras = (): readonly string[] => [],
  intents,
}: {
  config: AuthoredConfig;
  entries: readonly { readonly construction?: string }[];
  extras?: () => readonly string[];
  intents: ReadonlySet<string>;
}): string[] => {
  const issues: string[] = [];
  const mixed = mixedConstructionIssue(entries);
  if (mixed !== null) {
    issues.push(mixed);
  }
  if (entries.some((entry) => isAuthoredConstruction(entry.construction))) {
    issues.push(...authoredFileIssues(intents, config), ...extras());
  }
  return issues;
};
