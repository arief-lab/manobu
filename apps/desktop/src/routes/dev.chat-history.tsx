import {
  cardsFromRows,
  messageHistoryQueryOptions,
} from "@manobu/chat-session/history";
import { MessageTranscript } from "@manobu/chat-session/message-transcript";
import {
  ChatSessionProvider,
  useChatSession,
} from "@manobu/chat-session/provider";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

// data: local-state · the identity line still comes from the provider
// (agent / persona / model labels), which is a synchronous read. The
// transcript below is NOT local state: TASK-101 moved it to
// `chat.listMessages`, so this viewer shows what the database holds rather
// than whatever the current tab's localStorage blob happens to contain.
// TASK-30: moved to /dev/chat-history · debug/admin route.
export const Route = createFileRoute("/dev/chat-history")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    /* TASK-58: debug viewer · readOnly keeps it out of the shared
       persistence write race (all writable surfaces share one blob). */
    <ChatSessionProvider readOnly>
      <ChatHistory />
    </ChatSessionProvider>
  );
}

function ChatHistory() {
  const { meta, state: chat } = useChatSession();
  const { data, isError, isLoading } = useQuery(
    messageHistoryQueryOptions({
      conversationId: meta.conversationId,
      known: meta.conversationKnown,
    })
  );
  const cards = cardsFromRows(data ?? []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="shrink-0 border-b px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="font-medium text-sm">Chat History</h1>
          <p className="text-muted-foreground text-xs/relaxed">
            Read-only transcript, replayed from the database.
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {meta.selectedPersonaLabel}
            {" · "}
            {meta.selectedAgentLabel}
            {chat.selectedModel
              ? ` · ${chat.selectedModel}`
              : " · agent default"}
          </p>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        {isLoading ? (
          <p className="px-6 py-6 text-muted-foreground text-sm">Loading…</p>
        ) : null}
        {isError ? (
          <p className="px-6 py-6 text-destructive text-sm" role="alert">
            The server did not answer, so there is no transcript to show.
          </p>
        ) : null}
        {!(isLoading || isError) && (
          <MessageTranscript
            emptyDescription="No stored rows for this conversation yet · head to /ai to start one."
            messages={cards}
          />
        )}
      </main>
    </div>
  );
}
