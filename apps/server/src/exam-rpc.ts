import type { contract } from "@manobu/api-contract";
import type { RouterImplementer } from "@orpc/server";

import type { ChatContext } from "./chat-hub";
import {
  createExamService,
  type ExamGetUserDb,
  ExamServiceError,
  type ExamServiceErrorCode,
} from "./services/exam-service";

export type ExamBuilder = RouterImplementer<
  typeof contract,
  ChatContext & object
>["exam"];

type ExamErrorFactory = (input: { data: { message: string } }) => unknown;
type ExamErrorFactories = Partial<
  Record<ExamServiceErrorCode, ExamErrorFactory>
>;

const withExamErrors = async <Value>(
  errors: ExamErrorFactories,
  operation: () => Promise<Value>
): Promise<Value> => {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ExamServiceError)) {
      throw error;
    }
    const factory = errors[error.code];
    if (!factory) {
      throw error;
    }
    throw factory({ data: { message: error.message } });
  }
};

export const createExamHandlers = (
  exam: ExamBuilder,
  getUserDb: ExamGetUserDb
) => {
  const service = createExamService(getUserDb);

  return {
    abandon: exam.abandon.handler(async ({ context, errors, input }) =>
      withExamErrors(errors, () => service.abandon(input.examId, context))
    ),
    advanceSection: exam.advanceSection.handler(async ({ errors, input }) =>
      withExamErrors(errors, () => service.advanceSection(input))
    ),
    answer: exam.answer.handler(async ({ errors, input }) =>
      withExamErrors(errors, () => service.answer(input))
    ),
    assemble: exam.assemble.handler(async ({ context, errors, input }) =>
      withExamErrors(errors, () => service.assemble(input.examId, context))
    ),
    debrief: exam.debrief.handler(async ({ errors, input }) =>
      withExamErrors(errors, () => service.debrief(input.examId))
    ),
    dispute: exam.dispute.handler(async ({ errors, input }) =>
      withExamErrors(errors, () => service.dispute(input))
    ),
    get: exam.get.handler(async ({ errors, input }) =>
      withExamErrors(errors, () => service.get(input.examId))
    ),
    pause: exam.pause.handler(async ({ errors, input }) =>
      withExamErrors(errors, () => service.pause(input.examId))
    ),
    request: exam.request.handler(async ({ errors, input }) =>
      withExamErrors(errors, () => service.request(input))
    ),
    result: exam.result.handler(async ({ errors, input }) =>
      withExamErrors(errors, () => service.result(input.examId))
    ),
    resume: exam.resume.handler(async ({ errors, input }) =>
      withExamErrors(errors, () => service.resume(input.examId))
    ),
    review: exam.review.handler(async ({ errors, input }) =>
      withExamErrors(errors, () => service.review(input.examId))
    ),
    start: exam.start.handler(async ({ context, errors, input }) =>
      withExamErrors(errors, () => service.start(input.examId, context))
    ),
    status: exam.status.handler(async ({ errors, input }) =>
      withExamErrors(errors, () => service.status(input.examId))
    ),
    submit: exam.submit.handler(async ({ context, errors, input }) =>
      withExamErrors(errors, () => service.submit(input.examId, context))
    ),
  };
};
