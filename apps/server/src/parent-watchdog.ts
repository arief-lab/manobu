/**
 * Parent-process watchdog (TASK-153 AC#2).
 *
 * The packaged app spawns this sidecar as its child. If the Tauri process
 * dies uncleanly (`kill -9`, crash, logout), nobody sends this process a
 * signal: the sidecar squats the sidecar port, keeps its SQLite handles, and
 * its detached agent children keep their predictor caches alive as init's
 * orphans until the *next* boot's reap. The Tauri side therefore passes
 * `MANOBU_PARENT_PID`; here we poll it (signal-0, cheap) on an unref'd timer
 * and, once the parent is gone, run the same teardown SIGTERM runs — dispose
 * every ACP session so the agent process groups die with us.
 *
 * Everything nondeterministic (the liveness probe, the scheduler) is
 * injected so the module unit-tests against fake pids and fake clocks.
 * When `MANOBU_PARENT_PID` is unset (plain `bun run dev`, smoke scripts),
 * the watchdog is inert and the process behaves as before.
 */

const DEFAULT_POLL_INTERVAL_MS = 2000;

export interface ParentWatchdogDeps {
  clearInterval: (timer: ParentWatchdogTimer) => void;
  /** Is the pid still alive? EPERM counts as alive (we may not signal it). */
  probe: (pid: number) => boolean;
  setInterval: (callback: () => void, ms: number) => ParentWatchdogTimer;
}

export interface ParentWatchdogTimer {
  /** Never keep the process alive just to watch the parent. */
  unref?: () => void;
}

export interface ParentWatchdogOptions {
  deps?: Partial<ParentWatchdogDeps>;
  intervalMs?: number;
  log?: (message: string) => void;
  /** Called exactly once when the parent process has vanished. */
  onParentGone: (pid: number) => void;
  /** Raw `MANOBU_PARENT_PID` value; anything unparsable disables the watch. */
  parentPid: string | undefined;
}

export interface ParentWatchdogHandle {
  stop: () => void;
}

/** Signal-0 probe: existence + permission only, no delivery. */
function defaultProbe(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Parse the raw env value. A pid equal to our own is rejected: a parent that
 * IS us (a dev launcher that set the var wrong) would make every probe fire
 * the teardown mid-request.
 */
export function parseParentPid(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return null;
  }
  return pid;
}

/**
 * Start watching. Returns a handle even when the watch is inert so callers
 * need no branching. The poll is synchronous and cheap; it runs on the main
 * thread only for the duration of one signal-0 call.
 */
export function startParentWatchdog(
  options: ParentWatchdogOptions
): ParentWatchdogHandle {
  const log =
    options.log ?? ((message) => console.warn(`[sidecar] ${message}`));
  const parentPid = parseParentPid(options.parentPid);
  if (parentPid === null) {
    if (options.parentPid !== undefined && options.parentPid.trim() !== "") {
      log(
        `ignoring unparsable MANOBU_PARENT_PID "${options.parentPid}" · watchdog disabled`
      );
    }
    return { stop: () => undefined };
  }
  const deps: ParentWatchdogDeps = {
    clearInterval: (handle) =>
      clearInterval(handle as ReturnType<typeof setInterval>),
    probe: defaultProbe,
    setInterval: (callback, ms) => setInterval(callback, ms),
    ...options.deps,
  };
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let fired = false;
  let timer: ParentWatchdogTimer | null = deps.setInterval(() => {
    if (fired || deps.probe(parentPid)) {
      return;
    }
    fired = true;
    if (timer) {
      deps.clearInterval(timer);
      timer = null;
    }
    log(`parent pid ${parentPid} is gone · shutting the sidecar down`);
    options.onParentGone(parentPid);
  }, intervalMs);
  timer.unref?.();
  return {
    stop: () => {
      if (timer) {
        deps.clearInterval(timer);
        timer = null;
      }
    },
  };
}
