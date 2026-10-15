import {
  AcpTerminalCard,
  type AcpTerminalCardData,
} from "@manobu/ui/components/acp-terminal-card";
import { useCallback } from "react";
import type { TMessageTerminal } from "../chat-engine";
import { getChatWsClient } from "../orpc";

/**
 * AcpTerminalPart — the chat-session adapter for the AionUi terminal-output
 * card (TASK-80.4.1). Maps `TMessageTerminal` (the engine card) to the
 * structural `AcpTerminalCardData` the @manobu/ui card consumes, keeping
 * `packages/ui` free of a dependency on `@manobu/chat-session`.
 *
 * `onKill` wires the Kill button to `chat.killTerminal` over the WS oRPC
 * link (the server `kill`s the hosted child but keeps the id valid for a
 * final output pull, per the AionUi `AcpTerminalOutput` contract).
 */
export function AcpTerminalPart({ part }: { part: TMessageTerminal }) {
  const card: AcpTerminalCardData = {
    command: part.command,
    exitStatus: part.exitStatus,
    output: part.output,
    terminalId: part.terminalId,
    truncated: part.truncated,
  };

  const onKill = useCallback(async () => {
    await getChatWsClient().chat.killTerminal({
      conversationId: part.conversation_id,
      terminalId: part.terminalId,
    });
  }, [part.conversation_id, part.terminalId]);

  return <AcpTerminalCard card={card} onKill={onKill} />;
}
