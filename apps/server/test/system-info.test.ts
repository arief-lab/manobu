import { expect, test } from "bun:test";
import { dirname } from "node:path";

import { buildSystemInfoReport } from "../src/system-info";

const base = {
  assistant: { dir: null, fallback: true },
  childRegistryPath: undefined,
  cwd: "/somewhere/cwd",
  env: {} as NodeJS.ProcessEnv,
  pid: 4321,
};

test("packaged launcher paths are echoed exactly as passed", () => {
  const report = buildSystemInfoReport({
    ...base,
    assistant: {
      dir: "/app/usr/lib/manobu/assistant",
      fallback: false,
    },
    childRegistryPath: "/data/user.gg.manobu.app/.acp-children.json",
    env: {
      DATABASE_URL: "file:/data/user.gg.manobu.app/manobu.db",
      HOME: "/home/tester",
      MANOBU_CACHE_DIR: "/cache/gg.manobu.app",
      MANOBU_DATA_DIR: "/app/usr/lib/manobu/packages/japanese/data",
      MANOBU_LOG_DIR: "/log/gg.manobu.app",
      PATH: "/usr/bin:/bin",
    },
  });
  expect(report.paths).toEqual({
    assistantDir: "/app/usr/lib/manobu/assistant",
    assistantFallback: false,
    cacheDir: "/cache/gg.manobu.app",
    childRegistryPath: "/data/user.gg.manobu.app/.acp-children.json",
    databaseFile: "/data/user.gg.manobu.app/manobu.db",
    dataDir: "/data/user.gg.manobu.app",
    japaneseDataDir: "/app/usr/lib/manobu/packages/japanese/data",
    logDir: "/log/gg.manobu.app",
  });
  expect(report.process).toEqual({
    cwd: "/somewhere/cwd",
    home: "/home/tester",
    pathEntries: 2,
    pid: 4321,
  });
});

test("a relative file: db is resolved to an absolute path, not cwd-guessed elsewhere", () => {
  const report = buildSystemInfoReport({
    ...base,
    env: { DATABASE_URL: "file:../../local.db" },
  });
  expect(report.paths.databaseFile?.startsWith("/")).toBe(true);
  expect(report.paths.dataDir).toBe(dirname(report.paths.databaseFile ?? ""));
});

test("in-memory or URL databases report null file paths", () => {
  for (const url of [":memory:", "https://turso.db", ""]) {
    const report = buildSystemInfoReport({
      ...base,
      env: { DATABASE_URL: url },
    });
    expect(report.paths.databaseFile).toBeNull();
    expect(report.paths.dataDir).toBeNull();
  }
});

test("plain dev boot: unset env vars report null, never a cwd fallback", () => {
  const report = buildSystemInfoReport({ ...base, env: {} });
  expect(report.paths.cacheDir).toBeNull();
  expect(report.paths.logDir).toBeNull();
  expect(report.paths.japaneseDataDir).toBeNull();
  expect(report.paths.childRegistryPath).toBeNull();
  expect(report.paths.assistantFallback).toBe(true);
});
