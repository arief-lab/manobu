/**
 * Drill Lab card-machine contracts (SCR-03 redesign 2026-09-13).
 *
 * Defends the observable behavior of the rewrite:
 *   - gradeShape stays the stroke grader, tolerance scales with card size
 *   - kanaFold + gradePronunciation: the kanji say-path (readings match)
 *   - typeFallbackChoices: nearest-neighbour distractors, correct included
 *   - the deck data: kanji-n5.json shape
 *   - the mark moment and the deck tabs: rendered or called, never read out of
 *     the source file
 *
 * The last group used to be `readFileSync` + `toContain` (TASK-134 converted it
 * on 2026-09-28): those passed on a comment, broke on a rename, and could not
 * tell a wired surface from a deleted one. This file is `.tsx` because
 * `renderToStaticMarkup` is the desktop's DOM-free render harness, same as
 * `review-queue.test.tsx`.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { DrillChar } from "@/features/drill/drill-lab";
import { __test__ as drill } from "@/features/drill/drill-lab";
import { DECK_TAB_ORDER, DRILL_KINDS, KIND_LABELS } from "@/lib/drill-search";
import type { StrokeOrderData } from "@/lib/kanjivg";
import { isChromeFreePath } from "@/shared/chrome-free";

const noop = (): void => undefined;

/** The header line: the cue while a pick is open, the character after it. */
const CARD_TOP_RE = /data-testid="drill-card-top"[^>]*>([^<]*)</;

/** The class list of the choice button showing `value`, for the verdict marks. */
const buttonClass = (markup: string, value: string): string => {
  for (const button of markup.split("<button").slice(1)) {
    const classes = button.includes(`data-value="${value}"`)
      ? button.split('class="')[1]?.split('"')[0]
      : undefined;
    if (classes) {
      return classes;
    }
  }
  throw new Error(`no choice button rendered for ${value}`);
};

const kana = (char: string, romaji = "x"): DrillChar => ({
  char,
  level: "N5",
  romaji,
});

describe("stroke grading (card-machine geometry)", () => {
  it("tolerance scales from the legacy 280px calibration", () => {
    expect(drill.strokeTolerance(280)).toBe(40);
    expect(drill.strokeTolerance(140)).toBe(20);
    // The card is 220px: 31.4px, not the raw legacy 40.
    expect(drill.strokeTolerance(220)).toBeCloseTo(31.43, 1);
  });

  it("gradeShape still accepts an aligned path and rejects a wrong one", () => {
    const target = [
      { x: 10, y: 10 },
      { x: 50, y: 50 },
      { x: 90, y: 90 },
    ];
    expect(drill.gradeShape(target, target, 40)).toBe(true);
    expect(
      drill.gradeShape(
        [
          { x: 200, y: 200 },
          { x: 250, y: 250 },
          { x: 300, y: 300 },
        ],
        target,
        40
      )
    ).toBe(false);
    // fewer than 2 points never grades
    expect(drill.gradeShape([{ x: 1, y: 1 }], target, 40)).toBe(false);
  });
});

describe("pronunciation grading (say path)", () => {
  it("kanaFold maps katakana to hiragana", () => {
    expect(drill.kanaFold("アイウ")).toBe("あいう");
    expect(drill.kanaFold("あア")).toBe("ああ");
  });

  it("kana cards match the char itself (mic-stt contract)", () => {
    expect(drill.gradePronunciation("あめです", kana("あ"))).toBe(3);
    expect(drill.gradePronunciation("い", kana("あ"))).toBe(1);
    expect(drill.gradePronunciation(null, kana("あ"))).toBe(1);
  });

  it("kanji cards match ANY on/kun reading, katakana folded", () => {
    const nichi: DrillChar = {
      char: "日",
      gloss: "day; sun",
      kun: ["ひ", "-び", "-か"],
      level: "N5",
      on: ["ニチ", "ジツ"],
      romaji: "nichi",
      strokeCount: 4,
    };
    // STT returns hiragana; on-readings are katakana in the corpus.
    expect(drill.gradePronunciation("にち", nichi)).toBe(3);
    // lenient substring contract (same as kanaMatch): ひと.つ contains ひ,
    // a real reading of 日 — graded correct by design.
    expect(drill.gradePronunciation("ひと.つ", nichi)).toBe(3);
    expect(drill.gradePronunciation("やま", nichi)).toBe(1);
  });
});

describe("pick distractors (nearest-neighbour)", () => {
  const deck = "あいうえおかきくけこ".split("").map((c) => kana(c));

  it("includes the target + the 3 nearest deck positions", () => {
    const choices = drill.typeFallbackChoices(kana("う"), deck, {
      deterministic: true,
    });
    expect(choices).toHaveLength(4);
    expect(choices[0]).toBe("う");
    // deterministic: nearest-first — え/い (d=1), then お (d=2 forward)
    expect(choices.slice(1).sort()).toEqual(["い", "え", "お"].sort());
  });

  it("wraps around the deck edges without repeats", () => {
    const choices = drill.typeFallbackChoices(kana("あ"), deck, {
      deterministic: true,
    });
    // target あ (index 0): nearest-first with wrap — い, こ (d=1), う (d=2)
    expect(choices.slice(1).sort()).toEqual(["い", "う", "こ"].sort());
    expect(choices[0]).toBe("あ");
  });
});

describe("kanji N5 deck data", () => {
  const deck = JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        "..",
        "..",
        "..",
        "packages/japanese/data/kanji-n5.json"
      ),
      "utf8"
    )
  ) as {
    c: string;
    f: number;
    ku: string[];
    m: string[];
    on: string[];
    s: number;
  }[];

  it("ships 79 N5 kanji in frequency order", () => {
    expect(deck).toHaveLength(79);
    expect(deck[0]?.c).toBe("日");
    const freqs = deck.map((k) => k.f);
    expect([...freqs].sort((a, b) => a - b)).toEqual(freqs);
  });

  it("every entry has readings + meanings + a stroke count", () => {
    for (const k of deck) {
      expect(k.s).toBeGreaterThan(0);
      expect(k.m.length + k.on.length + k.ku.length).toBeGreaterThan(0);
    }
  });
});

describe("card machine render (the mark moment)", () => {
  const nichi: DrillChar = {
    char: "日",
    gloss: "day; sun",
    kun: ["ひ"],
    level: "N5",
    on: ["ニチ"],
    romaji: "nichi",
    strokeCount: 4,
  };
  /** A kana card: no strokeCount, so its cue is the reading (TASK-168). */
  const a: DrillChar = {
    char: "あ",
    kind: "gojuon",
    level: "N5",
    romaji: "a",
  };
  const strokes = (count: number): StrokeOrderData => ({
    character: nichi.char,
    elementPath: [],
    numbers: [],
    strokes: Array.from({ length: count }, (_, i) => ({
      d: "M 10 10 L 90 90",
      id: `stroke-${i}`,
    })),
    svg: "",
  });

  const face = (
    phase: "correct" | "intro" | "ready" | "wrong",
    over: Partial<Parameters<typeof drill.CardFace>[0]> = {}
  ): string =>
    renderToStaticMarkup(
      <drill.CardFace
        advance={noop}
        correcting={null}
        current={nichi}
        ghostVisible={0}
        ink={[]}
        inkLocked={false}
        missed={[]}
        modeDraw
        modePick={false}
        onComplete={noop}
        onCorrectionDone={noop}
        onSkipIntro={noop}
        phase={phase}
        strokeData={strokes(4)}
        {...over}
      />
    );

  const ghostPaths = (markup: string): number =>
    markup.split("data-stroke-index=").length - 1;

  /** The header line: the cue while a pick is open, the character after. */
  const cardTop = (markup: string): string => {
    const top = CARD_TOP_RE.exec(markup)?.[1];
    if (top === undefined) {
      throw new Error("no card top rendered");
    }
    return top;
  };

  it("a clean card stamps 朱, and only a clean card does", () => {
    expect(face("correct")).toContain("drill-stamp");
    expect(face("ready")).not.toContain("drill-stamp");
    expect(face("wrong")).not.toContain("drill-stamp");
    // Dropped from the old source assertion: the 1s auto-advance is a timer in
    // the machine body, invisible to a static render. Verified live in the
    // browser 2026-09-28 (TASK-162 notes); nothing automated guards it.
  });

  it("a missed card redraws the missed strokes in 朱 and waits for a tap", () => {
    const missed = face("wrong", { missed: [1, 3] });
    // RedPen paints one 朱 path per missed stroke over the attempt.
    const redPen = missed.split('stroke="#c2402a"').length - 1;
    expect(redPen).toBe(2);
    // The card is inert until the learner taps the continue overlay.
    expect(missed).toContain("drill-card-continue");
    expect(missed).toContain('data-phase="wrong"');
    expect(face("ready")).not.toContain("drill-card-continue");
    // The stroke being corrected animates; the rest sit as flat 朱.
    expect(face("wrong", { correcting: 1, missed: [1] })).toContain(
      "kanjivg-drawing"
    );
  });

  it("the intro sweep reveals one stroke at a time and the ready card shows them all", () => {
    // guides are off during the intro, so the ghost renders exactly `visible`.
    expect(ghostPaths(face("intro", { ghostVisible: 1 }))).toBe(1);
    expect(ghostPaths(face("intro", { ghostVisible: 3 }))).toBe(3);
    // ready: every stroke is on the card, the next one as a guide.
    expect(ghostPaths(face("ready", { ghostVisible: 1 }))).toBe(4);
    // Dropped from the old source assertion: `introPlayedRef` makes the sweep
    // run once per set. That is stateful machine behaviour, not markup.
  });

  it("pick prints the cue and keeps the character back until the verdict", () => {
    const pick = (
      phase: "correct" | "ready" | "wrong",
      over: Partial<Parameters<typeof drill.CardFace>[0]> = {}
    ): string => face(phase, { modeDraw: false, modePick: true, ...over });

    // A kana card asks by reading; the shape is nowhere in the markup.
    const kanaAsk = pick("ready", { current: a });
    expect(cardTop(kanaAsk)).toBe("a");
    expect(kanaAsk).not.toContain("あ");
    // A kanji card asks by meaning, and neither the glyph nor its stroke
    // guides (which draw the same glyph faintly) may be on the card.
    const kanjiAsk = pick("ready");
    expect(cardTop(kanjiAsk)).toBe("day; sun");
    expect(kanjiAsk).not.toContain("日");
    expect(kanjiAsk).not.toContain("drill-ghost");

    // The verdict is the reveal: correct confirms, wrong teaches.
    for (const phase of ["correct", "wrong"] as const) {
      expect(cardTop(pick(phase))).toBe("日");
      expect(pick(phase)).toContain("drill-ghost");
    }
    // A miss holds the card open on the revealed form until the tap.
    expect(pick("wrong")).toContain("drill-card-continue");
  });

  it("draw and say keep the character visible: neither asks for the form", () => {
    expect(cardTop(face("ready"))).toBe("日");
    expect(cardTop(face("ready", { modeDraw: false }))).toBe("日");
    expect(face("ready")).toContain("drill-ghost");
  });

  it("the grid says which shape was right and which one was tapped", () => {
    const grid = (picked: string | null): string =>
      renderToStaticMarkup(
        <drill.PickGrid
          choices={["雨", "日", "国", "一"]}
          current={nichi}
          onPick={noop}
          picked={picked}
        />
      );
    // While the answer is open, no button is marked: the border is the reveal.
    expect(grid(null)).not.toContain("border-primary");
    expect(grid(null)).not.toContain("border-mark");
    const wrong = grid("雨");
    // 日 is the answer, 雨 the tap, the other two untouched.
    expect(buttonClass(wrong, "日")).toContain("border-primary");
    expect(buttonClass(wrong, "雨")).toContain("border-mark");
    expect(buttonClass(wrong, "国")).toContain("border-border");
    expect(buttonClass(grid("日"), "日")).toContain("border-primary");
  });

  it("a missing microphone degrades the chip, never fakes a grade", () => {
    const disabled = renderToStaticMarkup(
      <drill.ModeChip
        active={false}
        disabled
        hint="no microphone detected"
        icon="🎤"
        label="say it"
        onSelect={noop}
        value="say"
      />
    );
    expect(disabled).toContain('aria-disabled="true"');
    expect(disabled).toContain("no microphone detected");
    const enabled = renderToStaticMarkup(
      <drill.ModeChip
        active
        icon="✍"
        label="draw it"
        onSelect={noop}
        value="draw"
      />
    );
    expect(enabled).not.toContain('aria-disabled="true"');
    expect(enabled).toContain('aria-pressed="true"');
    // The say path itself grades via gradePronunciation, asserted above.
  });
});

describe("deck tabs", () => {
  it("offers every drill kind as a tab, in the deck order", () => {
    expect([...DECK_TAB_ORDER].sort()).toEqual([...DRILL_KINDS].sort());
    expect(DECK_TAB_ORDER).toContain("kanji");
    // Hiragana first: the tab a learner with no stored selection lands on.
    expect(DECK_TAB_ORDER[0]).toBe("gojuon");
  });

  it("names every tab, and never leaves one bare", () => {
    for (const kind of DECK_TAB_ORDER) {
      expect(KIND_LABELS[kind].trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps /drill out of the app chrome", () => {
    expect(isChromeFreePath("/drill")).toBe(true);
    // Dropped from the old source assertion: the machine's remount key
    // (`key={kind}:${cell}:${group}`) and the `← desk` bar are route JSX
    // internals with no runtime seam. Both verified live 2026-09-28.
  });
});
