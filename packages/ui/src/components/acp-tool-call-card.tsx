import { Card, CardContent } from "@manobu/ui/components/card";
import { Skeleton } from "@manobu/ui/components/skeleton";
import { cn } from "@manobu/ui/lib/utils";
import type { AcpToolCallCardProps } from "./tool-call-shared";
import { isDiffOnly } from "./tool-call-shared";

export {
  getKindDisplayName,
  isDiffOnly,
  pickDiffItems,
} from "./tool-call-shared";

/**
 * AcpToolCallCard — the AionUi-style tool-call card (TASK-80.4).
 *
 * Ported from AionUi's `MessageAcpToolCall` (arco `Card` + `Tag` +
 * `FileChangesPanel`) to @manobu/ui + the sumi theme. Per-state structure
 * (TASK-81.3): the parent is a thin state switch; each render path lives
 * in its own subcomponent in `acp-tool-call-states.tsx`:
 *
 * - `ToolCallDiffPanels` — the diff-only fast path (bare file-changes
 *   panels, no Card shell) when every `content` item is a renderable diff.
 * - `ToolCallGenericCard` — the generic `Card` (title + StatusTag,
 *   raw_input JSON, image/text output, mixed diffs, truncated-expand).
 *
 * The truncated-expand interaction (loading/error/expanded, pinned via
 * `data-state`) is owned by `useToolCallExpand`.
 *
 * No `dark:` variants; no em dash in user-visible strings; all interactive
 * controls are real `<button>`s with `aria-label` (axe-clean).
 */

import {
  ToolCallDiffPanels,
  ToolCallExpandButton,
  ToolCallGenericBody,
  ToolCallIdLine,
  useToolCallExpand,
} from "./acp-tool-call-states";

export type {
  AcpContentItem,
  AcpDiffContentItem,
  AcpToolCallCardData,
  AcpToolCallCardProps,
} from "./tool-call-shared";

/** The parent: a thin two-branch state switch (TASK-81.3). */
export function AcpToolCallCard({
  card,
  className,
  debug = false,
  expandedCard,
  onExpand,
  testIdPrefix = "acp-tool-call",
}: AcpToolCallCardProps) {
  const expand = useToolCallExpand({ card, expandedCard, onExpand });
  const live = expandedCard ?? card;
  const expandedDiff = isDiffOnly(live);

  // Diff-only fast path: a bare file-changes panel per diff, no Card shell.
  if (expandedDiff && !live.truncated) {
    return (
      <ToolCallDiffPanels
        card={live}
        className={className}
        debug={debug}
        testIdPrefix={testIdPrefix}
      />
    );
  }

  // Generic card.
  const showExpand = Boolean(card.truncated && onExpand);
  return (
    <Card
      className={cn(
        "w-full border-dashed bg-muted/30 ring-foreground/5",
        className
      )}
      data-slot="acp-tool-call-card"
      data-state={expand.cardState}
      data-testid={`${testIdPrefix}-card`}
      data-tool-call-id={live.toolCallId}
      size="sm"
    >
      <CardContent className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <ToolCallGenericBody card={live} testIdPrefix={testIdPrefix} />

          {debug ? <ToolCallIdLine toolCallId={live.toolCallId} /> : null}

          {showExpand && !expand.expanded ? (
            <ToolCallExpandButton
              loading={expand.loading}
              onExpand={expand.handleExpand}
              testIdPrefix={testIdPrefix}
            />
          ) : null}
          {expand.loading ? (
            <div className="mt-2" data-slot="acp-tool-loading">
              <Skeleton className="h-4 w-32" />
            </div>
          ) : null}
          {expand.error ? (
            <div
              className="mt-2 text-destructive text-xs"
              data-slot="acp-tool-error"
              role="alert"
            >
              {expand.error}{" "}
              <button
                aria-label="Retry expand"
                className="underline hover:no-underline"
                onClick={expand.handleExpand}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
