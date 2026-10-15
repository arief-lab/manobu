/*
 * The fetcher's two data-feed decisions that a caller cannot see from the
 * UI: what the model-catalog fetcher does when the server refuses (TASK-102
 * AC#4/#5), and when the slash snapshot is allowed to ask at all (TASK-157).
 *
 * `modelCatalogQueryOptions().queryFn` is the seam that decides what the
 * picker shows when the server refuses the cold model fetch:
 * - a DEFINED `AUTH_REQUIRED` answer -> the authRequired catalog (a real
 *   sign-in signal: `agentModels` only 401s after the session open was
 *   actually rejected for auth),
 * - any other DEFINED answer (NOT_FOUND: no catalog) -> the honest empty
 *   catalog, `authRequired:false`,
 * - a NETWORK failure -> re-thrown so TanStack retries (not a settled state).
 *
 * `slashCommandsQueryOptions().enabled` is the gate that keeps a fresh
 * conversation from asking for a session the server has not created.
 *
 * Only `./orpc` is mocked (it would otherwise open a real link and read env);
 * `safe` and `isDefinedError` run for real, and the rejection is a genuine
 * defined error built by oRPC's own factory, so this locks the mapping
 * against the client's actual defined-error predicate.
 */

import { describe, expect, mock, test } from "bun:test";
import { createORPCErrorFromJson, isDefinedError } from "@orpc/client";

const models = mock((): Promise<unknown> => Promise.resolve({}));
const slashCommands = mock(
  (): Promise<unknown> => Promise.resolve({ commands: [] })
);

mock.module("./orpc", () => ({
  getChatWsClient: () => ({}),
  orpc: { acp: { agents: { models } }, chat: { slashCommands } },
}));

const { modelCatalogQueryOptions, slashCommandsQueryOptions } = await import(
  "./fetcher"
);

function definedError(code: "AUTH_REQUIRED" | "NOT_FOUND"): unknown {
  const error = createORPCErrorFromJson({
    code,
    data: { message: "sign in to use this agent" },
    defined: true,
    message: "sign in to use this agent",
  });
  // Guard the fixture itself: if oRPC's predicate ever stops accepting this,
  // the test is testing the wrong thing and must say so loudly.
  if (!isDefinedError(error)) {
    throw new Error("fixture is not a defined error");
  }
  return error;
}

function callQueryFn(): Promise<{
  authRequired: boolean;
  available: string[];
}> {
  const { queryFn } = modelCatalogQueryOptions("agent-1");
  if (!queryFn) {
    throw new Error("modelCatalogQueryOptions must define a queryFn");
  }
  return queryFn({
    queryKey: ["agents", "agent-1", "models"],
  } as unknown as Parameters<typeof queryFn>[0]) as Promise<{
    authRequired: boolean;
    available: string[];
  }>;
}

describe("modelCatalogQueryOptions error routing", () => {
  test("a defined AUTH_REQUIRED answer marks the catalog authRequired", async () => {
    models.mockImplementationOnce(() =>
      Promise.reject(definedError("AUTH_REQUIRED"))
    );
    const catalog = await callQueryFn();
    expect(catalog.authRequired).toBe(true);
  });

  test("a defined NOT_FOUND answer is an honest empty catalog, not sign-in", async () => {
    models.mockImplementationOnce(() =>
      Promise.reject(definedError("NOT_FOUND"))
    );
    const catalog = await callQueryFn();
    expect(catalog.authRequired).toBe(false);
    expect(catalog.available).toEqual([]);
  });

  test("a network failure re-throws so TanStack retries", async () => {
    models.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    await expect(callQueryFn()).rejects.toThrow("offline");
  });
});

describe("slashCommandsQueryOptions TASK-157 gate", () => {
  test("does not ask for a conversation the server has never created", () => {
    // A session id exists only after the first `chat.send`, so this request
    // could only ever be answered NOT_FOUND for a client-minted id.
    expect(slashCommandsQueryOptions("conv-fresh", false).enabled).toBe(false);
    expect(slashCommandsQueryOptions("conv-known", true).enabled).toBe(true);
  });

  test("a known conversation with no session yet still folds to an empty menu", async () => {
    slashCommands.mockImplementationOnce(() =>
      Promise.reject(definedError("NOT_FOUND"))
    );
    const { queryFn } = slashCommandsQueryOptions("conv-1", true);
    if (!queryFn) {
      throw new Error("slashCommandsQueryOptions must define a queryFn");
    }
    expect(
      await queryFn({ queryKey: ["chat", "slash", "conv-1"] } as never)
    ).toEqual([]);
  });
});
