/*
 * The conversation history desk (TASK-101).
 *
 * Before this surface existed, the only handle on a past chat was the
 * localStorage blob, which holds ONE conversation: opening or starting
 * another made every earlier chat unreachable (and undeleteable). This desk
 * reads the server's list instead, so a chat stays reachable and removable
 * after the composer has moved on.
 *
 * Data path: `chat.listConversations` (keyset-paged, most recent turn first)
 * through the package's `queryOptions`, mutations through
 * `chat.renameConversation` / `chat.deleteConversation`. Nothing here reads
 * the blob.
 */

import {
  type ConversationSummary,
  conversationHistoryQueryKey,
  conversationHistoryQueryOptions,
  storedStampToEpochMs,
} from "@manobu/chat-session/history";
import { Button } from "@manobu/ui/components/button";
import { Empty } from "@manobu/ui/components/empty";
import { Input } from "@manobu/ui/components/input";
import { Skeleton } from "@manobu/ui/components/skeleton";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { HistoryIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { type ChangeEvent, type FormEvent, useCallback, useState } from "react";
import { chatTitle } from "@/lib/chat-title";
import { orpc } from "@/lib/orpc";

/**
 * The alert line under a row. Rename and delete failures say different
 * things, and a delete refused because the turn is still running must not
 * tell the learner to cancel it HERE (this desk has no Stop control) - it
 * points at the row's own Open action, whose composer carries Stop.
 */
function failureCopy({
  deleteCode,
  renameFailed,
  removeFailed,
}: {
  deleteCode: string | undefined;
  renameFailed: boolean;
  removeFailed: boolean;
}): string {
  if (renameFailed) {
    return "Could not save that name. Try again.";
  }
  if (removeFailed) {
    return deleteCode === "CONVERSATION_BUSY"
      ? "This chat is still answering. Open it to stop the turn, then delete it."
      : "Could not delete that chat. Try again.";
  }
  return "";
}

/**
 * Human recency for a row. The stored stamp can be ISO or the legacy
 * `datetime('now')` text, so it goes through the same UTC-aware parse the
 * transcript fold uses (`storedStampToEpochMs`) rather than a bare
 * `Date.parse` that would read the old shape as local time.
 */
function formatRecency(stamp: string): string {
  const ms = storedStampToEpochMs(stamp);
  if (ms === undefined) {
    return "unknown date";
  }
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days} d ago`;
  }
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ms));
}

function RenameForm({
  busy,
  draft,
  onCancel,
  onChange,
  onSubmit,
}: {
  busy: boolean;
  draft: string;
  onCancel: () => void;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="flex items-center gap-2" onSubmit={onSubmit}>
      <Input
        aria-label="Conversation name"
        className="h-8 min-w-0 flex-1"
        maxLength={120}
        onChange={onChange}
        value={draft}
      />
      <Button
        disabled={busy || draft.trim().length === 0}
        size="sm"
        type="submit"
      >
        Save
      </Button>
      <Button
        aria-label="Cancel rename"
        onClick={onCancel}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <XIcon />
      </Button>
    </form>
  );
}

function RowIdentity({
  conversation,
  onOpen,
}: {
  conversation: ConversationSummary;
  onOpen: () => void;
}) {
  return (
    <>
      <button
        className="block max-w-full truncate text-left font-medium text-sm hover:underline"
        onClick={onOpen}
        type="button"
      >
        {chatTitle(conversation)}
      </button>
      <p className="mt-0.5 text-muted-foreground text-xs">
        {formatRecency(conversation.updatedAt)}
        {" · "}
        {conversation.messageCount}{" "}
        {conversation.messageCount === 1 ? "message" : "messages"}
        {conversation.agent ? ` · ${conversation.agent}` : ""}
      </p>
    </>
  );
}

function RowActions({
  armed,
  busy,
  onDeleteClick,
  onOpen,
  onStartRename,
}: {
  armed: boolean;
  busy: boolean;
  onDeleteClick: () => void;
  onOpen: () => void;
  onStartRename: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button onClick={onOpen} size="sm" type="button" variant="outline">
        Open
      </Button>
      <Button
        aria-label="Rename conversation"
        disabled={busy}
        onClick={onStartRename}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <PencilIcon />
      </Button>
      <Button
        aria-label={armed ? "Confirm delete" : "Delete conversation"}
        disabled={busy}
        onClick={onDeleteClick}
        size="sm"
        type="button"
        variant={armed ? "destructive" : "ghost"}
      >
        {armed ? (
          <>
            <Trash2Icon />
            Confirm
          </>
        ) : (
          <Trash2Icon />
        )}
      </Button>
    </div>
  );
}

function FailureNotice({
  deleteCode,
  removeFailed,
  renameFailed,
}: {
  deleteCode: string | undefined;
  removeFailed: boolean;
  renameFailed: boolean;
}) {
  return (
    <p className="mt-1.5 text-destructive text-xs" role="alert">
      {failureCopy({ deleteCode, removeFailed, renameFailed })}
    </p>
  );
}

/**
 * One history row: the identity a chat was stored under, plus its three
 * actions. Open navigates to `/ai?c=<id>` (the provider resumes that
 * conversation and the server replays its transcript). Rename is an inline
 * input, delete a two-step confirm; the repo ships no dialog primitive, so
 * the confirmation is the button changing state instead.
 */
function HistoryRow({ conversation }: { conversation: ConversationSummary }) {
  const [draft, setDraft] = useState(conversation.title ?? "");
  const [armed, setArmed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const rename = useMutation({
    mutationFn: (title: string) =>
      orpc.chat.renameConversation({
        conversationId: conversation.id,
        title,
      }),
    onSuccess: async () => {
      setRenaming(false);
      // The server is the list's source, so a rename refreshes the page
      // rather than patching the row in place.
      await queryClient.invalidateQueries({
        queryKey: conversationHistoryQueryKey,
      });
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      orpc.chat.deleteConversation({ conversationId: conversation.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: conversationHistoryQueryKey,
      });
    },
  });

  const onOpen = useCallback(() => {
    navigate({ search: { c: conversation.id }, to: "/ai" });
  }, [conversation.id, navigate]);
  const onCancelRename = useCallback(() => {
    setDraft(conversation.title ?? "");
    rename.reset();
    setRenaming(false);
  }, [conversation.title, rename]);
  const onRenameSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const title = draft.trim();
      // An empty or unchanged name is a no-op, not a server round trip: the
      // contract rejects a blank title, and the untitled state is the label
      // the row already shows.
      if (title.length === 0 || title === (conversation.title ?? "")) {
        setRenaming(false);
        return;
      }
      rename.mutate(title);
    },
    [conversation.title, draft, rename]
  );
  const onStartRename = useCallback(() => {
    remove.reset();
    setArmed(false);
    setRenaming(true);
  }, [remove]);
  // Two-step delete: the first click only arms the row, the second removes
  // it. Arming resets while the other action is in flight so a row cannot
  // be renamed and deleted at once.
  const onDeleteClick = useCallback(() => {
    if (!armed) {
      rename.reset();
      setArmed(true);
      return;
    }
    remove.mutate();
  }, [armed, rename, remove]);
  const onDraftChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
  }, []);

  const failed = rename.isError || remove.isError;
  const busy = rename.isPending || remove.isPending;
  const deleteCode = (remove.error as { code?: string } | null)?.code;

  return (
    <li className="rounded-card border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {renaming ? (
            <RenameForm
              busy={busy}
              draft={draft}
              onCancel={onCancelRename}
              onChange={onDraftChange}
              onSubmit={onRenameSubmit}
            />
          ) : (
            <RowIdentity conversation={conversation} onOpen={onOpen} />
          )}
        </div>
        {renaming ? null : (
          <RowActions
            armed={armed}
            busy={busy}
            onDeleteClick={onDeleteClick}
            onOpen={onOpen}
            onStartRename={onStartRename}
          />
        )}
      </div>
      {failed ? (
        <FailureNotice
          deleteCode={deleteCode}
          removeFailed={remove.isError}
          renameFailed={rename.isError}
        />
      ) : null}
    </li>
  );
}

function HistorySkeleton() {
  return (
    <div className="mt-5 flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <Skeleton className="h-14 w-full" key={i} />
      ))}
    </div>
  );
}

function HistoryErrorNotice() {
  return (
    <p className="mt-5 text-destructive text-sm" role="alert">
      The server did not answer, so there is no list to show.
    </p>
  );
}

function HistoryEmpty() {
  return (
    <Empty className="mt-10">
      <Empty.Header>
        <Empty.Title>No conversations yet</Empty.Title>
        <Empty.Description>
          Chats you start appear here, so you can come back to them later.
        </Empty.Description>
      </Empty.Header>
    </Empty>
  );
}

function HistoryList({
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  rows,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  rows: ConversationSummary[];
}) {
  return (
    <>
      <ul className="mt-5 flex flex-col gap-2">
        {rows.map((conversation) => (
          <HistoryRow conversation={conversation} key={conversation.id} />
        ))}
      </ul>
      {hasNextPage ? (
        <Button
          className="mt-4 w-full"
          disabled={isFetchingNextPage}
          onClick={onLoadMore}
          variant="outline"
        >
          {isFetchingNextPage ? "Loading…" : "Load older chats"}
        </Button>
      ) : null}
    </>
  );
}

/**
 * The desk itself: header, the paged list, and the older-pages control.
 * The route owns the chrome-free bar convention, so this is the content.
 */
export function HistoryDesk() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isError,
    isLoading,
  } = useInfiniteQuery(conversationHistoryQueryOptions());
  const rows = data?.pages.flatMap((page) => page.conversations) ?? [];
  const onLoadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-6">
      <h1 className="flex items-center gap-2 font-medium text-sm">
        <HistoryIcon />
        Chat history
      </h1>
      <p className="mt-1 text-muted-foreground text-xs/relaxed">
        Every conversation the sidecar has stored, newest activity first.
        Opening one continues it on the agent it started with.
      </p>

      {isLoading ? <HistorySkeleton /> : null}

      {isError ? <HistoryErrorNotice /> : null}

      {!(isLoading || isError) && rows.length === 0 ? <HistoryEmpty /> : null}

      {rows.length > 0 ? (
        <HistoryList
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={onLoadMore}
          rows={rows}
        />
      ) : null}
    </div>
  );
}
