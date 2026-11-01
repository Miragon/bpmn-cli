import { type BpmnElement, CAMUNDA, type CamundaElementType, IdWords, ZEEBE } from '../../../model/index.js';
import type { C7DescriptorNames } from '../values/C7DescriptorNames.js';
import type { C7ExtensionContentRules } from './C7ExtensionContentRules.js';
import { C7Rules } from './C7Rules.js';
import type { ExtValue, RuleSite } from '../rules/CamundaRules.js';
import { NameSuggestion } from '../rules/NameSuggestion.js';
import type { RuleContext } from '../rules/RuleContext.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

type VendorSite = RuleSite & { topEl: BpmnElement; path: string; local: string; vendorType: CamundaElementType; rebuild: () => string };
type ExtensionSite = RuleSite & { hostId: string | undefined; slot: string; executable: boolean };
type ExtensionGroup = { local: string; type: string; uri: string; els: BpmnElement[] };

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

  private static allowedTop(local: string, host: BpmnElement): boolean {
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
    const site = { host, owner, topEl, path, local, vendorType, where, rebuild, reporter };
    const names = this.names.attrNames(vendorType);
    for (const extra of C7ExtensionRules.EXTRA_ATTRS[local] ?? []) {
      names.add(extra);
    }
    for (const [key, raw] of Object.entries(vendorElement.raw)) {
      this.checkVendorAttribute(site, names, key, raw);
    }
    const texts = this.names.textChildNames(vendorType);
    for (const child of this.genericChildren(vendorElement, undefined, () => true)) {
      this.checkVendorChild(site, texts, child);
    }
  }

  private checkVendorAttribute({ host, owner, path, local, vendorType, where, rebuild, reporter }: VendorSite, names: Set<string>, key: string, raw: unknown): void {
    if (key.startsWith('$') || key.startsWith('xmlns')) {
      return;
    }
    if (key.includes(':')) {
      if (this.ns.uriOfName(key) === ZEEBE.uri) {
        reporter.runtime({ code: 'W_C7_FOREIGN_CONTENT', element: host, owner, subject: `ext:${path}/${local}@${key}`, message: `${where} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`, hint: rebuild() });
      }
      return;
    }
    if (!names.has(key)) {
      const guess = new NameSuggestion().closest(key, [...names]);
      reporter.runtime({ code: 'W_C7_UNKNOWN_ATTRIBUTE', element: host, owner, subject: `ext:${path}/${local}@${key}`, message: `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${guess}?)` : ''}; the engines ignore it`, hint: rebuild() });
      return;
    }
    const prop = vendorType.properties.find((property) => property.name === key);
    if (prop?.type === 'Boolean' && raw !== 'true' && raw !== 'false' && raw !== true && raw !== false) {
      reporter.runtime({ code: 'W_C7_BAD_VALUE', element: host, owner, subject: `ext:${path}/${local}@${key}`, message: `${key}="${String(raw)}" on ${where} is not true or false; the engines read only the exact value true`, hint: rebuild() });
    }
  }

  private checkVendorChild({ host, owner, topEl, path, local, vendorType, where, rebuild, reporter }: VendorSite, texts: Set<string>, child: BpmnElement): void {
    const uri = this.ns.uriOfElement(child);
    const cl = IdWords.localName(child.type);
    if (uri === ZEEBE.uri) {
      reporter.runtime({ code: 'W_C7_FOREIGN_CONTENT', element: host, owner, subject: `ext:${path}/${local}/${cl}`, message: `${where} contains the Camunda 8 element ${child.type}, which Camunda 7 ignores`, hint: rebuild() });
      return;
    }
    if (!CAMUNDA.reads(uri)) {
      return;
    }
    const childPath = path ? `${path} > ${this.prefix}:${local}` : `${this.prefix}:${local}`;
    if (texts.has(cl)) {
      return;
    }
    const ct = CAMUNDA.type(cl);
    if (!ct) {
      const guess = new NameSuggestion().closest(cl, [...texts, ...vendorType.properties.filter((property) => property.type.startsWith('camunda:')).map((property) => IdWords.localName(property.type).replace(/^./, (firstLetter) => firstLetter.toLowerCase()))]);
      reporter.runtime({ code: 'W_C7_UNKNOWN_ELEMENT', element: host, owner, subject: `ext:${childPath}/${cl}`, message: `${where} contains the unknown element ${this.prefix}:${cl}${guess ? ` (did you mean ${this.prefix}:${guess}?)` : ''}; the engines ignore it`, hint: rebuild() });
      return;
    }
    if (!CAMUNDA.containersOf(cl).includes(vendorType.name)) {
      reporter.runtime({ code: 'W_C7_MISPLACED_EXTENSION', element: host, owner, subject: `ext:${childPath}/${cl}`, message: `${this.prefix}:${cl} does not belong inside ${this.prefix}:${local} (${where}); the engines ignore it`, hint: rebuild() });
      return;
    }
    this.checkVendorElement(child, host, owner, topEl, childPath, reporter);
  }

  private isAsync(el: BpmnElement): boolean {
    return ['async', 'asyncBefore', 'asyncAfter'].some((asyncAttribute) => this.c7(el, asyncAttribute) === 'true');
  }

  private static hasTimer(el: BpmnElement): boolean {
    return el.list('eventDefinitions').some((definition) => definition.is('bpmn:TimerEventDefinition'));
  }

  private checkExtensions(host: BpmnElement, owner: BpmnElement | undefined, executable: boolean, reporter: RuleReporter): void {
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
    const site = { host, owner, hostId, slot, where, executable, reporter };
    const byType = new Map<string, ExtensionGroup>();
    for (const extValue of values) {
      this.checkExtensionValue(site, extValue, byType);
    }
    if (!executable) {
      return;
    }
    for (const group of byType.values()) {
      this.checkDuplicates(site, group);
    }
    this.content.checkInputOutputHost(host, owner, [...byType.values()].filter((group) => group.local === 'inputOutput').flatMap((group) => group.els), reporter);
  }
  private checkExtensionValue(site: ExtensionSite, extValue: ExtValue, byType: Map<string, ExtensionGroup>): void {
    const { host, owner, hostId, slot, where, executable, reporter } = site;
    if (!extValue.uri) {
      return;
    }
    if (extValue.uri === ZEEBE.uri) {
      reporter.runtime({ code: 'W_C7_FOREIGN_CONTENT', element: host, owner, subject: `ext:${extValue.el.type}`, message: `${where} contains the Camunda 8 extension ${extValue.el.type}, which Camunda 7 ignores`, hint: hostId ? `Remove it: \`bpmn ext remove <file> ${hostId} ${ShellWords.slotted(slot, extValue.el.type)}\`.` : 'Remove it from the XML.' });
      return;
    }
    if (!CAMUNDA.reads(extValue.uri)) {
      return;
    }
    const vendorType = CAMUNDA.type(extValue.local);
    if (!vendorType) {
      this.reportUnknownExtension(site, extValue);
      return;
    }
    const key = `${extValue.uri}\u0000${extValue.local}`;
    const group = byType.get(key) ?? { local: extValue.local, type: extValue.el.type, uri: extValue.uri, els: [] };
    group.els.push(extValue.el);
    byType.set(key, group);
    const side = this.wrongSide(host, owner, extValue.local, 'ext');
    if (side) {
      reporter.runtime({ code: 'W_C7_MISPLACED_EXTENSION', element: host, owner, subject: `ext:${extValue.local}`, message: `${extValue.el.type} on ${where} has no effect: the engines read it on ${side} only`, hint: hostId ? `Remove it: \`bpmn ext remove <file> ${hostId} ${ShellWords.quote(`${slot}${this.selectorOf(host, extValue.el)}`)}\`.` : 'Remove it from the XML.' });
      return;
    }
    if (!C7ExtensionRules.allowedTop(extValue.local, host)) {
      this.reportMisplacedExtension(site, extValue, vendorType);
      return;
    }
    this.checkVendorElement(extValue.el, host, owner, extValue.el, '', reporter);
    if (executable) {
      this.content.check(extValue.el, reporter);
    }
  }

  private reportUnknownExtension({ host, owner, hostId, slot, where, reporter }: ExtensionSite, extValue: ExtValue): void {
    const guess = new NameSuggestion().closest(extValue.local, this.names.typeNames());
    reporter.runtime({ code: 'W_C7_UNKNOWN_ELEMENT', element: host, owner, subject: `ext:${extValue.local}`, message: `${where} has the unknown extension element ${this.prefix}:${extValue.local}${guess ? ` (did you mean ${this.prefix}:${guess}?)` : ''}; the engines ignore it`, hint: hostId ? `Remove it (\`bpmn ext remove <file> ${hostId} ${ShellWords.slotted(slot, String(extValue.index))}\`) and add the right one with \`bpmn ext add <file> ${hostId} ${ShellWords.slotted(slot, `${this.prefix}:${guess ?? '<type>'}`)} ...\`.` : 'Fix it in the XML.' });
  }

  private reportMisplacedExtension(site: ExtensionSite, extValue: ExtValue, vendorType: CamundaElementType): void {
    const { host, owner, where, reporter } = site;
    const containers = vendorType.allowedIn.length ? [] : CAMUNDA.containersOf(extValue.local);
    const message = containers.length
      ? `${this.prefix}:${extValue.local} sits directly in the extension elements of ${where}, but belongs inside ${containers.map((container) => container.replace(/^camunda:/, `${this.prefix}:`)).join(' / ')}; the engines ignore it`
      : `${this.prefix}:${extValue.local} on ${where} has no effect: the engines read it on ${this.kindsText([...vendorType.allowedIn, ...(C7ExtensionRules.EXTRA_HOSTS[extValue.local] ?? [])])} only`;
    reporter.runtime({ code: 'W_C7_MISPLACED_EXTENSION', element: host, owner, subject: `ext:${extValue.local}`, message, hint: this.misplacedHint(site, extValue, containers.length > 0) });
  }

  private misplacedHint({ host, owner, hostId, slot }: ExtensionSite, extValue: ExtValue, contained: boolean): string {
    if (!hostId) {
      return 'Fix it in the XML.';
    }
    const again = this.extAddArgs(extValue.el, `${this.prefix}:${extValue.local}`);
    if (contained) {
      return `Remove it (\`bpmn ext remove <file> ${hostId} ${ShellWords.slotted(slot, String(extValue.index))}\`) and add it again, \`bpmn ext add\` files it into its container: ${again ? `\`bpmn ext add <file> ${hostId} ${ShellWords.slotted(slot, again)}\`` : `\`bpmn ext add <file> ${hostId} ${ShellWords.slotted(slot, `${this.prefix}:${extValue.local}`)} --xml '...'\``}.`;
    }
    return `Remove it: \`bpmn ext remove <file> ${hostId} ${ShellWords.slotted(slot, String(extValue.index))}\`${this.movable(host, owner, extValue.local, again)}.`;
  }

  private readTwice(host: BpmnElement, local: string): boolean | undefined {
    if (local === 'inputOutput') {
      return host.is('bpmn:FlowNode');
    }
    if (local === 'connector') {
      return C7Rules.SERVICE_LIKE.some((serviceType) => host.is(serviceType));
    }
    if (local === 'formData') {
      return host.is('bpmn:UserTask') || host.is('bpmn:StartEvent');
    }
    return local === 'failedJobRetryTimeCycle' ? this.isAsync(host) || C7ExtensionRules.hasTimer(host) : undefined;
  }

  private checkDuplicates({ host, owner, hostId, slot, where, reporter }: ExtensionSite, { local, type, uri, els }: ExtensionGroup): void {
    const read = this.readTwice(host, local);
    if (els.length < 2 || read === undefined || (!read && local !== 'failedJobRetryTimeCycle')) {
      return;
    }
    const merge = hostId ? `Merge them into one: \`bpmn ext list <file> ${hostId} --json\`, then \`bpmn ext add <file> ${hostId} ${ShellWords.slotted(slot, type)} --replace --xml '<${type}>...</${type}>'\`.` : 'Merge them in the XML.';
    const subject = `dup:${local}${uri === CAMUNDA.uri ? '' : `@${uri}`}`;
    if (read) {
      reporter.deploy({ code: 'W_C7_DEPLOY_DUPLICATE_EXTENSION', element: host, owner, subject, message: `${where} has ${els.length} ${type} elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name ${local})`, hint: merge });
    } else {
      reporter.practice({ code: 'W_C7_DUPLICATE_EXTENSION', element: host, owner, subject, message: `${where} has ${els.length} ${type} elements; once it runs asynchronously the engines refuse the file`, hint: merge });
    }
  }

  private movable(host: BpmnElement, owner: BpmnElement | undefined, local: string, again: string | undefined): string {
    const oid = owner?.id;
    if (!owner || owner === host || !oid || !again || !C7ExtensionRules.allowedTop(local, owner) || this.camundaExt(owner, local).length) {
      return '';
    }
    return `, then add it to ${this.describe(owner, undefined)}, where the engines read it: \`bpmn ext add <file> ${oid} ${again}\``;
  }

  private checkVendorRefs(host: BpmnElement, owner: BpmnElement | undefined, reporter: RuleReporter): void {
    for (const extValue of this.extensionValues(host)) {
      if (!extValue.uri || !CAMUNDA.reads(extValue.uri)) {
        continue;
      }
      for (const ref of CAMUNDA.idReferenceAttrs().filter(({ element }) => IdWords.localName(element) === extValue.local)) {
        this.checkVendorRef(host, owner, extValue, ref, reporter);
      }
    }
  }

  private checkVendorRef(host: BpmnElement, owner: BpmnElement | undefined, extValue: ExtValue, ref: ReturnType<typeof CAMUNDA.idReferenceAttrs>[number], reporter: RuleReporter): void {
    const target = this.attr(extValue.el, ref.attr);
    if (target === undefined) {
      return;
    }
    const el = this.document.tree.byId(target);
    if (el && el.is(ref.target)) {
      return;
    }
    const candidates = ref.target === 'bpmn:Error' ? [...this.errors.keys()] : [];
    const pointAt = `Point it at an existing one${candidates.length ? ` (${candidates.slice(0, 5).join(', ')})` : ''}`;
    reporter.runtime({ code: 'W_C7_DANGLING_REF', element: host, owner, subject: `ref:${extValue.local}#${extValue.index}@${ref.attr}`, message: `${extValue.el.type} of ${this.describe(host, owner)} references ${ref.attr}="${target}", which is not a ${ref.target} in the file; the engines ignore the mapping when it runs`, hint: `${pointAt}. ${this.extHint(host, owner, extValue.el, extValue.local, { [ref.attr]: `<${IdWords.localName(ref.target).replace(/^./, (firstLetter) => firstLetter.toLowerCase())}Id>` })}` });
  }
}
