/**
 * Mutation gate: does a declared seam mutation actually fail its tests?
 *
 * A test suite's value is not "it passes" but "it fails when the behavior
 * breaks". The 2026-09-26 test audit could only prove one real coverage hole
 * (an inert `Dispute` button passed all 452 desktop tests) by breaking the
 * code on purpose and watching. This script makes that check repeatable for a
 * curated list of high-value seams.
 *
 * For each declared mutation it:
 *   1. rewrites one exact string in one file (and FAILS if the anchor is
 *      missing or ambiguous, because a moved seam means the gate is stale),
 *   2. runs that seam's declared test command,
 *   3. requires a NON-ZERO exit — a surviving mutation is a coverage hole,
 *   4. restores the file in a `finally`, and journals the pre-mutation content
 *      first so a run that is KILLED (a `finally` it never reaches, and no
 *      signal handler can catch it while `spawnSync` blocks) leaves a record
 *      the next run applies before doing anything else.
 *
 * A mutating run also refuses to start when a selected seam file is already
 * dirty, because the seam would be scored against code its anchor does not
 * describe; `--allow-dirty` says the edit is yours. `--check` resolves every
 * anchor without writing, which is the tripwire for a leftover that predates
 * the journal.
 *
 * Usage:
 *   bun scripts/mutation-gate.ts            # every seam
 *   bun scripts/mutation-gate.ts dispute    # seams whose id contains "dispute"
 *   bun scripts/mutation-gate.ts --check    # resolve every anchor, write nothing
 *
 * Exit codes: 0 every mutation was caught, 1 at least one survived, a seam file
 * was dirty, or an anchor/command problem made the verdict untrustworthy.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

interface Mutation {
  /** Repo-relative file to rewrite. */
  file: string;
  /** The exact string to replace. Must occur exactly once. */
  find: string;
  /** Stable id, also the filter substring. */
  id: string;
  /** The replacement that breaks the behavior. */
  replace: string;
  /** What the mutation simulates, in one line. */
  simulates: string;
  /** Test command proving the behavior, run from the repo root. */
  test: string[];
}

/**
 * Anchors that name a line containing a template placeholder. Declaring the
 * placeholder as data keeps the file free of a `${` inside an ordinary string,
 * which the linter rightly rejects, and the seam still matches the source
 * character for character. Concatenating a literal `${` is not a way around it:
 * the linter sees through that too.
 */
const DOLLAR = "$";
const HEADING_LINE = `  return block === undefined ? null : \`大問 ${DOLLAR}{bigQuestion} · ${DOLLAR}{block.name}\`;`;
const STEM_LINE = `    return \`「${DOLLAR}{cue}」\`;`;

const MUTATIONS: readonly Mutation[] = [
  {
    file: "packages/japanese/scripts/gen-reading-chuubun.ts",
    find: "  if (CHUUBUN_STEM.includes(slot.surface)) {",
    id: "chuubun-stem-leak-slot-skipped",
    replace: "  if (false && CHUUBUN_STEM.includes(slot.surface)) {",
    simulates:
      "the 中文 generator re-ships a slot whose surface the fixed stem prints (the 一つ answer-inside-the-question row the first 令和7年版 regeneration caught; TASK-173.9.10). The skip sits in `finishRow`, which both constructions end in, so dropping it leaks the answer into the question at N2 and at N4 alike",
    test: ["bun", "test", "packages/japanese/test/gen-reading-chuubun.test.ts"],
  },
  {
    file: "packages/ui/src/lib/copy.ts",
    find: `  "mock.timer": { primary: "⏱ {mm}:{ss} elapsed" },`,
    id: "mock-timer-label-elapsed",
    replace: `  "mock.timer": { primary: "⏱ {mm}:{ss} remaining" },`,
    simulates:
      "the mock clock counts up but its label reverts to 'remaining', reading as a countdown about to expire",
    test: ["bun", "test", "apps/desktop/test/mock-timer.test.tsx"],
  },
  {
    file: "apps/desktop/src/shared/chrome-free.ts",
    find: '  "/review",\n',
    id: "review-desk-chrome-free",
    replace: "",
    simulates:
      "/review leaves the chrome-free family, so the shared Header returns and its lone 'AI Chat' link reads as the page title with no way back to the desk (TASK-170)",
    test: ["bun", "test", "apps/desktop/test/chrome-free.test.ts"],
  },
  {
    file: "packages/ui/src/lib/copy.ts",
    find: `    primary: "No audio output · pitch diagrams + type fallback still work",`,
    id: "voice-no-output-neutral-glyph",
    replace: `    primary: "🔇 No audio output · pitch diagrams + type fallback still work",`,
    simulates:
      "the expected no-voice state reverts to a red 🔇 prohibition glyph, signalling breakage to a learner who can still use pitch + type (TASK-171)",
    test: ["bun", "test", "packages/ui/test/copy-snapshot.test.ts"],
  },
  {
    file: "apps/desktop/src/features/exam/exam-paper-pane.tsx",
    find: "  dispute: () => dispute(item.itemId),\n  replay: () => replay(item),",
    id: "exam-review-dispute-binding",
    replace: "  dispute: () => undefined,\n  replay: () => replay(item),",
    simulates: "the exam review Dispute button renders but does nothing",
    test: ["bun", "test", "apps/desktop/test/exam-workspace.test.ts"],
  },
  {
    file: "apps/desktop/src/features/exam/exam-question.tsx",
    find: "  if (isTtsBootstrapped() || !isInTauri()) {",
    id: "exam-voice-gate-always-control",
    replace: "  if (true) {",
    simulates:
      "the listening control drops its proactive readiness gate: a fresh install renders a play button whose click cannot produce sound (the fake play TASK-173.8.2 AC#1 removes)",
    test: ["bun", "test", "apps/desktop/test/exam-voice-first-run.test.ts"],
  },
  {
    file: "apps/desktop/src/features/exam/exam-question.tsx",
    find: "  return question.passage ? [question.passage] : [];",
    id: "exam-stimulus-legacy-fallback",
    replace: "  return [];",
    simulates:
      "a paper written before the stimulus set renders no passage at all",
    test: ["bun", "test", "apps/desktop/test/exam-workspace.test.ts"],
  },
  {
    file: "apps/desktop/src/features/exam/exam-paper-pane.tsx",
    find: '        {t("paper.result.estimate")}',
    id: "exam-result-estimate-dropped",
    replace: '        {""}',
    simulates:
      "the banded result drops the estimate disclaimer, so the linear score reads as an official JLPT 得点 / pass prediction (TASK-173.10 AC#2)",
    test: ["bun", "test", "apps/desktop/test/exam-result-copy.test.ts"],
  },
  {
    file: "packages/acp/src/acp-events.ts",
    find: `  return HOST_TOOL_NAMES.some(
    (name) =>
      title === name || title.endsWith(\`_\${name}\`) || title.endsWith(\`-\${name}\`)
  );`,
    id: "host-ask-user-suppression",
    replace: "  return false;",
    simulates:
      "the host ask_user tool card is no longer suppressed, so raw JSON stacks on the ask card",
    test: [
      "bun",
      "test",
      "packages/acp/test/acp-events.test.ts",
      "packages/chat-session/src/chat-engine.test.ts",
      "packages/chat-session/src/history.test.ts",
      // The sink's claim reads this predicate, so a dead predicate re-opens the
      // leak on the plane the client cannot police (TASK-149).
      "apps/server/test/host-tool-suppression.test.ts",
    ],
  },
  {
    file: "packages/item-engine/src/validation.ts",
    find: '      return reject(MISSING_STIMULUS_REASON[item.itemType] ?? "stimuli-kind");',
    id: "integrated-stimulus-kind-rejection",
    replace: "      return null;",
    simulates: "an integrated item with the wrong stimulus kind is accepted",
    test: ["bun", "test", "packages/item-engine/test/validation.test.ts"],
  },
  {
    file: "packages/item-engine/src/hash.ts",
    // Removing the whole mixing block, not one constant: replacing a single
    // multiplier with 1 still mixes, and the ordering property survives, so
    // that weaker mutation is a hole in the gate rather than a catch.
    find: "  let mixed = hash;\n  mixed ^= mixed >>> 16;\n  mixed = Math.imul(mixed, 0x85_eb_ca_6b);\n  mixed ^= mixed >>> 13;\n  mixed = Math.imul(mixed, 0xc2_b2_ae_35);\n  mixed ^= mixed >>> 16;\n  return mixed >>> 0;",
    id: "shared-hash-avalanche",
    replace: "  return hash >>> 0;",
    simulates:
      "the shared hash loses its avalanche, so inputs differing in one character stay adjacent and every ordering built on it degrades to a character sort",
    test: [
      "bun",
      "test",
      "packages/item-engine/test/selection.test.ts",
      "packages/item-engine/test/paper.test.ts",
    ],
  },
  {
    file: "packages/item-engine/src/paper.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is the SOURCE line, whose ${...} must stay literal text
    find: "  seededPermutation(optionCount, hashString(`${examId}\\0${seed}\\0${itemId}`));",
    id: "option-shuffle-depends-on-the-item",
    replace: "  seededPermutation(optionCount, 0);",
    simulates:
      "the option order stops depending on the item, so one seed drives every item's order",
    test: ["bun", "test", "packages/item-engine/test/paper.test.ts"],
  },
  {
    file: "packages/item-engine/src/hash.ts",
    find: "    order[index] = other;\n    order[swapWith] = held;",
    id: "option-shuffle-returns-the-identity",
    replace: "    order[index] = held;\n    order[swapWith] = other;",
    simulates:
      "the Fisher-Yates swap is undone, so every paper is back to the original option order (answer A)",
    test: ["bun", "test", "packages/item-engine/test/paper.test.ts"],
  },
  {
    file: "packages/chat-session/src/chat-engine/folds/tool-call.ts",
    find: "  if (isHostToolCallTitle(title)) {\n    return prev.filter((message) => message.id !== id);\n  }",
    id: "host-tool-card-fold-removal",
    replace:
      "  if (false && isHostToolCallTitle(title)) {\n    return prev.filter((message) => message.id !== id);\n  }",
    simulates:
      "a host tool call that streamed a generic card never gets that card removed",
    test: ["bun", "test", "packages/chat-session/src/chat-engine.test.ts"],
  },
  {
    file: "packages/chat-session/src/chat-engine/folds/tool-call.ts",
    find: '  if (sessionUpdate === "tool_call_update" && !title && !existing) {\n    return prev;\n  }',
    id: "host-tool-update-invents-a-card",
    replace:
      '  if (false && sessionUpdate === "tool_call_update" && !title && !existing) {\n    return prev;\n  }',
    simulates:
      "a title-less tool_call_update with no card to update builds one from nothing, so a host tool the server suppressed still reaches the transcript as raw JSON (live and on reopen)",
    test: [
      "bun",
      "test",
      "packages/chat-session/src/chat-engine.test.ts",
      "packages/chat-session/src/history.test.ts",
    ],
  },
  {
    file: "packages/chat-session/src/history.ts",
    find: "    enabled: known,",
    id: "chat-history-reads-unconfirmed-conversation",
    replace: "    enabled: conversationId.length > 0,",
    simulates:
      "TASK-157's gate reverted to the string test: a fresh chat mints an id the server has never heard of, and the transcript read fires anyway and is answered NOT_FOUND",
    test: ["bun", "test", "packages/chat-session/src/history.test.ts"],
  },
  {
    file: "packages/chat-session/src/fetcher.tsx",
    find: "    enabled: known,",
    id: "chat-slash-snapshot-reads-unconfirmed-conversation",
    replace: "    enabled: true,",
    simulates:
      "TASK-157's second gate removed: the slash snapshot asks for a session that only the first chat.send creates, so every fresh conversation pays a 404 for it",
    test: ["bun", "test", "packages/chat-session/src/fetcher.test.ts"],
  },
  {
    file: "packages/chat-session/src/provider-initial.ts",
    find: "  return (\n    input.open?.conversationId === input.conversationId ||\n    input.messages.length > 0\n  );",
    id: "chat-conversation-known-everything",
    replace: "  return true;",
    simulates:
      "TASK-157's proof check degraded to always-true, which is exactly the old behavior: both gated reads go out for a client-minted conversation id",
    test: ["bun", "test", "packages/chat-session/src/provider-initial.test.ts"],
  },
  {
    file: "packages/chat-session/src/provider-initial.ts",
    find: "    SESSION_TURN_CARD_TYPES.includes(message.type)",
    id: "chat-slash-snapshot-fires-on-a-sessionless-transcript",
    replace: "    true",
    simulates:
      "TASK-172's stricter slash gate degraded to any-card: a stored paper or the learner's own row (both precede the session) would let the read fire and answer NOT_FOUND, the exam-mount 404",
    test: ["bun", "test", "packages/chat-session/src/provider-initial.test.ts"],
  },
  {
    file: "apps/desktop/src/routes/jlpt-mock.tsx",
    find: '      b: "に",',
    id: "mock-seed-offers-the-same-answer-twice",
    replace: '      b: "は",',
    simulates:
      "the shipped seed regression: q2 offered the correct string under two option ids while keying the answer to one of them, so a learner picking the other copy of a right answer was scored wrong",
    test: ["bun", "test", "apps/desktop/test/jlpt-mock-seed.test.ts"],
  },
  {
    file: "apps/server/src/chat-persistence.ts",
    find: "  return claimedHostToolCallIds.has(toolCallId);",
    id: "host-tool-claim-not-carried",
    replace: "  return false;",
    simulates:
      "the sink suppresses only the frame that names the host tool, so the follow-up title-less update streams raw JSON to every subscriber and is stored as a row",
    test: ["bun", "test", "apps/server/test/host-tool-suppression.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "      focus: state.focus,",
    id: "exam-request-focus-rebuild",
    replace: "      focus: [],",
    simulates:
      "a resumed exam rebuilds a request that is not the one submitted, silently discarding the focus the learner asked for",
    test: ["bun", "test", "apps/server/test/exam-pipeline.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "    focusSourceFor({ catalog, corpus, family, index, itemType, request }) ??",
    id: "exam-focus-prior-removed",
    replace: "    null ??",
    simulates:
      "focus is persisted and round-tripped but never read at selection time, so a focused request produces the same paper as an unfocused one",
    test: ["bun", "test", "apps/server/test/exam-pipeline.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-mask.ts",
    find: "  const after = await split(masked);\n  if (!after || after.includes(literal)) {",
    id: "exam-mask-unverified-claim",
    replace:
      "  const after = null as readonly string[] | null;\n  if (false && (!after || after.includes(literal))) {",
    simulates:
      "an item reports itself masked while the blank was never found, which is the outcome AC#3 exists to prevent",
    test: ["bun", "test", "apps/server/test/exam-mask.test.ts"],
  },
  {
    file: "packages/db/src/item-store.ts",
    find: "          focus: JSON.stringify(input.focus ?? []),",
    id: "exam-focus-not-persisted",
    replace: "          focus: JSON.stringify([]),",
    simulates:
      "the exam row never records the request focus, so a restart loses it even though the service passes it",
    test: ["bun", "test", "apps/server/test/exam-pipeline.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "  return entry !== undefined && synonymsOf(entry, target).includes(option);",
    id: "exam-gloss-ambiguity-not-refused",
    replace: "  return false;",
    simulates:
      "glossOptionSatisfies answers false for every distractor, so the validator never reports a second correct sense of the target and a bare-gloss item with two right options validates and ships (the TASK-144 baseline defect, doc-23)",
    test: ["bun", "test", "apps/server/test/exam-gloss-ambiguity.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    // The anchor spans BOTH withholding guards because they are redundant by
    // design: `ownConfirmed`'s group filter removes the answer's own group, and
    // the `seen` set removes it again at the dedupe step for a rendering that is
    // cross-listed into another group. Breaking one leaves the other, which is
    // why the single-line `seen` seam here SURVIVED: it was a no-op on the
    // shipped sample, not a coverage hole. A seam must break the property, not
    // one of the two ways it is defended.
    find: `          .filter((group) => !group.includes(target))
          .flat()
          .filter((gloss) => !ownSynonyms.has(gloss))
      : [];
  const others = rotateDistractors({
    isTaken: (surface) => surface === target,
    pool,
    scanFrom,
    size: pool.length,
    surfaceOf: (candidate) =>
      sharesTag(candidate, tags) && !isSameEntry(candidate, entry)
        ? surfaceOf(candidate)
        : undefined,
  });
  // The answer's own group is excluded even where a rendering also appears in
  // another group: a gloss that is correct for this answer is correct whatever
  // else it also is.
  const seen = new Set<string>([target, ...ownSynonyms]);`,
    id: "exam-sense-group-distractors-dropped",
    replace: `          .flat()
          .filter((gloss) => gloss !== target)
      : [];
  const others = rotateDistractors({
    isTaken: (surface) => surface === target,
    pool,
    scanFrom,
    size: pool.length,
    surfaceOf: (candidate) =>
      sharesTag(candidate, tags) && !isSameEntry(candidate, entry)
        ? surfaceOf(candidate)
        : undefined,
  });
  const seen = new Set<string>([target]);`,
    simulates:
      "the picker stops withholding the answer's own sense group at both guards, so 黄色 offers amber and 暇 offers leisure as wrong answers - AC#8's bug, back again",
    test: ["bun", "test", "apps/server/test/exam-sense-groups.test.ts"],
  },
  // DELETED, not weakened: a seam reverting the validator to the FLAT gloss list
  // instead of the sense group. It mutated the same line as
  // `exam-gloss-ambiguity-not-refused` above, and two seams cannot share one
  // anchor - the second would never resolve. The seam that remains reverts the
  // same decision to "never refuse", which is the stronger property: it proves
  // the group check is what refuses, and the flat-list regression cannot slip
  // past it either.
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "    if (!candidate || catalog.usedGrammarIds.has(candidate.id)) {",
    id: "exam-grammar-anchor-reused",
    replace: "    if (!candidate) {",
    simulates:
      "the paper spends one grammar POINT per item type instead of once per paper, so `particle` and `reading-info` can both ask the same question (21 duplicate anchors across five papers before TASK-138 AC#9)",
    test: ["bun", "test", "apps/server/test/exam-grammar-once.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "  gloss: (entry) => entry.senses?.[0]?.[0] ?? fullSensesOf(entry)[0],",
    id: "exam-gloss-reads-truncated-summary",
    replace: '  gloss: (entry) => (entry.meaning ?? "").split(";")[0]?.trim(),',
    simulates:
      "the gloss surface reads the CAPPED `meaning` summary again, which is what shipped before 35a4d09. `meaning` is `;`-joined and JMdict glosses contain `;` inside parentheses, so the primary gloss is mangled: アウト is `out (of a ball; in tennis, etc.)` and the summary parse yields `out (of a ball` - which is then marked as the ANSWER. Four entries shipped a wrong answer that way, silently, and the cap also hid 9,442 glosses across 1,748 entries. The first version of this seam mutated to `fullSensesOf(entry)[0]` instead, which is a NO-OP (a group's first rendering is its flat list's first rendering for all 8,476 corpus entries), and the gate reported it caught because the command was dying on env validation from the repo root rather than running",
    test: ["bun", "test", "apps/server/test/exam-sense-groups.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "  gloss: (entry) => entry.senses?.[0]?.[0] ?? fullSensesOf(entry)[0],",
    id: "exam-gloss-not-the-primary-sense",
    replace:
      "  gloss: (entry) => entry.senses?.[1]?.[0] ?? entry.senses?.[0]?.[0] ?? fullSensesOf(entry)[0],",
    simulates:
      "the gloss surface asking for a LATER sense than the one being taught (TASK-138 AC#7): 暇 answers 'leisure' rather than 'spare time'. Nothing about the item looks broken - it is still an attested gloss of the right entry, still unambiguous against its distractors - so only an assertion about WHICH sense passes for the answer can see it",
    test: ["bun", "test", "apps/server/test/exam-sense-groups.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: `  let sourcingCase: SourcingCase | undefined;
  if (family !== "gloss") {
    sourcingCase = undefined;
  } else if (ownConfirmed.length > 0) {
    sourcingCase = "from-own-group";
  } else if (senseGroupsOf(entry).length < 2) {
    sourcingCase = "single-group-fallback";
  } else {
    sourcingCase = "same-pos-pool";
  }`,
    id: "exam-sourcing-case-always-own-group",
    replace: `  const sourcingCase: SourcingCase = "from-own-group";`,
    simulates:
      "the per-item distractor ledger records a fixed case instead of deriving it from the counts that decided it. This is the failure fix 5 exists to prevent: AC#10 closed by writing down the answer rather than by measuring it. A ledger that can lie is worse than no ledger, because it converts a coverage question into a claim. Caught by cross-checking each recorded case against the item's actual options",
    test: ["bun", "test", "apps/server/test/exam-sense-groups.test.ts"],
  },
  {
    // TASK-173.1 AC#3, re-anchored by TASK-173.4. The seam used to mutate
    // `isRefused`'s drop (`usable = built`), and it survived: the block-driven
    // real mix asks only kanji-reading, grammar-form and particle (TASK-173.12
    // dropped conjugation from the 文の文法1 block),
    // and only the gloss family ever gets a `sourcingCase`
    // (`exam-service.ts:762`), so in real mode nothing is refused to drop. That
    // guard goes live again if a sibling format task gives a real-mode 大問 a
    // gloss-family item type (the candidates are TASK-173.5 文脈規定,
    // TASK-173.6 文の組み立て, TASK-173.7 読解 and TASK-173.8 聴解), and this
    // seam should be re-added for it then. What IS live, and
    // what AC#3 also promises, is the other half: the daily modes keep filling
    // from the fallback. Moving the refusal onto them is the break a test can
    // see, so that is what the anchor now spans.
    // TASK-173.9.5 grew `isRefused` from a flat two-term condition into
    // `mode === "real" && (fallback || composed)`, so the flat two-line anchor
    // went stale. The mode term is still the seam's target and still unique:
    // moving it onto a daily mode breaks AC#3's "the practice papers keep
    // filling" half regardless of which refusal term now rides behind it.
    file: "apps/server/src/services/exam-service.ts",
    find: '    request.mode === "real" &&',
    id: "exam-refusal-moved-onto-daily-papers",
    replace: '    request.mode === "shortened" &&',
    simulates:
      "the refusal follows the daily paper instead of the real one: 模試 keeps every fabricated distractor it widened for and ships a full slot count, while every practice paper starts dropping candidates it has always shipped. AC#3's second half, that the daily modes are unchanged",
    test: ["bun", "test", "apps/server/test/exam-real-mode-refusal.test.ts"],
  },
  {
    // TASK-173.4 AC#4 on the read side. The receipt's three shortage diagnoses
    // are separate fields on purpose (TASK-173.1's `refusedSections`, TASK-148's
    // `contentExhausted`, this one), and the learner-facing sentence is chosen
    // from them, so a dropped third field silently reverts a structurally short
    // paper to the generic "Try again?" failure.
    file: "apps/server/src/services/exam-service.ts",
    find: '  const unfilledBlocks =\n    request.mode === "real"',
    id: "exam-receipt-drops-unfilled-blocks",
    replace: '  const unfilledBlocks =\n    false && request.mode === "real"',
    simulates:
      "the receipt stops naming the 大問 the official shape asked for and the engine cannot build, so a real paper that is short by whole blocks reads to the learner as a build that merely failed, and the host tool answers with the wrong refusal",
    test: ["bun", "test", "apps/server/test/exam-real-mode-refusal.test.ts"],
  },
  {
    // TASK-173.4 AC#2: the real paper is shaped 大問 by 大問. Nothing else about
    // the mode changes, so a mix that silently falls back to the flat spread is
    // a paper that looks official in its receipt and is not one.
    file: "packages/item-engine/src/paper.ts",
    find: '}: PaperMixAllocationInput): PaperItemTypeCounts => {\n  if (mode !== "real") {\n    return allocatePaperItemTypes({ budget, level, section });\n  }',
    id: "paper-real-mix-not-block-driven",
    replace:
      "}: PaperMixAllocationInput): PaperItemTypeCounts => {\n  if (true) {\n    return allocatePaperItemTypes({ budget, level, section });\n  }",
    simulates:
      "real mode spreads its section budget over the level's item-type weights instead of walking the official 大問, so every 大問 after the first is filled from the wrong mix and the shortfall, the named holes and the printed grouping all describe a paper nobody assembled",
    test: ["bun", "test", "packages/item-engine/test/paper.test.ts"],
  },
  {
    // TASK-173.4 AC#4: a hole is a 大問 something was asked for AND nothing can
    // fill. Dropping the second half reports 大問 1 漢字読み, which the engine can
    // build, as missing, and the refusal then names parts of the paper the app
    // is in fact asking. The second half is now two terms (no question kind, or
    // a kind with no store at this level), and `hasSource` defaults to "every
    // 大問 is sourceable", so the engine-only reading of the anchor keeps this
    // seam about the engine's own rule.
    file: "packages/item-engine/src/paper.ts",
    find: "      (block) =>\n        block.requested > 0 &&\n        (block.itemTypes.length === 0 || !hasSource(block))",
    id: "paper-unfillable-blocks-count-buildable-ones",
    replace: "      (block) => block.requested > 0",
    simulates:
      "every 大問 the section asked for is reported as unfillable, including the ones with item types, so a real paper that is filling 漢字読み is refused as though it were not",
    test: ["bun", "test", "packages/item-engine/test/paper.test.ts"],
  },
  {
    // TASK-173.4: a real section cannot ask for more 小問 than the official
    // shape has. Uncapping it makes the receipt's shortfall larger than the
    // paper, which is the arithmetic the learner-facing numbers depend on.
    file: "packages/item-engine/src/paper.ts",
    find: "          Math.min(asked, paperSectionIndicativeCount({ level, section }))",
    id: "paper-real-budget-uncapped",
    replace: "          asked",
    simulates:
      "an over-large real ask is taken at face value, so a 40-item N5 vocabulary section is short by 28 against a paper that only ever had 35 小問, and both the receipt and the notice print a hole that is not in the official paper",
    test: ["bun", "test", "packages/item-engine/test/paper.test.ts"],
  },
  {
    // TASK-173.4 AC#4 on the desktop: the pane reads the grouping the server
    // sent and prints one heading per 大問.
    file: "apps/desktop/src/features/exam/exam-paper-pane.tsx",
    find: HEADING_LINE,
    id: "desktop-large-question-heading-dropped",
    replace: "  return null;",
    simulates:
      "the 大問 heading never renders, so a real paper reads as a flat run of 小問 with no block boundaries and no way to tell which part of the paper one is on",
    test: ["bun", "test", "apps/desktop/test/exam-workspace.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "    explanation: null,",
    id: "exam-explanation-stub-restored",
    replace: '    explanation: "server-only explanation",',
    simulates:
      "the composed-item stub comes back. Every exam item then ships the same placeholder prose, `explanationGenerated` derives to true from it, and the learner reads 'Generated from {anchor}: server-only explanation' on every review row and every replayed drill. TASK-137 AC#1: nothing in this repo authors exam prose (TASK-145 parked), so the honest value is null",
    test: ["bun", "test", "apps/server/test/exam-pipeline.test.ts"],
  },
  {
    file: "apps/desktop/src/features/exam/exam-paper-pane.tsx",
    find: "): boolean => item.explanationGenerated && item.explanation !== null;",
    id: "exam-review-explanation-gate",
    replace: "): boolean => item.explanationGenerated;",
    simulates:
      "the review row trusts the flag without checking the prose, so a generated row with nothing to show renders the 'Generated from {anchor}' heading over an empty panel. The two debrief fields are independent in the contract, so the flag cannot vouch for the text",
    test: ["bun", "test", "apps/desktop/test/exam-workspace.test.ts"],
  },
  {
    file: "packages/api-contract/src/exam.ts",
    find: `    return FOLDED_READING_LEVELS.includes(level)
      ? EXAM_SECTION_LABELS["language-knowledge-reading"]
      : "Language Knowledge";`,
    id: "exam-scoring-label-level-blind",
    replace: '    return "Language Knowledge";',
    simulates:
      "the single label function goes level-blind again, which is how five divergent private maps ended up naming the N4/N5 folded column 'Vocabulary'. The id alone cannot decide the name: at N4/N5 the reading items score inside `language-knowledge`, so that column is the combined one",
    test: [
      "bun",
      "test",
      "apps/server/test/exam-section-labels.test.ts",
      "packages/chat-session/src/chat-engine.test.ts",
    ],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: `    const level =
      corpus.vocabByAnchor.get(anchorId)?.level ??`,
    id: "exam-anchor-resolved-from-registration-not-corpus",
    replace: `    const level =
      anchorLevels.get(anchorId) ??`,
    simulates:
      "the corpus view resolving an anchor from the ids the service registered for itself instead of from the shipped corpus, which is exactly the pre-TASK-138 state: every anchor the exam minted resolved, so doc-16 §2's anchor-missing and anchor-level checks could not fail and the anti-hallucination guarantee was vacuous. Caught by a test that hands the view the old digest shape (`vocab:N5:0f4a9c2d8b1e7365`) and requires null",
    test: ["bun", "test", "apps/server/test/exam-anchor-namespace.test.ts"],
  },
  {
    file: "apps/desktop/src/lib/composer-routing.ts",
    find: '  if (intent.tier === "exam" && !intent.confirmNeeded) {\n    return {\n      conversationId,\n      focus: intent.anchors,\n      kind: "paper",\n      level: paperLevel(intent.level),\n    };\n  }',
    id: "exam-composer-branch-reverted",
    // The whole branch, not its condition: `confirmNeeded` is false for every
    // explicit command, so weakening that half alone changes nothing and a
    // no-op seam proves nothing.
    replace: "",
    simulates:
      "TASK-147 AC#7's complaint comes back: an explicit /exam command falls through to the chat turn, so the learner gets a conversation about exams instead of a paper",
    test: ["bun", "test", "apps/desktop/test/composer-routing.test.ts"],
  },
  {
    file: "apps/server/src/ask-tool.ts",
    find: "    mode: z.enum(EXAM_MODES).optional(),\n  })\n  .strict();",
    id: "exam-host-tool-budget-admitted",
    replace: "    mode: z.enum(EXAM_MODES).optional(),\n  });",
    simulates:
      "the start_exam input stops refusing unknown keys, so an agent can send a per-section `budget` and doc-21 §9.2 (the model never sizes a section) is prose again",
    test: [
      "bun",
      "test",
      "apps/server/test/exam-host-tool.test.ts",
      "apps/server/test/ask-tool.test.ts",
    ],
  },
  {
    file: "apps/server/src/context.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is the SOURCE line, whose ${...} must stay literal text
    find: "      sizeStatement: `${String(built.totalSlots)} items, sized by the host from the ${built.level} default budget.`,",
    id: "exam-host-tool-size-not-stated",
    replace: '      sizeStatement: "",',
    simulates:
      "TASK-156's fix reverted at the data end: the projection stops carrying the size the host gave the paper, so the agent has no count to repeat and a learner who asked for ten hears nothing about the thirty they got",
    test: ["bun", "test", "apps/server/test/exam-host-tool.test.ts"],
  },
  {
    file: "apps/server/src/ask-tool.ts",
    find: "Say that the paper is ready, name its level and its sections, and repeat `sizeStatement` from the result so the learner hears the size the host gave it. If the learner named a number, your reply must carry both numbers before anything else: the count they asked for, the count this paper has (`sizeStatement` states it), and the reason: the size comes from the level, and a smaller paper is not something this tool can build.",
    id: "exam-host-tool-size-not-told",
    replace: "Say only that the paper is ready, with its level and sections.",
    simulates:
      "TASK-156's fix reverted at the instruction end: the agent is told to announce only that a paper exists, which is what made the level default a silent substitution for a size the learner named",
    test: ["bun", "test", "apps/server/test/exam-host-tool.test.ts"],
  },
  {
    file: "apps/server/src/ask-tool.ts",
    find: "`shortened` and `exam-conditions` carry the same number of items and move only the clock: `shortened` gives each section a shorter limit and `exam-conditions` the official section minutes.",
    id: "exam-host-tool-mode-sells-size",
    replace:
      '"shortened" is the quick paper and "exam-conditions" the full one.',
    simulates:
      'TASK-167\'s lie back on the wire: the listing sells `mode` as a size knob again, so Sensei answers "10 questions" with a shorter-paper promise and hands over the level default',
    test: ["bun", "test", "apps/server/test/exam-host-tool.test.ts"],
  },
  {
    file: "apps/server/src/ask-tool.ts",
    find: "          paper = await startExam(conversationId, {",
    id: "exam-host-tool-conversation-ignored",
    replace: "          paper = await startExam(`exam:fallback`, {",
    simulates:
      "the paper stops being bound to the conversation the endpoint's token named, so the card lands on an orphan transcript the learner never opens",
    test: [
      "bun",
      "test",
      "apps/server/test/exam-host-tool.test.ts",
      "apps/server/test/ask-tool.test.ts",
    ],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "    if (hub.terminal) {\n      resetHub(hub);\n    }\n    publishFrame(hub, frame);",
    id: "exam-paper-publish-on-settled-hub",
    replace: "    publishFrame(hub, frame);",
    simulates:
      "a paper written between turns is pushed onto a hub the last turn settled, which the live subscriber reads as 'close the stream', so the card exists only in the database",
    test: [
      "bun",
      "test",
      "apps/server/test/exam-host-tool.test.ts",
      "apps/server/test/exam-pipeline.test.ts",
    ],
  },
  {
    file: "apps/server/src/chat-store.ts",
    find: `const hasLearnerTurn = sql\`EXISTS (
  SELECT 1 FROM \${messages} AS learner_frame
  WHERE learner_frame.conversation_id = conversations.id
    AND learner_frame.frame_type = 'user_created'
)\`;`,
    id: "history-lists-conversations-without-a-learner",
    replace: "const hasLearnerTurn = sql`1 = 1`;",
    simulates:
      "chat history offering a conversation the learner never spoke in, which is how a paper built with no conversation shows up as a dead entry (TASK-150)",
    test: ["bun", "test", "apps/server/test/chat-history.test.ts"],
  },
  {
    file: "apps/desktop/src/features/exam/exam-paper-pane.tsx",
    find: "        {result.overall.correct}/{result.overall.total} correct",
    id: "exam-result-raw-only-caveat-duplicated",
    replace:
      '        {t("paper.result.rawOnly")}\n        {result.overall.correct}/{result.overall.total} correct',
    simulates:
      "the submitted raw-only card saying the same sentence twice, once under the heading and once above the counts (TASK-159)",
    test: ["bun", "test", "apps/desktop/test/exam-result-copy.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "        anchorLabels: anchorLabelsFor(entry.item.anchors, corpus),",
    id: "exam-debrief-sends-no-anchor-labels",
    replace: "        anchorLabels: [],",
    simulates:
      "the debrief builder forgetting its caller: `anchorLabelsFor` works and the paper the client receives still has nothing to show (TASK-160)",
    test: ["bun", "test", "apps/server/test/exam-pipeline.test.ts"],
  },
  {
    file: "apps/desktop/src/features/exam/exam-paper-pane.tsx",
    find: '    : t("exam.review.anchor", { anchor: item.anchorLabels.join(" · ") });',
    id: "exam-review-prints-the-corpus-anchor",
    replace:
      '    : t("exam.review.anchor", { anchor: item.anchors.join(" · ") });',
    simulates:
      'the review row going back to interpolating the join key, so a learner reads "Built from vocab:N5:05d1e396…" (TASK-160)',
    test: ["bun", "test", "apps/desktop/test/exam-review-anchor.test.ts"],
  },
  {
    file: "packages/ui/src/components/acp-tool-call-card.tsx",
    find: "          {debug ? <ToolCallIdLine toolCallId={live.toolCallId} /> : null}",
    id: "tool-call-id-visible-without-debug",
    replace: "          <ToolCallIdLine toolCallId={live.toolCallId} />",
    simulates:
      "the raw tool-call id printed in every learner's transcript instead of only behind the developer affordance (TASK-160)",
    test: ["bun", "test", "packages/ui/src/components/acp-cards.test.tsx"],
  },
  {
    file: "packages/ui/src/components/paper-card-states.tsx",
    find: '          {t("paper.debrief.weak", { anchors: labels.join(" · ") })}',
    id: "paper-card-prints-weak-anchor-ids",
    replace:
      '          {t("paper.debrief.weak", { anchors: (debrief?.weakAnchors ?? []).join(" · ") })}',
    simulates:
      'the chat paper card reverting to "Missed: vocab:N5:05d1e396…" - the join key a learner cannot read (TASK-160)',
    test: ["bun", "test", "packages/ui/test/paper-card.test.tsx"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "            weakAnchorLabels: uniqueStrings(\n              anchorLabelsFor(result.weakAnchors, corpus)\n            ),",
    id: "paper-frame-omits-weak-anchor-labels",
    replace: "            weakAnchorLabels: uniqueStrings(result.weakAnchors),",
    simulates:
      "the stored paper frame putting the join keys in place of names, so the chat card that reads the frame leaks ids even though the debrief endpoint is clean (TASK-160)",
    test: ["bun", "test", "apps/server/test/exam-pipeline.test.ts"],
  },
  {
    file: "apps/desktop/src/features/mock/review-queue.tsx",
    find: "  if (lastGraded.cardId !== currentCardId) {\n    return null;\n  }",
    id: "review-confirm-outranks-its-card",
    replace: "  if (false) {\n    return null;\n  }",
    simulates:
      'the confirmation strip ignoring which card it describes, so a grade on たべる keeps reading "✓ Good · たべる" over the next card 東 (TASK-161)',
    test: ["bun", "test", "apps/desktop/test/review-queue.test.tsx"],
  },
  {
    file: "apps/desktop/src/features/mock/review-queue.tsx",
    find: "          due: batch.dueCount,",
    id: "review-header-counts-the-page",
    replace: "          due: batch.cards.length,",
    simulates:
      'the header counting its own rows again, so a learner with 24 due on a 20-row page reads "20 cards due" from a response that says 24 (TASK-165)',
    test: ["bun", "test", "apps/desktop/test/review-queue.test.tsx"],
  },
  {
    file: "apps/desktop/src/features/mock/review-queue.tsx",
    find: "          total: deckCount,",
    id: "review-header-total-stands-in-for-the-deck",
    replace: "          total: batch.cards.length,",
    simulates:
      'the header interpolating one page length into both numbers, which is the exact "0 cards due · 0 total" the desk printed over a deck the learner owns (TASK-165)',
    test: ["bun", "test", "apps/desktop/test/review-queue.test.tsx"],
  },
  {
    file: "apps/desktop/src/features/mock/review-queue.tsx",
    find: '      {nextDue === null\n        ? t("review.empty.first_run")\n        : t("review.empty", { duration: nextReviewDuration(nextDue) })}',
    id: "review-empty-forgets-its-next-day",
    replace: '      {t("review.empty.first_run")}',
    simulates:
      "TASK-155's withholding kept after the response grew a `nextDue`, so an empty desk still refuses to say when the next review is, one day or a month out (TASK-165 AC#3)",
    test: ["bun", "test", "apps/desktop/test/review-queue.test.tsx"],
  },
  {
    file: "apps/desktop/src/features/drill/drill-lab.tsx",
    find: 'const DEFAULT_MODE: Mode = "pick";',
    id: "drill-first-run-lands-on-pick",
    replace: 'const DEFAULT_MODE: Mode = "draw";',
    simulates:
      "the first-run drill defaulting back to draw mode, where a learner with no stored preference sees the card and no answer surface at all (TASK-162)",
    test: ["bun", "test", "apps/desktop/test/drill-mode.test.ts"],
  },
  {
    file: "apps/desktop/src/features/drill/drill-lab.tsx",
    find: '  stored === "draw" || stored === "pick" || stored === "say"',
    id: "drill-stored-mode-outranks-the-default",
    replace: '  false === "draw" || stored === "pick" || stored === "say"',
    simulates:
      'the sticky preference being read but not honoured, so the learner who chose "draw" is thrown back to the default every reload (TASK-162)',
    test: ["bun", "test", "apps/desktop/test/drill-mode.test.ts"],
  },
  {
    file: "apps/desktop/src/features/drill/drill-lab.tsx",
    find: "{askCue ? pickCue(current) : current.char}",
    id: "drill-pick-prints-its-own-answer",
    replace: "{current.char}",
    simulates:
      "the card top back to the target glyph while a pick is still open, so the four choices are graded by shape-matching instead of recall (TASK-168)",
    test: [
      "bun",
      "test",
      "apps/desktop/test/drill-machine.test.tsx",
      "apps/desktop/test/drill-mode.test.ts",
    ],
  },
  // DELETED, not weakened: a second seam re-adding the same-entry-senses family
  // to the PICKER. It survived, and the reason is worth keeping. The mutation
  // restored a local variable, which the function no longer reads, so it was a
  // no-op - a seam that cannot change anything proves nothing. Making it real
  // would mean mutating the return so the family is genuinely offered, and then
  // the VALIDATOR refuses those items, so the stored paper stays clean and the
  // picker-level test cannot see the difference. That is the defence working,
  // not a gap: `exam-gloss-ambiguity-not-refused` above is the enforcement
  // point and it is caught. Reintroducing the family without also reverting the
  // validator cannot reach a learner, so there is no behaviour left to pin.
  {
    file: "packages/ui/src/lib/copy.ts",
    find: "      return pluralize(count, one, other);",
    id: "deck-plural-arms-not-swapped",
    replace: "      return pluralize(count, other, one);",
    simulates:
      'the plural arms swapped, so a one-item paper reads "1 items" and a two-item one reads "1 item" (TASK-163)',
    test: ["bun", "test", "packages/ui/test/copy-snapshot.test.ts"],
  },
  {
    file: "packages/ui/src/lib/copy.ts",
    find: '      "Building your paper. {n}/{total} {total, plural, one {item} other {items}} ready.",',
    id: "paper-build-line-agrees-with-its-count",
    replace: '      "Building your paper. {n}/{total} items ready.",',
    simulates:
      'the deck dropping its plural clause on the build line, which is the exact "1 items" the QA walk reported (TASK-163)',
    test: ["bun", "test", "packages/ui/test/copy-snapshot.test.ts"],
  },
  {
    file: "apps/desktop/src/lib/chat-title.ts",
    find: '): string => conversation?.title ?? t("chat.untitled");',
    id: "one-label-for-an-unnamed-chat",
    replace: '): string => conversation?.title ?? "New Chat";',
    simulates:
      "the chat header naming an untitled conversation on its own again, so the same chat reads one way in history and another once it is open (TASK-163)",
    test: ["bun", "test", "apps/desktop/test/chat-title.test.ts"],
  },
  {
    file: "apps/server/src/services/due-queue.ts",
    find: "      .where(lte(cards.due, today))\n      .orderBy(asc(cards.due))",
    id: "due-queue-serves-the-whole-table",
    replace: "      .orderBy(asc(cards.due))",
    simulates:
      "TASK-164 reopened: /cards/due without the day predicate, so the dashboard tile counts the oldest 20 cards and the desk hands back a card scheduled for next week",
    test: [
      "bun",
      "test",
      "apps/server/test/due-queue.test.ts",
      "apps/server/test/grade-loop.test.ts",
    ],
  },
  {
    file: "apps/server/src/services/due-queue.ts",
    find: "    dueCount: dueRows[0]?.n ?? 0,",
    id: "cards-due-count-reads-the-page",
    replace: "    dueCount: page.length,",
    simulates:
      "the queue size being counted off the 20-row page instead of the table, so a learner with 25 due is still told 20, which is the one number TASK-165 added the count for",
    test: ["bun", "test", "apps/server/test/due-queue.test.ts"],
  },
  {
    file: "apps/server/src/services/grading.ts",
    find: "  const states = nextStates(previous, desiredRetention, daysElapsed);",
    id: "grade-write-ignores-client-retention",
    replace: "  const states = nextStates(previous, 0.9, daysElapsed);",
    simulates:
      "TASK-166 reopened: the sidecar schedules at a hardcoded 0.9 whatever the request carries, so a learner at 70% gets the 90% queue while the button prints the 70% number",
    test: ["bun", "test", "apps/server/test/grade-loop.test.ts"],
  },
  {
    file: "apps/server/src/services/grading.ts",
    find: "  const daysElapsed = daysElapsedSince(card.due, now);",
    id: "grade-write-ignores-elapsed-time",
    replace: "  const daysElapsed = 0;",
    simulates:
      "the write grading every card as if it had been served on time, so an overdue card grows stability it never earned and the desk's preview and the stored due disagree (TASK-166 AC#2)",
    test: ["bun", "test", "apps/server/test/grade-loop.test.ts"],
  },
  {
    file: "packages/srs/src/index.ts",
    find: "  Math.max(MIN_SCHEDULE_DAYS, Math.floor(capInterval(interval)));",
    id: "schedule-days-can-drop-below-one",
    replace: "  Math.floor(capInterval(interval));",
    simulates:
      "the one-day floor gone, so `again` schedules today: the desk refetches the due queue and hands the learner the card they just failed, and the button prints 0d",
    test: [
      "bun",
      "test",
      "packages/srs/test/fsrs-golden.test.ts",
      "apps/server/test/grade-loop.test.ts",
    ],
  },
  {
    file: "apps/desktop/src/lib/review.ts",
    find: "  desiredRetention,\n  grade: gradeRequestName(grade),",
    id: "desk-drops-retention-from-the-request",
    replace: "  desiredRetention: 0.9,\n  grade: gradeRequestName(grade),",
    simulates:
      "the desk previewing at the learner's setting and sending 0.9, which is the exact half of TASK-166 AC#1 the schema cannot catch on its own",
    test: ["bun", "test", "apps/desktop/test/review.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "    seenAnchors: new Set(await store.listServedAnchorsForLevel(request.level)),",
    id: "exam-seen-anchors-not-loaded",
    replace: "    seenAnchors: new Set<string>(),",
    simulates:
      "TASK-148 reopened at the one place both families read: the catalog is built without the learner's served record, so `poolFor` and `grammarPoolFor` filter against an empty set and a retry re-serves the same anchors, while the level can never report itself exhausted",
    test: ["bun", "test", "apps/server/test/exam-no-repeat.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "const MAX_FILL_ATTEMPTS = 3;",
    id: "exam-fill-retry-disabled",
    replace: "const MAX_FILL_ATTEMPTS = 1;",
    simulates:
      "the widening retry gone: with no repeat fallback a rejected candidate leaves a hole, so the paper comes back 29/30, is never marked ready, and the learner is told the paper could not be built for a level that still has the content",
    test: ["bun", "test", "apps/server/test/exam-fill-retry.test.ts"],
  },
  {
    file: "apps/server/src/ask-tool.ts",
    find: ". Tell the learner the paper could not be built, including any reason the message states, and do not describe a paper you do not have.",
    id: "exam-host-tool-failure-drops-reason",
    replace: "; do not describe a paper you do not have.",
    simulates:
      "TASK-148's dry-level reason dropped at the harness: the throw distinguishes 'this level has no unseen content left' from 'something broke', but a fixed sentence over the wire makes the agent tell the learner to retry a level that has nothing left to give",
    test: ["bun", "test", "apps/server/test/exam-host-tool.test.ts"],
  },
  {
    file: "packages/chat-session/src/send-notice.tsx",
    find: '  success: "text-success",',
    id: "composer-notice-success-painted-as-error",
    replace: '  success: "text-destructive",',
    simulates:
      "the notice lane regressed to one colour: a ready paper's success sentence falls back to the error red, which is the exact bug the tone map removes",
    test: ["bun", "test", "packages/chat-session/src/send-notice.test.tsx"],
  },
  {
    file: "apps/desktop/src/features/exam/exam-question.tsx",
    find: '  prompt: mode === "real" ? entry.item.stem : entry.item.prompt,',
    id: "exam-real-question-falls-back-to-english-prompt",
    replace: "  prompt: entry.item.prompt,",
    simulates:
      "the real-mode view drops the stem-or-nothing rule and prints the English prompt again, which is the one line TASK-173.2 exists to keep off the paper (AC#2)",
    test: ["bun", "test", "apps/desktop/test/exam-real-mode-stems.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: STEM_LINE,
    id: "exam-real-stem-never-sourced-from-cue",
    replace: "    return null;",
    simulates:
      "the composer stops turning the corpus cue into the 小問 material line, so a real paper prints a heading and blank questions",
    test: ["bun", "test", "apps/server/test/exam-real-mode-stems.test.ts"],
  },
  {
    file: "packages/db/src/item-store.ts",
    find: "          stem: input.stem ?? null,",
    id: "exam-stem-dropped-on-write",
    replace: "          stem: null,",
    simulates:
      "the insert forgets the column, so the line the paper prints is composed, discarded, and never read back",
    test: ["bun", "test", "apps/server/test/exam-real-mode-stems.test.ts"],
  },
  {
    file: "packages/db/src/item-store.ts",
    find: "  stem: item.stem,",
    id: "exam-stem-dropped-on-read",
    replace: "  stem: null,",
    simulates:
      "the client projection drops the stored stem, so a paper assembled from real material reaches the desktop without its Japanese line",
    test: ["bun", "test", "apps/server/test/exam-real-mode-stems.test.ts"],
  },
  {
    file: "packages/item-engine/src/paper.ts",
    find: "}): string | null => PAPER_BLOCK_INSTRUCTIONS[block]?.[level] ?? null;",
    id: "paper-block-instruction-never-resolves",
    replace: "}): string | null => null;",
    simulates:
      "the 大問 instruction table stops being read, so every real paper prints a heading with no sentence naming what its 小問 ask (AC#1)",
    test: ["bun", "test", "packages/item-engine/test/paper.test.ts"],
  },
  {
    file: "packages/api-contract/src/exam.ts",
    find: '  mode === "real" ? EXAM_SECTION_LABELS_JA[id] : EXAM_SECTION_LABELS[id];',
    id: "exam-real-section-name-not-japanese",
    replace:
      '  mode === "shortened" ? EXAM_SECTION_LABELS_JA[id] : EXAM_SECTION_LABELS[id];',
    simulates:
      "the section-name chooser stops keying on `real`, so a real paper's nav chip, section heading and chat card print the English 科目 again while the pane claims to be the official paper (TASK-173.3 AC#1/#4). Inverting the tested mode also flips the practice paper to Japanese, so the AC#2 guard fails alongside it",
    test: [
      "bun",
      "test",
      "apps/server/test/exam-section-labels.test.ts",
      "apps/desktop/test/exam-workspace.test.ts",
    ],
  },
  {
    file: "packages/api-contract/src/exam.ts",
    find: '  if (mode !== "real") {\n    return examScoringSectionLabel({ id, level });\n  }',
    id: "exam-real-scoring-name-not-japanese",
    replace:
      '  if (mode === "real") {\n    return examScoringSectionLabel({ id, level });\n  }',
    simulates:
      "the scoring chooser sends a real paper to the English table and a practice paper to the Japanese one, so the result pane names a scored column in the wrong language (TASK-173.3 AC#1). The fold and the pane read this same function, so the chat column and the result card cannot disagree",
    test: ["bun", "test", "apps/server/test/exam-section-labels.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "      label: examSectionLabelForMode({ id: section.id, mode: receipt.mode }),",
    id: "exam-frame-section-label-ignores-mode",
    replace:
      '      label: examSectionLabelForMode({ id: section.id, mode: "shortened" }),',
    simulates:
      "the emitted paper frame hardcodes a mode instead of reading the receipt's, so the chat paper card names every section in English on a real paper even though the pane beside it is Japanese (TASK-173.3 AC#4, the two-names-one-fact shape TASK-137 was about)",
    test: ["bun", "test", "apps/server/test/exam-paper-frame-labels.test.ts"],
  },
  {
    file: "packages/chat-session/src/chat-engine/folds/paper.ts",
    find: "    result: projectResult(data.level, data.result, data.mode),",
    id: "exam-fold-result-label-ignores-mode",
    replace: '    result: projectResult(data.level, data.result, "shortened"),',
    simulates:
      "the fold re-derives the result-column names at a fixed mode, so a real paper's scored columns come back in English in the chat column while the server frame that fed them used 科目 names (TASK-173.3 AC#1)",
    test: [
      "bun",
      "test",
      "packages/chat-session/src/chat-engine/paper.test.ts",
    ],
  },
  {
    file: "apps/desktop/src/lib/paper-notice.ts",
    find: "        missing: missingBlockList(receipt.unfilledBlocks, receipt.mode),",
    id: "exam-notice-missing-block-ignores-mode",
    replace:
      '        missing: missingBlockList(receipt.unfilledBlocks, "shortened"),',
    simulates:
      "the short-paper notice names the missing 大問 in English regardless of mode, so a real paper that came up short tells the learner which parts are missing in a language the rest of the paper does not use (TASK-173.3 AC#4)",
    test: ["bun", "test", "apps/desktop/test/paper-notice.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-mask.ts",
    find: '  if (!after || after.includes(word)) {\n    return unmaskable("unverified-after-masking", word);\n  }',
    id: "cloze-mask-skips-reverification",
    replace: "",
    simulates:
      "maskWord claims a verified cloze blank without re-tokenizing the masked sentence (TASK-173.5 AC#4), so a blank that did not take - the word survives re-segmentation - ships to the learner with the answer still visible in the line",
    test: ["bun", "test", "apps/server/test/exam-cloze.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-mask.ts",
    find: '  if (sentence.split(span).length - 1 !== 1) {\n    return unmaskable("unverified-after-masking", span);\n  }',
    id: "star-mask-unverified-claim",
    replace: "",
    simulates:
      "maskFragmentSpan blanks the fragment region without checking it occurs exactly once (TASK-173.6), so a region whose surface also lives inside the printed context ships verified while that fragment is still readable elsewhere in the line, which is the leak the star format exists to close",
    test: ["bun", "test", "apps/server/test/exam-mask.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  if (head.join("") + fragments.join("") + suffix !== sentence) {',
    id: "star-reconstruction-not-gated",
    replace: "  if (false) {",
    simulates:
      "starSourceForExample ships a 文の組み立て split without the byte-for-byte reconstruction gate (TASK-173.6 AC#2), so a tokenizer that dropped or rewrote a character yields fragments that never rebuild the example, and the learner reassembles a sentence that was not the one the corpus holds",
    test: ["bun", "test", "apps/server/test/exam-star-ordering.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "  return record !== undefined && satisfiesStar(record, option, corpus);",
    id: "star-ambiguity-not-refused",
    replace: "  return false;",
    simulates:
      "starOptionSatisfies answers false for every non-answer star fragment, so it never reports a second offered fragment that fills the ★ slot with an attested, legal reassembly (TASK-173.6 AC#4), and an ambiguous 文の組み立て item passes validation and reaches a learner with two defensible answers",
    test: ["bun", "test", "apps/server/test/exam-star-ordering.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '    } else if (family === "star" && allocation[itemType] > 0) {',
    id: "star-demand-excluded-from-grammar-pool",
    replace: "      } else if (false) {",
    simulates:
      "paperGrammarDemand sizes the shared grammar pool for the grammar, cloze and nonzero-star branches but its star branch never fires, so a real-mode 文の組み立て block draws its example sentences from a pool never sized for those anchors and a repeated paper holes the block (TASK-173.6)",
    test: ["bun", "test", "apps/server/test/exam-star-ordering.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "    if (tokenCount === 0 || tokenCount !== substringCount) {",
    id: "cloze-blank-ignores-occurrence-count",
    replace: "    if (tokenCount === 0) {",
    simulates:
      "clozeSourceFor blanks a word that also lives inside a longer token, because it only checks the word appears as a token and drops the token-vs-substring count equality (TASK-173.5), so replaceAll cuts a second word in half and leaks the answer as its remnant",
    test: ["bun", "test", "apps/server/test/exam-cloze.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '      family === "grammar" ||\n      (family === "cloze" && !KITEI_STORE_LEVELS.has(request.level));',
    id: "cloze-demand-excluded-from-grammar-pool",
    replace: '        family === "grammar";',
    simulates:
      "paperGrammarDemand sizes the shared grammar pool for the grammar family only and drops the JOIN-side cloze family (TASK-173.5, the demand N4/N5 still pay after TASK-173.9.29 moved N3/N2/N1 文脈規定 to the store), so a derived 文脈規定 block draws its example sentences from a pool never sized for those anchors and a repeated N4 paper holes the block",
    test: ["bun", "test", "apps/server/test/exam-cloze.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "storeFor: shortReadingStoreFor,",
    id: "short-reading-store-read-wrong-level",
    replace: 'storeFor: () => shortReadingStoreFor("N5"),',
    simulates:
      "shortReadingSourceFor reads the N5 store no matter the level (TASK-173.7), so a real N4 paper, whose 短文 were never licensed, silently fills 大問4 with N5 reading text across the level boundary instead of refusing, which is the ship-N5-refuse-N4 decision undone",
    test: ["bun", "test", "apps/server/test/exam-short-reading.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "spent: (catalog) => catalog.usedShortReadingPassages,",
    id: "short-reading-passage-not-spent",
    replace: "spent: () => new Set<string>(),",
    simulates:
      "shortReadingSourceFor stops honoring the per-paper passage spend (TASK-173.7), so one 短文 reading text backs two 小問 of the same 大問 and a repeated draw never runs dry, which the block's one-passage-per-小問 shape forbids",
    test: ["bun", "test", "apps/server/test/exam-short-reading.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "medium-reading",\n  "short-reading",\n]);',
    id: "short-reading-falls-back-to-canned-passage",
    replace: '  "medium-reading",\n]);',
    simulates:
      "`PRINTED_WHOLE_TYPES` takes 短文 away (TASK-173.7 AC#3), so candidatePresentationFor stops handing a 短文 its own sourced passage: the item fails `validateStimuli`'s minPassages and a real 内容理解（短文） never prints the reading the learner answers from",
    test: ["bun", "test", "apps/server/test/exam-short-reading.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '      (entry.source.provenance === "composed" && !entry.source.validated));',
    id: "composed-reading-serves-in-real",
    replace: "      false);",
    simulates:
      "the composed-短文 branch of isRefused is dropped (TASK-173.9.5 AC#1), so a real paper hands the learner an AI-authored reading question whose key no judge has falsified, laundering a composed item as an official one",
    test: ["bun", "test", "apps/server/test/exam-composed-reading.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '      (entry.source.provenance === "composed" && !entry.source.validated));',
    id: "composed-reading-forgives-unvalidated",
    replace: '      entry.source.provenance === "composed");',
    simulates:
      "the `!validated` term is dropped, so `real` serves an UNvalidated composed 短文 as readily as a falsified one (TASK-173.9.5 AC#2): the judge agent's sign-off stops gating the real paper and every authored key is trusted on sight",
    test: ["bun", "test", "apps/server/test/exam-composed-reading.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-reading-n4.ts",
    find: '    issues.push("answer-not-named-by-translation");',
    id: "reading-masked-unglossed-answer-allowed",
    replace: "    void 0;",
    simulates:
      "the answer-is-named-by-translation screen is dropped, so a key no word of the source English points at ships again - the item then measures whether the reader guesses the word, not whether they read the sentence",
    test: ["bun", "test", "packages/japanese/test/check-reading-n4.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-reading-n4.ts",
    find: '      issues.push("distractor-collides-with-answer");',
    id: "reading-masked-synonym-distractor-allowed",
    replace: "        void 0;",
    simulates:
      "the dominant-sense collision screen is dropped, so a distractor that is another English label for the answer (警察 / 警官) ships and the row carries two defensibly-correct options - the mechanically detectable form of TASK-173.9.5",
    test: ["bun", "test", "packages/japanese/test/check-reading-n4.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-reading-n4.ts",
    find: "  if (restorePassage(entry.passage, answer) !== source.jp) {",
    id: "reading-masked-restore-not-proven",
    replace: "  if (false) {",
    simulates:
      "the masked-slot restore check (TASK-173.9.6) stops proving that putting the answer option back reproduces the source sentence, so an edited passage - or a hand-picked key that the source never contained - freezes as a machine-checked row",
    test: ["bun", "test", "packages/japanese/test/check-reading-n4.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-reading-n4.ts",
    find: '    if (source.jp.includes(option)) {\n      issues.push("distractor-occurs-in-source");',
    id: "reading-masked-distractor-in-source-allowed",
    replace:
      '    if (false) {\n      issues.push("distractor-occurs-in-source");',
    simulates:
      'a distractor that already occurs in the source sentence is admitted (TASK-173.9.6), so the learner can read the "wrong" option straight off the passage and the row ships with two defensible answers',
    test: ["bun", "test", "packages/japanese/test/check-reading-n4.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-reading-n4.ts",
    find: "    if (signer !== GENERATOR_SIGNER) {",
    id: "reading-masked-any-signer-accepted",
    replace: "    if (signer.length === 0) {",
    simulates:
      "a generated row may be signed by anything (TASK-173.9.6), so a hand-edited option re-signed with a plausible judge id passes as machine-checked even though no pipeline produced it",
    test: ["bun", "test", "packages/japanese/test/check-reading-n4.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-reading-n4.ts",
    find: '        issues.push("distractor-corpus-plausible");',
    id: "reading-masked-corpus-plausible-distractor-allowed",
    replace: "        void 0;",
    simulates:
      "the corpus-context screen is dropped (TASK-173.9.6 limitation #1), so a distractor another in-level sentence fills the same context frame with ships - the corpus itself demonstrates the blank accepting it",
    test: ["bun", "test", "packages/japanese/test/check-reading-n4.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-reading-n4.ts",
    find: '    issues.push("row-judge-rejected");',
    id: "reading-masked-judge-rejection-ignored",
    replace: "    void 0;",
    simulates:
      "the freeze-time judge record is ignored, so a row the independent blind judge marked AMBIGUOUS/UNANSWERABLE (13 of the first 24) can sit in the frozen store and reach a paper the judge already failed",
    test: ["bun", "test", "packages/japanese/test/check-reading-n4.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-reading-n4.ts",
    find: '    issues.push("answer-context-ambiguous");',
    id: "reading-masked-bare-frame-allowed",
    replace: "    void 0;",
    simulates:
      "the solvability screen is dropped, so a bare frame like ＿＿はかわりますが。 ships again - under-determined in the Japanese the learner actually sees, since the server never serves sourceEn",
    test: ["bun", "test", "packages/japanese/test/check-reading-n4.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "storeFor: mediumReadingStoreFor,",
    id: "medium-reading-store-read-wrong-level",
    replace: 'storeFor: () => mediumReadingStoreFor("N2"),',
    simulates:
      "mediumReadingSourceFor reads the N2 store no matter the level (TASK-173.9.2), so a 中文 小問 asked for at N5, N4, N3 or N1 prints N2's 白書 passage while echoing the requested level back in `level`: the licensed N5 中長文 rows and the composed N4 stitch go unserved. Since TASK-173.9.15 every level N5-N1 ships a 中文 store, so no level is empty to refuse, and only ROW IDENTITY (the anchor must live in the store of the level asked for) tells the two apart",
    test: ["bun", "test", "apps/server/test/exam-medium-reading.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "spent: (catalog) => catalog.usedMediumReadingPassages,",
    id: "medium-reading-passage-not-spent",
    replace: "spent: () => new Set<string>(),",
    simulates:
      "mediumReadingSourceFor stops honoring the per-paper passage spend (TASK-173.9.2), so one 中文 passage backs two 小問 of the same 大問 and a repeated draw never runs dry",
    test: ["bun", "test", "apps/server/test/exam-medium-reading.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "claim-understanding",\n  "medium-reading",',
    id: "medium-reading-falls-back-to-canned-passage",
    replace: '  "claim-understanding",',
    simulates:
      "`PRINTED_WHOLE_TYPES` takes 中文 away (TASK-173.9.2 AC#3), so candidatePresentationFor stops handing a 中文 its own sourced passage: the item fails `validateStimuli`'s minPassages and a real 内容理解（中文） never prints the reading the learner answers from",
    test: ["bun", "test", "apps/server/test/exam-medium-reading.test.ts"],
  },
  {
    file: "packages/item-engine/src/paper.ts",
    find: '    itemTypes: ["medium-reading"],',
    id: "medium-reading-block-not-wired",
    replace: "    itemTypes: [],",
    simulates:
      "the 内容理解（中文） 大問 stops declaring medium-reading (TASK-173.9.2), so the real block walk never asks for a 中文 item and the block is reported unfilled instead of served",
    test: ["bun", "test", "apps/server/test/exam-medium-reading.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "storeFor: jouhouStoreFor,",
    id: "info-search-store-read-wrong-level",
    replace: 'storeFor: () => jouhouStoreFor("N5"),',
    simulates:
      "infoSearchSourceFor reads the N5 notice store no matter the level (TASK-173.9.7), so an N2 or N1 小問 prints an N5-band fee table across the level boundary and carries an anchor stamped N5 into a paper the learner asked for at its own level, while the composed 情報素材 stores go unserved",
    test: ["bun", "test", "apps/server/test/exam-info-search.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "spent: (catalog) => catalog.usedJouhouPassages,",
    id: "info-search-passage-not-spent",
    replace: "spent: () => new Set<string>(),",
    simulates:
      "infoSearchSourceFor stops honoring the per-paper notice spend (TASK-173.9.7), so one 案内 document backs two 小問 of the same 大問: upstream asks two questions per notice, and the block's one-notice-per-小問 shape forbids printing it twice",
    test: ["bun", "test", "apps/server/test/exam-info-search.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "info-search",\n  // TASK-173.9.28',
    id: "info-search-falls-back-to-canned-passage",
    replace: "  // TASK-173.9.28",
    simulates:
      "candidatePresentationFor hands a 情報検索 or 用法 item the hardcoded 長文 essay instead of the store text it was sourced from (TASK-173.9.7 AC#3 / TASK-173.9.23 AC#3), so a real 情報検索 小問 asks a price out of a document the learner is never shown, and a real 用法 小問 asks a form out of a sentence the learner is never shown",
    test: [
      "bun",
      "test",
      "apps/server/test/exam-info-search.test.ts",
      "apps/server/test/exam-youhou.test.ts",
    ],
  },
  {
    file: "packages/item-engine/src/paper.ts",
    find: '  "jouhou-kensaku": { itemTypes: ["info-search"], name: "情報検索" },',
    id: "info-search-block-not-wired",
    replace: '  "jouhou-kensaku": { itemTypes: [], name: "情報検索" },',
    simulates:
      "the 情報検索 大問 stops declaring info-search (TASK-173.9.7), so the real block walk never asks for a notice item, the licensed store goes unserved and the 大問 reads like a hole again",
    test: ["bun", "test", "apps/server/test/exam-info-search.test.ts"],
  },
  {
    // The wiring between the store and the HOLE decision. Every level has a
    // 情報検索 store since TASK-173.9.13, so an entry that answers "nothing here"
    // re-opens five closed holes at once, and only the receipt test notices.
    file: "apps/server/src/services/exam-service.ts",
    find: '  "info-search": jouhouStoreFor,',
    id: "info-search-store-not-consulted-for-holes",
    replace: '  "info-search": () => [],',
    simulates:
      "READING_STORE_FOR stops asking the 情報検索 store whether this level has a 素材 (TASK-173.9.13), so N5 大問6 through N1 大問13 are named as parts of the paper nothing can ask while the picker keeps printing them from the shipped files",
    test: ["bun", "test", "apps/server/test/exam-reading-holes.test.ts"],
  },
  {
    // The authored 素材 band is per level and fail-closed. N4 joined this table in
    // TASK-173.9.19, and a level that is NOT in it must be refused rather than
    // measured against whichever window happens to be first.
    file: "packages/japanese/scripts/reading-jouhou-corpus.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is the SOURCE line, whose ${...} must stay literal text
    find: "  const band = JOUHOU_AUTHORED_BAND[level];\n  if (band === undefined) {\n    return [`authored-band-unknown:${level}`];\n  }",
    id: "jouhou-authored-band-falls-back",
    replace:
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is the SOURCE line, whose ${...} must stay literal text
      "  const band = JOUHOU_AUTHORED_BAND[level] ?? JOUHOU_AUTHORED_BAND.N3;\n  if (false) {\n    return [`authored-band-unknown:${level}`];\n  }",
    simulates:
      "a level with no authored 情報検索 band silently borrows another level's 素材 length instead of being refused (TASK-173.9.19), so an N4 400字程度 page would be graded against N3's 600字 window, and a fifth level could be frozen with no band declared at all",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-jouhou.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-jouhou.ts",
    find: "  const minItems = MIN_ITEMS_BY_LEVEL[level] ?? 4;",
    id: "jouhou-depth-not-per-level",
    replace: "  const minItems = 4;",
    simulates:
      "every 情報検索 store is held to one flat minimum instead of its level's declared depth, so the 8-row authored N4 and N3 stores (four 素材 pairs, TASK-173.9.18/.19) drop to one paper's worth of 2 小問, and a level added to the table with no depth of its own is accepted at the default",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-jouhou.test.ts",
    ],
  },
  {
    // The shared authored screens are what four converted stores now run through
    // (短文, 中文, 長文 and the N4/N3 情報検索 route all read this module).
    file: "packages/japanese/scripts/reading-authored-corpus.ts",
    find: '  const band = config.bandFor(level);\n  if (band === undefined) {\n    return ["authored-band-unknown"];\n  }',
    id: "authored-band-not-fail-closed",
    replace:
      '  const band = config.bandFor(level) ?? { max: 100000, min: 0 };\n  if (false) {\n    return ["authored-band-unknown"];\n  }',
    simulates:
      "an authored row at a level the caller's band table does not name is measured against NO band instead of refused, so a 大問 can be opened at a fifth level with no length decided for it and the store freezes as though the screen had run",
    test: [
      "bun",
      "test",
      "packages/japanese/test/reading-authored-corpus.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/reading-authored-corpus.ts",
    find: '  return hasAuthored &&\n    entries.some((entry) => !isAuthoredConstruction(entry.construction))\n    ? "mixed-constructions"\n    : null;',
    id: "mixed-constructions-accepted",
    replace: "  return null;",
    simulates:
      "one store file carrying both a written row and a corpus row stops being refused, which is the hole the TASK-173.9.18/.19 conversions are about: a drained masked-slot store refilled with authored rows would keep its old rows as legitimate content, and the easier proof of the two would cover the file",
    test: [
      "bun",
      "test",
      "packages/japanese/test/reading-authored-corpus.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/reading-chuubun-corpus.ts",
    find: "  if (restorePassage(entry.passage, answer) !== sourceText) {",
    id: "chuubun-restore-not-proven",
    replace: "  if (false) {",
    simulates:
      "the 中文 restore check stops proving that putting the answer option back reproduces the source paragraph, so an edited passage or a hand-picked key freezes as a machine-checked row",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuubun.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/reading-chuubun-corpus.ts",
    find: "    if (sourceText.includes(option)) {",
    id: "chuubun-distractor-in-source-allowed",
    replace: "    if (false) {",
    simulates:
      "a 中文 distractor that already occurs in the source paragraph is admitted, so the learner can read the wrong option straight off the passage",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuubun.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-shared.ts",
    find: '  if (isAuthoredConstruction(entry.construction)) {\n    // The written row is signed by the judge record, not by the deterministic\n    // generator: nothing generated it, so claiming the generator\'s stamp would\n    // point the proof at a pipeline that never ran.\n    if (entry.validatedBy !== AUTHORED_SIGNER) {\n      issues.push("validatedBy-not-authored-signer");\n    }\n  } else if (entry.validatedBy !== blockSigner) {\n    issues.push("validatedBy-missing-or-bad-form");\n  }',
    id: "chuubun-any-signer-accepted",
    replace:
      '  if (false) {\n    // The written row is signed by the judge record, not by the deterministic\n    // generator: nothing generated it, so claiming the generator\'s stamp would\n    // point the proof at a pipeline that never ran.\n    if (entry.validatedBy !== AUTHORED_SIGNER) {\n      issues.push("validatedBy-not-authored-signer");\n    }\n  } else if (false) {\n    issues.push("validatedBy-missing-or-bad-form");\n  }',
    simulates:
      "the shared cert screen stops checking the signer in EITHER branch: the anchor spans the authored guard (AUTHORED_SIGNER) and the generator guard (blockSigner, CHUUBUN_SIGNER for this store), because mutating only one leaves the other still refusing, which proves nothing. A hand-edited 中文 option re-signed with a plausible judge id would then pass as machine-checked even though no pipeline and no judge record produced it",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuubun.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-shared.ts",
    find: "  if (entry.validated !== true) {",
    id: "chuubun-unvalidated-allowed",
    replace: "  if (false) {",
    simulates:
      "a 中文 row that lost its validated flag passes the gate, so an unjudged composed row reaches the real-mode refusal path disguised as a validated one",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuubun.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/reading-chuubun-corpus.ts",
    find: "  if (context.rejections.has(entry.id)) {",
    id: "chuubun-judge-rejection-ignored",
    replace: "  if (false) {",
    simulates:
      "the freeze-time judge record is ignored, so a 中文 row the blind judge marked AMBIGUOUS/UNANSWERABLE sits in the frozen store and reaches a paper the judge already failed",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuubun.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/reading-chuubun-corpus.ts",
    find: "    !isFrameSolvable(sourceSentences, slot, context.index, context.fillers)",
    id: "chuubun-frame-screen-dropped",
    replace: "    false",
    simulates:
      "the 中文 solvability screen is dropped, so a passage whose collocation frame the corpus licenses another noun in ships as a decidable item",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuubun.test.ts",
    ],
  },
  {
    // The stitched construction (TASK-173.9.15 AC#3): the four claims that only
    // exist because N4 composes its 中文 from sentences rather than from the
    // 白書. Each is a screen the masked-slot path never runs, so each needs its
    // own mutation or the N4 store ships on the strength of the N2 proof. The
    // coverage screen itself now lives in the shared masked-slot contract, where
    // each gate passes its own floor; mutating it there fails every composed
    // cloze gate, the N4 stitched store included.
    file: "packages/japanese/scripts/reading-chuubun-corpus.ts",
    find: "  if (coverageOf(sourceText, context.index, context.maxRank) < coverageFloor) {",
    id: "chuubun-coverage-floor-dropped",
    replace: "  if (false) {",
    simulates:
      "the 中文 coverage floor stops being measured, so a stitched N4 document whose prose is mostly off the vocabulary list freezes as a readable passage: COVERAGE_FLOOR.N4 = 0.8 is the only screen that says the 大問5 text is N4-readable (TASK-173.9.15 AC#3)",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuubun.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-chuubun.ts",
    find: "        stitchedTopicOf(sourceText, index, maxRank) === null",
    id: "chuubun-stitched-topic-ignored",
    replace: "        false",
    simulates:
      "the stitch's coherence claim becomes a comment: a document whose cited sentences share no noun ships as a 中文 passage, so 大問5 prints a list of unrelated statements instead of one text",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuubun.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-chuubun.ts",
    find: 'const constructionForLevel = (level: string): ChuubunConstruction => {\n  const source = CHUUBUN_SOURCE[level];\n  if (source === "sentences") {\n    return "stitched-in-level";\n  }\n  return source === "authored" ? "authored" : "masked-slot";\n};',
    id: "chuubun-construction-not-from-level-corpus",
    replace:
      'const constructionForLevel = (_level: string): ChuubunConstruction => {\n  return "masked-slot";\n};',
    simulates:
      "the level's corpus stops deciding which construction backs a row: every level claims `masked-slot`, so an N4 store of 白書-style rows, an N2 store of stitches and an N3 store of written rows each escape the proof their own corpus owes. The anchor replaces the whole dispatch rather than one arm, because the property is that NO level may choose its own easier proof",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuubun.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-chuubun.ts",
    find: "      const band = PASSAGE_BAND[construction];",
    id: "chuubun-passage-band-not-per-construction",
    replace: '      const band = PASSAGE_BAND["masked-slot"];',
    simulates:
      "the passage band stops coming from the row's construction, so a 400-rune stitched 中文 is judged against the 白書 floor of 200 and a half-document passes as a 大問5 passage",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuubun.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-chuushou.ts",
    find: '    issues.push("claim-not-in-source");',
    id: "chuushou-claim-not-in-source-allowed",
    replace: "    void 0;",
    simulates:
      "the authored-key anchor is dropped, so a key the source paragraph never prints freezes as a machine-checked row and the item's only verifiable tie to its passage is gone (TASK-173.9.2 slice 2)",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuushou.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-chuushou.ts",
    find: '      issues.push("distractor-occurs-in-source");',
    id: "chuushou-distractor-in-source-allowed",
    replace: "      void 0;",
    simulates:
      "a 主張理解 distractor that already occurs in the source paragraph is admitted, so the learner can read a second defensible answer straight off the passage and the row ships two right options",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuushou.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-chuushou.ts",
    find: '    issues.push("passage-not-byte-equal-to-source");',
    id: "chuushou-passage-not-byte-equal-allowed",
    replace: "    void 0;",
    simulates:
      "the byte-equality screen is dropped, so an edited passage - longer, shorter, or a different paragraph entirely - freezes as sourced from the 白書 row it no longer matches",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuushou.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-shared.ts",
    find: '  if (isAuthoredConstruction(entry.construction)) {\n    // The written row is signed by the judge record, not by the deterministic\n    // generator: nothing generated it, so claiming the generator\'s stamp would\n    // point the proof at a pipeline that never ran.\n    if (entry.validatedBy !== AUTHORED_SIGNER) {\n      issues.push("validatedBy-not-authored-signer");\n    }\n  } else if (entry.validatedBy !== blockSigner) {\n    issues.push("validatedBy-missing-or-bad-form");\n  }',
    id: "chuushou-any-signer-accepted",
    replace:
      '  if (false) {\n    // The written row is signed by the judge record, not by the deterministic\n    // generator: nothing generated it, so claiming the generator\'s stamp would\n    // point the proof at a pipeline that never ran.\n    if (entry.validatedBy !== AUTHORED_SIGNER) {\n      issues.push("validatedBy-not-authored-signer");\n    }\n  } else if (false) {\n    issues.push("validatedBy-missing-or-bad-form");\n  }',
    simulates:
      "the shared cert screen stops checking the signer in EITHER branch: the anchor spans the authored guard (AUTHORED_SIGNER) and the generator guard (blockSigner, CHUSHOU_SIGNER for this store), because mutating only one leaves the other still refusing, which proves nothing. A hand-edited 主張理解 claim re-signed with a plausible judge id would then pass as machine-checked even though no pipeline and no judge record produced it",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuushou.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-shared.ts",
    find: "  if (entry.validated !== true) {",
    id: "chuushou-unvalidated-allowed",
    replace: "  if (false) {",
    simulates:
      "a 主張理解 row that lost its validated flag passes the gate, so an unjudged composed row reaches the real-mode refusal path disguised as a validated one",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuushou.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-chuushou.ts",
    find: "  if (rejections.has(entry.id)) {",
    id: "chuushou-judge-rejection-ignored",
    replace: "  if (false) {",
    simulates:
      "the freeze-time judge record is ignored, so a 主張理解 row the blind judge marked AMBIGUOUS/UNANSWERABLE sits in the frozen store and reaches a paper the judge already failed",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuushou.test.ts",
    ],
  },
  // The routes TASK-173.9.20 opened at N2. 中文 and 短文 already had their own
  // seams from the N3/N4 conversions; 主張理解 and 統合理解 are the two blocks that
  // shipped no authored code before N2, so every screen below is new, and each seam
  // names the ONE property of the new contract it breaks.
  {
    file: "packages/japanese/scripts/reading-chuushou-corpus.ts",
    find: '  CHUSHOU_SOURCE[level] === "authored" ? "authored" : "authored-key";',
    id: "chuushou-level-route-claims-authored-always",
    replace: '  "authored";',
    simulates:
      "the level's route stops deciding which proof a 主張理解 row owes: every level claims the authored screens, so N1's one-paragraph 白書 window is measured against the written-argument contract it cannot meet and the mismatch the router exists to refuse (a written row filed at a level whose route is the 白書, and its mirror) goes uncaught at both levels (TASK-173.9.20 AC#2)",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuushou.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/reading-chuushou-corpus.ts",
    find: "export const CHUSHOU_AUTHORED_MIN_PARAGRAPHS = 4;",
    id: "chuushou-paragraph-floor-dropped",
    replace: "export const CHUSHOU_AUTHORED_MIN_PARAGRAPHS = 1;",
    simulates:
      "the floor that separates a written argument from a single paragraph is lowered to one, so a 主張理解 row whose passage states a position without reasons or an answered objection freezes as a 長文 argument. This is the exact defect the conversion removed: every shipped N2 row before TASK-173.9.20 printed ONE paragraph under a 大問 that reads a whole 長文",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuushou.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/reading-chuushou-corpus.ts",
    find: "export const CHUSHOU_MIN_REASON_CLASSES = CHUSHOU_DISTRACTOR_REASONS.length;",
    id: "chuushou-distractor-reason-spread-dropped",
    replace: "export const CHUSHOU_MIN_REASON_CLASSES = 1;",
    simulates:
      "the distractor contract stops being a contract: one reason class satisfies the store, so a 主張理解 大問 can ship three copies of the same failure mode (a store that names one way of being wrong three times) and the field 主張 distractors are only decoration (TASK-173.9.20 AC#2)",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-chuushou.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/reading-tougou-corpus.ts",
    find: '  TOUGOU_SOURCE[level] === "authored" ? "authored" : TOUGOU_CONSTRUCTION;',
    id: "tougou-level-route-claims-authored-always",
    replace: '  "authored";',
    simulates:
      "the level's route stops deciding which proof a 統合理解 pair owes: every level claims the authored screens, so N1's shared-topic pairs are measured against the written-pair contract and a lookup pair smuggled into N2's authored store (or its mirror) escapes the refusal the router is the only place that issues",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-tougou.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/reading-tougou-corpus.ts",
    find: `  for (const [at, text] of passages.entries()) {\n    if (text.includes(answer)) {\n      issues.push(\`authored-key-printed-in-document:${DOLLAR}{at}\`);\n    }\n  }`,
    id: "tougou-authored-key-printed-in-one-document-allowed",
    replace: `  for (const [at, text] of passages.entries()) {\n    if (text.includes(answer) && passages.every((each) => each.includes(answer))) {\n      issues.push(\`authored-key-printed-in-document:${DOLLAR}{at}\`);\n    }\n  }`,
    simulates:
      "the authored key screen collapses into the refuted lookup's own contract (key printed by BOTH): a 統合理解 key that one document plainly states rather than a relation the reader lifts from the pair freezes as an inference item. The authored branch exists precisely because its key must be printed by NEITHER document (TASK-173.9.20 AC#3, doc-27 §10)",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-tougou.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/reading-tougou-corpus.ts",
    find: '    if (printedBy.length === 2) {\n      issues.push("distractor-in-both-documents");\n    }\n    if (printedBy.length === 0) {\n      issues.push("distractor-in-neither-document");\n    }',
    id: "tougou-authored-distractor-exactly-one-dropped",
    replace:
      '    if (printedBy.length === 99) {\n      issues.push("distractor-in-both-documents");\n    }\n    if (printedBy.length === 99) {\n      issues.push("distractor-in-neither-document");\n    }',
    simulates:
      "the distractors of an authored 比較・統合 pair stop being pinned to the printed texts, so a wrong option either document contradicts (shared by both) or that neither document mentions (invented) freezes as a defensible answer. 'True in exactly one of the two passages' is the whole ねらい of the 大問, and both arms go together because one refusal on its own still leaves the other property unproven",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-tougou.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/reading-tougou-corpus.ts",
    find: "export const TOUGOU_AUTHORED_MIN_INTENTS = TOUGOU_AUTHORED_STEMS.length;",
    id: "tougou-authored-intent-spread-dropped",
    replace: "export const TOUGOU_AUTHORED_MIN_INTENTS = 1;",
    simulates:
      "the store's ねらい spread stops being required: one relation asked eight times satisfies 統合理解, so a 大問 that should test 一致, 不一致 and a shared 前提 trains only the first (TASK-173.9.20 AC#3)",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-tougou.test.ts",
    ],
  },
  // The two guards TASK-173.9.21 opened at N1: the level route that made the last
  // windowed 短文 store an authored one, and the per-level authored band a written
  // N1 長文 is measured against. Each seam names the one property it breaks.
  {
    file: "packages/japanese/scripts/reading-tanbun-corpus.ts",
    find: '  TANBUN_SOURCE[level] === "authored" ? "authored" : TANBUN_CONSTRUCTION;',
    id: "tanbun-level-route-claims-masked-always",
    replace: "  TANBUN_CONSTRUCTION;",
    simulates:
      "the level's route stops deciding which proof a 短文 row owes: every level claims the masked-slot screens, so the authored N1 store TASK-173.9.21 wrote (and N2/N3/N4 before it) reads as a routing error while a blanked 白書 noun is accepted at a level whose 大問 trains 内容理解 rather than slot recovery. The anchor hardcodes the OTHER arm rather than one branch, because the property is that the level, not the row's tag, picks the proof (TASK-173.9.21 AC#1)",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-tanbun.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-choubun.ts",
    find: "  bandFor: (level) => CHOUBUN_AUTHORED_BAND[level],",
    id: "choubun-authored-band-not-per-level",
    replace: "  bandFor: () => CHOUBUN_AUTHORED_BAND.N3,",
    simulates:
      "the authored 長文 band stops coming from the level: one level's window judges every written row, so N1's 900-1200 rune 大問10 document (the size the official paper prints, doc-26 §3.5) is graded against N3's 500-700 and a 965-rune N1 row fails for being too long while a 600-rune one passes as an N1 長文. The ceiling separation is what stops an N1 長文 being an N3 長文 re-headed (TASK-173.9.21 AC#3)",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-choubun.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-reading-jouhou.ts",
    find: "      issues.push(\n        ...jouhouPassageVerbatimIssues({ passage: row.passage, upstream })\n      );",
    id: "jouhou-passage-verbatim-screen-dropped",
    replace: "      void 0;",
    simulates:
      "the licensed route's core claim is dropped: the rendered 素材 is no longer compared byte for byte with the pinned snapshot, so a retyped cell, a fixed full-width digit or a row the 国税庁 document never prints freezes as vendored. The N2 大問 grew to eight rows on this route (TASK-173.9.20 AC#4), so this is the screen the new 請負 素材 passes through",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-reading-jouhou.test.ts",
    ],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "storeFor: claimUnderstandingStoreFor,",
    id: "claim-understanding-store-read-wrong-level",
    replace: 'storeFor: () => claimUnderstandingStoreFor("N2"),',
    simulates:
      "claimUnderstandingSourceFor reads the N2 store no matter the level (TASK-173.9.2 slice 2), so a level whose 主張理解 store is empty - every level but N2/N1 - silently fills 大問13 with another level's passage instead of refusing",
    test: ["bun", "test", "apps/server/test/exam-claim-understanding.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "spent: (catalog) => catalog.usedClaimUnderstandingPassages,",
    id: "claim-understanding-passage-not-spent",
    replace: "spent: () => new Set<string>(),",
    simulates:
      "claimUnderstandingSourceFor stops honoring the per-paper passage spend (TASK-173.9.2 slice 2), so one 主張理解 passage backs two 小問 of the same 大問 and a repeated draw never runs dry",
    test: ["bun", "test", "apps/server/test/exam-claim-understanding.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "claim-understanding",\n  "medium-reading",',
    id: "claim-understanding-never-prints-its-passage",
    replace: '  "medium-reading",',
    simulates:
      "wholePassageFor stops handing a 主張理解 its sourced passage (TASK-173.9.2 slice 2, AC#3's sibling): removed from PRINTED_WHOLE_TYPES, the item returns no whole-text passage and a real 主張理解 大問 prints no reading text at all",
    test: ["bun", "test", "apps/server/test/exam-claim-understanding.test.ts"],
  },
  {
    file: "packages/item-engine/src/paper.ts",
    find: '    itemTypes: ["claim-understanding"],',
    id: "claim-understanding-block-not-wired",
    replace: "    itemTypes: [],",
    simulates:
      "the 主張理解（長文） 大問 stops declaring claim-understanding (TASK-173.9.2 slice 2), so the real block walk never asks for a 主張理解 item and the filled 大問 is reported unfilled instead of served",
    test: ["bun", "test", "apps/server/test/exam-claim-understanding.test.ts"],
  },
  {
    // TASK-173.4 AC#4, widened: a 読解 大問 whose level has no store is a hole
    // too. Dropping the predicate reverts the receipt to the old rule, where a
    // block with a question kind is never called unfilled, so a level with no
    // reading store reads as the learner having run the level dry.
    file: "packages/item-engine/src/paper.ts",
    find: "        block.requested > 0 &&\n        (block.itemTypes.length === 0 || !hasSource(block))",
    id: "paper-unfillable-blocks-ignore-store-absence",
    replace:
      "        block.requested > 0 &&\n        block.itemTypes.length === 0",
    simulates:
      "paperUnfillableBlocks stops consulting hasSource, so a 大問 whose question kind exists but whose level has no store (N5/N4 中文, N2/N1 短文, every N3 reading 大問) goes unnamed and the paper reads as a genuine content shortfall instead of naming the part nothing can ask",
    test: ["bun", "test", "apps/server/test/exam-reading-holes.test.ts"],
  },
  {
    // The boundary the rule actually draws: a source EXISTS, not a source big
    // enough. Asking for size would report a 大問 whose store is merely shorter
    // than its 小問数 as a part of the paper nothing can ask, which is TASK-148's
    // shortfall wearing the wrong diagnosis.
    file: "apps/server/src/services/exam-service.ts",
    find: "      if (storeFor(level).length > 0) {",
    id: "reading-store-size-not-source-existence",
    replace: "      if (storeFor(level).length > 100) {",
    simulates:
      "blockHasRealSource asks whether a store is BIG ENOUGH instead of whether it exists, so a 大問 whose level ships a store too small for its 小問数 (or whose store was substituted with one row) is named as unfilled rather than coming up short",
    test: ["bun", "test", "apps/server/test/exam-reading-holes.test.ts"],
  },
  {
    // The wiring half: the predicate is dead unless the receipt passes it. A
    // store-absent 大問 then goes unnamed exactly as before the rule existed.
    file: "apps/server/src/services/exam-service.ts",
    find: "            hasSource: blockHasRealSource(request.level),",
    id: "receipt-skips-store-absence-check",
    replace: "            hasSource: () => true,",
    simulates:
      "receiptFromState passes a predicate that calls every 大問 sourceable, so the store-absence arm never fires and the receipt names only the blocks the engine has no question kind for, which is the defect this rule exists to close",
    test: ["bun", "test", "apps/server/test/exam-reading-holes.test.ts"],
  },
  {
    // TASK-173.9.3: the unit of a 比較・統合 小問 is the PAIR, so the spend keys
    // on both document texts. Drop the check and one pair can back two 小問 of
    // one 大問, which is the same text asked twice.
    file: "apps/server/src/services/exam-service.ts",
    find: "    if (catalog.usedTougouPairs.has(pairKey)) {",
    id: "tougou-pair-not-spent",
    replace: "    if (false) {",
    simulates:
      "tougouSourceFor stops honoring the per-paper pair spend (TASK-173.9.3), so the same two 白書 documents answer two 小問 of one 統合理解 大問 and a repeated draw never runs dry",
    test: ["bun", "test", "apps/server/test/exam-tougou.test.ts"],
  },
  {
    // The picker reads the LEVEL store. Hardcode one level and a paper at another
    // level serves pairs that level never licensed, across the level boundary.
    file: "apps/server/src/services/exam-service.ts",
    find: "  const store = tougouStoreFor(level);",
    id: "tougou-store-read-wrong-level",
    replace: '  const store = tougouStoreFor("N2");',
    simulates:
      "tougouSourceFor reads the N2 pair store no matter the level (TASK-173.9.3), so a real N1 paper fills 大問11 with N2 comparisons the N1 store never licensed instead of refusing",
    test: ["bun", "test", "apps/server/test/exam-tougou.test.ts"],
  },
  {
    // One document is not a 読み比べ. The two-document guard is what makes a
    // half-pair source print nothing rather than a truncated comparison.
    file: "apps/server/src/services/exam-service.ts",
    find: "    if (passages === undefined || passages.length !== 2) {",
    id: "tougou-half-pair-printed",
    replace: "    if (passages === undefined) {",
    simulates:
      "candidateStimuli accepts a 統合理解 source with ONE document (TASK-173.9.3), so a 比較・統合 小問 prints half the pair it cannot be answered from",
    test: ["bun", "test", "apps/server/test/exam-tougou.test.ts"],
  },
  {
    // AC#3: a sourced 統合理解 must never land on the hardcoded 長文 text. The
    // pair presentation helper's own null passage is the only thing keeping it
    // off that constant.
    file: "apps/server/src/services/exam-service.ts",
    find: "  passage: null,",
    id: "tougou-falls-back-to-canned-passage",
    replace: "      passage: LONG_READING_PASSAGE,",
    simulates:
      "the 統合理解 presentation branch hands the item the hardcoded 長文 passage instead of its own pair (TASK-173.9.3 AC#3), so a real 統合理解 prints fabricated content",
    test: ["bun", "test", "apps/server/test/exam-tougou.test.ts"],
  },
  {
    // The blueprint half: without the block's item type the 大問 has no question
    // kind, so real mode reports the hole instead of filling it.
    file: "packages/item-engine/src/paper.ts",
    find: '  "tougou-rikai": { itemTypes: ["text-comparison"], name: "統合理解" },',
    id: "tougou-block-not-wired",
    replace: '  "tougou-rikai": { itemTypes: [], name: "統合理解" },',
    simulates:
      "PAPER_BLOCK_SHAPES takes the item type away from 統合理解 (TASK-173.9.3), so the sourced pair store has no block to fill and the 大問 goes back to being an unnamed gap in the paper",
    test: ["bun", "test", "apps/server/test/exam-tougou.test.ts"],
  },
  {
    // The type is real-only: weight 0 in every flat mix. Give it weight and a
    // shortened/daily paper starts emitting an item type nothing authored for it.
    file: "packages/item-engine/src/paper.ts",
    find: '  // `shortened`/daily paper never emits it, exactly like `info-search`.\n  "text-comparison": 0,',
    id: "tougou-type-enters-flat-mix",
    replace:
      '  // `shortened`/daily paper never emits it, exactly like `info-search`.\n  "text-comparison": 1,',
    simulates:
      "the flat item-type weights give `text-comparison` a non-zero share (TASK-173.9.3), so a shortened or daily paper asks a 比較・統合 小問 outside the real blueprint, where nothing sources it",
    test: ["bun", "test", "packages/item-engine/test/paper.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "    return source.passage ?? LONG_READING_PASSAGE;",
    id: "long-reading-falls-back-to-canned-passage",
    replace: "    return LONG_READING_PASSAGE;",
    simulates:
      "candidatePresentationFor hands a real 長文 the hardcoded text instead of its sourced 白書 window (TASK-173.9.12 AC#3), so 大問10 prints four 小問 over a passage the learner was never shown and the store freezes unserved",
    test: ["bun", "test", "apps/server/test/exam-choubun-reading.test.ts"],
  },
  {
    // The store picker is real-mode-only because `long-reading` is the one
    // reading type the flat mixes still weight. Drop the mode test and a
    // shortened N1 paper starts printing a window nothing screened for it. The
    // guard lives in `choubunWindowSourced` so the walk's dispatch chain stays
    // inside the repo's cognitive-complexity cap.
    file: "apps/server/src/services/exam-service.ts",
    find: 'itemType === "long-reading" && mode === "real"',
    id: "long-reading-store-ignores-mode",
    replace: 'itemType === "long-reading"',
    simulates:
      "the 長文 dispatch stops honoring the paper mode (TASK-173.9.12 AC#6), so a flat N1 paper draws from the real-mode store and its canned passage disappears from the mixes that never asked for a 白書 window",
    test: ["bun", "test", "apps/server/test/exam-choubun-reading.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "spent: (catalog) => catalog.usedChoubunPassages,",
    id: "long-reading-passage-not-spent",
    replace: "spent: () => new Set<string>(),",
    simulates:
      "choubunSourceFor stops honoring the per-paper window spend (TASK-173.9.12), so one 1000-rune 白書 window backs several 小問 of the same 大問 and the block's one-passage-per-小問 shape is silently violated",
    test: ["bun", "test", "apps/server/test/exam-choubun-reading.test.ts"],
  },
  {
    // The 中文, 短文, 主張理解 and 統合理解 pickers each pin their per-level read;
    // this is the 長文 one. Hardwiring N1 makes an N3 paper serve N1 prose. Until
    // TASK-173.9.16 the only thing that noticed was the 大問6 hole disappearing
    // from `exam-reading-holes.test.ts`, which is emptiness, not identity, and
    // would have gone silent the moment an N3 store shipped. It is now caught by
    // row identity too: `exam-choubun-reading.test.ts` resolves the served
    // anchorId inside `choubunStoreFor("N3")` and asserts the row's own level,
    // passage and key (doc-27 §6's lesson from TASK-173.9.15).
    file: "apps/server/src/services/exam-service.ts",
    find: "storeFor: choubunStoreFor,",
    id: "long-reading-store-read-wrong-level",
    replace: 'storeFor: () => choubunStoreFor("N1"),',
    simulates:
      "choubunSourceFor stops honoring the request's level (TASK-173.9.12 AC#3), so an N3 real paper fills 大問6 from the N1 store, prints an N1 長文 (900-1200 runes, authored since TASK-173.9.21 and a masked 白書 window before it) that never cleared any N3 bar, and serves a row whose own level field contradicts the paper it reaches",
    test: [
      "bun",
      "test",
      "apps/server/test/exam-reading-holes.test.ts",
      "apps/server/test/exam-choubun-reading.test.ts",
    ],
  },
  {
    // TASK-173.9.17 AC#4: the third no-fallback leg. The two store-level legs are
    // already gated (`*-store-read-wrong-level` pins the filename, `isRefused`
    // pins the composed key). This one pins the ROW: a store read by the right
    // file can still hold a row stamped for another level, and nothing else in
    // the chain notices, because the item honestly carries the row's own stamp and
    // `validateAnchors` then agrees with it. Neutering the comparison makes an
    // N3 長文 大問 print an N1 白書 window, which is exactly what the
    // TASK-173.9.18 through TASK-173.9.21 conversions make reachable.
    file: "apps/server/src/services/exam-service.ts",
    find: "  if (entry === undefined || entry.level !== level) {",
    id: "reading-row-serves-across-level",
    replace: "  if (entry === undefined) {",
    simulates:
      "servableReadingRow stops checking the row's own level (TASK-173.9.17 AC#4), so a 読解 picker serves a row it borrowed from another level out of its own file and the paper reads as full while the 大問 trains another level's material",
    test: ["bun", "test", "apps/server/test/exam-reading-no-fallback.test.ts"],
  },
  {
    file: "packages/item-engine/src/paper.ts",
    find: '    itemTypes: ["long-reading"],',
    id: "long-reading-block-not-wired",
    replace: "    itemTypes: [],",
    simulates:
      "PAPER_BLOCK_SHAPES takes the question kind away from 内容理解（長文） (TASK-173.9.12), so the real block walk never asks for a 長文 小問, the frozen store goes unserved and the 大問 reads like a hole again",
    test: ["bun", "test", "apps/server/test/exam-choubun-reading.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '(entry.source.provenance === "composed" && !entry.source.validated)',
    id: "usage-serves-unvalidated-row-in-real",
    replace: "false",
    simulates:
      "the 用法 drop the `composed && !validated` refusal term (TASK-173.9.23.1 AC#5), so an unjudged 用法 row serves a real paper instead of refusing - the exact laundering 読解's 173.9.5 gate exists to block, now extended to the 用法 store",
    test: ["bun", "test", "apps/server/test/exam-youhou.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "usage: usageSourceFor,",
    id: "usage-store-absent-block-short",
    replace: "usage: () => null,",
    simulates:
      "usageSourceFor stops reading the usage store (TASK-173.9.23.1 AC#5), so the 用法 大問 comes up short at every level even though a validated store exists - the block is short, not a fabricated item, which is the refusal the 読解 content gate proves",
    test: ["bun", "test", "apps/server/test/exam-youhou.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-usage.ts",
    find: "if (key.includes(distractor) && distractor.length >= 2) {",
    id: "usage-gate-misses-two-answer",
    replace: "if (false) {",
    simulates:
      "check:usage stops flagging a distractor that is a substring of the key (TASK-173.9.23.1 AC#5), so a two-answer 用法 row passes the gate - the truncation failure the substring screen exists to catch, now uncaught at CI time",
    test: ["bun", "test", "packages/japanese/test/check-usage.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '(entry.source.provenance === "composed" && !entry.source.validated)',
    id: "bunshou-serves-unjudged-row-in-real",
    replace: "false",
    simulates:
      "the 文章の文法 walk drops the `composed && !validated` refusal term (TASK-173.9.24), so a store whose keys no blind pass ever read serves 大問3 whole - the same laundering the 用法 line pins, proven against the 文章の文法 store rather than assumed from it",
    test: ["bun", "test", "apps/server/test/exam-bunshou.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "  bunshou: discourseClozeSourceFor,",
    id: "bunshou-store-never-consulted",
    replace: "  bunshou: () => null,",
    simulates:
      "discourseClozeSourceFor stops reading the 文章の文法 store (TASK-173.9.24), so the 大問 comes up short at N3, N2 and N1 even though a blind-certified store exists",
    test: ["bun", "test", "apps/server/test/exam-bunshou.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "bunshou:",\n',
    id: "bunshou-anchor-namespace-not-trusted",
    replace: "",
    simulates:
      "`resolveAnchor` stops attesting the `bunshou:` namespace (TASK-173.9.24), so every 文章の文法 candidate fails the anchor check and is refused SILENTLY: the receipt still says the 大問 exists, it just lands empty - the trap 情報検索 fell into before its own anchor line",
    test: ["bun", "test", "apps/server/test/exam-bunshou.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "discourse-cloze",\n  "info-search",\n  // TASK-173.9.28',
    id: "bunshou-falls-back-to-canned-passage",
    replace: '  "info-search",\n  // TASK-173.9.28',
    simulates:
      "`STORE_PASSAGE_TYPES` takes 文章の文法 away (TASK-173.9.24), so a 小問 whose own 文章 was written for it prints the canned `LONG_READING_PASSAGE` instead - fabricated content under a real 大問 heading",
    test: ["bun", "test", "apps/server/test/exam-bunshou.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-bunshou.ts",
    find: "  if (blankCount !== 1) {",
    id: "bunshou-gate-misses-blank-count",
    replace: "  if (false) {",
    simulates:
      "check:bunshou stops counting the blanks (TASK-173.9.24), so a two-＿＿ passage that asks two 小問 at once, and a blank-free one that asks nothing, both pass the gate and ship",
    test: ["bun", "test", "packages/japanese/test/check-bunshou.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '(entry.source.provenance === "composed" && !entry.source.validated)',
    id: "hyouki-serves-unjudged-row-in-real",
    replace: "false",
    simulates:
      "the 表記 walk drops the `composed && !validated` refusal term (TASK-173.9.25), so a store whose keys no blind pass ever read serves 大問2 whole - the same laundering the 用法 and 文章の文法 lines pin, now proven against the 表記 store rather than assumed from them",
    test: ["bun", "test", "apps/server/test/exam-hyouki.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "  hyouki: hyoukiSourceFor,",
    id: "hyouki-store-never-consulted",
    replace: "  hyouki: () => null,",
    simulates:
      "the real paper stops routing the hyouki family through `hyoukiSourceFor` (TASK-173.9.25), so 表記 comes up empty at N5, N4, N3 and N2 even though a blind-certified store exists",
    test: ["bun", "test", "apps/server/test/exam-hyouki.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "hyouki:",\n',
    id: "hyouki-anchor-namespace-not-trusted",
    replace: "",
    simulates:
      "`resolveAnchor` stops attesting the `hyouki:` namespace (TASK-173.9.25), so every 表記 candidate fails the anchor check and is refused SILENTLY: the receipt still says the 大問 exists, it just lands empty - the trap 情報検索 fell into before its own anchor line",
    test: ["bun", "test", "apps/server/test/exam-hyouki.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "usage",\n  "word-spelling",\n]);\n\nconst candidatePresentationFor',
    id: "hyouki-falls-back-to-canned-passage",
    replace: '  "usage",\n]);\n\nconst candidatePresentationFor',
    simulates:
      "`STORE_PASSAGE_TYPES` takes 表記 away (TASK-173.9.25), so a 表記 candidate never gets its own authored sentence: `validateStimuli` rejects it against `word-spelling`'s minPassages 1 and the whole 大問 lands as a silent shortfall rather than filling",
    test: ["bun", "test", "apps/server/test/exam-hyouki.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-hyouki.ts",
    find: "  if (key.length > 0 && row.passage.includes(key)) {",
    id: "hyouki-gate-misses-key-spelling-leak",
    replace: "  if (false) {",
    simulates:
      "check:hyouki stops screening the key spelling out of the sentence (TASK-173.9.25), so a 表記 row that PRINTS its own answer among the surrounding kanji passes the gate and ships - a 小問 whose correct spelling is on the page before the learner chooses",
    test: ["bun", "test", "packages/japanese/test/check-hyouki.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '(entry.source.provenance === "composed" && !entry.source.validated)',
    id: "goseikei-serves-unjudged-row-in-real",
    replace: "false",
    simulates:
      "the shared walk drops the `composed && !validated` refusal term (TASK-173.9.26), so a 語形成 store whose compound keys no blind pass ever read serves 大問3 whole - the same laundering the 表記 line pins, now proven against the 語形成 store rather than assumed from it",
    test: ["bun", "test", "apps/server/test/exam-goseikei.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "  goseikei: goseikeiSourceFor,",
    id: "goseikei-store-never-consulted",
    replace: "  goseikei: () => null,",
    simulates:
      "the real paper stops routing the 語形成 family through `goseikeiSourceFor` (TASK-173.9.26), so 語形成 comes up empty at N2 even though a blind-certified store exists",
    test: ["bun", "test", "apps/server/test/exam-goseikei.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "goseikei:",\n',
    id: "goseikei-anchor-namespace-not-trusted",
    replace: "",
    simulates:
      "`resolveAnchor` stops attesting the `goseikei:` namespace (TASK-173.9.26), so every 語形成 candidate fails the anchor check and is refused SILENTLY: the receipt still says the 大問 exists, it just lands empty - the trap 情報検索 fell into before its own anchor line",
    test: ["bun", "test", "apps/server/test/exam-goseikei.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "compound-completion",\n  // TASK-173.9.29',
    id: "goseikei-falls-back-to-canned-passage",
    replace: "  // TASK-173.9.29",
    simulates:
      "`STORE_PASSAGE_TYPES` takes 語形成 away (TASK-173.9.26), so a candidate never gets its own authored sentence: `validateStimuli` rejects it against `compound-completion`'s minPassages 1 and the whole 大問 lands as a silent shortfall rather than filling",
    test: ["bun", "test", "apps/server/test/exam-goseikei.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-goseikei.ts",
    find: "  if (option.length > 0 && row.passage.includes(option)) {",
    id: "goseikei-gate-misses-key-kanji-leak",
    replace: "  if (false) {",
    simulates:
      "check:goseikei stops screening the answer kanji out of the sentence (TASK-173.9.26), so a row whose passage prints the answer inside a SECOND word (電車 beside a 車 blank, the n2-g-013 case) passes the gate and ships - where the item engine's `hasStemLeak` would silently assembly-drop it",
    test: ["bun", "test", "packages/japanese/test/check-goseikei.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '(entry.source.provenance === "composed" && !entry.source.validated)',
    id: "kitei-serves-unjudged-row-in-real",
    replace: "false",
    simulates:
      "the shared walk drops the `composed && !validated` refusal term (TASK-173.9.29), so a 文脈規定 store whose context-pinned keys no blind pass ever read serves its 大問 whole - the same laundering the 表記 and 語形成 lines pin, now proven against the 文脈規定 store rather than assumed from them",
    test: ["bun", "test", "apps/server/test/exam-kitei.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "      return kiteiSourceFor({ catalog, index, level: request.level, offset });",
    id: "kitei-store-never-consulted",
    replace: "      return null;",
    simulates:
      "the real paper stops routing the N3/N2/N1 cloze family through `kiteiSourceFor` (TASK-173.9.29), so 文脈規定 comes up empty at all three levels even though blind-certified stores exist - the picker is proven reachable from the dispatch, not just correct on its own",
    test: ["bun", "test", "apps/server/test/exam-kitei.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "kitei:",\n',
    id: "kitei-anchor-namespace-not-trusted",
    replace: "",
    simulates:
      "`resolveAnchor` stops attesting the `kitei:` namespace (TASK-173.9.29), so every 文脈規定 candidate fails the anchor check and is refused SILENTLY: the receipt still says the 大問 exists, it just lands empty - the trap 情報検索 fell into before its own anchor line",
    test: ["bun", "test", "apps/server/test/exam-kitei.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "context-cloze",\n  "discourse-cloze",\n  "info-search",\n  // TASK-173.9.28',
    id: "kitei-falls-back-to-canned-passage",
    replace: '  "discourse-cloze",\n  "info-search",\n  // TASK-173.9.28',
    simulates:
      "`STORE_PASSAGE_TYPES` takes 文脈規定 away (TASK-173.9.29), so a candidate never gets its own authored sentence: `validateStimuli` rejects it against `context-cloze`'s minPassages 1 and the whole 大問 lands as a silent shortfall rather than filling",
    test: ["bun", "test", "apps/server/test/exam-kitei.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "      ? kiteiStoreFor(level)",
    id: "kitei-drained-store-never-named",
    replace: '      ? ["cloze-present"]',
    simulates:
      "`READING_STORE_FOR` claims the 文脈規定 block always has a source (TASK-173.9.29), so an emptied or missing store reads as a bare shortfall instead of naming the 大問: the receipt stops telling the learner their paper is missing 文脈規定, which is the hole-naming leg the N3/N2/N1 split exists to keep",
    test: ["bun", "test", "apps/server/test/exam-kitei.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-kitei.ts",
    find: "    if (option.length > 0 && row.passage.includes(option)) {",
    id: "kitei-gate-misses-option-leak",
    replace: "    if (false) {",
    simulates:
      "check:kitei stops screening the FOUR options out of the sentence (TASK-173.9.29), so a 文脈規定 row whose passage prints a distractor (or its own answer) passes the gate and ships - printing it narrows the elimination the 小問 exists to test, and the engine's `hasStemLeak` would silently assembly-drop the answer leak anyway",
    test: ["bun", "test", "packages/japanese/test/check-kitei.test.ts"],
  },
  {
    file: "packages/item-engine/src/paper.ts",
    find: '  "claim-understanding",\n  "info-search",\n  "long-reading",\n  "medium-reading",\n  "reading-info",\n  "short-reading",\n  "text-comparison",\n] as const satisfies readonly ItemType[];',
    id: "reading-band-drops-placed-real-types",
    replace:
      '  "long-reading",\n  "reading-info",\n] as const satisfies readonly ItemType[];',
    simulates:
      "READING_ITEM_TYPES reverts to the two flat-mix carriers (the pre-TASK-173.9.29 band), so every placed 読解 小問 of the other kinds belongs to no band: the full real N1/N2/N3 papers never meet the 読解 floor and their banded results silently lose those points",
    test: ["bun", "test", "packages/item-engine/test/paper.test.ts"],
  },
  {
    file: "packages/item-engine/src/paper.ts",
    find: '  "star-ordering",\n  // TASK-173.9.28',
    id: "language-band-drops-star-ordering",
    replace: "  // TASK-173.9.28",
    simulates:
      "LANGUAGE_KNOWLEDGE_ITEM_TYPES loses `star-ordering` again (the pre-TASK-173.9.29 list), so the 5 文の組み立て 小問 a real N1/N2/N3 paper places belong to no band: the banded columns come up exactly 5 short of the landed items",
    test: ["bun", "test", "apps/server/test/exam-short-reading.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '(entry.source.provenance === "composed" && !entry.source.validated)',
    id: "iikae-serves-unjudged-row-in-real",
    replace: "false",
    simulates:
      "the shared walk drops the `composed && !validated` refusal term (TASK-173.9.27), so a 言い換え類義 store whose bracketed targets no blind pass ever read serves its 大問 whole - the same laundering the 表記 and 語形成 lines pin, now proven against the 言い換え store rather than assumed from it",
    test: ["bun", "test", "apps/server/test/exam-iikae.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "  iikae: iikaeSourceFor,",
    id: "iikae-store-never-consulted",
    replace: "  iikae: () => null,",
    simulates:
      "the real paper stops routing the 言い換え類義 family through `iikaeSourceFor` (TASK-173.9.27), so 言い換え類義 comes up empty at N1, N2 and N3 even though a blind-certified store exists",
    test: ["bun", "test", "apps/server/test/exam-iikae.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "iikae:",\n',
    id: "iikae-anchor-namespace-not-trusted",
    replace: "",
    simulates:
      "`resolveAnchor` stops attesting the `iikae:` namespace (TASK-173.9.27), so every 言い換え類義 candidate fails the anchor check and is refused SILENTLY: the receipt still says the 大問 exists, it just lands empty - the trap 情報検索 fell into before its own anchor line",
    test: ["bun", "test", "apps/server/test/exam-iikae.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "synonym-paraphrase",\n  // TASK-173.9.25',
    id: "iikae-falls-back-to-canned-passage",
    replace: "  // TASK-173.9.25",
    simulates:
      "`STORE_PASSAGE_TYPES` takes 言い換え類義 away (TASK-173.9.27), so a candidate never gets its own authored sentence: `validateStimuli` rejects it against `synonym-paraphrase`'s minPassages 1 and the whole 大問 lands as a silent shortfall rather than filling",
    test: ["bun", "test", "apps/server/test/exam-iikae.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-iikae.ts",
    find: "  if (option.length > 0 && row.passage.includes(option)) {",
    id: "iikae-gate-misses-option-leak",
    replace: "  if (false) {",
    simulates:
      "check:iikae stops screening the options out of the sentence (TASK-173.9.27), so a row that PRINTS one of its four choices in its own 文 passes the gate and ships. For the answer itself that is the 表記/語形成 leak (`synonym-paraphrase` is deliberately outside `STIMULUS_ANSWER_TYPES`, so `hasStemLeak` searches prompt+passage for the answer text and assembly drops the row in silence); for a distractor it is worse than a leak, it is the giveaway the two blind passes were supposed to catch.",
    test: ["bun", "test", "packages/japanese/test/check-iikae.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-iikae.ts",
    find: "  if (!attestation.wordsAtOrBelow.has(normalise(target))) {",
    id: "iikae-gate-misses-target-attestation",
    replace: "  if (false) {",
    simulates:
      "check:iikae stops asking the licensed corpus whether the 「　」 target is a word the learner has met by this level (TASK-173.9.27) - the one screen that distinguishes 言い換え類義 from every other store family, and the only place the property is enforced, since serving checks the cert trio and the shape but never re-consults the bands. Remove it and a row quoting 嗚呼 at N3 clears the gate, and every other screen stays green.",
    test: ["bun", "test", "packages/japanese/test/check-iikae.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "iikae-sentence": iikaeSentenceSourceFor,',
    id: "iikae-sentence-store-never-consulted",
    replace: '  "iikae-sentence": () => null,',
    simulates:
      "the real paper stops routing the 言い換え類義 SENTENCE family through `iikaeSentenceSourceFor` (TASK-173.9.28), so 大問4 comes up empty at N4 and N5 even though a blind-certified sentence store exists - and because the word form is a different family, the block cannot accidentally fill from N1-N3 material",
    test: ["bun", "test", "apps/server/test/exam-iikae-sentence.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "iikae-sentence:",\n',
    id: "iikae-sentence-anchor-namespace-not-trusted",
    replace: "",
    simulates:
      "`resolveAnchor` stops attesting the `iikae-sentence:` namespace (TASK-173.9.28), so every sentence-form candidate fails the anchor check and is refused SILENTLY: the receipt still says the 大問 exists, it just lands empty - the trap 情報検索 fell into before its own anchor line",
    test: ["bun", "test", "apps/server/test/exam-iikae-sentence.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "sentence-paraphrase",\n  // TASK-173.9.27',
    id: "iikae-sentence-falls-back-to-canned-passage",
    replace: "  // TASK-173.9.27",
    simulates:
      "`STORE_PASSAGE_TYPES` takes the sentence form away (TASK-173.9.28), so a candidate never gets the ぶん the paper underlines: `validateStimuli` rejects it against `sentence-paraphrase`'s minPassages 1 and the whole 大問 lands as a silent shortfall rather than filling",
    test: ["bun", "test", "apps/server/test/exam-iikae-sentence.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-iikae-sentence.ts",
    find: "    stripSpace(row.passage).includes(stripSpace(answerSwap.after))",
    id: "iikae-sentence-gate-misses-answer-leak",
    replace: "    false",
    simulates:
      "check:iikae-sentence stops screening the answer's own swapped expression out of the sentence (TASK-173.9.28), so a row that PRINTS its paraphrase's wording inside the underlined 文 passes the gate and ships. `sentence-paraphrase` is deliberately outside `STIMULUS_ANSWER_TYPES`, so `hasStemLeak` searches prompt+passage for the answer text and the assembly drops such a row in silence - the 大問 would come up short with nothing in the receipt to explain it.",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-iikae-sentence.test.ts",
    ],
  },
  {
    file: "packages/japanese/scripts/check-iikae-sentence.ts",
    find: "    if (runes(swap.before) > FOCUS_MAX || runes(swap.after) > FOCUS_MAX) {",
    id: "iikae-sentence-gate-misses-focus-cap",
    replace: "    if (false) {",
    simulates:
      "check:iikae-sentence stops capping how much of the sentence one option may change (TASK-173.9.28), so an option that rewrites a whole clause instead of swapping one expression ships as a 言い換え類義 小問. That is the sentence form read as a translation exercise: the paper asks whether one 表現 means another, and the frame around the swap is what keeps four options four WAYS OF SAYING one sentence.",
    test: [
      "bun",
      "test",
      "packages/japanese/test/check-iikae-sentence.test.ts",
    ],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "listening-",\n',
    id: "listening-anchor-namespace-not-trusted",
    replace: "",
    simulates:
      "`resolveAnchor` stops attesting the `listening-{kadai,point,gaiyou,hatsuwa,sokuji}:` namespaces (TASK-173.8.1, TASK-173.9.4.1), so every 聴解 candidate fails the anchor check and is refused SILENTLY: every listening 大問 lands empty with nothing in the receipt but a shortfall - the trap the 情報検索 anchor line pinned for its own namespace",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "listening-kadai": listeningKadaiSourceFor,',
    id: "listening-kadai-store-never-consulted",
    replace: '  "listening-kadai": () => null,',
    simulates:
      "the real paper stops routing the 課題理解 family through `listeningKadaiSourceFor` (TASK-173.8.1), so 大問1 comes up empty at N5 even though a blind-certified and licensed store exists",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  anchorPrefix: "listening-kadai",\n  asStimulus: true,\n  provenanceDefault: "composed",\n  spent: (catalog) => catalog.usedListeningScenarios,',
    id: "listening-scenario-spend-dropped",
    replace:
      '  anchorPrefix: "listening-kadai",\n  asStimulus: true,\n  provenanceDefault: "composed",\n  spent: () => new Set<string>(),',
    simulates:
      "the 聴解 picker stops honoring the SHARED scenario spend (TASK-173.8.1), so one dialogue can back two 小問 in one paper - a learner who heard it once has already answered it, and the four 大問 were a spend of 24 scenarios, not 24 chances to re-play one",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "packages/db/src/item-store.ts",
    find: '  "listening-kadai",\n  "listening-point",\n  "listening-hatsuwa",\n  "listening-sokuji",\n',
    id: "listening-speech-projection-dropped",
    replace: "",
    simulates:
      "`SPEAKING_ITEM_TYPES` takes the four 聴解 blocks back out of the speaking projection (TASK-173.8.1), so `toClientItem` projects `speech: null` for them: the scenario never crosses to the client, the paper prints options with nothing to hear, and TASK-173.8.2's TTS has no text to read",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-listening-shared.ts",
    find: '  if (SCENARIO_BRACKETS.test(scenario)) {\n    issues.push("scenario-carries-brackets");\n  }\n',
    id: "listening-gate-misses-bracket-screen",
    replace: "",
    simulates:
      "the 聴解 gate stops rejecting a scenario that carries 「」 (TASK-173.8.1 screen 2), so a row whose heard material is marked up like a 読解 passage - brackets the paper never prints over spoken audio - clears the offline gate and ships into the store",
    test: ["bun", "test", "packages/japanese/test/check-listening.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "listening-gaiyou": listeningGaiyouSourceFor,',
    id: "listening-gaiyou-store-never-consulted",
    replace: '  "listening-gaiyou": () => null,',
    simulates:
      "the real paper stops routing the 概要理解 family through `listeningGaiyouSourceFor` (TASK-173.9.4.1), so N3 大問3 comes up empty even though a blind-certified monologue store exists",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "integrated-listening",\n  "listening-choukai",\n  "listening-gaiyou",',
    id: "listening-gaiyou-speech-projection-dropped",
    replace: '  "integrated-listening",\n  "listening-choukai",',
    simulates:
      "`LISTENING_ITEM_TYPES` drops 概要理解 (TASK-173.9.4.1), so `presentationFor` prints the monologue as a passage and never fills the `script` column: the type's minScripts 1 refuses every candidate and the whole N3 大問3 lands as a silent shortfall",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "listening-gaiyou": listeningGaiyouStoreFor,',
    id: "listening-gaiyou-hole-not-named",
    replace: '  "listening-gaiyou": () => [],',
    simulates:
      "`READING_STORE_FOR` loses the 概要理解 entry (TASK-173.9.4.1), so `blockHasRealSource` no longer reads the N3 store: the full 大問 lands empty AND a drained store stops being named as the hole - both TASK-173.1 facts lost at once",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-listening-shared.ts",
    find: "  monologue: { N1: [120, 420], N2: [100, 400], N3: [100, 340] },",
    id: "listening-gaiyou-gate-misses-monologue-band",
    replace: "  monologue: { N1: [120, 420], N2: [100, 400], N3: [1, 4000] },",
    simulates:
      "the 概要理解 gate stops enforcing the N3 monologue rune band (TASK-173.9.4.1 AC#3), so a one-line notice or a dialogue-length exchange clears the offline gate as 概要理解 - the shape decision doc-26 §4 recorded is no longer re-proved by any screen",
    test: ["bun", "test", "packages/japanese/test/check-listening.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: '  "listening-choukai": listeningChoukaiSourceFor,',
    id: "listening-choukai-store-never-consulted",
    replace: '  "listening-choukai": () => null,',
    simulates:
      "the real paper stops routing the 聴解統合理解 family through `listeningChoukaiSourceFor` (TASK-173.9.4.2), so N2 大問5 comes up empty even though a blind-certified paired store exists",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is the SOURCE line, whose ${...} must stay literal text
    find: "const anchorId = `listening-choukai:${row.id}`;",
    id: "listening-choukai-anchor-namespace-not-trusted",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the replacement carries the same ${...} literal text
    replace: "const anchorId = `choukai:${row.id}`;",
    simulates:
      "the 聴解統合理解 picker builds its anchor from the family name instead of the trusted `listening-choukai:` namespace (TASK-173.9.4.2): the string stays self-consistent through seenAnchors and anchorLevels, but `resolveAnchor`'s arm chain carries no `choukai:` prefix, so every candidate resolves to null and validation silently refuses all of N2 大問5 - the namespace rule proved from the CONSTRUCTION side, the mirror of `listening-anchor-namespace-not-trusted` proving it from the trust side",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-service.ts",
    find: "const CHOUKAI_GROUP_SIZE = 2;",
    id: "listening-choukai-script-spend-dropped",
    replace: "const CHOUKAI_GROUP_SIZE = 1;",
    simulates:
      "the 聴解統合理解 picker stops spending scripts as PAIRS (二つの質問, TASK-173.9.4.2): the group filter admits only singleton scripts, every shipped dialogue is dropped, and N2 大問5 lands empty - the paper owes two 小問 of one dialogue and can name none",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "packages/db/src/item-store.ts",
    find: '  "listening-choukai",\n',
    id: "listening-choukai-speech-projection-dropped",
    replace: "",
    simulates:
      "`SPEAKING_ITEM_TYPES` takes 聴解統合理解 back out of the speaking projection (TASK-173.9.4.2), so `toClientItem` projects `speech: null` for its rows: the dialogue never crosses to the client and TASK-173.8.2's TTS has no text to read",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "packages/japanese/scripts/check-listening-shared.ts",
    find: "      if (group.length !== scriptGroupSize) {",
    id: "listening-choukai-group-screen-dropped",
    replace: "      if (false) {",
    simulates:
      "the 聴解統合理解 gate stops enforcing the pair size (TASK-173.9.4.2 AC#3): a lone 小問 of a dialogue or a script cloned onto a third clears the offline gate and ships into the store, so one heard script backs one question or three - exactly the shape the official 二つの質問 form forbids",
    test: ["bun", "test", "packages/japanese/test/check-listening.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-corpus.ts",
    find: '    for (const each of ["N1", "N2", "N3", "N4", "N5"]) {\n      listeningKadaiCache.set(each, loadListeningKadaiLevel(dir, each));',
    id: "listening-n1-kadai-store-not-loaded",
    replace:
      '    for (const each of ["N2", "N3", "N4", "N5"]) {\n      listeningKadaiCache.set(each, loadListeningKadaiLevel(dir, each));',
    simulates:
      "the 聴解 loader loop drops N1 from the 課題理解 ship list (TASK-173.9.4.3): the level list itself is the store contract, so a real N1 paper comes up with an empty 大問1 while the blind-certified 24-row store sits unread on disk",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "apps/server/src/services/exam-corpus.ts",
    find: '    for (const each of ["N1", "N2"]) {\n      listeningChoukaiCache.set(each, loadListeningChoukaiLevel(dir, each));',
    id: "listening-n1-choukai-store-not-loaded",
    replace:
      '    for (const each of ["N2"]) {\n      listeningChoukaiCache.set(each, loadListeningChoukaiLevel(dir, each));',
    simulates:
      "the 聴解統合理解 loader loop stops filling its N1 cache (TASK-173.9.4.3): N2 keeps pairing its dialogues while the N1 大問5 lands empty with its eight certified pairs unread - the pairing picker is only as shipped as the loader's level list",
    test: ["bun", "test", "apps/server/test/exam-listening.test.ts"],
  },
  {
    file: "apps/desktop/src/lib/sidecar-ready.ts",
    find: "  listen(SIDECAR_READY_EVENT, () => invalidateProbe(client))",
    id: "sidecar-ready-announce-ignored",
    replace: "  listen(SIDECAR_READY_EVENT, () => undefined)",
    simulates:
      "the shell announces the sidecar bound and the webview hears it but never re-asks: on a cold boot the setup rail keeps reading 'backend unreachable' after the backend came up, because the probe's retry: false means the first answer is the last one",
    test: ["bun", "test", "apps/desktop/test/sidecar-ready.test.ts"],
  },
];

const ROOT = resolve(import.meta.dir, "..");

type AnchorCheck =
  | { ok: true; original: string }
  | { ok: false; reason: string };

/**
 * Read-only anchor resolution. Separated from the write so every seam can be
 * checked BEFORE anything is touched: a refactor that moves the code a seam
 * targets used to cost a full mutation run to discover, one stale seam at a
 * time.
 */
const checkAnchor = (file: string, find: string): AnchorCheck => {
  const path = join(ROOT, file);
  if (!existsSync(path)) {
    return { ok: false, reason: `file not found: ${file}` };
  }
  const original = readFileSync(path, "utf8");
  const occurrences = original.split(find).length - 1;
  if (occurrences === 0) {
    return {
      ok: false,
      reason: `anchor not found in ${file} — the seam moved, update the gate`,
    };
  }
  if (occurrences > 1) {
    return {
      ok: false,
      reason: `anchor is ambiguous in ${file} (${occurrences} matches)`,
    };
  }
  return { ok: true, original };
};

/**
 * The pre-write record of what a mutated seam file contained. The `finally`
 * restore is the normal path, but a killed process never reaches it, and a JS
 * signal handler cannot cover the gap either: `runTests` blocks in `spawnSync`,
 * which is the only window where a file is mutated, and a signal arriving there
 * is deferred until the event loop next runs - by which time the script has
 * already exited. Measured 2026-10-14: SIGTERM at t=1s of a 4s `spawnSync`
 * printed nothing from the handler and the process exited 0.
 *
 * So the recovery is on disk, not in a handler: journal first, restore second,
 * unlink third. Any death mode, SIGKILL included, leaves a journal the next
 * run reads back and applies.
 */
const JOURNAL = join(ROOT, ".cache", "mutation-gate-journal.json");

interface Journal {
  file: string;
  original: string;
}

/** Put the journal down BEFORE the write, so a death between the two still has
 * a journal whose restore is a no-op. */
const journalFor = (entry: Journal): void => {
  mkdirSync(dirname(JOURNAL), { recursive: true });
  writeFileSync(JOURNAL, JSON.stringify(entry));
};

/**
 * Apply a journal left by a run that died mid-seam. Returns the healed file, or
 * null when nothing was pending. Runs before the dirty check so a leftover
 * mutation heals instead of tripping it.
 */
const healJournal = (): string | null => {
  if (!existsSync(JOURNAL)) {
    return null;
  }
  let entry: Journal;
  try {
    entry = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
  } catch {
    // A torn journal is a file this tool wrote; unreadable means the run died
    // between create and write, so nothing was mutated and it is safe to drop.
    rmSync(JOURNAL, { force: true });
    return null;
  }
  const target = join(ROOT, entry.file);
  if (!existsSync(target)) {
    // The file moved or was deleted since the journal was written. Restoring
    // would resurrect it with content from a commit that no longer describes
    // the tree, which is worse than the hole the journal was meant to close.
    console.log(
      `dropped a journal for ${entry.file}: that file is gone, so its pre-mutation content is not recoverable this way`
    );
    rmSync(JOURNAL, { force: true });
    return null;
  }
  writeFileSync(target, entry.original);
  rmSync(JOURNAL, { force: true });
  return entry.file;
};

const applyOnce = (
  file: string,
  find: string,
  replace: string
): AnchorCheck => {
  const checked = checkAnchor(file, find);
  if (!checked.ok) {
    return checked;
  }
  journalFor({ file, original: checked.original });
  writeFileSync(join(ROOT, file), checked.original.replace(find, replace));
  return checked;
};

/** The workspace package that owns a repo-relative path, or null.
 *
 * Bun loads `.env` from the process cwd, and `apps/server`'s env schema requires
 * `CORS_ORIGIN` and `DATABASE_URL`, which only that file supplies. A test command
 * run from the repo root therefore dies in env validation before a single
 * assertion executes, exits non-zero, and the gate reads that as "the mutation
 * was caught". Every server seam in this file was a false positive that way,
 * including a mutation that changes nothing (the gloss surface's
 * `entry.senses?.[0]?.[0]` and `fullSensesOf(entry)[0]` are equal for all 8,476
 * corpus entries). Running from the owning package is what `cd apps/server &&
 * bun run test` does, so it is what a seam means.
 */
const packageRootFor = (repoRelative: string): string | null => {
  let dir = dirname(resolve(ROOT, repoRelative));
  while (dir !== ROOT && dir !== dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return existsSync(join(ROOT, "package.json")) ? ROOT : null;
};

interface TestGroup {
  args: string[];
  cwd: string;
}

type TestPlan =
  | { groups: TestGroup[]; ok: true }
  | { ok: false; reason: string };

/** Split a seam's command into one run per owning package. Some seams declare
 * tests in two of them (the label seam checks the server receipt and the chat
 * fold), and each has to run where its own env file is, so the paths are grouped
 * rather than the whole command being pinned to one cwd. */
const resolveTestPlan = (command: readonly string[]): TestPlan => {
  const [bin = "bun", ...args] = command;
  const flags = args.filter((arg) => !existsSync(join(ROOT, arg)));
  const byRoot = new Map<string, string[]>();
  for (const arg of args) {
    const target = join(ROOT, arg);
    if (!existsSync(target)) {
      continue;
    }
    const root = packageRootFor(arg);
    if (root === null) {
      return { ok: false, reason: `no package.json above ${arg}` };
    }
    byRoot.set(root, [...(byRoot.get(root) ?? []), target]);
  }
  if (byRoot.size === 0) {
    return { groups: [{ args: [bin, ...args], cwd: ROOT }], ok: true };
  }
  return {
    groups: [...byRoot].map(([cwd, paths]) => ({
      args: [bin, ...flags, ...paths],
      cwd,
    })),
    ok: true,
  };
};

/** One exit code per group; a negative code means that run never started. */
const runTests = (command: readonly string[]): number[] => {
  const plan = resolveTestPlan(command);
  if (!plan.ok) {
    console.error(`  ! ${plan.reason}`);
    return [-1];
  }
  return plan.groups.map((group) => {
    const [bin = "bun", ...args] = group.args;
    const result = spawnSync(bin, args, {
      cwd: group.cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    if (result.error) {
      console.error(
        `  ! could not run ${group.args.join(" ")}: ${result.error.message}`
      );
      return -1;
    }
    return result.status ?? -1;
  });
};

type Verdict = "caught" | "survived" | "untrustworthy";

/** Exit code of a seam's command on an untouched tree, once per command. Seams
 * share commands heavily, so this is a handful of runs rather than one per seam. */
const baselines = new Map<string, number[]>();

const baselineStatus = (command: readonly string[]): number[] => {
  const key = command.join(" ");
  const known = baselines.get(key);
  if (known !== undefined) {
    return known;
  }
  const statuses = runTests(command);
  baselines.set(key, statuses);
  return statuses;
};

interface Outcome {
  detail: string;
  id: string;
  /** The seam's own statement of what it simulates, echoed on a failure. */
  intent: string;
  verdict: Verdict;
}

/** Apply one mutation, run its tests, and restore the file whatever happens. */
const evaluate = (mutation: Mutation): Outcome => {
  // The command has to pass BEFORE anything is rewritten. Every server seam in
  // this file reported "caught" from a repo-root run that dies in env validation
  // with no mutation applied at all, and a failing command cannot distinguish a
  // caught break from a broken harness.
  const baseline = baselineStatus(mutation.test);
  if (baseline.some((status) => status !== 0)) {
    return {
      detail: `UNTRUSTWORTHY — the seam's test command exits ${baseline.join(", ")} on an UNMUTATED tree, so its verdict measures nothing. Fix the command or the harness before trusting this seam.`,
      id: mutation.id,
      intent: mutation.simulates,
      verdict: "untrustworthy",
    };
  }
  const applied = applyOnce(mutation.file, mutation.find, mutation.replace);
  if (!applied.ok) {
    return {
      detail: applied.reason,
      id: mutation.id,
      intent: mutation.simulates,
      verdict: "untrustworthy",
    };
  }
  try {
    const statuses = runTests(mutation.test);
    if (statuses.every((status) => status === 0)) {
      return {
        // A survivor is ambiguous on purpose: either the seam is too weak to
        // break anything, or the behavior is genuinely unpinned. Both are real,
        // and the fix differs, so say both rather than guessing.
        detail:
          "SURVIVED — no test noticed this break. Either this mutation is too weak to change the behavior (a seam that mixes-but-still-works proves nothing), or the behavior is unpinned. Strengthen the mutation or delete the seam; never loosen the test.",
        id: mutation.id,
        intent: mutation.simulates,
        verdict: "survived",
      };
    }
    if (statuses.some((status) => status < 0)) {
      return {
        detail: `INCONCLUSIVE — a test group failed to run (exited ${statuses.join(", ")})`,
        id: mutation.id,
        intent: mutation.simulates,
        verdict: "untrustworthy",
      };
    }
    return {
      detail: `caught (tests exited ${statuses.join(", ")})`,
      id: mutation.id,
      intent: mutation.simulates,
      verdict: "caught",
    };
  } finally {
    writeFileSync(join(ROOT, mutation.file), applied.original);
    rmSync(JOURNAL, { force: true });
  }
};

const selectMutations = (filter: string | undefined): Mutation[] => {
  const all = filter
    ? MUTATIONS.filter((mutation) => mutation.id.includes(filter))
    : [...MUTATIONS];
  if (all.length === 0) {
    console.error(`no mutation matches "${filter}"`);
    process.exit(1);
  }
  return all;
};

const report = (outcomes: readonly Outcome[]): void => {
  for (const outcome of outcomes) {
    if (outcome.verdict !== "caught") {
      console.log(`  ${outcome.id}`);
      console.log(`    simulates: ${outcome.intent}`);
      console.log(`    ${outcome.detail}`);
    }
  }
  const survivors = outcomes
    .filter((outcome) => outcome.verdict === "survived")
    .map((outcome) => outcome.id);
  const untrustworthy = outcomes
    .filter((outcome) => outcome.verdict === "untrustworthy")
    .map((outcome) => outcome.id);
  if (survivors.length > 0) {
    console.log(
      `SURVIVING MUTATIONS (weak seam, or unpinned behavior): ${survivors.join(", ")}`
    );
  }
  if (untrustworthy.length > 0) {
    console.log(`UNTRUSTWORTHY GATES: ${untrustworthy.join(", ")}`);
  }
  if (survivors.length === 0 && untrustworthy.length === 0) {
    console.log(`all ${outcomes.length} mutation(s) caught`);
  }
  process.exit(survivors.length > 0 || untrustworthy.length > 0 ? 1 : 0);
};

/**
 * Resolve every selected seam's anchor without writing anything. Cheap enough
 * to run on its own (`--check`), and it turns "the gate is stale" from a
 * two-minute discovery into an instant one that names every stale seam at once.
 */
const preflight = (selected: readonly Mutation[]): string[] => {
  const stale: string[] = [];
  for (const mutation of selected) {
    const checked = checkAnchor(mutation.file, mutation.find);
    if (!checked.ok) {
      stale.push(`${mutation.id}: ${checked.reason}`);
    }
  }
  if (stale.length > 0) {
    console.log(`${stale.length} seam(s) cannot be applied:\n`);
    for (const line of stale) {
      console.log(`  ${line}`);
    }
    console.log(
      "\nA moved anchor means the seam needs updating (or deleting). Nothing was written."
    );
  }
  return stale;
};

/** The seam files a dirty-tree check has to look at for a selected run. */
const seamFiles = (selected: readonly Mutation[]): string[] =>
  [...new Set(selected.map((mutation) => mutation.file))].sort();

/**
 * Seam files the working tree already changed. A gate run restores what it
 * read, so a file that is dirty for someone else's reason becomes the
 * "original" the next run restores TO, and the seam is scored against code its
 * anchor does not describe. The journal normally heals a killed run's leftover
 * before this check runs; what reaches here is an edit of the user's, or a
 * leftover from before the journal existed.
 */
const dirtySeamFiles = (selected: readonly Mutation[]): string[] => {
  const result = spawnSync(
    "git",
    ["status", "--porcelain", "--", ...seamFiles(selected)],
    { cwd: ROOT, encoding: "utf8", stdio: "pipe" }
  );
  if (result.error !== undefined || (result.status ?? 1) !== 0) {
    console.error(
      `  ! git status failed (${result.error?.message ?? `exit ${result.status}`}); cannot prove the seam files are clean`
    );
    process.exit(1);
  }
  return result.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3).split(" -> ").pop() ?? "");
};

const main = (): void => {
  const [, , ...args] = process.argv;
  const checkOnly = args.includes("--check");
  const allowDirty = args.includes("--allow-dirty");
  // The filter is positional and optional, so flags and filter must be read
  // separately: `--check` alone is not a filter for the seam named "--check".
  const filter = args.find((arg) => !arg.startsWith("--"));
  const selected = selectMutations(filter);
  // Before anything else, including `--check`: a leftover mutation reads as a
  // stale anchor, and the honest fix is to put the file back, not to report a
  // seam that moved.
  const healed = healJournal();
  if (healed !== null) {
    console.log(
      `recovered a mutation left by a killed run: ${healed} restored from ${JOURNAL.slice(ROOT.length + 1)}`
    );
  }

  if (checkOnly) {
    const stale = preflight(selected);
    if (stale.length === 0) {
      console.log(`all ${selected.length} seam anchor(s) resolve`);
    }
    process.exit(stale.length > 0 ? 1 : 0);
  }

  if (!allowDirty) {
    const dirty = dirtySeamFiles(selected);
    if (dirty.length > 0) {
      console.error(
        `refusing to run: ${dirty.length} seam file(s) are already dirty:\n${dirty
          .map((file) => `  ${file}`)
          .join(
            "\n"
          )}\n\nThe seam would be scored against a file that is not the one its anchor describes. Pass --allow-dirty when the edit is yours; if it is not, restore it (git checkout -- <path>).`
      );
      process.exit(1);
    }
  }

  const stale = preflight(selected);
  if (stale.length > 0) {
    process.exit(1);
  }

  console.log(
    `mutation gate: ${selected.length} seam(s). A PASS means the mutation was CAUGHT (the tests failed).\n`
  );
  const outcomes = selected.map((mutation) => {
    process.stdout.write(`- ${mutation.id}\n`);
    return evaluate(mutation);
  });
  console.log("");
  report(outcomes);
};

main();
