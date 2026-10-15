import { Streamdown } from "streamdown";

/**
 * A text part rendered as markdown (TASK-79.5: extracted verbatim from
 * `message-transcript.tsx` so per-tool part components live together under
 * `parts/`). `isAnimating` drives Streamdown's streaming cursor; the caller
 * decides it from chat status + message role.
 */
export function TextPart({
  isStreaming,
  part,
}: {
  isStreaming: boolean;
  part: { text: string };
}) {
  return <Streamdown isAnimating={isStreaming}>{part.text}</Streamdown>;
}
