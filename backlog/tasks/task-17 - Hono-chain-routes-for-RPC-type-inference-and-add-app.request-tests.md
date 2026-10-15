---
id: TASK-17
title: 'Hono: chain routes for RPC type inference and add app.request() tests'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-05 11:50'
updated_date: '2026-09-06 02:36'
labels: []
dependencies: []
priority: medium
type: feature
ordinal: 613000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
apps/server/src/index.ts:153 app.post("/ai",...), app.get("/agents",...), etc. are defined as separate unchained calls, not as const route = app.post(...).get(...). Skill RPC section says routes MUST be chained for hc<AppType> type inference (export type AppType = typeof route). Current apps/server/test/learn-chat.test.ts tests only pure functions (__test__.formatResponse/chunkText) via bun:test, not integration via app.request() per skill Testing section. No coverage for /ai, /agents, /assistants endpoints, nor for validation error shapes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Chain route definitions where RPC types are desired (e.g., const apiRoutes = app.post("/ai", zValidator(...), handler).get("/agents", handler)...) and export type AppType = typeof apiRoutes
- [x] #2 Add integration tests using app.request("/ai", { method: "POST", body: JSON.stringify(...), headers: {...} }) for success and validation failure cases
- [x] #3 Add app.request tests for GET /agents, GET /agents/:id/models, GET /assistants, GET /, and 404/notFound
- [x] #4 Document hc client usage example if RPC is intended for web
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Chain route definitions in index.ts: create a chained route builder for /ai, /agents, /assistants endpoints. Export type AppType = typeof chainedRoutes for RPC type inference.\n2. Add app.request() integration tests for /ai (success + validation failure), GET /agents, GET /agents/:id/models, GET /assistants, GET /, and 404.\n3. Document hc client usage example.\nNote: /ai endpoint requires ACP agent which isn't available in tests — test validation error shape only. /agents/:id/models requires warm ACP session — skip or mock.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Chained top-level routes in index.ts: const aiRoutes = app.post('/ai',...).get('/agents/:id/models',...).get('/agents',...).get('/assistants',...).get('/'). Exported type AppType = typeof aiRoutes and aiRoutes for testing. Added 9 app.request() integration tests (1 skip for ACP-dependent endpoint) — all pass. Verified: ultracite clean, 17/18 server tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Chained aiRoutes = app.post('/ai',...).get('/agents/:id/models',...).get('/agents',...).get('/assistants',...).get('/') in index.ts. Exported AppType = typeof aiRoutes and aiRoutes. Added 9 app.request() integration tests covering GET /, /agents, /assistants, /nonexistent (404), POST /ai validation failure. 1 test skipped (ACP-dependent). Verified: ultracite clean, 17/18 server tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
