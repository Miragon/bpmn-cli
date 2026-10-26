export function nonEmpty(text: string | undefined): text is string {
  return typeof text === 'string' && text.trim() !== '';
}
