import { modelError } from '../../shared/utils/errors.js';
import type { El } from '../../model/utils/moddle.js';
import type { NestedHosts } from '../NestedHosts.js';

export interface Step {
  name: string;
  attr?: string;
  value?: string;
  index?: number;
  text: string;
}

/**
 * Parses extension selectors like `a:b[attr=value]/c:d[0]`; `[n]` is 0-based among the
 * matching siblings.
 */
export class SelectorParser {
  constructor(private readonly hosts: NestedHosts) {}

  parse(text: string, el: El): Step[] {
    const source = text.trim();
    const steps: Step[] = [];
    const nameRe = /[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*/y;
    let cursor = 0;
    for (;;) {
      nameRe.lastIndex = cursor;
      const match = nameRe.exec(source);
      if (!match) this.fail(text, `expected prefix:type at offset ${cursor}`, el);
      const start = cursor;
      const step: Step = { name: match[0], text: match[0] };
      cursor = nameRe.lastIndex;
      if (source[cursor] === '[') {
        let scan = cursor + 1;
        let quote: string | undefined;
        for (; scan < source.length; scan++) {
          const ch = source[scan]!;
          if (quote) {
            if (ch === quote) quote = undefined;
          } else if (ch === '"' || ch === "'") quote = ch;
          else if (ch === ']') break;
        }
        if (scan >= source.length) this.fail(text, 'unclosed [', el);
        const inner = source.slice(cursor + 1, scan).trim();
        if (/^\d+$/.test(inner)) step.index = Number(inner);
        else {
          const eq = inner.indexOf('=');
          if (eq <= 0) this.fail(text, `expected [attr=value] or [index], got [${inner}]`, el);
          step.attr = inner.slice(0, eq).trim();
          let attrValue = inner.slice(eq + 1).trim();
          if (attrValue.length >= 2 && (attrValue[0] === '"' || attrValue[0] === "'") && attrValue[attrValue.length - 1] === attrValue[0]) attrValue = attrValue.slice(1, -1);
          step.value = attrValue;
        }
        cursor = scan + 1;
        step.text = source.slice(start, cursor);
      }
      steps.push(step);
      if (cursor === source.length) return steps;
      if (source[cursor] !== '/') this.fail(text, `unexpected "${source[cursor]}" at offset ${cursor}`, el);
      cursor++;
    }
  }

  fail(text: string, why: string, el: El): never {
    throw modelError('E_INVALID_VALUE', `"${text}" is not a valid extension selector: ${why}`, {
      element: this.hosts.idOf(el),
      hint: "A selector is prefix:type, optionally with [attr=value] or [index], steps joined by '/', e.g. 'camunda:inputParameter[name=customerId]' or 'camunda:connector/camunda:inputOutput/camunda:inputParameter[name=url]'. Quote it in the shell.",
    });
  }
}
