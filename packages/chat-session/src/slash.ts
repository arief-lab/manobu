/**
 * The slash-command lane (TASK-80.5, AionUi `common/chat/slash` port).
 *
 * Pure, React-free: the types + ACP mapping + merge + query filter + a menu
 * controller state machine, all headless-testable under `bun test`. The
 * composer consumes this; the data feed (fetch-link authoritative snapshot
 * + live `available_commands` frame overlay) lives in `use-chat-engine.ts`.
 * Keeping the lane pure is what lets AC#1 pin filter/accept behavior
 * without a DOM test environment (same constraint the 80.3/80.4 SSR tests
 * worked under).
 *
 * Subpath: `@manobu/chat-session/slash` -> `src/slash.ts` (one cohesive
 * module; no barrel — `noBarrelFile`).
 */

/** How a command was defined. */
export type SlashCommandKind = "template" | "builtin";

/** Where a command came from. */
export type SlashCommandSource = "acp" | "builtin" | "skill";

/** What selecting the command does. `insert` drops the token into the
 * draft as plain text (the server injects the file block at the send
 * edge); `execute` is reserved for future client-side commands. */
export type SlashSelectionBehavior = "execute" | "insert";

/** One command in the composer menu. */
export interface SlashCommandItem {
  description: string;
  hint: string | null;
  kind: SlashCommandKind;
  /** The `/`-stripped name (`name === "/review"` never; `name === "review"`). */
  name: string;
  selectionBehavior: SlashSelectionBehavior;
  source: SlashCommandSource;
}

/** The ACP command shape both the frame and the procedure carry. */
export interface AcpCommand {
  description: string;
  /** The hint source differs by shape: `input.hint` on the frame, `hint`
   * on the procedure output. Accept both; first present wins. */
  hint?: string | null;
  input?: { hint?: string | null } | null;
  name: string;
}

/** Map one ACP command to a menu item (template/acp/insert, AionUi parity). */
export function acpCommandToItem(command: AcpCommand): SlashCommandItem {
  const hint = command.input?.hint ?? command.hint ?? null;
  return {
    description: command.description,
    hint,
    kind: "template" as SlashCommandKind,
    name: command.name,
    selectionBehavior: "insert" as SlashSelectionBehavior,
    source: "acp" as SlashCommandSource,
  };
}

/** Map a batch of ACP commands to items. */
export function acpCommandsToItems(commands: AcpCommand[]): SlashCommandItem[] {
  return commands.map(acpCommandToItem);
}

/**
 * First-wins merge by `name` with source priority: `builtin` > `acp` >
 * `skill`. An earlier source of a higher-priority source wins over a
 * later one; equal-priority keeps the first occurrence. The result is
 * stable-sorted (insertion order of the first occurrence of each name)
 * so the menu is deterministic.
 */
export function mergeSlashCommands(
  ...sources: SlashCommandItem[][]
): SlashCommandItem[] {
  const rank: Record<SlashCommandItem["source"], number> = {
    acp: 2,
    builtin: 1,
    skill: 3,
  };
  const byName = new Map<string, SlashCommandItem>();
  for (const items of sources) {
    for (const item of items) {
      const existing = byName.get(item.name);
      if (!existing || rank[item.source] < rank[existing.source]) {
        byName.set(item.name, item);
      }
    }
  }
  return [...byName.values()];
}

// ── Config options → picker data (AC#2) ─────────────────────────────────────

/** The config-option wire shape the procedure / frame carry. */
export interface ConfigOptionWire {
  currentValue: boolean | string;
  description?: string | null;
  id: string;
  name?: string | null;
  options: Array<{
    description?: string | null;
    name?: string | null;
    value: string;
  }>;
  type: "boolean" | "select";
}

/** True when a `select` config option with `id === "mode"` exists — the
 * mode picker renders only then (AC#2: "mode selector appears only when a
 * mode option exists"). Mirrors the server's `configOptionsToCatalog`
 * keying on `id === "model"`. */
export function hasModeOption(options: ConfigOptionWire[]): boolean {
  return options.some(
    (option) => option.id === "mode" && option.type === "select"
  );
}

/** The current value of a config option (model/mode/generic switch). */
export function currentConfigValue(
  options: ConfigOptionWire[],
  optionId: string
): string | null {
  const option = options.find((o) => o.id === optionId);
  return option?.type === "select" && typeof option.currentValue === "string"
    ? option.currentValue
    : null;
}

/** The selectable values for one `select` config option. */
export function configOptionValues(
  options: ConfigOptionWire[],
  optionId: string
): string[] {
  const option = options.find((o) => o.id === optionId);
  return option?.type === "select" ? option.options.map((o) => o.value) : [];
}

// ── Authoritative-then-overlay staleness (AC#1) ──────────────────────────────

/**
 * The overlay rule: the fetch-link `chat.slashCommands` snapshot is the
 * authoritative set; a live `available_commands` frame overlays it. A WS
 * push is only applied when it is NEWER than the last authoritative
 * snapshot for that conversation — a stale push (the socket resent an old
 * frame after a reconnect) must not clobber the fresh HTTP data.
 */
export function shouldApplyOverlay(
  pushVersion: number,
  authoritativeVersion: number
): boolean {
  return pushVersion > authoritativeVersion;
}

/** The live draft is a slash query only when it matches this exactly. */
export const SLASH_QUERY_RE = /^\/([a-zA-Z0-9_-]*)$/;

/** `[start, end)` spans into a command name to highlight. */
export type HighlightRange = readonly [number, number];

/** The menu's fuzzy state after a query change. */
export interface SlashFilterResult {
  /** The filtered + ranked menu rows (empty = the menu hides itself). */
  items: readonly SlashCommandItem[];
  /** The query tokens, in match order (the leading slash excluded). */
  query: string;
}

/** True when `draft` is a pure slash query (the menu may be open). */
export function isSlashQuery(draft: string): boolean {
  return SLASH_QUERY_RE.test(draft);
}

/** The query tokens out of a slash draft (`"/re vi"` -> `"re vi"`). */
export function slashQueryOf(draft: string): string {
  const match = SLASH_QUERY_RE.exec(draft);
  return match?.[1] ?? "";
}

/**
 * Fuzzy match: every character of the query must appear, in order,
 * somewhere in the command name (AionUi's subsequence highlight,
 * case-insensitive). A contiguous query (the slash regex admits no
 * spaces), so this is a char-subsequence test, not a token test.
 */
function matchesQuery(item: SlashCommandItem, query: string): boolean {
  const needle = query.toLowerCase();
  if (needle === "") {
    return true;
  }
  const haystack = item.name.toLowerCase();
  let position = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, position);
    if (found < 0) {
      return false;
    }
    position = found + 1;
  }
  return true;
}

/**
 * The highlight spans for a query against one item's name. Each matched
 * character becomes a single-char range; offsets are into the NAME (the
 * menu renders `/` + name; the draft's leading slash is NOT part of the
 * name the spans index into). Empty query -> no spans.
 */
export function highlightRanges(
  item: SlashCommandItem,
  query: string
): readonly HighlightRange[] {
  const needle = query.toLowerCase();
  if (needle === "") {
    return [];
  }
  const haystack = item.name.toLowerCase();
  const ranges: HighlightRange[] = [];
  let position = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, position);
    if (found >= 0) {
      ranges.push([found, found + 1]);
      position = found + 1;
    }
  }
  return ranges;
}
/**
 * Filter + rank the menu for one draft. Empty query -> all items; otherwise
 * substring/fuzzy matches only. Order: exact-prefix matches first, then the
 * rest, both name-sorted — a stable, testable ranking.
 */
export function filterCommands(
  draft: string,
  items: readonly SlashCommandItem[]
): SlashFilterResult {
  if (!isSlashQuery(draft)) {
    return { items: [], query: "" };
  }
  const query = slashQueryOf(draft);
  const matched = items.filter((item) => matchesQuery(item, query));
  const prefixRank = (item: SlashCommandItem): number =>
    query !== "" && item.name.toLowerCase().startsWith(query.toLowerCase())
      ? 0
      : 1;
  const ranked = matched.slice().sort((a, b) => {
    const difference = prefixRank(a) - prefixRank(b);
    return difference === 0 ? a.name.localeCompare(b.name) : difference;
  });
  return { items: ranked, query };
}

/** The controller's full state (the menu's UI-facing shape). */
export interface SlashMenuState {
  /** The highlighted row index (into `result.items`). */
  activeIndex: number;
  /** The query the user dismissed with Escape; the menu stays closed until
   * the query differs from it (AionUi parity). `null` = nothing pending. */
  dismissedQuery: string | null;
  /** Whether the menu is shown. */
  open: boolean;
  /** The filtered menu for the live draft. */
  result: SlashFilterResult;
}

/** One controller event. `items` is the full unfiltered command list (the
 * caller owns the data feed; the reducer only filters/ranks it). */
export type SlashMenuEvent =
  | {
      draft: string;
      items: readonly SlashCommandItem[];
      type: "input";
    }
  | {
      draft: string;
      items: readonly SlashCommandItem[];
      key: string;
      type: "keydown";
    }
  | { type: "dismiss" }
  | {
      draft: string;
      index: number;
      items: readonly SlashCommandItem[];
      type: "select";
    };

/** A fresh (menu-closed) state. */
export function initialSlashMenuState(): SlashMenuState {
  return {
    activeIndex: 0,
    dismissedQuery: null,
    open: false,
    result: filterCommands("", []),
  };
}

function reduceInput(
  state: SlashMenuState,
  draft: string,
  items: readonly SlashCommandItem[]
): SlashMenuState {
  const result = filterCommands(draft, items);
  const isQuery = isSlashQuery(draft);
  const query = isQuery ? slashQueryOf(draft) : "";
  // A dismissed menu reopens when the query changes from the dismissed
  // one; a fresh query (or a non-query draft) reopens / closes cleanly.
  const open = isQuery && query !== state.dismissedQuery;
  // A dismissed menu stays closed only for its dismissed query; any
  // other draft reopens it cleanly (AionUi parity, pinned in the
  // controller tests).
  const dismissedQuery = open || !isQuery ? null : query;
  return { activeIndex: 0, dismissedQuery, open, result };
}

function reduceKeyDown(
  state: SlashMenuState,
  key: string,
  draft: string,
  items: readonly SlashCommandItem[]
): SlashMenuState {
  const result = filterCommands(draft, items);
  if (!state.open) {
    // Closed: arrows/Enter/Tab fall through to the composer; only
    // Escape is a no-op here. Re-derive the result so the menu reopens
    // on the next input if the query differs.
    return { ...state, result };
  }
  if (key === "Escape") {
    const isQuery = isSlashQuery(draft);
    const query = isQuery ? slashQueryOf(draft) : "";
    return { ...state, dismissedQuery: query, open: false, result };
  }
  const count = result.items.length;
  if (key === "ArrowDown") {
    return {
      ...state,
      activeIndex: (state.activeIndex + 1) % Math.max(count, 1),
      result,
    };
  }
  if (key === "ArrowUp") {
    return {
      ...state,
      activeIndex: (state.activeIndex - 1 + count) % Math.max(count, 1),
      result,
    };
  }
  // Enter / Tab: the component accepts `result.items[activeIndex]`;
  // the reducer only clamps the index so an out-of-range highlight
  // (the list shrank under the cursor) resolves to a real row.
  if (key === "Enter" || key === "Tab") {
    const clamped = count === 0 ? 0 : Math.min(state.activeIndex, count - 1);
    return { ...state, activeIndex: clamped, result };
  }
  return { ...state, result };
}

function reduceSelect(
  draft: string,
  items: readonly SlashCommandItem[]
): SlashMenuState {
  // Selecting a command inserts `/name` (+ trailing space) into the
  // draft; the text then goes out as an ordinary prompt (no client-side
  // execution). The menu closes and forgets any dismissed query.
  const result = filterCommands(draft, items);
  return { activeIndex: 0, dismissedQuery: null, open: false, result };
}

/** The next state after one event. Pure: `(state, event) => state`. */
export function slashMenuReducer(
  state: SlashMenuState,
  event: SlashMenuEvent
): SlashMenuState {
  switch (event.type) {
    case "input":
      return reduceInput(state, event.draft, event.items);
    case "keydown":
      return reduceKeyDown(state, event.key, event.draft, event.items);
    case "dismiss":
      return { ...state, dismissedQuery: null, open: false };
    case "select":
      return reduceSelect(event.draft, event.items);
    default:
      return state;
  }
}

/**
 * The text a selection inserts into the draft: `/<name>` + a space (AionUi
 * parity). `null` when the index is out of range (nothing to insert).
 */
export function selectedInsertText(
  items: readonly SlashCommandItem[],
  index: number
): string | null {
  const item = items[index];
  return item ? `/${item.name} ` : null;
}

/** True when a keydown on an open menu the caller must handle (so it can
 * stop propagation before the composer's Enter-to-submit fires). */
export function menuOwnsKey(state: SlashMenuState, key: string): boolean {
  if (!state.open) {
    return false;
  }
  return ["ArrowDown", "ArrowUp", "Escape", "Enter", "Tab"].includes(key);
}
