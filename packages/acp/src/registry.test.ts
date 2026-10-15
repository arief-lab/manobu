/**
 * Registry contract tests — the guardrail for "adding the next agent CLI".
 *
 * Every new `AgentSpec` appended to `AGENT_REGISTRY` must keep `findAgent` /
 * `listAgents` deterministic and internally consistent. These tests encode
 * the invariants a new entry must satisfy, so a bad entry fails `bun test`
 * before it can break the router or the picker UI.
 */

import { describe, expect, it } from "bun:test";

import {
  type AgentSpec,
  type AgentTransport,
  DEFAULT_AGENT_ID,
  findAgent,
  listAgents,
} from "./registry";

const TRANSPORTS: readonly AgentTransport[] = ["acp", "direct-cli"];

function requireSpec(idOrCommand: string): AgentSpec {
  const spec = findAgent(idOrCommand);
  if (!spec) {
    throw new Error(`test fixture: unknown agent "${idOrCommand}"`);
  }
  return spec;
}

describe("findAgent", () => {
  it("resolves every registry id (derived — auto-covers new agents)", () => {
    for (const spec of listAgents()) {
      expect(findAgent(spec.id)?.id, `id ${spec.id}`).toBe(spec.id);
    }
  });

  it("resolves by command alias", () => {
    expect(findAgent("opencode")?.id).toBe("opencode");
    expect(findAgent("claude")?.id).toBe("claude-code");
    expect(findAgent("kilo")?.id).toBe("kilo-code");
    expect(findAgent("agy")?.id).toBe("antigravity");
  });

  it("returns null for unknown handles", () => {
    expect(findAgent("")).toBeNull();
    expect(findAgent("no-such-agent")).toBeNull();
    expect(findAgent("OPenCOde")).toBeNull(); // lookup is case-sensitive
  });
});

describe("listAgents", () => {
  it("is non-empty and stable in declaration order", () => {
    const agents = listAgents();
    expect(agents.length).toBeGreaterThan(0);
    expect(listAgents()).toBe(agents);
  });
});

describe("registry invariants (new-agent guardrails)", () => {
  const agents = listAgents();

  it("uses unique ids", () => {
    const ids = agents.map((agent) => agent.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses unique commands", () => {
    const commands = agents.map((agent) => agent.command);
    expect(new Set(commands).size).toBe(commands.length);
  });

  it("never lets one agent's id collide with another's command", () => {
    // A self-match (an agent's own id === its own command) is fine and common
    // (e.g. opencode). Only cross-agent ambiguity is a problem: `findAgent`
    // would resolve one handle to two different specs.
    const idToAgent = new Map(agents.map((agent) => [agent.id, agent]));
    for (const agent of agents) {
      const owner = idToAgent.get(agent.command);
      if (owner && owner !== agent) {
        throw new Error(
          `command "${agent.command}" collides with ${owner.id}'s id`
        );
      }
    }
  });

  it("carries complete, well-formed specs", () => {
    for (const agent of agents) {
      expect(TRANSPORTS, agent.id).toContain(agent.transport);
      expect(agent.displayName.length, agent.id).toBeGreaterThan(0);
      expect(typeof agent.launchPolicy.forwardMcp, agent.id).toBe("boolean");
      expect(typeof agent.launchPolicy.nonInteractive, agent.id).toBe(
        "boolean"
      );
      expect(typeof agent.launchPolicy.requiresAcpSubcommand, agent.id).toBe(
        "boolean"
      );
      // Every agent must be spawnable non-interactively: the bridge drives
      // stdio JSON-RPC (ACP) or single-shot `--print` (direct-cli) — never a
      // TTY prompt. A `false` entry is dead intent today and signals a
      // missing pty feature, exactly like a direct-cli agent with forwardMcp.
      expect(agent.launchPolicy.nonInteractive, agent.id).toBe(true);
      expect(typeof agent.capabilities.mcpHttp, agent.id).toBe("boolean");
      expect(typeof agent.capabilities.mcpSse, agent.id).toBe("boolean");
      expect(typeof agent.capabilities.mcpStdio, agent.id).toBe("boolean");
      expect(typeof agent.capabilities.streaming, agent.id).toBe("boolean");
    }
  });

  it("keeps direct-cli agents free of ACP-only config", () => {
    for (const agent of agents.filter(
      (entry) => entry.transport === "direct-cli"
    )) {
      // The direct-cli adapter spawns the binary bare (single-shot `--print`);
      // an `acp` subcommand or MCP attachment are ACP-transport concepts.
      expect(agent.launchPolicy.requiresAcpSubcommand, agent.id).toBe(false);
      expect(agent.launchPolicy.forwardMcp, agent.id).toBe(false);
    }
  });

  it("keeps the default agent resolvable and on the ACP transport", () => {
    const spec = requireSpec(DEFAULT_AGENT_ID);
    expect(spec.transport).toBe("acp");
  });
});
