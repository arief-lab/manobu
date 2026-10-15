import {
  ChatSessionProvider,
  useChatSession,
} from "@manobu/chat-session/provider";
import { createFileRoute } from "@tanstack/react-router";
import {
  ChatColumn,
  type ChatColumnHeaderProps,
} from "@/features/chat/chat-column";

/**
 * /learn/conversation/$sessionId · Teacher chat surface. Rides the shared
 * `ChatColumn` shell (oRPC WS chat engine + fetch-link procedures) exactly
 * like /ai and /exam/$examId: the same header slot, DB-backed transcript
 * hydration, slash menu, the CLI/model/mode picker trio, send/stop, and
 * older-history paging. `$sessionId` stays on the URL for routing
 * continuity; the engine's conversation is provider-owned (the shell reads
 * `meta.conversationId`, persisted by the provider). Switching the CLI keeps
 * the lesson history; New session starts fresh.
 *
 * data: local-state · the chat-session provider owns persistence.
 */
export const Route = createFileRoute("/learn/conversation/$sessionId")({
  component: () => (
    <ChatSessionProvider>
      <LearnConversation />
    </ChatSessionProvider>
  ),
});

function LearnChatHeader(_: ChatColumnHeaderProps) {
  const { sessionId } = Route.useParams();
  const { state: chat, meta } = useChatSession();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h1 className="font-medium text-sm">
        Conversation{" "}
        <span className="text-muted-foreground">({sessionId})</span>
      </h1>
      <p className="text-muted-foreground text-xs/relaxed">
        Sensei session · {meta.selectedAgentLabel}
        {chat.selectedModel ? ` · ${chat.selectedModel}` : " · agent default"}
      </p>
    </div>
  );
}

function LearnConversation() {
  return (
    <ChatColumn
      emptyDescription="Type below to start the lesson."
      emptyTitle="Sensei lesson"
      header={LearnChatHeader}
    />
  );
}
