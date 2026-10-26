import type { Doc } from './Doc.js';
import { modelError } from '../shared/utils/errors.js';
import { ignoresConditions, isEventSubProcess, isLinkCatch, isLinkThrow, kindLabel } from './utils/kinds.js';
import { idOf, is, type El } from './utils/moddle.js';

type Role = 'source' | 'target';

interface EndpointRule {
  role: Role;
  refuses: (node: El) => boolean;
  message: (node: El) => string;
}

/** Which ends a sequence flow may connect, within one scope, and which condition it may carry. */
export class FlowRules {
  /** In the order `assertRoles` reports them when both ends are refused. */
  private static readonly ENDPOINT_RULES: EndpointRule[] = [
    { role: 'source', refuses: (n) => !is(n, 'bpmn:FlowNode'), message: (n) => `${FlowRules.label(n)} cannot be the source of a sequence flow` },
    { role: 'target', refuses: (n) => !is(n, 'bpmn:FlowNode'), message: (n) => `${FlowRules.label(n)} cannot be the target of a sequence flow` },
    { role: 'source', refuses: (n) => is(n, 'bpmn:EndEvent'), message: (n) => `End event ${idOf(n)} cannot have outgoing sequence flows` },
    { role: 'target', refuses: (n) => is(n, 'bpmn:StartEvent'), message: (n) => `Start event ${idOf(n)} cannot have incoming sequence flows` },
    { role: 'source', refuses: isLinkThrow, message: (n) => `Link throw event ${idOf(n)} cannot have outgoing sequence flows` },
    { role: 'target', refuses: isLinkCatch, message: (n) => `Link catch event ${idOf(n)} cannot have incoming sequence flows` },
    { role: 'target', refuses: (n) => is(n, 'bpmn:BoundaryEvent'), message: (n) => `Boundary event ${idOf(n)} cannot have incoming sequence flows` },
    { role: 'source', refuses: isEventSubProcess, message: (n) => `Event sub-process ${idOf(n)} cannot have sequence flows` },
    { role: 'target', refuses: isEventSubProcess, message: (n) => `Event sub-process ${idOf(n)} cannot have sequence flows` },
  ];

  constructor(private readonly doc: Doc) {}

  canStart(node: El): boolean {
    return !FlowRules.refusal('source', node);
  }

  canEnd(node: El): boolean {
    return !FlowRules.refusal('target', node);
  }

  /** No scope check. */
  assertRoles(source: El, target: El): void {
    for (const rule of FlowRules.ENDPOINT_RULES) {
      const node = rule.role === 'source' ? source : target;
      if (!rule.refuses(node)) continue;
      throw modelError(rule.role === 'source' ? 'E_INVALID_SOURCE' : 'E_INVALID_TARGET', rule.message(node), { element: idOf(node) });
    }
  }

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

  assertCondition(expr: string | undefined): void {
    if (expr !== undefined && !expr.trim()) {
      throw modelError('E_INVALID_VALUE', 'The condition expression is empty', {
        hint: 'Shell expansion may have eaten it: quote expressions with single quotes, e.g. --condition \'${ok}\'.',
      });
    }
  }

  /** Parallel and event-based gateways ignore conditions on their outgoing flows. */
  assertConditionTaken(source: El, expr: string | undefined, flowId?: string): void {
    if (!expr || !ignoresConditions(source)) return;
    throw modelError('E_INVALID_VALUE', `A flow out of ${idOf(source)} cannot have a condition: a ${kindLabel(source)} ${is(source, 'bpmn:ParallelGateway') ? 'always takes all of its outgoing paths' : 'takes the path of the event that happens first'}`, {
      ...(flowId ? { element: flowId } : {}),
      hint: `Branch by condition with an exclusive gateway instead: \`bpmn retype <file> ${idOf(source)} exclusiveGateway\`.`,
    });
  }

  private static refusal(role: Role, node: El): EndpointRule | undefined {
    return FlowRules.ENDPOINT_RULES.find((rule) => rule.role === role && rule.refuses(node));
  }

  private static label(el: El): string {
    const name = el.get<string | undefined>('name');
    return `${kindLabel(el)} ${idOf(el)}${name ? ` "${name}"` : ''}`;
  }
}
