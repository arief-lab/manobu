import type { ExamLevel, ExamMode } from "@manobu/api-contract";
import { t } from "@manobu/ui/lib/copy";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { getLearnerLevel, JLPT_LEVELS } from "@/lib/learner-level";
import { orpc } from "@/lib/orpc";
import { paperBuildNotice } from "@/lib/paper-notice";

// data: local-state — the launch form owns only its level/mode selection and a
// request/assemble the learner triggers by hand. Nothing is pre-fetched, so this
// route takes no loader (see apps/desktop/test/route-loaders.test.ts).
//
// TASK-173.11 (doc-25 D5): the scored paper was reachable only by asking the
// agent in /ai. This is the dashboard's Exam entry · it asks the SAME
// `exam.request` + `exam.assemble` pair `startExplicitPaper` drives from the
// composer (apps/desktop/src/routes/ai.tsx), minus the conversation: the server
// synthesizes the backing conversation when none is given
// (apps/server/src/services/exam-service.ts), so a learner who never opened /ai
// still gets a real paper. AC#2: the daily-vs-real intent is chosen here, not
// defaulted.
export const Route = createFileRoute("/exam/")({
  component: ExamLaunchComponent,
});

interface Intent {
  description: string;
  label: string;
  mode: ExamMode;
}

// AC#2 contrasts exactly two intents. `exam-conditions` is a timed variant of
// the real paper, not a third thing a first-time learner is deciding between, so
// it is left out of the entry rather than muddying the daily/real choice.
const INTENTS: readonly Intent[] = [
  {
    description: t("exam.launch.daily.desc"),
    label: t("exam.launch.daily.label"),
    mode: "shortened",
  },
  {
    description: t("exam.launch.real.desc"),
    label: t("exam.launch.real.label"),
    mode: "real",
  },
];

interface Notice {
  text: string;
  tone: "error" | "success" | "warning";
}

const TONE_CLASS: Record<Notice["tone"], string> = {
  error: "text-destructive",
  success: "text-success",
  warning: "text-warning",
};

const LevelButton = ({
  onSelect,
  option,
  selected,
}: {
  onSelect: (level: ExamLevel) => void;
  option: ExamLevel;
  selected: boolean;
}) => {
  const onPick = useCallback(() => {
    onSelect(option);
  }, [onSelect, option]);
  return (
    <button
      aria-pressed={selected}
      className="min-h-11 rounded-card border border-border px-4 py-1 text-sm hover:bg-muted aria-pressed:border-2 aria-pressed:border-primary"
      data-testid={`exam-launch-level-${option}`}
      onClick={onPick}
      type="button"
    >
      {option}
    </button>
  );
};

const IntentOption = ({
  intent,
  onSelect,
  selected,
}: {
  intent: Intent;
  onSelect: (mode: ExamMode) => void;
  selected: boolean;
}) => {
  const onPick = useCallback(() => {
    onSelect(intent.mode);
  }, [onSelect, intent.mode]);
  return (
    <label className="flex min-w-40 flex-1 cursor-pointer flex-col gap-1 rounded-card border border-border p-3 has-[:checked]:border-2 has-[:checked]:border-primary">
      <input
        checked={selected}
        className="sr-only"
        name="exam-launch-mode"
        onChange={onPick}
        type="radio"
        value={intent.mode}
      />
      <span className="font-medium text-sm">{intent.label}</span>
      <span className="text-muted-foreground text-xs">
        {intent.description}
      </span>
    </label>
  );
};

function ExamLaunchComponent() {
  const navigate = useNavigate();
  const [level, setLevel] = useState<ExamLevel>(getLearnerLevel());
  const [mode, setMode] = useState<ExamMode>("shortened");
  const [building, setBuilding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const launch = useCallback(async () => {
    setBuilding(true);
    setNotice(null);
    try {
      const receipt = await orpc.exam.request({ level, mode });
      const built = await orpc.exam.assemble({ examId: receipt.examId });
      // A ready paper opens the workspace; a short one stays here and says why,
      // so a `real` paper missing whole 大問 never lands the learner on a broken
      // pane (the same honesty `paperBuildNotice` gives the /ai composer).
      if (built.ready) {
        navigate({ params: { examId: built.examId }, to: "/exam/$examId" });
        return;
      }
      setNotice(paperBuildNotice(built));
    } catch {
      setNotice({ text: t("paper.build.failed"), tone: "error" });
    } finally {
      setBuilding(false);
    }
  }, [level, mode, navigate]);

  return (
    <div className="mx-auto flex w-full max-w-170 flex-col gap-6 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <Link
          className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
          data-testid="exam-launch-desk"
          to="/dashboard"
        >
          ← desk
        </Link>
        <h1 className="font-semibold text-lg">{t("exam.launch.title")}</h1>
      </header>
      <p className="text-muted-foreground text-sm">
        {t("exam.launch.subtitle")}
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-muted-foreground text-xs">
          {t("exam.launch.level")}
        </legend>
        <div className="flex flex-wrap gap-2" data-testid="exam-launch-levels">
          {JLPT_LEVELS.map((option) => (
            <LevelButton
              key={option}
              onSelect={setLevel}
              option={option}
              selected={level === option}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-muted-foreground text-xs">
          {t("exam.launch.intent")}
        </legend>
        <div className="flex flex-wrap gap-3" data-testid="exam-launch-intents">
          {INTENTS.map((intent) => (
            <IntentOption
              intent={intent}
              key={intent.mode}
              onSelect={setMode}
              selected={mode === intent.mode}
            />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-3">
        <button
          className="min-h-11 w-fit rounded-card bg-primary px-5 py-2 font-medium text-primary-foreground text-sm hover:opacity-90 disabled:opacity-50"
          data-testid="exam-launch-submit"
          disabled={building}
          onClick={launch}
          type="button"
        >
          {building ? t("exam.launch.running") : t("exam.launch.action")}
        </button>
        {notice === null ? null : (
          <p
            className={`text-sm ${TONE_CLASS[notice.tone]}`}
            data-testid="exam-launch-notice"
            role="status"
          >
            {notice.text}
          </p>
        )}
      </div>
    </div>
  );
}
