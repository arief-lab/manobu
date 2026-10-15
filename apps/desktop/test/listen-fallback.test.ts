import { describe, expect, it } from "bun:test";

import { __test__ } from "@/features/listen-type/listen-type";

/**
 * TASK-171: the expected no-voice state must not read as breakage.
 *
 * The 🔇 "muted speaker" glyph renders as a RED prohibition circle in the
 * system emoji font, so a learner who is fine to continue (pitch + type still
 * work) sees a destructive-looking signal. The line already renders in muted
 * text; the glyph was the only red. This calls the seam that builds the copy.
 */
const { audioMessage } = __test__;

describe("ListenType no-audio fallback (TASK-171)", () => {
  for (const state of ["no-speaker", "tts-not-ready"] as const) {
    it(`renders the expected ${state} state without the red prohibition glyph`, () => {
      const msg = audioMessage(state);
      expect(msg).not.toContain("🔇");
      expect(msg).not.toContain("🚫");
      // Still states the graceful fallback the learner can act on.
      expect(msg).toContain("pitch");
      expect(msg).toContain("Read & Type");
    });
  }
});
