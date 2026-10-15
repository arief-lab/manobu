/*
 * Roleplay scenes (SCR-07 redesign data).
 *
 * A scene is a short, bounded exchange — you meet someone and produce
 * Japanese under a constraint. Three turns, then the transcript. Never
 * an endless thread (spec §SCR-07).
 *
 * Clerk lines are `Sentence`s from the reader's data model: `jp` is the
 * face, `words` are hand-authored dictionary entries, `en` is the gloss
 * the learner ASKS FOR. That means the shared TokenText coverage ladder
 * (story word → particle table → kana mora → kanji link) works on roleplay
 * text exactly as it does on reading text — tap anything, always get at
 * least a reading.
 *
 * `sensei` is the polished form of the SAME act. It is never shown up
 * front (that was the old bug — the input placeholder printed the answer).
 * It appears under your bubble only after you produce something flatter
 * than it, so contrast is feedback you earned, not a poster on the wall.
 */

import type { JlptLevel } from "@manobu/api-contract";
import type { Sentence, Word } from "@/lib/reader-stories";

/** Hand-authored clerk vocabulary — roleplay scenes are their own theme. */
const w = (
  gloss: string,
  jp: string,
  level: JlptLevel,
  reading: string
): Word => ({ gloss, jp, level, reading, themes: ["roleplay"] });

export interface RoleplayLine {
  /** The other person's turn — tappable, playable, glossable. */
  clerk: Sentence;
  /** Particles the reply is expected to carry (drives the composer chips). */
  requiredParticles: readonly string[];
  /** Polished form of the same act — revealed only as earned contrast. */
  sensei: string;
}

export interface RoleplayScene {
  blurb: string;
  icon: string;
  key: RoleplaySceneKey;
  level: JlptLevel;
  lines: RoleplayLine[];
  /** One honest line on the shelf card (the N2 keigo rule lives here). */
  note: string;
  title: string;
}

export type RoleplaySceneKey = "interview" | "konbini";

const KONBINI_LINES: RoleplayLine[] = [
  {
    clerk: {
      en: "Welcome! What would you like?",
      jp: "いらっしゃいませ！何になさいますか？",
      level: "N5",
      words: [
        w(
          "welcome! (to a customer)",
          "いらっしゃいませ",
          "N5",
          "いらっしゃいませ"
        ),
        w("what", "何", "N5", "なに"),
        w("do (polite)", "なさいます", "N5", "なさいます"),
      ],
    },
    requiredParticles: ["を", "ください"],
    sensei: "コーヒーをいただけますか？",
  },
  {
    clerk: {
      en: "That will be 100 yen.",
      jp: "100 円になります。",
      level: "N5",
      words: [w("yen", "円", "N5", "えん"), w("become", "なり", "N5", "なり")],
    },
    requiredParticles: ["を"],
    sensei: "お支払いします。",
  },
  {
    clerk: {
      en: "Here is your change. Thank you.",
      jp: "おつりです。ありがとうございました。",
      level: "N5",
      words: [
        w("change (money)", "おつり", "N5", "おつり"),
        w("is (polite)", "です", "N5", "です"),
        w("thanks", "ありがとう", "N5", "ありがとう"),
        w("was (polite)", "ございました", "N5", "ございました"),
      ],
    },
    requiredParticles: ["を", "は"],
    sensei: "どうもありがとうございました。",
  },
];

const INTERVIEW_LINES: RoleplayLine[] = [
  {
    clerk: {
      en: "Let us begin today's interview.",
      jp: "本日の面接を始めさせていただきます。",
      level: "N2",
      words: [
        w("today (formal)", "本日", "N2", "ほんじつ"),
        w("interview", "面接", "N2", "めんせつ"),
        w("begin", "始め", "N2", "はじめ"),
        w(
          "I humbly may do (for you)",
          "させていただきます",
          "N2",
          "させていただきます"
        ),
      ],
    },
    requiredParticles: ["を", "に"],
    sensei: "よろしくお願いいたします。",
  },
  {
    clerk: {
      en: "May I ask your reason for applying?",
      jp: "志望動機を伺ってもよろしいでしょうか。",
      level: "N2",
      words: [
        w("reason for applying", "志望動機", "N2", "しぼうどうき"),
        w("ask (humble)", "伺っ", "N2", "うかがっ"),
        w("is it alright?", "よろしい", "N2", "よろしい"),
        w("I wonder (polite)", "でしょうか", "N2", "でしょうか"),
      ],
    },
    requiredParticles: ["は", "を"],
    sensei: "御社で働かせていただきたく存じます。",
  },
  {
    clerk: {
      en: "Thank you for your time today.",
      jp: "本日はお時間をいただきありがとうございます。",
      level: "N2",
      words: [
        w("today (formal)", "本日", "N2", "ほんじつ"),
        w("your time (polite)", "お時間", "N2", "おじかん"),
        w("receive (humble)", "いただき", "N2", "いただき"),
        w("thanks", "ありがとう", "N5", "ありがとう"),
        w("to be (polite)", "ございます", "N2", "ございます"),
      ],
    },
    requiredParticles: ["に", "は"],
    sensei: "この度は誠にありがとうございました。",
  },
];

export const ROLEPLAY_SCENES: readonly RoleplayScene[] = [
  {
    blurb: "order and pay without switching to English",
    icon: "🏪",
    key: "konbini",
    level: "N5",
    lines: KONBINI_LINES,
    note: "です・ます is enough here",
    title: "the konbini",
  },
  {
    blurb: "say the same thing the way a hiring manager hears it",
    icon: "💼",
    key: "interview",
    level: "N2",
    lines: INTERVIEW_LINES,
    note: "strict 謙譲語: いただく / 申し上げる territory",
    title: "the interview",
  },
];

export const sceneForKey = (key: RoleplaySceneKey): RoleplayScene => {
  const scene = ROLEPLAY_SCENES.find((s) => s.key === key);
  if (!scene) {
    throw new Error(`unknown roleplay scene ${key}`);
  }
  return scene;
};

/** A roleplay line is a short sentence — 5s capture is bounded and ample. */
export const SPEAK_RECORD_MS = 5000;

/** The three rungs of the politeness ladder, labelled. Index = score. */
export const POLITENESS_RUNGS = ["flat", "polite", "keigo"] as const;
