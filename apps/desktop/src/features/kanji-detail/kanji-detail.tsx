/*
 * Kanji Detail (SCR-09) compound component · redesign 2026-09-14.
 *
 * What changed and why (the pre-redesign surface leaked spec text as
 * user copy, showed debug telemetry, and carried dead affordances):
 *   - Hero: the character IS the visual. The stroke player (KanjiVG)
 *     renders only when stroke data exists; a miss degrades to an
 *     honest line, never an empty reserved box.
 *   - DrawMini: the canvas actually paints your strokes now (the old
 *     one counted points and drew nothing), with a clear button. The
 *     visible "pointerType: · · 0 pts" telemetry is gone; the
 *     data-pointer-type attribute stays for tests. The dead
 *     "[Type しょく instead]" button is deleted.
 *   - Readings: romaji is DERIVED (katakana fold + kanaToRomaji), not a
 *     two-entry hand map that covered 食 and 時 only.
 *   - VocabRows: deduped across levels (食事 showed twice), first
 *     KANJIDIC sense as gloss, level chip, per-row hear (ListenButton),
 *     saved state + undo un-mark, cap 12 + show-all.
 *   - Audio: folded into the hero column; the disabled ♀/♂ buttons are
 *     gone (voice follows Settings > Voice; a dead toggle is clutter).
 *     Direct speak(character, { sid }) import stays (tts-surfaces
 *     contract) with the honest Tauri-only fallback line.
 *   - SenseiTip: plain copy ("this is wrong", not "[This is wrong]"),
 *     same flag + aria-pressed contract.
 *
 * Composition (Vercel pattern, no boolean-prop explosion):
 *   <KanjiDetail character>   provider (queries via useKanji)
 *     <KanjiDetail.Hero />       character + stroke player + hear + meta
 *     <KanjiDetail.Readings />   on/kun chips, derived romaji
 *     <KanjiDetail.VocabRows />  deduped, glossed, saveable rows
 *     <KanjiDetail.DrawMini />   trace-the-kanji canvas
 *     <KanjiDetail.SenseiTip />  meanings + wrong-flag
 *   </KanjiDetail>
 */

import {
  ensurePlaybackAudioContext,
  playWavBytes,
  speak,
} from "@manobu/speech/tts";
import { saveFsrsToast } from "@manobu/ui/lib/toast";
import { Volume2Icon } from "lucide-react";
import {
  createContext,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KanjiEntry, VocabRow } from "@/lib/kanji";
import { markLearned, markSeen, unmarkLearned } from "@/lib/kanji-progress";
import { useKanji } from "@/lib/kanji-queries";
import { useKanjiStrokes } from "@/lib/kanjivg-queries";
import { kanaToRomaji } from "@/lib/romaji";
import { useTtsPrefs } from "@/lib/tts-voice";
import { KanjiVg } from "@/shared/kanji-vg";
import { ListenButton } from "@/shared/listen-button";

/* ── pure helpers (exported via __test__) ─────────────────────── */

const KATAKANA_START = 0x30_a2;
const KATAKANA_END = 0x30_f3;
const HIRAGANA_OFFSET = 0x60;

/**
 * Romaji for a dictionary reading: on'yomi are katakana (fold to
 * hiragana, −0x60), kun'yomi carry the stem dot (た.べる → ta.beru,
 * which reads correctly as-is).
 */
const readingRomaji = (reading: string): string => {
  const hira = [...reading]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code >= KATAKANA_START && code <= KATAKANA_END) {
        return String.fromCodePoint(code - HIRAGANA_OFFSET);
      }
      return ch;
    })
    .join("");
  return kanaToRomaji(hira);
};

/**
 * vocabContaining concatenates per-level pools, so the same word+reading
 * appearing in two corpora shows twice (食事 N5 + N4). Keep the first
 * occurrence · pools are requested N5→N1, so that is the lowest level.
 */
const dedupeVocab = (rows: readonly VocabRow[]): readonly VocabRow[] => {
  const seen = new Set<string>();
  const out: VocabRow[] = [];
  for (const row of rows) {
    const key = vocabKey(row);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return out;
};

const vocabKey = (row: VocabRow): string => `${row.word}\u0000${row.reading}`;

/* ── context ─────────────────────────────────────────────────── */

interface KanjiDetailState {
  character: string;
  entry: KanjiEntry | null;
  flagged: boolean;
  loading: boolean;
  onFlag: () => void;
  onSaveVocab: (row: VocabRow) => void;
  onUndoVocab: (row: VocabRow) => void;
  /** word\0reading keys saved this session. */
  savedKeys: ReadonlySet<string>;
  /** Vocab rows deduped across levels, in corpus order. */
  vocab: readonly VocabRow[];
}

const Scope = createContext<KanjiDetailState | null>(null);

const useKanjiDetail = (): KanjiDetailState => {
  const ctx = useContext(Scope);
  if (ctx === null) {
    throw new Error("useKanjiDetail must be used within KanjiDetail");
  }
  return ctx;
};

/* ── audio: direct speak(), honest Tauri-only degrade ─────────── */

type AudioMode = "idle" | "loading" | "ok" | "unavailable";

const Audio = () => {
  const { character } = useKanjiDetail();
  const { sid } = useTtsPrefs();
  const [mode, setMode] = useState<AudioMode>("idle");
  const onPlay = useCallback(async () => {
    setMode("loading");
    // Capture the AudioContext synchronously on this click turn, before any
    // `await`. Tauri's Linux WebKitGTK webview drops the user activation once
    // an await resolves, so `Audio(url).play()` after `speak()` rejects with
    // NotAllowedError. `AudioBufferSourceNode.start()` is not gated that way.
    const audioCtx = ensurePlaybackAudioContext();
    try {
      if (!audioCtx) {
        throw new Error("WebAudio is unavailable in this environment");
      }
      const { wav } = await speak(character, { sid });
      await playWavBytes(wav, audioCtx);
      setMode("ok");
    } catch {
      setMode("unavailable");
    }
  }, [character, sid]);
  return (
    <div
      className="flex flex-col items-center gap-0.5"
      data-sid={sid}
      data-testid="kanji-audio"
    >
      <button
        aria-label={`Hear ${character}`}
        className="flex min-h-11 items-center gap-1.5 rounded-card border border-border px-3 py-1 text-sm hover:bg-muted"
        data-testid="kanji-audio-play"
        onClick={onPlay}
        type="button"
      >
        <Volume2Icon aria-hidden="true" className="size-4" />
        hear it
      </button>
      {mode === "unavailable" ? (
        <p
          className="text-muted-foreground text-xs"
          data-testid="kanji-audio-fallback"
        >
          {/* No 🔇 glyph: it renders as a red prohibition circle and reads as
           * breakage for the expected web-build no-audio state (TASK-171). */}
          audio needs the desktop app
        </p>
      ) : null}
    </div>
  );
};

/* ── hero: character + stroke player + hear + meta ────────────── */

/** What the hero says when there's no KanjiVG art, by data state. */
const strokeNote = (
  character: string,
  loading: boolean,
  entry: KanjiEntry | null
): string => {
  if (loading) {
    return "Loading this kanji's data…";
  }
  if (entry === null) {
    return `${character} isn't in the corpus yet.`;
  }
  return `Stroke-order art isn't available for ${character} · it has ${entry.strokeCount} strokes.`;
};

const Hero = () => {
  const { character, entry, loading } = useKanjiDetail();
  const [step, setStep] = useState(0);
  const { data: strokeData } = useKanjiStrokes(character);
  // KanjiVG stroke count is the ground truth when present; KANJIDIC2
  // stroke_count is the fallback (and the no-data total).
  const total = strokeData?.strokes.length ?? entry?.strokeCount ?? 0;
  const onPlay = () => {
    setStep((s) => (total > 0 ? (s + 1) % (total + 1) : 0));
  };
  const onReset = () => {
    setStep(0);
  };
  const meanings = entry?.meaningsEn.slice(0, 3).join(" · ");
  const meta = entry
    ? [
        entry.jlpt,
        entry.grade === null ? null : `grade ${entry.grade}`,
        `${total} strokes`,
        entry.frequency === null ? null : `freq. #${entry.frequency}`,
      ]
        .filter((x): x is string => x !== null)
        .join(" · ")
    : "–";
  return (
    <section
      aria-label={`Kanji ${character}`}
      className="rounded-card border-2 border-border bg-card p-4"
      data-testid="kanji-hero"
    >
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col items-center gap-1">
          <span className="font-mono text-7xl leading-none">{character}</span>
          <Audio />
        </div>
        {strokeData ? (
          <div className="flex flex-col items-center gap-2">
            <div className="text-ink" data-testid="kanjivg-render">
              <KanjiVg
                data={strokeData}
                doneClassName="text-foreground"
                drawingClassName="text-primary"
                guideClassName="text-muted-foreground/40"
                guides
                nextGuideClassName="text-muted-foreground/70"
                visible={step}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                aria-label="Play next stroke"
                className="min-h-11 rounded-card border border-border px-3 py-1 text-sm hover:bg-muted"
                data-testid="kanji-stroke-play"
                onClick={onPlay}
                type="button"
              >
                ▶ stroke
                {step > 0 ? ` ${step}/${total}` : ""}
                {step === total && total > 0 ? " · restart" : ""}
              </button>
              {step > 0 ? (
                <button
                  aria-label="Reset stroke order"
                  className="min-h-11 rounded-card px-2 py-1 text-muted-foreground text-sm underline hover:text-foreground"
                  data-testid="kanji-stroke-reset"
                  onClick={onReset}
                  type="button"
                >
                  reset
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <p
            className="max-w-60 self-center text-muted-foreground text-sm"
            data-testid="kanji-stroke-note"
          >
            {strokeNote(character, loading, entry)}
          </p>
        )}
        <div className="flex min-w-40 flex-1 flex-col gap-1">
          {meanings ? (
            <p className="text-sm" data-testid="kanji-meaning">
              {meanings}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs" data-testid="kanji-meta">
            {meta}
          </p>
        </div>
      </div>
    </section>
  );
};

/* ── draw mini: a canvas that actually paints ─────────────────── */

const DRAW_SIZE = 180;
const STROKE_LINE_WIDTH = 6;

interface DrawPoint {
  x: number;
  y: number;
}

/** Resolve a CSS custom property (canvas attrs can't take var()). */
const cssVar = (name: string): string =>
  typeof window === "undefined"
    ? ""
    : getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const DrawMini = () => {
  const { character } = useKanjiDetail();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [strokes, setStrokes] = useState<DrawPoint[][]>([]);
  const [pointerType, setPointerType] = useState<
    "mouse" | "pen" | "touch" | null
  >(null);

  /* Repaint committed strokes in sumi whenever the set changes. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = cssVar("--foreground") || "#2b2a26";
    ctx.lineWidth = STROKE_LINE_WIDTH;
    for (const stroke of strokes) {
      const first = stroke.at(0);
      if (first === undefined) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const p of stroke.slice(1)) {
        ctx.lineTo(p.x, p.y);
      }
      // a single tap is a dot, not an invisible zero-length line
      if (stroke.length === 1) {
        ctx.lineTo(first.x + 0.1, first.y + 0.1);
      }
      ctx.stroke();
    }
  }, [strokes]);

  /* Geometry comes from the ref, not e.currentTarget: a re-render can
   * detach the synthetic event's target mid-gesture (crashes the route
   * error boundary otherwise). setPointerCapture is best-effort · it
   * throws for pointer ids the browser no longer tracks. */
  const pointOf = (e: ReactPointerEvent<HTMLCanvasElement>): DrawPoint => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is an optimization; drawing works without it */
    }
    drawingRef.current = true;
    setPointerType(e.pointerType);
    setStrokes((s) => [...s, [pointOf(e)]]);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (drawingRef.current !== true) {
      return;
    }
    const p = pointOf(e);
    setStrokes((s) => {
      const last = s.at(-1);
      if (last === undefined) {
        return s;
      }
      return [...s.slice(0, -1), [...last, p]];
    });
  };
  const onPointerUp = () => {
    drawingRef.current = false;
  };
  const onClear = () => {
    setStrokes([]);
  };

  return (
    <section
      aria-label={`Practice writing ${character}`}
      className="flex flex-col items-center gap-2 rounded-card border-2 border-border bg-card p-4"
      data-testid="kanji-practice"
    >
      <p className="text-muted-foreground text-sm">
        Trace {character} · mouse, pen, or finger.
      </p>
      <canvas
        aria-label={`Draw ${character}`}
        className="rounded-card border-2 border-border border-dashed bg-transparent focus-visible:outline-ring"
        data-pointer-type={pointerType ?? ""}
        data-stroke-count={strokes.length}
        data-testid="kanji-draw-mini"
        height={DRAW_SIZE}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        ref={canvasRef}
        style={{ touchAction: "none", width: `${DRAW_SIZE}px` }}
        tabIndex={0}
        width={DRAW_SIZE}
      />
      <button
        className="min-h-11 rounded-card px-2 py-1 text-muted-foreground text-xs underline hover:text-foreground"
        data-testid="kanji-draw-clear"
        onClick={onClear}
        type="button"
      >
        clear
      </button>
    </section>
  );
};

/* ── readings ─────────────────────────────────────────────────── */

const Readings = () => {
  const { entry } = useKanjiDetail();
  const [mode, setMode] = useState<"on" | "kun">("on");
  const list = mode === "on" ? (entry?.on ?? []) : (entry?.kun ?? []);
  const pickOn = useCallback(() => {
    setMode("on");
  }, []);
  const pickKun = useCallback(() => {
    setMode("kun");
  }, []);
  const chip = (active: boolean) =>
    active
      ? "min-h-11 rounded-card border-2 border-primary px-3 py-1 font-mono text-sm"
      : "min-h-11 rounded-card border border-border px-3 py-1 font-mono text-sm text-muted-foreground hover:bg-muted";
  return (
    <section
      aria-label="Readings"
      className="rounded-card border-2 border-border bg-card p-4"
      data-testid="kanji-readings"
    >
      <div className="flex items-center gap-2">
        <button
          aria-pressed={mode === "on"}
          className={chip(mode === "on")}
          data-testid="kanji-readings-on"
          onClick={pickOn}
          type="button"
        >
          on
        </button>
        <button
          aria-pressed={mode === "kun"}
          className={chip(mode === "kun")}
          data-testid="kanji-readings-kun"
          onClick={pickKun}
          type="button"
        >
          kun
        </button>
      </div>
      <ul
        aria-live="polite"
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1"
        data-testid="kanji-readings-list"
      >
        {list.map((r) => (
          <li className="text-sm" key={r}>
            <span className="font-mono">{r}</span>{" "}
            <span className="text-muted-foreground text-xs">
              {readingRomaji(r)}
            </span>
          </li>
        ))}
        {list.length === 0 ? (
          <li className="text-muted-foreground text-sm">
            {mode === "on" ? "no on reading" : "no kun reading"}
          </li>
        ) : null}
      </ul>
    </section>
  );
};

/* ── vocab rows ───────────────────────────────────────────────── */

const VOCAB_PREVIEW = 12;
interface VocabRowItemProps {
  onSaved: (row: VocabRow) => void;
  onUndone: (row: VocabRow) => void;
  row: VocabRow;
  saved: boolean;
}

const VocabRowItem = ({ onSaved, onUndone, row, saved }: VocabRowItemProps) => {
  const onSaveClick = () => {
    /* Mark now: saveFsrsToast resolves true on UNDO (see its docs), so
     * awaiting it to "confirm" would record saves exactly when the user
     * cancels them · the inverted-RightRail bug. onUndo un-marks. */
    onSaved(row);
    saveFsrsToast({
      n: 1,
      onUndo: () => {
        onUndone(row);
      },
      retention: 0.9,
    }).catch(() => {
      /* toast failure shouldn't break the click handler */
    });
  };
  return (
    <li
      className="flex min-h-[44px] items-center gap-2 rounded-card border-2 border-border bg-card px-3 py-1"
      data-level={row.level}
      data-saved={saved}
      data-testid="kanji-vocab-row"
    >
      <span className="font-mono text-base">{row.word}</span>
      <span className="text-muted-foreground text-xs">
        {row.reading} · {readingRomaji(row.reading)}
      </span>
      {row.gloss ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">
          {row.gloss}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      <span className="rounded-card border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {row.level}
      </span>
      <ListenButton
        testId={`kanji-vocab-hear-${row.word}-${row.reading}`}
        text={row.reading}
      />
      <button
        aria-pressed={saved}
        className={
          saved
            ? "min-h-11 rounded-card px-2 text-muted-foreground text-xs"
            : "min-h-11 rounded-card border border-border px-2.5 py-1 text-xs hover:bg-muted"
        }
        data-testid="kanji-vocab-save"
        disabled={saved}
        onClick={onSaveClick}
        type="button"
      >
        {saved ? "saved ✓" : "save"}
      </button>
    </li>
  );
};

const VocabRows = () => {
  const { vocab, savedKeys, onSaveVocab, onUndoVocab } = useKanjiDetail();
  const [showAll, setShowAll] = useState(false);
  const onToggleShowAll = () => {
    setShowAll((s) => !s);
  };
  if (vocab.length === 0) {
    return (
      <p
        className="text-muted-foreground text-sm"
        data-testid="kanji-vocab-empty"
      >
        No vocabulary found for this kanji · it may not be in the corpus yet.
      </p>
    );
  }
  const shown = showAll ? vocab : vocab.slice(0, VOCAB_PREVIEW);
  return (
    <section
      aria-label="Words using this kanji"
      className="flex flex-col gap-2"
      data-testid="kanji-vocab-section"
    >
      <h2 className="text-muted-foreground text-xs">Words</h2>
      <ul className="flex flex-col gap-1">
        {shown.map((v) => (
          <VocabRowItem
            key={vocabKey(v)}
            onSaved={onSaveVocab}
            onUndone={onUndoVocab}
            row={v}
            saved={savedKeys.has(vocabKey(v))}
          />
        ))}
      </ul>
      {vocab.length > VOCAB_PREVIEW ? (
        <button
          className="min-h-11 self-start rounded-card px-2 py-1 text-muted-foreground text-xs underline hover:text-foreground"
          data-testid="kanji-vocab-more"
          onClick={onToggleShowAll}
          type="button"
        >
          {showAll ? "show less" : `show all ${vocab.length} words`}
        </button>
      ) : null}
    </section>
  );
};

/* ── sensei tip ───────────────────────────────────────────────── */

const SenseiTip = () => {
  const { entry, flagged, onFlag } = useKanjiDetail();
  const meaning = entry?.meaningsEn.slice(0, 2).join(", ") ?? "–";
  return (
    <section
      aria-label="Meaning source"
      className="flex flex-wrap items-center gap-2 rounded-card border-2 border-border bg-card p-4"
      data-flagged={flagged}
      data-testid="kanji-sensei-tip"
    >
      <p className="text-muted-foreground text-sm">
        meaning from KANJIDIC ·{" "}
        <span className="text-foreground">{meaning}</span>
      </p>
      <button
        aria-pressed={flagged}
        className="min-h-11 rounded-card border border-border px-2.5 py-1 text-muted-foreground text-xs hover:bg-muted"
        data-testid="kanji-sensei-flag"
        onClick={onFlag}
        type="button"
      >
        {flagged ? "flagged ✓" : "this is wrong"}
      </button>
      {flagged ? (
        <p
          className="w-full text-muted-foreground text-xs"
          data-testid="kanji-sensei-flag-note"
        >
          Thanks · flagged for review.
        </p>
      ) : null}
    </section>
  );
};

/* ── root provider ────────────────────────────────────────────── */

interface KanjiDetailProps {
  character?: string;
  children: ReactNode;
}

const KanjiDetailRoot = ({ character = "食", children }: KanjiDetailProps) => {
  const [flagged, setFlagged] = useState(false);
  const [savedKeys, setSavedKeys] = useState<ReadonlySet<string>>(
    new Set<string>()
  );
  const { data, isPending } = useKanji(character);
  const entry = data?.entry ?? null;
  const vocab = useMemo(() => dedupeVocab(data?.vocab ?? []), [data]);
  /* Opening a character's page is the "seen" signal for the grid
   * (TASK-75). Idempotent per day-free store; never throws. */
  useEffect(() => {
    markSeen(character);
  }, [character]);
  const flag = useCallback(() => {
    setFlagged((f) => !f);
  }, []);
  const saveVocab = useCallback(
    (row: VocabRow) => {
      setSavedKeys((s) => {
        const next = new Set(s);
        next.add(vocabKey(row));
        return next;
      });
      markLearned(character, vocabKey(row));
    },
    [character]
  );
  const undoVocab = useCallback(
    (row: VocabRow) => {
      setSavedKeys((s) => {
        const next = new Set(s);
        next.delete(vocabKey(row));
        return next;
      });
      unmarkLearned(character, vocabKey(row));
    },
    [character]
  );
  const ctx: KanjiDetailState = {
    character,
    entry,
    flagged,
    loading: isPending,
    onFlag: flag,
    onSaveVocab: saveVocab,
    onUndoVocab: undoVocab,
    savedKeys,
    vocab,
  };
  return (
    <Scope.Provider value={ctx}>
      <div
        className="flex flex-col gap-3"
        data-loading={isPending}
        data-testid="kanji-detail"
      >
        {children}
      </div>
    </Scope.Provider>
  );
};

export const KanjiDetail = Object.assign(KanjiDetailRoot, {
  DrawMini,
  Hero,
  Readings,
  SenseiTip,
  VocabRows,
});

export const __test__ = { DRAW_SIZE, dedupeVocab, readingRomaji, strokeNote };
