import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/*
 * TASK-52: bun test sets NODE_ENV=test but supplies no Vite env — any test
 * file that (transitively) imports this module crashed at import time with
 * "Invalid environment variables: VITE_SERVER_URL expected string" when
 * invoked outside the owning package (root-level `bun test` picks up test
 * files across packages via substring filtering; per-package --preload/
 * --env-file don't apply). Under test, default the URL so validation
 * passes; no test hits the network. Real builds and `bun run dev` keep
 * full strictness — unset VITE_SERVER_URL outside tests still throws.
 */
const TEST_SERVER_URL = "http://127.0.0.1:4317";

export const env = createEnv({
  client: {
    VITE_DEBUG: z
      .enum(["1"])
      .optional()
      .transform((v) => (v ? "1" : undefined)),
    VITE_SERVER_URL: z.url(),
  },
  clientPrefix: "VITE_",
  emptyStringAsUndefined: true,
  runtimeEnv:
    process.env.NODE_ENV === "test" && !import.meta.env.VITE_SERVER_URL
      ? { ...import.meta.env, VITE_SERVER_URL: TEST_SERVER_URL }
      : import.meta.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
