/**
 * AcpStreamEvent — the normalized ACP frame vocabulary (TASK-80.1).
 *
 * The native session engine (`src/session.ts`) translates inbound ACP
 * `session/update` notifications and out-of-band turn results into this
 * typed union. `apps/server` (TASK-80.2) forwards every member 1:1 as the
 * `data` of an AionUi `IResponseMessage` SSE frame, and
 * `packages/chat-session` (TASK-80.3) folds frames back into its message
 * model — the union IS the wire contract between the three layers.
 *
 * Naming rule: payloads keep the ACP wire's camelCase field names
 * (`toolCallId`, `rawInput`, `sessionUpdate`) exactly as on the stdio wire.
 * AionUi's backend aggressively snake-cases frames instead; we don't, and
 * the reducers in chat-session accept both spellings (see `dualKey`).
 */

// ── ACP-aligned payload types (SDK-free, wire-faithful subsets) ──────

/** ACP `ToolCallContent` item: text/image resource content or a file diff. */
export type AcpToolCallContentItem =
  | { type: "content"; content: { type: string; [key: string]: unknown } }
  | { type: "diff"; path: string; oldText?: string | null; newText: string }
  | { type: "terminal"; terminalId: string };

/** ACP `ToolCallLocation`. */
export interface AcpToolCallLocation {
  line?: number | null;
  path: string;
}

/*
 * The host's own tools. Their raw tool cards are never rendered: `ask_user`
 * answers through its questionnaire card, `next_drill_item` through the drill
 * card, and `start_exam` (TASK-147) through the paper card the assembly
 * publishes, so a third card on screen is a duplicate, not information.
 */
const HOST_TOOL_NAMES = ["ask_user", "next_drill_item", "start_exam"] as const;

export const isHostToolCallTitle = (
  title: string | null | undefined
): boolean => {
  if (!title) {
    return false;
  }
  return HOST_TOOL_NAMES.some(
    (name) =>
      title === name || title.endsWith(`_${name}`) || title.endsWith(`-${name}`)
  );
};

/** The dual-case-capable tool-call payload accepted from agents. */
export interface AcpToolCallUpdatePayload {
  content?: AcpToolCallContentItem[] | null;
  kind?: string | null;
  locations?: AcpToolCallLocation[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: string | null;
  title?: string | null;
  toolCallId: string;
}

/** One option offered on a permission request. */
export interface AcpPermissionOption {
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
  name: string;
  optionId: string;
}

/** ACP `SessionConfigOption` (select/boolean), flattened to flat options. */
export interface AcpConfigOption {
  category?: string | null;
  currentValue: string | boolean;
  description?: string | null;
  id: string;
  name?: string | null;
  options: Array<{
    value: string;
    name?: string | null;
    description?: string | null;
  }>;
  type: "select" | "boolean";
}

/** A slash command from `available_commands_update`. */
export interface AcpSlashCommand {
  /** Opaque agent `_meta` (e.g. completion behavior) — carried, never interpreted. */
  _meta?: Record<string, unknown> | null;
  description: string;
  input?: { hint?: string } | null;
  name: string;
}

/** Image reference synthesized for oversized inline base64 results. */
export interface AcpImageOutput {
  mimeType?: string;
  path: string;
  source?: string;
}

/** Sanitized tool `rawOutput` shape after inline-image stripping. */
export interface AcpRawOutput {
  image?: AcpImageOutput;
  result?: string;
  result_bytes?: number;
  result_omitted?: boolean;
  result_omitted_reason?: string;
  saved_path?: string;
  [key: string]: unknown;
}

// ── The frame union ──────────────────────────────────────────────────

/** Turn-open frame; the server emits the matching `start` SSE frame. */
export interface AcpTurnStartEvent {
  session_id?: string;
  type: "turn_start";
}

/** Raw ACP stop reason plus the engine-synthesized `error` terminal. */
export type AcpStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled"
  | "error";

/** Per-turn token usage from `PromptResponse.usage`. */
export interface AcpTurnUsage {
  cachedReadTokens?: number | null;
  cachedWriteTokens?: number | null;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens?: number | null;
  totalTokens: number;
}

/** Discriminator on a failed turn's `error`, so the client can render a
 * distinct affordance rather than one generic "reconnect the agent" bubble.
 * Mirrors the oRPC codes the synchronous surface already uses (task-102). */
export type AcpTurnErrorCode = "AUTH_REQUIRED" | "CONFIG_SWITCH_FAILED";

/** Terminal turn frame. */
export interface AcpTurnEndEvent {
  /** Present when the turn failed (JSON-RPC error or transport death). */
  error?: { code?: AcpTurnErrorCode; message: string };
  stopReason: AcpStopReason;
  type: "turn_end";
  usage?: AcpTurnUsage | null;
}

/** One question in a host-MCP `ask_user` request. */
export interface AcpAskQuestion {
  header?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string }>;
  question: string;
}

/** One answer line in an ask reply (the shape `answerAsk` accepts). */
export interface AcpAskAnswerLine {
  labels: string[];
  question: string;
}

/** Payload resolving a parked ask. `decline: true` = explicit deny. */
export interface AcpAskAnswer {
  answers?: AcpAskAnswerLine[];
  decline?: boolean;
}

export interface AcpDrillItem {
  anchors: readonly string[];
  id: string;
  itemType: string;
  level: string;
  options: readonly string[];
  passage?: string | null;
  prompt: string;
}

export interface AcpDrillSnapshot {
  answered: number;
  asked: number;
  correct?: number;
  declaredCount: number;
  nextReview?: string | null;
  pendingRefill?: boolean;
  readyCount?: number;
  remaining: number;
  skipped?: number;
  unanswered?: number;
}

export interface AcpDrillResolution {
  chosenIndex: number;
  correct: boolean;
  correctIndex: number;
  correctOption?: string;
  explanation?: string | null;
  itemId?: string;
  skipped?: boolean;
}

export function projectAcpDrillResolution(
  resolution: AcpDrillResolution
): AcpDrillResolution {
  return {
    chosenIndex: resolution.chosenIndex,
    correct: resolution.correct,
    correctIndex: resolution.correctIndex,
    ...(resolution.correctOption === undefined
      ? {}
      : { correctOption: resolution.correctOption }),
    ...(resolution.explanation === undefined
      ? {}
      : { explanation: resolution.explanation }),
    ...(resolution.itemId === undefined ? {} : { itemId: resolution.itemId }),
    ...(resolution.skipped === undefined
      ? {}
      : { skipped: resolution.skipped }),
  };
}

export interface AcpDrillItemEvent {
  drill_session_id: string;
  item: AcpDrillItem | null;
  phase: "pending" | "answered" | "suspended" | "summary" | "unavailable";
  request_id: string;
  resolution?: AcpDrillResolution;
  session_id: string;
  snapshot: AcpDrillSnapshot;
  type: "drill_item";
}

/** `agent_message_chunk` — one content block. */
export interface AcpTextEvent {
  content: Record<string, unknown>;
  /** ACP ContentChunk.messageId when the agent sends one. */
  message_id?: string | null;
  type: "text";
}

/** `agent_thought_chunk`. */
export interface AcpThinkingEvent {
  content: Record<string, unknown>;
  type: "thinking";
}

/** `plan` — full-replace snapshot. */
export interface AcpPlanEvent {
  entries: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    priority?: "high" | "medium" | "low";
  }>;
  type: "plan";
}

/** `tool_call` / `tool_call_update` — one (possibly partial) tool card frame. */
export interface AcpToolCallEvent {
  type: "acp_tool_call";
  update: {
    sessionUpdate: "tool_call" | "tool_call_update";
  } & AcpToolCallUpdatePayload;
}

/** Parked `session/request_permission`, surfaced until confirmed. */
export interface AcpPermissionEvent {
  options: AcpPermissionOption[];
  request_id: string;
  session_id?: string;
  tool_call: AcpToolCallUpdatePayload;
  type: "acp_permission";
}

/** Emitted when a parked permission resolves (the card should settle). */
export interface AcpPermissionResolvedEvent {
  option_id?: string | null;
  request_id: string;
  type: "acp_permission_resolved";
}

/** Host-MCP `ask_user` request parked for a human answer. */
export interface AcpAskEvent {
  questions: AcpAskQuestion[];
  request_id: string;
  session_id?: string;
  type: "ask";
}

/** `available_commands_update` snapshot. */
export interface AcpAvailableCommandsEvent {
  commands: AcpSlashCommand[];
  type: "available_commands";
}

/** `usage_update` (context window) or the terminal `PromptResponse.usage`. */
export interface AcpUsageEvent {
  data: {
    used: number;
    size: number;
    cost?: { amount: number; currency: string } | null;
    /** Per-turn token breakdown rides here for terminal usage frames. */
    _meta?: Record<string, unknown> | null;
  };
  type: "acp_context_usage";
}

/** `config_option_update` snapshot (model/mode/generic options). */
export interface AcpConfigOptionEvent {
  configOptions: AcpConfigOption[];
  type: "acp_config_option";
}

/** `current_mode_update`. */
export interface AcpModeUpdateEvent {
  currentModeId: string;
  type: "acp_mode_info";
}

/** `session_info_update` (agent-supplied title). */
export interface AcpSessionInfoEvent {
  title?: string | null;
  type: "acp_session_info";
  updatedAt?: string | null;
}

/** Cumulative terminal output snapshot (stream-only, never persisted). */
export interface AcpTerminalOutputEvent {
  command: string;
  exit_status?: { exit_code?: number | null; signaled?: boolean } | null;
  /** Full cumulative buffer on every frame (AionUi contract). */
  output: string;
  terminal_id: string;
  truncated: boolean;
  type: "acp_terminal_output";
}

/** Connection/session state frame (`agent_status` analogue). */
export interface AcpAgentStatusEvent {
  agent_id?: string;
  detail?: string;
  session_id?: string;
  status:
    | "connecting"
    | "connected"
    | "session_active"
    | "disconnected"
    | "error";
  type: "agent_status";
}

/** Anything the engine didn't translate — opaque, carries the tag. */
export interface AcpAdapterSpecificEvent {
  payload: unknown;
  tag: string;
  type: "adapter_specific";
}

export type AcpStreamEvent =
  | AcpTurnStartEvent
  | AcpTurnEndEvent
  | AcpTextEvent
  | AcpThinkingEvent
  | AcpPlanEvent
  | AcpToolCallEvent
  | AcpPermissionEvent
  | AcpPermissionResolvedEvent
  | AcpAskEvent
  | AcpDrillItemEvent
  | AcpAvailableCommandsEvent
  | AcpUsageEvent
  | AcpConfigOptionEvent
  | AcpModeUpdateEvent
  | AcpSessionInfoEvent
  | AcpTerminalOutputEvent
  | AcpAgentStatusEvent
  | AcpAdapterSpecificEvent;

export type AcpStreamEventType = AcpStreamEvent["type"];

/** Frame consumer invoked for every translated ACP event, in wire order. */
export type AcpEventSink = (event: AcpStreamEvent) => void;

// ── Dual-case + sanitize helpers (shared with chat-session) ─────────

/** Read `camelKey` then `snake_key` from a wire object (agents ship both). */
export function dualKey<T>(
  obj: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): T | undefined {
  const camel = obj[camelKey];
  if (camel !== undefined) {
    return camel as T;
  }
  return obj[snakeKey] as T | undefined;
}

/**
 * Inline base64 images bigger than this are stripped from tool results
 * before they ever reach the UI or the database (AionUi parity:
 * `INLINE_IMAGE_RESULT_LIMIT`).
 */
export const INLINE_IMAGE_RESULT_LIMIT = 64 * 1024;

const IMAGE_BASE64_PREFIXES = [
  "iVBORw0KGgo", // PNG
  "/9j/", // JPEG
  "UklGR", // RIFF (WebP)
  "data:image/", // data URL
] as const;

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;

function isProbablyInlineImageResult(value: string): boolean {
  if (value.length <= INLINE_IMAGE_RESULT_LIMIT) {
    return false;
  }
  return IMAGE_BASE64_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function mimeFromPath(path: string): string | undefined {
  const ext = path.match(IMAGE_EXTENSIONS)?.[1]?.toLowerCase();
  if (!ext) {
    return undefined;
  }
  if (ext === "jpg" || ext === "jpeg") {
    return "image/jpeg";
  }
  return `image/${ext}`;
}

/** Pick the image reference for a stripped inline result. */
function imageForStrippedResult(raw: AcpRawOutput): AcpImageOutput {
  if (raw.image?.path) {
    return raw.image;
  }
  if (typeof raw.saved_path === "string" && raw.saved_path.length > 0) {
    const mime = mimeFromPath(raw.saved_path);
    return {
      ...(mime ? { mimeType: mime } : {}),
      path: raw.saved_path,
      source: "codex_image_generation",
    };
  }
  return { path: "", source: "codex_image_generation" };
}

/**
 * Sanitize one tool-call raw-output value: strip oversized inline base64
 * image results, marking them `result_omitted` and keeping (or synthesizing)
 * an `image` reference. Non-objects and objects without an oversized text
 * `result` pass through unchanged.
 */
export function sanitizeAcpRawOutput(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const output = raw as AcpRawOutput;
  const { result } = output;
  if (typeof result !== "string" || !isProbablyInlineImageResult(result)) {
    return raw;
  }
  const { result: _stripped, ...rest } = output;
  return {
    ...rest,
    image: imageForStrippedResult(output),
    result_bytes: rest.result_bytes ?? result.length,
    result_omitted: true,
    result_omitted_reason: rest.result_omitted_reason ?? "image_base64",
  };
}

/**
 * Apply `sanitizeAcpRawOutput` to BOTH the camelCase and snake_case
 * spellings of the raw-output key (AionUi dual-case contract).
 */
export function sanitizeAcpToolUpdate(
  update: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...update };
  for (const key of ["rawOutput", "raw_output"] as const) {
    if (key in out && out[key] !== undefined) {
      out[key] = sanitizeAcpRawOutput(out[key]);
    }
  }
  return out;
}

/**
 * Image path a sanitized tool result points at (the `image.path` produced
 * by `sanitizeAcpRawOutput`, or a plain saved path). Used by the UI to show
 * the image instead of the stripped base64.
 */
export function getAcpImagePath(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const { image, saved_path: savedPath } = raw as AcpRawOutput;
  if (image?.path) {
    return image.path;
  }
  if (typeof savedPath === "string" && savedPath.length > 0) {
    return savedPath;
  }
  return null;
}
