import { EditDistance } from '../../../model/index.js';

export class NameSuggestion {
  closest(name: string, candidates: readonly string[], preferred: readonly string[] = []): string | undefined {
    const limit = Math.max(1, Math.floor(name.length / 4));
    let best: { candidate: string; distance: number } | undefined;
    for (const candidate of [...preferred, ...candidates]) {
      const distance = EditDistance.levenshtein(name.toLowerCase(), candidate.toLowerCase());
      if (distance <= limit && (!best || distance < best.distance)) {
        best = { candidate, distance };
      }
    }
    return best?.candidate;
  }
}
