import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUserDb } from "@manobu/db";
import { applyContentMigrations } from "@manobu/db/migrate";

/*
 * TASK-148: the fill retry.
 *
 * Removing the repeat fallback (AC#1) took away the picker's last-ditch way of
 * filling a slot, so a candidate the validator rejects now leaves a hole instead
 * of borrowing a question the learner already answered. A hole is not a small
 * inconvenience: `assemble` only marks a paper `ready` when every slot is
 * filled, and `start` refuses anything else, so a 29/30 paper is one the learner
 * cannot open. Measured on a clean database, a default N5 paper came up 29/30 on
 * 2 builds in 40 at the two-slot candidate reserve.
 *
 * The fix is to widen the reserve and rebuild rather than to ship the hole.
 * These tests pin both halves, because a retry that always ran would be as
 * wrong as one that never did: the cheap build must stay cheap, and the hard one
 * must end full.
 *
 * The seed strings are load-bearing. The walk is a digest of the seed, so
 * renaming one picks different corpus entries and the case stops being the case
 * it was. If the corpus changes underneath them, `attempts` moves and these
 * assertions say so out loud, which is the point: they are a canary on the
 * rejection profile, not a number copied from a comment.
 */

const DB_PATH = join(tmpdir(), `manobu-fill-${Date.now()}.db`);
const DB_URL = `file:${DB_PATH}`;
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.DATABASE_URL = DB_URL;
// Applied to the EXPLICIT url: `bun test` runs every file in one process, so the
// env var is a shared global a sibling file's value can win.
applyContentMigrations(DB_URL);

const { createRouterClient } = await import("@orpc/server");
const { createChatContext } = await import("../src/chat-hub");
const { createRpcHandlers } = await import("../src/rpc");
const { __test__ } = await import("../src/services/exam-service");

const db = await createUserDb(DB_URL);
const client = createRouterClient(
  createRpcHandlers({}, async () => db),
  {
    context: createChatContext(),
  }
);

const defaultPaper = async (seed: string) => {
  const requested = await client.exam.request({ level: "N5", seed });
  const built = await client.exam.assemble({ examId: requested.examId });
  return { built, fill: __test__.fillOf(requested.examId) };
};

describe("the fill retry (TASK-148)", () => {
  it("rebuilds with a wider reserve when the first run cannot fill the paper", async () => {
    const { built, fill } = await defaultPaper("hunt-18");
    // The case this exists for: the narrow reserve spends both its slots on
    // rejected candidates, so the build comes back short and the retry pays.
    expect(fill?.attempts).toBe(2);
    expect(fill?.reserve).toBe(4);
    expect(built.ready).toBe(true);
    expect(built.validatedSlots).toBe(built.totalSlots);
    // Widening is not exhaustion. The level had the content all along; the run
    // was too short to reach it, so the receipt must not tell the learner they
    // have seen everything.
    expect(built.contentExhausted).toBe(false);
  });

  it("does not widen a paper that filled on its first run", async () => {
    const { built, fill } = await defaultPaper("hunt-0");
    expect(fill?.attempts).toBe(1);
    expect(fill?.reserve).toBe(2);
    expect(built.ready).toBe(true);
  });
});
