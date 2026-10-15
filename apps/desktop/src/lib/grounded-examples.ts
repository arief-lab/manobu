/**
 * Grounded example-sentence fallback for the Lesson sensei hint
 * (TASK-23.4.4, doc-2 §5.2).
 *
 * When the Teacher AI fallback chain (local → BYOK → cache) can't produce an
 * example, the UI grounds it in the Tatoeba/Tanaka corpus shipped at
 * `data/sentences/sentences.jsonl` (147,705 pairs — TASK-23.4.1) instead of
 * letting a hallucinated `Example: 私は…` through.
 *
 * The full corpus is ~42 MB raw, so the UI imports only a curated N5 head
 * slice (short, level-appropriate sentences). Importing `@manobu/japanese`
 * JSON at module scope matches the `drill.tsx`/`listen.tsx` pattern.
 *
 * Every pick carries `tatoebaId` — the caller must cite it (Tatoeba CC BY
 * 2.0 / Tanaka PD attribution is embedded in the corpus itself).
 */

import sentencesHead from "@manobu/japanese/data/sentences/sentences-head.json";

export interface GroundedExample {
  en: string;
  jp: string;
  tatoebaId: number;
}

interface RawSentence {
  attribution?: string;
  en?: string;
  id?: number;
  jp?: string;
}

const SENTENCES = sentencesHead as readonly RawSentence[];

/**
 * Deterministic pseudo-random pick (FNV-1a over the seed string — same
 * scheme as the Rust sidecar's `random_example`). XOR is written as
 * addition/subtraction mod 2^64 because bigint bitwise operators are
 * lint-banned; over byte-sized values the mix is equivalent for our
 * purposes (seed → stable index, no cryptographic requirement).
 */
// TASK-39: TextEncoder instead of Node's Buffer — this module runs in the
// browser bundle (vite), where `Buffer` is undefined and /lesson crashed
// with "Buffer is not defined". TextEncoder yields the identical UTF-8
// bytes, so seeds stay behavior-identical to the Rust sidecar's scheme.
const SEED_ENCODER = new TextEncoder();

function pseudoRandomIndex(len: number, seed: string): number {
  const PRIME = 0x100000001b3n;
  const MASK64 = 2n ** 64n;
  let hash = 0xcbf29ce484222325n;
  for (const byte of SEED_ENCODER.encode(seed)) {
    hash = (((hash + BigInt(byte)) % MASK64) * PRIME) % MASK64;
  }
  return len === 0 ? 0 : Number(hash % BigInt(len));
}

/**
 * Return one grounded N5 example. `seed` varies the pick (e.g. the lesson
 * word or a day-stamp); the result is stable for a given seed. Never throws —
 * returns a static fallback pair when the corpus is unavailable.
 */
export function pickGroundedExample(seed = "lesson"): GroundedExample {
  const usable = SENTENCES.filter(
    (s) =>
      typeof s.jp === "string" &&
      typeof s.en === "string" &&
      typeof s.id === "number"
  );
  if (usable.length === 0) {
    return {
      en: "I eat breakfast every morning.",
      jp: "毎朝ご飯を食べます。",
      tatoebaId: 0,
    };
  }
  const pick = usable[pseudoRandomIndex(usable.length, seed)];
  return {
    en: pick.en as string,
    jp: pick.jp as string,
    tatoebaId: pick.id as number,
  };
}

export const __test__ = { SENTENCE_COUNT: SENTENCES.length };
