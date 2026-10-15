/*
 * Cold-boot backend announce (shell → webview).
 *
 * The window mounts before the sidecar binds: `src-tauri/src/lib.rs` polls
 * readiness off the main thread so window creation is not blocked, and the
 * sidecar runs its DB migrations before it listens, so the port can stay
 * closed for ~15s. Every RPC the first paint fires fails with connection
 * refused in that window. `lib/sensei.ts` sets `retry: false` on purpose (a
 * dead sidecar is the expected offline-laptop state, not a transient
 * failure), so nothing re-asks and the setup rail sits at "backend
 * unreachable" after the backend came up.
 *
 * The shell is the one that knows when the backend came up, so it says so:
 * this subscribes to that announcement and invalidates the probe. Outside
 * Tauri there is no shell and no event, so the web-dev path is a no-op.
 */

import type { QueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";

import { SENSEI_STATUS_QUERY_KEY } from "./sensei";

/** Mirrors `SIDECAR_READY_EVENT` in `apps/desktop/src-tauri/src/lib.rs`. */
export const SIDECAR_READY_EVENT = "sidecar:ready";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI__" in window;

// Hoisted so the `listen` callback itself creates no promise chain: biome
// reads a chain inside a chained handler as nested promises.
const invalidateProbe = (client: QueryClient): void => {
  client
    .invalidateQueries({ queryKey: SENSEI_STATUS_QUERY_KEY })
    .catch(() => undefined);
};

/**
 * Re-probe the backend when the shell reports it bound. Returns an
 * unsubscribe for the caller's effect cleanup; the listener can resolve
 * after the caller has already unmounted (dev HMR double-mount), so the
 * pending handle is tracked rather than assumed.
 */
export function watchSidecarReady(client: QueryClient): () => void {
  if (!isTauri()) {
    return () => undefined;
  }
  let unlisten: (() => void) | null = null;
  let stopped = false;
  listen(SIDECAR_READY_EVENT, () => invalidateProbe(client))
    .then((fn) => {
      if (stopped) {
        fn();
      } else {
        unlisten = fn;
      }
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    unlisten?.();
  };
}
