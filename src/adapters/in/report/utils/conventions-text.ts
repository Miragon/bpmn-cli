import type { PrefixSource } from '../../../../domain/document/ids/IdStyle.js';
import { UNQUALIFIED_NOTE, type ConventionsView, type Undeclared } from '../../../../domain/document/ids/ConventionsTable.js';

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
  const width = Math.max(...view.rows.map((row) => row.pattern.length));
  const sourceWidth = Math.max(...view.rows.map((row) => row.source.length));
  for (const row of view.rows) lines.push(`  ${row.pattern.padEnd(width)}  ${row.source.padEnd(sourceWidth)}  ${row.kinds.join(' ')}${row.note ? ` (${row.note})` : ''}`);
  if (view.qualified) {
    const except = view.rows.some((row) => row.note?.endsWith(UNQUALIFIED_NOTE)) ? ' (not the triggers marked above)' : '';
    const how = view.qualified.mode === 'required' ? `required, new ids take it${except}` : 'also accepted, new ids take the plain prefix';
    lines.push(`  events with a trigger: <trigger><Prefix> (${view.qualified.examples.join(', ')}) ${how}`);
  }
  const used = [...new Set(view.rows.map((row) => row.source))];
  lines.push(`sources: ${used.map((source) => `${source} = ${SOURCE_WORDS[source]}`).join('; ')}`);
  for (const note of view.notes) lines.push(`warning ${note.code}: ${note.message}${note.hint ? `  (${note.hint})` : ''}`);
  return lines.join('\n');
}
