import { describe, expect, it } from "bun:test";
import { isChromeFreePath } from "@/shared/chrome-free";

describe("chrome-free route boundaries", () => {
  it("matches the exam route and its parameters", () => {
    expect(isChromeFreePath("/exam")).toBe(true);
    expect(isChromeFreePath("/exam/exam-1")).toBe(true);
  });

  // TASK-170: /review is a desk-facing practice surface, so it drops the
  // shared Header (whose only element was a bare "AI Chat" link that read as
  // a page title) and carries its own "← desk" pill like every other surface.
  it("matches the review desk", () => {
    expect(isChromeFreePath("/review")).toBe(true);
  });

  it("does not match lookalike paths", () => {
    expect(isChromeFreePath("/exambridge")).toBe(false);
    expect(isChromeFreePath("/examiner/exam-1")).toBe(false);
    expect(isChromeFreePath("/reviews")).toBe(false);
  });
});
