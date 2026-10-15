import { expect, test } from "bun:test";

import {
  type ParentWatchdogTimer,
  parseParentPid,
  startParentWatchdog,
} from "../src/parent-watchdog";

interface FakeTimer extends ParentWatchdogTimer {
  unrefCalls: number;
}

interface FakeScheduler {
  clearIntervalCalls: ParentWatchdogTimer[];
  fire: () => void;
  timers: FakeTimer[];
}

function makeWorld(alivePids: Set<number>) {
  const callbacks: (() => void)[] = [];
  const timers: FakeTimer[] = [];
  const world: FakeScheduler = {
    clearIntervalCalls: [],
    fire: () => {
      for (const callback of callbacks) {
        callback();
      }
    },
    timers,
  };
  return {
    deps: {
      clearInterval: (timer: ParentWatchdogTimer) => {
        world.clearIntervalCalls.push(timer);
      },
      probe: (pid: number) => alivePids.has(pid),
      setInterval: (callback: () => void, _ms: number): ParentWatchdogTimer => {
        const timer: FakeTimer = {
          unref(): void {
            timer.unrefCalls += 1;
          },
          unrefCalls: 0,
        };
        callbacks.push(callback);
        timers.push(timer);
        return timer;
      },
    },
    world,
  };
}

test("parseParentPid rejects unset, garbage, non-positive, and self", () => {
  expect(parseParentPid(undefined)).toBeNull();
  expect(parseParentPid("")).toBeNull();
  expect(parseParentPid("  ")).toBeNull();
  expect(parseParentPid("opencode")).toBeNull();
  expect(parseParentPid("0")).toBeNull();
  expect(parseParentPid("-7")).toBeNull();
  expect(parseParentPid("1.5")).toBeNull();
  expect(parseParentPid(String(process.pid))).toBeNull();
  expect(parseParentPid("4321")).toBe(4321);
});

test("watchdog is inert without a parent pid", () => {
  const { deps, world } = makeWorld(new Set());
  let fired = 0;
  const handle = startParentWatchdog({
    deps,
    onParentGone: () => {
      fired += 1;
    },
    parentPid: undefined,
  });
  expect(world.timers.length).toBe(0);
  expect(fired).toBe(0);
  handle.stop();
});

test("unparsable but set value warns once and stays inert", () => {
  const { deps, world } = makeWorld(new Set());
  const warnings: string[] = [];
  startParentWatchdog({
    deps,
    log: (message) => warnings.push(message),
    onParentGone: () => undefined,
    parentPid: "not-a-pid",
  });
  expect(warnings.length).toBe(1);
  expect(world.timers.length).toBe(0);
});

test("the scheduled timer is unref'd by the watchdog itself", () => {
  const { deps, world } = makeWorld(new Set([1234]));
  startParentWatchdog({
    deps,
    onParentGone: () => undefined,
    parentPid: "1234",
  });
  expect(world.timers.length).toBe(1);
  expect(world.timers[0]?.unrefCalls).toBe(1);
});

test("parent death fires onParentGone exactly once and clears the timer", () => {
  const parentPid = 99_999;
  const alive = new Set<number>([parentPid]);
  const { deps, world } = makeWorld(alive);
  const gone: number[] = [];
  startParentWatchdog({
    deps,
    onParentGone: (pid) => {
      gone.push(pid);
    },
    parentPid: String(parentPid),
  });
  // Still alive: nothing happens.
  world.fire();
  expect(gone.length).toBe(0);
  // Parent vanishes.
  alive.clear();
  world.fire();
  expect(gone).toEqual([parentPid]);
  expect(world.clearIntervalCalls.length).toBe(1);
  // A stray later tick must not fire a second time.
  alive.add(parentPid);
  world.fire();
  expect(gone.length).toBe(1);
});

test("stop() clears a live watch before the parent dies", () => {
  const { deps, world } = makeWorld(new Set([1234]));
  const handle = startParentWatchdog({
    deps,
    onParentGone: () => {
      throw new Error("must not fire");
    },
    parentPid: "1234",
  });
  handle.stop();
  expect(world.clearIntervalCalls.length).toBe(1);
  world.fire();
  handle.stop();
  expect(world.clearIntervalCalls.length).toBe(1);
});
