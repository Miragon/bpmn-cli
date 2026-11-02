import type { BpmnElement } from '../document/BpmnElement.js';
import type { BpmnScopes } from '../document/BpmnScopes.js';
import type { FlowGraph } from '../document/FlowGraph.js';
import { BpmnError } from '../errors/BpmnError.js';
import { Kinds } from './Kinds.js';
import { Triggers } from './Triggers.js';

type Role = 'source' | 'target';

interface EndpointRule {
  role: Role;
  refuses: (node: BpmnElement) => boolean;
  message: (node: BpmnElement) => string;
}

export class FlowRules {
  private static readonly ENDPOINT_RULES: EndpointRule[] = [
    { role: 'source', refuses: (node) => !node.is('bpmn:FlowNode'), message: (node) => `${FlowRules.label(node)} cannot be the source of a sequence flow` },
    { role: 'target', refuses: (node) => !node.is('bpmn:FlowNode'), message: (node) => `${FlowRules.label(node)} cannot be the target of a sequence flow` },
    { role: 'source', refuses: (node) => node.is('bpmn:EndEvent'), message: (node) => `End event ${node.id} cannot have outgoing sequence flows` },
    { role: 'target', refuses: (node) => node.is('bpmn:StartEvent'), message: (node) => `Start event ${node.id} cannot have incoming sequence flows` },
    { role: 'source', refuses: Triggers.isLinkThrow, message: (node) => `Link throw event ${node.id} cannot have outgoing sequence flows` },
    { role: 'target', refuses: Triggers.isLinkCatch, message: (node) => `Link catch event ${node.id} cannot have incoming sequence flows` },
    { role: 'target', refuses: (node) => node.is('bpmn:BoundaryEvent'), message: (node) => `Boundary event ${node.id} cannot have incoming sequence flows` },
    { role: 'source', refuses: Kinds.isEventSubProcess, message: (node) => `Event sub-process ${node.id} cannot have sequence flows` },
    { role: 'target', refuses: Kinds.isEventSubProcess, message: (node) => `Event sub-process ${node.id} cannot have sequence flows` },
  ];

  constructor(
    private readonly scopes: BpmnScopes,
    private readonly flows: FlowGraph,
  ) {}

  canStart(node: BpmnElement): boolean {
    return !FlowRules.refusal('source', node);
  }

  canEnd(node: BpmnElement): boolean {
    return !FlowRules.refusal('target', node);
  }

  assertRoles(source: BpmnElement, target: BpmnElement): void {
    for (const rule of FlowRules.ENDPOINT_RULES) {
      const node = rule.role === 'source' ? source : target;
      if (!rule.refuses(node)) {
        continue;
      }
      throw BpmnError.model(rule.role === 'source' ? 'E_INVALID_SOURCE' : 'E_INVALID_TARGET', rule.message(node), { element: node.id });
    }
  }

  assertEndpoints(source: BpmnElement, target: BpmnElement, replacing?: BpmnElement): void {
    this.assertRoles(source, target);
    const sScope = this.scopes.scopeOf(source);
    const tScope = this.scopes.scopeOf(target);
    if (!sScope || !tScope || sScope !== tScope) {
      throw BpmnError.model(
        'E_CROSS_SCOPE',
        `Sequence flows cannot cross scopes: ${source.id} is in ${sScope ? sScope.id : '?'}, ${target.id} in ${tScope ? tScope.id : '?'}`,
        {
          element: source.id,
          related: [target.id],
          hint: 'Use a message flow between pools, or move the node with `bpmn move <file> <id> --in <scope>`.',
        },
      );
    }
    this.assertSingleIncomingAfterEventGateway(source, target, replacing);
  }

  assertCondition(expr: string | undefined): void {
    if (expr !== undefined && !expr.trim()) {
      throw BpmnError.model('E_INVALID_VALUE', 'The condition expression is empty', {
        hint: 'Shell expansion may have eaten it: quote expressions with single quotes, e.g. --condition \'${ok}\'.',
      });
    }
  }

  assertConditionTaken(source: BpmnElement, expr: string | undefined, flowId?: string): void {
    if (!expr || !Kinds.ignoresConditions(source)) {
      return;
    }
    throw BpmnError.model('E_INVALID_VALUE', `A flow out of ${source.id} cannot have a condition: a ${Kinds.label(source)} ${source.is('bpmn:ParallelGateway') ? 'always takes all of its outgoing paths' : 'takes the path of the event that happens first'}`, {
      ...(flowId ? { element: flowId } : {}),
      hint: `Branch by condition with an exclusive gateway instead: \`bpmn retype <file> ${source.id} exclusiveGateway\`.`,
    });
  }

  private assertSingleIncomingAfterEventGateway(source: BpmnElement, target: BpmnElement, replacing?: BpmnElement): void {
    const others = this.flows.incoming(target).filter((flow) => flow !== replacing);
    if (!others.length) {
      return;
    }
    const isEventGateway = (node: BpmnElement | undefined): node is BpmnElement => !!node && node.is('bpmn:EventBasedGateway');
    const gateway = isEventGateway(source) ? source : others.map((flow) => flow.get<BpmnElement | undefined>('sourceRef')).find(isEventGateway);
    if (!gateway) {
      return;
    }
    throw BpmnError.model('E_INVALID_TARGET', `${target.id} follows event-based gateway ${gateway.id} and can have no other incoming sequence flow (BPMN 2.0 10.6.6)`, {
      element: target.id,
      related: [gateway.id, ...others.map((flow) => flow.id)],
      hint: `Join before the gateway instead: ${FlowRules.joinBefore(gateway, source, replacing)}.`,
    });
  }

  private static joinBefore(gateway: BpmnElement, source: BpmnElement, replacing?: BpmnElement): string {
    if (source === gateway) {
      return `\`bpmn set <file> <flowId> target=${gateway.id}\``;
    }
    if (replacing) {
      return `\`bpmn set <file> ${replacing.id} target=${gateway.id}\``;
    }
    return `\`bpmn connect <file> ${source.id} ${gateway.id}\``;
  }

  private static refusal(role: Role, node: BpmnElement): EndpointRule | undefined {
    return FlowRules.ENDPOINT_RULES.find((rule) => rule.role === role && rule.refuses(node));
  }

  private static label(el: BpmnElement): string {
    const name = el.get<string | undefined>('name');
    return `${Kinds.label(el)} ${el.id}${name ? ` "${name}"` : ''}`;
  }
}
