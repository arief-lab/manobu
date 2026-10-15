---
id: TASK-14
title: 'Hono: add Zod validation with zValidator for /ai and /learn/chat'
status: Done
assignee:
  - '@arief'
created_date: '2026-09-05 11:49'
updated_date: '2026-09-05 15:26'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 614000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
apps/server/src/index.ts:153 POST /ai manually parses body via await c.req.json() then typeof checks for agent/assistant/model, and apps/server/src/routes/learn-chat.ts:66 does LearnChatInput.safeParse(await c.req.json()) without using hono validator middleware. Skill Validation section recommends import { zValidator } from "@hono/zod-validator" and using c.req.valid("json") for typed, centralized validation. Manual parsing bypasses standardized error shape, misses automatic 400 handling, and duplicates validation logic. Also no param validation for /agents/:id/models.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Add @hono/zod-validator dependency and use zValidator("json", schema) for POST /ai and POST /learn/chat
- [x] #2 Replace manual typeof checks for agent/assistant/model in /ai with Zod schemas (e.g., z.object({ messages: z.array(...), agent: z.string().optional(), assistant: z.string().optional(), model: z.string().optional() })) and read via c.req.valid("json")
- [x] #3 Add param validation for GET /agents/:id/models via zValidator("param", z.object({ id: z.string().min(1) })) or equivalent
- [x] #4 Remove manual safeParse + flatten error handling in favor of validator middleware error responses
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add @hono/zod-validator to apps/server (already have zod catalog, add dependency) and verify import { zValidator } from "@hono/zod-validator"
2. For POST /ai: define AiRequestSchema z.object({ messages: z.array(z.object({ role: z.enum(["user","assistant","system"]), content: z.string() }).or(z.object({ role: z.string(), content: z.string() })), agent: z.string().trim().optional(), assistant: z.string().trim().optional(), model: z.string().trim().optional() }) and use zValidator("json", AiRequestSchema) middleware, then read via c.req.valid("json") replacing manual body = await c.req.json() + typeof checks
3. For POST /learn/chat: replace LearnChatInput.safeParse(await c.req.json()) with zValidator("json", LearnChatInput) middleware, read via c.req.valid("json"), remove manual flatten error handling (hono validator auto 400)
4. For GET /agents/:id/models: add zValidator("param", z.object({ id: z.string().min(1) })) and read via c.req.valid("param") replacing c.req.param("id") manual
5. Remove manual safeParse + c.json flatten, ensure error shape is standard hono 400, verify with bun run check-types + test via app.request() smoke
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verify: bun run check-types 10/10 pass ( Vite build 1,023kB, server tsc -b pass after fixing listAgents import + AgentSpec type), bun x ultracite check 203 clean (0 errors after fixing async without await), app.request smoke via @hono/zod-validator: valid POST /test 200, invalid empty/missing 400 ZodError as expected; manual safeParse removed, c.req.valid typed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added @hono/zod-validator@0.9.1 to apps/server and migrated to zValidator middleware: POST /ai now uses AiRequestSchema (messages array any default [], agent/assistant/model optional trimmed min1 passthrough) via zValidator json + c.req.valid json (was manual c.req.json + typeof checks); GET /agents/:id/models now zValidator param id min1 + c.req.valid param; POST /learn/chat now zValidator json LearnChatInput + c.req.valid json (removed safeParse+flatten). Fixed import @manobu/acp/registry for listAgents + AgentSpec type for check-types. Verified check-types 10/10, ultracite 203 clean, app.request smoke valid 200 / invalid 400 ZodError.
<!-- SECTION:FINAL_SUMMARY:END -->
