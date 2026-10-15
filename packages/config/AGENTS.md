# packages/config

## Purpose

- Foundation config package. Exposes the shared TypeScript compiler options every other workspace extends.

## Ownership

- Project contributors.

## Local Contracts

- Exposes
  - `@manobu/config` (package name).
  - `@manobu/config/tsconfig.base.json` — base `compilerOptions` (ESNext, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, bun types).
- Depends on
  - Nothing. Intentionally a zero-dependency leaf.
- Downstream consumers extend this base via `"extends": "@manobu/config/tsconfig.base.json"`.

## Work Guidance

_Empty — no specific standards documented yet._

## Verification

- No package scripts. Verify a base change by running `bun run check-types` in any downstream workspace — if it still passes, the base is intact.
- `bun run check` (Ultracite) from repo root.

## Child DOX Index

_None._
