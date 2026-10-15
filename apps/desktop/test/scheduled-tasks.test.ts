import { describe, expect, it } from "bun:test";

import { __test__ as cronUi } from "@/features/settings/settings-scheduled-tasks";

/**
 * ScheduledTasks pure helpers (2026-09-14 state audit). The component moved
 * onto react-query (lib/tauri-queries.ts); these are the parts that don't
 * need a cache or a Tauri shell to prove.
 */

const baseInput = {
  advanced: false,
  name: "Daily drill",
  presetLabel: "Daily",
  prompt: "  review my due cards  ",
  rawCron: "",
};

describe("buildTask", () => {
  it("trims the prompt and defaults an empty name", () => {
    const job = cronUi.buildTask(baseInput);
    expect(job.prompt).toBe("review my due cards");
    expect(job.name).toBe("Daily drill");
    expect(cronUi.buildTask({ ...baseInput, name: "   " }).name).toBe(
      "Untitled task"
    );
  });

  it("uses the preset schedule when not advanced", () => {
    const job = cronUi.buildTask(baseInput);
    expect(job.enabled).toBe(true);
    expect(job.queueProtection).toBe(true);
    expect(job.keepAwake).toBe(false);
    expect(job.executionMode).toBe("continue");
    expect(job.tz).toBe("Asia/Tokyo");
    // an unknown preset label falls back to the hourly expression
    expect(job.cronExpr).toBe("0 * * * *");
    expect(job.id).toStartWith("user-");
  });

  it("takes the raw cron verbatim in advanced mode", () => {
    const job = cronUi.buildTask({
      ...baseInput,
      advanced: true,
      rawCron: "  */15 * * * *  ",
    });
    expect(job.cronExpr).toBe("*/15 * * * *");
  });
});

describe("firstErrorMessage", () => {
  it("returns the first message, or null when all are empty", () => {
    expect(
      cronUi.firstErrorMessage(null, new Error("boom"), new Error("later"))
    ).toBe("boom");
    expect(cronUi.firstErrorMessage(undefined, null)).toBeNull();
    expect(cronUi.firstErrorMessage()).toBeNull();
  });
});

describe("runsFor", () => {
  it("selects only the rows ending with the job id", () => {
    const history = [
      "2026-09-14T09:00|user-1|done",
      "2026-09-14T10:00|user-2|failed",
      "2026-09-14T11:00|user-1|running",
    ];
    expect(cronUi.runsFor(history, "user-1")).toHaveLength(2);
    expect(cronUi.runsFor(history, "user-3")).toEqual([]);
  });
});
