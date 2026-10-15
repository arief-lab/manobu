import { describe, expect, it } from "bun:test";
import type { ExamAnswerOutput, ExamState } from "@manobu/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  abandonExamMutationOptions,
  advanceSectionMutationOptions,
  answerExamMutationOptions,
  disputeExamMutationOptions,
  examDebriefQueryOptions,
  examKeys,
  examQueryOptions,
  examRefetchInterval,
  examResultQueryOptions,
  examReviewQueryOptions,
  pauseExamMutationOptions,
  resumeExamMutationOptions,
  startExamMutationOptions,
  submitExamMutationOptions,
} from "@/lib/exam-queries";

const state: ExamState = {
  abandonedAt: null,
  answers: [],
  conversationId: "conversation-1",
  createdAt: "2026-09-25T00:00:00.000Z",
  currentSection: "vocabulary",
  examId: "exam-1",
  floor: { floors: [], scoring: "raw-only" },
  items: [],
  label: "shortened-paper-raw-only",
  level: "N5",
  mode: "shortened",
  ready: true,
  readyAt: "2026-09-25T00:00:00.000Z",
  request: {
    budget: {},
    focus: [],
    level: "N5",
    mode: "shortened",
    sections: ["vocabulary"],
    seed: "seed-1",
  },
  sections: [],
  seed: "seed-1",
  source: "generated",
  startedAt: null,
  status: "in_progress",
  submittedAt: null,
  totalSlots: 0,
  validatedSlots: 0,
};

describe("exam query keys and options", () => {
  it("builds hierarchical keys and live state polling", () => {
    expect(examKeys.all()).toEqual(["exam"]);
    expect(examKeys.detail("exam-1")).toEqual(["exam", "exam-1"]);
    expect(examKeys.result("exam-1")).toEqual(["exam", "exam-1", "result"]);
    expect(examKeys.debrief("exam-1")).toEqual(["exam", "exam-1", "debrief"]);
    expect(examKeys.review("exam-1")).toEqual(["exam", "exam-1", "review"]);
    expect(examRefetchInterval(undefined)).toBe(false);
    expect(examRefetchInterval({ status: "in_progress" })).toBe(1000);
    expect(examRefetchInterval({ status: "submitted" })).toBe(false);

    const options = examQueryOptions("exam-1");
    expect([...options.queryKey]).toEqual(["exam", "exam-1"]);
    expect(options.networkMode).toBe("offlineFirst");
    expect(options.staleTime).toBe(0);
    expect(options.gcTime).toBe(1000 * 60 * 5);
    expect(options.retry).toBe(1);
    expect(options.refetchIntervalInBackground).toBe(false);
  });

  it("keeps result and debrief reads disabled until submitted", () => {
    expect(examResultQueryOptions("exam-1").enabled).toBe(false);
    expect(examDebriefQueryOptions("exam-1").enabled).toBe(false);
    expect(examResultQueryOptions("exam-1", true).enabled).toBe(true);
    expect(examDebriefQueryOptions("exam-1", true).enabled).toBe(true);
    expect(examReviewQueryOptions("exam-1").enabled).toBe(false);
    expect(examReviewQueryOptions("exam-1", true).enabled).toBe(true);
    expect(
      disputeExamMutationOptions(new QueryClient(), "exam-1").mutationFn
    ).toBeDefined();
  });
});

describe("exam mutation cache updates", () => {
  it("replaces the cached state with each server response and does not patch before success", () => {
    const queryClient = new QueryClient();
    const previous: ExamState = { ...state, status: "ready" };
    queryClient.setQueryData(examKeys.detail("exam-1"), previous);

    const stateOptions = [
      startExamMutationOptions(queryClient, "exam-1"),
      pauseExamMutationOptions(queryClient, "exam-1"),
      resumeExamMutationOptions(queryClient, "exam-1"),
      submitExamMutationOptions(queryClient, "exam-1"),
      abandonExamMutationOptions(queryClient, "exam-1"),
    ];
    for (const options of stateOptions) {
      queryClient.setQueryData(examKeys.detail("exam-1"), previous);
      expect(
        queryClient.getQueryData<ExamState>(examKeys.detail("exam-1"))
      ).toEqual(previous);
      options.onSuccess?.(state, undefined, undefined, {
        client: queryClient,
        meta: undefined,
      });
      expect(
        queryClient.getQueryData<ExamState>(examKeys.detail("exam-1"))
      ).toEqual(state);
    }

    queryClient.setQueryData(examKeys.detail("exam-1"), previous);
    advanceSectionMutationOptions(queryClient, "exam-1").onSuccess?.(
      state,
      {},
      undefined,
      { client: queryClient, meta: undefined }
    );
    expect(
      queryClient.getQueryData<ExamState>(examKeys.detail("exam-1"))
    ).toEqual(state);

    const answerOutput: ExamAnswerOutput = {
      answer: {
        answeredAt: "2026-09-25T00:01:00.000Z",
        itemId: "item-1",
        section: "vocabulary",
        selectedIndex: 1,
      },
      recorded: true,
      state,
    };
    answerExamMutationOptions(queryClient, "exam-1").onSuccess?.(
      answerOutput,
      { itemId: "item-1", selectedIndex: 1 },
      undefined,
      { client: queryClient, meta: undefined }
    );
    expect(
      queryClient.getQueryData<ExamState>(examKeys.detail("exam-1"))
    ).toEqual(state);
  });
});
