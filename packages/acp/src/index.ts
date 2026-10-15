/**
 * @manobu/acp — native ACP session engine surface (TASK-80.1/80.2).
 *
 * The provider-era bridge (`getAcpModel` / `AcpModelResource` /
 * `acpTools` / the AI-SDK model layer, built on `@mcpc-tech/acp-ai-provider`)
 * was deleted in TASK-80.6: the native engine in `session.ts`
 * (`SessionController` over `@agentclientprotocol/sdk`'s `ClientSideConnection`)
 * is now the ONLY agent spawn path. This file keeps the registry +
 * `$PATH` discovery helpers every layer still consumes:
 *
 * - `resolveSpawnTarget` — canonical `AgentSpec` resolution for the warm
 *   session pool (`apps/server/src/context.ts`).
 * - `listAgentCandidates` / `AgentCandidate` — `$PATH` probing for the
 *   agent picker (`GET /agents`) and boot diagnostics.
 *
 * The direct-cli transport (agy, single-shot `--print`) rides the
 * `DirectCliSession` facade (`direct-cli-session.ts`), not this file.
 */

import { existsSync, statSync } from "node:fs";
import { posix, win32 } from "node:path";

import {
  type AgentSpec,
  DEFAULT_AGENT_ID,
  findAgent,
  listAgents,
} from "./registry";

/** Metadata for one ACP agent CLI discovered on `$PATH`. */
export interface AgentCandidate {
  description: string;
  name: string;
  path: string;
}

/**
 * Resolve which agent to spawn, given the optional override.
 *
 * Precedence:
 *   1. `bin` argument — registry lookup by `id` or `command` (may be a
 *      registry id, command basename, or literal path).
 *   2. `process.env.ACP_AGENT_BIN` — same lookup.
 *   3. `DEFAULT_AGENT_ID` if its `command` is on `$PATH`.
 *   4. First registry entry whose `command` is on `$PATH`.
 *   5. Throw (no installed ACP-speaking CLI).
 *
 * Unrecognized handles spawn as a generic ACP agent with conservative
 * defaults so users who set `ACP_AGENT_BIN=my-custom-fork` aren't stranded.
 *
 * Exported so callers (e.g. `apps/server`'s session pool) can compute the
 * canonical `AgentSpec.id` for pooling without spawning first.
 */
export function resolveSpawnTarget(bin: string | undefined): AgentSpec {
  const explicit = bin ?? process.env.ACP_AGENT_BIN;

  if (explicit) {
    const match = findAgent(explicit);
    if (match) {
      return match;
    }
    return makeFallbackSpec(explicit);
  }

  // Prefer the default agent if it's installed; otherwise pick any
  // installed registry entry. Avoids surprises when multiple ACP CLIs
  // happen to be on $PATH.
  const defaultSpec = findAgent(DEFAULT_AGENT_ID);
  if (
    defaultSpec &&
    which(defaultSpec.command, process.env.PATH ?? "") !== null
  ) {
    return defaultSpec;
  }

  const [installedFirst] = listAgentCandidates();
  if (!installedFirst) {
    throw new Error(
      "No agent CLI found on PATH and ACP_AGENT_BIN is unset. Install one of: " +
        listAgents()
          .map((s) => s.id)
          .join(", ")
    );
  }
  const spec = findAgent(installedFirst.name);
  if (!spec) {
    throw new Error(
      `Could not resolve registry entry for installed binary "${installedFirst.name}"; this is a registry bug.`
    );
  }
  return spec;
}

function makeFallbackSpec(bin: string): AgentSpec {
  return {
    capabilities: {
      mcpHttp: false,
      mcpSse: false,
      mcpStdio: false,
      streaming: false,
    },
    command: bin,
    displayName: bin,
    id: bin,
    launchPolicy: {
      forwardMcp: true,
      nonInteractive: true,
      requiresAcpSubcommand: true,
    },
    transport: "acp",
  };
}

/**
 * `PATHEXT` when the environment does not carry one: the four extensions a
 * Windows shell resolves for a bare command name.
 */
const WIN_PATH_EXT_DEFAULT = [".exe", ".cmd", ".bat", ".com"];

/** Candidate name suffixes for a bare command, in resolution order. */
function winCommandSuffixes(pathExt: string | undefined): string[] {
  const extensions = (pathExt ?? "")
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  const resolved = extensions.length > 0 ? extensions : WIN_PATH_EXT_DEFAULT;
  return resolved.map((extension) =>
    extension.startsWith(".") ? extension : `.${extension}`
  );
}

/**
 * Every path `which` will probe for `bin`, in resolution order.
 *
 * Windows (TASK-177) is a different filesystem contract in three places, and
 * each one alone makes every agent look uninstalled: entries are `;`
 * separated, a bare `opencode` is not a file (the real one is
 * `opencode.exe`/`.cmd`/`.bat`, listed by `PATHEXT`), and `/`-joined paths are
 * not what the API returns. This is the pure half of the walk, so the win32
 * shape is pinned from a Linux checkout; `which` below does the probing.
 */
export function pathCandidates(
  bin: string,
  pathEnv: string,
  platform: NodeJS.Platform = process.platform,
  pathExt: string | undefined = process.env.PATHEXT
): string[] {
  const isWin = platform === "win32";
  const join = isWin ? win32.join : posix.join;
  const suffixes = isWin ? ["", ...winCommandSuffixes(pathExt)] : [""];
  const candidates: string[] = [];
  for (const dir of pathEnv.split(isWin ? ";" : ":").filter(Boolean)) {
    for (const suffix of suffixes) {
      candidates.push(join(dir, `${bin}${suffix}`));
    }
  }
  return candidates;
}

/**
 * Lightweight `$PATH` walk. We avoid pulling in `which` as a dep — files
 * we can read that aren't directories are accepted as the resolved path.
 */
function which(bin: string, pathEnv: string): string | null {
  for (const candidate of pathCandidates(bin, pathEnv)) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // file not present in this dir, keep looking
    }
  }
  return null;
}

/** Probe `$PATH` for agent CLIs based on the registry's `command` (ACP and direct-cli alike). */
export function listAgentCandidates(): AgentCandidate[] {
  const pathEnv = process.env.PATH ?? "";
  const out: AgentCandidate[] = [];
  for (const spec of listAgents()) {
    const path = which(spec.command, pathEnv);
    if (path) {
      out.push({ description: spec.displayName, name: spec.command, path });
    }
  }
  return out;
}
