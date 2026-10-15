import type { JlptLevel } from "@manobu/api-contract";
import { t } from "@manobu/ui/lib/copy";
import { queryOptions } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ChangeEvent, useCallback } from "react";
import { z } from "zod";
import { JlptMock } from "@/features/mock/jlpt-mock";
import { grammarIdLevel, type Question } from "@/lib/mock";
import { offlinePaperCard } from "@/lib/paper-fallback";

const mockSearchSchema = z.object({
  // TASK-23.7: all five official levels · real JLPT allows bypass (no
  // prereq), so the filter surfaces N3/N2/N1 directly.
  filter: z
    .enum(["all", "N5", "N4", "N3", "N2", "N1"])
    .default("all")
    .catch("all"),
});

const mockQueryOptions = (filter: string) =>
  queryOptions({
    queryFn: () => Promise.resolve({ filter }),
    queryKey: ["mock", filter] as const,
    staleTime: 1000 * 30,
  });

export const SEED: readonly Question[] = [
  {
    id: "q1",
    prompt: "これは本__。",
    grammarId: "n5-desu-polite-copula",
    choiceIds: ["a", "b", "c", "d"],
    correctId: "a",
    choices: {
      a: "です",
      b: "だ",
      c: "でした",
      d: "ではありません",
    },
  },
  {
    id: "q2",
    prompt: "田中先生__学生ではありません。",
    grammarId: "n5-dewa-arimasen-negative-polite-copula",
    choiceIds: ["a", "b", "c", "d"],
    correctId: "a",
    choices: {
      a: "は",
      b: "に",
      c: "が",
      d: "を",
    },
  },
  {
    id: "q3",
    prompt: "きのう映画を__。",
    grammarId: "n5-past-ta-form",
    choiceIds: ["a", "b", "c", "d"],
    correctId: "c",
    choices: {
      a: "見ます",
      b: "見て",
      c: "見た",
      d: "見ない",
    },
  },
  // TASK-23.7: N3..N1 seeds so the new filter options surface real content.
  {
    id: "q4",
    prompt: "雨が降っている__、出かけた。",
    grammarId: "noni-although",
    choiceIds: ["a", "b", "c", "d"],
    correctId: "b",
    choices: {
      a: "ので",
      b: "にもかかわらず",
      c: "のに",
      d: "ことで",
    },
  },
  {
    id: "q5",
    prompt: "社長____、ご挨拶申し上げます。",
    grammarId: "n2-ni-atatte-occasion",
    choiceIds: ["a", "b", "c", "d"],
    correctId: "a",
    choices: {
      a: "にあたって",
      b: "によって",
      c: "において",
      d: "にとって",
    },
  },
  {
    id: "q6",
    prompt: "彼の努力____、成功はあり得なかった。",
    grammarId: "n1-wo-motte",
    choiceIds: ["a", "b", "c", "d"],
    correctId: "c",
    choices: {
      a: "をもとに",
      b: "をはじめ",
      c: "をもってしても",
      d: "をめぐって",
    },
  },
  // TASK-23.8 (doc-4 §5.2): reading (info retrieval + short passage,
  // Reader コンビニで reuse) + listening (TTS card) questions. The section
  // tags feed the TASK-23.7 sectional scoring.
  {
    choiceIds: ["a", "b", "c", "d"],
    choices: { a: "8時間", b: "12時間", c: "24時間", d: "48時間" },
    correctId: "c",
    grammarId: "reading-info-retrieval",
    id: "mock-reading-1",
    prompt: "コンビニは なん時間 営業ですか。",
    section: "reading",
  },
  {
    choiceIds: ["a", "b", "c", "d"],
    choices: { a: "パン", b: "おにぎり", c: "コーヒー", d: "弁当" },
    correctId: "b",
    grammarId: "reading-short-passage",
    id: "mock-reading-2",
    prompt: "私は まいにち コンビニで 何を 買いますか。",
    section: "reading",
  },
  {
    choiceIds: ["a", "b", "c", "d"],
    choices: {
      a: "新しい あかい くるまです",
      b: "新しい しろい くるまです",
      c: "ふるい あかい くるまです",
      d: "新しい あかい じてんしゃです",
    },
    correctId: "a",
    grammarId: "listening-detail",
    id: "mock-listening-1",
    prompt: "聞いてください · What is the car like?",
    section: "listening",
  },
];

/*
 * TASK-71.1: the hand-written jlpt-mock.lazy.tsx wrapper is gone · with
 * vite's tanstackRouter `autoCodeSplitting: true`, declaring the component
 * here still ships it in its own lazy chunk (the splitter hoists
 * component/errorComponent out of the static route module). One mental
 * model for laziness across the whole tree.
 */
export const Route = createFileRoute("/jlpt-mock")({
  component: JlptMockComponent,
  errorComponent: ({ error }) => (
    <div className="p-4 text-destructive text-sm">
      Failed to load mock: {error.message}
    </div>
  ),
  loaderDeps: ({ search: { filter } }) => ({ filter }),
  loader: ({ context: { queryClient }, deps: { filter } }) =>
    queryClient.ensureQueryData(mockQueryOptions(filter)),
  validateSearch: mockSearchSchema,
});

function JlptMockComponent() {
  const { filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const onChangeFilter = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      navigate({ search: { filter: e.target.value as typeof filter } });
    },
    [navigate]
  );
  const level = (filter === "all" ? "N5" : filter) as JlptLevel;
  // TASK-23.7: corpus ids carry no level prefix (noni-although, wo-motte…) ·
  // resolve each seed's level via grammarIdLevel (prefix tag + local seed
  // membership) instead of a substring match.
  const filtered =
    filter === "all"
      ? SEED
      : SEED.filter((q) => {
          const qLevel = grammarIdLevel(q.grammarId);
          return qLevel === null
            ? q.grammarId.startsWith(filter.toLowerCase())
            : qLevel === filter.toLowerCase();
        });
  const seedPaper = offlinePaperCard(level, filtered);
  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-xl">JLPT Mock</h1>
          <p className="text-muted-foreground text-sm">
            Internal surface · built-in seed questions, not a generated paper.
            The scored exam is the one the server assembles at /exam.
          </p>
          <p
            className="text-muted-foreground text-xs"
            data-testid="mock-seed-fallback"
          >
            {seedPaper.total > 0
              ? t("paper.offline.seed", {
                  total: seedPaper.total,
                  validated: seedPaper.validated,
                })
              : t("paper.offline.empty")}
          </p>
        </div>
        <select
          aria-label="Filter"
          className="rounded border-2 border-border px-2 py-1 text-sm"
          onChange={onChangeFilter}
          value={filter}
        >
          <option value="all">All</option>
          <option value="N5">N5</option>
          <option value="N4">N4</option>
          <option value="N3">N3</option>
          <option value="N2">N2</option>
          <option value="N1">N1</option>
        </select>
      </header>
      <JlptMock level={level} questions={filtered}>
        <JlptMock.Timer />
        <JlptMock.Progress />
        <JlptMock.ReadingCard />
        <JlptMock.ListeningCard />
        <JlptMock.Choices />
        <JlptMock.Next />
        <JlptMock.Score />
        <JlptMock.Plan />
        <JlptMock.SubmitFail />
      </JlptMock>
    </div>
  );
}
