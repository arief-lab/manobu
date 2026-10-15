import { describe, expect, it, mock } from "bun:test";

import { QueryClient } from "@tanstack/react-query";

/**
 * Cold-boot backend announce (`lib/sidecar-ready.ts`).
 *
 * The window mounts while the sidecar is still migrating, so the status
 * probe can fail against a closed port and `retry: false` means nothing
 * re-asks. The shell's readiness poll is the only party that knows when the
 * port actually opened, so the probe is re-run from that announcement.
 *
 * Mirrors exam-voice-first-run.test.ts: module-mock `@tauri-apps/api/event`
 * and toggle `__TAURI__` on globalThis, then assert against a REAL
 * QueryClient rather than a spy, so the claim is "the cached probe went
 * stale", not "a method with that name was called".
 */

const setTauri = (on: boolean): void => {
  // `sidecar-ready` gates on `"__TAURI__" in window` (the same check as
  // `lib/tts-init.ts`). bun test runs without a DOM, so alias window to
  // globalThis and toggle the key there.
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.window === undefined) {
    g.window = g;
  }
  if (on) {
    g.__TAURI__ = {};
  } else {
    Reflect.deleteProperty(g, "__TAURI__");
  }
};

type EventHandler = (event: unknown) => void;

const state: {
  fired: EventHandler | null;
  name: string;
  unsubscribed: number;
} = {
  fired: null,
  name: "",
  unsubscribed: 0,
};

// Both reads and resets of `state` go through a function: TypeScript narrows a
// property to the literal last assigned to it in the current block, so an
// inline `state.fired = null` (or an `expect(...).toBeNull()`) types the
// handler the mock recorded out of existence for the rest of the test.
const reset = (): void => {
  state.name = "";
  state.fired = null;
  state.unsubscribed = 0;
};

const recordedHandler = (): EventHandler => {
  if (state.fired === null) {
    throw new Error("the readiness watcher registered no listener");
  }
  return state.fired;
};

mock.module("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: EventHandler): Promise<() => void> => {
    state.name = name;
    state.fired = handler;
    return Promise.resolve(() => {
      state.unsubscribed += 1;
      state.fired = null;
    });
  },
}));

// Import after the mocks so the module binds the mocked `listen`.
const { SIDECAR_READY_EVENT, watchSidecarReady } = await import(
  "@/lib/sidecar-ready"
);
const { SENSEI_STATUS_QUERY_KEY } = await import("@/lib/sensei");

const settle = async (): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const clientWithProbeCache = (): QueryClient => {
  const client = new QueryClient();
  client.setQueryData(SENSEI_STATUS_QUERY_KEY, { agents: [] });
  return client;
};

describe("sidecar readiness announce (cold-boot backend unreachable)", () => {
  it("does nothing outside Tauri: no web-dev listener on a missing shell", async () => {
    setTauri(false);
    reset();
    const client = clientWithProbeCache();

    const unwatch = watchSidecarReady(client);
    await settle();
    unwatch();

    expect(state.name).toBe("");
    expect(state.fired).toBeNull();
    expect(client.getQueryState(SENSEI_STATUS_QUERY_KEY)?.isInvalidated).toBe(
      false
    );
  });

  it("invalidates the status probe when the shell reports the port open", async () => {
    setTauri(true);
    reset();
    const client = clientWithProbeCache();

    const unwatch = watchSidecarReady(client);
    await settle();

    expect(state.name).toBe(SIDECAR_READY_EVENT);
    const handler = recordedHandler();
    expect(client.getQueryState(SENSEI_STATUS_QUERY_KEY)?.isInvalidated).toBe(
      false
    );

    handler({ payload: null });
    await settle();

    expect(client.getQueryState(SENSEI_STATUS_QUERY_KEY)?.isInvalidated).toBe(
      true
    );
    unwatch();
    setTauri(false);
  });

  it("unsubscribes a listener that resolves after the caller left", async () => {
    setTauri(true);
    reset();
    const client = clientWithProbeCache();

    // Cleanup runs BEFORE the `listen` promise settles (dev HMR
    // double-mount), so the late handle must be released, not leaked.
    watchSidecarReady(client)();
    await settle();

    expect(state.unsubscribed).toBe(1);
    expect(state.fired).toBeNull();
    setTauri(false);
  });
});
