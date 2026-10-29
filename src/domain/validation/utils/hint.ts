/** Quotes a shell argument when the shell would interpret it (a `<placeholder>` stays as it is). */
export function sh(arg: string): string {
  return /^[A-Za-z0-9_.:=,/@+-]*(<[a-zA-Z]+>)?$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** `<slot><first argument>` shell-quoted (`'definition[1].camunda:field'`), the rest as is. */
export function slotted(slot: string, args: string): string {
  const space = args.indexOf(' ');
  return space === -1 ? sh(`${slot}${args}`) : `${sh(`${slot}${args.slice(0, space)}`)}${args.slice(space)}`;
}

export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Levenshtein distance, case-insensitive. */
function distance(left: string, right: string): number {
  const source = left.toLowerCase();
  const target = right.toLowerCase();
  const row = Array.from({ length: target.length + 1 }, (_entry, targetIndex) => targetIndex);
  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex++) {
    let prev = row[0]!;
    row[0] = sourceIndex;
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex++) {
      const tmp = row[targetIndex]!;
      row[targetIndex] = Math.min(row[targetIndex]! + 1, row[targetIndex - 1]! + 1, prev + (source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[target.length]!;
}

/** The closest candidate within a small edit distance, preferring `preferred`. */
export function didYouMean(name: string, candidates: string[], preferred: string[] = []): string | undefined {
  const limit = Math.max(1, Math.floor(name.length / 4));
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of [...preferred, ...candidates]) {
    const dist = distance(name, candidate);
    if (dist <= limit && (!best || dist < best.distance)) {
      best = { candidate, distance: dist };
    }
  }
  return best?.candidate;
}
