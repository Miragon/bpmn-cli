/** How the engines read a value the file writes as text. */
export class Values {
  /** Whether `text` holds more than white space. */
  static nonEmpty(text: unknown): text is string {
    return typeof text === 'string' && text.trim() !== '';
  }

  /** No value, or only white space. */
  static isBlank(value: unknown): boolean {
    return !Values.nonEmpty(value);
  }

  /** No value at all: Camunda 8 refuses a missing or empty name or code, but not one of white space. */
  static isMissing(value: unknown): boolean {
    return value === undefined || value === null || value === '';
  }

  /** Whether a message or signal has a name as Camunda 8 reads it: white space counts, `''` does not. */
  static hasName(element: { name?: unknown } | undefined): boolean {
    return typeof element?.name === 'string' && element.name !== '';
  }

  /** A FEEL expression for Camunda 8: the value starts with `=` (after white space). */
  static isFeel(value: unknown): boolean {
    return typeof value === 'string' && value.trim().startsWith('=');
  }

  /** Whether `value` is a plain integer, as the engines parse a priority. */
  static isInteger(value: string): boolean {
    return /^[+-]?\d+$/.test(value);
  }

  /** Whether `value` holds a JUEL expression (`${...}` or `#{...}`). */
  static isExpression(value: string): boolean {
    return /[$#]\{/.test(value);
  }
}
