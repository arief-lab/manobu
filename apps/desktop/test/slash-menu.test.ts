import { describe, expect, it } from "bun:test";
import {
  type AcpCommand,
  acpCommandsToItems,
  filterCommands,
  initialSlashMenuState,
  mergeSlashCommands,
  selectedInsertText,
  slashMenuReducer,
} from "@manobu/chat-session/slash";

/*
 * TASK-80.5 AC#3: the fake agent's available_commands payload must
 * surface in the composer menu. The lane is pure, so the "fake agent
 * payload -> menu" path is pinned headlessly: the frame/procedure
 * shape maps to items, merges with (here, no) builtins, and filters
 * against the composer's draft. The live-DOM accept (Enter/Tab
 * inserting `/<name> ` into the textarea, AC#1) is pinned through the
 * same controller the /ai route drives (no DOM env in the workspace);
 * the route's React wiring is verified by type-check + the browser.
 */

/** A fake agent's `available_commands_update` payload (ACP shape). */
const FAKE_AGENT_COMMANDS: AcpCommand[] = [
  {
    description: "Review the current diff for bugs and style",
    input: { hint: "scope?" },
    name: "review",
  },
  {
    description: "Plan the week's study sessions",
    input: null,
    name: "plan",
  },
  {
    description: "Summarize the conversation so far",
    input: { hint: null },
    name: "summary",
  },
];

describe("TASK-80.5 slash menu lane (desktop composer data path)", () => {
  it("fake-agent available_commands surface in the filtered menu (AC#3)", () => {
    const items = mergeSlashCommands(
      [],
      acpCommandsToItems(FAKE_AGENT_COMMANDS)
    );
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.source === "acp")).toBe(true);

    const result = filterCommands("/rev", items);
    expect(result.query).toBe("rev");
    expect(result.items.map((item) => item.name)).toEqual(["review"]);
    // The hint survives the ACP mapping (`input.hint` wins over `hint`).
    expect(result.items[0]?.hint).toBe("scope?");
  });

  it("accepting a row inserts `/<name> ` as plain draft text (AC#1)", () => {
    const items = mergeSlashCommands(
      [],
      acpCommandsToItems(FAKE_AGENT_COMMANDS)
    );
    let state = slashMenuReducer(initialSlashMenuState(), {
      draft: "/pl",
      items,
      type: "input",
    });
    expect(state.open).toBe(true);

    state = slashMenuReducer(state, {
      draft: "/pl",
      items,
      key: "Enter",
      type: "keydown",
    });
    expect(selectedInsertText(state.result.items, state.activeIndex)).toBe(
      "/plan "
    );

    // The route's accept closes the menu via the `select` event.
    state = slashMenuReducer(state, {
      draft: "/plan ",
      index: state.activeIndex,
      items,
      type: "select",
    });
    expect(state.open).toBe(false);
  });

  it("an empty draft keeps the menu closed (no query in progress)", () => {
    const items = acpCommandsToItems(FAKE_AGENT_COMMANDS);
    const state = slashMenuReducer(initialSlashMenuState(), {
      draft: "hello",
      items,
      type: "input",
    });
    expect(state.open).toBe(false);
  });
});
