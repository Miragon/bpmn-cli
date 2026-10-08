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
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** integer in [0, n) */
    int: (n) => Math.floor(next() * n),
    /** one element of the list, undefined for an empty list */
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    shuffle: (list) => {
      const a = [...list];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}

/** FNV-1a over the string forms of the parts. */
export function seedOf(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.map(String).join('\u0000')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
