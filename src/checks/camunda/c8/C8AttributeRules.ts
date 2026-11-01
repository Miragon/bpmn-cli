import { type BpmnElement, CAMUNDA, IdWords, ZEEBE } from '../../../model/index.js';
import { C8Rules } from './C8Rules.js';
import { NameSuggestion } from '../rules/NameSuggestion.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C8AttributeRules extends C8Rules {
  caughtMessages(): Set<BpmnElement> {
    const executable = this.document.tree.processes().filter((process) => process.peek<boolean>('isExecutable') === true);
    const catching = executable.flatMap((process) => [...this.document.tree.walk(process, { bpmnOnly: true })]).filter((element) => element.is('bpmn:Event') || element.is('bpmn:ReceiveTask'));
    return new Set(catching.map((element) => this.messageOf(element)).filter((message): message is BpmnElement => !!message));
  }

  check(element: BpmnElement, reporter: RuleReporter): void {
    for (const key of Object.keys(element.attrs ?? {})) {
      this.checkAttribute(element, reporter.owner, key, reporter);
    }
  }

  private checkAttribute(el: BpmnElement, owner: BpmnElement | undefined, key: string, reporter: RuleReporter): void {
    const uri = this.ns.uriOfName(key);
    if (!uri) {
      return;
    }
    const local = IdWords.localName(key);
    const where = this.describe(el, owner);
    const unset = this.unsetCommand(el, owner, key);
    if (CAMUNDA.uris.has(uri)) {
      reporter.runtime({ code: 'W_C8_FOREIGN_CONTENT', element: el, owner, subject: `attr:${key}`, message: `${where} carries the Camunda 7 attribute ${key}, which Camunda 8 ignores`, hint: this.foreignHint(el, owner, local, unset) });
      return;
    }
    if (uri !== ZEEBE.uri) {
      return;
    }
    const def = ZEEBE.attr(local);
    if (!def) {
      this.reportUnknownAttribute(el, owner, key, unset, reporter);
      return;
    }
    if (!def.owners.some((ownerType) => el.is(ownerType))) {
      reporter.runtime({ code: 'W_C8_MISPLACED_ATTRIBUTE', element: el, owner, subject: `attr:${key}`, message: `${key} on ${where} has no effect: Camunda 8 reads it on ${def.owners.map((ownerType) => IdWords.lcfirst(IdWords.localName(ownerType))).join(', ')} only`, hint: `Remove it: ${unset}.` });
    }
  }

  private reportUnknownAttribute(el: BpmnElement, owner: BpmnElement | undefined, key: string, unset: string, reporter: RuleReporter): void {
    const local = IdWords.localName(key);
    const home = ZEEBE.typeNames().find((typeName) => ZEEBE.allowedOn(typeName, el) === true && ZEEBE.type(typeName)!.attributes.some((attribute) => attribute.name === local));
    const guess = home ? undefined : new NameSuggestion().closest(local, ZEEBE.attrs().map((attribute) => IdWords.localName(attribute.name)));
    const value = String(el.attrs[key] ?? '');
    reporter.runtime({ code: 'W_C8_UNKNOWN_ATTRIBUTE', element: el, owner, subject: `attr:${key}`, message: `${this.describe(el, owner)} has the unknown attribute ${key}${guess ? ` (did you mean ${this.prefix}:${guess}?)` : ''}; Camunda 8 ignores it${home ? ` (it reads ${local} on the ${this.zeebeName(IdWords.localName(home))} extension element)` : ' (most zeebe settings are extension elements: `bpmn guide`)'}`, hint: home ? `Move it: ${unset}, then ${this.extAdd(el, owner, `${this.zeebeName(IdWords.localName(home))} ${ShellWords.quote(`${local}=${value}`)}`)}.` : `Remove it: ${unset}.` });
  }
}
