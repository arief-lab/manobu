import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRouter, Link, RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import Loader from "@/shared/loader";
import { queryClient } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8">
      <h1 className="font-semibold text-xl">Not found</h1>
      <p className="text-muted-foreground text-sm">
        The page you requested does not exist.
      </p>
      {/* Link, not <a>: this renders inside RouterProvider — a raw anchor
       *  full-reloads the SPA (and in the Tauri shell re-boots the window)
       *  just to get home. (router audit 2026-09-14) */}
      <Link className="text-primary text-sm underline" to="/">
        Go home
      </Link>
    </div>
  );
}

function RouteError({ error }: { error: Error }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8">
      <h1 className="font-semibold text-xl">Something went wrong</h1>
      <p className="text-muted-foreground text-sm">{error.message}</p>
    </div>
  );
}

const router = createRouter({
  context: { queryClient },
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: NotFound,
  defaultPendingComponent: () => <Loader />,
  defaultPreload: "intent",
  routeTree,
  scrollRestoration: true,
  // TASK-30: debug/admin routes moved to /dev/; no env guard needed.
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* TASK-35 AC4: same opt-in gate as the router devtools in
          __root.tsx — DEV build AND ?devtools=1, so dev preview and
          screenshots never have the panel in the way. */}
      {import.meta.env.DEV && window.location.search.includes("devtools=1") ? (
        <ReactQueryDevtools
          buttonPosition="bottom-left"
          initialIsOpen={false}
        />
      ) : null}
    </QueryClientProvider>
  );
}
