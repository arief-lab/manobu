/*
 * First-run setup (bento redesign) · one-time landing page, never seen
 * again once `setup_done` is written by the Begin bar. Rendered
 * chrome-free and full-screen (see routes/__root.tsx firstRun branch):
 * no Header, no AskSensei widget, the grid owns the viewport.
 *
 * Concept B: the sensei introduction IS the pitch. Left rail = the
 * connection state machine rendered in-character (waking up → typed
 * greeting → status row); right bento = mode picker where every tile is
 * one human question + a hand-drawn line-art SVG scene that tells the
 * story of that path (plane over Fuji, answer sheet filling, retro TV,
 * skyline lighting up). Scenes loop subtly via CSS keyframes
 * (index.css setup-*), honor prefers-reduced-motion, and never block
 * path selection when AI is absent (SCR-02 contract).
 *
 * Composition (Vercel pattern):
 *   <Setup>            provider (goal + jlpt level selection)
 *     <Setup.Rail>     sensei welcome + live CLI status (left col, row-span)
 *     <Setup.Grid>     question tiles + quiet "just for fun" strip
 *     <Setup.Begin>    full-width CTA, enabled once a tile is picked
 *   </Setup>
 *
 * Selection writes go through lib/learner-setup.ts (localStorage,
 * learner-level.ts pattern) · completeSetup() flips the gate; the JLPT
 * tile's level chips reuse lib/learner-level.ts so the sidebar selector
 * stays the single source of truth for curriculum level.
 */

import type { AgentOption, JlptLevel } from "@manobu/api-contract";
import {
  loadPersistedChat,
  persistChat,
} from "@manobu/chat-session/persistence";
import { TTS_MODEL_ID } from "@manobu/speech/models";
import { log } from "@manobu/ui/lib/gsm";
import { saveFsrsToast } from "@manobu/ui/lib/toast";
import { cn } from "@manobu/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  BriefcaseIcon,
  ClapperboardIcon,
  Dice5Icon,
  PlaneIcon,
  TargetIcon,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { cliIdentityFor, cliMonogram } from "@/lib/cli-identity";
import {
  getLearnerLevel,
  JLPT_LEVELS,
  setLearnerLevel,
} from "@/lib/learner-level";
import { completeSetup, GOAL_LABEL, type GoalId } from "@/lib/learner-setup";
import { type SenseiState, useSenseiStatus } from "@/lib/sensei";
import {
  SPEECH_STATUS_QUERY_KEY,
  speechModelsQueryOptions,
  useEnsureModel,
  useSpeechDownloadProgress,
  useSpeechModels,
} from "@/lib/tauri-queries";
import { ensureTts } from "@/lib/tts-init";
import { ListenButton } from "@/shared/listen-button";

/* ── copy data ─────────────────────────────────────────────────── */

interface SampleToken {
  en: string;
  jp: string;
  rd: string;
}

interface Mode {
  goal: GoalId;
  icon: typeof PlaneIcon;
  question: string;
  quiet?: boolean;
  sample: readonly SampleToken[];
  scene: (props: { active: boolean }) => ReactNode;
}

/* Line-art scenes: 200×110 viewBox, stroke=currentColor, no fills.
 * `active` (tile selected) brightens the accent parts. All motion is
 * CSS (setup-* keyframes in index.css) · compositor-friendly, and
 * prefers-reduced-motion kills it wholesale. */

const SCENE_STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 2,
} as const;

function SceneTravel({ active }: { active: boolean }) {
  return (
    <svg
      aria-hidden
      className={cn(
        "h-full w-full transition-opacity duration-300",
        active ? "opacity-100" : "opacity-70"
      )}
      viewBox="0 0 200 110"
    >
      {/* Mt. Fuji with snow cap */}
      <g {...SCENE_STROKE}>
        <path d="M38 96 L86 40 L97 52 L110 34 L162 96" />
        <path d="M97 52 L103 44 L110 34 L117 44 L124 53 L117 49 L110 55 L103 49 Z" />
        <path d="M20 96 H180" />
      </g>
      {/* Marching flight route */}
      <path
        className="setup-march"
        d="M28 78 Q96 6 172 66"
        fill="none"
        stroke="currentColor"
        strokeDasharray="5 9"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      {/* Plane riding the arc's end */}
      <g
        className="setup-bob"
        fill={active ? "var(--color-primary)" : "currentColor"}
        stroke="none"
        transform="translate(166 58) rotate(38)"
      >
        <path d="M0 -9 L3 -1 L13 2 L3 3 L1 10 L-1 3 L-9 1 L-1 -2 Z" />
      </g>
    </svg>
  );
}

function SceneJlpt({ active }: { active: boolean }) {
  // 4×4 answer bubbles; each fills in sequence, then the sheet resets.
  const bubbles = Array.from({ length: 16 }, (_, i) => i);
  return (
    <svg
      aria-hidden
      className={cn(
        "h-full w-full transition-opacity duration-300",
        active ? "opacity-100" : "opacity-70"
      )}
      viewBox="0 0 200 110"
    >
      <g {...SCENE_STROKE}>
        <rect height="86" rx="6" width="64" x="68" y="14" />
        <path d="M80 30 H120 M80 44 H120 M80 58 H120 M80 72 H108" />
      </g>
      {/* Filling answer column on the left sheet edge */}
      <g fill={active ? "var(--color-primary)" : "currentColor"} stroke="none">
        {bubbles.map((i) => (
          <circle
            className="setup-fill"
            cx={i % 2 === 0 ? 40 : 158}
            cy={22 + Math.floor((i % 8) / 2) * 18}
            key={i}
            opacity="0.15"
            r="4"
            style={{ animationDelay: `${i * 320}ms` }}
          />
        ))}
      </g>
    </svg>
  );
}

function SceneAnime({ active }: { active: boolean }) {
  return (
    <svg
      aria-hidden
      className={cn(
        "h-full w-full transition-opacity duration-300",
        active ? "opacity-100" : "opacity-70"
      )}
      viewBox="0 0 200 110"
    >
      <g {...SCENE_STROKE}>
        {/* Retro TV body + antennas + knobs */}
        <rect height="62" rx="8" width="96" x="52" y="40" />
        <path d="M84 40 L66 16 M104 40 L122 16" />
        <circle cx="66" cy="16" r="2.5" />
        <circle cx="122" cy="16" r="2.5" />
        <circle cx="138" cy="56" r="3.5" />
        <circle cx="138" cy="72" r="3.5" />
        <path d="M64 102 L60 110 M136 102 L140 110" />
      </g>
      {/* Flickering screen */}
      <rect
        className="setup-flicker"
        fill={active ? "var(--color-primary)" : "currentColor"}
        height="42"
        rx="4"
        width="66"
        x="62"
        y="50"
      />
      {/* Sparkle beside the antenna */}
      <g
        className="setup-sparkle"
        stroke={active ? "var(--color-primary)" : "currentColor"}
        strokeWidth="2"
      >
        <path d="M150 24 V36 M144 30 H156" />
      </g>
    </svg>
  );
}

function SceneWork({ active }: { active: boolean }) {
  // Three towers; windows light up in a slow staggered sweep.
  const windows = [
    { x: 62, y: 44 },
    { x: 74, y: 44 },
    { x: 62, y: 58 },
    { x: 74, y: 58 },
    { x: 62, y: 72 },
    { x: 74, y: 72 },
    { x: 96, y: 30 },
    { x: 108, y: 30 },
    { x: 96, y: 46 },
    { x: 108, y: 46 },
    { x: 96, y: 62 },
    { x: 108, y: 62 },
    { x: 96, y: 78 },
    { x: 108, y: 78 },
    { x: 130, y: 52 },
    { x: 142, y: 52 },
    { x: 130, y: 66 },
    { x: 142, y: 66 },
    { x: 130, y: 80 },
    { x: 142, y: 80 },
  ];
  return (
    <svg
      aria-hidden
      className={cn(
        "h-full w-full transition-opacity duration-300",
        active ? "opacity-100" : "opacity-70"
      )}
      viewBox="0 0 200 110"
    >
      <g {...SCENE_STROKE}>
        <rect height="62" width="26" x="56" y="42" />
        <rect height="78" width="26" x="90" y="26" />
        <rect height="46" width="26" x="124" y="58" />
        <path d="M36 104 H176" />
        {/* Clock tower face on the middle building */}
        <circle cx="103" cy="38" r="6" />
        <path d="M103 38 V34 M103 38 H106" />
      </g>
      <g fill={active ? "var(--color-primary)" : "currentColor"} stroke="none">
        {windows.map((w, i) => (
          <rect
            className="setup-fill"
            height="6"
            key={`${w.x}-${w.y}`}
            opacity="0.15"
            rx="1"
            style={{ animationDelay: `${i * 260}ms` }}
            width="6"
            x={w.x}
            y={w.y}
          />
        ))}
      </g>
    </svg>
  );
}

/* Mini scene for the quiet strip: a tumbling die, a twinkling spark,
 * confetti dots drifting up. Compact 48×24 viewBox to sit inline. */
function SceneFun({ active }: { active: boolean }) {
  return (
    <svg
      aria-hidden
      className={cn(
        "h-6 w-12 shrink-0 transition-opacity duration-300",
        active ? "opacity-100" : "opacity-60"
      )}
      viewBox="0 0 48 24"
    >
      <g
        fill="none"
        stroke={active ? "var(--color-primary)" : "currentColor"}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      >
        <g className="setup-tumble" style={{ transformOrigin: "12px 12px" }}>
          <rect height="12" rx="2.5" width="12" x="6" y="6" />
          <circle cx="9.5" cy="9.5" fill="currentColor" r="1" stroke="none" />
          <circle cx="14.5" cy="14.5" fill="currentColor" r="1" stroke="none" />
        </g>
        <g className="setup-sparkle" style={{ transformOrigin: "30px 8px" }}>
          <path d="M30 4 V12 M26 8 H34" />
        </g>
        <circle
          className="setup-rise"
          cx="40"
          cy="18"
          fill="currentColor"
          r="1.4"
          stroke="none"
        />
        <circle
          className="setup-rise"
          cx="44"
          cy="14"
          fill="currentColor"
          r="1.1"
          stroke="none"
          style={{ animationDelay: "700ms" }}
        />
      </g>
    </svg>
  );
}

const MODES: readonly Mode[] = [
  {
    goal: "travel",
    icon: PlaneIcon,
    question: "Going to Japan?",
    sample: [
      { en: "order", jp: "注文", rd: "ちゅうもん" },
      { en: "can you…? (polite)", jp: "できます", rd: "できます" },
      { en: "question marker", jp: "か", rd: "か" },
    ],
    scene: SceneTravel,
  },
  {
    goal: "jlpt",
    icon: TargetIcon,
    question: "Taking the JLPT?",
    sample: [
      { en: "grammar", jp: "文法", rd: "ぶんぽう" },
      { en: "object particle", jp: "を", rd: "を" },
      { en: "let's do", jp: "やりましょう", rd: "やりましょう" },
    ],
    scene: SceneJlpt,
  },
  {
    goal: "anime",
    icon: ClapperboardIcon,
    question: "Love anime & manga?",
    sample: [
      { en: "awesome! (casual)", jp: "すげえ", rd: "すげえ" },
      { en: "exclamation", jp: "！", rd: "！" },
    ],
    scene: SceneAnime,
  },
  {
    goal: "work",
    icon: BriefcaseIcon,
    question: "Need it for work?",
    sample: [
      { en: "humble 「I begin」", jp: "はじめ", rd: "はじめ" },
      { en: "polite ending", jp: "ます", rd: "ます" },
    ],
    scene: SceneWork,
  },
  {
    goal: "fun",
    icon: Dice5Icon,
    question: "Just for fun?",
    quiet: true,
    sample: [{ en: "fun!", jp: "楽しい", rd: "たのしい" }],
    scene: SceneFun,
  },
] as const;

/* The mock deck + lesson corpora cover N5–N2; keep the setup promise
 * honest · no N1 chip until there's an N1 plan. */
const LEVEL_CHOICES: readonly JlptLevel[] = JLPT_LEVELS.slice(0, 4);

/* Registry displayNames carry a GitHub slug parenthetical
 * ("OpenCode (sst/opencode)") · process-monitor talk. Sensei speaks as
 * a person; the bare name lives in the status row only. */
const TRAILING_SLUG = /\s*\([^)]*\)\s*$/;
const shortAgent = (name: string): string => name.replace(TRAILING_SLUG, "");

/* ── scope ────────────────────────────────────────────────────── */

interface SetupContext {
  goal: GoalId | null;
  level: JlptLevel;
  setGoal: (goal: GoalId) => void;
  setLevel: (level: JlptLevel) => void;
}

const SetupScope = createContext<SetupContext>({
  goal: null,
  level: "N5",
  setGoal: () => undefined,
  setLevel: () => undefined,
});

const useSetup = (): SetupContext => useContext(SetupScope);

interface SetupProps {
  children: ReactNode;
}

/* Full-viewport bento: rail left (spans all rows), 2×2 tiles filling
 * the remaining height, quiet fun strip + Begin under them. Mobile
 * stacks rail → tiles → fun → Begin and scrolls. */
const SetupRoot = ({ children }: SetupProps) => {
  const [goal, setGoalState] = useState<GoalId | null>(null);
  const [level, setLevelState] = useState<JlptLevel>(() => getLearnerLevel());
  const setGoal = useCallback((next: GoalId) => {
    setGoalState(next);
  }, []);
  const setLevel = useCallback((next: JlptLevel) => {
    setLevelState(next);
  }, []);
  return (
    <SetupScope.Provider value={{ goal, level, setGoal, setLevel }}>
      <section
        aria-label="Welcome to manobu"
        className="mx-auto grid h-full max-w-400 auto-rows-min grid-cols-1 gap-4 p-4 md:p-6 lg:grid-cols-[minmax(340px,5fr)_7fr] lg:grid-rows-[1fr_auto]"
        data-testid="setup"
      >
        {children}
      </section>
    </SetupScope.Provider>
  );
};

/* ── rail: sensei wakes up ─────────────────────────────────────── */

/* True character reveal: the visible layer slices the string one char at
 * a time with a blinking caret. An invisible copy of the finished text
 * reserves the height so the rail never reflows mid-type, and a
 * sr-only live region gives screen readers the sentence once instead of
 * per keystroke. Remount-per-message (key={message}) resets the counter. */
const TYPE_MS_PER_CHAR = 24;

const TypewriterParagraph = ({ text }: { text: string }) => {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= text.length) {
      return;
    }
    const timer = setTimeout(() => {
      setShown((prev) => prev + 1);
    }, TYPE_MS_PER_CHAR);
    return () => {
      clearTimeout(timer);
    };
  }, [shown, text.length]);
  const skip = useCallback(() => {
    setShown(text.length);
  }, [text.length]);
  const done = shown >= text.length;
  return (
    <>
      {/* AT reads the finished sentence once; the visible layer types it
          out. The invisible ghost reserves the final height so the rail
          never reflows mid-type. */}
      <span aria-live="polite" className="sr-only">
        {text}
      </span>
      <div className="relative mt-4">
        <p aria-hidden className="invisible text-lg leading-relaxed">
          {text}
        </p>
        <p aria-hidden className="absolute inset-0 text-lg leading-relaxed">
          {text.slice(0, shown)}
          {!done && (
            <span className="ml-0.5 animate-pulse font-normal text-primary">
              ▍
            </span>
          )}
        </p>
      </div>
      {!done && (
        <button
          className="mt-3 self-start text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
          onClick={skip}
          type="button"
        >
          skip typing
        </button>
      )}
    </>
  );
};

const senseiMessage = (state: SenseiState): string => {
  switch (state.kind) {
    case "detecting":
      return "";
    case "local-found":
      return "はじめまして 👋 I'm your sensei. I run right here on your computer, so you can practice offline and keep your progress to yourself. Tap any word for help. First, one question: what brought you here?";
    case "cli-missing":
      return "はじめまして 👋 The talking part needs a local AI tool like opencode or claude, and I don't see one yet. Everything else works without it: lessons, flashcards, the dictionary. Pick a path to start, and switch me on later in Settings.";
    case "offline":
      return "はじめまして 👋 I can't reach the local engine right now, so I'll stay quiet for the moment. The app still works offline. Pick a path and start learning; I'll wake up the next time you're connected.";
    default:
      return "";
  }
};

/* Vendored Simple Icons path (CC0) when the registry id is known,
 * generated monogram otherwise. 14px rail badge / 16px chooser rows. */
const CliBadge = ({
  agentId,
  displayName,
  size = 14,
}: {
  agentId: string;
  displayName: string;
  size?: number;
}) => {
  const identity = cliIdentityFor(agentId);
  if (identity?.path) {
    return (
      <svg
        aria-hidden
        fill="currentColor"
        height={size}
        viewBox="0 0 24 24"
        width={size}
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
      className="inline-flex shrink-0 items-center justify-center rounded-sm bg-muted font-semibold text-[9px] leading-none"
      style={{ height: size, width: size }}
    >
      {cliMonogram(displayName)}
    </span>
  );
};

const STATUS_DOT: Record<SenseiState["kind"], string> = {
  "cli-missing": "○",
  detecting: "◌",
  "local-found": "●",
  offline: "○",
};

const statusLabel = (state: SenseiState): string => {
  switch (state.kind) {
    case "detecting":
      return "connecting to agent cli…";
    case "local-found":
      return `sensei is here · ${shortAgent(state.agent)}`;
    case "cli-missing":
      return "no local agent CLI";
    case "offline":
      return "backend unreachable";
    default:
      return "";
  }
};

/* The chooser popover: every installed CLI with its badge; the active
 * row is the persisted chat-session agent (or the derived default).
 * Owns its open/null gating so CliStatusRow stays under the complexity
 * gate. */
const CliChooserList = ({
  agents,
  currentId,
  onPick,
  open,
}: {
  agents: readonly AgentOption[];
  currentId: string;
  onPick: (agentId: string) => void;
  open: boolean;
}) => {
  if (!open) {
    return null;
  }
  return (
    <ul
      className="absolute inset-x-0 bottom-full z-10 mb-2 flex flex-col gap-1 rounded-card border border-border bg-card p-2 shadow-lg"
      data-testid="setup-cli-list"
    >
      {agents.map((agent) => (
        <li key={agent.id}>
          <CliChooserItem
            active={agent.id === currentId}
            agent={agent}
            onPick={onPick}
          />
        </li>
      ))}
    </ul>
  );
};

/* Stable per-row handler (noJsxPropsBind): the click handler is declared
 * here, not as an inline arrow in JSX. */
function CliChooserItem({
  active,
  agent,
  onPick,
}: {
  active: boolean;
  agent: AgentOption;
  onPick: (agentId: string) => void;
}) {
  const onSelect = useCallback(() => {
    onPick(agent.id);
  }, [agent.id, onPick]);
  return (
    <button
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent",
        active && "text-foreground"
      )}
      onClick={onSelect}
      type="button"
    >
      <CliBadge agentId={agent.id} displayName={agent.displayName} size={16} />
      <span>{shortAgent(agent.displayName)}</span>
      {active ? (
        <span aria-hidden className="ml-auto text-primary">
          ✓
        </span>
      ) : null}
    </button>
  );
}

/* The found branch: badge + name, the chooser when more than one CLI is
 * installed, re-check. Choosing writes the chat-session persisted
 * `agent` · the same field /ai and the chat pickers read · so the pick
 * is real, not decorative. Split from the not-found row so neither
 * component carries the whole union's branching. */
type FoundState = Extract<SenseiState, { kind: "local-found" }>;

const CliFoundRow = ({
  found,
  onPick,
  preferredId,
  refetch,
}: {
  found: FoundState;
  onPick: (agentId: string) => void;
  preferredId: string | undefined;
  refetch: () => void;
}) => {
  const [choosing, setChoosing] = useState(false);
  const choose = useCallback(
    (agentId: string) => {
      setChoosing(false);
      onPick(agentId);
    },
    [onPick]
  );
  const toggleChoosing = useCallback(() => {
    setChoosing((prev) => !prev);
  }, []);
  const showChooser = found.installed.length > 1;
  return (
    <>
      <div className="flex items-center gap-2">
        <CliBadge agentId={found.agentId} displayName={found.agent} />
        <span>{statusLabel(found)}</span>
        {showChooser && (
          <button
            aria-expanded={choosing}
            className="underline underline-offset-2 hover:text-foreground"
            data-testid="setup-cli-choose"
            onClick={toggleChoosing}
            type="button"
          >
            {choosing ? "close" : "change"}
          </button>
        )}
        <button
          className="ml-auto underline underline-offset-2 hover:text-foreground"
          onClick={refetch}
          type="button"
        >
          re-check
        </button>
      </div>
      <CliChooserList
        agents={found.installed}
        currentId={preferredId ?? found.agentId}
        onPick={choose}
        open={choosing}
      />
    </>
  );
};

/* The rail's status row doubles as the sensei's identity: badge + name
 * when found, a pulsing ring while detecting or unreachable. */
const CliStatusRow = ({
  onPick,
  preferredId,
  refetch,
  state,
}: {
  onPick: (agentId: string) => void;
  preferredId: string | undefined;
  refetch: () => void;
  state: SenseiState;
}) => (
  <div className="relative mt-auto pt-6 text-muted-foreground text-xs">
    {state.kind === "local-found" ? (
      <CliFoundRow
        found={state}
        onPick={onPick}
        preferredId={preferredId}
        refetch={refetch}
      />
    ) : (
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "animate-pulse",
            state.kind === "detecting" && "animate-spin"
          )}
        >
          {STATUS_DOT[state.kind]}
        </span>
        <span>{statusLabel(state)}</span>
        {state.kind !== "detecting" && (
          <button
            className="ml-auto underline underline-offset-2 hover:text-foreground"
            onClick={refetch}
            type="button"
          >
            re-check
          </button>
        )}
      </div>
    )}
  </div>
);

/* The Supertonic listening voice lives in the Tauri shell, so there is
 * nothing to download on web dev. */
const isInTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI__" in window;

/* Second rail row: the ~123 MB listening voice. Skippable by design · Begin
 * only ever depends on the chosen path, never on this row. It speaks through
 * the same `speech_ensure_model` path Settings uses and shows byte progress,
 * then brings the engine up so the first listening item is ready without a
 * restart (the same `ensureTts` boot the root route runs). Outside Tauri it
 * renders nothing, because a download that cannot run is not an offer.
 *
 * Readiness is read from DISK (`speech_list_models` → `ModelInfo.ready`),
 * not from `speech_status.tts_ready`: that flag means "the engine object
 * exists in this process", so a query answered before the boot warm-up
 * lands reports a downloaded voice as missing and offers to re-download it. */
const voiceDownloadPercent = (
  entries:
    | readonly { downloaded: number; model_id: string; total: number }[]
    | undefined
): number | null => {
  const entry = entries?.find((item) => item.model_id === TTS_MODEL_ID);
  if (entry === undefined || entry.total <= 0) {
    return null;
  }
  return Math.min(100, Math.floor((entry.downloaded / entry.total) * 100));
};

const VoiceReadyRow = () => (
  <div className="mt-2 flex items-center gap-2">
    <span aria-hidden className="text-primary">
      ●
    </span>
    <span>listening voice ready</span>
    <span className="ml-auto">
      <ListenButton testId="setup-voice-preview" text="こんにちは" />
    </span>
  </div>
);

const VoiceDownloadingRow = ({ percent }: { percent: number | null }) => (
  <div className="mt-2 flex items-center gap-2">
    <span aria-hidden className="animate-spin">
      ◌
    </span>
    <span>
      {percent === null
        ? "downloading voice…"
        : `downloading voice · ${percent}%`}
    </span>
  </div>
);

const VoiceIdleRow = ({
  isError,
  onDownload,
}: {
  isError: boolean;
  onDownload: () => void;
}) => (
  <div className="mt-2 flex items-center gap-2">
    <span aria-hidden>{isError ? "✕" : "○"}</span>
    <span>
      {isError ? "voice download failed" : "listening voice · about 123 MB"}
    </span>
    <button
      className="ml-auto underline underline-offset-2 hover:text-foreground"
      data-testid="setup-voice-download"
      onClick={onDownload}
      type="button"
    >
      {isError ? "retry" : "download"}
    </button>
  </div>
);

const VoiceStatusRow = () => {
  const models = useSpeechModels();
  const ensure = useEnsureModel();
  const progress = useSpeechDownloadProgress(ensure.isPending);
  const queryClient = useQueryClient();
  const onDownload = useCallback(() => {
    ensure.mutate(TTS_MODEL_ID, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: speechModelsQueryOptions.queryKey,
        });
        await queryClient.invalidateQueries({
          queryKey: SPEECH_STATUS_QUERY_KEY,
        });
        // Warm the engine now so opening a listening paper speaks right away.
        ensureTts().catch(() => undefined);
      },
    });
  }, [ensure, queryClient]);

  if (!isInTauri() || models.isPending) {
    return null;
  }
  const downloaded = models.data?.some(
    (model) => model.id === TTS_MODEL_ID && model.ready
  );
  if (downloaded) {
    return <VoiceReadyRow />;
  }
  if (ensure.isPending) {
    return (
      <VoiceDownloadingRow percent={voiceDownloadPercent(progress.data)} />
    );
  }
  return <VoiceIdleRow isError={ensure.isError} onDownload={onDownload} />;
};

const SetupRail = () => {
  // The chat provider persists its agent under manobu:chat:v1; reading
  // it here keeps rail and /ai in sync without a second source of truth.
  const [preferredId, setPreferredId] = useState<string | undefined>(
    () => loadPersistedChat().agent
  );
  const { state, refetch } = useSenseiStatus(preferredId);
  const onPick = useCallback((agentId: string) => {
    setPreferredId(agentId);
    persistChat({ ...loadPersistedChat(), agent: agentId });
    log("onboarding_step", { agentId, step: "cli_chosen" });
  }, []);
  const message = senseiMessage(state);
  return (
    <aside
      className="flex flex-col rounded-card border border-border bg-card/40 p-6 lg:row-span-2 lg:p-8"
      data-state={state.kind}
      data-testid="setup-rail"
    >
      <p className="font-semibold text-2xl tracking-tight">manobu</p>
      {/* Center the greeting so the tall rail reads intentional, not
          top-heavy: wordmark pinned top, status pinned bottom. */}
      <div className="flex flex-1 flex-col justify-center">
        {state.kind === "detecting" ? (
          <div aria-live="polite" className="my-8 space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <span aria-hidden className="animate-spin">
                ◌
              </span>
              sensei is waking up…
            </div>
            <div className="h-4 w-11/12 animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-9/12 animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-7/12 animate-pulse rounded-full bg-muted" />
          </div>
        ) : (
          <TypewriterParagraph key={message} text={message} />
        )}
      </div>
      <CliStatusRow
        onPick={onPick}
        preferredId={preferredId}
        refetch={refetch}
        state={state}
      />
      <VoiceStatusRow />
    </aside>
  );
};

/* ── grid: question tiles ──────────────────────────────────────── */

/* Tap-to-glossify word: once the tile is selected the sample words
 * become buttons revealing reading + meaning + save, plus the shared
 * [🔊] ListenButton (its TTS contract + demo-when-no-engine behavior are
 * documented in shared/listen-button.tsx). Lives outside the tile's
 * select button so no interactive element is ever nested. */
const WordChip = ({
  delayMs,
  token,
}: {
  delayMs: number;
  token: SampleToken;
}) => {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const onToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);
  const onSave = useCallback(async () => {
    if (saved) {
      return;
    }
    setSaved(true);
    await saveFsrsToast({
      n: 1,
      onUndo: () => {
        setSaved(false);
      },
      retention: 0.9,
    });
  }, [saved]);
  return (
    <span
      className="fade-in-0 slide-in-from-bottom-2 flex animate-in flex-col items-start gap-1 duration-300"
      style={{ animationDelay: `${delayMs}ms`, animationFillMode: "backwards" }}
    >
      <span className="flex items-center gap-1">
        <button
          aria-expanded={open}
          aria-label={`${token.jp} · tap for help`}
          className={cn(
            "rounded-md px-1 text-2xl transition-colors hover:bg-accent hover:text-accent-foreground",
            open && "bg-accent text-accent-foreground"
          )}
          onClick={onToggle}
          type="button"
        >
          {token.jp}
        </button>
        <ListenButton testId={`listen-${token.jp}`} text={token.jp} />
      </span>
      {open ? (
        <span className="flex items-baseline gap-1.5 px-1 text-muted-foreground text-xs">
          <span>{token.rd}</span>
          <span>· {token.en}</span>
          <button
            aria-label={
              saved ? `${token.jp} saved` : `Save ${token.jp} to FSRS`
            }
            className="underline underline-offset-2 hover:text-foreground"
            onClick={onSave}
            type="button"
          >
            {saved ? "✓ saved" : "save"}
          </button>
        </span>
      ) : null}
    </span>
  );
};

/* Stable per-level handler (noJsxPropsBind). Level writes land in the
 * store at Begin (SetupBegin), not here, so a half-picked level never
 * leaks. */
function LevelChip({ chipLevel }: { chipLevel: JlptLevel }) {
  const { level, setLevel } = useSetup();
  const active = chipLevel === level;
  const onClick = useCallback(() => {
    setLevel(chipLevel);
  }, [chipLevel, setLevel]);
  return (
    <button
      aria-pressed={active}
      className={cn(
        "rounded-chip border px-3 py-1 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border hover:border-primary/60"
      )}
      onClick={onClick}
      type="button"
    >
      {chipLevel}
    </button>
  );
}

/* Selection is a native <button aria-pressed> filling the tile; the
 * SVG scene is always on display (it tells the path's story at rest).
 * Once selected the scene shrinks and the tappable word chips animate
 * in below it. */
const ModeTile = ({ mode }: { mode: Mode }) => {
  const { goal, setGoal, setLevel } = useSetup();
  const selected = goal === mode.goal;
  const Icon = mode.icon;
  const Scene = mode.scene;
  const onSelect = useCallback(() => {
    setGoal(mode.goal);
    if (mode.goal === "jlpt") {
      setLevel(getLearnerLevel());
    }
  }, [mode.goal, setGoal, setLevel]);
  if (mode.quiet) {
    return (
      <div
        className="col-span-full"
        data-goal={mode.goal}
        data-selected={selected}
        data-testid={`setup-tile-${mode.goal}`}
      >
        <button
          aria-pressed={selected}
          className={cn(
            "flex w-full items-center gap-2 rounded-card border px-5 py-3 font-medium text-sm transition-all active:scale-[0.995]",
            selected
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground"
          )}
          onClick={onSelect}
          type="button"
        >
          <Icon aria-hidden className="size-4" />
          {mode.question}
          <Scene active={selected} />
          {selected && (
            <span aria-hidden className="ml-auto text-primary">
              ✓
            </span>
          )}
        </button>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex min-h-40 flex-col rounded-card border bg-card transition-all duration-150",
        "hover:-translate-y-0.5 hover:border-primary/60",
        selected && "border-primary ring-2 ring-primary/70",
        "lg:min-h-0"
      )}
      data-goal={mode.goal}
      data-selected={selected}
      data-testid={`setup-tile-${mode.goal}`}
    >
      <button
        aria-pressed={selected}
        className="flex flex-1 flex-col items-stretch gap-2 p-5 text-left transition-transform active:scale-[0.99]"
        onClick={onSelect}
        type="button"
      >
        <span className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
          <Icon aria-hidden className="size-5 text-primary" />
          {mode.question}
          {selected && (
            <span aria-hidden className="ml-1 text-primary">
              ✓
            </span>
          )}
        </span>
        <div
          className={cn(
            "min-h-0 flex-1 text-muted-foreground transition-all duration-300",
            selected ? "max-h-24 opacity-90" : "opacity-80"
          )}
        >
          <Scene active={selected} />
        </div>
      </button>
      {selected && (
        <div className="fade-in-0 slide-in-from-bottom-2 flex animate-in flex-col gap-3 px-5 pb-5 duration-300">
          {mode.goal === "jlpt" && (
            <fieldset
              className="flex flex-wrap gap-2"
              data-testid="setup-jlpt-levels"
            >
              <legend className="sr-only">JLPT level</legend>
              {LEVEL_CHOICES.map((chipLevel) => (
                <LevelChip chipLevel={chipLevel} key={chipLevel} />
              ))}
            </fieldset>
          )}
          <div
            className="flex flex-wrap gap-x-6 gap-y-2"
            data-testid={`setup-sample-${mode.goal}`}
          >
            {mode.sample.map((token, i) => (
              <WordChip delayMs={i * 90} key={token.jp} token={token} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const SetupGrid = () => (
  <fieldset
    className="grid min-h-0 gap-4 sm:grid-cols-2 lg:col-start-2 lg:grid-rows-[1fr_1fr_auto]"
    data-testid="setup-grid"
  >
    <legend className="sr-only">What are you learning Japanese for?</legend>
    {MODES.map((mode) => (
      <ModeTile key={mode.goal} mode={mode} />
    ))}
  </fieldset>
);

/* ── begin bar ─────────────────────────────────────────────────── */

const SetupBegin = () => {
  const { goal, level } = useSetup();
  const navigate = useNavigate();
  const onBegin = useCallback(() => {
    if (!goal) {
      return;
    }
    log("onboarding_step", { goal, step: "setup_complete" });
    if (goal === "jlpt") {
      setLearnerLevel(level);
    }
    completeSetup(goal);
    // Land on the desk, not the lesson: the dashboard's stage-`new`
    // hero is the single loud "Start lesson 1" · one tap from setup to
    // practice, and the user sees the new first page before diving in.
    // (The goal→corpus mapping, incl. "fun" → travel, lives in the
    // dashboard hero's `search`, not here.)
    navigate({ to: "/dashboard" });
  }, [goal, level, navigate]);
  return (
    <div className="lg:col-start-2">
      <button
        className={cn(
          "w-full rounded-card px-4 py-4 font-medium text-lg transition-all active:scale-[0.995]",
          goal
            ? "bg-primary text-primary-foreground hover:opacity-90"
            : "cursor-default bg-muted text-muted-foreground"
        )}
        data-testid="setup-begin"
        disabled={!goal}
        onClick={onBegin}
        type="button"
      >
        {goal
          ? `Begin ${GOAL_LABEL[goal]}${goal === "jlpt" ? ` ${level}` : ""} →`
          : "Begin · pick a path above"}
      </button>
    </div>
  );
};

export const Setup = Object.assign(SetupRoot, {
  Begin: SetupBegin,
  Grid: SetupGrid,
  Rail: SetupRail,
});
