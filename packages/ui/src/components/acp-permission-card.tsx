import { Card, CardContent } from "@manobu/ui/components/card";
import { cn } from "@manobu/ui/lib/utils";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AcpPermissionOptionsFieldset,
  AcpPermissionStateBadge,
} from "./acp-permission-states";

/**
 * AcpPermissionCard — the AionUi permission-request panel (TASK-80.4).
 *
 * Ported from AionUi's `PermissionRequestPanel` (arco `Button` + `Card` +
 * css-modules) to @manobu/ui + the sumi theme. Per-state structure
 * (TASK-81.3): the parent owns the submit state machine and epoch guards;
 * the render branches live in `acp-permission-states.tsx` (options
 * fieldset, receipt/retry badge). Key behaviors pinned by the SSR tests:
 *
 * - **Single-click submit**: each option button submits on click (no
 *   separate confirm step). An in-flight guard drops double-clicks; the
 *   request/option epoch guards ignore a result that resolves after the
 *   request or option set changed underneath us.
 * - **Receipt**: on success the panel shows a "Response sent" status
 *   (`data-state="receipt"`).
 * - **Retry on failure**: on reject the panel re-arms the buttons and shows
 *   a one-line error (`data-state="retry"`).
 *
 * No `dark:` variants; option buttons are real `<Button>`s with `aria-label`
 * = the option name (axe-clean).
 */

export interface AcpPermissionOption {
  disabled?: boolean;
  /** The wire option id (sent back to `chat.confirm`). */
  id: string;
  /** Optional intent (allow/reject/neutral) for styling. */
  intent?: "allow" | "neutral" | "reject";
  /** The human label. */
  label: string;
}

export interface AcpPermissionCardProps {
  className?: string;
  description?: string;
  /** A readable detail block (command or JSON dump). */
  detail?: string;
  detailLabel?: string;
  /**
   * Submit a chosen option. Resolves on success (receipt), rejects on
   * failure (retry). The caller wires this to `chat.confirm`.
   */
  onSubmit: (optionId: string) => Promise<void>;
  operationKind?: string;
  options: AcpPermissionOption[];
  /**
   * A stable key for the request; when it changes the panel re-arms (new
   * permission request). Mirrors AionUi's `requestKey`.
   */
  requestKey?: string;
  testIdPrefix?: string;
  /** The card title (tool title / description). */
  title: string;
}

export function AcpPermissionCard({
  className,
  detail,
  detailLabel,
  description,
  onSubmit,
  operationKind,
  options,
  requestKey,
  testIdPrefix = "acp-permission",
  title,
}: AcpPermissionCardProps) {
  const [isResponding, setIsResponding] = useState(false);
  const [hasResponded, setHasResponded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const respondingRef = useRef(false);
  const requestEpochRef = useRef(0);
  const optionsEpochRef = useRef(0);

  // Re-arm when the request or option set changes (a new permission request).
  const prevRequestKeyRef = useRef(requestKey);
  const prevOptionsIdRef = useRef<string | null>(null);
  const optionsIdentity = options.map((o) => `${o.id}:${o.label}`).join(",");
  useEffect(() => {
    const requestChanged = prevRequestKeyRef.current !== requestKey;
    const optionsChanged = prevOptionsIdRef.current !== optionsIdentity;
    if (requestChanged || optionsChanged) {
      prevRequestKeyRef.current = requestKey;
      prevOptionsIdRef.current = optionsIdentity;
      requestEpochRef.current += 1;
      optionsEpochRef.current += 1;
      respondingRef.current = false;
      setIsResponding(false);
      setHasResponded(false);
      setHasError(false);
      setSubmittingId(null);
    }
  });

  const submitOption = useCallback(
    (option: AcpPermissionOption) => {
      if (isResponding || hasResponded || option.disabled) {
        return;
      }
      const requestEpoch = requestEpochRef.current;
      const optionsEpoch = optionsEpochRef.current;
      respondingRef.current = true;
      setIsResponding(true);
      setSubmittingId(option.id);
      setHasError(false);
      onSubmit(option.id)
        .then(() => {
          if (
            requestEpochRef.current === requestEpoch &&
            optionsEpochRef.current === optionsEpoch
          ) {
            setHasResponded(true);
          }
        })
        .catch(() => {
          if (
            requestEpochRef.current === requestEpoch &&
            optionsEpochRef.current === optionsEpoch
          ) {
            setHasError(true);
          }
        })
        .finally(() => {
          if (requestEpochRef.current === requestEpoch) {
            respondingRef.current = false;
            setIsResponding(false);
            setSubmittingId(null);
          }
        });
    },
    [onSubmit, hasResponded, isResponding]
  );

  // One click handler for the fieldset: maps data-option-id to submitOption.
  const handleOptionClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const { optionId } = event.currentTarget.dataset;
      if (optionId === undefined) {
        return;
      }
      const option = options.find((o) => o.id === optionId);
      if (option !== undefined) {
        submitOption(option);
      }
    },
    [options, submitOption]
  );

  let state: "default" | "receipt" | "retry" = "default";
  if (hasResponded) {
    state = "receipt";
  } else if (hasError) {
    state = "retry";
  }

  const hasDescription = description !== undefined && description !== title;
  const hasOperationKind = operationKind !== undefined;
  const hasDetail = detail !== undefined;
  const detailLabelText = detailLabel === undefined ? "Command" : detailLabel;

  return (
    <Card
      className={cn(
        "w-full border-dashed bg-muted/30 ring-foreground/5",
        className
      )}
      data-slot="acp-permission-card"
      data-state={state}
      data-testid={`${testIdPrefix}-card`}
      size="sm"
    >
      <CardContent aria-busy={isResponding} className="p-3">
        <div className="flex items-center gap-2">
          <span
            className="font-medium text-sm"
            data-slot="acp-permission-title"
          >
            {title}
          </span>
          {hasOperationKind ? (
            <span
              className="rounded-none bg-muted px-1.5 py-0.5 text-muted-foreground text-xs"
              data-slot="acp-permission-kind"
            >
              {operationKind}
            </span>
          ) : null}
        </div>
        {hasDescription ? (
          <p className="mt-1 text-muted-foreground text-xs">{description}</p>
        ) : null}

        {hasDetail ? (
          <div className="mt-2" data-slot="acp-permission-detail">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
              {detailLabelText}
            </div>
            <code className="block whitespace-pre-wrap break-words font-mono text-xs">
              {detail}
            </code>
          </div>
        ) : null}

        {state === "default" ? (
          <AcpPermissionOptionsFieldset
            isResponding={isResponding}
            onOptionClick={handleOptionClick}
            options={options}
            submittingId={submittingId}
            testIdPrefix={testIdPrefix}
          />
        ) : null}

        <AcpPermissionStateBadge state={state} testIdPrefix={testIdPrefix} />
      </CardContent>
    </Card>
  );
}
