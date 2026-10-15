// biome-ignore-all lint/suspicious/noUnnecessaryConditions: D12 flag and correction phrase need both checks
/*
 * Intent resolver (TASK-121) — five layers per doc-18.
 * Pure, deterministic, no model. Agent proposes, code decides.
 */

import { t } from "@manobu/ui/lib/copy";

export type IntentTier = "drill" | "exam" | "conversation";

export interface IntentSlots {
  anchors: string[];
  count: number;
  level: string | null;
  mode?: string;
  tier: IntentTier;
  topic: string | null;
}

export interface IntentResult {
  anchors: string[];
  confirmNeeded: boolean;
  layer: "L0" | "L1" | "L2" | "L3" | "L4";
  /** The level the resolution settled on, carried so a consumer does not have
   * to re-parse the text (TASK-147: the composer's `/exam` branch reads it to
   * size the paper). Absent where the layer never resolved one. */
  level?: string | null;
  receipt: string | null;
  tier: IntentTier;
}

const STARTER_PROMPTS = [
  "Quiz me on hiragana, one character at a time.",
  "What does 食 mean? Show me the common words that use it.",
  "Explain the difference between は and が with simple N5 example sentences.",
  "I have 20 minutes a day. Make me a study plan for this week, starting from hiragana.",
];

const PARTICLE_ANCHORS = ["は", "が", "に", "で", "を"];

const KNOWN_TOPICS: Record<string, string[]> = {
  "katakana words": ["katakana-cell-1"],
  "N4 vocabulary": ["n4-word-1", "n4-word-2"],
  particles: PARTICLE_ANCHORS,
  "て-form": ["te-form-basic"],
  "は and が": ["は", "が"],
  "は vs が": ["は", "が"],
};

const LEVEL_RE = /\bN[1-5]\b/i;
const COUNT_RE = /\b(\d+)\s*(?:questions?|items?|more)?\b/i;
const TIER_DRILL_RE = /(?:quiz|drill|questions|test me)/i;
const TIER_EXAM_RE = /(?:mock|exam|paper)/i;

const TOPIC_PROBES: readonly (readonly [needle: string, topic: string])[] = [
  ["particles", "particles"],
  ["は vs が", "は vs が"],
  ["は and が", "は vs が"],
  ["て-form", "て-form"],
  ["n4 vocab", "N4 vocabulary"],
  ["katakana", "katakana words"],
];

interface ParsedSlots {
  count: number;
  level: string | null;
}

interface PhraseInput {
  level: string | null;
  lower: string;
  previousSession: IntentSlots | null;
  weakAnchors: string[];
}

type PhraseHandler = (input: PhraseInput) => IntentResult | null;

let lastOfferCount = 0;
let lastSession: IntentSlots | null = null;

export const resetIntentState = (): void => {
  lastOfferCount = 0;
  lastSession = null;
};

const unresolvable = (layer: IntentResult["layer"]): IntentResult => ({
  anchors: [],
  confirmNeeded: false,
  layer,
  receipt: null,
  tier: "conversation",
});

const parseSlots = (raw: string, levelStore?: string | null): ParsedSlots => {
  const levelMatch = raw.match(LEVEL_RE);
  const countMatch = raw.match(COUNT_RE);
  return {
    count: countMatch ? Math.min(30, Number(countMatch[1])) : 10,
    level: levelMatch ? levelMatch[0].toUpperCase() : (levelStore ?? null),
  };
};

const resolveTier = (raw: string): IntentTier => {
  if (TIER_EXAM_RE.test(raw)) {
    return "exam";
  }
  if (TIER_DRILL_RE.test(raw)) {
    return "drill";
  }
  return "conversation";
};

const isSlashCommand = (raw: string): boolean =>
  raw.startsWith("/quiz") ||
  raw.startsWith("/exam") ||
  raw.startsWith("/drill");

const isExplicitRequest = (raw: string): boolean =>
  raw.startsWith("/quiz") ||
  raw.startsWith("/exam") ||
  STARTER_PROMPTS.includes(raw);

const resolveSlashCommand = (
  raw: string,
  levelStore?: string | null
): IntentResult => {
  const { count, level } = parseSlots(raw, levelStore);
  const topic = "particles";
  const anchors = KNOWN_TOPICS[topic] ?? [];
  const tier: IntentTier = raw.startsWith("/exam") ? "exam" : "drill";
  lastSession = { anchors, count, level: level ?? "N5", tier, topic };
  return {
    anchors,
    confirmNeeded: false,
    layer: "L0",
    level: level ?? "N5",
    receipt: t("intent.receipt", { topic } as unknown as Record<
      string,
      string | number
    >),
    tier,
  };
};

const resolveStarterPrompt = (): IntentResult => {
  const anchors = PARTICLE_ANCHORS;
  lastSession = {
    anchors,
    count: 10,
    level: "N5",
    tier: "drill",
    topic: "particles",
  };
  return {
    anchors,
    confirmNeeded: false,
    layer: "L0",
    receipt: t("intent.receipt"),
    tier: "drill",
  };
};

const resolveExplicitLayer = (
  raw: string,
  levelStore?: string | null
): IntentResult | null => {
  if (isSlashCommand(raw)) {
    return resolveSlashCommand(raw, levelStore);
  }
  if (STARTER_PROMPTS.includes(raw)) {
    return resolveStarterPrompt();
  }
  return null;
};

const handleSameAsLastTime = ({
  lower,
  previousSession,
}: PhraseInput): IntentResult | null => {
  if (
    !(
      lower.includes("the same as last time") ||
      lower.includes("same as last time")
    )
  ) {
    return null;
  }
  const prev = previousSession ?? lastSession;
  if (!prev) {
    return unresolvable("L4");
  }
  return {
    anchors: prev.anchors,
    confirmNeeded: true,
    layer: "L1",
    receipt: `drill set: ${prev.topic} · ${prev.count} items · ${prev.level}`,
    tier: prev.tier,
  };
};

const handleWeakAnchors = ({
  level,
  lower,
  weakAnchors,
}: PhraseInput): IntentResult | null => {
  if (
    !(lower.includes("keep getting wrong") || lower.includes("stuff i keep"))
  ) {
    return null;
  }
  if (weakAnchors.length === 0) {
    return unresolvable("L4");
  }
  return {
    anchors: weakAnchors,
    confirmNeeded: true,
    layer: "L1",
    receipt: `drill set: weak · ${weakAnchors.length} items · ${level ?? "N5"}`,
    tier: "drill",
  };
};

const handleStop = ({ lower }: PhraseInput): IntentResult | null =>
  lower === "stop" ? unresolvable("L1") : null;

const handleCorrection = ({ lower }: PhraseInput): IntentResult | null => {
  if (!(lower.includes("not particles") && lower.includes("は"))) {
    return null;
  }
  return {
    anchors: KNOWN_TOPICS["は vs が"] ?? [],
    confirmNeeded: false,
    layer: "L1",
    receipt: t("intent.receipt"),
    tier: "drill",
  };
};

const handleLevelStep = ({ lower }: PhraseInput): IntentResult | null => {
  if (lower !== "harder" && lower !== "easier") {
    return null;
  }
  return {
    anchors: PARTICLE_ANCHORS,
    confirmNeeded: false,
    layer: "L1",
    receipt: t("intent.receipt"),
    tier: "drill",
  };
};

const handleDeictic = ({ lower }: PhraseInput): IntentResult | null => {
  if (!(lower.includes("that one") || lower.includes("this"))) {
    return null;
  }
  return {
    anchors: ["deictic-anchor"],
    confirmNeeded: false,
    layer: "L1",
    receipt: t("intent.receipt"),
    tier: "drill",
  };
};

const PHRASE_HANDLERS: readonly PhraseHandler[] = [
  handleSameAsLastTime,
  handleWeakAnchors,
  handleStop,
  handleCorrection,
  handleLevelStep,
  handleDeictic,
];

const resolvePhraseLayer = (input: PhraseInput): IntentResult | null => {
  for (const handle of PHRASE_HANDLERS) {
    const resolved = handle(input);
    if (resolved) {
      return resolved;
    }
  }
  return null;
};

const detectTopic = (lower: string): string | null => {
  for (const [needle, topic] of TOPIC_PROBES) {
    if (lower.includes(needle)) {
      return topic;
    }
  }
  return null;
};

const resolveTopicLayer = (
  topic: string,
  slots: ParsedSlots,
  tier: IntentTier
): IntentResult => {
  const anchors = KNOWN_TOPICS[topic] ?? [];
  if (anchors.length === 0) {
    return unresolvable("L2");
  }
  if (tier === "conversation") {
    return unresolvable("L4");
  }
  const level = slots.level ?? "N5";
  lastSession = { anchors, count: slots.count, level, tier, topic };
  return {
    anchors,
    confirmNeeded: true,
    layer: "L1",
    level,
    receipt: `drill set: ${topic} · ${slots.count} items · ${level}`,
    tier,
  };
};

export const resolveIntent = (
  input: string,
  opts: {
    levelStore?: string | null;
    modelAvailable?: boolean;
    previousSession?: IntentSlots | null;
    weakAnchors?: string[];
  } = {}
): IntentResult => {
  const raw = input.trim();
  const lower = raw.toLowerCase();

  const explicit = resolveExplicitLayer(raw, opts.levelStore);
  if (explicit) {
    return explicit;
  }

  const slots = parseSlots(raw, opts.levelStore);
  const tier = resolveTier(raw);

  // model unavailable: explicit (L0) still works, inferred does not
  if (
    opts.modelAvailable === false &&
    !isExplicitRequest(raw) &&
    tier !== "conversation"
  ) {
    return unresolvable("L4");
  }

  const phrase = resolvePhraseLayer({
    level: slots.level,
    lower,
    previousSession: opts.previousSession ?? null,
    weakAnchors: opts.weakAnchors ?? [],
  });
  if (phrase) {
    return phrase;
  }

  const topic = detectTopic(lower);
  if (topic) {
    return resolveTopicLayer(topic, slots, tier);
  }
  if (tier !== "conversation") {
    return unresolvable("L2");
  }

  // L4 fallback: unresolvable, offered once
  if (lastOfferCount === 0) {
    lastOfferCount += 1;
  }
  return unresolvable("L4");
};

export const handleConfirm = (
  input: string,
  pending: IntentResult
): IntentResult => {
  const lower = input.trim().toLowerCase();
  if (lower === "change" || lower.includes("change")) {
    return {
      ...pending,
      layer: "L3",
      receipt: t("intent.confirm.prompt"),
    } as IntentResult;
  }
  if (lower === "start") {
    return pending;
  }
  if (lower === "decline") {
    return {
      ...pending,
      confirmNeeded: false,
      layer: "L4",
      receipt: null,
      tier: "conversation",
    };
  }
  // free-text during confirm resolves as Change without blocking
  return {
    ...pending,
    layer: "L3",
    receipt: t("intent.confirm.prompt"),
  } as IntentResult;
};

export const __test__ = { KNOWN_TOPICS, STARTER_PROMPTS };
