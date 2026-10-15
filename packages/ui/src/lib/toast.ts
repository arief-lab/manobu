import { toast } from "sonner";

import { t } from "./copy";

/**
 * Undo-able toast for "Save to FSRS" with 5s undo (spec §Copy Matrix).
 * Returns a promise that resolves true if undo was pressed, false if the
 * timeout elapsed. Reserve destructive colors for errors only (no red
 * accent here — uses neutral toast background, the red `#b42318` is for
 * errors only per spec §Global Systems).
 */
export const saveFsrsToast = (args: {
  n: number;
  retention: number;
  onUndo: () => void;
}): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    let undoPressed = false;
    const id = toast.success(
      t("review.save_toast", {
        n: args.n,
        retention: Math.round(args.retention * 100),
      }),
      {
        action: {
          label: "Undo",
          onClick: () => {
            undoPressed = true;
            args.onUndo();
            resolve(true);
          },
        },
        description: "Saved locally · no network",
        duration: 5000,
        onAutoClose: () => {
          if (!undoPressed) {
            resolve(false);
          }
        },
        onDismiss: () => {
          if (!undoPressed) {
            resolve(false);
          }
        },
      }
    );
    return () => {
      toast.dismiss(id);
    };
  });

/**
 * Error toast — only place where we use the destructive color (`#b42318`).
 * All errors follow spec §Error pattern: What + Why + What to do.
 */
export const errorToast = (
  key:
    | "error.audio"
    | "error.disk_full"
    | "error.download"
    | "error.api_key"
    | "error.quota"
    | "error.offline",
  vars: Record<string, string | number> = {}
): void => {
  toast.error(t(key, vars), {
    description: `${t("error.why")}: see ${t("error.action")}`,
    duration: 8000,
  });
};

/**
 * FTC click-to-cancel equivalent: Reset must require typing `RESET` exactly.
 * Returns true on confirm.
 */
export const confirmReset = (typed: string): boolean => typed === "RESET";
