import { type BpmnElement, ElementText, type Finding, Kinds, type Suggestion, type ValidatorSeverity } from '../../model/index.js';

interface Extra {
  related?: string[];
  hint?: string;
  fix?: Suggestion;
}

export class StructureFindings {
  readonly all: Finding[] = [];

  error(code: string, message: string, element: string | undefined, extra: Extra = {}): void {
    this.add('error', code, message, element, extra);
  }

  warning(code: string, message: string, element: string | undefined, extra: Extra = {}): void {
    this.add('warning', code, message, element, extra);
  }

  nameOf(element: BpmnElement): string | undefined {
    const name = element.peek<string>('name');
    return name ? String(name) : undefined;
  }

  describe(element: BpmnElement): string {
    const name = this.nameOf(element);
    return `${Kinds.label(element)} ${ElementText.shownId(element)}${name ? ` "${name}"` : ''}`;
  }

  private add(severity: ValidatorSeverity, code: string, message: string, element: string | undefined, { related, hint, fix }: Extra): void {
    this.all.push({ code, message, severity, ...(element ? { element } : {}), ...(related?.length ? { related } : {}), ...(hint ? { hint } : {}), ...(fix ? { fix } : {}) });
  }
}
