/*
 * Conjugate Lab (SCR-06) · the morph card (redesign 2026-09-13).
 *
 * One card = one verb × one form. The base renders as `stem【ending】`
 * with the ending boxed · the answer slot IS the transformation, so the
 * reward moment shows the glyphs morphing: on a clean answer the old
 * ending strikes through in 朱 and the new one lands in ai (Motif 2,
 * earned contrast · same DNA as the drill's stroke animation, but for
 * morphology). Irregulars (来る) don't split cleanly, so they show the
 * full reading in the slot.
 *
 * The ladder, three rungs:
 *   1. wrong → targeted question (the classification decision, not the
 *      rule) + the deinflect hint when the answer was the right verb in
 *      the wrong form (TASK-23.29 engine, kept verbatim)
 *   2. wrong again → tell: the rule in one line + the answer + a real
 *      [Save to FSRS] button (saveFsrsToast, undo-aware) + next
 *   💡 hint (anytime) → reveals only the CLASS (る-verb / う-verb /
 *      irregular). Class is the skill; the ending is arithmetic after.
 *
 * Ask-first is the contract (Settings §Correction "ask" is the shipped
 * default); the ask rung carries a "just tell me" escape so tell-mode
 * learners skip one rung. (Settings state is in-memory per SCR-11 v1 ·
 * no global store to read, so the escape hatch is the honest wiring.)
 *
 * Six forms (て・た・ません・ない・たい・可能) as sticky chips
 * (localStorage manobu.conjForm); the verb deck is data/verbs-n5.json
 * (classify()-clean N5 verbs, generated) cycled per form. Wrong verbs
 * resurface at set end ("N to redo"), honest counts, no streaks.
 */

import verbsRaw from "@manobu/japanese/data/verbs-n5.json";
import { log } from "@manobu/ui/lib/gsm";
import { saveFsrsToast } from "@manobu/ui/lib/toast";
import { Link } from "@tanstack/react-router";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  choiceOptions,
  classify,
  conjugate,
  FORM_IDS,
  FORM_LABELS,
  type FormId,
  formGloss,
  patternExplanation,
  type VerbEntry,
  verifyDetailed,
  verifyForm,
} from "@/lib/conjugate";
import { kanaToRomaji, romajiToKana } from "@/lib/romaji";

interface DeckVerb {
  gloss: string;
  verb: VerbEntry;
}

interface RawVerb {
  m: string;
  r: string;
  w: string;
}

const DECK: DeckVerb[] = (verbsRaw as RawVerb[])
  .map((e): DeckVerb | null => {
    const verb = classify(e.r);
    // kanji keeps the written word (食べる); the morph slot runs on the
    // kana stem · conjugation happens in kana, the title stays literate.
    return verb === null ? null : { gloss: e.m, verb: { ...verb, kanji: e.w } };
  })
  .filter((x): x is DeckVerb => x !== null);

const FORM_KEY = "manobu.conjForm";
const MORPH_HOLD_MS = 1400;

type Rung = "none" | "ask" | "tell";

const loadForm = (): FormId => {
  try {
    const f = localStorage.getItem(FORM_KEY);
    if (f && (FORM_IDS as readonly string[]).includes(f)) {
      return f as FormId;
    }
  } catch {
    // private mode: default below
  }
  return "te";
};

/** The class label the hint rung reveals (never the ending). */
const classLabel = (verb: VerbEntry): string => {
  if (verb.kind === "ichidan") {
    return "る-verb (ichidan)";
  }
  if (verb.kind.startsWith("irregular")) {
    return "irregular";
  }
  return `う-verb (godan): ends in ${verb.reading.slice(-1)}`;
};

/** The rung-1 question: the classification decision, not the rule. */
const askQuestion = (verb: VerbEntry, form: FormId): string => {
  if (verb.kind === "ichidan") {
    return `Can you say ${verb.reading.slice(0, -1)}います? Or does ${verb.reading} go straight to ${verb.reading.slice(0, -1)}ます?`;
  }
  if (verb.kind.startsWith("irregular")) {
    return `${verb.kanji} is one of the three irregulars · does a rule fit it?`;
  }
  return `Which row does ${verb.reading.slice(-1)} belong to? Its ${FORM_LABELS[form]} shape comes from that row.`;
};

/** Contrast line for the tell rung: the trap this verb walks into. */
const contrastLine = (verb: VerbEntry, form: FormId): string | null => {
  if (verb.kind === "irregular-iku") {
    const kaku = classify("書く");
    return kaku
      ? `書く → ${conjugate(kaku, form)}, but 行く → ${conjugate(verb, form)}`
      : null;
  }
  if (verb.kind === "irregular-kuru") {
    return `来る is not a rule verb: the ${FORM_LABELS[form]} shape is ${conjugate(verb, form)}`;
  }
  if (verb.kind === "irregular-suru") {
    return `only the する part changes: ${conjugate(verb, form)}`;
  }
  return null;
};

/** Split the surface for the morph slot: stem + boxed ending, or full. */
const morphParts = (
  verb: VerbEntry,
  form: FormId
): { base: string; ending: string; split: boolean } => {
  const full = conjugate(verb, form);
  if (full.startsWith(verb.stem) && verb.stem.length > 0) {
    return {
      base: verb.stem,
      ending: full.slice(verb.stem.length),
      split: true,
    };
  }
  return { base: verb.kanji, ending: full, split: false };
};

interface ConjugateProps {
  /** Optional grade sink (GSM surfaces use log() directly). */
  onGrade?: (grade: 1 | 3) => void;
}

export function Conjugate({ onGrade }: ConjugateProps) {
  const [form, setForm] = useState<FormId>(loadForm);
  const [order, setOrder] = useState<number[]>(() => DECK.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [redo, setRedo] = useState<number[]>([]);
  const [results, setResults] = useState<Record<number, boolean>>({});
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [rung, setRung] = useState<Rung>("none");
  const [hint, setHint] = useState<string | null>(null);
  const [classShown, setClassShown] = useState(false);
  const [morphed, setMorphed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [summary, setSummary] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const idx = order[pos] ?? 0;
  const card = DECK[idx] ?? DECK[0];
  const { verb, gloss } = card;
  const answer = conjugate(verb, form);
  const choices = useMemo(() => choiceOptions(verb, form), [verb, form]);

  /* Refocus the type slot when it appears / the card turns. The deps ARE
   * the trigger (pos/form read for no other reason) · biome can't see
   * that, hence the suppression. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: pos/form/typing are the change signals for the refocus
  useEffect(() => {
    if (typing) {
      inputRef.current?.focus();
    }
  }, [pos, form, typing]);

  const resetRung = useCallback(() => {
    setMorphed(false);
    setRung("none");
    setHint(null);
    setClassShown(false);
    setSaved(false);
    setInput("");
  }, []);

  const advance = useCallback(() => {
    resetRung();
    if (pos + 1 >= order.length) {
      setSummary(true);
      return;
    }
    setPos((p) => p + 1);
  }, [order.length, pos, resetRung]);

  const grade = useCallback(
    (good: boolean) => {
      setResults((r) => ({ ...r, [idx]: good }));
      if (!good) {
        setRedo((q) => (q.includes(idx) ? q : [...q, idx]));
      }
      onGrade?.(good ? 3 : 1);
      log("grade", {
        char: verb.reading,
        correct: good,
        source: `conj-${form}`,
      });
    },
    [form, idx, onGrade, verb.reading]
  );

  /* The ladder on a miss: first wrong → ask, second → tell + grade. */
  const failRung = useCallback(() => {
    if (rung === "none") {
      setRung("ask");
      log("socratic_fail", { level: "ask", verb: verb.reading });
      return;
    }
    setRung("tell");
    log("socratic_fail", { level: "tell", verb: verb.reading });
    grade(false);
  }, [grade, rung, verb.reading]);

  /* Pick a choice: correct morphs; wrong names the form it really is. */
  const onPick = useCallback(
    (choice: string) => {
      if (morphed || rung === "tell") {
        return;
      }
      if (choice === answer) {
        grade(true);
        setRung("none");
        setHint(null);
        setMorphed(true);
        return;
      }
      const wrongForm = FORM_IDS.find(
        (f) => f !== form && conjugate(verb, f) === choice
      );
      setHint(
        wrongForm
          ? `that's the ${FORM_LABELS[wrongForm]} form · right verb, wrong form`
          : "not quite · watch the ending"
      );
      failRung();
    },
    [answer, failRung, form, grade, morphed, rung, verb]
  );

  /* Type mode: romaji is accepted and converted to kana before checking. */
  const onCheck = useCallback(() => {
    const typed = romajiToKana(input.trim());
    if (typed === "") {
      return;
    }
    if (verifyForm(verb, form, typed)) {
      grade(true);
      setRung("none");
      setHint(null);
      setMorphed(true);
      return;
    }
    const detail = verifyDetailed(verb, typed, form);
    if (detail.kind === "deinflected") {
      setHint(detail.hint);
    }
    failRung();
  }, [failRung, form, grade, input, verb]);

  /* Correct → the morph holds a beat, then the card turns. */
  useEffect(() => {
    if (!morphed) {
      return;
    }
    const t = window.setTimeout(advance, MORPH_HOLD_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [advance, morphed]);

  const switchForm = useCallback(
    (next: FormId) => {
      setForm(next);
      try {
        localStorage.setItem(FORM_KEY, next);
      } catch {
        // private mode: sticky for this session only
      }
      // form change = new exercise set; reset progress honestly
      setOrder(DECK.map((_, i) => i));
      setPos(0);
      setRedo([]);
      setResults({});
      resetRung();
    },
    [resetRung]
  );

  const onInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  }, []);

  const toggleTyping = useCallback(() => {
    setTyping((t) => !t);
  }, []);

  const onHint = useCallback(() => {
    setClassShown((s) => !s);
  }, []);

  const onTellSkip = useCallback(() => {
    setRung("tell");
    grade(false);
  }, [grade]);

  const onSave = useCallback(() => {
    setSaved(true);
    saveFsrsToast({
      n: 1,
      onUndo: () => {
        setSaved(false);
      },
      retention: 0.9,
    }).catch(() => undefined);
  }, []);

  const exitSummary = useCallback(() => {
    setOrder(DECK.map((_, i) => i));
    setPos(0);
    setRedo([]);
    setResults({});
    setSummary(false);
    resetRung();
  }, [resetRung]);

  const redoSummary = useCallback(() => {
    setOrder(redo);
    setPos(0);
    setRedo([]);
    setResults({});
    setSummary(false);
    resetRung();
  }, [redo, resetRung]);

  const mastered = useMemo(
    () => Object.values(results).filter(Boolean).length,
    [results]
  );

  if (summary) {
    return (
      <ConjugateSummary
        form={form}
        mastered={mastered}
        onExit={exitSummary}
        onRedo={redoSummary}
        redo={redo}
        total={DECK.length}
      />
    );
  }

  const parts = morphParts(verb, form);
  const contrast = rung === "tell" ? contrastLine(verb, form) : null;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* the form chips (sticky) */}
      <fieldset
        className="flex flex-wrap justify-center gap-1.5 border-0 p-0"
        data-testid="conj-form-chips"
      >
        <legend className="sr-only">Form</legend>
        {FORM_IDS.map((f) => (
          <FormChip
            active={form === f}
            key={f}
            label={FORM_LABELS[f]}
            onSelect={switchForm}
            value={f}
          />
        ))}
      </fieldset>

      {/* card face: the word, with romaji for reading */}
      <div className="text-center">
        <p className="font-semibold text-2xl">{verb.kanji}</p>
        <p className="text-muted-foreground text-xs" data-testid="conj-gloss">
          {verb.reading} · {kanaToRomaji(verb.reading)} · {gloss}
        </p>
      </div>

      {/* the morph card */}
      <div
        className="w-full max-w-130 rounded-card border-2 bg-card p-5"
        data-phase={rung}
        data-testid="conj-card"
        style={{
          borderColor: rung === "tell" ? "var(--mark)" : "var(--border)",
        }}
      >
        <MorphRow
          answer={answer}
          choices={choices}
          form={form}
          gloss={gloss}
          input={input}
          inputRef={inputRef}
          morphed={morphed}
          onCheck={onCheck}
          onInputChange={onInputChange}
          onPick={onPick}
          onToggleTyping={toggleTyping}
          parts={parts}
          rung={rung}
          typing={typing}
          verb={verb}
        />
        <Rungs
          answer={answer}
          contrast={contrast}
          form={form}
          hint={hint}
          onAdvance={advance}
          onSave={onSave}
          onTellSkip={onTellSkip}
          rung={rung}
          saved={saved}
          verb={verb}
        />
      </div>

      {/* the hint rung: class only, never the ending */}
      <div className="flex flex-col items-center gap-1">
        <button
          className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
          data-shown={classShown}
          data-testid="conj-hint"
          onClick={onHint}
          type="button"
        >
          💡 what kind of verb?
        </button>
        {classShown ? (
          <p className="text-muted-foreground text-xs" data-testid="conj-class">
            {classLabel(verb)}
          </p>
        ) : null}
      </div>

      {/* the ladder */}
      <Ladder
        current={idx}
        deckSize={DECK.length}
        mastered={mastered}
        order={order}
        pos={pos}
        redo={redo}
        results={results}
      />
    </div>
  );
}

/* ── form chip ────────────────────────────────────────────────── */

const FormChip = ({
  active,
  label,
  onSelect,
  value,
}: {
  active: boolean;
  label: string;
  onSelect: (f: FormId) => void;
  value: FormId;
}) => {
  const onPick = () => {
    onSelect(value);
  };
  return (
    <button
      aria-pressed={active}
      className={
        active
          ? "min-h-11 rounded-card border-2 border-primary bg-card px-3 py-1.5 font-medium font-mono text-sm"
          : "min-h-11 rounded-card border border-border bg-card px-3 py-1.5 font-mono text-muted-foreground text-sm hover:bg-muted"
      }
      data-testid={`conj-form-${value}`}
      onClick={onPick}
      type="button"
    >
      {label}
    </button>
  );
};

/* ── morph row ────────────────────────────────────────────────── */

interface MorphRowProps {
  answer: string;
  choices: string[];
  form: FormId;
  gloss: string;
  input: string;
  inputRef: RefObject<HTMLInputElement | null>;
  morphed: boolean;
  onCheck: () => void;
  onInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onPick: (choice: string) => void;
  onToggleTyping: () => void;
  parts: { base: string; ending: string; split: boolean };
  rung: Rung;
  typing: boolean;
  verb: VerbEntry;
}

/** What the type slot shows under the input: the conversion, or a hint. */
const romajiPreview = (trimmed: string, converted: string): string => {
  if (converted === "") {
    return "kana or romaji";
  }
  if (converted === trimmed) {
    return converted;
  }
  return `${trimmed} → ${converted}`;
};

const MorphRow = ({
  answer,
  choices,
  form,
  gloss,
  input,
  inputRef,
  morphed,
  onCheck,
  onInputChange,
  onPick,
  onToggleTyping,
  parts,
  rung,
  typing,
  verb,
}: MorphRowProps) => {
  const morphEnding = parts.split ? parts.ending : answer;
  const locked = morphed || rung === "tell";
  /* Hover = the English of THAT shape (the discrimination the card asks
   * for), romaji always visible so English readers can read every word. */
  const choiceLabel = (choice: string): string => {
    const f = FORM_IDS.find((x) => conjugate(verb, x) === choice);
    const romaji = kanaToRomaji(choice);
    return f ? `${romaji} · ${formGloss(f, gloss)}` : romaji;
  };
  const choiceClass = (choice: string): string => {
    const base =
      "flex min-h-14 flex-col items-center justify-center rounded-card px-3 py-2";
    if (locked) {
      return choice === answer
        ? `${base} border-2 border-primary bg-card`
        : `${base} border border-border bg-card opacity-50`;
    }
    return `${base} border border-border bg-card hover:border-primary hover:bg-muted`;
  };
  const onChoiceClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const { value } = e.currentTarget.dataset;
    if (value) {
      onPick(value);
    }
  };
  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCheck();
    }
  };
  const trimmed = input.trim();
  const converted = trimmed === "" ? "" : romajiToKana(trimmed);
  const previewText = romajiPreview(trimmed, converted);
  return (
    <div className="flex flex-col items-center gap-3">
      {/* the instruction: what to find, never the rule that solves it */}
      <p
        className="text-muted-foreground text-sm"
        data-testid="conj-instruction"
      >
        Which one is the{" "}
        <span className="font-mono text-foreground">{FORM_LABELS[form]}</span>{" "}
        form of {verb.kanji}?
      </p>

      {/* the morph slot: stem + ending → answer (or an open slot) */}
      <div className="flex flex-wrap items-center justify-center gap-2 font-mono text-2xl">
        <span>{parts.base}</span>
        <span
          className={
            morphed
              ? "conj-strike rounded-md border border-border px-1 text-mark"
              : "rounded-md border border-border px-1 text-muted-foreground"
          }
          data-testid="conj-base-ending"
        >
          {parts.split ? verb.reading.slice(-1) : verb.reading}
        </span>
        <span aria-hidden="true" className="text-muted-foreground">
          →
        </span>
        {morphed ? (
          <span className="flex items-center">
            {parts.split ? <span>{parts.base}</span> : null}
            <span
              className="conj-land font-mono text-primary"
              data-testid="conj-morph-answer"
            >
              {morphEnding}
            </span>
            <span className="ml-1 font-mono text-muted-foreground text-sm">
              {kanaToRomaji(answer)}
            </span>
          </span>
        ) : (
          <span
            className="rounded-md border-2 border-border border-dashed px-3 text-muted-foreground"
            data-testid="conj-slot"
          >
            ？
          </span>
        )}
      </div>

      {typing ? (
        <div className="flex w-full max-w-90 flex-col items-center gap-1.5">
          <div className="flex w-full items-center gap-2">
            <input
              aria-label={`${FORM_LABELS[form]} form of ${verb.kanji}`}
              className="min-h-11 w-full rounded-card border-2 border-primary bg-transparent px-3 text-center font-mono outline-none"
              data-testid="conj-answer-input"
              onChange={onInputChange}
              onKeyDown={onInputKeyDown}
              placeholder="たべた / tabeta"
              ref={inputRef}
              value={input}
            />
            <button
              className="min-h-11 rounded-card bg-primary px-4 py-2 font-medium text-primary-foreground text-sm"
              data-testid="conj-check"
              onClick={onCheck}
              type="button"
            >
              check
            </button>
          </div>
          <p
            className="text-muted-foreground text-xs"
            data-testid="conj-romaji-preview"
          >
            {previewText}
          </p>
        </div>
      ) : (
        <div
          className="grid w-full max-w-110 grid-cols-2 gap-2"
          data-testid="conj-choices"
        >
          {choices.map((choice, i) => (
            <button
              className={choiceClass(choice)}
              data-testid={`conj-choice-${i}`}
              data-value={choice}
              disabled={locked}
              key={choice}
              onClick={onChoiceClick}
              title={choiceLabel(choice)}
              type="button"
            >
              <span className="font-mono text-lg">{choice}</span>
              <span className="text-muted-foreground text-xs">
                {kanaToRomaji(choice)}
              </span>
            </button>
          ))}
        </div>
      )}

      <button
        className="min-h-11 text-muted-foreground text-xs underline"
        data-testid="conj-toggle-typing"
        onClick={onToggleTyping}
        type="button"
      >
        {typing ? "pick instead" : "type it instead"}
      </button>
    </div>
  );
};

/* ── rungs ────────────────────────────────────────────────────── */

interface RungsProps {
  answer: string;
  contrast: string | null;
  form: FormId;
  hint: string | null;
  onAdvance: () => void;
  onSave: () => void;
  onTellSkip: () => void;
  rung: Rung;
  saved: boolean;
  verb: VerbEntry;
}

const Rungs = ({
  answer,
  contrast,
  form,
  hint,
  onAdvance,
  onSave,
  onTellSkip,
  rung,
  saved,
  verb,
}: RungsProps) => (
  <>
    {hint ? (
      <p
        aria-live="polite"
        className="mt-2 text-center text-muted-foreground text-xs"
        data-testid="conj-deinflect-hint"
      >
        {hint}
      </p>
    ) : null}

    {rung === "ask" ? (
      <div className="mt-3 flex flex-col items-center gap-1">
        <p
          aria-live="polite"
          className="text-center text-sm"
          data-testid="conj-socratic-ask"
        >
          {askQuestion(verb, form)}
        </p>
        <button
          className="min-h-11 text-muted-foreground text-xs underline"
          data-testid="conj-skip-to-tell"
          onClick={onTellSkip}
          type="button"
        >
          just tell me
        </button>
      </div>
    ) : null}

    {rung === "tell" ? (
      <div
        className="mt-3 flex flex-col items-center gap-2"
        data-testid="conj-socratic-tell"
      >
        <p className="text-center text-sm">
          {patternExplanation(verb)} · {FORM_LABELS[form]}:{" "}
          <span className="font-mono text-primary">{answer}</span>
        </p>
        {contrast ? (
          <p className="text-center text-muted-foreground text-xs">
            {contrast}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <button
            className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
            data-testid="conj-save"
            disabled={saved}
            onClick={onSave}
            type="button"
          >
            {saved ? "saved ✓" : "save to FSRS"}
          </button>
          <button
            className="min-h-11 rounded-card bg-primary px-4 py-2 font-medium text-primary-foreground text-sm"
            data-testid="conj-next"
            onClick={onAdvance}
            type="button"
          >
            next
          </button>
        </div>
      </div>
    ) : null}
  </>
);

/* ── ladder ───────────────────────────────────────────────────── */

const Ladder = ({
  current,
  deckSize,
  mastered,
  order,
  pos,
  redo,
  results,
}: {
  current: number;
  deckSize: number;
  mastered: number;
  order: number[];
  pos: number;
  redo: number[];
  results: Record<number, boolean>;
}) => {
  const tickClass = (i: number): string => {
    const r = results[i];
    if (r === true) {
      return "size-2 rounded-full bg-foreground";
    }
    if (r === false) {
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
        aria-label={`${mastered} of ${deckSize} mastered`}
        className="flex flex-wrap justify-center gap-1"
        data-testid="conj-ladder"
        role="img"
      >
        {DECK.map((c, i) => (
          <span
            aria-hidden="true"
            className={tickClass(i)}
            key={c.verb.reading}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-sm" data-testid="conj-progress">
        {pos + 1}/{order.length} in set · {mastered}/{deckSize} mastered
        {redo.length > 0 ? ` · ${redo.length} to redo` : ""}
      </p>
    </div>
  );
};

/* ── set-end summary ──────────────────────────────────────────── */

const ConjugateSummary = ({
  form,
  mastered,
  onExit,
  onRedo,
  redo,
  total,
}: {
  form: FormId;
  mastered: number;
  onExit: () => void;
  onRedo: () => void;
  redo: number[];
  total: number;
}) => (
  <div
    className="w-full max-w-100 rounded-card border border-border bg-card p-5 text-center"
    data-testid="conj-summary"
  >
    <p className="font-semibold text-lg">
      {FORM_LABELS[form]} · {mastered}/{total} mastered
    </p>
    {redo.length > 0 ? (
      <p className="mt-2 text-muted-foreground text-sm" data-testid="conj-redo">
        {redo.length} to redo:{" "}
        {redo
          .map((i) => DECK[i]?.verb.kanji)
          .filter(Boolean)
          .join(" ")}
      </p>
    ) : null}
    <div className="mt-4 flex justify-center gap-2">
      {redo.length > 0 ? (
        <button
          className="min-h-11 rounded-card bg-primary px-4 py-2 font-medium text-primary-foreground text-sm"
          data-testid="conj-redo-button"
          onClick={onRedo}
          type="button"
        >
          redo
        </button>
      ) : null}
      <button
        className="min-h-11 rounded-card border border-border px-4 py-2 text-sm"
        data-testid="conj-done"
        onClick={onExit}
        type="button"
      >
        practice again
      </button>
      <Link
        className="min-h-11 rounded-card border border-border px-4 py-2 text-sm"
        data-testid="conj-back-desk"
        to="/dashboard"
      >
        back to desk
      </Link>
    </div>
  </div>
);

export const __test__ = { classLabel, DECK, morphParts };
