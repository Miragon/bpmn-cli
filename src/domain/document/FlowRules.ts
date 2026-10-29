import type { Doc } from './Doc.js';
import { modelError } from './utils/errors.js';
import { ignoresConditions, isEventSubProcess, isLinkCatch, isLinkThrow, kindLabel } from './Kinds.js';
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
    { role: 'source', refuses: (node) => !is(node, 'bpmn:FlowNode'), message: (node) => `${FlowRules.label(node)} cannot be the source of a sequence flow` },
    { role: 'target', refuses: (node) => !is(node, 'bpmn:FlowNode'), message: (node) => `${FlowRules.label(node)} cannot be the target of a sequence flow` },
    { role: 'source', refuses: (node) => is(node, 'bpmn:EndEvent'), message: (node) => `End event ${idOf(node)} cannot have outgoing sequence flows` },
    { role: 'target', refuses: (node) => is(node, 'bpmn:StartEvent'), message: (node) => `Start event ${idOf(node)} cannot have incoming sequence flows` },
    { role: 'source', refuses: isLinkThrow, message: (node) => `Link throw event ${idOf(node)} cannot have outgoing sequence flows` },
    { role: 'target', refuses: isLinkCatch, message: (node) => `Link catch event ${idOf(node)} cannot have incoming sequence flows` },
    { role: 'target', refuses: (node) => is(node, 'bpmn:BoundaryEvent'), message: (node) => `Boundary event ${idOf(node)} cannot have incoming sequence flows` },
    { role: 'source', refuses: isEventSubProcess, message: (node) => `Event sub-process ${idOf(node)} cannot have sequence flows` },
    { role: 'target', refuses: isEventSubProcess, message: (node) => `Event sub-process ${idOf(node)} cannot have sequence flows` },
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

  assertEndpoints(source: El, target: El, replacing?: El): void {
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
    this.assertSingleIncomingAfterEventGateway(source, target, replacing);
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

  private assertSingleIncomingAfterEventGateway(source: El, target: El, replacing?: El): void {
    const others = this.doc.incoming(target).filter((flow) => flow !== replacing);
    if (!others.length) {
      return;
    }
    const isEventGateway = (node: El | undefined): node is El => !!node && is(node, 'bpmn:EventBasedGateway');
    const gateway = isEventGateway(source) ? source : others.map((flow) => flow.get<El | undefined>('sourceRef')).find(isEventGateway);
    if (!gateway) {
      return;
    }
    throw modelError('E_INVALID_TARGET', `${idOf(target)} follows event-based gateway ${idOf(gateway)} and can have no other incoming sequence flow (BPMN 2.0 10.6.6)`, {
      element: idOf(target),
      related: [idOf(gateway), ...others.map(idOf)],
      hint: `Join before the gateway instead: ${FlowRules.joinBefore(gateway, source, replacing)}.`,
    });
  }

  private static joinBefore(gateway: El, source: El, replacing?: El): string {
    if (source === gateway) {
      return `\`bpmn set <file> <flowId> target=${idOf(gateway)}\``;
    }
    if (replacing) {
      return `\`bpmn set <file> ${idOf(replacing)} target=${idOf(gateway)}\``;
    }
    return `\`bpmn connect <file> ${idOf(source)} ${idOf(gateway)}\``;
  }

  private static refusal(role: Role, node: El): EndpointRule | undefined {
    return FlowRules.ENDPOINT_RULES.find((rule) => rule.role === role && rule.refuses(node));
  }

  private static label(el: El): string {
    const name = el.get<string | undefined>('name');
    return `${kindLabel(el)} ${idOf(el)}${name ? ` "${name}"` : ''}`;
  }
}
