import { MessageTranscript } from "@manobu/chat-session/message-transcript";
import { useChatSession } from "@manobu/chat-session/provider";
import { Button } from "@manobu/ui/components/button";
import { InputGroup } from "@manobu/ui/components/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@manobu/ui/components/tooltip";
import { Loader2, MessageCircleIcon, SparklesIcon, XIcon } from "lucide-react";
import { AgentModelModePickers } from "@/features/chat/composer-pickers";

/**
 * Open state panel of the Ask Sensei widget (TASK-32.2). Lives in its
 * own module so the launcher shell can `React.lazy` this file: the
 * `@manobu/chat-session/message-transcript` import (and transitively
 * streamdown → parse5/micromark/shiki) only loads when the panel is
 * first opened. Reads only the slices the widget needs.
 */
export default function AskSenseiPanel({ onClose }: { onClose: () => void }) {
  // Third-surface proof: this widget destructures *only* the slices
  // it uses. /ai reads everything; /chat-history reads just state
  // + meta; the widget reads state + actions + a single meta field.
  // The Provider interface is partitioned correctly across three
  // distinct consumer shapes.
  const { state: chat, actions, meta } = useChatSession();

  return (
    <div className="fixed right-4 bottom-4 z-50 flex h-120 w-100 flex-col rounded-lg border border-border bg-background shadow-2xl">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircleIcon className="size-4 text-primary" />
          <h2 className="truncate font-medium text-sm">Ask Sensei</h2>
          <span className="text-[10px] text-muted-foreground">
            · {meta.selectedAgentLabel}
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Close Ask Sensei"
                onClick={onClose}
                size="icon-xs"
                type="button"
                variant="ghost"
              />
            }
          >
            <XIcon />
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </header>
      <main className="min-h-0 flex-1">
        <MessageTranscript
          emptyDescription="Type below to ask Anything · Sensei is online."
          emptyTitle="Ask Sensei"
        />
      </main>
      <footer className="shrink-0 border-t px-3 py-2">
        <form className="w-full" onSubmit={actions.onSubmit}>
          <InputGroup>
            <InputGroup.Textarea
              autoComplete="off"
              autoFocus
              className="max-h-24 min-h-10"
              disabled={chat.isSending}
              name="prompt"
              onChange={actions.onInputChange}
              onKeyDown={actions.onPromptKeyDown}
              placeholder="Ask Sensei..."
              rows={1}
              value={chat.input}
            />
            <InputGroup.Addon align="block-end" className="pt-1">
              <AgentModelModePickers />
              <InputGroup.Button
                aria-label="Send"
                className="ml-auto"
                disabled={chat.isSending || !chat.input.trim()}
                size="icon-sm"
                type="submit"
                variant="default"
              >
                {chat.isSending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <SparklesIcon />
                )}
              </InputGroup.Button>
            </InputGroup.Addon>
          </InputGroup>
        </form>
      </footer>
    </div>
  );
}
