import { type BpmnElement, BpmnError } from '../../model/index.js';
import type { NestedHosts } from './NestedHosts.js';

export interface Step {
  name: string;
  attr?: string;
  value?: string;
  index?: number;
  text: string;
}

export class SelectorParser {
  constructor(private readonly hosts: NestedHosts) {}

  parse(text: string, el: BpmnElement): Step[] {
    const source = text.trim();
    const steps: Step[] = [];
    const nameRe = /[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*/y;
    let cursor = 0;
    for (;;) {
      nameRe.lastIndex = cursor;
      const match = nameRe.exec(source);
      if (!match) {
        this.fail(text, `expected prefix:type at offset ${cursor}`, el);
      }
      const start = cursor;
      const step: Step = { name: match[0], text: match[0] };
      cursor = nameRe.lastIndex;
      if (source[cursor] === '[') {
        const close = SelectorParser.closingBracket(source, cursor);
        if (close >= source.length) {
          this.fail(text, 'unclosed [', el);
        }
        this.readSelection(step, source.slice(cursor + 1, close).trim(), text, el);
        cursor = close + 1;
        step.text = source.slice(start, cursor);
      }
      steps.push(step);
      if (cursor === source.length) {
        return steps;
      }
      if (source[cursor] !== '/') {
        this.fail(text, `unexpected "${source[cursor]}" at offset ${cursor}`, el);
      }
      cursor++;
    }
  }

  private static closingBracket(source: string, open: number): number {
    let quote: string | undefined;
    for (let scan = open + 1; scan < source.length; scan++) {
      const ch = source[scan]!;
      if (quote) {
        quote = ch === quote ? undefined : quote;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ']') {
        return scan;
      }
    }
    return source.length;
  }

  private readSelection(step: Step, inner: string, text: string, el: BpmnElement): void {
    if (/^\d+$/.test(inner)) {
      step.index = Number(inner);
      return;
    }
    const eq = inner.indexOf('=');
    if (eq <= 0) {
      this.fail(text, `expected [attr=value] or [index], got [${inner}]`, el);
    }
    step.attr = inner.slice(0, eq).trim();
    step.value = SelectorParser.stripQuotes(inner.slice(eq + 1).trim());
  }

  private static stripQuotes(value: string): string {
    const isQuoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0];
    return isQuoted ? value.slice(1, -1) : value;
  }

  fail(text: string, why: string, el: BpmnElement): never {
    throw BpmnError.model('E_INVALID_VALUE', `"${text}" is not a valid extension selector: ${why}`, {
      element: this.hosts.idOf(el),
      hint: "A selector is prefix:type, optionally with [attr=value] or [index], steps joined by '/', e.g. 'camunda:inputParameter[name=customerId]' or 'camunda:connector/camunda:inputOutput/camunda:inputParameter[name=url]'. Quote it in the shell.",
    });
  }
}
