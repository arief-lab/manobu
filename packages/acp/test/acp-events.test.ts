/**
 * Host tool-call title predicate (TASK-110).
 *
 * The sidecar's host tools (`ask_user`, `next_drill_item`, `start_exam`)
 * arrive on the wire
 * under three title shapes: the bare name, the MCP-prefixed form the Tauri
 * shell renders (`manobu-host-tools_ask_user`), and a dash-prefixed form. The
 * transcript fold and the persistence filter both key off this one predicate,
 * so a change here changes what the learner sees: a false positive silently
 * deletes a real tool card, a false negative stacks a raw JSON card on top of
 * the card that is supposed to represent the tool.
 */

import { describe, expect, it } from "bun:test";

import { isHostToolCallTitle } from "../src/acp-events";

describe("isHostToolCallTitle", () => {
  it("claims the host tool in all three title shapes", () => {
    expect(isHostToolCallTitle("ask_user")).toBe(true);
    expect(isHostToolCallTitle("manobu-host-tools_ask_user")).toBe(true);
    expect(isHostToolCallTitle("host-ask_user")).toBe(true);
    expect(isHostToolCallTitle("next_drill_item")).toBe(true);
    expect(isHostToolCallTitle("manobu-host-tools_next_drill_item")).toBe(true);
    // TASK-147: the paper card the assembly publishes is the artifact, so the
    // raw tool card behind it is a duplicate, not information.
    expect(isHostToolCallTitle("start_exam")).toBe(true);
    expect(isHostToolCallTitle("manobu-host-tools_start_exam")).toBe(true);
  });

  it("claims a host tool behind any server prefix, by design", () => {
    // The rule is prefix-shaped, not exact: the Tauri shell renders the whole
    // MCP server name in front of the tool. A foreign server exposing a tool
    // literally named `ask_user` is therefore also suppressed — the deliberate
    // trade, since the alternative is a raw JSON card over the real one.
    expect(isHostToolCallTitle("my_ask_user")).toBe(true);
    expect(isHostToolCallTitle("some-other-server_next_drill_item")).toBe(true);
  });

  it("passes every other tool through, including near-miss names", () => {
    for (const title of [
      "read_file",
      "bash",
      "lookup_vocab",
      // Near misses: names that CONTAIN the host tool mid-word, or start with
      // it and go somewhere else.
      "ask_user_helper",
      "not_ask_user_at_all",
      "next_drill_item_extra",
      "start_exam_later",
    ]) {
      expect(isHostToolCallTitle(title)).toBe(false);
    }
  });

  it("claims nothing from a missing title", () => {
    expect(isHostToolCallTitle(null)).toBe(false);
    expect(isHostToolCallTitle(undefined)).toBe(false);
    expect(isHostToolCallTitle("")).toBe(false);
  });
});
