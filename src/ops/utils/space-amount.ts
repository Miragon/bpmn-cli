/**
 * A `space` amount read: `column` / `row` (one), `<n>col`, `<n>column(s)`,
 * `<n>row(s)` (n steps of the drawing's grid; a space before the unit is
 * fine), `<n>px` or a bare integer (pixels); a leading `-` closes. Undefined
 * for anything else (0 included).
 */
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
