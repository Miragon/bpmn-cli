import { type BpmnElement, CAMUNDA, IdWords, ZEEBE } from '../../../model/index.js';
import { C7Rules } from './C7Rules.js';
import { NameSuggestion } from '../rules/NameSuggestion.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C7AttributeRules extends C7Rules {
  check(element: BpmnElement, reporter: RuleReporter): void {
    this.checkAttributes(element, reporter.owner, reporter);
  }

  checkAttributes(el: BpmnElement, owner: BpmnElement | undefined, reporter: RuleReporter): void {
    const addr = this.addressOf(el, owner);
    const where = this.describe(el, owner);
    for (const [key, raw] of Object.entries(el.attrs ?? {})) {
      const uri = this.ns.uriOfName(key);
      if (!uri) {
        continue;
      }
      const local = key.slice(key.indexOf(':') + 1);
      const value = raw === undefined || raw === null ? '' : String(raw);
      const unset = addr ? `\`bpmn set <file> ${addr.id} ${ShellWords.quote(`${addr.prefix}${key}=`)}\`` : 'edit the XML';
      if (uri === ZEEBE.uri) {
        reporter.runtime({ code: 'W_C7_FOREIGN_CONTENT', element: el, owner, subject: `attr:${key}`, message: `${where} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`, hint: `Remove it: ${unset}, and use the camunda attribute instead (\`bpmn kinds\` lists them).` });
        continue;
      }
      if (!CAMUNDA.reads(uri)) {
        continue;
      }
      const def = CAMUNDA.attr(local);
      if (!def) {
        const applicable = CAMUNDA.attrs().filter((attribute) => attribute.owners.some((ownerType) => el.is(ownerType))).map((attribute) => IdWords.localName(attribute.name));
        const guess = new NameSuggestion().closest(local, CAMUNDA.attrs().map((attribute) => IdWords.localName(attribute.name)), applicable);
        const prefix = key.slice(0, key.indexOf(':'));
        const fits = !!guess && applicable.includes(guess);
        const elsewhere = guess && !fits ? ` It applies to ${this.kindsText(CAMUNDA.attr(guess)!.owners)} only.` : '';
        reporter.runtime({ code: 'W_C7_UNKNOWN_ATTRIBUTE', element: el, owner, subject: `attr:${key}`, message: `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${prefix}:${guess}?${elsewhere})` : ''}; the engines ignore it`, hint: fits && addr ? `Rename it: \`bpmn set <file> ${addr.id} ${ShellWords.quote(`${addr.prefix}${key}=`)} ${ShellWords.quote(`${addr.prefix}${prefix}:${guess}=${value}`)}\`.` : `Remove it: ${unset}.` });
        continue;
      }
      const owned = def.owners.some((ownerType) => el.is(ownerType));
      const readOn = owned ? this.wrongSide(el, owner, local, 'attrs') : this.kindsText(def.owners);
      if (readOn !== undefined) {
        reporter.runtime({ code: 'W_C7_MISPLACED_ATTRIBUTE', element: el, owner, subject: `attr:${key}`, message: `${key} on ${where} has no effect: the engines read it on ${readOn} only`, hint: owned ? `Remove it: ${unset}.` : this.misplacedHint(el, owner, key, local, value, def.owners) });
        continue;
      }
      if (def.type === 'Boolean' && value !== 'true' && value !== 'false') {
        reporter.runtime({ code: 'W_C7_BAD_VALUE', element: el, owner, subject: `attr:${key}`, message: `${key}="${value}" on ${where} is not true or false; the engines read only the exact value true (yes, TRUE or True leave it off)`, hint: addr ? `\`bpmn set <file> ${addr.id} ${ShellWords.quote(`${addr.prefix}${key}=true`)}\` (or =false).` : 'Use true or false.' });
      }
    }
  }

  private misplacedHint(el: BpmnElement, owner: BpmnElement | undefined, key: string, local: string, value: string, owners: string[]): string {
    const addr = this.addressOf(el, owner);
    const id = addr?.id;
    const move = (prefix: string): string => `\`bpmn set <file> ${id} ${ShellWords.quote(`${addr!.prefix}${key}=`)} ${ShellWords.quote(`${prefix}${this.prefix}:${local}=${value}`)}\``;
    if (id && addr!.prefix === '') {
      const defs = el.list('eventDefinitions');
      const fit = defs.findIndex((definition) => owners.some((ownerType) => definition.is(ownerType)));
      if (el.is('bpmn:Event') && fit !== -1) {
        return `It belongs on the event definition: ${move(defs.length > 1 ? `definition[${fit}].` : 'definition.')}.`;
      }
      if (el.is('bpmn:Activity') && owners.includes('bpmn:MultiInstanceLoopCharacteristics')) {
        const mi = this.isMultiInstance(el);
        return `It belongs on the multi-instance loop: ${move('loop.')}${mi ? '' : ' (creates a parallel multi-instance loop)'}.`;
      }
      if (el.is('bpmn:SequenceFlow') && owners.includes('bpmn:FormalExpression') && el.peek<BpmnElement>('conditionExpression')) {
        return `It belongs on the condition: ${move('condition.')}.`;
      }
    }
    return id ? `Remove it: \`bpmn set <file> ${id} ${ShellWords.quote(`${addr!.prefix}${key}=`)}\`.` : 'Remove it from the XML.';
  }
}
