/**
 * How to give a scope without start event one: add it before the first node (or into an empty
 * scope); a sub-process may go instead.
 */
export function missingStartHint(scopeId: string, hasNodes: boolean, removable: boolean): string {
  const add = hasNodes
    ? `Add one: \`bpmn add <file> startEvent "<Name>" --before <firstNodeId>\` (or --in ${scopeId}, then connect it)`
    : `Add content: \`bpmn add <file> startEvent "<Name>" --in ${scopeId}\` and continue from it`;
  return `${add}${removable ? `, or remove it: \`bpmn remove <file> ${scopeId}\`` : ''}.`;
}
