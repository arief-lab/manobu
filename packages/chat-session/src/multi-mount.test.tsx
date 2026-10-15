/**
 * Multi-mount / no-Provider-drift test.
 *
 * The `f66cfa0` diff split `ChatSessionApi` into `{state, actions, meta}`
 * and added three slice hooks: `useChatSessionState()`,
 * `useChatSessionActions()`, `useChatSessionMeta()`. The contract from
 * `vercel-composition-patterns/state-context-interface` says each slice
 * is part of the same Provider — and two simultaneously-mounted
 * Providers do not share state.
 *
 * Today three surfaces (`/ai`, `/chat-history`, the AskSensei widget)
 * mount the Provider. Each widget instance owns its own Provider
 * state; closing/opening one widget must not affect another's
 * messages or selection. These tests pin that property so a future
 * refactor that accidentally lifts the Provider into a singleton
 * breaks the test.
 */

import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type ChatSessionActions,
  type ChatSessionApi,
  type ChatSessionMeta,
  ChatSessionProvider,
  type ChatSessionState,
  useChatSession,
  useChatSessionActions,
  useChatSessionMeta,
  useChatSessionState,
} from "./provider";

const testQueryClient = new QueryClient({
  defaultOptions: {
    mutations: { retry: 0 },
    queries: { retry: 0, staleTime: 0 },
  },
});

/** Typed capture slot populated during SSR render and asserted after. */
interface Slot<T> {
  value: T | null;
}

describe("two simultaneously-mounted <ChatSessionProvider>s do not share state (no Provider drift)", () => {
  test("useChatSession() returns two distinct context objects across siblings", () => {
    const slotA: Slot<ChatSessionApi> = { value: null };
    const slotB: Slot<ChatSessionApi> = { value: null };
    function ProbeA() {
      slotA.value = useChatSession();
      return null;
    }
    function ProbeB() {
      slotB.value = useChatSession();
      return null;
    }
    renderToStaticMarkup(
      <QueryClientProvider client={testQueryClient}>
        <div>
          <ChatSessionProvider>
            <ProbeA />
          </ChatSessionProvider>
          <ChatSessionProvider>
            <ProbeB />
          </ChatSessionProvider>
        </div>
      </QueryClientProvider>
    );
    // Both probes captured a Provider value
    expect(slotA.value).not.toBeNull();
    expect(slotB.value).not.toBeNull();
    // Neither shares state with the other — each Provider owns its
    // own context value object. No global singleton, no drift.
    expect(slotA.value).not.toBe(slotB.value);
  });

  test("each sub-slice (state / actions / meta) is also distinct between Providers", () => {
    const slotA: Slot<ChatSessionApi> = { value: null };
    const slotB: Slot<ChatSessionApi> = { value: null };
    function ProbeA() {
      slotA.value = useChatSession();
      return null;
    }
    function ProbeB() {
      slotB.value = useChatSession();
      return null;
    }
    renderToStaticMarkup(
      <QueryClientProvider client={testQueryClient}>
        <div>
          <ChatSessionProvider>
            <ProbeA />
          </ChatSessionProvider>
          <ChatSessionProvider>
            <ProbeB />
          </ChatSessionProvider>
        </div>
      </QueryClientProvider>
    );
    const a = slotA.value as ChatSessionApi;
    const b = slotB.value as ChatSessionApi;
    expect(a.state).not.toBe(b.state);
    expect(a.actions).not.toBe(b.actions);
    expect(a.meta).not.toBe(b.meta);
  });
});

describe("slice hooks return the exact slice from useChatSession()", () => {
  test("useChatSessionState() === useChatSession().state", () => {
    const fullSlot: Slot<ChatSessionApi> = { value: null };
    const stateSlot: Slot<ChatSessionState> = { value: null };
    function FullProbe() {
      fullSlot.value = useChatSession();
      return null;
    }
    function StateProbe() {
      stateSlot.value = useChatSessionState();
      return null;
    }
    renderToStaticMarkup(
      <QueryClientProvider client={testQueryClient}>
        <ChatSessionProvider>
          <FullProbe />
          <StateProbe />
        </ChatSessionProvider>
      </QueryClientProvider>
    );
    expect(stateSlot.value).toBe((fullSlot.value as ChatSessionApi).state);
  });

  test("useChatSessionActions() === useChatSession().actions", () => {
    const fullSlot: Slot<ChatSessionApi> = { value: null };
    const actionsSlot: Slot<ChatSessionActions> = { value: null };
    function FullProbe() {
      fullSlot.value = useChatSession();
      return null;
    }
    function ActionsProbe() {
      actionsSlot.value = useChatSessionActions();
      return null;
    }
    renderToStaticMarkup(
      <QueryClientProvider client={testQueryClient}>
        <ChatSessionProvider>
          <FullProbe />
          <ActionsProbe />
        </ChatSessionProvider>
      </QueryClientProvider>
    );
    expect(actionsSlot.value).toBe((fullSlot.value as ChatSessionApi).actions);
  });

  test("useChatSessionMeta() === useChatSession().meta", () => {
    const fullSlot: Slot<ChatSessionApi> = { value: null };
    const metaSlot: Slot<ChatSessionMeta> = { value: null };
    function FullProbe() {
      fullSlot.value = useChatSession();
      return null;
    }
    function MetaProbe() {
      metaSlot.value = useChatSessionMeta();
      return null;
    }
    renderToStaticMarkup(
      <QueryClientProvider client={testQueryClient}>
        <ChatSessionProvider>
          <FullProbe />
          <MetaProbe />
        </ChatSessionProvider>
      </QueryClientProvider>
    );
    expect(metaSlot.value).toBe((fullSlot.value as ChatSessionApi).meta);
  });

  test("all three slice hooks === the corresponding slice from the same Provider (one consumer)", () => {
    // One component reads all four hooks under the same Provider.
    // The three slice hooks must return the very same references
    // as the corresponding fields of `useChatSession()`. This is
    // the contract from `state-context-interface`: the slice hooks
    // are sugar over the full hook — they do not compute independently.
    interface AllCaptures {
      actions: ChatSessionActions;
      full: ChatSessionApi;
      meta: ChatSessionMeta;
      state: ChatSessionState;
    }
    const slot: Slot<AllCaptures> = { value: null };
    function Combined() {
      const full = useChatSession();
      const state = useChatSessionState();
      const actions = useChatSessionActions();
      const meta = useChatSessionMeta();
      slot.value = { actions, full, meta, state };
      return null;
    }
    renderToStaticMarkup(
      <QueryClientProvider client={testQueryClient}>
        <ChatSessionProvider>
          <Combined />
        </ChatSessionProvider>
      </QueryClientProvider>
    );
    const v = slot.value as AllCaptures;
    expect(v.state).toBe(v.full.state);
    expect(v.actions).toBe(v.full.actions);
    expect(v.meta).toBe(v.full.meta);
  });
});
