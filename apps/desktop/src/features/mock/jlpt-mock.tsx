/*
 * JLPT Mock (SCR-10) compound component.
 *
 * Per spec §SCR-10:
 *   - Sequential wizard; real+pausable timer `⏱ {mm}:{ss}`.
 *   - Next disabled (40% opacity) until the user picks a choice.
 *   - Helper "Choose an answer to continue" visible until choice.
 *   - On submit: score → top-3 weak patterns → AI 7-day plan scaffolded
 *     from the weak patterns (full Teacher Agent integration lives in
 *     TASK-1.16; [Start plan] currently pre-seeds useChatSession with a
 *     system prompt listing the weak patterns).
 *   - Submit fail: [Retry submit] · Progress saved locally (WAL).
 *   - No total-retake shame copy (spec §Ethical CLEAR).
 *
 * Composition (Vercel pattern, no boolean-prop explosion):
 *   <JlptMock>          provider
 *     <JlptMock.Timer        ⏱ {mm}:{ss} elapsed
 *     <JlptMock.Progress     Q {n}/{total}
 *     <JlptMock.Choices      radio group + helper
 *     <JlptMock.Next         disabled until choice
 *     <JlptMock.Score        pct% + top-3 weak patterns
 *     <JlptMock.Plan         Next 7 days + [Start plan] [Review mistakes]
 *     <JlptMock.SubmitFail   di16p
 *   </JlptMock>
 */

import type { JlptLevel } from "@manobu/api-contract";
import { t } from "@manobu/ui/lib/copy";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { KanaScript } from "@/lib/kana-checkpoint";
import {
  evaluateKanaPaper,
  type KanaAnswerValue,
  type KanaItem,
} from "@/lib/kana-instrument";
import {
  cefrForScore,
  computeMockResult,
  deriveSectionalWeak,
  formatTimer,
  isSectionViable,
  overallPassMark,
  type Question,
  type SectionalScore,
  type SectionName,
  scoreBySection,
  scoreQuestion,
  sectionalPassMark,
  sectionCaps,
  totalScaled,
  type WeakPattern,
} from "@/lib/mock";
import { useTtsPrefs } from "@/lib/tts-voice";
import {
  KanaCheckpointResult,
  type KanaCheckpointScriptResult,
} from "./kana-checkpoint-result";

type Phase = "running" | "scored" | "submit-failed";

type RawCounts = Record<SectionName, { correct: number; total: number }>;

interface ScoredResult {
  cefr: string | null;
  isViable: boolean;
  overallMark: number | null;
  overallPass: boolean | null;
  pct: number;
  rawCounts: RawCounts;
  score: number;
  sectional: SectionalScore | null;
  sectionalWrong: { lang: number; listening: number; reading: number };
  total: number;
  totalScaled: number | null;
  weak: readonly WeakPattern[];
}

interface JlptMockState {
  answers: ReadonlyMap<string, string | null>;
  checkpointResult: KanaCheckpointScriptResult | null;
  chosenId: string | null;
  currentIndex: number;
  elapsedSeconds: number;
  goNext: () => void;
  level: JlptLevel;
  paused: boolean;
  phase: Phase;
  pickChoice: (questionId: string, choiceId: string) => void;
  questions: readonly Question[];
  reset: () => void;
  result: ScoredResult | null;
  setPaused: (paused: boolean) => void;
  source: "mock" | "checkpoint";
  submit: () => Promise<void>;
  /** TASK-36 AC3: the real failure text · a generic "submit failed"
      banner hid the cause (doc-9 QA-3). Null until a submit fails. */
  submitError: string | null;
}

const Scope = createContext<JlptMockState | null>(null);

const useJlptMock = (): JlptMockState => {
  const ctx = useContext(Scope);
  if (!ctx) {
    throw new Error("useJlptMock must be used within JlptMock");
  }
  return ctx;
};

const Timer = () => {
  const { elapsedSeconds, paused, setPaused } = useJlptMock();
  const pause = useCallback(() => {
    setPaused(true);
  }, [setPaused]);
  const resume = useCallback(() => {
    setPaused(false);
  }, [setPaused]);
  return (
    <section
      aria-label="Mock timer"
      className="flex items-center gap-2"
      data-paused={paused}
      data-testid="mock-timer"
    >
      <span aria-live="polite" className="font-mono text-sm">
        {t("mock.timer", {
          mm: formatTimer(elapsedSeconds).slice(0, 2),
          ss: formatTimer(elapsedSeconds).slice(3),
        })}
      </span>
      <button
        aria-pressed={paused}
        className="rounded-card border-2 border-border px-2 py-0.5 text-xs"
        data-testid="mock-timer-toggle"
        onClick={paused ? resume : pause}
        type="button"
      >
        {paused ? "Resume" : "Pause"}
      </button>
    </section>
  );
};

const Progress = () => {
  const { currentIndex, questions } = useJlptMock();
  const total = questions.length;
  const n = Math.min(currentIndex + 1, total);
  return (
    <div className="flex flex-col gap-1">
      <p
        aria-label="Mock progress"
        className="text-muted-foreground text-sm"
        data-testid="mock-progress"
        role="progressbar"
      >
        {t("mock.progress", { n, total })}
      </p>
      {/* TASK-23.7 AC#3 (doc-4 §5 + nihongoai-copy-deck place.note): real
          JLPT has no level prerequisites · surface the skip helper under the
          progress line so a learner can jump straight to N3. Shown on the
          first question only, level-agnostic copy. */}
      {n === 1 ? (
        <p
          className="text-muted-foreground text-xs"
          data-testid="mock-skip-placement"
        >
          {t("mock.skip.placement")}
        </p>
      ) : null}
    </div>
  );
};

// TASK-36 AC3: visible selected-vs-correct feedback the moment you
// answer · correct row ringed green, a wrong pick red · before advancing.
const CHOICE_CLASS =
  "rounded-card border-2 border-border px-3 py-2 text-left text-sm";
const choiceClass = (
  chosenId: string | null,
  cid: string,
  correctId: string
): string => {
  if (chosenId !== null && cid === correctId) {
    return "rounded-card border-2 border-success bg-success/10 px-3 py-2 text-left text-sm";
  }
  if (chosenId === cid) {
    return "rounded-card border-2 border-destructive bg-destructive/10 px-3 py-2 text-left text-sm";
  }
  return CHOICE_CLASS;
};

const Choices = () => {
  const { questions, currentIndex, chosenId, pickChoice } = useJlptMock();
  const q = questions[currentIndex];
  if (!q) {
    return null;
  }
  return (
    <fieldset
      aria-label={q.prompt}
      className="rounded-card border-2 border-border p-3"
      data-testid="mock-choices"
    >
      <legend className="font-semibold">{q.prompt}</legend>
      <div className="flex flex-col gap-2">
        {q.choiceIds.map((cid) => {
          const onPick = () => {
            pickChoice(q.id, cid);
          };
          return (
            <button
              aria-pressed={chosenId === cid}
              className={choiceClass(chosenId, cid, q.correctId)}
              data-choice={cid}
              data-correct={cid === q.correctId}
              data-picked={chosenId === cid}
              data-testid="mock-choice"
              key={cid}
              onClick={onPick}
              type="button"
            >
              {q.choices[cid] ?? cid}
            </button>
          );
        })}
      </div>
      <p
        aria-live="polite"
        className="mt-2 text-muted-foreground text-xs"
        data-opacity-40={chosenId === null}
        data-testid="mock-helper"
      >
        {chosenId === null ? t("mock.helper") : "✓"}
      </p>
    </fieldset>
  );
};

const Next = () => {
  const { chosenId, goNext, currentIndex, questions } = useJlptMock();
  const isLast = currentIndex >= questions.length - 1;
  const disabled = chosenId === null;
  const className = `mt-2 rounded-card bg-2 px-3 py-1 text-sm ${
    disabled ? "opacity-40" : ""
  }`;
  return (
    <button
      aria-disabled={disabled}
      className={className}
      data-testid="mock-next"
      disabled={disabled}
      onClick={goNext}
      type="button"
    >
      {isLast ? "Submit" : "→"}
    </button>
  );
};

const SECTION_LABELS: Record<SectionName, string> = {
  lang: "Language",
  listening: "Listening",
  reading: "Reading",
};

/**
 * One sectional badge: `言語 42/60 ✓` style · pass/fail against the official
 * sectional mark (19/60 N1-N3; 38/120 lang + 19/60 listening N4-N5, reading 0).
 * Hidden when the section is below the viability floor · caller checks
 * isSectionViable before rendering.
 */
const SectionBadge = ({
  level,
  points,
  section,
  wrong,
}: {
  level: JlptLevel;
  points: number;
  section: SectionName;
  wrong: number;
}) => {
  const cap = sectionCaps(level)[section];
  const pass = points >= sectionalPassMark(level, section);
  return (
    <span
      className="rounded-card border-2 border-border px-2 py-0.5 text-xs"
      data-pass={pass}
      data-section={section}
      data-testid={`mock-section-${section}`}
    >
      {SECTION_LABELS[section]} {points}/{cap}{" "}
      {pass ? "✓" : `✗ (${wrong} wrong)`}
    </span>
  );
};

/** Raw count row shown below the viability floor: `Language 2/6` (no band). */
const RawCount = ({
  correct,
  label,
  section,
  total,
}: {
  correct: number;
  label: string;
  section: SectionName;
  total: number;
}) => (
  <span
    className="rounded-card border-2 border-border px-2 py-0.5 text-xs"
    data-testid={`mock-raw-${section}`}
  >
    {label} {correct}/{total}
  </span>
);

/**
 * Raw counts per test section (three buckets, always). The band view folds
 * reading into lang at N4/N5 (D11): two scoring sections, not three.
 */
const computeRawCounts = (
  questions: readonly Question[],
  answers: ReadonlyMap<string, string | null>
): Record<SectionName, { correct: number; total: number }> => {
  const raw: Record<SectionName, { correct: number; total: number }> = {
    lang: { correct: 0, total: 0 },
    listening: { correct: 0, total: 0 },
    reading: { correct: 0, total: 0 },
  };
  for (const q of questions) {
    const section = q.section ?? "lang";
    raw[section].total += 1;
    if (scoreQuestion(q, answers.get(q.id) ?? null)) {
      raw[section].correct += 1;
    }
  }
  return raw;
};

/**
 * Scale raw answer counts to official scoring caps. At N4/N5 reading is
 * folded into lang for banding (D11): the lang total is lang+reading,
 * listening stays separate, reading band stays 0.
 */
const computeSectional = (
  questions: readonly Question[],
  answers: ReadonlyMap<string, string | null>,
  level: JlptLevel
): SectionalScore => {
  const raw = computeRawCounts(questions, answers);
  if (level === "N4" || level === "N5") {
    const combined = {
      correct: raw.lang.correct + raw.reading.correct,
      total: raw.lang.total + raw.reading.total,
    };
    return scoreBySection(level, {
      lang: combined,
      listening: raw.listening,
      reading: { correct: 0, total: 0 },
    });
  }
  return scoreBySection(level, raw);
};

const isViablePaper = (level: JlptLevel, rawCounts: RawCounts): boolean => {
  if (level === "N4" || level === "N5") {
    const langTotal = rawCounts.lang.total + rawCounts.reading.total;
    return (
      isSectionViable(level, "lang", langTotal) &&
      isSectionViable(level, "listening", rawCounts.listening.total)
    );
  }
  return (
    isSectionViable(level, "lang", rawCounts.lang.total) &&
    isSectionViable(level, "reading", rawCounts.reading.total) &&
    isSectionViable(level, "listening", rawCounts.listening.total)
  );
};

const passesEverySection = (
  level: JlptLevel,
  sectional: SectionalScore
): boolean => {
  if (level === "N4" || level === "N5") {
    return (
      sectional.lang >= sectionalPassMark(level, "lang") &&
      sectional.listening >= sectionalPassMark(level, "listening")
    );
  }
  return (
    sectional.lang >= sectionalPassMark(level, "lang") &&
    sectional.reading >= sectionalPassMark(level, "reading") &&
    sectional.listening >= sectionalPassMark(level, "listening")
  );
};

const buildScoredResult = (
  level: JlptLevel,
  questions: readonly Question[],
  answers: ReadonlyMap<string, string | null>,
  r: Awaited<ReturnType<typeof computeMockResult>>
): ScoredResult => {
  const sectional = computeSectional(questions, answers, level);
  const sectionalWrong = deriveSectionalWeak(
    r.mistakes.map((m) => ({
      ...m,
      section: questions.find((q) => q.id === m.questionId)?.section,
    }))
  );
  const rawCounts = computeRawCounts(questions, answers);
  const isViable = isViablePaper(level, rawCounts);
  const scaledTotal = isViable ? totalScaled(sectional) : null;
  const overallMark = isViable ? overallPassMark(level) : null;
  const overallPass =
    isViable && scaledTotal !== null && overallMark !== null
      ? scaledTotal >= overallMark && passesEverySection(level, sectional)
      : null;
  const cefr =
    isViable && scaledTotal !== null ? cefrForScore(level, scaledTotal) : null;
  return {
    cefr,
    isViable,
    overallMark,
    overallPass,
    pct: r.pct,
    rawCounts,
    score: r.score,
    sectional,
    sectionalWrong,
    total: r.total,
    totalScaled: scaledTotal,
    weak: r.weak,
  };
};

// ---------------------------------------------------------------------------
// TASK-23.8 (doc-4 §5.2): Reading + Listening section cards. Both reuse the
// SAME Choices shape (a Question with a `section` tag feeds the sectional
// scoring built in TASK-23.7).
// ---------------------------------------------------------------------------

/** Konbini notice · information-retrieval reading stimulus (Reader N5_DEFAULT reuse). */
const READING_NOTICE = {
  jp: "コンビニは 24時間 営業です。朝も夜も 開いています。おにぎりは 110円です。",
  title: "おしらせ · Information (N5)",
};

/** Konbini short passage · narrative reading stimulus (Reader N5_DEFAULT reuse). */
const READING_PASSAGE = {
  jp: "私は まいにち コンビニで おにぎりを 買います。店員は いつも 「いらっしゃいませ」と 言います。あさは あたたかい コーヒーも 売っています。",
  title: "どきょ · Short passage (N4)",
};

/** Listening stimulus line (TTS-spoken; no on-screen jp for the listening card). */
const LISTENING_LINE =
  "これは わたしの くるまです。あかい くるまです。きのう 買いました。";

/** One reading stimulus block + the shared Choices radio group. */
const ReadingCard = () => {
  const { currentIndex, questions } = useJlptMock();
  const q = questions[currentIndex];
  if (q?.section !== "reading") {
    return null;
  }
  const stimuli: Record<string, { jp: string; title: string }> = {
    "mock-reading-1": READING_NOTICE,
    "mock-reading-2": READING_PASSAGE,
  };
  const stimulus = stimuli[q.id] ?? null;
  if (stimulus === null) {
    return null;
  }
  return (
    <section
      aria-label="Reading passage"
      className="rounded-card border-2 border-border p-3"
      data-testid="mock-reading-passage"
    >
      <h2 className="font-semibold text-sm">{stimulus.title}</h2>
      <p className="mt-2 text-sm leading-relaxed">{stimulus.jp}</p>
    </section>
  );
};

/** TTS [▶] + shared Choices · no on-screen text of the spoken line. */
const ListeningCard = () => {
  const { currentIndex, questions } = useJlptMock();
  const prefs = useTtsPrefs();
  const [playing, setPlaying] = useState(false);
  const onPlay = useCallback(async () => {
    setPlaying(true);
    try {
      const { speak } = await import("@manobu/speech/tts");
      const isInTauri = typeof window !== "undefined" && "__TAURI__" in window;
      if (isInTauri) {
        await speak(LISTENING_LINE, { sid: prefs.sid, speed: prefs.speed });
      }
    } catch {
      /* degrade silently · the transcript shows in web dev */
    } finally {
      setPlaying(false);
    }
  }, [prefs.sid, prefs.speed]);
  const q = questions[currentIndex];
  if (q?.section !== "listening") {
    return null;
  }
  return (
    <section
      aria-label="Listening stimulus"
      className="flex flex-col gap-2 rounded-card border-2 border-border p-3"
      data-testid="mock-listening"
    >
      <button
        className="self-start rounded-card bg-primary px-3 py-1 text-primary-foreground text-sm"
        data-playing={playing}
        data-testid="mock-listening-play"
        onClick={onPlay}
        type="button"
      >
        {playing ? "▮▮" : "[▶] Listen"} {prefs.speed === 0.8 ? "0.8×" : "1×"}
      </button>
      {typeof window !== "undefined" && "__TAURI__" in window ? null : (
        <p className="text-muted-foreground text-xs">
          Web dev: TTS is Tauri-only · transcript: {LISTENING_LINE}
        </p>
      )}
    </section>
  );
};

const RawCounts = ({ rawCounts }: { rawCounts: RawCounts }) => (
  <div className="mt-2 flex flex-wrap gap-2" data-testid="mock-raw-counts">
    {(["lang", "reading", "listening"] as const).map((section) => {
      const rc = rawCounts[section];
      if (rc.total === 0) {
        return null;
      }
      return (
        <RawCount
          correct={rc.correct}
          key={section}
          label={SECTION_LABELS[section]}
          section={section}
          total={rc.total}
        />
      );
    })}
  </div>
);

const SectionalBadges = ({
  level,
  result,
}: {
  level: JlptLevel;
  result: ScoredResult;
}) => {
  const scoringSections: SectionName[] =
    level === "N4" || level === "N5"
      ? ["lang", "listening"]
      : ["lang", "reading", "listening"];
  return (
    <div className="mt-2 flex flex-wrap gap-2" data-testid="mock-sectional">
      {scoringSections.map((section) => (
        <SectionBadge
          key={section}
          level={level}
          // biome-ignore lint/style/noNonNullAssertion: sectional is non-null when viable (guarded above)
          points={result.sectional![section]}
          section={section}
          wrong={result.sectionalWrong[section]}
        />
      ))}
      {result.cefr === null ? null : (
        <span
          className="rounded-card border-2 border-primary px-2 py-0.5 text-xs"
          data-cefr={result.cefr}
          data-testid="mock-cefr-badge"
        >
          CEFR {result.cefr}
        </span>
      )}
    </div>
  );
};

const OverallLine = ({ result }: { result: ScoredResult }) => {
  if (result.totalScaled === null || result.overallMark === null) {
    return null;
  }
  return (
    <p
      className="mt-2 text-xs"
      data-pass={result.overallPass}
      data-testid="mock-overall"
    >
      Overall {result.totalScaled}/180 pass mark {result.overallMark}{" "}
      {result.overallPass ? "✓" : "✗"}
    </p>
  );
};

const WeakPatternsLine = ({ result }: { result: ScoredResult }) => {
  if (result.weak.length === 0) {
    return (
      <p className="mt-1 text-muted-foreground text-sm">
        Perfect run · no weak patterns.
      </p>
    );
  }
  const patternSummary = result.weak
    .map((w) => `${w.pattern} (${w.wrong}/${w.total})`)
    .join(" · ");
  return (
    <p
      aria-live="polite"
      className="mt-1 text-sm"
      data-testid="mock-weak-patterns"
    >
      Weak: {patternSummary}
    </p>
  );
};

const Score = () => {
  const { checkpointResult, level, result, source } = useJlptMock();
  if (source === "checkpoint") {
    return (
      <KanaCheckpointResult
        results={checkpointResult ? [checkpointResult] : []}
        source={source}
        submitted={checkpointResult !== null}
      />
    );
  }
  if (!result) {
    return null;
  }
  const isShortened = !result.isViable;
  return (
    <section
      aria-label="Mock score"
      className="rounded-card border-2 border-border p-3"
      data-testid="mock-score"
    >
      <h2 className="font-semibold text-lg">
        Score {result.pct}% ({result.score}/{result.total})
      </h2>
      {isShortened ? (
        <p
          className="mt-1 text-muted-foreground text-xs"
          data-testid="mock-shortened-label"
        >
          Shortened paper: {result.total} questions
        </p>
      ) : null}
      {result.sectional === null ? null : (
        <>
          {isShortened ? (
            <RawCounts rawCounts={result.rawCounts} />
          ) : (
            <SectionalBadges level={level} result={result} />
          )}
          {isShortened ? null : <OverallLine result={result} />}
        </>
      )}
      <WeakPatternsLine result={result} />
    </section>
  );
};

const Plan = () => {
  const { result, source } = useJlptMock();
  if (source === "checkpoint" || !result || result.weak.length === 0) {
    return null;
  }
  const startPlan = () => {
    /* Wired to useChatSession in TASK-1.16 · for now this is a no-op marker. */
    if (typeof window !== "undefined") {
      window.console.info(
        "[JlptMock] Start plan: would seed chat session with patterns",
        result.weak.map((w) => w.grammarId)
      );
    }
  };
  const reviewMistakes = () => {
    if (typeof window !== "undefined") {
      window.console.info("[JlptMock] Review mistakes", result);
    }
  };
  return (
    <section
      aria-label="7-day study plan"
      className="rounded-card border-2 border-border p-3"
      data-testid="mock-plan"
    >
      <h2 className="font-semibold">Next 7 days</h2>
      <p className="mt-1 text-sm">
        Focus on {result.weak.length} weak pattern
        {result.weak.length === 1 ? "" : "s"}:
      </p>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {result.weak.map((w) => (
          <li key={w.grammarId}>
            {w.pattern} · {w.wrong}/{w.total} wrong this mock
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <button
          className="rounded-card border-2 border-border px-3 py-1 text-sm"
          data-testid="mock-plan-start"
          onClick={startPlan}
          type="button"
        >
          {t("mock.start_plan")}
        </button>
        <button
          className="rounded-card border-2 border-border px-3 py-1 text-sm"
          data-testid="mock-plan-mistakes"
          onClick={reviewMistakes}
          type="button"
        >
          {t("mock.mistakes")}
        </button>
      </div>
    </section>
  );
};

const SubmitFail = () => {
  const { phase, reset, submit, submitError } = useJlptMock();
  const retrySubmit = () => {
    submit().catch(() => {
      // surfaced via phase="submit-failed" + console.error in submit
    });
  };
  // TASK-40 AC1: no phase guard → the failure banner rendered in EVERY
  // phase, including "running" (Q1/9) and "scored" · the whole "mock
  // always fails" symptom was this ghost banner.
  if (phase !== "submit-failed") {
    return null;
  }
  return (
    <section
      aria-live="assertive"
      className="rounded-card border-2 border-destructive p-3"
      data-testid="mock-submit-fail"
      role="alert"
    >
      <p className="text-sm">{t("mock.submit.fail")}</p>
      {submitError === null ? null : (
        <p
          className="mt-1 font-mono text-muted-foreground text-xs"
          data-testid="mock-submit-error"
        >
          {submitError}
        </p>
      )}
      {/* TASK-40 AC4: Retry re-runs submit (answers preserved); full reset
          moves to a separate "Start over" control. */}
      <button
        className="mt-2 rounded-card border-2 border-border px-3 py-1 text-sm"
        onClick={retrySubmit}
        type="button"
      >
        Retry submit
      </button>
      <button
        className="mt-2 ml-2 rounded-card border-2 border-border px-3 py-1 text-sm"
        onClick={reset}
        type="button"
      >
        Start over
      </button>
    </section>
  );
};

interface KanaCheckpointConfig {
  items: readonly KanaItem[];
  script: KanaScript;
}

const checkpointResultFor = (
  checkpoint: KanaCheckpointConfig,
  questions: readonly Question[],
  answers: ReadonlyMap<string, string | null>
): KanaCheckpointScriptResult => {
  const checkpointAnswers = new Map<string, KanaAnswerValue>();
  for (const item of checkpoint.items) {
    const picked = answers.get(item.id) ?? null;
    const question = questions.find((candidate) => candidate.id === item.id);
    checkpointAnswers.set(item.id, {
      correct: picked !== null && picked === question?.correctId,
      picked,
    });
  }
  return {
    evaluation: evaluateKanaPaper(checkpoint.items, checkpointAnswers),
    script: checkpoint.script,
  };
};

interface JlptMockProps {
  checkpoint?: KanaCheckpointConfig;
  children: ReactNode;
  /** Mock level · drives sectional caps (60/60/60 vs 120/60) + CEFR badge. */
  level: JlptLevel;
  questions: readonly Question[];
  source?: "mock" | "checkpoint";
}

const JlptMockRoot = ({
  checkpoint,
  children,
  level,
  questions,
  source = "mock",
}: JlptMockProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<string, string | null>>(
    () => new Map()
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<Phase>("running");
  const [result, setResult] = useState<ScoredResult | null>(null);
  const [checkpointResult, setCheckpointResult] =
    useState<KanaCheckpointScriptResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (paused || phase !== "running") {
      return;
    }
    const id = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [paused, phase]);

  const chosenId = answers.get(questions[currentIndex]?.id ?? "") ?? null;

  const pickChoice = useCallback((questionId: string, choiceId: string) => {
    setAnswers((prev) => {
      const next = new Map(prev);
      next.set(questionId, choiceId);
      return next;
    });
  }, []);

  const goNext = useCallback(() => {
    if (chosenId === null) {
      return;
    }
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
      return;
    }
    const finalize = async () => {
      try {
        if (source === "checkpoint" && checkpoint) {
          setCheckpointResult(
            checkpointResultFor(checkpoint, questions, answers)
          );
          setResult(null);
        } else {
          const r = await computeMockResult(questions, answers);
          setResult(buildScoredResult(level, questions, answers, r));
          setCheckpointResult(null);
        }
        setPhase("scored");
      } catch (e) {
        // TASK-40 AC2: silent catch hid real failures (doc-9 QA-3).
        // TASK-36 AC3: surface the actual error text in the fail banner.
        console.error("[JlptMock] finalize failed:", e);
        setSubmitError(e instanceof Error ? e.message : String(e));
        setPhase("submit-failed");
      }
    };
    finalize().catch((e) => {
      console.error("[JlptMock] finalize rejected:", e);
    });
  }, [answers, checkpoint, chosenId, currentIndex, level, questions, source]);

  const submit = useCallback(async () => {
    try {
      if (source === "checkpoint" && checkpoint) {
        setCheckpointResult(
          checkpointResultFor(checkpoint, questions, answers)
        );
        setResult(null);
      } else {
        const r = await computeMockResult(questions, answers);
        setResult(buildScoredResult(level, questions, answers, r));
        setCheckpointResult(null);
      }
      setPhase("scored");
    } catch (e) {
      // TASK-40 AC2: silent catch hid real failures (doc-9 QA-3).
      // TASK-36 AC3: surface the actual error text in the fail banner.
      console.error("[JlptMock] submit failed:", e);
      setSubmitError(e instanceof Error ? e.message : String(e));
      setPhase("submit-failed");
    }
  }, [answers, checkpoint, level, questions, source]);

  const reset = useCallback(() => {
    setCurrentIndex(0);
    setAnswers(new Map());
    setElapsedSeconds(0);
    setPhase("running");
    setResult(null);
    setCheckpointResult(null);
    setSubmitError(null);
  }, []);

  const ctx: JlptMockState = {
    answers,
    checkpointResult,
    chosenId,
    currentIndex,
    elapsedSeconds,
    goNext,
    level,
    paused,
    phase,
    pickChoice,
    questions,
    reset,
    result,
    setPaused,
    source,
    submit,
    submitError,
  };

  return <Scope.Provider value={ctx}>{children}</Scope.Provider>;
};

export const JlptMock = Object.assign(JlptMockRoot, {
  Choices,
  ListeningCard,
  Next,
  Plan,
  Progress,
  ReadingCard,
  Score,
  SubmitFail,
  Timer,
});

export const __test__ = { formatTimer };
