export function nonEmpty(v: string | undefined): v is string {
  return typeof v === 'string' && v.trim() !== '';
}
