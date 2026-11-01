import { type BpmnElement, CAMUNDA, IdWords, ZEEBE } from '../../../model/index.js';
import type { C7DescriptorNames } from './C7DescriptorNames.js';
import type { C7ExtensionContentRules } from './C7ExtensionContentRules.js';
import { C7Rules } from './C7Rules.js';
import { NameSuggestion } from '../rules/NameSuggestion.js';
import type { RuleContext } from '../rules/RuleContext.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C7ExtensionRules extends C7Rules {
  private static readonly EXTRA_HOSTS: Record<string, string[]> = {
  potentialStarter: ['bpmn:Process'],
  errorEventDefinition: ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask', 'bpmn:MessageEventDefinition', 'bpmn:IntermediateThrowEvent', 'bpmn:EndEvent'],
};
  private static readonly EXTRA_ATTRS: Record<string, string[]> = { field: ['expression'] };

  private readonly errors: Map<string, BpmnElement>;

  constructor(
    context: RuleContext,
    private readonly names: C7DescriptorNames,
    private readonly content: C7ExtensionContentRules,
  ) {
    super(context);
    this.errors = new Map(this.document.tree.rootElementsOfType('bpmn:Error').map((error) => [error.id, error] as const));
  }

  check(element: BpmnElement, reporter: RuleReporter): void {
    this.checkExtensions(element, reporter.owner, reporter.executable, reporter);
    if (!element.is('bpmn:Definitions')) {
      this.checkVendorRefs(element, reporter.owner, reporter);
    }
  }

  private allowedTop(local: string, host: BpmnElement): boolean {
    const vendorType = CAMUNDA.type(local);
    if (!vendorType) {
      return true;
    }
    const hosts = [...vendorType.allowedIn, ...(C7ExtensionRules.EXTRA_HOSTS[local] ?? [])];
    return hosts.some((allowedHost) => allowedHost === '*' || (allowedHost.startsWith('bpmn:') && host.is(allowedHost)));
  }

  private checkVendorElement(vendorElement: BpmnElement, host: BpmnElement, owner: BpmnElement | undefined, topEl: BpmnElement, path: string, reporter: RuleReporter): void {
    const local = IdWords.localName(vendorElement.type);
    const vendorType = CAMUNDA.type(local);
    if (!vendorType) {
      return;
    }
    const rebuild = (): string => this.extHint(host, owner, topEl, IdWords.localName(topEl.type));
    const where = `${this.prefix}:${local}${path ? ` (in ${path})` : ''} of ${this.describe(host, owner)}`;
    const names = this.names.attrNames(vendorType);
    for (const extra of C7ExtensionRules.EXTRA_ATTRS[local] ?? []) {
      names.add(extra);
    }
    for (const [key, raw] of Object.entries(vendorElement.raw)) {
      if (key.startsWith('$') || key.startsWith('xmlns')) {
        continue;
      }
      if (key.includes(':')) {
        if (this.ns.uriOfName(key) === ZEEBE.uri) {
          reporter.runtime({ code: 'W_C7_FOREIGN_CONTENT', element: host, owner, subject: `ext:${path}/${local}@${key}`, message: `${where} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`, hint: rebuild() });
        }
        continue;
      }
      if (!names.has(key)) {
        const guess = new NameSuggestion().closest(key, [...names]);
        reporter.runtime({ code: 'W_C7_UNKNOWN_ATTRIBUTE', element: host, owner, subject: `ext:${path}/${local}@${key}`, message: `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${guess}?)` : ''}; the engines ignore it`, hint: rebuild() });
        continue;
      }
      const prop = vendorType.properties.find((property) => property.name === key);
      if (prop?.type === 'Boolean' && raw !== 'true' && raw !== 'false' && raw !== true && raw !== false) {
        reporter.runtime({ code: 'W_C7_BAD_VALUE', element: host, owner, subject: `ext:${path}/${local}@${key}`, message: `${key}="${String(raw)}" on ${where} is not true or false; the engines read only the exact value true`, hint: rebuild() });
      }
    }
    const texts = this.names.textChildNames(vendorType);
    const kids = vendorElement.peek<unknown[]>('$children');
    for (const child of Array.isArray(kids) ? (kids as BpmnElement[]) : []) {
      if (!child || typeof child.type !== 'string' || !child.isGeneric) {
        continue;
      }
      const uri = this.ns.uriOfElement(child);
      const cl = IdWords.localName(child.type);
      if (uri === ZEEBE.uri) {
        reporter.runtime({ code: 'W_C7_FOREIGN_CONTENT', element: host, owner, subject: `ext:${path}/${local}/${cl}`, message: `${where} contains the Camunda 8 element ${child.type}, which Camunda 7 ignores`, hint: rebuild() });
        continue;
      }
      if (!CAMUNDA.reads(uri)) {
        continue;
      }
      const childPath = path ? `${path} > ${this.prefix}:${local}` : `${this.prefix}:${local}`;
      if (texts.has(cl)) {
        continue;
      }
      const ct = CAMUNDA.type(cl);
      if (!ct) {
        const guess = new NameSuggestion().closest(cl, [...texts, ...vendorType.properties.filter((property) => property.type.startsWith('camunda:')).map((property) => IdWords.localName(property.type).replace(/^./, (firstLetter) => firstLetter.toLowerCase()))]);
        reporter.runtime({ code: 'W_C7_UNKNOWN_ELEMENT', element: host, owner, subject: `ext:${childPath}/${cl}`, message: `${where} contains the unknown element ${this.prefix}:${cl}${guess ? ` (did you mean ${this.prefix}:${guess}?)` : ''}; the engines ignore it`, hint: rebuild() });
        continue;
      }
      if (!CAMUNDA.containersOf(cl).includes(vendorType.name)) {
        reporter.runtime({ code: 'W_C7_MISPLACED_EXTENSION', element: host, owner, subject: `ext:${childPath}/${cl}`, message: `${this.prefix}:${cl} does not belong inside ${this.prefix}:${local} (${where}); the engines ignore it`, hint: rebuild() });
        continue;
      }
      this.checkVendorElement(child, host, owner, topEl, childPath, reporter);
    }
  }

  private isAsync(el: BpmnElement): boolean {
    return ['async', 'asyncBefore', 'asyncAfter'].some((asyncAttribute) => this.c7(el, asyncAttribute) === 'true');
  }

  private hasTimer(el: BpmnElement): boolean {
    return el.list('eventDefinitions').some((definition) => definition.is('bpmn:TimerEventDefinition'));
  }

  checkExtensions(host: BpmnElement, owner: BpmnElement | undefined, executable: boolean, reporter: RuleReporter): void {
    const values = this.extensionValues(host);
    if (!values.length) {
      return;
    }
    const addr = this.addressOf(host, owner);
    const hostId = addr?.id;
    const slot = addr?.prefix ?? '';
    const where = this.describe(host, owner);
    if (host.is('bpmn:Definitions')) {
      const types = values.map((extValue) => extValue.el.type).join(', ');
      reporter.deploy({ code: 'W_C7_DEPLOY_DEFINITIONS_EXTENSION', element: host, subject: 'definitions', message: `bpmn:definitions carries bpmn:extensionElements (${types}), which the BPMN schema does not allow there; the engines refuse the file`, hint: `Move the content to the process: \`bpmn ext remove <file> ${hostId ?? '<definitionsId>'} <type>\`, then \`bpmn ext add <file> <processId> <type> ...\`.` });
      return;
    }
    const byType = new Map<string, { local: string; type: string; uri: string; els: BpmnElement[] }>();
    for (const extValue of values) {
      if (!extValue.uri) {
        continue;
      }
      if (extValue.uri === ZEEBE.uri) {
        reporter.runtime({ code: 'W_C7_FOREIGN_CONTENT', element: host, owner, subject: `ext:${extValue.el.type}`, message: `${where} contains the Camunda 8 extension ${extValue.el.type}, which Camunda 7 ignores`, hint: hostId ? `Remove it: \`bpmn ext remove <file> ${hostId} ${ShellWords.slotted(slot, extValue.el.type)}\`.` : 'Remove it from the XML.' });
        continue;
      }
      if (!CAMUNDA.reads(extValue.uri)) {
        continue;
      }
      const vendorType = CAMUNDA.type(extValue.local);
      if (!vendorType) {
        const guess = new NameSuggestion().closest(extValue.local, this.names.typeNames());
        reporter.runtime({ code: 'W_C7_UNKNOWN_ELEMENT', element: host, owner, subject: `ext:${extValue.local}`, message: `${where} has the unknown extension element ${this.prefix}:${extValue.local}${guess ? ` (did you mean ${this.prefix}:${guess}?)` : ''}; the engines ignore it`, hint: hostId ? `Remove it (\`bpmn ext remove <file> ${hostId} ${ShellWords.slotted(slot, String(extValue.index))}\`) and add the right one with \`bpmn ext add <file> ${hostId} ${ShellWords.slotted(slot, `${this.prefix}:${guess ?? '<type>'}`)} ...\`.` : 'Fix it in the XML.' });
        continue;
      }
      const key = `${extValue.uri}\u0000${extValue.local}`;
      const group = byType.get(key) ?? { local: extValue.local, type: extValue.el.type, uri: extValue.uri, els: [] };
      group.els.push(extValue.el);
      byType.set(key, group);
      const side = this.wrongSide(host, owner, extValue.local, 'ext');
      if (side) {
        reporter.runtime({ code: 'W_C7_MISPLACED_EXTENSION', element: host, owner, subject: `ext:${extValue.local}`, message: `${extValue.el.type} on ${where} has no effect: the engines read it on ${side} only`, hint: hostId ? `Remove it: \`bpmn ext remove <file> ${hostId} ${ShellWords.quote(`${slot}${this.selectorOf(host, extValue.el)}`)}\`.` : 'Remove it from the XML.' });
        continue;
      }
      if (!this.allowedTop(extValue.local, host)) {
        const containers = vendorType.allowedIn.length ? [] : CAMUNDA.containersOf(extValue.local);
        const message = containers.length
          ? `${this.prefix}:${extValue.local} sits directly in the extension elements of ${where}, but belongs inside ${containers.map((container) => container.replace(/^camunda:/, `${this.prefix}:`)).join(' / ')}; the engines ignore it`
          : `${this.prefix}:${extValue.local} on ${where} has no effect: the engines read it on ${this.kindsText([...vendorType.allowedIn, ...(C7ExtensionRules.EXTRA_HOSTS[extValue.local] ?? [])])} only`;
        const again = this.extAddArgs(extValue.el, `${this.prefix}:${extValue.local}`);
        const hint = !hostId
          ? 'Fix it in the XML.'
          : containers.length
            ? `Remove it (\`bpmn ext remove <file> ${hostId} ${ShellWords.slotted(slot, String(extValue.index))}\`) and add it again, \`bpmn ext add\` files it into its container: ${again ? `\`bpmn ext add <file> ${hostId} ${ShellWords.slotted(slot, again)}\`` : `\`bpmn ext add <file> ${hostId} ${ShellWords.slotted(slot, `${this.prefix}:${extValue.local}`)} --xml '...'\``}.`
            : `Remove it: \`bpmn ext remove <file> ${hostId} ${ShellWords.slotted(slot, String(extValue.index))}\`${this.movable(host, owner, extValue.local, again)}.`;
        reporter.runtime({ code: 'W_C7_MISPLACED_EXTENSION', element: host, owner, subject: `ext:${extValue.local}`, message, hint });
        continue;
      }
      this.checkVendorElement(extValue.el, host, owner, extValue.el, '', reporter);
      if (executable) {
        this.content.check(extValue.el, reporter);
      }
    }
    if (!executable) {
      return;
    }
    for (const { local, type, uri, els } of byType.values()) {
      if (els.length < 2) {
        continue;
      }
      let read = false;
      if (local === 'inputOutput') {
        read = host.is('bpmn:FlowNode');
      } else if (local === 'connector') {
        read = C7Rules.SERVICE_LIKE.some((serviceType) => host.is(serviceType));
      } else if (local === 'formData') {
        read = host.is('bpmn:UserTask') || host.is('bpmn:StartEvent');
      } else if (local === 'failedJobRetryTimeCycle') {
        read = this.isAsync(host) || this.hasTimer(host);
      } else {
        continue;
      }
      if (!read && local !== 'failedJobRetryTimeCycle') {
        continue;
      }
      const merge = hostId ? `Merge them into one: \`bpmn ext list <file> ${hostId} --json\`, then \`bpmn ext add <file> ${hostId} ${ShellWords.slotted(slot, type)} --replace --xml '<${type}>...</${type}>'\`.` : 'Merge them in the XML.';
      const subject = `dup:${local}${uri === CAMUNDA.uri ? '' : `@${uri}`}`;
      if (read) {
        reporter.deploy({ code: 'W_C7_DEPLOY_DUPLICATE_EXTENSION', element: host, owner, subject, message: `${where} has ${els.length} ${type} elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name ${local})`, hint: merge });
      } else {
        reporter.practice({ code: 'W_C7_DUPLICATE_EXTENSION', element: host, owner, subject, message: `${where} has ${els.length} ${type} elements; once it runs asynchronously the engines refuse the file`, hint: merge });
      }
    }
    this.content.checkInputOutputHost(host, owner, [...byType.values()].filter((group) => group.local === 'inputOutput').flatMap((group) => group.els), reporter);
  }

  private movable(host: BpmnElement, owner: BpmnElement | undefined, local: string, again: string | undefined): string {
    const oid = owner?.id;
    if (!owner || owner === host || !oid || !again || !this.allowedTop(local, owner) || this.camundaExt(owner, local).length) {
      return '';
    }
    return `, then add it to ${this.describe(owner, undefined)}, where the engines read it: \`bpmn ext add <file> ${oid} ${again}\``;
  }

  checkVendorRefs(host: BpmnElement, owner: BpmnElement | undefined, reporter: RuleReporter): void {
    for (const extValue of this.extensionValues(host)) {
      if (!extValue.uri || !CAMUNDA.reads(extValue.uri)) {
        continue;
      }
      for (const ref of CAMUNDA.idReferenceAttrs()) {
        if (IdWords.localName(ref.element) !== extValue.local) {
          continue;
        }
        const target = this.attr(extValue.el, ref.attr);
        if (target === undefined) {
          continue;
        }
        const el = this.document.tree.byId(target);
        if (el && el.is(ref.target)) {
          continue;
        }
        const candidates = ref.target === 'bpmn:Error' ? [...this.errors.keys()] : [];
        const pointAt = `Point it at an existing one${candidates.length ? ` (${candidates.slice(0, 5).join(', ')})` : ''}`;
        reporter.runtime({ code: 'W_C7_DANGLING_REF', element: host, owner, subject: `ref:${extValue.local}#${extValue.index}@${ref.attr}`, message: `${extValue.el.type} of ${this.describe(host, owner)} references ${ref.attr}="${target}", which is not a ${ref.target} in the file; the engines ignore the mapping when it runs`, hint: `${pointAt}. ${this.extHint(host, owner, extValue.el, extValue.local, { [ref.attr]: `<${IdWords.localName(ref.target).replace(/^./, (firstLetter) => firstLetter.toLowerCase())}Id>` })}` });
      }
    }
  }
}
