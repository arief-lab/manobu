import { beforeAll, describe, expect, it } from "bun:test";
import {
  connectExamClient,
  type ExamClient,
  prepareContentDb,
  requestAssembleRead,
} from "./exam-harness";

/*
 * TASK-173.2: what a real paper asks in is Japanese.
 *
 * A real 大問 prints one instruction sentence and then material (TASK-173.2
 * AC#1), so the English stem every daily mode shows is the wrong thing to put
 * in front of a learner sitting a mock of the official paper (AC#2). Two fields
 * carry that: `blocks[].instruction`, looked up per (level, 大問) from the
 * sample papers, and `item.stem`, the Japanese line stored with the item at
 * assembly (`exam-service.ts` `candidateStemFor`) rather than re-derived when
 * the paper is re-read.
 *
 * The daily modes are asserted too, because the same two fields exist for them
 * and must stay empty: a shortened paper asks in English and has no 大問 to head.
 */

const DB_URL = prepareContentDb("exam-real-mode-stems");

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

const build = (input: {
  level: "N5";
  mode: "real" | "shortened";
  sections: ("grammar-reading" | "vocabulary")[];
  seed: string;
}) => requestAssembleRead(client, input);

/** An ASCII letter in a string the learner is meant to read as Japanese. The
 * papers print １・２・３・４ in full width and never a Latin glyph, so this is
 * the shape AC#4 pins rather than a check for one specific English sentence. */
const LATIN_RE = /[A-Za-z]/;

describe("TASK-173.2 a real paper asks in Japanese", () => {
  it("heads 漢字読み with the sentence the N5 paper prints", async () => {
    const { state } = await build({
      level: "N5",
      mode: "real",
      sections: ["vocabulary"],
      seed: "stems-vocab",
    });
    const section = state.sections.find(
      (candidate) => candidate.id === "vocabulary"
    );
    if (section === undefined) {
      throw new Error("the paper has no vocabulary section");
    }
    const [first] = section.blocks;
    expect(first?.bigQuestion).toBe(1);
    expect(first?.name).toBe("漢字読み");
    expect(first?.instruction).toBe(
      "＿＿＿ の ことばは ひらがなで どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。"
    );
    // The 大問 the paper cannot build still prints its heading, and says nothing
    // it cannot name a paper for. TASK-173.9.25 filled 表記 and TASK-173.9.28
    // filled the sentence form of 言い換え類義, so all three 大問 this paper
    // builds carry their official instruction line.
    const instructed = section.blocks
      .filter((block) => block.instruction !== null)
      .map((block) => block.name);
    expect(instructed).toEqual(["漢字読み", "表記", "言い換え類義"]);
  });

  it("stores the 小問 material on every item of the 大問 it fills", async () => {
    const { state } = await build({
      level: "N5",
      mode: "real",
      sections: ["vocabulary"],
      seed: "stems-material",
    });
    const landed = state.items.filter((entry) => entry.bigQuestion === 1);
    // Non-vacuity: the 大問 the paper builds must actually have filled, or the
    // loop below proves nothing about an empty list.
    expect(landed.length).toBeGreaterThan(0);
    for (const entry of landed) {
      expect(entry.item.itemType).toBe("kanji-reading");
      if (entry.item.stem === null) {
        throw new Error(
          `item ${entry.item.id} landed in 漢字読み with no stem, so the view has no material to print`
        );
      }
      // The word the paper underlines, quoted rather than described.
      expect(entry.item.stem.startsWith("「")).toBe(true);
      expect(entry.item.stem.endsWith("」")).toBe(true);
      expect(entry.item.stem).not.toMatch(LATIN_RE);
    }
  });

  /**
   * TASK-173.12 AC#4: 文の文法1 prints ONE material shape now. Its official ねらい
   * is 文の内容に合った文法形式かどうかを判断する, and only the sentence-blank
   * `grammar-form` / `particle` ask that: each item IS its sentence, which travels
   * as `passage` with the realization masked out (`exam-mask.ts`), so it carries no
   * stem. `conjugation` was word material with no sentence and left the block, so a
   * conjugation 小問 must never appear here. What is pinned is the uniformity: every
   * landed 小問 is a sentence, none is a bare quoted word.
   */
  it("gives every 文の文法1 小問 the sentence its ねらい asks for", async () => {
    const { state } = await build({
      level: "N5",
      mode: "real",
      sections: ["grammar-reading"],
      seed: "stems-grammar",
    });
    const section = state.sections.find(
      (candidate) => candidate.id === "grammar-reading"
    );
    if (section === undefined) {
      throw new Error("the paper has no grammar-reading section");
    }
    const grammar = section.blocks.find(
      (block) => block.name === "文の文法1（文法形式の判断）"
    );
    expect(grammar?.instruction).toBe(
      "（　）に 何を 入れますか。１・２・３・４から いちばん いい ものを 一つ えらんで ください。"
    );
    const landed = state.items.filter(
      (entry) => entry.bigQuestion === grammar?.bigQuestion
    );
    expect(landed.length).toBeGreaterThan(0);
    for (const entry of landed) {
      if (entry.item.itemType === "conjugation") {
        throw new Error(
          `item ${entry.item.id} is a conjugation 小問 under 文の文法1, the misfiling TASK-173.12 removed`
        );
      }
      if (entry.item.stem !== null) {
        throw new Error(
          `item ${entry.item.id} landed in 文の文法1 with a word stem, so the block prints a second shape`
        );
      }
      if (entry.item.passage === null) {
        throw new Error(
          `item ${entry.item.id} has no sentence, so the 文法形式の判断 ねらい has nothing to ask about`
        );
      }
    }
  });

  /**
   * AC#4, the property the desktop renders from: on a real paper there is no
   * Latin-script stem anywhere. An item with no stem prints nothing rather
   * than falling back to `prompt`, which is the desktop's rule and is pinned in
   * `apps/desktop/test/exam-workspace.test.ts`; what is pinned here is that the
   * wire never carries one to fall back to.
   */
  it("AC#4: a real paper carries no Latin-script stem", async () => {
    const papers = await Promise.all(
      ["property-a", "property-b"].map((seed) =>
        build({
          level: "N5",
          mode: "real",
          sections: ["grammar-reading", "vocabulary"],
          seed,
        })
      )
    );
    for (const { state } of papers) {
      const stems = state.items
        .map((entry) => entry.item.stem)
        .filter((stem): stem is string => stem !== null);
      expect(stems.length).toBeGreaterThan(0);
      for (const stem of stems) {
        expect(stem).not.toMatch(LATIN_RE);
      }
    }
  });

  it("keeps the daily modes on their English stem and no 大問 heading", async () => {
    const { state } = await build({
      level: "N5",
      mode: "shortened",
      sections: ["vocabulary"],
      seed: "stems-daily",
    });
    expect(state.mode).toBe("shortened");
    for (const section of state.sections) {
      expect(section.blocks).toEqual([]);
    }
    expect(state.items.length).toBeGreaterThan(0);
    for (const entry of state.items) {
      expect(entry.item.stem).toBeNull();
      expect(entry.item.prompt.length).toBeGreaterThan(0);
    }
  });
});
