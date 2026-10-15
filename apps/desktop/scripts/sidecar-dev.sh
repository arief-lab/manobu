#!/usr/bin/env bash
# Build the app sidecar binaries and place them where Tauri's
# `shell().sidecar(...)` finds them in dev mode:
#   apps/desktop/src-tauri/binaries/<name>-x86_64-unknown-linux-gnu
#
# Sidecars:
#   - server    → the Hono API backend (apps/server), bun-compiled Linux ELF,
#                 spawned by lib.rs
#   - jlpt-mcp  → the JLPT vocab stdio MCP server. Rust port at
#                 crates/jlpt-mcp (cargo release build), spawned by the ACP
#                 agent via ACP_MCP_SERVERS
#
# Idempotent. Skips the build step when neither source nor compiled binary
# changed since the last copy.
#
# Runs from Tauri as part of `beforeDevCommand` via `bun run scripts/sidecar-dev.sh`.
# Bun's built-in shell rejects `[[ -nt ]]` so we use POSIX-`stat` `find -newer`
# instead.
set -euo pipefail

MANOBU_ROOT="${MANOBU_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
TAURI_DIR="$MANOBU_ROOT/apps/desktop/src-tauri"
DEST_DIR="$TAURI_DIR/binaries"
TARGET_TRIPLE="x86_64-unknown-linux-gnu"

mkdir -p "$DEST_DIR"

# TASK-48: an unclean previous shutdown (kill -9 of the app/dev stack) can
# leave the old sidecar alive, squatting :4317 — the next boot's sidecar
# then dies with EADDRINUSE and the health wait burns 30s before a vague
# timeout. Kill any of OUR sidecar binaries still running from the dev
# binaries dir (exact-path match; never a pattern that could hit other
# processes). They hold no state worth preserving: the user db is a file.
# tauri dev spawns the sidecar as target/debug/server (it copies externalBin
# next to the app binary); the binaries/server-…gnu path is the pre-copy
# artifact. Match both — the pgrep pattern is repo-anchored on both sides
# (leading path literal) so it can never hit unrelated "server" processes.
ORPHAN_PIDS=$(pgrep -f "$TAURI_DIR/target/debug/server" 2>/dev/null || true)
ORPHAN_PIDS="$ORPHAN_PIDS $(pgrep -f "$DEST_DIR/server-$TARGET_TRIPLE" 2>/dev/null || true)"
if [ -n "$ORPHAN_PIDS" ]; then
  echo "[sidecar] killing orphaned sidecar(s) from a previous boot: $ORPHAN_PIDS"
  kill $ORPHAN_PIDS 2>/dev/null || true
  sleep 1
  # Still alive (stuck in a syscall)? Escalate.
  # tauri dev spawns the sidecar as target/debug/server (it copies externalBin
# next to the app binary); the binaries/server-…gnu path is the pre-copy
# artifact. Match both — the pgrep pattern is repo-anchored on both sides
# (leading path literal) so it can never hit unrelated "server" processes.
ORPHAN_PIDS=$(pgrep -f "$TAURI_DIR/target/debug/server" 2>/dev/null || true)
ORPHAN_PIDS="$ORPHAN_PIDS $(pgrep -f "$DEST_DIR/server-$TARGET_TRIPLE" 2>/dev/null || true)"
  [ -n "$ORPHAN_PIDS" ] && kill -9 $ORPHAN_PIDS 2>/dev/null || true
fi

# <name> <build-kind> <app-dir> <source-file-that-triggers-rebuild>
# build-kind: "bun" → `bun run compile:linux`; "cargo" → `cargo build --release`
SIDECARS=(
  "server bun apps/server src/index.ts"
  "jlpt-mcp cargo crates/jlpt-mcp src/main.rs"
)

for entry in "${SIDECARS[@]}"; do
  read -r NAME BUILD_KIND APP_DIR SRC_INDEX_REL <<<"$entry"
  APP_PATH="$MANOBU_ROOT/$APP_DIR"
  SRC_INDEX="$APP_PATH/$SRC_INDEX_REL"
  DEST_BIN="$DEST_DIR/$NAME-$TARGET_TRIPLE"

  case "$BUILD_KIND" in
    bun)
      SRC_BIN="$APP_PATH/dist/$NAME-$TARGET_TRIPLE"
      ;;
    cargo)
      SRC_BIN="$APP_PATH/target/release/$NAME"
      ;;
  esac

  # cargo: always rebuild — `cargo build --release` is incremental (~0.15s
  # when fresh) and watches every source + data file, unlike a main.rs-only
  # freshness check, which would sync stale binaries after engine/data edits.
  if [ "$BUILD_KIND" = "cargo" ]; then
    echo "[sidecar] compiling $APP_DIR → $SRC_BIN"
    ( cd "$APP_PATH" && cargo build --release )
  else
    # bun: rebuild only when stale. We rebuild if any of these is true:
    #   - source or destination binary is missing
    #   - ANY file under $APP_PATH/src is newer than the compiled binary
    #     (TASK-46: watching only index.ts served stale binaries after
    #     route/lib edits — jap-data.ts, data-dir.ts, index.ts boot code
    #     all silently skipped)
    #   - destination copy is older than the compiled binary
    #
    # WATCH BOUNDARY (TASK-47): src/** covers CODE only. Runtime-read files
    # outside src/ are deliberately NOT rebuild triggers:
    #   - assistant/*.md   → refreshed by the persona sync below, every boot
    #   - japanese data    → MANOBU_DATA_DIR resolves at request time from
    #     packages/japanese/data; never baked into the bundle. If anyone
    #     bakes data into the compiled binary, they MUST extend this watch.
    NEEDS_BUILD=1
    if [ -f "$SRC_BIN" ] && [ -f "$DEST_BIN" ]; then
      STALE_SRC=$(find "$APP_PATH/src" -type f -newer "$SRC_BIN" -print -quit 2>/dev/null)
      if [ -z "$STALE_SRC" ] && [ "$DEST_BIN" -nt "$SRC_BIN" ]; then
        NEEDS_BUILD=0
      fi
    fi
    if [ "$NEEDS_BUILD" = "1" ]; then
      echo "[sidecar] compiling $APP_DIR → $SRC_BIN"
      ( cd "$APP_PATH" && bun run compile:linux )
    fi
  fi

  echo "[sidecar] syncing binary → $DEST_BIN"
  cp -f "$SRC_BIN" "$DEST_BIN"
  chmod +x "$DEST_BIN"
  SIZE=$(stat -c '%s' "$DEST_BIN" 2>/dev/null || echo "?")
  echo "[sidecar] ready: $DEST_BIN (${SIZE} bytes)"

  # TASK-53 flake fix: in dev, tauri spawns the externalBin COPY at
  # target/debug/<name> (made when the APP recompiles — not on every
  # script run). Without this refresh, a mid-session route edit +
  # manual sidecar restart silently runs the boot-time binary: HTTP 200,
  # stale logic (the TASK-53 replay hit exactly this). Refresh it unless
  # the running app holds the file (Text file busy) — the next full boot
  # re-copies anyway.
  DEV_COPY="$TAURI_DIR/target/debug/$NAME"
  if [ -f "$DEV_COPY" ]; then
    if cp -f "$DEST_BIN" "$DEV_COPY" 2>/dev/null; then
      chmod +x "$DEV_COPY"
      echo "[sidecar] dev copy refreshed → $DEV_COPY"
    else
      echo "[sidecar] dev copy busy (running) — left as-is"
    fi
  fi

  # For the Tauri bundle, externalBin resolves the binary from the dist dir
  # with the target-triple suffix appended (see tauri.conf.json). Sync the
  # cargo artifact there too so `tauri build` finds it.
  if [ "$BUILD_KIND" = "cargo" ]; then
    DIST_BIN="$APP_PATH/dist/$NAME-$TARGET_TRIPLE"
    mkdir -p "$APP_PATH/dist"
    cp -f "$SRC_BIN" "$DIST_BIN"
    chmod +x "$DIST_BIN"
    echo "[sidecar] dist sync → $DIST_BIN"
  fi

  # bun: the compiled server resolves native addons (libsql's
  # `require("@libsql/linux-x64-gnu")`, TASK-38) from a node_modules walk
  # relative to the sidecar CWD — NOT embedded in the single-file binary.
  # Mirror the platform package next to the destination binary so dev-mode
  # (cwd = binaries dir, set by lib.rs) resolves it. Packaged builds get
  # the same layout via tauri.conf.json bundle.resources.
  if [ "$NAME" = "server" ]; then
    NATIVE_SRC="$MANOBU_ROOT/node_modules/@libsql/linux-x64-gnu"
    NATIVE_DEST="$DEST_DIR/node_modules/@libsql/linux-x64-gnu"
    if [ -d "$NATIVE_SRC" ]; then
      mkdir -p "$(dirname "$NATIVE_DEST")"
      rm -rf "$NATIVE_DEST"
      # -L: repo-root node_modules/@libsql/* are SYMLINKS into the .bun
      # store (isolated linker) with RELATIVE targets — copying them as
      # links leaves a dangling path next to the sidecar binary.
      cp -rL "$NATIVE_SRC" "$NATIVE_DEST"
      echo "[sidecar] native libsql module → $NATIVE_DEST"
    else
      echo "[sidecar] WARN: $NATIVE_SRC missing — run bun install at the repo root"
    fi
  fi
done

# Sync the assistant (persona) markdown files next to the server binary so
# the compiled server can resolve `assistant/*.md` via MANOBU_ASSISTANT_DIR
# (set by lib.rs) or the exec-relative fallback. Persona edits are picked up
# without recompiling the server.
ASSISTANT_SRC="$MANOBU_ROOT/assistant"
# TASK-47: the ONLY dev persona copy tauri reads is the staged resource dir
# target/debug/assistant (lib.rs resolves exe-parent first, and in dev the
# exe parent IS target/debug). binaries/assistant is read by nothing —
# packaged builds bundle straight from repo root (tauri.conf.json resources)
# — so we do not maintain it. Sync refreshes staging for boots where tauri
# does not recompile (no resource re-stage), eliminating the stale-copy trap.
ASSISTANT_STAGE_DEST="$TAURI_DIR/target/debug/assistant"
if [ -d "$ASSISTANT_SRC" ]; then
  mkdir -p "$ASSISTANT_STAGE_DEST"
  # TASK-48: cp errors are NOT swallowed — a failed copy must fail the dev
  # boot visibly (beforeDevCommand exits nonzero), never boot with missing
  # or stale personas silently.
  cp -f "$ASSISTANT_SRC"/*.md "$ASSISTANT_STAGE_DEST"/
  # TASK-48: prune — removed personas must disappear from staging too, or
  # a deleted persona keeps loading in dev forever from the stale copy.
  for staged in "$ASSISTANT_STAGE_DEST"/*.md; do
    [ -f "$staged" ] || continue
    base=$(basename "$staged")
    [ -f "$ASSISTANT_SRC/$base" ] || rm -f "$staged"
  done
  echo "[sidecar] synced personas → $ASSISTANT_STAGE_DEST ($(ls "$ASSISTANT_STAGE_DEST"/*.md 2>/dev/null | wc -l) files)"
else
  echo "[sidecar] warning: no $ASSISTANT_SRC directory — persona markdown will not be bundled"
fi
