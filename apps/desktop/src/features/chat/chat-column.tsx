import type { TMessage } from "@manobu/chat-session/chat-engine";
import {
  agentCatalogQueryOptions,
  personaCatalogQueryOptions,
} from "@manobu/chat-session/fetcher";
import {
  cardsFromRows,
  mergeTranscript,
  messageHistoryQueryOptions,
  useOlderHistory,
} from "@manobu/chat-session/history";
import {
  type ChatSuggestion,
  MessageTranscript,
} from "@manobu/chat-session/message-transcript";
import { useChatSession } from "@manobu/chat-session/provider";
import {
  highlightRanges,
  initialSlashMenuState,
  menuOwnsKey,
  type SlashCommandItem,
  type SlashMenuState,
  selectedInsertText,
  slashMenuReducer,
} from "@manobu/chat-session/slash";
import { Button } from "@manobu/ui/components/button";
import { InputGroup } from "@manobu/ui/components/input-group";
import { t } from "@manobu/ui/lib/copy";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpIcon, RotateCwIcon, SquareIcon } from "lucide-react";
import {
  type ChangeEvent,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { AgentModelModePickers } from "./composer-pickers";

export interface ChatColumnHeaderProps {
  messages: readonly TMessage[];
}

export interface ChatColumnProps {
  composerBlockedMessage?: string | null;
  composerControls?: ReactNode;
  emptyDescription?: string;
  emptyTitle?: string;
  header: ComponentType<ChatColumnHeaderProps>;
  onOpenPaper?: (examId: string) => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onSuggestion?: (text: string) => void;
  suggestions?: readonly ChatSuggestion[];
}

function renderSlashName(item: SlashCommandItem, query: string): ReactNode {
  const ranges = highlightRanges(item, query);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) {
      parts.push(item.name.slice(cursor, start));
    }
    parts.push(
      <span className="font-semibold" key={`${start}-${end}`}>
        {item.name.slice(start, end)}
      </span>
    );
    cursor = end;
  }
  if (cursor < item.name.length) {
    parts.push(item.name.slice(cursor));
  }
  return <>/{parts}</>;
}

function SlashMenuRow({
  active,
  index,
  item,
  onAccept,
  query,
}: {
  active: boolean;
  index: number;
  item: SlashCommandItem;
  onAccept: (index: number) => void;
  query: string;
}) {
  const handleClick = useCallback(() => {
    onAccept(index);
  }, [index, onAccept]);
  const handleMouseDown = useCallback((event: MouseEvent) => {
    event.preventDefault();
  }, []);
  return (
    <button
      className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm ${active ? "bg-muted" : ""}`}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      type="button"
    >
      <span className="truncate">
        <span className="font-medium">{renderSlashName(item, query)}</span>
        {item.hint ? (
          <span className="ml-2 text-muted-foreground text-xs">
            {item.hint}
          </span>
        ) : null}
      </span>
      {active ? (
        <span className="shrink-0 text-muted-foreground text-xs">
          {item.description}
        </span>
      ) : null}
    </button>
  );
}

function SlashMenu({
  onAccept,
  state,
}: {
  onAccept: (index: number) => void;
  state: SlashMenuState;
}) {
  const rows = state.result.items;
  if (!state.open || rows.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label="Slash commands"
      className="absolute bottom-full z-10 mb-1 max-h-56 w-full overflow-auto rounded-card border border-border bg-popover p-1"
      data-testid="slash-menu"
    >
      {rows.map((item, index) => (
        <li key={item.name}>
          <SlashMenuRow
            active={index === state.activeIndex}
            index={index}
            item={item}
            onAccept={onAccept}
            query={state.result.query}
          />
        </li>
      ))}
    </ul>
  );
}

type ComposerActionState =
  | { kind: "send"; disabled: boolean }
  | { kind: "stop" };

function composerActionState({
  blockedMessage,
  input,
  isSending,
}: {
  blockedMessage: string | null | undefined;
  input: string;
  isSending: boolean;
}): ComposerActionState {
  if (isSending) {
    return { kind: "stop" };
  }
  return {
    disabled: Boolean(blockedMessage) || input.trim().length === 0,
    kind: "send",
  };
}

function SubmitOrStopButton({
  blockedMessage,
}: {
  blockedMessage: string | null | undefined;
}) {
  const { actions, state: chat } = useChatSession();
  const action = composerActionState({
    blockedMessage,
    input: chat.input,
    isSending: chat.isSending,
  });
  if (action.kind === "stop") {
    return (
      <InputGroup.Button
        aria-label="Stop generating"
        className="ml-auto"
        onClick={actions.stop}
        size="icon-sm"
        type="button"
        variant="outline"
      >
        <SquareIcon />
        <span className="sr-only">Stop</span>
      </InputGroup.Button>
    );
  }
  return (
    <InputGroup.Button
      aria-label="Send message"
      className="ml-auto"
      disabled={action.disabled}
      size="icon-sm"
      type="submit"
      variant="default"
    >
      <ArrowUpIcon />
      <span className="sr-only">Send</span>
    </InputGroup.Button>
  );
}

/**
 * The explicit "start over" control. Distinct from switching CLI, which keeps
 * the conversation: this clears the transcript AND mints a fresh
 * conversationId (`actions.reset`), so it is the only way a learner wipes the
 * chat. Disabled while a turn is running or the composer is blocked.
 */
function NewSessionButton({ disabled }: { disabled: boolean }) {
  const { actions } = useChatSession();
  return (
    <InputGroup.Button
      aria-label="New session"
      disabled={disabled}
      onClick={actions.reset}
      size="icon-sm"
      title="New session"
      type="button"
      variant="ghost"
    >
      <RotateCwIcon />
      <span className="sr-only">New session</span>
    </InputGroup.Button>
  );
}

export function ChatColumn({
  composerBlockedMessage,
  composerControls,
  emptyDescription = "What are we working on today?",
  emptyTitle = "Morning, manobu!",
  header: Header,
  onOpenPaper,
  onSubmit,
  onSuggestion,
  suggestions,
}: ChatColumnProps) {
  const { actions, meta, state: chat } = useChatSession();
  const agentsQuery = useQuery(agentCatalogQueryOptions);
  const personasQuery = useQuery(personaCatalogQueryOptions);
  const isOffline = agentsQuery.isError || personasQuery.isError;
  const { data: storedRows } = useQuery(
    messageHistoryQueryOptions({
      conversationId: meta.conversationId,
      known: meta.conversationKnown,
    })
  );
  const older = useOlderHistory(meta.conversationId, storedRows);
  const transcript = useMemo(
    () => mergeTranscript(cardsFromRows(older.rows), chat.messages),
    [chat.messages, older.rows]
  );
  const [menuState, dispatchMenu] = useReducer(
    slashMenuReducer,
    undefined,
    initialSlashMenuState
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerBlocked = Boolean(composerBlockedMessage);
  const submit = onSubmit ?? actions.onSubmit;

  const acceptSlash = useCallback(
    (index: number) => {
      const text = selectedInsertText(menuState.result.items, index);
      if (text === null) {
        return;
      }
      actions.setDraft(text);
      dispatchMenu({
        draft: text,
        index,
        items: meta.slashCommands,
        type: "select",
      });
      requestAnimationFrame(() => {
        const element = textareaRef.current;
        if (element === null) {
          return;
        }
        element.focus();
        const { value } = element;
        element.setSelectionRange(value.length, value.length);
      });
    },
    [actions, menuState, meta.slashCommands]
  );

  const handleSlashChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      actions.onInputChange(event);
      dispatchMenu({
        draft: event.target.value,
        items: meta.slashCommands,
        type: "input",
      });
    },
    [actions, meta.slashCommands]
  );

  const handleSlashKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!menuOwnsKey(menuState, event.key)) {
        actions.onPromptKeyDown(event);
        return;
      }
      event.preventDefault();
      const clamped = Math.max(
        0,
        Math.min(menuState.activeIndex, menuState.result.items.length - 1)
      );
      dispatchMenu({
        draft: chat.input,
        items: meta.slashCommands,
        key: event.key,
        type: "keydown",
      });
      if (event.key === "Enter" || event.key === "Tab") {
        acceptSlash(clamped);
      }
    },
    [acceptSlash, actions, chat.input, menuState, meta.slashCommands]
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      if (composerBlocked) {
        event.preventDefault();
        return;
      }
      submit(event);
    },
    [composerBlocked, submit]
  );

  return (
    <section aria-label="Chat" className="flex h-full min-h-0 w-full flex-col">
      <header className="shrink-0 border-b px-4 py-3">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6">
          <Header messages={transcript} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {isOffline ? (
          <div
            className="mx-auto w-full max-w-2xl px-6 pt-3"
            data-testid="ai-offline"
            role="status"
          >
            <p className="rounded-card border border-border bg-muted px-3 py-2 text-sm">
              {t("error.offline")}
            </p>
          </div>
        ) : null}
        {older.hasMore ? (
          <div className="flex shrink-0 justify-center pt-3">
            <Button
              disabled={older.loading}
              onClick={older.loadOlder}
              size="sm"
              type="button"
              variant="outline"
            >
              {older.loading ? "Loading…" : "Load older messages"}
            </Button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <MessageTranscript
            emptyDescription={emptyDescription}
            emptyTitle={emptyTitle}
            messages={transcript}
            onOpenPaper={onOpenPaper}
            onSuggestion={onSuggestion}
            suggestions={suggestions}
          />
        </div>
      </div>
      <footer className="shrink-0 border-t px-4 py-3">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-2">
          {composerBlocked ? (
            <p
              className="px-2 text-muted-foreground text-xs"
              data-testid="chat-composer-blocked"
              role="status"
            >
              {composerBlockedMessage}
            </p>
          ) : null}
          <div className="relative">
            {composerBlocked ? null : (
              <SlashMenu onAccept={acceptSlash} state={menuState} />
            )}
            <form className="w-full" onSubmit={handleSubmit}>
              <InputGroup>
                <legend className="sr-only">Message Sensei</legend>
                <InputGroup.Textarea
                  aria-describedby={
                    composerBlocked ? "chat-composer-blocked" : undefined
                  }
                  autoComplete="off"
                  autoFocus
                  className="max-h-32 min-h-14 p-3.5"
                  disabled={composerBlocked}
                  name="prompt"
                  onChange={handleSlashChange}
                  onKeyDown={handleSlashKeyDown}
                  placeholder="Type your message..."
                  ref={textareaRef}
                  rows={1}
                  value={chat.input}
                />
                <InputGroup.Addon align="block-end" className="pt-1">
                  <NewSessionButton
                    disabled={chat.isSending || composerBlocked}
                  />
                  <AgentModelModePickers />
                  {composerControls}
                  <SubmitOrStopButton blockedMessage={composerBlockedMessage} />
                </InputGroup.Addon>
              </InputGroup>
            </form>
          </div>
        </div>
      </footer>
    </section>
  );
}

export const __test__ = { composerActionState };
