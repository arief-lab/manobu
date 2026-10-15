import { describe, expect, it } from "bun:test";

import {
  buildSendFailureError,
  classifyConversationBusyError,
  SessionCommandQueue,
} from "../src/conversation-guard";

/**
 * TASK-22 Tier A2/A3 — AionUi conversation-guard adoption.
 *
 * The queue must serialize overlapping prompts (rapid taps, cron tick +
 * user send) per session; busy failures must classify into the
 * buildSendFailureError taxonomy so UI cards render resolutions, not
 * `String(e)`.
 */

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("buildSendFailureError taxonomy", () => {
  it("classifies disconnect as reconnect_agent", () => {
    const failure = buildSendFailureError(
      new Error("socket connection closed unexpectedly")
    );
    expect(failure.code).toBe("user_agent_disconnected");
    expect(failure.resolution).toBe("reconnect_agent");
  });

  it("classifies busy as wait", () => {
    const failure = buildSendFailureError(
      new Error("agent already processing a prompt")
    );
    expect(failure.code).toBe("conversation_busy");
    expect(failure.resolution).toBe("wait");
  });

  it("classifies missing binary as fix_path", () => {
    const failure = buildSendFailureError(new Error("spawn opencode ENOENT"));
    expect(failure.code).toBe("path_unavailable");
    expect(failure.resolution).toBe("fix_path");
  });

  it("classifies unknown as retry and preserves upstream text", () => {
    const failure = buildSendFailureError(new Error("weird upstream"));
    expect(failure.code).toBe("unknown_upstream");
    expect(failure.resolution).toBe("retry");
    expect(failure.upstream).toBe("weird upstream");
  });

  it("handles non-Error throws and undefined", () => {
    expect(buildSendFailureError("boom").upstream).toBe("boom");
    expect(buildSendFailureError(undefined).code).toBe("unknown_upstream");
  });

  // Every keyword group of the UPSTREAM_RULES table, driven through the
  // public classifier (classifyUpstream itself is module-private by design).
  it("matches every disconnect keyword group case-insensitively", () => {
    for (const message of [
      "Connection Closed by peer",
      "socket connection was interrupted",
      "agent process exited with code 1",
      "AIONUI user_agent_disconnected received",
    ]) {
      expect(buildSendFailureError(new Error(message)).code).toBe(
        "user_agent_disconnected"
      );
    }
  });

  it("matches every busy keyword group", () => {
    for (const message of [
      "session BUSY",
      "already processing your last message",
      "prompt in progress",
      "AIONUI_CONVERSATION_BUSY",
    ]) {
      expect(buildSendFailureError(new Error(message)).code).toBe(
        "conversation_busy"
      );
    }
  });

  it("matches every path keyword group including the workspace pair", () => {
    for (const message of [
      "agent binary not found",
      "spawn opencode ENOENT",
      "no such file or directory",
      "the workspace is temporarily unavailable",
    ]) {
      expect(buildSendFailureError(new Error(message)).code).toBe(
        "path_unavailable"
      );
    }
  });

  it("requires both workspace keywords for the pair group", () => {
    expect(buildSendFailureError(new Error("workspace detached")).code).toBe(
      "unknown_upstream"
    );
    expect(buildSendFailureError(new Error("service unavailable")).code).toBe(
      "unknown_upstream"
    );
  });

  it("orders disconnect above busy for mixed messages", () => {
    const failure = buildSendFailureError(
      new Error("connection closed while prompt was in progress")
    );
    expect(failure.code).toBe("user_agent_disconnected");
    expect(failure.detail).toBe(
      "The agent process disconnected. Reconnect and try again."
    );
  });
});

describe("classifyConversationBusyError", () => {
  it("flags busy variants and ignores everything else", () => {
    expect(classifyConversationBusyError(new Error("session busy")).busy).toBe(
      true
    );
    expect(
      classifyConversationBusyError(new Error("AIONUI_CONVERSATION_BUSY: x"))
        .busy
    ).toBe(true);
    expect(classifyConversationBusyError(new Error("other")).busy).toBe(false);
    expect(classifyConversationBusyError(null).busy).toBe(false);
  });
});

describe("SessionCommandQueue", () => {
  it("runs the first command immediately", async () => {
    const queue = new SessionCommandQueue();
    const outcome = await queue.enqueue(async () => "first");
    expect(outcome.outcome).toBe("ran");
    expect(outcome.result).toBe("first");
  });

  it("queues overlapping commands and drains in order", async () => {
    const queue = new SessionCommandQueue();
    const order: string[] = [];
    let releaseActive: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });

    const first = queue.enqueue(async () => {
      await gate; // hold the queue busy
      order.push("first");
      return "first-result";
    });
    const second = queue.enqueue(() => {
      order.push("second");
      return Promise.resolve("second-result");
    });
    const third = queue.enqueue(() => {
      order.push("third");
      return Promise.resolve("third-result");
    });

    releaseActive?.();
    const [r1, r2, r3] = await Promise.all([first, second, third]);
    expect(r1.outcome).toBe("ran");
    expect(r2.outcome).toBe("queued");
    expect(r3.outcome).toBe("queued");
    expect(order).toEqual(["first", "second", "third"]);
    expect(r2.result).toBe("second-result");
    expect(r3.result).toBe("third-result");
  });

  it("propagates command failure without breaking the chain", async () => {
    const queue = new SessionCommandQueue();
    const first = queue.enqueue(() =>
      Promise.reject(new Error("command failed"))
    );
    const second = queue.enqueue(() => Promise.resolve("after-failure"));
    await expect(first).rejects.toThrow("command failed");
    const outcome = await second;
    expect(outcome.result).toBe("after-failure");
    expect(queue.depth).toBe(0);
  });

  it("rejects admission past maxPending with a busy taxonomy error", async () => {
    // maxPending counts commands in the system (active + waiting).
    const queue = new SessionCommandQueue({ maxPending: 2 });
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.enqueue(async () => {
      await gate;
      return 1;
    });
    const second = queue.enqueue(() => Promise.resolve(2)); // fills the cap
    await flush();
    // Third command exceeds maxPending=2 → structured busy rejection.
    try {
      await queue.enqueue(async () => 3);
      throw new Error("expected admission rejection");
    } catch (error) {
      const failure = error as { code?: string; resolution?: string };
      expect(failure.code).toBe("conversation_busy");
      expect(failure.resolution).toBe("wait");
    }
    release?.();
    expect(await first).toEqual({ outcome: "ran", result: 1 });
    expect(await second).toEqual({ outcome: "queued", result: 2 });
    expect(queue.depth).toBe(0);
  });
});
