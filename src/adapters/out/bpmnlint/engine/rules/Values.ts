/** XML 1.0 fifth edition: what the schema's xsd:ID allows. */
const NCNAME_START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const NCNAME = new RegExp(`^[${NCNAME_START}][${NCNAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, 'u');

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

  /** Whether `id` is an XML NCName, as the schema's xsd:ID takes it. */
  static isNcName(id: string): boolean {
    return NCNAME.test(id);
  }
}
