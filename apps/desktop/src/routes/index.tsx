import { createFileRoute, redirect } from "@tanstack/react-router";

import { getSetupDone } from "@/lib/learner-setup";

// data: local-state — pure redirect guard: first-run users go to
// /setup (sensei rail + mode grid), everyone else to /dashboard (the
// Today bento). Route-level beforeLoad replaces the old component-level
// useSyncExternalStore gate; the store itself is read by the pages.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: getSetupDone() ? "/dashboard" : "/setup" });
  },
});
