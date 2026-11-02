import { RuleKit } from '../RuleKit.js';

/** The name a typo most likely meant. */
export class DidYouMean {
  /** The closest candidate within a small edit distance (a quarter of the name), preferring `preferred`. */
  static of(name: string, candidates: string[], preferred: string[] = []): string | undefined {
    const limit = Math.max(1, Math.floor(name.length / 4));
    let best: { candidate: string; distance: number } | undefined;
    for (const candidate of [...preferred, ...candidates]) {
      const distance = RuleKit.kit.levenshtein(name.toLowerCase(), candidate.toLowerCase());
      if (distance <= limit && (!best || distance < best.distance)) {
        best = { candidate, distance };
      }
    }
    return best?.candidate;
  }

  /** ` (did you mean <closest>?)`, or '' without a close candidate. */
  static suggestion(name: string, candidates: string[]): string {
    const guess = DidYouMean.of(name, candidates);
    return guess ? ` (did you mean ${guess}?)` : '';
  }
}
