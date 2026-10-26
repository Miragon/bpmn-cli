/** Optimal string alignment (adjacent transpositions count once); small strings only. */
export function editDistance(left: string, right: string): number {
  const distances: number[][] = Array.from({ length: left.length + 1 }, (_row, rowIndex) => Array.from({ length: right.length + 1 }, (_column, columnIndex) => (rowIndex === 0 ? columnIndex : columnIndex === 0 ? rowIndex : 0)));
  for (let row = 1; row <= left.length; row++) {
    for (let column = 1; column <= right.length; column++) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      let distance = Math.min(distances[row - 1]![column]! + 1, distances[row]![column - 1]! + 1, distances[row - 1]![column - 1]! + cost);
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) distance = Math.min(distance, distances[row - 2]![column - 2]! + 1);
      distances[row]![column] = distance;
    }
  }
  return distances[left.length]![right.length]!;
}

export function typoTolerance(length: number): number {
  return length >= 12 ? 2 : length >= 5 ? 1 : 0;
}

export function levenshtein(left: string, right: string): number {
  const dp: number[][] = Array.from({ length: left.length + 1 }, (_row, rowIndex) => [rowIndex, ...Array<number>(right.length).fill(0)]);
  for (let column = 1; column <= right.length; column++) dp[0]![column] = column;
  for (let row = 1; row <= left.length; row++) {
    for (let column = 1; column <= right.length; column++) {
      dp[row]![column] = Math.min(dp[row - 1]![column]! + 1, dp[row]![column - 1]! + 1, dp[row - 1]![column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1));
    }
  }
  return dp[left.length]![right.length]!;
}

/** kebab-case / snake_case / wrong-case spellings and small typos of an allowed key. */
export function closestKey(key: string, allowed: readonly string[]): string | undefined {
  const norm = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedKey = norm(key);
  const exact = allowed.find((candidate) => norm(candidate) === normalizedKey) ?? allowed.find((candidate) => norm(candidate).startsWith(normalizedKey) || normalizedKey.startsWith(norm(candidate)));
  if (exact || !normalizedKey) return exact;
  let best: string | undefined;
  let bestD = Infinity;
  for (const candidate of allowed) {
    const distance = editDistance(normalizedKey, norm(candidate));
    if (distance < bestD) {
      best = candidate;
      bestD = distance;
    }
  }
  return bestD <= (normalizedKey.length >= 5 ? 2 : 1) ? best : undefined;
}
