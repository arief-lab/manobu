/**
 * TASK-100: the refused-send notice lane.
 *
 * SSR markup assertions (no DOM env in this workspace, so state transitions
 * are not reachable here): a fresh provider has `sendNotice === null`, which
 * must leave no live region and no stray text in the composer footer. The
 * shown branch is the same five lines of markup and is verified in the
 * running app; its COPY is pinned by composer-send.test.ts.
 */

import { describe, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatSessionProvider } from "./provider";
import { noticeToneClass, SendNotice } from "./send-notice";
import { createTestQueryClient, installLocalStorageStub } from "./ssr-test-env";

installLocalStorageStub();
const testQueryClient = createTestQueryClient();

describe("SendNotice (TASK-100)", () => {
  test("an idle composer renders no notice and no live region", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={testQueryClient}>
        <ChatSessionProvider readOnly>
          <SendNotice />
        </ChatSessionProvider>
      </QueryClientProvider>
    );
    expect(html).toBe("");
  });

  test("each tone paints its own colour, and a success is not the error red", () => {
    // The bug this pins: the lane used to hardcode `text-destructive`, so
    // "Paper ready" arrived in the same red as a refused send.
    expect(noticeToneClass.error).toBe("text-destructive");
    expect(noticeToneClass.success).toBe("text-success");
    expect(noticeToneClass.warning).toBe("text-warning");
    expect(noticeToneClass.info).toBe("text-muted-foreground");
    expect(noticeToneClass.success).not.toBe(noticeToneClass.error);
  });
});
