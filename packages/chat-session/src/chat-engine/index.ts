/**
 * Public API of the chat-engine folder (TASK-81.2).
 *
 * Preserves the EXACT export surface of the pre-folder `chat-engine.ts`
 * so every consumer keeps its import path. Layout: card model in
 * `types.ts`, per-variant folds in `folds/*`, dispatch in
 * `transform.ts`, status rules in `status.ts`.
 */

export {
  beginRetryNotice,
  dropRetryingNotice,
  settleRetryNotice,
} from "./folds/retry-notice";
export type { RetryDecision, TerminalError } from "./retry-policy";
export { classifyTerminalError, terminalError } from "./retry-policy";
export { deriveStatus, type FrameStatus } from "./status";
export { transformFrame } from "./transform";
export type {
  AskAnswer,
  AskQuestion,
  DrillItem,
  DrillPhase,
  DrillResolution,
  DrillSnapshot,
  FrameCtx,
  PaperPhase,
  PaperResult,
  PaperSectionSummary,
  PermissionOption,
  TMessage,
  TMessageAcpPermission,
  TMessageAcpToolCall,
  TMessageAsk,
  TMessageContextUsage,
  TMessageDrillItem,
  TMessagePaper,
  TMessageRetryNotice,
  TMessageTerminal,
  TMessageText,
} from "./types";
export {
  isAskCard,
  isContextUsageCard,
  isDrillItemCard,
  isPaperCard,
  isPermissionCard,
  isPlanCard,
  isRetryNoticeCard,
  isTerminalCard,
  isTextCard,
  isThinkingCard,
  isToolCard,
  isUserCard,
} from "./types";
export type {
  ContextUsage,
  ContextUsageTier,
  ContextUsageView,
} from "./usage";
export { contextUsageView, latestContextUsage } from "./usage";
