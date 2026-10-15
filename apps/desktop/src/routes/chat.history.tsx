import { conversationHistoryQueryOptions } from "@manobu/chat-session/history";
import { createFileRoute, Link } from "@tanstack/react-router";

import { HistoryDesk } from "@/features/chat-history/history-desk";

/**
 * The conversation history route (TASK-101). A loader-warm first page so the
 * list paints with the shell instead of after a client round trip; the desk
 * itself owns the `useInfiniteQuery` for the older pages.
 */
export const Route = createFileRoute("/chat/history")({
  component: RouteComponent,
  errorComponent: HistoryError,
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureInfiniteQueryData(conversationHistoryQueryOptions()),
});

function HistoryError({ error }: { error: Error }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-6 py-8">
      <p className="text-destructive text-sm">
        Failed to load chat history: {error.message}
      </p>
      <Link
        className="inline-flex min-h-11 items-center rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
        to="/ai"
      >
        ← Back to chat
      </Link>
    </div>
  );
}

function RouteComponent() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="shrink-0 border-b px-4 py-3">
        <div className="mx-auto w-full max-w-2xl px-6">
          {/* Same chrome-free family as /ai (CHROME_FREE_PATHS): the desk
              bar is the way out, and it leads back to the chat rather than
              the dashboard because this surface only makes sense next to
              one. */}
          <Link
            className="inline-flex min-h-11 items-center rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
            data-testid="history-back-ai"
            to="/ai"
          >
            ← chat
          </Link>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <HistoryDesk />
      </main>
    </div>
  );
}
