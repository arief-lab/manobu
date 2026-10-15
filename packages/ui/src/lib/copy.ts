/*
 * NihongoAI copy matrix (spec §Copy Matrix + §Sensei Voice).
 * i18n: every string is keyed `screen.element.state` for ICU plural translation.
 * Strings live here in EN — the runtime can swap to `de.json` etc. via `t()`.
 * German expansion buffer: +30% on every primary string.
 *
 * Voice rules (spec §Sensei Voice):
 *   warm-direct-humble
 *   "pattern not person" — corrections target the rule, not the learner
 *   every AI answer ends `Source: [DB ref] · [This may be wrong]`
 *   no confirmshaming — `Keep & adapt` not guilt copy
 *   no anthropomorphic manipulation — "I may be wrong" flag is mandatory
 */

export type CopyKey =
  // Review (SCR-12)
  | "review.empty"
  | "review.empty.first_run"
  | "review.save_toast"
  | "review.save_toast.error"
  | "review.optimize"
  | "review.optimize.fail"
  | "review.goal_switch"
  | "review.goal_switch.reset"
  // Errors (spec §Error pattern: What + Why + What to do)
  | "error.what"
  | "error.why"
  | "error.action"
  | "error.audio"
  | "error.disk_full"
  | "error.download"
  | "error.api_key"
  | "error.quota"
  | "error.offline"
  // Sensei (chat)
  | "sensei.source"
  | "sensei.may_be_wrong"
  | "chat.untitled"
  // JLPT Mock (SCR-10)
  | "mock.timer"
  | "mock.progress"
  | "mock.helper"
  | "mock.next"
  | "mock.score"
  | "mock.submit.fail"
  | "mock.mistakes"
  | "mock.start_plan"
  | "mock.skip.placement"
  // Settings (SCR-11, redesign TASK-76: learner voice, no spec dumps)
  | "set.tab.learning"
  | "set.tab.app"
  | "set.learning.retention.title"
  | "set.learning.retention.body"
  | "set.learning.retention.doubling_warn"
  | "set.learning.advanced"
  | "set.corr.title"
  | "set.corr.ask"
  | "set.corr.ask.desc"
  | "set.corr.tell"
  | "set.corr.tell.desc"
  | "set.voice.title"
  | "set.voice.body"
  | "set.level.title"
  | "set.level.body"
  | "set.goal.title"
  | "set.goal.body"
  | "set.privacy"
  | "set.about.shortcuts"
  | "set.about.offline"
  | "voice.varied"
  | "voice.female"
  | "voice.male"
  | "voice.no_output"
  | "app.model.title"
  | "app.model.body"
  | "app.speech.title"
  | "app.speech.body"
  | "app.desktop.only"
  // Review (SCR-12)
  | "review.header"
  | "review.badge"
  | "review.slider"
  | "review.batch"
  | "grade.again"
  | "grade.hard"
  | "grade.good"
  | "grade.easy"
  | "reset.confirm"
  // Kana checkpoint (doc-13 §8.1, TASK-118)
  | "kana.gate.offer"
  | "kana.gate.skip"
  | "kana.gate.source"
  | "kana.checkpoint.pass"
  | "kana.checkpoint.fail"
  | "kana.checkpoint.group"
  | "kana.checkpoint.cooldown"
  | "kana.checkpoint.queue"
  | "kana.result.review.title"
  | "kana.settings.reset"
  // Intent (doc-18 §10, TASK-121)
  | "intent.receipt"
  | "intent.confirm.start"
  | "intent.confirm.change"
  | "intent.confirm.prompt"
  | "intent.clarify.topic"
  | "intent.noAnchors"
  | "intent.correct.action"
  | "intent.correct.done"
  | "intent.degraded.model"
  | "drill.start"
  | "drill.verdict.correct"
  | "drill.verdict.wrong"
  | "drill.explain.action"
  | "drill.explain.generated"
  | "drill.skip"
  | "drill.stop"
  | "drill.next"
  | "drill.pending"
  | "drill.summary.counts"
  | "drill.summary.schedule"
  | "drill.summary.next"
  | "drill.suspended"
  | "paper.mode.shortened"
  | "paper.mode.examConditions"
  | "paper.mode.real"
  | "paper.build.exhausted"
  | "paper.build.failed"
  | "paper.build.ready"
  | "paper.build.running"
  | "paper.build.unfilled"
  | "paper.result.belowMark"
  | "paper.result.estimate"
  | "paper.result.markValue"
  | "paper.result.overall"
  | "paper.result.rawOnly"
  | "paper.result.reachesMark"
  | "paper.result.twoGates"
  | "paper.debrief.weak"
  | "paper.debrief.notSaved"
  | "paper.offline.seed"
  | "paper.offline.empty"
  | "exam.paused.composer"
  | "exam.pause.action"
  | "exam.pause.recorded"
  | "exam.section.submit"
  | "exam.section.timeUp"
  | "exam.timer.fiveMin"
  | "exam.timer.oneMin"
  | "exam.abandon.confirm"
  | "exam.abandon.done"
  | "exam.review.title"
  | "exam.review.yourPick"
  | "exam.review.answer"
  | "exam.review.anchor"
  | "exam.review.replay"
  | "exam.review.sendToDesk"
  | "exam.review.dispute"
  | "exam.collapse.toggle"
  | "exam.launch.action"
  | "exam.launch.daily.desc"
  | "exam.launch.daily.label"
  | "exam.launch.intent"
  | "exam.launch.level"
  | "exam.launch.real.desc"
  | "exam.launch.real.label"
  | "exam.launch.running"
  | "exam.launch.subtitle"
  | "exam.launch.title";

export interface Copy {
  edge?: string;
  error?: string;
  primary: string;
}

export const copy: Record<CopyKey, Copy> = {
  "app.desktop.only": {
    primary:
      "Model downloads, speech engines, and scheduled tasks run in the desktop app.",
  },
  "app.model.body": {
    primary:
      "Sensei answers come from your local model first, then your own API key, then a cached answer.",
  },
  "app.model.title": { primary: "Answer source" },
  "app.speech.body": {
    primary: "Offline speech models download on demand and are never bundled.",
  },
  "app.speech.title": { primary: "Speech and tasks" },
  "chat.untitled": { primary: "Untitled chat" },
  "drill.explain.action": { primary: "Why?" },
  "drill.explain.generated": { primary: "Generated explanation." },
  "drill.next": { primary: "Next" },
  "drill.pending": { primary: "Preparing the next one." },
  "drill.skip": { primary: "Skip" },
  "drill.start": {
    primary: "Starting a 10-question set on particles: say stop any time.",
  },
  "drill.stop": { primary: "Stop" },
  "drill.summary.counts": { primary: "{correct}/{asked}" },
  "drill.summary.next": { primary: "Next: {action}" },
  "drill.summary.schedule": { primary: "Next review: {when}" },
  "drill.suspended": {
    primary: "{answered}/{declared} paused. Resume or end?",
  },
  "drill.verdict.correct": { primary: "Correct." },
  "drill.verdict.wrong": { primary: "Not quite. The answer is {answer}." },
  "error.action": { primary: "What to do" },
  "error.api_key": {
    primary: "Key invalid: paste a 51-char key starting with sk-",
  },
  "error.audio": {
    primary: "Couldn't load audio: [Re-download] [Continue offline]",
  },
  "error.disk_full": {
    primary: "Out of disk space: [Free space] [Continue offline]",
  },
  "error.download": {
    primary: "Download interrupted: resume at {percent}% [Retry]",
  },
  "error.offline": {
    primary: "You're offline: cached lessons still work, AI disabled",
  },
  "error.quota": {
    primary: "Quota reached: switch to local model? [Use local] [Wait]",
  },
  "error.what": { primary: "What happened" },
  "error.why": { primary: "Why it matters" },
  "exam.abandon.confirm": {
    primary: "Abandon this paper? Nothing is scored.",
  },
  "exam.abandon.done": {
    primary: "Abandoned. It stays in your history.",
  },
  "exam.collapse.toggle": { edge: "Show chat", primary: "Hide chat" },
  "exam.launch.action": { primary: "Build paper" },
  "exam.launch.daily.desc": {
    primary: "A short mixed set of what you are due for, like the /ai quiz.",
  },
  "exam.launch.daily.label": { primary: "Daily practice" },
  "exam.launch.intent": { primary: "What kind of paper?" },
  "exam.launch.level": { primary: "Level" },
  "exam.launch.real.desc": {
    primary:
      "The official 大問 layout with Japanese section names. Some parts may not be askable yet.",
  },
  "exam.launch.real.label": { primary: "Real exam" },
  "exam.launch.running": { primary: "Building your paper." },
  "exam.launch.subtitle": {
    primary:
      "Pick a level and a kind, then the server assembles a fresh paper.",
  },
  "exam.launch.title": { primary: "Build a paper" },
  "exam.pause.action": { primary: "Pause" },
  "exam.pause.recorded": {
    primary:
      "Paused {count} {count, plural, one {time} other {times}}, {total} total.",
  },
  "exam.paused.composer": {
    primary: "Your paper is running. Questions unlock at submit.",
  },
  "exam.review.anchor": { primary: "Built from {anchor}" },
  "exam.review.answer": { primary: "Answer: {answer}" },
  "exam.review.dispute": { primary: "Report a wrong answer" },
  "exam.review.replay": { primary: "Try this one again" },
  "exam.review.sendToDesk": { primary: "Send these to the desk" },
  "exam.review.title": { primary: "Your answers" },
  "exam.review.yourPick": { primary: "You chose {answer}" },
  "exam.section.submit": { primary: "Submit section" },
  "exam.section.timeUp": { primary: "Time. Section submitted." },
  "exam.timer.fiveMin": {
    primary: "Five minutes left in this section.",
  },
  "exam.timer.oneMin": { primary: "One minute left." },
  "grade.again": { primary: "Again / {interval}d / fail · D↑ S↓" },
  "grade.easy": { primary: "Easy / {interval}d / pass strong · S++" },
  "grade.good": { primary: "Good / {interval}d / pass · S+" },
  "grade.hard": { primary: "Hard / {interval}d / pass weak · S+ small" },
  "intent.clarify.topic": { primary: "What should the questions be about?" },
  "intent.confirm.change": { primary: "Change" },
  "intent.confirm.prompt": {
    primary: "What should I change: topic, level, or length?",
  },
  "intent.confirm.start": { primary: "Start" },
  "intent.correct.action": { primary: "Not what I meant" },
  "intent.correct.done": { primary: "Changed to {receipt}." },
  "intent.degraded.model": {
    primary:
      "Running without the AI right now. Commands like /quiz 5 particles still work.",
  },
  "intent.noAnchors": {
    primary: "No N5 items on that topic. Nearest is {topic}. Use that?",
  },
  "intent.receipt": {
    primary: "drill set: particles (は, が, に, で) · 10 items · N5",
  },
  "kana.checkpoint.cooldown": { primary: "Next attempt available {date}." },
  "kana.checkpoint.fail": { primary: "{script}: not yet" },
  "kana.checkpoint.group": { primary: "Missed the {group} group" },
  "kana.checkpoint.pass": { primary: "{script}: passed" },
  "kana.checkpoint.queue": { primary: "Drill these cells" },
  "kana.gate.offer": {
    primary:
      "N5 papers are written in kana. About five minutes to check yours first.",
  },
  "kana.gate.skip": { primary: "I can read kana: skip this" },
  "kana.gate.source": { primary: "Reading shown from: {source}" },
  "kana.result.review.title": { primary: "Your answers" },
  "kana.settings.reset": { primary: "Reset kana admission" },
  "mock.helper": { primary: "Choose an answer to continue" },
  "mock.mistakes": { primary: "Review mistakes" },
  "mock.next": { primary: "Next →" },
  "mock.progress": { primary: "Q {n}/{total}" },
  "mock.score": {
    primary:
      "Score {pct}% · Weak: {pattern} ({wrong}/{total} wrong) → AI plan: 'Next 7 days: …' [Start plan] [Review mistakes]",
  },
  "mock.skip.placement": {
    primary:
      "Not sure? Real JLPT lets you start at any level: no prerequisites. Skip placement and jump straight to N3 practice.",
  },
  "mock.start_plan": { primary: "Start plan" },
  "mock.submit.fail": {
    primary:
      "Submit failed: FSRS write failed [Retry submit] · Progress saved locally",
  },
  // The mock clock counts UP (elapsedSeconds); "elapsed" is the honest
  // label. Do not revert to "remaining" — there is no per-question budget.
  "mock.timer": { primary: "⏱ {mm}:{ss} elapsed" },
  "paper.build.exhausted": {
    // TASK-148 AC#6: the level ran out of content the learner has not seen, so
    // they get the reason and both numbers instead of a silently shorter paper.
    // `contentExhausted` only ever reaches a receipt that is also short.
    primary:
      "Short paper: {validated}/{total} {total, plural, one {item} other {items}}. This level has no new questions left.",
  },
  "paper.build.failed": {
    primary: "The paper could not be built. Try again?",
  },
  "paper.build.ready": {
    // The size is in the sentence because the receipt knows it: TASK-156's rule
    // is that a paper is described with the number the host gave it, never with
    // a bare "ready".
    primary:
      "Paper ready: {total} {total, plural, one {item} other {items}}. It is in the conversation.",
  },
  "paper.build.running": {
    primary:
      "Building your paper. {n}/{total} {total, plural, one {item} other {items}} ready.",
  },
  "paper.build.unfilled": {
    // TASK-173.4: the real paper is short because whole 大問 of the official
    // shape ask for a kind of question the app cannot ask yet, either because no
    // item type exists for it or because the level has no content behind that
    // type. "Try again" would be false: the next attempt leaves the same hole.
    // So the sentence names the missing parts and points at the paper the app
    // can finish.
    primary:
      "Not a full paper: {validated}/{total} {total, plural, one {item} other {items}}. The app cannot ask these parts of a real paper yet: {missing}. A practice paper asks what it has.",
  },
  "paper.debrief.notSaved": {
    primary: "Your last result was not saved.",
  },
  "paper.debrief.weak": { primary: "Missed: {anchors}" },
  "paper.mode.examConditions": { primary: "exam conditions" },
  // Interim wording (TASK-173.1): the card has to say something about a paper
  // built in the new mode. The learner-facing name is TASK-173.2/173.3's call.
  "paper.mode.real": { primary: "real exam paper" },
  "paper.mode.shortened": { primary: "shortened paper" },
  "paper.offline.empty": {
    primary: "No built-in seed for this level",
  },
  "paper.offline.seed": {
    primary:
      "Built-in seed · {validated}/{total} {total, plural, one {item} other {items}} ready offline",
  },
  "paper.result.belowMark": {
    primary: "Below the mark",
  },
  "paper.result.estimate": {
    primary:
      "This score is an estimate from your answers, not the official JLPT result or a pass prediction.",
  },
  "paper.result.markValue": {
    primary: "mark {mark}",
  },
  "paper.result.overall": {
    primary: "Overall {score}/{max}",
  },
  "paper.result.rawOnly": {
    primary: "Shortened paper: item counts only.",
  },
  "paper.result.reachesMark": {
    primary: "Reaches the mark",
  },
  "paper.result.twoGates": {
    primary: "Total {total}/{max} against {mark}, plus each section.",
  },
  "reset.confirm": {
    primary:
      "This will delete {n} cards and progress. Cannot be undone. [Export backup] Type RESET to confirm [Delete]",
  },
  "review.badge": { primary: "Smart spacing · Advanced ▸" },
  "review.batch": {
    primary: "{hidden} hidden · Finish batch to see more",
  },
  "review.empty": {
    edge: "Review unlocks after your first lesson",
    primary: "No cards due · great work! Your next review is in {duration}",
  },
  "review.empty.first_run": {
    primary: "No cards due · great work!",
  },
  "review.goal_switch": {
    primary: "Keep {n} words, add {m} grammar · SRS preserved",
  },
  "review.goal_switch.reset": {
    primary: "Reset requires typing RESET",
  },
  "review.header": {
    primary:
      "Review · FSRS · Due at R ≤ {pct}% · {due} {due, plural, one {card} other {cards}} due · {total} total",
  },
  "review.optimize": {
    primary: "Trains smart spacing on your history",
  },
  "review.optimize.fail": {
    primary: "<400 reviews · using defaults (better than SM-2) [Learn more]",
  },
  "review.save_toast": {
    primary: "Saved to FSRS · next at R≤90% in {n}d [Undo 5s]",
  },
  "review.save_toast.error": {
    primary: "Couldn't save: [Retry] [Export backup]",
  },
  "review.slider": {
    primary: "Desired Retention: the one knob to tune · {pct}%",
  },
  "sensei.may_be_wrong": {
    primary: "This may be wrong · see Grammar DB {ref}",
  },
  "sensei.source": { primary: "Source: {ref}" },
  "set.about.offline": {
    primary: "Everything runs offline. Your data stays on this computer.",
  },
  "set.about.shortcuts": {
    primary:
      "Shortcuts · Ctrl+Enter grade Good · 1/2/3/4 grade buttons · Esc exit",
  },
  "set.corr.ask": { primary: "Ask first" },
  "set.corr.ask.desc": {
    primary:
      "Wrong answer? Sensei asks a hint question first. Only on the second miss you get the answer, with the source.",
  },
  "set.corr.tell": { primary: "Tell first" },
  "set.corr.tell.desc": {
    primary:
      "Wrong answer? Sensei corrects it right away and shows the rule. Faster, less thinking practice.",
  },
  "set.corr.title": { primary: "When you get it wrong" },
  "set.goal.body": {
    primary:
      "Lesson cards pick their face by goal: sound-first for travel and anime, read-first for work, word-first for JLPT.",
  },
  "set.goal.title": { primary: "Learning goal" },
  "set.learning.advanced": { primary: "Advanced (review scheduling)" },
  "set.learning.retention.body": {
    primary:
      "{pct}% target means about 1 in {slips} cards slips past you. Higher means more reviews per day.",
  },
  "set.learning.retention.doubling_warn": {
    primary: "At {pct}% you will see roughly twice the reviews you see at 90%.",
  },
  "set.learning.retention.title": {
    primary: "How challenging should reviews be?",
  },
  "set.level.body": {
    primary:
      "Which level drills, lessons, and reviews pull from. The kanji grid and mock filters follow it.",
  },
  "set.level.title": { primary: "JLPT level" },
  "set.privacy": {
    primary:
      "Telemetry is off by default. Export your data as a .json file, or reset everything (type RESET to confirm).",
  },
  "set.tab.app": { primary: "App" },
  "set.tab.learning": { primary: "Learning" },
  "set.voice.body": {
    primary:
      "Hear-it buttons use this voice. Varied mixes both, which trains your ear.",
  },
  "set.voice.title": { primary: "Sensei voice" },
  "voice.female": { primary: "♀ Female" },
  "voice.male": { primary: "♂ Male" },
  // No 🔇/🚫 glyph: the system emoji font renders the muted speaker as a RED
  // prohibition circle, which reads as breakage for an expected no-voice state
  // (TASK-171). The muted text treatment already carries the "info" tone.
  "voice.no_output": {
    primary: "No audio output · pitch diagrams + type fallback still work",
  },
  "voice.varied": { primary: "Varied ● recommended" },
};

/**
 * Pluralize via ICU MessageFormat-lite — `{n}` substitution +
 * `{n, plural, one {day} other {days}}`.
 * Real i18n library can be swapped in later; this keeps the dependency surface zero.
 */
export const pluralize = (n: number, one: string, other: string): string =>
  n === 1 ? one : other;

/**
 * One plural clause of the form `{count, plural, one {time} other {times}}`.
 * Both arms are literal text; the count itself stays a plain `{count}`
 * substitution, so no nested var is needed inside an arm.
 */
const PLURAL_CLAUSE = /\{(\w+), plural, one \{([^{}]*)\} other \{([^{}]*)\}\}/g;

/**
 * `other` is the fallback when the var is missing or is not a number: correct
 * for 0, and it never leaks the raw clause into the UI.
 */
const pluralizeClauses = (
  template: string,
  vars: Record<string, string | number>
): string =>
  template.replace(
    PLURAL_CLAUSE,
    (_clause: string, name: string, one: string, other: string) => {
      const count = vars[name];
      if (typeof count !== "number") {
        return other;
      }
      return pluralize(count, one, other);
    }
  );

export const t = (
  key: CopyKey,
  vars: Record<string, string | number> = {}
): string => {
  const c = copy[key];
  let s = pluralizeClauses(c.primary, vars);
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
};
