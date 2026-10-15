/**
 * Provider-owned pure helpers (TASK-83): the persisted-blob seed reader
 * and the picker label resolvers. Pure functions — no React, no I/O —
 * so TASK-82's conversationId persistence work extends `readInitialChatState`
 * with testable, provider-free coverage.
 */

import type { AgentOption, PersonaOption } from "@manobu/api-contract";
import type { TMessage } from "./chat-engine";
import { loadPersistedChat } from "./persistence";

/**
 * A persisted conversation id is only trustworthy when it is shaped like
 * a UUID (crypto.randomUUID output): a stale or hand-edited blob must not
 * poison the identity (the server would reject/ignore it anyway, but the
 * client can cheaply self-heal by re-minting).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPlausibleConversationId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * The conversation identity seed (TASK-82): reuse the persisted id so a
 * reload reconnects to the SAME server-side conversation (the engine's
 * connect-time history replay restores the transcript), else mint a fresh
 * one (first run, or after New Chat cleared the blob). Empty/invalid
 * persisted values self-heal to a fresh id.
 */
export function resolveConversationId(persistedId: unknown): string {
  if (isPlausibleConversationId(persistedId)) {
    return persistedId;
  }
  return crypto.randomUUID();
}

/**
 * The persisted blob normalized into Provider-owned `useState` seeds.
 * Empty-string persisted ids become `undefined` (the server default),
 * and the message list falls back to a fresh conversation.
 */
export interface InitialChatState {
  agent: string | undefined;
  /** TASK-82: the persisted conversation id, or undefined (mint fresh). */
  conversationId: string | undefined;
  input: string;
  messages: TMessage[];
  model: string | undefined;
  persona: string | undefined;
}

/** The identity of a stored conversation the learner is opening (TASK-101). */
export interface OpenConversationSeed {
  agent: string | null;
  assistant: string | null;
  conversationId: string;
}

/**
 * The seed for opening a PAST conversation instead of the blob's current
 * one. Three rules, all of them about not letting the old chat's state leak
 * into the new one:
 * - the stored `agent`/`assistant` win, because the conversation's ACP
 *   session belongs to the CLI that made it (a `session/load` on another
 *   agent cannot work);
 * - `messages` are empty: the transcript comes from the database via the
 *   engine's connect-time replay, so a blob another profile cleared cannot
 *   hide it (and stale messages from the previous chat must not be
 *   replayed into it);
 * - `input` and `model` are the previous chat's half-finished choices, not
 *   this one's.
 */
export function mergeOpenConversation(
  initial: InitialChatState,
  open: OpenConversationSeed
): InitialChatState {
  return {
    ...initial,
    agent: open.agent ?? undefined,
    conversationId: open.conversationId,
    input: "",
    messages: [],
    model: undefined,
    persona: open.assistant ?? undefined,
  };
}

/**
 * TASK-157: does the SERVER hold this conversation?
 *
 * Two reads (`chat.listMessages`, `chat.slashCommands`) answer NOT_FOUND for
 * a conversation the server never created, so they may only fire on proof.
 * The id itself is not proof: a mount mints one with `crypto.randomUUID()`
 * (the fallthrough of `resolveConversationId`) before the learner sends
 * anything, and the persist effect writes that minted id into the blob
 * immediately, so a never-used id is indistinguishable from a real one by
 * shape, by length, or by having been persisted.
 *
 * The two proofs are the server's own claims:
 * - `open`: the learner named this id in the route and the route loader
 *   awaited `chat.getConversation` for it before mounting;
 * - a card in the engine's list: each one came from the connect-time replay
 *   of stored rows, from a live frame, or from the persisted transcript of a
 *   conversation that already had a turn.
 */
export function resolveConversationKnown(input: {
  conversationId: string;
  messages: readonly TMessage[];
  open: OpenConversationSeed | null;
}): boolean {
  return (
    input.open?.conversationId === input.conversationId ||
    input.messages.length > 0
  );
}

/**
 * TASK-172: has this conversation's AGENT SESSION been established?
 *
 * `chat.slashCommands` is a stricter read than `chat.listMessages`: it answers
 * NOT_FOUND for a conversation the server created but never ran a turn on,
 * because the ACP session id (`storedSessionId`) is only persisted inside the
 * first turn (context.ts:386, reached by `runTurn`), NOT at row creation.
 * `resolveConversationKnown` is not enough here: a stored conversation opened
 * from a route (`open`) or a transcript holding only the learner's own cards
 * can still have no session, so it would fire the read and log a 404 (the exam
 * paper chat reproduces this: the route always sets `open`, the paper is a
 * server-built card, and no turn has run, so the mount 404s).
 *
 * The one client-side signal that a session exists is a card the live agent
 * session itself emitted: the session id is set synchronously at the head of
 * `runTurn`, before any streamed frame, so any agent-produced card proves the
 * session is already stored. Deliberately EXCLUDED:
 * - `user_created`: the server persists the learner's row at chat-rpc.ts:470,
 *   which runs BEFORE `runTurn` sets the session (the same send's ack may
 *   therefore carry a `user_created` card with no session yet);
 * - `paper` and `drill_item`: published by the server (exam-service.ts,
 *   drill-bridge), not by an agent turn, so no session id;
 * - `error` and `retry_notice`: a client-side notice and a pre-session
 *   AUTH_REQUIRED both surface without ever opening a session.
 */
const SESSION_TURN_CARD_TYPES: readonly TMessage["type"][] = [
  "acp_context_usage",
  "acp_permission",
  "acp_terminal_output",
  "acp_tool_call",
  "ask",
  "plan",
  "text",
  "thinking",
];

export function resolveSlashSnapshotReady(
  messages: readonly TMessage[]
): boolean {
  return messages.some((message) =>
    SESSION_TURN_CARD_TYPES.includes(message.type)
  );
}

export function readInitialChatState(): InitialChatState {
  const persisted = loadPersistedChat();
  const { conversationId, ...rest } = persisted;
  return {
    ...rest,
    agent: persisted.agent || undefined,
    conversationId: isPlausibleConversationId(conversationId)
      ? conversationId
      : undefined,
    input: persisted.input ?? "",
    messages: persisted.messages ?? [],
    model: persisted.model || undefined,
    persona: persisted.persona || undefined,
  };
}

/** Human label for the picked agent; falls back to the raw id, then "Default". */
export function resolveAgentLabel(
  agents: AgentOption[],
  selectedAgent: string | undefined
): string {
  return (
    agents.find((agent) => agent.id === selectedAgent)?.displayName ??
    selectedAgent ??
    "Default"
  );
}

/**
 * Label for the picked persona; an unknown/absent selection shows the
 * server's default persona, then "Default".
 */
export function resolvePersonaLabel(
  personas: PersonaOption[],
  selectedPersona: string | undefined,
  defaultPersonaId: string | undefined
): string {
  return (
    personas.find((persona) => persona.id === selectedPersona)?.name ??
    selectedPersona ??
    personas.find((persona) => persona.id === defaultPersonaId)?.name ??
    "Default"
  );
}
