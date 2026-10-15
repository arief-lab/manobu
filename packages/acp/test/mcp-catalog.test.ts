import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import {
  isMcpCatalog,
  negotiateMcpServers,
  parseMcpCatalog,
  parseMcpServers,
  resolveMcpServers,
  toMcpServer,
} from "../src/mcp";

/**
 * TASK-22 Tier C — MCP catalog adoption (AionUi `IMcpServer[]` analogue).
 *
 * The catalog file is the single source of truth for MCP server
 * declarations; the env literal survives as an override. A corrupt config
 * must never take sessions down (same rule as the env parser).
 */

// TASK-51 AC3: the corrupt-catalog tests intentionally drive the module's
// designed-failure warnings. Re-print them with a [fixture] tag so CI logs
// and human skims never mistake them for real failures.
const realWarn = console.warn;
const warningBuffer: string[] = [];
beforeEach(() => {
  console.warn = (...args: unknown[]) => {
    warningBuffer.push(args.map(String).join(" "));
  };
});
afterAll(() => {
  console.warn = realWarn;
  for (const line of warningBuffer) {
    console.warn(`[fixture] ${line}`);
  }
});

describe("parseMcpCatalog", () => {
  it("parses a valid catalog with mixed transports", () => {
    const catalog = parseMcpCatalog(
      JSON.stringify({
        servers: [
          {
            enabled: true,
            id: "jlpt-vocab",
            target: "/usr/bin/jlpt-mcp",
            transport: "stdio",
          },
          {
            enabled: false,
            id: "dict-remote",
            target: "http://localhost:3001/mcp",
            transport: "http",
          },
        ],
        version: 1,
      })
    );
    expect(catalog.version).toBe(1);
    expect(catalog.servers).toHaveLength(2);
  });

  it("returns an empty catalog for corrupt JSON (never throws)", () => {
    const catalog = parseMcpCatalog("{not json");
    expect(catalog.servers).toEqual([]);
    expect(catalog.version).toBe(1);
  });

  it("rejects wrong shapes silently", () => {
    expect(
      parseMcpCatalog(JSON.stringify({ servers: [], version: 2 })).servers
    ).toEqual([]);
    expect(
      parseMcpCatalog(JSON.stringify({ servers: "nope", version: 1 })).servers
    ).toEqual([]);
    expect(
      parseMcpCatalog(
        JSON.stringify({
          servers: [
            { enabled: true, id: "x", target: "t", transport: "pigeon" },
          ],
          version: 1,
        })
      ).servers
    ).toEqual([]);
    expect(parseMcpCatalog(null).servers).toEqual([]);
    expect(parseMcpCatalog("").servers).toEqual([]);
  });

  it("isMcpCatalog discriminates correctly", () => {
    expect(
      isMcpCatalog({
        servers: [{ enabled: true, id: "a", target: "b", transport: "sse" }],
        version: 1,
      })
    ).toBe(true);
    expect(isMcpCatalog(null)).toBe(false);
    expect(isMcpCatalog({ version: 1 })).toBe(false);
  });
});

describe("resolveMcpServers", () => {
  it("prefers enabled catalog entries over the env literal", () => {
    const catalog = {
      servers: [
        {
          enabled: true,
          id: "file-server",
          target: "/bin/x",
          transport: "stdio" as const,
        },
        {
          enabled: false,
          id: "off",
          target: "/bin/y",
          transport: "stdio" as const,
        },
      ],
      version: 1,
    };
    const resolved = resolveMcpServers(catalog, "env-server:stdio:/bin/z");
    expect(resolved).toEqual([
      { id: "file-server", target: "/bin/x", transport: "stdio" },
    ]);
  });

  it("falls back to the env literal when no catalog entries are enabled", () => {
    const resolved = resolveMcpServers(
      { servers: [], version: 1 },
      "env-server:stdio:/bin/z"
    );
    expect(resolved).toEqual([
      { id: "env-server", target: "/bin/z", transport: "stdio" },
    ]);
  });
});

describe("negotiateMcpServers http/sse passthrough (Tier C2)", () => {
  const caps = { http: true, sse: true, stdio: true };

  it("attaches http and sse servers when the agent advertises them", () => {
    const result = negotiateMcpServers(
      [
        {
          id: "remote",
          target: "http://localhost:3001/mcp",
          transport: "http",
        },
        {
          id: "sse-srv",
          target: "http://localhost:3002/sse",
          transport: "sse",
        },
        { id: "local", target: "/bin/jlpt-mcp", transport: "stdio" },
      ],
      caps
    );
    expect(result.attached).toHaveLength(3);
    expect(result.skipped).toEqual([]);
  });

  it("warn-skips http servers when the agent lacks the capability", () => {
    const result = negotiateMcpServers(
      [
        {
          id: "remote",
          target: "http://localhost:3001/mcp",
          transport: "http",
        },
      ],
      { http: false, sse: true, stdio: true }
    );
    expect(result.attached).toEqual([]);
    expect(result.skipped[0]?.reason).toContain("http");
  });

  it("skips stdio servers with empty commands", () => {
    const result = negotiateMcpServers(
      [{ id: "bad", target: "   ", transport: "stdio" }],
      caps
    );
    expect(result.attached).toEqual([]);
    expect(result.skipped[0]?.reason).toContain("empty command");
  });
});

describe("per-server env (TASK-96)", () => {
  it("parses the pipe suffix into a named map", () => {
    const [server] = parseMcpServers(
      "jlpt-vocab:stdio:/bin/jlpt-mcp|JLPT_MCP_DEBUG=1;LANG=ja_JP.UTF-8"
    );
    expect(server).toEqual({
      env: { JLPT_MCP_DEBUG: "1", LANG: "ja_JP.UTF-8" },
      id: "jlpt-vocab",
      target: "/bin/jlpt-mcp",
      transport: "stdio",
    });
  });

  it("keeps colons and spaces in the target, which the env suffix must not steal", () => {
    const servers = parseMcpServers(
      "notes:http:http://localhost:3001/mcp,local:stdio:npx jlpt-mcp@latest|X=1"
    );
    expect(servers).toEqual([
      { id: "notes", target: "http://localhost:3001/mcp", transport: "http" },
      {
        env: { X: "1" },
        id: "local",
        target: "npx jlpt-mcp@latest",
        transport: "stdio",
      },
    ]);
  });

  it("warn-drops a malformed pair instead of the whole server", () => {
    const before = warningBuffer.length;
    const [server] = parseMcpServers(
      "jlpt:stdio:/bin/jlpt-mcp|9BAD=1;OK=2;NOEQUALS;PIPE=has|inside"
    );
    expect(server?.env).toEqual({ OK: "2" });
    expect(warningBuffer.slice(before).join("\n")).toContain("9BAD=1");
  });

  it("leaves env off the object entirely when no suffix is present", () => {
    expect(parseMcpServers("jlpt:stdio:/bin/jlpt-mcp")).toEqual([
      { id: "jlpt", target: "/bin/jlpt-mcp", transport: "stdio" },
    ]);
    expect(parseMcpServers("jlpt:stdio:/bin/jlpt-mcp|")).toEqual([
      { id: "jlpt", target: "/bin/jlpt-mcp", transport: "stdio" },
    ]);
  });

  it("maps stdio env onto name-sorted ACP EnvVariable pairs", () => {
    const config = toMcpServer({
      env: { JLPT_MCP_DEBUG: "1", ZOO: "2" },
      id: "jlpt",
      target: "/bin/jlpt-mcp --verbose",
      transport: "stdio",
    });
    expect(config).toEqual({
      args: ["--verbose"],
      command: "/bin/jlpt-mcp",
      env: [
        { name: "JLPT_MCP_DEBUG", value: "1" },
        { name: "ZOO", value: "2" },
      ],
      name: "jlpt",
    });
  });

  /**
   * TASK-177: a per-machine Windows install puts the bundled sidecar under
   * `C:\Program Files\…`, and the plain whitespace split turned that into the
   * command `C:\Program`. The desktop shell quotes such a target; the split has
   * to honor the quote or the vocab tools vanish with no error.
   */
  it("reads a quoted stdio command with spaces as one command", () => {
    const config = toMcpServer({
      id: "jlpt",
      target: '"C:\\Program Files\\manobu\\jlpt-mcp.exe" --verbose',
      transport: "stdio",
    });
    expect(config).toEqual({
      args: ["--verbose"],
      command: "C:\\Program Files\\manobu\\jlpt-mcp.exe",
      env: [],
      name: "jlpt",
    });
    // Quote with nothing after it: no args, and the quotes are not kept.
    expect(
      toMcpServer({ id: "jlpt", target: '"/bin/my mcp"', transport: "stdio" })
    ).toEqual({ args: [], command: "/bin/my mcp", env: [], name: "jlpt" });
  });

  /**
   * The quote support above must not cost the unquoted form its split: the
   * launcher-style catalog entries (`npx jlpt-mcp@latest`) rely on every token
   * after the first becoming an arg, which is how they worked before TASK-177.
   */
  it("splits an unquoted stdio target into command plus args", () => {
    expect(
      toMcpServer({
        id: "jlpt-vocab",
        target: "npx jlpt-mcp@latest",
        transport: "stdio",
      })
    ).toEqual({
      args: ["jlpt-mcp@latest"],
      command: "npx",
      env: [],
      name: "jlpt-vocab",
    });
  });

  it("fails loudly on an unclosed quote rather than spawning a half path", () => {
    expect(() =>
      toMcpServer({
        id: "jlpt",
        target: '"C:\\Program Files\\a.exe',
        transport: "stdio",
      })
    ).toThrow("unclosed quote");
    expect(() =>
      toMcpServer({ id: "jlpt", target: '""  --verbose', transport: "stdio" })
    ).toThrow("empty command");
  });

  it("warns and drops env for a transport whose ACP type has no env field", () => {
    const before = warningBuffer.length;
    const config = toMcpServer({
      env: { SECRET: "x" },
      id: "remote",
      target: "http://localhost:3001/mcp",
      transport: "http",
    });
    expect(config).toEqual({
      headers: [],
      name: "remote",
      type: "http",
      url: "http://localhost:3001/mcp",
    });
    expect(warningBuffer.slice(before).join("\n")).toContain("remote");
  });

  it("accepts a catalog entry with env and rejects an illegal one", () => {
    const base = {
      enabled: true,
      id: "jlpt",
      target: "/bin/jlpt-mcp",
      transport: "stdio" as const,
    };
    const catalogWith = (env: unknown) => ({
      servers: [{ ...base, env }],
      version: 1,
    });
    // Same all-or-nothing rule as the rest of the file: one bad entry voids it.
    expect(isMcpCatalog(catalogWith({ JLPT_MCP_DEBUG: "1" }))).toBe(true);
    expect(isMcpCatalog(catalogWith(undefined))).toBe(true);
    expect(isMcpCatalog(catalogWith({ "9X": "1" }))).toBe(false);
    expect(isMcpCatalog(catalogWith({ X: "has|pipe" }))).toBe(false);
    expect(isMcpCatalog(catalogWith("JLPT_MCP_DEBUG=1"))).toBe(false);
    const parsed = parseMcpCatalog(JSON.stringify(catalogWith({ X: "1" })));
    expect(parsed.servers[0]?.env).toEqual({ X: "1" });
  });

  it("carries env through resolveMcpServers, which only strips enabled", () => {
    const resolved = resolveMcpServers(
      {
        servers: [
          {
            enabled: true,
            env: { JLPT_MCP_DEBUG: "1" },
            id: "file-server",
            target: "/bin/x",
            transport: "stdio",
          },
        ],
        version: 1,
      },
      null
    );
    expect(resolved).toEqual([
      {
        env: { JLPT_MCP_DEBUG: "1" },
        id: "file-server",
        target: "/bin/x",
        transport: "stdio",
      },
    ]);
  });
});
