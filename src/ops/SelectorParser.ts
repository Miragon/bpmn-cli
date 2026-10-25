import { modelError } from '../shared/utils/errors.js';
import type { El } from '../model/utils/moddle.js';
import type { NestedHosts } from './NestedHosts.js';

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
    const s = text.trim();
    const steps: Step[] = [];
    const nameRe = /[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*/y;
    let i = 0;
    for (;;) {
      nameRe.lastIndex = i;
      const m = nameRe.exec(s);
      if (!m) this.fail(text, `expected prefix:type at offset ${i}`, el);
      const start = i;
      const step: Step = { name: m[0], text: m[0] };
      i = nameRe.lastIndex;
      if (s[i] === '[') {
        let j = i + 1;
        let quote: string | undefined;
        for (; j < s.length; j++) {
          const ch = s[j]!;
          if (quote) {
            if (ch === quote) quote = undefined;
          } else if (ch === '"' || ch === "'") quote = ch;
          else if (ch === ']') break;
        }
        if (j >= s.length) this.fail(text, 'unclosed [', el);
        const inner = s.slice(i + 1, j).trim();
        if (/^\d+$/.test(inner)) step.index = Number(inner);
        else {
          const eq = inner.indexOf('=');
          if (eq <= 0) this.fail(text, `expected [attr=value] or [index], got [${inner}]`, el);
          step.attr = inner.slice(0, eq).trim();
          let v = inner.slice(eq + 1).trim();
          if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
          step.value = v;
        }
        i = j + 1;
        step.text = s.slice(start, i);
      }
      steps.push(step);
      if (i === s.length) return steps;
      if (s[i] !== '/') this.fail(text, `unexpected "${s[i]}" at offset ${i}`, el);
      i++;
    }
  }

  fail(text: string, why: string, el: El): never {
    throw modelError('E_INVALID_VALUE', `"${text}" is not a valid extension selector: ${why}`, {
      element: this.hosts.idOf(el),
      hint: "A selector is prefix:type, optionally with [attr=value] or [index], steps joined by '/', e.g. 'camunda:inputParameter[name=customerId]' or 'camunda:connector/camunda:inputOutput/camunda:inputParameter[name=url]'. Quote it in the shell.",
    });
  }
}
