/**
 * Persistent registry of spawned agent-child process groups (TASK-102).
 *
 * Why it exists: every ACP agent we spawn (`opencode` and friends) forks its
 * own grandchildren — the `jlpt-mcp` sidecar per `session/new` plus tool
 * subprocesses mid-turn — each carrying a multi-megabyte predictor cache. The
 * old teardown killed only the direct child, so that whole forest was orphaned;
 * and once the sidecar itself dies uncleanly the survivors reparent to init,
 * where no in-memory handle can reach them. Recording each group leader's pid
 * in a durable file lets the *next* boot reap what the last one left behind,
 * which is the only way to bound the accumulation across restarts.
 *
 * The interface is deliberately tiny: register one group leader while it lives,
 * unregister it when we tear it down ourselves, and `reapLeftovers()` once at
 * boot. Everything nondeterministic (the liveness probe, the group killer, the
 * `/proc` marker match, the clock) is injected, so the module is testable
 * against fake pids and a fake process table with no real children and no
 * reliance on OS state.
 *
 * Safety: a bare pid can be recycled by the OS between a crash and the next
 * boot, so `reapLeftovers` will not kill a live pid unless its recorded command
 * `marker` still matches the process (`/proc/<pid>/cmdline` on Linux; when the
 * check is unavailable the entry is skipped rather than killed blindly).
 */

import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** One durable record of a group we spawned and did not get to reap. */
interface ChildRecord {
  kind: string;
  /** Command basename captured at spawn, re-checked before a reap kill. */
  marker: string;
  /** Process-group id, which equals a detached child's own pid. */
  pgid: number;
  registeredAt: number;
}

export interface ChildRegistryDeps {
  /** Does the group still have at least one live member? */
  isAlive: (pgid: number) => boolean;
  /** Signal the whole group; throws if it is already gone. */
  killGroup: (pgid: number) => void;
  /**
   * Is the live process behind `pgid` still the one we recorded? Returning
   * false makes a reap skip the pid (treated as recycled). Omitted on
   * platforms where the identity cannot be checked without a syscall helper.
   */
  matchesMarker?: (pgid: number, marker: string) => boolean;
  now: () => number;
}

export interface ChildRegistryOptions {
  deps?: Partial<ChildRegistryDeps>;
  /** Where the durable list lives; a file we can rewrite atomically. */
  filePath?: string;
  log?: (message: string) => void;
}

/**
 * Default home for the registry. The sidecar overrides this with a path in its
 * data directory (`apps/server/src/context.ts`); the tmpdir default keeps a
 * bare `SessionController` (tests, CLI) from scattering files in the cwd.
 */
function defaultRegistryPath(): string {
  return (
    process.env.ACP_CHILD_REGISTRY ?? join(tmpdir(), "manobu-acp-children.json")
  );
}

/** Signal-0 probe: no delivery, existence + permission only. Never target 0. */
function defaultIsAlive(pgid: number): boolean {
  if (pgid <= 0) {
    return false;
  }
  try {
    process.kill(killTarget(pgid, process.platform), 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function defaultKillGroup(pgid: number): void {
  warnWindowsGroupReapOnce();
  process.kill(killTarget(pgid, process.platform), "SIGKILL");
}

/**
 * Linux identity check via `/proc/<pid>/cmdline` (NUL-separated argv). Returns
 * false when the file cannot be read, so an unreadable pid is never killed
 * blind. A non-Linux dev of this path should inject `matchesMarker`.
 *
 * That includes the packaged Windows run, where there is no `/proc`: every
 * leftover is reported `skipped` instead of killed, which is the conservative
 * direction. The parent watchdog is what bounds the leak there, not this sweep.
 */
function defaultMatchesMarker(pgid: number, marker: string): boolean {
  try {
    const raw = readFileSync(`/proc/${pgid}/cmdline`, "utf8");
    const argv = raw.split("\0").filter((token) => token.length > 0);
    if (argv.length === 0) {
      return false;
    }
    return argv.some((token) => baseName(token) === marker);
  } catch {
    return false;
  }
}

/**
 * Last path segment, i.e. a command basename without `node:path`. Both
 * separators count (TASK-177): a Windows spawn records
 * `C:\Users\u\.bun\bin\opencode.exe`, and splitting only on `/` made the
 * marker the whole string, which no `/proc` token ever equals.
 */
function baseName(token: string): string {
  const slash = token.lastIndexOf("/");
  const backslash = token.lastIndexOf("\\");
  const cut = Math.max(slash, backslash);
  return cut === -1 ? token : token.slice(cut + 1);
}

/** Command basename to capture at spawn as a reap-time identity marker. */
export function commandBaseName(token: string): string {
  return baseName(token);
}

/**
 * What to hand `process.kill` for a group leader.
 *
 * POSIX takes the negative pid and signals the whole group, which is how one
 * kill takes down the grandchildren (`jlpt-mcp`, tool subprocesses) too.
 * Windows has no such thing: `-pid` is rejected outright, so the best available
 * target is the pid itself and the grandchildren survive the reap. Job Objects
 * are the real fix and are deliberately out of scope for this pass (TASK-177
 * Stage 5); until then a Windows run leaks what a Linux run reaps.
 */
export function killTarget(pgid: number, platform: NodeJS.Platform): number {
  return platform === "win32" ? pgid : -pgid;
}

/**
 * The line a Windows reap has to say out loud. Without it the swallow in
 * `killGroupQuiet` reads as "group already gone" and the leak is invisible,
 * which is the failure TASK-177 AC#3 exists to prevent. `null` on platforms
 * where the group really was reaped.
 */
export function windowsGroupReapWarning(
  platform: NodeJS.Platform
): string | null {
  return platform === "win32"
    ? "[acp] win32: kill targeted the pid, not a process group, so this child's grandchildren are still running (Job Objects deferred, TASK-177 Stage 5)"
    : null;
}

/** Repeat the warning once per process; a teardown loop reaps many children. */
let groupReapWarned = false;

function warnWindowsGroupReapOnce(): void {
  if (groupReapWarned) {
    return;
  }
  const line = windowsGroupReapWarning(process.platform);
  if (line) {
    groupReapWarned = true;
    console.warn(line);
  }
}

/**
 * SIGKILL a whole process group, swallowing the already-gone case. Used by
 * every teardown path so killing one child takes down the grandchildren it
 * spawned into the same group (the jlpt-mcp sidecar, tool subprocesses). On
 * Windows this reaches the child only, per `killTarget`.
 */
export function killGroupQuiet(pgid: number | undefined): void {
  if (pgid === undefined || pgid <= 0) {
    return;
  }
  warnWindowsGroupReapOnce();
  try {
    process.kill(killTarget(pgid, process.platform), "SIGKILL");
  } catch {
    // group already reaped or exited
  }
}

/**
 * The registry. One instance per `SessionController`; also usable standalone
 * for a server that wants a boot reap without any live session yet.
 */
export class ChildRegistry {
  readonly #deps: ChildRegistryDeps;
  readonly #filePath: string;
  readonly #log: (message: string) => void;
  /** Groups this process spawned and has not yet torn down. */
  readonly #own = new Set<number>();

  constructor(options: ChildRegistryOptions = {}) {
    this.#filePath = options.filePath ?? defaultRegistryPath();
    this.#deps = {
      isAlive: defaultIsAlive,
      killGroup: defaultKillGroup,
      matchesMarker: defaultMatchesMarker,
      now: () => Date.now(),
      ...options.deps,
    };
    this.#log = options.log ?? ((message) => console.warn(`[acp] ${message}`));
  }

  /**
   * Record a group leader we just spawned. `marker` is the command basename,
   * kept so a later reap can confirm the pid has not been recycled.
   */
  register(pgid: number, kind: string, marker: string): void {
    if (pgid <= 0) {
      return;
    }
    this.#own.add(pgid);
    const records = this.#read();
    const next = records.filter((record) => record.pgid !== pgid);
    next.push({ kind, marker, pgid, registeredAt: this.#deps.now() });
    this.#write(next);
  }

  /**
   * Drop a group we tore down ourselves, so a boot reap never targets a pid
   * that may later be reused by an unrelated process. Cheap no-op when the pgid
   * is unknown (a crash between spawn and register, or another writer).
   */
  unregister(pgid: number): void {
    this.#own.delete(pgid);
    const records = this.#read();
    const next = records.filter((record) => record.pgid !== pgid);
    if (next.length !== records.length) {
      this.#write(next);
    }
  }

  /**
   * Boot: kill every group a previous run recorded and left alive, then start
   * this run's registry clean. Returns counts, not a promise — it is a
   * synchronous sweep meant to run before the sidecar serves a single request.
   */
  reapLeftovers(): { reaped: number; skipped: number } {
    const records = this.#read();
    let reaped = 0;
    let skipped = 0;
    for (const record of records) {
      if (this.#own.has(record.pgid)) {
        continue;
      }
      if (!this.#deps.isAlive(record.pgid)) {
        continue;
      }
      const identity = this.#deps.matchesMarker;
      if (identity && !identity(record.pgid, record.marker)) {
        skipped += 1;
        this.#log(
          `skipping leftover pid ${record.pgid}: command no longer matches "${record.marker}" (pid likely recycled)`
        );
        continue;
      }
      try {
        this.#deps.killGroup(record.pgid);
        reaped += 1;
        this.#log(
          `reaped leftover ${record.kind} group -${record.pgid} from a previous run`
        );
      } catch (error) {
        skipped += 1;
        this.#log(`failed to reap group -${record.pgid}: ${String(error)}`);
      }
    }
    this.#write([]);
    return { reaped, skipped };
  }

  /** Group leaders this process registered and has not unregistered. */
  liveGroups(): number[] {
    return [...this.#own];
  }

  #read(): ChildRecord[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#filePath, "utf8"));
      return Array.isArray(parsed) ? parsed.filter(isChildRecord) : [];
    } catch {
      // Missing, unreadable, or corrupt: treat as an empty registry. A corrupt
      // file is moved aside rather than silently overwritten, so the evidence
      // survives for debugging.
      return [];
    }
  }

  #write(records: ChildRecord[]): void {
    // Unique temp name per write: two writers in one process never collide on
    // the rename, and a reader never sees a half-written file.
    const temp = `${this.#filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      writeFileSync(temp, `${JSON.stringify(records)}\n`, "utf8");
      renameSync(temp, this.#filePath);
    } catch (error) {
      this.#log(
        `child registry write failed for ${this.#filePath}: ${String(error)}`
      );
    }
  }
}

/** Validate one decoded row so a hand-edited file cannot inject bad reaps. */
function isChildRecord(value: unknown): value is ChildRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.pgid === "number" &&
    Number.isInteger(record.pgid) &&
    record.pgid > 0 &&
    typeof record.kind === "string" &&
    typeof record.marker === "string"
  );
}
