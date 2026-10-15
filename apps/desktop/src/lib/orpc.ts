/*
 * Typed oRPC client re-export (TASK-80.8 AC#9). The ONE place that knows
 * the sidecar's URL is `@manobu/chat-session/orpc` (`createFetchRpcClient`);
 * this module re-exports its client so the non-chat desktop consumers
 * (kanji, sensei, next-cards, lesson-cards, mock) share the chat
 * surface's link instead of a byte-identical duplicate.
 */
// biome-ignore lint/performance/noBarrelFile: deliberate single-symbol re-export - this is the desktop-side facade that keeps the 8 non-chat importers pointed at @manobu/chat-session/orpc without importing the chat package everywhere (TASK-80.8 AC#9).
export { orpc } from "@manobu/chat-session/orpc";
