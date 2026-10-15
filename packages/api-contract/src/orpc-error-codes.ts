/**
 * oRPC error-code registry (TASK-80.9).
 *
 * oRPC's default `ORPCErrorCode` is `keyof COMMON_ERROR_STATUS_MAP | (string & {})`
 * — every string is a legal code, so a stray `throw new ORPCError("WHATEVER")`
 * with a made-up code type-checks. This module-augments the global `Registry`
 * to narrow `ORPCErrorCode` to the codes this contract declares, so stray
 * codes are a compile error. Doc-sanctioned: orpc.dev/docs/error-handling
 * ("ORPC Error Codes"). No `(string & {})` fallback on purpose: the point is
 * rejection, not autocomplete. `@orpc`'s own `.d.ts` (skipped by
 * skipLibCheck) and cross-package generics are unaffected; only this repo's
 * source literals are checked.
 *
 * Target module: `@orpc/contract`. In this oRPC beta (2.0.0-beta.35) the
 * global `Registry` interface is declared in `@orpc/shared`; `@orpc/contract`
 * re-exports it (the same symbol), and `@orpc/contract` is the only
 * `@orpc/*` module in this package's dependency graph (adding `@orpc/shared`
 * as a direct dependency just to name it as the augmentation target is
 * unnecessary indirection when the re-exported symbol is mergeable).
 *
 * Why a `.ts` side-effect import from `index.ts` (not a loose `.d.ts`): the
 * package ships source (`exports "." → ./src/index.ts`), so consumers'
 * typecheck programs only load files reachable from `index.ts`. A loose
 * declaration file in `src/` is in this package's own tsc program
 * (`include: ["src"]`) but would NOT propagate to apps/server,
 * packages/chat-session, or apps/desktop — exactly where the stray-code
 * guard has to bite.
 *
 * Keep the set in sync with the contract's `.errors()` declarations
 * (chat.ts, exam.ts, index.ts). Add a code here the moment it lands on a procedure —
 * an undeclared code is precisely the stray throw this file guards.
 */

declare module "@orpc/contract" {
  interface Registry {
    ORPCErrorCode:
      | "NOT_FOUND"
      | "CONVERSATION_BUSY"
      | "CONFIG_SWITCH_FAILED"
      | "TOO_MANY_REQUESTS"
      | "AUTH_REQUIRED"
      | "INVALID_REQUEST"
      | "NOT_READY"
      | "CONFLICT";
  }
}

export {};
