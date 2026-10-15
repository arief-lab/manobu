/**
 * Synthetic-stream tests for the tool-call / tool-result renderer.
 *
 * We do **not** stand up a DOM or a real MCP server. The contract being
 * pinned here is "given a V3 message-part shape, the dispatcher picks the
 * right renderer and emits the right text on the page". Hand-craft the
 * parts the JLPT MCP server actually produces (see
 * research/ai-sdk-v3-tool-part-shape.md §3) and assert that the rendered
 * HTML contains the expected fragments.
 *
 * Rendering goes through `react-dom/server.renderToStaticMarkup` because:
 *   1. Bun's test runner doesn't need a DOM.
 *   2. The shape we're verifying is the HTML the user sees — text content,
 *      state pills, "show input" disclosure text. We don't need real DOM
 *      event handlers, just the static tree.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  GrammarResult,
  jlptToolRenderers,
  KanjiResult,
  PitchResult,
  pickToolName,
  ToolCallCard,
  ToolPart,
  type ToolPartLike,
  toToolCallState,
  VocabResult,
} from "./tool-call-card";

// ---------------------------------------------------------------------------
// Helpers — build synthetic V3 tool parts the way the JLPT MCP emits them
// ---------------------------------------------------------------------------

function dynamicToolPart(
  toolName: string,
  options: {
    input?: unknown;
    output?: unknown;
    errorText?: string;
    state?: string;
    toolCallId?: string;
  } = {}
): ToolPartLike {
  return {
    errorText: options.errorText,
    input: options.input,
    output: options.output,
    state: options.state ?? "input-available",
    toolCallId: options.toolCallId ?? `tc-${toolName}`,
    toolName,
    type: "dynamic-tool",
  };
}

function staticToolPart(
  toolName: string,
  options: {
    input?: unknown;
    output?: unknown;
    state?: string;
    toolCallId?: string;
  } = {}
): ToolPartLike {
  return {
    input: options.input,
    output: options.output,
    state: options.state ?? "input-available",
    toolCallId: options.toolCallId ?? `tc-${toolName}`,
    type: `tool-${toolName}`,
  };
}

const FAKE_VOCAB_OUTPUT = [
  {
    level: "N5",
    meaning: "to eat; to live on (e.g. a salary)",
    partOfSpeech: "v1",
    reading: "たべる",
    word: "食べる",
  },
];

const FAKE_GRAMMAR_OUTPUT = {
  examples: [
    {
      english: "I read a book.",
      japanese: "本を読みました。",
      source: "original",
    },
  ],
  formality: "neutral",
  formation: "Verb (past) + ました",
  formation_notes: [],
  id: "te-form-basic",
  level: "N5",
  meaning_detailed: "Used for polite past statements or questions.",
  meaning_en: "Polite past tense (positive)",
  pattern: "Verb (past) + ました",
  related: [],
  review_status: "draft",
  sources: [],
};

const FAKE_KANJI_OUTPUT = {
  character: "食",
  jlpt: "N5",
  kunReadings: ["た.べる", "く.う"],
  meanings: ["eat", "food", "meal"],
  onReadings: ["ショク"],
  radical: 184,
  strokeCount: 9,
};

const FAKE_PITCH_OUTPUT = [
  {
    description: "drop after mora 1: は↓し (nakadaka)",
    moraCount: 2,
    pitchPositions: [1],
    reading: "はし",
    word: "はし",
  },
];

const FAKE_CONJUGATION_OUTPUT = {
  class: "v1",
  dictionary_form: "食べる",
  display_forms: {
    past: "食べた",
    polite: "食べます",
    polite_past: "食べました",
    te: "食べて",
  },
  forms: {
    past: "たべた",
    polite: "たべます",
    polite_past: "たべました",
    te: "たべて",
  },
  id: "taberu",
  reading: "たべる",
};

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

describe("toToolCallState", () => {
  it("maps the SDK's 7 states to 4 visual states", () => {
    expect(toToolCallState("input-streaming")).toBe("pending");
    expect(toToolCallState("input-available")).toBe("pending");
    expect(toToolCallState("approval-requested")).toBe("pending");
    expect(toToolCallState("approval-responded")).toBe("pending");
    expect(toToolCallState("output-available")).toBe("result");
    expect(toToolCallState("output-error")).toBe("error");
    expect(toToolCallState("output-denied")).toBe("denied");
  });

  it("treats unknown states as pending (defensive)", () => {
    expect(toToolCallState("future-state-we-havent-seen")).toBe("pending");
    expect(toToolCallState("")).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// pickToolName — covers dynamic + static variants
// ---------------------------------------------------------------------------

describe("pickToolName", () => {
  it("reads dynamic-tool parts via `.toolName`", () => {
    expect(
      pickToolName({
        state: "input-available",
        toolCallId: "x",
        toolName: "lookup_vocab",
        type: "dynamic-tool",
      })
    ).toBe("lookup_vocab");
  });

  it("reads static tool-NAME-prefixed parts by stripping the prefix", () => {
    expect(
      pickToolName({
        state: "input-available",
        toolCallId: "x",
        type: "tool-lookup_vocab",
      })
    ).toBe("lookup_vocab");
  });

  it("falls back to `type` for unrecognised shapes", () => {
    expect(
      pickToolName({ state: "pending", toolCallId: "x", type: "dynamic-tool" })
    ).toBe("dynamic-tool");
  });
});

// ---------------------------------------------------------------------------
// ToolCallCard shell — pending / result / error states
// ---------------------------------------------------------------------------

describe("<ToolCallCard>", () => {
  it("renders the tool name + state pill for the pending state", () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        input={{ word: "食べる" }}
        state={"pending"}
        toolCallId={"tc-1"}
        toolName={"lookup_vocab"}
      >
        <span>{"searching…"}</span>
      </ToolCallCard>
    );
    expect(html).toContain("lookup_vocab");
    expect(html).toContain('data-state="pending"');
    expect(html).toContain("show input"); // disclosure is present, collapsed
    expect(html).toContain("searching"); // children ARE in the rendered tree
  });

  it("renders the error message + tool name in the error state", () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        errorText={"connection refused"}
        state={"error"}
        toolCallId={"tc-2"}
        toolName={"lookup_grammar"}
      >
        <span>unused</span>
      </ToolCallCard>
    );
    expect(html).toContain("lookup_grammar");
    expect(html).toContain("connection refused");
    expect(html).toContain('data-state="error"');
  });

  it("renders the denied notice for the denied state", () => {
    const html = renderToStaticMarkup(
      <ToolCallCard state={"denied"} toolCallId={"tc-3"} toolName={"agy"}>
        <span>unused</span>
      </ToolCallCard>
    );
    expect(html).toContain("(call was denied before execution)");
    expect(html).toContain('data-state="denied"');
  });
});

// ---------------------------------------------------------------------------
// JLPT-specific renderers
// ---------------------------------------------------------------------------

describe("<VocabResult>", () => {
  it("renders a single entry with word, reading, level, POS, meaning", () => {
    const html = renderToStaticMarkup(<VocabResult data={FAKE_VOCAB_OUTPUT} />);
    expect(html).toContain("食べる");
    expect(html).toContain("たべる");
    expect(html).toContain("N5");
    expect(html).toContain("to eat");
  });

  it("falls back gracefully for non-array / non-object input", () => {
    const html = renderToStaticMarkup(<VocabResult data={null} />);
    expect(html).toContain("no vocab match");
  });

  it("flattens a single object into a one-row list", () => {
    const html = renderToStaticMarkup(
      <VocabResult data={FAKE_VOCAB_OUTPUT[0]} />
    );
    expect(html).toContain("食べる");
    expect(html).toContain("N5");
  });
});

describe("<GrammarResult>", () => {
  it("renders pattern, level, formality, meaning, example sentence", () => {
    const html = renderToStaticMarkup(
      <GrammarResult data={FAKE_GRAMMAR_OUTPUT} />
    );
    expect(html).toContain("Verb (past) + ました");
    expect(html).toContain("N5");
    expect(html).toContain("neutral");
    expect(html).toContain("Polite past tense");
    expect(html).toContain("本を読みました");
  });

  it("falls back to JsonResult when the shape doesn't look like a grammar point", () => {
    const html = renderToStaticMarkup(
      <GrammarResult data={{ not: "a grammar point" }} />
    );
    // JsonResult serializes the input verbatim (HTML-escaped by
    // renderToStaticMarkup, hence the absence of raw double-quotes).
    expect(html).toContain('data-slot="json-fallback"');
    expect(html).toContain("not");
    expect(html).toContain("a grammar point");
  });
});

describe("<KanjiResult>", () => {
  it("renders big-glyph card for one kanji with on/kun readings", () => {
    const html = renderToStaticMarkup(<KanjiResult data={FAKE_KANJI_OUTPUT} />);
    expect(html).toContain("食");
    expect(html).toContain("ショク");
    expect(html).toContain("た.べる");
    expect(html).toContain("eat");
    expect(html).toContain("N5");
    expect(html).toContain('data-slot="kanji-glyph"');
  });

  it("renders a compact grid for arrays (study-set view)", () => {
    const html = renderToStaticMarkup(
      <KanjiResult data={[FAKE_KANJI_OUTPUT, FAKE_KANJI_OUTPUT]} />
    );
    expect(html).toContain('data-slot="kanji-grid"');
    expect(html).toContain("食");
  });
});

describe("<PitchResult>", () => {
  it("renders word, reading, and the heiban/atamadaka/nakadaka/odaka description with the downstep marker preserved", () => {
    const html = renderToStaticMarkup(<PitchResult data={FAKE_PITCH_OUTPUT} />);
    expect(html).toContain("はし");
    expect(html).toContain("drop after mora 1");
    expect(html).toContain("↓");
  });
});

// ---------------------------------------------------------------------------
// <ToolPart> dispatcher — highest-value contract test
// ---------------------------------------------------------------------------

describe("<ToolPart> dispatcher", () => {
  it("renders the VocabResult body for a lookup_vocab dynamic-tool part", () => {
    const part = dynamicToolPart("lookup_vocab", {
      input: { word: "食べる" },
      output: FAKE_VOCAB_OUTPUT,
      state: "output-available",
    });
    const html = renderToStaticMarkup(<ToolPart part={part} />);
    expect(html).toContain("食べる");
    expect(html).toContain("たべる");
    expect(html).toContain("lookup_vocab");
    expect(html).toContain('data-state="result"');
  });

  it("renders the GrammarResult body for a lookup_grammar static-tool part", () => {
    const part = staticToolPart("lookup_grammar", {
      input: { id: "te-form-basic" },
      output: FAKE_GRAMMAR_OUTPUT,
      state: "output-available",
    });
    const html = renderToStaticMarkup(<ToolPart part={part} />);
    expect(html).toContain("Verb (past) + ました");
    expect(html).toContain("Polite past tense");
    expect(html).toContain("lookup_grammar");
  });

  it("renders the KanjiResult body for a lookup_kanji dynamic-tool part", () => {
    const part = dynamicToolPart("lookup_kanji", {
      input: { character: "食" },
      output: FAKE_KANJI_OUTPUT,
      state: "output-available",
    });
    const html = renderToStaticMarkup(<ToolPart part={part} />);
    expect(html).toContain("食");
    expect(html).toContain("ショク");
    expect(html).toContain("lookup_kanji");
  });

  it("renders the ConjugationResult body for a conjugate_verb part", () => {
    const part = dynamicToolPart("conjugate_verb", {
      input: { word: "食べる" },
      output: FAKE_CONJUGATION_OUTPUT,
      state: "output-available",
    });
    const html = renderToStaticMarkup(<ToolPart part={part} />);
    expect(html).toContain("食べる");
    expect(html).toContain("たべました");
    expect(html).toContain("v1");
    expect(html).toContain("conjugate_verb");
  });

  it("shows pending state + the input preview for input-streaming parts", () => {
    const part: ToolPartLike = dynamicToolPart("lookup_vocab", {
      input: { word: "食べる" },
      state: "input-streaming",
    });
    const html = renderToStaticMarkup(<ToolPart part={part} />);
    expect(html).toContain('data-state="pending"');
    expect(html).toContain('aria-label="running"');
    expect(html).toContain("lookup_vocab");
  });

  it("renders the errorText in the error state", () => {
    const part = dynamicToolPart("lookup_vocab", {
      errorText: "tool crashed: connection reset",
      state: "output-error",
    });
    const html = renderToStaticMarkup(<ToolPart part={part} />);
    expect(html).toContain("tool crashed: connection reset");
    expect(html).toContain('data-state="error"');
  });

  it("falls back to JsonResult for unknown tools (preserves wire shape)", () => {
    const part = dynamicToolPart("totally_unknown_tool", {
      input: { something: "raw" },
      output: { surprise: "data" },
      state: "output-available",
    });
    const html = renderToStaticMarkup(<ToolPart part={part} />);
    expect(html).toContain('data-slot="json-fallback"');
    expect(html).toContain("totally_unknown_tool");
    // renderToStaticMarkup HTML-escapes the JSON: " → &quot;.
    expect(html).toContain("surprise");
    expect(html).toContain("data");
  });
});

// ---------------------------------------------------------------------------
// jlptToolRenderers — guardrail: every MCP tool is registered
// ---------------------------------------------------------------------------

describe("jlptToolRenderers registry", () => {
  it("covers every tool name the JLPT MCP server exposes", () => {
    // Mirrors crates/jlpt-mcp/src/main.rs #[tool] declarations. If a new
    // tool is added there, this test fails until it gets a renderer — that's
    // the contract we want.
    const expected = [
      // vocab
      "lookup_vocab",
      "search_vocab",
      "list_vocab_by_level",
      // grammar + conjugation
      "lookup_grammar",
      "search_grammar",
      "list_grammar_by_level",
      "conjugate_verb",
      // kanji
      "lookup_kanji",
      "search_kanji",
      "list_kanji_by_level",
      // pitch
      "lookup_pitch_accent",
      "search_pitch_accent",
    ];
    for (const name of expected) {
      expect(jlptToolRenderers[name]).toBeDefined();
      expect(typeof jlptToolRenderers[name]).toBe("function");
    }
    expect(Object.keys(jlptToolRenderers).length).toBe(expected.length);
  });
});
