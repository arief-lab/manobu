import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { WorksheetCompound } from "@/features/lesson/worksheet";
import {
  deckForGoal,
  jlptDeckFromVocab,
  type LessonDeck,
  lessonVocabQueryOptions,
} from "@/lib/lesson-cards";

const lessonSearchSchema = z.object({
  level: z.enum(["N5", "N4", "N3", "N2", "N1"]).default("N5").catch("N5"),
  goal: z
    .enum(["travel", "jlpt", "anime", "work", "fun"])
    .default("travel")
    .catch("travel"),
});

// data: local-state for the curated goals (travel/anime/work decks ship
// with the bundle); the JLPT goal warms the vocab query — word/reading/
// meaning rows, the word-first deck's data source.
export const Route = createFileRoute("/lesson")({
  component: LessonPage,
  loaderDeps: ({ search: { goal, level } }) => ({ goal, level }),
  loader: ({ context: { queryClient }, deps: { goal, level } }) =>
    goal === "jlpt"
      ? queryClient.ensureQueryData(lessonVocabQueryOptions(level))
      : undefined,
  validateSearch: lessonSearchSchema,
});

const GOAL_LABEL: Record<string, string> = {
  anime: "Anime",
  fun: "Free Roam",
  jlpt: "JLPT",
  travel: "Travel",
  work: "Work",
};

/** "fun" is a motivation, not a curriculum — its deck is travel's (same
 * mapping as setup Begin + the desk hero). */
const deckFor = (
  goal: "travel" | "jlpt" | "anime" | "work" | "fun",
  vocabDeck: LessonDeck | null
): LessonDeck | null => {
  if (goal === "jlpt") {
    return vocabDeck;
  }
  return deckForGoal(goal === "fun" ? "travel" : goal);
};

function LessonPage() {
  const { goal, level } = Route.useSearch();
  const vocab = useQuery({
    ...lessonVocabQueryOptions(level),
    enabled: goal === "jlpt",
  });
  const deck = deckFor(goal, vocab.data ? jlptDeckFromVocab(vocab.data) : null);
  return (
    <WorksheetCompound deck={deck} goalLabel={GOAL_LABEL[goal] ?? "Travel"}>
      <WorksheetCompound.Bar />
      <WorksheetCompound.Card />
      <WorksheetCompound.Practice />
      <WorksheetCompound.Done />
    </WorksheetCompound>
  );
}
