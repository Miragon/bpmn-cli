/** How the engines read a value the file writes as text. */
export class Values {
  /** Whether `text` holds more than white space. */
  static nonEmpty(text: unknown): text is string {
    return typeof text === 'string' && text.trim() !== '';
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
