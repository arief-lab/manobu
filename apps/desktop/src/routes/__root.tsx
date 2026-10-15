import { Toaster } from "@manobu/ui/components/sonner";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

// TASK-35 (AC4): devtools are opt-in per page load — DEV build AND an
// explicit ?devtools=1 query flag, so dev preview screenshots and flows
// never have the panel overlapping the surface under test.
const DevTools =
  import.meta.env.DEV && window.location.search.includes("devtools=1") ? (
    <TanStackRouterDevtools position="bottom-left" />
  ) : null;

import { AskSenseiWidget } from "@/features/ask-sensei/widget";
import { startCronDispatchLoop } from "@/lib/cron-dispatch";
import { ensureVad } from "@/lib/mic-stt";
import { queryClient } from "@/lib/query-client";
import { watchSidecarReady } from "@/lib/sidecar-ready";
import { ensureTts } from "@/lib/tts-init";
import { TtsProvider } from "@/lib/tts-voice";
import { isChromeFreePath } from "@/shared/chrome-free";
import Header from "@/shared/header";

import "../index.css";

import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

interface RouterAppContext {
  queryClient: QueryClient;
}

// data: local-state — __root owns the provider tree + boot effects
// (ensureVad, ensureTts, startCronDispatchLoop, watchSidecarReady) per
// TASK-21.3 AC1 + TASK-22
// Tier B. No route-level loader needed because there's nothing to fetch
// before the providers mount; the providers do their own lazy
// initialization. The AppShell sidebar/AI-pane layout is gone (router
// audit 2026-09-14): the bento desk + per-surface ← bars are the
// navigation, so the root only picks chrome-free vs Header chrome.
export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    links: [
      {
        href: "/favicon.ico",
        rel: "icon",
      },
    ],
    meta: [
      {
        title: "manobu",
      },
      {
        content: "manobu is a web application",
        name: "description",
      },
    ],
  }),
});

function RootComponent() {
  // TASK-21.3 AC1: init Silero VAD once at boot when the model is present
  // so `speech_status.vad_ready` is true by the time any mic surface opens.
  // Best-effort — no model / web-dev keeps the stub energy path alive.
  useEffect(() => {
    ensureVad().catch(() => undefined);
  }, []);
  // TASK-154 AC1: same boot pattern for the Supertonic TTS engine, so a
  // listening item plays without a dev route or Settings visit first.
  useEffect(() => {
    ensureTts().catch(() => undefined);
  }, []);
  // The window mounts while the sidecar is still migrating, so the first
  // probe can fail against a closed port and `retry: false` means nothing
  // re-asks. Re-probe when the shell announces the backend bound.
  useEffect(() => watchSidecarReady(queryClient), []);
  // TASK-22 Tier B: poll cron Running history and dispatch prompts into /ai.
  useEffect(() => startCronDispatchLoop(), []);
  const { pathname } = useLocation();
  const chromeFree = isChromeFreePath(pathname);
  return (
    <>
      <HeadContent />
      <TtsProvider>
        {chromeFree ? (
          <main className="h-svh w-full overflow-auto">
            <Outlet />
          </main>
        ) : (
          <div className="grid h-svh grid-rows-[auto_1fr]">
            <Header />
            <main
              className="mx-auto w-full flex-1 overflow-auto"
              style={{ maxWidth: "1600px" }}
            >
              <Outlet />
            </main>
          </div>
        )}
        <Toaster richColors />
      </TtsProvider>
      {/* Third chat surface. Mounts its own ChatSessionProvider
          independent of /ai and /chat-history. Read the JSDoc on
          AskSenseiWidget for the contract proof. Hidden on /ai
          (TASK-79.2): the page IS a chat surface; a floating second
          panel duplicates it and races the shared draft blob. */}
      {!chromeFree && <AskSenseiWidget />}
      {DevTools}
    </>
  );
}
