/**
 * TASK-79.1 (chatbot-template port): the transcript's empty state takes
 * `suggestions` and renders them as starter chips wired to the
 * Provider's send action. Contract pinned here: chips render only when
 * suggestions are passed (the read-only /dev/chat-history viewer passes
 * none), and each chip carries its prompt text.
 */
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { TMessagePaper } from "./chat-engine/types";
import { MessageTranscript } from "./message-transcript";
import { ChatSessionProvider } from "./provider";
import { installMemoryStorage } from "./test-storage";

// Bun runs every test file in ONE process, so a `globalThis.localStorage`
// stub installed by an earlier file (thinking-collapse.test.tsx seeds the
// chat blob with a thinking card) survives into this one and the Provider
// mounts a NON-empty transcript. Install a fresh empty storage before any
// mount, same pattern as persistence.test.ts.
installMemoryStorage();

const testQueryClient = new QueryClient({
  defaultOptions: {
    mutations: { retry: 0 },
    queries: { retry: 0, staleTime: 0 },
  },
});

const STARTERS = [
  { label: "Hiragana practice", prompt: "Quiz me on hiragana." },
  { label: "What does 食 mean?", prompt: "What does 食 mean?" },
];
const noop = () => undefined;

const render = (ui: React.ReactNode) =>
  renderToStaticMarkup(
    <QueryClientProvider client={testQueryClient}>
      <ChatSessionProvider>{ui}</ChatSessionProvider>
    </QueryClientProvider>
  );

describe("MessageTranscript empty state (TASK-79.1)", () => {
  test("renders starter chips with their labels when suggestions are passed", () => {
    const html = render(
      <MessageTranscript
        emptyDescription="What are we working on today?"
        emptyTitle="Morning, manobu!"
        suggestions={STARTERS}
      />
    );
    expect(html).toContain("Morning, manobu!");
    expect(html).toContain("Hiragana practice");
    expect(html).toContain("What does 食 mean?");
    // Outline chips are buttons (keyboard-accessible, template parity).
    expect(html).toContain("<button");
  });

  test("renders no chips when suggestions are omitted (read-only viewer)", () => {
    const html = render(
      <MessageTranscript emptyDescription="Read only" emptyTitle="Transcript" />
    );
    expect(html).toContain("Transcript");
    expect(html).not.toContain("<button");
  });

  test("passes the paper callback to the existing action without leaking keys", () => {
    const paper = {
      answerIndex: 2,
      conversation_id: "c1",
      correctIndex: 1,
      examId: "exam-1",
      id: "paper:exam-1",
      label: "shortened-paper-banded",
      level: "N5",
      mode: "shortened",
      msg_id: "m1",
      phase: "ready",
      script: "secret-paper-script",
      sections: [
        {
          id: "vocabulary",
          label: "Vocabulary",
          state: "ready",
          total: 10,
          validated: 10,
        },
      ],
      totalSlots: 10,
      type: "paper",
      validatedSlots: 10,
    } satisfies TMessagePaper & {
      answerIndex: number;
      correctIndex: number;
      script: string;
    };

    const withoutCallback = render(<MessageTranscript messages={[paper]} />);
    const withCallback = render(
      <MessageTranscript messages={[paper]} onOpenPaper={noop} />
    );

    expect(withoutCallback).not.toContain('data-testid="paper-start"');
    expect(withCallback).toContain('data-testid="paper-start"');
    expect(withCallback).toContain("Start the paper");
    expect(withCallback).not.toContain("answerIndex");
    expect(withCallback).not.toContain("correctIndex");
    expect(withCallback).not.toContain("secret-paper-script");
  });
});
