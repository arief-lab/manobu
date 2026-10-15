import { t } from "@manobu/ui/lib/copy";
import { Link } from "@tanstack/react-router";
import { drillSearchForSelection } from "@/lib/drill-search";
import type { KanaScript } from "@/lib/kana-checkpoint";
import type { KanaEvaluation } from "@/lib/kana-instrument";

export interface KanaCheckpointScriptResult {
  evaluation: KanaEvaluation;
  script: KanaScript;
}

const drillKindForScript = (script: KanaScript): "gojuon" | "katakana" =>
  script === "hiragana" ? "gojuon" : "katakana";

interface KanaCheckpointResultProps {
  results: readonly KanaCheckpointScriptResult[];
  source: "mock" | "checkpoint";
  submitted: boolean;
}

const failedCells = (evaluation: KanaEvaluation): string[] =>
  evaluation.review.filter((row) => !row.isCorrect).map((row) => row.item.char);

export function KanaCheckpointResult({
  results,
  source,
  submitted,
}: KanaCheckpointResultProps) {
  if (!submitted || source !== "checkpoint") {
    return null;
  }
  return (
    <section
      aria-label="Kana checkpoint result"
      className="flex flex-col gap-3"
      data-source={source}
      data-testid="kana-checkpoint-result"
    >
      {results.map(({ evaluation, script }) => {
        const groups = evaluation.groups.filter(
          (group) => group.failedItemIds.length > 0
        );
        const cells = failedCells(evaluation);
        return (
          <article
            className="rounded-card border-2 border-border p-3"
            data-pass={evaluation.passed}
            data-script={script}
            key={script}
          >
            <h2 className="font-semibold">
              {script} ·{" "}
              {t(
                evaluation.passed
                  ? "kana.checkpoint.pass"
                  : "kana.checkpoint.fail",
                { script }
              )}
            </h2>
            <p className="mt-1 text-sm" data-testid="kana-checkpoint-score">
              {evaluation.score}/{evaluation.total} ·{" "}
              {Math.round(evaluation.pct)}%
            </p>
            <ul
              className="mt-2 flex flex-col gap-2"
              data-testid="kana-checkpoint-groups"
            >
              {groups.map((group) => (
                <li key={group.key}>
                  <p className="text-sm">
                    {t("kana.checkpoint.group", { group: group.key })}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {group.correct}/{group.total} · {group.failedItemIds.length}{" "}
                    missed
                  </p>
                  <ul className="list-disc pl-5 text-sm">
                    {evaluation.review
                      .filter(
                        (row) =>
                          row.groupKey === group.key &&
                          group.failedItemIds.includes(row.item.id)
                      )
                      .map((row) => (
                        <li key={row.item.id}>
                          {row.item.char} · {row.correct} · {row.groupKey}
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
            <Link
              className="mt-3 inline-flex min-h-11 items-center rounded-card border-2 border-border px-3 py-1 text-sm"
              data-group-count={groups.length}
              data-testid="kana-checkpoint-queue"
              search={drillSearchForSelection(
                {
                  cell: cells,
                  group: groups.map((group) => group.key),
                },
                drillKindForScript(script)
              )}
              to="/drill"
            >
              {t("kana.checkpoint.queue")}
            </Link>
            <h3 className="mt-4 font-semibold">
              {t("kana.result.review.title")}
            </h3>
            <ul
              className="mt-2 flex flex-col gap-1"
              data-testid="kana-checkpoint-review"
            >
              {evaluation.review.map((row) => (
                <li className="text-sm" key={row.item.id}>
                  {row.item.char} · {row.picked ?? "missed"} · {row.correct} ·{" "}
                  {row.groupKey}
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </section>
  );
}
