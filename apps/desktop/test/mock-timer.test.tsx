import { describe, expect, it } from "bun:test";
import { t } from "@manobu/ui/lib/copy";
import { renderToStaticMarkup } from "react-dom/server";
import { JlptMock } from "@/features/mock/jlpt-mock";

// TASK-169: the mock clock counts UP (elapsedSeconds), so the label must say
// "elapsed". These render the real component (not a source-text read,
// TASK-134) and pin the value the Timer feeds to the word it is shown under.
describe("JlptMock.Timer label matches what it measures", () => {
  const markup = renderToStaticMarkup(
    <JlptMock level="N5" questions={[]} source="mock">
      <JlptMock.Timer />
    </JlptMock>
  );

  it("renders the elapsed clock under an elapsed label", () => {
    // Initial elapsedSeconds is 0, so formatTimer(0) is "00:00".
    expect(markup).toContain("00:00");
    expect(markup).toContain("elapsed");
  });

  it("never claims the clock is counting down", () => {
    expect(markup).not.toContain("remaining");
  });
});

describe("mock copy deck", () => {
  it("formats the timer as elapsed with both placeholders", () => {
    expect(t("mock.timer", { mm: "12", ss: "34" })).toBe("⏱ 12:34 elapsed");
  });

  it("keeps the implementation note out of the learner helper", () => {
    expect(t("mock.helper")).toBe("Choose an answer to continue");
    expect(t("mock.helper")).not.toContain("opacity");
  });
});
