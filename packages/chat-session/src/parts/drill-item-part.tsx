import {
  DrillCard,
  type DrillCardData,
} from "@manobu/ui/components/drill-card";
import { useCallback } from "react";

import type { TMessageDrillItem } from "../chat-engine";
import { getChatWsClient } from "../orpc";

function toUiCard(part: TMessageDrillItem): DrillCardData {
  return {
    drillSessionId: part.drillSessionId,
    item:
      part.item === null
        ? null
        : {
            anchors: [...part.item.anchors],
            id: part.item.id,
            itemType: part.item.itemType,
            level: part.item.level,
            options: [...part.item.options],
            ...(part.item.passage === undefined
              ? {}
              : { passage: part.item.passage }),
            prompt: part.item.prompt,
          },
    phase: part.phase,
    requestId: part.requestId,
    ...(part.resolution === undefined
      ? {}
      : {
          resolution: {
            chosenIndex: part.resolution.chosenIndex,
            correct: part.resolution.correct,
            correctIndex: part.resolution.correctIndex,
            ...(part.resolution.correctOption === undefined
              ? {}
              : { correctOption: part.resolution.correctOption }),
            ...(part.resolution.explanation === undefined
              ? {}
              : { explanation: part.resolution.explanation }),
            ...(part.resolution.itemId === undefined
              ? {}
              : { itemId: part.resolution.itemId }),
            ...(part.resolution.skipped === undefined
              ? {}
              : { skipped: part.resolution.skipped }),
          },
        }),
    sessionId: part.sessionId,
    snapshot: { ...part.snapshot },
  };
}

export function DrillItemPart({
  part,
  readOnly = false,
}: {
  part: TMessageDrillItem;
  readOnly?: boolean;
}) {
  const onAnswer = useCallback(
    (chosenIndex: number) => {
      const itemId = part.item?.id;
      if (itemId === undefined) {
        return Promise.resolve(undefined);
      }
      return getChatWsClient().chat.answerDrillItem({
        chosenIndex,
        conversationId: part.conversation_id,
        itemId,
        requestId: part.requestId,
      });
    },
    [part.conversation_id, part.item?.id, part.requestId]
  );

  const onSkip = useCallback(() => {
    const itemId = part.item?.id;
    return itemId === undefined
      ? Promise.resolve(undefined)
      : getChatWsClient().chat.skipDrill({
          conversationId: part.conversation_id,
          itemId,
          requestId: part.requestId,
        });
  }, [part.conversation_id, part.item?.id, part.requestId]);

  const onStop = useCallback(
    () =>
      getChatWsClient().chat.stopDrill({
        conversationId: part.conversation_id,
        requestId: part.requestId,
      }),
    [part.conversation_id, part.requestId]
  );

  return (
    <DrillCard
      card={toUiCard(part)}
      onAnswer={readOnly ? undefined : onAnswer}
      onSkip={readOnly ? undefined : onSkip}
      onStop={readOnly ? undefined : onStop}
      readOnly={readOnly}
    />
  );
}
