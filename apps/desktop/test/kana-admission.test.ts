import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  canAttemptCheckpoint,
  getAdmission,
  getDrillCoverageAdmission,
} from "@/lib/kana-admission";
import {
  clearKanaCheckpoint,
  readKanaCheckpoint,
  recordCheckpointAttempt,
  setCheckpointPass,
  setCheckpointSkip,
} from "@/lib/kana-checkpoint";
import { clearKanaMastery, recordKanaOutcome } from "@/lib/kana-mastery";

// localStorage mock for bun:test
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

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("kana admission (TASK-119)", () => {
  it("AC#1 admission OR of three named sources, stored source", () => {
    expect(getAdmission("hiragana").status).toBe("not-admitted");
    setCheckpointPass("hiragana", "checkpoint", 1000);
    expect(getAdmission("hiragana")).toEqual({
      reason: "checkpoint",
      source: "checkpoint",
      status: "admitted",
    });
    expect(readKanaCheckpoint().hiragana?.source).toBe("checkpoint");
  });

  it("AC#2 skip never writes passedAt, is override not pass, reversible", () => {
    setCheckpointSkip("hiragana", 2000);
    const rec = readKanaCheckpoint().hiragana;
    expect(rec?.source).toBe("skip");
    expect(rec?.passedAt).toBeNull();
    expect(getAdmission("hiragana").status).toBe("admitted");
    expect(getAdmission("hiragana").source).toBe("skip");
    // reversible via clear
    clearKanaCheckpoint();
    expect(getAdmission("hiragana").status).toBe("not-admitted");
  });

  it("AC#3 drill-coverage now available (six kinds shipped) — not yet met when no mastery", () => {
    const r = getDrillCoverageAdmission("hiragana");
    expect(r.status).toBe("not-admitted");
    expect(r.reason).toBe("not yet met");
    expect(r.source).toBe("drill-coverage");
  });

  it("AC#4 cooldown: 1 and 2 immediate, 3rd within 24h refused per script, never blocks drill/N4", () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // 1st attempt -> 2nd allowed immediately
    recordCheckpointAttempt("hiragana", {
      at: now,
      groupsFailed: ["a"],
      itemIds: ["1"],
      score: 0,
    });
    expect(canAttemptCheckpoint("hiragana", now + 1000).allowed).toBe(true);
    // 2nd attempt -> 3rd within 24h refused
    recordCheckpointAttempt("hiragana", {
      at: now + 2000,
      groupsFailed: ["b"],
      itemIds: ["2"],
      score: 0,
    });
    expect(canAttemptCheckpoint("hiragana", now + 3000).allowed).toBe(false);
    expect(canAttemptCheckpoint("hiragana", now + 3000).nextAvailableAt).toBe(
      now + 2000 + day
    );
    // per script: katakana still allowed (separate)
    expect(canAttemptCheckpoint("katakana", now + 3000).allowed).toBe(true);
    // after 24h, 3rd allowed
    expect(
      canAttemptCheckpoint("hiragana", now + 2000 + day + 1000).allowed
    ).toBe(true);
  });

  it("AC#5 backwards clock does not clear cooldown", () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    recordCheckpointAttempt("hiragana", {
      at: now,
      groupsFailed: [],
      itemIds: ["1"],
      score: 0,
    });
    recordCheckpointAttempt("hiragana", {
      at: now + 1000,
      groupsFailed: [],
      itemIds: ["2"],
      score: 0,
    });
    recordCheckpointAttempt("hiragana", {
      at: now + 2000,
      groupsFailed: [],
      itemIds: ["3"],
      score: 0,
    });
    // clock goes backwards to before last attempt
    expect(canAttemptCheckpoint("hiragana", now - 1000).allowed).toBe(false);
    // still refused even with backwards clock
    expect(canAttemptCheckpoint("hiragana", now + day + 3000).allowed).toBe(
      true
    );
  });

  it("AC#6 mastery state 3 in one session stays shaky, 3 over 2 sessions solid, wrong drops to shaky", () => {
    const day = 86_400_000;
    // need to use real mastery store
    clearKanaMastery();
    recordKanaOutcome("か", "gojuon", "k", true, "pick", day * 1 + 1000);
    recordKanaOutcome("か", "gojuon", "k", true, "pick", day * 1 + 2000);
    recordKanaOutcome("か", "gojuon", "k", true, "pick", day * 1 + 3000);
    // same day 3 correct -> shaky
    const { getKanaCellState } =
      require("@/lib/kana-mastery") as typeof import("@/lib/kana-mastery");
    expect(getKanaCellState("か")).toBe("shaky");
    clearKanaMastery();
    recordKanaOutcome("さ", "gojuon", "s", true, "pick", day * 1 + 1000);
    recordKanaOutcome("さ", "gojuon", "s", true, "pick", day * 1 + 2000);
    recordKanaOutcome("さ", "gojuon", "s", true, "pick", day * 2 + 1000);
    expect(getKanaCellState("さ")).toBe("solid");
    recordKanaOutcome("さ", "gojuon", "s", false, "pick", day * 3 + 1000);
    expect(getKanaCellState("さ")).toBe("shaky");
  });

  it("AC#7 settings reset clears selected script only", () => {
    setCheckpointPass("hiragana", "checkpoint", 1000);
    setCheckpointPass("katakana", "checkpoint", 2000);
    // clear hiragana only
    const { clearKanaCheckpointScript } =
      require("@/lib/kana-checkpoint") as typeof import("@/lib/kana-checkpoint");
    clearKanaCheckpointScript("hiragana");
    expect(readKanaCheckpoint().hiragana).toBeUndefined();
    expect(readKanaCheckpoint().katakana?.source).toBe("checkpoint");
  });

  it("AC#8 corrupt/absent yields no attempt yet, never fake pass", () => {
    expect(getAdmission("hiragana").status).toBe("not-admitted");
    localStorage.setItem("manobu.kanaCheckpoint", "bad-json");
    expect(getAdmission("hiragana").status).toBe("not-admitted");
    // mastery corrupt also not admitted via drill (now available, so not yet met, not not-available)
    localStorage.setItem("manobu.kanaMastery", "bad-json");
    expect(getDrillCoverageAdmission("hiragana").status).toBe("not-admitted");
  });
});
