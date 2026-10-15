import { expect, test } from "bun:test";

import {
  agentBinDirs,
  bootstrapAgentPath,
  compareNodeVersions,
  prependMissingPaths,
} from "../src/path-bootstrap";

/** Fake filesystem: only these absolute paths exist; dirs list children. */
function fakeFs(paths: Set<string>, children = new Map<string, string[]>()) {
  return {
    exists: (path: string) => paths.has(path),
    listDir: (path: string) => children.get(path) ?? [],
  };
}

const HOME = "/home/tester";
/**
 * Every case names the platform it models instead of inheriting
 * `process.platform`, so the POSIX expectations below hold on a Windows
 * checkout too (TASK-177).
 */
const LINUX: NodeJS.Platform = "linux";
const WIN: NodeJS.Platform = "win32";
const WIN_HOME = "C:\\Users\\tester";

test("agentBinDirs picks the newest nvm bin and only existing dirs", () => {
  const nvmRoot = `${HOME}/.nvm/versions/node`;
  const paths = new Set([
    nvmRoot,
    `${nvmRoot}/v20.1.0/bin`,
    `${nvmRoot}/v22.3.0/bin`,
    `${nvmRoot}/v9.11.0/bin`,
    // version dir without a bin/ must be skipped
    `${nvmRoot}/v99.0.0`,
    `${HOME}/.bun/bin`,
    `${HOME}/.cargo/bin`,
  ]);
  const children = new Map([
    [nvmRoot, ["v20.1.0", "v22.3.0", "v9.11.0", "v99.0.0"]],
  ]);
  const dirs = agentBinDirs(HOME, fakeFs(paths, children), LINUX);
  expect(dirs).toEqual([
    `${nvmRoot}/v22.3.0/bin`,
    `${HOME}/.bun/bin`,
    `${HOME}/.cargo/bin`,
  ]);
  // mise shims absent → not listed; bun share dir absent → not listed.
  expect(dirs.some((d) => d.includes("mise"))).toBe(false);
});

test("nvm missing or empty yields no nvm entry without crashing", () => {
  expect(
    agentBinDirs(HOME, fakeFs(new Set([`${HOME}/.bun/bin`])), LINUX)
  ).toEqual([`${HOME}/.bun/bin`]);
  const withEmptyNvm = fakeFs(
    new Set([`${HOME}/.nvm/versions/node`, `${HOME}/.cargo/bin`]),
    new Map([[`${HOME}/.nvm/versions/node`, []]])
  );
  expect(agentBinDirs(HOME, withEmptyNvm, LINUX)).toEqual([
    `${HOME}/.cargo/bin`,
  ]);
});

test("win32 lists the AppData bin dirs and the newest nvm-windows version", () => {
  const appData = `${WIN_HOME}\\AppData\\Roaming`;
  const localAppData = `${WIN_HOME}\\AppData\\Local`;
  const nvmRoot = `${appData}\\nvm`;
  const paths = new Set([
    nvmRoot,
    `${nvmRoot}\\v22.3.0`,
    `${nvmRoot}\\v9.11.0`,
    // nvm-windows keeps its helpers in the same dir: not a version.
    `${nvmRoot}\\nodejs`,
    `${nvmRoot}\\elevate.cmd`,
    `${WIN_HOME}\\.bun\\bin`,
    `${appData}\\npm`,
    `${localAppData}\\mise\\shims`,
  ]);
  const children = new Map([
    [nvmRoot, ["v22.3.0", "v9.11.0", "nodejs", "elevate.cmd"]],
  ]);
  expect(agentBinDirs(WIN_HOME, fakeFs(paths, children), WIN)).toEqual([
    `${nvmRoot}\\v22.3.0`,
    `${WIN_HOME}\\.bun\\bin`,
    `${appData}\\npm`,
    `${localAppData}\\mise\\shims`,
  ]);
});

test("win32 with no version manager installed still finds .bun", () => {
  expect(
    agentBinDirs(WIN_HOME, fakeFs(new Set([`${WIN_HOME}\\.bun\\bin`])), WIN)
  ).toEqual([`${WIN_HOME}\\.bun\\bin`]);
});

test("compareNodeVersions orders numerically, not lexically", () => {
  const sorted = ["v9.11.0", "v22.3.0", "v22.10.0", "v100.0.0"].sort(
    compareNodeVersions
  );
  expect(sorted).toEqual(["v9.11.0", "v22.3.0", "v22.10.0", "v100.0.0"]);
  expect(compareNodeVersions("v22.3.0", "v22.3.0")).toBe(0);
  expect(compareNodeVersions("garbage", "v1.0.0")).toBeLessThan(0);
});

test("prependMissingPaths dedupes, drops empty entries, keeps order", () => {
  const merged = prependMissingPaths(
    "/usr/bin::/bin",
    ["/home/tester/.bun/bin", "/usr/bin", "/home/tester/.cargo/bin"],
    LINUX
  );
  expect(merged.added).toEqual([
    "/home/tester/.bun/bin",
    "/home/tester/.cargo/bin",
  ]);
  expect(merged.path).toBe(
    "/home/tester/.bun/bin:/home/tester/.cargo/bin:/usr/bin:/bin"
  );
});

test("win32 joins with `;` and leaves a drive-letter colon inside an entry", () => {
  const merged = prependMissingPaths(
    "C:\\Windows;C:\\Windows\\System32;;",
    ["C:\\Users\\tester\\.bun\\bin"],
    WIN
  );
  expect(merged.added).toEqual(["C:\\Users\\tester\\.bun\\bin"]);
  expect(merged.path).toBe(
    "C:\\Users\\tester\\.bun\\bin;C:\\Windows;C:\\Windows\\System32"
  );
  // The `:` of `C:` must not split the entry: that is the whole bug, a
  // `:`-joined PATH arriving at the child as one mangled string.
  expect(merged.path.split(";")).toHaveLength(3);
});

test("bootstrapAgentPath mutates env.PATH only when something is added", () => {
  const nvmRoot = `${HOME}/.nvm/versions/node`;
  const paths = new Set([
    nvmRoot,
    `${nvmRoot}/v22.3.0/bin`,
    `${HOME}/.bun/bin`,
  ]);
  const children = new Map([[nvmRoot, ["v22.3.0"]]]);
  const env: NodeJS.ProcessEnv = { HOME, PATH: "/usr/bin:/bin" };
  const first = bootstrapAgentPath(env, fakeFs(paths, children), LINUX);
  expect(first.added).toEqual([`${nvmRoot}/v22.3.0/bin`, `${HOME}/.bun/bin`]);
  expect(env.PATH).toBe(
    `${nvmRoot}/v22.3.0/bin:${HOME}/.bun/bin:/usr/bin:/bin`
  );
  // Second run is a no-op: everything is already on PATH.
  const second = bootstrapAgentPath(env, fakeFs(paths, children), LINUX);
  expect(second.added).toEqual([]);
  expect(env.PATH).toBe(
    `${nvmRoot}/v22.3.0/bin:${HOME}/.bun/bin:/usr/bin:/bin`
  );
});

test("a Windows sidecar with USERPROFILE and no HOME is still augmented", () => {
  const paths = new Set([`${WIN_HOME}\\AppData\\Roaming\\npm`]);
  const env: NodeJS.ProcessEnv = {
    PATH: "C:\\Windows",
    USERPROFILE: WIN_HOME,
  };
  const result = bootstrapAgentPath(env, fakeFs(paths), WIN);
  expect(result.added).toEqual([`${WIN_HOME}\\AppData\\Roaming\\npm`]);
  expect(env.PATH).toBe(`${WIN_HOME}\\AppData\\Roaming\\npm;C:\\Windows`);
});

test("no HOME means no augmentation and no throw", () => {
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
  const result = bootstrapAgentPath(env, fakeFs(new Set()), LINUX);
  expect(result.added).toEqual([]);
  expect(result.path).toBe("/usr/bin");
  expect(env.PATH).toBe("/usr/bin");
});
