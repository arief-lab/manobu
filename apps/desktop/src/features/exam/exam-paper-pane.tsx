import type {
  ExamDebriefItem,
  ExamMode,
  ExamResult,
  ExamSectionState,
  ExamState,
} from "@manobu/api-contract";
import {
  examScoringSectionLabelForMode,
  examSectionLabelForMode,
} from "@manobu/api-contract";
import { Button } from "@manobu/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@manobu/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@manobu/ui/components/empty";
import { copy, t } from "@manobu/ui/lib/copy";
import { Link } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import {
  EXAM_CHAT_COLLAPSE_STORAGE_KEY,
  isNarrowExamScreen,
  parseExamChatCollapse,
} from "./exam-collapse";
import {
  PaperScopeRoot,
  shouldBlockExamChat,
  shouldRenderExamReview,
  usePaperScope,
} from "./exam-paper-scope";
import {
  activeQuestionFor,
  activeQuestionIndex,
  ExamQuestion,
  formatExamTimer,
  questionFromComposedItem,
  questionStimuli,
  shortcutToOptionIndex,
} from "./exam-question";

export const EXAM_CHAT_COLUMN_ID = "exam-chat-column";

/** A review row shows an explanation only when the debrief says one was
 * generated (TASK-137): a composed item carries none, and the server's stub
 * reached the learner under a "Generated from {anchor}" heading. A seam rather
 * than an inline condition because the desktop has no DOM environment to click
 * a row with (`apps/desktop/AGENTS.md`). */
const shouldRenderExplanation = (
  item: Pick<ExamDebriefItem, "explanation" | "explanationGenerated">
): boolean => item.explanationGenerated && item.explanation !== null;

/** The review row's provenance line (TASK-160): the item's corpus NAMES, never
 * its anchor ids. `anchors` is a join key (`vocab:N5:05d1e396…`, `grammar:<id>`)
 * and a learner reading it learns nothing. Null when the debrief carried no
 * resolvable label: the row says less but lies less. A seam for the same
 * no-DOM reason as `shouldRenderExplanation` above. */
const reviewAnchorLine = (
  item: Pick<ExamDebriefItem, "anchorLabels">
): string | null =>
  item.anchorLabels.length === 0
    ? null
    : t("exam.review.anchor", { anchor: item.anchorLabels.join(" · ") });

/** The listening script the review prints (TASK-173.8.2 AC#4): the item's
 * `speech`, which is the synthesis input the client received and never
 * rendered during the block (TASK-141). The control's failure line promises
 * "The script is in the review", and this is where that promise is kept.
 * Null for a non-listening item, which carries no speech. A seam for the same
 * no-DOM reason as `reviewAnchorLine` above. */
const reviewScriptLine = (item: Pick<ExamDebriefItem, "item">): string | null =>
  item.item.speech;

const sectionStateLabel = (
  status: "pending" | "in_progress" | "submitted" | "abandoned"
): string => {
  if (status === "in_progress") {
    return "active";
  }
  return status;
};

const formatPausedTime = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const reviewOptionLabel = (option: string, index: number): string =>
  `${String.fromCharCode(65 + index)}. ${option}`;

/**
 * The 大問 heading of the 小問 the learner is on (TASK-173.4 AC#4). A real paper
 * prints the official block heading above its questions, and the numbering
 * restarts per 科目 the way the official paper's does. Null when there is no
 * heading to print: every mode but `real`, and a real paper whose stored rows do
 * not line up with the official shape (the server prints no grouping it cannot
 * stand behind). A seam rather than inline JSX because the desktop has no DOM
 * environment to click a heading with, and a render-only assertion cannot tell a
 * wired branch from a dead one.
 */
const largeQuestionHeading = (
  section: ExamSectionState | null,
  index: number
): string | null => {
  if (section === null) {
    return null;
  }
  const bigQuestion = section.items[index]?.bigQuestion ?? null;
  if (bigQuestion === null) {
    return null;
  }
  const block = section.blocks.find(
    (candidate) => candidate.bigQuestion === bigQuestion
  );
  return block === undefined ? null : `大問 ${bigQuestion} · ${block.name}`;
};

/**
 * The instruction sentence the paper prints under the 大問 heading
 * (TASK-173.2 AC#1). This is where a real paper tells the learner what a 小問
 * asks, so it is printed once per 大問 rather than repeated on every item.
 * Null when the block has no wording this repo can name a paper for, or when
 * there is no 大問 at all, which is every mode but `real`.
 */
const largeQuestionInstruction = (
  section: ExamSectionState | null,
  index: number
): string | null => {
  if (section === null) {
    return null;
  }
  const bigQuestion = section.items[index]?.bigQuestion ?? null;
  if (bigQuestion === null) {
    return null;
  }
  return (
    section.blocks.find((candidate) => candidate.bigQuestion === bigQuestion)
      ?.instruction ?? null
  );
};

const reviewOptionClass = (
  index: number,
  correctIndex: number,
  selectedIndex: number | null
): string => {
  if (index === correctIndex) {
    return "font-medium text-success";
  }
  if (index === selectedIndex) {
    return "text-destructive";
  }
  return "text-muted-foreground";
};

export interface ExamPaperPaneProps {
  collapsed: boolean;
  examId: string;
  onCollapsedChange: (collapsed: boolean) => void;
}

const paperModeCopyKey = (mode: ExamState["mode"]) => {
  switch (mode) {
    case "exam-conditions":
      return "paper.mode.examConditions";
    case "real":
      return "paper.mode.real";
    case "shortened":
      return "paper.mode.shortened";
    default: {
      const unhandled: never = mode;
      throw new Error(`unhandled exam mode: ${String(unhandled)}`);
    }
  }
};

function PaperHeader({
  collapsed,
  onCollapsedChange,
}: {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const { exam } = usePaperScope();
  const label = collapsed
    ? (copy["exam.collapse.toggle"].edge ??
      copy["exam.collapse.toggle"].primary)
    : copy["exam.collapse.toggle"].primary;
  const handleCollapse = useCallback(() => {
    onCollapsedChange(!collapsed);
  }, [collapsed, onCollapsedChange]);
  return (
    <header
      className="flex shrink-0 items-center justify-between gap-3 border-border border-b px-4 py-3"
      data-collapsed={collapsed ? "true" : "false"}
      data-testid="exam-paper-header"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Link
          className="inline-flex min-h-11 items-center rounded-card px-2 text-sm hover:bg-muted"
          to="/dashboard"
        >
          ← desk
        </Link>
        <div className="min-w-0">
          <h1 className="font-medium text-sm">{exam.level}</h1>
          <p className="text-muted-foreground text-xs">
            {t(paperModeCopyKey(exam.mode))}
          </p>
        </div>
      </div>
      <Button
        aria-controls={EXAM_CHAT_COLUMN_ID}
        aria-label={label}
        aria-pressed={collapsed}
        className="min-h-11"
        data-testid="exam-chat-collapse"
        onClick={handleCollapse}
        type="button"
        variant="outline"
      >
        {label}
      </Button>
    </header>
  );
}

function ActionNotice() {
  const { actionError } = usePaperScope();
  if (actionError === null) {
    return null;
  }
  return (
    <p
      className="rounded-card border border-destructive px-3 py-2 text-destructive text-sm"
      data-testid="exam-action-error"
      role="alert"
    >
      {actionError.message}
    </p>
  );
}

function DraftState() {
  const { exam } = usePaperScope();
  if (exam.status !== "draft") {
    return null;
  }
  return (
    <Card data-testid="exam-building" role="status" size="sm">
      <CardHeader>
        <CardTitle>
          {t("paper.build.running", {
            n: exam.validatedSlots,
            total: exam.totalSlots,
          })}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function ReadyState() {
  const { exam, isStarting, start } = usePaperScope();
  if (exam.status !== "ready") {
    return null;
  }
  return (
    <Card data-testid="exam-ready" size="sm">
      <CardHeader>
        <CardTitle>Paper ready</CardTitle>
        <CardDescription>
          {exam.sections.length} sections · {exam.validatedSlots} items
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          className="min-h-11"
          disabled={isStarting}
          onClick={start}
          type="button"
        >
          Start the paper
        </Button>
      </CardContent>
    </Card>
  );
}

function SectionNav() {
  const { activeSection, exam } = usePaperScope();
  return (
    <nav aria-label="Paper sections" data-testid="exam-section-nav">
      <ol className="flex flex-wrap gap-2">
        {exam.sections.map((section) => {
          const active = section.id === activeSection?.id;
          return (
            <li
              aria-current={active ? "step" : undefined}
              className={
                active
                  ? "rounded-card border border-primary bg-primary px-3 py-2 text-primary-foreground text-xs"
                  : "rounded-card border border-border bg-card px-3 py-2 text-muted-foreground text-xs"
              }
              data-active={active ? "true" : "false"}
              data-section-id={section.id}
              data-section-status={section.status}
              data-testid={`exam-section-${section.id}`}
              key={section.id}
            >
              <span className="font-medium">
                {section.position + 1}{" "}
                {examSectionLabelForMode({ id: section.id, mode: exam.mode })}
              </span>
              <span className="ml-2">{sectionStateLabel(section.status)}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Timer() {
  const { activeSection, displayRemaining, exam } = usePaperScope();
  if (activeSection === null) {
    return null;
  }
  if (displayRemaining === null) {
    return (
      <span className="text-muted-foreground text-sm">shortened pace</span>
    );
  }
  const clock = formatExamTimer(displayRemaining);
  const value = exam.mode === "shortened" ? `shortened pace · ${clock}` : clock;
  return (
    <span
      aria-label="Section timer"
      aria-live="off"
      className="font-mono text-sm tabular-nums"
      data-paused={activeSection.paused ? "true" : "false"}
      data-testid="exam-timer"
      role="timer"
    >
      {value}
    </span>
  );
}

function TimerAnnouncement() {
  const { timerAnnouncement } = usePaperScope();
  return (
    <p
      aria-atomic="true"
      aria-live="polite"
      className="sr-only"
      data-testid="exam-timer-announcement"
    >
      {timerAnnouncement}
    </p>
  );
}

function SectionHeader() {
  const {
    activeSection,
    exam,
    isPaused,
    isPausing,
    isResuming,
    sectionHeadingRef,
    togglePause,
  } = usePaperScope();
  if (activeSection === null) {
    return null;
  }
  const pausePending = isPausing || isResuming;
  return (
    <Card data-testid="exam-section-header" size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs">
              Section {activeSection.position + 1}
            </p>
            <h2
              className="font-medium text-lg"
              id={`exam-section-heading-${activeSection.id}`}
              ref={sectionHeadingRef}
              tabIndex={-1}
            >
              {examSectionLabelForMode({
                id: activeSection.id,
                mode: exam.mode,
              })}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Timer />
            <Button
              aria-pressed={isPaused}
              className="min-h-11"
              disabled={pausePending}
              onClick={togglePause}
              type="button"
              variant="outline"
            >
              {isPaused ? "Resume" : t("exam.pause.action")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {exam.mode === "exam-conditions" ? (
          <p
            className="text-muted-foreground text-xs"
            data-testid="exam-pause-record"
          >
            {t("exam.pause.recorded", {
              count: activeSection.pauseCount,
              total: formatPausedTime(activeSection.pausedMs),
            })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stimulus() {
  const { activeQuestion } = usePaperScope();
  const passages = activeQuestion
    ? questionStimuli(activeQuestion.question)
    : [];
  if (passages.length === 0) {
    return null;
  }
  return (
    <section
      aria-label="Question stimulus"
      className="rounded-card border border-border bg-card p-4"
      data-testid="exam-stimulus"
    >
      {passages.map((passage) => (
        <p className="text-sm leading-relaxed" key={passage}>
          {passage}
        </p>
      ))}
    </section>
  );
}

function Question() {
  const {
    activeQuestion,
    activeSection,
    advance,
    exam,
    selectAnswer,
    handlePaperKeyDown,
    isAnswering,
    isPaused,
    selectedIndex,
  } = usePaperScope();
  if (activeQuestion === null) {
    if (exam.status !== "in_progress") {
      return null;
    }
    return (
      <Empty data-testid="exam-question-empty">
        <EmptyHeader>
          <EmptyTitle>No items in this section</EmptyTitle>
          <EmptyDescription>
            The paper has no question to show here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const heading = largeQuestionHeading(activeSection, activeQuestion.index);
  const instruction = largeQuestionInstruction(
    activeSection,
    activeQuestion.index
  );
  return (
    <section className="flex flex-col gap-3" data-testid="exam-question-pane">
      <p className="text-muted-foreground text-sm tabular-nums">
        Q {activeQuestion.index + 1}/{activeQuestion.total}
      </p>
      {heading === null ? null : (
        <p className="font-medium text-sm" data-testid="exam-large-question">
          {heading}
        </p>
      )}
      {instruction === null ? null : (
        <p className="text-sm" data-testid="exam-large-question-instruction">
          {instruction}
        </p>
      )}
      <Stimulus />
      <ExamQuestion
        disabled={isPaused || isAnswering}
        onKeyDown={handlePaperKeyDown}
        onSelect={selectAnswer}
        question={activeQuestion.question}
        selectedIndex={selectedIndex}
      />
      {activeQuestion.index < activeQuestion.total - 1 ? (
        <Button
          className="min-h-11 self-start"
          disabled={selectedIndex === null || isPaused || isAnswering}
          onClick={advance}
          type="button"
        >
          Next
        </Button>
      ) : null}
    </section>
  );
}

function SubmitSection() {
  const {
    activeSection,
    cancelConfirmation,
    confirmSubmit,
    confirmation,
    exam,
    isAdvancing,
    isFinalSection,
    isSubmitting,

    requestSubmit,
    unansweredCount,
  } = usePaperScope();
  if (exam.status !== "in_progress") {
    return null;
  }
  const isPaper = activeSection === null;
  const submitsPaper = isPaper || isFinalSection;
  const isOpen =
    confirmation !== null &&
    (confirmation.kind === "paper" || confirmation.kind === "section");
  if (!isOpen) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3"
        data-testid="exam-submit-section"
      >
        <p
          className="text-muted-foreground text-sm"
          data-testid="exam-unanswered-count"
        >
          {unansweredCount} unanswered
        </p>
        <Button
          className="min-h-11"
          onClick={requestSubmit}
          type="button"
          variant={isPaper ? "default" : "outline"}
        >
          {submitsPaper ? "Submit paper" : t("exam.section.submit")}
        </Button>
      </div>
    );
  }
  const pending = isAdvancing || isSubmitting;
  return (
    <Card data-testid="exam-submit-confirm" size="sm">
      <CardHeader>
        <CardTitle>
          {isPaper || isFinalSection
            ? "Submit this paper?"
            : t("exam.section.submit")}
        </CardTitle>
        <CardDescription>
          {unansweredCount} questions unanswered.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          className="min-h-11"
          disabled={pending}
          onClick={confirmSubmit}
          type="button"
        >
          {isPaper || isFinalSection ? "Submit paper" : "Submit section"}
        </Button>
        <Button
          className="min-h-11"
          disabled={pending}
          onClick={cancelConfirmation}
          type="button"
          variant="ghost"
        >
          Keep going
        </Button>
      </CardContent>
    </Card>
  );
}

interface ReviewRowActions {
  dispute: () => void;
  replay: () => void;
}

/**
 * The review row's two action bindings, as a pure factory.
 *
 * `ReviewRow` used to build these inline, which made them invisible to every
 * test: the desktop has no DOM env, so a render-only assertion cannot tell a
 * wired button from a dead one — a `Dispute` action that did nothing passed
 * the whole suite. A factory that takes the scope callbacks returns handlers a
 * test can invoke and pin to the exact item, so a swapped or dropped binding
 * fails loudly.
 */
const reviewRowActions = ({
  dispute,
  item,
  replay,
}: {
  dispute: (itemId: string) => void;
  item: ExamDebriefItem;
  replay: (item: ExamDebriefItem) => void;
}): ReviewRowActions => ({
  dispute: () => dispute(item.itemId),
  replay: () => replay(item),
});

/**
 * The line a review row prints for one item (TASK-173.2 AC#2). The same rule
 * the question pane uses, because a learner who was asked in Japanese and is
 * then shown an English stem in the debrief is being told about a different
 * test. Null is a real outcome: a 文の文法1 小問 is its sentence, which the row
 * prints below this line as the stimulus.
 */
const reviewQuestionLine = (
  item: ExamDebriefItem["item"],
  mode: ExamMode
): string | null => (mode === "real" ? item.stem : item.prompt);

function ReviewRow({ item }: { item: ExamDebriefItem }) {
  const { dispute, exam, isDisputing, isReplaying, replay } = usePaperScope();
  const actions = useMemo(
    () => reviewRowActions({ dispute, item, replay }),
    [dispute, item, replay]
  );
  const anchorLine = reviewAnchorLine(item);
  const scriptLine = reviewScriptLine(item);
  const line = reviewQuestionLine(item.item, exam.mode);
  return (
    <li
      className="flex flex-col gap-3 border-border border-t px-4 py-4 first:border-t-0"
      data-correct={item.correct === true ? "true" : "false"}
      data-disputed={item.disputed ? "true" : "false"}
      data-item-id={item.itemId}
      data-testid="exam-review-row"
    >
      <details>
        <summary className="cursor-pointer font-medium text-sm">
          Q {item.order + 1}. {line}
        </summary>
        {questionStimuli(item.item).map((passage) => (
          <p
            className="mt-2 text-muted-foreground text-sm leading-relaxed"
            key={passage}
          >
            {passage}
          </p>
        ))}
        {scriptLine === null ? null : (
          <p
            className="mt-2 text-muted-foreground text-sm leading-relaxed"
            data-testid="exam-review-script"
          >
            {scriptLine}
          </p>
        )}
      </details>
      <ul
        aria-label="Answer options"
        className="grid gap-1 text-sm sm:grid-cols-2"
      >
        {item.item.options.map((option, index) => (
          <li
            className={reviewOptionClass(
              index,
              item.correctIndex,
              item.selectedIndex
            )}
            data-correct={index === item.correctIndex ? "true" : "false"}
            data-selected={index === item.selectedIndex ? "true" : "false"}
            key={option}
          >
            {reviewOptionLabel(option, index)}
            {index === item.correctIndex ? " ✓" : null}
          </li>
        ))}
      </ul>
      <div className="grid gap-1 text-sm sm:grid-cols-2">
        <p data-testid="exam-review-pick">
          {t("exam.review.yourPick", {
            answer: item.selectedOption ?? "No pick",
          })}
        </p>
        <p data-testid="exam-review-answer">
          {t("exam.review.answer", { answer: item.correctOption })}
        </p>
      </div>
      {anchorLine === null ? null : (
        <p
          className="text-muted-foreground text-xs"
          data-testid="exam-review-anchor"
        >
          {anchorLine}
        </p>
      )}
      {shouldRenderExplanation(item) ? (
        <div className="rounded-card bg-muted px-3 py-2 text-sm">
          <p className="font-medium text-xs">{t("drill.explain.generated")}</p>
          <p>{item.explanation}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11"
          disabled={isReplaying}
          onClick={actions.replay}
          type="button"
          variant="outline"
        >
          {t("exam.review.replay")}
        </Button>
        <Button
          className="min-h-11"
          disabled={isDisputing || item.disputed}
          onClick={actions.dispute}
          type="button"
          variant="ghost"
        >
          {item.disputed ? "Disputed" : t("exam.review.dispute")}
        </Button>
      </div>
    </li>
  );
}

function Review() {
  const {
    debrief,
    debriefError,
    exam,
    isDebriefPending,
    isReviewOpen,
    isSendingToDesk,
    sendToDesk,
    toggleReview,
  } = usePaperScope();
  if (!shouldRenderExamReview(exam.status)) {
    return null;
  }
  if (!isReviewOpen) {
    return (
      <Button
        className="self-start"
        data-testid="exam-review-open"
        onClick={toggleReview}
        type="button"
        variant="outline"
      >
        {t("exam.review.title")}
      </Button>
    );
  }
  return (
    <section
      aria-labelledby="exam-review-heading"
      className="flex flex-col gap-3"
      data-testid="exam-review"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium text-lg" id="exam-review-heading">
          {t("exam.review.title")}
        </h2>
        <Button
          aria-pressed="true"
          className="min-h-11"
          onClick={toggleReview}
          type="button"
          variant="ghost"
        >
          Hide review
        </Button>
      </div>
      {isDebriefPending ? (
        <p className="text-muted-foreground text-sm" role="status">
          Loading answers.
        </p>
      ) : null}
      {debriefError ? (
        <p className="text-destructive text-sm" role="alert">
          {debriefError.message}
        </p>
      ) : null}
      {debrief?.items.length === 0 ? (
        <p className="text-muted-foreground text-sm" role="status">
          No answers were saved for this paper.
        </p>
      ) : null}
      {debrief && debrief.items.length > 0 ? (
        <ul className="rounded-card border border-border bg-card">
          {debrief.items
            .slice()
            .sort((left, right) => left.order - right.order)
            .map((item) => (
              <ReviewRow item={item} key={item.itemId} />
            ))}
        </ul>
      ) : null}
      {debrief?.items.some((item) => item.correct === false) ? (
        <Button
          className="self-start"
          disabled={isSendingToDesk}
          onClick={sendToDesk}
          type="button"
          variant="outline"
        >
          {t("exam.review.sendToDesk")}
        </Button>
      ) : null}
    </section>
  );
}

type BandResult = Extract<ExamResult, { scoring: "band" }>;
type RawResult = Extract<ExamResult, { scoring: "raw-only" }>;

const resultDescription = (
  label: ExamState["label"],
  result: ExamResult | undefined
): string => {
  if (result?.scoring === "raw-only") {
    return t("paper.result.rawOnly");
  }
  if (label === "real-paper-banded") {
    return t("paper.mode.real");
  }
  return t(
    label === "exam-conditions"
      ? "paper.mode.examConditions"
      : "paper.mode.shortened"
  );
};

function ResultStatus({
  error,
  isPending,
}: {
  error: Error | null;
  isPending: boolean;
}) {
  if (isPending) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Loading result.
      </p>
    );
  }
  if (error === null) {
    return null;
  }
  return (
    <p className="text-destructive text-sm" role="alert">
      {error.message}
    </p>
  );
}

function BandResultView({ result }: { result: BandResult }) {
  return (
    <div className="flex flex-col gap-3" data-testid="exam-band-result">
      <p
        className="text-muted-foreground text-sm"
        data-testid="exam-result-estimate"
      >
        {t("paper.result.estimate")}
      </p>
      <p
        className="font-medium text-base"
        data-gate="overall"
        data-passed={result.overall.passed ? "true" : "false"}
      >
        {t("paper.result.overall", {
          max: result.overall.maxScore,
          score: result.overall.score,
        })}
      </p>
      <p className="text-sm">
        {t("paper.result.twoGates", {
          mark: result.overall.passMark,
          max: result.overall.maxScore,
          total: result.overall.score,
        })}
      </p>
      <p
        className={
          result.overall.passed
            ? "text-sm text-success"
            : "text-destructive text-sm"
        }
      >
        {result.overall.passed
          ? t("paper.result.reachesMark")
          : t("paper.result.belowMark")}
      </p>
      <ul aria-label="Scored sections" className="flex flex-col gap-2">
        {result.sections.map((section) => (
          <li
            className="flex items-baseline justify-between gap-3 text-sm"
            data-gate="section"
            data-passed={section.passed ? "true" : "false"}
            data-section-id={section.id}
            key={section.id}
          >
            <span>
              {examScoringSectionLabelForMode({
                id: section.id,
                level: result.level,
                mode: result.mode,
              })}
            </span>
            <span className="tabular-nums">
              {section.score}/{section.maxScore} ·{" "}
              {t("paper.result.markValue", { mark: section.passMark })} ·{" "}
              {section.passed
                ? t("paper.result.reachesMark")
                : t("paper.result.belowMark")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RawResultView({ result }: { result: RawResult }) {
  return (
    <div
      className="flex flex-col gap-3"
      data-shortened-result="true"
      data-testid="exam-raw-result"
    >
      <p className="font-medium text-base">
        {result.overall.correct}/{result.overall.total} correct
      </p>
      <ul aria-label="Raw section counts" className="flex flex-col gap-2">
        {result.sections.map((section) => (
          <li
            className="flex items-baseline justify-between gap-3 text-sm"
            key={section.id}
          >
            <span>
              {examScoringSectionLabelForMode({
                id: section.id,
                level: result.level,
                mode: result.mode,
              })}
            </span>
            <span className="tabular-nums">
              {section.correct}/{section.total}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultDetails({ result }: { result: ExamResult | undefined }) {
  if (result === undefined) {
    return null;
  }
  if (result.scoring === "band") {
    return <BandResultView result={result} />;
  }
  return <RawResultView result={result} />;
}

function Result() {
  const { debrief, exam, result } = usePaperScope();
  if (exam.status !== "submitted") {
    return null;
  }
  return (
    <Card
      data-debrief-items={debrief?.items.length ?? 0}
      data-scoring={result.data?.scoring}
      data-testid="exam-result"
      size="sm"
    >
      <CardHeader>
        <CardTitle>Result</CardTitle>
        <CardDescription>
          {resultDescription(exam.label, result.data)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ResultStatus error={result.error} isPending={result.isPending} />
        <ResultDetails result={result.data} />
        {result.data !== undefined && exam.mode === "exam-conditions" ? (
          <p
            className="text-muted-foreground text-xs"
            data-testid="exam-result-pauses"
          >
            {t("exam.pause.recorded", {
              count: result.data.pauses.count,
              total: formatPausedTime(result.data.pauses.totalMs),
            })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Abandon() {
  const {
    abandon,
    cancelConfirmation,
    confirmation,
    exam,
    isAbandoning,
    requestAbandon,
  } = usePaperScope();
  if (exam.status === "submitted") {
    return null;
  }
  if (exam.status === "abandoned") {
    return (
      <Card data-testid="exam-abandoned" role="status" size="sm">
        <CardHeader>
          <CardTitle>{t("exam.abandon.done")}</CardTitle>
        </CardHeader>
      </Card>
    );
  }
  if (confirmation?.kind !== "abandon") {
    return (
      <Button
        className="self-start"
        data-testid="exam-abandon"
        disabled={isAbandoning}
        onClick={requestAbandon}
        type="button"
        variant="outline"
      >
        Abandon
      </Button>
    );
  }
  return (
    <Card data-testid="exam-abandon-confirm" size="sm">
      <CardHeader>
        <CardTitle>{t("exam.abandon.confirm")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          className="min-h-11"
          disabled={isAbandoning}
          onClick={abandon}
          type="button"
          variant="destructive"
        >
          Abandon
        </Button>
        <Button
          className="min-h-11"
          disabled={isAbandoning}
          onClick={cancelConfirmation}
          type="button"
          variant="ghost"
        >
          Keep paper
        </Button>
      </CardContent>
    </Card>
  );
}

export const PaperScope = Object.assign(PaperScopeRoot, {
  Abandon,
  Question,
  Result,
  Review,
  SectionHeader,
  SectionNav,
  Stimulus,
  SubmitSection,
  Timer,
});

export function ExamPaperPane({
  collapsed,
  examId,
  onCollapsedChange,
}: ExamPaperPaneProps) {
  return (
    <PaperScope examId={examId}>
      <PaperHeader
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
      />
      <section
        aria-label="Paper"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
          <TimerAnnouncement />

          <ActionNotice />
          <DraftState />
          <ReadyState />

          <PaperScope.SectionNav />
          <PaperScope.SectionHeader />
          <PaperScope.Question />
          <PaperScope.SubmitSection />
          <PaperScope.Result />
          <PaperScope.Review />
          <PaperScope.Abandon />
        </div>
      </section>
    </PaperScope>
  );
}

const activeQuestionTestHelper = activeQuestionFor;
const findShortcut = shortcutToOptionIndex;

export const __test__ = {
  activeQuestion: activeQuestionTestHelper,
  activeQuestionFor,
  activeQuestionIndex,
  BandResultView,
  collapseDefault: isNarrowExamScreen,
  ExamQuestion,
  findShortcut,
  formatExamTimer,
  largeQuestionHeading,
  largeQuestionInstruction,
  paperModeCopyKey,
  parseCollapse: parseExamChatCollapse,
  parseExamChatCollapse,
  questionFromComposedItem,
  questionStimuli,
  RawResultView,
  resultDescription,
  reviewAnchorLine,
  reviewOptionLabel,
  reviewQuestionLine,
  reviewRowActions,
  reviewScriptLine,
  STORAGE_KEY: EXAM_CHAT_COLLAPSE_STORAGE_KEY,
  shortcutToOptionIndex,
  shouldBlockExamChat,
  shouldRenderExamReview,
  shouldRenderExplanation,
};
