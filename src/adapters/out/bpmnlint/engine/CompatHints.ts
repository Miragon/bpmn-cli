import type { BpmnlintEngineReport } from '../bpmnlint-contract.js';

interface Node {
  $type?: string;
  id?: string;
  $parent?: Node;
  cancelActivity?: boolean;
  triggeredByEvent?: boolean;
  values?: Node[];
  [property: string]: unknown;
}

/** The kind `bpmn retype` makes of an element type the engine does not support. */
const REPLACEMENTS: Record<string, string> = {
  'bpmn:Transaction': '`bpmn retype <file> {id} subProcess` (an embedded sub-process).',
  'bpmn:ComplexGateway': '`bpmn retype <file> {id} inclusiveGateway` (or exclusiveGateway: one path).',
};

/**
 * The hints for camunda-compat reports where the one derived from `path` and `data.type` would be
 * vague or wrong: a missing start event, a timer cycle where the engine refuses one, an element the
 * engine does not support, a duplicated header, a standard loop.
 */
export class CompatHints {
  of(rule: string, report: BpmnlintEngineReport, host: Node): string | undefined {
    const id = String(host.id);
    const type = report.data?.type;
    const path = report.path ?? [];
    if (rule === 'start-event-required') return this.startEvent(id, host);
    if (rule === 'camunda-compat/history-time-to-live') return `\`bpmn set <file> ${id} camunda:historyTimeToLive=180\` (days, like Camunda Modeler; P180D works too).`;
    if (type === 'camunda.propertyNotAllowed' && path[path.length - 1] === 'timeCycle') return this.timerCycle(id, host);
    if (type === 'camunda.elementTypeNotAllowed') return this.unsupported(id, host, report);
    if (type === 'camunda.attachedToRefElementTypeNotAllowed') return `Attach it elsewhere (\`bpmn move <file> ${id} --on <subProcessId>\`) or remove it: \`bpmn remove <file> ${id}\`.`;
    if (type === 'camunda.propertyTypeNotAllowed' && path[0] === 'loopCharacteristics') return `Remove it (\`bpmn set <file> ${id} loop=none\`) and model the loop with a gateway, or make it a multi-instance: \`bpmn set <file> ${id} loop=sequential\`, then \`bpmn ext add <file> ${id} loop.zeebe:loopCharacteristics inputCollection==<items> inputElement=<item>\`.`;
    if (type === 'camunda.elementMultipleNotAllowed' && !path.length) return `Remove ${id} (\`bpmn remove <file> ${id}\`) or give it a trigger: \`bpmn set <file> ${id} trigger=message message=<MessageName>\`.`;
    if (type === 'camunda.propertyValueDuplicated') return this.duplicatedChild(id, report);
    if (type === 'camunda.extensionElementRequired') return this.unprefixedDecision(id, host, report);
    return undefined;
  }

  /** A business rule task that names its decision without the zeebe prefix: `bpmn set` writes the zeebe:calledDecision. */
  private unprefixedDecision(id: string, host: Node, report: BpmnlintEngineReport): string | undefined {
    const required = report.data?.requiredExtensionElement;
    const decision = (host.$attrs as Record<string, unknown> | undefined)?.['calledDecision'];
    if (!Array.isArray(required) || !required.includes('zeebe:CalledDecision') || typeof decision !== 'string') return undefined;
    return `Give it its decision: \`bpmn set <file> ${id} calledDecision=${decision}\`.`;
  }

  private startEvent(id: string, host: Node): string {
    return host.$type === 'bpmn:Process' ? `\`bpmn add <file> startEvent "<Name>" --before <firstNodeId>\` (or --in ${id}).` : `\`bpmn add <file> startEvent "<Name>" --in ${id}\`, then connect it to the first node.`;
  }

  /** A catch event takes a duration or a date; an interrupting boundary or event sub-process start no cycle. */
  private timerCycle(id: string, host: Node): string {
    if (host.$type === 'bpmn:IntermediateCatchEvent') return `\`bpmn set <file> ${id} timer=PT1H\` (a duration, or a date-time).`;
    return `Make it non-interrupting (\`bpmn set <file> ${id} nonInterrupting=true\`) or use a duration (\`bpmn set <file> ${id} timer=PT1H\`).`;
  }

  private unsupported(id: string, host: Node, report: BpmnlintEngineReport): string | undefined {
    if (report.data?.eventDefinition === 'bpmn:CancelEventDefinition' || (report.data?.eventDefinition as Node | undefined)?.$type === 'bpmn:CancelEventDefinition') return `\`bpmn set <file> ${id} trigger=none\`.`;
    return REPLACEMENTS[String(host.$type)]?.replace('{id}', id);
  }

  /** Two children of one container with the same key: the second goes. */
  private duplicatedChild(id: string, report: BpmnlintEngineReport): string | undefined {
    const container = report.data?.node as Node | undefined;
    const second = (report.data?.properties as Node[] | undefined)?.[1];
    const index = second && container?.values ? container.values.indexOf(second) : -1;
    if (!container?.$type || !second?.$type || index < 0) return undefined;
    return `Keep one: \`bpmn ext remove <file> ${id} '${this.xmlName(container.$type)}/${this.xmlName(second.$type)}[${index}]'\`.`;
  }

  private xmlName(type: string): string {
    const colon = type.indexOf(':');
    return `${type.slice(0, colon + 1)}${type.charAt(colon + 1).toLowerCase()}${type.slice(colon + 2)}`;
  }
}
