import type { PersonaOption } from "@manobu/api-contract";
import {
  type ContextUsageTier,
  type ContextUsageView,
  contextUsageView,
  latestContextUsage,
} from "@manobu/chat-session/chat-engine";
import {
  agentCatalogQueryOptions,
  personaCatalogQueryOptions,
} from "@manobu/chat-session/fetcher";
import {
  conversationQueryOptions,
  type MessageRow,
  messageHistoryQueryKey,
  messageHistoryQueryOptions,
} from "@manobu/chat-session/history";
import { getChatWsClient } from "@manobu/chat-session/orpc";
import {
  ChatSessionProvider,
  useChatSession,
} from "@manobu/chat-session/provider";
import { Picker } from "@manobu/ui/components/picker";
import { t } from "@manobu/ui/lib/copy";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { GraduationCapIcon, HistoryIcon } from "lucide-react";
import { type FormEvent, useCallback, useMemo, useState } from "react";
import { z } from "zod";
import {
  ChatColumn,
  type ChatColumnHeaderProps,
} from "@/features/chat/chat-column";
import { chatTitle } from "@/lib/chat-title";
import {
  type ExamPaperRequest,
  routeComposerSubmit,
} from "@/lib/composer-routing";
import { type IntentResult, resolveIntent } from "@/lib/intent";
import { orpc } from "@/lib/orpc";
import { paperBuildNotice } from "@/lib/paper-notice";

const DRILL_LEVEL_RE = /\bN[1-5]\b/i;
const DRILL_COUNT_RE = /\b(\d+)\s*(?:questions?|items?|more)?\b/i;

// TASK-101: `?c=<id>` is the history list's "open this conversation" link.
// `.catch(undefined)` keeps a malformed param from failing the route: an
// unparseable `c` is treated as "no conversation asked for" (a fresh chat),
// which is what a typo in the address bar should do.
const aiSearchSchema = z.object({
  c: z.string().min(1).optional().catch(undefined),
});

// TASK-79.1 (chatbot-template port): starter prompts for the empty
// state, rendered as outline chips by <MessageTranscript> (the
// template's Suggestions row). Hardcoded for now; persona-aware
// starters are a follow-up. No em dash in user copy (AGENTS.md R-02).
const STARTERS = [
  {
    label: "Hiragana practice",
    prompt: "Quiz me on hiragana, one character at a time.",
  },
  {
    label: "What does 食 mean?",
    prompt: "What does 食 mean? Show me the common words that use it.",
  },
  {
    label: "は vs が",
    prompt:
      "Explain the difference between は and が with simple N5 example sentences.",
  },
  {
    label: "Plan my week",
    prompt:
      "I have 20 minutes a day. Make me a study plan for this week, starting from hiragana.",
  },
] as const;

/** Header chip fill per context tier (TASK-103). Text stays the dark token
 * color on a light tint, so the label clears WCAG AA on the app's single
 * theme (contrast contract R-02); warning/danger only intensify the tint. */
const CONTEXT_TIER_CLASS: Record<ContextUsageTier, string> = {
  danger: "bg-destructive/15 text-destructive",
  normal: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
  warning: "bg-amber-500/15 text-amber-600",
};

/** TASK-103: the header's context-window readout. The agent reports
 * `{ used, size }` per turn (an `acp_context_usage` frame, durable so it
 * survives reload / agent restart); this renders the latest reading as a
 * compact chip with a normal / warning / danger fill so a long conversation
 * that is quietly filling the window is visible before it degrades (AC#1/#2).
 * The percentage is the agent's own `used / size`, never a guessed window
 * (AC#4): a conversation with no reported window size shows the raw token
 * count instead of inventing a percentage. */
function ContextUsageChip({ view }: { view: ContextUsageView }) {
  const tierClass = CONTEXT_TIER_CLASS[view.tier];
  const reading =
    view.percent === null
      ? `${view.used.toLocaleString()} tokens`
      : `context ${view.percent}%`;
  return (
    <span
      aria-label={
        view.percent === null
          ? `Context usage: ${view.used} tokens`
          : `Context window ${view.percent}% used`
      }
      className={`inline-flex items-center rounded-card border border-border px-2 py-1 text-xs tabular-nums ${tierClass}`}
      data-percent={view.percent ?? ""}
      data-testid="context-usage"
      data-tier={view.tier}
      role="img"
      title={`The agent has used ${view.used.toLocaleString()} of its ${view.size.toLocaleString()}-token context window.`}
    >
      {reading}
    </span>
  );
}

/** Whether a persona row is the active selection (explicit or default). */
function isPersonaSelected(
  selectedPersona: string | undefined,
  defaultPersonaId: string | undefined,
  persona: PersonaOption
): boolean {
  return (
    selectedPersona === persona.id ||
    (selectedPersona === undefined && persona.id === defaultPersonaId)
  );
}

/** Status-dot color for one persona row in the picker. */
function personaDotColor(
  selectedPersona: string | undefined,
  defaultPersonaId: string | undefined,
  persona: PersonaOption
): string {
  return isPersonaSelected(selectedPersona, defaultPersonaId, persona)
    ? "bg-primary"
    : "bg-muted-foreground/40";
}

export const Route = createFileRoute("/ai")({
  component: RouteComponent,
  // TASK-101: a bad `?c=` id fails the loader (unknown conversation) and this
  // is what the learner sees. It stays INSIDE the chrome-free family but
  // OUTSIDE `ChatRoute`/the provider, so the header's history pill never
  // mounts here. The error is a dead end unless the exits are rendered by
  // hand: back to the list, or start fresh.
  errorComponent: ({ error }) => (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-6 py-8">
      <p className="text-destructive text-sm">
        Failed to open the chat: {error.message}
      </p>
      <div className="flex gap-2">
        <Link
          className="inline-flex min-h-11 items-center rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
          to="/chat/history"
        >
          ← Back to history
        </Link>
        <Link
          className="inline-flex min-h-11 items-center rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
          to="/ai"
        >
          Start a new chat
        </Link>
      </div>
    </div>
  ),
  // TASK-101: `?c=<id>` opens a STORED conversation instead of the one the
  // blob points at. The loader fetches that row before the provider mounts
  // because it carries the conversation's agent binding, and resuming on a
  // different CLI cannot work (the stored acp_session_id belongs to the one
  // that made it). An unknown id fails here, as a route error, rather than
  // opening a blank chat that looks like lost history.
  loaderDeps: ({ search: { c } }) => ({ c }),
  loader: ({ context: { queryClient }, deps: { c } }) => {
    // TASK-115: sidecar unreachable must not throw the route into an error
    // boundary — the desk degrades honestly (dashboard.tsx:217) and /ai must
    // do the same. Each ensureQueryData is individually caught so a dead
    // /agents or /assistants still lets the route mount; the component
    // renders the inline error.offline state and keeps the shell usable.
    const safe = <T,>(p: Promise<T>): Promise<T | undefined> =>
      p.catch(() => undefined);
    return Promise.all([
      safe(queryClient.ensureQueryData(agentCatalogQueryOptions)),
      safe(queryClient.ensureQueryData(personaCatalogQueryOptions)),
      c
        ? safe(queryClient.ensureQueryData(conversationQueryOptions(c)))
        : Promise.resolve(undefined),
      // TASK-108: warm the persisted rows so an opened chat folds its stored
      // transcript on FIRST paint (the component reads the same cache key).
      // Identity still gates the mount above; this only fills the transcript.
      // `known: true` because the learner named this id in the URL: the
      // loader above is what confirms it (TASK-157).
      c
        ? safe(
            queryClient.ensureQueryData(
              messageHistoryQueryOptions({ conversationId: c, known: true })
            )
          )
        : Promise.resolve<MessageRow[]>([]),
    ]);
  },
  validateSearch: aiSearchSchema,
});

function RouteComponent() {
  const [, , opened] = Route.useLoaderData();
  // The seed object is memoised on the row, not rebuilt every render: the
  // provider treats `open` identity as "the caller changed which
  // conversation this mount should show".
  const open = useMemo(
    () =>
      opened
        ? {
            agent: opened.agent,
            assistant: opened.assistant,
            conversationId: opened.id,
          }
        : null,
    [opened]
  );
  return (
    <ChatSessionProvider open={open}>
      <ChatRoute />
    </ChatSessionProvider>
  );
}

// ── Route parts (TASK-81.5): each guard/picker cluster extracted so
// ChatRoute stays a linear composition. They read the chat-session
// context directly (same instance the route reads), so no prop plumbing.

/** Conversation-identity picker (persona); hidden until catalogs load. */
function PersonaPicker() {
  const { actions, meta, state: chat } = useChatSession();
  if (meta.personas.length === 0) {
    return null;
  }
  return (
    <Picker>
      <Picker.Trigger
        aria-label="Select persona"
        icon={GraduationCapIcon}
        maxWidthClassName="max-w-36"
      >
        {meta.selectedPersonaLabel}
      </Picker.Trigger>
      <Picker.Content align="end" className="w-64">
        <Picker.Heading>Persona</Picker.Heading>
        {meta.personas.map((persona) => (
          <Picker.Item
            dotClassName={personaDotColor(
              chat.selectedPersona,
              meta.defaultPersonaId,
              persona
            )}
            id={persona.id}
            key={persona.id}
            onSelect={actions.selectPersona}
            selected={isPersonaSelected(
              chat.selectedPersona,
              meta.defaultPersonaId,
              persona
            )}
          >
            <span className="block truncate">{persona.name}</span>
            {persona.description ? (
              <span className="block truncate text-[10px] text-muted-foreground">
                {persona.description}
              </span>
            ) : null}
          </Picker.Item>
        ))}
      </Picker.Content>
    </Picker>
  );
}

function ChatHeader({ messages }: ChatColumnHeaderProps) {
  const [, , opened] = Route.useLoaderData();
  const { state: chat } = useChatSession();
  const contextUsage = useMemo(() => {
    const usage = latestContextUsage(messages);
    return usage ? contextUsageView(usage) : null;
  }, [messages]);
  let sessionDotClass = "bg-muted-foreground/40";
  if (chat.status === "streaming" || chat.status === "submitted") {
    sessionDotClass = "bg-primary animate-pulse";
  } else if (chat.status === "error") {
    sessionDotClass = "bg-destructive";
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <Link
          className="inline-flex min-h-11 w-fit items-center rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
          data-testid="ai-back-desk"
          to="/dashboard"
        >
          ← desk
        </Link>
        <h2 className="flex items-center gap-2 font-medium text-sm">
          <span
            aria-hidden
            className={`inline-block size-2 shrink-0 rounded-full ${sessionDotClass}`}
            data-active={
              chat.status === "streaming" || chat.status === "submitted"
            }
            data-status={chat.status}
            data-testid="session-dot"
          />
          {chatTitle(opened)}
        </h2>
        <p className="text-muted-foreground text-xs/relaxed">
          {opened
            ? "Continuing a saved conversation."
            : "How can I help you today?"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {contextUsage ? <ContextUsageChip view={contextUsage} /> : null}
        <PersonaPicker />
        <Link
          aria-label="Chat history"
          className="inline-flex size-7 items-center justify-center rounded-card border border-border hover:bg-muted"
          data-testid="ai-history"
          search={{}}
          title="History"
          to="/chat/history"
        >
          <HistoryIcon />
        </Link>
      </div>
    </>
  );
}

function ChatRoute() {
  // Read the three slices of the chat-session surface. The split
  // matches `vercel-composition-patterns/state-context-interface`:
  // `state` (mutable runtime values), `actions` (imperative handles),
  // `meta` (auxiliary data the route renders but doesn't drive). The
  // prefixes at every call site below communicate *which* slice is
  // being read — meta data renders, state drives the next render,
  // actions mutate state.
  const { state: chat, actions, meta } = useChatSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDrill, setPendingDrill] = useState<{
    intent: IntentResult;
    text: string;
  } | null>(null);

  const startExplicitDrill = useCallback(
    (
      text: string,
      { fromComposer = false }: { fromComposer?: boolean } = {}
    ) => {
      const intent = resolveIntent(text);
      if (intent.tier !== "drill" || intent.confirmNeeded) {
        actions.send(text);
        return;
      }
      const level = text.match(DRILL_LEVEL_RE)?.[0]?.toUpperCase() ?? "N5";
      const countMatch = text.match(DRILL_COUNT_RE);
      const count = countMatch ? Number(countMatch[1]) : 10;
      return getChatWsClient()
        .chat.startDrill({
          anchors: intent.anchors,
          conversationId: meta.conversationId,
          count,
          level,
          seed: `explicit:${text}`,
          tier: "2",
        })
        .then((result) => {
          if (result.kind === "unavailable") {
            actions.setNotice("No item right now.", "warning");
          } else {
            actions.setNotice(null);
            // A drill from the composer is SPENT once it starts: this leg never
            // goes through `actions.onSubmit`, so nothing else clears the draft
            // and a second Enter silently starts a second drill. A suggestion
            // chip does not set the draft, so it must not clear one either.
            // "No item right now." keeps the text, because adjusting it is the
            // way out.
            if (fromComposer) {
              actions.setDraft("");
            }
          }
        })
        .catch(() => actions.setNotice("No item right now.", "warning"));
    },
    [actions, meta.conversationId]
  );

  /** TASK-147: the model-free paper. `/exam …` builds a real paper through the
   * same `exam.request` + `exam.assemble` pair the agent's `start_exam` host
   * tool calls, so the learner and the agent cannot get two different papers
   * from the same request. No counts here: the level's shipped budget decides
   * the size (doc-21 §9.2), and the card landing in the transcript is the
   * affordance (its own button opens the workspace).
   *
   * TASK-148 AC#6: the receipt is what the learner hears. The old code assembled
   * the paper, threw the receipt away, and said "Paper ready" either way, so a
   * paper the level could not fill was announced as one that was. */
  const startExplicitPaper = useCallback(
    (request: ExamPaperRequest) => {
      orpc.exam
        .request({
          conversationId: request.conversationId,
          focus: request.focus,
          level: request.level,
        })
        .then(async (receipt) => {
          const built = await orpc.exam.assemble({ examId: receipt.examId });
          await queryClient.invalidateQueries({
            queryKey: messageHistoryQueryKey(request.conversationId),
          });
          const notice = paperBuildNotice(built);
          actions.setNotice(notice.text, notice.tone);
          // The command is SPENT once the paper exists: this leg never calls
          // `actions.onSubmit`, so nothing else clears the draft and the learner
          // pressing Enter again silently asks for a second paper. A short build
          // keeps the text, because editing the level is the way out of it.
          if (built.ready) {
            actions.setDraft("");
          }
        })
        .catch(() => actions.setNotice(t("paper.build.failed")));
    },
    [actions, queryClient]
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      const text = chat.input.trim();
      const pending = pendingDrill;
      const route = routeComposerSubmit({
        conversationId: meta.conversationId,
        intent: resolveIntent(text),
        pending,
        text,
      });
      if (route.kind !== "chat") {
        event.preventDefault();
      }
      switch (route.kind) {
        case "chat": {
          actions.onSubmit(event);
          return;
        }
        case "drill": {
          startExplicitDrill(route.text, { fromComposer: true });
          return;
        }
        case "offer": {
          setPendingDrill({ intent: route.intent, text: route.text });
          actions.setNotice(route.intent.receipt, "info");
          return;
        }
        case "paper": {
          startExplicitPaper(route);
          return;
        }
        case "pending": {
          setPendingDrill(null);
          if (route.startDrill) {
            startExplicitDrill(route.text, { fromComposer: true });
            return;
          }
          actions.setNotice(route.receipt, "info");
          return;
        }
        default: {
          // Every kind the router can return is handled above; a new one has
          // to be dispatched here or the build fails.
          const unhandled: never = route;
          throw new Error(`unhandled composer route: ${String(unhandled)}`);
        }
      }
    },
    [
      actions,
      chat.input,
      meta.conversationId,
      pendingDrill,
      startExplicitDrill,
      startExplicitPaper,
    ]
  );

  const openPaper = useCallback(
    (examId: string) => {
      navigate({ params: { examId }, to: "/exam/$examId" });
    },
    [navigate]
  );

  return (
    <ChatColumn
      header={ChatHeader}
      onOpenPaper={openPaper}
      onSubmit={handleSubmit}
      onSuggestion={startExplicitDrill}
      suggestions={STARTERS}
    />
  );
}
