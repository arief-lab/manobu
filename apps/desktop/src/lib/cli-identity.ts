/*
 * CLI identity map for the agent registry (packages/acp/src/registry.ts).
 *
 * Logos are vendored Simple Icons SVG files (CC0-1.0, simpleicons.org)
 * under src/assets/cli/ — downloaded, not fetched at runtime (the app is
 * offline-first; a CDN dependency would break the rail on a plane, which
 * is exactly the scenario the rail advertises). The raw file is parsed
 * once at module load so the asset stays the single source of truth:
 * refresh a logo by re-downloading the .svg, never by editing code.
 *
 * Rendered as inline <path fill="currentColor"> (see CliBadge in
 * features/setup/setup.tsx), not <img>, so the glyph themes with the
 * rail text. Agents without a vendored logo (kilo-code, antigravity —
 * no Simple Icons slug) render their monogram instead.
 *
 * Keep ids in sync with the registry; unknown ids fall back to a
 * generated monogram at the call site (cliMonogram).
 */

import anthropicRaw from "@/assets/cli/anthropic.svg?raw";
import copilotRaw from "@/assets/cli/githubcopilot.svg?raw";
import geminiRaw from "@/assets/cli/googlegemini.svg?raw";
import openaiRaw from "@/assets/cli/openai.svg?raw";
import opencodeRaw from "@/assets/cli/opencode.svg?raw";

const PATH_D = /<path d="([^"]+)"/;

/** Extract the `d` attribute from a single-path Simple Icons SVG. */
const pathDataFrom = (svg: string): string => {
  const match = PATH_D.exec(svg);
  if (!match) {
    throw new Error("cli-identity: vendored SVG has no single <path d=…>");
  }
  return match[1];
};

interface CliIdentity {
  /** evenodd needed for the OpenCode square-with-hole glyph. */
  evenOdd?: boolean;
  id: string;
  /** Simple Icons path data (viewBox 0 0 24 24), if vendored. */
  path?: string;
}

const CLI_IDENTITIES: readonly CliIdentity[] = [
  {
    evenOdd: true,
    id: "opencode",
    path: pathDataFrom(opencodeRaw),
  },
  { id: "claude-code", path: pathDataFrom(anthropicRaw) },
  { id: "gemini-cli", path: pathDataFrom(geminiRaw) },
  { id: "codex-cli", path: pathDataFrom(openaiRaw) },
  { id: "gh-copilot", path: pathDataFrom(copilotRaw) },
  { id: "kilo-code" },
  { id: "antigravity" },
] as const;

export const cliIdentityFor = (id: string): CliIdentity | undefined =>
  CLI_IDENTITIES.find((entry) => entry.id === id);

const WORD_SPLIT = /[\s(]+/;

/** Fallback glyph: initials of the display name's words, max 2 chars. */
export const cliMonogram = (displayName: string): string => {
  const words = displayName.split(WORD_SPLIT).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0] ?? "");
  return letters.join("").toUpperCase();
};
