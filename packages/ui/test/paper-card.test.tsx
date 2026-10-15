import { describe, expect, it } from "bun:test";
import {
  PaperCard,
  type PaperCardProps,
  type PaperResultFacts,
  type PaperSectionSummary,
} from "@manobu/ui/components/paper-card";
import { renderToStaticMarkup } from "react-dom/server";

const sections = [
  {
    id: "vocabulary",
    label: "Vocab",
    state: "ready",
    total: 12,
    validated: 12,
  },
  {
    id: "grammar-reading",
    label: "Grammar·Reading",
    state: "building",
    total: 18,
    validated: 6,
  },
] as const satisfies readonly PaperSectionSummary[];

const basePaper = {
  examId: "exam-1",
  level: "N4",
  mode: "shortened",
  phase: "ready",
  sections,
  total: 30,
  validated: 18,
} as const satisfies PaperCardProps;

const bandedResult = {
  overall: {
    max: 180,
    passed: true,
    passMark: 90,
    score: 102,
  },
  scoring: "band",
  sections: [
    {
      id: "language-knowledge",
      label: "Language Knowledge·Reading",
      max: 120,
      passed: true,
      score: 72,
    },
    {
      id: "listening",
      label: "Listening",
      max: 60,
      passed: false,
      score: 30,
    },
  ],
} as const satisfies PaperResultFacts;

const rawResult = {
  overall: {
    correct: 3,
    total: 5,
  },
  scoring: "raw-only",
  sections: [
    {
      correct: 1,
      id: "listening",
      label: "Listening",
      total: 1,
    },
    {
      correct: 2,
      id: "vocabulary",
      label: "Vocab",
      total: 4,
    },
  ],
} as const satisfies PaperResultFacts;

const renderPaper = (overrides: Partial<PaperCardProps> = {}) =>
  renderToStaticMarkup(<PaperCard {...basePaper} {...overrides} />);

describe("PaperCard", () => {
  it("renders real validated-slot progress while building", () => {
    const html = renderPaper({
      onStart: () => undefined,
      phase: "building",
    });

    expect(html).toContain('data-state="building"');
    expect(html).toContain("Building your paper. 18/30 items ready.");
    expect(html).toContain('data-section-id="vocabulary"');
    expect(html).toContain("12/12 · ready");
    expect(html).toContain("6/18 · building");
    expect(html).not.toContain("<button");
  });

  it("renders every honest mode label and starts only with a callback", () => {
    const shortened = renderPaper({ onStart: () => undefined });
    const examConditions = renderPaper({
      mode: "exam-conditions",
      onStart: () => undefined,
    });
    const real = renderPaper({ mode: "real", onStart: () => undefined });

    expect(shortened).toContain("shortened paper");
    expect(shortened).toContain(
      "Your N4 paper is ready: 30 items, 2 sections."
    );
    expect(shortened).toContain("Start the paper");
    expect(examConditions).toContain("exam conditions");
    // TASK-173.1 AC#2/#7: the real paper is the same card on the same route, so
    // the only thing a learner can see that it is a different kind of paper is
    // this label.
    expect(real).toContain("real exam paper");
    expect(real).toContain("Start the paper");
  });

  it("renders a running paper as resumable", () => {
    const html = renderPaper({
      onStart: () => undefined,
      phase: "running",
    });

    expect(html).toContain('data-state="running"');
    expect(html).toContain(
      "Paper in progress. Your answers are kept as you go."
    );
    expect(html).toContain("Resume the paper");
  });

  it("renders submitted banded facts and debrief facts", () => {
    const html = renderPaper({
      debrief: {
        saved: false,
        weakAnchorLabels: ["来る（くる）", "Noun + ではありません"],
        weakAnchors: ["vocab:N5:来る:くる", "grammar:dewa-arimasen"],
      },
      phase: "submitted",
      result: bandedResult,
    });

    expect(html).toContain('data-state="submitted"');
    expect(html).toContain("Overall 102/180");
    expect(html).toContain("Total 102/180 against 90, plus each section.");
    expect(html).toContain("Language Knowledge·Reading");
    expect(html).toContain("72/120");
    // TASK-160: the card names the weak anchors. A corpus id in this sentence
    // is the defect this closed, so the ids the same payload carries are
    // asserted ABSENT, not merely unused.
    expect(html).toContain("Missed: 来る（くる） · Noun + ではありません");
    expect(html).not.toContain("vocab:N5:来る:くる");
    expect(html).not.toContain("grammar:dewa-arimasen");
    expect(html).toContain("Your last result was not saved.");
    expect(html).not.toContain("<button");
  });

  it("shows no weak-anchor line for a paper stored without labels", () => {
    // A `paper` frame written before TASK-160 is replayed from storage with ids
    // and no names (TASK-137: stored frames are re-parsed). Printing the ids is
    // the leak; printing nothing is the honest degradation.
    const html = renderPaper({
      debrief: { saved: true, weakAnchors: ["vocab:N5:東:ひがし"] },
      phase: "submitted",
      result: bandedResult,
    });

    expect(html).not.toContain("Missed:");
    expect(html).not.toContain("vocab:N5:東:ひがし");
  });

  it("opens a submitted paper result from chat history", () => {
    const html = renderPaper({
      onStart: () => undefined,
      phase: "submitted",
      result: bandedResult,
    });

    expect(html).toContain("Open result");
  });

  it("renders raw-only counts without band or pass claims", () => {
    const html = renderPaper({
      debrief: {
        weakAnchorLabels: ["来る（くる）"],
        weakAnchors: ["vocab:N5:来る:くる"],
      },
      phase: "raw-only",
      result: rawResult,
    });

    expect(html).toContain('data-state="raw-only"');
    expect(html).toContain("Shortened paper: item counts only.");
    expect(html).toContain("3/5 correct");
    expect(html).toContain("Listening");
    expect(html).toContain("1/1");
    expect(html).toContain("Missed: 来る（くる）");
    expect(html).not.toContain("vocab:N5:来る:くる");
    expect(html).not.toContain("Pass");
    expect(html).not.toContain("pass mark");
  });

  it("renders failed and offline unavailable states honestly", () => {
    const failed = renderPaper({ phase: "unavailable" });
    const offline = renderPaper({ offline: true, phase: "unavailable" });
    const abandoned = renderPaper({
      abandoned: true,
      phase: "unavailable",
    });

    expect(failed).toContain('data-state="unavailable"');
    expect(failed).toContain("The paper could not be built. Try again?");
    expect(failed).toContain("18/30");
    expect(offline).toContain('data-offline="true"');
    expect(offline).toContain("Paper unavailable while offline.");
    expect(abandoned).toContain('data-abandoned="true"');
    expect(abandoned).toContain("Abandoned. It stays in your history.");
  });

  it("suppresses every action in read-only mode", () => {
    const html = renderPaper({
      onStart: () => undefined,
      readOnly: true,
    });

    expect(html).toContain('data-read-only="true"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Start the paper");
  });

  it("does not forward answer keys, scripts, explanations, or source links", () => {
    const unsafeProps = {
      ...basePaper,
      answerIndex: 3,
      correctIndex: 1,
      explanation: "secret-explanation",
      fsrsLink: "/review/secret-card",
      optionSourceKey: "secret-option-source",
      script: "secret-listening-script",
    };
    const html = renderToStaticMarkup(
      <PaperCard
        {...unsafeProps}
        debrief={{ saved: true }}
        phase="submitted"
        result={bandedResult}
      />
    );

    for (const forbidden of [
      "answerIndex",
      "correctIndex",
      "secret-explanation",
      "/review/secret-card",
      "secret-option-source",
      "secret-listening-script",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });
});
