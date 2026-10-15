/**
 * Child-registry tests (TASK-102 AC#7).
 *
 * Two layers:
 *  - The `ChildRegistry` unit through its injected deps (a fake process table +
 *    a temp file): no real processes, so register/unregister/reap and every
 *    skip path are deterministic.
 *  - One controller integration test that spawns the real `fake-agent` with a
 *    temp registry path and proves the agent's group is recorded while it lives
 *    and pruned when we tear it down — the durability the boot reap depends on.
 *    It does not assert the OS kill (that is teardown's job, and killing a real
 *    group in a unit test is a footgun); it asserts the durable contract.
 */

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { ChildRegistry } from "../src/child-registry";
import type { CommandSpec } from "../src/launch-policy";
import { SessionController } from "../src/session";

const FAKE = join(import.meta.dir, "fake-agent.ts");
const tmp = mkdtempSync(join(tmpdir(), "acp-registry-"));

let fileSeq = 0;
function tempFile(): string {
  fileSeq += 1;
  return join(tmp, `reg-${fileSeq}.json`);
}

/** Fake process table + killer so a reap never touches a real pid. */
function fakeTable(options: {
  alive?: Set<number>;
  markers?: Map<number, string>;
}) {
  const alive = options.alive ?? new Set<number>();
  const markers = options.markers ?? new Map<number, string>();
  const killed: number[] = [];
  return {
    deps: {
      isAlive: (pgid: number): boolean => alive.has(pgid),
      killGroup: (pgid: number): void => {
        killed.push(pgid);
        alive.delete(pgid);
      },
      matchesMarker: (pgid: number, marker: string): boolean =>
        markers.get(pgid) === marker,
      now: (): number => 1000,
    },
    killed,
  };
}

function readRows(path: string): Record<string, unknown>[] {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>[];
}

function seededRegistry(options: {
  alive?: Set<number>;
  markers?: Map<number, string>;
  rows: unknown[];
}) {
  const path = tempFile();
  const table = fakeTable(options);
  const registry = new ChildRegistry({
    deps: table.deps,
    filePath: path,
    log: () => undefined,
  });
  writeFileSync(path, JSON.stringify(options.rows));
  return { path, registry, ...table };
}

test("register writes one durable row per group leader", () => {
  const path = tempFile();
  const { deps } = fakeTable({});
  const registry = new ChildRegistry({ deps, filePath: path });

  registry.register(101, "agent", "bun");
  const rows = readRows(path);
  expect(rows).toEqual([
    { kind: "agent", marker: "bun", pgid: 101, registeredAt: 1000 },
  ]);
});

test("register dedups a pgid re-recorded after a respawn", () => {
  const path = tempFile();
  const { deps } = fakeTable({});
  const registry = new ChildRegistry({ deps, filePath: path });

  registry.register(101, "agent", "bun");
  registry.register(101, "agent", "bun");
  expect(readRows(path)).toHaveLength(1);
});

test("register ignores a non-positive pgid (spawn failed before a pid)", () => {
  const path = tempFile();
  const { deps } = fakeTable({});
  const registry = new ChildRegistry({ deps, filePath: path });

  // Seed one valid row so the file exists; the invalid ones must not add more.
  registry.register(100, "agent", "bun");
  registry.register(0, "agent", "bun");
  registry.register(-1, "agent", "bun");
  expect(readRows(path)).toHaveLength(1);
});

test("unregister prunes the row so a recycled pid is never reaped", () => {
  const path = tempFile();
  const { deps } = fakeTable({});
  const registry = new ChildRegistry({ deps, filePath: path });

  registry.register(101, "agent", "bun");
  registry.register(102, "agent", "bun");
  registry.unregister(101);
  expect(readRows(path)).toEqual([
    { kind: "agent", marker: "bun", pgid: 102, registeredAt: 1000 },
  ]);
});

test("reapLeftovers kills live, marker-matching groups and clears the file", () => {
  const { killed, path, registry } = seededRegistry({
    alive: new Set([101, 102]),
    markers: new Map([
      [101, "bun"],
      [102, "opencode"],
    ]),
    rows: [
      { kind: "agent", marker: "bun", pgid: 101, registeredAt: 1 },
      { kind: "agent", marker: "opencode", pgid: 102, registeredAt: 1 },
    ],
  });

  const result = registry.reapLeftovers();
  expect(result).toEqual({ reaped: 2, skipped: 0 });
  expect(killed.sort((a, b) => a - b)).toEqual([101, 102]);
  expect(readRows(path)).toEqual([]);
});

test("reapLeftovers skips a dead pgid and a recycled one, killing neither", () => {
  // 101 died on its own; 102's pid was reused by an unrelated command.
  const { killed, registry } = seededRegistry({
    alive: new Set([102]),
    markers: new Map([[102, "something-else"]]),
    rows: [
      { kind: "agent", marker: "bun", pgid: 101, registeredAt: 1 },
      { kind: "agent", marker: "opencode", pgid: 102, registeredAt: 1 },
    ],
  });

  const result = registry.reapLeftovers();
  expect(result).toEqual({ reaped: 0, skipped: 1 });
  expect(killed).toEqual([]);
});

test("reapLeftovers never kills a group this instance registered and still owns", () => {
  const path = tempFile();
  const alive = new Set([201]);
  const markers = new Map([[201, "bun"]]);
  const table = fakeTable({ alive, markers });
  const registry = new ChildRegistry({
    deps: table.deps,
    filePath: path,
    log: () => undefined,
  });

  registry.register(201, "agent", "bun");
  const result = registry.reapLeftovers();
  expect(result).toEqual({ reaped: 0, skipped: 0 });
  expect(table.killed).toEqual([]);
  // Our own live group is still tracked after the sweep.
  expect(registry.liveGroups()).toEqual([201]);
});

test("reapLeftovers tolerates a missing or corrupt registry file", () => {
  const missing = new ChildRegistry({
    deps: fakeTable({}).deps,
    filePath: tempFile(),
    log: () => undefined,
  });
  expect(missing.reapLeftovers()).toEqual({ reaped: 0, skipped: 0 });

  const corrupt = tempFile();
  writeFileSync(corrupt, "this is not json {{{");
  const registry = new ChildRegistry({
    deps: fakeTable({}).deps,
    filePath: corrupt,
    log: () => undefined,
  });
  expect(registry.reapLeftovers()).toEqual({ reaped: 0, skipped: 0 });
});

test("reapLeftovers drops malformed rows so a hand-edited file cannot forge a reap", () => {
  const { killed, registry } = seededRegistry({
    alive: new Set([301]),
    markers: new Map([[301, "bun"]]),
    rows: [
      { kind: "agent", marker: "bun", pgid: -5 },
      { kind: "agent", pgid: 301 },
      "not-an-object",
      { kind: "agent", marker: "bun", pgid: 301, registeredAt: 1 },
    ],
  });

  const result = registry.reapLeftovers();
  // Only the one well-formed row (301) is acted on.
  expect(result).toEqual({ reaped: 1, skipped: 0 });
  expect(killed).toEqual([301]);
});

// ── Controller durability (real fake-agent child, temp registry file) ──

test("the controller records an agent group while it lives and prunes it on dispose", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-fake-"));
  const scriptPath = join(dir, "handshake.json");
  writeFileSync(scriptPath, JSON.stringify({ capabilities: {} }));
  const spec: CommandSpec = {
    args: [FAKE, scriptPath],
    command: process.execPath,
    cwd: dir,
    forwardMcp: false,
    mcpServers: [],
  };

  const path = tempFile();
  const controller = new SessionController({ childRegistryPath: path });
  const handle = await controller.ensureSession(spec);
  const pgid = handle.child?.pid;
  expect(pgid).toBeTypeOf("number");

  const [row] = readRows(path);
  expect(row).toMatchObject({
    kind: "agent",
    marker: basename(process.execPath),
    pgid,
  });
  expect(typeof row?.registeredAt).toBe("number");

  await controller.disposeAll();
  // Torn down: the durable record is gone, so a future boot cannot target it.
  expect(readRows(path)).toEqual([]);
}, 15_000);
