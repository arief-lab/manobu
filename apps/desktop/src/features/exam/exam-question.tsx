import type {
  ExamAnswer,
  ExamComposedItem,
  ExamItem,
  ExamMode,
  ExamSectionState,
  ExamStimulus,
} from "@manobu/api-contract";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";
import { ensureTts, isTtsBootstrapped } from "@/lib/tts-init";
import { ListenButton } from "../../shared/listen-button";

const isInTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI__" in window;

export interface ExamQuestion {
  id: string;
  itemType?: ExamItem["itemType"];
  options: readonly string[];
  passage?: string | null;
  /** TASK-173.2 AC#2: the line the paper prints above the options. A real
   * paper prints the 大問 instruction once and then Japanese 小問 material, so
   * this is the item's stem and never its English prompt - and a real item with
   * no stem prints nothing rather than falling back. Every other mode asks in
   * English, so this is that prompt. Null only when there is no line to print. */
  prompt: string | null;
  /** TASK-141: the text to speak, present only on a listening item. It is the
   * input to client-side synthesis, not a reading aid. */
  speech?: string | null;
  stimuli: readonly ExamStimulus[];
}

export interface ActiveExamQuestion {
  index: number;
  question: ExamQuestion;
  total: number;
}

export const shortcutToOptionIndex = (key: string): number | null => {
  const normalized = key.toLowerCase();
  if (
    normalized === "1" ||
    normalized === "2" ||
    normalized === "3" ||
    normalized === "4"
  ) {
    return Number(normalized) - 1;
  }
  if (
    normalized === "a" ||
    normalized === "b" ||
    normalized === "c" ||
    normalized === "d"
  ) {
    return normalized.charCodeAt(0) - "a".charCodeAt(0);
  }
  return null;
};

export const questionFromComposedItem = (
  entry: ExamComposedItem,
  mode: ExamMode
): ExamQuestion => ({
  id: entry.item.id,
  itemType: entry.item.itemType,
  options: entry.item.options,
  passage: entry.item.passage,
  prompt: mode === "real" ? entry.item.stem : entry.item.prompt,
  speech: entry.item.speech,
  stimuli: entry.item.stimuli,
});

/**
 * The passages to read, in order. A paper written before the stimulus set fell
 * back to the single `passage` column, so that one still renders.
 */
export const questionStimuli = (
  question: Pick<ExamQuestion, "passage" | "stimuli">
): readonly string[] => {
  const passages = question.stimuli.map((stimulus) => stimulus.text);
  if (passages.length > 0) {
    return passages;
  }
  return question.passage ? [question.passage] : [];
};

export const answerIds = (answers: readonly ExamAnswer[]): Set<string> =>
  new Set(answers.map((answer) => answer.itemId));

export const activeQuestionIndex = (
  section: Pick<ExamSectionState, "answers" | "items"> | null | undefined
): number => {
  if (!section || section.items.length === 0) {
    return 0;
  }
  const answered = answerIds(section.answers);
  const firstUnanswered = section.items.findIndex(
    (entry) => !answered.has(entry.item.id)
  );
  return firstUnanswered < 0 ? section.items.length - 1 : firstUnanswered;
};

export const formatExamTimer = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

export const activeQuestionFor = (
  section: Pick<ExamSectionState, "answers" | "items"> | null | undefined,
  mode: ExamMode,
  preferredIndex?: number
): ActiveExamQuestion | null => {
  if (!section || section.items.length === 0) {
    return null;
  }
  const index =
    preferredIndex === undefined
      ? activeQuestionIndex(section)
      : Math.min(Math.max(preferredIndex, 0), section.items.length - 1);
  const entry = section.items[index];
  if (!entry) {
    return null;
  }
  return {
    index,
    question: questionFromComposedItem(entry, mode),
    total: section.items.length,
  };
};

/**
 * TASK-141 + TASK-154 + TASK-173.8.2: the listening control.
 *
 * The audio is synthesized on the client, because the models live in the
 * Tauri shell and the sidecar has no TTS. The item carries the text to speak
 * and `ListenButton` does the rest - it already speaks, plays, shows a speaking
 * state, and honours the user's voice and speed preferences.
 *
 * Three states, and the gate is PROACTIVE (173.8.2 AC#1): the control is never
 * rendered to a machine that has no voice. The boot-time `ensureTts` result
 * decides the first render; a `checking` mount only covers the window where
 * boot init has not settled yet, and it renders nothing rather than a fake
 * play. A speak attempt can still fail later (the engine dying mid-session),
 * and the reactive path reports that honestly with the unavailable line
 * everywhere (AC#5). The voice is downloaded on `/setup` (and in Settings),
 * never offered here: the exam plays it when it is present and says so when it
 * is not. A reading item with no speech text gets nothing at all, because a
 * reading question must never offer to speak a passage it was never asked
 * aloud - that is the listening-only rule the store enforces.
 */
type VoiceState = "control" | "checking" | "failed";

// Inside Tauri with no proven engine, `checking` holds the pane empty until
// `ensureTts` settles — the fake play is what 173.8.2 removes. Outside Tauri
// nothing can ever install, so the TASK-141 demo path stays reactive: a
// control that reports `failed` on the first failed speak.
const initialVoiceState = (): VoiceState => {
  if (isTtsBootstrapped() || !isInTauri()) {
    return "control";
  }
  return "checking";
};

/** Test seam (exam-voice-first-run.test.ts): the proactive gate's first-render
 * mapping is called directly — `renderToStaticMarkup` never runs effects, so
 * the dynamic half of the gate lives in this function's return value. */
export const __test__ = { initialVoiceState };

export const ExamSpeechControl = ({ text }: { text?: string | null }) => {
  const [voice, setVoice] = useState<VoiceState>(initialVoiceState);
  const resolveVoice = useCallback((ready: boolean) => {
    setVoice(ready ? "control" : "failed");
  }, []);
  useEffect(() => {
    // A new question re-reads readiness instead of inheriting the previous
    // question's failure, so moving off a dead voice and back does not leave a
    // stale complaint on screen.
    const state = initialVoiceState();
    setVoice(state);
    if (state === "checking") {
      // Boot init hasn't settled: resolve it now. A missing model fails the
      // init fast (a file check, not a load), so the report lands in ms.
      ensureTts().then(resolveVoice);
    }
  }, [resolveVoice]);
  const handleError = useCallback(() => {
    // The usual cause is an uninitialized engine whose model IS on disk
    // (downloaded on /setup or in Settings), so try to bring it up before
    // reporting. A still-failed init means the voice is simply absent.
    ensureTts().then(resolveVoice);
  }, [resolveVoice]);

  if (!text) {
    return null;
  }
  if (voice === "checking") {
    // Readiness unknown: render nothing rather than a play button that a
    // voice-less machine cannot use (173.8.2 AC#1).
    return null;
  }
  if (voice === "failed") {
    return (
      <p
        className="mt-2 text-muted-foreground text-xs"
        data-testid="exam-speech-unavailable"
      >
        Audio unavailable. Download the voice on the setup screen, then reopen
        this section. The script is in the review.
      </p>
    );
  }
  // One failure path is enough per question: a learner who stays on a broken
  // voice sees the report, not a button that re-throws on every click.
  return (
    <div className="mt-2" data-testid="exam-speech">
      <ListenButton onError={handleError} text={text} />
    </div>
  );
};

export interface ExamQuestionProps {
  disabled?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSelect?: (index: number) => void;
  question: ExamQuestion;
  selectedIndex?: number | null;
}

export function ExamQuestion({
  disabled = false,
  onKeyDown,
  onSelect,
  question,
  selectedIndex = null,
}: ExamQuestionProps) {
  const fieldId = useId().replaceAll(":", "");
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const index = Number(event.currentTarget.value);
      if (Number.isInteger(index)) {
        onSelect?.(index);
      }
    },
    [onSelect]
  );
  return (
    <fieldset
      aria-keyshortcuts="1 2 3 4 A B C D Enter"
      className="rounded-card border border-border bg-card p-4"
      data-question-id={question.id}
      data-testid="exam-question"
    >
      {question.prompt === null ? null : (
        <legend className="px-1 font-medium text-base">
          {question.prompt}
        </legend>
      )}
      <ExamSpeechControl text={question.speech} />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {question.options.map((option, index) => {
          const optionId = `${fieldId}-${index}`;
          return (
            <label
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-muted"
              htmlFor={optionId}
              key={`${optionId}-${option}`}
            >
              <input
                checked={selectedIndex === index}
                className="size-4 accent-primary"
                data-option-index={index}
                data-testid={`exam-option-${index}`}
                disabled={disabled || onSelect === undefined}
                id={optionId}
                name={`exam-question-${fieldId}`}
                onChange={handleChange}
                onKeyDown={onKeyDown}
                type="radio"
                value={index}
              />
              <span>
                {String.fromCharCode(65 + index)}. {option}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
