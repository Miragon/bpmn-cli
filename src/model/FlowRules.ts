/**
 * What a sequence flow of a document may connect and carry: the roles of its
 * ends (no flow out of an end event, a link throw event or an event
 * sub-process, none into a start, boundary or link catch event or an event
 * sub-process), one scope for both ends, and a condition that is not empty
 * and that its source takes.
 */
import type { Doc } from './Doc.js';
import { modelError } from '../shared/utils/errors.js';
import { ignoresConditions, isLinkCatch, isLinkThrow, kindLabel } from './kinds.js';
import { idOf, is, type El } from './utils/moddle.js';

export class FlowRules {
  constructor(private readonly doc: Doc) {}

  /** True when the node may have outgoing sequence flows. */
  canStart(node: El): boolean {
    return is(node, 'bpmn:FlowNode') && !is(node, 'bpmn:EndEvent') && !isLinkThrow(node) && !FlowRules.isEventSubProcess(node);
  }

  /** True when the node may have incoming sequence flows. */
  canEnd(node: El): boolean {
    return is(node, 'bpmn:FlowNode') && !is(node, 'bpmn:StartEvent') && !is(node, 'bpmn:BoundaryEvent') && !isLinkCatch(node) && !FlowRules.isEventSubProcess(node);
  }

  /** The kind-based part of the endpoint rules (no scope check). */
  assertRoles(source: El, target: El): void {
    if (!is(source, 'bpmn:FlowNode')) {
      throw modelError('E_INVALID_SOURCE', `${FlowRules.label(source)} cannot be the source of a sequence flow`, { element: idOf(source) });
    }
    if (!is(target, 'bpmn:FlowNode')) {
      throw modelError('E_INVALID_TARGET', `${FlowRules.label(target)} cannot be the target of a sequence flow`, { element: idOf(target) });
    }
    if (is(source, 'bpmn:EndEvent')) {
      throw modelError('E_INVALID_SOURCE', `End event ${idOf(source)} cannot have outgoing sequence flows`, { element: idOf(source) });
    }
    if (is(target, 'bpmn:StartEvent')) {
      throw modelError('E_INVALID_TARGET', `Start event ${idOf(target)} cannot have incoming sequence flows`, { element: idOf(target) });
    }
    if (isLinkThrow(source)) {
      throw modelError('E_INVALID_SOURCE', `Link throw event ${idOf(source)} cannot have outgoing sequence flows`, { element: idOf(source) });
    }
    if (isLinkCatch(target)) {
      throw modelError('E_INVALID_TARGET', `Link catch event ${idOf(target)} cannot have incoming sequence flows`, { element: idOf(target) });
    }
    if (is(target, 'bpmn:BoundaryEvent')) {
      throw modelError('E_INVALID_TARGET', `Boundary event ${idOf(target)} cannot have incoming sequence flows`, { element: idOf(target) });
    }
    if (is(source, 'bpmn:SubProcess') && source.get<boolean | undefined>('triggeredByEvent')) {
      throw modelError('E_INVALID_SOURCE', `Event sub-process ${idOf(source)} cannot have sequence flows`, { element: idOf(source) });
    }
    if (is(target, 'bpmn:SubProcess') && target.get<boolean | undefined>('triggeredByEvent')) {
      throw modelError('E_INVALID_TARGET', `Event sub-process ${idOf(target)} cannot have sequence flows`, { element: idOf(target) });
    }
  }

  /** The roles of both ends, and one scope for both (E_CROSS_SCOPE). */
  assertEndpoints(source: El, target: El): void {
    this.assertRoles(source, target);
    const sScope = this.doc.scopeOf(source);
    const tScope = this.doc.scopeOf(target);
    if (!sScope || !tScope || sScope !== tScope) {
      throw modelError(
        'E_CROSS_SCOPE',
        `Sequence flows cannot cross scopes: ${idOf(source)} is in ${sScope ? idOf(sScope) : '?'}, ${idOf(target)} in ${tScope ? idOf(tScope) : '?'}`,
        {
          element: idOf(source),
          related: [idOf(target)],
          hint: 'Use a message flow between pools, or move the node with `bpmn move <file> <id> --in <scope>`.',
        },
      );
    }
  }

  /** E_INVALID_VALUE for an empty condition expression. */
  assertCondition(expr: string | undefined): void {
    if (expr !== undefined && !expr.trim()) {
      throw modelError('E_INVALID_VALUE', 'The condition expression is empty', {
        hint: 'Shell expansion may have eaten it: quote expressions with single quotes, e.g. --condition \'${ok}\'.',
      });
    }
  }

  /** E_INVALID_VALUE for a condition on a flow out of a node that ignores conditions (parallel / event-based gateway). */
  assertConditionTaken(source: El, expr: string | undefined, flowId?: string): void {
    if (!expr || !ignoresConditions(source)) return;
    throw modelError('E_INVALID_VALUE', `A flow out of ${idOf(source)} cannot have a condition: a ${kindLabel(source)} ${is(source, 'bpmn:ParallelGateway') ? 'always takes all of its outgoing paths' : 'takes the path of the event that happens first'}`, {
      ...(flowId ? { element: flowId } : {}),
      hint: `Branch by condition with an exclusive gateway instead: \`bpmn retype <file> ${idOf(source)} exclusiveGateway\`.`,
    });
  }

  private static isEventSubProcess(el: El): boolean {
    return is(el, 'bpmn:SubProcess') && !!el.get<boolean | undefined>('triggeredByEvent');
  }

  private static label(el: El): string {
    const name = el.get<string | undefined>('name');
    return `${kindLabel(el)} ${idOf(el)}${name ? ` "${name}"` : ''}`;
  }
}
