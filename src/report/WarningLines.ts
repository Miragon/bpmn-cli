import type { Warning } from '../shared/CliError.js';
import { renderProblems } from './utils/result-lines.js';
import { FLOOD_MIN, floodKey, idsText, validatorOf, validatorTag, warningTag } from './utils/findings.js';

/** Codes whose every warning gets its own line: each hint is the command for that one element (a flood line keeps only the first). */
const NEVER_FLOOD = new Set(['W_FLOW_ID_STALE']);

/** What an advisory validator reports that is no rule of it: bpmn-cli's own codes about the validator and its configuration, the lint parse's import warnings. */
const NO_RULE = new Set(['W_LINT_UNAVAILABLE', 'W_LINT_FAILED', 'W_CONFIG_IGNORED', 'import-warning']);

export class WarningLines {
  constructor(private readonly advisory: ReadonlySet<string> = new Set()) {}

  /**
   * One `warning ...` line per warning; FLOOD_MIN or more of one code become one
   * line at the place of the first: `warning W_UNREACHABLE x20 [A, B, ...]: <the
   * first one's message>  (<its hint>)`. The NEVER_FLOOD codes stay one line
   * each; the findings of an `advisory` validator group by code and message.
   */
  lines(warnings: readonly Warning[]): string[] {
    const keyOf = (w: Warning): string => {
      const v = validatorOf(w);
      return v && this.advisory.has(v) ? `${warningTag(w)}${w.code}\n${w.message}` : floodKey(w);
    };
    const groups = new Map<string, Warning[]>();
    for (const w of warnings) groups.set(keyOf(w), [...(groups.get(keyOf(w)) ?? []), w]);
    const out: string[] = [];
    const done = new Set<string>();
    for (const w of warnings) {
      const key = keyOf(w);
      const group = groups.get(key)!;
      if (group.length < FLOOD_MIN || NEVER_FLOOD.has(w.code)) {
        out.push(WarningLines.warningLine(w));
        continue;
      }
      if (done.has(key)) continue;
      done.add(key);
      const ids = group.map((g) => g.element ?? '?');
      out.push(`warning ${warningTag(w)}${w.code} x${group.length} [${idsText(ids)}]: ${w.message}${w.hint ? `  (${w.hint})` : ''}`);
    }
    return out;
  }

  /**
   * validate's text of errors or warnings: renderProblems, but an error of an
   * `advisory` validator reads `[bpmnlint error]`, and FLOOD_MIN or more
   * findings of one of its rules with one hint are one line at the place of
   * the first: `[bpmnlint] <rule> x12 [ids]: <the most common message> (5 of
   * 12; 7 others with 3 other messages, --json lists them)  (<the hint>)`, the
   * ids those with that message. What bpmn-cli reports about the validator
   * itself and its configuration (W_LINT_UNAVAILABLE, W_LINT_FAILED,
   * W_CONFIG_IGNORED) and import warnings are no rule: one line each.
   */
  problems(problems: readonly Warning[]): string {
    const isAdvisory = (p: Warning): boolean => {
      const v = validatorOf(p);
      return !!v && this.advisory.has(v);
    };
    const keyOf = (p: Warning): string | undefined => {
      if (!isAdvisory(p) || NO_RULE.has(p.code)) return undefined;
      return `${validatorOf(p)}\n${p.code}\n${p.hint ?? ''}`;
    };
    const tag = (p: Warning): string => (isAdvisory(p) ? warningTag(p) : validatorTag(p));
    const groups = new Map<string, Warning[]>();
    for (const p of problems) {
      const key = keyOf(p);
      if (key) groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    const out: string[] = [];
    const done = new Set<string>();
    for (const p of problems) {
      const key = keyOf(p);
      const group = key ? groups.get(key)! : [p];
      if (group.length < FLOOD_MIN) {
        // `[bpmnlint error] <rule> ...` for an advisory validator's error: its rule names carry no E_ / W_
        out.push(isAdvisory(p) ? renderProblems([p]).replace(validatorTag(p), tag(p)) : renderProblems([p]));
        continue;
      }
      if (done.has(key!)) continue;
      done.add(key!);
      const byMessage = new Map<string, Warning[]>();
      for (const g of group) byMessage.set(g.message, [...(byMessage.get(g.message) ?? []), g]);
      const [message, same] = [...byMessage].reduce((a, b) => (b[1].length > a[1].length ? b : a));
      const others = byMessage.size - 1;
      const rest = group.length - same.length;
      const note = others ? ` (${same.length} of ${group.length}; ${rest} other${rest === 1 ? '' : 's'} with ${others} other message${others === 1 ? '' : 's'}, --json lists them)` : '';
      // one hint per group (the key): the line's hint is every finding's
      out.push(`${tag(p)}${p.code} x${group.length} [${idsText(same.map((g) => g.element ?? '?'))}]: ${message}${note}${p.hint ? `  (${p.hint})` : ''}`);
    }
    return out.join('\n');
  }

  private static warningLine(w: Warning): string {
    return `warning ${warningTag(w)}${w.code}${w.element ? ` ${w.element}` : ''}: ${w.message}${w.hint ? `  (${w.hint})` : ''}`;
  }
}
