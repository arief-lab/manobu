import { describe, expect, it } from "bun:test";

import type { ExamBuildReceipt, ExamMode } from "@manobu/api-contract";
import { __test__ } from "../src/services/exam-service";

/*
 * TASK-173.3 AC#4: the chat paper card names its sections in the language of
 * the paper that produced them.
 *
 * The card's section list is the frame's `sections[].label`, and the fold passes
 * it through unchanged (packages/chat-session/src/chat-engine/folds/paper.ts),
 * so the server is the only place that decides the name. `paperFrameData` reads
 * the mode off the receipt; a receipt that hardcoded a mode would show an
 * English 科目 on a real paper's chat card while the pane beside it said
 * 言語知識, which is the two-labels-one-screen failure TASK-137 was about.
 *
 * This drives the pure frame builder rather than a started paper because the
 * field under test is a function of (id, mode) alone: no DB, no corpus, no
 * result. `result` is undefined so the frame carries no scoring columns; those
 * labels are pinned through the fold in packages/chat-session.
 */

const N5_FRAME_RECEIPT = (mode: ExamMode): ExamBuildReceipt => ({
  contentExhausted: false,
  examId: "exam-frame-1",
  floor: { floors: [], scoring: "band" },
  label: mode === "real" ? "real-paper-banded" : "shortened-paper-banded",
  level: "N5",
  mode,
  ready: true,
  refusedSections: [],
  request: {
    budget: {},
    focus: [],
    level: "N5",
    mode,
    sections: ["vocabulary", "grammar-reading", "listening"],
    seed: "seed-1",
  },
  sections: [
    {
      id: "vocabulary",
      minutes: 20,
      position: 0,
      requestedItems: 8,
      scoringSectionIds: ["language-knowledge"],
      shortfall: 0,
      status: "submitted",
      timeLimitSeconds: null,
      validatedItems: 8,
    },
    {
      id: "grammar-reading",
      minutes: 40,
      position: 1,
      requestedItems: 10,
      scoringSectionIds: ["language-knowledge"],
      shortfall: 0,
      status: "submitted",
      timeLimitSeconds: null,
      validatedItems: 10,
    },
    {
      id: "listening",
      minutes: 30,
      position: 2,
      requestedItems: 10,
      scoringSectionIds: ["listening"],
      shortfall: 0,
      status: "submitted",
      timeLimitSeconds: null,
      validatedItems: 10,
    },
  ],
  shortfall: 0,
  status: "ready",
  totalSlots: 28,
  unfilledBlocks: [],
  validatedSlots: 28,
});

const frameSectionLabels = (mode: ExamMode): string[] =>
  __test__
    .paperFrameData(N5_FRAME_RECEIPT(mode), undefined, null)
    .sections.map((section) => section.label);

describe("paper frame section labels (TASK-173.3)", () => {
  it("names every section in Japanese on a real paper", () => {
    expect(frameSectionLabels("real")).toEqual([
      "言語知識（文字・語彙）",
      "言語知識（文法）・読解",
      "聴解",
    ]);
  });

  it("keeps the English names on a practice paper", () => {
    expect(frameSectionLabels("shortened")).toEqual([
      "Vocabulary",
      "Grammar·Reading",
      "Listening",
    ]);
    expect(frameSectionLabels("exam-conditions")).toEqual([
      "Vocabulary",
      "Grammar·Reading",
      "Listening",
    ]);
  });
});
