import type { BpmnlintEngineReport } from '../bpmnlint-contract.js';
import { CompatHints } from './CompatHints.js';

/** camunda-compat's error types (`data.type`), the ones a hint tells apart. */
const SET = new Set(['camunda.propertyRequired', 'camunda.propertyValueRequired', 'camunda.propertyDependentRequired', 'camunda.propertyValueNotAllowed', 'camunda.propertyTypeNotAllowed', 'camunda.expressionRequired', 'camunda.expressionValueNotAllowed', 'camunda.expressionNotAllowed', 'camunda.feelExpressionInvalid', 'camunda.feelExpressionUnsupportedFunction', 'camunda.propertyValueDuplicated', 'camunda.elementPropertyValueDuplicated', 'camunda.propertiesValuesDuplicated']);
const UNSET = new Set(['camunda.propertyNotAllowed', 'camunda.propertyDeprecated']);
const FEEL = new Set(['camunda.expressionRequired', 'camunda.feelExpressionInvalid', 'camunda.expressionValueNotAllowed']);
const EXT_ADD = new Set(['camunda.extensionElementRequired', 'camunda.childElementOfTypeRequired']);
const EXT_REMOVE = new Set(['camunda.extensionElementNotAllowed', 'camunda.elementMultipleNotAllowed', 'camunda.childElementTypeNotAllowed']);
const REMOVE = new Set(['camunda.elementTypeNotAllowed', 'camunda.attachedToRefElementTypeNotAllowed', 'camunda.loopNotAllowed', 'camunda.elementCollapsedNotAllowed', 'camunda.eventBasedGatewayTargetNotAllowed']);

/** How `bpmn set` addresses an element nested in a flow node or flow. */
const SLOTS: Record<string, string> = { eventDefinitions: 'definition', loopCharacteristics: 'loop', conditionExpression: 'condition' };

/** What an alternative extension element does, for a hint that offers it next to a job. */
const ALTERNATIVES: Record<string, string> = { 'zeebe:script': 'a FEEL script', 'zeebe:calledDecision': 'call a DMN decision' };

/** The attributes an extension element needs to deploy, as `bpmn ext add` takes them. */
const REQUIRED_ATTRIBUTES: Record<string, string> = {
  'zeebe:taskDefinition': 'type=<jobType>',
  'zeebe:calledElement': 'processId=<processId>',
  'zeebe:calledDecision': 'decisionId=<decisionId> resultVariable=<variable>',
  'zeebe:subscription': 'correlationKey==<expression>',
  'zeebe:loopCharacteristics': 'inputCollection==<items> inputElement=<item>',
  'zeebe:script': 'expression==<expression> resultVariable=<variable>',
  'zeebe:formDefinition': 'formId=<formId>',
  'camunda:field': 'name=<name> stringValue=<value>',
};

/**
 * The `bpmn set` key that writes a property of a nested element, with its placeholder: the
 * timer, message or condition of an event, the condition of a flow.
 */
const SET_ALIASES: Record<string, string> = {
  'definition.timeDate': 'timer=<date>',
  'definition.timeCycle': 'timer=<cycle>',
  'definition.timeDuration': 'timer=PT1H',
  'definition.messageRef': 'message=<MessageName>',
  'definition.signalRef': 'signal=<SignalName>',
  'definition.errorRef': 'error=<ErrorName> errorCode=<CODE>',
  'definition.escalationRef': 'escalation=<Name> escalationCode=<CODE>',
  'definition.condition': 'when=<expression>',
  'definition.name': 'link=<Name>',
  messageRef: 'message=<MessageName>',
  conditionExpression: 'condition=<expression>',
  completionCondition: 'completion=<expression>',
  'camunda:type': 'camunda:type=external camunda:topic=<topic>',
  'definition.camunda:type': 'definition.camunda:type=external definition.camunda:topic=<topic>',
};

/** The placeholder a hint writes for a property, in the vocabulary of bpmn-cli's hints. */
const PLACEHOLDERS: Record<string, string> = {
  resultVariable: '<variable>',
  expression: '=<expression>',
  type: '<jobType>',
  target: '<variable>',
  source: '=<expression>',
  processId: '<processId>',
  decisionId: '<decisionId>',
  formId: '<formId>',
  versionTag: '<versionTag>',
  inputElement: '<item>',
  outputElement: '=<expression>',
  inputCollection: '=<items>',
  outputCollection: '<variable>',
  correlationKey: '=<expression>',
  errorCode: '<CODE>',
  escalationCode: '<CODE>',
  messageName: '<MessageName>',
  historyTimeToLive: '180',
};

/** `bpmn set` keys of the event triggers, by event definition type. */
const TRIGGERS: Record<string, string> = {
  'bpmn:MessageEventDefinition': 'message',
  'bpmn:TimerEventDefinition': 'timer',
  'bpmn:SignalEventDefinition': 'signal',
  'bpmn:ErrorEventDefinition': 'error',
  'bpmn:EscalationEventDefinition': 'escalation',
  'bpmn:ConditionalEventDefinition': 'conditional',
  'bpmn:LinkEventDefinition': 'link',
  'bpmn:CompensateEventDefinition': 'compensation',
  'bpmn:TerminateEventDefinition': 'terminate',
  'bpmn:CancelEventDefinition': 'cancel',
};

interface ModdleNode {
  $type?: string;
  id?: string;
  $descriptor?: { properties?: Array<{ name: string; isAttr?: boolean; ns?: { prefix?: string } }>; propertiesByName?: Record<string, { ns?: { prefix?: string }; isReference?: boolean }> };
  [property: string]: unknown;
}

/** Where a path leads: the element `bpmn` addresses, the slot of the nested element, the rest. */
interface Address {
  target: string;
  slot: string;
  node: ModdleNode;
  rest: Array<string | number>;
}

/**
 * The `bpmn` command that fixes an engine finding, derived from where the report points (`path`)
 * and what kind of problem it is (`data.type`, camunda-compat's error types): one rule for all
 * engine rules instead of a hint per rule. Without a command that fits, it says what to look at.
 */
export class EngineHint {
  private readonly compat = new CompatHints();

  constructor(private readonly elementsById: Readonly<Record<string, unknown>>) {}

  of(report: BpmnlintEngineReport, rule = ''): string {
    const id = report.id;
    const type = report.data?.type;
    const host = id ? (this.elementsById[id] as ModdleNode | undefined) : undefined;
    const own = report.data?.hint;
    if (typeof own === 'string') return own;
    const special = id && host ? this.compat.of(rule, report, host) : undefined;
    if (special) return special;
    if (!id || !host || !type) return this.fallback(id);
    const path = report.path ?? [];
    const requiredType = report.data?.requiredType;
    if (type === 'camunda.childElementOfTypeRequired' && typeof requiredType === 'string' && requiredType.startsWith('bpmn:')) return this.addChild(id, host, requiredType);
    if (type === 'camunda.elementMultipleNotAllowed' && path[path.length - 1] === 'eventDefinitions') return this.keepOneTrigger(id, report);
    if (!path.length && EXT_REMOVE.has(type)) return `Remove it (\`bpmn remove <file> ${id}\`), or give it another trigger (\`bpmn set <file> ${id} trigger=<trigger>\`).`;
    const address = this.address(host, path);
    if (!address) return this.fallback(id);
    const ext = this.extensionStep(address);
    if (EXT_ADD.has(type)) return this.extAdd(address, ext, report);
    const child = ext && !EXT_REMOVE.has(type) && !UNSET.has(type) ? this.childRebuild(address, ext.element) : undefined;
    if (child) return child;
    if (ext) return EXT_REMOVE.has(type) || UNSET.has(type) ? `Remove it: \`bpmn ext remove <file> ${address.target} ${this.quoted(`${address.slot}${ext.index}`)}\` (\`bpmn ext list <file> ${address.target}\` shows the extension elements).` : this.extRebuild(address.target, address.slot, ext.element, ext.property, FEEL.has(type));
    if (REMOVE.has(type)) return `Remove it (\`bpmn remove <file> ${id}\`), or change it to a kind the engine supports (\`bpmn retype <file> ${id} <kind>\`, \`bpmn kinds\` lists them).`;
    const key = this.attributeKey(address, report);
    if (!key) return this.fallback(id);
    const alias = SET_ALIASES[key.replace(/^definition\[\d+\]\./, 'definition.')];
    if (alias && !UNSET.has(type)) return `\`bpmn set <file> ${address.target} ${alias.split(' ').map((pair) => this.quoted(FEEL.has(type) ? pair.replace(/=<expression>$/, '==<expression>') : pair)).join(' ')}\`.`;
    if (UNSET.has(type)) return `Remove it: \`bpmn set <file> ${address.target} ${this.quoted(`${key}=`)}\`.`;
    const suggested = report.data?.suggestedValue ?? report.data?.requiredValue;
    if (SET.has(type)) return `\`bpmn set <file> ${address.target} ${this.quoted(`${key}=${typeof suggested === 'string' || typeof suggested === 'boolean' ? String(suggested) : FEEL.has(type) ? '=<expression>' : this.placeholder(key, address.node)}`)}\`.`;
    return this.fallback(id);
  }

  /**
   * Follows the path from the reported element: into a nested element of a flow node (a slot of
   * `bpmn set`) or a referenced root element (a message, an error), which `bpmn` then addresses.
   */
  private address(host: ModdleNode, path: ReadonlyArray<string | number>): Address | undefined {
    let node = host;
    let target = String(host.id);
    let slot = '';
    let index = 0;
    while (index < path.length) {
      const step = path[index]!;
      if (typeof step === 'number' || step === 'extensionElements') break;
      const value = node[step];
      const isLast = index === path.length - 1;
      if (isLast && !SLOTS[step]) break;
      const property = node.$descriptor?.propertiesByName?.[step];
      if (property?.isReference && value && typeof value === 'object' && (value as ModdleNode).id) {
        node = value as ModdleNode;
        target = String(node.id);
        slot = '';
        index++;
        continue;
      }
      if (!SLOTS[step] || node !== host) break;
      const many = Array.isArray(value) && value.length > 1;
      const position = typeof path[index + 1] === 'number' ? (path[index + 1] as number) : 0;
      const nested = Array.isArray(value) ? value[position] : value;
      if (!nested || typeof nested !== 'object') break;
      slot = `${SLOTS[step]}${many ? `[${position}]` : ''}.`;
      node = nested as ModdleNode;
      index += typeof path[index + 1] === 'number' ? 2 : 1;
    }
    return { target, slot, node, rest: path.slice(index) };
  }

  /**
   * The `bpmn set` key of the attribute the rest of the path names (`camunda:topic`,
   * `definition.name`); a path that ends at a nested element names the property it lacks in `data`.
   */
  private attributeKey(address: Address, report: BpmnlintEngineReport): string | undefined {
    const required = report.data?.requiredProperty;
    if (!address.rest.length && !required && address.slot === 'condition.') return 'conditionExpression';
    const [step, ...more] = address.rest.length ? address.rest : [Array.isArray(required) ? required[required.length - 1] : required];
    if (typeof step !== 'string' || more.some((part) => typeof part === 'string')) return undefined;
    const prefix = address.node.$descriptor?.propertiesByName?.[step]?.ns?.prefix;
    const name = step.includes(':') || !prefix || prefix === 'bpmn' ? step : `${prefix}:${step}`;
    return `${address.slot}${name}`;
  }

  private extensionStep(address: Address): { index: number; element: ModdleNode; property?: string } | undefined {
    const [first, values, index, property] = address.rest;
    if (first !== 'extensionElements' || values !== 'values' || typeof index !== 'number') return undefined;
    const element = ((address.node.extensionElements as ModdleNode | undefined)?.values as ModdleNode[] | undefined)?.[index];
    if (!element) return undefined;
    return { index, element, ...(typeof property === 'string' ? { property } : {}) };
  }

  private extAdd(address: Address, ext: { element: ModdleNode } | undefined, report: BpmnlintEngineReport): string {
    if (ext) return this.extRebuild(address.target, address.slot, ext.element, undefined, false);
    const required = report.data?.requiredExtensionElement ?? report.data?.requiredChildElement;
    const named = (Array.isArray(required) ? required : [required ?? '<type>']).map((type) => this.xmlName(String(type)));
    const types = named.includes('zeebe:taskDefinition') ? ['zeebe:taskDefinition', ...named.filter((type) => type !== 'zeebe:taskDefinition')] : named;
    const present = types.filter((type) => this.extensionTypes(address.node).includes(type));
    if (present.length > 1) return `Keep one: ${present.map((type, index) => `${index ? '(or ' : ''}\`bpmn ext remove <file> ${address.target} ${type}\`${index ? ')' : ''}`).join(' ')}.`;
    const owner = report.data?.node as ModdleNode | undefined;
    const target = owner?.id && owner.$type === 'bpmn:Message' ? owner.id : address.target;
    const slot = target === address.target ? address.slot : '';
    const [first, ...others] = types;
    const command = (type: string): string => {
      const attributes = REQUIRED_ATTRIBUTES[type];
      return `\`bpmn ext add <file> ${target} ${this.quoted(`${slot}${type}`)}${attributes ? ` ${attributes}` : ''}\``;
    };
    const lead = first === 'zeebe:taskDefinition' ? 'Give it a job type: ' : '';
    const alternatives = others.map((type) => ` (or ${ALTERNATIVES[type] ?? 'one'}: ${command(type)})`).join('');
    const kinds = REQUIRED_ATTRIBUTES[first!] ? '' : ' (`bpmn kinds` lists the extension elements and their attributes)';
    return `${lead}${command(first!)}${alternatives}${kinds}.`;
  }

  /**
   * `bpmn ext add --replace` that writes the extension element anew with all its attributes and
   * the one to fix; an element with child elements is rebuilt from its XML.
   */
  private extRebuild(target: string, slot: string, element: ModdleNode, property: string | undefined, feel: boolean): string {
    const type = this.xmlName(String(element.$type));
    const attributes = (element.$descriptor?.properties ?? []).filter((candidate) => candidate.isAttr && candidate.name !== property && Object.hasOwn(element, candidate.name) && element[candidate.name] !== undefined && typeof element[candidate.name] !== 'object').map((candidate) => this.quoted(`${candidate.name}=${String(element[candidate.name])}`));
    const required = REQUIRED_ATTRIBUTES[type]?.split(' ').filter((pair) => !attributes.some((attribute) => attribute.startsWith(`${pair.split('=')[0]}=`))) ?? [];
    const fixed = property ? [this.quoted(`${property}=${feel ? '=<expression>' : (PLACEHOLDERS[property] ?? `<${property}>`)}`)] : required;
    const hasChildren = (element.$descriptor?.properties ?? []).some((candidate) => !candidate.isAttr && element[candidate.name] !== undefined && typeof element[candidate.name] === 'object');
    if (hasChildren) return `See it with \`bpmn ext list <file> ${target} --json\`, then rebuild it: \`bpmn ext add <file> ${target} ${this.quoted(`${slot}${type}`)} --replace --xml '<${type} ...>...</${type}>'\`.`;
    return `\`bpmn ext add <file> ${target} ${[this.quoted(`${slot}${type}`), ...attributes, ...fixed, '--replace'].join(' ')}\`.`;
  }

  /**
   * A child of a container extension (a listener, an input or output mapping) that lacks or has a
   * wrong attribute: it is removed and added again, its siblings stay.
   */
  private childRebuild(address: Address, container: ModdleNode): string | undefined {
    const [, , , list, position, property] = address.rest;
    if (typeof list !== 'string' || typeof position !== 'number' || typeof property !== 'string') return undefined;
    const element = (container[list] as ModdleNode[] | undefined)?.[position];
    if (!element?.$type) return undefined;
    const containerName = this.xmlName(String(container.$type));
    const childName = this.xmlName(String(element.$type));
    const added = containerName === 'zeebe:ioMapping' ? childName : `${containerName}/${childName}`;
    const attributes = (element.$descriptor?.properties ?? []).filter((candidate) => candidate.isAttr && candidate.name !== property && typeof element[candidate.name] === 'string' && element[candidate.name] !== '').map((candidate) => this.quoted(`${candidate.name}=${String(element[candidate.name])}`));
    const fixed = this.quoted(`${property}=${PLACEHOLDERS[property] ?? `<${property}>`}`);
    return `Rebuild it: \`bpmn ext remove <file> ${address.target} ${this.quoted(`${containerName}/${childName}[${position}]`)}\`, then \`bpmn ext add <file> ${address.target} ${[this.quoted(`${address.slot}${added}`), ...attributes, fixed].join(' ')}\`.`;
  }

  /** Several event definitions: keep the one the engine acts on (the rule names it as `kept`). */
  private keepOneTrigger(id: string, report: BpmnlintEngineReport): string {
    const kept = report.data?.kept as ModdleNode | undefined;
    const trigger = kept?.$type ? TRIGGERS[kept.$type] : undefined;
    return `Keep one: \`bpmn set <file> ${id} trigger=${trigger ?? '<trigger>'}\` (the others are removed).`;
  }

  /** `bpmn add` of a BPMN element a process or sub-process lacks (a start event). */
  private addChild(id: string, host: ModdleNode, requiredType: string): string {
    const kind = requiredType === 'bpmn:Activity' ? 'serviceTask' : `${requiredType.charAt(5).toLowerCase()}${requiredType.slice(6)}`;
    return host.$type === 'bpmn:Process' ? `\`bpmn add <file> ${kind} "<Name>" --before <firstNodeId>\`.` : `\`bpmn add <file> ${kind} "<Name>" --in ${id}\`.`;
  }

  private extensionTypes(node: ModdleNode): string[] {
    return (((node.extensionElements as ModdleNode | undefined)?.values as ModdleNode[] | undefined) ?? []).map((value) => this.xmlName(String(value.$type)));
  }

  /** The element name of a type as the XML writes it: `zeebe:TaskDefinition` -> `zeebe:taskDefinition`. */
  private xmlName(type: string): string {
    const colon = type.indexOf(':');
    return `${type.slice(0, colon + 1)}${type.charAt(colon + 1).toLowerCase()}${type.slice(colon + 2)}`;
  }

  /** `<topic>` for `camunda:topic`, `<variable>` for `camunda:resultVariable`. */
  private placeholder(key: string, node?: ModdleNode): string {
    const name = key.slice(Math.max(key.lastIndexOf(':'), key.lastIndexOf('.')) + 1);
    if (name === 'name' && (node?.$type === 'bpmn:Message' || node?.$type === 'bpmn:Signal')) return `<${node.$type.slice(5)}Name>`;
    return PLACEHOLDERS[name] ?? `<${name}>`;
  }

  /** Quotes a shell argument when the shell would read it (a `<placeholder>` stays as it is). */
  private quoted(arg: string): string {
    return /^[A-Za-z0-9_.:=,/@+-]*(<[a-zA-Z ]+>)?$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
  }

  private fallback(id: string | undefined): string {
    return id ? `Fix what the message names on ${id}: \`bpmn show <file> ${id}\` shows the element.` : 'Fix what the message names in the XML.';
  }
}
