/*
 * Dashboard (SCR-01, bento redesign) · the returning-user page rendered
 * at `/` once setup_done is set. Chrome-free by design (router audit
 * 2026-09-14: the AppShell chrome it once sat inside is retired · the
 * tiles ARE the navigation).
 *
 * Sensei's desk: one paper hero card (the day's single action from
 * deriveToday's stage ladder), honest data tiles around it, and a rail
 * that greets in prose. The ladder is the invariant: a user who never
 * practiced is never offered "Lesson 4" · every string derives from
 * real inputs (due count, practice days, goal, level).
 *
 * Data-honesty rule: tiles render only on data that exists NOW. The
 * Weak-spot tile needs revlog persistence (not built), so the grid
 * collapses instead of showing a placeholder. Path progress "12/40"
 * needs a phrase-count source (none yet), so the rail shows goal +
 * level, not a fake bar.
 *
 * Composition (Vercel pattern):
 *   <Dashboard>       provider (plan from live inputs)
 *     <Dashboard.Rail>     greeting + path + CLI status + redo setup
 *     <Dashboard.Hero>     the one action, goal motif backdrop, only pink
 *     <Dashboard.Due>      review count (big number or prose by stage)
 *     <Dashboard.Momentum> 7 day-dots + honest copy
 *     <Dashboard.Ask>      "not sure? ask sensei" escape hatch
 *     <Dashboard.Nudge>    stage-D touch-practice bubble (1/day, dismissible)
 *   </Dashboard>
 */

import { cn } from "@manobu/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { useCardsDue } from "@/lib/cards";
import { cliIdentityFor, cliMonogram } from "@/lib/cli-identity";
import { getLearnerLevel } from "@/lib/learner-level";
import type { GoalId } from "@/lib/learner-setup";
import { getGoal, resetSetup } from "@/lib/learner-setup";
import {
  lastDaysFlags,
  practicedDaysOfLast,
  recordPracticeDay,
} from "@/lib/practice-days";
import { type SenseiState, useSenseiStatus } from "@/lib/sensei";
import type { TodayPlan } from "@/lib/today";
import { deriveToday, momentumCopy } from "@/lib/today";

/* Small per-goal motifs for the hero backdrop · dimmed, decorative,
 * deliberately simpler than the setup page's full scenes (this file
 * must not import from features/setup · feature slices stay independent). */

const MOTIF_PATHS: Record<GoalId, ReactNode> = {
  anime: (
    <g>
      <rect height="48" rx="6" width="76" x="32" y="34" />
      <path d="M56 34 L44 12 M84 34 L96 12" />
    </g>
  ),
  fun: (
    <g>
      <rect height="34" rx="6" width="34" x="52" y="34" />
      <circle cx="62" cy="44" r="3" />
      <circle cx="76" cy="58" r="3" />
    </g>
  ),
  jlpt: (
    <g>
      <circle cx="70" cy="52" r="30" />
      <circle cx="70" cy="52" r="16" />
      <circle cx="70" cy="52" r="4" />
    </g>
  ),
  travel: (
    <g>
      <path d="M20 90 L60 30 L68 42 L76 28 L116 90" />
      <path d="M4 90 H132" />
    </g>
  ),
  work: (
    <g>
      <rect height="52" width="22" x="36" y="38" />
      <rect height="66" width="22" x="62" y="24" />
      <rect height="40" width="22" x="88" y="50" />
      <path d="M28 90 H118" />
    </g>
  ),
};

const PATH_LABEL: Record<GoalId, string> = {
  anime: "Immersion",
  fun: "Free Roam",
  jlpt: "JLPT",
  travel: "Travel",
  work: "Business",
};

/* Nudge dismissal: one calendar day (settings.nudge_last_shown analogue;
 * localStorage until the settings db wiring lands). */
const NUDGE_KEY = "manobu.nudgeDismissed";

const nudgeDismissedToday = (): boolean => {
  try {
    return (
      localStorage.getItem(NUDGE_KEY) === new Date().toISOString().slice(0, 10)
    );
  } catch {
    return false;
  }
};

const dismissNudgeToday = (): void => {
  try {
    localStorage.setItem(NUDGE_KEY, new Date().toISOString().slice(0, 10));
  } catch {
    // best-effort; the in-session dismiss still applies
  }
};

/* ── scope ────────────────────────────────────────────────────── */

interface DashboardContext {
  goal: GoalId | null;
  plan: TodayPlan;
}

const DashboardScope = createContext<DashboardContext>({
  goal: null,
  plan: deriveToday({
    dueCount: 0,
    goal: null,
    level: "N5",
    practicedDays: 0,
  }),
});

const useDashboard = (): DashboardContext => useContext(DashboardScope);

interface DashboardProps {
  children: ReactNode;
}

/* Chrome-free bento (no sidebar/AI pane here · the tiles ARE the
 * navigation): rail (col 1, all rows: greeting + motif + CLI + theme +
 * redo) | hero spanning cols 2-3 row 1 | Due tall col 4 rows 1-2 |
 * momentum + ask row 2 | nudge + browse row 3. Auto-placement walks the
 * DOM order; spans collapse honestly (no nudge → browse widens). */
const DashboardRoot = ({ children }: DashboardProps) => {
  const goal = getGoal();
  const level = getLearnerLevel();
  const { data } = useCardsDue();
  /* TASK-165: the tile counts the queue, not the page the read happened to
   * carry: a learner with 200 due was shown "20" and a ~3 minute estimate. */
  const dueCount = data?.dueCount ?? 0;
  const practicedDays = practicedDaysOfLast(7);
  const plan = deriveToday({ dueCount, goal, level, practicedDays });
  return (
    <DashboardScope.Provider value={{ goal, plan }}>
      <section
        aria-label="Today"
        className="mx-auto grid h-full max-w-350 grid-cols-1 gap-4 p-4 md:grid-cols-2 lg:grid-cols-[320px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)] lg:grid-rows-[1.15fr_1fr_auto]"
        data-stage={plan.stage}
        data-testid="dashboard"
      >
        {children}
      </section>
    </DashboardScope.Provider>
  );
};

/* ── rail ─────────────────────────────────────────────────────── */

const CliBadge = ({
  agentId,
  displayName,
}: {
  agentId: string;
  displayName: string;
}) => {
  const identity = cliIdentityFor(agentId);
  if (identity?.path) {
    return (
      <svg
        aria-hidden
        fill="currentColor"
        height={14}
        viewBox="0 0 24 24"
        width={14}
      >
        <path
          d={identity.path}
          fillRule={identity.evenOdd ? "evenodd" : undefined}
        />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-muted font-semibold text-[9px] leading-none"
    >
      {cliMonogram(displayName)}
    </span>
  );
};

/* The rail's CLI line, extracted so the JSX stays ternary-free. */
const senseiLine = (kind: SenseiState["kind"]): string => {
  switch (kind) {
    case "detecting":
      return "connecting to agent cli…";
    case "local-found":
      return "sensei is here";
    default:
      return "sensei offline · the desk still works";
  }
};

const DashboardRail = () => {
  const { plan, goal } = useDashboard();
  const { state } = useSenseiStatus();
  const navigate = useNavigate();
  const onRedo = useCallback(() => {
    resetSetup();
    navigate({ to: "/setup" });
  }, [navigate]);
  const level = getLearnerLevel();
  const found = state.kind === "local-found" ? state : null;
  return (
    <aside
      className="flex flex-col rounded-card border border-border bg-card/40 p-6 lg:row-span-3"
      data-testid="dashboard-rail"
    >
      <p className="font-medium text-muted-foreground text-sm">welcome back</p>
      <p aria-live="polite" className="mt-3 text-lg leading-relaxed">
        {plan.greeting}
      </p>
      {/* Path identity: label + the goal's motif art · fills the rail
          with WHO you are, not a fake progress bar. */}
      <p className="mt-6 text-muted-foreground text-sm">
        {goal === null
          ? "no path chosen yet"
          : `${PATH_LABEL[goal]}${goal === "jlpt" ? ` · ${level}` : ""}`}
      </p>
      {goal ? (
        <svg
          aria-hidden
          className="mt-6 h-36 w-full text-muted-foreground opacity-40"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 140 100"
        >
          {MOTIF_PATHS[goal]}
        </svg>
      ) : null}
      {/* The old landing footer's promise, relocated into the rail so the
          column earns its height instead of floating a void. */}
      <p className="mt-6 text-muted-foreground text-xs leading-relaxed">
        All offline · Tap any word for help · No streaks · Your data stays here
      </p>
      <div className="mt-auto flex items-center gap-2 pt-6 text-muted-foreground text-xs">
        <div className="flex items-center gap-2">
          {found ? (
            <CliBadge agentId={found.agentId} displayName={found.agent} />
          ) : (
            <span aria-hidden>{state.kind === "detecting" ? "◌" : "○"}</span>
          )}
          <span>{senseiLine(state.kind)}</span>
        </div>
        <button
          className="ml-auto underline underline-offset-2 hover:text-foreground"
          data-testid="redo-setup"
          onClick={onRedo}
          type="button"
        >
          redo setup
        </button>
      </div>
    </aside>
  );
};

/* ── hero: the one action ─────────────────────────────────────── */

const DashboardHero = () => {
  const { plan, goal } = useDashboard();
  const motif = goal ? MOTIF_PATHS[goal] : null;
  /* Inverted hero (sumi/kibari/ai/shu pass): the day's action is a
   * paper card with an ink headline, not a wall of dye. ai carries
   * the CTA rule + underline (the work), the motif sits in asagi (the
   * diluted bath). Focal point = size + position, not accent mass ·
   * DESIGN.md caps ai fields at 8% of a screen. */
  return (
    <Link
      className={cn(
        "group/hero relative flex min-h-44 flex-col justify-end overflow-hidden rounded-card",
        "border border-border bg-card p-6 text-card-foreground transition-transform",
        "hover:scale-[1.005] active:scale-[0.995] lg:col-span-2"
      )}
      data-stage={plan.stage}
      data-testid="dashboard-hero"
      onClick={recordPracticeDay}
      search={
        plan.hero.to === "/lesson"
          ? {
              goal: goal === "fun" || goal === null ? "travel" : goal,
              level: getLearnerLevel(),
            }
          : undefined
      }
      to={plan.hero.to}
    >
      {motif ? (
        <svg
          aria-hidden
          className="absolute inset-x-10 top-6 h-2/3 w-auto text-asagi opacity-60"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 140 100"
        >
          {motif}
        </svg>
      ) : null}
      <span className="relative">
        <span className="block font-medium text-muted-foreground text-sm">
          Today
        </span>
        <span className="mt-1 block font-semibold text-2xl">
          {plan.hero.cta}
        </span>
        <span
          aria-hidden
          className="mt-3 block h-0.5 w-10 bg-primary transition-all duration-200 group-hover/hero:w-16"
        />
      </span>
    </Link>
  );
};

/* ── due tile ─────────────────────────────────────────────────── */

const DashboardDue = () => {
  const { plan } = useDashboard();
  const copy = plan.due;
  return (
    <Link
      className="flex min-h-28 flex-col justify-center rounded-card border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/60 lg:row-span-2"
      data-testid="dashboard-due"
      to="/review"
    >
      {/* The due count is 朱: the seal that something is owed. Large
       * numerals only · shu clears 4.5:1 at this size, never small
       * text (DESIGN.md contrast contract). */}
      {copy.big ? (
        <>
          <span className="font-semibold text-7xl text-mark tabular-nums leading-none">
            {plan.dueCount}
          </span>
          <span className="mt-2 text-sm">{copy.line}</span>
          {copy.sub ? (
            <span className="mt-1 text-muted-foreground text-xs">
              {copy.sub}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-sm">
          {copy.line}
          {copy.sub ? (
            <span className="mt-1 block text-muted-foreground text-xs">
              {copy.sub}
            </span>
          ) : null}
        </span>
      )}
    </Link>
  );
};

/* ── momentum + escape hatch ──────────────────────────────────── */

const DashboardMomentum = () => {
  const practicedDays = practicedDaysOfLast(7);
  const copy = momentumCopy(practicedDays);
  const flags = lastDaysFlags(7);
  return (
    <div
      className="flex min-h-28 flex-col justify-center gap-3 rounded-card border border-border bg-card p-5"
      data-testid="dashboard-momentum"
    >
      <span className="mb-1 flex font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        last 7 days
      </span>
      {/* Three states, three meanings (墨・紙・藍・朱): ai = the work done,
       * shu = the mark of *now* (the seal, never a fill), nezu outline =
       * a day not yet lived. Honest state, not a streak promise. */}
      <span className="flex gap-1.5">
        {flags.map(({ iso, label, practiced, today }) => (
          <span className="flex flex-col items-center gap-1" key={iso}>
            <span
              aria-hidden
              className={cn(
                "size-3 rounded-full border border-border",
                practiced && "border-transparent bg-primary",
                today && "bg-mark"
              )}
            />
            <span aria-hidden className="text-[10px] text-muted-foreground">
              {label}
            </span>
          </span>
        ))}
      </span>
      <p aria-live="polite" className="text-sm">
        {copy.line}
        {copy.sub ? (
          <span className="block text-muted-foreground text-xs">
            {copy.sub}
          </span>
        ) : null}
      </p>
    </div>
  );
};

const ASK_EXAMPLES = [
  "“は vs が · when do I use each?”",
  "“is 食べる casual enough here?”",
  "“explain the て form with examples”",
] as const;

const DashboardAsk = () => (
  <Link
    className="flex min-h-28 flex-col justify-center gap-2 rounded-card border border-border border-dashed bg-card/40 p-5 text-sm transition-colors hover:border-primary/60 hover:text-foreground"
    data-testid="dashboard-ask"
    to="/ai"
  >
    <span>
      <span className="font-medium">not sure?</span>{" "}
      <span className="text-muted-foreground">ask sensei ↗</span>
    </span>
    <span className="flex flex-col gap-1">
      {ASK_EXAMPLES.map((q) => (
        <span className="truncate text-muted-foreground text-xs" key={q}>
          {q}
        </span>
      ))}
    </span>
  </Link>
);

/* ── nudge (stage D, 1/day, dismissible) ──────────────────────── */

const DashboardNudge = () => {
  // Hooks first, always (useHookAtTopLevel): the gate below is a render
  // decision, not a hook decision.
  const [dismissed, setDismissed] = useState(() => nudgeDismissedToday());
  const onDismiss = useCallback(() => {
    dismissNudgeToday();
    setDismissed(true);
  }, []);
  const { plan } = useDashboard();
  if (dismissed || !plan.nudge) {
    return null;
  }
  return (
    <div className="flex min-h-28 flex-col justify-center gap-2 rounded-card border border-border bg-card/60 p-5 text-sm">
      <p>{plan.nudge}</p>
      <span className="flex gap-3 text-xs">
        <Link
          className="font-medium text-primary underline underline-offset-2"
          search={{ cell: [], chart: "0", group: [], kind: "gojuon" }}
          to="/drill"
        >
          Drill kana →
        </Link>
        <button
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          data-testid="nudge-dismiss"
          onClick={onDismiss}
          type="button"
        >
          not now
        </button>
      </span>
    </div>
  );
};

/* ── browse: replaces the sidebar (chrome-free page) ──────────── */

const BROWSE_LINKS = [
  { label: "Exam", to: "/exam" },
  { label: "Lesson", to: "/lesson" },
  { label: "Reader", to: "/reader" },
  { label: "Listen", to: "/listen" },
  { label: "Roleplay", to: "/roleplay" },
  { label: "Drill", to: "/drill" },
  { label: "Conjugate", to: "/conjugate" },
  { label: "Kanji", to: "/kanji" },
  { label: "Settings", to: "/settings" },
] as const;

const DashboardBrowse = () => (
  <nav
    aria-label="Practice surfaces"
    className="flex min-h-16 flex-col justify-center gap-2 rounded-card border border-border bg-card/40 p-5 lg:col-span-3"
    data-testid="dashboard-browse"
  >
    <p className="text-muted-foreground text-xs">or pick your own:</p>
    <span className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {BROWSE_LINKS.map((link) => (
        <Link
          className="underline underline-offset-2 hover:text-primary"
          key={link.to}
          to={link.to}
        >
          {link.label}
        </Link>
      ))}
    </span>
  </nav>
);

export const Dashboard = Object.assign(DashboardRoot, {
  Ask: DashboardAsk,
  Browse: DashboardBrowse,
  Due: DashboardDue,
  Hero: DashboardHero,
  Momentum: DashboardMomentum,
  Nudge: DashboardNudge,
  Rail: DashboardRail,
});
