/**
 * One JSON-RPC `tools/call` against a conversation's host-tools endpoint.
 *
 * The host tools (`ask_user`, `next_drill_item`, `start_exam`) are reached over
 * the streamable-HTTP transport, and every spec that drives them used to carry
 * its own copy of the request envelope plus the reply projection.
 */

import type { AskToolServer } from "../src/ask-tool";

/** The tool result projected out of the JSON-RPC envelope. */
export interface ToolReply {
  isError: boolean;
  text: string;
}

interface JsonRpcReply {
  error?: { code: number; message: string };
  result?: {
    content?: { text?: string }[];
    isError?: boolean;
  };
}

export const callHostTool = async (
  server: Pick<AskToolServer, "handleRequest">,
  token: string,
  call: { arguments: Record<string, unknown>; name: string }
): Promise<ToolReply> => {
  const response = await server.handleRequest(
    new Request(`http://127.0.0.1/internal/host-tools/${token}`, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: call.arguments, name: call.name },
      }),
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      method: "POST",
    })
  );
  const body = (await response.json()) as JsonRpcReply;
  if (body.error) {
    throw new Error(
      `transport error ${body.error.code}: ${body.error.message}`
    );
  }
  return {
    isError: body.result?.isError === true,
    text: body.result?.content?.[0]?.text ?? "",
  };
};
