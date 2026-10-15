import { z } from "zod";

/**
 * Agent catalog entry (GET /agents) — mirrors `AgentOption` in
 * packages/chat-session (an AionUi `agent_status` analogue): every registry
 * agent plus whether its CLI is installed on $PATH (client greys uninstalled).
 */
const AgentOptionSchema = z.object({
  command: z.string(),
  displayName: z.string(),
  id: z.string(),
  installed: z.boolean(),
});
export type AgentOption = z.infer<typeof AgentOptionSchema>;

export const AgentsOutputSchema = z.object({
  agents: z.array(AgentOptionSchema),
});
export type AgentsOutput = z.infer<typeof AgentsOutputSchema>;

/** Persona catalog entry (GET /assistants) — assistants-as-markdown table. */
const PersonaOptionSchema = z.object({
  description: z.string().nullable(),
  id: z.string(),
  name: z.string(),
});
export type PersonaOption = z.infer<typeof PersonaOptionSchema>;

export const AssistantsOutputSchema = z.object({
  assistants: z.array(PersonaOptionSchema),
  default: z.string(),
});
export type AssistantsOutput = z.infer<typeof AssistantsOutputSchema>;

/** Model catalog for one ACP agent (GET /agents/:id/models).
 * `authRequired` distinguishes "installed but signed out" from "installed,
 * no models": the fetch throws AUTH_REQUIRED only when a session open was
 * actually rejected for auth, so success implies signed-in (TASK-102 AC#5).
 * The picker learns sign-in state from a real signal, never a fabricated
 * anonymous probe. */
export const ModelCatalogSchema = z.object({
  authRequired: z.boolean(),
  available: z.array(z.string()),
  current: z.string().nullable(),
  supportsSwitching: z.boolean(),
});
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;
