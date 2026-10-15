import { beforeAll, describe, expect, it } from "bun:test";
import type { ExamLevel } from "@manobu/api-contract";
import {
  PAPER_BLUEPRINTS,
  type PaperBlockId,
  paperBlockInstruction,
  paperBlocksFor,
} from "@manobu/item-engine/paper";
import type { ItemType } from "@manobu/item-engine/types";
import {
  listeningChoukaiStoreFor,
  listeningGaiyouStoreFor,
  listeningHatsuwaStoreFor,
  listeningKadaiStoreFor,
  listeningPointStoreFor,
  listeningSokujiStoreFor,
} from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import {
  assertLandedScoresInto,
  connectExamClient,
  type ExamClient,
  newCatalog,
  prepareContentDb,
  requestAssembleRead,
  shippedReadingRows,
  withSubstitutedReadingStore,
} from "./exam-harness";

const DB_URL = prepareContentDb("exam-listening");

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

/*
 * TASK-173.8.1 (N4/N5), TASK-173.9.4.1 (N3), TASK-173.9.4.2 (N2) and
 * TASK-173.9.4.3 (N1): authentic 聴解 material for the
 * 大問 per level the paper plays rather than prints (doc-25 §2).
 *
 * Each 小問 is ONE heard scenario, ONE printed Japanese question and FOUR
 * options, exactly one of which keeps what the scenario says. The mechanical
 * half is falsifiable offline (`check:listening-*`: the block's own scenario
 * shape in band, the frozen key slot, the prompt leak, the orthography, the
 * store-wide reuse screen and the floor); what no screen can see, that the
 * chosen option actually keeps what a dialogue heard ONCE says, is what the two
 * blind judge passes certified onto `validated: true`, and licensed rows serve
 * on their CC BY-SA tag instead (data/LICENSE.md §29). N5 mixes the two routes;
 * N4, N3, N2 and N1 are AUTHORED-ONLY (JLPTSuccess ships listening at N5 only). This
 * file proves the shipped rows REACH a paper, as AUDIO material and not as
 * printed text:
 *
 *   - the stores (`listening*StoreFor`): each at its 小問数 × 4 papers, every
 *     row either licensed or composed+validated, and the holes only where a
 *     blueprint alone declares them (概要理解 at no N4/N5, 聴解統合理解 at no
 *     level outside N1/N2, 発話表現 at no N1/N2),
 *   - the pickers (`listeningKadaiSourceFor` and kin): the scenario travels as
 *     the `script` stimulus with NO printed passage, one scenario per 小問
 *     spent SHARED across the 大問, `seenAnchors` honored,
 *   - the real papers: all 大問 land whole at N1, N2, N3, N4 and at N5, byte-equal
 *     to shipped rows, `item.passage` null (a learner who could read the
 *     dialogue is not doing 聴解), one 統合理解 dialogue heard once behind its
 *     two 小問, and the block stays in the documented no-instruction case AC#2
 *     chose,
 *   - the hole: with one store emptied the receipt NAMES that 大問
 *     (TASK-173.1 no-fallback), a one-row store comes up short instead, and an
 *     unjudged authored row never reaches a learner while licensed rows keep
 *     serving.
 */

/** The five levels that ship 聴解 stores as of TASK-173.9.4.3. */
const STORE_LEVELS = ["N1", "N2", "N3", "N4", "N5"] as const;
type StoreLevel = (typeof STORE_LEVELS)[number];

/** One level's 聴解 大問: where the paper numbers it per level (N3 prints
 * 概要理解 as 大問3, shifting 発話表現/即時応答 to 4/5), its block id, its store
 * file stem, the item type its 小問 wear, the receipt's 大問 name, and per
 * level how many 小問 it prints and how many rows ship behind it (小問数 × 4
 * papers from the blueprint, `packages/item-engine/src/paper.ts`). */
interface BlockSpec {
  bigQuestion: Partial<Record<StoreLevel, number>>;
  block: PaperBlockId;
  fileStem: string;
  items: Partial<Record<StoreLevel, number>>;
  itemType: ItemType;
  name: string;
  rows: Partial<Record<StoreLevel, number>>;
  storeFor: typeof listeningKadaiStoreFor;
}

const BLOCKS: readonly BlockSpec[] = [
  {
    bigQuestion: { N1: 1, N2: 1, N3: 1, N4: 1, N5: 1 },
    block: "kadai-rikai",
    fileStem: "kadai",
    items: { N1: 6, N2: 5, N3: 6, N4: 8, N5: 7 },
    itemType: "listening-kadai",
    name: "課題理解",
    rows: { N1: 24, N2: 20, N3: 24, N4: 32, N5: 28 },
    storeFor: listeningKadaiStoreFor,
  },
  {
    bigQuestion: { N1: 2, N2: 2, N3: 2, N4: 2, N5: 2 },
    block: "point-rikai",
    fileStem: "point",
    items: { N1: 7, N2: 6, N3: 6, N4: 7, N5: 6 },
    itemType: "listening-point",
    name: "ポイント理解",
    rows: { N1: 28, N2: 24, N3: 24, N4: 28, N5: 24 },
    storeFor: listeningPointStoreFor,
  },
  {
    // TASK-173.9.4.1 opened 概要理解 at N3, TASK-173.9.4.2 printed it at N2 and
    // TASK-173.9.4.3 at N1; N4/N5 blueprints do not ask the 大問.
    bigQuestion: { N1: 3, N2: 3, N3: 3 },
    block: "gaiyou-rikai",
    fileStem: "gaiyou",
    items: { N1: 6, N2: 5, N3: 3 },
    itemType: "listening-gaiyou",
    name: "概要理解",
    rows: { N1: 24, N2: 20, N3: 12 },
    storeFor: listeningGaiyouStoreFor,
  },
  {
    bigQuestion: { N3: 4, N4: 3, N5: 3 },
    block: "hatsuwa-hyougen",
    fileStem: "hatsuwa",
    items: { N3: 4, N4: 5, N5: 5 },
    itemType: "listening-hatsuwa",
    name: "発話表現",
    rows: { N3: 16, N4: 20, N5: 20 },
    storeFor: listeningHatsuwaStoreFor,
  },
  {
    bigQuestion: { N1: 4, N2: 4, N3: 5, N4: 4, N5: 4 },
    block: "sokuji-outou",
    fileStem: "sokuji",
    items: { N1: 14, N2: 12, N3: 9, N4: 8, N5: 6 },
    itemType: "listening-sokuji",
    name: "即時応答",
    rows: { N1: 56, N2: 48, N3: 36, N4: 32, N5: 24 },
    storeFor: listeningSokujiStoreFor,
  },
  {
    // TASK-173.9.4.2: 聴解統合理解 is N2's own 大問 (N2L.pdf 問題5: one long
    // dialogue heard ONCE behind two 小問); TASK-173.9.4.3 prints it at N1 too,
    // N3 prints 発話表現 instead, N4/N5 never ask it.
    bigQuestion: { N1: 5, N2: 5 },
    block: "choukai-tougou-rikai",
    fileStem: "choukai",
    items: { N1: 4, N2: 4 },
    itemType: "listening-choukai",
    name: "統合理解",
    rows: { N1: 16, N2: 16 },
    storeFor: listeningChoukaiStoreFor,
  },
];

/** The blocks one level's blueprint asks. A block absent from a level's maps
 * (概要理解 outside N3) is skipped, never asked as a hole nobody named. */
const blocksAt = (level: StoreLevel): readonly BlockSpec[] =>
  BLOCKS.filter((candidate) => candidate.items[level] !== undefined);

/** A per-level map entry, read at a level `blocksAt` already admitted. The
 * throw is a test-authoring guard: it names the level the map forgot. */
const at = (
  map: Partial<Record<StoreLevel, number>>,
  level: StoreLevel
): number => {
  const value = map[level];
  if (value === undefined) {
    throw new Error(`no ${level} entry in the block spec`);
  }
  return value;
};

const realPaper = (level: ExamLevel, seed: string) =>
  requestAssembleRead(client, {
    budget: { listening: 400 },
    level,
    mode: "real",
    sections: ["listening"],
    seed,
  });

const itemsOf = (
  state: Awaited<ReturnType<typeof realPaper>>["state"],
  itemType: string
) => state.items.filter((entry) => entry.item.itemType === itemType);

const {
  listeningChoukaiSourceFor,
  listeningGaiyouSourceFor,
  listeningHatsuwaSourceFor,
  listeningKadaiSourceFor,
  listeningPointSourceFor,
  servableReadingRow,
} = __test__;

type ListeningSource = NonNullable<ReturnType<typeof listeningKadaiSourceFor>>;

/*
 * The store-sized, drained and unjudged boundaries are all reached by
 * SUBSTITUTING one block's file: a real paper is never drained by spending it.
 * The scratch root symlinks everything else, so the other listening stores and
 * the vocab/grammar corpora stay the real ones, and a shipped file can never be
 * written by the overlay.
 */

/** One block's shipped store, rewritten in the scratch root. `null` means the
 * file is absent, which is the same absence as an empty one. */
const withListeningStore = async <T>(
  level: StoreLevel,
  fileStem: string,
  rows: string | null,
  run: () => Promise<T>
): Promise<T> =>
  withSubstitutedReadingStore({
    fileName: `${level.toLowerCase()}-${fileStem}.json`,
    prefix: "manobu-listening-",
    rows,
    run,
  });

/** One shipped store, read as JSON so an overlay can rewrite one field. */
const shippedRows = (
  level: StoreLevel,
  fileStem: string
): Record<string, unknown>[] =>
  shippedReadingRows(`${level.toLowerCase()}-${fileStem}.json`);

describe("the 聴解 stores", () => {
  for (const level of STORE_LEVELS) {
    for (const { block, items, rows, storeFor } of blocksAt(level)) {
      it(`ships ${at(rows, level)} rows at ${level}, four papers' worth of its ${at(items, level)} 小問`, () => {
        const store = storeFor(level);
        expect(store).toHaveLength(at(rows, level));
        for (const entry of store) {
          expect(entry.level).toBe(level);
          expect(entry.block).toBe(block);
          // The two routes a row may ship by (the gate's screen 1): licensed on
          // its CC BY-SA tag alone, or composed WITH the blind-pass cert the
          // honesty gate (`isRefused`) trusts. N4 and N3 have no licensed row at
          // all: JLPTSuccess ships listening at N5 only (LICENSE §29), so those
          // whole stores ride the cert route.
          if (entry.provenance === "licensed") {
            expect(entry.validated ?? false).toBe(false);
          } else {
            expect(entry.provenance).toBe("composed");
            expect(entry.validated ?? false).toBe(true);
          }
          // The scenario IS the material: the store row carries it in `passage`,
          // and the picker moves it to the `script` stimulus on the way out.
          expect(entry.passage.length).toBeGreaterThan(0);
          expect(entry.stem.length).toBeGreaterThan(0);
          expect(entry.options).toHaveLength(4);
          expect(new Set(entry.options).size).toBe(4);
          expect(entry.answerIndex).toBe(0);
        }
        // Four papers' worth of 小問 before the store runs dry (the same depth
        // standard the 読解 stores are held to).
        expect(store.length).toBeGreaterThanOrEqual(at(items, level) * 4);
        // The shipped count is exactly the floor the blueprint demands; a store
        // that later grows past it must not silently drop this file's expectation.
        expect(store.length).toBe(at(rows, level));
      });
    }
  }

  it("ships 概要理解 only where its blueprint asks 大問3 (N1, N2 and N3)", () => {
    // The other blocks print at every shipping level; N4/N5 blueprints have no
    // 概要理解 大問, so an N4/N5 paper must come up with the block absent from
    // its shape, not with a fabricated 大問.
    expect(listeningGaiyouStoreFor("N1").length).toBeGreaterThan(0);
    expect(listeningGaiyouStoreFor("N3").length).toBeGreaterThan(0);
    expect(listeningGaiyouStoreFor("N2").length).toBeGreaterThan(0);
    for (const level of ["N4", "N5"] as const) {
      expect(listeningGaiyouStoreFor(level)).toHaveLength(0);
    }
  });

  it("ships 聴解統合理解 at N1 and N2, the two levels whose blueprint asks it", () => {
    // Every other level's picker must find no 統合理解 store rather than
    // borrow another block's dialogues.
    expect(listeningChoukaiStoreFor("N1").length).toBeGreaterThan(0);
    expect(listeningChoukaiStoreFor("N2").length).toBeGreaterThan(0);
    for (const level of ["N3", "N4", "N5"] as const) {
      expect(listeningChoukaiStoreFor(level)).toHaveLength(0);
    }
  });

  it("serves no row outside its own level", () => {
    // `servableReadingRow` is the third leg of no-fallback: the loader keys on
    // the filename, so a row wearing another level's stamp must be skipped.
    for (const { storeFor } of BLOCKS) {
      for (const home of STORE_LEVELS) {
        for (const entry of storeFor(home)) {
          expect(servableReadingRow({ entry, level: home })).not.toBeNull();
          for (const away of STORE_LEVELS) {
            if (away !== home) {
              expect(servableReadingRow({ entry, level: away })).toBeNull();
            }
          }
        }
      }
    }
  });
});

describe("the 聴解 pickers", () => {
  for (const level of STORE_LEVELS) {
    it(`turn one ${level} row into a source whose SCENARIO is the stimulus, not the passage`, () => {
      const source = listeningKadaiSourceFor({
        catalog: newCatalog(),
        index: 0,
        level,
        offset: 0,
      });
      expect(source).not.toBeNull();
      const s = source as ListeningSource;
      // The scenario travels as the audio material: `presentationFor` reads
      // `stimulus.japanese` into the `script` column for a LISTENING_ITEM_TYPE,
      // and the printed `passage` stays absent. A learner who could read the
      // dialogue would not be doing 聴解.
      expect(s.passage ?? null).toBeNull();
      expect(s.stimulus).not.toBeNull();
      expect((s.stimulus?.japanese ?? "").length).toBeGreaterThan(0);
      expect(s.stimulus?.english).toBe("");
      // The printed question rides the cue, the answer is options[0] and the
      // picker hands over the three wrong options. Read the row the scenario
      // came from off the store itself: the cue is that row's own question,
      // the target is its key, and nothing about the 小問 is invented on the
      // way out.
      const row = listeningKadaiStoreFor(level).find(
        (entry) => entry.passage === s.stimulus?.japanese
      );
      if (row === undefined) {
        throw new Error(
          "the picker served a scenario its own store does not have"
        );
      }
      expect(s.cue).toBe(row.stem);
      const key = row.options[row.answerIndex];
      if (key === undefined) {
        throw new Error("the store row's answerIndex does not name an option");
      }
      expect(s.target).toBe(key);
      expect(s.distractors).toHaveLength(3);
      expect(new Set([s.target, ...s.distractors])).toEqual(
        new Set(row.options)
      );
      // The anchor is the block's OWN namespace, so a kadai id can never be
      // attested under another block's heading.
      expect(s.anchorId.startsWith("listening-kadai:")).toBe(true);
      expect(s.pattern).toBeNull();
      expect(s.sourcingCase).toBeUndefined();
      expect(s.target).not.toBe("");
    });

    it(`spends the ${level} scenario, so one scenario backs one 小問`, () => {
      const catalog = newCatalog();
      const first = listeningKadaiSourceFor({
        catalog,
        index: 0,
        level,
        offset: 0,
      }) as ListeningSource;
      const second = listeningKadaiSourceFor({
        catalog,
        index: 0,
        level,
        offset: 0,
      }) as ListeningSource;
      // Same index and offset: the first scenario is spent, so the walk moves on.
      expect(second.stimulus?.japanese).not.toBe(first.stimulus?.japanese);
    });

    it(`shares the ${level} scenario spend across the 大問`, () => {
      // `usedListeningScenarios` is ONE set for the whole paper: a scenario the
      // learner already heard in 課題理解 is not a new 小問 under ポイント理解,
      // even though the two stores never repeat a scenario between them today.
      const catalog = newCatalog();
      const kadai = listeningKadaiSourceFor({
        catalog,
        index: 0,
        level,
        offset: 0,
      }) as ListeningSource;
      catalog.usedListeningScenarios.add(kadai.stimulus?.japanese ?? "");
      const point = listeningPointSourceFor({
        catalog,
        index: 0,
        level,
        offset: 0,
      }) as ListeningSource;
      expect(point.stimulus?.japanese).not.toBe(kadai.stimulus?.japanese);
      expect(catalog.usedListeningScenarios.size).toBe(2);
    });

    it(`honors \`seenAnchors\`, so a ${level} retry asks a scenario this learner has not heard`, () => {
      const catalog = newCatalog();
      const first = listeningKadaiSourceFor({
        catalog,
        index: 0,
        level,
        offset: 0,
      }) as ListeningSource;
      const seen = newCatalog();
      seen.seenAnchors.add(first.anchorId);
      const next = listeningKadaiSourceFor({
        catalog: seen,
        index: 0,
        level,
        offset: 0,
      }) as ListeningSource;
      expect(next.anchorId).not.toBe(first.anchorId);
    });
  }

  it("spends the N2 統合理解 dialogue across papers: heard once, never re-aired to the same learner", () => {
    // The 統合理解 script is spent WITHIN a paper by the shared
    // `usedListeningScenarios` (its two 小問 are the lawful exception), and
    // ACROSS papers by `seenAnchors`: a learner who answered paper one's four
    // 小問 has heard both of its dialogues, and the second paper's cursor
    // advances past them instead of rotating back (exam-service.ts:1692).
    const first = newCatalog();
    const heardScripts = new Set<string>();
    const heardAnchors = new Set<string>();
    for (const index of [0, 1, 2, 3]) {
      const source = listeningChoukaiSourceFor({
        catalog: first,
        index,
        level: "N2",
        offset: 7,
      }) as ListeningSource;
      heardScripts.add(source.stimulus?.japanese ?? "");
      heardAnchors.add(source.anchorId);
    }
    // Four 小問 = two dialogues, each heard ONCE behind its two questions.
    expect(heardScripts.size).toBe(2);
    const second = newCatalog();
    for (const anchor of heardAnchors) {
      second.seenAnchors.add(anchor);
    }
    const nextScripts = new Set<string>();
    for (const index of [0, 1, 2, 3]) {
      const source = listeningChoukaiSourceFor({
        catalog: second,
        index,
        level: "N2",
        offset: 7,
      }) as ListeningSource;
      nextScripts.add(source.stimulus?.japanese ?? "");
    }
    expect(nextScripts.size).toBe(2);
    for (const script of nextScripts) {
      expect(heardScripts.has(script)).toBe(false);
    }
  });

  it("declines a level with no store rather than invent a dialogue", () => {
    // Since TASK-173.9.4.3 the only 聴解 store holes left are the ones the
    // blueprints declare: 発話表現 ships at no N1/N2 paper, 概要理解 exists
    // only at N1/N2/N3 and 聴解統合理解 only at N1/N2, so those pickers
    // return null at the levels below and the paper names the hole instead
    // of printing a 大問 off a word list (TASK-173.1: no invented fallback).
    for (const level of ["N1", "N2"] as const) {
      expect(
        listeningHatsuwaSourceFor({
          catalog: newCatalog(),
          index: 0,
          level,
          offset: 0,
        })
      ).toBeNull();
    }
    for (const level of ["N3", "N4", "N5"] as const) {
      expect(
        listeningChoukaiSourceFor({
          catalog: newCatalog(),
          index: 0,
          level,
          offset: 0,
        })
      ).toBeNull();
    }
    for (const level of ["N4", "N5"] as const) {
      expect(
        listeningGaiyouSourceFor({
          catalog: newCatalog(),
          index: 0,
          level,
          offset: 0,
        })
      ).toBeNull();
    }
  });
});

describe("a real paper fills every 聴解 大問 at N1, N2, N3, N4 and N5", () => {
  for (const level of STORE_LEVELS) {
    for (const {
      bigQuestion,
      fileStem,
      items,
      itemType,
      name,
      storeFor,
    } of blocksAt(level)) {
      it(`lands the whole ${level} ${itemType} 大問 byte-equal to its store, as audio not text`, async () => {
        const { assembled, state } = await realPaper(
          level,
          `listening-fill-${level}-${fileStem}`
        );
        const landed = itemsOf(state, itemType);
        // Not "some 聴解": the entire 大問 the blueprint asks.
        expect(landed).toHaveLength(at(items, level));
        // The receipt must not name what it just printed.
        expect(
          assembled.unfilledBlocks.map((block) => block.name)
        ).not.toContain(name);
        // A value type of the ELEMENT, not of `storeFor`'s return: the
        // 統合理解 loader returns a readonly array, and the group below has to
        // grow as rows sharing one script are collected.
        const rowsByScenario = new Map<
          string,
          ReturnType<typeof storeFor>[number][]
        >();
        for (const entry of storeFor(level)) {
          const group = rowsByScenario.get(entry.passage) ?? [];
          group.push(entry);
          rowsByScenario.set(entry.passage, group);
        }
        for (const entry of landed) {
          const { item } = entry;
          expect(entry.bigQuestion).toBe(at(bigQuestion, level));
          expect(entry.section).toBe("listening");
          expect(item.level).toBe(level);
          // The scenario is the AUDIO material: it lands in the `script`
          // column and travels to the client as `speech` (TASK-141's
          // speaking projection, widened to the 聴解 blocks by
          // SPEAKING_ITEM_TYPES), and the printed passage stays null.
          const { speech } = item;
          if (speech === null) {
            throw new Error(
              `a real ${level} 聴解 小問 carries its scenario as speech`
            );
          }
          expect(item.passage).toBeNull();
          const rows = rowsByScenario.get(speech);
          if (rows === undefined) {
            throw new Error(
              `a real ${level} 聴解 小問 plays a scenario it does not have`
            );
          }
          // Byte-equal to ONE of the rows sharing this script: every block but
          // 統合理解 has exactly one row per script, while 聴解統合理解's group
          // carries TWO (one per 小問) and each landed question must match its
          // own row - which is also the proof that `resolveAnchor` trusts the
          // `listening-*:` namespace and the stimuli contract accepts a
          // script-only row (minScripts 1): either failure drops the candidate
          // before it can land.
          const row = rows.find((candidate) => candidate.stem === item.stem);
          if (row === undefined) {
            throw new Error(
              `a real ${level} 聴解 小問 plays a question its store does not carry`
            );
          }
          expect(item.stem).toBe(row.stem);
          expect(new Set(item.options)).toEqual(new Set(row.options));
          expect(item.options).toHaveLength(4);
          // The printed question never carries the scenario's own text.
          expect(item.stem).not.toBe(speech);
        }
      });
    }

    it(`never plays one ${level} scenario twice in one paper, across the 大問`, async () => {
      // The shared `usedListeningScenarios` spend, proven end to end: every
      // 小問 of the section plays a different scenario, because a learner who
      // heard it once has already answered it - with ONE lawful exception:
      // 聴解統合理解 hears one long dialogue ONCE and answers its TWO 小問
      // (N2L.pdf 問題5), so its scripts appear exactly twice each, never under
      // another 大問's heading, and every other 大問's script appears once.
      const { state } = await realPaper(
        level,
        `listening-scenario-uniqueness-${level}`
      );
      const landed = state.items.filter((entry) => entry.item.speech !== null);
      const scenarios = landed.map((entry) => entry.item.speech);
      const expected = blocksAt(level).reduce(
        (total, block) => total + at(block.items, level),
        0
      );
      expect(scenarios).toHaveLength(expected);
      const countByScript = new Map<string, number>();
      const typesByScript = new Map<string, Set<string>>();
      for (const entry of landed) {
        const script = entry.item.speech ?? "";
        countByScript.set(script, (countByScript.get(script) ?? 0) + 1);
        const types = typesByScript.get(script) ?? new Set<string>();
        types.add(entry.item.itemType);
        typesByScript.set(script, types);
      }
      // A script belongs to exactly ONE 大問, whatever the block.
      for (const types of typesByScript.values()) {
        expect(types.size).toBe(1);
      }
      const choukai = blocksAt(level).find(
        (block) => block.block === "choukai-tougou-rikai"
      );
      if (choukai === undefined) {
        expect(countByScript.size).toBe(expected);
        return;
      }
      // With 統合理解: 4 小問 = 2 dialogues × 2 questions. Each dialogue is
      // heard ONCE and answered twice; every other scenario is spent once.
      expect(countByScript.size).toBe(expected - at(choukai.items, level) / 2);
      for (const [script, count] of countByScript) {
        const isChoukai = typesByScript.get(script)?.has("listening-choukai");
        expect(count).toBe(isChoukai === true ? 2 : 1);
      }
    });
  }

  for (const level of ["N1", "N2"] as const) {
    it(`lands ${level} 聴解統合理解 as two dialogues heard once, each behind its two 小問`, async () => {
      // AC#6's pin: the 統合理解 大問 is the one lawful case where a script
      // re-airs inside a paper (N2L.pdf 問題5: 二つの質問). ONE long dialogue is
      // heard once, its TWO questions land whole and distinct, and the script
      // never leaks into another 大問.
      const { assembled, state } = await realPaper(
        level,
        `listening-${level}-choukai-group`
      );
      expect(assembled.unfilledBlocks.map((block) => block.name)).not.toContain(
        "統合理解"
      );
      const landed = itemsOf(state, "listening-choukai");
      expect(landed).toHaveLength(4);
      const byScript = new Map<string, typeof landed>();
      for (const entry of landed) {
        const script = entry.item.speech ?? "";
        const group = byScript.get(script) ?? [];
        group.push(entry);
        byScript.set(script, group);
      }
      expect(byScript.size).toBe(2);
      for (const group of byScript.values()) {
        expect(group).toHaveLength(2);
        // Two DIFFERENT questions of one dialogue, both at 大問5.
        expect(new Set(group.map((entry) => entry.item.stem)).size).toBe(2);
        for (const entry of group) {
          expect(entry.bigQuestion).toBe(5);
          expect(entry.item.passage).toBeNull();
        }
      }
      const otherScripts = new Set(
        state.items
          .filter(
            (entry) =>
              entry.item.itemType !== "listening-choukai" &&
              entry.item.speech !== null
          )
          .map((entry) => entry.item.speech)
      );
      for (const script of byScript.keys()) {
        expect(otherScripts.has(script)).toBe(false);
      }
    });
  }

  it("heads no 聴解 大問 with a printed instruction, as AC#2 decided", () => {
    // The real booklets read the 聴解 heading aloud; the instruction table
    // returns null for these blocks at every level rather than inventing a
    // sentence nobody printed (the documented no-instruction case).
    for (const level of STORE_LEVELS) {
      for (const { block } of blocksAt(level)) {
        expect(paperBlockInstruction({ block, level })).toBeNull();
      }
    }
  });

  it("puts every 聴解 大問 in the listening blueprint section with its item type", () => {
    // The block rows are where the routing lives: an item type missing from
    // its block would silently never be asked.
    for (const level of STORE_LEVELS) {
      const blocks = paperBlocksFor({ level, section: "listening" });
      for (const { block, itemType } of blocksAt(level)) {
        const row = blocks.find((candidate) => candidate.id === block);
        expect(row?.itemTypes).toEqual([itemType]);
      }
    }
  });

  it("scores the 小問 into the listening band", async () => {
    for (const level of STORE_LEVELS) {
      const band = PAPER_BLUEPRINTS[level].scoringSections.find(
        (each) => each.id === "listening"
      );
      expect(band).toBeDefined();
      // biome-ignore lint/performance/noAwaitInLoops: one paper per level, assembled sequentially so a failure names its level.
      const { assembled, state } = await realPaper(
        level,
        `listening-band-${level}`
      );
      assertLandedScoresInto({
        assembled,
        landed: itemsOf(state, "listening-kadai"),
        scoringSectionId: "listening",
      });
    }
  });
});

describe("a 聴解 大問 is a hole exactly when its store is gone", () => {
  for (const level of STORE_LEVELS) {
    for (const { bigQuestion, fileStem, items, itemType, name } of blocksAt(
      level
    )) {
      it(`names 大問${at(bigQuestion, level)} when the ${level} ${fileStem} store is empty or missing`, async () => {
        for (const rows of ["[]", null] as const) {
          // biome-ignore lint/performance/noAwaitInLoops: both iterations swap an overlay of the SAME store file, so they must not run concurrently.
          const { assembled, state } = await withListeningStore(
            level,
            fileStem,
            rows,
            () => realPaper(level, `listening-drained-${level}-${fileStem}`)
          );
          const hole = assembled.unfilledBlocks.find(
            (block) => block.name === name
          );
          expect(hole?.bigQuestion).toBe(at(bigQuestion, level));
          expect(hole?.requestedItems).toBe(at(items, level));
          expect(itemsOf(state, itemType)).toHaveLength(0);
          // Non-vacuity: the overlay is a working data root, not a broken one,
          // because the OTHER 聴解 大問 still fill from their real stores.
          const otherFilled = blocksAt(level)
            .filter((candidate) => candidate.fileStem !== fileStem)
            .every(
              (candidate) =>
                itemsOf(state, candidate.itemType).length ===
                at(candidate.items, level)
            );
          expect(otherFilled).toBe(true);
        }
      });
    }
  }

  it("counts a store too small for its 大問 as a shortfall, not a hole", async () => {
    // One row DOES trigger the boundary: the block HAS a source, so it stays
    // out of `unfilledBlocks` and comes up short instead (TASK-148's different
    // fact).
    const { assembled, state } = await withListeningStore(
      "N5",
      "kadai",
      JSON.stringify(shippedRows("N5", "kadai").slice(0, 1)),
      () => realPaper("N5", "listening-one-row")
    );
    expect(assembled.unfilledBlocks.map((block) => block.name)).not.toContain(
      "課題理解"
    );
    expect(itemsOf(state, "listening-kadai")).toHaveLength(1);
  });
});

describe("an unjudged 聴解 row never reaches a learner", () => {
  for (const level of STORE_LEVELS) {
    it(`refuses every ${level} composed row whose two blind passes did not sign it off`, async () => {
      // 即時応答 is the FULLY authored store at every level, which is why the
      // overlay goes there: the N5 licensed rows in the other stores keep
      // serving on their CC BY-SA tag, and 課題理解 has so many of them at N5
      // (≥ its 小問数) that refusing every composed row there would still land
      // a whole 大問. Here the refusal is visible: not one 小問 arrives.
      // The walk's `composed && !validated` term (the honesty gate `isRefused`)
      // is what makes a real paper trust the flag `check:listening-*` proves.
      const unjudged = shippedRows(level, "sokuji").map((row) => ({
        ...row,
        validated: false,
      }));
      const { assembled, state } = await withListeningStore(
        level,
        "sokuji",
        JSON.stringify(unjudged),
        () => realPaper(level, `listening-unjudged-${level}`)
      );
      expect(itemsOf(state, "listening-sokuji")).toHaveLength(0);
      // The store still HAS rows, so the block has a real source and stays out
      // of the named holes: what failed is the CERT, which is TASK-148's
      // shortfall fact, not the missing-store fact the drained group names.
      expect(assembled.unfilledBlocks.map((block) => block.name)).not.toContain(
        "即時応答"
      );
      // Non-vacuity: the same overlay with the shipped rows fills the 大問
      // whole, so the refusal above is the flag and nothing else.
      const filled = await withListeningStore(
        level,
        "sokuji",
        JSON.stringify(shippedRows(level, "sokuji")),
        () => realPaper(level, `listening-judged-overlay-${level}`)
      );
      const sokujiItems = BLOCKS.find(
        (block) => block.fileStem === "sokuji"
      ) as BlockSpec;
      expect(itemsOf(filled.state, "listening-sokuji")).toHaveLength(
        at(sokujiItems.items, level)
      );
    });
  }
});
