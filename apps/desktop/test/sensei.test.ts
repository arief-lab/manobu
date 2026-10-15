import { describe, expect, it } from "bun:test";

import type { AgentsOutput } from "@manobu/api-contract";

import { __test__ } from "@/lib/sensei";

const { deriveSensei } = __test__;

const agentsOutput = (
  entries: { id?: string; installed: boolean; name: string }[]
): AgentsOutput => ({
  agents: entries.map((entry) => ({
    command: entry.name.toLowerCase().split(" ")[0] ?? entry.name,
    displayName: entry.name,
    id: entry.id ?? entry.name.toLowerCase(),
    installed: entry.installed,
  })),
});

describe("deriveSensei", () => {
  it("is detecting while the probe is pending", () => {
    expect(
      deriveSensei({ data: undefined, error: false, pending: true })
    ).toEqual({ kind: "detecting" });
  });

  it("is offline when the sidecar is unreachable (no retry storm)", () => {
    expect(
      deriveSensei({ data: undefined, error: true, pending: false })
    ).toEqual({ kind: "offline" });
  });

  it("is cli-missing when every registry agent reports not installed", () => {
    const data = agentsOutput([{ installed: false, name: "Opencode" }]);
    expect(deriveSensei({ data, error: false, pending: false })).toEqual({
      kind: "cli-missing",
    });
  });

  it("names the FIRST installed agent when no preference is set", () => {
    const data = agentsOutput([
      { installed: false, name: "Opencode" },
      { id: "claude-code", installed: true, name: "Claude Code" },
      { id: "codex-cli", installed: true, name: "Codex" },
    ]);
    const state = deriveSensei({ data, error: false, pending: false });
    expect(state.kind).toBe("local-found");
    if (state.kind === "local-found") {
      expect(state.agent).toBe("Claude Code");
      expect(state.installed.map((agent) => agent.displayName)).toEqual([
        "Claude Code",
        "Codex",
      ]);
    }
  });

  it("honors a preferred installed id over registry order", () => {
    const data = agentsOutput([
      { id: "claude-code", installed: true, name: "Claude Code" },
      { id: "codex-cli", installed: true, name: "Codex" },
    ]);
    const state = deriveSensei({
      data,
      error: false,
      pending: false,
      preferredId: "codex-cli",
    });
    expect(state.kind).toBe("local-found");
    if (state.kind === "local-found") {
      expect(state.agent).toBe("Codex");
    }
  });

  it("falls back to registry order when the preference is stale", () => {
    const data = agentsOutput([
      { id: "claude-code", installed: true, name: "Claude Code" },
      { id: "codex-cli", installed: false, name: "Codex" },
    ]);
    const state = deriveSensei({
      data,
      error: false,
      pending: false,
      preferredId: "codex-cli",
    });
    expect(state.kind).toBe("local-found");
    if (state.kind === "local-found") {
      expect(state.agent).toBe("Claude Code");
    }
  });

  it("treats an empty catalog as cli-missing, not offline", () => {
    const data = agentsOutput([]);
    expect(deriveSensei({ data, error: false, pending: false })).toEqual({
      kind: "cli-missing",
    });
  });
});
