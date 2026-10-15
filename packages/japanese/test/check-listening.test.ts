/**
 * TASK-173.8.1 AC#4, TASK-173.9.4.1 AC#3 and TASK-173.9.4.2 AC#7: the six
 * `check:listening-*` gates are pinned with real assertions over the exported
 * per-row screens, not source-text checks. A clean row passes; each defect a
 * gate exists to catch is a separate fixture that must fail; the last group
 * runs the screens over the shipped stores, N3 and N2 included (the 概要理解
 * monologue opens at N3, the 聴解統合理解 shape at N2).
 *
 * What these forms are mechanically falsifiable about: the scenario is the
 * block's own SHAPE inside the block's rune band and marks nothing, the four
 * options are distinct and inside the option band, the key sits frozen at
 * `options[0]`, the PRINTED QUESTION may not name its own answer, the
 * orthography is Japanese with digits and the vendored A/B speaker labels
 * excused, an authored row owes the cert trio plus a one-sentence evidence
 * naming the answer, a licensed row owes the license tag and NOTHING else, and
 * across the store no scenario and no answer is spent twice. The one inverted
 * screen belongs to 聴解統合理解: one script must back EXACTLY two 小問
 * (二つの質問), never one and never three, pinned below by a dropped-row and a
 * cloned-row fixture that both have to fail.
 *
 * What NO fixture can check is whether the chosen option actually keeps what
 * the scenario SAYS — a dialogue the learner hears once, and no word list
 * decides it. That is what the two blind judge passes certify, which is why a
 * composed row without `validated: true` never clears the screen.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type ListeningRow,
  listeningReuseClashes,
  listeningRowIssues,
} from "../scripts/check-listening-shared";

const NO_REJECTIONS = new Set<string>();

const screen = (
  row: ListeningRow,
  rejectedIds: ReadonlySet<string> = NO_REJECTIONS
): string[] => listeningRowIssues(row, rejectedIds);

/** A 課題理解 row that clears every screen: the heard dialogue decides exactly
 * one of the four places, the key sits at `options[0]`, and the evidence names
 * it. Written out here so the test does not grade the store against itself. */
const baseRow = (): ListeningRow => ({
  answerIndex: 0,
  block: "kadai-rikai",
  construction: "authored",
  evidence:
    "二人は図書館の前に会うことにしましたから、図書館の まえ がこたえです。",
  id: "n5-kd-900",
  key: ["図書館の まえ"],
  level: "N5",
  options: ["図書館の まえ", "駅の まえ", "学校の まえ", "びょういんの まえ"],
  passage:
    "男の人と 女の人が 話しています。\n男：あした どこで 会いましょうか。\n女：駅は 人が多いですから、図書館の まえに しましょう。\n男：わかりました。じゃ、また あした。",
  provenance: "composed",
  stem: "ふたりは どこで 会いますか。",
  validated: true,
  validatedBy: "authored:agent-blind-judged",
});

/** A vendored row: the license tag is the whole record, so the cert trio and
 * the evidence are absent by design. */
const licensedRow = (): ListeningRow => ({
  answerIndex: 0,
  block: "kadai-rikai",
  id: "n5-kd-901",
  key: ["カフェの 前"],
  level: "N5",
  options: ["カフェの 前", "本の やま", "学校", "駅"],
  passage:
    "男：あしたの えいがは、何時から？\n女：5時からよ。\n男：じゃ、5時に カフェの 前で 会いましょう。\n女：いいわ。",
  provenance: "licensed",
  stem: "男の人は どこで 女の人に 会うと言いましたか。",
});

describe("listeningRowIssues, authored rows", () => {
  it("passes a clean 課題理解 row", () => {
    expect(screen(baseRow())).toEqual([]);
  });

  it("rejects a row whose construction is not authored", () => {
    const row = baseRow();
    row.construction = "sourced";
    expect(screen(row)).toContain("construction-is-sourced");
  });

  it("rejects a composed row that claims no blind-cert", () => {
    const row = baseRow();
    row.validated = false;
    expect(screen(row)).toContain("not-validated");
  });

  it("rejects a row certified by anything other than the two blind passes", () => {
    const row = baseRow();
    row.validatedBy = "authored:draft";
    expect(screen(row)).toContain("validatedBy-is-authored:draft");
  });

  it("rejects a row the verdict ledger burned", () => {
    expect(screen(baseRow(), new Set(["n5-kd-900"]))).toContain(
      "row-judge-rejected"
    );
  });

  it("passes a clean 概要理解 monologue at N3", () => {
    expect(screen(gaiyouRow())).toEqual([]);
  });

  it("rejects a 概要理解 monologue shorter than the N3 band", () => {
    // The block's shape is ONE coherent talk (measured off the official N3
    // ねらい, doc-26 §4); a dialogue-length exchange or a one-line notice
    // cannot be what 話者の意図や主張 asks of the whole text.
    const row = gaiyouRow();
    row.passage = "市立図書館で交換会をやります。";
    expect(
      screen(row).some((issue) => issue.includes("runes-outside-100-340"))
    ).toBe(true);
  });

  it("rejects a row filed under another 大問's block", () => {
    // 表記 is not one of the four listening shapes, so the shape lookup itself
    // refuses the row: a 表記 sentence filed into a 聴解 store cannot clear the
    // gate under any content. (`runListeningGate` adds the per-block
    // `block-is-...` half over the top of this.)
    const row = baseRow();
    row.block = "hyouki";
    expect(screen(row)).toEqual(["block-unknown:hyouki"]);
  });
});

describe("listeningRowIssues, licensed rows", () => {
  it("passes a licensed row on its license tag alone", () => {
    expect(screen(licensedRow())).toEqual([]);
  });

  it("rejects a licensed row that fakes the authored branch's validated", () => {
    const row = licensedRow();
    row.validated = true;
    expect(screen(row)).toContain("licensed-row-claims-validated");
  });

  it("rejects a licensed row that claims an authored construction", () => {
    const row = licensedRow();
    row.construction = "authored";
    expect(screen(row)).toContain("licensed-row-claims-authored-construction");
  });

  it("rejects a licensed row carrying evidence (the upstream item is the record)", () => {
    const row = licensedRow();
    row.evidence = "カフェの 前で 会いましょう と言っています。";
    expect(screen(row)).toContain("licensed-row-carries-evidence");
  });
});

describe("scenario shape screens", () => {
  it("rejects a scenario carrying 「　」 brackets, which mark no 聴解 material", () => {
    const row = baseRow();
    row.passage = "男：「あした 会いましょう」。ふたりは あした 会います。";
    expect(screen(row)).toContain("scenario-carries-brackets");
  });

  it("rejects a scenario carrying ＿＿, which belongs to a cloze", () => {
    const row = baseRow();
    row.passage = "＿＿＿の ぶんを きいて、こたえを えらんで ください。";
    expect(screen(row)).toContain("scenario-carries-blank");
  });

  it("rejects a scenario under the block's rune band", () => {
    const row = baseRow();
    row.passage = "男：あいましょう。女：はい。";
    expect(screen(row).some((issue) => issue.includes("runes-outside"))).toBe(
      true
    );
  });

  it("judges each block by its OWN shape band", () => {
    // A 即時応答 phrase that would be too short for a 課題理解 dialogue is the
    // right shape at its own block: the band is chosen by the row's block.
    const row = baseRow();
    row.block = "sokuji-outou";
    row.passage = "きょうは あついですね。";
    row.options = [
      "そうですね、とても あついです",
      "いいえ、おとといも あつかったです",
      "はい、きょうは いきません",
      "ありがとう、いってきます",
    ];
    row.key = [row.options[0] as string];
    row.stem = row.passage;
    row.evidence =
      "あついですね と 言われたら、そうですね、とても あついです が いちばん いい 返事です。";
    expect(screen(row)).toEqual([]);
  });
});

describe("option and key screens", () => {
  it("rejects a fifth option", () => {
    const row = baseRow();
    row.options.push("公園の ちかく");
    expect(screen(row)).toContain("options-count-5");
  });

  it("rejects two options that say the same thing", () => {
    const row = baseRow();
    row.options[2] = row.options[1] as string;
    expect(screen(row)).toContain("options-not-distinct");
  });

  it("rejects an option moved off the frozen key slot", () => {
    const row = baseRow();
    row.answerIndex = 1;
    expect(screen(row)).toContain("answerIndex-1");
  });

  it("rejects a key that is not the option the grader reads", () => {
    const row = baseRow();
    row.key = ["駅の まえ"];
    expect(screen(row)).toContain("key-not-one-answer-matching-options-0");
  });

  it("rejects an option outside the level's band", () => {
    const row = baseRow();
    row.options[1] =
      "駅の まえは 人が多いですから、わたしは いつも よりも ずっと 早く 出て、ほんの ほんだんしつの となりの ほうへ いきます。";
    expect(screen(row).some((issue) => issue.includes("runes-outside"))).toBe(
      true
    );
  });
});

describe("leak and evidence screens", () => {
  it("rejects a printed question that names its own answer", () => {
    // For a 聴解 type the PROMPT is the only printed surface `hasStemLeak`
    // reads, because the scenario may legitimately SPOKEN the answer.
    const row = baseRow();
    row.stem = "ふたりは 図書館の まえで 会いますか。";
    expect(screen(row)).toContain("answer-in-stem:図書館の まえ");
  });

  it("does NOT reject an answer the spoken scenario prints", () => {
    // The construction, not a leak: 課題理解 dialogues answer with the words
    // they say (`STIMULUS_ANSWER_TYPES` exempts the four types).
    expect(screen(baseRow())).toEqual([]);
  });

  it("rejects an authored row with no evidence", () => {
    const row = baseRow();
    row.evidence = "";
    expect(screen(row)).toContain("authored-row-lacks-evidence");
  });

  it("rejects evidence that is not one Japanese sentence", () => {
    const row = baseRow();
    row.evidence = "二人は会います。図書館の前です。";
    expect(screen(row)).toContain("evidence-not-one-japanese-sentence");
  });

  it("rejects evidence that does not name the answer", () => {
    const row = baseRow();
    row.evidence = "二人は場所について話しています。";
    expect(
      screen(row).some((issue) => issue.startsWith("evidence-names-not-answer"))
    ).toBe(true);
  });
});

/** A 概要理解 row that clears every screen: ONE coherent N3 monologue the
 * whole of which answers the printed question. Written out here so the test
 * does not grade the store against itself. */
const gaiyouRow = (): ListeningRow => ({
  answerIndex: 0,
  block: "gaiyou-rikai",
  construction: "authored",
  evidence:
    "市立図書館で本の交換会を行っていますから、本を交換できる がこたえです。",
  id: "n3-gy-900",
  key: ["本を交換できる"],
  level: "N3",
  options: [
    "本を交換できる",
    "本を新しく買える",
    "本を借りられない",
    "本を寄付できない",
  ],
  passage:
    "市立図書館の司会の人が話しています。今月の市立図書館では、読んでいる本を一つ持って来て、別の本と交換できる交換会をやっています。新しい本は買わずに、読んだ本で読みたい本と交換できます。持ち込めるのは一冊だけで、本の状態が悪いと交換できません。詳しくは市立図書館のホームページを見てください。",
  provenance: "composed",
  stem: "この話はどういう内容ですか。",
  validated: true,
  validatedBy: "authored:agent-blind-judged",
});

describe("orthography screens", () => {
  it("rejects Latin letters in the scenario", () => {
    const row = baseRow();
    row.passage =
      "男：あした library で 会いましょう。女：はい。しかたありませんね。";
    expect(screen(row)).toContain("latin-in-scenario");
  });

  it("excuses digits, both widths, in options and scenario", () => {
    // 8時 (half width) and ８時 (full width) are legitimate 聴解 content.
    const row = baseRow();
    row.options = ["８時", "8時", "9時", "１０時"];
    row.key = ["８時"];
    row.stem = "ふたりは いつ 会いますか。";
    row.evidence = "二人は ８時に 会うことにしましたから、８時 がこたえです。";
    row.passage =
      "男の人と 女の人が 話しています。\n男：あした、何時に 会いましょうか。\n女：８時に しましょう。\n男：では、また。";
    expect(screen(row)).toEqual([]);
  });

  it("excuses the vendored A/B speaker labels and an A/B さん reference", () => {
    // A transcript whose speakers' genders are unknown labels each LINE A： or
    // B：; the exception covers ONLY those token shapes, at line starts, with
    // the full-width colon the vendored rows were normalised to.
    const row = baseRow();
    row.passage =
      "A： あした どこで 会いましょうか。\nB： 図書館の まえに しましょう。\nA： わかりました。じゃ、また あした。";
    row.stem = "B さんは どこで 会うと言いましたか。";
    expect(screen(row)).toEqual([]);
  });

  it("still rejects Latin outside the excused label shapes", () => {
    const row = baseRow();
    row.passage = "A: あした library の まえに 会いましょう。B: はい。";
    expect(screen(row)).toContain("latin-in-scenario");
  });

  it("rejects a simplified-only hanzi", () => {
    // 応 is the shinjitai; 应 (U+5E94) is its simplified-Chinese form and lives
    // on the vetted list. A good-faith Japanese hanzi like 的 is NOT enough to
    // fail this screen, which is what the list, not a script guess, decides.
    const row = baseRow();
    row.passage =
      "男：あした 学校で 会いましょう。女：应、わかりました。じゃ、また あしたに 学校で。";
    expect(
      screen(row).some((issue) => issue.includes("simplified-hanzi"))
    ).toBe(true);
  });
});

describe("store-wide reuse screen", () => {
  it("rejects a scenario spent twice", () => {
    const second = baseRow();
    second.id = "n5-kd-902";
    expect(listeningReuseClashes([baseRow(), second])).toContain(
      "reused-scenario:n5-kd-902:n5-kd-900"
    );
  });

  it("rejects an answer spent twice even under a different scenario", () => {
    const second = baseRow();
    second.id = "n5-kd-903";
    second.passage =
      "男の人と 女の人が 話しています。\n男：待ち合わせは どこに しましょう。\n女：図書館の まえに しましょう。あした また。";
    expect(listeningReuseClashes([baseRow(), second])).toContain(
      "reused-answer:n5-kd-903:n5-kd-900"
    );
  });

  it("lets distractors repeat, because real papers re-offer the same places", () => {
    const second = baseRow();
    second.id = "n5-kd-904";
    second.passage =
      "男の人と 女の人が 話しています。\n男：どこで 本を かいますか。\n女：駅の まえの ほんやで 買いましょう。";
    second.options = [
      "駅の まえ",
      "図書館の まえ",
      "学校の まえ",
      "びょういんの まえ",
    ];
    second.key = ["駅の まえ"];
    second.evidence =
      "駅の まえの ほんやで 買うことにしましたから、駅の まえ がこたえです。";
    expect(listeningReuseClashes([baseRow(), second])).toEqual([]);
  });
});

describe("the shipped N4 and N5 聴解 stores", () => {
  const DATA_DIR = join(import.meta.dir, "..", "data", "reading");

  /** 小問数 × 4 papers from the blueprint. A store shipped for a level this
   * table does not name fails the gate's own `store-shipped-but-not-checked`
   * screen, so the depth cannot land unjudged. */
  const SHIPPED = [
    { block: "kadai-rikai", floor: 28, level: "n5", stem: "kadai" },
    { block: "point-rikai", floor: 24, level: "n5", stem: "point" },
    { block: "hatsuwa-hyougen", floor: 20, level: "n5", stem: "hatsuwa" },
    { block: "sokuji-outou", floor: 24, level: "n5", stem: "sokuji" },
    { block: "kadai-rikai", floor: 32, level: "n4", stem: "kadai" },
    { block: "point-rikai", floor: 28, level: "n4", stem: "point" },
    { block: "hatsuwa-hyougen", floor: 20, level: "n4", stem: "hatsuwa" },
    { block: "sokuji-outou", floor: 32, level: "n4", stem: "sokuji" },
    // TASK-173.9.4.1: N3 ships all five 大問, 概要理解 included.
    { block: "kadai-rikai", floor: 24, level: "n3", stem: "kadai" },
    { block: "point-rikai", floor: 24, level: "n3", stem: "point" },
    { block: "gaiyou-rikai", floor: 12, level: "n3", stem: "gaiyou" },
    { block: "hatsuwa-hyougen", floor: 16, level: "n3", stem: "hatsuwa" },
    { block: "sokuji-outou", floor: 36, level: "n3", stem: "sokuji" },
    // TASK-173.9.4.2: N2 re-opens the family with 聴解統合理解, one script
    // backing exactly two 小問 (the grouping screen is pinned separately).
    { block: "choukai-tougou-rikai", floor: 16, level: "n2", stem: "choukai" },
  ] as const;

  const load = (level: string, stem: string): ListeningRow[] =>
    JSON.parse(
      readFileSync(join(DATA_DIR, `${level}-${stem}.json`), "utf8")
    ) as ListeningRow[];

  it("holds the floor of rows per block and every row clears the gate", () => {
    for (const { floor, level, stem } of SHIPPED) {
      const rows = load(level, stem);
      expect(rows.length).toBeGreaterThanOrEqual(floor);
      for (const row of rows) {
        expect(listeningRowIssues(row, NO_REJECTIONS)).toEqual([]);
      }
    }
  });

  it("stamps every row with its own block and level", () => {
    for (const { block, level, stem } of SHIPPED) {
      for (const row of load(level, stem)) {
        expect(row.block).toBe(block);
        expect(row.level).toBe(level.toUpperCase());
      }
    }
  });

  it("never spends one scenario or one answer twice within a block", () => {
    // Every level of one file stem pooled, the way `runListeningGate` does:
    // a scenario or answer the N5 store already spent is not a new 小問 when
    // the N4 or N3 store repeats it.
    for (const stem of ["kadai", "point", "hatsuwa", "sokuji"] as const) {
      expect(
        listeningReuseClashes([
          ...load("n3", stem),
          ...load("n4", stem),
          ...load("n5", stem),
        ])
      ).toEqual([]);
    }
  });
});

describe("the shipped N2 聴解統合理解 grouping", () => {
  const DATA_DIR = join(import.meta.dir, "..", "data", "reading");

  const load = (): ListeningRow[] =>
    JSON.parse(
      readFileSync(join(DATA_DIR, "n2-choukai.json"), "utf8")
    ) as ListeningRow[];

  it("spends every script on EXACTLY two 小問 (二つの質問), never one or three", () => {
    // The 統合理解 gate inverts the reuse screen: the official 大問5 hears one
    // long dialogue ONCE and asks two questions of it, so the store's unit is
    // a PAIR - one script × GROUP_SIZE - while every answer stays unique.
    expect(listeningReuseClashes(load(), 2)).toEqual([]);
  });

  it("rejects a pair left with a single 小問", () => {
    const rows = load();
    const broken = rows.filter((row) => row.id !== rows[1]?.id);
    expect(listeningReuseClashes(broken, 2).join("\n")).toContain(
      "script-group-wrong-size"
    );
  });

  it("rejects a script cloned onto a third 小問", () => {
    const rows = load();
    const [first] = rows;
    if (first === undefined) {
      throw new Error("n2-choukai.json ships no rows");
    }
    expect(listeningReuseClashes([...rows, first], 2).join("\n")).toContain(
      "script-group-wrong-size"
    );
  });
});
