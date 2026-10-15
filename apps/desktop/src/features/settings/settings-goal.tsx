import { t } from "@manobu/ui/lib/copy";
import { useSyncExternalStore } from "react";
import {
  completeSetup,
  GOAL_LABEL,
  GOALS,
  type GoalId,
  getGoal,
  subscribeLearnerSetup,
} from "@/lib/learner-setup";

/*
 * Settings goal picker (TASK-76): the first-run page owns the initial
 * choice; this is the change-it-later surface. Same store
 * (lib/learner-setup.ts) · completeSetup(goal) writes the goal and keeps
 * setup_done true (it was already true if you're here), so the landing
 * redirect never sends an existing learner back through the picker.
 */

const subscribe = (notify: () => void) => subscribeLearnerSetup(notify);

export const GoalPicker = () => {
  const goal = useSyncExternalStore(subscribe, getGoal, () => null);
  const pick = (next: GoalId) => () => {
    completeSetup(next);
  };
  return (
    <section
      aria-label={t("set.goal.title")}
      className="flex flex-col gap-3"
      data-testid="settings-goal-card"
    >
      <h2 className="font-semibold text-lg">{t("set.goal.title")}</h2>
      <p className="text-muted-foreground text-sm">{t("set.goal.body")}</p>
      <div className="flex flex-wrap gap-2">
        {GOALS.map((g) => (
          <button
            aria-pressed={g === goal}
            className={
              g === goal
                ? "min-h-11 rounded-card border-2 border-primary bg-card px-3 py-1 text-sm"
                : "min-h-11 rounded-card border-2 border-border bg-card px-3 py-1 text-muted-foreground text-sm hover:bg-muted"
            }
            data-goal={g}
            data-testid={`settings-goal-${g}`}
            key={g}
            onClick={pick(g)}
            type="button"
          >
            {GOAL_LABEL[g]}
          </button>
        ))}
      </div>
      {goal === null ? (
        <p
          className="text-muted-foreground text-xs"
          data-testid="settings-goal-none"
        >
          No goal picked yet · the first-run page will ask next time you start a
          lesson.
        </p>
      ) : null}
    </section>
  );
};
