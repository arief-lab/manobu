import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  __test__ as checkpointTest,
  readKanaCheckpoint,
  recordCheckpointAttempt,
  setCheckpointPass,
  setCheckpointSkip,
} from "@/lib/kana-checkpoint";
import {
  clearKanaMastery,
  deriveState,
  getKanaCellState,
  __test__ as masteryTest,
  readKanaMastery,
  recordKanaOutcome,
} from "@/lib/kana-mastery";

// bun:test has no DOM localStorage — provide an in-memory mock for this file
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    clear: () => {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    },
    getItem: (k: string) => (k in store ? store[k] : null),
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  } as unknown as Storage;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("kanaMastery store (TASK-117 AC#1, AC#4, AC#5)", () => {
  it("persists per-cell and survives reload (AC#1)", () => {
    recordKanaOutcome("あ", "gojuon", "a", true, "pick", 1000);
    recordKanaOutcome("あ", "gojuon", "a", true, "pick", 2000);
    const m = readKanaMastery();
    const cell = m.cells.あ;
    expect(cell).toBeDefined();
    expect(cell.outcomes).toHaveLength(2);
    expect(cell.state).toBe("shaky");
    // simulate reload: read again
    const reloaded = readKanaMastery().cells.あ;
    expect(reloaded).toBeDefined();
    expect(reloaded.cell).toBe("あ");
  });

  it("corrupt or absent yields empty, never fabricated pass (AC#4)", () => {
    expect(readKanaMastery().cells).toEqual({});
    localStorage.setItem(masteryTest.STORAGE_KEY, "not-json");
    expect(readKanaMastery()).toEqual(masteryTest.EMPTY);
    localStorage.setItem(
      masteryTest.STORAGE_KEY,
      JSON.stringify({ cells: { あ: { bad: true } } })
    );
    expect(readKanaMastery().cells.あ).toBeUndefined();
    expect(getKanaCellState("あ")).toBe("unseen");
  });

  it("state machine: 3 correct in one session stays shaky, over 2 sessions becomes solid, wrong drops to shaky (AC#3)", () => {
    const day = 86_400_000;
    // 3 correct same day -> shaky (needs 2 sessions)
    recordKanaOutcome("か", "gojuon", "k", true, "pick", day * 1 + 1000);
    recordKanaOutcome("か", "gojuon", "k", true, "pick", day * 1 + 2000);
    recordKanaOutcome("か", "gojuon", "k", true, "pick", day * 1 + 3000);
    expect(getKanaCellState("か")).toBe("shaky");
    clearKanaMastery();
    // 3 correct over 2 days, last 2 correct -> solid
    recordKanaOutcome("さ", "gojuon", "s", true, "pick", day * 1 + 1000);
    recordKanaOutcome("さ", "gojuon", "s", true, "pick", day * 1 + 2000);
    recordKanaOutcome("さ", "gojuon", "s", true, "pick", day * 2 + 1000);
    expect(getKanaCellState("さ")).toBe("solid");
    // later wrong -> shaky
    recordKanaOutcome("さ", "gojuon", "s", false, "pick", day * 3 + 1000);
    expect(getKanaCellState("さ")).toBe("shaky");
  });

  it("deriveState directly (AC#3)", () => {
    const day = 86_400_000;
    expect(deriveState([])).toBe("unseen");
    expect(deriveState([{ at: 1, correct: true, mode: "pick" }])).toBe("shaky");
    expect(
      deriveState([
        { at: day * 1, correct: true, mode: "pick" },
        { at: day * 1 + 1, correct: true, mode: "pick" },
        { at: day * 2, correct: true, mode: "pick" },
      ])
    ).toBe("solid");
  });
});

describe("kanaCheckpoint store (TASK-117 AC#2, AC#4, AC#5)", () => {
  it("persists per script independently (AC#2)", () => {
    recordCheckpointAttempt("hiragana", {
      at: 1,
      groupsFailed: ["k"],
      itemIds: ["1"],
      score: 42,
    });
    setCheckpointPass("hiragana", "checkpoint", 2);
    expect(readKanaCheckpoint().hiragana?.passedAt).toBe(2);
    expect(readKanaCheckpoint().katakana).toBeUndefined();
    recordCheckpointAttempt("katakana", {
      at: 3,
      groupsFailed: [],
      itemIds: ["2"],
      score: 10,
    });
    expect(readKanaCheckpoint().katakana?.attempts).toHaveLength(1);
    expect(readKanaCheckpoint().hiragana?.attempts).toHaveLength(1);
  });

  it("skip never writes passedAt (AC#2)", () => {
    setCheckpointSkip("hiragana", 5);
    const r = readKanaCheckpoint().hiragana;
    expect(r?.source).toBe("skip");
    expect(r?.passedAt).toBeNull();
  });

  it("corrupt or absent yields empty, never fabricated pass (AC#4)", () => {
    expect(readKanaCheckpoint()).toEqual(checkpointTest.EMPTY);
    localStorage.setItem(checkpointTest.STORAGE_KEY, "bad-json");
    expect(readKanaCheckpoint()).toEqual(checkpointTest.EMPTY);
    localStorage.setItem(
      checkpointTest.STORAGE_KEY,
      JSON.stringify({ hiragana: { bad: true } })
    );
    expect(readKanaCheckpoint().hiragana).toBeUndefined();
  });

  it("round-trip survives reload", () => {
    recordCheckpointAttempt("hiragana", {
      at: 10,
      groupsFailed: [],
      itemIds: ["a", "b"],
      score: 45,
    });
    setCheckpointPass("hiragana", "checkpoint", 11);
    const again = readKanaCheckpoint();
    expect(again.hiragana?.attempts[0]?.itemIds).toEqual(["a", "b"]);
    expect(again.hiragana?.source).toBe("checkpoint");
  });
});
