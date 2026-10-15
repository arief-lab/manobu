import { t } from "@manobu/ui/lib/copy";

/**
 * The ONE name for a conversation with no title, so the header, the history
 * list and the exam workspace cannot disagree (TASK-163).
 *
 * A chat the learner has not prompted yet is unnamed in exactly the way a
 * saved row with a null title is, and it takes that row's name the moment it
 * persists, so both states share the label. The sub-line under the composer
 * header is what tells them apart.
 */
export const chatTitle = (
  conversation: { title: string | null } | undefined
): string => conversation?.title ?? t("chat.untitled");
