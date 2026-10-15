/**
 * The one SSR test environment for chat-session component specs.
 *
 * Bun's test env has no DOM and no localStorage; the specs render through
 * `react-dom/server.renderToStaticMarkup`, so each file installs the stub
 * before seeding `CHAT_STORAGE_KEY`. Three files carried byte-identical
 * copies (TASK-148 fallow clone), which is why the install lives here.
 */

import { QueryClient } from "@tanstack/react-query";

/** Installs a Map-backed localStorage stub and returns the backing store
 * so a spec can seed keys before rendering. */
export function installLocalStorageStub(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  return store;
}

/** A no-retry QueryClient for SSR specs (staleTime 0 is the library
 * default and is set explicitly so every spec starts from one shape). */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: 0 },
      queries: { retry: 0, staleTime: 0 },
    },
  });
}
