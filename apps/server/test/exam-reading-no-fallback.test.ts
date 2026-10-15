import { describe, expect, it } from "bun:test";
import {
  choubunStoreFor,
  claimUnderstandingStoreFor,
  jouhouStoreFor,
  mediumReadingStoreFor,
  shortReadingStoreFor,
  tougouStoreFor,
} from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import { newCatalog } from "./exam-harness";

/*
 * TASK-173.9.17 AC#4: 読解 has no fallback. When a level's own store cannot answer
 * a slot, the picker must come up short and let the real paper name the hole
 * (TASK-173.1) rather than reach sideways for content that trains a different
 * skill under the same 大問 heading.
 *
 * Three legs enforce that and two of them predate this file: an empty store returns
 * null before the walk, and a composed row is refused in real mode unless an
 * offline judge falsified its key (`isRefused`). The third leg is what this task
 * writes once and calls from all six pickers: a row whose own `level` is not the
 * level being printed is not servable, because the loader keys on the FILENAME and
 * a row inside `n3-choubun.json` stamped N1 would otherwise print an N1 白書 window
 * under N3's 長文 heading and pass `validateAnchors` honestly.
 *
 * That leg is what the conversions in TASK-173.9.18 through TASK-173.9.21 make
 * reachable. They drain a masked-slot store and refill the same file with authored
 * rows; a borrowed row left behind would then wear a 内容理解 ねらい it cannot
 * answer, and the paper would look full.
 */

const LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;

const {
  choubunSourceFor,
  claimUnderstandingSourceFor,
  infoSearchSourceFor,
  mediumReadingSourceFor,
  servableReadingRow,
  shortReadingSourceFor,
  tougouSourceFor,
} = __test__;

type Catalog = Parameters<typeof shortReadingSourceFor>[0]["catalog"];

/** One 読解 大問: the block's name, the picker that fills it, the store it fills
 * from, and the levels that store actually ships. */
interface ReadingPicker {
  readonly block: string;
  readonly levels: readonly ("N1" | "N2" | "N3" | "N4" | "N5")[];
  readonly picker: (args: {
    catalog: Catalog;
    index: number;
    level: string;
    offset: number;
  }) => ReturnType<typeof shortReadingSourceFor>;
  readonly store: (
    level: string
  ) => readonly { readonly id: string; readonly level: string }[];
}

const PICKERS: readonly ReadingPicker[] = [
  {
    block: "内容理解（短文）",
    levels: LEVELS,
    picker: shortReadingSourceFor,
    store: shortReadingStoreFor,
  },
  {
    block: "内容理解（中文）",
    levels: LEVELS,
    picker: mediumReadingSourceFor,
    store: mediumReadingStoreFor,
  },
  {
    block: "内容理解（長文）",
    levels: ["N3", "N1"],
    picker: choubunSourceFor,
    store: choubunStoreFor,
  },
  {
    block: "主張理解（長文）",
    levels: ["N2", "N1"],
    picker: claimUnderstandingSourceFor,
    store: claimUnderstandingStoreFor,
  },
  {
    block: "情報検索",
    levels: LEVELS,
    picker: infoSearchSourceFor,
    store: jouhouStoreFor,
  },
  {
    block: "統合理解",
    levels: ["N2", "N1"],
    picker: tougouSourceFor,
    store: tougouStoreFor,
  },
];

describe("servableReadingRow", () => {
  it("refuses a row stamped for another level", () => {
    const borrowed = { id: "n1b-1", level: "N1", passage: "借りた文" };
    expect(servableReadingRow({ entry: borrowed, level: "N3" })).toBeNull();
  });

  it("serves a row stamped for the level being printed", () => {
    const own = { id: "n3b-1", level: "N3", passage: "自前の文" };
    expect(servableReadingRow({ entry: own, level: "N3" })).toBe(own);
  });

  it("refuses a missing row the same way it refuses a borrowed one", () => {
    expect(servableReadingRow({ entry: undefined, level: "N3" })).toBeNull();
  });
});

describe("no shipped reading row trips the no-fallback rule", () => {
  /* The rule must refuse the defect and nothing else: every store file stamps each
   * of its rows with the level of the filename. That was not true before
   * TASK-173.9.18 and TASK-173.9.19, whose conversions drained the 情報検索 stores
   * that borrowed the N5 notices and re-stamped them at N3 and N4; those rows were
   * still legal here because the re-stamp made the anchor level match, which is
   * exactly the hole this loop cannot see and the authored route closes. If this
   * fails, a conversion task shipped a borrowed row and the picker would have
   * printed it. */
  for (const { block, store } of PICKERS) {
    it(`serves every row of the ${block} stores at its own level`, () => {
      for (const level of LEVELS) {
        for (const entry of store(level)) {
          expect(servableReadingRow({ entry, level })).toBe(entry);
        }
      }
    });
  }
});

describe("a drained 読解 store comes up short instead of borrowing", () => {
  for (const { block, levels, picker, store } of PICKERS) {
    for (const level of levels) {
      it(`${block} at ${level} answers from its own level and returns null once that store is spent`, () => {
        expect(store(level).length).toBeGreaterThan(0);

        // Undrained, the slot is filled by a row of THIS level: the item carries
        // the entry's own stamp, so a mismatch here is the borrow the rule forbids.
        const fresh = picker({
          catalog: newCatalog(),
          index: 0,
          level,
          offset: 0,
        });
        expect(fresh).not.toBeNull();
        expect(fresh?.level).toBe(level);

        // Spent, the walk finds nothing servable and reports the shortfall. Every
        // reading anchor is `reading:{id}`, so this drains exactly the store this
        // picker reads and nothing else.
        const catalog = newCatalog();
        for (const entry of store(level)) {
          catalog.seenAnchors.add(`reading:${entry.id}`);
        }
        expect(picker({ catalog, index: 0, level, offset: 0 })).toBeNull();
      });
    }
  }
});
