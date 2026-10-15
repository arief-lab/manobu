import { CHAT_CARD_MEASURE } from "./chat-card-measure";
import type { NoticeTone } from "./chat-session-contract";
import { useChatSessionState } from "./provider";

/**
 * Why the composer still holds what the learner pressed Enter on (TASK-100):
 * a send the engine refused must say so where the text is.
 *
 * The lane is also the local-degradation escape hatch, and `/ai` reports a
 * ready paper, a dry level and an offer receipt through it, so the colour is
 * chosen by the notice's tone rather than hardcoded to the error red. The map
 * is a pure lookup so the "a success is not painted as a failure" rule is
 * testable without a DOM (this workspace has no DOM env).
 *
 * Internal module, no subpath: the surfaces do not place it.
 * `<MessageTranscript>` mounts it, because every chat footer already mounts
 * the transcript, so the reason always appears beside the draft that
 * survived and one more route cannot ship without it. Nothing renders
 * unless a notice was actually set.
 */
export const noticeToneClass: Record<NoticeTone, string> = {
  error: "text-destructive",
  info: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
};

export function SendNotice() {
  const { sendNotice } = useChatSessionState();
  if (sendNotice === null) {
    return null;
  }
  return (
    <p
      aria-live="polite"
      className={`mx-auto w-full ${CHAT_CARD_MEASURE} px-6 ${noticeToneClass[sendNotice.tone]} text-xs/relaxed`}
    >
      {sendNotice.text}
    </p>
  );
}
