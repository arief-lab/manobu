import {
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@manobu/ui/components/card";
import { t } from "@manobu/ui/lib/copy";
import { cn } from "@manobu/ui/lib/utils";

import type {
  PaperBandedSectionResult,
  PaperDebriefFacts,
  PaperLevel,
  PaperMode,
  PaperPhase,
  PaperRawSectionResult,
  PaperResultFacts,
  PaperSectionSummary,
} from "./paper-card";

type PaperBandedResult = Extract<PaperResultFacts, { scoring: "band" }>;
type PaperRawResult = Extract<PaperResultFacts, { scoring: "raw-only" }>;

function phaseLabel(phase: PaperPhase): string {
  if (phase === "raw-only") {
    return "Raw counts only";
  }
  if (phase === "running") {
    return "In progress";
  }
  return `${phase.charAt(0).toUpperCase()}${phase.slice(1)}`;
}

function sectionStateLabel(state: PaperSectionSummary["state"]): string {
  if (state === "building") {
    return "building";
  }
  return state;
}

function modeLabel(mode: PaperMode): string {
  if (mode === "shortened") {
    return t("paper.mode.shortened");
  }
  if (mode === "real") {
    return t("paper.mode.real");
  }
  return t("paper.mode.examConditions");
}

export function PaperCardHeader({
  level,
  mode,
  offline,
  phase,
  testIdPrefix,
}: {
  level: PaperLevel;
  mode: PaperMode;
  offline: boolean;
  phase: PaperPhase;
  testIdPrefix: string;
}) {
  return (
    <CardHeader>
      <CardTitle
        className="min-w-0 break-words"
        data-testid={`${testIdPrefix}-title`}
      >
        {level} paper
      </CardTitle>
      <CardDescription data-testid={`${testIdPrefix}-mode`}>
        {modeLabel(mode)}
      </CardDescription>
      <CardAction>
        <span
          className="text-muted-foreground text-xs"
          data-testid={`${testIdPrefix}-status`}
        >
          {offline ? "Offline" : phaseLabel(phase)}
        </span>
      </CardAction>
    </CardHeader>
  );
}

function PaperSectionSummaryList({
  sections,
  testIdPrefix,
}: {
  sections: readonly PaperSectionSummary[];
  testIdPrefix: string;
}) {
  if (sections.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No sections reported.</p>
    );
  }
  return (
    <ul
      aria-label="Paper sections"
      className="flex flex-col gap-2"
      data-testid={`${testIdPrefix}-sections`}
    >
      {sections.map((section) => (
        <li
          className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 text-sm"
          data-section-id={section.id}
          data-section-state={section.state}
          key={section.id}
        >
          <span className="min-w-0 break-words">{section.label}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {section.validated}/{section.total} ·{" "}
            {sectionStateLabel(section.state)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PaperDebrief({
  debrief,
  testIdPrefix,
}: {
  debrief: PaperDebriefFacts | undefined;
  testIdPrefix: string;
}) {
  const labels = debrief?.weakAnchorLabels ?? [];
  return (
    <div
      className="flex flex-col gap-1"
      data-testid={`${testIdPrefix}-debrief`}
    >
      {labels.length > 0 ? (
        <p className="text-sm">
          {t("paper.debrief.weak", { anchors: labels.join(" · ") })}
        </p>
      ) : null}
      {debrief?.saved === false ? (
        <p className="text-destructive text-xs" role="alert">
          {t("paper.debrief.notSaved")}
        </p>
      ) : null}
    </div>
  );
}

function PaperBandedResultBody({
  debrief,
  result,
  testIdPrefix,
}: {
  debrief: PaperDebriefFacts | undefined;
  result: PaperBandedResult;
  testIdPrefix: string;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid={`${testIdPrefix}-result`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium text-base">
          Overall {result.overall.score}/{result.overall.max}
        </span>
        <span
          className={cn(
            "font-medium text-sm",
            result.overall.passed ? "text-success" : "text-destructive"
          )}
        >
          {result.overall.passed ? "Pass" : "Not passed"}
        </span>
      </div>
      <p className="text-muted-foreground text-sm">
        {t("paper.result.twoGates", {
          mark: result.overall.passMark,
          max: result.overall.max,
          total: result.overall.score,
        })}
      </p>
      <PaperBandedSectionList
        sections={result.sections}
        testIdPrefix={testIdPrefix}
      />
      <PaperDebrief debrief={debrief} testIdPrefix={testIdPrefix} />
    </div>
  );
}

function PaperBandedSectionList({
  sections,
  testIdPrefix,
}: {
  sections: readonly PaperBandedSectionResult[];
  testIdPrefix: string;
}) {
  return (
    <ul
      aria-label="Scored sections"
      className="flex flex-col gap-2"
      data-testid={`${testIdPrefix}-result-sections`}
    >
      {sections.map((section) => (
        <li
          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 text-sm"
          data-section-id={section.id}
          key={section.id}
        >
          <span className="min-w-0 break-words">{section.label}</span>
          <span className="tabular-nums">
            {section.score}/{section.max}
          </span>
          <span
            className={cn(
              "text-xs",
              section.passed ? "text-success" : "text-destructive"
            )}
          >
            {section.passed ? "Pass" : "Not passed"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PaperRawResultBody({
  debrief,
  result,
  testIdPrefix,
}: {
  debrief: PaperDebriefFacts | undefined;
  result: PaperRawResult | null;
  testIdPrefix: string;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid={`${testIdPrefix}-result`}>
      <p className="font-medium text-sm">{t("paper.result.rawOnly")}</p>
      {result ? (
        <>
          <p className="text-sm">
            {result.overall.correct}/{result.overall.total} correct
          </p>
          <PaperRawSectionList
            sections={result.sections}
            testIdPrefix={testIdPrefix}
          />
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          Raw counts are not available yet.
        </p>
      )}
      <PaperDebrief debrief={debrief} testIdPrefix={testIdPrefix} />
    </div>
  );
}

function PaperRawSectionList({
  sections,
  testIdPrefix,
}: {
  sections: readonly PaperRawSectionResult[];
  testIdPrefix: string;
}) {
  return (
    <ul
      aria-label="Raw section counts"
      className="flex flex-col gap-2"
      data-testid={`${testIdPrefix}-result-sections`}
    >
      {sections.map((section) => (
        <li
          className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 text-sm"
          data-section-id={section.id}
          key={section.id}
        >
          <span className="min-w-0 break-words">{section.label}</span>
          <span className="tabular-nums">
            {section.correct}/{section.total}
          </span>
        </li>
      ))}
    </ul>
  );
}

function BuildingState({
  sections,
  testIdPrefix,
  total,
  validated,
}: {
  sections: readonly PaperSectionSummary[];
  testIdPrefix: string;
  total: number;
  validated: number;
}) {
  return (
    <div
      aria-live="polite"
      className="flex flex-col gap-3"
      data-testid={`${testIdPrefix}-building`}
      role="status"
    >
      <p className="font-medium text-sm">
        {t("paper.build.running", { n: validated, total })}
      </p>
      <PaperSectionSummaryList
        sections={sections}
        testIdPrefix={testIdPrefix}
      />
    </div>
  );
}

function ReadyState({
  level,
  offline,
  sections,
  testIdPrefix,
  total,
}: {
  level: PaperLevel;
  offline: boolean;
  sections: readonly PaperSectionSummary[];
  testIdPrefix: string;
  total: number;
}) {
  const itemLabel = total === 1 ? "item" : "items";
  const sectionCountLabel = sections.length === 1 ? "section" : "sections";
  return (
    <div
      className="flex flex-col gap-3"
      data-testid={`${testIdPrefix}-ready`}
      role="status"
    >
      <p className="font-medium text-sm">
        Your {level} paper is ready: {total} {itemLabel}, {sections.length}{" "}
        {sectionCountLabel}.
      </p>
      {offline ? (
        <p className="text-muted-foreground text-sm">
          Built-in paper ready. Answers stay on this computer.
        </p>
      ) : null}
      <PaperSectionSummaryList
        sections={sections}
        testIdPrefix={testIdPrefix}
      />
    </div>
  );
}

function RunningState({
  offline,
  sections,
  testIdPrefix,
}: {
  offline: boolean;
  sections: readonly PaperSectionSummary[];
  testIdPrefix: string;
}) {
  return (
    <div
      className="flex flex-col gap-3"
      data-testid={`${testIdPrefix}-running`}
      role="status"
    >
      <p className="font-medium text-sm">
        {offline
          ? "Paper in progress. Reconnect to continue."
          : "Paper in progress. Your answers are kept as you go."}
      </p>
      <PaperSectionSummaryList
        sections={sections}
        testIdPrefix={testIdPrefix}
      />
    </div>
  );
}

function SubmittedState({
  debrief,
  result,
  testIdPrefix,
}: {
  debrief: PaperDebriefFacts | undefined;
  result: PaperResultFacts | undefined;
  testIdPrefix: string;
}) {
  if (result?.scoring === "band") {
    return (
      <PaperBandedResultBody
        debrief={debrief}
        result={result}
        testIdPrefix={testIdPrefix}
      />
    );
  }
  if (result?.scoring === "raw-only") {
    return (
      <PaperRawResultBody
        debrief={debrief}
        result={result}
        testIdPrefix={testIdPrefix}
      />
    );
  }
  return (
    <div
      className="flex flex-col gap-3"
      data-testid={`${testIdPrefix}-submitted`}
      role="status"
    >
      <p className="font-medium text-sm">
        Submitted. The result is not available yet.
      </p>
      <PaperDebrief debrief={debrief} testIdPrefix={testIdPrefix} />
    </div>
  );
}

function unavailableMessage(abandoned: boolean, offline: boolean): string {
  if (abandoned) {
    return t("exam.abandon.done");
  }
  return offline ? "Paper unavailable while offline." : t("paper.build.failed");
}

function UnavailableState({
  abandoned,
  offline,
  sections,
  testIdPrefix,
  total,
  validated,
}: {
  abandoned: boolean;
  offline: boolean;
  sections: readonly PaperSectionSummary[];
  testIdPrefix: string;
  total: number;
  validated: number;
}) {
  return (
    <div
      className="flex flex-col gap-3"
      data-testid={`${testIdPrefix}-unavailable`}
      role={abandoned || offline ? "status" : "alert"}
    >
      <p className="font-medium text-sm">
        {unavailableMessage(abandoned, offline)}
      </p>
      {offline || abandoned ? null : (
        <>
          <p className="text-sm">
            {validated}/{total} items validated.
          </p>
          <PaperSectionSummaryList
            sections={sections}
            testIdPrefix={testIdPrefix}
          />
        </>
      )}
    </div>
  );
}

export function PaperCardState({
  abandoned,
  debrief,
  level,
  offline,
  phase,
  result,
  sections,
  testIdPrefix,
  total,
  validated,
}: {
  abandoned: boolean;
  debrief: PaperDebriefFacts | undefined;
  level: PaperLevel;
  offline: boolean;
  phase: PaperPhase;
  result: PaperResultFacts | undefined;
  sections: readonly PaperSectionSummary[];
  testIdPrefix: string;
  total: number;
  validated: number;
}) {
  if (phase === "building") {
    return (
      <BuildingState
        sections={sections}
        testIdPrefix={testIdPrefix}
        total={total}
        validated={validated}
      />
    );
  }
  if (phase === "ready") {
    return (
      <ReadyState
        level={level}
        offline={offline}
        sections={sections}
        testIdPrefix={testIdPrefix}
        total={total}
      />
    );
  }
  if (phase === "running") {
    return (
      <RunningState
        offline={offline}
        sections={sections}
        testIdPrefix={testIdPrefix}
      />
    );
  }
  if (phase === "submitted") {
    return (
      <SubmittedState
        debrief={debrief}
        result={result}
        testIdPrefix={testIdPrefix}
      />
    );
  }
  if (phase === "raw-only") {
    return (
      <PaperRawResultBody
        debrief={debrief}
        result={result?.scoring === "raw-only" ? result : null}
        testIdPrefix={testIdPrefix}
      />
    );
  }
  return (
    <UnavailableState
      abandoned={abandoned}
      offline={offline}
      sections={sections}
      testIdPrefix={testIdPrefix}
      total={total}
      validated={validated}
    />
  );
}
