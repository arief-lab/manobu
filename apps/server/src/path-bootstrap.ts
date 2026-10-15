/**
 * Agent PATH bootstrap (TASK-153 AC#4).
 *
 * A packaged desktop app is launched by systemd/DDE/wlroots, NOT by a shell:
 * its `PATH` is the minimal system one (`/usr/bin:/bin:…`), so every CLI
 * agent installed through a version manager — nvm's node, `~/.bun/bin`,
 * mise shims (where `opencode` lives on this host), `~/.cargo/bin` — is
 * invisible. The symptom: `GET /agents` reports nothing installed and
 * `resolveSpawnTarget` throws, even though the binary is on disk three
 * directories away from the user's home.
 *
 * Fix: at boot, before anything reads `process.env.PATH`, prepend each
 * per-user bin directory that actually EXISTS (never a phantom entry, never
 * a duplicate of what PATH already carries). Two consumers get fixed by the
 * one augmentation: `which()`/`listAgentCandidates` walk `process.env.PATH`
 * for the picker, and `agentChildEnv()` copies `process.env` into every
 * spawned agent, so the child's own tool subprocesses inherit the same view.
 *
 * Windows (TASK-177) is the same problem with two extra traps: the entries
 * are under `%USERPROFILE%\AppData\…` rather than the dot-directories, and the
 * separator is `;`, so joining with `:` would hand the child one mangled PATH
 * entry instead of a list. Both are driven by the `platform` argument, which
 * defaults to `process.platform` and is faked in the tests.
 *
 * `exists`/`listDir`/`home` are injected so the directory discovery
 * unit-tests against a fake filesystem instead of the developer's dotfiles.
 */

import { existsSync, readdirSync } from "node:fs";
import { posix, win32 } from "node:path";

export interface PathBootstrapDeps {
  exists: (path: string) => boolean;
  listDir: (path: string) => string[];
}

export interface PathBootstrapResult {
  /** Directories newly prepended to PATH this boot, in PATH order. */
  added: string[];
  /** The full new PATH string. */
  path: string;
}

const PATH_SEP = ":";
/** `;` on Windows, where `:` would clobber PATH instead of extending it. */
const PATH_SEP_WIN = ";";
/** Leading `v` in nvm version dir names (`v22.3.0`). */
const NVM_VERSION_PREFIX = /^v/;
/** nvm-windows names its version dirs `v22.3.0` too, and keeps node.exe in it. */
const NVM_WINDOWS_VERSION_DIR = /^v\d/;

/** PATH entry separator for the platform whose PATH we are editing. */
function pathSeparator(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? PATH_SEP_WIN : PATH_SEP;
}

/**
 * Candidate per-user bin directories, in prepend order (earlier wins a name
 * collision). For nvm, only the highest-installed version is used — sorting
 * `v22.3.0`-style names numerically by segment, newest first.
 *
 * The POSIX list is the version-manager layout of a Linux dev box. Windows
 * keeps the same tools under `%USERPROFILE%\AppData` (Roaming for npm and
 * nvm-windows, Local for pnpm and mise), so the list is a separate set rather
 * than the same names under a different root.
 */
export function agentBinDirs(
  home: string,
  deps: PathBootstrapDeps,
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform === "win32") {
    return win32AgentBinDirs(home, deps);
  }
  const dirs: string[] = [];
  const nvmRoot = posix.join(home, ".nvm", "versions", "node");
  if (deps.exists(nvmRoot)) {
    const latest = deps
      .listDir(nvmRoot)
      .filter((name) => deps.exists(posix.join(nvmRoot, name, "bin")))
      .sort(compareNodeVersions)
      .pop();
    if (latest) {
      dirs.push(posix.join(nvmRoot, latest, "bin"));
    }
  }
  dirs.push(
    posix.join(home, ".bun", "bin"),
    posix.join(home, ".local", "share", "bun", "bin"),
    posix.join(home, ".local", "share", "mise", "shims"),
    posix.join(home, ".cargo", "bin")
  );
  return dirs.filter((dir) => deps.exists(dir));
}

/**
 * Windows half of `agentBinDirs`, kept separate so the POSIX list above stays
 * one flat list. Every path is built with `win32.join` (backslashes) because a
 * sidecar on Windows and a unit test on Linux must agree on the shape.
 */
function win32AgentBinDirs(home: string, deps: PathBootstrapDeps): string[] {
  const dirs: string[] = [];
  const appData = win32.join(home, "AppData", "Roaming");
  const localAppData = win32.join(home, "AppData", "Local");
  const nvmRoot = win32.join(appData, "nvm");
  if (deps.exists(nvmRoot)) {
    const latest = deps
      .listDir(nvmRoot)
      .filter((name) => NVM_WINDOWS_VERSION_DIR.test(name))
      .filter((name) => deps.exists(win32.join(nvmRoot, name)))
      .sort(compareNodeVersions)
      .pop();
    if (latest) {
      dirs.push(win32.join(nvmRoot, latest));
    }
  }
  dirs.push(
    win32.join(home, ".bun", "bin"),
    win32.join(appData, "npm"),
    win32.join(localAppData, "pnpm"),
    win32.join(localAppData, "mise", "shims"),
    win32.join(home, ".cargo", "bin")
  );
  return dirs.filter((dir) => deps.exists(dir));
}

/** `v22.10.0` > `v22.9.1` > `v9.11.0`: numeric per segment, missing = 0. */
export function compareNodeVersions(a: string, b: string): number {
  const left = versionSegments(a);
  const right = versionSegments(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function versionSegments(name: string): number[] {
  return name
    .replace(NVM_VERSION_PREFIX, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/**
 * Pure PATH merge: prepend `dirs` that are not already entries, keep the
 * rest of `currentPath` in order. Empty entries are dropped (a trailing `:`
 * means "cwd" in POSIX and we must not smuggle that in).
 *
 * Dedup is exact-string, so a Windows entry that differs only by case or a
 * trailing `\` is added again. Harmless (the loader walks entries in order),
 * and case-folding would drop a legitimately distinct POSIX directory.
 */
export function prependMissingPaths(
  currentPath: string,
  dirs: readonly string[],
  platform: NodeJS.Platform = process.platform
): { added: string[]; path: string } {
  const sep = pathSeparator(platform);
  const existing = currentPath.split(sep).filter((entry) => entry !== "");
  const seen = new Set(existing);
  const added: string[] = [];
  for (const dir of dirs) {
    if (!seen.has(dir)) {
      seen.add(dir);
      added.push(dir);
    }
  }
  return { added, path: added.concat(existing).join(sep) };
}

/**
 * Boot entry point: discover the dirs, merge them into `process.env.PATH`,
 * and report what changed. Mutates only PATH — the whole design is that
 * `agentChildEnv()`'s env copy then carries the fix for free.
 *
 * `HOME` is the POSIX home; a Windows sidecar launched by the Tauri shell
 * gets `USERPROFILE` and often no `HOME` at all, so the missing one is the
 * common case rather than a fallback.
 */
export function bootstrapAgentPath(
  env: NodeJS.ProcessEnv = process.env,
  deps: Partial<PathBootstrapDeps> = {},
  platform: NodeJS.Platform = process.platform
): PathBootstrapResult {
  const full: PathBootstrapDeps = {
    exists: (candidate) => existsSync(candidate),
    listDir: (dir) => readdirSync(dir),
    ...deps,
  };
  const home = env.HOME ?? env.USERPROFILE ?? "";
  const currentPath = env.PATH ?? "";
  const { added, path } = prependMissingPaths(
    currentPath,
    home.length > 0 ? agentBinDirs(home, full, platform) : [],
    platform
  );
  if (added.length > 0) {
    env.PATH = path;
    console.log(
      `[sidecar] PATH augmented with agent bin dirs: ${added.join(", ")}`
    );
  }
  return { added, path };
}
