import type { Warning } from '../../../domain/document/CliError.js';
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
    const keyOf = (warning: Warning): string => {
      const validator = validatorOf(warning);
      return validator && this.advisory.has(validator) ? `${warningTag(warning)}${warning.code}\n${warning.message}` : floodKey(warning);
    };
    const groups = new Map<string, Warning[]>();
    for (const warning of warnings) groups.set(keyOf(warning), [...(groups.get(keyOf(warning)) ?? []), warning]);
    const out: string[] = [];
    const done = new Set<string>();
    for (const warning of warnings) {
      const key = keyOf(warning);
      const group = groups.get(key)!;
      if (group.length < FLOOD_MIN || NEVER_FLOOD.has(warning.code)) {
        out.push(WarningLines.warningLine(warning));
        continue;
      }
      if (done.has(key)) continue;
      done.add(key);
      const ids = group.map((member) => member.element ?? '?');
      out.push(`warning ${warningTag(warning)}${warning.code} x${group.length} [${idsText(ids)}]: ${warning.message}${warning.hint ? `  (${warning.hint})` : ''}`);
    }
    return out;
  }

  /**
   * validate's text: FLOOD_MIN or more findings of one advisory rule with one hint become one
   * line naming the most common message.
   */
  problems(problems: readonly Warning[]): string {
    const isAdvisory = (problem: Warning): boolean => {
      const validator = validatorOf(problem);
      return !!validator && this.advisory.has(validator);
    };
    const keyOf = (problem: Warning): string | undefined => {
      if (!isAdvisory(problem) || NO_RULE.has(problem.code)) return undefined;
      return `${validatorOf(problem)}\n${problem.code}\n${problem.hint ?? ''}`;
    };
    const tag = (problem: Warning): string => (isAdvisory(problem) ? warningTag(problem) : validatorTag(problem));
    const groups = new Map<string, Warning[]>();
    for (const problem of problems) {
      const key = keyOf(problem);
      if (key) groups.set(key, [...(groups.get(key) ?? []), problem]);
    }
    const out: string[] = [];
    const done = new Set<string>();
    for (const problem of problems) {
      const key = keyOf(problem);
      const group = key ? groups.get(key)! : [problem];
      if (group.length < FLOOD_MIN) {
        // advisory rule names carry no E_ / W_, so their errors read `[bpmnlint error]`
        out.push(isAdvisory(problem) ? renderProblems([problem]).replace(validatorTag(problem), tag(problem)) : renderProblems([problem]));
        continue;
      }
      if (done.has(key!)) continue;
      done.add(key!);
      const byMessage = new Map<string, Warning[]>();
      for (const member of group) byMessage.set(member.message, [...(byMessage.get(member.message) ?? []), member]);
      const [message, same] = [...byMessage].reduce((best, candidate) => (candidate[1].length > best[1].length ? candidate : best));
      const others = byMessage.size - 1;
      const rest = group.length - same.length;
      const note = others ? ` (${same.length} of ${group.length}; ${rest} other${rest === 1 ? '' : 's'} with ${others} other message${others === 1 ? '' : 's'}, --json lists them)` : '';
      out.push(`${tag(problem)}${problem.code} x${group.length} [${idsText(same.map((member) => member.element ?? '?'))}]: ${message}${note}${problem.hint ? `  (${problem.hint})` : ''}`);
    }
    return out.join('\n');
  }

  private static warningLine(warning: Warning): string {
    return `warning ${warningTag(warning)}${warning.code}${warning.element ? ` ${warning.element}` : ''}: ${warning.message}${warning.hint ? `  (${warning.hint})` : ''}`;
  }
}
