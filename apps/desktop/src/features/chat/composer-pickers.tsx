import type { AgentOption } from "@manobu/api-contract";
import { useChatSession } from "@manobu/chat-session/provider";
import {
  configOptionValues,
  currentConfigValue,
  hasModeOption,
} from "@manobu/chat-session/slash";
import { Picker } from "@manobu/ui/components/picker";
import { BotIcon, CpuIcon, GaugeIcon } from "lucide-react";

/** Status-dot color for one agent row in the picker. */
function agentDotColor(
  selectedAgent: string | undefined,
  agent: AgentOption
): string {
  if (selectedAgent === agent.id) {
    return "bg-primary";
  }
  return agent.installed ? "bg-success" : "bg-muted-foreground/40";
}

/**
 * The composer's block-end pickers: agent (CLI), model, mode. Lives on the
 * shared shell so every chat route offers the CLI picker (the app's core
 * affordance), not just /ai. Switching CLI does not wipe the conversation
 * (see provider `selectAgent`); use New session to start fresh.
 */
export function AgentModelModePickers() {
  const { actions, meta, state: chat } = useChatSession();
  return (
    <>
      {meta.agents.length > 0 && (
        <Picker>
          <Picker.Trigger
            aria-label="Select agent"
            icon={BotIcon}
            maxWidthClassName="max-w-44"
          >
            {meta.selectedAgentLabel}
          </Picker.Trigger>
          <Picker.Content align="end" className="w-56">
            <Picker.Heading>Agent</Picker.Heading>
            <Picker.DefaultItem
              label="Default"
              onSelect={actions.selectAgent}
              selected={chat.selectedAgent === undefined}
            />
            {meta.agents.map((agent) => (
              <Picker.Item
                disabled={!agent.installed}
                dotClassName={agentDotColor(chat.selectedAgent, agent)}
                id={agent.id}
                key={agent.id}
                onSelect={actions.selectAgent}
                selected={chat.selectedAgent === agent.id}
              >
                <span className="truncate">{agent.displayName}</span>
                {!agent.installed && (
                  <span className="text-[10px] text-muted-foreground">
                    not installed
                  </span>
                )}
              </Picker.Item>
            ))}
          </Picker.Content>
        </Picker>
      )}
      {chat.modelCatalog.available.length > 0 && (
        <Picker>
          <Picker.Trigger
            aria-label="Select model"
            icon={CpuIcon}
            maxWidthClassName="max-w-40"
          >
            {chat.selectedModel ?? chat.modelCatalog.current ?? "Model"}
          </Picker.Trigger>
          <Picker.Content align="end" className="w-64">
            <Picker.Heading>Model</Picker.Heading>
            <Picker.DefaultItem
              label="Agent default"
              onSelect={actions.switchModel}
              selected={chat.selectedModel === undefined}
            />
            {chat.modelCatalog.available.map((modelId) => (
              <Picker.Item
                disabled={
                  !chat.modelCatalog.supportsSwitching &&
                  modelId !== chat.modelCatalog.current
                }
                dotClassName="bg-muted-foreground/40"
                id={modelId}
                key={modelId}
                onSelect={actions.switchModel}
                selected={chat.selectedModel === modelId}
              >
                <span className="truncate">{modelId}</span>
              </Picker.Item>
            ))}
          </Picker.Content>
        </Picker>
      )}
      {/* TASK-102 AC#5: an installed-but-signed-out agent has no model
        catalog to offer (its session open was rejected for auth). Say so,
        so "signed out" reads differently from "no models". */}
      {chat.modelCatalog.authRequired === true && (
        <span
          className="text-muted-foreground text-xs"
          role="status"
          title={`Sign in to ${meta.selectedAgentLabel} in a terminal to use it`}
        >
          sign in required
        </span>
      )}
      {/* TASK-80.5 (AC#2): the mode picker renders only when the live
        config options carry a `mode` select; values arrive via
        `acp_config_option` frames and the `setConfigOption` response. */}
      {hasModeOption(meta.configOptions) ? (
        <Picker>
          <Picker.Trigger
            aria-label="Select mode"
            icon={GaugeIcon}
            maxWidthClassName="max-w-40"
          >
            {currentConfigValue(meta.configOptions, "mode") ?? "Mode"}
          </Picker.Trigger>
          <Picker.Content align="end" className="w-56">
            <Picker.Heading>Mode</Picker.Heading>
            {configOptionValues(meta.configOptions, "mode").map((modeId) => (
              <Picker.Item
                dotClassName="bg-muted-foreground/40"
                id={modeId}
                key={modeId}
                onSelect={actions.switchMode}
                selected={
                  currentConfigValue(meta.configOptions, "mode") === modeId
                }
              >
                <span className="truncate">{modeId}</span>
              </Picker.Item>
            ))}
          </Picker.Content>
        </Picker>
      ) : null}
    </>
  );
}
