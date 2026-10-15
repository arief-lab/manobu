/**
 * TASK-173.9.6 AC#3: the `check:reading-n4` gate is pinned with REAL data
 * assertions over fixtures (temp dirs + parsed reports), not source-text
 * `readFileSync`/`toContain` checks (TASK-134). Two row contracts are pinned:
 *
 *   - the AUTHORED-KEY contract (passage byte-equals its single source; the
 *     deliberately-ambiguous repeated-option row must be REJECTED), and
 *   - the MASKED-SLOT contract (the passage is the source with one word
 *     blanked, the answer restores it byte for byte, and no distractor occurs
 *     in the source), including the two defects this gate exists to catch: a
 *     hand-swapped distractor and a tampered blank.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ComposedReadingEntry,
  checkEntry,
  checkReadingFile,
  loadTatoebaSentences,
} from "../scripts/check-reading-n4";
import {
  buildContextFillers,
  buildVocabIndex,
  GENERATOR_SIGNER,
  READING_STEM,
  type VocabEntry,
} from "../scripts/reading-n4-corpus";

const SENTENCES = [
  { id: "1001", jp: "あした は あめが ふる と おもいます。" },
  { id: "1002", jp: "かれ は つくえ の うえ に てんご を のこしました。" },
  {
    id: "9001" /* long source used only by the too-long fixture */,
    jp: "の".repeat(241),
  },
];

/** The masked-slot source: every word is in-level (雨 / が as a function word /
 * 降る), and exactly one noun occurs once, so it is the only maskable slot. */
const MASKED_SOURCE = {
  en: "It is raining.",
  id: "2001",
  jp: "雨が降っている。",
  linkedWords: ["雨", "が", "降る{降っている}"],
};

const VOCAB_FIXTURE: readonly VocabEntry[] = [
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "あめ",
    senses: [["rain"]],
    word: "雨",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "かぜ",
    senses: [["wind"]],
    word: "風",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "ゆき",
    senses: [["snow"]],
    word: "雪",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "どうぐ",
    senses: [["tool", "implement"]],
    word: "道具",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "てがみ",
    senses: [["letter"]],
    word: "手紙",
  },
  {
    level: "N5",
    partOfSpeech: "verb, intransitive verb",
    reading: "ふる",
    senses: [["fall", "rain (precipitation)"]],
    word: "降る",
  },
  { level: "N5", partOfSpeech: "particle", reading: "は", word: "は" },
];

const VOCAB = buildVocabIndex(VOCAB_FIXTURE);

const sourceMap = (
  entries: readonly {
    en?: string;
    id: string;
    jp: string;
    linkedWords?: readonly string[];
  }[]
) =>
  new Map(
    entries.map((each) => [
      each.id,
      {
        en: each.en ?? "",
        id: each.id,
        jp: each.jp,
        linkedWords: each.linkedWords ?? [],
      },
    ])
  );

const dirs: string[] = [];
const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "reading-n4-"));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const baseEntry = (
  overrides: Partial<ComposedReadingEntry> = {}
): ComposedReadingEntry => ({
  answerIndex: 2,
  block: "naiyou-rikai-tanbun",
  id: "n4c-1",
  level: "N4",
  options: [
    "ふります",
    "ふっていました",
    "ふるとおもいます",
    "ふらないとおもいます",
  ],
  passage: "あした は あめが ふる と おもいます。",
  provenance: "composed",
  sourceIds: ["1001"],
  stem: "この ぶんから、あとの せつに あうものは どれですか。",
  validated: true,
  validatedBy: "opencode:anthropic/claude-test-model",
  ...overrides,
});

const maskedEntry = (
  overrides: Partial<ComposedReadingEntry> = {}
): ComposedReadingEntry => ({
  answerIndex: 0,
  block: "naiyou-rikai-tanbun",
  construction: "masked-slot",
  id: "n4m-2001",
  level: "N4",
  options: ["雨", "風", "雪", "道具"],
  passage: "＿＿が降っている。",
  provenance: "composed",
  sourceIds: ["2001"],
  stem: READING_STEM,
  validated: true,
  validatedBy: GENERATOR_SIGNER,
  ...overrides,
});

const authoredIssuesFor = (entry: ComposedReadingEntry): string[] =>
  checkEntry(entry, sourceMap(SENTENCES), VOCAB);

const maskedIssuesFor = (entry: ComposedReadingEntry): string[] =>
  checkEntry(entry, sourceMap([MASKED_SOURCE]), VOCAB);

// Fixture sentences by position; `?? ""` satisfies noUncheckedIndexedAccess
// without inline optional chaining on the literal array.
const sentenceAt = (index: number): string => SENTENCES[index]?.jp ?? "";

describe("checkEntry: a clean authored-key row", () => {
  it("passes with zero issues", () => {
    expect(authoredIssuesFor(baseEntry())).toEqual([]);
  });
});

describe("checkEntry: provenance and freeze fields", () => {
  it("rejects a row whose provenance is not composed", () => {
    expect(authoredIssuesFor(baseEntry({ provenance: undefined }))).toContain(
      "provenance-not-composed"
    );
  });

  it("rejects a composed row that is not validated", () => {
    expect(authoredIssuesFor(baseEntry({ validated: false }))).toContain(
      "not-validated"
    );
  });

  it("rejects a validated row whose validatedBy names no judge agent", () => {
    // The empty-validatedBy seam (TASK-173.9.6 AC#7): `validated: true` with
    // an anonymous signer is exactly the laundering the gate exists to stop.
    expect(authoredIssuesFor(baseEntry({ validatedBy: "" }))).toContain(
      "validatedBy-missing-or-bad-form"
    );
    expect(
      authoredIssuesFor(baseEntry({ validatedBy: "antigravity:gpt?" }))
    ).toContain("validatedBy-missing-or-bad-form");
  });

  it("rejects the agent prefix with an empty resolved model id", () => {
    // `opencode:` with no model is not the AC#2 form (opencode:<non-empty model id>).
    expect(
      authoredIssuesFor(baseEntry({ validatedBy: "opencode:" }))
    ).toContain("validatedBy-missing-or-bad-form");
  });

  it("rejects a judge that resolved onto the author's Gemini family", () => {
    // Independence, checked: an opencode session that picked a google/gemini
    // model shares the agy author's family, so it cannot launder the freeze.
    expect(
      authoredIssuesFor(
        baseEntry({ validatedBy: "opencode:google/gemini-2.5-pro" })
      )
    ).toContain("validatedBy-judge-model-is-author-family");
  });
});

describe("checkEntry: single-sentence verbatim sourcing", () => {
  it("rejects a stitch-up over two source ids (the old subset hole)", () => {
    const stitch = `${sentenceAt(0)}${sentenceAt(1)}`;
    const issues = authoredIssuesFor(
      baseEntry({
        passage: stitch,
        sourceIds: ["1001", "1002"],
      })
    );
    expect(issues).toContain("sourceIds-not-single");
  });

  it("rejects a passage that is not byte-equal to its single source", () => {
    const issues = authoredIssuesFor(
      baseEntry({ passage: "あした は あめが ふる と おもいます" })
    );
    expect(issues).toContain("passage-not-verbatim");
  });

  it("rejects a source id that is not in sentences.jsonl", () => {
    expect(authoredIssuesFor(baseEntry({ sourceIds: ["999999"] }))).toContain(
      "sourceId-unknown"
    );
  });

  it("rejects a passage over the 240-rune short-reading cap", () => {
    const issues = authoredIssuesFor(
      baseEntry({
        passage: sentenceAt(2),
        sourceIds: ["9001"],
      })
    );
    expect(issues).toContain("passage-too-long");
    expect(issues).toContain("structural:passage-length");
  });
});

describe("checkEntry: structure via the item-engine validator", () => {
  it("rejects the deliberately-ambiguous fixture: two identical options", () => {
    // AC#3. The answer is offered twice - two defensibly-correct options in
    // their mechanically detectable form. A real paper would grade both as
    // the same correct answer, so the gate must refuse the row.
    const issues = authoredIssuesFor(
      baseEntry({
        answerIndex: 2,
        options: [
          "ふります",
          "ふっていました",
          "ふるとおもいます",
          "ふるとおもいます",
        ],
      })
    );
    expect(issues).toContain("structural:duplicate-option");
  });

  it("rejects an answer option echoed inside the stem (stem-leak)", () => {
    const issues = authoredIssuesFor(
      baseEntry({ stem: "「ふるとおもいます」は 正しいですか。" })
    );
    expect(issues).toContain("structural:stem-leak");
  });

  it("rejects an answer index outside the option range", () => {
    expect(authoredIssuesFor(baseEntry({ answerIndex: 4 }))).toContain(
      "structural:answer-index"
    );
  });

  it("rejects an option count that is not four", () => {
    expect(
      authoredIssuesFor(baseEntry({ answerIndex: 0, options: ["a", "b", "c"] }))
    ).toContain("structural:option-count");
  });
});

describe("checkEntry: the masked-slot contract", () => {
  it("passes a clean generated row with zero issues", () => {
    // MASKED_SOURCE's frame has no second corpus witness (single-sentence
    // sourceMap) and carries the content word 降る, so it is solvable, and no
    // judge rejections are supplied by default.
    expect(maskedIssuesFor(maskedEntry())).toEqual([]);
  });

  it("rejects a row the judge rejected (row-judge-rejected)", () => {
    // The freeze-time judge record is data: a row id in n4-rejected.json can
    // never sit in the frozen store, however well-formed its construction.
    const issues = checkEntry(
      maskedEntry(),
      sourceMap([MASKED_SOURCE]),
      VOCAB,
      new Map(),
      new Set(["n4m-2001"])
    );
    expect(issues).toContain("row-judge-rejected");
  });

  it("rejects a bare-frame slot the corpus cannot decide (answer-context-ambiguous)", () => {
    // 「＿＿はかわりますが。」: the frame holds only function words, so no
    // content word pins the noun and the corpus witnesses prove nothing. The
    // learner would see only this frame - the condition the blind-judge run
    // marked 13 of the first 24 rows with.
    const bare = {
      en: "To change the subject.",
      id: "2004",
      jp: "話はかわりますが。",
      linkedWords: ["話", "は", "変わる{かわります}"],
    };
    const vocab = buildVocabIndex([
      ...VOCAB_FIXTURE,
      {
        level: "N4",
        partOfSpeech: "noun",
        reading: "わ",
        senses: [["subject", "talk"]],
        word: "話",
      },
    ]);
    const entry = maskedEntry({
      id: "n4m-2004",
      options: ["話", "風", "雪", "道具"],
      passage: "＿＿はかわりますが。",
      sourceIds: ["2004"],
    });
    const issues = checkEntry(entry, sourceMap([bare]), vocab);
    expect(issues).toContain("answer-context-ambiguous");
  });

  it("rejects a passage whose blank is not the single expected marker", () => {
    // A tampered blank: two blanks, so restoring the answer no longer yields
    // the source sentence either.
    const issues = maskedIssuesFor(
      maskedEntry({ passage: "＿＿が＿＿ている。" })
    );
    expect(issues).toContain("passage-blank-not-single");
  });

  it("rejects a passage that does not restore to its source", () => {
    // The passage is neither the source nor a blanked copy of it: an
    // authored edit slipped in where a construction belongs.
    const issues = maskedIssuesFor(
      maskedEntry({ passage: "明日の＿＿が降っている。" })
    );
    expect(issues).toContain("passage-not-restorable-to-source");
  });

  it("rejects an answer that is not the source's own word", () => {
    const issues = maskedIssuesFor(
      maskedEntry({
        answerIndex: 0,
        options: ["雪", "風", "道具", "手紙"],
      })
    );
    expect(issues).toContain("answer-not-single-in-source");
    expect(issues).toContain("passage-not-restorable-to-source");
  });

  it("rejects a distractor that occurs in the source sentence", () => {
    // が is in the passage and is also a distractor, so the learner can read
    // the "wrong" option straight off the sentence: two defensible answers.
    const vocab = buildVocabIndex([
      ...VOCAB_FIXTURE,
      { level: "N5", partOfSpeech: "particle", reading: "が", word: "が" },
    ]);
    const issues = checkEntry(
      maskedEntry({ options: ["雨", "風", "が", "道具"] }),
      sourceMap([MASKED_SOURCE]),
      vocab
    );
    expect(issues).toContain("distractor-occurs-in-source");
  });

  it("rejects an answer or distractor that is not an in-level noun", () => {
    // A verb option: same-category is the whole distractor contract, and the
    // form mismatch would give the answer away before the sentence is read.
    const vocab = buildVocabIndex([
      ...VOCAB_FIXTURE,
      {
        level: "N5",
        partOfSpeech: "verb, intransitive verb",
        reading: "やむ",
        word: "止まる",
      },
    ]);
    expect(maskedIssuesFor(maskedEntry())).toEqual([]);
    expect(
      checkEntry(
        maskedEntry({ options: ["雨", "風", "雪", "止まる"] }),
        sourceMap([MASKED_SOURCE]),
        vocab
      )
    ).toContain("distractor-not-in-level-noun");
  });

  it("rejects a source sentence with an out-of-level word", () => {
    // The passage IS the difficulty claim, so one above-N4 word fails the row
    // even when the cloze itself is well formed.
    const issues = checkEntry(
      maskedEntry(),
      sourceMap([
        {
          ...MASKED_SOURCE,
          linkedWords: ["雨", "が", "降る{降っている}", "車"],
        },
      ]),
      VOCAB
    );
    expect(issues).toContain("source-not-in-level");
  });

  it("rejects an answer the source English never names", () => {
    // 話 was the answer to "To change the subject": nothing in the translation
    // points at the word, so the item measures guessing, not reading.
    const vocab = buildVocabIndex([
      ...VOCAB_FIXTURE,
      {
        level: "N4",
        partOfSpeech: "noun",
        reading: "はなし",
        senses: [["tale", "talk"]],
        word: "話",
      },
    ]);
    const issues = checkEntry(
      maskedEntry({ answerIndex: 0, options: ["話", "風", "雪", "道具"] }),
      sourceMap([{ ...MASKED_SOURCE, en: "It is raining." }]),
      vocab
    );
    expect(issues).toContain("answer-not-named-by-translation");
  });

  it("rejects a distractor the corpus fills the same context frame with", () => {
    // Limitation #1 screen (distractor-corpus-plausible): the corpus holds
    // 「雪が降っている」, so the frame 「＿＿が降っている」 is demonstrably
    // fillable by 雪 as well as 雨 - a reader who knows the frame could argue
    // the distractor in. The screen fires only when the fillers index is
    // supplied, so an empty index (the default) leaves the clean row clean.
    const corpus = [
      MASKED_SOURCE,
      {
        en: "It is snowing.",
        id: "2003",
        jp: "雪が降っている。",
        linkedWords: ["雪", "が", "降る{降っている}"],
      },
    ];
    const fillers = buildContextFillers(corpus, VOCAB);
    expect(
      checkEntry(maskedEntry(), sourceMap(corpus), VOCAB, fillers)
    ).toContain("distractor-corpus-plausible");
    // And the same row over the same sentence but an EMPTY context passes:
    // without a corpus witness the clause proves nothing and says nothing.
    expect(
      checkEntry(maskedEntry(), sourceMap([MASKED_SOURCE]), VOCAB)
    ).not.toContain("distractor-corpus-plausible");
  });

  it("rejects a distractor that is another label for the answer", () => {
    // 豪雨 is glossed with the same dominant sense as 雨 ("rain
    // (precipitation)"), so offering both is offering the same answer twice -
    // the mechanically detectable form of the TASK-173.9.5 defect.
    const vocab = buildVocabIndex([
      ...VOCAB_FIXTURE,
      {
        level: "N5",
        partOfSpeech: "noun",
        reading: "ごう",
        senses: [["rain (precipitation)"]],
        word: "雨",
      },
      {
        level: "N4",
        partOfSpeech: "noun",
        reading: "ごう",
        senses: [["rain (precipitation)"]],
        word: "豪雨",
      },
    ]);
    const issues = checkEntry(
      maskedEntry({ options: ["雨", "豪雨", "雪", "道具"] }),
      sourceMap([MASKED_SOURCE]),
      vocab
    );
    expect(issues).toContain("distractor-collides-with-answer");
  });

  it("rejects a distractor sharing the answer's dominant sense", () => {
    // 警察 "police" and 警官 "policeman" are different words whose DOMINANT
    // senses overlap on `policeman`, which is the case the screen exists for.
    const vocab = buildVocabIndex([
      ...VOCAB_FIXTURE,
      {
        level: "N4",
        partOfSpeech: "noun",
        reading: "けいさつ",
        senses: [["police", "policeman"]],
        word: "警察",
      },
      {
        level: "N4",
        partOfSpeech: "noun",
        reading: "けいかん",
        senses: [["policeman"]],
        word: "警官",
      },
    ]);
    const issues = checkEntry(
      {
        ...maskedEntry({
          answerIndex: 0,
          options: ["警察", "警官", "雪", "道具"],
          passage: "＿＿を呼んだ。",
          sourceIds: ["2002"],
        }),
      },
      sourceMap([
        {
          en: "I called the police.",
          id: "2002",
          jp: "警察を呼んだ。",
          linkedWords: ["警察", "を", "呼ぶ{呼んだ}"],
        },
      ]),
      vocab
    );
    expect(issues).toContain("distractor-collides-with-answer");
  });

  it("rejects a generated row signed by anything but the pipeline", () => {
    // Otherwise a hand-edited option could be signed with a plausible judge
    // id and read as machine-checked.
    expect(
      maskedIssuesFor(
        maskedEntry({ validatedBy: "opencode:anthropic/claude-x" })
      )
    ).toContain("validatedBy-missing-or-bad-form");
    expect(maskedIssuesFor(maskedEntry({ validatedBy: "" }))).toContain(
      "validatedBy-missing-or-bad-form"
    );
  });

  it("does not apply the authored-key byte-equality rule to a blanked passage", () => {
    // The masked passage is NOT byte-equal to its source, and must not be
    // flagged for it: that is the check the construction branch replaces.
    expect(maskedIssuesFor(maskedEntry())).not.toContain(
      "passage-not-verbatim"
    );
  });
});

describe("loadTatoebaSentences: numeric corpus ids", () => {
  it("indexes a JSON-number id under its string form", () => {
    // The corpus writes `"id":4707`, the store's `sourceIds` are strings. When
    // the reader required `typeof id === "string"` the map came back EMPTY for
    // the real corpus and every row failed `sourceId-unknown`.
    const dir = makeDir();
    const path = join(dir, "sentences.jsonl");
    writeFileSync(
      path,
      `${JSON.stringify({
        en: "It is raining.",
        id: 4707,
        jp: "雨が降っている。",
        linkedWords: ["雨", "が", "降る{降っている}"],
      })}\n`,
      "utf8"
    );
    const loaded = loadTatoebaSentences(path);
    expect(loaded.get("4707")?.jp).toBe("雨が降っている。");
  });
});

describe("checkReadingFile: file-level invariants", () => {
  const writeStore = (
    dir: string,
    entries: readonly ComposedReadingEntry[]
  ): string => {
    const path = join(dir, "n4.json");
    writeFileSync(path, JSON.stringify(entries, null, 2), "utf8");
    return path;
  };

  const sentencesPathOf = (dir: string): string => {
    const path = join(dir, "sentences.jsonl");
    writeFileSync(
      path,
      `${SENTENCES.map((each) => JSON.stringify(each)).join("\n")}\n`,
      "utf8"
    );
    return path;
  };

  it("flags too-few-items when the batch has fewer than 4 rows", () => {
    const dir = makeDir();
    const reports = checkReadingFile(
      writeStore(dir, [
        baseEntry(),
        baseEntry({
          id: "n4c-2",
          passage: sentenceAt(1),
          sourceIds: ["1002"],
        }),
      ]),
      sentencesPathOf(dir),
      VOCAB
    );
    const fileReport = reports.find((each) => each.entryId === "(file)");
    expect(fileReport?.issues).toContain("too-few-items:2<4");
  });

  it("flags two rows that ask the same answer word", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "sentences.jsonl"),
      `${JSON.stringify(MASKED_SOURCE)}\n`,
      "utf8"
    );
    const reports = checkReadingFile(
      writeStore(dir, [maskedEntry(), maskedEntry({ id: "n4m-2002" })]),
      join(dir, "sentences.jsonl"),
      VOCAB
    );
    expect(reports[1]?.issues).toContain("duplicate-answer");
  });

  it("flags duplicate ids and duplicate passages across rows", () => {
    const dir = makeDir();
    const reports = checkReadingFile(
      writeStore(dir, [
        baseEntry(),
        baseEntry(),
        baseEntry({ id: "n4c-3" }),
        baseEntry({ id: "n4c-4", passage: "ちがう ぶん。" }),
      ]),
      sentencesPathOf(dir),
      VOCAB
    );
    const issuesAt = (index: number): readonly string[] =>
      reports[index]?.issues ?? [];
    // First occurrence is clean; the repeats are what the gate names.
    expect(issuesAt(0)).not.toContain("duplicate-id");
    expect(issuesAt(0)).not.toContain("duplicate-passage");
    expect(issuesAt(1)).toContain("duplicate-id");
    expect(issuesAt(1)).toContain("duplicate-passage");
    expect(issuesAt(2)).toContain("duplicate-passage");
    expect(issuesAt(2)).not.toContain("duplicate-id");
    expect(issuesAt(3)).not.toContain("duplicate-passage");
  });
});
