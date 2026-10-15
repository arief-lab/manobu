/*\
 * Listen & Type (SCR-04) compound component.
 *
 * Per spec §SCR-04:
 *   - Audio ▶ with 0.8×/1× speed control, wired to @manobu/speech/tts
 *     speak(target.jp, { speed, sid }) via useTtsPrefs() (TASK-21.1).
 *   - Input auto-converts romaji on blur; still-romaji (MJKZg) → red
 *     border-destructive + shake 200ms; Next stays disabled at 40% opacity
 *     until valid kana
 *   - No-speaker banner (pcvtp) switches to Read & Type from pitch
 *     diagram たべ˥て · counts for FSRS identically
 *   - Audio fail (J-7) + TTS corrupt (UUIuC) → pitch diagram + furigana
 *     fallback; [Re-download][Continue offline]
 *   - TTS not ready → Banner pcvtp + Pitch たべ˥て fallback; FSRS
 *     onGrade(3) unchanged when learner types correct answer.
 *
 * Composition (Vercel pattern):
 *   <ListenType>            provider (target + audio state)
 *     <ListenType.Audio     [▶] speed + TTS wiring
 *     <ListenType.Input     romaji→kana + shake
 *     <ListenType.Banner    pcvtp / J-7 / UUIuC
 *     <ListenType.Pitch     たべ˥て
 *     <ListenType.Next      40% opacity until valid kana
 *   </ListenType>
 */

import { ensurePlaybackAudioContext } from "@manobu/speech/tts";
import {
  createContext,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { matchTarget, similarityPercent } from "@/lib/deinflect";
import { isStillRomaji, isValidKana, romajiToKana } from "@/lib/romaji";
import { SHADOW_GRADE_THRESHOLD, shadowScore } from "@/lib/shadow";
import { useSttStream } from "@/lib/stt-stream";
import { useTtsPrefs } from "@/lib/tts-voice";

interface ListenTarget {
  gloss: string;
  jp: string;
  pitch: string;
  romaji: string;
}

type AudioState =
  | "ok"
  | "no-speaker"
  | "audio-fail"
  | "tts-corrupt"
  | "tts-not-ready";

interface ListenContext {
  audio: AudioState;
  graded: 1 | 2 | 3 | 4 | null;
  input: string;
  onGrade: (g: 1 | 2 | 3 | 4) => void;
  setInput: (v: string) => void;
  target: ListenTarget;
}

const ListenScope = createContext<ListenContext | null>(null);

const useListen = (): ListenContext => {
  const ctx = useContext(ListenScope);
  if (!ctx) {
    throw new Error("useListen must be used within ListenType");
  }
  return ctx;
};

const bannerMessage = (audio: AudioState): string => {
  if (audio === "no-speaker") {
    return "pcvtp · No speaker detected";
  }
  if (audio === "audio-fail") {
    return "J-7 · Audio failed, falling back to pitch";
  }
  if (audio === "tts-corrupt") {
    return "UUIuC · TTS corrupted";
  }
  if (audio === "tts-not-ready") {
    return "pcvtp · No speaker detected";
  }
  return "";
};

const audioMessage = (audio: AudioState): string => {
  if (audio === "no-speaker" || audio === "tts-not-ready") {
    // No 🔇 glyph: it renders as a red prohibition circle in the emoji font
    // and reads as breakage for an expected no-voice state (TASK-171). The
    // line already renders in muted text, and it names the fallback.
    return "No speaker · using pitch + furigana. Task switches to Read & Type. [Test audio]";
  }
  if (audio === "audio-fail") {
    return "Audio unavailable · pitch diagram + furigana fallback";
  }
  return "Voices corrupted · checksum mismatch [Re-download] [Continue offline]";
};

const Audio = () => {
  const { audio, target } = useListen();
  const [speed, setSpeed] = useState<1 | 0.8>(1);
  const prefs = useTtsPrefs();

  const onSlow = useCallback(() => {
    setSpeed(0.8);
  }, []);

  const onNormal = useCallback(() => {
    setSpeed(1);
  }, []);

  const onPlay = useCallback(async () => {
    if (audio !== "ok") {
      return;
    }
    const isInTauri = typeof window !== "undefined" && "__TAURI__" in window;
    if (!isInTauri) {
      return; // web dev: TTS is Tauri-only; no state change.
    }
    // Capture the AudioContext synchronously on this click turn, BEFORE the
    // dynamic import's `await`. Tauri's Linux WebKitGTK webview closes the
    // user activation once an await resolves, so `Audio(url).play()` after
    // `speak()` rejects with NotAllowedError and the ▶ animates silence.
    const audioCtx = ensurePlaybackAudioContext();
    if (!audioCtx) {
      return;
    }
    try {
      const { playWavBytes, speak } = await import("@manobu/speech/tts");
      const { wav } = await speak(target.jp, {
        sid: prefs.sid,
        speed: speed === 0.8 ? 0.8 : 1,
      });
      await playWavBytes(wav, audioCtx);
    } catch {
      // Initialized-Tauri speak failure: keep existing banner routing
      // (the host sets audio via initial.audio; fine-grained error
      // classification is deferred but the surface degrades gracefully).
    }
  }, [audio, prefs.sid, speed, target.jp]);

  return (
    <div className="flex flex-col gap-2" data-testid="listen-audio">
      <div className="flex gap-2">
        <button
          aria-label="Play audio"
          className="rounded-card border-2 border-border px-3 py-1 text-sm"
          data-testid="listen-play"
          onClick={onPlay}
          type="button"
        >
          [▶] audio
        </button>
        <button
          aria-pressed={speed === 0.8}
          className="rounded-card border-2 border-border px-2 py-1 text-sm"
          data-speed="0.8"
          onClick={onSlow}
          type="button"
        >
          0.8×
        </button>
        <button
          aria-pressed={speed === 1}
          className="rounded-card border-2 border-border px-2 py-1 text-sm"
          data-speed="1"
          onClick={onNormal}
          type="button"
        >
          1×
        </button>
      </div>
      {audio === "ok" ? null : (
        <p className="text-muted-foreground text-xs" data-state={audio}>
          {audioMessage(audio)}
        </p>
      )}
    </div>
  );
};

const Input = () => {
  const { input, setInput } = useListen();
  const [shake, setShake] = useState(false);
  const stillRomaji = isStillRomaji(input);
  const validKana = isValidKana(input);
  const onChangeInput = useCallback(
    (e: { target: { value: string } }) => {
      // TASK-41 AC4: convert romaji→kana LIVE. The old behavior converted
      // only on blur · typing 'taberu' left raw romaji in the field, so
      // isStillRomaji kept Next disabled (40% opacity, no reason shown):
      // the "Next click no-op" from doc-9 QA-4. romajiToKana leaves
      // un-transliterable trailing characters as-is, so partial romaji
      // still displays while typing.
      setInput(romajiToKana(e.target.value));
    },
    [setInput]
  );
  const onBlur = useCallback(
    (e: ReactFocusEvent<HTMLInputElement>) => {
      const next = romajiToKana(e.target.value);
      setInput(next);
      if (isStillRomaji(next)) {
        setShake(true);
        setTimeout(() => {
          setShake(false);
        }, 200);
      }
    },
    [setInput]
  );
  // TASK-23.2.2 AC5: a KanaChart mounted anywhere in the app may dispatch
  // `manobu:kana-chart-copy` (CustomEvent<{ romaji, char }>). When this
  // .Input is mounted, pre-fill the input with the romaji so the learner
  // can edit/blur-to-kana without retyping. No-op when no chart is
  // mounted (the event never fires).
  useEffect(() => {
    const handler = (e: Event) => {
      const { detail } = e as CustomEvent<{ romaji?: string }>;
      if (detail?.romaji) {
        setInput(detail.romaji);
      }
    };
    window.addEventListener("manobu:kana-chart-copy", handler);
    return () => {
      window.removeEventListener("manobu:kana-chart-copy", handler);
    };
  }, [setInput]);
  return (
    <div className="flex flex-col gap-1" data-testid="listen-input">
      <p className="text-muted-foreground text-xs">
        Auto-converts: type 'a' → 'あ' · Romaji won't be marked wrong
      </p>
      <input
        aria-invalid={stillRomaji}
        className={
          stillRomaji
            ? "shake rounded-card border-2 border-destructive px-3 py-2 focus-visible:outline-ring data-tone-error:border-destructive"
            : "rounded-card border-2 border-border px-3 py-2 focus-visible:outline-ring"
        }
        data-shake={shake}
        data-still-romaji={stillRomaji}
        data-testid="listen-typer"
        data-tone={stillRomaji ? "error" : undefined}
        data-valid={validKana}
        onBlur={onBlur}
        onChange={onChangeInput}
        placeholder="Type what you hear in hiragana"
        value={input}
      />
    </div>
  );
};

const Banner = () => {
  const { audio } = useListen();
  if (audio === "ok") {
    return null;
  }
  const id = audio;
  const message = bannerMessage(audio);
  return (
    <p
      aria-live="polite"
      className="rounded-card border-2 border-border border-warning px-3 py-2 text-sm"
      data-banner={id}
      data-testid={`listen-banner-${id}`}
    >
      {message}
    </p>
  );
};

const Pitch = () => {
  const { target, audio } = useListen();
  if (audio === "ok") {
    return null;
  }
  return (
    <p
      className="rounded-card bg-muted px-3 py-2 font-mono text-sm"
      data-testid="listen-pitch"
    >
      See {target.jp} ({target.pitch} pitch) → type {target.jp} · counts for
      FSRS
    </p>
  );
};

const Next = () => {
  const { input, onGrade, graded, target } = useListen();
  const stillRomaji = isStillRomaji(input);
  const validKana = isValidKana(input);
  const disabled = !validKana || stillRomaji || graded !== null;
  // TASK-23.29: the typed answer is actually graded now · exact match or a
  // deinflected inflected form (食べました for target 食べる) passes; an
  // inflected match grades Hard(2) with the reason surfaced, a wrong word
  // grades Again(1). The pre-23.29 behavior graded blindly onGrade(3).
  const match = useMemo(
    () => matchTarget(target.jp, input),
    [input, target.jp]
  );
  // TASK-36: deinflected banner condition moved to render (graded !== null
  // && match.kind === "deinflected") · the showMatch state is gone.
  const onClick = useCallback(() => {
    if (disabled) {
      return;
    }
    if (match.kind === "exact") {
      onGrade(3);
      return;
    }
    if (match.kind === "deinflected") {
      onGrade(2);
      return;
    }
    onGrade(1);
  }, [disabled, match, onGrade]);
  // TASK-41 AC3: visible grade feedback · before this, the ONLY signal
  // after grading was Next disabling itself (doc-9: "no grade feedback").
  const gradeCopy = (() => {
    if (graded === 3) {
      return "✓ exact match · FSRS Good(3)";
    }
    if (graded === 2) {
      return "→ deinflected · FSRS Hard(2)";
    }
    if (graded === 1) {
      return "✗ not the target · FSRS Again(1)";
    }
    return null;
  })();
  return (
    <div className="flex flex-col gap-1">
      {graded === null ? null : (
        <p
          className={
            graded === 1 ? "text-destructive text-sm" : "text-primary text-sm"
          }
          data-testid="listen-grade"
          role="status"
        >
          {gradeCopy}
        </p>
      )}
      {graded !== null && match.kind === "deinflected" ? (
        <p
          className="text-muted-foreground text-xs"
          data-testid="listen-deinflected"
        >
          {input.trim()} → {match.dictionaryForm} ({match.reason}) · counts as
          hard
        </p>
      ) : null}
      {graded === 1 ? (
        /* TASK-36 AC2: a wrong answer that leaves you guessing is the
           silent-failure sin · always reveal the target. */
        <p className="text-destructive text-xs" data-testid="listen-reveal">
          Target was: {target.jp} · yours matched{" "}
          {similarityPercent(target.jp, input.trim())}% of characters
        </p>
      ) : null}
      <button
        aria-disabled={disabled}
        className="rounded-card bg-primary px-3 py-2 text-primary-foreground"
        data-disabled={disabled}
        data-testid="listen-next"
        onClick={onClick}
        style={disabled ? { opacity: 0.4 } : undefined}
        type="button"
      >
        Next
      </button>
    </div>
  );
};

const Shadow = () => {
  const { onGrade, graded, target } = useListen();
  const stream = useSttStream();
  const [finalText, setFinalText] = useState<string | null>(null);

  const onFinal = useCallback((text: string) => {
    setFinalText(text);
  }, []);

  const onToggle = useCallback(() => {
    if (stream.listening) {
      stream.stop().catch(() => undefined);
      return;
    }
    setFinalText(null);
    stream.start("listen-shadow", { onFinal }).catch(() => undefined);
  }, [onFinal, stream]);

  // Final ≥80% overlap → FSRS Good(3) fires once, like Next.
  useEffect(() => {
    if (finalText === null || graded !== null) {
      return;
    }
    if (shadowScore(target.jp, finalText) >= SHADOW_GRADE_THRESHOLD) {
      onGrade(3);
    }
  }, [finalText, graded, onGrade, target.jp]);

  const score =
    finalText === null
      ? shadowScore(target.jp, stream.partial)
      : shadowScore(target.jp, finalText);
  const reached = score >= SHADOW_GRADE_THRESHOLD;

  return (
    <div className="flex flex-col gap-2" data-testid="listen-shadow">
      <div className="flex items-center gap-2">
        <button
          aria-pressed={stream.listening}
          className="rounded-card border-2 border-border px-3 py-1 text-sm"
          data-listening={stream.listening}
          data-testid="shadow-mic"
          onClick={onToggle}
          type="button"
        >
          {stream.listening ? "⏹ stop shadowing" : "🎤 shadow (streaming)"}
        </button>
        <output
          aria-live="polite"
          className="text-muted-foreground text-xs"
          data-score={score}
          data-testid="shadow-score"
        >
          match {Math.round(score * 100)}%
        </output>
      </div>
      <p
        className="min-h-6 rounded-card bg-muted px-3 py-1 font-mono text-sm"
        data-partial={stream.partial}
        data-testid="shadow-partial"
      >
        {stream.partial || (stream.listening ? "🗣 listening…" : "–")}
      </p>
      {finalText === null ? null : (
        <p
          className="text-xs"
          data-graded={reached}
          data-testid="shadow-result"
        >
          {reached
            ? "✓ Shadowed · counts as Good for FSRS"
            : "Try once more · aim for ≥80% overlap"}
        </p>
      )}
      {stream.error === null ? null : (
        <p className="text-muted-foreground text-xs" data-error={stream.error}>
          Streaming STT unavailable · download the Zipformer JA model in
          Settings ({stream.error})
        </p>
      )}
    </div>
  );
};

interface ListenTypeProps {
  children: ReactNode;
  initial: {
    target: ListenTarget;
    audio?: AudioState;
  };
  onGrade?: (g: 1 | 2 | 3 | 4) => void;
}

const ListenTypeRoot = ({ initial, onGrade, children }: ListenTypeProps) => {
  const [input, setInput] = useState("");
  const [graded, setGraded] = useState<1 | 2 | 3 | 4 | null>(null);
  const grade = useCallback(
    (g: 1 | 2 | 3 | 4) => {
      if (graded !== null) {
        return;
      }
      setGraded(g);
      onGrade?.(g);
    },
    [graded, onGrade]
  );
  const ctx: ListenContext = {
    audio: initial.audio ?? "ok",
    graded,
    input,
    onGrade: grade,
    setInput,
    target: initial.target,
  };
  return <ListenScope.Provider value={ctx}>{children}</ListenScope.Provider>;
};

export const ListenType = Object.assign(ListenTypeRoot, {
  Audio,
  Banner,
  Input,
  Next,
  Pitch,
  Shadow,
});

export const __test__ = {
  audioMessage,
  isStillRomaji,
  isValidKana,
  romajiToKana,
};
