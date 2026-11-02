export class EditDistance {
  static readonly CLOSE_FROM_LENGTH = 5;

  static transposing(left: string, right: string): number {
    const distances = EditDistance.table(left, right);
    for (let row = 1; row <= left.length; row++) {
      for (let column = 1; column <= right.length; column++) {
        distances[row]![column] = EditDistance.transposingCell(distances, left, right, row, column);
      }
    }
    return distances[left.length]![right.length]!;
  }

  static typoTolerance(length: number): number {
    if (length >= 12) {
      return 2;
    }
    return length >= EditDistance.CLOSE_FROM_LENGTH ? 1 : 0;
  }

  static levenshtein(left: string, right: string): number {
    const distances = EditDistance.table(left, right);
    for (let row = 1; row <= left.length; row++) {
      for (let column = 1; column <= right.length; column++) {
        distances[row]![column] = EditDistance.substitutionCell(distances, left, right, row, column);
      }
    }
    return distances[left.length]![right.length]!;
  }

  static closestKey(key: string, allowed: readonly string[]): string | undefined {
    const normalizedKey = EditDistance.normalized(key);
    const exact = allowed.find((candidate) => EditDistance.normalized(candidate) === normalizedKey) ?? allowed.find((candidate) => EditDistance.normalized(candidate).startsWith(normalizedKey) || normalizedKey.startsWith(EditDistance.normalized(candidate)));
    if (exact || !normalizedKey) {
      return exact;
    }
    let best: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of allowed) {
      const distance = EditDistance.transposing(normalizedKey, EditDistance.normalized(candidate));
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return bestDistance <= (normalizedKey.length >= EditDistance.CLOSE_FROM_LENGTH ? 2 : 1) ? best : undefined;
  }

  private static normalized(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private static table(left: string, right: string): number[][] {
    const firstRow = Array.from({ length: right.length + 1 }, (_column, column) => column);
    return [firstRow, ...Array.from({ length: left.length }, (_row, row) => [row + 1, ...new Array<number>(right.length).fill(0)])];
  }

  private static substitutionCell(distances: number[][], left: string, right: string, row: number, column: number): number {
    const cost = left[row - 1] === right[column - 1] ? 0 : 1;
    return Math.min(distances[row - 1]![column]! + 1, distances[row]![column - 1]! + 1, distances[row - 1]![column - 1]! + cost);
  }

  private static transposingCell(distances: number[][], left: string, right: string, row: number, column: number): number {
    const distance = EditDistance.substitutionCell(distances, left, right, row, column);
    const transposed = row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1];
    return transposed ? Math.min(distance, distances[row - 2]![column - 2]! + 1) : distance;
  }
}
