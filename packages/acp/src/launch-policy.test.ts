/**
 * Launch-policy contract tests.
 *
 * `applyLaunchPolicy` is the single place that decides *how* an agent is
 * spawned (subcommand vs bare, MCP passthrough, cwd) and what data the
 * bridge carries (`model`, `mode`, `resume` — data, never argv). A new
 * registry entry must keep every contract below — the registry-wide loops
 * fail the moment a new agent breaks the shape.
 */

import { describe, expect, it } from "bun:test";

import { applyLaunchPolicy } from "./launch-policy";
import { type AgentSpec, findAgent, listAgents } from "./registry";

const JLPT_SERVER = {
  id: "jlpt-vocab",
  target: "npx jlpt-mcp@latest",
  transport: "stdio",
} as const;

function requireSpec(idOrCommand: string): AgentSpec {
  const spec = findAgent(idOrCommand);
  if (!spec) {
    throw new Error(`test fixture: unknown agent "${idOrCommand}"`);
  }
  return spec;
}

describe("applyLaunchPolicy", () => {
  it("derives argv from requiresAcpSubcommand for every registry agent", () => {
    for (const agent of listAgents()) {
      const spec = applyLaunchPolicy({ agent });
      expect(spec.args, agent.id).toEqual(
        agent.launchPolicy.requiresAcpSubcommand ? ["acp"] : []
      );
      expect(spec.command, agent.id).toBe(agent.command);
    }
  });

  it("defaults cwd to the caller's working directory", () => {
    const spec = applyLaunchPolicy({ agent: requireSpec("opencode") });
    expect(spec.cwd).toBe(process.cwd());
  });

  it("honors an explicit cwd override", () => {
    const spec = applyLaunchPolicy({
      agent: requireSpec("opencode"),
      cwd: "/tmp/manobu-test",
    });
    expect(spec.cwd).toBe("/tmp/manobu-test");
  });

  it("carries model/mode/resume as data, never argv", () => {
    const spec = applyLaunchPolicy({
      agent: requireSpec("opencode"),
      mode: "plan",
      model: "anthropic/claude-sonnet-4-5",
      resume: "session-123",
    });
    expect(spec.args).toEqual(["acp"]);
    expect(spec.mode).toBe("plan");
    expect(spec.model).toBe("anthropic/claude-sonnet-4-5");
    expect(spec.resume).toBe("session-123");
  });

  describe("MCP forwarding", () => {
    it("passes configured servers through when forwardMcp is true", () => {
      const spec = applyLaunchPolicy({
        agent: requireSpec("opencode"),
        mcpServers: [JLPT_SERVER],
      });
      expect(spec.forwardMcp).toBe(true);
      expect(spec.mcpServers).toEqual([JLPT_SERVER]);
    });

    it("drops servers for agents that cannot forward MCP", () => {
      const spec = applyLaunchPolicy({
        agent: requireSpec("antigravity"),
        mcpServers: [JLPT_SERVER],
      });
      expect(spec.forwardMcp).toBe(false);
      expect(spec.mcpServers).toEqual([]);
    });

    it("matches forwardMcp on the spec for every registry agent", () => {
      for (const agent of listAgents()) {
        const spec = applyLaunchPolicy({ agent });
        expect(spec.forwardMcp, agent.id).toBe(agent.launchPolicy.forwardMcp);
      }
    });
  });
});
