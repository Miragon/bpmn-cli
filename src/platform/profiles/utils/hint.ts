/** Quotes a shell argument when the shell would interpret it (a `<placeholder>` stays as it is). */
export function sh(arg: string): string {
  return /^[A-Za-z0-9_.:=,/@+-]*(<[a-zA-Z]+>)?$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** `<slot><first argument>` shell-quoted (`'definition[1].camunda:field'`), the rest as is. */
export function slotted(slot: string, args: string): string {
  const i = args.indexOf(' ');
  return i === -1 ? sh(`${slot}${args}`) : `${sh(`${slot}${args.slice(0, i)}`)}${args.slice(i)}`;
}

export function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Levenshtein distance, case-insensitive. */
function distance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const row = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (s[i - 1] === t[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[t.length]!;
}

/** The closest candidate within a small edit distance, preferring `preferred`. */
export function didYouMean(name: string, candidates: string[], preferred: string[] = []): string | undefined {
  const limit = Math.max(1, Math.floor(name.length / 4));
  let best: { c: string; d: number } | undefined;
  for (const c of [...preferred, ...candidates]) {
    const d = distance(name, c);
    if (d <= limit && (!best || d < best.d)) best = { c, d };
  }
  return best?.c;
}
