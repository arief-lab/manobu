import { Button } from "@manobu/ui/components/button";
import { Card, CardContent, CardFooter } from "@manobu/ui/components/card";
import { cn } from "@manobu/ui/lib/utils";

import { PaperCardHeader, PaperCardState } from "./paper-card-states";

export type PaperLevel = "N1" | "N2" | "N3" | "N4" | "N5";
/** Mirrors the contract's `ExamMode`. This package stays free of `api-contract`,
 * so the copy is deliberate; the drift is caught by `tsc`, because
 * `chat-session` passes `TMessagePaper.mode` (the contract type) straight into
 * this prop, so a mode added to the enum and not here fails the build. */
export type PaperMode = "shortened" | "exam-conditions" | "real";
export type PaperPhase =
  | "building"
  | "ready"
  | "running"
  | "submitted"
  | "raw-only"
  | "unavailable";
export type PaperSectionState = "building" | "ready" | "unavailable";

export interface PaperSectionSummary {
  id: string;
  label: string;
  state: PaperSectionState;
  total: number;
  validated: number;
}

export interface PaperBandedOverallResult {
  max: number;
  passed: boolean;
  passMark: number;
  score: number;
}

export interface PaperBandedSectionResult {
  id: string;
  label: string;
  max: number;
  passed: boolean;
  score: number;
}

export interface PaperRawOverallResult {
  correct: number;
  total: number;
}

export interface PaperRawSectionResult {
  correct: number;
  id: string;
  label: string;
  total: number;
}

export type PaperResultFacts =
  | {
      overall: PaperBandedOverallResult;
      scoring: "band";
      sections: readonly PaperBandedSectionResult[];
    }
  | {
      overall: PaperRawOverallResult;
      scoring: "raw-only";
      sections: readonly PaperRawSectionResult[];
    };

export interface PaperDebriefFacts {
  saved?: boolean;
  /** The names to show (TASK-160). `weakAnchors` are corpus ids and stay only
   * as keys; absent on a paper stored before this field existed. */
  weakAnchorLabels?: readonly string[];
  weakAnchors?: readonly string[];
}

export interface PaperCardProps {
  abandoned?: boolean;
  className?: string;
  debrief?: PaperDebriefFacts;
  examId: string;
  level: PaperLevel;
  mode: PaperMode;
  offline?: boolean;
  onStart?: () => void;
  phase: PaperPhase;
  readOnly?: boolean;
  result?: PaperResultFacts;
  sections: readonly PaperSectionSummary[];
  testIdPrefix?: string;
  total: number;
  validated: number;
}

function paperActionLabel(phase: PaperPhase): string {
  if (phase === "running") {
    return "Resume the paper";
  }
  if (phase === "submitted" || phase === "raw-only") {
    return "Open result";
  }
  return "Start the paper";
}

export function PaperCard({
  abandoned = false,
  className,
  debrief,
  examId,
  level,
  mode,
  offline = false,
  onStart,
  phase,
  readOnly = false,
  result,
  sections,
  testIdPrefix = "paper",
  total,
  validated,
}: PaperCardProps) {
  const canOpen =
    !readOnly &&
    onStart !== undefined &&
    (phase === "ready" ||
      phase === "running" ||
      phase === "submitted" ||
      phase === "raw-only");

  return (
    <Card
      className={cn("w-full bg-muted/20", className)}
      data-abandoned={abandoned ? "true" : "false"}
      data-exam-id={examId}
      data-offline={offline ? "true" : "false"}
      data-read-only={readOnly ? "true" : "false"}
      data-slot="paper-card"
      data-state={phase}
      data-testid={`${testIdPrefix}-card`}
      size="sm"
    >
      <PaperCardHeader
        level={level}
        mode={mode}
        offline={offline}
        phase={phase}
        testIdPrefix={testIdPrefix}
      />
      <CardContent
        aria-busy={phase === "building"}
        className="flex flex-col gap-3"
        data-slot="paper-card-content"
      >
        <PaperCardState
          abandoned={abandoned}
          debrief={debrief}
          level={level}
          offline={offline}
          phase={phase}
          result={result}
          sections={sections}
          testIdPrefix={testIdPrefix}
          total={total}
          validated={validated}
        />
      </CardContent>
      {canOpen ? (
        <CardFooter className="justify-end" data-slot="paper-card-footer">
          <Button
            className="min-h-11"
            data-testid={`${testIdPrefix}-start`}
            onClick={onStart}
            type="button"
          >
            {paperActionLabel(phase)}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
