import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { count, eq } from "drizzle-orm";
import DatabaseLibsql from "libsql";

import {
  createItemStore,
  type ExamState,
  type ItemStore,
  type StoreItemInput,
  type UserDatabase,
} from "../src/item-store";
import { applyContentMigrations } from "../src/migrate";
import migration0007 from "../src/migrations/0007_items_and_sessions.sql" with {
  type: "text",
};
import {
  conversations,
  drillAttempts,
  examAnswers,
  examItems,
  examSections,
  items,
} from "../src/schema/user";

const DB_PATH = join(tmpdir(), `manobu-items-${Date.now()}.db`);
const PARTIAL_DB_PATH = join(tmpdir(), `manobu-items-partial-${Date.now()}.db`);
const PARTIAL_EXAM_DB_PATH = join(
  tmpdir(),
  `manobu-items-partial-exam-${Date.now()}.db`
);
const DB_URL = `file:${DB_PATH}`;
const PARTIAL_DB_URL = `file:${PARTIAL_DB_PATH}`;
const PARTIAL_EXAM_DB_URL = `file:${PARTIAL_EXAM_DB_PATH}`;
const CONVERSATION_ID = "conversation-items";

process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.DATABASE_URL = DB_URL;

const { createUserDb } = await import("../src/index");

let db: UserDatabase;
let store: ItemStore;

const itemInput = (
  id: string,
  overrides: Partial<StoreItemInput> = {}
): StoreItemInput => ({
  anchors: [`vocab:${id}`],
  answerIndex: 1,
  id,
  itemType: "word-in-context",
  level: "N5",
  options: ["まち", "ほん", "みず", "ひだり"],
  prompt: "___を読みます。",
  surface: "exam",
  ...overrides,
});

const expectPausedExam = (paused: ExamState): void => {
  expect(paused.sections[0]?.activeMs).toBe(300_000);
  expect(paused.sections[0]?.pauseCount).toBe(1);
  expect(paused.sections[0]?.pausedAt).toBe("2026-09-25T10:05:00.000Z");
  expect(paused.sections[0]?.timerStartedAt).toBeNull();
};

const expectReopenedExam = (reopened: ExamState | null): void => {
  expect(reopened?.status).toBe("in_progress");
  expect(reopened?.currentSection).toBe("vocabulary");
  expect(reopened?.sections[0]?.pausedAt).toBe("2026-09-25T10:05:00.000Z");
};

const expectResumedExam = (resumed: ExamState): void => {
  expect(resumed.sections[0]?.pausedMs).toBe(120_000);
  expect(resumed.sections[0]?.timerStartedAt).toBe("2026-09-25T10:07:00.000Z");
};

const expectAdvancedExam = (advanced: ExamState): void => {
  expect(advanced.currentSection).toBe("grammar-reading");
  expect(
    advanced.sections.find((section) => section.section === "vocabulary")
      ?.status
  ).toBe("submitted");
  expect(
    advanced.sections.find((section) => section.section === "grammar-reading")
      ?.startedAt
  ).toBe("2026-09-25T10:20:00.000Z");
  expect(advanced.answers[0]?.answerIndex).toBe(1);
};

const expectClientSafeExam = async (
  itemStore: ItemStore,
  examId: string
): Promise<void> => {
  const clientExam = await itemStore.renderExam(examId);
  expect(clientExam).not.toBeNull();
  const serialized = JSON.stringify(clientExam);
  for (const key of [
    "answerIndex",
    "explanation",
    "script",
    "fsrsVocabId",
    "optionSources",
  ]) {
    expect(serialized).not.toContain(`"${key}"`);
  }
};

beforeAll(async () => {
  applyContentMigrations(DB_URL);
  db = await createUserDb(DB_URL);
  store = createItemStore(db);
  await db
    .insert(conversations)
    .values({ id: CONVERSATION_ID, title: "Items" });
}, 120_000);

const removeDatabase = (path: string): void => {
  for (const suffix of ["", "-wal", "-shm"]) {
    const databasePath = `${path}${suffix}`;
    if (existsSync(databasePath)) {
      unlinkSync(databasePath);
    }
  }
};

afterAll(() => {
  db.$client.close();
  removeDatabase(DB_PATH);
  removeDatabase(PARTIAL_DB_PATH);
  removeDatabase(PARTIAL_EXAM_DB_PATH);
});

describe("TASK-122 item storage", () => {
  it("creates migration 0015 as the latest migration", async () => {
    const tableResult = await db.$client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('items', 'exam_items', 'exam_sections', 'exam_answers', 'drill_sessions', 'drill_attempts', 'drill_session_lifecycle', 'drill_pool_items', 'exams')"
    );
    const tableNames = tableResult.rows.map((row) => String(row.name));
    expect(new Set(tableNames)).toEqual(
      new Set([
        "items",
        "exam_items",
        "exam_sections",
        "exam_answers",
        "drill_sessions",
        "drill_attempts",
        "drill_session_lifecycle",
        "drill_pool_items",
        "exams",
      ])
    );
    const versionResult = await db.$client.execute("PRAGMA user_version");
    expect(Number(versionResult.rows[0]?.user_version)).toBe(17);
    const columnResult = await db.$client.execute(
      "SELECT name FROM pragma_table_info('items') WHERE name = 'stimuli'"
    );
    expect(columnResult.rows).toHaveLength(1);
    // TASK-139: the exams.focus column, and its default, are what make a
    // rebuilt request the request that was made. Assert the column lands
    // on a fresh database, not only that the migration count went up.
    const focusColumn = await db.$client.execute(
      "SELECT name, type, \"notnull\", dflt_value FROM pragma_table_info('exams') WHERE name = 'focus'"
    );
    expect(focusColumn.rows).toHaveLength(1);
    expect(String(focusColumn.rows[0]?.notnull)).toBe("1");
    expect(String(focusColumn.rows[0]?.dflt_value)).toBe("'[]'");
    // TASK-142: the items.mask column, nullable because an item with nothing to
    // mask stores no record - and null must stay distinct from a stored
    // unmasked record, which is the whole point of the field.
    const maskColumn = await db.$client.execute(
      "SELECT name, type FROM pragma_table_info('items') WHERE name = 'mask'"
    );
    expect(maskColumn.rows).toHaveLength(1);
    expect(String(maskColumn.rows[0]?.type)).toBe("TEXT");
  });

  it("recovers when migration 0007 stopped after its first table", async () => {
    applyContentMigrations(PARTIAL_DB_URL);
    const partialDb = new DatabaseLibsql(PARTIAL_DB_URL);
    try {
      for (const table of [
        "exam_answers",
        "exam_sections",
        "drill_pool_items",
        "drill_session_lifecycle",
        "drill_attempts",
        "drill_sessions",
        "exam_items",
        "exams",
        "items",
      ]) {
        partialDb.exec(`DROP TABLE \`${table}\``);
      }
      const [firstStatement] = migration0007.split("--> statement-breakpoint");
      if (!firstStatement) {
        throw new Error("migration 0007 has no first statement");
      }
      partialDb.exec(firstStatement);
      partialDb.exec("PRAGMA user_version = 7");
    } finally {
      partialDb.close();
    }

    expect(() => applyContentMigrations(PARTIAL_DB_URL)).not.toThrow();
    const recoveredDb = await createUserDb(PARTIAL_DB_URL);
    const version = await recoveredDb.$client.execute("PRAGMA user_version");
    const tableResult = await recoveredDb.$client.execute(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('items', 'exam_items', 'exam_sections', 'exam_answers', 'drill_sessions', 'drill_attempts', 'drill_session_lifecycle', 'drill_pool_items', 'exams')"
    );
    recoveredDb.$client.close();
    expect(Number(version.rows[0]?.user_version)).toBe(17);
    expect(Number(tableResult.rows[0]?.count)).toBe(9);
  });

  it("recovers a partially applied exam-state migration", async () => {
    applyContentMigrations(PARTIAL_EXAM_DB_URL);
    const partialDb = new DatabaseLibsql(PARTIAL_EXAM_DB_URL);
    try {
      partialDb.exec("DROP TABLE `exam_answers`");
      partialDb.exec("PRAGMA user_version = 10");
    } finally {
      partialDb.close();
    }

    expect(() => applyContentMigrations(PARTIAL_EXAM_DB_URL)).not.toThrow();
    const recoveredDb = await createUserDb(PARTIAL_EXAM_DB_URL);
    const version = await recoveredDb.$client.execute("PRAGMA user_version");
    const answerTable = await recoveredDb.$client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'exam_answers'"
    );
    recoveredDb.$client.close();
    expect(Number(version.rows[0]?.user_version)).toBe(17);
    expect(answerTable.rows).toHaveLength(1);
  });

  it("composes exams by item id and reuses the same row in a drill", async () => {
    const item = itemInput("shared-item", { answerIndex: 2 });
    await store.storeItem(item);
    await store.storeItem(item);
    await expect(
      store.storeItem({ ...item, prompt: "A conflicting prompt." })
    ).rejects.toThrow("already exists with different content");
    await store.createExam({
      budgets: { vocabulary: 10 },
      conversationId: CONVERSATION_ID,
      id: "exam-shared-item",
      level: "N5",
      mode: "shortened",
      seed: "seed-1",
      source: "generated",
    });
    await store.composeExamItems("exam-shared-item", [
      {
        itemId: item.id,
        itemType: item.itemType,
        order: 0,
        section: "vocabulary",
      },
    ]);
    await store.createDrillSession({
      anchors: item.anchors,
      conversationId: CONVERSATION_ID,
      declaredCount: 1,
      id: "drill-shared-item",
      level: "N5",
      tier: "2",
    });
    await store.markDrillItemAsked("drill-shared-item", item.id);
    await store.answerDrillItem("drill-shared-item", item.id, 0);

    const examItemsForPaper = await store.listExamItems("exam-shared-item");
    const resolution = await store.resolveItem(item.id);
    const [itemCount] = await db.select({ value: count() }).from(items);
    expect(examItemsForPaper[0]?.item.id).toBe(item.id);
    expect(resolution?.id).toBe(item.id);
    expect(Number(itemCount?.value)).toBe(1);
  });

  it("persists an idempotent dispute without changing the client item projection", async () => {
    const item = itemInput("review-item");
    await store.storeItem(item);
    const first = await store.markItemDisputed(
      item.id,
      "2026-09-25T00:00:00.000Z"
    );
    const second = await store.markItemDisputed(
      item.id,
      "2026-09-26T00:00:00.000Z"
    );
    expect(first.disputed).toBe(true);
    expect(first.disputedAt).toBe("2026-09-25T00:00:00.000Z");
    expect(second.disputedAt).toBe(first.disputedAt);
    expect(await store.isItemDisputed(item.id)).toBe(true);
    const clientItem = await store.renderItem(item.id);
    expect(clientItem).not.toBeNull();
    expect(JSON.stringify(clientItem)).not.toContain("disputed");
  });

  it("recovers asked, answered and remaining after pause and reopen", async () => {
    const answeredItem = itemInput("resume-answered");
    const pendingItem = itemInput("resume-pending");
    await store.storeItem(answeredItem);
    await store.storeItem(pendingItem);
    await store.createDrillSession({
      anchors: ["grammar:particles"],
      conversationId: CONVERSATION_ID,
      declaredCount: 3,
      id: "drill-resume",
      level: "N5",
      tier: "2",
    });
    await store.markDrillItemAsked("drill-resume", answeredItem.id);
    const firstAnswer = await store.answerDrillItem(
      "drill-resume",
      answeredItem.id,
      1
    );
    const duplicateAnswer = await store.answerDrillItem(
      "drill-resume",
      answeredItem.id,
      0
    );
    expect(firstAnswer.recorded).toBe(true);
    expect(duplicateAnswer.recorded).toBe(false);
    expect(duplicateAnswer.attempt.id).toBe(firstAnswer.attempt.id);
    expect(duplicateAnswer.attempt.chosenIndex).toBe(1);
    expect(duplicateAnswer.attempt.correct).toBe(true);
    await store.markDrillItemAsked("drill-resume", pendingItem.id);
    await store.pauseDrillSession("drill-resume");

    db.$client.close();
    db = await createUserDb(DB_URL);
    store = createItemStore(db);

    const paused = await store.getDrillSessionState("drill-resume");
    expect(paused?.status).toBe("paused");
    expect(paused?.asked).toBe(2);
    expect(paused?.answered).toBe(1);
    expect(paused?.remaining).toBe(1);
    expect(paused?.answeredItemIds).toEqual([answeredItem.id]);

    const resumed = await store.resumeDrillSession("drill-resume");
    expect(resumed.status).toBe("active");
    expect(resumed.asked).toBe(2);
    expect(resumed.answered).toBe(1);
    expect(resumed.remaining).toBe(1);
  });

  it("stores FSRS links only for word-backed items", async () => {
    await store.storeItem(
      itemInput("word-backed", { fsrsVocabId: 17, itemType: "kanji-reading" })
    );
    await store.storeItem(
      itemInput("grammar-item", { itemType: "grammar-form" })
    );
    await store.storeItem(
      itemInput("listening-item", {
        itemType: "listening-detail",
        script: "駅へ行きます。",
      })
    );

    const word = await store.resolveItem("word-backed");
    const grammar = await store.resolveItem("grammar-item");
    const listening = await store.resolveItem("listening-item");
    expect(word?.fsrsVocabId).toBe(17);
    expect(grammar?.fsrsVocabId).toBeNull();
    expect(listening?.fsrsVocabId).toBeNull();
    await expect(
      store.storeItem(
        itemInput("invalid-grammar-link", {
          fsrsVocabId: 18,
          itemType: "grammar-form",
        })
      )
    ).rejects.toThrow("grammar-form items cannot link to an FSRS card");
    await expect(
      store.storeItem(itemInput("invalid-word-link", { fsrsVocabId: 0 }))
    ).rejects.toThrow("FSRS vocabulary id must be a positive integer");
  });

  it("omits hidden answer and listening data from client renders", async () => {
    const item = itemInput("key-containment", {
      answerIndex: 3,
      explanation: "The key is only shown after a pick.",
      itemType: "listening-detail",
      script: "駅へ行きます。",
    });
    await store.storeItem(item);
    const clientItem = await store.renderItem(item.id);
    const resolution = await store.resolveItem(item.id);
    expect(clientItem).not.toBeNull();
    expect(clientItem).not.toHaveProperty("answerIndex");
    expect(clientItem).not.toHaveProperty("explanation");
    expect(clientItem).not.toHaveProperty("fsrsVocabId");
    expect(clientItem).not.toHaveProperty("script");
    expect(clientItem?.createdAt).not.toBe("(datetime('now'))");
    expect(resolution?.answerIndex).toBe(3);
    expect(resolution?.script).toBe("駅へ行きます。");
  });

  it("persists a stimulus set, materializes the singular columns, and keeps scripts server-side (TASK-132)", async () => {
    const item = itemInput("integrated-reading", {
      itemType: "integrated-reading",
      level: "N1",
      stimuli: [
        { kind: "passage", text: "最初のパッセージです。" },
        { kind: "passage", text: "第二のパッセージです。" },
      ],
    });
    const clientItem = await store.storeItem(item);
    expect(clientItem.stimuli).toEqual([
      { kind: "passage", text: "最初のパッセージです。" },
      { kind: "passage", text: "第二のパッセージです。" },
    ]);
    const resolution = await store.resolveItem(item.id);
    expect(resolution?.stimuli).toEqual(item.stimuli);
    expect(resolution?.passage).toBe("最初のパッセージです。");
    // Re-storing the same declared set is idempotent; a different set is not.
    await expect(store.storeItem(item)).resolves.toBeTruthy();
    await expect(
      store.storeItem({
        ...item,
        stimuli: [{ kind: "passage", text: "別の文章です。" }],
      })
    ).rejects.toThrow("already exists with different content");
  });

  it("keeps an integrated listening script out of the client render (TASK-132)", async () => {
    const item = itemInput("integrated-listening", {
      itemType: "integrated-listening",
      level: "N1",
      stimuli: [
        { kind: "script", text: "録音された台本です。" },
        { kind: "passage", text: "付随する資料です。" },
      ],
    });
    await store.storeItem(item);
    const resolution = await store.resolveItem(item.id);
    expect(resolution?.script).toBe("録音された台本です。");
    const clientItem = await store.renderItem(item.id);
    expect(clientItem?.stimuli).toEqual([
      { kind: "passage", text: "付随する資料です。" },
    ]);
    const serialized = JSON.stringify(clientItem);
    expect(serialized).not.toContain("録音された台本です");
    expect(serialized).not.toContain("script");
  });

  it("reads a row written before the stimulus column as a one-stimulus set (TASK-132)", async () => {
    const legacy = itemInput("legacy-passage", {
      itemType: "long-reading",
      level: "N3",
      passage: "長い文章です。",
    });
    await store.storeItem(legacy);
    await db.$client.execute(
      "UPDATE items SET stimuli = NULL WHERE id = 'legacy-passage'"
    );
    const resolution = await store.resolveItem(legacy.id);
    expect(resolution?.stimuli).toBeNull();
    expect(resolution?.passage).toBe("長い文章です。");
    const clientItem = await store.renderItem(legacy.id);
    expect(clientItem?.stimuli).toEqual([
      { kind: "passage", text: "長い文章です。" },
    ]);
  });

  it("refuses a stimulus column it cannot read (TASK-132)", async () => {
    const item = itemInput("corrupt-stimuli", {
      itemType: "integrated-reading",
      level: "N1",
      stimuli: [{ kind: "passage", text: "文章です。" }],
    });
    await store.storeItem(item);
    await db.$client.execute(
      "UPDATE items SET stimuli = '[{\"kind\":\"audio\"}]' WHERE id = 'corrupt-stimuli'"
    );
    await expect(store.resolveItem(item.id)).rejects.toThrow(
      "must be a stimulus array"
    );
  });

  it("persists the drill runway and caps supersession rounds", async () => {
    const first = itemInput("pool-first", { surface: "drill" });
    const second = itemInput("pool-second", { surface: "drill" });
    await store.storeItem(first);
    await store.storeItem(second);
    await store.createDrillSession({
      anchors: ["vocab:pool"],
      conversationId: CONVERSATION_ID,
      declaredCount: 3,
      id: "drill-pool",
      level: "N5",
      maxPerType: 1,
      tier: "2",
    });
    const created = await store.getDrillSessionState("drill-pool");
    expect(created?.generation).toBe(0);
    expect(
      await store.appendDrillPoolItems({
        expectedGeneration: 0,
        itemIds: [first.id, second.id],
        sessionId: "drill-pool",
      })
    ).toBe(2);
    const claimed = await store.claimDrillItem("drill-pool", first.id);
    expect(claimed.kind).toBe("claimed");
    expect((await store.getDrillSessionState("drill-pool"))?.asked).toBe(1);
    expect((await store.getDrillPool("drill-pool"))[0]?.state).toBe("asked");

    const firstSupersession = await store.supersedeDrillPool("drill-pool");
    expect(firstSupersession.superseded).toBe(true);
    expect(firstSupersession.dropped).toBe(1);
    expect((await store.getDrillPool("drill-pool"))[1]?.state).toBe(
      "superseded"
    );
    expect((await store.supersedeDrillPool("drill-pool")).superseded).toBe(
      true
    );
    expect((await store.supersedeDrillPool("drill-pool")).superseded).toBe(
      false
    );
    expect(
      (await store.getDrillSessionState("drill-pool"))?.supersessionCount
    ).toBe(2);
  });

  it("guards exam transitions and rejects partial or unvalidated papers", async () => {
    const first = itemInput("exam-guard-first");
    const second = itemInput("exam-guard-second");
    await store.storeItem(first);
    await store.storeItem(second);
    await store.createExam({
      budgets: { vocabulary: 2 },
      conversationId: CONVERSATION_ID,
      id: "exam-guard",
      level: "N5",
      mode: "shortened",
      seed: "guard-seed",
      source: "generated",
    });

    await expect(store.startExam("exam-guard")).rejects.toThrow("is not ready");
    await expect(store.markExamReady("exam-guard")).rejects.toThrow(
      "before validation"
    );
    await expect(
      store.markExamReady({ examId: "exam-guard", validated: false })
    ).rejects.toThrow("before validation");
    await store.composeExamItems("exam-guard", [
      {
        itemId: first.id,
        itemType: first.itemType,
        order: 0,
        section: "vocabulary",
      },
    ]);
    await expect(
      store.markExamReady({ examId: "exam-guard", validated: true })
    ).rejects.toThrow("not fully validated");
    await store.composeExamItems("exam-guard", [
      {
        itemId: second.id,
        itemType: second.itemType,
        order: 1,
        section: "vocabulary",
      },
    ]);
    const ready = await store.markExamReady({
      at: "2026-09-25T09:00:00.000Z",
      examId: "exam-guard",
      validated: true,
    });
    expect(ready.status).toBe("ready");
    expect(ready.readyAt).toBe("2026-09-25T09:00:00.000Z");
    await expect(store.submitExam("exam-guard")).rejects.toThrow(
      "is not in progress"
    );
    const abandoned = await store.abandonExam({
      at: "2026-09-25T09:01:00.000Z",
      examId: "exam-guard",
    });
    expect(abandoned.status).toBe("abandoned");
    expect(abandoned.abandonedAt).toBe("2026-09-25T09:01:00.000Z");
    expect(await store.getExamResult("exam-guard")).toBeNull();
  });

  it("resumes answers, advances timed sections and projects client-safe items", async () => {
    const first = itemInput("exam-resume-first", {
      explanation: "server-only explanation",
      fsrsVocabId: 91,
      script: "server-only script",
    });
    const second = itemInput("exam-resume-second", {
      itemType: "grammar-form",
    });
    await store.storeItem(first);
    await store.storeItem(second);
    await store.createExam({
      budgets: { "grammar-reading": 1, vocabulary: 1 },
      conversationId: CONVERSATION_ID,
      id: "exam-resume",
      level: "N5",
      mode: "shortened",
      seed: "resume-seed",
      source: "generated",
    });
    await store.composeExamItems("exam-resume", [
      {
        itemId: first.id,
        itemType: first.itemType,
        order: 0,
        section: "vocabulary",
        timeLimitSeconds: 1200,
      },
      {
        itemId: second.id,
        itemType: second.itemType,
        order: 1,
        section: "grammar-reading",
        timeLimitSeconds: 2400,
      },
    ]);
    await store.markExamReady({ examId: "exam-resume", validated: true });
    const started = await store.startExam({
      at: "2026-09-25T10:00:00.000Z",
      examId: "exam-resume",
    });
    expect(started.currentSection).toBe("vocabulary");
    expect(started.sections[0]?.timeLimitSeconds).toBe(1200);
    const paused = await store.pauseExam({
      at: "2026-09-25T10:05:00.000Z",
      examId: "exam-resume",
    });
    expectPausedExam(paused);

    db.$client.close();
    db = await createUserDb(DB_URL);
    store = createItemStore(db);
    const reopened = await store.getExamState("exam-resume");
    expectReopenedExam(reopened);
    const resumed = await store.resumeExam({
      at: "2026-09-25T10:07:00.000Z",
      examId: "exam-resume",
    });
    expectResumedExam(resumed);
    const answer = await store.recordExamAnswer({
      answerIndex: 1,
      at: "2026-09-25T10:08:00.000Z",
      examId: "exam-resume",
      itemId: first.id,
    });
    expect(answer.answerIndex).toBe(1);
    const duplicate = await store.recordExamAnswer("exam-resume", first.id, 0);
    expect(duplicate.answerIndex).toBe(1);

    const advanced = await store.advanceExamSection({
      at: "2026-09-25T10:20:00.000Z",
      examId: "exam-resume",
      section: "grammar-reading",
    });
    expectAdvancedExam(advanced);

    await expectClientSafeExam(store, "exam-resume");
  });

  it("auto-submits at time-up without clearing an answer", async () => {
    const item = itemInput("exam-time-up", {
      itemType: "listening-detail",
      script: "駅へ行きます。",
    });
    await store.storeItem(item);
    await store.createExam({
      budgets: { listening: 1 },
      conversationId: CONVERSATION_ID,
      id: "exam-time-up",
      level: "N5",
      mode: "shortened",
      seed: "time-up-seed",
      source: "generated",
    });
    await store.composeExamItems("exam-time-up", [
      {
        itemId: item.id,
        itemType: item.itemType,
        order: 0,
        section: "listening",
      },
    ]);
    await store.markExamReady({ examId: "exam-time-up", validated: true });
    await store.startExam("exam-time-up");
    await store.recordExamAnswer("exam-time-up", item.id, 2);
    expect(await store.getExamResult("exam-time-up")).toBeNull();
    const submitted = await store.autoSubmitExam({
      at: "2026-09-25T10:30:00.000Z",
      examId: "exam-time-up",
      result: { rawScore: 1 },
    });
    expect(submitted.status).toBe("submitted");
    expect(submitted.submittedAt).toBe("2026-09-25T10:30:00.000Z");
    expect(submitted.answers[0]?.answerIndex).toBe(2);
    expect(await store.getExamResult("exam-time-up")).toEqual({ rawScore: 1 });
    expect(submitted.sections[0]?.status).toBe("submitted");
  });

  it("cascades exam sections and answers while preserving shared items", async () => {
    const item = itemInput("exam-cascade-state");
    await store.storeItem(item);
    await store.createExam({
      budgets: { vocabulary: 1 },
      conversationId: CONVERSATION_ID,
      id: "exam-cascade-state",
      level: "N5",
      mode: "shortened",
      seed: "cascade-state-seed",
      source: "generated",
    });
    await store.composeExamItems("exam-cascade-state", [
      {
        itemId: item.id,
        itemType: item.itemType,
        order: 0,
        section: "vocabulary",
      },
    ]);
    await store.markExamReady({
      examId: "exam-cascade-state",
      validated: true,
    });
    await store.startExam("exam-cascade-state");
    await store.recordExamAnswer("exam-cascade-state", item.id, 1);
    await store.deleteExam("exam-cascade-state");

    const [sectionCount] = await db
      .select({ value: count() })
      .from(examSections)
      .where(eq(examSections.examId, "exam-cascade-state"));
    const [answerCount] = await db
      .select({ value: count() })
      .from(examAnswers)
      .where(eq(examAnswers.examId, "exam-cascade-state"));
    expect(Number(sectionCount?.value)).toBe(0);
    expect(Number(answerCount?.value)).toBe(0);
    expect((await store.renderItem(item.id))?.id).toBe(item.id);
  });

  it("reverses compositions without deleting reusable items", async () => {
    const item = itemInput("cascade-item");
    await store.storeItem(item);
    await store.createExam({
      budgets: { "grammar-reading": 1 },
      conversationId: CONVERSATION_ID,
      id: "exam-cascade",
      level: "N5",
      mode: "shortened",
      seed: "seed-cascade",
      source: "seed",
    });
    await store.composeExamItems("exam-cascade", [
      {
        itemId: item.id,
        itemType: item.itemType,
        order: 0,
        section: "grammar-reading",
      },
    ]);
    await store.createDrillSession({
      anchors: item.anchors,
      conversationId: CONVERSATION_ID,
      declaredCount: 1,
      id: "drill-cascade",
      level: "N5",
      tier: "2",
    });
    await store.answerDrillItem("drill-cascade", item.id, 1);

    await store.deleteExam("exam-cascade");
    await store.deleteDrillSession("drill-cascade");

    const [examItemCount] = await db
      .select({ value: count() })
      .from(examItems)
      .where(eq(examItems.examId, "exam-cascade"));
    const [attemptCount] = await db
      .select({ value: count() })
      .from(drillAttempts)
      .where(eq(drillAttempts.sessionId, "drill-cascade"));
    expect(Number(examItemCount?.value)).toBe(0);
    expect(Number(attemptCount?.value)).toBe(0);
    expect((await store.renderItem(item.id))?.id).toBe(item.id);
  });
});
