import type { BpmnError, Finding } from '../../api/index.js';

export class ErrorText {
  constructor(private readonly error: BpmnError) {}

  private static issueLine({ validator, code, element, message, hint }: Finding): string {
    return `  ${validator ? `[${validator}] ` : ''}${code}${element ? ` ${element}` : ''}: ${message}${hint ? `  (${hint})` : ''}`;
  }

  private static listLine(title: string, items: unknown): string[] {
    return Array.isArray(items) && items.length ? [`  ${title}: ${items.join(', ')}`] : [];
  }

  text(): string {
    const { code, message, details } = this.error;
    return [
      `error ${code}: ${message}`,
      ...(details.element ? [`  element: ${details.element}`] : []),
      ...ErrorText.listLine('related', details.related),
      ...ErrorText.listLine('candidates', details.candidates),
      ...(Array.isArray(details['errors']) ? (details['errors'] as Finding[]).map(ErrorText.issueLine) : []),
      ...(Array.isArray(details['warnings']) ? (details['warnings'] as string[]).map((warning) => `  ${warning}`) : []),
      ...(details.op === undefined ? [] : [`  op: #${details.op}`]),
      ...(details.hint ? [`  hint: ${details.hint}`] : []),
    ].join('\n');
  }
}
