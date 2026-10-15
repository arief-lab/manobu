/**
 * Bun test preload (`--preload ./test/setup.ts`, see `package.json`).
 *
 * Several `src/lib/*` modules import `@manobu/env/web`, which validates
 * `VITE_SERVER_URL` at import time. Bun auto-loads `apps/desktop/.env`
 * locally, but CI checkouts may not have one — default the variable here
 * so env-coupled imports validate deterministically. No test in `test/`
 * hits the network (offline corpus fallbacks cover every path), so the
 * dummy URL is never fetched; an explicit `.env` value still wins via
 * `??=`.
 */
process.env.VITE_SERVER_URL ??= "http://127.0.0.1:4317";
