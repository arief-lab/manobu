/*
 * Practice-day log (TASK-60 / doc-10 R5) — the data behind the dashboard's
 * honest momentum line. Deliberately MINIMAL: one localStorage key holding
 * ISO dates (YYYY-MM-DD) on which the user completed any practice
 * activity. No card data, no durations, no streak logic — the anti-pattern
 * catalog (nihongoai-spec-v1.md) bans streak mechanics and guilt copy, so
 * the momentum line reports facts ("practiced 4 of the last 7 days"),
 * never obligations.
 *
 * Cards-learned counts need the revlog wiring (v1 runs on seed data);
 * until that lands the momentum line shows practice-days only.
 */

const STORAGE_KEY = "manobu.practiceDays";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const load = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (d): d is string => typeof d === "string" && ISO_DATE_RE.test(d)
      );
    }
  } catch {
    // private mode / corrupt blob — fall through to empty
  }
  return [];
};

/** Record that practice happened today (idempotent per day). */
export const recordPracticeDay = (): void => {
  try {
    const days = new Set(load());
    days.add(todayIso());
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...days].sort()));
  } catch {
    // best-effort; in-memory consumers still work this session
  }
};

/** Count of practice days within the trailing N days (inclusive of today). */
export const practicedDaysOfLast = (n = 7): number => {
  const days = new Set(load());
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (days.has(d.toISOString().slice(0, 10))) {
      count += 1;
    }
  }
  return count;
};

/** Per-day truth for the trailing N days, oldest first — the momentum
 * strip renders these directly (label + practiced flag). `iso` is the
 * stable key (weekday letters repeat). `today` marks the live day so
 * the strip can carry the 朱 seal on "now" (DESIGN.md: shu = the mark,
 * ai = the work done). Same UTC convention as storage. */
export const lastDaysFlags = (
  n = 7
): { iso: string; label: string; practiced: boolean; today: boolean }[] => {
  const days = new Set(load());
  const nowIso = todayIso();
  const out: {
    iso: string;
    label: string;
    practiced: boolean;
    today: boolean;
  }[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push({
      iso,
      label: d.toLocaleDateString("en-US", { weekday: "narrow" }),
      practiced: days.has(iso),
      today: iso === nowIso,
    });
  }
  return out;
};

export const __test__ = { STORAGE_KEY, todayIso };
