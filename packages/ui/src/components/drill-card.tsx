import { Card, CardContent } from "@manobu/ui/components/card";
import { cn } from "@manobu/ui/lib/utils";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DrillCardAnsweredBody,
  DrillCardHeader,
  DrillCardPendingBody,
  DrillCardSummaryBody,
  DrillCardSuspendedBody,
  DrillCardUnavailableBody,
} from "./drill-card-states";

export type DrillPhase =
  | "pending"
  | "answered"
  | "suspended"
  | "summary"
  | "unavailable";

export interface DrillCardItem {
  anchors: string[];
  id: string;
  itemType: string;
  level: string;
  options: string[];
  passage?: string | null;
  prompt: string;
}

export interface DrillCardResolution {
  chosenIndex: number;
  correct: boolean;
  correctIndex: number;
  correctOption?: string;
  explanation?: string | null;
  itemId?: string;
  skipped?: boolean;
}

export interface DrillCardSnapshot {
  answered: number;
  asked: number;
  correct?: number;
  declaredCount: number;
  nextReview?: string | null;
  pendingRefill?: boolean;
  readyCount?: number;
  remaining: number;
  skipped?: number;
  unanswered?: number;
}

export interface DrillCardData {
  drillSessionId: string;
  item: DrillCardItem | null;
  phase: DrillPhase;
  requestId: string;
  resolution?: DrillCardResolution;
  sessionId: string;
  snapshot: DrillCardSnapshot;
}

export interface DrillCardAnswerResult {
  resolution: DrillCardResolution;
  snapshot?: DrillCardSnapshot;
}

export type DrillCardAnswerHandler = (chosenIndex: number) => Promise<unknown>;

export interface DrillCardProps {
  card: DrillCardData;
  className?: string;
  onAnswer?: DrillCardAnswerHandler;
  onSkip?: () => Promise<unknown>;
  onStop?: () => Promise<unknown>;
  readOnly?: boolean;
  testIdPrefix?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isResolution(value: unknown): value is DrillCardResolution {
  return (
    isRecord(value) &&
    typeof value.chosenIndex === "number" &&
    typeof value.correct === "boolean" &&
    typeof value.correctIndex === "number"
  );
}

function isSnapshot(value: unknown): value is DrillCardSnapshot {
  return (
    isRecord(value) &&
    typeof value.answered === "number" &&
    typeof value.asked === "number" &&
    typeof value.declaredCount === "number" &&
    typeof value.remaining === "number"
  );
}

function normalizeAnswerResult(result: unknown): DrillCardAnswerResult | null {
  if (isResolution(result)) {
    return { resolution: result };
  }
  if (!(isRecord(result) && isResolution(result.resolution))) {
    return null;
  }
  return {
    resolution: result.resolution,
    ...(isSnapshot(result.snapshot) ? { snapshot: result.snapshot } : {}),
  };
}

interface DrillCardViewModel {
  answerError: boolean;
  effectiveCard: DrillCardData;
  effectivePhase: DrillPhase;
  effectiveSnapshot: DrillCardSnapshot;
  explanationInteractive: boolean;
  explanationOpen: boolean;
  handleOptionClick: (event: MouseEvent<HTMLButtonElement>) => Promise<unknown>;
  isAnswering: boolean;
  toggleExplanation: () => void;
}

function useDrillCardViewModel({
  card,
  onAnswer,
  readOnly,
}: {
  card: DrillCardData;
  onAnswer?: DrillCardAnswerHandler;
  readOnly: boolean;
}): DrillCardViewModel {
  const [localResolution, setLocalResolution] =
    useState<DrillCardResolution | null>(
      card.phase === "answered" ? (card.resolution ?? null) : null
    );
  const [localSnapshot, setLocalSnapshot] = useState(card.snapshot);
  const [localSubmitted, setLocalSubmitted] = useState(
    card.phase === "answered"
  );
  const [isAnswering, setIsAnswering] = useState(false);
  const [answerError, setAnswerError] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const requestIdentity = `${card.requestId}:${card.phase}`;
  const answerPhase = card.phase === "answered";
  const requestKeyRef = useRef(requestIdentity);
  const requestEpochRef = useRef(0);

  useEffect(() => {
    if (requestKeyRef.current !== requestIdentity) {
      requestKeyRef.current = requestIdentity;
      requestEpochRef.current += 1;
    }
    setLocalResolution(answerPhase ? (card.resolution ?? null) : null);
    setLocalSnapshot(card.snapshot);
    setLocalSubmitted(answerPhase);
    setIsAnswering(false);
    setAnswerError(false);
    setExplanationOpen(false);
  }, [answerPhase, card.resolution, card.snapshot, requestIdentity]);

  const answer = useCallback(
    (chosenIndex: number) => {
      const submitAnswer = onAnswer;
      if (isAnswering || readOnly || submitAnswer === undefined) {
        return Promise.resolve();
      }
      const requestEpoch = requestEpochRef.current;
      setIsAnswering(true);
      setAnswerError(false);
      return Promise.resolve()
        .then(() => submitAnswer(chosenIndex))
        .then((result) => {
          if (requestEpochRef.current !== requestEpoch) {
            return;
          }
          const normalized = normalizeAnswerResult(result);
          if (normalized) {
            setLocalResolution(normalized.resolution);
            if (normalized.snapshot) {
              setLocalSnapshot(normalized.snapshot);
            }
          }
          setLocalSubmitted(true);
        })
        .catch(() => {
          if (requestEpochRef.current === requestEpoch) {
            setAnswerError(true);
          }
        })
        .finally(() => {
          if (requestEpochRef.current === requestEpoch) {
            setIsAnswering(false);
          }
        });
    },
    [isAnswering, onAnswer, readOnly]
  );

  const handleOptionClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const rawIndex = event.currentTarget.dataset.optionIndex;
      const chosenIndex = Number(rawIndex);
      return Number.isInteger(chosenIndex)
        ? answer(chosenIndex)
        : Promise.resolve();
    },
    [answer]
  );

  const toggleExplanation = useCallback(() => {
    setExplanationOpen((open) => !open);
  }, []);

  const persistedResolution =
    card.phase === "answered" ? card.resolution : undefined;
  const effectiveResolution = localResolution ?? persistedResolution;
  const effectivePhase: DrillPhase =
    localSubmitted || effectiveResolution ? "answered" : card.phase;
  const effectiveSnapshot = localSnapshot ?? card.snapshot;
  const explanationInteractive = !readOnly && onAnswer !== undefined;
  const effectiveCard: DrillCardData = {
    ...card,
    item: card.item,
    phase: effectivePhase,
    resolution: effectiveResolution,
    snapshot: effectiveSnapshot,
  };

  return {
    answerError,
    effectiveCard,
    effectivePhase,
    effectiveSnapshot,
    explanationInteractive,
    explanationOpen,
    handleOptionClick,
    isAnswering,
    toggleExplanation,
  };
}

function DrillCardBody({
  card,
  explanationInteractive,
  explanationOpen,
  handleOptionClick,
  isAnswering,
  onAnswer,
  onSkip,
  onStop,
  readOnly,
  testIdPrefix,
  toggleExplanation,
}: {
  card: DrillCardData;
  explanationInteractive: boolean;
  explanationOpen: boolean;
  handleOptionClick: DrillCardViewModel["handleOptionClick"];
  isAnswering: boolean;
  onAnswer?: DrillCardAnswerHandler;
  onSkip?: () => Promise<unknown>;
  onStop?: () => Promise<unknown>;
  readOnly: boolean;
  testIdPrefix: string;
  toggleExplanation: () => void;
}) {
  switch (card.phase) {
    case "pending":
      return (
        <DrillCardPendingBody
          card={card}
          handleOptionClick={handleOptionClick}
          isAnswering={isAnswering}
          onAnswer={onAnswer}
          onSkip={onSkip}
          onStop={onStop}
          readOnly={readOnly}
          testIdPrefix={testIdPrefix}
        />
      );
    case "answered":
      return (
        <DrillCardAnsweredBody
          card={card}
          explanationOpen={explanationOpen}
          interactive={explanationInteractive}
          onToggleExplanation={toggleExplanation}
          testIdPrefix={testIdPrefix}
        />
      );
    case "suspended":
      return (
        <DrillCardSuspendedBody
          snapshot={card.snapshot}
          testIdPrefix={testIdPrefix}
        />
      );
    case "summary":
      return (
        <DrillCardSummaryBody
          snapshot={card.snapshot}
          testIdPrefix={testIdPrefix}
        />
      );
    case "unavailable":
      return <DrillCardUnavailableBody testIdPrefix={testIdPrefix} />;
    default: {
      const exhaustivePhase: never = card.phase;
      return exhaustivePhase;
    }
  }
}

export function DrillCard({
  card,
  className,
  onAnswer,
  onSkip,
  onStop,
  readOnly = false,
  testIdPrefix = "drill",
}: DrillCardProps) {
  const view = useDrillCardViewModel({ card, onAnswer, readOnly });
  const state = view.answerError ? "error" : view.effectivePhase;

  return (
    <Card
      className={cn(
        "w-full border-dashed bg-muted/30 ring-foreground/5",
        className
      )}
      data-read-only={readOnly ? "true" : "false"}
      data-slot="drill-card"
      data-state={state}
      data-testid={`${testIdPrefix}-card`}
      size="sm"
    >
      <DrillCardHeader
        card={view.effectiveCard}
        phase={view.effectivePhase}
        snapshot={view.effectiveSnapshot}
        testIdPrefix={testIdPrefix}
      />
      <CardContent
        aria-busy={view.isAnswering}
        className="flex flex-col gap-3"
        data-slot="drill-card-content"
      >
        <DrillCardBody
          card={view.effectiveCard}
          explanationInteractive={view.explanationInteractive}
          explanationOpen={view.explanationOpen}
          handleOptionClick={view.handleOptionClick}
          isAnswering={view.isAnswering}
          onAnswer={onAnswer}
          onSkip={onSkip}
          onStop={onStop}
          readOnly={readOnly}
          testIdPrefix={testIdPrefix}
          toggleExplanation={view.toggleExplanation}
        />
        {view.answerError ? (
          <p className="text-destructive text-xs" role="alert">
            The answer could not be saved. Try again.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
