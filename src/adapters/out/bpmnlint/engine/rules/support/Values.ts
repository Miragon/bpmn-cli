/** How the engines read a value the file writes as text. */
export class Values {
  /** Whether `text` holds more than white space. */
  static nonEmpty(text: unknown): text is string {
    return typeof text === 'string' && text.trim() !== '';
  }

  /** Whether a message or signal has a name as Camunda 8 reads it: white space counts, `''` does not. */
  static hasName(element: { name?: unknown } | undefined): boolean {
    return typeof element?.name === 'string' && element.name !== '';
  }

  /** A FEEL expression for Camunda 8: the value starts with `=` (after white space). */
  static isFeel(value: unknown): boolean {
    return typeof value === 'string' && value.trim().startsWith('=');
  }

  /** Whether `value` is a plain integer or holds a JUEL expression (`${...}` or `#{...}`), as the engines read a priority. */
  static isPriority(value: string): boolean {
    return /^[+-]?\d+$/.test(value) || /[$#]\{/.test(value);
  }
}
