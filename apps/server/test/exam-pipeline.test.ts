import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createItemStore,
  type ItemResolution,
  type ItemStore,
  type UserDatabase,
} from "@manobu/db/item-store";
import { applyContentMigrations } from "@manobu/db/migrate";
import {
  conversations,
  examItems,
  examSections,
  messages,
} from "@manobu/db/schema/user";
import { isDefinedError, type PromiseWithError, safe } from "@orpc/client";
import { eq } from "drizzle-orm";
import { type ExamClient, makeExamClient } from "./exam-harness";
import { removeSqliteDbFiles } from "./harness";

const DB_PATH = join(tmpdir(), `manobu-exam-pipeline-${Date.now()}.db`);
const DB_URL = `file:${DB_PATH}`;
const GENERATED_SEED_RE = /^generated-/;

/** The anchor shape the 16-noun catalog minted: `${family}:${level}:<digest>`.
 * A digest cannot resolve through the corpus view, so this is the shape that
 * must not come back. */
const SYNTHETIC_ANCHOR_RE = /^[a-z]+:N5:[0-9a-f]{1,}$/;

/** The corpus id namespaces (`exam-corpus.ts:143-147`). A debrief label is a
 * word or a construction, never one of these. */
const ANCHOR_NAMESPACE_RE = /(?:vocab|grammar|kanji):/;

process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.DATABASE_URL = DB_URL;

const { createUserDb } = await import("@manobu/db");
const { examCorpus, senseGroupsOf } = await import(
  "../src/services/exam-corpus"
);
const { MASK_BLANK, targetLiteralOf } = await import(
  "../src/services/exam-mask"
);

type Client = ExamClient;

let db: UserDatabase;
let client: Client;

const smallPaper = (seed: string) =>
  client.exam.request({
    budget: { vocabulary: 2 },
    level: "N5",
    mode: "shortened",
    sections: ["vocabulary"],
    seed,
  });

const buildSmallPaper = async (seed: string) => {
  const requested = await smallPaper(seed);
  const assembled = await client.exam.assemble({ examId: requested.examId });
  return { assembled, requested };
};

const requestAndAssemble = async (input: {
  level: "N1" | "N2" | "N3" | "N4" | "N5";
  mode: "exam-conditions" | "shortened";
  seed: string;
}) => {
  const requested = await client.exam.request(input);
  const assembled = await client.exam.assemble({ examId: requested.examId });
  return { assembled, requested };
};

type RequestedExam = Awaited<ReturnType<Client["exam"]["request"]>>;

type StartedSection = Awaited<
  ReturnType<Client["exam"]["start"]>
>["sections"][number];

/**
 * Answer every item CORRECTLY, advancing through each section in order.
 *
 * The key is read from the store, not guessed: the client projection hides
 * `answerIndex` on purpose, and this walk used to pick index 0 for every item,
 * which only produced a perfect score because the seeded shuffle was the
 * identity and every answer sat in slot A (TASK-135).
 */
const answerEveryItem = async (
  examClient: Client,
  examId: string,
  sections: readonly StartedSection[],
  store: ItemStore
): Promise<void> => {
  for (const [index, section] of sections.entries()) {
    for (const entry of section.items) {
      // biome-ignore lint/performance/noAwaitInLoops: the state machine guards one active section, so answers MUST land in order.
      const resolved = await store.resolveItem(entry.item.id);
      await examClient.exam.answer({
        examId,
        itemId: entry.item.id,
        selectedIndex: resolved?.answerIndex ?? 0,
      });
    }
    if (index < sections.length - 1) {
      await examClient.exam.advanceSection({ examId });
    }
  }
};
type AssembledExam = Awaited<ReturnType<Client["exam"]["assemble"]>>;
type ExamState = Awaited<ReturnType<Client["exam"]["get"]>>;
type StartedExam = Awaited<ReturnType<Client["exam"]["start"]>>;
type PausedExam = Awaited<ReturnType<Client["exam"]["pause"]>>;
type SubmittedExam = Awaited<ReturnType<Client["exam"]["submit"]>>;
type DebriefedExam = Awaited<ReturnType<Client["exam"]["debrief"]>>;

const assertDraftRequest = (requested: RequestedExam): void => {
  expect(requested.status).toBe("draft");
  expect(requested.totalSlots).toBe(2);
  expect(requested.validatedSlots).toBe(0);
  expect(requested.shortfall).toBe(2);
  expect(requested.ready).toBe(false);
};

const assertAssembledPaper = (assembled: AssembledExam): void => {
  expect(assembled.status).toBe("ready");
  expect(assembled.ready).toBe(true);
  expect(assembled.validatedSlots).toBe(2);
  expect(assembled.totalSlots).toBe(2);
  expect(assembled.sections.map((section) => section.id)).toEqual([
    "vocabulary",
    "listening",
  ]);
  expect(assembled.sections.every((section) => section.shortfall === 0)).toBe(
    true
  );
};

const assertClientOutputExcludesServerFields = (input: {
  assembled: AssembledExam;
  requested: RequestedExam;
  state: ExamState;
}): void => {
  const serialized = JSON.stringify(input);
  for (const key of [
    "answerIndex",
    "explanation",
    "fsrsVocabId",
    "optionSources",
    "script",
  ]) {
    expect(serialized).not.toContain(`"${key}"`);
  }
  expect(serialized).not.toContain("server-only explanation");
};

const assertPaperRowExcludesServerFields = async (
  conversationId: string
): Promise<void> => {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
  const paperRow = rows.find((row) => row.frameType === "paper");
  expect(paperRow).toBeDefined();
  expect(paperRow?.content).not.toContain("answerIndex");
  expect(paperRow?.content).not.toContain("script");
};

const assertFirstItemHasNoExplanation = async (
  state: ExamState
): Promise<void> => {
  const [firstItem] = state.items;
  if (!firstItem) {
    throw new Error("assembled exam did not contain an item");
  }
  const resolved = await createItemStore(db).resolveItem(firstItem.item.id);
  expect(resolved?.answerIndex).toBeGreaterThanOrEqual(0);
  // TASK-137: the composed item used to carry the literal "server-only
  // explanation", which the review row and the replayed drill both rendered
  // under a "Generated from {anchor}" heading. Nothing authors exam prose, so
  // the honest value is null and `explanationGenerated` reports false.
  expect(resolved?.explanation).toBeNull();
};

const assertConversationExists = async (
  requested: RequestedExam
): Promise<void> => {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, requested.conversationId ?? "missing"));
  expect(conversation?.id).toBe(requested.conversationId);
};

const reopenClient = async (): Promise<void> => {
  db.$client.close();
  db = await createUserDb(DB_URL);
  client = makeExamClient(db);
};

const startWithItem = async (examId: string) => {
  const started = await client.exam.start({ examId });
  const [item] = started.items;
  if (!item) {
    throw new Error("resumable exam did not contain an item");
  }
  return { item, started };
};

const assertResumedExam = (resumed: StartedExam, paused: PausedExam): void => {
  expect(resumed.status).toBe("in_progress");
  expect(resumed.sections[0]?.paused).toBe(true);
  expect(resumed.sections[0]?.remainingSeconds).toBe(
    paused.sections[0]?.remainingSeconds
  );
  expect(resumed.answers).toHaveLength(1);
  expect(resumed.answers[0]?.selectedIndex).toBe(0);
};

const assertNotReady = async <TOutput, TError>(
  operation: () => PromiseWithError<TOutput, TError>
): Promise<void> => {
  const [error] = await safe(operation());
  expect(isDefinedError(error)).toBe(true);
  if (isDefinedError(error)) {
    expect(error.code).toBe("NOT_READY");
  }
};

const assertNotReadyResultAndDebrief = async (
  examId: string
): Promise<void> => {
  await assertNotReady(() => client.exam.result({ examId }));
  await assertNotReady(() => client.exam.debrief({ examId }));
  await assertNotReady(() => client.exam.review({ examId }));
};

/** The conversation's stored `paper` frame content. `{}` when the row is
 * missing, so every reader asserts against content and an absent frame fails
 * the same way an empty one does. */
const paperFrameContent = async (conversationId: string): Promise<string> => {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
  return rows.find((row) => row.frameType === "paper")?.content ?? "{}";
};

const assertPaperRowSaysRawOnly = async (
  conversationId: string
): Promise<void> => {
  const content = await paperFrameContent(conversationId);
  expect(content).toContain('"phase":"raw-only"');
  expect(content).toContain('"scoring":"raw-only"');
};

interface StoredPaperDebrief {
  weakAnchorLabels?: unknown[];
  weakAnchors?: unknown[];
}

const storedPaperDebrief = async (
  conversationId: string
): Promise<StoredPaperDebrief | undefined> => {
  const content = await paperFrameContent(conversationId);
  return (JSON.parse(content) as { debrief?: StoredPaperDebrief }).debrief;
};

const assertDebriefRecordsThePickAndVerdict = (
  debrief: DebriefedExam
): void => {
  const [first] = debrief.items;
  if (!first) {
    throw new Error("submitted debrief had no item");
  }
  expect(first.selectedIndex).toBe(0);
  expect(first.item.options[first.correctIndex]).toBe(first.correctOption);
  expect(first.explanation).toBeNull();
  expect(first.explanationGenerated).toBe(false);
  expect(first.item.id).toBe(first.itemId);
  expect(JSON.stringify(debrief)).toContain('"correctIndex"');
};

const assertDebriefNamesItsAnchors = (debrief: DebriefedExam): void => {
  // TASK-160: what the CLIENT receives, not just what the helper returns. A
  // debrief over a real assembled paper must carry learner-facing names
  // beside the ids, and at least one item must resolve to one.
  for (const item of debrief.items) {
    for (const label of item.anchorLabels) {
      expect(label).not.toMatch(ANCHOR_NAMESPACE_RE);
    }
  }
  expect(debrief.items.some((item) => item.anchorLabels.length > 0)).toBe(true);
};

const assertStoredFrameNamesItsWeakAnchors = async (
  conversationId: string
): Promise<void> => {
  // TASK-160: the chat paper card reads the STORED frame, not the debrief
  // endpoint, so its "Missed:" line needs the same names baked into the frame.
  // A frame that carries ids without labels is the leak wearing a new field.
  const debrief = await storedPaperDebrief(conversationId);
  if ((debrief?.weakAnchors?.length ?? 0) === 0) {
    return;
  }
  const labels = debrief?.weakAnchorLabels;
  if (!Array.isArray(labels)) {
    throw new Error("the stored paper frame names none of its weak anchors");
  }
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(typeof label).toBe("string");
    expect(label).not.toMatch(ANCHOR_NAMESPACE_RE);
  }
};

const assertSubmittedExam = async (
  submitted: SubmittedExam,
  examId: string
): Promise<void> => {
  const result = await client.exam.result({ examId });
  expect(result.scoring).toBe("raw-only");
  expect(result.pauses.count).toBe(1);
  await assertPaperRowSaysRawOnly(submitted.conversationId);
  const debrief = await client.exam.debrief({ examId });
  expect(debrief.status).toBe("submitted");
  assertDebriefRecordsThePickAndVerdict(debrief);
  assertDebriefNamesItsAnchors(debrief);
  await assertStoredFrameNamesItsWeakAnchors(submitted.conversationId);
};

beforeAll(async () => {
  applyContentMigrations(DB_URL);
  db = await createUserDb(DB_URL);
  client = makeExamClient(db);
}, 120_000);

afterAll(() => {
  db.$client.close();
  removeSqliteDbFiles(DB_PATH);
});

describe("TASK-126 exam pipeline", () => {
  it("builds a request into a ready paper and keeps keys out of client output", async () => {
    const requested = await client.exam.request({
      budget: { listening: 1, vocabulary: 1 },
      level: "N5",
      mode: "shortened",
      sections: ["listening", "vocabulary"],
      seed: "request-ready",
    });
    assertDraftRequest(requested);

    const assembled = await client.exam.assemble({
      examId: requested.examId,
    });
    assertAssembledPaper(assembled);

    const state = await client.exam.get({ examId: requested.examId });
    assertClientOutputExcludesServerFields({ assembled, requested, state });
    if (!requested.conversationId) {
      throw new Error("paper request did not create a conversation");
    }
    await assertPaperRowExcludesServerFields(requested.conversationId);
    await assertFirstItemHasNoExplanation(state);
    await assertConversationExists(requested);
  });

  it("mints and stores a seed when the request omits one", async () => {
    const requested = await client.exam.request({
      budget: { vocabulary: 1 },
      level: "N5",
      sections: ["vocabulary"],
    });
    expect(requested.request.seed).toMatch(GENERATED_SEED_RE);
    const assembled = await client.exam.assemble({
      examId: requested.examId,
    });
    expect(assembled.request.seed).toBe(requested.request.seed);
  });

  it("keeps the official N3 three-section shape", async () => {
    const requested = await client.exam.request({
      level: "N3",
      seed: "n3-shape",
    });
    const assembled = await client.exam.assemble({
      examId: requested.examId,
    });
    expect(assembled.sections.map((section) => section.id)).toEqual([
      "vocabulary",
      "grammar-reading",
      "listening",
    ]);
    expect(assembled.ready).toBe(true);
  });

  it("builds and scores N3 papers in both modes with long reading", async () => {
    await (["shortened", "exam-conditions"] as const).reduce(
      async (previous, mode) => {
        await previous;
        const { assembled, requested } = await requestAndAssemble({
          level: "N3",
          mode,
          seed: `n3-v4-${mode}`,
        });
        expect(assembled.ready).toBe(true);
        expect(assembled.sections.map((section) => section.id)).toEqual([
          "vocabulary",
          "grammar-reading",
          "listening",
        ]);
        expect(assembled.sections.map((section) => section.minutes)).toEqual([
          30, 70, 40,
        ]);
        expect(
          assembled.sections.map((section) => section.timeLimitSeconds)
        ).toEqual(
          mode === "exam-conditions" ? [1800, 4200, 2400] : [900, 2100, 1200]
        );

        const state = await client.exam.get({ examId: requested.examId });
        const longReading = state.items.filter(
          (entry) => entry.item.itemType === "long-reading"
        );
        expect(longReading.length).toBeGreaterThan(0);
        expect(
          longReading.every(
            (entry) =>
              entry.section === "grammar-reading" &&
              typeof entry.item.passage === "string" &&
              entry.item.passage.length > 0
          )
        ).toBe(true);

        const started = await client.exam.start({ examId: requested.examId });
        await answerEveryItem(
          client,
          requested.examId,
          started.sections,
          createItemStore(db)
        );
        await client.exam.submit({ examId: requested.examId });
        const result = await client.exam.result({ examId: requested.examId });
        expect(result.scoring).toBe("band");
        if (result.scoring === "band") {
          // TASK-173.13: the banded N3 result follows the official 得点区分
          // (言語知識・読解・聴解), the same three columns N1/N2 score into, not
          // one column per 試験科目. The test sections above stay vocabulary /
          // grammar-reading / listening; only the scored columns re-split.
          expect(result.sections.map((section) => section.id)).toEqual([
            "language-knowledge",
            "reading",
            "listening",
          ]);
          expect(result.sections.map((section) => section.maxScore)).toEqual([
            60, 60, 60,
          ]);
          expect(result.overall.maxScore).toBe(180);
          expect(result.overall.passed).toBe(true);
        }
      },
      Promise.resolve()
    );
  });

  it("keeps the N2 shape and official minutes", async () => {
    const { assembled } = await requestAndAssemble({
      level: "N2",
      mode: "exam-conditions",
      seed: "n2-v4",
    });
    expect(assembled.ready).toBe(true);
    expect(assembled.sections.map((section) => section.id)).toEqual([
      "language-knowledge-reading",
      "listening",
    ]);
    expect(assembled.sections[0]?.scoringSectionIds).toEqual([
      "language-knowledge",
      "reading",
    ]);
    expect(assembled.sections.map((section) => section.minutes)).toEqual([
      105, 50,
    ]);
    expect(
      assembled.sections.map((section) => section.timeLimitSeconds)
    ).toEqual([6300, 3000]);
  });

  it("splits N2 into three independent banded result columns", async () => {
    const { assembled, requested } = await requestAndAssemble({
      level: "N2",
      mode: "exam-conditions",
      seed: "n2-v4-result",
    });
    const started = await client.exam.start({ examId: requested.examId });
    expect(assembled.ready).toBe(true);
    await answerEveryItem(
      client,
      requested.examId,
      started.sections,
      createItemStore(db)
    );
    await client.exam.submit({ examId: requested.examId });
    const result = await client.exam.result({ examId: requested.examId });
    expect(result.scoring).toBe("band");
    if (result.scoring === "band") {
      expect(result.sections.map((section) => section.id)).toEqual([
        "language-knowledge",
        "reading",
        "listening",
      ]);
      expect(result.sections.map((section) => section.maxScore)).toEqual([
        60, 60, 60,
      ]);
      expect(result.sections.map((section) => section.total)).toEqual([
        60, 10, 10,
      ]);
      expect(result.overall.maxScore).toBe(180);
      expect(result.overall.score).toBe(180);
    }
  });

  it("builds N1 exam conditions with integrated items at 110 + 55 minutes (TASK-132)", async () => {
    const { assembled, requested } = await requestAndAssemble({
      level: "N1",
      mode: "exam-conditions",
      seed: "n1-v5",
    });
    expect(assembled.ready).toBe(true);
    expect(assembled.sections.map((section) => section.id)).toEqual([
      "language-knowledge-reading",
      "listening",
    ]);
    expect(assembled.sections.map((section) => section.minutes)).toEqual([
      110, 55,
    ]);
    expect(
      assembled.sections.map((section) => section.timeLimitSeconds)
    ).toEqual([6600, 3300]);

    const state = await client.exam.get({ examId: requested.examId });
    const integratedReading = state.items.filter(
      (entry) => entry.item.itemType === "integrated-reading"
    );
    const integratedListening = state.items.filter(
      (entry) => entry.item.itemType === "integrated-listening"
    );
    expect(integratedReading.length).toBeGreaterThan(0);
    expect(integratedListening.length).toBeGreaterThan(0);
    // Cross-passage reading: at least two passages, all readable by the client.
    expect(
      integratedReading.every((entry) => entry.item.stimuli.length >= 2)
    ).toBe(true);
    expect(
      integratedReading.every((entry) =>
        entry.item.stimuli.every((stimulus) => stimulus.kind === "passage")
      )
    ).toBe(true);
    // Multi-source listening: the stored item depends on a script AND its
    // accompanying passage, while the client reads only the passage and never
    // the spoken text.
    const store = createItemStore(db);
    const resolutions: (ItemResolution | null)[] = [];
    for (const entry of integratedListening) {
      // biome-ignore lint/performance/noAwaitInLoops: one libSQL read per item keeps the assertion on each stored row.
      resolutions.push(await store.resolveItem(entry.item.id));
    }
    expect(resolutions.map((item) => item?.stimuli?.length)).toEqual(
      integratedListening.map(() => 2)
    );
    expect(resolutions.every((item) => item?.script !== null)).toBe(true);
    expect(
      integratedListening.every((entry) => entry.item.stimuli.length === 1)
    ).toBe(true);
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("特別講演の録音");
    expect(serialized).not.toContain('"script"');
  });

  it("reports N1 as three 60-point sections with a 19-point mark each (TASK-132)", async () => {
    const { assembled, requested } = await requestAndAssemble({
      level: "N1",
      mode: "exam-conditions",
      seed: "n1-v5-result",
    });
    expect(assembled.ready).toBe(true);
    const started = await client.exam.start({ examId: requested.examId });
    await answerEveryItem(
      client,
      requested.examId,
      started.sections,
      createItemStore(db)
    );
    await client.exam.submit({ examId: requested.examId });
    const result = await client.exam.result({ examId: requested.examId });
    expect(result.scoring).toBe("band");
    if (result.scoring === "band") {
      expect(result.sections.map((section) => section.id)).toEqual([
        "language-knowledge",
        "reading",
        "listening",
      ]);
      expect(result.sections.map((section) => section.maxScore)).toEqual([
        60, 60, 60,
      ]);
      expect(result.sections.map((section) => section.passMark)).toEqual([
        19, 19, 19,
      ]);
      expect(result.overall.maxScore).toBe(180);
      expect(result.overall.passed).toBe(true);
    }
  });

  it("resumes answers, preserves the first pick, and gates result and debrief on submit", async () => {
    const { assembled, requested } = await buildSmallPaper("resume-submit");
    expect(assembled.ready).toBe(true);
    const { item } = await startWithItem(requested.examId);
    const first = await client.exam.answer({
      examId: requested.examId,
      itemId: item.item.id,
      selectedIndex: 0,
    });
    expect(first.recorded).toBe(true);
    expect(first.state.status).toBe("in_progress");
    const paused = await client.exam.pause({ examId: requested.examId });
    expect(paused.sections[0]?.paused).toBe(true);
    expect(paused.sections[0]?.pauseCount).toBe(1);

    await reopenClient();
    const resumed = await client.exam.start({ examId: requested.examId });
    assertResumedExam(resumed, paused);
    await client.exam.resume({ examId: requested.examId });

    const duplicate = await client.exam.answer({
      examId: requested.examId,
      itemId: item.item.id,
      selectedIndex: 3,
    });
    expect(duplicate.recorded).toBe(false);
    expect(duplicate.state.answers[0]?.selectedIndex).toBe(0);

    await assertNotReadyResultAndDebrief(requested.examId);

    await client.exam.advanceSection({ examId: requested.examId });
    const submitted = await client.exam.submit({ examId: requested.examId });
    expect(submitted.status).toBe("submitted");
    expect(submitted.answers[0]?.selectedIndex).toBe(0);

    await assertSubmittedExam(submitted, requested.examId);
  });

  it("disputes an item idempotently without changing the stored paper result", async () => {
    const { requested } = await buildSmallPaper("review-dispute");
    const started = await client.exam.start({ examId: requested.examId });
    const [item] = started.items;
    if (!item) {
      throw new Error("dispute fixture did not contain an item");
    }
    await client.exam.answer({
      examId: requested.examId,
      itemId: item.item.id,
      selectedIndex: 0,
    });
    await client.exam.submit({ examId: requested.examId });
    const resultBefore = await client.exam.result({ examId: requested.examId });
    const dispute = await client.exam.dispute({
      examId: requested.examId,
      itemId: item.item.id,
    });
    expect(dispute).toEqual({
      disputed: true,
      disputedAt: expect.any(String),
      itemId: item.item.id,
    });
    const resultAfter = await client.exam.result({ examId: requested.examId });
    expect(resultAfter).toEqual(resultBefore);

    await reopenClient();
    const review = await client.exam.review({ examId: requested.examId });
    expect(
      review.items.find((entry) => entry.itemId === item.item.id)?.disputed
    ).toBe(true);
    const repeated = await client.exam.dispute({
      examId: requested.examId,
      itemId: item.item.id,
    });
    expect(repeated.disputedAt).toBe(dispute.disputedAt);
    expect(await createItemStore(db).isItemDisputed(item.item.id)).toBe(true);
  });

  it("uses raw counts below the floor and official scoring bands above it", async () => {
    const raw = await buildSmallPaper("raw-floor");
    const rawStarted = await client.exam.start({
      examId: raw.requested.examId,
    });
    expect(rawStarted.status).toBe("in_progress");
    await client.exam.submit({ examId: raw.requested.examId });
    const rawResult = await client.exam.result({
      examId: raw.requested.examId,
    });
    expect(rawResult.scoring).toBe("raw-only");
    if (rawResult.scoring === "raw-only") {
      expect(rawResult.overall).toEqual({ correct: 0, total: 2 });
      expect(rawResult.sections[0]?.id).toBe("vocabulary");
    }

    const undersizedExamConditions = await client.exam.request({
      budget: { listening: 1 },
      level: "N5",
      mode: "exam-conditions",
      sections: ["listening"],
      seed: "raw-floor-exam-conditions",
    });
    const undersizedAssembled = await client.exam.assemble({
      examId: undersizedExamConditions.examId,
    });
    expect(undersizedAssembled.ready).toBe(false);
    expect(undersizedAssembled.floor.scoring).toBe("raw-only");
    expect(undersizedAssembled.label).toBe("shortened-paper-raw-only");

    const bandRequested = await client.exam.request({
      level: "N4",
      seed: "band-floor",
    });
    const bandAssembled = await client.exam.assemble({
      examId: bandRequested.examId,
    });
    expect(bandAssembled.ready).toBe(true);
    expect(bandAssembled.floor.scoring).toBe("band");
    const firstMount = await client.exam.get({ examId: bandRequested.examId });
    const firstOrder = firstMount.items.map((item) => item.item.options);

    db.$client.close();
    db = await createUserDb(DB_URL);
    client = makeExamClient(db);
    const secondMount = await client.exam.get({ examId: bandRequested.examId });
    expect(secondMount.items.map((item) => item.item.options)).toEqual(
      firstOrder
    );

    await client.exam.start({ examId: bandRequested.examId });
    await client.exam.submit({ examId: bandRequested.examId });
    const bandResult = await client.exam.result({
      examId: bandRequested.examId,
    });
    expect(bandResult.scoring).toBe("band");
    if (bandResult.scoring === "band") {
      expect(bandResult.sections.map((section) => section.id)).toEqual([
        "language-knowledge",
        "listening",
      ]);
      expect(bandResult.overall.maxScore).toBe(180);
      expect(
        bandResult.sections.find(
          (section) => section.id === "language-knowledge"
        )?.total
      ).toBe(20);
    }
  });

  it("reports the total and section gates independently above the floor", async () => {
    const run = async (
      seed: string,
      correctBySection: Record<string, number>
    ) => {
      const requested = await client.exam.request({
        level: "N4",
        mode: "exam-conditions",
        seed,
      });
      await client.exam.assemble({ examId: requested.examId });
      const started = await client.exam.start({ examId: requested.examId });
      const lastSectionId = started.sections.at(-1)?.id;
      await started.sections.reduce(async (previous, section) => {
        await previous;
        const count = correctBySection[section.id] ?? 0;
        await section.items
          .slice(0, count)
          .reduce(async (answerPrevious, entry) => {
            await answerPrevious;
            // The key comes from the store: the client projection hides it, and
            // a hardcoded 0 only ever worked while every answer sat in slot A.
            const resolved = await createItemStore(db).resolveItem(
              entry.item.id
            );
            await client.exam.answer({
              examId: requested.examId,
              itemId: entry.item.id,
              selectedIndex: resolved?.answerIndex ?? 0,
            });
          }, Promise.resolve());
        if (section.id !== lastSectionId) {
          await client.exam.advanceSection({ examId: requested.examId });
        }
      }, Promise.resolve());
      await client.exam.submit({ examId: requested.examId });
      return await client.exam.result({ examId: requested.examId });
    };

    const sectionsPassButTotalFails = await run("gates-total-fail", {
      "grammar-reading": 3,
      listening: 4,
      vocabulary: 4,
    });
    expect(sectionsPassButTotalFails.scoring).toBe("band");
    if (sectionsPassButTotalFails.scoring === "band") {
      expect(sectionsPassButTotalFails.overall.passed).toBe(false);
      expect(
        sectionsPassButTotalFails.sections.every((section) => section.passed)
      ).toBe(true);
    }

    const totalPassButSectionFails = await run("gates-section-fail", {
      "grammar-reading": 10,
      vocabulary: 10,
    });
    expect(totalPassButSectionFails.scoring).toBe("band");
    if (totalPassButSectionFails.scoring === "band") {
      expect(totalPassButSectionFails.overall.passed).toBe(true);
      expect(
        totalPassButSectionFails.sections.find(
          (section) => section.id === "listening"
        )?.passed
      ).toBe(false);
    }
  });

  it("submits a timed-out section without clearing its answer", async () => {
    const requested = await client.exam.request({
      budget: { listening: 1, vocabulary: 1 },
      level: "N5",
      sections: ["listening", "vocabulary"],
      seed: "time-up-server",
    });
    await client.exam.assemble({ examId: requested.examId });
    await client.exam.start({ examId: requested.examId });
    const sections = await db
      .select()
      .from(examSections)
      .where(eq(examSections.examId, requested.examId));
    const vocabulary = sections.find(
      (section) => section.section === "vocabulary"
    );
    if (!vocabulary) {
      throw new Error("timed exam did not create a vocabulary section");
    }
    const [item] = (await client.exam.get({ examId: requested.examId })).items;
    if (!item) {
      throw new Error("timed exam did not create an item");
    }
    await client.exam.answer({
      examId: requested.examId,
      itemId: item.item.id,
      selectedIndex: 0,
    });
    await db
      .update(examSections)
      .set({ timerStartedAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(examSections.examId, requested.examId));
    const timedOut = await client.exam.get({ examId: requested.examId });
    expect(timedOut.status).toBe("in_progress");
    expect(timedOut.currentSection).toBe("listening");
    expect(
      timedOut.sections.find((section) => section.id === "vocabulary")?.status
    ).toBe("submitted");
    expect(timedOut.answers[0]?.selectedIndex).toBe(0);
  });

  it("records abandon as an end state without a score", async () => {
    const { requested } = await buildSmallPaper("abandon-no-score");
    await client.exam.start({ examId: requested.examId });
    const abandoned = await client.exam.abandon({ examId: requested.examId });
    expect(abandoned.status).toBe("abandoned");
    expect(abandoned.abandonedAt).not.toBeNull();
    expect(
      await createItemStore(db).getExamResult(requested.examId)
    ).toBeNull();
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, abandoned.conversationId));
    const paperRow = rows.find((row) => row.frameType === "paper");
    expect(paperRow?.content).toContain('"abandoned":true');
    expect(paperRow?.content).toContain('"phase":"unavailable"');

    const [resultError] = await safe(
      client.exam.result({ examId: requested.examId })
    );
    expect(isDefinedError(resultError)).toBe(true);
    if (isDefinedError(resultError)) {
      expect(resultError.code).toBe("CONFLICT");
    }
    const [debriefError] = await safe(
      client.exam.debrief({ examId: requested.examId })
    );
    expect(isDefinedError(debriefError)).toBe(true);
    if (isDefinedError(debriefError)) {
      expect(debriefError.code).toBe("CONFLICT");
    }
  });

  it("maps an unknown exam to the typed NOT_FOUND contract error", async () => {
    const [error] = await safe(client.exam.get({ examId: "missing-exam" }));
    expect(isDefinedError(error)).toBe(true);
    if (isDefinedError(error)) {
      expect(error.code).toBe("NOT_FOUND");
    }
  });

  it("maps shared-policy request failures to INVALID_REQUEST", async () => {
    const [error] = await safe(
      client.exam.request({
        level: "N5",
        sections: ["language-knowledge-reading"],
        seed: "invalid-section",
      })
    );
    expect(isDefinedError(error)).toBe(true);
    if (isDefinedError(error)) {
      expect(error.code).toBe("INVALID_REQUEST");
    }
  });

  /**
   * TASK-139 AC#1: the request rebuilt from stored state must be the
   * request that was made.
   *
   * The rebuild only runs when the service's in-memory request map misses,
   * so a test that reuses one client would never reach it and would pass
   * against the bug. A second `makeClient` over the same database is a
   * real restart: a fresh `createExamService` with an empty cache, which
   * is also what happens in production after a sidecar restart or once
   * the LRU evicts. `focus` is the field that used to be dropped, and the
   * receipt carries the request, so the comparison is on the wire shape.
   */
  it("rebuilds the stored request, focus included, after a restart (TASK-139)", async () => {
    const focus = ["grammar:te-form", "grammar:na-form-negative"];
    const original = await client.exam.request({
      budget: { vocabulary: 2 },
      focus,
      level: "N5",
      mode: "shortened",
      sections: ["vocabulary"],
      seed: "t139-round-trip",
    });
    expect(original.request.focus).toEqual(focus);

    const restarted = makeExamClient(db);
    const rebuilt = await restarted.exam.assemble({
      examId: original.examId,
    });

    expect(rebuilt.request).toEqual(original.request);
    expect(rebuilt.request.focus).toEqual(focus);
  });

  /**
   * TASK-138. The 16-hardcoded-noun catalog is gone, and these pin the
   * properties that replaced it rather than restating the implementation:
   * anchors are real corpus ids, each item type draws from a source that can
   * support it, distractors are corpus surfaces, and a paper's vocabulary is
   * distributed rather than a rotation of one list.
   */
  /** Every surface an N5 item is allowed to offer: grammar patterns, example
   * sentences (a listening item's options), readings, words, and glosses. */
  const knownN5Surfaces = (): ReadonlySet<string> => {
    const corpus = examCorpus();
    const grammar = corpus?.grammarByLevel.get("N5") ?? [];
    const vocab = corpus?.vocabByLevel.get("N5") ?? [];
    return new Set([
      ...grammar.map((entry) => entry.pattern),
      ...grammar.flatMap((entry) => entry.examples.map((e) => e.japanese)),
      ...vocab.map((entry) => entry.reading),
      ...vocab.map((entry) => entry.word),
      // Every gloss the entry actually attests, which is `senses` and NOT the
      // flat `meaning`: that string is a summary capped at 8 glosses, so a
      // distractor drawn from sense 12 of a polysemous word is a real corpus
      // surface that `sensesOf` cannot see. TASK-138 AC#10 draws distractors
      // from sense GROUPS, so this set has to be the grouped form or the
      // provenance assertion below fails on a correct item - which is what
      // happened, and looked like a flake until it was read.
      ...vocab.flatMap((entry) => senseGroupsOf(entry).flat()),
    ]);
  };

  /** The pattern's trailing literal, or null when the pattern names no surface. */
  const literalFor = (
    item: { anchors: readonly string[] },
    corpus: ReturnType<typeof examCorpus>
  ): string | null => {
    const pattern =
      corpus?.grammarByAnchor.get(item.anchors[0] ?? "")?.pattern ?? "";
    return targetLiteralOf(pattern);
  };

  /** Split a paper's grammar items into the ones a blank landed in and the ones
   * no rule could touch, so each group is asserted for the property it actually
   * has rather than one loop carrying both. */
  const classifyMasks = (
    items: readonly { anchors: readonly string[]; passage: string | null }[],
    corpus: ReturnType<typeof examCorpus>
  ): {
    masked: { anchors: readonly string[]; passage: string | null }[];
    unmaskable: { passage: string | null }[];
  } => {
    const masked: { anchors: readonly string[]; passage: string | null }[] = [];
    const unmaskable: { passage: string | null }[] = [];
    for (const item of items) {
      if (item.passage?.includes(MASK_BLANK)) {
        masked.push(item);
      } else if (literalFor(item, corpus) === null) {
        unmaskable.push(item);
      }
    }
    return { masked, unmaskable };
  };

  describe("TASK-138 corpus-sourced candidates", () => {
    const fullPaper = async (seed: string) => {
      const requested = await client.exam.request({
        budget: { "grammar-reading": 6, listening: 4, vocabulary: 6 },
        level: "N5",
        mode: "shortened",
        sections: ["vocabulary", "grammar-reading", "listening"],
        seed,
      });
      const assembled = await client.exam.assemble({
        examId: requested.examId,
      });
      const store = createItemStore(db);
      const rows = await db
        .select()
        .from(examItems)
        .where(eq(examItems.examId, requested.examId));
      const items: NonNullable<
        Awaited<ReturnType<typeof store.resolveItem>>
      >[] = [];
      const resolved = await Promise.all(
        rows.map((row) => store.resolveItem(row.itemId))
      );
      for (const [index, item] of resolved.entries()) {
        if (!item) {
          throw new Error(`exam item ${rows[index]?.itemId} did not resolve`);
        }
        items.push(item);
      }
      return { assembled, items };
    };

    // AC#1: an anchor is a real corpus id, resolvable by string. A digest of a
    // synthetic id is not, which is what makes doc-16 §2's anchor check mean
    // something: before TASK-138 the service minted ids and then resolved
    // them against its own map, so the check could not fail.
    it("anchors every item to a real corpus entry (AC#1)", async () => {
      const corpus = examCorpus();
      expect(corpus).not.toBeNull();
      const { items } = await fullPaper("t138-anchors");
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.anchors.length).toBeGreaterThan(0);
        for (const anchor of item.anchors) {
          const known =
            corpus?.vocabByAnchor.has(anchor) === true ||
            corpus?.grammarByAnchor.has(anchor) === true;
          expect(known).toBe(true);
        }
        // The old anchors were `${family}:${level}:<digest>`; a 16-hex digest
        // cannot resolve, so this fails loudly if the catalog regresses.
        expect(item.anchors[0]).not.toMatch(SYNTHETIC_ANCHOR_RE);
      }
    });

    // AC#2: a particle item is anchored to a grammar point and a conjugation to
    // a verb entry. Before, every type drew the same 16 nouns, so the item
    // type drove allocation and validation but not content.
    it("sources each item type from a family that can support it (AC#2)", async () => {
      const corpus = examCorpus();
      const { items } = await fullPaper("t138-families");
      const isGrammarBacked = (itemType: string): boolean =>
        itemType === "particle" ||
        itemType === "grammar-form" ||
        itemType === "reading-info" ||
        itemType === "listening-detail";
      const grammar = items.filter((item) =>
        item.anchors[0]?.startsWith("grammar:")
      );
      const vocab = items.filter((item) =>
        item.anchors[0]?.startsWith("vocab:")
      );
      expect(grammar.length).toBeGreaterThan(0);
      expect(vocab.length).toBeGreaterThan(0);

      for (const item of grammar) {
        const entry = corpus?.grammarByAnchor.get(item.anchors[0] ?? "");
        expect(entry).toBeDefined();
        // A grammar point with no example cannot carry a context or a script,
        // so one that backs an item always has one.
        expect(entry?.examples.length ?? 0).toBeGreaterThan(0);
      }
      for (const item of vocab) {
        expect(corpus?.vocabByAnchor.has(item.anchors[0] ?? "")).toBe(true);
      }
      // The point of AC#2: a grammar-backed type is never anchored to a
      // vocabulary entry, and a conjugation is never anchored to a pattern.
      // Before, every type drew the same sixteen nouns.
      for (const item of items) {
        if (isGrammarBacked(item.itemType)) {
          expect(item.anchors[0]).toStartWith("grammar:");
        }
        if (item.itemType === "conjugation") {
          expect(item.anchors[0]).toStartWith("vocab:");
        }
      }
    });

    // AC#3: four distinct options, and every one of them a real surface rather
    // than a literal from a 16-entry table.
    it("builds four distinct corpus surfaces as options (AC#3)", async () => {
      const { items } = await fullPaper("t138-options");
      const known = knownN5Surfaces();
      for (const item of items) {
        expect(item.options).toHaveLength(4);
        expect(new Set(item.options).size).toBe(4);
        expect(item.options.filter((option) => known.has(option))).toHaveLength(
          4
        );
      }
    });
    // AC#4: the distribution, asserted over an assembled paper rather than one
    // hand-picked item. The old catalog could not pass this: it had 16 entries
    // and a 30-item paper, so a 6-item section already repeated.
    it("draws a distributed vocabulary, not a rotation of one list (AC#4)", async () => {
      const first = await fullPaper("t138-dist-a");
      const second = await fullPaper("t138-dist-b");
      for (const { items } of [first, second]) {
        const anchors = items.map((item) => item.anchors[0] ?? "");
        expect(anchors.length).toBeGreaterThan(0);
        // One entry may back a "meaning of X" and a "reading of X" item -
        // two genuinely different questions, which is what a real paper
        // does. What must not happen is the same entry asked twice the same
        // way, so uniqueness is per (anchor, itemType).
        const pairs = items.map(
          (item) => `${item.anchors[0] ?? ""}#${item.itemType}`
        );
        expect(new Set(pairs).size).toBe(pairs.length);
        // No vocabulary entry backs two items in one paper. The picker spends
        // each anchor once per catalog (CandidateCatalogState.usedVocabAnchors)
        // because the reading and meaning pools are filtered differently, so
        // without that spend the same word could back both and a six-slot
        // section would show it twice.
        const vocabAnchors = anchors.filter((anchor) =>
          anchor.startsWith("vocab:")
        );
        expect(vocabAnchors.length).toBeGreaterThanOrEqual(3);
        expect(new Set(vocabAnchors).size).toBe(vocabAnchors.length);
        // And the words themselves, not just the anchor strings.
        const words = vocabAnchors.map((anchor) => anchor.split(":")[2] ?? "");
        expect(new Set(words).size).toBe(words.length);
      }
      // Two seeds must not produce the same paper.
      const a = first.items.map((item) => item.anchors[0]).join("|");
      const b = second.items.map((item) => item.anchors[0]).join("|");
      expect(a).not.toBe(b);
    });
  });

  /**
   * TASK-142 AC#1: the answer must not be readable off the page. Asserted over
   * an assembled paper rather than one item, and only for items whose pattern
   * names a literal that IS a whole token - the rest are reported unmaskable
   * on purpose, and the test says so rather than pretending they are masked.
   */
  it("masks the target realization so a grammar item needs Japanese (AC#1)", async () => {
    const requested = await client.exam.request({
      budget: { "grammar-reading": 12 },
      level: "N5",
      mode: "shortened",
      sections: ["grammar-reading"],
      seed: "t142-mask",
    });
    const assembled = await client.exam.assemble({
      examId: requested.examId,
    });
    expect(assembled.ready).toBe(true);
    const store = createItemStore(db);
    const rows = await db
      .select()
      .from(examItems)
      .where(eq(examItems.examId, requested.examId));
    const resolved = await Promise.all(
      rows.map((row) => store.resolveItem(row.itemId))
    );
    const items = resolved.filter((item) => item !== null);
    const withPassage = items.filter((item) => item.passage !== null);
    expect(withPassage.length).toBeGreaterThan(0);

    const grammarItems = withPassage.filter((item) =>
      item.anchors[0]?.startsWith("grammar:")
    );
    const { masked, unmaskable } = classifyMasks(grammarItems, examCorpus());
    for (const item of masked) {
      // The literal is gone from what the learner is shown. This is the
      // actual property: non-derivability, which stem-leak cannot check
      // because it only compares the answer STRING.
      expect(item.passage).not.toContain(literalFor(item, examCorpus()) ?? " ");
    }
    // A pattern that names no surface at all (Verb-て, X と Y) is unmaskable
    // by rule, so it must be visibly unmasked rather than silently leaky.
    for (const item of unmaskable) {
      expect(item.passage).not.toContain(MASK_BLANK);
    }
    // The rule is measured at 61% of grammar points, and a 12-slot paper draws
    // a dozen different ones, so at least some must mask. Zero would mean the
    // tokenizer went missing again and every item silently degraded.
    expect(masked.length).toBeGreaterThan(0);
  });

  /**
   * TASK-142 AC#3 + AC#4: the masking record is stored on the item, and it is
   * self-consistent. The invariant matters more than the masking itself: an
   * item that CLAIMS it was masked when the blank was never found is the
   * outcome this task exists to prevent, and nothing else in the pipeline would
   * catch it. AC#4 is the same records read back through a fresh service, so
   * what a reviewer sees is what the learner saw.
   */
  it("records the mask on the item and keeps it self-consistent (AC#3, AC#4)", async () => {
    const requested = await client.exam.request({
      budget: { "grammar-reading": 8, listening: 4 },
      level: "N5",
      mode: "shortened",
      sections: ["grammar-reading", "listening"],
      seed: "t142-record",
    });
    expect(
      (await client.exam.assemble({ examId: requested.examId })).ready
    ).toBe(true);

    const store = createItemStore(db);
    const rows = await db
      .select()
      .from(examItems)
      .where(eq(examItems.examId, requested.examId));
    const resolved = await Promise.all(
      rows.map((row) => store.resolveItem(row.itemId))
    );
    const items = resolved.filter((item) => item !== null);
    const withMask = items.filter((item) => item.mask !== null);
    expect(withMask.length).toBeGreaterThan(0);

    for (const { mask, passage } of withMask) {
      if (!mask) {
        continue;
      }
      // The one strategy that re-tokenized and confirmed the literal is gone.
      if (mask.strategy === "trailing-literal") {
        expect(mask.verified).toBe(true);
        expect(passage).toContain(MASK_BLANK);
        // A verified mask means the literal is absent from what is shown.
        // This is the non-derivability property, and it is the only assertion
        // here that could fail while every other field looks healthy.
        expect(passage).not.toContain(mask.literal ?? "unreachable");
      } else {
        // Every other strategy is a refusal, and a refusal must leave the
        // sentence intact rather than claim a blank it did not insert.
        expect(mask.verified).toBe(false);
        expect(passage).not.toContain(MASK_BLANK);
      }
      if (mask.strategy === "no-literal-in-pattern") {
        expect(mask.literal).toBeNull();
      }
    }

    // A listening item's script never leaves the server, so there is nothing to
    // mask and nothing to record. Null must mean that, not "masked and fine".
    const listening = items.filter(
      (item) =>
        item.itemType === "listening-detail" ||
        item.itemType === "integrated-listening"
    );
    for (const item of listening) {
      expect(item.mask).toBeNull();
    }
  });

  /**
   * TASK-141 AC#5: a listening item speaks the script it was assembled from,
   * and nothing else speaks at all.
   *
   * The property that cannot be faked: a listening item's options are example
   * sentences from OTHER grammar points, so the spoken script must be THIS
   * item's own option - the one assembly marked as the answer. A learner must
   * never hear text they cannot find again in the review.
   */
  it("projects the spoken script for listening items only (AC#5)", async () => {
    const requested = await client.exam.request({
      budget: { "grammar-reading": 4, listening: 4, vocabulary: 4 },
      level: "N5",
      mode: "shortened",
      sections: ["listening", "vocabulary", "grammar-reading"],
      seed: "t141-speech",
    });
    expect(
      (await client.exam.assemble({ examId: requested.examId })).ready
    ).toBe(true);
    // `start` is what the desktop renders a running paper from, and it is where
    // the client item projection is produced.
    const started = await client.exam.start({ examId: requested.examId });
    const items = started.sections.flatMap((section) => section.items);
    // `listening-detail` ONLY. `integrated-listening` keeps TASK-132's rule and
    // is NOT covered by this task: its script is one of several stimuli, and a
    // named TASK-132 test guards exactly that. See SPEAKING_ITEM_TYPES.
    const isListening = (type: string): boolean => type === "listening-detail";
    const listening = items.filter((entry) => isListening(entry.item.itemType));
    const others = items.filter((entry) => !isListening(entry.item.itemType));
    expect(listening.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);

    for (const { item } of listening) {
      expect(typeof item.speech).toBe("string");
      expect(item.speech?.length ?? 0).toBeGreaterThan(0);
      // The spoken text is one of this item's OWN options, so the review can
      // point at what the learner heard. It is not necessarily options[0]: the
      // TASK-135 shuffle permutes options after assembly, so the answer's index
      // is deliberately unstable and the answer key stays server-side.
      expect(item.options).toContain(item.speech ?? "unreachable");
      // And the audio is not a reading aid: a listening item has no passage.
      expect(item.passage).toBeNull();
    }
    for (const { item } of others) {
      // TASK-132's rule, narrowed rather than dropped: a reading question must
      // never offer to speak a passage it was never asked aloud.
      expect(item.speech).toBeNull();
    }
  });

  /**
   * TASK-140. `focus` was accepted by the contract, persisted (TASK-139) and
   * then ignored at selection time, so a focused request produced exactly the
   * paper an unfocused one did. These pin the prior.
   *
   * The comparison that matters is between two papers of the SAME seed, one
   * focused and one not. Everything else follows from it.
   */
  describe("TASK-140 focus as a selection prior", () => {
    const paperFor = async (focus: readonly string[], seed: string) => {
      const requested = await client.exam.request({
        budget: { "grammar-reading": 10 },
        focus: [...focus],
        level: "N5",
        mode: "shortened",
        sections: ["grammar-reading"],
        seed,
      });
      const assembled = await client.exam.assemble({
        examId: requested.examId,
      });
      const started = await client.exam.start({ examId: requested.examId });
      const items = started.sections
        .flatMap((section) => section.items)
        .map((entry) => entry.item);
      return { assembled, items, requested };
    };

    const anchorsOf = (items: readonly { anchors: readonly string[] }[]) =>
      items.map((item) => item.anchors[0] ?? "");

    // AC#1: a focus-carrying request changes which anchors the picker chooses.
    // Real corpus anchors, not synthetic digests, so this cannot pass against
    // the old behaviour by accident.
    it("changes the paper when focus is supplied (AC#1)", async () => {
      const corpus = examCorpus();
      const grammarAnchors = [
        ...(corpus?.grammarByLevel.get("N5") ?? [])
          .slice(0, 3)
          .map((entry) => `grammar:${entry.id}`),
      ];
      expect(grammarAnchors.length).toBeGreaterThan(0);

      const focused = await paperFor(grammarAnchors, "t140-prior");
      const unfocused = await paperFor([], "t140-prior");

      expect(focused.assembled.ready).toBe(true);
      expect(unfocused.assembled.ready).toBe(true);
      // Same seed, so the only difference is the focus.
      expect(anchorsOf(focused.items)).not.toEqual(anchorsOf(unfocused.items));

      // AC#4: the distribution, not one hand-picked item. Every focus anchor
      // lands, and the rest of the paper is still filled.
      const focusedAnchors = anchorsOf(focused.items);
      for (const anchor of grammarAnchors) {
        expect(focusedAnchors).toContain(anchor);
      }
      expect(focusedAnchors.length).toBeGreaterThanOrEqual(8);
    });

    // AC#2: a prior is not a filter. Two ids must still yield a full paper, and
    // an unknown id must degrade to today's behaviour rather than throwing.
    it("fills a full paper from a two-id focus, and ignores unknown ids (AC#2)", async () => {
      const corpus = examCorpus();
      const anchors = [...(corpus?.grammarByLevel.get("N5") ?? [])]
        .slice(0, 2)
        .map((entry) => `grammar:${entry.id}`);
      const two = await paperFor(anchors, "t140-two");
      expect(two.assembled.ready).toBe(true);
      // Ten slots asked for, ten delivered: exhaustion fell back to the pool.
      expect(two.items.length).toBeGreaterThanOrEqual(8);
      for (const anchor of anchors) {
        expect(anchorsOf(two.items)).toContain(anchor);
      }

      // An empty id is rejected by the contract's IdentifierSchema before it
      // reaches the picker, so the degradation case is a well-formed id that
      // names nothing.
      const junk = await paperFor(
        ["grammar:not-a-real-point", "vocab:N5:__:__"],
        "t140-junk"
      );
      expect(junk.assembled.ready).toBe(true);
      expect(junk.items.length).toBeGreaterThanOrEqual(8);
    });

    // AC#3: the prior is applied in a STABLE ORDER. Not "the same request
    // produces the same paper" - that property does not exist and never did,
    // because the exam id seeds the pool walk, so two requests with one seed
    // differ outside the focus region by design. Replay comes from the stored
    // items, not from re-deriving the request (doc-21 §9). What must be stable
    // is that the focus anchors land in the CALLER's order, every run.
    it("lands focus anchors in the caller's order on every run (AC#3)", async () => {
      const corpus = examCorpus();
      const entries = [...(corpus?.grammarByLevel.get("N5") ?? [])];
      // Guarded rather than indexed blindly: a corpus edit that shortened the
      // N5 grammar list would otherwise fail as an undefined entry.
      const chosen = [entries[2], entries[0], entries[1]].filter(
        (entry): entry is (typeof entries)[number] => entry !== undefined
      );
      const requested = chosen.map((entry) => `grammar:${entry.id}`);
      const inRequestOrder = async (
        anchors: readonly string[],
        seed: string
      ) => {
        const { items } = await paperFor(anchors, seed);
        const found = anchorsOf(items);
        // The CALLER's order, filtered to the anchors that actually landed -
        // filtered by the parameter, not the outer list, so a different
        // request order is measured against itself.
        return anchors.filter((anchor) => found.includes(anchor));
      };

      const first = await inRequestOrder(requested, "t140-order-a");
      const second = await inRequestOrder(requested, "t140-order-b");
      expect(first).toEqual(requested);
      expect(second).toEqual(requested);

      // And the order is the caller's, not sorted: a different order must put
      // the same anchors in a different sequence.
      const swapped = [...requested];
      const [head, ...rest] = swapped;
      swapped.splice(0, 1, ...rest.slice(1));
      if (head !== undefined) {
        swapped.push(head);
      }
      const swappedSeen = await inRequestOrder(swapped, "t140-order-a");
      expect(swappedSeen).toEqual(swapped);
      expect(swappedSeen).not.toEqual(first);
    });
  });

  it("keeps the rebuild faithful for a request made without focus (TASK-139)", async () => {
    const original = await client.exam.request({
      budget: { vocabulary: 2 },
      level: "N5",
      mode: "shortened",
      sections: ["vocabulary"],
      seed: "t139-no-focus",
    });
    expect(original.request.focus).toEqual([]);

    const restarted = makeExamClient(db);
    const rebuilt = await restarted.exam.assemble({
      examId: original.examId,
    });

    expect(rebuilt.request).toEqual(original.request);
  });
});
