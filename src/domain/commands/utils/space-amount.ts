/** `row`, `<n>col(umns)`, `<n>rows` count grid steps; `<n>px` or `<n>` pixels; `-` closes. */
export function parseSpaceAmount(value: unknown): { count: number; unit: 'column' | 'row' | 'px' } | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value !== 0 ? { count: value, unit: 'px' } : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const match = /^\s*(-?)\s*(\d*)\s*(px|cols?|columns?|rows?)?\s*$/i.exec(value);
  if (!match || (!match[2] && (!match[3] || /^px$/i.test(match[3])))) {
    return undefined;
  }
  const count = (match[1] ? -1 : 1) * (match[2] ? Number(match[2]) : 1);
  if (count === 0) return undefined;
  const unit = !match[3] || /^px$/i.test(match[3]) ? 'px' : /^col/i.test(match[3]) ? 'column' : 'row';
  return { count, unit };
}
