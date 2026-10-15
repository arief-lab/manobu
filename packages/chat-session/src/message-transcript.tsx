/*
 * The chat-message list, shared between any route that mounts
 * `<ChatSessionProvider>` (the live chat and the read-only transcript
 * today). Reads its data straight from the Provider, so the same
 * instance renders identically in any surface — differences live in
 * the route itself (composer present or absent, picker trio present
 * or absent).
 *
 * TASK-80.3 cutover: the message list is now the engine's `TMessage[]`
 * card list (one card per durable frame type). Each card renders
 * directly — no nested `parts` array (the AI SDK's UIMessage model is
 * gone). Card dispatch:
 * - `user_created` → user bubble
 * - `text` → `TextPart` (Streamdown markdown)
 * - `thinking` → `AcpThinkingPart` (collapsed-by-default strip, TASK-87)
 * - `acp_tool_call` → `AcpToolCallPart` (the AionUi tool-call card)
 * - `acp_permission` → `AcpPermissionPart` (the permission card)
 * - `ask` → `AcpAskPart` (the ask_user card, inline in the transcript)
 * - `acp_terminal_output` → `AcpTerminalPart` (the hosted-terminal card)
 * - `error` → error bubble
 * - `plan` → plan checklist card
 */

import { Button } from "@manobu/ui/components/button";
import { Empty } from "@manobu/ui/components/empty";
import { MessageScroller } from "@manobu/ui/components/message-scroller";
import { Loader2, MessageCircleDashedIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { CHAT_CARD_MEASURE as chatCardMeasure } from "./chat-card-measure";
import { answeredTurnMsgIds, ChatCardRow } from "./chat-card-switch";
import type { TMessage } from "./chat-engine";
import { useChatSession } from "./provider";
import { SendNotice } from "./send-notice";

export interface ChatSuggestion {
  label: string;
  prompt: string;
}

/** One starter chip; the handler is a stable useCallback (noJsxPropsBind). */
function SuggestionChip({
  label,
  onSend,
  prompt,
}: {
  label: string;
  onSend: (text: string) => void;
  prompt: string;
}) {
  const onClick = useCallback(() => {
    onSend(prompt);
  }, [onSend, prompt]);
  return (
    <Button
      data-testid={`chat-suggestion-${label.slice(0, 12)}`}
      onClick={onClick}
      size="sm"
      type="button"
      variant="outline"
    >
      {label}
    </Button>
  );
}

/**
 * TASK-79.1 (chatbot-template port): the transcript takes an optional
 * `suggestions` list rendered as outline chips in the empty state
 * (template's Suggestions row). The starter CONTENT is call-site
 * composition (chat-session AGENTS.md: no route-shaped UI in here),
 * so `/ai` passes Japanese-learning prompts and the read-only
 * `/dev/chat-history` viewer passes nothing.
 */
export function MessageTranscript({
  emptyTitle,
  emptyDescription,
  messages: messagesOverride,
  onOpenPaper,
  onSuggestion,
  suggestions,
}: {
  emptyDescription?: string;
  emptyTitle?: string;
  /**
   * TASK-101: render THIS card list instead of the Provider's. The read-only
   * `/dev/chat-history` viewer uses it to show a database transcript (the
   * persisted rows folded through the same reducer), which the engine's
   * live card list is not.
   */
  messages?: TMessage[];
  onOpenPaper?: (examId: string) => void;
  onSuggestion?: (text: string) => void;
  suggestions?: readonly ChatSuggestion[];
}) {
  const { actions, meta: chatMeta, state: chat } = useChatSession();
  const { isSending, status } = chat;
  const messages = messagesOverride ?? chat.messages;
  // TASK-103: the context-usage card is a durable reading the header renders
  // as a chip, not a transcript bubble. Drop it here so the list stays the
  // conversation, and so a conversation whose ONLY card is usage still shows
  // the empty state rather than a blank scroller.
  const bubbleMessages = messages.filter(
    (card) => card.type !== "acp_context_usage"
  );
  // TASK-87: a turn whose text card has arrived renders its thinking
  // card collapsed (the answer landed, the reasoning is history).
  const answeredMsgIds = useMemo(
    () => answeredTurnMsgIds(messages),
    [messages]
  );

  if (bubbleMessages.length === 0 && !isSending) {
    // Template empty state: vertically centered Empty with the starter
    // chips inside Empty.Content (not top-pinned like the old bare Empty).
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty className={`w-full ${chatCardMeasure}`}>
          <Empty.Header>
            <Empty.Media variant="icon">
              <MessageCircleDashedIcon />
            </Empty.Media>
            <Empty.Title>{emptyTitle ?? "No messages yet"}</Empty.Title>
            <Empty.Description>
              {emptyDescription ??
                "Start a conversation in the AI Chat view to see your transcript here."}
            </Empty.Description>
          </Empty.Header>
          {suggestions && suggestions.length > 0 && (
            <Empty.Content>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestions.map((suggestion) => (
                  <SuggestionChip
                    key={suggestion.label}
                    label={suggestion.label}
                    onSend={onSuggestion ?? actions.send}
                    prompt={suggestion.prompt}
                  />
                ))}
              </div>
            </Empty.Content>
          )}
        </Empty>
      </div>
    );
  }

  // TASK-57: the Provider lives HERE, not in the consumers — panel.tsx
  // (TASK-32.2) and dev.chat-history.tsx rendered the transcript bare and
  // the scroll hook threw into the error boundary. Self-contained
  // transcript = no second convention for the next consumer to miss.
  //
  // The notice is a SIBLING of the scroller, so the column has to be
  // explicit: the scroller is `size-full`, and without `flex-1 min-h-0` on
  // it plus a definite-height wrapper here, the notice line would push the
  // list past the bottom of `<main>` instead of shortening it.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MessageScroller.Provider>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScroller.Viewport>
            {/* TASK-79.1: template column rhythm - max-w-2xl + px-6
              (was max-w-3xl px-4); gap-6 is the scroller default. */}
            <MessageScroller.Content
              aria-busy={isSending}
              className={`mx-auto w-full ${chatCardMeasure} px-6 py-6`}
            >
              {/* Card dispatch lives in chat-card-switch.tsx (TASK-81.5):
              one documented site per the use-chat-engine/transcript DOX. */}
              {bubbleMessages.map((card) => (
                <ChatCardRow
                  answered={answeredMsgIds.has(card.msg_id)}
                  card={card}
                  isStreaming={status === "streaming"}
                  key={card.id}
                  onOpenPaper={onOpenPaper}
                  readOnly={chatMeta.readOnly}
                />
              ))}
              {status === "submitted" && (
                // TASK-79.1: the template's thinking line is a bare muted
                // row, not a bubble - the bubble implied content that
                // isn't there yet.
                <MessageScroller.Item>
                  <div className="flex items-center gap-2 px-1.5 text-muted-foreground text-sm">
                    <Loader2 className="size-3.5 animate-spin" />
                    <span className="shimmer">Thinking…</span>
                  </div>
                </MessageScroller.Item>
              )}
              <MessageScroller.Item scrollAnchor />
            </MessageScroller.Content>
          </MessageScroller.Viewport>
          <MessageScroller.Button />
        </MessageScroller>
      </MessageScroller.Provider>
      {/* TASK-100: a refused send keeps its text in the composer, and this
          is where the learner learns why. Mounted here rather than in each
          footer so no surface can ship the draft without the reason. */}
      <SendNotice />
    </div>
  );
}
