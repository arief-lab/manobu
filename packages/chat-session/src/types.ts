import type { TMessage } from "./chat-engine";

/**
 * Conversation persistence — localStorage key for the current chat.
 * Survives app restarts (Tauri relaunch included). Agents/personas/models
 * ride along so a restored conversation is fully rehydrated.
 */
export interface PersistedChat {
  agent?: string;
  /**
   * TASK-82: the conversation identity. Persisted so a reload/remount
   * reconnects to the SAME server-side conversation (the engine's
   * connect-time history replay restores the transcript) instead of
   * forking a fresh one per mount. Cleared by `reset` (New Chat) —
   * explicit reset semantics preserved.
   */
  conversationId?: string;
  /**
   * TASK-66: the in-flight composer draft. / and /learn/* each mount
   * their own AppShell (route-tree siblings), so navigating between them
   * remounts the provider — without persisting the draft, the most
   * common navigation in the app silently ate what the user was typing.
   */
  input?: string;
  messages?: TMessage[];
  model?: string;
  persona?: string;
}
