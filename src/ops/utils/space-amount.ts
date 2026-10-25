/** `row`, `<n>col(umns)`, `<n>rows` count grid steps; `<n>px` or `<n>` pixels; `-` closes. */
export function parseSpaceAmount(value: unknown): { count: number; unit: 'column' | 'row' | 'px' } | undefined {
  if (typeof value === 'number') return Number.isInteger(value) && value !== 0 ? { count: value, unit: 'px' } : undefined;
  if (typeof value !== 'string') return undefined;
  const m = /^\s*(-?)\s*(\d*)\s*(px|cols?|columns?|rows?)?\s*$/i.exec(value);
  if (!m || (!m[2] && (!m[3] || /^px$/i.test(m[3])))) return undefined;
  const count = (m[1] ? -1 : 1) * (m[2] ? Number(m[2]) : 1);
  if (count === 0) return undefined;
  const unit = !m[3] || /^px$/i.test(m[3]) ? 'px' : /^col/i.test(m[3]) ? 'column' : 'row';
  return { count, unit };
}
