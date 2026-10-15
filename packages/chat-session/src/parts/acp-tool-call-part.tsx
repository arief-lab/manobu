import { env } from "@manobu/env/web";
import {
  AcpToolCallCard,
  type AcpToolCallCardData,
} from "@manobu/ui/components/acp-tool-call-card";
import type { TMessageAcpToolCall } from "../chat-engine";

/**
 * AcpToolCallPart — the chat-session adapter for the AionUi tool-call card
 * (TASK-80.4). Maps `TMessageAcpToolCall` (the engine card) to the
 * structural `AcpToolCallCardData` the @manobu/ui card consumes, keeping
 * `packages/ui` free of a dependency on `@manobu/chat-session`.
 *
 * It is also where the developer affordance lives: `packages/ui` cannot read
 * `@manobu/env`, so the card takes a `debug` flag and this part decides it
 * from `VITE_DEBUG` (TASK-30), the same switch that gates /speech and
 * /chat-history (TASK-160: the raw tool-call id is behind it).
 */
export function AcpToolCallPart({ part }: { part: TMessageAcpToolCall }) {
  const card: AcpToolCallCardData = {
    content: part.content as AcpToolCallCardData["content"],
    kind: part.kind,
    raw_input: part.raw_input,
    raw_output: part.raw_output,
    status: part.status,
    title: part.title,
    toolCallId: part.toolCallId,
  };
  return <AcpToolCallCard card={card} debug={env.VITE_DEBUG === "1"} />;
}
