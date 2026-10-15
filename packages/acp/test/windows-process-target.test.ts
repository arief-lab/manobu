/**
 * Windows process-target unit tests (TASK-177 Stage 3).
 *
 * The kill path is the part that goes silently wrong on Windows:
 * `process.kill(-pid)` is the POSIX way to take down a child *and its
 * grandchildren* in one signal, and on win32 the negative pid is simply an
 * invalid argument. If the code keeps negating it there, every teardown throws,
 * every throw is swallowed as "group already gone", and the learner accumulates
 * orphaned agent processes without a single log line. These pin the target and
 * the marker shape without touching a real pid (the killer itself stays
 * injectable in `child-registry.test.ts`).
 */

import { expect, test } from "bun:test";

import {
  commandBaseName,
  killTarget,
  windowsGroupReapWarning,
} from "../src/child-registry";

test("killTarget signals the group on POSIX and the pid on Windows", () => {
  expect(killTarget(4242, "linux")).toBe(-4242);
  expect(killTarget(4242, "darwin")).toBe(-4242);
  expect(killTarget(4242, "freebsd")).toBe(-4242);
  expect(killTarget(4242, "win32")).toBe(4242);
});

/**
 * The AC this pins is the silence: `killGroupQuiet` swallows every throw, so on
 * Windows a reap that reaches the child but not its grandchildren looked
 * identical to a reap that worked. The line has to exist on win32 and must not
 * appear on a platform that genuinely reaped the group.
 */
test("the Windows reap says the grandchildren survived", () => {
  const line = windowsGroupReapWarning("win32");
  expect(line).not.toBeNull();
  expect(line).toContain("grandchildren");
  expect(windowsGroupReapWarning("linux")).toBeNull();
  expect(windowsGroupReapWarning("darwin")).toBeNull();
});

test("commandBaseName takes the last segment of a Windows path", () => {
  expect(commandBaseName("C:\\Users\\u\\.bun\\bin\\opencode.exe")).toBe(
    "opencode.exe"
  );
  expect(commandBaseName("C:\\Program Files\\opencode\\opencode.cmd")).toBe(
    "opencode.cmd"
  );
  // A mixed separator path is what `node:path.win32` and a hand-joined
  // literal can both produce, so neither shape may leave the whole string as
  // the marker (that matched no process and every reap was skipped).
  expect(commandBaseName("/mnt/c/bin/opencode")).toBe("opencode");
  expect(commandBaseName("C:\\bin/opencode")).toBe("opencode");
  expect(commandBaseName("opencode")).toBe("opencode");
  expect(commandBaseName("")).toBe("");
});
