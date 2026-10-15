import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  ReaderShelf,
  ReadingCornerCompound,
} from "@/features/reader/reading-corner";
import { storyForKey } from "@/lib/reader-stories";

const readerSearchSchema = z.object({
  story: z.enum(["konbini", "preN5", "n5"]).optional().catch(undefined),
});

// data: local-state — the reading corner (SCR-05 redesign): no ?story=
// renders the shelf, ?story= renders that story. The TASK-23.3 deep-link
// contract (?story=preN5|konbini|n5) is preserved; the old /learn/reader
// route is now a redirect stub to here. Chrome-free like the worksheet —
// reading is the desk's focus mode.
export const Route = createFileRoute("/reader")({
  component: ReaderPage,
  validateSearch: readerSearchSchema,
});

function ReaderPage() {
  const { story } = Route.useSearch();
  if (!story) {
    return <ReaderShelf />;
  }
  const selected = storyForKey(story);
  return (
    <ReadingCornerCompound story={selected}>
      <ReadingCornerCompound.Bar />
      <ReadingCornerCompound.Page />
      <ReadingCornerCompound.Close />
    </ReadingCornerCompound>
  );
}
