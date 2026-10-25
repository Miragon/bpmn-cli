export function textValue(v: unknown): string | undefined {
  if (v === undefined || v === null || typeof v === 'object') return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}
