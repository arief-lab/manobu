import { describe, expect, test } from "bun:test";
import { createKeepaliveFetchRpcClient } from "./orpc";

describe("keepalive fetch RPC client", () => {
  test("sets keepalive on the custom fetch request", async () => {
    const requests: RequestInit[] = [];
    const client = createKeepaliveFetchRpcClient((_input, init) => {
      requests.push(init ?? {});
      return Promise.resolve(
        Response.json({
          json: { conversations: [], nextCursor: null },
        })
      );
    });

    await client.chat.listConversations({});

    expect(requests).toHaveLength(1);
    expect(requests[0]?.keepalive).toBe(true);
  });
});
