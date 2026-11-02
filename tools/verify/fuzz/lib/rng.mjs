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
    int: (bound) => Math.floor(next() * bound),
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

export function seedOf(...parts) {
  let hash = 0x811c9dc5;
  for (const ch of parts.map(String).join('\u0000')) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
