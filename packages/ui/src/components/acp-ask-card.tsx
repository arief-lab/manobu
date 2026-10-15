import { Button } from "@manobu/ui/components/button";
import { Card, CardContent } from "@manobu/ui/components/card";
import { Checkbox } from "@manobu/ui/components/checkbox";
import { Input } from "@manobu/ui/components/input";
import { Label } from "@manobu/ui/components/label";
import { cn } from "@manobu/ui/lib/utils";
import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * AcpAskCard — the AionUi ask_user card (TASK-80.4).
 *
 * Ported from AionUi's `MessageAcpAsk` to @manobu/ui + the sumi theme.
 * Renders a set of structured questions with per-question option
 * selections (single-select, multi-select, or free-text "Other").
 *
 * **All-answered gating**: the Submit button stays disabled until every
 * question has an answer (a chosen option, or a non-blank "Other"
 * free-text for questions that offer one).
 *
 * **Decline**: a Decline button sends a decline receipt (the caller wires
 * this to `chat.answerAsk` with `decline: true`).
 *
 * **Compact terminal states (TASK-86)**: once an ask is resolved — the
 * learner submitted/declined live, or the host replays a settled row via
 * the `resolution` prop — the card collapses to a one-line summary
 * (answers listed under their questions) instead of the full form. An
 * expired ask renders a compact failed line, never an empty shell.
 *
 * No `dark:` variants; all interactive controls are real elements with
 * `aria-label` / `aria-labelledby` (axe-clean).
 */

// ── Structural types (chat-session maps TMessageAsk in) ──

export interface AcpAskOption {
  description?: string;
  label: string;
}

export interface AcpAskQuestion {
  header?: string;
  multiSelect?: boolean;
  options: AcpAskOption[];
  question: string;
}

/** One submitted answer (a label list for multi-select, a string for
 * single-select or free-text "Other"). */
export interface AcpAskAnswer {
  labels: string[];
  question: string;
}

/**
 * The terminal state of a resolved ask (TASK-86). The chat-session part
 * derives this from the replayed row (`status` finish/error + the
 * persisted answer summary); the card itself derives the live-submit
 * variant from local state.
 */
export type AcpAskResolution =
  | { answers: AcpAskAnswer[]; kind: "answered" }
  | { kind: "declined" }
  | { kind: "expired" };

export interface AcpAskCardProps {
  className?: string;
  /**
   * Submit the collected answers (or a decline). Resolves on success
   * (the card collapses to its compact answered/declined state), rejects
   * on failure (retry). The caller wires this to `chat.answerAsk`.
   */
  onSubmit: (payload: {
    answers?: AcpAskAnswer[];
    decline?: boolean;
  }) => Promise<void>;
  questions: AcpAskQuestion[];
  /** A stable key for the request; when it changes the card re-arms. */
  requestKey?: string;
  /**
   * TASK-86: a persisted terminal state. When present the card renders
   * the compact summary directly and `onSubmit` is never called —
   * interactive only while the ask is still pending.
   */
  resolution?: AcpAskResolution;
  testIdPrefix?: string;
}

/** One question's local answer state. */
interface QuestionAnswerState {
  /** Chosen option labels (single-select: one entry; multi: many). */
  labels: string[];
  /** Free-text "Other" value (wins over labels when non-blank). */
  other: string;
}

type AnswerMap = Record<string, QuestionAnswerState>;

/** True when every question has an answer (a label or a non-blank Other). */
function allAnswered(questions: AcpAskQuestion[], answers: AnswerMap): boolean {
  return questions.every((q) => {
    const a = answers[q.question];
    if (a === undefined) {
      return false;
    }
    if (a.other.trim() !== "") {
      return true;
    }
    return a.labels.length > 0;
  });
}

/** Collect the answers into the submit shape (Other wins over labels). */
export function collectAnswers(
  questions: AcpAskQuestion[],
  answers: AnswerMap
): AcpAskAnswer[] {
  const result: AcpAskAnswer[] = [];
  for (const q of questions) {
    const a = answers[q.question];
    if (a === undefined) {
      continue;
    }
    if (a.other.trim() !== "") {
      result.push({ labels: [a.other.trim()], question: q.question });
    } else if (a.labels.length > 0) {
      result.push({ labels: a.labels, question: q.question });
    }
  }
  return result;
}

/** What the learner just sent; kept so the live compact state can render
 * the answer summary after the submit promise resolves (TASK-86). */
interface LiveSubmission {
  answers: AcpAskAnswer[];
  decline: boolean;
}

/** The terminal state implied by this card's own live submission, or null
 * while the form is still in flight. */
function liveTerminal(
  submitted: boolean,
  lastSubmission: LiveSubmission | null
): AcpAskResolution | null {
  if (!submitted || lastSubmission === null) {
    return null;
  }
  if (lastSubmission.decline) {
    return { kind: "declined" };
  }
  return { answers: lastSubmission.answers, kind: "answered" };
}

function terminalStatusLabel(kind: AcpAskResolution["kind"]): string {
  if (kind === "expired") {
    return "This question expired without an answer.";
  }
  if (kind === "declined") {
    return "Response declined";
  }
  return "Response sent";
}

/** The compact one-line summary a resolved ask collapses to (TASK-86):
 * status line plus, for answered asks, the question/answer list. */
function AskCardTerminal({
  className,
  terminal,
  testIdPrefix,
}: {
  className?: string;
  terminal: AcpAskResolution;
  testIdPrefix: string;
}) {
  const expired = terminal.kind === "expired";
  return (
    <Card
      className={cn(
        "w-full border-dashed bg-muted/30 ring-foreground/5",
        className
      )}
      data-slot="acp-ask-card"
      data-state={terminal.kind}
      data-testid={`${testIdPrefix}-card`}
      size="sm"
    >
      <CardContent className="p-3">
        <div
          className={cn(
            "flex items-center gap-1.5 text-xs",
            expired ? "text-destructive" : "text-muted-foreground"
          )}
          data-testid={`${testIdPrefix}-status`}
          role={expired ? "alert" : "status"}
        >
          {expired ? (
            <AlertTriangleIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <CheckIcon aria-hidden="true" className="size-3.5" />
          )}
          <span>{terminalStatusLabel(terminal.kind)}</span>
        </div>
        {terminal.kind === "answered" && terminal.answers.length > 0 ? (
          <dl
            className="mt-2 flex flex-col gap-1.5"
            data-slot="acp-ask-summary"
          >
            {terminal.answers.map((answer) => (
              <div data-testid={`${testIdPrefix}-answer`} key={answer.question}>
                <dt className="text-muted-foreground text-xs">
                  {answer.question}
                </dt>
                <dd className="text-sm">{answer.labels.join(", ")}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AcpAskCard({
  className,
  onSubmit,
  questions,
  resolution,
  requestKey,
  testIdPrefix = "acp-ask",
}: AcpAskCardProps) {
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [lastSubmission, setLastSubmission] = useState<LiveSubmission | null>(
    null
  );
  const [hasError, setHasError] = useState(false);
  const submittingRef = useRef(false);
  const requestEpochRef = useRef(0);

  // Re-arm when the request changes.
  const prevRequestKeyRef = useRef(requestKey);
  useEffect(() => {
    if (prevRequestKeyRef.current !== requestKey) {
      prevRequestKeyRef.current = requestKey;
      requestEpochRef.current += 1;
      submittingRef.current = false;
      setIsSubmitting(false);
      setSubmitted(false);
      setLastSubmission(null);
      setHasError(false);
      setAnswers({});
    }
  });

  const fieldIdBase = useId();
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const setAnswer = (
    question: string,
    update: Partial<QuestionAnswerState>
  ) => {
    setAnswers((prev) => ({
      ...prev,
      [question]: {
        labels: update.labels ?? prev[question]?.labels ?? [],
        other: update.other ?? prev[question]?.other ?? "",
      },
    }));
  };

  const toggleOption = (question: string, optionLabel: string) => {
    setAnswers((prev) => {
      const current = prev[question] ?? { labels: [], other: "" };
      if (current.labels.includes(optionLabel)) {
        return {
          ...prev,
          [question]: {
            ...current,
            labels: current.labels.filter((l) => l !== optionLabel),
          },
        };
      }
      return {
        ...prev,
        [question]: {
          ...current,
          labels: [...current.labels, optionLabel],
        },
      };
    });
  };

  // Stable row-level handlers (noJsxPropsBind). Each reads the option
  // key/label from the row's own data attributes, so one handler serves
  // all option rows without per-item closures.
  const onCheckboxClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const { dataset } = event.currentTarget;
      if (dataset.otherActive === "true") {
        return;
      }
      const { optionKey: qKey, optionLabel, multi } = dataset;
      const isMultiRow = multi === "true";
      if (qKey === undefined || optionLabel === undefined) {
        return;
      }
      if (isMultiRow) {
        toggleOptionRef.current(qKey, optionLabel);
      } else {
        const current = answersRef.current[qKey];
        const isAlreadySelected =
          current?.labels.includes(optionLabel) ?? false;
        setAnswerRef.current(qKey, {
          labels: isAlreadySelected ? [] : [optionLabel],
        });
      }
    },
    []
  );

  const onOtherInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const qKey = event.currentTarget.dataset.questionKey;
      if (qKey === undefined) {
        return;
      }
      setAnswerRef.current(qKey, {
        labels: [],
        other: event.currentTarget.value,
      });
    },
    []
  );

  const setAnswerRef = useRef(setAnswer);
  setAnswerRef.current = setAnswer;
  const toggleOptionRef = useRef(toggleOption);
  toggleOptionRef.current = toggleOption;

  const isComplete = allAnswered(questions, answers);

  const doSubmit = useCallback(() => {
    if (isSubmitting || submitted || !isComplete) {
      return;
    }
    const requestEpoch = requestEpochRef.current;
    submittingRef.current = true;
    setIsSubmitting(true);
    setHasError(false);
    const collected = collectAnswers(questions, answers);
    setLastSubmission({ answers: collected, decline: false });
    onSubmit({ answers: collected })
      .then(() => {
        if (requestEpochRef.current === requestEpoch) {
          setSubmitted(true);
        }
      })
      .catch(() => {
        if (requestEpochRef.current === requestEpoch) {
          setHasError(true);
        }
      })
      .finally(() => {
        if (requestEpochRef.current === requestEpoch) {
          submittingRef.current = false;
          setIsSubmitting(false);
        }
      });
  }, [isSubmitting, submitted, isComplete, questions, answers, onSubmit]);

  const doDecline = useCallback(() => {
    if (isSubmitting || submitted) {
      return;
    }
    const requestEpoch = requestEpochRef.current;
    submittingRef.current = true;
    setIsSubmitting(true);
    setHasError(false);
    setLastSubmission({ answers: [], decline: true });
    onSubmit({ decline: true })
      .then(() => {
        if (requestEpochRef.current === requestEpoch) {
          setSubmitted(true);
        }
      })
      .catch(() => {
        if (requestEpochRef.current === requestEpoch) {
          setHasError(true);
        }
      })
      .finally(() => {
        if (requestEpochRef.current === requestEpoch) {
          submittingRef.current = false;
          setIsSubmitting(false);
        }
      });
  }, [isSubmitting, submitted, onSubmit]);

  // The compact terminal view wins over the form: a persisted resolution
  // (reload/expire replay) or the live submit this card just sent.
  const terminal = resolution ?? liveTerminal(submitted, lastSubmission);

  if (terminal !== null) {
    return (
      <AskCardTerminal
        className={className}
        terminal={terminal}
        testIdPrefix={testIdPrefix}
      />
    );
  }

  const state: "default" | "retry" = hasError ? "retry" : "default";

  return (
    <Card
      className={cn(
        "w-full border-dashed bg-muted/30 ring-foreground/5",
        className
      )}
      data-slot="acp-ask-card"
      data-state={state}
      data-testid={`${testIdPrefix}-card`}
      size="sm"
    >
      <CardContent aria-busy={isSubmitting} className="p-3">
        <div className="flex flex-col gap-4">
          {questions.map((question, index) => {
            const qKey = question.question;
            const answer = answers[qKey] ?? { labels: [], other: "" };
            const isMulti = question.multiSelect === true;
            const fieldId = `${fieldIdBase}-q${index}`;
            const hasOther = question.options.length > 0;
            const answered =
              answer.other.trim() !== "" || answer.labels.length > 0;
            const showQuestionText = question.question !== question.header;
            return (
              <fieldset
                data-testid={`${testIdPrefix}-question-${index}`}
                disabled={isSubmitting}
                key={qKey}
              >
                <legend className="mb-1.5 font-medium" id={fieldId}>
                  {question.header ?? question.question}
                </legend>
                {showQuestionText ? (
                  <p
                    className="mb-2 text-muted-foreground text-xs"
                    data-slot="acp-ask-question-text"
                  >
                    {question.question}
                  </p>
                ) : null}
                <div
                  className="flex flex-col gap-2"
                  data-slot="acp-ask-options"
                >
                  {question.options.map((option, optionIndex) => {
                    const otherActive = answer.other.trim() !== "";
                    const isChecked =
                      !otherActive && answer.labels.includes(option.label);
                    const hasDescription = option.description !== undefined;
                    // base-ui's Checkbox renders a visible span plus a
                    // HIDDEN native input; the `id` lands on the input and
                    // the label's `for` activates THAT (spans aren't
                    // labelable), so the toggle handler must also sit on
                    // the label or clicking the option text does nothing.
                    // The id must stay whitespace-free: a label like
                    // "Total beginner" made the old `for="…-Total
                    // beginner"` reference unresolvable.
                    const optionId = `${fieldId}-o${optionIndex}`;
                    return (
                      <div
                        className="flex items-center gap-2"
                        data-testid={`${testIdPrefix}-option-${index}-${option.label}`}
                        key={option.label}
                      >
                        <Checkbox
                          aria-labelledby={fieldId}
                          checked={isChecked}
                          data-multi={isMulti ? "true" : "false"}
                          data-option-key={qKey}
                          data-option-label={option.label}
                          data-other-active={otherActive ? "true" : "false"}
                          disabled={otherActive}
                          id={optionId}
                          onClick={onCheckboxClick}
                          value={option.label}
                        />
                        <Label
                          className={cn(
                            "text-sm",
                            !otherActive && "cursor-pointer"
                          )}
                          data-multi={isMulti ? "true" : "false"}
                          data-option-key={qKey}
                          data-option-label={option.label}
                          data-other-active={otherActive ? "true" : "false"}
                          htmlFor={optionId}
                          onClick={otherActive ? undefined : onCheckboxClick}
                        >
                          {option.label}
                          {hasDescription ? (
                            <span className="text-muted-foreground text-xs">
                              {" "}
                              {option.description}
                            </span>
                          ) : null}
                        </Label>
                      </div>
                    );
                  })}
                  {hasOther ? (
                    <div
                      className="flex items-center gap-2"
                      data-testid={`${testIdPrefix}-other-${index}`}
                    >
                      <Input
                        aria-label={`Other answer for ${question.question}`}
                        data-question-key={qKey}
                        data-testid={`${testIdPrefix}-other-input-${index}`}
                        id={`${fieldId}-other`}
                        maxLength={500}
                        onChange={onOtherInputChange}
                        placeholder="Other"
                        value={answer.other}
                      />
                    </div>
                  ) : null}
                  {answered ? null : (
                    <span
                      className="text-muted-foreground text-xs"
                      data-slot="acp-ask-unanswered"
                    >
                      No answer selected
                    </span>
                  )}
                </div>
              </fieldset>
            );
          })}
        </div>

        {state === "default" ? (
          <div
            className="mt-4 flex items-center gap-2"
            data-slot="acp-ask-actions"
          >
            <Button
              data-testid={`${testIdPrefix}-submit`}
              disabled={!isComplete || isSubmitting}
              onClick={doSubmit}
              size="sm"
              type="button"
            >
              Submit
            </Button>
            <Button
              data-testid={`${testIdPrefix}-decline`}
              disabled={isSubmitting}
              onClick={doDecline}
              size="sm"
              type="button"
              variant="outline"
            >
              Decline
            </Button>
          </div>
        ) : null}

        {hasError ? (
          <div
            className="mt-2 flex items-center gap-1.5 text-destructive text-xs"
            data-testid={`${testIdPrefix}-error`}
            role="alert"
          >
            <AlertTriangleIcon aria-hidden="true" className="size-3.5" />
            <span>Response failed. Try again.</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
