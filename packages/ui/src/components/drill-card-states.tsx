import { Button } from "@manobu/ui/components/button";
import {
  CardDescription,
  CardHeader,
  CardTitle,
} from "@manobu/ui/components/card";
import { t } from "@manobu/ui/lib/copy";
import { cn } from "@manobu/ui/lib/utils";
import type { MouseEvent } from "react";

import type {
  DrillCardData,
  DrillCardProps,
  DrillCardSnapshot,
  DrillPhase,
} from "./drill-card";

type OptionState = "correct" | "neutral" | "wrong";

function optionState(
  index: number,
  chosenIndex: number,
  correctIndex: number
): OptionState {
  if (index === correctIndex) {
    return "correct";
  }
  if (index === chosenIndex) {
    return "wrong";
  }
  return "neutral";
}

function optionClasses(state: OptionState, className?: string): string {
  if (state === "correct") {
    return cn("border-success/50 bg-success/10 text-foreground", className);
  }
  if (state === "wrong") {
    return cn(
      "border-destructive/50 bg-destructive/10 text-foreground",
      className
    );
  }
  return cn("border-border bg-background text-foreground", className);
}

function phaseTitle(phase: DrillPhase): string {
  if (phase === "suspended") {
    return "Drill set paused";
  }
  if (phase === "summary") {
    return "Drill set complete";
  }
  return "Drill set";
}

export function DrillCardHeader({
  card,
  phase,
  snapshot,
  testIdPrefix,
}: {
  card: DrillCardData;
  phase: DrillPhase;
  snapshot: DrillCardSnapshot;
  testIdPrefix: string;
}) {
  return (
    <CardHeader>
      <div className="flex w-full items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle data-testid={`${testIdPrefix}-title`}>
            {phaseTitle(phase)}
          </CardTitle>
          <CardDescription>
            {card.item
              ? `${card.item.level} · ${card.item.itemType}`
              : t("drill.pending")}
          </CardDescription>
        </div>
        <span
          className="shrink-0 text-muted-foreground text-xs"
          data-testid={`${testIdPrefix}-progress`}
        >
          {snapshot.asked}/{snapshot.declaredCount}
        </span>
      </div>
    </CardHeader>
  );
}

function StaticOption({
  index,
  label,
  state,
  testIdPrefix,
}: {
  index: number;
  label: string;
  state: OptionState;
  testIdPrefix: string;
}) {
  return (
    <li
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 border px-3 py-2 text-left text-sm",
        optionClasses(state)
      )}
      data-option-index={index}
      data-option-state={state}
      data-testid={`${testIdPrefix}-option-${index}`}
    >
      <span>{label}</span>
      {state === "correct" ? <span>Correct</span> : null}
      {state === "wrong" ? <span>Your pick</span> : null}
    </li>
  );
}

function ResolvedOptions({
  card,
  testIdPrefix,
}: {
  card: DrillCardData;
  testIdPrefix: string;
}) {
  const { item, resolution } = card;
  if (!(resolution && item)) {
    return null;
  }
  return (
    <ul
      aria-label="Answer choices"
      className="flex flex-col gap-2"
      data-slot="drill-resolved-options"
    >
      {item.options.map((option, index) => (
        <StaticOption
          index={index}
          key={option}
          label={option}
          state={optionState(
            index,
            resolution.chosenIndex,
            resolution.correctIndex
          )}
          testIdPrefix={testIdPrefix}
        />
      ))}
    </ul>
  );
}

export function DrillCardPendingBody({
  card,
  handleOptionClick,
  isAnswering,
  onAnswer,
  onSkip,
  onStop,
  readOnly,
  testIdPrefix,
}: {
  card: DrillCardData;
  handleOptionClick: (event: MouseEvent<HTMLButtonElement>) => void;
  isAnswering: boolean;
  onAnswer: DrillCardProps["onAnswer"];
  onSkip?: () => Promise<unknown>;
  onStop?: () => Promise<unknown>;
  readOnly: boolean;
  testIdPrefix: string;
}) {
  if (!card.item) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t("drill.pending")}
      </p>
    );
  }
  const interactive = !readOnly && onAnswer !== undefined;
  return (
    <div className="flex flex-col gap-3">
      <p
        className="font-medium text-base"
        data-testid={`${testIdPrefix}-prompt`}
      >
        {card.item.prompt}
      </p>
      {card.item.passage ? (
        <p
          className="border-primary border-l-2 pl-3 text-muted-foreground text-sm"
          data-testid={`${testIdPrefix}-passage`}
        >
          {card.item.passage}
        </p>
      ) : null}
      <fieldset
        aria-label="Answer choices"
        className="border-0 p-0"
        data-testid={`${testIdPrefix}-choices`}
        disabled={isAnswering}
      >
        <legend className="sr-only">Choose an answer</legend>
        <ul className="flex flex-col gap-2">
          {card.item.options.map((option, index) => (
            <li key={option}>
              {interactive ? (
                <Button
                  className="min-h-11 w-full justify-start border-border px-3 text-left"
                  data-option-index={index}
                  data-testid={`${testIdPrefix}-option-${index}`}
                  disabled={isAnswering}
                  onClick={handleOptionClick}
                  type="button"
                  variant="outline"
                >
                  {option}
                </Button>
              ) : (
                <StaticOption
                  index={index}
                  label={option}
                  state="neutral"
                  testIdPrefix={testIdPrefix}
                />
              )}
            </li>
          ))}
        </ul>
      </fieldset>
      {interactive && onSkip ? (
        <Button
          className="self-start"
          data-testid={`${testIdPrefix}-skip`}
          onClick={onSkip}
          type="button"
          variant="ghost"
        >
          {t("drill.skip")}
        </Button>
      ) : null}
      {interactive && onStop ? (
        <Button
          className="self-start"
          data-testid={`${testIdPrefix}-stop`}
          onClick={onStop}
          type="button"
          variant="ghost"
        >
          {t("drill.stop")}
        </Button>
      ) : null}
    </div>
  );
}

export function DrillCardAnsweredBody({
  card,
  explanationOpen,
  interactive,
  onToggleExplanation,
  testIdPrefix,
}: {
  card: DrillCardData;
  explanationOpen: boolean;
  interactive: boolean;
  onToggleExplanation: () => void;
  testIdPrefix: string;
}) {
  const { resolution } = card;
  if (!resolution) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t("drill.next")}
      </p>
    );
  }
  if (resolution.skipped) {
    return (
      <p
        className="font-medium text-sm"
        data-testid={`${testIdPrefix}-skipped`}
        role="status"
      >
        Skipped.
      </p>
    );
  }
  const correctOption =
    resolution.correctOption ??
    card.item?.options[resolution.correctIndex] ??
    "the correct option";
  const verdict = resolution.correct
    ? t("drill.verdict.correct")
    : t("drill.verdict.wrong", { answer: correctOption });
  // An item with no explanation must not open with a "Generated from" heading:
  // that is the placeholder-shape defect (TASK-137), and a replayed exam item
  // has no prose behind it. The heading names no anchor either (TASK-160): the
  // item's `anchors[0]` is a corpus join key, not something a learner reads.
  const explanation = resolution.explanation ? (
    <section
      aria-label={t("drill.explain.action")}
      className="flex flex-col gap-1 border-primary border-l-2 pl-3 text-sm"
      data-testid={`${testIdPrefix}-explanation`}
      id={`${testIdPrefix}-explanation`}
    >
      <span className="text-muted-foreground text-xs">
        {t("drill.explain.generated")}
      </span>
      <span>{resolution.explanation}</span>
    </section>
  ) : null;
  return (
    <div className="flex flex-col gap-3">
      <p
        aria-live="polite"
        className={cn(
          "font-medium text-sm",
          resolution.correct ? "text-success" : "text-destructive"
        )}
        data-testid={`${testIdPrefix}-verdict`}
        role="status"
      >
        {verdict}
      </p>
      <ResolvedOptions card={card} testIdPrefix={testIdPrefix} />
      {!resolution.correct && explanation !== null ? (
        <div className="flex flex-col gap-2">
          {interactive ? (
            <Button
              aria-controls={`${testIdPrefix}-explanation`}
              aria-expanded={explanationOpen}
              className="self-start"
              data-testid={`${testIdPrefix}-explain`}
              onClick={onToggleExplanation}
              type="button"
              variant="ghost"
            >
              {t("drill.explain.action")}
            </Button>
          ) : (
            <div
              className="text-sm"
              data-testid={`${testIdPrefix}-explain`}
              role="note"
            >
              {t("drill.explain.action")}
            </div>
          )}
          {!interactive || explanationOpen ? explanation : null}
        </div>
      ) : null}
    </div>
  );
}

export function DrillCardSuspendedBody({
  snapshot,
  testIdPrefix,
}: {
  snapshot: DrillCardSnapshot;
  testIdPrefix: string;
}) {
  return (
    <div
      className="flex flex-col gap-2"
      data-testid={`${testIdPrefix}-suspended`}
    >
      <p className="font-medium text-sm" role="status">
        {t("drill.suspended", {
          answered: snapshot.answered,
          declared: snapshot.declaredCount,
        })}
      </p>
      <p className="text-muted-foreground text-xs">
        {snapshot.remaining} waiting
      </p>
    </div>
  );
}

export function DrillCardSummaryBody({
  snapshot,
  testIdPrefix,
}: {
  snapshot: DrillCardSnapshot;
  testIdPrefix: string;
}) {
  const correct =
    snapshot.correct === undefined ? "not available" : String(snapshot.correct);
  const schedule = snapshot.nextReview ?? "not scheduled";
  const skipped = snapshot.skipped ?? 0;
  const unasked = snapshot.unanswered ?? snapshot.remaining;
  return (
    <div
      className="flex flex-col gap-2"
      data-testid={`${testIdPrefix}-summary`}
    >
      <p className="font-medium text-sm" role="status">
        {t("drill.summary.counts", { asked: snapshot.asked, correct })}
      </p>
      <p className="text-muted-foreground text-xs">
        {t("drill.summary.schedule", { when: schedule })}
      </p>
      <p className="text-muted-foreground text-xs">
        {t("drill.summary.next", { action: "return to chat" })}
      </p>
      <p className="text-muted-foreground text-xs">
        {snapshot.answered} answered · {skipped} skipped · {unasked} unasked
      </p>
    </div>
  );
}

export function DrillCardUnavailableBody({
  testIdPrefix,
}: {
  testIdPrefix: string;
}) {
  return (
    <p
      className="text-muted-foreground text-sm"
      data-testid={`${testIdPrefix}-unavailable`}
      role="status"
    >
      No item right now.
    </p>
  );
}
