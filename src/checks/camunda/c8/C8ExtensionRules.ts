import { type BpmnElement, CAMUNDA, IdWords, ZEEBE } from '../../../model/index.js';
import { C8Rules } from './C8Rules.js';
import type { C8ZeebeContentRules } from './C8ZeebeContentRules.js';
import type { ExtValue } from '../rules/CamundaRules.js';
import { NameSuggestion } from '../rules/NameSuggestion.js';
import type { RuleContext } from '../rules/RuleContext.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C8ExtensionRules extends C8Rules {
  constructor(
    context: RuleContext,
    private readonly content: C8ZeebeContentRules,
  ) {
    super(context);
  }

  private static readonly FEEL_ATTRS: Record<string, string[]> = {
  taskDefinition: ['type', 'retries'],
  input: ['source'],
  output: ['source'],
  loopCharacteristics: ['inputCollection', 'outputElement'],
  calledElement: ['processId'],
  calledDecision: ['decisionId'],
  script: ['expression'],
  subscription: ['correlationKey'],
  assignmentDefinition: ['assignee', 'candidateGroups', 'candidateUsers'],
  taskSchedule: ['dueDate', 'followUpDate'],
  priorityDefinition: ['priority'],
  adHoc: ['activeElementsCollection', 'outputElement'],
};

  check(element: BpmnElement, reporter: RuleReporter): void {
    this.checkExtensions(element, reporter.owner, reporter);
  }

  private inputsIgnored(host: BpmnElement): string | undefined {
    if (host.is('bpmn:StartEvent')) {
      return 'start events';
    }
    if (host.is('bpmn:BoundaryEvent')) {
      return 'boundary events';
    }
    const defs = host.list('eventDefinitions');
    if (host.is('bpmn:IntermediateThrowEvent') && !defs.length) {
      return 'none intermediate throw events';
    }
    if (host.is('bpmn:EndEvent') && !defs.length) {
      return 'none end events';
    }
    return undefined;
  }

  checkExtensions(host: BpmnElement, owner: BpmnElement | undefined, reporter: RuleReporter): void {
    const values = this.extensionValues(host);
    if (!values.length) {
      return;
    }
    const addr = this.addressOf(host, owner);
    const where = this.describe(host, owner);
    const remove = (extValue: ExtValue): string => (addr ? `\`bpmn ext remove <file> ${addr.id} ${ShellWords.quote(`${addr.prefix}${extValue.index}`)}\`` : 'remove it from the XML');
    const counts = new Map<string, number>();
    for (const extValue of values) {
      if (!extValue.uri) {
        continue;
      }
      if (CAMUNDA.uris.has(extValue.uri)) {
        reporter.runtime({ code: 'W_C8_FOREIGN_CONTENT', element: host, owner, subject: `ext:${extValue.el.type}#${extValue.index}`, message: `${where} contains the Camunda 7 extension ${extValue.el.type}, which Camunda 8 ignores`, hint: this.foreignHint(host, owner, extValue.local, remove(extValue)) });
        continue;
      }
      if (extValue.uri !== ZEEBE.uri) {
        continue;
      }
      const zeebeType = ZEEBE.type(extValue.local);
      if (!zeebeType) {
        const guess = new NameSuggestion().closest(extValue.local, ZEEBE.typeNames().map((typeName) => IdWords.localName(typeName)));
        reporter.runtime({ code: 'W_C8_UNKNOWN_ELEMENT', element: host, owner, subject: `ext:${extValue.local}`, message: `${where} has the unknown extension element ${this.zeebeName(extValue.local)}${guess ? ` (did you mean ${this.zeebeName(guess)}?)` : ''}; Camunda 8 ignores it`, hint: `Remove it (${remove(extValue)})${guess && addr ? ` and add the right one: ${this.extAdd(host, owner, `${this.zeebeName(guess)} ...`)}` : ''}.` });
        continue;
      }
      if (ZEEBE.nestedOnly(extValue.local)) {
        const container = ZEEBE.containersOf(extValue.local)[0]!;
        reporter.runtime({ code: 'W_C8_MISPLACED_EXTENSION', element: host, owner, subject: `ext:${extValue.local}`, message: `${this.zeebeName(extValue.local)} sits directly in the extension elements of ${where}, but belongs inside ${this.zeebeName(IdWords.localName(container))}; Camunda 8 ignores it`, hint: `Remove it (${remove(extValue)}) and add it again, \`bpmn ext add\` files it into its container: ${this.extAdd(host, owner, `${this.zeebeName(extValue.local)} ...`)}.` });
        continue;
      }
      if (extValue.local === 'executionListeners' && host.is('bpmn:SequenceFlow')) {
        reporter.deploy({ code: 'W_C8_DEPLOY_LISTENER', element: host, owner, subject: 'listener:flow', message: `${where} has execution listeners; Camunda 8 supports them on processes, activities, events and gateways, not on sequence flows, and refuses the file`, hint: `Remove them (${remove(extValue)}) and put them on the flow's source or target.` });
        continue;
      }
      if (ZEEBE.allowedOn(extValue.local, host) === false) {
        const hosts = zeebeType.allowedIn.filter((allowedHost) => allowedHost.startsWith('bpmn:')).map((allowedHost) => IdWords.lcfirst(IdWords.localName(allowedHost)));
        reporter.runtime({ code: 'W_C8_MISPLACED_EXTENSION', element: host, owner, subject: `ext:${extValue.local}`, message: `${this.zeebeName(extValue.local)} on ${where} has no effect: Camunda 8 reads it on ${hosts.length > 5 ? `${hosts.slice(0, 5).join(', ')}, ...` : hosts.join(', ')} only`, hint: `Remove it: ${remove(extValue)}.` });
        continue;
      }
      counts.set(extValue.local, (counts.get(extValue.local) ?? 0) + 1);
      this.checkZeebeElement(host, owner, extValue.el, '', reporter);
    }
    for (const [local, count] of counts) {
      if (count < 2 || !ZEEBE.isSingle(local)) {
        continue;
      }
      reporter.deploy({ code: 'W_C8_DEPLOY_DUPLICATE_EXTENSION', element: host, owner, subject: `dup:${local}`, message: `${where} has ${count} ${this.zeebeName(local)} elements; Camunda 8 reads one and refuses the file`, hint: `Merge them into one: ${IdWords.lcfirst(this.rebuildHint(host, owner, this.zeebeName(local)).replace(/^See it/, 'See them'))}` });
    }
    const ignored = this.inputsIgnored(host);
    if (ignored) {
      for (const io of this.zeebe(host, 'ioMapping')) {
        for (const input of this.kids(io, 'input')) {
          const target = this.attr(input, 'target') ?? '';
          reporter.runtime({ code: 'W_C8_MISPLACED_EXTENSION', element: host, owner, subject: `input:${target}`, message: `The input mapping ${target ? `to ${target} ` : ''}on ${where} has no effect: Camunda 8 ignores input mappings on ${ignored} (output mappings work there)`, hint: addr ?`Remove it: \`bpmn ext remove <file> ${addr.id} ${ShellWords.quote(`${addr.prefix}${this.zeebeName('input')}[target=${target}]`)}\` (set the variable in an activity before it, or as an output mapping of the element before).` : 'Remove it from the XML.' });
        }
      }
    }
  }

  private checkZeebeElement(host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, path: string, reporter: RuleReporter): void {
    const local = IdWords.localName(zeebeElement.type);
    const zeebeType = ZEEBE.type(local);
    if (!zeebeType) {
      return;
    }
    const where = `${this.zeebeName(local)}${path ? ` (in ${path})` : ''} of ${this.describe(host, owner)}`;
    const names = new Set(zeebeType.attributes.map((attribute) => attribute.name));
    for (const attributeKey of Object.keys(zeebeElement.raw)) {
      if (attributeKey.startsWith('$') || attributeKey.startsWith('xmlns') || attributeKey.includes(':')) {
        continue;
      }
      if (names.has(attributeKey)) {
        continue;
      }
      const guess = new NameSuggestion().closest(attributeKey, [...names]);
      reporter.runtime({ code: 'W_C8_UNKNOWN_ATTRIBUTE', element: host, owner, subject: `ext:${path}/${local}@${attributeKey}`, message: `${where} has the unknown attribute ${attributeKey}${guess ? ` (did you mean ${guess}?)` : ''}; Camunda 8 ignores it`, hint: this.rebuildHint(host, owner, this.zeebeName(path ? path.split(' > ')[0]!.replace(/^[^:]+:/, '') : local)) });
    }
    for (const feelAttribute of C8ExtensionRules.FEEL_ATTRS[local] ?? []) {
      const value = this.attr(zeebeElement, feelAttribute);
      const target = this.attr(zeebeElement, 'target');
      const fix =
        (local === 'input' || local === 'output') && target && this.isFeel(value)
          ? `${this.extAdd(host, owner, `${this.zeebeName(local)} ${ShellWords.quote(`source==${this.feelOf(value!.trim().slice(1)).trim()}`)} target=${ShellWords.quote(target)}`)} (replaces the mapping of that target; check the FEEL syntax).`
          : path
            ? this.rebuildHint(host, owner, this.zeebeName(IdWords.localName(path.split(' > ')[0]!)))
            : this.fixHint(host, owner, zeebeElement, { [feelAttribute]: '=<FEEL expression>' });
      this.checkFeel(host, owner, `${path}/${local}@${feelAttribute}`, `${feelAttribute} of ${where}`, value, fix, reporter);
    }
    for (const child of this.kids(zeebeElement)) {
      const cl = IdWords.localName(child.type);
      const childPath = path ? `${path} > ${this.zeebeName(local)}` : this.zeebeName(local);
      if (!zeebeType.children.includes(`zeebe:${cl}`)) {
        const known = ZEEBE.type(cl);
        reporter.runtime({ code: known ? 'W_C8_MISPLACED_EXTENSION' : 'W_C8_UNKNOWN_ELEMENT', element: host, owner, subject: `ext:${childPath}/${cl}`, message: known ? `${this.zeebeName(cl)} does not belong inside ${this.zeebeName(local)} (${where}); Camunda 8 ignores it` : `${where} contains the unknown element ${this.zeebeName(cl)}; Camunda 8 ignores it`, hint: this.rebuildHint(host, owner, this.zeebeName(path ? IdWords.localName(path.split(' > ')[0]!) : local)) });
        continue;
      }
      this.checkZeebeElement(host, owner, child, childPath, reporter);
    }
    if (!path) {
      this.content.check(zeebeElement, reporter);
    }
  }
}
