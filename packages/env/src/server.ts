import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    // Optional override for apps/server. When unset, @manobu/acp picks the
    // first ACP-speaking CLI on $PATH (opencode → claude → gemini → codex → copilot).
    ACP_AGENT_BIN: z.string().min(1).optional(),
    // Comma-separated MCP servers to attach to every agent session, e.g.
    // "jlpt-vocab:stdio:npx jlpt-mcp@latest,notes:http:http://localhost:3001/mcp".
    // Each entry is "<id>:<stdio|http|sse>:<command-or-url>". Servers whose
    // transport the agent doesn't advertise are warn-skipped (Tier 1.3).
    ACP_MCP_SERVERS: z.string().optional(),
    // Blocking `ask_user` tools/call deadline in apps/server (AskToolServer).
    // When the learner has not answered by then, the tool returns an isError
    // timeout text and the parked row settles to "error" (TASK-86/88).
    // Default when unset: 25 min (the AskToolServer default).
    ASK_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    // Engine deadline (packages/acp SessionController) for parked asks AND
    // permission cards. A backstop past ASK_TIMEOUT_MS so the tool-side
    // reply usually wins the race; both ultimately die if nobody answers.
    // Default when unset: 30 min (the SessionController default).
    CONFIRMATION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    // Comma-separated list of allowed CORS origins. In dev we typically run
    // a single Vite origin (http://localhost:3001); in the AppImage build the
    // WebView is loaded under the `tauri://localhost` scheme. Bundling both
    // — e.g. "http://localhost:3001,tauri://localhost" — keeps server-mode
    // debugging possible without redefining env.
    CONTENT_DATABASE_URL: z.string().min(1).optional(),
    CORS_ORIGIN: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    // (No PORT field.) Bun's auto-serve reads `BUN_PORT=4317` natively when
    // apps/server runs `export default app`. The Tauri sidecar sets that env
    // var directly via tauri-plugin-shell. Do NOT add a `PORT` field here —
    // an explicit `Bun.serve({port: …, fetch: app.fetch})` was tried and
    // broke V3-aware SSE streaming.
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
