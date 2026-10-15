---
id: TASK-16
title: 'Hono: adopt createFactory with Env and route grouping'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-05 11:50'
updated_date: '2026-09-06 02:24'
labels: []
dependencies: []
priority: medium
type: feature
ordinal: 612000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
apps/server/src/index.ts:37 uses new Hono() without Env generics (Bindings/Variables) and defines all routes flat on main app. createLearnChatRoute at apps/server/src/routes/learn-chat.ts:63 creates new Hono() separately and mounts via app.route("/", ...) which is not idiomatic (mounts at root). Skill Best Practices recommends createFactory<Env>() to share Env type across app/middleware/handlers, and app.route("/api", api) / basePath for feature grouping. Also no Variables for requestId/user context via c.set/c.get.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Define Env type with Variables (e.g., requestId) and Bindings if needed, create factory via createFactory<Env>()
- [x] #2 Refactor routes into grouped Hono instances (e.g., const api = factory.createApp().basePath("/api") or const learn = new Hono().post("/learn/chat",...)) and mount via app.route("/learn", learnApp) instead of app.route("/", ...)
- [x] #3 Use factory.createMiddleware for shared middleware and c.set/c.get for Variables
- [x] #4 Verify existing routes still work via app.request() smoke test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Define AppEnv type extending Hono's Env with Variables: { requestId: string }. Import createFactory from 'hono/factory'. Create factory = createFactory<AppEnv>().\n2. Replace new Hono() in index.ts with factory.createApp(). Convert all app.use() middleware calls to use factory.createMiddleware() wrappers.\n3. Refactor route files to use factory.createApp() instead of new Hono(). Mount via app.route('/api', apiApp) for jap-data + cards, app.route('/learn', learnApp) for learn-chat.\n4. In requestId middleware, add c.set('requestId', ...) to store the ID in Variables.\n5. Add smoke test using app.request() to verify / and /api/kanji and /learn/nextCards respond correctly.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Converted index.ts to use createFactory<AppEnv>() with Env type including Variables.requestId. All middleware uses factory.createMiddleware(). Routes grouped: /api (jap-data + cards) and /learn (learn-chat) mounted via app.route(). Added c.set('requestId', ...) middleware. Route files converted to factory.createApp(). Added smoke test (4 tests, all pass via app.request()). All 12 server tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Migrated Hono app to createFactory<AppEnv>() with typed Env/Variables (requestId). All middleware uses factory.createMiddleware(). Routes grouped: /api (jap-data, cards) and /learn (learn-chat) via app.route(). Added c.set('requestId') middleware. Route files use factory.createApp(). Added 4 app.request() smoke tests — all pass (12/12 server tests pass).
<!-- SECTION:FINAL_SUMMARY:END -->
