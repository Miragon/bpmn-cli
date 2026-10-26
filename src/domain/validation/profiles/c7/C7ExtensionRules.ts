import type { El } from '../../../document/utils/moddle.js';
import type { RuleRun } from '../RuleRun.js';
import { attr, idOf, isGeneric, list, localName, peek } from '../../utils/element.js';
import { didYouMean, sh, slotted } from '../../utils/hint.js';
import { extAddArgs, kindsText } from '../../utils/c7-hint.js';
import type { C7DescriptorNames } from './C7DescriptorNames.js';
import type { C7ExtensionContentRules } from './C7ExtensionContentRules.js';
import { C7Rules, SERVICE_LIKE } from './C7Rules.js';

/**
 * Content of an event definition the engines read on one side only (the descriptor allows it on
 * both): delegate settings on message throw events, async and camunda:in on signal throw events,
 * the code variables on error and escalation catch events.
 */
const SIDE_RULES: Array<{ def: string; side: 'throw' | 'catch'; attrs: string[]; ext: string[]; where: string }> = [
  { def: 'bpmn:MessageEventDefinition', side: 'throw', attrs: ['class', 'delegateExpression', 'expression', 'resultVariable', 'type', 'topic', 'taskPriority'], ext: ['field', 'connector'], where: 'message throw and end events' },
  { def: 'bpmn:SignalEventDefinition', side: 'throw', attrs: ['async'], ext: ['in'], where: 'signal throw and end events' },
  { def: 'bpmn:ErrorEventDefinition', side: 'catch', attrs: ['errorCodeVariable', 'errorMessageVariable'], ext: [], where: 'error boundary and error start events' },
  { def: 'bpmn:EscalationEventDefinition', side: 'catch', attrs: ['escalationCodeVariable'], ext: [], where: 'escalation boundary and escalation start events' },
];

/** Hosts the descriptor misses but the engines read. */
const EXTRA_HOSTS: Record<string, string[]> = {
  potentialStarter: ['bpmn:Process'],
  errorEventDefinition: ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask', 'bpmn:MessageEventDefinition', 'bpmn:IntermediateThrowEvent', 'bpmn:EndEvent'],
};

/** Attributes the engines read that the descriptor knows as child elements only. */
const EXTRA_ATTRS: Record<string, string[]> = { field: ['expression'] };

/**
 * Camunda attributes and extension elements against the descriptor: unknown, misplaced,
 * duplicated or Camunda 8 content, and id references inside camunda content.
 */
export class C7ExtensionRules extends C7Rules {
  private readonly errors: Map<string, El>;

  constructor(
    run: RuleRun,
    prefix: string,
    private readonly names: C7DescriptorNames,
    private readonly content: C7ExtensionContentRules,
  ) {
    super(run, prefix);
    this.errors = new Map(run.doc.rootElementsOfType('bpmn:Error').map((error) => [idOf(error) ?? '', error] as const));
  }

  private wrongSide(def: El, owner: El | undefined, local: string, kind: 'attrs' | 'ext'): string | undefined {
    if (!owner || !list(owner, 'eventDefinitions').includes(def)) return undefined;
    const side = this.kit.is(owner, 'bpmn:CatchEvent') ? 'catch' : this.kit.is(owner, 'bpmn:ThrowEvent') ? 'throw' : undefined;
    if (!side) return undefined;
    const rule = SIDE_RULES.find((sideRule) => this.kit.is(def, sideRule.def) && sideRule[kind].includes(local));
    return rule && rule.side !== side ? rule.where : undefined;
  }

  /** camunda / zeebe attributes of a BPMN element: unknown, misplaced, foreign, bad booleans. */
  checkAttributes(el: El, owner: El | undefined): void {
    const addr = this.addressOf(el, owner);
    const where = this.describe(el, owner);
    for (const [key, raw] of Object.entries(el.$attrs ?? {})) {
      const uri = this.ns.uriOfName(key);
      if (!uri) continue;
      const local = key.slice(key.indexOf(':') + 1);
      const value = raw === undefined || raw === null ? '' : String(raw);
      const unset = addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${key}=`)}\`` : 'edit the XML';
      if (uri === this.kit.zeebe.uri) {
        this.push('runtime', 'W_C7_FOREIGN_CONTENT', el, owner, `attr:${key}`, `${where} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`, `Remove it: ${unset}, and use the camunda attribute instead (\`bpmn kinds\` lists them).`);
        continue;
      }
      if (!this.kit.camunda.reads(uri)) continue;
      const def = this.kit.camunda.attr(local);
      if (!def) {
        const applicable = this.kit.camunda.attrs().filter((attribute) => attribute.owners.some((ownerType) => this.kit.is(el, ownerType))).map((attribute) => localName(attribute.name));
        const guess = didYouMean(local, this.kit.camunda.attrs().map((attribute) => localName(attribute.name)), applicable);
        const prefix = key.slice(0, key.indexOf(':'));
        const fits = !!guess && applicable.includes(guess);
        const elsewhere = guess && !fits ? ` It applies to ${kindsText(this.kit.camunda.attr(guess)!.owners)} only.` : '';
        this.push(
          'runtime',
          'W_C7_UNKNOWN_ATTRIBUTE',
          el,
          owner,
          `attr:${key}`,
          `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${prefix}:${guess}?${elsewhere})` : ''}; the engines ignore it`,
          fits && addr ? `Rename it: \`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${key}=`)} ${sh(`${addr.prefix}${prefix}:${guess}=${value}`)}\`.` : `Remove it: ${unset}.`,
        );
        continue;
      }
      const owned = def.owners.some((ownerType) => this.kit.is(el, ownerType));
      const readOn = owned ? this.wrongSide(el, owner, local, 'attrs') : kindsText(def.owners);
      if (readOn !== undefined) {
        this.push('runtime', 'W_C7_MISPLACED_ATTRIBUTE', el, owner, `attr:${key}`, `${key} on ${where} has no effect: the engines read it on ${readOn} only`, owned ? `Remove it: ${unset}.` : this.misplacedHint(el, owner, key, local, value, def.owners));
        continue;
      }
      if (def.type === 'Boolean' && value !== 'true' && value !== 'false') {
        this.push('runtime', 'W_C7_BAD_VALUE', el, owner, `attr:${key}`, `${key}="${value}" on ${where} is not true or false; the engines read only the exact value true (yes, TRUE or True leave it off)`, addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${key}=true`)}\` (or =false).` : 'Use true or false.');
      }
    }
  }

  private misplacedHint(el: El, owner: El | undefined, key: string, local: string, value: string, owners: string[]): string {
    const addr = this.addressOf(el, owner);
    const id = addr?.id;
    const move = (prefix: string): string => `\`bpmn set <file> ${id} ${sh(`${addr!.prefix}${key}=`)} ${sh(`${prefix}${this.prefix}:${local}=${value}`)}\``;
    if (id && addr!.prefix === '') {
      const defs = list(el, 'eventDefinitions');
      const fit = defs.findIndex((definition) => owners.some((ownerType) => this.kit.is(definition, ownerType)));
      if (this.kit.is(el, 'bpmn:Event') && fit !== -1) {
        return `It belongs on the event definition: ${move(defs.length > 1 ? `definition[${fit}].` : 'definition.')}.`;
      }
      if (this.kit.is(el, 'bpmn:Activity') && owners.includes('bpmn:MultiInstanceLoopCharacteristics')) {
        const mi = this.isMultiInstance(el);
        return `It belongs on the multi-instance loop: ${move('loop.')}${mi ? '' : ' (creates a parallel multi-instance loop)'}.`;
      }
      if (this.kit.is(el, 'bpmn:SequenceFlow') && owners.includes('bpmn:FormalExpression') && peek<El>(el, 'conditionExpression')) {
        return `It belongs on the condition: ${move('condition.')}.`;
      }
    }
    return id ? `Remove it: \`bpmn set <file> ${id} ${sh(`${addr!.prefix}${key}=`)}\`.` : 'Remove it from the XML.';
  }

  private allowedTop(local: string, host: El): boolean {
    const vendorType = this.kit.camunda.type(local);
    if (!vendorType) return true;
    const hosts = [...vendorType.allowedIn, ...(EXTRA_HOSTS[local] ?? [])];
    return hosts.some((allowedHost) => allowedHost === '*' || (allowedHost.startsWith('bpmn:') && this.kit.is(host, allowedHost)));
  }

  /** Attributes and children of a generic camunda element, recursively. */
  private checkVendorElement(vendorElement: El, host: El, owner: El | undefined, topEl: El, path: string): void {
    const local = localName(vendorElement.$type);
    const vendorType = this.kit.camunda.type(local);
    if (!vendorType) return;
    const rebuild = (): string => this.extHint(host, owner, topEl, localName(topEl.$type));
    const where = `${this.prefix}:${local}${path ? ` (in ${path})` : ''} of ${this.describe(host, owner)}`;
    const names = this.names.attrNames(vendorType);
    for (const extra of EXTRA_ATTRS[local] ?? []) names.add(extra);
    for (const [key, raw] of Object.entries(vendorElement as unknown as Record<string, unknown>)) {
      if (key.startsWith('$') || key.startsWith('xmlns')) continue;
      if (key.includes(':')) {
        if (this.ns.uriOfName(key) === this.kit.zeebe.uri) this.push('runtime', 'W_C7_FOREIGN_CONTENT', host, owner, `ext:${path}/${local}@${key}`, `${where} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`, rebuild());
        continue;
      }
      if (!names.has(key)) {
        const guess = didYouMean(key, [...names]);
        this.push('runtime', 'W_C7_UNKNOWN_ATTRIBUTE', host, owner, `ext:${path}/${local}@${key}`, `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${guess}?)` : ''}; the engines ignore it`, rebuild());
        continue;
      }
      const prop = vendorType.properties.find((property) => property.name === key);
      if (prop?.type === 'Boolean' && raw !== 'true' && raw !== 'false' && raw !== true && raw !== false) {
        this.push('runtime', 'W_C7_BAD_VALUE', host, owner, `ext:${path}/${local}@${key}`, `${key}="${String(raw)}" on ${where} is not true or false; the engines read only the exact value true`, rebuild());
      }
    }
    const texts = this.names.textChildNames(vendorType);
    const kids = peek<unknown[]>(vendorElement, '$children');
    for (const child of Array.isArray(kids) ? (kids as El[]) : []) {
      if (!child || typeof child.$type !== 'string' || !isGeneric(child)) continue;
      const uri = this.ns.uriOfElement(child);
      const cl = localName(child.$type);
      if (uri === this.kit.zeebe.uri) {
        this.push('runtime', 'W_C7_FOREIGN_CONTENT', host, owner, `ext:${path}/${local}/${cl}`, `${where} contains the Camunda 8 element ${child.$type}, which Camunda 7 ignores`, rebuild());
        continue;
      }
      if (!this.kit.camunda.reads(uri)) continue;
      const childPath = path ? `${path} > ${this.prefix}:${local}` : `${this.prefix}:${local}`;
      if (texts.has(cl)) continue;
      const ct = this.kit.camunda.type(cl);
      if (!ct) {
        const guess = didYouMean(cl, [...texts, ...vendorType.properties.filter((property) => property.type.startsWith('camunda:')).map((property) => localName(property.type).replace(/^./, (firstLetter) => firstLetter.toLowerCase()))]);
        this.push('runtime', 'W_C7_UNKNOWN_ELEMENT', host, owner, `ext:${childPath}/${cl}`, `${where} contains the unknown element ${this.prefix}:${cl}${guess ? ` (did you mean ${this.prefix}:${guess}?)` : ''}; the engines ignore it`, rebuild());
        continue;
      }
      if (!this.kit.camunda.containersOf(cl).includes(vendorType.name)) {
        this.push('runtime', 'W_C7_MISPLACED_EXTENSION', host, owner, `ext:${childPath}/${cl}`, `${this.prefix}:${cl} does not belong inside ${this.prefix}:${local} (${where}); the engines ignore it`, rebuild());
        continue;
      }
      this.checkVendorElement(child, host, owner, topEl, childPath);
    }
  }

  private isAsync(el: El): boolean {
    return ['async', 'asyncBefore', 'asyncAfter'].some((asyncAttribute) => this.c7(el, asyncAttribute) === 'true');
  }

  private hasTimer(el: El): boolean {
    return list(el, 'eventDefinitions').some((definition) => this.kit.is(definition, 'bpmn:TimerEventDefinition'));
  }

  /**
   * Extension elements of one BPMN element: unknown or misplaced types, duplicates, foreign
   * content, and the engine rules on their content.
   */
  checkExtensions(host: El, owner: El | undefined, executable: boolean): void {
    const values = this.extensionValues(host);
    if (!values.length) return;
    /**
     * `ext` addresses a nested element's extensions through its flow node (or flow) with a key
     * prefix, also when it has an id of its own (`ext <ownId> definition.0` fails)
     */
    const addr = this.addressOf(host, owner);
    const hostId = addr?.id;
    const slot = addr?.prefix ?? '';
    const where = this.describe(host, owner);
    if (this.kit.is(host, 'bpmn:Definitions')) {
      const types = values.map((extValue) => extValue.el.$type).join(', ');
      this.push('deploy', 'W_C7_DEPLOY_DEFINITIONS_EXTENSION', host, undefined, 'definitions', `bpmn:definitions carries bpmn:extensionElements (${types}), which the BPMN schema does not allow there; the engines refuse the file`, `Move the content to the process: \`bpmn ext remove <file> ${hostId ?? '<definitionsId>'} <type>\`, then \`bpmn ext add <file> <processId> <type> ...\`.`);
      return;
    }
    // per namespace: Operaton reads one operaton:inputOutput next to one camunda:inputOutput
    const byType = new Map<string, { local: string; type: string; uri: string; els: El[] }>();
    for (const extValue of values) {
      if (!extValue.uri) continue;
      if (extValue.uri === this.kit.zeebe.uri) {
        this.push('runtime', 'W_C7_FOREIGN_CONTENT', host, owner, `ext:${extValue.el.$type}`, `${where} contains the Camunda 8 extension ${extValue.el.$type}, which Camunda 7 ignores`, hostId ? `Remove it: \`bpmn ext remove <file> ${hostId} ${slotted(slot, extValue.el.$type)}\`.` : 'Remove it from the XML.');
        continue;
      }
      if (!this.kit.camunda.reads(extValue.uri)) continue;
      const vendorType = this.kit.camunda.type(extValue.local);
      if (!vendorType) {
        const guess = didYouMean(extValue.local, this.names.typeNames());
        this.push('runtime', 'W_C7_UNKNOWN_ELEMENT', host, owner, `ext:${extValue.local}`, `${where} has the unknown extension element ${this.prefix}:${extValue.local}${guess ? ` (did you mean ${this.prefix}:${guess}?)` : ''}; the engines ignore it`, hostId ? `Remove it (\`bpmn ext remove <file> ${hostId} ${slotted(slot, String(extValue.index))}\`) and add the right one with \`bpmn ext add <file> ${hostId} ${slotted(slot, `${this.prefix}:${guess ?? '<type>'}`)} ...\`.` : 'Fix it in the XML.');
        continue;
      }
      const key = `${extValue.uri}\u0000${extValue.local}`;
      const group = byType.get(key) ?? { local: extValue.local, type: extValue.el.$type, uri: extValue.uri, els: [] };
      group.els.push(extValue.el);
      byType.set(key, group);
      const side = this.wrongSide(host, owner, extValue.local, 'ext');
      if (side) {
        this.push('runtime', 'W_C7_MISPLACED_EXTENSION', host, owner, `ext:${extValue.local}`, `${extValue.el.$type} on ${where} has no effect: the engines read it on ${side} only`, hostId ? `Remove it: \`bpmn ext remove <file> ${hostId} ${sh(`${slot}${this.selectorOf(host, extValue.el)}`)}\`.` : 'Remove it from the XML.');
        continue;
      }
      if (!this.allowedTop(extValue.local, host)) {
        const containers = vendorType.allowedIn.length ? [] : this.kit.camunda.containersOf(extValue.local);
        const message = containers.length
          ? `${this.prefix}:${extValue.local} sits directly in the extension elements of ${where}, but belongs inside ${containers.map((container) => container.replace(/^camunda:/, `${this.prefix}:`)).join(' / ')}; the engines ignore it`
          : `${this.prefix}:${extValue.local} on ${where} has no effect: the engines read it on ${kindsText([...vendorType.allowedIn, ...(EXTRA_HOSTS[extValue.local] ?? [])])} only`;
        const again = extAddArgs(extValue.el, `${this.prefix}:${extValue.local}`);
        const hint = !hostId
          ? 'Fix it in the XML.'
          : containers.length
            ? `Remove it (\`bpmn ext remove <file> ${hostId} ${slotted(slot, String(extValue.index))}\`) and add it again, \`bpmn ext add\` files it into its container: ${again ? `\`bpmn ext add <file> ${hostId} ${slotted(slot, again)}\`` : `\`bpmn ext add <file> ${hostId} ${slotted(slot, `${this.prefix}:${extValue.local}`)} --xml '...'\``}.`
            : `Remove it: \`bpmn ext remove <file> ${hostId} ${slotted(slot, String(extValue.index))}\`${this.movable(host, owner, extValue.local, again)}.`;
        this.push('runtime', 'W_C7_MISPLACED_EXTENSION', host, owner, `ext:${extValue.local}`, message, hint);
        continue;
      }
      this.checkVendorElement(extValue.el, host, owner, extValue.el, '');
      if (executable) this.content.checkContent(host, owner, extValue.el, extValue.local);
    }
    if (!executable) return;
    // duplicates of the containers the engines read with a single-element lookup
    for (const { local, type, uri, els } of byType.values()) {
      if (els.length < 2) continue;
      let read = false;
      if (local === 'inputOutput') read = this.kit.is(host, 'bpmn:FlowNode');
      else if (local === 'connector') read = SERVICE_LIKE.some((serviceType) => this.kit.is(host, serviceType));
      else if (local === 'formData') read = this.kit.is(host, 'bpmn:UserTask') || this.kit.is(host, 'bpmn:StartEvent');
      else if (local === 'failedJobRetryTimeCycle') read = this.isAsync(host) || this.hasTimer(host);
      else continue;
      if (!read && local !== 'failedJobRetryTimeCycle') continue;
      const merge = hostId ? `Merge them into one: \`bpmn ext list <file> ${hostId} --json\`, then \`bpmn ext add <file> ${hostId} ${slotted(slot, type)} --replace --xml '<${type}>...</${type}>'\`.` : 'Merge them in the XML.';
      const subject = `dup:${local}${uri === this.kit.camunda.uri ? '' : `@${uri}`}`;
      if (read) {
        this.push('deploy', 'W_C7_DEPLOY_DUPLICATE_EXTENSION', host, owner, subject, `${where} has ${els.length} ${type} elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name ${local})`, merge);
      } else {
        this.push('practice', 'W_C7_DUPLICATE_EXTENSION', host, owner, subject, `${where} has ${els.length} ${type} elements; once it runs asynchronously the engines refuse the file`, merge);
      }
    }
    this.content.checkInputOutputHost(host, owner, [...byType.values()].filter((group) => group.local === 'inputOutput').flatMap((group) => group.els));
  }

  /**
   * `, then add it to <flow node>: ...` when an extension element on a nested element is read on
   * the flow node that holds it and that node has none of its type yet; '' otherwise.
   */
  private movable(host: El, owner: El | undefined, local: string, again: string | undefined): string {
    const oid = idOf(owner);
    if (!owner || owner === host || !oid || !again || !this.allowedTop(local, owner) || this.camundaExt(owner, local).length) return '';
    return `, then add it to ${this.describe(owner, undefined)}, where the engines read it: \`bpmn ext add <file> ${oid} ${again}\``;
  }

  /** Id references inside camunda content (camunda:errorEventDefinition errorRef -> bpmn:Error). */
  checkVendorRefs(host: El, owner: El | undefined): void {
    for (const extValue of this.extensionValues(host)) {
      if (!extValue.uri || !this.kit.camunda.reads(extValue.uri)) continue;
      for (const ref of this.kit.camunda.idReferenceAttrs()) {
        if (localName(ref.element) !== extValue.local) continue;
        const target = attr(extValue.el, ref.attr);
        if (target === undefined) continue;
        const el = this.doc.get(target);
        if (el && this.kit.is(el, ref.target)) continue;
        const candidates = ref.target === 'bpmn:Error' ? [...this.errors.keys()] : [];
        const pointAt = `Point it at an existing one${candidates.length ? ` (${candidates.slice(0, 5).join(', ')})` : ''}`;
        this.push('runtime', 'W_C7_DANGLING_REF', host, owner, `ref:${extValue.local}#${extValue.index}@${ref.attr}`, `${extValue.el.$type} of ${this.describe(host, owner)} references ${ref.attr}="${target}", which is not a ${ref.target} in the file; the engines ignore the mapping when it runs`, `${pointAt}. ${this.extHint(host, owner, extValue.el, extValue.local, { [ref.attr]: `<${localName(ref.target).replace(/^./, (firstLetter) => firstLetter.toLowerCase())}Id>` })}`);
      }
    }
  }
}
