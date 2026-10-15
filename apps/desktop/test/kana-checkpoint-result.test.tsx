import { describe, expect, it } from "bun:test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JlptMock } from "@/features/mock/jlpt-mock";
import { KanaCheckpointResult } from "@/features/mock/kana-checkpoint-result";
import { evaluateKanaPaper, generateKanaPaper } from "@/lib/kana-instrument";

const queueHrefPattern =
  /data-testid="kana-checkpoint-queue"[^>]*href="([^"]+)"/;

const evaluationFor = (script: "hiragana" | "katakana", correct: boolean) => {
  const paper = generateKanaPaper(script, "checkpoint-test");
  const answers = new Map(
    paper.map((item) => [
      item.id,
      { correct, picked: correct ? "correct" : "wrong" },
    ])
  );
  return evaluateKanaPaper(paper, answers);
};

const result = () => evaluationFor("hiragana", false);

const withRouter = (children: ReactNode) => {
  const rootRoute = createRootRoute();
  const drillRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/drill",
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([drillRoute]),
  });
  return (
    <RouterContextProvider router={router}>{children}</RouterContextProvider>
  );
};

describe("KanaCheckpointResult", () => {
  it("keeps checkpoint source out of the mock score and plan", () => {
    const markup = renderToStaticMarkup(
      <JlptMock level="N5" questions={[]} source="checkpoint">
        <JlptMock.Score />
        <JlptMock.Plan />
      </JlptMock>
    );
    expect(markup).toBe("");
  });

  it("renders only a submitted checkpoint result", () => {
    const evaluation = result();
    expect(
      renderToStaticMarkup(
        <KanaCheckpointResult
          results={[{ evaluation, script: "hiragana" }]}
          source="mock"
          submitted
        />
      )
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <KanaCheckpointResult
          results={[{ evaluation, script: "hiragana" }]}
          source="checkpoint"
          submitted={false}
        />
      )
    ).toBe("");
  });

  it("renders pass/fail independently for each script", () => {
    const markup = renderToStaticMarkup(
      withRouter(
        <KanaCheckpointResult
          results={[
            { evaluation: evaluationFor("hiragana", true), script: "hiragana" },
            {
              evaluation: evaluationFor("katakana", false),
              script: "katakana",
            },
          ]}
          source="checkpoint"
          submitted
        />
      )
    );
    expect(markup).toContain('data-script="hiragana"');
    expect(markup).toContain('data-pass="true"');
    expect(markup).toContain('data-script="katakana"');
    expect(markup).toContain('data-pass="false"');
  });

  it("shows blocked groups, review rows, and no mock score claims", () => {
    const evaluation = result();
    const markup = renderToStaticMarkup(
      withRouter(
        <KanaCheckpointResult
          results={[{ evaluation, script: "hiragana" }]}
          source="checkpoint"
          submitted
        />
      )
    );
    expect(markup).toContain('data-testid="kana-checkpoint-result"');
    expect(markup).toContain('data-testid="kana-checkpoint-queue"');
    expect(markup).toContain('data-testid="kana-checkpoint-review"');
    expect(markup).toContain("gojuon:k");
    const queueHref = markup.match(queueHrefPattern)?.[1];
    expect(queueHref).toBeDefined();
    expect(decodeURIComponent(queueHref ?? "")).toContain("gojuon:k");
    const blockedGroups = evaluation.groups.filter(
      (group) => group.failedItemIds.length > 0
    ).length;
    expect(markup).toContain(`data-group-count="${blockedGroups}"`);
    expect(markup).not.toContain("CEFR");
    expect(markup).not.toContain("mock-plan");
    expect(markup).not.toContain("mock-section");
  });
});
