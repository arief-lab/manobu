/**
 * The chat-session context contract (TASK-83): the three slices —
 * state (mutable runtime values), actions (imperative handles), meta
 * (auxiliary render data) — per
 * `vercel-composition-patterns/state-context-interface`. This is the
 * contract any Provider can implement: today's `ChatSessionProvider`,
 * a future server-backed history provider, or a CLI replay tool.
 *
 * Extracted from provider.tsx so the identity/persistence work
 * (TASK-82) lands on a smaller surface; the types are the public
 * contract and change only deliberately (a new field or a widened
 * action is a decision, not a drift — see the notice tone below).
 */

import type {
  AgentOption,
  ModelCatalog,
  PersonaOption,
} from "@manobu/api-contract";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import type { FrameStatus, TMessage } from "./chat-engine";
import type { ConfigOptionWire, SlashCommandItem } from "./slash";

/**
 * How loud a composer notice is. The lane was born for one job — a send the
 * engine refused (TASK-100) — and rendered every message in the error colour.
 * But `setNotice` is also the local-degradation escape hatch, and `/ai` now
 * reports a ready paper, a dry level and an offer receipt through it, so a
 * fixed red painted a success as a failure. The tone travels with the text so
 * the colour matches the meaning; `error` is the default because a notice with
 * no stated tone is a problem the caller did not dress up.
 */
export type NoticeTone = "error" | "info" | "success" | "warning";

/**
 * A composer notice: the sentence and its severity. "No notice" is the absence
 * of this object (`null`), never an empty one, so there is no tone to render
 * without text or a text with no tone.
 */
export interface ComposerNotice {
  text: string;
  tone: NoticeTone;
}

/**
 * The runtime values that change over time. State is what the chat
 * route renders directly (messages in the transcript, the draft in
 * the composer, the three picker selections). Mutate it via the
 * actions slice — never reach into the Provider's internal useState
 * calls. This is the slice a future server-backed history version of
 * the Provider would swap, while keeping the actions slice identical.
 */
export interface ChatSessionState {
  input: string;
  isSending: boolean;
  messages: TMessage[];
  modelCatalog: ModelCatalog;
  selectedAgent: string | undefined;
  selectedModel: string | undefined;
  selectedPersona: string | undefined;
  /**
   * TASK-100: why the composer still holds a message the engine refused to
   * take (a turn is in flight), or `null` when nothing was shown. A refused
   * send never clears `input`, so the surfaces render this next to the draft
   * instead of losing it. It carries a `tone` because the same lane now also
   * reports a ready paper, a dry level and an offer receipt, and those are not
   * errors.
   */
  sendNotice: ComposerNotice | null;
  status: FrameStatus;
}

/**
 * The imperative handles. Send/regenerate/stop drive the engine's
 * transport. The select* handlers reconcile the picker trio. The
 * composer handlers (onSubmit / onPromptKeyDown / onInputChange)
 * wire the form. Reset wipes the conversation. None of these mutate
 * state directly — they go through React state setters the Provider
 * owns. Future Provider implementations keep this slice byte-for-byte.
 */
export interface ChatSessionActions {
  onInputChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onPromptKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  regenerate: () => void;
  reset: () => void;
  selectAgent: (id: string) => void;
  selectPersona: (id: string) => void;
  send: (text: string) => void;
  /** Programmatic draft setter (the slash menu's command insertion,
   * TASK-80.5); distinct from `onInputChange` (the user's keystrokes). */
  setDraft: (text: string) => void;
  /** The local-degradation escape hatch (TASK-125): show a notice beside the
   * draft without sending it through the model. `null` clears it. `tone`
   * defaults to `error`, so a caller only names it when the message is not a
   * failure (a success, a warning, an offer receipt). */
  setNotice: (text: string | null, tone?: NoticeTone) => void;
  stop: () => void;
  /** TASK-80.5 (AC#2): hot-switch the live session's mode option
   * (`chat.setConfigOption` option `mode`). Renders only when a
   * `mode` select option exists. */
  switchMode: (id: string) => void;
  /** TASK-80.5 (AC#2): hot-switch the live session's model option via
   * `chat.setConfigOption` (and keep `selectedModel` for the next turn).
   * `""` = the server/agent default. */
  switchModel: (id: string) => void;
}

/**
 * Auxiliary data the route needs to render — server-fetched catalogs,
 * the server's default persona id, the displayed labels. Meta is
 * derived (catalogs come from the server, labels come from
 * `selectedX` joined against the catalog). It informs the picker
 * labels but never drives behaviour.
 */
export interface ChatSessionMeta {
  agents: AgentOption[];
  /** Live ACP config options (`acp_config_option` frames + the
   * `setConfigOption` response): the model/mode picker data (TASK-80.5). */
  configOptions: ConfigOptionWire[];
  /**
   * The conversation this mount is bound to (TASK-101). A DB-backed
   * transcript reader needs it: `/dev/chat-history` fetches this id's
   * persisted rows through `chat.listMessages` rather than trusting the
   * localStorage blob, and the id is otherwise private to the Provider.
   */
  conversationId: string;
  /**
   * TASK-157: the server has this conversation. A `conversationId` alone is
   * not proof: a mount mints one locally before the first send, and both
   * `chat.listMessages` and `chat.slashCommands` answer NOT_FOUND for an id
   * the server never created. A transcript reader mounts on this flag rather
   * than on the id's shape, so a fresh chat costs it zero requests.
   */
  conversationKnown: boolean;
  defaultPersonaId: string | undefined;
  personas: PersonaOption[];
  /** Read-only mounts must not render interactive surfaces (ask_user card). */
  readOnly: boolean;
  selectedAgentLabel: string;
  selectedPersonaLabel: string;
  /** The composer's command menu data (TASK-80.5): the authoritative
   * `chat.slashCommands` snapshot merged with the live
   * `available_commands` overlay, latest-first. */
  slashCommands: SlashCommandItem[];
}

/**
 * The combine — three sub-interfaces a Provider MUST supply. This is
 * the contract from
 * `vercel-composition-patterns/state-context-interface`:
 *
 * > Define a generic interface for your component context with three
 * > parts: state, actions, and meta. This interface is a contract
 * > that any provider can implement — enabling the same UI
 * > components to work with completely different state
 * > implementations.
 *
 * Today's consumer routes (`/ai`, `/chat-history`) read all three
 * slices. A future Provider — server-backed chat history, a CLI
 * replay tool, a third-party replay of an `ACP` conversation —
 * implements the same interface with different `state`.
 */
export interface ChatSessionApi {
  actions: ChatSessionActions;
  meta: ChatSessionMeta;
  state: ChatSessionState;
}
