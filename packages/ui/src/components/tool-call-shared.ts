/**
 * Tool-call card shared vocabulary (TASK-81.3): the public data shapes and
 * pure helpers the per-state subcomponents consume. Re-exported by the
 * parent `acp-tool-call-card.tsx` so the import surface is unchanged.
 */

// ── Card data shape (structural; chat-session maps TMessageAcpToolCall in) ──

export interface AcpDiffContentItem {
  new_text: string;
  old_text: string;
  path: string;
  type: "diff";
  [key: string]: unknown;
}

export interface AcpContentItem {
  type: string;
  [key: string]: unknown;
}

export interface AcpToolCallCardData {
  content?: AcpContentItem[] | null;
  /** ACP tool kind: `edit` / `read` / `execute` / custom. */
  kind: string | null;
  raw_input: unknown;
  raw_output: unknown;
  status: string | null;
  title: string | null;
  toolCallId: string;
  /** The compact/truncated marker (the 80.3 fold sets it on compact rows). */
  truncated?: boolean;
}

export interface AcpToolCallCardProps {
  card: AcpToolCallCardData;
  className?: string;
  /**
   * Developer affordance (TASK-160): render the raw tool-call id as text. A
   * UUID means nothing to a learner and every external tool call used to
   * print one, so it is off unless the host turns it on. The id stays on the
   * card's `data-tool-call-id` attribute either way: invisible, and what
   * tests select on.
   */
  debug?: boolean;
  /** The refetched full payload (when `onExpand` resolved). */
  expandedCard?: AcpToolCallCardData | null;
  /**
   * Called when the user expands a truncated card. The caller refetches the
   * full payload and passes the result back through `expandedCard`. Returns
   * a Promise so the card can show a loading state.
   */
  onExpand?: (card: AcpToolCallCardData) => Promise<AcpToolCallCardData>;
  /** Override the test id prefix (default `acp-tool-call`). */
  testIdPrefix?: string;
}

/** Kind display names (AionUi parity). */
export function getKindDisplayName(kind: string | null): string {
  switch (kind) {
    case "edit":
      return "File Edit";
    case "read":
      return "File Read";
    case "execute":
      return "Shell Command";
    default:
      return kind ?? "Tool";
  }
}

/** True when every content item is a diff with the fields the panel needs. */
export function isDiffOnly(card: AcpToolCallCardData): boolean {
  const items = card.content;
  if (!Array.isArray(items) || items.length === 0) {
    return false;
  }
  return (
    !card.truncated &&
    items.every(
      (item): item is AcpDiffContentItem =>
        item.type === "diff" &&
        typeof (item as AcpDiffContentItem).path === "string" &&
        (item as AcpDiffContentItem).path.trim() !== "" &&
        typeof (item as AcpDiffContentItem).old_text === "string" &&
        typeof (item as AcpDiffContentItem).new_text === "string"
    )
  );
}

/** Filter a content array down to the diff items the panel can render. */
export function pickDiffItems(
  content: AcpContentItem[] | null | undefined
): AcpDiffContentItem[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(
    (item): item is AcpDiffContentItem =>
      item.type === "diff" &&
      typeof item.path === "string" &&
      item.path.trim() !== ""
  );
}

/** An image output (base64 data-URI or a path the client can resolve). */
export function isImageOutput(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return value.startsWith("data:image/") || IMAGE_EXTENSION.test(value);
}

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
