/**
 * `${a && b}` -> ` a and b`: a starting point for FEEL (the hint asks to check it). Single-quoted
 * JUEL strings become double-quoted FEEL strings.
 */
export function feelOf(juel: string): string {
  const match = /^\s*[$#]\{([\s\S]*)\}\s*$/.exec(juel);
  const inner = (match ? match[1]! : juel).trim();
  const quoted = inner.replace(
    /'((?:[^'\\]|\\.)*)'/g,
    (_match, text: string) => `"${text.replace(/"/g, '\\"')}"`,
  );
  return ` ${quoted
    .replace(/&&/g, 'and')
    .replace(/\|\|/g, 'or')
    .replace(/==/g, '=')
    .replace(/!\s*\((?!=)/g, 'not(')
    .replace(/!(?!=)\s*([\w.]+)/g, 'not($1)')}`;
}
