/**
 * Card dispatch (TASK-81.5): the single documented site that maps one
 * engine `TMessage` card onto its renderer (see use-chat-engine/transcript
 * DOX). Table-driven over the card `type` discriminant — one renderer row
 * per card family, unknown types fall through to `null` (defensive, same
 * as the inline arrow it replaced). The runtime guards (`isTextCard` etc.)
 * remain the authority for union narrowing; the table keys on `type` and
 * each renderer re-asserts its own guard, keeping CC per function tiny.
 */

import { Bubble } from "@manobu/ui/components/bubble";
import { Message } from "@manobu/ui/components/message";
import { MessageScroller } from "@manobu/ui/components/message-scroller";
import type { ReactNode } from "react";

import {
  isAskCard,
  isDrillItemCard,
  isPaperCard,
  isPermissionCard,
  isPlanCard,
  isRetryNoticeCard,
  isTerminalCard,
  isTextCard,
  isThinkingCard,
  isToolCard,
  isUserCard,
} from "./chat-engine";
import type { TMessage } from "./chat-engine/types";
import { AcpAskPart } from "./parts/acp-ask-part";
import { AcpPermissionPart } from "./parts/acp-permission-part";
import { AcpTerminalPart } from "./parts/acp-terminal-part";
import { AcpThinkingPart } from "./parts/acp-thinking-part";
import { AcpToolCallPart } from "./parts/acp-tool-call-part";
import { DrillItemPart } from "./parts/drill-item-part";
import { PaperPart } from "./parts/paper-part";
import { TextPart } from "./parts/text-part";

/** Header + secondary bubble wrapper shared by every assistant card.
 * `stretch` renders the card as full-width block content in a decoration-
 * free ghost bubble instead of a fit-content speech bubble. The Card-based
 * families need this: `Card` carries `[container-type:inline-size]` (its
 * card_header container query), and inline-size containment makes an
 * element contribute 0 to a fit-content parent, so a `w-full` Card inside
 * a `w-fit` Bubble collapses to 0 width (TASK-90). A definite (stretched)
 * parent width removes the dependency on intrinsic sizing entirely. */
function AssistantBubble({
  children,
  stretch = false,
}: {
  children: ReactNode;
  stretch?: boolean;
}) {
  return (
    <Message align="start">
      <Message.Content>
        <Message.Header>AI Assistant</Message.Header>
        <Bubble
          align="start"
          className={stretch ? "w-full items-stretch" : undefined}
          variant={stretch ? "ghost" : "secondary"}
        >
          <Bubble.Content className={stretch ? "w-full" : undefined}>
            {children}
          </Bubble.Content>
        </Bubble>
      </Message.Content>
    </Message>
  );
}

/** User bubble (align end, default variant, "You" header). */
function UserBubble({ text }: { text: string }) {
  return (
    <Message align="end">
      <Message.Content>
        <Message.Header>You</Message.Header>
        <Bubble align="end" variant="default">
          <Bubble.Content>{text}</Bubble.Content>
        </Bubble>
      </Message.Content>
    </Message>
  );
}

/** Error bubble (destructive variant, no header). A discriminated code
 * (TASK-102) gets a short heading so a sign-in prompt and a rejected config
 * switch read differently from a generic failure, not just via body text. */
const ERROR_HEADINGS: Record<string, string> = {
  AUTH_REQUIRED: "Sign-in required",
  CONFIG_SWITCH_FAILED: "Model/mode switch rejected",
};

function ErrorBubble({
  code,
  text,
}: {
  code?: "AUTH_REQUIRED" | "CONFIG_SWITCH_FAILED";
  text: string;
}) {
  const heading = code ? ERROR_HEADINGS[code] : undefined;
  return (
    <Message align="start">
      <Message.Content>
        <Bubble align="start" className="max-w-md" variant="destructive">
          <Bubble.Content>
            {heading ? (
              <span className="mb-1 block font-semibold">{heading}</span>
            ) : null}
            <span className="text-destructive">{text}</span>
          </Bubble.Content>
        </Bubble>
      </Message.Content>
    </Message>
  );
}

/** TASK-104: the retry notice (client-only card, types.ts) is a bare,
 * muted centered line, not a bubble: it comments on the turn rather than
 * speaking in it. `reason` is the short policy label ("rate limit"), never
 * the raw upstream message. The retried turn's output follows this row; a
 * retry whose re-drive failed for good is replaced by the error bubble
 * (foldError drops the live notice). */
function RetryNoticeLine({
  reason,
  state,
}: {
  reason: string;
  state: "recovered" | "retrying";
}) {
  return (
    <div
      className="flex justify-center"
      data-retry-state={state}
      data-testid="retry-notice"
    >
      <span className="text-muted-foreground text-xs">
        {state === "retrying"
          ? `Retrying: ${reason}…`
          : `Auto-recovered after ${reason}`}
      </span>
    </div>
  );
}

/** Plan checklist body (status icon + per-entry class). */
function PlanChecklist({
  entries,
}: {
  entries: Array<{ content: string; status: string }>;
}) {
  return (
    <ul className="space-y-1">
      {entries.map((entry) => {
        const statusIcon = PLAN_STATUS_ICONS[entry.status] ?? "○ ";
        const statusClass = PLAN_STATUS_CLASSES[entry.status] ?? "";
        return (
          <li
            className={`text-sm ${statusClass}`}
            key={`plan:${entry.content.slice(0, 32)}`}
          >
            {statusIcon}
            {entry.content}
          </li>
        );
      })}
    </ul>
  );
}

const PLAN_STATUS_ICONS: Record<string, string> = {
  completed: "✓ ",
  in_progress: "● ",
};
const PLAN_STATUS_CLASSES: Record<string, string> = {
  completed: "text-muted-foreground line-through",
  in_progress: "font-medium",
};

/** Per-family body renderer: the card INSIDE the assistant bubble.
 * `answered` (TASK-87) is true when a text card with the same `msg_id`
 * exists in the transcript, i.e. the turn's answer has arrived. Only the
 * thinking family consumes it. */
const CARD_BODIES: {
  [type: string]: (
    card: TMessage,
    isStreaming: boolean,
    answered: boolean,
    readOnly: boolean,
    onOpenPaper?: (examId: string) => void
  ) => ReactNode;
} = {
  acp_permission: (card) =>
    isPermissionCard(card) ? <AcpPermissionPart part={card} /> : null,
  acp_terminal_output: (card) =>
    isTerminalCard(card) ? <AcpTerminalPart part={card} /> : null,
  acp_tool_call: (card) =>
    isToolCard(card) ? (
      <AcpToolCallPart key={card.toolCallId} part={card} />
    ) : null,
  ask: (card) => (isAskCard(card) ? <AcpAskPart part={card} /> : null),
  drill_item: (card, _isStreaming, _answered, readOnly) =>
    isDrillItemCard(card) ? (
      <DrillItemPart part={card} readOnly={readOnly} />
    ) : null,
  error: (card) =>
    card.type === "error" ? (
      <ErrorBubble code={card.code} text={card.text} />
    ) : null,
  paper: (card, _isStreaming, _answered, readOnly, onOpenPaper) =>
    isPaperCard(card) ? (
      <PaperPart card={card} onOpenPaper={onOpenPaper} readOnly={readOnly} />
    ) : null,
  plan: (card) =>
    isPlanCard(card) ? <PlanChecklist entries={card.entries} /> : null,
  retry_notice: (card) =>
    isRetryNoticeCard(card) ? (
      <RetryNoticeLine reason={card.reason} state={card.state} />
    ) : null,
  text: (card, isStreaming) => {
    if (!isTextCard(card)) {
      return null;
    }
    const textKey = card.content.slice(0, 40).replace(/\s+/g, "-");
    return (
      <TextPart
        isStreaming={isStreaming}
        key={`${card.id}-text-${textKey}`}
        part={{ text: card.content }}
      />
    );
  },
  thinking: (card, isStreaming, answered) =>
    isThinkingCard(card) ? (
      <AcpThinkingPart
        answered={answered}
        isStreaming={isStreaming}
        key={`${card.id}-thinking`}
        text={card.content}
      />
    ) : null,
  user_created: (card) =>
    isUserCard(card) ? <UserBubble text={card.text} /> : null,
};

/** User cards render bare (their own Message envelope); the rest wrap.
 * `retry_notice` renders its own centered line (TASK-104). */
const BARE_TYPES = new Set(["error", "retry_notice", "user_created"]);

/** The Card-based families: they bring their own bordered surface and must
 * stretch (see AssistantBubble; TASK-90 collapse). */
export const STRETCHED_TYPES = new Set([
  "acp_permission",
  "acp_terminal_output",
  "acp_tool_call",
  "ask",
  "drill_item",
  "paper",
]);

/**
 * Dispatch one card to its renderer. Returns `null` for unknown card
 * types (defensive fall-through).
 */
export function ChatCardSwitch({
  card,
  isStreaming,
  answered = false,
  onOpenPaper,
  readOnly = false,
}: {
  answered?: boolean;
  card: TMessage;
  isStreaming: boolean;
  onOpenPaper?: (examId: string) => void;
  readOnly?: boolean;
}) {
  const renderBody = CARD_BODIES[card.type];
  if (!renderBody) {
    return null;
  }
  if (BARE_TYPES.has(card.type)) {
    return (
      <>{renderBody(card, isStreaming, answered, readOnly, onOpenPaper)}</>
    );
  }
  return (
    <AssistantBubble stretch={STRETCHED_TYPES.has(card.type)}>
      {renderBody(card, isStreaming, answered, readOnly, onOpenPaper)}
    </AssistantBubble>
  );
}

/** Cards whose `msg_id` has a text card: the turn's answer has arrived
 * (TASK-87, drives the thinking card's auto-collapse). */
export function answeredTurnMsgIds(cards: TMessage[]): Set<string> {
  const answered = new Set<string>();
  for (const card of cards) {
    if (isTextCard(card)) {
      answered.add(card.msg_id);
    }
  }
  return answered;
}

/** The transcript row: scroller item keyed by card id wrapping the switch. */
export function ChatCardRow({
  answered,
  card,
  isStreaming,
  onOpenPaper,
  readOnly = false,
}: {
  answered: boolean;
  card: TMessage;
  isStreaming: boolean;
  onOpenPaper?: (examId: string) => void;
  readOnly?: boolean;
}) {
  return (
    <MessageScroller.Item key={card.id} scrollAnchor={isUserCard(card)}>
      <ChatCardSwitch
        answered={answered}
        card={card}
        isStreaming={isStreaming}
        onOpenPaper={onOpenPaper}
        readOnly={readOnly}
      />
    </MessageScroller.Item>
  );
}
