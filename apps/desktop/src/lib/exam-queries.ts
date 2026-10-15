import type {
  ExamAdvanceSectionInput,
  ExamAnswerInput,
  ExamAnswerOutput,
  ExamDebrief,
  ExamDisputeInput,
  ExamDisputeOutput,
  ExamResult,
  ExamState,
} from "@manobu/api-contract";
import {
  type QueryClient,
  queryOptions,
  type UseMutationOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";

const EXAM_GC_TIME = 1000 * 60 * 5;
const EXAM_RETRY = 1;
const EXAM_STALE_TIME = 0;
const EXAM_POLL_INTERVAL = 1000;
const SUBMITTED_QUERY_GC_TIME = 1000 * 60 * 5;
const SUBMITTED_QUERY_RETRY = 0;
const SUBMITTED_QUERY_STALE_TIME = 1000 * 60;

const EXAM_ROOT_KEY = ["exam"] as const;

export const examKeys = {
  all: () => EXAM_ROOT_KEY,
  debrief: (examId: string) => [...examKeys.detail(examId), "debrief"] as const,
  detail: (examId: string) => [...EXAM_ROOT_KEY, examId] as const,
  result: (examId: string) => [...examKeys.detail(examId), "result"] as const,
  review: (examId: string) => [...examKeys.detail(examId), "review"] as const,
} as const;

export const examRefetchInterval = (
  state: Pick<ExamState, "status"> | undefined
): number | false =>
  state?.status === "in_progress" ? EXAM_POLL_INTERVAL : false;

export const examQueryOptions = (examId: string) =>
  queryOptions({
    gcTime: EXAM_GC_TIME,
    networkMode: "offlineFirst",
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      const state = await orpc.exam.get({ examId });
      signal.throwIfAborted();
      return state;
    },
    queryKey: examKeys.detail(examId),
    refetchInterval: (query) => examRefetchInterval(query.state.data),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: EXAM_RETRY,
    staleTime: EXAM_STALE_TIME,
  });

export const examResultQueryOptions = (examId: string, submitted = false) =>
  queryOptions({
    enabled: submitted && examId.length > 0,
    gcTime: SUBMITTED_QUERY_GC_TIME,
    networkMode: "offlineFirst",
    queryFn: async (): Promise<ExamResult> =>
      await orpc.exam.result({ examId }),
    queryKey: examKeys.result(examId),
    retry: SUBMITTED_QUERY_RETRY,
    staleTime: SUBMITTED_QUERY_STALE_TIME,
  });

export const examDebriefQueryOptions = (examId: string, submitted = false) =>
  queryOptions({
    enabled: submitted && examId.length > 0,
    gcTime: SUBMITTED_QUERY_GC_TIME,
    networkMode: "offlineFirst",
    queryFn: async (): Promise<ExamDebrief> =>
      await orpc.exam.debrief({ examId }),
    queryKey: examKeys.debrief(examId),
    retry: SUBMITTED_QUERY_RETRY,
    staleTime: SUBMITTED_QUERY_STALE_TIME,
  });

export const examReviewQueryOptions = (examId: string, submitted = false) =>
  queryOptions({
    enabled: submitted && examId.length > 0,
    gcTime: SUBMITTED_QUERY_GC_TIME,
    networkMode: "offlineFirst",
    queryFn: async (): Promise<ExamDebrief> =>
      await orpc.exam.review({ examId }),
    queryKey: examKeys.review(examId),
    retry: SUBMITTED_QUERY_RETRY,
    staleTime: SUBMITTED_QUERY_STALE_TIME,
  });

type ExamStateMutationOptions = UseMutationOptions<
  ExamState,
  Error,
  void,
  unknown
>;

type ExamAnswerMutationInput = Omit<ExamAnswerInput, "examId">;
type ExamAdvanceSectionMutationInput = Omit<ExamAdvanceSectionInput, "examId">;

type ExamAnswerMutationOptions = UseMutationOptions<
  ExamAnswerOutput,
  Error,
  ExamAnswerMutationInput,
  unknown
>;

type ExamAdvanceSectionMutationOptions = UseMutationOptions<
  ExamState,
  Error,
  ExamAdvanceSectionMutationInput,
  unknown
>;

type ExamDisputeMutationInput = Omit<ExamDisputeInput, "examId">;
type ExamDisputeMutationOptions = UseMutationOptions<
  ExamDisputeOutput,
  Error,
  ExamDisputeMutationInput,
  unknown
>;

const updateExamState = (
  queryClient: QueryClient,
  examId: string,
  state: ExamState
): void => {
  queryClient.setQueryData<ExamState>(examKeys.detail(examId), state);
};

const stateMutationOptions = (
  queryClient: QueryClient,
  examId: string,
  mutationFn: () => Promise<ExamState>
): ExamStateMutationOptions => ({
  mutationFn,
  networkMode: "offlineFirst",
  onMutate: async () => {
    await queryClient.cancelQueries({
      exact: true,
      queryKey: examKeys.detail(examId),
    });
  },
  onSuccess: (state) => {
    updateExamState(queryClient, examId, state);
  },
});

export const startExamMutationOptions = (
  queryClient: QueryClient,
  examId: string
): ExamStateMutationOptions =>
  stateMutationOptions(
    queryClient,
    examId,
    async () => await orpc.exam.start({ examId })
  );

export const pauseExamMutationOptions = (
  queryClient: QueryClient,
  examId: string
): ExamStateMutationOptions =>
  stateMutationOptions(
    queryClient,
    examId,
    async () => await orpc.exam.pause({ examId })
  );

export const resumeExamMutationOptions = (
  queryClient: QueryClient,
  examId: string
): ExamStateMutationOptions =>
  stateMutationOptions(
    queryClient,
    examId,
    async () => await orpc.exam.resume({ examId })
  );

export const answerExamMutationOptions = (
  queryClient: QueryClient,
  examId: string
): ExamAnswerMutationOptions => ({
  mutationFn: async (input: ExamAnswerMutationInput) =>
    await orpc.exam.answer({ ...input, examId }),
  networkMode: "offlineFirst",
  onMutate: async () => {
    await queryClient.cancelQueries({
      exact: true,
      queryKey: examKeys.detail(examId),
    });
  },
  onSuccess: ({ state }) => {
    updateExamState(queryClient, examId, state);
  },
});

export const advanceSectionMutationOptions = (
  queryClient: QueryClient,
  examId: string
): ExamAdvanceSectionMutationOptions => ({
  mutationFn: async (input: ExamAdvanceSectionMutationInput) =>
    await orpc.exam.advanceSection({ ...input, examId }),
  networkMode: "offlineFirst",
  onMutate: async () => {
    await queryClient.cancelQueries({
      exact: true,
      queryKey: examKeys.detail(examId),
    });
  },
  onSuccess: (state) => {
    updateExamState(queryClient, examId, state);
  },
});

export const disputeExamMutationOptions = (
  queryClient: QueryClient,
  examId: string
): ExamDisputeMutationOptions => ({
  mutationFn: async (input: ExamDisputeMutationInput) =>
    await orpc.exam.dispute({ ...input, examId }),
  networkMode: "offlineFirst",
  onSuccess: async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: examKeys.debrief(examId) }),
      queryClient.invalidateQueries({ queryKey: examKeys.review(examId) }),
    ]);
  },
});

export const submitExamMutationOptions = (
  queryClient: QueryClient,
  examId: string
): ExamStateMutationOptions =>
  stateMutationOptions(
    queryClient,
    examId,
    async () => await orpc.exam.submit({ examId })
  );

export const abandonExamMutationOptions = (
  queryClient: QueryClient,
  examId: string
): ExamStateMutationOptions =>
  stateMutationOptions(
    queryClient,
    examId,
    async () => await orpc.exam.abandon({ examId })
  );

export function useStartExam(examId: string) {
  const queryClient = useQueryClient();
  return useMutation(startExamMutationOptions(queryClient, examId));
}

export function usePauseExam(examId: string) {
  const queryClient = useQueryClient();
  return useMutation(pauseExamMutationOptions(queryClient, examId));
}

export function useResumeExam(examId: string) {
  const queryClient = useQueryClient();
  return useMutation(resumeExamMutationOptions(queryClient, examId));
}

export function useAnswerExam(examId: string) {
  const queryClient = useQueryClient();
  return useMutation(answerExamMutationOptions(queryClient, examId));
}

export function useAdvanceSection(examId: string) {
  const queryClient = useQueryClient();
  return useMutation(advanceSectionMutationOptions(queryClient, examId));
}

export function useDisputeExam(examId: string) {
  const queryClient = useQueryClient();
  return useMutation(disputeExamMutationOptions(queryClient, examId));
}

export function useSubmitExam(examId: string) {
  const queryClient = useQueryClient();
  return useMutation(submitExamMutationOptions(queryClient, examId));
}

export function useAbandonExam(examId: string) {
  const queryClient = useQueryClient();
  return useMutation(abandonExamMutationOptions(queryClient, examId));
}
