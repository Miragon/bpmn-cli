export function textValue(value: unknown): string | undefined {
  if (value === undefined || value === null || typeof value === 'object') return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}
