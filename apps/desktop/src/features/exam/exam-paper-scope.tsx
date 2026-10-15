import type {
  ExamDebrief,
  ExamDebriefItem,
  ExamMode,
  ExamResult,
  ExamSectionId,
  ExamSectionState,
  ExamState,
} from "@manobu/api-contract";
import {
  createKeepaliveFetchRpcClient,
  getChatWsClient,
} from "@manobu/chat-session/orpc";
import { t } from "@manobu/ui/lib/copy";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  examQueryOptions,
  examResultQueryOptions,
  examReviewQueryOptions,
  useAbandonExam,
  useAdvanceSection,
  useAnswerExam,
  useDisputeExam,
  usePauseExam,
  useResumeExam,
  useStartExam,
  useSubmitExam,
} from "@/lib/exam-queries";
import { orpc } from "@/lib/orpc";
import {
  type ActiveExamQuestion,
  activeQuestionFor,
  activeQuestionIndex,
  answerIds,
  shortcutToOptionIndex,
} from "./exam-question";

export type Confirmation =
  | { kind: "abandon" }
  | { kind: "paper" }
  | { kind: "section"; sectionId: ExamSectionId };

export type TimerValue = number | null;

const TIMER_THRESHOLDS = [300, 60, 0] as const;
type TimerThreshold = (typeof TIMER_THRESHOLDS)[number];

interface TimerAnnouncementRequest {
  alreadyAnnounced: ReadonlySet<string>;
  remainingSeconds: number;
  sectionId: string;
}

interface TimerAnnouncement {
  key: string;
  message: string;
}

const timerMessage = (threshold: TimerThreshold): string => {
  if (threshold === 300) {
    return t("exam.timer.fiveMin");
  }
  if (threshold === 60) {
    return t("exam.timer.oneMin");
  }
  return t("exam.section.timeUp");
};

const timerAnnouncementsFor = ({
  alreadyAnnounced,
  remainingSeconds,
  sectionId,
}: TimerAnnouncementRequest): TimerAnnouncement[] => {
  const announcements: TimerAnnouncement[] = [];
  for (const threshold of TIMER_THRESHOLDS) {
    if (remainingSeconds > threshold) {
      continue;
    }
    const key = `${sectionId}:${threshold}`;
    if (alreadyAnnounced.has(key)) {
      continue;
    }
    announcements.push({ key, message: timerMessage(threshold) });
  }
  return announcements;
};

interface ExitState {
  examId: string;
  sectionPaused: boolean;
  status: ExamState["status"];
}

export interface PaperScopeState {
  abandon: () => void;
  actionError: Error | null;
  activeQuestion: ActiveExamQuestion | null;
  activeSection: ExamSectionState | null;
  advance: () => void;
  cancelConfirmation: () => void;
  confirmation: Confirmation | null;
  confirmSubmit: () => void;
  debrief: ExamDebrief | undefined;
  debriefError: Error | null;
  displayRemaining: TimerValue;
  dispute: (itemId: string) => void;
  exam: ExamState;
  handlePaperKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  isAbandoning: boolean;
  isAdvancing: boolean;
  isAnswering: boolean;
  isDebriefPending: boolean;
  isDisputing: boolean;
  isFinalSection: boolean;
  isPaused: boolean;
  isPausing: boolean;
  isReplaying: boolean;
  isResuming: boolean;
  isReviewOpen: boolean;
  isSendingToDesk: boolean;
  isStarting: boolean;
  isSubmitting: boolean;
  replay: (item: ExamDebriefItem) => void;
  requestAbandon: () => void;
  requestSubmit: () => void;
  result: {
    data: ExamResult | undefined;
    error: Error | null;
    isPending: boolean;
  };
  sectionHeadingRef: RefObject<HTMLHeadingElement | null>;
  selectAnswer: (index: number) => void;
  selectedIndex: number | null;
  sendToDesk: () => void;
  start: () => void;
  timerAnnouncement: string;
  togglePause: () => void;
  toggleReview: () => void;
  unansweredCount: number;
}

export const shouldBlockExamChat = (
  exam: Pick<ExamState, "mode" | "status"> | null | undefined
): boolean => exam?.status === "in_progress" && exam.mode === "exam-conditions";

export const shouldRenderExamReview = (
  status: ExamState["status"] | undefined
): boolean => status === "submitted";

const PaperScopeContext = createContext<PaperScopeState | null>(null);

export const usePaperScope = (): PaperScopeState => {
  const value = useContext(PaperScopeContext);
  if (value === null) {
    throw new Error("PaperScope subcomponents must be used within PaperScope");
  }
  return value;
};

const keepaliveExamClient = createKeepaliveFetchRpcClient();
const ignoreFailure = (): undefined => undefined;

const pauseOnExit = (examId: string): void => {
  const fallback = () => {
    try {
      orpc.exam.pause({ examId }).catch(ignoreFailure);
    } catch {
      ignoreFailure();
    }
  };
  try {
    keepaliveExamClient.exam.pause({ examId }).then(ignoreFailure, fallback);
  } catch {
    fallback();
  }
};

const useExitPause = (examId: string, exitState: ExitState): void => {
  const stateRef = useRef(exitState);
  stateRef.current = exitState;
  useEffect(() => {
    let requested = false;
    const pauseIfRunning = () => {
      const { current } = stateRef;
      if (
        requested ||
        current.examId !== examId ||
        current.status !== "in_progress" ||
        current.sectionPaused
      ) {
        return;
      }
      requested = true;
      pauseOnExit(examId);
    };
    if (typeof window === "undefined") {
      return;
    }
    window.addEventListener("pagehide", pauseIfRunning);
    return () => {
      window.removeEventListener("pagehide", pauseIfRunning);
      pauseIfRunning();
    };
  }, [examId]);
};

interface ExamTimerOptions {
  activeSection: ExamSectionState | null;
  advanceSection: (input: { section: ExamSectionId }) => Promise<unknown>;
  answerPending: boolean;
  mode: ExamMode;
  status: ExamState["status"];
}

const useExamTimer = ({
  activeSection,
  advanceSection,
  answerPending,
  mode,
  status,
}: ExamTimerOptions) => {
  const [displayRemaining, setDisplayRemaining] = useState<TimerValue>(null);
  const [timerAnnouncement, setTimerAnnouncement] = useState("");
  const announcementKeys = useRef(new Set<string>());
  const timeUpSection = useRef<string | null>(null);
  const lastAnnouncementSection = useRef<string | null>(null);

  useEffect(() => {
    setDisplayRemaining(activeSection?.remainingSeconds ?? null);
    if (lastAnnouncementSection.current !== (activeSection?.id ?? null)) {
      lastAnnouncementSection.current = activeSection?.id ?? null;
      announcementKeys.current.clear();
      timeUpSection.current = null;
    }
  }, [activeSection?.id, activeSection?.remainingSeconds]);

  const timerRunning =
    status === "in_progress" &&
    activeSection !== null &&
    !activeSection.paused &&
    displayRemaining !== null;
  useEffect(() => {
    if (!timerRunning || typeof window === "undefined") {
      return;
    }
    const interval = window.setInterval(() => {
      setDisplayRemaining((current) =>
        current === null ? null : Math.max(0, current - 1)
      );
    }, 1000);
    return () => window.clearInterval(interval);
  }, [timerRunning]);

  useEffect(() => {
    if (
      status !== "in_progress" ||
      mode !== "exam-conditions" ||
      activeSection === null ||
      activeSection.paused ||
      answerPending ||
      displayRemaining === null
    ) {
      return;
    }
    const sectionId = activeSection.id;
    const announcements = timerAnnouncementsFor({
      alreadyAnnounced: announcementKeys.current,
      remainingSeconds: displayRemaining,
      sectionId,
    });
    for (const announcement of announcements) {
      announcementKeys.current.add(announcement.key);
      setTimerAnnouncement(announcement.message);
    }
    if (displayRemaining !== 0 || timeUpSection.current === sectionId) {
      return;
    }
    timeUpSection.current = sectionId;
    advanceSection({ section: sectionId }).catch(() => {
      if (timeUpSection.current === sectionId) {
        timeUpSection.current = null;
      }
    });
  }, [
    activeSection,
    advanceSection,
    answerPending,
    displayRemaining,
    mode,
    status,
  ]);

  return { displayRemaining, timerAnnouncement };
};

const unansweredInSection = (section: ExamSectionState): number => {
  const answered = answerIds(section.answers);
  return section.items.reduce(
    (count, entry) => count + (answered.has(entry.item.id) ? 0 : 1),
    0
  );
};

const unansweredInExam = (exam: ExamState): number =>
  exam.sections.reduce(
    (count, section) => count + unansweredInSection(section),
    0
  );

const isLastSectionInPaper = (
  section: ExamSectionState,
  sections: readonly ExamSectionState[]
): boolean =>
  !sections.some(
    (candidate) =>
      candidate.position > section.position && candidate.status === "pending"
  );

const unansweredCountFor = (
  exam: ExamState,
  activeSection: ExamSectionState | null
): number =>
  activeSection === null
    ? unansweredInExam(exam)
    : unansweredInSection(activeSection);

const finalSectionFor = (
  activeSection: ExamSectionState | null,
  sections: readonly ExamSectionState[]
): boolean =>
  activeSection === null ? true : isLastSectionInPaper(activeSection, sections);

interface ExamReviewActionOptions {
  debrief: ExamDebrief | undefined;
  exam: ExamState;
  examId: string;
}

interface ExamReviewActions {
  dispute: (itemId: string) => void;
  error: Error | null;
  isDisputing: boolean;
  isReplaying: boolean;
  isSendingToDesk: boolean;
  replay: (item: ExamDebriefItem) => void;
  sendToDesk: () => void;
}

const useExamReviewActions = ({
  debrief,
  exam,
  examId,
}: ExamReviewActionOptions): ExamReviewActions => {
  const disputeMutation = useDisputeExam(examId);
  const [isReplaying, setIsReplaying] = useState(false);
  const [isSendingToDesk, setIsSendingToDesk] = useState(false);
  const [replayError, setReplayError] = useState<Error | null>(null);

  const replay = useCallback(
    (item: ExamDebriefItem) => {
      if (isReplaying) {
        return;
      }
      setIsReplaying(true);
      setReplayError(null);
      getChatWsClient()
        .chat.startDrill({
          anchors: item.anchors,
          conversationId: exam.conversationId,
          count: 1,
          itemId: item.itemId,
          level: item.item.level,
          seed: `replay:${item.itemId}`,
          tier: "2",
        })
        .then((result) => {
          if (result.kind === "unavailable") {
            setReplayError(new Error("This item is not available for replay"));
          }
        })
        .catch((error: unknown) => {
          setReplayError(
            error instanceof Error ? error : new Error("Replay could not start")
          );
        })
        .finally(() => setIsReplaying(false));
    },
    [exam.conversationId, isReplaying]
  );

  const sendToDesk = useCallback(() => {
    const weakItems =
      debrief?.items.filter((item) => item.correct === false) ?? [];
    const anchors = [...new Set(weakItems.flatMap((item) => item.anchors))];
    if (anchors.length === 0 || isSendingToDesk) {
      return;
    }
    setIsSendingToDesk(true);
    setReplayError(null);
    getChatWsClient()
      .chat.startDrill({
        anchors,
        conversationId: exam.conversationId,
        count: Math.min(30, weakItems.length),
        level: exam.level,
        seed: `review:${examId}`,
        tier: "2",
      })
      .then((result) => {
        if (result.kind === "unavailable") {
          setReplayError(new Error("No desk practice is available yet"));
        }
      })
      .catch((error: unknown) => {
        setReplayError(
          error instanceof Error
            ? error
            : new Error("Desk practice could not start")
        );
      })
      .finally(() => setIsSendingToDesk(false));
  }, [debrief, exam.conversationId, exam.level, examId, isSendingToDesk]);

  const dispute = useCallback(
    (itemId: string) => {
      disputeMutation.mutate({ itemId });
    },
    [disputeMutation]
  );

  return {
    dispute,
    error: disputeMutation.error ?? replayError,
    isDisputing: disputeMutation.isPending,
    isReplaying,
    isSendingToDesk,
    replay,
    sendToDesk,
  };
};

export function PaperScopeRoot({
  children,
  examId,
}: {
  children: ReactNode;
  examId: string;
}) {
  const { data: exam } = useSuspenseQuery(examQueryOptions(examId));
  const submitted = exam.status === "submitted";
  const resultQuery = useQuery(examResultQueryOptions(examId, submitted));
  const debriefQuery = useQuery(examReviewQueryOptions(examId, submitted));
  const startMutation = useStartExam(examId);
  const pauseMutation = usePauseExam(examId);
  const resumeMutation = useResumeExam(examId);
  const answerMutation = useAnswerExam(examId);
  const advanceMutation = useAdvanceSection(examId);
  const submitMutation = useSubmitExam(examId);
  const abandonMutation = useAbandonExam(examId);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [isReviewOpen, setIsReviewOpen] = useState(true);
  const [pendingAnswer, setPendingAnswer] = useState<{
    itemId: string;
    selectedIndex: number;
  } | null>(null);
  const [questionIndex, setQuestionIndex] = useState<number | null>(null);
  const sectionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const {
    dispute,
    error: reviewError,
    isDisputing,
    isReplaying,
    isSendingToDesk,
    replay,
    sendToDesk,
  } = useExamReviewActions({
    debrief: debriefQuery.data,
    exam,
    examId,
  });
  const actionError =
    startMutation.error ??
    pauseMutation.error ??
    resumeMutation.error ??
    answerMutation.error ??
    advanceMutation.error ??
    submitMutation.error ??
    abandonMutation.error ??
    reviewError;

  const activeSection = useMemo(
    () =>
      exam.sections.find((section) => section.id === exam.currentSection) ??
      null,
    [exam.currentSection, exam.sections]
  );
  useEffect(() => {
    setQuestionIndex(activeQuestionIndex(activeSection));
  }, [activeSection]);

  useEffect(() => {
    const pendingItemId = pendingAnswer?.itemId;
    if (
      pendingItemId !== undefined &&
      (activeSection?.id !== exam.currentSection ||
        exam.answers.some((answer) => answer.itemId === pendingItemId))
    ) {
      setPendingAnswer(null);
    }
  }, [activeSection?.id, exam.answers, exam.currentSection, pendingAnswer]);

  useEffect(() => {
    if (answerMutation.error !== null) {
      setPendingAnswer(null);
    }
  }, [answerMutation.error]);

  const activeQuestion = useMemo(
    () =>
      activeQuestionFor(activeSection, exam.mode, questionIndex ?? undefined),
    [activeSection, exam.mode, questionIndex]
  );
  const serverSelectedIndex =
    activeSection?.answers.find(
      (answer) => answer.itemId === activeQuestion?.question.id
    )?.selectedIndex ?? null;
  const pending = pendingAnswer;
  const pendingSelectedIndex =
    pending !== null && pending.itemId === activeQuestion?.question.id
      ? pending.selectedIndex
      : null;
  const selectedIndex = serverSelectedIndex ?? pendingSelectedIndex;
  const unansweredCount = useMemo(
    () => unansweredCountFor(exam, activeSection),
    [activeSection, exam]
  );
  const finalSection = finalSectionFor(activeSection, exam.sections);

  const activationKey =
    exam.status === "in_progress" && activeSection !== null
      ? `${exam.currentSection ?? "none"}:${activeSection.startedAt ?? "none"}`
      : null;
  const lastActivation = useRef<string | null>(null);
  useEffect(() => {
    if (activationKey === null || lastActivation.current === activationKey) {
      return;
    }
    lastActivation.current = activationKey;
    if (typeof window === "undefined") {
      return;
    }
    const focusHeading = () => {
      sectionHeadingRef.current?.focus();
    };
    if (typeof window.requestAnimationFrame !== "function") {
      focusHeading();
      return;
    }
    const frame = window.requestAnimationFrame(focusHeading);
    return () => window.cancelAnimationFrame(frame);
  }, [activationKey]);

  const { displayRemaining, timerAnnouncement } = useExamTimer({
    activeSection,
    advanceSection: advanceMutation.mutateAsync,
    answerPending: answerMutation.isPending,
    mode: exam.mode,
    status: exam.status,
  });

  const selectAnswer = useCallback(
    (index: number) => {
      if (
        activeQuestion === null ||
        activeSection === null ||
        activeSection.paused ||
        answerMutation.isPending ||
        index < 0 ||
        index > 3
      ) {
        return;
      }
      setPendingAnswer({
        itemId: activeQuestion.question.id,
        selectedIndex: index,
      });
      answerMutation.mutate(
        {
          itemId: activeQuestion.question.id,
          selectedIndex: index,
        },
        {
          onError: () => setPendingAnswer(null),
        }
      );
    },
    [activeQuestion, activeSection, answerMutation]
  );
  const requestSubmit = useCallback(() => {
    if (activeSection === null) {
      setConfirmation({ kind: "paper" });
      return;
    }
    setConfirmation({ kind: "section", sectionId: activeSection.id });
  }, [activeSection]);
  const advance = useCallback(() => {
    if (activeQuestion === null || selectedIndex === null) {
      return;
    }
    if (activeQuestion.index < activeQuestion.total - 1) {
      setQuestionIndex(activeQuestion.index + 1);
      return;
    }
    requestSubmit();
  }, [activeQuestion, requestSubmit, selectedIndex]);
  const handlePaperKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      const { target } = event;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const inQuestion =
        target === event.currentTarget ||
        target.closest('[data-testid="exam-question"]') !== null;
      if (!inQuestion) {
        return;
      }
      if (event.key === "Enter") {
        if (target instanceof HTMLInputElement && target.type === "radio") {
          event.preventDefault();
          advance();
        }
        return;
      }
      const optionIndex = shortcutToOptionIndex(event.key);
      if (optionIndex === null) {
        return;
      }
      event.preventDefault();
      selectAnswer(optionIndex);
    },
    [advance, selectAnswer]
  );
  const start = useCallback(() => {
    startMutation.mutate();
  }, [startMutation]);
  const togglePause = useCallback(() => {
    if (activeSection === null) {
      return;
    }
    if (activeSection.paused) {
      resumeMutation.mutate();
      return;
    }
    pauseMutation.mutate();
  }, [activeSection, pauseMutation, resumeMutation]);
  const confirmSubmit = useCallback(() => {
    if (confirmation === null) {
      return;
    }
    if (confirmation.kind === "abandon") {
      return;
    }
    setConfirmation(null);
    if (confirmation.kind === "paper") {
      submitMutation.mutate();
      return;
    }
    const section = exam.sections.find(
      (candidate) => candidate.id === confirmation.sectionId
    );
    if (section === undefined) {
      return;
    }
    if (isLastSectionInPaper(section, exam.sections)) {
      submitMutation.mutate();
      return;
    }
    advanceMutation.mutate({ section: confirmation.sectionId });
  }, [advanceMutation, confirmation, exam.sections, submitMutation]);
  const requestAbandon = useCallback(() => {
    setConfirmation({ kind: "abandon" });
  }, []);
  const abandon = useCallback(() => {
    abandonMutation.mutate();
    setConfirmation(null);
  }, [abandonMutation]);
  const cancelConfirmation = useCallback(() => {
    setConfirmation(null);
  }, []);
  const toggleReview = useCallback(() => {
    setIsReviewOpen((current) => !current);
  }, []);

  useEffect(() => {
    if (exam.status === "submitted" || exam.status === "abandoned") {
      setConfirmation(null);
    }
  }, [exam.status]);

  useExitPause(examId, {
    examId,
    sectionPaused: activeSection?.paused ?? true,
    status: exam.status,
  });

  const value = useMemo<PaperScopeState>(
    () => ({
      abandon,
      actionError,
      activeQuestion,
      activeSection,
      advance,
      cancelConfirmation,
      confirmation,
      confirmSubmit,
      debrief: debriefQuery.data,
      debriefError: debriefQuery.error,
      displayRemaining,
      dispute,
      exam,
      handlePaperKeyDown,
      isAbandoning: abandonMutation.isPending,
      isAdvancing: advanceMutation.isPending,
      isAnswering: answerMutation.isPending,
      isDebriefPending: debriefQuery.isPending,
      isDisputing,
      isFinalSection: finalSection,
      isPaused: activeSection?.paused ?? false,
      isPausing: pauseMutation.isPending,
      isReplaying,
      isResuming: resumeMutation.isPending,
      isReviewOpen,
      isSendingToDesk,
      isStarting: startMutation.isPending,
      isSubmitting: submitMutation.isPending,
      replay,
      requestAbandon,
      requestSubmit,
      result: {
        data: resultQuery.data,
        error: resultQuery.error,
        isPending: resultQuery.isPending,
      },
      sectionHeadingRef,
      selectAnswer,
      selectedIndex,
      sendToDesk,
      start,
      timerAnnouncement,
      togglePause,
      toggleReview,
      unansweredCount,
    }),
    [
      abandon,
      abandonMutation.isPending,
      actionError,
      activeQuestion,
      activeSection,
      advance,
      advanceMutation.isPending,
      selectAnswer,
      answerMutation.isPending,
      cancelConfirmation,
      confirmSubmit,
      confirmation,
      debriefQuery.data,
      debriefQuery.error,
      debriefQuery.isPending,
      dispute,
      displayRemaining,
      exam,
      finalSection,
      handlePaperKeyDown,
      isDisputing,
      isReviewOpen,
      isReplaying,
      isSendingToDesk,
      pauseMutation.isPending,
      replay,
      requestAbandon,
      requestSubmit,
      sendToDesk,
      resultQuery.data,
      resultQuery.error,
      resultQuery.isPending,
      resumeMutation.isPending,
      selectedIndex,
      start,
      startMutation.isPending,
      submitMutation.isPending,
      timerAnnouncement,
      togglePause,
      toggleReview,
      unansweredCount,
    ]
  );

  return (
    <PaperScopeContext.Provider value={value}>
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background lg:min-w-[360px]"
        data-exam-id={examId}
        data-exam-paper="true"
        data-testid="exam-paper-pane"
      >
        {children}
      </div>
    </PaperScopeContext.Provider>
  );
}

export const __test__ = { timerAnnouncementsFor };
