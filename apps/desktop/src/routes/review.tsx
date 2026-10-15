import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { z } from "zod";
import { ReviewQueue } from "@/features/mock/review-queue";
import { useSettingsStore } from "@/hooks/use-settings-store";
import { cardsDueQueryOptions, useCardsDue, useGradeCard } from "@/lib/cards";
import {
  gradeRequest,
  type ReviewCard,
  reviewCardFromDueCard,
} from "@/lib/review";

/* TASK-155 decision B: the server caps the queue at 20 rows
 * (apps/server/src/rpc.ts:108 `.limit(20)`), so a larger choice could only
 * ever be a lie about what this session will show. */
const MAX_BATCH = 20;

const BATCH_CHOICES: readonly number[] = [5, 10, MAX_BATCH];

const reviewSearchSchema = z.object({
  batch: z.coerce
    .number()
    .min(1)
    .max(MAX_BATCH)
    .default(MAX_BATCH)
    .catch(MAX_BATCH),
});

export const Route = createFileRoute("/review")({
  component: ReviewComponent,
  errorComponent: ({ error }) => (
    <div className="p-4 text-destructive text-sm">
      Failed to load review queue: {error.message}
    </div>
  ),
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(cardsDueQueryOptions),
  validateSearch: reviewSearchSchema,
});

function ReviewComponent() {
  const { batch } = Route.useSearch();
  const navigate = Route.useNavigate();
  /* 2026-09-14 state audit: the desk used to hardcode R ≤ 90% and hide
   * D/S always, while Settings owned retention + the FSRS-advanced
   * toggle. Both now flow from the one persisted store (hooks/
   * use-settings-store.ts): the slider moves the header AND the grade
   * previews together, the toggle shows D/S on the card. Batch stays a
   * per-desk URL control — it is a "this session" choice, not a stored
   * preference (the old store field for it was dead and is gone). */
  const settings = useSettingsStore();
  const onChangeBatch = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      navigate({ search: { batch: Number(e.target.value) } });
    },
    [navigate]
  );
  /* TASK-155: the desk serves the same query the dashboard tile counts
   * (lib/cards.ts `cardsDueQueryOptions`), so the two cannot disagree
   * about what is due. The full fetched queue goes to the compound and
   * `batchSize` slices it; the counts the desk states come from the same
   * response rather than from that slice (TASK-165). */
  const { data } = useCardsDue();
  const cards = useMemo(
    () => (data?.cards ?? []).map(reviewCardFromDueCard),
    [data]
  );
  /* TASK-165: what the desk states about the queue comes from the response's
   * counts, never from the rows this page happened to carry. `cards` is a
   * 20-row page; the counts are the queue and the deck. */
  const deckCount = data?.deckCount ?? 0;
  const dueCount = data?.dueCount ?? 0;
  const nextDue = data?.nextDue ?? null;
  /* TASK-155 decision A: the grade leaves the browser. `mutate` refetches
   * ["cards","due"] on success, which is what advances the desk: the head
   * card the learner just rated is the sidecar's to move, not ours to skip
   * with a local index. `pending` gates the buttons across the round trip,
   * while the stale list still shows the card that was just rated. */
  const gradeCard = useGradeCard();
  /* TASK-166: the retention travels with the grade. It lives in this store, so
   * the write cannot see it otherwise, and every setting other than 0.9 made
   * the interval on the button a number the card would not get. */
  const onGrade = useCallback(
    (g: 1 | 2 | 3 | 4, card: ReviewCard) => {
      gradeCard.mutate(gradeRequest(card, g, settings.retention));
    },
    [gradeCard.mutate, settings.retention]
  );
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        {/* The desk tile lands here, so the surface carries its own return
         * pill (TASK-170): the shared Header it used to inherit showed only
         * a bare "AI Chat" link where a page title belongs, and it navigated
         * away rather than back. /review is now chrome-free. */}
        <Link
          className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
          data-testid="review-bar-desk"
          to="/dashboard"
        >
          ← desk
        </Link>
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground text-sm">Batch: {batch}</p>
          <select
            aria-label="Batch size"
            className="rounded border-2 border-border px-2 py-1 text-sm"
            onChange={onChangeBatch}
            value={String(batch)}
          >
            {BATCH_CHOICES.map((size) => (
              <option key={size} value={String(size)}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ReviewQueue
        batchSize={batch}
        cards={cards}
        deckCount={deckCount}
        desiredRetention={settings.retention}
        dueCount={dueCount}
        gradeFailed={gradeCard.isError}
        nextDue={nextDue}
        onGrade={onGrade}
        pending={gradeCard.isPending}
        showAdvanced={settings.fsrsAdvanced}
      >
        <ReviewQueue.Header />
        <ReviewQueue.Batch />
        <ReviewQueue.Card />
        <ReviewQueue.LastGraded />
        <ReviewQueue.Grades />
        <ReviewQueue.Empty />
      </ReviewQueue>
    </div>
  );
}
