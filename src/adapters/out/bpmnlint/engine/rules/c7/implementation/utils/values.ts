/** Whether `text` holds more than whitespace. */
export function nonEmpty(text: string | undefined): text is string {
  return typeof text === 'string' && text.trim() !== '';
}

/** Whether `value` is a plain integer, as the engines parse a priority. */
export function isInteger(value: string): boolean {
  return /^[+-]?\d+$/.test(value);
}

/** Whether `value` holds a JUEL expression (`${...}` or `#{...}`). */
export function isExpression(value: string): boolean {
  return /[$#]\{/.test(value);
}
