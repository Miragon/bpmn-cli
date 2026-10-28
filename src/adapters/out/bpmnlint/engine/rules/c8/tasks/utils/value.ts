/** A FEEL expression for Camunda 8: the value starts with `=` (after white space). */
export function isFeel(value: unknown): boolean {
  return typeof value === 'string' && value.trim().startsWith('=');
}

/** No value, or only white space. */
export function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/** Whether a message or signal has a name as Camunda 8 reads it: white space counts, `''` does not. */
export function hasName(element: { name?: unknown } | undefined): boolean {
  return typeof element?.name === 'string' && element.name !== '';
}
