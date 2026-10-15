import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Shared helper for source-contract tests (gsm-events, tts-surfaces,
 * settings-speech-models pattern): assert the wiring exists in source —
 * runtime is browser/Tauri-verified, not bun-test-verified.
 */
const root = resolve(import.meta.dirname, "..", "..", "src");

export const file = (rel: string): string =>
  readFileSync(resolve(root, rel), "utf8");
