/*
 * Drill Lab (SCR-03) · the sensei's card machine (redesign 2026-09-13).
 *
 * One card, one question, three equal ways to answer it:
 *   ✍ draw   pointer/pen/touch, graded per stroke against the KanjiVG path
 *   あ pick   4-choice recognition (nearest-neighbour distractors)
 *   🎤 say   bounded STT capture (degrades to a disabled chip, never a fake grade)
 *
 * The mark moment is the loop: a clean card gets the 朱 stamp dot and
 * auto-advances (~1s); a missed stroke redraws itself in shu over your ink
 * (the red pen IS the lesson · Motif 2, earned contrast) and the card waits
 * for a tap so the correction lands. Wrong cards resurface at set end
 * ("3 to redo"), honest counts, no streaks.
 *
 * Stroke animation (shared <KanjiVg> from @/shared/kanji-vg): the first
 * card of a set auto-plays the stroke order · each stroke draws in ai, then
 * settles to faint sumi. After that, sensei never nags twice: the ghost
 * waits, [◉ replay] re-runs on request, a tap mid-animation skips to end.
 * While you draw, the NEXT guide stroke stays ai so the sequence is tracked,
 * not guessed (Motif 1: help on request).
 *
 * Decks: ひらがな / カタカナ / 漢字 N5 (the route owns the tabs; DrillLab
 * just receives `chars`). Mode is sticky (localStorage), decks are not.
 *
 * Composition: DrillLab is one state machine; the render halves (card face,
 * audio row, chips, ladder, summary) are module-level components so the
 * machine stays under the complexity budget.
 */

import { ensurePlaybackAudioContext } from "@manobu/speech/tts";
import { log } from "@manobu/ui/lib/gsm";
import { Link } from "@tanstack/react-router";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { StrokeOrderData } from "@/lib/kanjivg";
import { useKanjiStrokes } from "@/lib/kanjivg-queries";
import { kanaMatch, recordAndTranscribe } from "@/lib/mic-stt";
import { useTtsPrefs } from "@/lib/tts-voice";
import {
  KANJIVG_VIEWBOX,
  KanjiVg,
  STROKE_DURATION_MS,
} from "@/shared/kanji-vg";

export interface DrillChar {
  char: string;
  /** Kanji deck extras (data/kanji-n5.json): meanings + readings + strokes. */
  gloss?: string;
  /** Kana category · populated when the char comes from kana.json (TASK-23.2). */
  kind?:
    | "gojuon"
    | "dakuten"
    | "yoon"
    | "katakana"
    | "katakana-dakuten"
    | "katakana-yoon"
    | "word";
  kun?: string[];
  level: "N5" | "N4" | "N3" | "N2" | "N1";
  /** Optional English mnemonic (TASK-23.2 A2). */
  mnemonic?: string;
  on?: string[];
  romaji: string;
  row?: string;
  strokeCount?: number;
}

interface Point {
  x: number;
  y: number;
}

/* ── geometry ────────────────────────────────────────────────── */

/** Square card edge in CSS px (was a 280×140 landscape slab). */
const CARD_PX = 280;

/** Legacy tolerance: 40px was calibrated for the 280px canvas. */
const GHOST_TOLERANCE_PX = 40;

/** Tolerance scaled to the card size in use. */
const strokeTolerance = (sizePx: number): number =>
  (GHOST_TOLERANCE_PX * sizePx) / 280;

/** Order + direction within tolerance · not pixel-perfect. */
const gradeShape = (
  drawn: Point[],
  target: Point[],
  tolerance = GHOST_TOLERANCE_PX
): boolean => {
  if (drawn.length < 2 || target.length < 2) {
    return false;
  }
  const n = Math.min(drawn.length, target.length);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const a = drawn[Math.floor((i / n) * drawn.length)];
    const b = target[Math.floor((i / n) * target.length)];
    if (!(a && b)) {
      continue;
    }
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total / n <= tolerance;
};

/** Points sampled along an SVG path, scaled into card space. */
const SAMPLE_COUNT = 24;
let samplerSvg: SVGSVGElement | null = null;
const samplePath = (d: string, scale: number): Point[] => {
  if (typeof document === "undefined") {
    return [];
  }
  if (!samplerSvg?.isConnected) {
    samplerSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    samplerSvg.appendChild(path);
    samplerSvg.style.position = "fixed";
    document.body.appendChild(samplerSvg);
  }
  const sampler = samplerSvg.querySelector("path");
  if (!sampler) {
    return [];
  }
  sampler.setAttribute("d", d);
  const len = sampler.getTotalLength();
  const pts: Point[] = [];
  for (let i = 0; i <= SAMPLE_COUNT; i += 1) {
    const p = sampler.getPointAtLength((len * i) / SAMPLE_COUNT);
    pts.push({ x: p.x * scale, y: p.y * scale });
  }
  return pts;
};

/** Resolve a CSS custom property (canvas/SVG attrs can't take var()). */
const cssVar = (name: string): string =>
  typeof document === "undefined"
    ? ""
    : getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Paint committed + live strokes in sumi onto the ink canvas. */
const paintInk = (
  ctx: CanvasRenderingContext2D | null,
  dpr: number,
  strokes: Point[][]
): void => {
  if (!ctx) {
    return;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, CARD_PX, CARD_PX);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = cssVar("--foreground") || "#2b2a26";
  for (const stroke of strokes) {
    if (stroke.length < 2) {
      const [dot] = stroke;
      if (dot) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }
      continue;
    }
    ctx.beginPath();
    const [first, ...rest] = stroke;
    if (first) {
      ctx.moveTo(first.x, first.y);
    }
    for (const p of rest) {
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
};

/* ── mic + timing ─────────────────────────────────────────────── */

type MicState = "checking" | "ok" | "missing";

/**
 * Resolve the mic once at mount: no getUserMedia → missing; permission
 * denied → missing; otherwise trust enumerateDevices. A denied permission
 * still lists devices, hence the permission query first.
 */
const detectMic = async (): Promise<MicState> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "missing";
  }
  try {
    const perm = await navigator.permissions?.query?.({
      name: "microphone" as PermissionName,
    });
    if (perm?.state === "denied") {
      return "missing";
    }
  } catch {
    /* permissions API missing: fall through to device listing */
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === "audioinput") ? "ok" : "missing";
  } catch {
    return "missing";
  }
};

/** STT errors that mean "this machine has no usable mic" (vs transient). */
const MIC_DEAD_RE = /permission|notfound|device/i;

/** One kana is spoken in ~1s · 3s capture is generous but bounded. */
const SPEAK_RECORD_MS = 3000;
/** The 朱 stamp beat before the card turns. */
const CORRECT_HOLD_MS = 1000;
/** Intro animation: stroke draw + a settle pause before the next one. */
const INTRO_STEP_MS = STROKE_DURATION_MS + 220;

const MODE_KEY = "manobu.drillMode";
type Mode = "draw" | "pick" | "say";
type Phase = "loading" | "intro" | "ready" | "correct" | "wrong";

/**
 * First-run mode for a learner with no stored preference. `pick` because it is
 * the only mode that answers with a tap on every deck, needing neither a
 * microphone nor stroke-order knowledge (TASK-162).
 */
const DEFAULT_MODE: Mode = "pick";

/** A stored preference wins; anything else (absent, garbage) is the default. */
const resolveMode = (stored: string | null): Mode =>
  stored === "draw" || stored === "pick" || stored === "say"
    ? stored
    : DEFAULT_MODE;

const loadMode = (): Mode => {
  try {
    return resolveMode(localStorage.getItem(MODE_KEY));
  } catch {
    // private mode or no storage at all: the default, not a crash.
    return resolveMode(null);
  }
};

/**
 * What the ACTIVE mode asks, in the learner's terms. `pick` names the cue
 * because TASK-168 took the target off the card until the verdict: the task is
 * recalling the form from the cue, not finding a shape already printed.
 */
const MODE_INSTRUCTION: Record<Mode, string> = {
  draw: "trace each stroke over the faint guide",
  pick: "read the cue, then tap its character",
  say: "say this character out loud",
};

/**
 * How much of the character the square shows. `pick` holds the form back for
 * the verdict (TASK-168): the ghost and its guides are the answer, drawn in
 * faint strokes the four choices are asking for.
 */
const ghostStrokes = ({
  introVisible,
  mode,
  phase,
  strokeCount,
  strokeIndex,
}: {
  introVisible: number;
  mode: Mode;
  phase: Phase;
  strokeCount: number;
  strokeIndex: number;
}): number => {
  if (mode === "pick") {
    return phase === "correct" || phase === "wrong" ? strokeCount : 0;
  }
  return phase === "intro" ? introVisible : Math.min(strokeIndex, strokeCount);
};

/* ── pronunciation ────────────────────────────────────────────── */
/** Katakana → hiragana fold (KANJIDIC on-readings are katakana; STT says hiragana). */
const kanaFold = (s: string): string =>
  s.replace(/[ァ-ヴ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * Grade a pronunciation against the card: kana cards match the char itself
 * (same contract as mic-stt's pronunciationGrade); kanji cards match ANY of
 * the deck entry's on/kun readings (markers stripped, katakana folded).
 */
const gradePronunciation = (
  transcribed: string | null,
  current: DrillChar
): 1 | 3 => {
  if (transcribed === null) {
    return 1;
  }
  if (current.strokeCount === undefined) {
    return kanaMatch(transcribed, current.char) ? 3 : 1;
  }
  const t = kanaFold(transcribed);
  const readings = [...(current.on ?? []), ...(current.kun ?? [])]
    .map((r) => kanaFold(r).replace(/[.\-\s]/g, ""))
    .filter((r) => r.length > 0);
  return readings.some((r) => t.includes(r)) ? 3 : 1;
};

/* ── distractors ──────────────────────────────────────────────── */

/** Deck positions in nearest-first order: +1, -1, +2, -2, … (wrapped). */
const nearestOffsets = (at: number, n: number): number[] => {
  const offsets: number[] = [];
  for (let d = 1; d < n; d += 1) {
    offsets.push((at + d) % n, (((at - d) % n) + n) % n);
  }
  return offsets;
};

/**
 * 4-choice picker: the correct char + 3 distractors taken from the deck
 * positions NEAREST to the current char (adjacent gojūon rows / frequency
 * neighbours) · the confusable ones, not an arbitrary sample.
 */
export const typeFallbackChoices = (
  current: DrillChar,
  chars: DrillChar[],
  options: { deterministic?: boolean } = {}
): string[] => {
  const target = current.char;
  const at = chars.findIndex((c) => c.char === target);
  const pool: string[] = [];
  if (at >= 0) {
    for (const j of nearestOffsets(at, chars.length)) {
      const c = chars[j];
      if (c && c.char !== target && !pool.includes(c.char)) {
        pool.push(c.char);
        if (pool.length === 3) {
          break;
        }
      }
    }
  }
  const all = options.deterministic
    ? [target, ...pool]
    : shuffle([target, ...pool]);
  return all.slice(0, 4);
};

const shuffle = <T,>(arr: T[]): T[] => {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) {
      continue;
    }
    out[i] = b;
    out[j] = a;
  }
  return out;
};

/* ── set-end first word (TASK-60 AC4, kept from the old Victory) ─ */

const VICTORY_FLAG = "manobu.victoryShown";

const FIRST_WORDS: Record<
  string,
  { gloss: string; jp: string; romaji: string }
> = {
  gojuon: { gloss: "rain", jp: "あめ", romaji: "ame" },
  katakana: { gloss: "ice cream", jp: "アイス", romaji: "aisu" },
};

const victoryWordFor = (
  chars: DrillChar[]
): { gloss: string; jp: string; kind: string; romaji: string } | null => {
  const hasKatakana = chars.some((c) => c.kind === "katakana");
  const word = hasKatakana ? FIRST_WORDS.katakana : FIRST_WORDS.gojuon;
  const kind = hasKatakana ? "katakana" : "gojuon";
  const usable =
    kind === "katakana"
      ? chars.some((c) => "アイス".includes(c.char))
      : chars.some((c) => "あめ".includes(c.char));
  return usable ? { ...word, kind } : null;
};

/* ── the machine ──────────────────────────────────────────────── */

interface DrillLabProps {
  initial: {
    chars: DrillChar[];
    /** Deck label for the summary heading ("Hiragana", "Kanji N5", …). */
    deckLabel: string;
  };
  onGrade?: (grade: 1 | 2 | 3 | 4) => void;
}

export function DrillLab({ initial, onGrade }: DrillLabProps) {
  const { chars, deckLabel } = initial;
  const [fallback] = chars;
  if (!fallback) {
    throw new Error("DrillLab requires at least one char in initial.chars");
  }

  /* order: deck positions in play; redo: positions that missed, run at end */
  const [order, setOrder] = useState<number[]>(() => chars.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [redo, setRedo] = useState<number[]>([]);
  const [results, setResults] = useState<Record<number, "correct" | "wrong">>(
    {}
  );
  const [phase, setPhase] = useState<Phase>("loading");
  const [mode, setMode] = useState<Mode>(loadMode);
  const [micState, setMicState] = useState<MicState>("checking");
  const [sttError, setSttError] = useState<string | null>(null);
  const [summary, setSummary] = useState(false);

  /* per-card drawing state */
  const [strokeIndex, setStrokeIndex] = useState(0);
  const [missed, setMissed] = useState<number[]>([]);
  const [ink, setInk] = useState<Point[][]>([]);
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [introVisible, setIntroVisible] = useState(0);
  const introPlayedRef = useRef(false);
  const introTimerRef = useRef<number | null>(null);

  const deckIndex = order[pos] ?? 0;
  const current = chars[deckIndex] ?? fallback;
  const { data: strokeData } = useKanjiStrokes(current.char);
  const strokeCount = strokeData?.strokes.length ?? 0;
  const { sid } = useTtsPrefs();
  const [speed, setSpeed] = useState<1 | 0.8>(1);

  /* TASK-68: lesson_start is LESSON-scoped · once per mount / new set. */
  useEffect(() => {
    log("lesson_start", { set: initial.chars.length });
  }, [initial.chars.length]);

  const stopIntro = useCallback(() => {
    if (introTimerRef.current !== null) {
      window.clearInterval(introTimerRef.current);
      introTimerRef.current = null;
    }
  }, []);

  /* Mic detection: the chip starts checking, resolves to ok | missing. */
  useEffect(() => {
    let cancelled = false;
    detectMic().then((state) => {
      if (!cancelled) {
        setMicState(state);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetCard = useCallback(() => {
    setStrokeIndex(0);
    setMissed([]);
    setInk([]);
    setCorrecting(null);
    setPicked(null);
    setIntroVisible(0);
    setSttError(null);
    setPhase("loading");
  }, []);

  const advance = useCallback(() => {
    stopIntro();
    if (pos + 1 >= order.length) {
      setSummary(true);
      return;
    }
    setPos((p) => p + 1);
    resetCard();
  }, [order.length, pos, resetCard, stopIntro]);

  const finishCard = useCallback(
    (good: boolean) => {
      setResults((r) => ({ ...r, [deckIndex]: good ? "correct" : "wrong" }));
      if (!good) {
        setRedo((q) => (q.includes(deckIndex) ? q : [...q, deckIndex]));
      }
      onGrade?.(good ? 3 : 1);
      setPhase(good ? "correct" : "wrong");
      log("grade", { char: current.char, correct: good, source: mode });
    },
    [current.char, deckIndex, mode, onGrade]
  );

  /* Card lifecycle: when stroke data settles, either auto-play the order
   * (first card of the set only) or go straight to ready. Chars without
   * stroke data (server unreachable) still work: pick/say carry the set,
   * draw explains itself. `pick` never sweeps: the animation draws the very
   * character the four choices are asking for (TASK-168). */
  useEffect(() => {
    if (phase !== "loading" || strokeData === undefined) {
      return;
    }
    if (strokeData === null || strokeCount === 0) {
      setPhase("ready");
      return;
    }
    if (mode !== "pick" && introPlayedRef.current !== true) {
      introPlayedRef.current = true;
      setPhase("intro");
      return;
    }
    setPhase("ready");
  }, [mode, phase, strokeCount, strokeData]);

  /* The intro sweep: one stroke every INTRO_STEP_MS. */
  useEffect(() => {
    if (phase !== "intro" || strokeCount === 0) {
      return;
    }
    setIntroVisible(1);
    introTimerRef.current = window.setInterval(() => {
      setIntroVisible((v) => v + 1);
    }, INTRO_STEP_MS);
    return stopIntro;
  }, [phase, stopIntro, strokeCount]);

  /* Completion watcher (no side effects inside the state updater). */
  useEffect(() => {
    if (phase === "intro" && strokeCount > 0 && introVisible >= strokeCount) {
      stopIntro();
      setPhase("ready");
    }
  }, [introVisible, phase, stopIntro, strokeCount]);

  /* Correct → the 朱 stamp holds for a beat, then the card turns. */
  useEffect(() => {
    if (phase !== "correct") {
      return;
    }
    const t = window.setTimeout(advance, CORRECT_HOLD_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [advance, phase]);

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // private mode: sticky for this session only
    }
  }, []);

  const onPickChoice = useCallback(
    (c: string) => {
      if (phase !== "ready" || picked !== null) {
        return;
      }
      setPicked(c);
      finishCard(c === current.char);
    },
    [current.char, finishCard, phase, picked]
  );

  /* ── draw path ───────────────────────────────────────────────── */

  const onStrokeComplete = useCallback(
    (points: Point[]) => {
      if (!strokeData || correcting !== null || phase !== "ready") {
        return;
      }
      const stroke = strokeData.strokes[strokeIndex];
      if (!stroke) {
        return;
      }
      const scale = CARD_PX / KANJIVG_VIEWBOX;
      const ok = gradeShape(
        points,
        samplePath(stroke.d, scale),
        strokeTolerance(CARD_PX)
      );
      setInk((prev) => [...prev, points]);
      if (ok) {
        if (strokeIndex + 1 >= strokeCount) {
          finishCard(missed.length === 0);
        } else {
          setStrokeIndex(strokeIndex + 1);
        }
        return;
      }
      // The miss is corrected immediately, in shu, over the attempt.
      setMissed((m) => [...m, strokeIndex]);
      setCorrecting(strokeIndex);
    },
    [
      correcting,
      finishCard,
      missed,
      phase,
      strokeCount,
      strokeData,
      strokeIndex,
    ]
  );

  const onCorrectionDone = useCallback(() => {
    setCorrecting(null);
    if (strokeIndex + 1 >= strokeCount) {
      finishCard(false);
    } else {
      setStrokeIndex(strokeIndex + 1);
    }
  }, [finishCard, strokeCount, strokeIndex]);

  /* ── say path ────────────────────────────────────────────────── */

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const onSpeak = useCallback(async () => {
    if (listening || phase !== "ready") {
      return;
    }
    setSttError(null);
    setListening(true);
    const attempt = await recordAndTranscribe(`drill-${current.romaji}`, {
      maxMs: SPEAK_RECORD_MS,
      // Live VAD indicator (TASK-21.3): speaking/silent drives data-speaking.
      onActivity: (a) => {
        setSpeaking(a.speaking);
      },
    });
    setSpeaking(false);
    setListening(false);
    if (!attempt.ok) {
      setSttError(attempt.error);
      if (attempt.error !== null && MIC_DEAD_RE.test(attempt.error)) {
        setMicState("missing");
      }
      return;
    }
    finishCard(gradePronunciation(attempt.text, current) === 3);
  }, [current, finishCard, listening, phase]);

  /* ── audio ───────────────────────────────────────────────────── */

  const onPlay = useCallback(async () => {
    const isInTauri = typeof window !== "undefined" && "__TAURI__" in window;
    if (!isInTauri) {
      return; // web dev: TTS is Tauri-only.
    }
    // Capture the AudioContext synchronously on this click turn, BEFORE the
    // dynamic import's `await`: WebKitGTK closes the user activation once an
    // await resolves, so `Audio(url).play()` after `speak()` rejects silent.
    const audioCtx = ensurePlaybackAudioContext();
    if (!audioCtx) {
      return;
    }
    try {
      // Platform-specific: @manobu/speech/tts resolves only inside the Tauri
      // runtime (native speech model); a static import breaks the web build.
      const { playWavBytes, speak } = await import("@manobu/speech/tts");
      const { wav } = await speak(current.char, { sid, speed });
      await playWavBytes(wav, audioCtx);
    } catch {
      // Initialized-Tauri speak failure: silent graceful skip.
    }
  }, [current.char, sid, speed]);

  const onSlow = useCallback(() => {
    setSpeed(0.8);
  }, []);
  const onNormal = useCallback(() => {
    setSpeed(1);
  }, []);

  const replay = useCallback(() => {
    if (!strokeData || strokeCount === 0) {
      return;
    }
    stopIntro();
    setStrokeIndex(0);
    setMissed([]);
    setInk([]);
    setCorrecting(null);
    setPicked(null);
    setIntroVisible(0);
    setPhase("intro");
  }, [strokeCount, strokeData, stopIntro]);

  /* Skip the sweep on tap · impatient repeat users exist. */
  const skipIntro = useCallback(() => {
    if (phase !== "intro") {
      return;
    }
    stopIntro();
    setIntroVisible(strokeCount);
    setPhase("ready");
  }, [phase, stopIntro, strokeCount]);

  /* ── summary exits ───────────────────────────────────────────── */

  const exitSummary = useCallback(() => {
    setOrder(chars.map((_, i) => i));
    setPos(0);
    setRedo([]);
    setResults({});
    introPlayedRef.current = false;
    setSummary(false);
    resetCard();
  }, [chars, resetCard]);

  const redoSummary = useCallback(() => {
    setOrder(redo);
    setPos(0);
    setRedo([]);
    setResults({});
    setSummary(false);
    resetCard();
  }, [redo, resetCard]);

  /* ── derived ─────────────────────────────────────────────────── */

  const mastered = useMemo(
    () => Object.values(results).filter((r) => r === "correct").length,
    [results]
  );
  const choices = useMemo(
    () => typeFallbackChoices(current, chars),
    [chars, current]
  );
  const ghostVisible = ghostStrokes({
    introVisible,
    mode,
    phase,
    strokeCount,
    strokeIndex,
  });
  const inkLocked = mode !== "draw" || phase !== "ready" || correcting !== null;

  if (summary) {
    return (
      <SetSummary
        chars={chars}
        deckLabel={deckLabel}
        onExit={exitSummary}
        onRedo={redoSummary}
        redo={redo}
        results={results}
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <CardFace
        advance={advance}
        correcting={correcting}
        current={current}
        ghostVisible={ghostVisible}
        ink={ink}
        inkLocked={inkLocked}
        missed={missed}
        modeDraw={mode === "draw"}
        modePick={mode === "pick"}
        onComplete={onStrokeComplete}
        onCorrectionDone={onCorrectionDone}
        onSkipIntro={skipIntro}
        phase={phase}
        strokeData={strokeData ?? null}
      />

      <AudioRow
        char={current.char}
        onNormal={onNormal}
        onPlay={onPlay}
        onReplay={replay}
        onSlow={onSlow}
        replayDisabled={!strokeData}
        speed={speed}
      />

      <fieldset
        className="flex flex-col items-center gap-2"
        data-testid="drill-mode-chips"
      >
        <legend className="text-muted-foreground text-xs">Answer mode</legend>
        <div className="flex items-start gap-2">
          <ModeChip
            active={mode === "draw"}
            icon="✍"
            label="draw it"
            onSelect={switchMode}
            value="draw"
          />
          <ModeChip
            active={mode === "pick"}
            icon="あ"
            label="pick it"
            onSelect={switchMode}
            value="pick"
          />
          <ModeChip
            active={mode === "say"}
            disabled={micState === "missing"}
            hint={micState === "missing" ? "no microphone detected" : undefined}
            icon="🎤"
            label="say it"
            onSelect={switchMode}
            value="say"
          />
        </div>
        <p
          aria-live="polite"
          className="text-center text-sm"
          data-testid="drill-mode-instruction"
        >
          {MODE_INSTRUCTION[mode]}
        </p>
      </fieldset>

      {mode === "pick" ? (
        <PickGrid
          choices={choices}
          current={current}
          onPick={onPickChoice}
          picked={picked}
        />
      ) : null}

      {mode === "say" ? (
        <SayPanel
          listening={listening}
          micOk={micState === "ok"}
          onSpeak={onSpeak}
          phase={phase}
          speaking={speaking}
          sttError={sttError}
        />
      ) : null}

      <Ladder
        chars={chars}
        current={deckIndex}
        mastered={mastered}
        order={order}
        pos={pos}
        redo={redo}
        results={results}
      />
    </div>
  );
}

/* ── card face ────────────────────────────────────────────────── */

interface CardFaceProps {
  advance: () => void;
  correcting: number | null;
  current: DrillChar;
  ghostVisible: number;
  ink: Point[][];
  inkLocked: boolean;
  missed: number[];
  modeDraw: boolean;
  modePick: boolean;
  onComplete: (points: Point[]) => void;
  onCorrectionDone: () => void;
  onSkipIntro: () => void;
  phase: Phase;
  strokeData: StrokeOrderData | null;
}

const cardSubtitle = (current: DrillChar): string => {
  if (current.strokeCount === undefined) {
    return `${current.romaji}${current.mnemonic ? ` · ${current.mnemonic}` : ""}`;
  }
  const readings = [...(current.on ?? []), ...(current.kun ?? [])].join("・");
  return `${current.romaji} · ${readings} · ${current.gloss ?? ""} · ${current.strokeCount}画`;
};

/**
 * What pick asks the learner to answer FROM: the reading for a kana card, the
 * meaning for a kanji card (TASK-168). Neither can contain the form, which is
 * the point: printing `current.char` here turns the task back into matching.
 */
const pickCue = (current: DrillChar): string =>
  current.strokeCount === undefined
    ? current.romaji
    : (current.gloss ?? current.romaji);

const CardFace = ({
  advance,
  correcting,
  current,
  ghostVisible,
  ink,
  inkLocked,
  missed,
  modeDraw,
  modePick,
  onCorrectionDone,
  onComplete,
  onSkipIntro,
  phase,
  strokeData,
}: CardFaceProps) => {
  const onCardTap = () => {
    if (phase === "wrong") {
      advance();
    } else {
      onSkipIntro();
    }
  };
  /* TASK-168: in pick the form IS the answer, so it waits for the verdict. */
  const revealed = phase === "correct" || phase === "wrong";
  const askCue = modePick && !revealed;
  return (
    <div className="flex flex-col items-center">
      <div
        className="mb-3 text-center"
        style={{ maxWidth: `${CARD_PX + 16}px` }}
      >
        <p className="font-semibold text-2xl" data-testid="drill-card-top">
          {askCue ? pickCue(current) : current.char}
        </p>
        {askCue ? null : (
          <p
            className="text-muted-foreground text-xs"
            data-testid="drill-subtitle"
          >
            {cardSubtitle(current)}
          </p>
        )}
      </div>

      <div
        aria-busy={phase === "loading"}
        className="relative rounded-card border-2 bg-card p-2"
        data-phase={phase}
        data-testid="drill-card"
        style={{
          borderColor: phase === "wrong" ? "var(--mark)" : "var(--border)",
          height: CARD_PX + 16,
          width: CARD_PX + 16,
        }}
      >
        {/* 米字格 practice guides: hairline cross, 紙 only */}
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-2"
          height={CARD_PX}
          viewBox={`0 0 ${CARD_PX} ${CARD_PX}`}
          width={CARD_PX}
        >
          <g stroke="var(--border)" strokeDasharray="3 5" strokeWidth="1">
            <line x1={CARD_PX / 2} x2={CARD_PX / 2} y1={8} y2={CARD_PX - 8} />
            <line x1={8} x2={CARD_PX - 8} y1={CARD_PX / 2} y2={CARD_PX / 2} />
          </g>
        </svg>

        {/* the ghost: stroke sequence in 藍・墨 · while a pick is still
         * unanswered its guides would draw the answer (TASK-168) */}
        {askCue ? null : (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-2"
            data-testid="drill-ghost"
          >
            <KanjiVg
              animate={phase === "intro"}
              data={strokeData}
              doneClassName="text-muted-foreground/30"
              drawingClassName="text-primary"
              guideClassName="text-muted-foreground/30"
              guides={phase !== "intro"}
              nextGuideClassName="text-primary/60"
              numbers={false}
              size={CARD_PX}
              visible={ghostVisible}
            />
          </div>
        )}

        <InkCanvas
          ink={ink}
          locked={inkLocked}
          onComplete={onComplete}
          onPointerDown={onSkipIntro}
        />

        {/* the red pen: missed strokes redrawn in 朱 over the attempt */}
        <RedPen
          correcting={correcting}
          missed={missed}
          onCorrectionDone={onCorrectionDone}
          strokeData={strokeData}
        />

        {phase === "correct" ? (
          <span
            aria-hidden="true"
            className="absolute top-2.5 right-2.5 size-2.5 rounded-full bg-mark"
            data-testid="drill-stamp"
          />
        ) : null}

        {strokeData === null && modeDraw ? (
          <p className="absolute inset-x-0 bottom-1 text-center text-muted-foreground text-xs">
            stroke data offline · pick or say still work
          </p>
        ) : null}

        {/* tap-to-continue / tap-to-skip: a real button overlay so the
         * card div stays non-interactive and the canvas keeps its own
         * pointer handling underneath */}
        {phase === "wrong" || phase === "intro" ? (
          <button
            aria-label={
              phase === "wrong"
                ? `Continue to the next card after ${current.char}`
                : "Skip the stroke animation"
            }
            className="absolute inset-0 z-10 cursor-pointer rounded-md focus-visible:outline-ring"
            data-testid="drill-card-continue"
            onClick={onCardTap}
            type="button"
          />
        ) : null}
      </div>
    </div>
  );
};

/* ── red pen ──────────────────────────────────────────────────── */

const RedPen = ({
  correcting,
  missed,
  onCorrectionDone,
  strokeData,
}: {
  correcting: number | null;
  missed: number[];
  onCorrectionDone: () => void;
  strokeData: StrokeOrderData | null;
}) => {
  if (!strokeData) {
    return null;
  }
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-2"
      height={CARD_PX}
      viewBox={`0 0 ${KANJIVG_VIEWBOX} ${KANJIVG_VIEWBOX}`}
      width={CARD_PX}
    >
      {missed.map((i) => {
        const stroke = strokeData.strokes[i];
        if (!stroke) {
          return null;
        }
        const animating = correcting === i;
        return (
          <path
            className={animating ? "kanjivg-drawing" : undefined}
            d={stroke.d}
            fill="none"
            key={`${i}-${stroke.id}`}
            onAnimationEnd={animating ? onCorrectionDone : undefined}
            pathLength="1"
            stroke={cssVar("--mark") || "#c2402a"}
            strokeDasharray={animating ? "1" : undefined}
            strokeDashoffset={animating ? 1 : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
            style={
              animating
                ? { animationDuration: `${STROKE_DURATION_MS}ms` }
                : undefined
            }
          />
        );
      })}
    </svg>
  );
};

/* ── audio row ────────────────────────────────────────────────── */

const AudioRow = ({
  char,
  onNormal,
  onPlay,
  onReplay,
  onSlow,
  replayDisabled,
  speed,
}: {
  char: string;
  onNormal: () => void;
  onPlay: () => void;
  onReplay: () => void;
  onSlow: () => void;
  replayDisabled: boolean;
  speed: 1 | 0.8;
}) => (
  <div className="flex flex-wrap items-center justify-center gap-2">
    <button
      aria-label={`Play audio for ${char}`}
      className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
      data-testid="drill-play"
      onClick={onPlay}
      type="button"
    >
      ▶ {char}
    </button>
    <button
      aria-pressed={speed === 0.8}
      className="min-h-11 rounded-card border border-border px-2.5 py-1.5 text-sm hover:bg-muted"
      data-speed="0.8"
      data-testid="drill-speed-slow"
      onClick={onSlow}
      type="button"
    >
      0.8×
    </button>
    <button
      aria-pressed={speed === 1}
      className="min-h-11 rounded-card border border-border px-2.5 py-1.5 text-sm hover:bg-muted"
      data-speed="1"
      data-testid="drill-speed-normal"
      onClick={onNormal}
      type="button"
    >
      1×
    </button>
    <button
      className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
      data-testid="drill-replay"
      disabled={replayDisabled}
      onClick={onReplay}
      type="button"
    >
      ◉ replay
    </button>
  </div>
);

/* ── mode chip ────────────────────────────────────────────────── */

interface ModeChipProps {
  active: boolean;
  disabled?: boolean;
  hint?: string;
  icon: string;
  label: string;
  onSelect: (m: Mode) => void;
  value: Mode;
}

const ModeChip = ({
  active,
  disabled,
  hint,
  icon,
  label,
  onSelect,
  value,
}: ModeChipProps) => {
  const onChip = () => {
    if (!disabled) {
      onSelect(value);
    }
  };
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        aria-disabled={disabled}
        aria-pressed={active}
        className={
          active
            ? "min-h-11 rounded-card border-2 border-primary bg-card px-4 py-2 font-medium text-sm"
            : "min-h-11 rounded-card border border-border bg-card px-4 py-2 text-muted-foreground text-sm hover:bg-muted"
        }
        data-testid={`drill-mode-${value}`}
        onClick={onChip}
        type="button"
      >
        {icon} {label}
      </button>
      {hint ? (
        <span className="text-muted-foreground text-xs">{hint}</span>
      ) : null}
    </div>
  );
};

/* ── say panel ────────────────────────────────────────────────── */

/** Button label for the mic states · speaking wins over idle-listening. */
const micButtonLabel = (listening: boolean, speaking: boolean): string => {
  if (speaking) {
    return "🗣 speaking…";
  }
  if (listening) {
    return "🎤 listening…";
  }
  return "🎤 say it";
};

const SayPanel = ({
  listening,
  micOk,
  onSpeak,
  phase,
  speaking,
  sttError,
}: {
  listening: boolean;
  micOk: boolean;
  onSpeak: () => void;
  phase: Phase;
  speaking: boolean;
  sttError: string | null;
}) => (
  <div className="flex flex-col items-center gap-1" data-testid="drill-speak">
    {micOk ? (
      <button
        className="min-h-11 rounded-card border border-border px-4 py-2 text-sm disabled:opacity-50"
        data-listening={listening}
        data-speaking={speaking}
        data-testid="drill-speak-button"
        disabled={listening || phase !== "ready"}
        onClick={onSpeak}
        type="button"
      >
        {micButtonLabel(listening, speaking)}
      </button>
    ) : (
      <p
        className="text-muted-foreground text-sm"
        data-testid="drill-mic-missing"
      >
        🎤 no microphone detected · draw or pick still work
      </p>
    )}
    {sttError ? (
      <p
        className="text-muted-foreground text-xs"
        data-testid="drill-stt-error"
      >
        🎤 unavailable ({sttError}) · use pick instead.
      </p>
    ) : null}
  </div>
);

/* ── ink canvas ───────────────────────────────────────────────── */

interface InkCanvasProps {
  /** Committed strokes (card space) · repainted whenever this changes. */
  ink: Point[][];
  locked: boolean;
  onComplete: (points: Point[]) => void;
  /** Fires on every pointerdown (intro skip passthrough), even when locked. */
  onPointerDown: () => void;
}

/**
 * Ink paint + capture, following signature_pad's proven architecture
 * (szimek/signature_pad, MIT): a NATIVE `pointerdown` listener on the
 * canvas, window-level `pointermove`/`pointerup` for the stroke's
 * duration, imperative segment painting · no React synthetic pointer
 * events (delegation proved unreliable for pointerdown here), no
 * `setPointerCapture` (retargets inconsistently under re-renders).
 * Committed strokes repaint from the `ink` prop on card changes.
 */
const InkCanvas = ({
  ink,
  locked,
  onComplete,
  onPointerDown,
}: InkCanvasProps) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  /* Latest props for the native handlers (attached once, must not close
   * over stale values). */
  const latest = useRef({ ink, locked, onComplete, onPointerDown });
  latest.current = { ink, locked, onComplete, onPointerDown };

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== CARD_PX * dpr) {
      canvas.width = CARD_PX * dpr;
      canvas.height = CARD_PX * dpr;
    }
    paintInk(canvas.getContext("2d"), dpr, ink);
  }, [ink]);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) {
      return;
    }
    let points: Point[] | null = null;

    const onDown = (e: PointerEvent) => {
      latest.current.onPointerDown();
      if (latest.current.locked || points !== null) {
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const toCard = (cx: number, cy: number): Point => ({
        x: cx - rect.left,
        y: cy - rect.top,
      });
      points = [toCard(e.clientX, e.clientY)];

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 5;
      ctx.strokeStyle = cssVar("--foreground") || "#2b2a26";

      const onMove = (ev: PointerEvent) => {
        if (!points) {
          return;
        }
        const p = toCard(ev.clientX, ev.clientY);
        const last = points.at(-1) ?? p;
        points.push(p);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        ctx.restore();
        const stroke = points;
        points = null;
        if (stroke && stroke.length > 1) {
          latest.current.onComplete(stroke);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };

    canvas.addEventListener("pointerdown", onDown);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
    };
  }, []);

  return (
    <canvas
      aria-label="Draw the character stroke by stroke"
      className={
        locked
          ? "pointer-events-none absolute inset-2 rounded-md"
          : "absolute inset-2 touch-none select-none rounded-md focus-visible:outline-ring"
      }
      data-locked={locked}
      data-testid="drill-canvas"
      height={CARD_PX}
      ref={ref}
      style={{ height: CARD_PX, touchAction: "none", width: CARD_PX }}
      tabIndex={0}
      width={CARD_PX}
    />
  );
};

/* ── ladder + pick grid ───────────────────────────────────────── */

const Ladder = ({
  chars,
  current,
  mastered,
  order,
  pos,
  redo,
  results,
}: {
  chars: DrillChar[];
  current: number;
  mastered: number;
  order: number[];
  pos: number;
  redo: number[];
  results: Record<number, "correct" | "wrong">;
}) => {
  const tickClass = (i: number): string => {
    const r = results[i];
    if (r === "correct") {
      return "size-2 rounded-full bg-foreground";
    }
    if (r === "wrong") {
      return "size-2 rounded-full border border-mark bg-card";
    }
    if (i === current) {
      return "size-2 rounded-full border-2 border-primary bg-card";
    }
    return "size-2 rounded-full border border-border bg-card";
  };
  return (
    <div className="flex w-full max-w-170 flex-col items-center gap-1">
      <div
        aria-label={`${mastered} of ${chars.length} mastered`}
        className="flex flex-wrap justify-center gap-1"
        data-testid="drill-ladder"
        role="img"
      >
        {chars.map((c, i) => (
          <span aria-hidden="true" className={tickClass(i)} key={c.char} />
        ))}
      </div>
      <p className="text-muted-foreground text-sm" data-testid="drill-progress">
        {pos + 1}/{order.length} in set · {mastered}/{chars.length} mastered
        {redo.length > 0 ? ` · ${redo.length} to redo` : ""}
      </p>
    </div>
  );
};

const PickGrid = ({
  choices,
  current,
  onPick,
  picked,
}: {
  choices: string[];
  current: DrillChar;
  onPick: (c: string) => void;
  picked: string | null;
}) => {
  const onPickClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const { value } = e.currentTarget.dataset;
    if (value) {
      onPick(value);
    }
  };
  /* TASK-168: the card keeps the form back now, so the grid is the only place
   * a verdict can say WHICH shape was the answer and which one was tapped. */
  const pickBorder = (c: string): string => {
    if (picked === null) {
      return "border-border";
    }
    if (c === current.char) {
      return "border-primary";
    }
    return c === picked ? "border-mark" : "border-border";
  };
  return (
    <div
      aria-live="polite"
      className="flex gap-2"
      data-testid="drill-type-fallback"
    >
      {choices.map((c) => (
        <button
          aria-pressed={picked === c}
          className={`min-h-11 rounded-card border-2 bg-card px-5 py-3 font-mono text-2xl hover:bg-muted ${pickBorder(c)}`}
          data-correct={c === current.char}
          data-picked={picked === c}
          data-value={c}
          key={c}
          onClick={onPickClick}
          type="button"
        >
          {c}
        </button>
      ))}
    </div>
  );
};

/* ── set-end summary ──────────────────────────────────────────── */

const SetSummary = ({
  chars,
  deckLabel,
  onExit,
  onRedo,
  redo,
  results,
}: {
  chars: DrillChar[];
  deckLabel: string;
  onExit: () => void;
  onRedo: () => void;
  redo: number[];
  results: Record<number, "correct" | "wrong">;
}) => {
  const { sid } = useTtsPrefs();
  const played = Object.keys(results).length || chars.length;
  const word = victoryWordFor(chars);
  const mastered = Object.values(results).filter((r) => r === "correct").length;
  const [showWord, setShowWord] = useState(false);
  /* victoryWordFor returns a fresh object per render · the flag check must
   * run exactly once per mount, or the second pass sees the flag it just
   * wrote and hides the word again. */
  const wordChecked = useRef(false);
  useEffect(() => {
    if (wordChecked.current === true) {
      return;
    }
    wordChecked.current = true;
    let seen = false;
    try {
      seen = localStorage.getItem(VICTORY_FLAG) === "1";
      if (!seen && word) {
        localStorage.setItem(VICTORY_FLAG, "1");
      }
    } catch {
      // private mode: show it anyway
    }
    setShowWord(!seen && word !== null);
  }, [word]);
  const onPlay = useCallback(async () => {
    if (!word) {
      return;
    }
    // Capture the AudioContext synchronously on this click turn, BEFORE the
    // dynamic import's `await` (see the kana Audio for the WebKitGTK why).
    const audioCtx = ensurePlaybackAudioContext();
    if (!audioCtx) {
      return;
    }
    try {
      // Platform-specific: @manobu/speech/tts resolves only inside the Tauri
      // runtime (native speech model); a static import breaks the web build.
      const { playWavBytes, speak } = await import("@manobu/speech/tts");
      const { wav } = await speak(word.jp, { sid, speed: 1 });
      await playWavBytes(wav, audioCtx);
    } catch {
      // web dev: TTS is Tauri-only · silent graceful skip.
    }
  }, [sid, word]);

  return (
    <div
      className="w-full max-w-100 rounded-card border border-border bg-card p-5 text-center"
      data-testid="drill-summary"
    >
      <p className="font-semibold text-lg">
        {deckLabel} · {mastered}/{played} mastered
      </p>
      {showWord && word ? (
        <p className="mt-2 text-sm">
          Here&apos;s your first real word:{" "}
          <span className="font-mono text-xl">{word.jp}</span> ({word.romaji}) ·{" "}
          {word.gloss}{" "}
          <button
            aria-label={`Play audio for ${word.jp}`}
            className="min-h-11 rounded-card border border-border px-2 py-0.5 text-sm"
            data-testid="drill-victory-play"
            onClick={onPlay}
            type="button"
          >
            ▶
          </button>
        </p>
      ) : null}
      {redo.length > 0 ? (
        <p
          className="mt-2 text-muted-foreground text-sm"
          data-testid="drill-redo"
        >
          {redo.length} to redo: {redo.map((i) => chars[i]?.char).join(" ")}
        </p>
      ) : null}
      <div className="mt-4 flex justify-center gap-2">
        {redo.length > 0 ? (
          <button
            className="min-h-11 rounded-card bg-primary px-4 py-2 font-medium text-primary-foreground text-sm"
            data-testid="drill-redo-button"
            onClick={onRedo}
            type="button"
          >
            redo
          </button>
        ) : null}
        <button
          className="min-h-11 rounded-card border border-border px-4 py-2 text-sm"
          data-testid="drill-done"
          onClick={onExit}
          type="button"
        >
          practice again
        </button>
        <Link
          className="min-h-11 rounded-card border border-border px-4 py-2 text-sm"
          data-testid="drill-back-desk"
          to="/dashboard"
        >
          back to desk
        </Link>
      </div>
    </div>
  );
};

/**
 * Exported for `test/drill-machine.test.tsx`: this package has no DOM env, but
 * a `renderToStaticMarkup` of the real components still proves which surfaces
 * a given phase shows, which no pure-function test can see.
 */
export const __test__ = {
  CardFace,
  DEFAULT_MODE,
  GHOST_TOLERANCE_PX,
  ghostStrokes,
  gradePronunciation,
  gradeShape,
  kanaFold,
  loadMode,
  MODE_INSTRUCTION,
  ModeChip,
  PickGrid,
  pickCue,
  resolveMode,
  strokeTolerance,
  typeFallbackChoices,
};
