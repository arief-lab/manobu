/**
 * Per-state subcomponents for AcpPermissionCard (TASK-81.3). The parent
 * (`acp-permission-card.tsx`) keeps the submit state machine (default/
 * receipt/retry + epoch guards) and delegates the per-state render
 * branches here.
 */

import { Button } from "@manobu/ui/components/button";
import { AlertTriangleIcon, CheckIcon, Loader2 } from "lucide-react";
import type * as React from "react";
import { useCallback, useId, useRef } from "react";

import type { AcpPermissionOption } from "./acp-permission-card";

/** The receipt / retry feedback branch. Renders nothing while default. */
export function AcpPermissionStateBadge({
  state,
  testIdPrefix,
}: {
  state: "default" | "receipt" | "retry";
  testIdPrefix: string;
}) {
  if (state === "receipt") {
    return (
      <div
        className="mt-2 flex items-center gap-1.5 text-muted-foreground text-xs"
        data-testid={`${testIdPrefix}-status`}
        role="status"
      >
        <CheckIcon aria-hidden="true" className="size-3.5" />
        <span>Response sent</span>
      </div>
    );
  }
  if (state === "retry") {
    return (
      <div
        className="mt-2 flex items-center gap-1.5 text-destructive text-xs"
        data-testid={`${testIdPrefix}-error`}
        role="alert"
      >
        <AlertTriangleIcon aria-hidden="true" className="size-3.5" />
        <span>Response failed. Try again.</span>
      </div>
    );
  }
  return null;
}

/** The option-row kind split (ACP spec): allow rows render secondary,
 * reject rows render destructive. */
export function AcpPermissionOptionButton({
  isResponding,
  label,
  onClick,
  option,
  submittingId,
  testIdPrefix,
}: {
  isResponding: boolean;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  option: AcpPermissionOption;
  submittingId: string | null;
  testIdPrefix: string;
}) {
  return (
    <Button
      aria-label={label}
      className="min-w-24"
      data-disabled={Boolean(option.disabled || isResponding)}
      data-option-id={option.id}
      data-testid={
        option.id === "" ? undefined : `${testIdPrefix}-option-${option.id}`
      }
      disabled={option.disabled || isResponding}
      onClick={onClick}
      size="sm"
      variant={option.intent === "reject" ? "destructive" : "secondary"}
    >
      {submittingId === option.id ? (
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
      ) : null}
      <span>{label}</span>
    </Button>
  );
}

/** The options fieldset (default state only): one row per option, with
 * the sr-only legend and the empty fallback. */
export function AcpPermissionOptionsFieldset({
  isResponding,
  onOptionClick,
  options,
  submittingId,
  testIdPrefix,
}: {
  isResponding: boolean;
  onOptionClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  options: AcpPermissionOption[];
  submittingId: string | null;
  testIdPrefix: string;
}) {
  const optionsLabelId = useId();
  // Per-button click handler reads the option id from the button's own
  // data-option-id, so one handler serves all buttons without per-item
  // closures.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const { optionId } = event.currentTarget.dataset;
      if (optionId === undefined) {
        return;
      }
      if (optionsRef.current.some((o) => o.id === optionId)) {
        onOptionClick(event);
      }
    },
    [onOptionClick]
  );

  return (
    <fieldset
      aria-labelledby={optionsLabelId}
      className="mt-3"
      disabled={isResponding}
    >
      <legend className="sr-only" id={optionsLabelId}>
        Choose an action
      </legend>
      {options.length > 0 ? (
        <div
          className="flex flex-wrap gap-2"
          data-testid={`${testIdPrefix}-options`}
        >
          {options.map((option) => (
            <AcpPermissionOptionButton
              isResponding={isResponding}
              key={option.id}
              label={option.label}
              onClick={handleClick}
              option={option}
              submittingId={submittingId}
              testIdPrefix={testIdPrefix}
            />
          ))}
        </div>
      ) : (
        <span className="text-muted-foreground text-xs">
          No options available
        </span>
      )}
    </fieldset>
  );
}
