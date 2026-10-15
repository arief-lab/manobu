#!/usr/bin/env bash
# TASK-151: build and stage the two release sidecars exactly where
# tauri.conf.json's `bundle.externalBin` resolves them:
#   apps/server/dist/server-x86_64-unknown-linux-gnu
#     <- `bun run compile:linux` writes this path directly (apps/server/package.json:9)
#   crates/jlpt-mcp/dist/jlpt-mcp-x86_64-unknown-linux-gnu
#     <- copied from `cargo build --release` output (crates/jlpt-mcp/target/release/jlpt-mcp)
#
# TARGET_TRIPLE selects the platform (default: the linux pair above). Set it to
# `x86_64-pc-windows-msvc` to stage server-x86_64-pc-windows-msvc.exe and
# jlpt-mcp-x86_64-pc-windows-msvc.exe for a Windows bundle cross-built here.
#
# Then run the freshness guard over each staged binary:
#   1. sha256(staged) must equal sha256(build output) — the staged bytes are
#      today's build, not leftover bytes from an earlier one (AC#2).
#   2. staged mtime must not predate the newest source that produces it —
#      catching a staged binary that no build step this run refreshed (AC#4).
# A failure names the sidecar and both facts and exits non-zero, so
# `tauri build` cannot package stale sidecars silently.
#
# Modes:
#   (default)  build + stage + guard. This is `beforeBuildCommand`.
#   --check    guard only, no build: prove the staged binaries are fresh
#              against the current sources.
#
# The server's producing sources are its src/ plus the @manobu/* package src
# trees that `bun build --compile` bundles into the single-file binary; runtime
# data is NOT baked in (it resolves MANOBU_DATA_DIR at request time, the
# TASK-47 watch boundary from scripts/sidecar-dev.sh). The jlpt-mcp sources are
# its Rust tree plus the corpus files build.rs embeds (the exact
# cargo:rerun-if-changed list, crates/jlpt-mcp/build.rs:19-47).
set -euo pipefail

MODE="stage"
if [ "$#" -gt 0 ]; then
  case "$1" in
    --check) MODE="check" ;;
    *)
      echo "usage: sidecar-stage.sh [--check]" >&2
      exit 2
      ;;
  esac
  shift
fi
if [ "$#" -gt 0 ]; then
  echo "usage: sidecar-stage.sh [--check]" >&2
  exit 2
fi

MANOBU_ROOT="${MANOBU_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"

# TARGET_TRIPLE is the suffix that `bundle.externalBin` resolves, so it has to
# match the build's `--target` exactly. Linux is the default and the unchanged
# contract; a windows triple switches four dependent facts at once: the bun
# compile script, the cargo output directory, the linker driver (cargo-xwin
# feeds clang-cl the MSVC CRT and SDK that a Linux host does not have), and the
# `.exe` suffix Tauri appends when it looks the binary up. This script is still
# bash and still calls GNU `stat -c`/`sha256sum`/`find -newer`, which is fine
# because the Windows targets are BUILT HERE, on Linux. Building this repo's
# release on a Windows host would need the whole script rewritten in TS first.
TARGET_TRIPLE="${TARGET_TRIPLE:-x86_64-unknown-linux-gnu}"
case "$TARGET_TRIPLE" in
  x86_64-unknown-linux-gnu)
    SERVER_COMPILE_SCRIPT="compile:linux"
    CARGO_CMD=(cargo build --release)
    EXE_SUFFIX=""
    ;;
  x86_64-pc-windows-msvc)
    SERVER_COMPILE_SCRIPT="compile:windows"
    CARGO_CMD=(cargo xwin build --release --target "$TARGET_TRIPLE")
    EXE_SUFFIX=".exe"
    ;;
  *)
    echo "[stage] unsupported TARGET_TRIPLE=$TARGET_TRIPLE (expected x86_64-unknown-linux-gnu or x86_64-pc-windows-msvc)" >&2
    exit 2
    ;;
esac

SERVER_APP_DIR="$MANOBU_ROOT/apps/server"
SERVER_STAGED="$SERVER_APP_DIR/dist/server-$TARGET_TRIPLE$EXE_SUFFIX"

MCP_CRATE_DIR="$MANOBU_ROOT/crates/jlpt-mcp"
if [ -n "$EXE_SUFFIX" ]; then
  MCP_TARGET_DIR="$MCP_CRATE_DIR/target/$TARGET_TRIPLE/release"
else
  MCP_TARGET_DIR="$MCP_CRATE_DIR/target/release"
fi
MCP_BUILT="$MCP_TARGET_DIR/jlpt-mcp$EXE_SUFFIX"
MCP_STAGED="$MCP_CRATE_DIR/dist/jlpt-mcp-$TARGET_TRIPLE$EXE_SUFFIX"

# TASK-38's four-leg rule applies per platform: bun `--compile` cannot embed a
# `.node` addon, `bundle.resources` maps it in, and `lib.rs` pins the sidecar
# CWD so the runtime `require()` walk finds it. The windows leg needs the
# store path to exist on the build host, and `bun install` only materializes
# the optional dependency matching the HOST platform, so a cross build has to
# say so out loud instead of letting tauri fail on the resource map.
LIBSQL_WIN32_STORE="$MANOBU_ROOT/node_modules/.bun/@libsql+win32-x64-msvc@0.5.29/node_modules/@libsql/win32-x64-msvc"

SERVER_SOURCES=(
  "$SERVER_APP_DIR/src"
  "$MANOBU_ROOT/packages/acp/src"
  "$MANOBU_ROOT/packages/agent/src"
  "$MANOBU_ROOT/packages/api-contract/src"
  "$MANOBU_ROOT/packages/db/src"
  "$MANOBU_ROOT/packages/env/src"
  "$MANOBU_ROOT/packages/item-engine/src"
  "$MANOBU_ROOT/packages/japanese/src"
  "$MANOBU_ROOT/packages/srs/src"
)

MCP_SOURCES=(
  "$MCP_CRATE_DIR/src"
  "$MCP_CRATE_DIR/build.rs"
  "$MCP_CRATE_DIR/Cargo.toml"
  "$MCP_CRATE_DIR/Cargo.lock"
  "$MANOBU_ROOT/packages/japanese/data/n1.json"
  "$MANOBU_ROOT/packages/japanese/data/n2.json"
  "$MANOBU_ROOT/packages/japanese/data/n3.json"
  "$MANOBU_ROOT/packages/japanese/data/n4.json"
  "$MANOBU_ROOT/packages/japanese/data/n5.json"
  "$MANOBU_ROOT/packages/japanese/data/grammar/n1.json"
  "$MANOBU_ROOT/packages/japanese/data/grammar/n2.json"
  "$MANOBU_ROOT/packages/japanese/data/grammar/n3.json"
  "$MANOBU_ROOT/packages/japanese/data/grammar/n4.json"
  "$MANOBU_ROOT/packages/japanese/data/grammar/n5.json"
  "$MANOBU_ROOT/packages/japanese/data/grammar/conjugations.json"
  "$MANOBU_ROOT/packages/japanese/data/kanji.json"
  "$MANOBU_ROOT/packages/japanese/data/pitch-accent.json"
  "$MANOBU_ROOT/packages/japanese/data/sentences/sentences.jsonl"
  "$MANOBU_ROOT/packages/japanese/data/kanjivg/kanjivg.jsonl"
)

failures=0

fail() {
  echo "[stage] FAIL $1" >&2
  failures=$((failures + 1))
}

timestamp() {
  date -u -d "@$(stat -c '%Y' "$1")" '+%Y-%m-%d %H:%M:%S UTC'
}

sha() {
  sha256sum "$1" | cut -d' ' -f1
}

# guard <name> <staged> <built-or-same> <source...>
guard() {
  local name="$1" staged="$2" built="$3"
  shift 3
  local sources=("$@")

  if [ ! -f "$staged" ]; then
    fail "$name: staged binary missing at $staged"
    return
  fi

  # Fact pair 1: staged bytes must be the bytes of this build's output.
  if [ "$staged" != "$built" ]; then
    if [ ! -f "$built" ]; then
      fail "$name: build output missing at $built — run without --check to produce it"
      return
    fi
    local staged_sha built_sha
    staged_sha=$(sha "$staged")
    built_sha=$(sha "$built")
    if [ "$staged_sha" != "$built_sha" ]; then
      fail "$name: staged sha256 $staged_sha != build-output sha256 $built_sha"
      return
    fi
  fi

  # Fact pair 2: staged must not predate the newest producing source.
  # Same POSIX-`find -newer` freshness idiom as scripts/sidecar-dev.sh.
  local newest=""
  local hit
  local candidate
  for candidate in "${sources[@]}"; do
    if [ -d "$candidate" ]; then
      while IFS= read -r hit; do
        if [ -z "$newest" ] || [ "$hit" -nt "$newest" ]; then
          newest="$hit"
        fi
      done < <(find "$candidate" -type f -newer "$staged" -print)
    elif [ -f "$candidate" ] && [ "$candidate" -nt "$staged" ]; then
      if [ -z "$newest" ] || [ "$candidate" -nt "$newest" ]; then
        newest="$candidate"
      fi
    fi
  done
  if [ -n "$newest" ]; then
    fail "$name: staged mtime $(timestamp "$staged") predates source $newest ($(timestamp "$newest"))"
  fi
}

if [ "$MODE" = "stage" ]; then
  echo "[stage] building apps/server (bun $SERVER_COMPILE_SCRIPT)"
  ( cd "$SERVER_APP_DIR" && bun run "$SERVER_COMPILE_SCRIPT" )

  echo "[stage] building crates/jlpt-mcp (${CARGO_CMD[*]})"
  ( cd "$MCP_CRATE_DIR" && "${CARGO_CMD[@]}" )

  echo "[stage] staging jlpt-mcp → $MCP_STAGED"
  mkdir -p "$MCP_CRATE_DIR/dist"
  # cp (no -p): the staged mtime becomes "now", which is the freshness fact the
  # guard reads. The build ran first, so sources cannot postdate it.
  cp -f "$MCP_BUILT" "$MCP_STAGED"
  chmod +x "$MCP_STAGED"
fi

echo "[stage] guarding staged sidecars (mode: $MODE)"
guard "server" "$SERVER_STAGED" "$SERVER_STAGED" "${SERVER_SOURCES[@]}"
guard "jlpt-mcp" "$MCP_STAGED" "$MCP_BUILT" "${MCP_SOURCES[@]}"

if [ -n "$EXE_SUFFIX" ] && [ ! -f "$LIBSQL_WIN32_STORE/index.node" ]; then
  fail "libsql: the windows native addon is not materialized at $LIBSQL_WIN32_STORE - run \`bun install --os='*' --cpu='*'\` before bundling, or every packaged run dies with \"Cannot find module '@libsql/win32-x64-msvc'\""
fi

if [ "$failures" -gt 0 ]; then
  echo "[stage] $failures sidecar(s) failed the freshness guard" >&2
  exit 1
fi
echo "[stage] all staged sidecars fresh"
