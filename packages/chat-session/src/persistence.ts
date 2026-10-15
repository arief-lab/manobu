import type { PersistedChat } from "./types";

/**
 * localStorage key for the current chat.
 *
 * Versioned (`v1`) so a future schema change can leave old blobs behind and
 * start fresh without crashing the load.
 */
export const CHAT_STORAGE_KEY = "manobu:chat:v1";

export function loadPersistedChat(): PersistedChat {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as PersistedChat;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function persistChat(chat: PersistedChat): void {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chat));
  } catch {
    // storage full / private mode — persistence is best-effort
  }
}
