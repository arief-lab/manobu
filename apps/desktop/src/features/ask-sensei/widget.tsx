import { ChatSessionProvider } from "@manobu/chat-session/provider";
import { Button } from "@manobu/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@manobu/ui/components/tooltip";
import { useLocation } from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useState } from "react";

// TASK-32.2: the panel (and its `@manobu/chat-session/message-transcript`
// dependency, which pulls streamdown → parse5/micromark/shiki, ~400kB min)
// is code-split behind React.lazy. The launcher stays in the index chunk;
// the parser cluster only downloads when the widget is first opened.
const AskSenseiPanel = lazy(() => import("./panel"));

/**
 * The third chat surface — a floating "ask Sensei" panel mounted
 * globally via `__root.tsx`. Its purpose is to prove that the
 * `{state, actions, meta}` interface from `<ChatSessionProvider>`
 * holds across N>2 surfaces: this widget reads `state.input/messages/
 * isSending/status`, `actions.send/onSubmit/onInputChange`, and
 * `meta.selectedAgentLabel`. It keeps a deliberately compact frame
 * (its own close header, no persona picker, no full-height shell chrome)
 * but reuses the shared `AgentModelModePickers` composer trio, so the CLI
 * picker — the app's core affordance — is present on this surface too.
 *
 * Each widget instance mounts its own Provider. The Provider owns
 * the widget's chat state — open/closed just swaps the visible
 * children but keeps the state. So closing the panel does NOT
 * erase the draft, the persona, or the messages.
 */
export function AskSenseiWidget() {
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  // Router audit (2026-09-14): the AppShell AI pane (and its /learn hide)
  // is gone — the bento's Ask tile is the desk chat entry, this launcher
  // is the entry on every other route. The exceptions are the routes that
  // ARE chat surfaces: /ai (TASK-79.2: it joined CHROME_FREE_PATHS, so
  // __root doesn't even mount this widget there — the page owns the
  // transcript, composer, and pickers; a floating second panel would
  // duplicate it and race the shared manobu:chat:v1 draft blob) and
  // /learn/conversation (launcher hidden while closed, per the original
  // rule). (The old /onboarding case died with the route.)
  const { pathname } = useLocation();
  if (
    !open &&
    (pathname.startsWith("/learn/conversation") ||
      pathname === "/exam" ||
      pathname.startsWith("/exam/"))
  ) {
    return null;
  }
  if (!open) {
    return <AskSenseiLauncher onOpen={handleOpen} />;
  }
  // TASK-57: the open-state panel needs a ChatSessionProvider — TASK-30
  // stripped it as "dead VITE_DEBUG refs" and every FAB open since threw
  // "useChatSession must be used within <ChatSessionProvider>" into the
  // error boundary. Owns the widget's chat state (draft/persona survive
  // close, per the JSDoc contract below).
  return (
    <ChatSessionProvider>
      <Suspense fallback={null}>
        <AskSenseiPanel onClose={handleClose} />
      </Suspense>
    </ChatSessionProvider>
  );
}

/** Floating action button at viewport's bottom-right. Closed state. */
function AskSenseiLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="fixed right-4 bottom-4 z-50">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Open Ask Sensei"
              className="size-12 rounded-full shadow-lg"
              onClick={onOpen}
              size="icon"
              type="button"
              variant="default"
            />
          }
        >
          <SparklesIcon />
        </TooltipTrigger>
        <TooltipContent>Ask Sensei</TooltipContent>
      </Tooltip>
    </div>
  );
}
