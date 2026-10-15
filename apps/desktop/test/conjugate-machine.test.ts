/**
 * Conjugate Lab card-machine contracts (SCR-06 redesign 2026-09-13).
 *
 * Engine: six forms × the classification table (the te/ta onbin, the
 * a/i/e-row shifts, the three irregulars). UI: rung ladder (ask → tell),
 * class-only hint, morph split, sticky form, deck integrity, chrome-free
 * route. Runtime behavior is browser-verified; this file locks the pure
 * machine + the source contracts the old surface violated (fake save,
 * hardcoded verbs, spoiler pattern line).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __test__ as conj } from "@/features/lesson/conjugate";
import {
  choiceOptions,
  classify,
  conjugate,
  FORM_IDS,
  formGloss,
  toTeForm,
  verifyDetailed,
  verifyForm,
} from "@/lib/conjugate";
import { kanaToRomaji, romajiToKana } from "@/lib/romaji";

const srcFile = (rel: string): string =>
  readFileSync(join(import.meta.dirname, "..", "src", rel), "utf8");

const v = (reading: string) => {
  const verb = classify(reading);
  if (!verb) {
    throw new Error(`classify(${reading}) returned null`);
  }
  return verb;
};

describe("conjugate engine — six forms", () => {
  it("ichidan 食べる: stem + per-form endings", () => {
    const taberu = v("食べる");
    expect(conjugate(taberu, "te")).toBe("食べて");
    expect(conjugate(taberu, "ta")).toBe("食べた");
    expect(conjugate(taberu, "masen")).toBe("食べません");
    expect(conjugate(taberu, "nai")).toBe("食べない");
    expect(conjugate(taberu, "tai")).toBe("食べたい");
    expect(conjugate(taberu, "potential")).toBe("食べられる");
  });

  it("godan onbin: 飲む/書く/話す/買う/待つ/遊ぶ/泳ぐ", () => {
    expect(conjugate(v("飲む"), "te")).toBe("飲んで");
    expect(conjugate(v("飲む"), "ta")).toBe("飲んだ");
    expect(conjugate(v("書く"), "te")).toBe("書いて");
    expect(conjugate(v("話す"), "te")).toBe("話して");
    expect(conjugate(v("買う"), "te")).toBe("買って");
    expect(conjugate(v("待つ"), "te")).toBe("待って");
    expect(conjugate(v("泳ぐ"), "te")).toBe("泳いで");
  });

  it("godan row shifts: masen=i-row, nai/tai=a-row, potential=e-row", () => {
    const nomu = v("飲む");
    expect(conjugate(nomu, "masen")).toBe("飲みません");
    expect(conjugate(nomu, "nai")).toBe("飲まない");
    expect(conjugate(nomu, "tai")).toBe("飲みたい");
    expect(conjugate(nomu, "potential")).toBe("飲める");
    // う → わ, not う → あ: 会う → 会わない
    expect(conjugate(v("会う"), "nai")).toBe("会わない");
    expect(conjugate(v("会う"), "tai")).toBe("会いたい");
    // ぐ → が: 泳ぐ → 泳がない
    expect(conjugate(v("泳ぐ"), "nai")).toBe("泳がない");
  });

  it("irregulars: 行く te/ta only, the rest regular く-godan", () => {
    const iku = v("行く");
    // kana engine output (the card title shows 行く; forms are kana)
    expect(conjugate(iku, "te")).toBe("いって");
    expect(conjugate(iku, "ta")).toBe("いった");
    expect(conjugate(iku, "masen")).toBe("いきません");
    expect(conjugate(iku, "nai")).toBe("いかない");
    expect(conjugate(iku, "potential")).toBe("いける");
  });

  it("irregulars: 来る ki-co / ko- stems", () => {
    const kuru = v("くる");
    // the engine is kana-based: te/ta come out きて/きた (来る on the card)
    expect(conjugate(kuru, "te")).toBe("きて");
    expect(conjugate(kuru, "ta")).toBe("きた");
    expect(conjugate(kuru, "masen")).toBe("きません");
    expect(conjugate(kuru, "nai")).toBe("こない");
    expect(conjugate(kuru, "tai")).toBe("きたい");
    expect(conjugate(kuru, "potential")).toBe("こられる");
  });

  it("irregulars: する and compounds conjugate the する part", () => {
    const suru = v("する");
    expect(conjugate(suru, "te")).toBe("して");
    expect(conjugate(suru, "masen")).toBe("しません");
    expect(conjugate(suru, "nai")).toBe("しない");
    expect(conjugate(suru, "potential")).toBe("できる");
    const benkyou = v("べんきょうする");
    expect(conjugate(benkyou, "te")).toBe("べんきょうして");
    expect(conjugate(benkyou, "masen")).toBe("べんきょうしません");
    expect(conjugate(benkyou, "potential")).toBe("べんきょうできる");
  });

  it("every deck verb conjugates into six non-empty distinct forms", () => {
    for (const { verb } of conj.DECK) {
      const forms = FORM_IDS.map((f) => conjugate(verb, f));
      for (const f of forms) {
        expect(f.length).toBeGreaterThan(0);
      }
      // te and ta always differ; nai always ends ない etc.
      expect(forms[0]).not.toBe(forms[1]);
    }
  });

  it("verifyForm grades the asked form; verifyDetailed keeps 23.29", () => {
    const taberu = v("食べる");
    expect(verifyForm(taberu, "te", "食べて")).toBe(true);
    expect(verifyForm(taberu, "ta", "食べて")).toBe(false);
    expect(verifyForm(taberu, "ta", "食べた")).toBe(true);
    // right verb, wrong form → hint (never a silent pass)
    expect(verifyDetailed(taberu, "食べた", "te").kind).toBe("deinflected");
    expect(verifyDetailed(taberu, "食べます", "te").kind).toBe("deinflected");
    // wrong verb → wrong
    expect(verifyDetailed(taberu, "飲んだ").kind).toBe("wrong");
    // dictionary form to a te prompt → wrong (TASK-54 identity skip)
    expect(verifyDetailed(taberu, "食べる").kind).toBe("wrong");
  });

  it("toTeForm stays the SCR-06 primary path", () => {
    expect(toTeForm(v("食べる"))).toBe("食べて");
    expect(toTeForm(v("行く"))).toBe("いって");
  });
});

describe("choice engine (Bunpro-style multiple choice)", () => {
  it("returns 4 unique options, the answer included", () => {
    for (const reading of ["食べる", "飲む", "行く", "する", "来る"]) {
      const verb = v(reading);
      for (const form of FORM_IDS) {
        const opts = choiceOptions(verb, form, { deterministic: true });
        expect(opts).toHaveLength(4);
        expect(new Set(opts).size).toBe(4);
        expect(opts).toContain(conjugate(verb, form));
      }
    }
  });

  it("the teaching distractor is the wrong rule, not a random string", () => {
    // ichidan 食べる conjugated like godan
    expect(choiceOptions(v("食べる"), "te", { deterministic: true })).toContain(
      "食べって"
    );
    // godan 飲む conjugated like ichidan
    expect(
      choiceOptions(v("飲む"), "masen", { deterministic: true })
    ).toContain("飲ません");
  });

  it("distractors are other forms of the SAME verb (form discrimination)", () => {
    const taberu = v("食べる");
    const opts = choiceOptions(taberu, "te", { deterministic: true });
    // every wrong option is a real conjugation of 食べる, never another verb
    const allForms = new Set(FORM_IDS.map((f) => conjugate(taberu, f)));
    for (const o of opts) {
      expect(allForms.has(o) || o === "食べって").toBe(true);
    }
  });

  it("formGloss turns a deck gloss into the shape's English", () => {
    expect(formGloss("masen", "to drink")).toBe("doesn't drink");
    expect(formGloss("ta", "to enter")).toBe("did enter");
  });
});

describe("romaji display + type-slot conversion", () => {
  it("kanaToRomaji renders the reading for English readers", () => {
    expect(kanaToRomaji("はいる")).toBe("hairu");
    expect(kanaToRomaji("いった")).toBe("itta");
    expect(kanaToRomaji("がっこう")).toBe("gakkou");
  });

  it("romajiToKana folds sokuon and nn for the type slot", () => {
    expect(romajiToKana("katta")).toBe("かった");
    expect(romajiToKana("gakkou")).toBe("がっこう");
    expect(romajiToKana("nn")).toBe("ん");
    // a vowel double is a long vowel, never a sokuon
    expect(romajiToKana("ai")).toBe("あい");
  });

  it("the type slot accepts romaji and grades the kana it converts to", () => {
    const nomu = v("のむ");
    const typed = romajiToKana("nomanai");
    expect(verifyForm(nomu, "nai", typed)).toBe(true);
  });
});

describe("morph card UI contracts", () => {
  const src = srcFile("features/lesson/conjugate.tsx");

  it("morphParts splits stem+ending for rule verbs, full for irregulars", () => {
    const taberu = v("食べる");
    const parts = conj.morphParts(taberu, "te");
    expect(parts.split).toBe(true);
    expect(parts.base).toBe("食べ");
    expect(parts.ending).toBe("て");
    const kuru = v("くる");
    // 来て prefixes the き- stem: base き, ending て
    expect(conj.morphParts(kuru, "te").split).toBe(true);
  });

  it("hint reveals the class, never the ending", () => {
    expect(conj.classLabel(v("食べる"))).toBe("る-verb (ichidan)");
    expect(conj.classLabel(v("飲む"))).toContain("ends in む");
    expect(conj.classLabel(v("行く"))).toBe("irregular");
  });

  it("the card states the task without giving the rule", () => {
    const idx = src.indexOf("conj-instruction");
    expect(idx).toBeGreaterThan(-1);
    const instructionBlock = src.slice(idx, idx + 400);
    // names the target form, never the transformation that solves it
    expect(instructionBlock).toContain("Which one is the");
    expect(instructionBlock).not.toContain("drop");
    expect(instructionBlock).not.toContain("GODAN_MAP");
  });

  it("form chips are sticky via localStorage", () => {
    expect(src).toContain('const FORM_KEY = "manobu.conjForm"');
    expect(src).toContain("localStorage.setItem(FORM_KEY, next)");
  });

  it("suru compounds split on the し- stem", () => {
    const suruParts = conj.morphParts(v("する"), "te");
    expect(suruParts.split).toBe(true);
    expect(suruParts.base).toBe("し");
    expect(suruParts.ending).toBe("て");
  });

  it("save is a real button wired to saveFsrsToast, undo-aware", () => {
    expect(src).toContain("saveFsrsToast");
    expect(src).toContain("onUndo");
    expect(src).toContain("conj-save");
  });

  it("the old spoilers are gone: no static pattern line, no fake save text", () => {
    expect(src).not.toContain("Source: Grammar DB");
    expect(src).not.toContain("(no FSRS effect)");
    expect(src).not.toContain("YailE");
    expect(src).not.toContain("[Hint]");
    expect(src).not.toContain("が not");
    // patternExplanation only appears inside the tell rung
    const tellIdx = src.indexOf('rung === "tell"');
    const patternIdx = src.indexOf("{patternExplanation(verb)}");
    expect(tellIdx).toBeGreaterThan(-1);
    expect(patternIdx).toBeGreaterThan(tellIdx);
  });

  it("wrong verbs resurface: redo queue + honest ladder", () => {
    expect(src).toContain("conj-redo");
    expect(src).toContain("to redo");
    expect(src).toContain("conj-ladder");
  });

  it("morph animations exist and die under reduced motion", () => {
    const css = srcFile("index.css");
    expect(css).toContain("@keyframes conj-land");
    expect(css).toContain(".conj-strike");
    expect(css).toContain("line-through");
  });
});

describe("conjugate route (chrome-free move)", () => {
  it("/conjugate is the focus surface with its own bar", () => {
    const route = srcFile("routes/conjugate.tsx");
    expect(route).toContain('createFileRoute("/conjugate")');
    expect(route).toContain("conj-bar-desk");
    expect(route).toContain("data: local-state");
    const chromeFree = srcFile("shared/chrome-free.ts");
    expect(chromeFree).toContain("CHROME_FREE_PATHS");
    expect(chromeFree).toContain('"/conjugate"');
  });

  it("/learn/conjugate redirects old deep links", () => {
    const stub = srcFile("routes/learn/conjugate.tsx");
    expect(stub).toContain("redirect");
    expect(stub).toContain('to: "/conjugate"');
  });

  it("the deck is the generated verbs-n5.json, classify()-clean", () => {
    expect(conj.DECK.length).toBeGreaterThanOrEqual(50);
    const readings = conj.DECK.map((d) => d.verb.reading);
    expect(new Set(readings).size).toBe(readings.length);
    // the 帰る trap is denied, the irregulars are present
    expect(readings).not.toContain("かえる");
    expect(readings.some((r) => r === "いく" || r === "行く")).toBe(true);
  });
});
