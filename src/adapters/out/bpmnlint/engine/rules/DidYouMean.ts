/** The name a typo most likely meant. */
export class DidYouMean {
  /** The closest candidate within a small edit distance (a quarter of the name), preferring `preferred`. */
  static of(name: string, candidates: string[], preferred: string[] = []): string | undefined {
    const limit = Math.max(1, Math.floor(name.length / 4));
    let best: { candidate: string; distance: number } | undefined;
    for (const candidate of [...preferred, ...candidates]) {
      const distance = DidYouMean.distance(name, candidate);
      if (distance <= limit && (!best || distance < best.distance)) best = { candidate, distance };
    }
    return best?.candidate;
  }

  private static distance(left: string, right: string): number {
    const source = left.toLowerCase();
    const target = right.toLowerCase();
    const row = Array.from({ length: target.length + 1 }, (_entry, targetIndex) => targetIndex);
    for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex++) {
      let diagonal = row[0] ?? 0;
      row[0] = sourceIndex;
      for (let targetIndex = 1; targetIndex <= target.length; targetIndex++) {
        const above = row[targetIndex] ?? 0;
        const substitution = source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1;
        row[targetIndex] = Math.min(above + 1, (row[targetIndex - 1] ?? 0) + 1, diagonal + substitution);
        diagonal = above;
      }
    }
    return row[target.length] ?? 0;
  }
}
