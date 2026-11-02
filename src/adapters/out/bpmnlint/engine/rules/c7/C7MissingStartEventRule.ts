import { is, isAny } from 'bpmnlint-utils';
import { ERROR_TYPES, type ModdleElement, type ReportData } from '../CamundaRule.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';

/**
 * The base of the rules on a process or sub-process without start event (an empty one too): a
 * rule implements `checkScope(scope, what, data)` with what the scope lacks and the report's data.
 * The engines need a start event to begin a scope; the kind of scope says whether they refuse the
 * file or fail when an instance reaches it.
 *
 * @example a sub-process without start event
 * <bpmn:subProcess id="Review"><bpmn:task id="Check" /></bpmn:subProcess>
 */
export abstract class C7MissingStartEventRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!isAny(node, ['bpmn:Process', 'bpmn:SubProcess']) || is(node, 'bpmn:AdHocSubProcess')) {
      return;
    }
    const nodes: ModdleElement[] = (node.flowElements ?? []).filter((element: ModdleElement) => is(element, 'bpmn:FlowNode'));
    if (nodes.some((element) => is(element, 'bpmn:StartEvent'))) return;
    const what = nodes.length ? 'has no start event' : 'is empty, without a start event';
    this.checkScope(node, what, { path: ['flowElements'], type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED, requiredType: 'bpmn:StartEvent', hint: this.hint(node.id, nodes.length > 0, !is(node, 'bpmn:Process')) });
  }

  protected abstract checkScope(scope: ModdleElement, what: string, data: ReportData): void;

  /** Add a start event before the first node (or into an empty scope); a sub-process may go instead. */
  private hint(scopeId: string, hasNodes: boolean, removable: boolean): string {
    const add = hasNodes ? `Add one: \`bpmn add <file> startEvent "<Name>" --before <firstNodeId>\` (or --in ${scopeId}, then connect it)` : `Add content: \`bpmn add <file> startEvent "<Name>" --in ${scopeId}\` and continue from it`;
    return `${add}${removable ? `, or remove it: \`bpmn remove <file> ${scopeId}\`` : ''}.`;
  }
}
