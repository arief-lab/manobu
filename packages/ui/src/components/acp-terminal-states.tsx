/**
 * Per-state subcomponents for AcpTerminalCard (TASK-81.3). The parent
 * (`acp-terminal-card.tsx`) keeps the state machine (running/killing/
 * kill-error/exited) and delegates the two render branches here.
 */

import { Button } from "@manobu/ui/components/button";
import { Loader2, Square } from "lucide-react";

import type { AcpTerminalExitStatus } from "./acp-terminal-card";

/** The badge label for an exit status (null while running). */
function exitBadgeLabel(status: AcpTerminalExitStatus): string {
  if (status.signaled) {
    return "Killed";
  }
  if (status.exit_code === 0) {
    return "Exited 0";
  }
  return `Exited ${status.exit_code ?? "?"}`;
}

/** The exit badge: exit code, or the signal when the run was killed.
 * Renders nothing while the terminal is still running. */
export function AcpTerminalExitBadge({
  exitStatus,
  testIdPrefix,
}: {
  exitStatus: AcpTerminalExitStatus | null;
  testIdPrefix: string;
}) {
  if (exitStatus === null || exitStatus === undefined) {
    return null;
  }
  const label = exitBadgeLabel(exitStatus);
  return (
    <span
      className="rounded-none border border-muted-foreground/20 bg-muted px-1.5 py-0.5 font-medium text-muted-foreground text-xs"
      data-slot="acp-terminal-exit-badge"
      data-testid={`${testIdPrefix}-exit-badge`}
    >
      {label}
    </span>
  );
}

/** The running badge (warning-tinted "Running" pill). */
export function AcpTerminalRunningBadge({
  testIdPrefix,
}: {
  testIdPrefix: string;
}) {
  return (
    <span
      className="rounded-none border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-medium text-warning-foreground text-xs"
      data-slot="acp-terminal-running"
      data-testid={`${testIdPrefix}-running`}
    >
      Running
    </span>
  );
}

/** The Kill affordance: armed button, spinner while killing. */
export function AcpTerminalKillButton({
  isKilling,
  killingLabel,
  onKill,
  testIdPrefix,
  terminalId,
}: {
  isKilling: boolean;
  killingLabel: string;
  onKill: () => void;
  testIdPrefix: string;
  terminalId: string;
}) {
  return (
    <Button
      aria-label={`Kill terminal ${terminalId}`}
      data-testid={`${testIdPrefix}-kill`}
      disabled={isKilling}
      onClick={onKill}
      size="sm"
      variant="outline"
    >
      {isKilling ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : (
        <Square aria-hidden className="size-4" />
      )}
      {killingLabel}
    </Button>
  );
}

/** The cumulative-output region (full snapshot, never chunk-appended). */
export function AcpTerminalOutput({
  output,
  testIdPrefix,
}: {
  output: string;
  testIdPrefix: string;
}) {
  return (
    <pre
      className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-none border bg-muted/50 p-2 font-mono text-xs"
      data-slot="acp-terminal-output"
      data-testid={`${testIdPrefix}-output`}
    >
      {output === "" ? "(no output yet)" : String(output)}
    </pre>
  );
}
