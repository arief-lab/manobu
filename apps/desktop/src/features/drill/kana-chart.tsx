/*
 * Kana Chart drawer (TASK-23.2.2).
 *
 * Per spec doc-5 §2-4 A1/A2/A4:
 *   - 46 hiragana + 46 katakana gojūon grid; each cell shows char + romaji.
 *   - Per-cell [Hear] (mirrors DrillLab.Audio · useTtsPrefs() +
 *     @manobu/speech/tts speak(current.char, { sid, speed })).
 *   - Per-cell [Copy] copies the romaji to clipboard AND, if a ListenType
 *     is mounted, dispatches a `manobu:kana-chart-copy` window event
 *     carrying { romaji, char }. ListenType subscribes and fills its
 *     .Input (AC5: "no-op otherwise" · the clipboard fallback is the
 *     no-op path).
 *   - Look-alike overlay (data-testid=look-alike-overlay): highlights
 *     シ/ツ/ソ/ン before the first katakana drill (doc-5 A2). A
 *     localStorage flag (`manobu:kana-katakana-overlay-seen`) suppresses
 *     it after the learner dismisses it once.
 *
 * Composition (Vercel pattern):
 *   <KanaChart>                  provider (kind + open)
 *     <KanaChart.Header          title + close
 *     <KanaChart.LookAlike       callout (only when kind=katakana)
 *     <KanaChart.Grid            46+46 cells
 *   </KanaChart>
 *
 * Each cell renders its own [Hear] and [Copy] buttons. The provider
 * holds the cell list; cells consume via `useKanaChart()`.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useTtsPrefs } from "@/lib/tts-voice";

export type KanaKind =
  | "gojuon"
  | "katakana"
  | "dakuten"
  | "yoon"
  | "katakana-dakuten"
  | "katakana-yoon"
  | "all";

export interface KanaCell {
  char: string;
  from?: string;
  kind: KanaKind;
  mnemonic: string;
  romaji: string;
  row: string;
}

/** Visual-similar katakana pairs (doc-5 A2). Locked by kana.test.ts. */
const LOOK_ALIKE_PAIRS: readonly [string, string, string][] = [
  ["シ", "ツ", "Hook on a stroke · same top"],
  ["ソ", "ン", "Tiny curl · same tail"],
];

const STORAGE_KEY = "manobu:kana-katakana-overlay-seen";

const seenOverlay = (): boolean => {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
};

const markOverlaySeen = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // localStorage unavailable (private mode, etc.) · degrade silently
    // and just show the overlay again next time.
  }
};

const copyToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

interface KanaChartContext {
  cells: KanaCell[];
  onCopy: (cell: KanaCell) => void;
  onHear: (cell: KanaCell) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const KanaChartScope = createContext<KanaChartContext | null>(null);

const useKanaChart = (): KanaChartContext => {
  const ctx = useContext(KanaChartScope);
  if (!ctx) {
    throw new Error("useKanaChart must be used within KanaChart");
  }
  return ctx;
};

const Header = () => {
  const { setOpen } = useKanaChart();
  const onClose = useCallback(() => {
    setOpen(false);
  }, [setOpen]);
  return (
    <div
      className="flex items-center justify-between"
      data-testid="kana-chart-header"
    >
      <h2 className="font-semibold text-sm">Kana Chart</h2>
      <button
        aria-label="Close kana chart"
        className="rounded-card border-2 border-border px-2 py-1 text-xs"
        data-testid="kana-chart-close"
        onClick={onClose}
        type="button"
      >
        ✕
      </button>
    </div>
  );
};

const LookAlike = () => {
  const [dismissed, setDismissed] = useState(false);
  // Re-evaluate the seen-flag once on mount; the host (Kind switch) can
  // also re-mount this subtree by keying on kind.
  const [seen] = useState(seenOverlay);
  const onDismiss = useCallback(() => {
    markOverlaySeen();
    setDismissed(true);
  }, []);
  if (seen || dismissed) {
    return null;
  }
  return (
    <div
      className="rounded-card border-2 border-warning bg-muted p-2 text-xs"
      data-testid="look-alike-overlay"
    >
      <p className="font-semibold">Look-alike katakana · pause here</p>
      <ul className="ml-4 list-disc">
        {LOOK_ALIKE_PAIRS.map(([a, b, hint]) => (
          <li data-pair={`${a}${b}`} key={`${a}${b}`}>
            <span className="font-mono text-base">{a}</span> vs{" "}
            <span className="font-mono text-base">{b}</span> · {hint}
          </li>
        ))}
      </ul>
      <button
        className="mt-2 rounded-card border-2 border-border px-2 py-1 text-xs"
        data-testid="look-alike-dismiss"
        onClick={onDismiss}
        type="button"
      >
        Got it · don't show again
      </button>
    </div>
  );
};

const Cell = ({ cell }: { cell: KanaCell }) => {
  const { onCopy, onHear } = useKanaChart();
  const onHearClick = () => {
    onHear(cell);
  };
  const onCopyClick = () => {
    onCopy(cell);
  };
  return (
    <div
      className="flex flex-col items-center gap-1 rounded-card border-2 border-border p-2"
      data-char={cell.char}
      data-romaji={cell.romaji}
      data-testid="kana-chart-cell"
    >
      <span className="font-mono text-2xl">{cell.char}</span>
      <span className="text-muted-foreground text-xs">{cell.romaji}</span>
      <div className="flex gap-1">
        <button
          aria-label={`Hear ${cell.char}`}
          className="rounded-card border-2 border-border px-2 py-1 text-xs"
          data-testid="kana-chart-hear"
          onClick={onHearClick}
          type="button"
        >
          ▶
        </button>
        <button
          aria-label={`Copy ${cell.romaji}`}
          className="rounded-card border-2 border-border px-2 py-1 text-xs"
          data-testid="kana-chart-copy"
          onClick={onCopyClick}
          type="button"
        >
          Copy
        </button>
      </div>
    </div>
  );
};

const Grid = () => {
  const { cells } = useKanaChart();
  return (
    <div
      className="grid grid-cols-8 gap-2"
      data-cell-count={cells.length}
      data-testid="kana-chart-grid"
    >
      {cells.map((c) => (
        <Cell cell={c} key={`${c.kind}:${c.char}`} />
      ))}
    </div>
  );
};

interface KanaChartProps {
  children: ReactNode;
  initial: {
    cells: KanaCell[];
    open?: boolean;
  };
  onCopy?: (cell: KanaCell) => void;
}

const KanaChartRoot = ({ initial, children, onCopy }: KanaChartProps) => {
  const [open, setOpen] = useState(initial.open ?? true);
  const { sid, speed } = useTtsPrefs();
  const onHear = useCallback(
    async (cell: KanaCell) => {
      const isInTauri = typeof window !== "undefined" && "__TAURI__" in window;
      if (!isInTauri) {
        return; // web dev: TTS is Tauri-only.
      }
      try {
        const { speak } = await import("@manobu/speech/tts");
        await speak(cell.char, { sid, speed });
      } catch {
        // graceful skip
      }
    },
    [sid, speed]
  );
  const handleCopy = useCallback(
    async (cell: KanaCell) => {
      await copyToClipboard(cell.romaji);
      // Tell any mounted ListenType.Input to fill itself. AC5: no-op
      // otherwise · the listener is optional, the clipboard path is
      // always present.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("manobu:kana-chart-copy", {
            detail: { char: cell.char, romaji: cell.romaji },
          })
        );
      }
      onCopy?.(cell);
    },
    [onCopy]
  );
  const ctx = useMemo<KanaChartContext>(
    () => ({
      cells: initial.cells,
      onCopy: handleCopy,
      onHear,
      open,
      setOpen,
    }),
    [initial.cells, handleCopy, onHear, open]
  );
  // Auto-close on Escape (matches Reader.Overlay behavior)
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!open) {
    return null;
  }
  return (
    <KanaChartScope.Provider value={ctx}>{children}</KanaChartScope.Provider>
  );
};

export const KanaChart = Object.assign(KanaChartRoot, {
  Grid,
  Header,
  LookAlike,
});

export const __test__ = { LOOK_ALIKE_PAIRS };
