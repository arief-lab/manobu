import {
  conversationQueryOptions,
  messageHistoryQueryOptions,
} from "@manobu/chat-session/history";
import { ChatSessionProvider } from "@manobu/chat-session/provider";
import { t } from "@manobu/ui/lib/copy";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  ChatColumn,
  type ChatColumnHeaderProps,
} from "@/features/chat/chat-column";
import { useExamChatCollapse } from "@/features/exam/exam-collapse";
import {
  EXAM_CHAT_COLUMN_ID,
  ExamPaperPane,
} from "@/features/exam/exam-paper-pane";
import { shouldBlockExamChat } from "@/features/exam/exam-paper-scope";
import { chatTitle } from "@/lib/chat-title";
import { examQueryOptions } from "@/lib/exam-queries";

export const Route = createFileRoute("/exam/$examId")({
  component: RouteComponent,
  errorComponent: ({ error }) => (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-6 py-8">
      <p className="text-destructive text-sm">
        Failed to open the paper: {error.message}
      </p>
      <div className="flex gap-2">
        <Link
          className="inline-flex min-h-11 items-center rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
          to="/dashboard"
        >
          ← Back to desk
        </Link>
        <Link
          className="inline-flex min-h-11 items-center rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
          to="/chat/history"
        >
          Open chat history
        </Link>
      </div>
    </div>
  ),
  loader: async ({ context: { queryClient }, params }) => {
    const exam = await queryClient.ensureQueryData(
      examQueryOptions(params.examId)
    );
    const [conversation] = await Promise.all([
      queryClient.ensureQueryData(
        conversationQueryOptions(exam.conversationId)
      ),
      queryClient.ensureQueryData(
        messageHistoryQueryOptions({
          conversationId: exam.conversationId,
          known: true,
        })
      ),
    ]);
    return { conversation, exam };
  },
});

function ExamChatHeader(_: ChatColumnHeaderProps) {
  const { conversation } = Route.useLoaderData();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 className="font-medium text-sm">Paper chat</h2>
      <p className="truncate text-muted-foreground text-xs">
        {chatTitle(conversation)}
      </p>
    </div>
  );
}

function ExamWorkspace() {
  const { exam: initialExam } = Route.useLoaderData();
  const { data: exam } = useQuery(examQueryOptions(initialExam.examId));
  const [collapsed, setCollapsed] = useExamChatCollapse();
  const blockedMessage = shouldBlockExamChat(exam)
    ? t("exam.paused.composer")
    : null;
  const gridClassName = collapsed
    ? "grid h-full min-h-0 grid-cols-1 grid-rows-1"
    : "grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(360px,1fr)_minmax(360px,1fr)] lg:grid-cols-[minmax(360px,32%)_minmax(360px,1fr)] lg:grid-rows-1";

  return (
    <div
      className={gridClassName}
      data-chat-collapsed={collapsed ? "true" : "false"}
    >
      <div className="col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col lg:col-start-2">
        <ExamPaperPane
          collapsed={collapsed}
          examId={initialExam.examId}
          onCollapsedChange={setCollapsed}
        />
      </div>
      <aside
        aria-label="Paper conversation"
        className={
          collapsed
            ? "hidden"
            : "col-start-1 row-start-2 min-h-0 min-w-0 border-border border-t lg:col-start-1 lg:row-start-1 lg:border-t-0 lg:border-r"
        }
        id={EXAM_CHAT_COLUMN_ID}
      >
        {collapsed ? null : (
          <ChatColumn
            composerBlockedMessage={blockedMessage}
            header={ExamChatHeader}
          />
        )}
      </aside>
    </div>
  );
}

function RouteComponent() {
  const { conversation, exam } = Route.useLoaderData();
  const open = useMemo(
    () => ({
      agent: conversation.agent,
      assistant: conversation.assistant,
      conversationId: exam.conversationId,
    }),
    [conversation, exam.conversationId]
  );
  return (
    <ChatSessionProvider open={open}>
      <ExamWorkspace />
    </ChatSessionProvider>
  );
}
