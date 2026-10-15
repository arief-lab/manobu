import {
  AcpPermissionCard,
  type AcpPermissionOption,
} from "@manobu/ui/components/acp-permission-card";
import { useCallback } from "react";
import type { PermissionOption, TMessageAcpPermission } from "../chat-engine";
import { getChatWsClient } from "../orpc";

/**
 * AcpPermissionPart — the chat-session adapter for the AionUi permission
 * card (TASK-80.4). Maps `TMessageAcpPermission` (the engine card) to the
 * structural `AcpPermissionCardProps` the @manobu/ui card consumes, and
 * wires `onSubmit` to `chat.confirm` over the WS oRPC link.
 *
 * The `callId` for `chat.confirm` is the ACP request id (the card's
 * `requestId`); the `data` field is the chosen option's `optionId`
 * (the server echoes it back to the ACP session as the user's choice).
 */

/** Map the engine `PermissionOption` to the UI card's option shape. */
function toUiOptions(options: PermissionOption[]): AcpPermissionOption[] {
  return options.map((option) => ({
    id: option.optionId,
    intent: option.kind.startsWith("allow") ? "allow" : "reject",
    label: option.name,
  }));
}

export function AcpPermissionPart({ part }: { part: TMessageAcpPermission }) {
  const isSettled = part.settled !== undefined;
  // TASK-109: the sidecar's park died with the process and the boot
  // recovery settled the row to `error`; the replayed status makes the
  // card read as expired, never tappable. An answer already sent
  // (`settled`) outranks this: it is the card's real terminal state.
  const isExpired = !isSettled && part.status === "error";

  const onSubmit = useCallback(
    async (optionId: string) => {
      await getChatWsClient().chat.confirm({
        callId: part.requestId,
        conversationId: part.conversation_id,
        data: optionId,
      });
    },
    [part.conversation_id, part.requestId]
  );

  const detail = JSON.stringify(part.toolCall, null, 2);

  const options = toUiOptions(part.options);

  let title = "Permission requested";
  if (isSettled) {
    title = "Response sent";
  } else if (isExpired) {
    title = "Permission request expired";
  }

  return (
    <AcpPermissionCard
      detail={detail}
      detailLabel="Tool call"
      onSubmit={onSubmit}
      options={
        isExpired
          ? options.map((option) => ({ ...option, disabled: true }))
          : options
      }
      requestKey={part.requestId}
      title={title}
    />
  );
}
