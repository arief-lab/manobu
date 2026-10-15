---
id: TASK-79.4
title: >-
  79.4 ask_user questionnaire: port Questionnaire primitive + pinned card UI +
  auto-resume
status: Done
assignee: []
created_date: '2026-09-15 07:00'
updated_date: '2026-09-15 13:16'
labels:
  - frontend
  - ai-chat
dependencies:
  - TASK-79.3
parent_task_id: TASK-79
priority: high
type: feature
ordinal: 259000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The template's signature interaction, ported end-to-end. (1) UI: copy components/ui/questionnaire.tsx (base-ui, MIT) into packages/ui/src/components/questionnaire.tsx following our ui conventions (compound exports like message.tsx; sumi theme, no dark: variants), and components/question-card.tsx into packages/chat-session as a pinned clarifying-questions card: sticky bottom-2 rounded-3xl bg-popover shadow-lg ring-1, one question at a time with QuestionnaireProgress dots, 3 choices + free-text 'Another answer' input, shown while the last assistant message holds a tool-ask_user part in input-streaming/input-available state (input-streaming renders the shimmer Preparing a question... placeholder). (2) Tool: add ask_user to the shared tool map from 79.3 (no execute - the user answers it; copy the template's inputSchema: questions[] with question + exactly 3 choices, outputSchema: {question, answer}[]) and its description tuned for the sensei persona (ask before lesson planning when the goal/level is unknown). (3) Wire: ChatSessionProvider gains addToolOutput passthrough + sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls (from ai@7); ChatSessionApi extended (adding fields is allowed; update ai.tsx + dev.chat-history.tsx only if the interface changes shape). (4) Transcript: answered tool-ask_user parts render inline via a small ask-user-part component (question -> answer lines, muted), like the template's ask-user-part.tsx.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Browser walkthrough against the local agent (or a stub model that calls ask_user): assistant asks, card pins to scroller bottom, answering resumes streaming automatically with the answers in the next request; answered card collapses to inline Q/A lines.
- [x] #2 packages/ui compounds.test.tsx-style contract test for Questionnaire; chat-session persistence unaffected (answers ride the normal message blob).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design pivot (verified against @mcpc-tech/acp-ai-provider 0.3.5 + opencode 1.18.18): the template's no-execute client-tool flow is NOT viable over ACP. Three independent blockers proven live: (1) plain tool({}) without execute is silently dropped by extractACPTools unless registered via the provider's acpTools() wrapper; (2) with the wrapper, the wire part arrives MCP-prefixed (tool-acp-ai-sdk-tools_ask_user) and opencode's rawOutput {output,metadata} wrapper defeats isClientToolResult, so the stream never ends with tool-calls; (3) the proxy runtime enforces a 30s hostReq timeout, so a blocking execute waiting on a human cannot work, and the addToolOutput resume leg would only send the last user text into the warm session anyway. Final design: ask_user executes server-side, returns a HANDOFF_UI sentinel immediately; the browser pins the QuestionCard from the streamed part (input.args.questions envelope); answering sends 'question: answer' lines as an ordinary user message and the agent continues next turn. ChatTools stays the OPEN map (79.3) - closed-map experiment reverted with evidence; ask_user typing lives in structural helpers (ASK_USER_PART_TYPE, AskUserToolPart, isAskUserPart, askUserQuestions, unansweredAskUserPart, askUserAnswerText). actions.answerAskUser(questions, answers) + meta.readOnly added to the ChatSessionApi; Questionnaire compound ported to @manobu/ui over @shadcn/react 0.3.1 (bumped from 0.2.1; message-scroller typings unchanged). DOX updated: packages/chat-session, packages/ui, packages/acp, packages/api-contract, apps/server, apps/desktop.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
ask_user questionnaire shipped on /ai. Server registers the tool via @manobu/acp acpTools() (plain tool({}) is dropped by the provider); execute returns the HANDOFF_UI sentinel immediately (30s proxy timeout + broken isClientToolResult make the template's client-tool round trip impossible over ACP - evidence in notes). packages/ui gains the ported Questionnaire compound over @shadcn/react ^0.3.1 (bumped; dark: stripped, data-slots kept, smoke test in questionnaire.test.tsx). packages/chat-session: chat-messages seam exports ASK_USER_PART_TYPE + structural helpers; provider gains actions.answerAskUser (answers ride a normal user message: 'question: answer' lines) + meta.readOnly; message-transcript pins QuestionCard (template markup, sticky bottom-2 rounded-3xl popover, shimmer placeholder while input streams) and suppresses the part in bubbles except output-error. Verified: 53 chat-session tests (predicates + SSR card/read-only), 100 ui tests, 391 desktop tests, root check-types 13/13, ultracite check clean; browser E2E on :3001 - prompt -> card pinned with 3 choices -> click Answer -> agent resumed and chained a second ask_user -> card + transcript survive reload; no page errors. AC1 deviation: 'auto-resume' is realized as the next-turn user message (same UX, only viable transport); answered card disappears instead of collapsing inline (the answer message is the record).
<!-- SECTION:FINAL_SUMMARY:END -->
