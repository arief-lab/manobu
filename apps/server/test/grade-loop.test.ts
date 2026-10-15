/**
 * TASK-53: the FSRS loop must close — grading a card has to advance its
 * due date, memory state, and lapse counters. Guards the exact regression
 * where /cards/grade only wrote a revlog row and cards never moved (queue
 * could never drain; memory state frozen at defaults).
 *
 * TASK-164 made /cards/due a due QUEUE rather than a card browser, so this
 * suite no longer takes handles out of it: each test seeds the card it grades
 * (POST /cards) and reads the outcome off that row. The queue is asserted only
 * for what the queue owns — whether the card is still due.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";

process.env.CORS_ORIGIN = "http://localhost:3000";
const TEST_DB = "file:/tmp/t53-grade-loop.db";

const { createCardsRoute } = await import("../src/routes/cards");
const { createUserDb } = await import("@manobu/db");
const { cards: cardsTable } = await import("@manobu/db/schema/user");
const { daysElapsedSince, previewIntervals } = await import("@manobu/srs");
const { eq } = await import("drizzle-orm");

const jsonAs = async <T>(res: Response): Promise<T> => (await res.json()) as T;

const cards = createCardsRoute(() => createUserDb(TEST_DB));
let db: Awaited<ReturnType<typeof createUserDb>>;

interface CardRow {
  difficulty: number;
  due: string;
  id: number;
  isLeech: boolean;
  lapses: number;
  stability: number;
  state: string;
}

type GradeCode = "again" | "easy" | "good" | "hard";

/** The wire's grade name to the FSRS grade number `previewIntervals` keys by. */
const GRADE_CODE: Record<GradeCode, 1 | 2 | 3 | 4> = {
  again: 1,
  easy: 4,
  good: 3,
  hard: 2,
};

const today = (): string => new Date().toISOString().slice(0, 10);

/** The date `n` whole days from today, the way the write computes one. */
const dayFromToday = (n: number): string =>
  new Date(Date.parse(`${today()}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);

const readCard = async (id: number): Promise<CardRow> => {
  const row = await db
    .select()
    .from(cardsTable)
    .where(eq(cardsTable.id, id))
    .then((rows) => rows[0]);
  if (!row) {
    throw new Error(`card ${id} not found`);
  }
  return row;
};

const seedCard = async (jp: string, vocabId: number): Promise<CardRow> => {
  const res = await cards.request("/cards", {
    body: JSON.stringify({
      cards: [{ jp, level: "N5", reading: jp, vocabId }],
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  expect(res.status).toBe(200);
  const { inserted } = await jsonAs<{ inserted: number[] }>(res);
  const [id] = inserted;
  if (id === undefined) {
    throw new Error(`seed card ${jp} was not inserted`);
  }
  return readCard(id);
};

const gradeCard = async (
  cardId: number,
  grade: GradeCode,
  desiredRetention?: number
): Promise<CardRow> => {
  const res = await cards.request("/cards/grade", {
    body: JSON.stringify({ cardId, desiredRetention, grade }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  expect(res.status).toBe(200);
  const { card } = await jsonAs<{ card: CardRow }>(res);
  return card;
};

const dueCards = async (): Promise<CardRow[]> => {
  const res = await cards.request("/cards/due");
  const { cards: rows } = await jsonAs<{ cards: CardRow[] }>(res);
  return rows;
};

beforeAll(async () => {
  // Start from a fresh db every run — a leftover db from a previous run
  // would double-apply grades and break state assertions.
  const dbPath = TEST_DB.replace("file:", "");
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${dbPath}${suffix}`);
    } catch {
      // first run — nothing to clean
    }
  }
  // The cards table lives in the content-migration chain — the route
  // assumes boot migrations ran (index.ts). Apply them to the test db.
  // (Cold vaporetto predictor build ~6.5s — hence the long timeout.)
  const { applyContentMigrations } = await import("@manobu/db/migrate");
  applyContentMigrations(TEST_DB);
  db = await createUserDb(TEST_DB);
}, 60_000);

describe("TASK-53 grade loop", () => {
  it("grading 'good' advances due date and memory state", async () => {
    const card = await seedCard("食べる", 3);
    expect(card.state).toBe("new");

    const graded = await gradeCard(card.id, "good");

    expect(graded.due > today()).toBe(true);
    expect(graded.state).toBe("review");
    expect(graded.stability).toBeGreaterThan(0);
    expect(graded.lapses).toBe(0);
  });

  it("a card graded 'good' is no longer in the due queue (TASK-164)", async () => {
    const card = await seedCard("水", 5);

    const graded = await gradeCard(card.id, "good");

    expect(graded.due > today()).toBe(true);
    const ids = (await dueCards()).map((row) => row.id);
    expect(ids).not.toContain(card.id);
  });

  it("grading 'again' increments lapses and schedules tomorrow, not today (TASK-166)", async () => {
    const card = await seedCard("東", 2);

    const graded = await gradeCard(card.id, "again");

    expect(graded.lapses).toBe(1);
    // FSRS says a failed card comes back in under a day (0.21d for a new
    // card), which a day-granular `due` cannot express. Flooring it to today
    // left the card at the head of the queue the desk had just refetched, so
    // the learner graded it twice: the cycling TASK-166 was filed for. The
    // one-day floor is the whole fix, and it is the same number the button
    // printed.
    expect(graded.due).toBe(dayFromToday(1));
    const ids = (await dueCards()).map((row) => row.id);
    expect(ids).not.toContain(card.id);
  });

  it("is_leech flags after the lapse threshold (queue.ts uses lapses > 4)", async () => {
    const card = await seedCard("飲む", 4);
    // drive 5 'again' grades → lapses 5 > 4
    const gradeAgain = async (): Promise<void> => {
      await gradeCard(card.id, "again");
    };
    await gradeAgain();
    await gradeAgain();
    await gradeAgain();
    await gradeAgain();
    await gradeAgain();

    const graded = await readCard(card.id);
    expect(graded.lapses).toBe(5);
    expect(graded.isLeech).toBe(true);
  });

  it("grading a missing card returns 404", async () => {
    const res = await cards.request("/cards/grade", {
      body: JSON.stringify({ cardId: 999_999, grade: "good" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("keeps level-local vocabulary ids distinct", async () => {
    await seedCard("飲む", 20);
    const res = await cards.request("/cards", {
      body: JSON.stringify({
        cards: [{ jp: "飲む", level: "N4", reading: "のむ", vocabId: 20 }],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(200);
    const { inserted } = await jsonAs<{ inserted: number[] }>(res);
    expect(inserted).toHaveLength(1);
  });

  it("preview-parity: the day written is the day the shared preview prints", async () => {
    // `previewIntervals` is the function `apps/desktop/src/lib/review.ts`
    // wraps for the grade buttons, and `gradeCard` posts over the legacy
    // route, so this is the desk's number against the server's write through
    // two real entry points rather than a read of either one's source
    // (TASK-53 AC5, TASK-166 AC#1). Both sides now run the same
    // `nextStates` + `scheduleDays`, so the days are equal by construction
    // and this test says so loudly when someone reintroduces a second path.
    const card = await seedCard("石", 7);
    const graded = await gradeCard(card.id, "good", 0.8);
    const daysElapsed = daysElapsedSince(card.due, new Date());
    const { 3: previewed } = previewIntervals(
      card.state === "new"
        ? null
        : { difficulty: card.difficulty, stability: card.stability },
      0.8,
      daysElapsed
    );
    expect(graded.due).toBe(dayFromToday(previewed));
  });

  it("the write schedules at the retention the request carries (TASK-166 AC#1)", async () => {
    // Two new cards, the same grade, the same second. Until the retention
    // travelled with the request both were scheduled at a hardcoded 0.9
    // (apps/server/src/services/grading.ts), so a learner at 70% got the 90%
    // queue and the button lied about it.
    const loose = await seedCard("新聞", 31);
    const tight = await seedCard("電話", 32);
    const gradedLoose = await gradeCard(loose.id, "good", 0.7);
    const gradedTight = await gradeCard(tight.id, "good", 0.97);

    expect(gradedLoose.due).toBe(
      dayFromToday(previewIntervals(null, 0.7, 0)[3])
    );
    expect(gradedTight.due).toBe(
      dayFromToday(previewIntervals(null, 0.97, 0)[3])
    );
    // The two have to differ, or the request changed nothing.
    expect(gradedLoose.due > gradedTight.due).toBe(true);
  });

  it("an omitted retention uses the contract default (0.9)", async () => {
    // The desk always sends its setting; this is the fallback every other
    // caller (and the drill's `applyGrade`) gets, pinned to one number.
    const card = await seedCard("駅", 33);
    const graded = await gradeCard(card.id, "good");
    expect(graded.due).toBe(dayFromToday(previewIntervals(null, 0.9, 0)[3]));
  });

  it("an overdue card schedules at the time it actually waited (TASK-166 AC#2)", async () => {
    // `daysElapsedSince` is shared by the write and the desk's preview now,
    // but every card this suite seeds is due today, so no assertion against a
    // seeded row can tell real elapsed time from a hardcoded 0. This row is
    // pushed 14 days into the past at a stability where waiting costs a whole
    // scheduled day, which is what makes the two observable.
    const card = await seedCard("東京", 36);
    const dueDate = dayFromToday(-14);
    await db
      .update(cardsTable)
      .set({
        difficulty: 5,
        due: dueDate,
        stability: 29,
        state: "review",
      })
      .where(eq(cardsTable.id, card.id));
    const late = await readCard(card.id);

    const graded = await gradeCard(card.id, "good");
    const previous = {
      difficulty: late.difficulty,
      stability: late.stability,
    };
    const { 3: waited } = previewIntervals(
      previous,
      0.9,
      daysElapsedSince(late.due, new Date())
    );
    const { 3: asIfFresh } = previewIntervals(previous, 0.9, 0);
    // The state is chosen so the fresh-card assumption gives a different day;
    // if that stops being true this test proves nothing.
    expect(waited).not.toBe(asIfFresh);
    expect(graded.due).toBe(dayFromToday(waited));
  });

  it("a retention outside the band is rejected at the boundary", async () => {
    const card = await seedCard("本", 34);
    const res = await cards.request("/cards/grade", {
      body: JSON.stringify({
        cardId: card.id,
        desiredRetention: 0.5,
        grade: "good",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(400);
  });

  it("no grade leaves a card due today (TASK-166 AC#4)", async () => {
    // The desk sessions from `due <= today` (TASK-164) and refetches after
    // every grade, so a card still due today is the next card it shows. Any
    // grade scheduling below one whole day put the rated card straight back
    // at the head, which is the cycling this task was filed for.
    //
    // The row's own `due` is what is asserted, not queue membership: the
    // queue is capped at 20 rows and this suite has seeded more than that by
    // now, so absence from the page would prove nothing.
    const grades = ["again", "hard", "good", "easy"] as const;
    // Sequential on purpose: each assertion is about the row after its own
    // write, and every grade goes through the same single connection.
    for (const [index, grade] of grades.entries()) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential write table over one connection
      const card = await seedCard(`語${grade}`, 40 + index);
      const graded = await gradeCard(card.id, grade);
      expect(graded.due > today()).toBe(true);
      expect(graded.due).toBe(
        dayFromToday(previewIntervals(null, 0.9, 0)[GRADE_CODE[grade]])
      );
    }
  });
});
