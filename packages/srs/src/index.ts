export const DEFAULT_PARAMETERS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
] as const;

export const FSRS6_DECAY = 0.1542;

export interface MemoryState {
  difficulty: number;
  stability: number;
}

export interface ItemState {
  interval: number;
  memory: MemoryState;
}

export interface NextStates {
  again: ItemState;
  easy: ItemState;
  good: ItemState;
  hard: ItemState;
}

export type Grade = 1 | 2 | 3 | 4;

const D_MIN = 1;
const D_MAX = 10;
const S_MIN = 0.01;

const clamp = (v: number, min: number, max: number): number =>
  Math.min(Math.max(v, min), max);

export const currentRetrievability = (
  state: MemoryState,
  daysElapsed: number,
  decay: number = FSRS6_DECAY
): number => {
  const factor = 0.9 ** (1 / -decay) - 1;
  return ((daysElapsed / state.stability) * factor + 1) ** -decay;
};

const nextIntervalForStability = (
  stability: number,
  desiredRetention: number
): number => {
  const decay = FSRS6_DECAY;
  const factor = 0.9 ** (1 / -decay) - 1;
  // Inverse of forgetting curve: interval where R = desiredRetention
  const interval =
    (stability / factor) * (desiredRetention ** (1 / -decay) - 1);
  return interval;
};

const initStability = (rating: number): number => {
  // w0..w3 for new card Again/Hard/Good/Easy
  const w = DEFAULT_PARAMETERS;
  if (rating === 1) {
    return w[0];
  }
  if (rating === 2) {
    return w[1];
  }
  if (rating === 3) {
    return w[2];
  }
  return w[3];
};

const initDifficulty = (rating: number): number => {
  const w = DEFAULT_PARAMETERS;
  // Simplified mapping: D = 5 + offset per rating, clamped
  if (rating === 1) {
    return clamp(w[4], D_MIN, D_MAX);
  }
  if (rating === 2) {
    return clamp(w[4] - 1, D_MIN, D_MAX);
  }
  if (rating === 3) {
    return clamp(5, D_MIN, D_MAX);
  }
  return clamp(w[4] - 2, D_MIN, D_MAX);
};

const computeMemory = (
  previous: MemoryState,
  rating: Grade,
  daysElapsed: number
): MemoryState => {
  const w = DEFAULT_PARAMETERS;
  let hardPenalty = 1;
  if (rating === 1) {
    hardPenalty = 0.5;
  } else if (rating === 2) {
    hardPenalty = 0.8;
  }
  const easyBonus = rating === 4 ? 1.3 : 1;
  const stability =
    previous.stability *
    (1 + w[8] * (w[9] + (rating - 3) * 0.3)) *
    hardPenalty *
    easyBonus;
  let difficultyDelta = 0;
  if (rating === 1) {
    difficultyDelta = 1;
  } else if (rating === 4) {
    difficultyDelta = -1;
  }
  const difficulty =
    clamp(previous.difficulty + difficultyDelta * 0.2, D_MIN, D_MAX) || 5;
  const r = currentRetrievability(previous, daysElapsed);
  const adjustedStability = stability * (0.9 + r * 0.1);
  return {
    difficulty,
    stability: Math.max(adjustedStability, S_MIN),
  };
};

export const nextStates = (
  previous: MemoryState | null,
  desiredRetention: number,
  daysElapsed: number
): NextStates => {
  const mk = (rating: Grade): ItemState => {
    const memory =
      previous === null
        ? {
            difficulty: initDifficulty(rating),
            stability: initStability(rating),
          }
        : computeMemory(previous, rating, daysElapsed);
    const interval = nextIntervalForStability(
      memory.stability,
      desiredRetention
    );
    return { interval, memory };
  };

  return {
    again: mk(1),
    easy: mk(4),
    good: mk(3),
    hard: mk(2),
  };
};

export const capInterval = (interval: number, maxDays = 365): number =>
  Math.min(interval, maxDays);

/**
 * The whole days a card is actually scheduled for, and the one number the
 * desk's grade buttons and the server's `due` write must agree on (TASK-166).
 *
 * Floor, not round: the write adds this many days to today, so rounding up a
 * 2.6-day preview would promise a day the card never gets. Never below one
 * day: `cards.due` is day-granular (TASK-164) and the desk's session IS the
 * fetched due order, so a card scheduled for less than a day stays at the head
 * of the queue and the learner grades it twice.
 */
export const MIN_SCHEDULE_DAYS = 1;

export const scheduleDays = (interval: number): number =>
  Math.max(MIN_SCHEDULE_DAYS, Math.floor(capInterval(interval)));

/**
 * Whole days between a card's `due` and `now`, clamped at zero so an
 * early-served card is never treated as if time ran backwards.
 *
 * Lives here rather than in the server because both sides need the same
 * answer: the write turns it into FSRS stability growth, and the desk has to
 * assume the same elapsed time it previews an interval for (TASK-166 AC#2).
 * A preview computed at 0 days elapsed is systematically optimistic for an
 * overdue card.
 */
export const daysElapsedSince = (due: string, now: Date): number =>
  Math.max(
    0,
    Math.floor((now.getTime() - new Date(due).getTime()) / 86_400_000)
  );

export const applyLoadBalancer = (
  interval: number,
  dueCountMap: Map<string, number>,
  dueDateStr: string
): number => {
  // Simple load balancer: if due date has >20 cards, push +1 day
  const count = dueCountMap.get(dueDateStr) ?? 0;
  if (count > 20) {
    return interval + 1;
  }
  return interval;
};

/**
 * The interval each grade will schedule, in whole days: what the desk prints
 * on its buttons.
 *
 * Every branch runs through `scheduleDays`, the same arithmetic the server's
 * grade write uses (`apps/server/src/services/grading.ts`), because a preview
 * is a promise about a write. Two things that used to break that promise are
 * deliberately gone (TASK-166): a demo branch that returned a fixed
 * 1/4/12/28 for any stability near 10 at R=0.9, and a ±5% fuzz the writer
 * never applied. Both made the button a number the card would not get, and
 * the demo branch only fired at exactly one retention, so the preview jumped
 * discontinuously as the slider crossed 0.9.
 */
export const previewIntervals = (
  previous: MemoryState | null,
  desiredRetention: number,
  daysElapsed: number
): Record<Grade, number> => {
  const states = nextStates(previous, desiredRetention, daysElapsed);
  return {
    1: scheduleDays(states.again.interval),
    2: scheduleDays(states.hard.interval),
    3: scheduleDays(states.good.interval),
    4: scheduleDays(states.easy.interval),
  };
};

export const shouldMarkLeech = (lapses: number): boolean => lapses > 4;

export const snoozeDueDate = (currentDue: string, days: 1 | 3 | 7): string => {
  const d = new Date(currentDue);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export const vacationPause = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};
