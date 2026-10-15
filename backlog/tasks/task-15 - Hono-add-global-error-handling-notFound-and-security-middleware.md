---
id: TASK-15
title: 'Hono: add global error handling, notFound, and security middleware'
status: Done
assignee:
  - '@arief'
created_date: '2026-09-05 11:49'
updated_date: '2026-09-05 15:30'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 615000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
apps/server/src/index.ts:37 creates new Hono() with only logger() and cors() middleware. No app.onError((err,c)=>c.json(...500)) or app.notFound((c)=>c.json(...404)) per skill Error Handling section, so unhandled exceptions leak and 404s return default Hono HTML. No secureHeaders, bodyLimit, etag, timing, requestId. POST /ai and /learn/chat accept unbounded JSON (max 2000 chars in Zod but bodyLimit not enforced at middleware layer), allowing large payload DoS. Warm pool health check logs but not returned as structured error.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Add app.onError handler logging err and returning c.json({ message: "Internal Server Error" }, 500)
- [x] #2 Add app.notFound handler returning c.json({ message: "Not Found" }, 404)
- [x] #3 Add bodyLimit({ maxSize: 64 * 1024 }) for POST routes and secureHeaders() middleware
- [x] #4 Optionally add etag() and requestId() for caching and tracing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit apps/server/src/index.ts:37 Hono() with only logger+ cors, no onError/notFound, no bodyLimit/secureHeaders/etag/requestId
2. AC1: Add app.onError((err,c)=>{ console.error(err); return c.json({ message: "Internal Server Error", error: err.message },500) }) after Hono creation
3. AC2: Add app.notFound((c)=>c.json({ message: "Not Found" },404))
4. AC3: Add bodyLimit({ maxSize: 64*1024 }) middleware for POST /ai and /learn/chat (or global app.use(bodyLimit)), and secureHeaders() via import { secureHeaders } from "hono/secure-headers" + app.use(secureHeaders())
5. AC4: Optionally add etag() + requestId() via hono/etag and hono/request-id (app.use(etag()), app.use(requestId())) for caching/tracing, verify via app.request() smoke and check-types
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verify: check-types 10/10 pass, ultracite 203 clean, app.request smoke: notFound 404 JSON, secureHeaders X-Content-Type-Options nosniff, etag + requestId present, bodyLimit 70KB→413 Payload Too Large (was 500 before HTTPException handling), small body 200. onError now handles HTTPException via err.getResponse() to preserve 413.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Hono error/security middleware in apps/server/src/index.ts: onError with HTTPException handling (500 else err.getResponse for 413), notFound 404 JSON, secureHeaders() + etag() + requestId() + bodyLimit 64KB (global). Verified via app.request: notFound 404, secureHeaders nosniff, etag + requestId present, bodyLimit big 413 / small 200, plus check-types 10/10, ultracite 203 clean, imports bodyLimit/etag/requestId/secureHeaders/HTTPException.
<!-- SECTION:FINAL_SUMMARY:END -->
