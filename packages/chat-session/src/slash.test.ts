/**
 * TASK-80.5 AC#1 — the slash-command lane, pinned headlessly (no DOM env in
 * the workspace, the same constraint the 80.3/80.4 SSR tests worked under).
 * The lane is a pure module: filter regex + fuzzy highlight + the menu
 * controller's accept transitions + the authoritative-then-overlay rule.
 */
import { describe, expect, it } from "bun:test";

import {
  acpCommandsToItems,
  filterCommands,
  hasModeOption,
  highlightRanges,
  initialSlashMenuState,
  isSlashQuery,
  menuOwnsKey,
  mergeSlashCommands,
  type SlashCommandItem,
  selectedInsertText,
  shouldApplyOverlay,
  slashMenuReducer,
} from "./slash";

const COMMANDS: SlashCommandItem[] = [
  {
    description: "Review the diff",
    hint: "[files]",
    kind: "template",
    name: "review",
    selectionBehavior: "insert",
    source: "acp",
  },
  {
    description: "Summarize the thread",
    hint: null,
    kind: "template",
    name: "summarize",
    selectionBehavior: "insert",
    source: "acp",
  },
  {
    description: "manobu builtin",
    hint: null,
    kind: "builtin",
    name: "clear",
    selectionBehavior: "insert",
    source: "builtin",
  },
];

// ── filter regex ──────────────────────────────────────────────────────────────

describe("slash query gate", () => {
  it("accepts a bare slash and name characters only", () => {
    expect(isSlashQuery("/")).toBe(true);
    expect(isSlashQuery("/re")).toBe(true);
    expect(isSlashQuery("/re-view")).toBe(true);
    expect(isSlashQuery("/re_view")).toBe(true);
    // Prose, not a command: the menu must stay closed.
    expect(isSlashQuery("/re view")).toBe(false);
    expect(isSlashQuery("hi /re")).toBe(false);
    expect(isSlashQuery("/re.md")).toBe(false);
    expect(isSlashQuery("")).toBe(false);
  });

  it("a non-query draft yields an empty menu", () => {
    const result = filterCommands("hello world", COMMANDS);
    expect(result.items).toHaveLength(0);
    expect(result.query).toBe("");
  });
});

// ── fuzzy match + highlight ───────────────────────────────────────────────────

describe("filterCommands + highlightRanges", () => {
  it("a bare slash lists every command, name-sorted", () => {
    const result = filterCommands("/", COMMANDS);
    expect(result.items.map((c) => c.name)).toEqual([
      "clear",
      "review",
      "summarize",
    ]);
  });

  it("a substring query matches case-insensitively", () => {
    const result = filterCommands("/REV", COMMANDS);
    expect(result.items.map((c) => c.name)).toEqual(["review"]);
  });

  it("a non-contiguous char subsequence matches the name", () => {
    const result = filterCommands("/se", COMMANDS);
    // "se" is a char subsequence of "summarize" (s ... e) that no other
    // command name contains, so it isolates that row.
    expect(result.items.map((c) => c.name)).toEqual(["summarize"]);
  });

  it("highlight ranges offset into the NAME, not the draft", () => {
    const item: SlashCommandItem = {
      description: "Summarize the thread",
      hint: null,
      kind: "template",
      name: "summarize",
      selectionBehavior: "insert",
      source: "acp",
    };
    const ranges = highlightRanges(item, "se");
    expect(ranges[0]).toEqual([0, 1]); // "s"
    expect(ranges[1]).toEqual([8, 9]); // "e"
  });

  it("prefix matches rank above other matches", () => {
    const result = filterCommands("/re", COMMANDS);
    expect(result.items[0]?.name).toBe("review");
  });
});

// ── controller accept (Enter/Tab) ────────────────────────────────────────────

describe("slashMenuReducer accept on Enter/Tab", () => {
  it("Enter on an open menu clamps the active index and the insertion text is /<name> ", () => {
    let state = initialSlashMenuState();
    state = slashMenuReducer(state, {
      draft: "/re",
      items: COMMANDS,
      type: "input",
    });
    expect(state.open).toBe(true);
    expect(state.activeIndex).toBe(0);
    state = slashMenuReducer(state, {
      draft: "/re",
      items: COMMANDS,
      key: "Enter",
      type: "keydown",
    });
    // The active row is the first (prefix) match: "review".
    const insert = selectedInsertText(state.result.items, state.activeIndex);
    expect(insert).toBe("/review ");
  });

  it("Tab after ArrowDown accepts the second row", () => {
    let state = slashMenuReducer(initialSlashMenuState(), {
      draft: "/",
      items: COMMANDS,
      type: "input",
    });
    state = slashMenuReducer(state, {
      draft: "/",
      items: COMMANDS,
      key: "ArrowDown",
      type: "keydown",
    });
    expect(state.activeIndex).toBe(1);
    state = slashMenuReducer(state, {
      draft: "/",
      items: COMMANDS,
      key: "Tab",
      type: "keydown",
    });
    const insert = selectedInsertText(state.result.items, state.activeIndex);
    // Sorted: clear, review, summarize. Index 1 = "review".
    expect(insert).toBe("/review ");
  });

  it("the accepted text re-derives: after insert the draft is no longer a pure query", () => {
    // Simulating what the composer does: it sets the draft to "/review " and
    // re-runs the reducer. The trailing space means the regex no longer
    // matches, so the menu closes and the text is ready to send as a plain
    // prompt (no client-side execution).
    let state = slashMenuReducer(
      {
        activeIndex: 0,
        dismissedQuery: null,
        open: true,
        result: filterCommands("/re", COMMANDS),
      },
      {
        draft: "/re",
        items: COMMANDS,
        key: "Enter",
        type: "keydown",
      }
    );
    state = slashMenuReducer(state, {
      draft: "/review ",
      items: COMMANDS,
      type: "input",
    });
    expect(state.open).toBe(false);
    expect(isSlashQuery("/review ")).toBe(false);
  });
});

// ── dismissed-until-query-change ─────────────────────────────────────────────

describe("dismissed menu only reopens on query change", () => {
  it("Escape dismisses; re-typing the SAME query stays closed", () => {
    let state = slashMenuReducer(initialSlashMenuState(), {
      draft: "/re",
      items: COMMANDS,
      type: "input",
    });
    state = slashMenuReducer(state, {
      draft: "/re",
      items: COMMANDS,
      key: "Escape",
      type: "keydown",
    });
    expect(state.open).toBe(false);
    // Same query again: still closed.
    state = slashMenuReducer(state, {
      draft: "/re",
      items: COMMANDS,
      type: "input",
    });
    expect(state.open).toBe(false);
    // A DIFFERENT query: reopens.
    state = slashMenuReducer(state, {
      draft: "/sum",
      items: COMMANDS,
      type: "input",
    });
    expect(state.open).toBe(true);
  });
});

// ── select inserts /<name> into the draft (plain prompt text) ───────────────

describe("select inserts /<name> and closes the menu", () => {
  it("the insertion is the plain text the composer sends as a prompt", () => {
    const state = slashMenuReducer(initialSlashMenuState(), {
      draft: "/",
      items: COMMANDS,
      type: "input",
    });
    const next = slashMenuReducer(state, {
      draft: "/",
      index: 0,
      items: COMMANDS,
      type: "select",
    });
    expect(next.open).toBe(false);
    // First sorted row is "clear".
    expect(selectedInsertText(state.result.items, 0)).toBe("/clear ");
  });
});

// ── menuOwnsKey (Enter/Tab must not fall through to submit) ─────────────────

describe("menuOwnsKey", () => {
  it("is true for the menu keys when open, false when closed", () => {
    const open = slashMenuReducer(initialSlashMenuState(), {
      draft: "/",
      items: COMMANDS,
      type: "input",
    });
    for (const key of ["Enter", "Tab", "ArrowDown", "ArrowUp", "Escape"]) {
      expect(menuOwnsKey(open, key)).toBe(true);
    }
    const closed = { ...open, open: false };
    for (const key of ["Enter", "Tab", "ArrowDown", "ArrowUp", "Escape"]) {
      expect(menuOwnsKey(closed, key)).toBe(false);
    }
  });
});

// ── merge + authoritative-then-overlay (AC#1 stale-WS-push) ──────────────────

describe("merge + overlay staleness", () => {
  it("builtin wins over an acp command of the same name", () => {
    const acp = acpCommandsToItems([
      { description: "agent clear", input: { hint: null }, name: "clear" },
    ]);
    const merged = mergeSlashCommands(COMMANDS, acp);
    // "clear" is a builtin in COMMANDS; the acp "clear" must not win.
    const clear = merged.find((c) => c.name === "clear");
    expect(clear?.source).toBe("builtin");
  });

  it("a fresh acp command (no collision) lands in the menu", () => {
    const acp = acpCommandsToItems([
      {
        description: "explain the code",
        input: { hint: "[file]" },
        name: "explain",
      },
    ]);
    const merged = mergeSlashCommands(COMMANDS, acp);
    const explain = merged.find((c) => c.name === "explain");
    expect(explain?.source).toBe("acp");
    expect(explain?.hint).toBe("[file]");
    expect(explain?.kind).toBe("template");
    expect(explain?.selectionBehavior).toBe("insert");
  });

  it("a stale WS push (older than the authoritative snapshot) is dropped", () => {
    // Authoritative HTTP snapshot took version 5; a stale socket push at
    // version 4 must not clobber it.
    expect(shouldApplyOverlay(4, 5)).toBe(false);
    // A newer push applies.
    expect(shouldApplyOverlay(6, 5)).toBe(true);
  });
});

// ── config options → picker data (AC#2) ──────────────────────────────────────

describe("config option picker data", () => {
  const options = [
    {
      currentValue: "sonnet",
      description: null,
      id: "model",
      options: [{ value: "opus" }, { value: "sonnet" }],
      type: "select" as const,
    },
    {
      currentValue: "normal",
      description: null,
      id: "mode",
      options: [{ value: "normal" }, { value: "fast" }],
      type: "select" as const,
    },
  ];

  it("the mode selector appears only when a mode option exists", () => {
    const modelOnly = options.filter((o) => o.id === "model");
    expect(hasModeOption(options)).toBe(true);
    expect(hasModeOption(modelOnly)).toBe(false);
  });

  it("a boolean option is never a mode source", () => {
    expect(
      hasModeOption([
        {
          currentValue: true,
          id: "mode",
          options: [],
          type: "boolean",
        },
      ])
    ).toBe(false);
  });
});
