#!/usr/bin/env node
"use strict";
/**
 * `@manobu/jlpt-mcp` bin shim (TASK-22 Tier C3 — ACP Registry publish).
 *
 * Resolves the real Rust `jlpt-mcp` binary and execs it with all arguments:
 *   1. `MANOBU_JLPT_MCP_BIN` env (explicit override)
 *   2. Tauri sidecar layout — `src-tauri/binaries/jlpt-mcp` next to the
 *      running app (dev + packaged)
 *   3. `crates/jlpt-mcp/target/{release,debug}/jlpt-mcp` (repo checkout)
 *
 * Exit code mirrors the child so `healthCheck: {versionCommand:
 * "jlpt-mcp --version"}` style probes work unchanged.
 */

const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

function resolveBinary() {
  if (process.env.MANOBU_JLPT_MCP_BIN) {
    return process.env.MANOBU_JLPT_MCP_BIN;
  }
  // bin/ → package → packages/ → repo root
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const candidates = [
    // Tauri sidecar layout (dev + packaged: binaries/ sits next to the app).
    path.join(repoRoot, "apps", "desktop", "src-tauri", "binaries", "jlpt-mcp"),
    // Repo checkout build outputs.
    path.join(repoRoot, "crates", "jlpt-mcp", "target", "release", "jlpt-mcp"),
    path.join(repoRoot, "crates", "jlpt-mcp", "target", "debug", "jlpt-mcp"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const binary = resolveBinary();
if (!binary) {
  process.stderr.write(
    "jlpt-mcp binary not found — build it with: cargo build --release -p jlpt-mcp\n"
  );
  process.exit(127);
}

const result = spawnSync(binary, process.argv.slice(2), {
  env: process.env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
