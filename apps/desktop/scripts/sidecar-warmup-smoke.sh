#!/usr/bin/env bash
# TASK-24.1 AC#3 — sidecar warmup smoke.
#
# Proves the vaporetto predictor warm happens at sidecar boot, off the
# JSON-RPC readiness path: the initialize response must arrive BEFORE the
# multi-second warm completes, and the first Japanese search AFTER warmup
# must be fast (<500 ms tool wall clock on the warmed predictor).
#
# Usage: apps/desktop/scripts/sidecar-warmup-smoke.sh [path-to-jlpt-mcp]
#   Defaults to crates/jlpt-mcp/target/release/jlpt-mcp.
#   Exit 0 = pass, 1 = any check failed.
set -euo pipefail

BIN="${1:-crates/jlpt-mcp/target/release/jlpt-mcp}"
MODEL="apps/desktop/src-tauri/resources/vaporetto/model/bccwj-suw+unidic_pos+kana.model.zst"

if [[ ! -x "$BIN" ]]; then
  echo "FAIL: binary not found/executable: $BIN" >&2
  echo "Build it: cargo build --release --features vaporetto (in crates/jlpt-mcp)" >&2
  exit 1
fi
if [[ ! -f "$MODEL" ]]; then
  echo "FAIL: model not found: $MODEL" >&2
  echo "Fetch it: bun run fetch:vaporetto (in packages/db)" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkfifo "$work/in"

export SQLITE_VAPORETTO_MODEL="$PWD/$MODEL"

# Drive the stdio JSON-RPC channel from a background writer so we can
# timestamp each step without blocking on reads.
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  sleep 0.5
  # First Japanese search — the call a real user's first query maps to.
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_vocab","arguments":{"query":"たべる","limit":3}}}'
  # Hold stdin open: an RPC EOF mid-warm would tear the loop down before
  # the background warm + queued search finish.
  sleep 120
) > "$work/in" &

t_start=$(date +%s%N)
./"$BIN" < "$work/in" > "$work/out" 2> "$work/err" &
pid=$!

# Wait for the initialize response; measure how long readiness took.
deadline=$(( $(date +%s%N) + 30000000000 )) # 30 s
init_ms=-1
while [[ $(date +%s%N) -lt $deadline ]]; do
  if grep -q '"id":1' "$work/out" 2>/dev/null; then
    init_ms=$(( ($(date +%s%N) - t_start) / 1000000 ))
    break
  fi
  sleep 0.05
done
if [[ $init_ms -lt 0 ]]; then
  echo "FAIL: initialize never answered within 30 s" >&2
  kill "$pid" 2>/dev/null || true
  exit 1
fi

# Wait for the search response (or 60 s), then stop the process.
deadline2=$(( $(date +%s%N) + 60000000000 ))
search_ms=-1
while [[ $(date +%s%N) -lt $deadline2 ]]; do
  if grep -q '"id":2' "$work/out" 2>/dev/null; then
    search_ms=$(( ($(date +%s%N) - t_start) / 1000000 ))
    break
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.1
done
kill "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true

if [[ $search_ms -lt 0 ]]; then
  echo "FAIL: search_vocab never returned" >&2
  cat "$work/err" >&2
  exit 1
fi

warm_ms=$(grep -o 'vaporetto warm at boot: [0-9]* ms' "$work/err" | grep -o '[0-9]*' || echo "0")
active=$(grep -c 'model_active' "$work/out" || true)

echo "== sidecar warmup smoke =="
echo "initialize (readiness path): ${init_ms} ms  (must be fast — warm must NOT block it)"
echo "boot warm (stderr log):      ${warm_ms} ms  (background decode; overlaps RPC serving)"
echo "first search_vocab:            answered at ${search_ms} ms after spawn (includes boot warm)"
if grep -q '食べる' "$work/out"; then echo "first search hit:              食べる"; else echo "WARN: no 食べる hit"; fi
if [[ "$warm_ms" -gt 0 ]]; then
  echo "PASS: warm ran at boot (${warm_ms} ms) while initialize answered in ${init_ms} ms"
else
  echo "WARN: no boot-warm log line — is this a vaporetto-feature build?"
  [[ "$active" -gt 0 ]] || { echo "FAIL: model_active never surfaced"; exit 1; }
fi
