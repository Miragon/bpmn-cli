import type { El } from '../../../../model/utils/moddle.js';
import { peek } from '../../utils/element.js';
import { nonEmpty } from '../../utils/value.js';

/** No value or only white space. */
export function blank(value: string | undefined): boolean {
  return !nonEmpty(value);
}

/**
 * No value at all: Camunda 8 refuses a missing or empty name, job type, code,
 * process / decision id or result variable, but deploys one of white space (8.9.22).
 */
export function missing(value: string | undefined): boolean {
  return value === undefined || value === null || value === '';
}

/** A FEEL expression: the value starts with `=`. */
export function isFeel(value: string | undefined): boolean {
  return value !== undefined && value.trim().startsWith('=');
}

/** `${a && b}` -> ` a and b` (a starting point for FEEL; the hint asks to check it). */
export function feelOf(juel: string): string {
  const match = /^\s*[$#]\{([\s\S]*)\}\s*$/.exec(juel);
  const inner = (match ? match[1]! : juel).trim();
  // JUEL strings may be single-quoted, FEEL strings are double-quoted
  const quoted = inner.replace(/'((?:[^'\\]|\\.)*)'/g, (_m, text: string) => `"${text.replace(/"/g, '\\"')}"`);
  return ` ${quoted.replace(/&&/g, 'and').replace(/\|\|/g, 'or').replace(/==/g, '=').replace(/!\s*\((?!=)/g, 'not(').replace(/!(?!=)\s*([\w.]+)/g, 'not($1)')}`;
}

/** The name as written, or undefined when there is none (unlike nameOf, white space is a name). */
export function nameAttr(el: El | undefined): string | undefined {
  const name = peek<string>(el, 'name');
  return typeof name === 'string' && name !== '' ? name : undefined;
}
