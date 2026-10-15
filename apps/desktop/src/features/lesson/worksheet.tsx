/*
 * Worksheet (SCR-08 redesign) · the lesson as a sensei's worksheet.
 *
 * One card, one moment, flip to continue. The desk philosophy extended:
 * the card shows only what the learner can ACT on. A first-day travel
 * user cannot read, so the travel face is meaning + sound FIRST · the
 * script appears only after the sound has been heard (a label for a
 * sound they own, not a puzzle). The JLPT face is word-first (they are
 * there precisely to learn to read). The goal picks the face.
 *
 * Tap-any-word-for-help is the hiragana curriculum: every tap is one
 * binding event (squiggle ↔ sound ↔ meaning). Romaji is never banned,
 * only demoted from "given" to "asked for".
 *
 * Composition (Vercel pattern):
 *   <Worksheet deck goalLabel>    provider: deck + stage machine + phase
 *     <Worksheet.Bar />           ← desk · Lesson · goal · saved dots
 *     <Worksheet.Card />          listen → read (study phase)
 *     <Worksheet.Practice />      hear → recognize (practice phase)
 *     <Worksheet.Done />          honest close, no confetti (done phase)
 *   </Worksheet>
 *
 * Data-honesty: the dots count saved cards (real), the done line counts
 * taps (real), "first review: tomorrow" is the FSRS default (real). No
 * streak, no XP, no fake progress. Romaji visibility follows the parsed
 * per-kana mastery state, while tap-reveal remains available as a safety net.
 */

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
  useRef,
  useState,
} from "react";

import { getKanaCellState } from "@/lib/kana-mastery";
import {
  cardStage,
  doneCopy,
  type LessonCard,
  type LessonDeck,
  segmentReading,
  type WordChipData,
} from "@/lib/lesson-cards";
import { ListenButton } from "@/shared/listen-button";

/* ── scope ─────────────────────────────────────────────────────── */

type Phase = "done" | "practice" | "study";

interface WorksheetContext {
  card: LessonCard;
  deck: LessonDeck;
  goalLabel: string;
  heard: boolean;
  index: number;
  /** Practice finished · the provider owns the phase flip so the
   * worksheet never strands on a blank card (the local done flag did). */
  onFinish: () => void;
  onHear: () => void;
  onNext: () => void;
  onSave: () => void;
  onTapWord: () => void;
  saved: readonly number[];
  taps: number;
  total: number;
}

const WorksheetScope = createContext<WorksheetContext | null>(null);

const useWorksheet = (): WorksheetContext => {
  const ctx = useContext(WorksheetScope);
  if (!ctx) {
    throw new Error("useWorksheet must be used within Worksheet");
  }
  return ctx;
};

/** Which phase subcomponent renders; lives in the provider so children
 * never sniff the DOM. */
const PhaseScope = createContext<Phase>("study");
const usePhase = (): Phase => useContext(PhaseScope);

interface WorksheetProps {
  /** null while the deck is still loading · renders a quiet placeholder. */
  children: ReactNode;
  deck: LessonDeck | null;
  goalLabel: string;
}

const Worksheet = ({ children, deck, goalLabel }: WorksheetProps) => {
  const [index, setIndex] = useState(0);
  const [heardSet, setHeardSet] = useState<Set<number>>(() => new Set());
  const [saved, setSaved] = useState<number[]>([]);
  const [taps, setTaps] = useState(0);
  const [phase, setPhase] = useState<Phase>("study");
  // lesson_start once per deck-mount (TASK-68 scope rule · never per card).
  const started = useRef(false);
  useEffect(() => {
    if (deck && !started.current) {
      started.current = true;
      log("lesson_start", { cards: deck.cards.length, goal: goalLabel });
    }
  }, [deck, goalLabel]);

  const onHear = useCallback(() => {
    setHeardSet((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, [index]);
  const onFinish = useCallback(() => {
    setPhase("done");
  }, []);
  const onTapWord = useCallback(() => {
    setTaps((t) => t + 1);
  }, []);
  const onSave = useCallback(() => {
    // Mark saved NOW · the toast is the confirmation UI, and its promise
    // resolves true on UNDO (see saveFsrsToast docs), so awaiting it to
    // "confirm" would record saves exactly when the user cancels them.
    // The onUndo callback un-marks. (The old RightRail had this inverted.)
    setSaved((s) => (s.includes(index) ? s : [...s, index]));
    saveFsrsToast({
      n: 1,
      onUndo: () => {
        setSaved((s) => s.filter((i) => i !== index));
      },
      retention: 0.9,
    }).catch(() => undefined);
  }, [index]);
  const onNext = useCallback(() => {
    if (!deck) {
      return;
    }
    if (index < deck.cards.length - 1) {
      setIndex((i) => i + 1);
      return;
    }
    // Last card: practice only exists for saved cards; nothing saved →
    // straight to the honest close (no fake review to grade).
    setPhase(saved.length > 0 ? "practice" : "done");
  }, [deck, index, saved.length]);

  const card = deck?.cards[index];
  if (!(deck && card)) {
    return (
      <div className="flex min-h-full items-center justify-center p-4">
        <p className="text-muted-foreground text-sm">
          {deck
            ? "No cards today · nothing to learn right now."
            : "warming up…"}
        </p>
      </div>
    );
  }
  const ctx: WorksheetContext = {
    card,
    deck,
    goalLabel,
    heard: heardSet.has(index),
    index,
    onFinish,
    onHear,
    onNext,
    onSave,
    onTapWord,
    saved,
    taps,
    total: deck.cards.length,
  };
  return (
    <WorksheetScope.Provider value={ctx}>
      <PhaseScope.Provider value={phase}>
        <div
          className="mx-auto flex min-h-full w-full max-w-170 flex-col gap-4 p-4"
          data-phase={phase}
          data-testid="worksheet"
        >
          {children}
        </div>
      </PhaseScope.Provider>
    </WorksheetScope.Provider>
  );
};

/* ── bar ───────────────────────────────────────────────────────── */

/** Dot state for one card: saved (filled) > current (ring) > upcoming.
 * Keys ride the deck's unique jp (curated decks never repeat a phrase). */
const dotClass = (isSaved: boolean, isCurrent: boolean): string => {
  if (isSaved) {
    return "size-2.5 rounded-full bg-primary";
  }
  if (isCurrent) {
    return "size-2.5 rounded-full border-2 border-foreground";
  }
  return "size-2.5 rounded-full border border-border";
};

const Bar = () => {
  const { deck, goalLabel, index, saved, taps, total } = useWorksheet();
  return (
    <header className="flex items-center justify-between px-1">
      <Link
        className="flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
        data-testid="worksheet-back"
        to="/dashboard"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        desk
      </Link>
      <p className="text-muted-foreground text-sm">
        Lesson · {goalLabel} · {index + 1}/{total}
        {taps > 0 ? ` · ${taps} taps of help` : ""}
      </p>
      <span aria-hidden className="flex gap-1.5">
        {deck.cards.map((c, i) => (
          <span
            className={dotClass(saved.includes(i), i === index)}
            key={c.jp}
          />
        ))}
      </span>
    </header>
  );
};

/* ── word chip (tap-reveal) ────────────────────────────────────── */

/* Cards without a hand-picked breakdown segment per syllable from the
 * kana data (きゃ never splits) · a kana tap teaches exactly one kana. */
const chipsFor = (card: LessonCard): readonly WordChipData[] => {
  if (card.words) {
    return card.words;
  }
  return segmentReading(card.rd)
    .filter((m) => m.romaji !== "")
    .map((m) => ({ en: m.romaji, jp: m.text, rd: m.text }));
};

const kanaCellsFor = (reading: string): readonly string[] =>
  segmentReading(reading)
    .filter((part) => part.romaji !== "")
    .map((part) => part.text);

const romajiVisibleForCell = (cell: string): boolean =>
  getKanaCellState(cell) !== "solid";

const romajiVisibleForReading = (reading: string): boolean => {
  const cells = kanaCellsFor(reading);
  return cells.length === 0 || cells.some(romajiVisibleForCell);
};

const romajiPartsForReading = (
  reading: string
):
  | readonly { cell: string; key: string; romaji: string; text: string }[]
  | null => {
  const parts = segmentReading(reading);
  if (parts.some((part) => part.romaji === "" && part.text.trim() !== "")) {
    return null;
  }
  const kanaParts = parts.filter(
    (part) => part.romaji !== "" || part.text === " "
  );
  if (kanaParts.length === 0) {
    return null;
  }
  const occurrences = new Map<string, number>();
  return kanaParts.map((part) => {
    const base = part.romaji === "" ? "space" : part.text;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return {
      cell: part.romaji === "" ? "" : part.text,
      key: `${base}-${occurrence}`,
      romaji: part.romaji,
      text: part.text,
    };
  });
};

const RomajiLine = ({ card }: { card: LessonCard }) => {
  const parts = romajiPartsForReading(card.rd);
  if (parts === null) {
    const visible = romajiVisibleForReading(card.rd);
    return (
      <p
        className="text-muted-foreground text-sm"
        data-romaji-visible={visible}
        data-testid="worksheet-romaji"
      >
        {visible ? card.romaji : null}
      </p>
    );
  }
  const kanaParts = parts.filter((part) => part.romaji !== "");
  const visible =
    kanaParts.length === 0 ||
    kanaParts.some((part) => romajiVisibleForCell(part.cell));
  return (
    <p
      className="text-muted-foreground text-sm"
      data-romaji-visible={visible}
      data-testid="worksheet-romaji"
    >
      {parts.map((part) => {
        if (part.romaji === "") {
          return <span key={part.key}>{part.text}</span>;
        }
        const cellVisible = romajiVisibleForCell(part.cell);
        return (
          <span
            data-cell={part.cell}
            data-romaji-visible={cellVisible}
            key={part.key}
          >
            {cellVisible ? part.romaji : null}
          </span>
        );
      })}
    </p>
  );
};

const romajiForChip = (chip: WordChipData, card: LessonCard): string => {
  const derived = segmentReading(chip.rd)
    .map((part) => part.romaji)
    .filter(Boolean)
    .join(" ");
  return derived || card.romaji;
};

const WordChip = ({ chip }: { chip: WordChipData }) => {
  const { card, onTapWord } = useWorksheet();
  const revealedRomaji = romajiForChip(chip, card);
  const [open, setOpen] = useState(false);
  const onToggle = useCallback(() => {
    setOpen((o) => !o);
    onTapWord();
  }, [onTapWord]);
  return (
    <span className="flex flex-col items-start gap-0.5">
      <button
        aria-expanded={open}
        aria-label={`${chip.jp} · tap for help`}
        className={
          open
            ? "rounded-md bg-accent px-1.5 py-0.5 text-accent-foreground text-xl"
            : "rounded-md px-1.5 py-0.5 text-xl underline decoration-dotted underline-offset-4 transition-colors hover:bg-accent"
        }
        data-romaji={revealedRomaji}
        data-testid={`word-${chip.jp}`}
        onClick={onToggle}
        type="button"
      >
        {chip.jp}
      </button>
      {open ? (
        <span
          className="flex items-center gap-1 px-1.5 text-muted-foreground text-xs"
          data-romaji={revealedRomaji}
          data-testid={`word-romaji-${chip.jp}`}
        >
          <span>{chip.en}</span>
          {revealedRomaji === chip.en ? null : <span>{revealedRomaji}</span>}
          <ListenButton text={chip.rd} variant="chip" />
        </span>
      ) : null}
    </span>
  );
};

/* ── card (study phase) ────────────────────────────────────────── */

const Card = () => {
  const phase = usePhase();
  const { card, deck, heard, index, onHear, onNext, onSave, saved } =
    useWorksheet();
  if (phase !== "study") {
    return null;
  }
  const stage = cardStage(deck, heard);
  const isSaved = saved.includes(index);
  if (stage === "listen") {
    return (
      <section
        className="flex flex-1 flex-col items-center justify-center gap-8 rounded-card border border-border bg-card p-8 text-center"
        data-stage="listen"
        data-testid="worksheet-card"
      >
        <p className="text-2xl leading-relaxed">“{card.en}”</p>
        <ListenButton onHeard={onHear} text={card.rd} variant="lg" />
        <p className="text-muted-foreground text-xs">
          hear it first · the words appear after
        </p>
      </section>
    );
  }
  return (
    <section
      className="flex flex-1 flex-col items-center justify-center gap-6 rounded-card border border-border bg-card p-8 text-center"
      data-stage="read"
      data-testid="worksheet-card"
    >
      <p className="text-lg text-muted-foreground">“{card.en}”</p>
      <div className="flex items-center gap-4">
        <p className="font-semibold text-5xl leading-tight tracking-wide">
          {card.jp}
        </p>
        <ListenButton text={card.rd} variant="chip" />
      </div>
      <RomajiLine card={card} />
      <div className="flex flex-wrap items-end justify-center gap-x-3 gap-y-4 pt-2">
        {chipsFor(card).map((chip) => (
          <WordChip chip={chip} key={`${chip.jp}-${chip.rd}`} />
        ))}
      </div>
      <p className="text-muted-foreground text-xs">tap any word for help</p>
      {card.note ? (
        <fieldset className="mt-2 rounded-card border border-border border-dashed px-4 py-2 text-left text-xs">
          <legend className="px-1 text-muted-foreground">sensei’s note</legend>
          <span>{card.note}</span>
        </fieldset>
      ) : null}
      <div className="mt-auto flex w-full items-center justify-between pt-6">
        <button
          className={
            isSaved
              ? "text-muted-foreground text-sm"
              : "text-sm underline underline-offset-4 transition-colors hover:text-foreground"
          }
          data-testid="worksheet-save"
          disabled={isSaved}
          onClick={onSave}
          type="button"
        >
          {isSaved ? "saved ✓" : "save phrase"}
        </button>
        <button
          className="rounded-card bg-primary px-5 py-2.5 font-medium text-primary-foreground text-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
          data-testid="worksheet-next"
          onClick={onNext}
          type="button"
        >
          next →
        </button>
      </div>
    </section>
  );
};

/* ── practice (recognition phase) ──────────────────────────────── */

/* One choice button; extracted so the handler is stable (noJsxPropsBind,
 * LevelChip pattern) · the inline arrow would re-bind on every render. */
const PracticeChoice = ({
  choice,
  dimmed,
  onPick,
}: {
  choice: LessonCard;
  dimmed: boolean;
  onPick: (choice: LessonCard) => void;
}) => {
  const onClick = useCallback(() => {
    onPick(choice);
  }, [choice, onPick]);
  return (
    <button
      className={
        dimmed
          ? "rounded-card border border-border px-6 py-4 text-2xl opacity-40"
          : "rounded-card border-2 border-border px-6 py-4 text-2xl transition-colors hover:border-primary/60"
      }
      data-testid={`practice-choice-${choice.jp}`}
      onClick={onClick}
      type="button"
    >
      {choice.jp}
    </button>
  );
};

/* Two kana faces, one sound. The saved cards, in save order; the
 * distractor is the next saved card (wraps), falling back to any deck
 * card that isn't the target so a single-save session still works. A
 * miss dims the wrong choice and asks for a retry · the retry IS the
 * lesson; no punishment, no score. */
const Practice = () => {
  const phase = usePhase();
  const { deck, onFinish, saved } = useWorksheet();
  const [pIndex, setPIndex] = useState(0);
  const [missed, setMissed] = useState(false);
  const targets = useMemo(
    () => saved.map((i) => deck.cards[i]).filter((c): c is LessonCard => !!c),
    [deck.cards, saved]
  );
  const target = targets[pIndex];
  const distractor =
    targets[(pIndex + 1) % targets.length] ??
    deck.cards.find((c) => c.jp !== target?.jp);
  const onPick = useCallback(
    (choice: LessonCard) => {
      if (!target) {
        return;
      }
      if (choice.jp !== target.jp) {
        setMissed(true);
        return;
      }
      if (pIndex < targets.length - 1) {
        setPIndex((i) => i + 1);
        setMissed(false);
        return;
      }
      log("lesson_complete", { firstTry: !missed, saved: targets.length });
      onFinish();
    },
    [missed, onFinish, pIndex, target, targets.length]
  );
  if (phase !== "practice") {
    return null;
  }
  if (!(target && distractor)) {
    return null;
  }
  const choices = [target, distractor];
  return (
    <section
      className="flex flex-1 flex-col items-center justify-center gap-8 rounded-card border border-border bg-card p-8"
      data-testid="worksheet-practice"
    >
      <p className="text-muted-foreground text-sm">
        hear it · which one did you save?
      </p>
      <ListenButton text={target.rd} variant="lg" />
      <div className="flex gap-4">
        {choices.map((choice) => (
          <PracticeChoice
            choice={choice}
            dimmed={missed && choice.jp !== target.jp}
            key={choice.jp}
            onPick={onPick}
          />
        ))}
      </div>
      {missed ? (
        <p className="text-muted-foreground text-xs">
          not that one · listen again and pick the other
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {pIndex + 1} of {targets.length}
      </p>
    </section>
  );
};

/* ── done ─────────────────────────────────────────────────────── */

const Done = () => {
  const phase = usePhase();
  const { saved, taps } = useWorksheet();
  if (phase !== "done") {
    return null;
  }
  return (
    <section
      className="flex flex-1 flex-col items-center justify-center gap-6 rounded-card border border-border bg-card p-8 text-center"
      data-testid="worksheet-done"
    >
      <p className="text-xl">{doneCopy(saved.length)}</p>
      <p className="text-muted-foreground text-sm">
        {taps} {taps === 1 ? "tap" : "taps"} of help · that’s how the kana stick
      </p>
      <Link
        className="rounded-card bg-primary px-6 py-2.5 font-medium text-primary-foreground text-sm transition-transform hover:scale-[1.02]"
        data-testid="worksheet-back-desk"
        to="/dashboard"
      >
        back to the desk
      </Link>
    </section>
  );
};

export const WorksheetCompound = Object.assign(Worksheet, {
  Bar,
  Card,
  Done,
  Practice,
});

export const __test__ = {
  kanaCellsFor,
  romajiForChip,
  romajiPartsForReading,
  romajiVisibleForCell,
  romajiVisibleForReading,
};
