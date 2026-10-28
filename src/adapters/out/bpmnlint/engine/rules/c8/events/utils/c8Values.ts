/** A FEEL expression: the value starts with `=`. */
export function isFeel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().startsWith('=');
}

/** No value at all: Camunda 8 refuses a missing or empty name or code, but not one of white space. */
export function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** No value or only white space. */
export function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}
