/**
 * Pure normalization helpers for the native ACP engine (TASK-80.1).
 *
 * Wire → internal shape conversions shared by `SessionController` and the
 * session/update translator: config-option flattening (dual legacy
 * models/modes shapes), tool-call payload sanitizing, plan-entry mapping,
 * prompt content-block mapping, and ask-answer formatting. All functions
 * here are stateless; nothing may assume a particular agent dialect beyond
 * what the ACP schema (plus observed snake_case drift) allows.
 */

import type { ContentBlock, PlanEntry } from "@agentclientprotocol/sdk";

import {
  type AcpAskAnswer,
  type AcpAskAnswerLine,
  type AcpConfigOption,
  type AcpToolCallUpdatePayload,
  sanitizeAcpToolUpdate,
} from "./acp-events";
import type { PromptFileAttachment, PromptInput } from "./session-types";

/** session/new|load response subset we consume (dual wire shapes). */
export interface OpenSessionResult {
  configOptions?: unknown[] | null;
  models?: {
    availableModels?: { modelId: string; name?: string | null }[];
    currentModelId?: string | null;
  } | null;
  modes?: {
    availableModes?: {
      description?: string | null;
      id: string;
      name?: string | null;
    }[];
    currentModeId?: string | null;
  } | null;
  sessionId?: string | null;
}

/**
 * Merge `tool_call` / `tool_call_update` raw payloads into one sanitized
 * `AcpToolCallUpdatePayload`: dual-case `rawOutput`/`raw_output` folded to
 * camelCase, then oversized inline base64 stripped (AionUi contract).
 */
export function normalizeToolCallUpdate(
  raw: Record<string, unknown>
): AcpToolCallUpdatePayload {
  const sanitized = sanitizeAcpToolUpdate(raw);
  return sanitized as unknown as AcpToolCallUpdatePayload;
}

/** Map one ACP plan entry (status dialects ride the SDK's union). */
export function planEntry(entry: PlanEntry): {
  content: string;
  priority?: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
} {
  return {
    content: entry.content,
    priority: entry.priority,
    status: entry.status,
  };
}

/** Map prompt input + files onto the negotiated ContentBlock set. */
export function contentBlocks(
  capabilities: { image: boolean },
  input: PromptInput
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (typeof input.content === "string") {
    blocks.push({ text: input.content, type: "text" });
  } else {
    for (const block of input.content) {
      blocks.push(block as unknown as ContentBlock);
    }
  }
  for (const file of input.files ?? []) {
    const block = fileBlock(capabilities, file);
    if (block) {
      blocks.push(block);
    }
  }
  return blocks;
}

function fileBlock(
  capabilities: { image: boolean },
  file: PromptFileAttachment
): ContentBlock | null {
  if (file.data && capabilities.image) {
    return {
      data: file.data,
      mimeType: file.mimeType ?? "application/octet-stream",
      type: "image",
    } as unknown as ContentBlock;
  }
  if (file.uri) {
    const link: Record<string, unknown> = {
      name: file.name,
      type: "resource_link",
      uri: file.uri,
    };
    if (file.mimeType) {
      link.mimeType = file.mimeType;
    }
    if (file.size !== undefined) {
      link.size = file.size;
    }
    return link as unknown as ContentBlock;
  }
  return null;
}

/** `session/set_config_option` request value per select/boolean dialect. */
export function configOptionRequest(
  sessionId: string,
  configId: string,
  value: string | boolean
):
  | { configId: string; sessionId: string; type: "boolean"; value: boolean }
  | { configId: string; sessionId: string; value: string } {
  if (typeof value === "boolean") {
    return { configId, sessionId, type: "boolean", value };
  }
  return { configId, sessionId, value };
}

/** Turn raw wire `SessionConfigOption[]` into the normalized flat shape. */
export function normalizeConfigOptions(raw: unknown): AcpConfigOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AcpConfigOption[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const option = normalizeOneConfigOption(item);
    if (option) {
      out.push(option);
    }
  }
  return out;
}

function normalizeOneConfigOption(
  item: Record<string, unknown>
): AcpConfigOption | null {
  const id = typeof item.id === "string" ? item.id : "";
  if (!id) {
    return null;
  }
  const isBoolean = item.type === "boolean";
  const options = isBoolean ? [] : flattenSelectOptions(item.options);
  let currentValue: string | boolean = false;
  if (isBoolean) {
    currentValue = item.currentValue === true;
  } else {
    const rawValue = item.currentValue ?? item.selectedValue;
    currentValue = typeof rawValue === "string" ? rawValue : "";
  }
  return {
    category: optionalString(item.category),
    currentValue,
    description: optionalString(item.description),
    id,
    name: optionalString(item.name),
    options,
    type: isBoolean ? "boolean" : "select",
  };
}

interface FlatSelectOption {
  description: string | null;
  name: string | null;
  value: string;
}

/** Select options arrive flat or grouped; flatten groups to one list. */
function flattenSelectOptions(raw: unknown): FlatSelectOption[] {
  const out: FlatSelectOption[] = [];
  if (!Array.isArray(raw)) {
    return out;
  }
  for (const item of raw as Record<string, unknown>[]) {
    if (Array.isArray(item.options)) {
      // Grouped: {group, name, options: [...]}.
      for (const nested of item.options as Record<string, unknown>[]) {
        out.push(selectOption(nested));
      }
      continue;
    }
    out.push(selectOption(item));
  }
  return out;
}

function selectOption(item: Record<string, unknown>): FlatSelectOption {
  const raw = item.value;
  return {
    description: optionalString(item.description),
    name: optionalString(item.name),
    value: typeof raw === "string" ? raw : String(raw ?? ""),
  };
}

/**
 * Fold the two legacy top-level shapes (`models`/`modes` on session/new|load
 * responses) into the config-options list when the agent didn't expose
 * `model`/`mode` options (aioncore dual-shape rule). One shared synthesis
 * helper; the per-shape differences are data, not branches.
 */
/** Synthesize one legacy select option; per-shape data is passed in. */
function legacyOption(
  id: "model" | "mode",
  name: string,
  currentValue: string | null,
  entries: ReadonlyArray<{
    description: string | null;
    label: string;
    value: string;
  }>
): AcpConfigOption {
  return {
    category: id,
    currentValue: currentValue ?? "",
    description: null,
    id,
    name,
    options: entries.map((entry) => ({
      description: entry.description,
      name: entry.label,
      value: entry.value,
    })),
    type: "select",
  };
}

/** Legacy `models` top-level shape -> a `model` select option. */
function legacyModelOption(
  models: NonNullable<OpenSessionResult["models"]>
): AcpConfigOption {
  return legacyOption(
    "model",
    "Model",
    models.currentModelId ?? "",
    (models.availableModels ?? []).map((model) => ({
      description: null,
      label: model.name ?? model.modelId,
      value: model.modelId,
    }))
  );
}

/** Legacy `modes` top-level shape -> a `mode` select option. */
function legacyModeOption(
  modes: NonNullable<OpenSessionResult["modes"]>
): AcpConfigOption {
  return legacyOption(
    "mode",
    "Mode",
    modes.currentModeId ?? "",
    (modes.availableModes ?? []).map((mode) => ({
      description: mode.description ?? null,
      label: mode.name ?? mode.id,
      value: mode.id,
    }))
  );
}

/** Append a synthesized option only when the modern option is absent. */
function appendIfAbsent(
  out: AcpConfigOption[],
  id: "model" | "mode",
  option: AcpConfigOption
): void {
  if (!out.some((existing) => existing.id === id)) {
    out.push(option);
  }
}

/**
 * Fold the two legacy top-level shapes (`models`/`modes` on session/new|load
 * responses) into the config-options list when the agent didn't expose
 * `model`/`mode` options (aioncore dual-shape rule).
 */
export function foldLegacyModelMode(
  options: AcpConfigOption[],
  models?: OpenSessionResult["models"] | null,
  modes?: OpenSessionResult["modes"] | null
): { currentModeId: string | null; options: AcpConfigOption[] } {
  const out = [...options];
  if (models) {
    appendIfAbsent(out, "model", legacyModelOption(models));
  }
  if (modes) {
    appendIfAbsent(out, "mode", legacyModeOption(modes));
  }
  return { currentModeId: modes?.currentModeId ?? null, options: out };
}

/** Replace a handle's config snapshot from raw wire options. */
export function applyConfigOptions(
  handle: {
    configOptions: AcpConfigOption[];
    currentModeId: string | null;
  },
  raw: unknown
): void {
  const options = normalizeConfigOptions(raw);
  if (options.length > 0) {
    handle.configOptions.length = 0;
    handle.configOptions.push(...options);
  }
  const mode = options.find((option) => option.id === "mode");
  if (mode?.type === "select" && typeof mode.currentValue === "string") {
    handle.currentModeId = mode.currentValue;
  }
}

/** Format an ask answer payload into the text the agent's tool receives. */
export function formatAskAnswer(payload: AcpAskAnswer): string {
  if (payload.decline) {
    return "The learner declined to answer this question. Do not re-ask; proceed with your best guess and say what you assumed.";
  }
  const answers = payload.answers ?? [];
  if (answers.length === 0) {
    return "(no answer given)";
  }
  return answers
    .map(
      (answer: AcpAskAnswerLine) =>
        `${answer.question}: ${answer.labels.join(", ")}`
    )
    .join("\n");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
