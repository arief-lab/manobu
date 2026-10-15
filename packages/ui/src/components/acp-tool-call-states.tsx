/**
 * Per-state subcomponents for AcpToolCallCard (TASK-81.3). The parent
 * (`acp-tool-call-card.tsx`) is a thin two-branch switch; each render
 * path and the truncated-expand interaction live here.
 */

import { StatusTag, toStatusVariant } from "@manobu/ui/components/status-tag";
import { cn } from "@manobu/ui/lib/utils";
import { createTwoFilesPatch } from "diff";
import { useCallback, useMemo, useState } from "react";

import {
  type AcpDiffContentItem,
  type AcpToolCallCardData,
  getKindDisplayName,
  isDiffOnly,
  isImageOutput,
  pickDiffItems,
} from "./tool-call-shared";

// ── Diff view ─────────────────────────────────────────────────────────────────

/** One parsed diff line (for the line-by-line unified view). */
interface DiffLine {
  text: string;
  type: "add" | "context" | "remove";
}

const DIFF_PATH_SEP = /[/\\]/;

/**
 * Parse a `createTwoFilesPatch` output into line records. A replacement for
 * AionUi's `parseDiff` (which feeds its FileChangesPanel); we render the
 * unified lines directly.
 */
function parseUnifiedDiffLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      lines.push({ text: raw.slice(1), type: "add" });
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      lines.push({ text: raw.slice(1), type: "remove" });
    } else if (raw.startsWith(" ")) {
      lines.push({ text: raw.slice(1), type: "context" });
    }
  }
  return lines;
}

/** A bare file-changes panel (diff-only fast path). */
function DiffPanel({ diff }: { diff: AcpDiffContentItem }) {
  const displayName =
    diff.path.split(DIFF_PATH_SEP).pop() || diff.path || "Unknown file";
  const patch = useMemo(
    () =>
      createTwoFilesPatch(
        displayName,
        displayName,
        diff.old_text,
        diff.new_text,
        "",
        "",
        { context: 3 }
      ),
    [displayName, diff.new_text, diff.old_text]
  );
  const diffLines = useMemo(() => parseUnifiedDiffLines(patch), [patch]);
  return (
    <div className="mb-2 w-full" data-slot="file-changes">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-2 py-1 font-medium text-xs">
        <span data-slot="file-changes-title">{displayName}</span>
      </div>
      <pre className="overflow-x-auto p-2 font-mono text-xs">
        <code>
          {diffLines.map((line) => (
            <span
              className={cn(
                "block whitespace-pre",
                line.type === "add" &&
                  "bg-emerald-500/10 text-emerald-foreground",
                line.type === "remove" && "bg-rose-500/10 text-rose-foreground"
              )}
              data-diff-line={line.type}
              key={`line-${line.type}-${line.text}`}
            >
              {line.text || " "}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

// ── Per-state exports ────────────────────────────────────────────────────────

/** The tool-call lifecycle status tag (pending/in_progress/completed/failed). */
export function ToolCallStateTag({ status }: { status: string | null }) {
  return <StatusTag status={status} variant={toStatusVariant(status)} />;
}

/**
 * The raw tool-call id as text (TASK-160). A UUID is a transport correlation
 * id: it names nothing a learner can act on, and every external tool call
 * used to print one in the transcript. Rendered only behind the host's
 * developer affordance, never by default.
 */
export function ToolCallIdLine({ toolCallId }: { toolCallId: string }) {
  return (
    <div className="mt-2 text-muted-foreground text-xs" data-slot="acp-tool-id">
      Tool Call ID: {toolCallId}
    </div>
  );
}

/** The diff-only fast path: a bare panel per diff, no Card shell. */
export function ToolCallDiffPanels({
  card,
  className,
  debug,
  testIdPrefix,
}: {
  card: AcpToolCallCardData;
  className?: string;
  debug: boolean;
  testIdPrefix: string;
}) {
  const diffs = pickDiffItems(card.content);
  return (
    <div className={cn("w-full", className)} data-slot="acp-tool-call-card">
      <div className="flex items-center gap-2">
        <ToolCallStateTag status={card.status} />
      </div>
      {debug ? <ToolCallIdLine toolCallId={card.toolCallId} /> : null}
      {diffs.map((diff) => (
        <DiffPanel diff={diff} key={diff.path} />
      ))}
      {/* testIdPrefix keeps the prop symmetric with the generic path; the
          fast path renders no Card shell so it carries no test id. */}
      <span className="hidden" data-testid={`${testIdPrefix}-diff-only`} />
    </div>
  );
}

/** raw_input / raw_output body of the generic card. */
export function ToolCallGenericBody({
  card,
  testIdPrefix,
}: {
  card: AcpToolCallCardData;
  testIdPrefix: string;
}) {
  const title = card.title || getKindDisplayName(card.kind);
  const hasInput = card.raw_input !== undefined && card.raw_input !== null;
  const hasOutput = card.raw_output !== undefined && card.raw_output !== null;
  const diffs = pickDiffItems(card.content);
  const diffOnly = isDiffOnly(card);

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <span className="truncate font-medium" data-slot="acp-tool-title">
          {title}
        </span>
        <ToolCallStateTag status={card.status} />
      </div>

      {hasInput ? (
        <div className="text-sm" data-slot="acp-tool-input">
          <JsonPre value={card.raw_input} />
        </div>
      ) : null}

      {isImageOutput(card.raw_output) ? (
        <div
          className="mt-3 overflow-hidden rounded-none border bg-muted/40 p-2"
          data-slot="acp-tool-image"
        >
          <img
            alt="Tool output"
            className="max-h-[520px] max-w-full object-contain"
            height={520}
            src={String(card.raw_output)}
            width={520}
          />
        </div>
      ) : null}

      {hasOutput && !isImageOutput(card.raw_output) ? (
        <div className="mt-2 text-muted-foreground text-xs">
          <JsonPre value={card.raw_output} />
        </div>
      ) : null}

      {/* Mixed (non-diff-only) content that still carries diffs */}
      {!diffOnly &&
        diffs.map((diff) => <DiffPanel diff={diff} key={diff.path} />)}

      <span className="hidden" data-testid={`${testIdPrefix}-body`} />
    </>
  );
}

function JsonPre({ value }: { value: unknown }) {
  return (
    <pre className="max-h-60 overflow-x-auto rounded-none bg-muted/40 p-2 text-xs">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** The truncated-card expand affordance (button only; state text below). */
export function ToolCallExpandButton({
  loading,
  onExpand,
  testIdPrefix,
}: {
  loading: boolean;
  onExpand: () => void;
  testIdPrefix: string;
}) {
  return (
    <button
      aria-label="Expand full tool output"
      className="mt-2 inline-flex items-center gap-1 rounded-none bg-muted px-2 py-1 text-xs hover:bg-muted/80"
      data-slot="acp-tool-expand"
      data-testid={`${testIdPrefix}-expand`}
      disabled={loading}
      onClick={onExpand}
      type="button"
    >
      {loading ? "Loading..." : "Expand"}
    </button>
  );
}

/** The truncated-expand interaction: loading/error/expanded + data-state. */
export function useToolCallExpand({
  card,
  expandedCard,
  onExpand,
}: {
  card: AcpToolCallCardData;
  expandedCard?: AcpToolCallCardData | null;
  onExpand?: (card: AcpToolCallCardData) => Promise<AcpToolCallCardData>;
}): {
  cardState: string;
  error: string | null;
  expanded: boolean;
  handleExpand: () => void;
  loading: boolean;
} {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExpand = useCallback(() => {
    if (!onExpand || card.truncated === false || expandedCard) {
      setExpanded(true);
      return;
    }
    setLoading(true);
    setError(null);
    onExpand(card)
      .then(() => {
        setExpanded(true);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [card, expandedCard, onExpand]);

  let cardState = "default";
  if (loading) {
    cardState = "loading";
  } else if (error) {
    cardState = "error";
  } else if (expanded) {
    cardState = "expanded";
  }

  return { cardState, error, expanded, handleExpand, loading };
}
