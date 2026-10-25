import type { PrefixSource } from '../IdStyle.js';
import type { ConventionsView, Undeclared } from '../ConventionsTable.js';

/**
 * Notes event triggers whose required qualified prefix new ids cannot have:
 * they follow the file's style.
 */
export const UNQUALIFIED_NOTE = "qualified prefix ignored, the file's style (W_CONFIG_IGNORED)";

const SOURCE_WORDS: Record<PrefixSource, string> = {
  lint: 'element-id-naming',
  file: "the file's ids",
  'lint shape': 'shaped like the declared prefixes (the file shows none)',
  default: "bpmn-cli's default",
};

const UNDECLARED_WORDS: Record<Undeclared, (where: string | undefined) => string> = {
  skipped: () => '--no-lint-config leaves the .bpmnlintrc out',
  'no config': () => 'no .bpmnlintrc applies here',
  'not loaded': (where) => `the ${where ?? '.bpmnlintrc'} could not be loaded (W_LINT_UNAVAILABLE below)`,
  off: (where) => `element-id-naming is off or not configured in the ${where ?? '.bpmnlintrc'}`,
  'no prefixes': (where) => `element-id-naming (${where ?? 'the host'}) declares no prefix new ids can follow`,
};

export function renderConventions(view: ConventionsView): string {
  const lines: string[] = [];
  lines.push(`conventions of ${view.file ?? 'the model'}${view.exists ? '' : ' (no file yet: a new model)'}`);
  if (view.rule) lines.push(`element-id-naming (${view.source ?? 'the host'}): ${view.rule.severity}, case ${view.rule.case}, eventDefinitionQualifier ${view.rule.qualifier}`);
  else if (view.undeclared) lines.push(`no id conventions: ${UNDECLARED_WORDS[view.undeclared](view.source)}; new ids follow the file's id style`);
  else lines.push("no id conventions declared: new ids follow the file's id style");
  const width = Math.max(...view.rows.map((r) => r.pattern.length));
  const sourceWidth = Math.max(...view.rows.map((r) => r.source.length));
  for (const r of view.rows) lines.push(`  ${r.pattern.padEnd(width)}  ${r.source.padEnd(sourceWidth)}  ${r.kinds.join(' ')}${r.note ? ` (${r.note})` : ''}`);
  if (view.qualified) {
    const except = view.rows.some((r) => r.note?.endsWith(UNQUALIFIED_NOTE)) ? ' (not the triggers marked above)' : '';
    const how = view.qualified.mode === 'required' ? `required, new ids take it${except}` : 'also accepted, new ids take the plain prefix';
    lines.push(`  events with a trigger: <trigger><Prefix> (${view.qualified.examples.join(', ')}) ${how}`);
  }
  const used = [...new Set(view.rows.map((r) => r.source))];
  lines.push(`sources: ${used.map((s) => `${s} = ${SOURCE_WORDS[s]}`).join('; ')}`);
  for (const n of view.notes) lines.push(`warning ${n.code}: ${n.message}${n.hint ? `  (${n.hint})` : ''}`);
  return lines.join('\n');
}
