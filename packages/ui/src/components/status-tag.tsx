import { cn } from "@manobu/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

/**
 * StatusTag — a small status pill for the AionUi card set (TASK-80.4).
 *
 * Ported from AionUi's inline `StatusTag` (arco `Tag`) to a sumi-themed
 * span. The four variants map to the ACP tool-call states + generic card
 * states:
 *
 *   pending      -> blue (info)
 *   in_progress  -> orange (warning)
 *   completed    -> gray (muted)
 *   failed       -> gray (muted, destructive text)
 *
 * Rendered with `data-slot="status-tag"` + `data-state={variant}` so the
 * SSR tests pin the state table. No `dark:` variants (one sumi theme),
 * WCAG AA on the solid fills.
 */

const statusTagVariants = cva(
  "inline-flex items-center rounded-none border px-1.5 py-0.5 font-medium text-xs leading-none",
  {
    defaultVariants: {
      variant: "completed",
    },
    variants: {
      variant: {
        completed: "border-muted-foreground/20 bg-muted text-muted-foreground",
        failed: "border-destructive/30 bg-destructive/10 text-destructive",
        in_progress: "border-warning/30 bg-warning/10 text-warning-foreground",
        pending: "border-info/30 bg-info/10 text-info-foreground",
      },
    },
  }
);

/** The ACP tool-call / generic card status states StatusTag renders. */
export type StatusTagVariant =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

const STATUS_LABELS: Record<StatusTagVariant, string> = {
  completed: "Completed",
  failed: "Failed",
  in_progress: "In progress",
  pending: "Pending",
};

/** Map a raw ACP `status` string (or any value) to a StatusTag variant. */
export function toStatusVariant(
  status: string | null | undefined
): StatusTagVariant {
  if (status === "pending") {
    return "pending";
  }
  if (status === "in_progress") {
    return "in_progress";
  }
  if (status === "failed" || status === "error") {
    return "failed";
  }
  return "completed";
}

function StatusTag({
  className,
  status,
  variant,
  ...props
}: React.ComponentProps<"span"> & {
  /** The raw ACP status string (e.g. `"in_progress"`). Mapped via
   * `toStatusVariant`. */
  status?: string | null;
  /** An explicit variant. Wins over `status` when both are provided. */
  variant?: StatusTagVariant;
} & VariantProps<typeof statusTagVariants>) {
  const effectiveVariant: StatusTagVariant = variant ?? toStatusVariant(status);
  return (
    <span
      className={cn(
        statusTagVariants({ variant: effectiveVariant }),
        className
      )}
      data-slot="status-tag"
      data-state={effectiveVariant}
      role="status"
      {...props}
    >
      {STATUS_LABELS[effectiveVariant]}
    </span>
  );
}

export { StatusTag, statusTagVariants };
