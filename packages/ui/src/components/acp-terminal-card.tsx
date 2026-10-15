import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@manobu/ui/components/card";
import { cn } from "@manobu/ui/lib/utils";
import { useCallback, useRef, useState } from "react";

import {
  AcpTerminalExitBadge,
  AcpTerminalKillButton,
  AcpTerminalOutput,
  AcpTerminalRunningBadge,
} from "./acp-terminal-states";

/**
 * AcpTerminalCard — the AionUi terminal-output card (TASK-80.4.1).
 *
 * Ported from AionUi's `MessageAcpTerminalOutput` to @manobu/ui + the sumi
 * theme. The server streams CUMULATIVE snapshots (the full output buffer on
 * every frame, AionUi contract), so the card renders the card data as-is
 * (no chunk appending on the client).
 *
 * State machine + render branches (per-state split, TASK-81.3): the parent
 * owns the kill interaction and derives the state; the branches render via
 * `acp-terminal-states.tsx` (exit badge, running badge, output region,
 * kill button). Pinned by the SSR tests via `data-state`:
 *
 * - `running`: no exit status yet — the output scroll region is live, the
 *   Kill button is armed. A `truncated` flag renders the
 *   "output truncated" indicator.
 * - `exited`: an exit status arrived — the region is final, the Kill
 *   button is replaced by the exit-status badge (exit code, or a signal
 *   when `signaled`), and the title shows the settled state.
 *
 * Kill: `onKill` (the caller wires it to `chat.killTerminal`); in-flight
 * kills show a spinner (`data-state="killing"`), a rejection re-arms the
 * button with a one-line error (`data-state="kill-error"`).
 *
 * No `dark:` variants; no em dash in user-visible strings; the Kill button
 * is a real `<Button>` with an `aria-label` (axe-clean).
 */

// ── Card data shape (structural; chat-session maps TMessageTerminal in) ──

export interface AcpTerminalExitStatus {
  exit_code: number | null;
  signaled: boolean;
}

export interface AcpTerminalCardData {
  /** The command line the hosted terminal runs. */
  command: string;
  /** The exit status, or null while the command is still running. */
  exitStatus: AcpTerminalExitStatus | null;
  /** Cumulative output buffer (full snapshot, not a chunk). */
  output: string;
  terminalId: string;
  /** True once the server-side byte cap was hit (front-truncation). */
  truncated: boolean;
}

export interface AcpTerminalCardProps {
  card: AcpTerminalCardData;
  className?: string;
  /**
   * Kill the hosted terminal. Resolves on success (the running card is
   * effectively settled), rejects on failure (the card shows
   * `data-state="kill-error"` and re-arms the button). Only meaningful
   * while the card is still running.
   */
  onKill?: () => Promise<void>;
  /** Override the test id prefix (default `acp-terminal`). */
  testIdPrefix?: string;
}

/** The exit badge text: exit code, or the signal when the run was killed. */
export function exitStatusLabel(card: AcpTerminalCardData): string | null {
  if (card.exitStatus === null || card.exitStatus === undefined) {
    return null;
  }
  const status = card.exitStatus;
  if (status.signaled) {
    return "Killed";
  }
  return status.exit_code === 0
    ? "Exited 0"
    : `Exited ${status.exit_code ?? "?"}`;
}

/** Derive the card state string (the SSR-pinned data-state values). */
function terminalState(
  exited: boolean,
  isKilling: boolean,
  killError: boolean
): string {
  if (exited) {
    return "exited";
  }
  if (isKilling) {
    return "killing";
  }
  if (killError) {
    return "kill-error";
  }
  return "running";
}

/** The kill interaction: epoch-guarded in-flight/reject handling. */
function useTerminalKill(
  exited: boolean,
  onKill: (() => Promise<void>) | undefined
): { handleKill: () => void; isKilling: boolean; killError: boolean } {
  const [isKilling, setIsKilling] = useState(false);
  const [killError, setKillError] = useState(false);
  const killEpochRef = useRef(0);

  const handleKill = useCallback(() => {
    if (!onKill || isKilling || exited) {
      return;
    }
    const epoch = killEpochRef.current;
    setIsKilling(true);
    setKillError(false);
    onKill()
      .catch(() => {
        if (killEpochRef.current === epoch) {
          setKillError(true);
        }
      })
      .finally(() => {
        if (killEpochRef.current === epoch) {
          setIsKilling(false);
        }
      });
  }, [exited, isKilling, onKill]);

  return { handleKill, isKilling, killError };
}

export function AcpTerminalCard({
  card,
  className,
  onKill,
  testIdPrefix = "acp-terminal",
}: AcpTerminalCardProps) {
  const exited = card.exitStatus !== null && card.exitStatus !== undefined;
  const { handleKill, isKilling, killError } = useTerminalKill(exited, onKill);
  const state = terminalState(exited, isKilling, killError);

  return (
    <Card
      className={cn("w-full", className)}
      data-slot="acp-terminal-card"
      data-state={state}
      data-testid={`${testIdPrefix}-card`}
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="font-mono" data-testid={`${testIdPrefix}-command`}>
            {card.command}
          </span>
          {exited ? (
            <AcpTerminalExitBadge
              exitStatus={card.exitStatus}
              testIdPrefix={testIdPrefix}
            />
          ) : (
            <AcpTerminalRunningBadge testIdPrefix={testIdPrefix} />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <AcpTerminalOutput output={card.output} testIdPrefix={testIdPrefix} />
        {card.truncated ? (
          <p
            className="text-muted-foreground text-xs"
            data-testid={`${testIdPrefix}-truncated`}
          >
            Output truncated (server-side byte cap)
          </p>
        ) : null}
        {killError ? (
          <p
            className="text-destructive text-xs"
            data-testid={`${testIdPrefix}-kill-error`}
            role="alert"
          >
            Kill failed, retry
          </p>
        ) : null}
        {!exited && onKill ? (
          <AcpTerminalKillButton
            isKilling={isKilling}
            killingLabel={isKilling ? "Killing" : "Kill"}
            onKill={handleKill}
            terminalId={card.terminalId}
            testIdPrefix={testIdPrefix}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
