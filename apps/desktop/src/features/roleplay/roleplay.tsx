/*
 * Roleplay (SCR-07 redesign) — the exchange is a chat thread.
 *
 * The old page was a worksheet ABOUT a conversation (Goal panel, Scores
 * line, Keigo poster, spoiler placeholder `Type: コーヒーをください`).
 * The redesign makes it the conversation itself:
 *
 *   shelf          "who are you meeting today?" — scene cards
 *   scene          clerk bubbles left, your saved lines right. The
 *                  thread IS the progress; one action ("say it →")
 *                  saves the line to FSRS and advances. Skip stays a
 *                  quiet ghost link — never blocked, never nagged.
 *   transcript     the whole exchange top-to-bottom is the reward.
 *
 * The comprehension ladder carries over from the reading corner: the
 * clerk's Japanese is the face, the English lives under the dotted
 * line (tap = reveal), and every clerk word is tappable via the shared
 * TokenText (same coverage ladder, same popover, same save).
 *
 * The contrast is EARNED: the polished sensei form of the same act
 * appears under your bubble only after you produce something flatter
 * than it. Never shown up front — the answer is never the placeholder.
 *
 * Composer feedback is visual language, not a debug console: particle
 * chips light ✓ as they appear; the politeness ladder (flat ▸ polite
 * ▸ keigo) highlights the current rung. Nothing gates — submit is
 * enabled with any non-empty input (the retry-is-the-lesson rule).
 *
 * The mic keeps the dual STT path exactly (TASK-21.5): streaming is an
 * upgrade, the file path is the equal fallback, VAD ticks drive the
 * live speaking state.
 *
 * Composition (Vercel pattern):
 *   <Roleplay scene>          provider: thread + answers + saved
 *     <Roleplay.Bar />        ← shelf · dots · ふりがな · [🔊 scene]
 *     <Roleplay.Thread />     bubbles + earned contrast + composer
 *     <Roleplay.Transcript /> the end screen (once the scene ends)
 *   </Roleplay>
 *   <RoleplayShelf />         the picker (pure props, no provider)
 *
 * Data-honesty: the close line counts real saves; "due tomorrow" is the
 * FSRS default; 3 turns and the scene ENDS (spec: not endless thread).
 */

import { isSttStreamReady } from "@manobu/speech/stt";
import { log } from "@manobu/ui/lib/gsm";
import { saveFsrsToast } from "@manobu/ui/lib/toast";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { recordAndTranscribe } from "@/lib/mic-stt";
import type { Token } from "@/lib/reader-stories";
import {
  I1_REQUIRED_PARTICLES,
  particleScore,
  politenessScore,
} from "@/lib/roleplay";
import type { RoleplayScene } from "@/lib/roleplay-scenes";
import {
  POLITENESS_RUNGS,
  ROLEPLAY_SCENES,
  SPEAK_RECORD_MS,
} from "@/lib/roleplay-scenes";
import { useSttStream } from "@/lib/stt-stream";
import { ListenButton } from "@/shared/listen-button";
import { TokenText } from "@/shared/token-text";

/** A produced line, keyed by the clerk turn it answers. */
interface Answer {
  politeness: number;
  saved: boolean;
  text: string;
}

interface RoleplayContext {
  answers: ReadonlyMap<number, Answer>;
  furigana: boolean;
  glossRevealed: (lineIndex: number) => boolean;
  index: number;
  input: string;
  isSavedToken: (token: Token) => boolean;
  reset: () => void;
  revealGloss: (lineIndex: number) => void;
  saveToken: (token: Token) => void;
  scene: RoleplayScene;
  setInput: (value: string) => void;
  skip: () => void;
  submit: () => void;
  toggleFurigana: () => void;
  total: number;
}

const RoleplayScope = createContext<RoleplayContext | null>(null);

const useRoleplay = (): RoleplayContext => {
  const ctx = useContext(RoleplayScope);
  if (!ctx) {
    throw new Error("useRoleplay must be used within Roleplay");
  }
  return ctx;
};

/* ── provider ─────────────────────────────────────────────────── */

interface RoleplayProps {
  children: ReactNode;
  scene: RoleplayScene;
}

const RoleplayRoot = ({ children, scene }: RoleplayProps) => {
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState("");
  const [answers, setAnswers] = useState<ReadonlyMap<number, Answer>>(
    () => new Map()
  );
  const [glossed, setGlossed] = useState<Set<number>>(() => new Set());
  const [savedTokens, setSavedTokens] = useState<Set<string>>(() => new Set());
  const [furigana, setFurigana] = useState(
    () => scene.level === "N5" || scene.level === "N4"
  );

  // Submitting a line saves it to FSRS and walks the scene — one action,
  // no separate Save + Next buttons.
  const submit = useCallback(() => {
    const text = input.trim();
    if (text.length === 0 || index >= scene.lines.length) {
      return;
    }
    const politeness = politenessScore(text);
    setAnswers((prev) => {
      const next = new Map(prev);
      next.set(index, { politeness, saved: true, text });
      return next;
    });
    saveFsrsToast({
      n: 1,
      onUndo: () => {
        setAnswers((prev) => {
          const next = new Map(prev);
          const answer = next.get(index);
          if (answer) {
            next.set(index, { ...answer, saved: false });
          }
          return next;
        });
      },
      retention: 0.9,
    }).catch(() => undefined);
    log("lesson_start", { line: index + 1, phrase: text, scene: scene.key });
    setInput("");
    setIndex((i) => i + 1);
  }, [index, input, scene.lines, scene.key]);

  // Skip is a ghost link, not a gate: reading the next clerk reply is
  // still learning. It leaves no bubble and saves nothing (honest counts).
  const skip = useCallback(() => {
    setInput("");
    setIndex((i) => Math.min(i + 1, scene.lines.length));
  }, [scene.lines.length]);

  const reset = useCallback(() => {
    setIndex(0);
    setInput("");
    setAnswers(new Map());
    setGlossed(new Set());
    setSavedTokens(new Set());
  }, []);

  const toggleFurigana = useCallback(() => {
    setFurigana((v) => !v);
  }, []);
  const glossRevealed = useCallback(
    (lineIndex: number) => glossed.has(lineIndex),
    [glossed]
  );
  const revealGloss = useCallback((lineIndex: number) => {
    setGlossed((prev) => new Set(prev).add(lineIndex));
  }, []);
  const isSavedToken = useCallback(
    (token: Token) => savedTokens.has(token.text),
    [savedTokens]
  );
  // Clerk words are dictionary entries the learner met in the scene —
  // saving one is the same act as saving a reader word.
  const saveToken = useCallback((token: Token) => {
    setSavedTokens((s) => (s.has(token.text) ? s : new Set(s).add(token.text)));
    saveFsrsToast({
      n: 1,
      onUndo: () => {
        setSavedTokens((s) => {
          const next = new Set(s);
          next.delete(token.text);
          return next;
        });
      },
      retention: 0.9,
    }).catch(() => undefined);
  }, []);

  const ctx: RoleplayContext = useMemo(
    () => ({
      answers,
      furigana,
      glossRevealed,
      index,
      input,
      isSavedToken,
      reset,
      revealGloss,
      saveToken,
      scene,
      setInput,
      skip,
      submit,
      toggleFurigana,
      total: scene.lines.length,
    }),
    [
      answers,
      furigana,
      glossRevealed,
      index,
      input,
      isSavedToken,
      revealGloss,
      reset,
      saveToken,
      scene,
      skip,
      submit,
      toggleFurigana,
    ]
  );
  return (
    <RoleplayScope.Provider value={ctx}>
      <div
        className="mx-auto flex min-h-full w-full max-w-170 flex-col gap-4 p-4"
        data-testid="roleplay-scene"
      >
        {children}
      </div>
    </RoleplayScope.Provider>
  );
};

/* ── bar ─────────────────────────────────────────────────────── */

const Bar = () => {
  const { answers, furigana, index, scene, toggleFurigana } = useRoleplay();
  const fullText = useMemo(
    () => scene.lines.map((l) => l.clerk.jp).join(" "),
    [scene.lines]
  );
  return (
    <header className="flex items-center justify-between px-1">
      <Link
        className="flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
        data-testid="rp-back-shelf"
        search={{}}
        to="/roleplay"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        shelf
      </Link>
      <p className="text-muted-foreground text-sm">
        {scene.icon} {scene.title} · {scene.level}
      </p>
      <span className="flex items-center gap-2">
        <button
          aria-pressed={furigana}
          className="inline-flex min-h-11 items-center rounded-full border border-border px-2.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground data-[aria-pressed=true]:border-primary/60 data-[aria-pressed=true]:text-foreground"
          data-testid="rp-furigana-toggle"
          onClick={toggleFurigana}
          type="button"
        >
          ふりがな
        </button>
        <span className="flex gap-1.5">
          {scene.lines.map((line, i) => (
            <span
              className={
                answers.has(i) || i < index
                  ? "size-2.5 rounded-full bg-primary"
                  : "size-2.5 rounded-full border border-border"
              }
              key={line.clerk.jp}
            />
          ))}
        </span>
        <ListenButton testId="rp-audio-scene" text={fullText} />
      </span>
    </header>
  );
};

/* ── bubbles ──────────────────────────────────────────────────── */

const ClerkBubble = ({ lineIndex }: { lineIndex: number }) => {
  const {
    furigana,
    glossRevealed,
    isSavedToken,
    revealGloss,
    saveToken,
    scene,
  } = useRoleplay();
  const onReveal = useCallback(() => {
    revealGloss(lineIndex);
  }, [lineIndex, revealGloss]);
  const line = scene.lines[lineIndex];
  if (!line) {
    return null;
  }
  const revealed = glossRevealed(lineIndex);
  return (
    <div className="flex max-w-105 flex-col gap-1 self-start">
      <p className="rounded-card rounded-tl-none border-2 border-border bg-card px-3 py-2 text-base leading-relaxed">
        <span aria-hidden className="mr-1.5">
          {scene.icon}
        </span>
        <TokenText
          furigana={furigana}
          isSaved={isSavedToken}
          level={line.clerk.level}
          onSave={saveToken}
          popoverTestId="rp-popover"
          saveTestId="rp-popover-save"
          tapTestId="rp-tap"
          text={line.clerk.jp}
          words={line.clerk.words}
        />
      </p>
      <div className="flex items-center gap-2">
        {/* The comprehension ladder: the dotted line IS "translate
         * this" — the English never shows unless asked for. The button
         * is a full 24px tall with the line drawn inside. */}
        <button
          aria-expanded={revealed}
          className="group/line flex h-6 min-w-24 flex-1 items-center"
          data-testid={`rp-gloss-${lineIndex}`}
          onClick={onReveal}
          type="button"
        >
          <span className="h-0 w-full border-border border-t border-dashed transition-colors group-hover/line:border-primary/60" />
        </button>
        <ListenButton testId={`rp-audio-${lineIndex}`} text={line.clerk.jp} />
      </div>
      {revealed ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid={`rp-gloss-text-${lineIndex}`}
        >
          {line.clerk.en}
        </p>
      ) : null}
    </div>
  );
};

const UserBubble = ({ lineIndex }: { lineIndex: number }) => {
  const { answers, scene } = useRoleplay();
  const answer = answers.get(lineIndex);
  const line = scene.lines[lineIndex];
  if (!(answer && line)) {
    return null;
  }
  // The earned contrast: your line vs the polished form of the SAME
  // act — shown only because you produced something flatter first.
  const earned = answer.politeness < politenessScore(line.sensei);
  return (
    <div className="flex max-w-105 flex-col items-end gap-1 self-end">
      <p
        className="rounded-card rounded-tr-none bg-primary px-3 py-2 text-base text-primary-foreground leading-relaxed"
        data-testid={`rp-answer-${lineIndex}`}
      >
        {answer.text}
      </p>
      <p className="text-[11px] text-muted-foreground">
        you · {POLITENESS_RUNGS[Math.min(answer.politeness, 2)]}
        {answer.saved ? " · saved" : ""}
      </p>
      {earned ? (
        /* The correction is a mark, not a wall: a 朱 hairline leads the
         * sensei's way line; the text stays ink. */
        <p
          className="flex items-center gap-2 text-muted-foreground text-xs"
          data-testid="rp-contrast"
        >
          <span aria-hidden className="h-3 w-0.5 shrink-0 bg-mark" />
          <span>
            sensei's way: <span className="text-foreground">{line.sensei}</span>
          </span>
          <ListenButton
            testId={`rp-audio-sensei-${lineIndex}`}
            text={line.sensei}
          />
        </p>
      ) : null}
    </div>
  );
};

/* ── composer ────────────────────────────────────────────────── */

const micSupported = (): boolean =>
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

/** Button label for the mic states — speaking wins over idle-listening. */
const micButtonLabel = (listening: boolean, speaking: boolean): string => {
  if (speaking) {
    return "🗣 speaking…";
  }
  if (listening) {
    return "🎤 listening…";
  }
  return "🎤 say it";
};

const Composer = () => {
  const { index, input, scene, setInput, skip, submit, total } = useRoleplay();
  const onChange = useCallback(
    (e: { target: { value: string } }) => {
      setInput(e.target.value);
    },
    [setInput]
  );
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  // TASK-21.5: streaming is a *upgrade*, not a gate — if the Zipformer
  // session is ready the mic streams partials live; otherwise the
  // file-STT path below stays the equal fallback (SCR-03 rule).
  const [streamReady, setStreamReady] = useState(false);
  const stream = useSttStream();
  useEffect(() => {
    let alive = true;
    isSttStreamReady()
      .then((ready) => {
        if (alive) {
          setStreamReady(ready);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  // TASK-21.2: the mic fills the same input state — politeness and
  // particle feedback recompute live, exactly like a typed line. Failure
  // keeps the input untouched and shows a hint; typing stays equal-path.
  // TASK-21.3: VAD ticks drive the live speaking state; the
  // 800ms-silence auto-stop lives inside recordAndTranscribe.
  const onSpeakStream = useCallback(async () => {
    if (stream.listening) {
      const finalText = await stream.stop();
      setSpeaking(false);
      setListening(false);
      if (finalText !== null && finalText.length > 0) {
        setInput(finalText);
        log("grade", { line: index + 1, source: "stt-stream" });
      }
      return;
    }
    setSttError(null);
    setListening(true);
    await stream.start(`roleplay-line-${index + 1}`, {
      onActivity: (a) => {
        setSpeaking(a.speaking);
      },
      onFinal: (text) => {
        // Endpoint fired mid-session — fill the input with the utterance.
        setInput(text);
        log("grade", { line: index + 1, source: "stt-stream" });
      },
    });
    if (!stream.listening) {
      // start failed (unavailable) — surface and keep typing equal-path.
      setSttError(stream.error);
      setListening(false);
    }
  }, [index, setInput, stream]);
  const onSpeakFile = useCallback(async () => {
    if (listening) {
      return;
    }
    setSttError(null);
    setListening(true);
    const attempt = await recordAndTranscribe(`roleplay-line-${index + 1}`, {
      maxMs: SPEAK_RECORD_MS,
      onActivity: (a) => {
        setSpeaking(a.speaking);
      },
    });
    setSpeaking(false);
    setListening(false);
    if (!attempt.ok || attempt.text === null) {
      setSttError(attempt.error);
      return;
    }
    setInput(attempt.text);
    log("grade", { line: index + 1, source: "stt" });
  }, [index, listening, setInput]);
  const onSpeak = streamReady ? onSpeakStream : onSpeakFile;

  const line = scene.lines[index];
  if (!line) {
    return null;
  }
  const required = line.requiredParticles.length
    ? line.requiredParticles
    : I1_REQUIRED_PARTICLES;
  const particles = particleScore(input, required);
  const hasInput = input.trim().length > 0;
  const rung = Math.min(politenessScore(input), 2);
  return (
    <div
      className="flex flex-col gap-2 rounded-card border-2 border-border bg-card p-3"
      data-testid="rp-composer"
    >
      {/* Visual language, not a debug console: chips light as the
       * particles appear; the ladder shows where your politeness sits. */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5" data-testid="rp-chips">
          {required.map((p) => {
            const hit = input.includes(p);
            return (
              <span
                className={
                  hit
                    ? "rounded-full bg-primary/15 px-2 py-0.5 text-primary text-xs"
                    : "rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs"
                }
                data-testid={`rp-chip-${p}`}
                key={p}
              >
                {p} {hit ? "✓" : ""}
              </span>
            );
          })}
          <span className="text-[11px] text-muted-foreground">
            {particles}/{required.length}
          </span>
        </span>
        <span
          className="flex items-center gap-1 text-[11px]"
          data-testid="rp-ladder"
        >
          {POLITENESS_RUNGS.map((name, i) => (
            <span
              className={
                hasInput && i === rung
                  ? "font-semibold text-primary"
                  : "text-muted-foreground"
              }
              key={name}
            >
              {name}
              {i < POLITENESS_RUNGS.length - 1 ? " ▸ " : ""}
            </span>
          ))}
        </span>
      </div>
      {/* min-w-0 + wrap: at 375px the buttons used to push past the
       * viewport (audit-001 R-03); the input takes the first row, the
       * buttons share the second. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Your reply in Japanese"
          className="min-w-0 flex-1 basis-48 rounded-card border-2 border-border px-3 py-2 focus-visible:outline-ring"
          data-testid="rp-input"
          onChange={onChange}
          placeholder="type or speak…"
          value={input}
        />
        {micSupported() && (
          <button
            className="inline-flex min-h-11 shrink-0 items-center rounded-card border-2 border-border px-3 text-sm"
            data-listening={listening}
            data-speaking={speaking}
            data-testid="rp-speak"
            disabled={listening}
            onClick={onSpeak}
            type="button"
          >
            {micButtonLabel(listening, speaking)}
          </button>
        )}
        <button
          className="inline-flex min-h-11 shrink-0 items-center rounded-card bg-primary px-4 text-primary-foreground disabled:opacity-40"
          data-testid="rp-submit"
          disabled={!hasInput}
          onClick={submit}
          type="button"
        >
          say it →
        </button>
      </div>
      {sttError ? (
        <p className="text-muted-foreground text-xs" data-testid="rp-stt-error">
          🎤 unavailable ({sttError}). Keep typing instead.
        </p>
      ) : null}
      <button
        className="inline-flex min-h-11 items-center self-end text-muted-foreground text-xs underline-offset-4 transition-colors hover:text-foreground hover:underline"
        data-testid="rp-skip"
        onClick={skip}
        type="button"
      >
        skip (just read the reply) · {index + 1}/{total}
      </button>
    </div>
  );
};

/* ── thread ───────────────────────────────────────────────────── */

/** The visible thread: every clerk turn up to and including the live
 * one. Skipped turns still show their reply (reading is learning). */
const visibleLineIndexes = (index: number, total: number): number[] => {
  const through = Math.min(index, total - 1);
  const out: number[] = [];
  for (let i = 0; i <= through; i += 1) {
    out.push(i);
  }
  return out;
};

const Thread = () => {
  const { index, total } = useRoleplay();
  const ended = index >= total;
  return (
    <section
      aria-label="The exchange"
      className="flex flex-1 flex-col gap-4"
      data-testid="rp-thread"
    >
      {visibleLineIndexes(index, total).map((i) => (
        <div className="flex flex-col gap-2" key={i}>
          <ClerkBubble lineIndex={i} />
          <UserBubble lineIndex={i} />
        </div>
      ))}
      {ended ? null : <Composer />}
    </section>
  );
};

/* ── transcript (the end screen) ──────────────────────────────── */

const Transcript = () => {
  const { answers, index, reset, scene, total } = useRoleplay();
  if (index < total) {
    return null;
  }
  const savedCount = [...answers.values()].filter((a) => a.saved).length;
  return (
    <section className="flex flex-col gap-4" data-testid="rp-transcript">
      <p className="px-1 text-muted-foreground text-sm">the whole exchange</p>
      <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
        {scene.lines.map((line, i) => (
          <div className="flex flex-col gap-2" key={line.clerk.jp}>
            <p className="max-w-105 self-start rounded-card border-2 border-border px-3 py-1.5 text-sm">
              {scene.icon} {line.clerk.jp}
            </p>
            {answers.get(i)?.text ? (
              <p className="max-w-105 self-end rounded-card bg-primary/90 px-3 py-1.5 text-primary-foreground text-sm">
                you · {answers.get(i)?.text}
              </p>
            ) : (
              <p className="max-w-105 self-end text-muted-foreground text-xs italic">
                (skipped)
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="text-center text-sm" data-testid="rp-close">
        {savedCount === total
          ? `you did all ${total} turns in Japanese`
          : `${savedCount}/${total} lines saved to review`}
      </p>
      <p className="text-center text-muted-foreground text-xs">
        {savedCount > 0
          ? "they're due tomorrow. The desk will say so"
          : "nothing saved. Say a line next time and it enters the queue"}
      </p>
      <div className="flex items-center justify-center gap-3 pt-1">
        <button
          className="inline-flex min-h-11 items-center rounded-card border-2 border-border px-4 text-sm transition-colors hover:border-primary/60"
          data-testid="rp-again"
          onClick={reset}
          type="button"
        >
          do it again
        </button>
        <Link
          className="inline-flex min-h-11 items-center rounded-card bg-primary px-4 text-primary-foreground text-sm"
          data-testid="rp-to-shelf"
          to="/roleplay"
        >
          back to shelf
        </Link>
      </div>
    </section>
  );
};

/* ── shelf ────────────────────────────────────────────────────── */

const ShelfCard = ({ scene }: { scene: RoleplayScene }) => (
  <Link
    className="flex flex-col gap-2 rounded-card border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/60"
    data-testid={`shelf-${scene.key}`}
    search={{ scene: scene.key }}
    to="/roleplay"
  >
    <span aria-hidden className="text-2xl">
      {scene.icon}
    </span>
    <span className="font-semibold text-lg">{scene.title}</span>
    <span className="text-muted-foreground text-sm">{scene.blurb}</span>
    <span className="text-muted-foreground text-xs">
      {scene.level} · {scene.lines.length} turns · {scene.note}
    </span>
  </Link>
);

export const RoleplayShelf = () => (
  <div
    className="mx-auto flex min-h-full w-full max-w-170 flex-col gap-4 p-4"
    data-testid="roleplay-shelf"
  >
    <header className="flex items-center justify-between px-1">
      <Link
        className="flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
        data-testid="rp-back-desk"
        to="/dashboard"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        desk
      </Link>
      <p className="text-muted-foreground text-sm">Roleplay</p>
      <span aria-hidden className="w-12" />
    </header>
    <p className="px-1 text-muted-foreground text-sm">
      who are you meeting today?
    </p>
    <div className="grid gap-4 sm:grid-cols-2">
      {ROLEPLAY_SCENES.map((scene) => (
        <ShelfCard key={scene.key} scene={scene} />
      ))}
    </div>
  </div>
);

export const Roleplay = Object.assign(RoleplayRoot, {
  Bar,
  Thread,
  Transcript,
});
