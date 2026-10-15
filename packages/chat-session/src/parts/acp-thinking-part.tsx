import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@manobu/ui/components/collapsible";
import { ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";

/**
 * The thinking card renderer (TASK-87): a collapsed-by-default strip that
 * expands on click. The reasoning itself stays in the engine card and the
 * replayed transcript; only this renderer changed. The strip never echoes
 * raw reasoning, that was the noise being removed.
 *
 * `readerChoice` is the only state: null means "follow the stream" (open
 * while the turn is still thinking, collapsed once its answer card
 * lands), a boolean is the reader overriding that for the rest of the
 * turn. Replayed history has no live stream to follow, so it starts
 * collapsed.
 */
export function AcpThinkingPart({
  answered,
  isStreaming,
  text,
}: {
  answered: boolean;
  isStreaming: boolean;
  text: string;
}) {
  const [readerChoice, setReaderChoice] = useState<boolean | null>(null);
  const followingStream = isStreaming && !answered;
  const open = readerChoice ?? followingStream;
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setReaderChoice(nextOpen);
  }, []);

  return (
    <Collapsible className="w-full" onOpenChange={handleOpenChange} open={open}>
      <CollapsibleTrigger
        aria-label="Toggle thinking"
        className="flex w-full items-center gap-2 py-0.5 text-left text-muted-foreground text-sm"
      >
        <ChevronRight
          className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span data-testid="thinking-label">
          {followingStream ? "Thinking..." : "Thought"}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap px-1 py-2 text-muted-foreground text-xs">
          {text}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
