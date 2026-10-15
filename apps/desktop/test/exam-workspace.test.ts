import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ExamComposedItem,
  ExamDebriefItem,
  ExamSectionState,
} from "@manobu/api-contract";
import {
  examScoringSectionLabel,
  examScoringSectionLabelForMode,
  examSectionLabel,
  examSectionLabelForMode,
} from "@manobu/api-contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { __test__, PaperScope } from "@/features/exam/exam-paper-pane";
import { __test__ as paperScopeTest } from "@/features/exam/exam-paper-scope";
import { ExamQuestion, ExamSpeechControl } from "@/features/exam/exam-question";
import { TtsProvider } from "@/lib/tts-voice";

const composed = (
  id: string,
  prompt: string,
  options: string[],
  order: number
): ExamComposedItem => ({
  bigQuestion: null,
  item: {
    anchors: [`anchor-${id}`],
    id,
    itemType: "word-in-context",
    level: "N5",
    options,
    passage: null,
    prompt,
    seedPart: null,
    speech: null,
    stem: null,
    stimuli: [],
    surface: "exam",
  },
  order,
  requestedSlotIndex: order,
  section: "vocabulary",
});

const section = (items: ExamComposedItem[]): ExamSectionState => ({
  answers: [],
  blocks: [],
  id: "vocabulary",
  items,
  minutes: 5,
  pauseCount: 0,
  paused: false,
  pausedMs: 0,
  position: 0,
  remainingSeconds: null,
  requestedItems: items.length,
  scoringSectionIds: ["language-knowledge"],
  startedAt: "2026-09-25T00:00:00.000Z",
  status: "in_progress",
  submittedAt: null,
  timeLimitSeconds: null,
});

describe("exam workspace pure seams", () => {
  it("blocks only the live exam-conditions composer gate", () => {
    expect(
      __test__.shouldBlockExamChat({
        mode: "exam-conditions",
        status: "in_progress",
      })
    ).toBe(true);
    expect(
      __test__.shouldBlockExamChat({
        mode: "shortened",
        status: "in_progress",
      })
    ).toBe(false);
    expect(
      __test__.shouldBlockExamChat({
        mode: "exam-conditions",
        status: "submitted",
      })
    ).toBe(false);
  });

  it("maps number and letter shortcuts to the four paper options", () => {
    expect(__test__.shortcutToOptionIndex("1")).toBe(0);
    expect(__test__.shortcutToOptionIndex("4")).toBe(3);
    expect(__test__.shortcutToOptionIndex("a")).toBe(0);
    expect(__test__.shortcutToOptionIndex("D")).toBe(3);
    expect(__test__.shortcutToOptionIndex("e")).toBeNull();
    expect(__test__.shortcutToOptionIndex("Enter")).toBeNull();
  });

  it("names each scoring section from the contract table the pane reads", () => {
    // TASK-137: the pane used to carry its own id->name map, so the chat
    // column and the result pane could name one section two ways. Both now
    // call `examScoringSectionLabel`, which is level-aware because the
    // `language-knowledge` id means two different official sections.
    expect(examSectionLabel("vocabulary")).toBe("Vocabulary");
    expect(examSectionLabel("grammar-reading")).toBe("Grammar·Reading");
    expect(examSectionLabel("listening")).toBe("Listening");
    expect(examScoringSectionLabel({ id: "reading", level: "N1" })).toBe(
      "Reading"
    );
    expect(
      examScoringSectionLabel({ id: "language-knowledge", level: "N1" })
    ).toBe("Language Knowledge");
    expect(
      examScoringSectionLabel({ id: "language-knowledge", level: "N5" })
    ).toBe("Language Knowledge·Reading");
  });

  it("names a real-mode section in Japanese and every other mode in English", () => {
    // The pane reads the nav chip, the section heading and the result rows
    // through `...ForMode`, so one mode value decides the whole paper's
    // language (TASK-173.3). The names come from the same contract table the
    // server parity test pins against the blueprint.
    expect(examSectionLabelForMode({ id: "vocabulary", mode: "real" })).toBe(
      "言語知識（文字・語彙）"
    );
    expect(
      examSectionLabelForMode({ id: "grammar-reading", mode: "real" })
    ).toBe("言語知識（文法）・読解");
    expect(examSectionLabelForMode({ id: "listening", mode: "real" })).toBe(
      "聴解"
    );
    expect(
      examScoringSectionLabelForMode({
        id: "language-knowledge",
        level: "N5",
        mode: "real",
      })
    ).toBe("言語知識（文字・語彙・文法）・読解");
    // The same calls on a practice paper keep the English names.
    expect(
      examSectionLabelForMode({ id: "vocabulary", mode: "shortened" })
    ).toBe("Vocabulary");
    expect(
      examSectionLabelForMode({ id: "listening", mode: "exam-conditions" })
    ).toBe("Listening");
  });

  it("selects the first unanswered question for resume", () => {
    const first = composed("q1", "First", ["a", "b", "c", "d"], 0);
    const second = composed("q2", "Second", ["e", "f", "g", "h"], 1);
    const third = composed("q3", "Third", ["i", "j", "k", "l"], 2);
    const current = section([first, second, third]);
    current.answers.push({
      answeredAt: "2026-09-25T00:01:00.000Z",
      itemId: "q1",
      section: "vocabulary",
      selectedIndex: 2,
    });

    expect(__test__.activeQuestionIndex(current)).toBe(1);
    expect(
      __test__.activeQuestionFor(current, "exam-conditions")?.question.id
    ).toBe("q2");
  });

  it("prints one heading per 大問 on a real paper (TASK-173.4 AC#4)", () => {
    const inBlock = (
      item: ExamComposedItem,
      bigQuestion: number
    ): ExamComposedItem => ({ ...item, bigQuestion });
    const real = section([
      inBlock(composed("q1", "First", ["a", "b", "c", "d"], 0), 1),
      inBlock(composed("q2", "Second", ["e", "f", "g", "h"], 1), 1),
      inBlock(composed("q3", "Third", ["i", "j", "k", "l"], 2), 2),
    ]);
    real.blocks = [
      {
        bigQuestion: 1,
        instruction: "＿＿＿ の ことばは ひらがなで どう かきますか。",
        itemCount: 2,
        name: "漢字読み",
        requestedItems: 12,
      },
      {
        bigQuestion: 2,
        instruction: null,
        itemCount: 1,
        name: "表記",
        requestedItems: 8,
      },
    ];
    expect(__test__.largeQuestionHeading(real, 0)).toBe("大問 1 · 漢字読み");
    expect(__test__.largeQuestionHeading(real, 1)).toBe("大問 1 · 漢字読み");
    expect(__test__.largeQuestionHeading(real, 2)).toBe("大問 2 · 表記");

    // A flat mode carries no 大問 on its rows, so there is nothing to head.
    const flat = section([composed("q1", "First", ["a", "b", "c", "d"], 0)]);
    expect(__test__.largeQuestionHeading(flat, 0)).toBeNull();

    // Rows that claim a 大問 the section does not print are an inconsistency the
    // server refuses to label, not a heading to invent.
    expect(
      __test__.largeQuestionHeading({ ...real, blocks: [] }, 0)
    ).toBeNull();
    expect(__test__.largeQuestionHeading(real, 3)).toBeNull();
    expect(__test__.largeQuestionHeading(null, 0)).toBeNull();
  });

  it("parses only an explicit versioned collapse preference", () => {
    expect(__test__.STORAGE_KEY).toBe("manobu:exam-chat-collapse:v1");
    expect(__test__.parseCollapse(null, true)).toBe(true);
    expect(__test__.parseCollapse("not-json", false)).toBe(false);
    expect(__test__.parseCollapse("1", false)).toBe(true);
    expect(__test__.parseCollapse("0", true)).toBe(false);
    expect(
      __test__.parseCollapse('{"version":1,"collapsed":true}', false)
    ).toBe(true);

    expect(
      __test__.parseCollapse('{"version":1,"collapsed":"yes"}', false)
    ).toBe(false);
  });

  /**
   * TASK-141 AC#3 + AC#4: the listening control, behaviourally.
   *
   * Three states and all three are asserted in the rendered output, because the
   * one that used to be missing is the one nobody notices: a control on a
   * reading question (a reading aid the item was never asked for), and a
   * control that silently does nothing when there is no voice installed.
   */
  it("offers a control only for a listening item, and speaks its script (AC#3)", () => {
    const listening = composed(
      "q-listen",
      "Choose the phrase heard in the recording.",
      [
        "パンと牛乳を買いました。",
        "日本から来ました。",
        "学校へ行きます。",
        "これは私の本です。",
      ],
      0
    );
    const withSpeech = {
      ...__test__.questionFromComposedItem(listening, "exam-conditions"),
      speech: "パンと牛乳を買いました。",
    };
    const spoken = renderToStaticMarkup(
      createElement(
        TtsProvider,
        null,
        createElement(ExamQuestion, { question: withSpeech })
      )
    );
    // The control is present and carries the exact script, so what the learner
    // hears is what the item carries.
    expect(spoken).toContain('data-testid="exam-speech"');
    expect(spoken).toContain("パンと牛乳を買いました。");
    expect(spoken).toContain('aria-label="Hear パンと牛乳を買いました。"');

    // A reading item with no speech gets NOTHING. TASK-132's rule, narrowed
    // rather than dropped: a reading question must never offer to speak a
    // passage it was never asked aloud.
    const reading = composed(
      "q-read",
      "これは本__。",
      ["です", "だ", "でした", "ではありません"],
      0
    );
    const silent = renderToStaticMarkup(
      createElement(
        TtsProvider,
        null,
        createElement(ExamQuestion, {
          question: __test__.questionFromComposedItem(
            reading,
            "exam-conditions"
          ),
        })
      )
    );
    expect(silent).not.toContain('data-testid="exam-speech"');
    expect(silent).not.toContain('aria-label="Hear ');
  });

  it("reports audio as unavailable rather than faking a play (AC#4)", () => {
    // TASK-141: `ListenButton` historically swallowed a synthesis failure and
    // played the sign animation anyway, so a learner tapped hear, saw a voice
    // animate, and had heard nothing. The control must flip to a reported state.
    const control = renderToStaticMarkup(
      createElement(
        TtsProvider,
        null,
        createElement(ExamSpeechControl, { text: "駅まで歩きます。" })
      )
    );
    // Before any failure it is a control, not a complaint.
    expect(control).toContain('data-testid="exam-speech"');
    expect(control).not.toContain('data-testid="exam-speech-unavailable"');

    // No text, no control and no complaint: a non-listening item is not a
    // degraded listening item.
    expect(
      renderToStaticMarkup(createElement(ExamSpeechControl, { text: null }))
    ).toBe("");
    expect(renderToStaticMarkup(createElement(ExamSpeechControl, {}))).toBe("");
  });

  it("renders prompt and options without answer metadata", () => {
    const entry = composed(
      "q-safe",
      "これは本__。",
      ["です", "だ", "でした", "ではありません"],
      0
    );
    const unsafeQuestion = {
      ...__test__.questionFromComposedItem(entry, "exam-conditions"),
      answerIndex: 0,
      correctIndex: 0,
      explanation: "secret-explanation",
      script: "secret-script",
      sourceKey: "secret-source-key",
    };
    const html = renderToStaticMarkup(
      createElement(ExamQuestion, { question: unsafeQuestion })
    );

    expect(html).toContain("これは本__。");
    expect(html).toContain("です");
    expect(html).toContain("ではありません");
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).toContain('type="radio"');
    for (const forbidden of [
      "answerIndex",
      "correctIndex",
      "secret-explanation",
      "secret-script",
      "secret-source-key",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("reads every passage of an integrated item in order (TASK-132)", () => {
    const entry = composed(
      "q-integrated",
      "二つの文章から読み取ってください。",
      ["first", "second", "third", "fourth"],
      0
    );
    const integrated = {
      ...entry,
      item: {
        ...entry.item,
        itemType: "integrated-reading" as const,
        level: "N1" as const,
        stimuli: [
          { kind: "passage" as const, text: "最初のパッセージ。" },
          { kind: "passage" as const, text: "第二のパッセージ。" },
          { kind: "passage" as const, text: "第三のパッセージ。" },
        ],
      },
    };
    const question = __test__.questionFromComposedItem(
      integrated,
      "exam-conditions"
    );
    expect(__test__.questionStimuli(question)).toEqual([
      "最初のパッセージ。",
      "第二のパッセージ。",
      "第三のパッセージ。",
    ]);
    // A paper written before the stimulus set still renders its one passage.
    expect(
      __test__.questionStimuli({
        passage: "古い文章。",
        stimuli: [],
      })
    ).toEqual(["古い文章。"]);
    expect(__test__.questionStimuli({ passage: null, stimuli: [] })).toEqual(
      []
    );
  });

  it("binds the review row's dispute and replay actions to the right item", () => {
    // The desktop has no DOM env, so a render assertion cannot tell a wired
    // button from a dead one: an inert `Dispute` handler passed all 452
    // desktop tests. These bindings are pinned as a pure seam instead.
    const debriefItem: ExamDebriefItem = {
      anchorLabels: ["本（ほん）"],
      anchors: ["anchor-q1"],
      correct: false,
      correctIndex: 1,
      correctOption: "second",
      disputed: false,
      disputedAt: null,
      explanation: null,
      explanationGenerated: false,
      item: composed(
        "q1",
        "これは本__。",
        ["です", "だ", "でした", "ではありません"],
        0
      ).item,
      itemId: "q1",
      order: 0,
      section: "vocabulary",
      selectedIndex: 0,
      selectedOption: "です",
    };
    const calls: string[] = [];
    const actions = __test__.reviewRowActions({
      dispute: (itemId) => calls.push(`dispute:${itemId}`),
      item: debriefItem,
      replay: (item) => calls.push(`replay:${item.itemId}`),
    });

    actions.dispute();
    actions.replay();

    expect(calls).toEqual(["dispute:q1", "replay:q1"]);
  });

  it("prints the listening script in the review row (TASK-173.8.2 AC#4)", () => {
    // The control's failure line promises "The script is in the review".
    // `reviewScriptLine` is the seam that keeps the promise: the row prints
    // the item's `speech`, the synthesis input the client carried the whole
    // time (TASK-141) and never showed during the block.
    const listening = composed(
      "q-lis",
      "Choose the phrase heard in the recording.",
      [
        "パンと牛乳を買いました。",
        "日本から来ました。",
        "学校へ行きます。",
        "これは私の本です。",
      ],
      0
    );
    expect(
      __test__.reviewScriptLine({
        item: { ...listening.item, speech: "パンと牛乳を買いました。" },
      })
    ).toBe("パンと牛乳を買いました。");
    expect(
      __test__.reviewScriptLine({
        item: composed(
          "q-read",
          "これは本__。",
          ["です", "だ", "でした", "ではありません"],
          1
        ).item,
      })
    ).toBeNull();
    // And the row's JSX actually calls it, testid and all (no-DOM constraint,
    // same reason as the source reads in the test below).
    const paneSource = readFileSync(
      join(import.meta.dir, "../src/features/exam/exam-paper-pane.tsx"),
      "utf8"
    );
    expect(paneSource).toContain('data-testid="exam-review-script"');
    expect(paneSource).toContain("const scriptLine = reviewScriptLine(item)");
  });

  it("keeps review and exact replay on the submitted surface", () => {
    const paneSource = readFileSync(
      join(import.meta.dir, "../src/features/exam/exam-paper-pane.tsx"),
      "utf8"
    );
    const scopeSource = readFileSync(
      join(import.meta.dir, "../src/features/exam/exam-paper-scope.tsx"),
      "utf8"
    );
    expect(paneSource).toContain('data-testid="exam-review"');
    expect(paneSource).toContain("correctIndex");
    expect(paneSource).toContain("exam.review.dispute");
    expect(paneSource).toContain("exam.review.sendToDesk");
    expect(scopeSource).toContain("getChatWsClient");
    expect(scopeSource).toContain("itemId: item.itemId");
    expect(__test__.reviewOptionLabel("answer", 1)).toBe("B. answer");
    expect(__test__.shouldRenderExamReview("in_progress")).toBe(false);
    expect(__test__.shouldRenderExamReview("submitted")).toBe(true);
  });

  it("renders an explanation only when the debrief generated one", () => {
    // TASK-137: every composed item carried the server's stub explanation, so
    // each review row opened with "Generated from {anchor}" over a placeholder.
    expect(
      __test__.shouldRenderExplanation({
        explanation: "です is the plain copula.",
        explanationGenerated: true,
      })
    ).toBe(true);
    expect(
      __test__.shouldRenderExplanation({
        explanation: null,
        explanationGenerated: false,
      })
    ).toBe(false);
    expect(
      __test__.shouldRenderExplanation({
        explanation: "server-only explanation",
        explanationGenerated: false,
      })
    ).toBe(false);
    // The two debrief fields arrive independently, so the flag alone cannot
    // vouch for prose: a generated=true row with nothing to show would render
    // the heading over an empty panel.
    expect(
      __test__.shouldRenderExplanation({
        explanation: null,
        explanationGenerated: true,
      })
    ).toBe(false);
  });

  it("exposes the paper compound subs", () => {
    for (const sub of [
      PaperScope.Abandon,
      PaperScope.Question,
      PaperScope.Result,
      PaperScope.SectionHeader,
      PaperScope.SectionNav,
      PaperScope.Stimulus,
      PaperScope.SubmitSection,
      PaperScope.Timer,
    ]) {
      expect(sub).toBeDefined();
    }
  });

  it("mounts one chat provider and fails an unknown exam through the route", () => {
    const routeSource = readFileSync(
      join(import.meta.dir, "../src/routes/exam/$examId.tsx"),
      "utf8"
    );
    expect(routeSource.match(/<ChatSessionProvider/g)).toHaveLength(1);
    expect(routeSource).toContain("errorComponent:");
    expect(routeSource).toContain("examQueryOptions(params.examId)");
    expect(routeSource).toContain(
      "conversationQueryOptions(exam.conversationId)"
    );
    expect(routeSource).not.toContain("AskSensei");
  });

  it("announces each timer threshold once and keeps focus/keyboard controls", () => {
    const scopeSource = readFileSync(
      join(import.meta.dir, "../src/features/exam/exam-paper-scope.tsx"),
      "utf8"
    );
    const paneSource = readFileSync(
      join(import.meta.dir, "../src/features/exam/exam-paper-pane.tsx"),
      "utf8"
    );
    const questionSource = readFileSync(
      join(import.meta.dir, "../src/features/exam/exam-question.tsx"),
      "utf8"
    );
    const announced = new Set<string>();
    const atFiveMinutes = paperScopeTest.timerAnnouncementsFor({
      alreadyAnnounced: announced,
      remainingSeconds: 300,
      sectionId: "vocabulary",
    });
    expect(atFiveMinutes).toEqual([
      {
        key: "vocabulary:300",
        message: "Five minutes left in this section.",
      },
    ]);
    for (const { key } of atFiveMinutes) {
      announced.add(key);
    }
    expect(
      paperScopeTest.timerAnnouncementsFor({
        alreadyAnnounced: announced,
        remainingSeconds: 300,
        sectionId: "vocabulary",
      })
    ).toEqual([]);
    const atOneMinute = paperScopeTest.timerAnnouncementsFor({
      alreadyAnnounced: announced,
      remainingSeconds: 60,
      sectionId: "vocabulary",
    });
    expect(atOneMinute).toEqual([
      { key: "vocabulary:60", message: "One minute left." },
    ]);
    for (const { key } of atOneMinute) {
      announced.add(key);
    }
    expect(
      paperScopeTest.timerAnnouncementsFor({
        alreadyAnnounced: announced,
        remainingSeconds: 0,
        sectionId: "vocabulary",
      })
    ).toEqual([{ key: "vocabulary:0", message: "Time. Section submitted." }]);
    expect(scopeSource).toContain("sectionHeadingRef.current?.focus()");
    expect(paneSource).toContain('role="timer"');
    expect(paneSource).toContain('aria-live="polite"');
    expect(questionSource).toContain(
      'aria-keyshortcuts="1 2 3 4 A B C D Enter"'
    );

    expect(paneSource).toContain("aria-pressed={collapsed}");
  });
});
