import { describe, expect, it } from "bun:test";
import { segmentSentence } from "@/lib/reader-stories";
import { politenessScore } from "@/lib/roleplay";
import { ROLEPLAY_SCENES, sceneForKey } from "@/lib/roleplay-scenes";

/*
 * SCR-07 redesign (TASK-73) data contracts. The UI behavior is verified
 * in the browser; these guard the invariants the redesign rests on:
 * bounded scenes, earned contrast, and total clerk-line coverage.
 */

/** Everything that is not Japanese script (digits, latin punct, spaces). */
const NON_JAPANESE_RE = /[！!。.？?、，\s0-9a-zA-Z]/gu;
/** A romaji aid must be pure latin — raw kana leaking here is the
 * sokuon bug (iraっshaimase) the derivation fix cured. */
const ROMAJI_ONLY_RE = /^[a-z0-9 ]*$/i;

describe("roleplay scenes (TASK-73)", () => {
  it("every scene is a bounded 3-turn exchange (not endless)", () => {
    for (const scene of ROLEPLAY_SCENES) {
      expect(scene.lines.length).toBe(3);
    }
  });

  it("scene keys are unique and resolvable", () => {
    const keys = ROLEPLAY_SCENES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(sceneForKey(key).key).toBe(key);
    }
  });

  it("unknown scene key throws (no silent undefined)", () => {
    expect(() => sceneForKey("nope" as never)).toThrow(
      "unknown roleplay scene"
    );
  });

  it("every sensei form carries real politeness (contrast can fire)", () => {
    // The earned-contrast rule: the polish line appears only when the
    // learner's line scores below it. A 0-score sensei line could never
    // out-polite anything — the affordance would be dead.
    for (const scene of ROLEPLAY_SCENES) {
      for (const line of scene.lines) {
        expect(politenessScore(line.sensei)).toBeGreaterThan(0);
      }
    }
  });

  it("every clerk character lands in a tappable token (full coverage)", () => {
    for (const scene of ROLEPLAY_SCENES) {
      for (const line of scene.lines) {
        const tokens = segmentSentence(line.clerk);
        // Reassemble: non-punct tokens must cover every kana/kanji char.
        const covered = tokens
          .filter((t) => t.source !== "punct")
          .map((t) => t.text)
          .join("");
        const japanese = line.clerk.jp.replace(NON_JAPANESE_RE, "");
        for (const ch of japanese) {
          expect(covered).toContain(ch);
        }
      }
    }
  });

  it("no clerk romaji aid leaks raw kana (sokuon folded)", () => {
    for (const scene of ROLEPLAY_SCENES) {
      for (const line of scene.lines) {
        for (const token of segmentSentence(line.clerk)) {
          if (token.romaji) {
            expect(token.romaji).toMatch(ROMAJI_ONLY_RE);
          }
        }
      }
    }
  });
});
