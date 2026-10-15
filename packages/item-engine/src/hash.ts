/**
 * The package's deterministic ordering primitives.
 *
 * Both the paper's option order and the selector's new-bucket order come from
 * here, because the version this replaces was copy-pasted into two files and
 * one of the copies was quietly degenerate (TASK-135).
 *
 * The trap worth remembering: in a djb2-style accumulator the FINAL character's
 * code is the lowest-order term, so two inputs differing only in their last
 * character produce adjacent hashes and any order built on them is just that
 * character ascending. That is how the "seeded" option shuffle became the
 * identity and every generated paper answered A. The avalanche below exists to
 * destroy exactly that relationship.
 */

// biome-ignore-start lint/suspicious/noBitwiseOperators: a 32-bit avalanche and a 32-bit PRNG are bitwise by definition, and the float-only alternative is what produced TASK-135's identity ordering.

/**
 * 32-bit string hash with a murmur3 `fmix32` avalanche.
 *
 * `Math.imul` keeps the accumulator in int32 (the old `hash * 33 %
 * 2147483647` grew past 2^53 on any realistic id and was one multiplication
 * from `Infinity`). The finalizer matters as much as the arithmetic: without
 * it, inputs differing in a single character stay adjacent after hashing, so a
 * "per item" ordering silently degrades into a global one.
 */
export const hashString = (value: string): number => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 33) + value.charCodeAt(index)) | 0;
  }
  let mixed = hash;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x85_eb_ca_6b);
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 0xc2_b2_ae_35);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
};

/** mulberry32: small, fast, and fully deterministic for a given seed. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d_2b_79_f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

// biome-ignore-end lint/suspicious/noBitwiseOperators: see the start marker above

/**
 * A seeded Fisher-Yates over `[0..count)`.
 *
 * A permutation has to come from a generator, not from sorting keys: a sort
 * key that differs only in its last character orders by that character, which
 * is the defect this module exists to make impossible. One entry legitimately
 * draws the identity, so never assert a shuffle by checking that it moved.
 */
export const seededPermutation = (count: number, seed: number): number[] => {
  const order = Array.from({ length: count }, (_, index) => index);
  if (order.length < 2) {
    return order;
  }
  const random = seededRandom(seed);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    const held = order[index];
    const other = order[swapWith];
    if (held === undefined || other === undefined) {
      throw new Error("seeded permutation is out of range");
    }
    order[index] = other;
    order[swapWith] = held;
  }
  return order;
};
