import { PaperCard } from "@manobu/ui/components/paper-card";

import type { TMessagePaper } from "../chat-engine/types";

export function PaperPart({
  card,
  onOpenPaper,
  readOnly = false,
}: {
  card: TMessagePaper;
  onOpenPaper?: (examId: string) => void;
  readOnly?: boolean;
}) {
  return (
    <PaperCard
      abandoned={card.abandoned}
      debrief={card.debrief}
      examId={card.examId}
      level={card.level}
      mode={card.mode}
      offline={card.offline}
      onStart={onOpenPaper ? () => onOpenPaper(card.examId) : undefined}
      phase={card.phase}
      readOnly={readOnly}
      result={card.result}
      sections={card.sections}
      total={card.totalSlots}
      validated={card.validatedSlots}
    />
  );
}
