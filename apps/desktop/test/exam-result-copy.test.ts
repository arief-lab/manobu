/**
 * The submitted result card says each thing once (TASK-159).
 *
 * A raw-only (shortened) paper used to print `paper.result.rawOnly` twice: as
 * the CardDescription under "Result" (via `resultDescription`) and again as the
 * first line of the body (the paragraph deleted from `RawResultView`). These
 * assertions count occurrences of the deck's OWN value rather than a literal
 * sentence, so rewording `paper.result.rawOnly` stays cheap.
 *
 * The composition mirrors the real card (CardDescription + ResultDetails)
 * because `PaperScope.Result` needs a QueryClient, a suspense exam query and
 * eleven mutations to mount. The two halves are exported through `__test__` for
 * exactly this.
 */
import { describe, expect, it } from "bun:test";

import type { ExamResult } from "@manobu/api-contract";
import { t } from "@manobu/ui/lib/copy";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { __test__ } from "@/features/exam/exam-paper-pane";

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const rawResult = {
  examId: "exam-raw-1",
  label: "shortened-paper-raw-only",
  level: "N5",
  mode: "shortened",
  overall: { correct: 7, total: 20 },
  pauses: { count: 0, totalMs: 0 },
  scoring: "raw-only",
  sections: [{ correct: 7, id: "vocabulary", total: 20 }],
  status: "submitted",
  submittedAt: "2026-09-28T00:00:00.000Z",
  weakAnchors: ["anchor-1"],
} satisfies ExamResult;

const bandResult = {
  examId: "exam-band-1",
  label: "shortened-paper-banded",
  level: "N5",
  mode: "shortened",
  overall: {
    correct: 90,
    maxScore: 120,
    passed: true,
    passMark: 80,
    score: 95,
    total: 120,
  },
  pauses: { count: 0, totalMs: 0 },
  scoring: "band",
  sections: [
    {
      correct: 40,
      id: "vocabulary",
      maxScore: 60,
      passed: true,
      passMark: 19,
      score: 45,
      total: 60,
    },
  ],
  status: "submitted",
  submittedAt: "2026-09-28T00:00:00.000Z",
  weakAnchors: ["anchor-1"],
} satisfies ExamResult;

/** A `mode: "real"` band result: the deterministic half of TASK-173.10 AC#4
 * (the live browser half ran 2026-10-13 against an assembled N3 paper).
 * Rendered through the real `BandResultView` it must show the official Japanese
 * 科目 names, each band's floor, and the estimate disclaimer. */
const realBandResult = {
  examId: "exam-real-band-1",
  label: "real-paper-banded",
  level: "N5",
  mode: "real",
  overall: {
    correct: 90,
    maxScore: 180,
    passed: true,
    passMark: 90,
    score: 102,
    total: 180,
  },
  pauses: { count: 0, totalMs: 0 },
  scoring: "band",
  sections: [
    {
      correct: 60,
      id: "language-knowledge",
      maxScore: 120,
      passed: true,
      passMark: 38,
      score: 72,
      total: 120,
    },
    {
      correct: 12,
      id: "listening",
      maxScore: 60,
      passed: false,
      passMark: 19,
      score: 20,
      total: 60,
    },
  ],
  status: "submitted",
  submittedAt: "2026-09-28T00:00:00.000Z",
  weakAnchors: ["anchor-1"],
} satisfies ExamResult;

/** The text a submitted result card shows, header slot then body. The result
 * carries its own `mode`, so the card names its sections the way the paper that
 * produced them did (TASK-173.3). */
const card = (result: ExamResult): string =>
  __test__.resultDescription(result.label, result) +
  renderToStaticMarkup(
    result.scoring === "band"
      ? createElement(__test__.BandResultView, { result })
      : createElement(__test__.RawResultView, { result })
  );

describe("result card copy (TASK-159)", () => {
  it("states the item-counts-only caveat exactly once on a raw-only paper", () => {
    const markup = card(rawResult);
    expect(occurrences(markup, t("paper.result.rawOnly"))).toBe(1);
  });

  it("still renders the raw counts after dropping the duplicate", () => {
    const markup = card(rawResult);
    expect(markup).toContain("data-shortened-result");
    expect(markup).toContain("7/20");
  });

  it("never says it on a banded paper, which keeps its own mode line", () => {
    const markup = card(bandResult);
    expect(occurrences(markup, t("paper.result.rawOnly"))).toBe(0);
    expect(occurrences(markup, t("paper.mode.shortened"))).toBe(1);
  });

  it("keeps the banded gates that the raw-only fix must not touch", () => {
    const markup = card(bandResult);
    expect(markup).toContain('data-gate="overall"');
    expect(markup).toContain('data-gate="section"');
    expect(markup).toContain('data-section-id="vocabulary"');
  });

  it("states the estimate disclaimer exactly once on a banded paper", () => {
    expect(occurrences(card(bandResult), t("paper.result.estimate"))).toBe(1);
  });

  it("never claims an estimate on a raw-only paper", () => {
    expect(occurrences(card(rawResult), t("paper.result.estimate"))).toBe(0);
  });

  it("prints each band's floor as a mark and drops the official-sounding verdict", () => {
    const markup = card(bandResult);
    expect(markup).toContain(t("paper.result.markValue", { mark: 19 }));
    expect(markup).not.toContain("Not passed");
    expect(markup).toContain(t("paper.result.reachesMark"));
  });
});

describe("real-mode result layout (TASK-173.10 AC#4)", () => {
  it("renders the official Japanese 科目 name for a folded N5 language column", () => {
    const markup = card(realBandResult);
    expect(markup).toContain("言語知識（文字・語彙・文法）・読解");
    expect(markup).toContain("聴解");
  });

  it("shows the estimate disclaimer and each band's floor on the real paper", () => {
    const markup = card(realBandResult);
    expect(occurrences(markup, t("paper.result.estimate"))).toBe(1);
    expect(markup).toContain(t("paper.result.markValue", { mark: 38 }));
    expect(markup).toContain(t("paper.result.markValue", { mark: 19 }));
  });

  it("reframes a failing band as an estimate mark, never an official verdict", () => {
    const markup = card(realBandResult);
    expect(markup).toContain(t("paper.result.belowMark"));
    expect(markup).toContain(t("paper.result.reachesMark"));
    expect(markup).not.toContain("Not passed");
  });

  it("names the card a real exam paper, not a shortened one (live-pass finding)", () => {
    const markup = card(realBandResult);
    expect(occurrences(markup, t("paper.mode.real"))).toBe(1);
    expect(occurrences(markup, t("paper.mode.shortened"))).toBe(0);
  });
});

/** The header subtitle is a third mode-labelled string, and the live pass found
 * it claiming "exam conditions" on a real paper too. `PaperHeader` needs the
 * whole scope to mount, so the key switch is pinned directly. */
describe("paper header mode label (live-pass finding)", () => {
  it("maps every mode to its own deck key", () => {
    expect(t(__test__.paperModeCopyKey("real"))).toBe(t("paper.mode.real"));
    expect(t(__test__.paperModeCopyKey("shortened"))).toBe(
      t("paper.mode.shortened")
    );
    expect(t(__test__.paperModeCopyKey("exam-conditions"))).toBe(
      t("paper.mode.examConditions")
    );
  });
});
