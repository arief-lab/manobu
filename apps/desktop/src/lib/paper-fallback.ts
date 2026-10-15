import type { JlptLevel } from "@manobu/api-contract";
import { type ExamSectionId, examSectionLabel } from "@manobu/api-contract";
import type {
  PaperCardProps,
  PaperSectionSummary,
} from "@manobu/ui/components/paper-card";
import type { Question } from "./mock";

const sectionForQuestion = (question: Question): ExamSectionId => {
  if (question.section === "listening") {
    return "listening";
  }
  if (question.section === "reading") {
    return "grammar-reading";
  }
  return "vocabulary";
};

export const offlinePaperCard = (
  level: JlptLevel,
  questions: readonly Question[]
): PaperCardProps => {
  const sections = new Map<ExamSectionId, PaperSectionSummary>();
  for (const question of questions) {
    const id = sectionForQuestion(question);
    const current = sections.get(id) ?? {
      id,
      // The offline card is always `mode: "shortened"` (below), so the English
      // name is the correct one here; it is never a real-mode surface
      // (TASK-173.3).
      label: examSectionLabel(id),
      state: "ready" as const,
      total: 0,
      validated: 0,
    };
    current.total += 1;
    current.validated += 1;
    sections.set(id, current);
  }
  return {
    examId: "offline-seed",
    level,
    mode: "shortened",
    offline: true,
    phase: "ready",
    sections: [...sections.values()],
    total: questions.length,
    validated: questions.length,
  };
};

export const offlinePaperItems = (
  level: JlptLevel,
  questions: readonly Question[]
): Array<{
  anchors: string[];
  id: string;
  itemType: string;
  level: string;
  options: string[];
  prompt: string;
}> =>
  questions.map((question) => ({
    anchors: [question.grammarId],
    id: question.id,
    itemType: "grammar-form",
    level,
    options: question.choiceIds.map(
      (choiceId) => question.choices[choiceId] ?? ""
    ),
    prompt: question.prompt,
  }));
