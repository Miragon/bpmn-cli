import type { Warning } from '../shared/CliError.js';
import { renderProblems } from './utils/result-lines.js';
import { FLOOD_MIN, floodKey, idsText, validatorOf, validatorTag, warningTag } from './utils/findings.js';

/** Never flooded: each hint is the command for that one element. */
const NEVER_FLOOD = new Set(['W_FLOW_ID_STALE']);

/** bpmn-cli's own codes about an advisory validator: not rules, one line each. */
const NO_RULE = new Set(['W_LINT_UNAVAILABLE', 'W_LINT_FAILED', 'W_CONFIG_IGNORED', 'import-warning']);

export class WarningLines {
  constructor(private readonly advisory: ReadonlySet<string> = new Set()) {}

  /**
   * FLOOD_MIN or more warnings of one code become one line at the place of the first;
   * an advisory validator's findings group by code and message.
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
   * validate's text: FLOOD_MIN or more findings of one advisory rule with one hint become one
   * line naming the most common message.
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
        // advisory rule names carry no E_ / W_, so their errors read `[bpmnlint error]`
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
      out.push(`${tag(p)}${p.code} x${group.length} [${idsText(same.map((g) => g.element ?? '?'))}]: ${message}${note}${p.hint ? `  (${p.hint})` : ''}`);
    }
    return out.join('\n');
  }

  private static warningLine(w: Warning): string {
    return `warning ${warningTag(w)}${w.code}${w.element ? ` ${w.element}` : ''}: ${w.message}${w.hint ? `  (${w.hint})` : ''}`;
  }
}
