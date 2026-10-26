/**
 * Seeded pseudo-random numbers for the fuzzer.
 *
 * Contract: `rng(seed)` returns a mulberry32 stream; the same seed gives the same
 * sequence on every platform (32-bit integer arithmetic only). `seedOf(...parts)`
 * hashes strings / numbers into a 32-bit seed (FNV-1a), so a walk's seed can be
 * derived from the run seed, the model name and the walk index. Pure; no I/O.
 */

/** @param {number} seed */
export function rng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** integer in [0, n) */
    int: (bound) => Math.floor(next() * bound),
    /** one element of the list, undefined for an empty list */
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (probability) => next() < probability,
    shuffle: (list) => {
      const shuffled = [...list];
      for (let index = shuffled.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(next() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
      }
      return shuffled;
    },
  };
}

/** FNV-1a over the string forms of the parts. */
export function seedOf(...parts) {
  let hash = 0x811c9dc5;
  for (const ch of parts.map(String).join('\u0000')) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
