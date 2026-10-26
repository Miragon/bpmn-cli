import type { Warning } from '../../shared/CliError.js';
import { kindLabel } from '../../model/utils/kinds.js';
import { peek, shownId, type El } from '../../model/utils/moddle.js';

type Extra = { related?: string[]; hint?: string };

/** The errors (block writes) and warnings (lint) one structural validation collects. */
export class StructureFindings {
  readonly errors: Warning[] = [];
  readonly warnings: Warning[] = [];

  error(code: string, message: string, element: string | undefined, extra: Extra = {}): void {
    StructureFindings.push(this.errors, code, message, element, extra);
  }

  warning(code: string, message: string, element: string | undefined, extra: Extra = {}): void {
    StructureFindings.push(this.warnings, code, message, element, extra);
  }

  nameOf(el: El): string | undefined {
    const name = peek<string>(el, 'name');
    return name ? String(name) : undefined;
  }

  /** `userTask Activity_X "name"` */
  describe(el: El): string {
    const name = this.nameOf(el);
    return `${kindLabel(el)} ${shownId(el)}${name ? ` "${name}"` : ''}`;
  }

  private static push(target: Warning[], code: string, message: string, element: string | undefined, extra: Extra): void {
    const finding: Warning = { code, message };
    if (element) finding.element = element;
    if (extra.related?.length) finding.related = extra.related;
    if (extra.hint) finding.hint = extra.hint;
    target.push(finding);
  }
}
