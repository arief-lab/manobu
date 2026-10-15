/*
 * Numbers module (spec §SCR-08 MaYa9).
 *
 *   - 0..100 (cardinal)
 *   - counters 一つ / 二人 / 三枚 (generic, people, flat-things)
 *   - Time + Price contexts
 *
 *   The 1..10 counters follow the standard system:
 *     一つ/二人/三人 (people) — 一人/二人 can also mean "1/2 people" with
 *     ふりがな ひとり/ふたり. For lesson display we use the long form
 *     (hitotsu/futatsu/...) for generic and 人 counter for people.
 */

export const CARDINALS: Readonly<Record<number, string>> = {
  0: "ゼロ / 零",
  1: "一 (いち)",
  2: "二 (に)",
  3: "三 (さん)",
  4: "四 (よん / し)",
  5: "五 (ご)",
  6: "六 (ろく)",
  7: "七 (なな / しち)",
  8: "八 (はち)",
  9: "九 (きゅう / く)",
  10: "十 (じゅう)",
};

export const I1_TO_10: Readonly<Record<number, string>> = {
  1: "一つ (ひとつ)",
  2: "二つ (ふたつ)",
  3: "三つ (みっつ)",
  4: "四つ (よっつ)",
  5: "五つ (いつつ)",
  6: "六つ (むっつ)",
  7: "七つ (ななつ)",
  8: "八つ (やっつ)",
  9: "九つ (ここのつ)",
  10: "十 (とお)",
};

export const PEOPLE: Readonly<Record<number, string>> = {
  1: "一人 (ひとり)",
  2: "二人 (ふたり)",
  3: "三人 (さんにん)",
  4: "四人 (よにん)",
  5: "五人 (ごにん)",
  6: "六人 (ろくにん)",
  7: "七人 (ななにん / しちにん)",
  8: "八人 (はちにん)",
  9: "九人 (きゅうにん)",
  10: "十人 (じゅうにん)",
};

export const FLAT: Readonly<Record<number, string>> = {
  1: "一枚 (いちまい)",
  2: "二枚 (にまい)",
  3: "三枚 (さんまい)",
  4: "四枚 (よんまい)",
  5: "五枚 (ごまい)",
  6: "六枚 (ろくまい)",
  7: "七枚 (ななまい)",
  8: "八枚 (はちまい)",
  9: "九枚 (きゅうまい)",
  10: "十枚 (じゅうまい)",
};

export const formatPrice = (n: number, yen = "円"): string =>
  `${n.toLocaleString("ja-JP")}${yen}`;

export const formatTime = (hour: number, minute: number): string => {
  const h = `${hour}時`.replace("0", "零");
  const m = minute === 0 ? "" : `${minute}分`;
  return `${h}${m}`;
};
