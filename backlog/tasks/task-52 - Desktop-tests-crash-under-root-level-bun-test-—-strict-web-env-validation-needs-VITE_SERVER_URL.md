---
id: TASK-52
title: >-
  Tests importing @manobu/env/web crash under root-level bun test — strict web
  env validation needs VITE_SERVER_URL
status: Done
assignee: []
created_date: '2026-09-09 17:20'
updated_date: '2026-09-09 17:28'
labels:
  - bug
  - tooling
  - frontend
dependencies: []
priority: medium
ordinal: 540000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found 2026-09-10 during TASK-51 closeout verification (same tooling-lies family as TASK-50/51): a repo-root `bun test` (bun's CLI test path argument is a substring filter, so test files across packages get picked up) crashes every test file that imports @manobu/env/web at module load — unhandled error: 'Invalid environment variables: VITE_SERVER_URL expected string, received undefined' (packages/env/src/web.ts:4, t3-oss/env-core ensureSynchronous). CONFIRMED affected by the filing run itself: apps/desktop (4 test files) AND packages/chat-session (2 test files: exports.test.ts, multi-mount.test.tsx). Per-package `bun run test` (turbo) passes because each package's .env/preload supplies VITE_SERVER_URL; apps/desktop's preload (bun test --preload ./test/setup.ts test/) only applies when the package script runs, not on bare root invocation. The suites hard-crash instead of degrading. The filing run itself captured live evidence: 424 pass / 6 fail / 6 errors — all 6 errors are this env throw. Fix guidance: make @manobu/env/web's validation tolerate bun-test context (e.g. default VITE_SERVER_URL to '' when NODE_ENV==='test' or when Bun origin is test-runner), OR set the env in each affected package's test setup — pick the option that preserves strictness for real builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Desktop test setup is self-sufficient regardless of invocation context: test/setup.ts (or the web env schema) guarantees VITE_SERVER_URL is defined for bun test — set process.env.VITE_SERVER_URL ??= "" in setup (or allow empty-in-test in @manobu/env/web) — so a bare bun test from the REPO ROOT runs the desktop suite instead of aborting every file with 'Invalid environment variables: VITE_SERVER_URL expected string, received undefined' (t3-env throw at packages/env/src/web.ts:4)
- [x] #2 The fix preserves the strictness contract for real builds: production/desktop runtime behavior of @manobu/env/web is unchanged (env still required when imported by the app, not by tests) — verified by apps/desktop bun run test (normal per-package path) staying 234/0 and a root-level bun test executing desktop test files without unhandled env errors
- [x] #3 bun run check-types + bunx ultracite check green repo-wide after the change
- [x] #4 DOX: if the fix touches @manobu/env/web, packages/env/AGENTS.md documents the test-empty allowance; if it touches apps/desktop test setup, apps/desktop AGENTS (or the closest owning doc) notes the invocation-context robustness
- [x] #5 Note the boundary: this fixes the ROOT-invocation crash only if bun's substring filter pulls desktop tests; per-package turbo test remains the canonical path — document which invocations are supported in the owning AGENTS bullet
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 722bd9e): chose the env-source fix over per-package setup widening — root cause is that bun test sets NODE_ENV=test but supplies no Vite env, so ANY test importing @manobu/env/web (desktop 4 files + chat-session 2 files, confirmed live during filing) crashes outside its own package. web.ts now defaults VITE_SERVER_URL to http://127.0.0.1:4317 when NODE_ENV==='test' and the var is unset (runtimeEnv override); strictness unchanged outside test — real builds/dev still throw on unset. No test hits the network; per-package setups (desktop preload setup.ts, chat-session .env.test) still win when present. Probed NODE_ENV under bun test first ('test' confirmed) before committing to the hook. Proof: bare repo-root bun test — was 424 pass/6 fail/6 errors (all 6 errors = the env throw), now 480 pass/3 skip/0 fail across 42 files. Repo: check-types 12/12, test 9/9, ultracite clean. AC4/AC5 — packages/env/AGENTS.md Validation rules bullet documents the test-context default; packages/AGENTS.md Verification section documents the canonical per-package test path + the dual-invocation requirement for new env-importing tests (per-package and bare-root bun test).
<!-- SECTION:NOTES:END -->
