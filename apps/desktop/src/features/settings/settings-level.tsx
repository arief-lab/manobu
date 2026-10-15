import type { JlptLevel } from "@manobu/api-contract";
import { t } from "@manobu/ui/lib/copy";
import { useSyncExternalStore } from "react";
import {
  ensureLearnerLevelLoaded,
  JLPT_LEVELS,
  setLearnerLevel,
  subscribeLearnerLevel,
} from "@/lib/learner-level";

/*
 * Settings level picker (TASK-76): same store (lib/learner-level.ts) as
 * the first-run picker and the kanji grid tabs, same subscribe pattern,
 * pill row. The store is the single source of truth, so every
 * level-aware surface (drills, lessons, reviews, kanji) follows one
 * write. (The sidebar's LevelSelector this mirrored was retired with
 * AppShell — router audit 2026-09-14.)
 */

const subscribe = (notify: () => void) => subscribeLearnerLevel(notify);

export const LevelPicker = () => {
  const level = useSyncExternalStore(
    subscribe,
    ensureLearnerLevelLoaded,
    () => JLPT_LEVELS[0] as JlptLevel
  );
  const pick = (next: JlptLevel) => () => {
    setLearnerLevel(next);
  };
  return (
    <section
      aria-label={t("set.level.title")}
      className="flex flex-col gap-3"
      data-testid="settings-level-card"
    >
      <h2 className="font-semibold text-lg">{t("set.level.title")}</h2>
      <p className="text-muted-foreground text-sm">{t("set.level.body")}</p>
      <div className="flex flex-wrap gap-2">
        {JLPT_LEVELS.map((lvl) => (
          <button
            aria-pressed={lvl === level}
            className={
              lvl === level
                ? "min-h-11 rounded-card border-2 border-primary bg-card px-3 py-1 text-sm"
                : "min-h-11 rounded-card border-2 border-border bg-card px-3 py-1 text-muted-foreground text-sm hover:bg-muted"
            }
            data-level={lvl}
            data-testid={`settings-level-${lvl}`}
            key={lvl}
            onClick={pick(lvl)}
            type="button"
          >
            {lvl}
          </button>
        ))}
      </div>
    </section>
  );
};
