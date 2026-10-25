/** Optimal string alignment (adjacent transpositions count once); small strings only. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

export function typoTolerance(length: number): number {
  return length >= 12 ? 2 : length >= 5 ? 1 : 0;
}

export function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}

/** kebab-case / snake_case / wrong-case spellings and small typos of an allowed key. */
export function closestKey(key: string, allowed: readonly string[]): string | undefined {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(key);
  const exact = allowed.find((k) => norm(k) === n) ?? allowed.find((k) => norm(k).startsWith(n) || n.startsWith(norm(k)));
  if (exact || !n) return exact;
  let best: string | undefined;
  let bestD = Infinity;
  for (const k of allowed) {
    const d = editDistance(n, norm(k));
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  }
  return bestD <= (n.length >= 5 ? 2 : 1) ? best : undefined;
}
