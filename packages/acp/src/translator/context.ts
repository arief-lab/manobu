/**
 * Context-family translators (TASK-81.1): the variants that mutate the
 * session handle's UI state (slash commands, mode, config options) plus
 * the read-only session-info and usage updates.
 */

import type { SessionUpdate } from "@agentclientprotocol/sdk";

import type { AcpStreamEvent } from "../acp-events";
import { applyConfigOptions } from "../session-normalize";
import type { AcpSessionHandle } from "../session-types";

type ContextUpdate = Extract<
  SessionUpdate,
  | { sessionUpdate: "available_commands_update" }
  | { sessionUpdate: "current_mode_update" }
  | { sessionUpdate: "config_option_update" }
  | { sessionUpdate: "session_info_update" }
  | { sessionUpdate: "usage_update" }
>;

export function translateContext(
  handle: AcpSessionHandle,
  update: ContextUpdate
): AcpStreamEvent {
  switch (update.sessionUpdate) {
    case "available_commands_update": {
      handle.slashCommands = update.availableCommands;
      return {
        commands: update.availableCommands.map((command) => ({
          description: command.description,
          input: command.input ?? null,
          name: command.name,
          ...(command._meta ? { _meta: command._meta } : {}),
        })),
        type: "available_commands",
      };
    }
    case "current_mode_update": {
      handle.currentModeId = update.currentModeId;
      return {
        currentModeId: update.currentModeId,
        type: "acp_mode_info",
      };
    }
    case "config_option_update": {
      applyConfigOptions(handle, update.configOptions);
      return {
        configOptions: handle.configOptions,
        type: "acp_config_option",
      };
    }
    case "session_info_update":
      return {
        title: update.title ?? null,
        type: "acp_session_info",
        updatedAt: update.updatedAt ?? null,
      };
    case "usage_update":
      return {
        data: {
          cost: update.cost ?? null,
          size: update.size,
          used: update.used,
        },
        type: "acp_context_usage",
      };
    default: {
      // The family dispatch (index.ts) owns the A1 opaque fallback, so an
      // unknown variant can never reach a family translator; this default
      // only satisfies the exhaustive-switch lint over the closed union.
      return update satisfies never as never;
    }
  }
}
