// biome-ignore-all lint/performance/noAwaitInLoops: sequential cron dispatch required
/*
 * Cron dispatch loop (TASK-22 Tier B — AionUi due→prompt→report cycle).
 *
 * The Rust ticker (cron.rs spawn_ticker) marks due jobs as `Running` in
 * `jobs.json`. This loop polls `cron_history` for `Running` entries,
 * dispatches each job's `prompt` through the oRPC fetch-link `chat.send`
 * procedure (honoring `agent`/`conversationId`/`model` per job; a job
 * without a conversation rides the stable `cron-<jobId>` conversation),
 * and calls `cron_report_result` so the history flips to `Done/Failed`
 * and one-time jobs auto-disable. Keeps the Tauri module ACP-free — the
 * frontend owns the network call. The pre-oRPC raw `POST /ai` transport
 * is deleted (TASK-80.8 AC#6: the Hono route 80.2 retired no longer
 * exists).
 *
 * Poll interval matches the Rust ticker (30s). Missed-trigger semantics are
 * handled Rust-side; this loop only dispatches what Rust already marked due.
 */

import { safe } from "@orpc/client";
import { cronHistory, cronList, cronReportResult } from "./cron";
import { orpc } from "./orpc";

const POLL_MS = 30_000;

async function dispatchOne(job: {
  agent?: string | null;
  conversationId?: string | null;
  id: string;
  model?: string | null;
  prompt: string;
}): Promise<boolean> {
  const [error] = await safe(
    orpc.chat.send({
      agent: job.agent ?? undefined,
      // A job without its own conversation pools into a stable per-job
      // conversation so repeated ticks keep one thread (the pre-oRPC
      // transport invented a fresh one each time).
      conversationId: job.conversationId ?? `cron-${job.id}`,
      messages: [{ content: job.prompt, role: "user" }],
      model: job.model ?? undefined,
    })
  );
  if (error) {
    // Any failure (sidecar down, CONVERSATION_BUSY, agent error) marks
    // this run failed; the next tick's `running` poll picks up retries.
    console.error(
      `[cron] dispatch ${job.id} failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
  return true;
}

export function startCronDispatchLoop(): () => void {
  // Only in Tauri desktop — cron store lives in app_data_dir via Rust.
  const isTauri =
    typeof globalThis !== "undefined" &&
    Boolean((globalThis as Record<string, unknown>).__TAURI__);
  if (!isTauri) {
    return () => undefined;
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      const [running, jobs] = await Promise.all([
        cronHistory(undefined, 100),
        cronList(),
      ]);
      const pending = running.filter((r) => r.status === "running");
      if (pending.length === 0) {
        return;
      }
      const jobById = new Map(jobs.map((j) => [j.id, j] as const));
      for (const run of pending) {
        const job = jobById.get(run.jobId);
        if (!job) {
          // Job deleted after firing — mark failed so it doesn't spin.
          await cronReportResult(run.jobId, run.firedAt, false).catch(
            () => undefined
          );
          continue;
        }
        const ok = await dispatchOne(job);
        await cronReportResult(run.jobId, run.firedAt, ok).catch(
          () => undefined
        );
      }
    } catch {
      // Poll failures are non-fatal — next tick retries.
    }
  };

  const schedule = (): void => {
    timer = setTimeout(async () => {
      await tick();
      if (!stopped) {
        schedule();
      }
    }, POLL_MS);
  };

  // First tick delayed by POLL_MS to let Rust ticker fire first; immediate
  // dispatch would race with a job that just became due.
  schedule();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
