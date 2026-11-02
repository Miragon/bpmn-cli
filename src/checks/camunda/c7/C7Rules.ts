import { type BpmnElement, CAMUNDA, CamundaDescriptor, IdWords, Kinds } from '../../../model/index.js';
import { CamundaRules } from '../rules/CamundaRules.js';
import type { ElementAddress } from '../rules/ElementAddress.js';
import { ShellWords } from '../rules/ShellWords.js';

export abstract class C7Rules extends CamundaRules {
  private static readonly SIDE_RULES: Array<{ def: string; side: 'throw' | 'catch'; attrs: string[]; ext: string[]; where: string }> = [
    { def: 'bpmn:MessageEventDefinition', side: 'throw', attrs: ['class', 'delegateExpression', 'expression', 'resultVariable', 'type', 'topic', 'taskPriority'], ext: ['field', 'connector'], where: 'message throw and end events' },
    { def: 'bpmn:SignalEventDefinition', side: 'throw', attrs: ['async'], ext: ['in'], where: 'signal throw and end events' },
    { def: 'bpmn:ErrorEventDefinition', side: 'catch', attrs: ['errorCodeVariable', 'errorMessageVariable'], ext: [], where: 'error boundary and error start events' },
    { def: 'bpmn:EscalationEventDefinition', side: 'catch', attrs: ['escalationCodeVariable'], ext: [], where: 'escalation boundary and escalation start events' },
  ];
  static readonly SERVICE_LIKE = ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask'];
  private static readonly SELECTOR_KEYS = ['id', 'name', 'event', 'target', 'source', 'errorRef'];
  private static readonly ACTING_ORDERS: Array<[string, string[]]> = [
    ['bpmn:IntermediateCatchEvent', ['Timer', 'Signal', 'Message', 'Link', 'Conditional']],
    ['bpmn:BoundaryEvent', ['Timer', 'Signal', 'Message', 'Conditional']],
    ['bpmn:IntermediateThrowEvent', ['Signal', 'Message']],
    ['bpmn:EndEvent', ['Message', 'Signal']],
  ];

  protected override addressOf(el: BpmnElement, owner: BpmnElement | undefined): ElementAddress | undefined {
    if (owner && el !== owner && !owner.id) {
      return undefined;
    }
    return super.addressOf(el, owner);
  }

  protected wrongSide(def: BpmnElement, owner: BpmnElement | undefined, local: string, kind: 'attrs' | 'ext'): string | undefined {
    if (!owner || !owner.list('eventDefinitions').includes(def)) {
      return undefined;
    }
    const side = C7Rules.sideOf(owner);
    if (!side) {
      return undefined;
    }
    const rule = C7Rules.SIDE_RULES.find((sideRule) => def.is(sideRule.def) && sideRule[kind].includes(local));
    return rule && rule.side !== side ? rule.where : undefined;
  }
  private static sideOf(event: BpmnElement): 'catch' | 'throw' | undefined {
    if (event.is('bpmn:CatchEvent')) {
      return 'catch';
    }
    return event.is('bpmn:ThrowEvent') ? 'throw' : undefined;
  }

  protected isExpression(value: string): boolean {
    return /[$#]\{/.test(value);
  }

  protected isNumber(value: string): boolean {
    return /^[+-]?\d+$/.test(value.trim()) && value.trim() === value;
  }

  protected kindsText(owners: readonly string[]): string {
    const names = owners.map((ownerType) => IdWords.lcfirst(ownerType.replace(/^bpmn:/, '')));
    return names.length > 4 ? `${names.slice(0, 4).join(', ')}, ...` : names.join(', ');
  }

  protected extAddArgs(vendorElement: BpmnElement, type: string, fix: Record<string, string> = {}): string | undefined {
    if (vendorElement.list('$children').length) {
      return undefined;
    }
    const entries = Object.entries(vendorElement.raw).filter(([key]) => !key.startsWith('$') && !key.startsWith('xmlns'));
    for (const key of Object.keys(fix)) {
      if (!entries.some(([existingKey]) => existingKey === key)) {
        entries.push([key, fix[key]]);
      }
    }
    const attrs = entries.map(([key, value]) => ShellWords.quote(`${key}=${key in fix ? fix[key] : String(value)}`));
    const body = vendorElement.peek<string>('$body');
    return [type, ...attrs, ...(body !== undefined ? [ShellWords.quote(`body=${body}`)] : [])].join(' ');
  }

  protected describe(el: BpmnElement, owner: BpmnElement | undefined): string {
    const id = el.id;
    const kind = el.isBpmn ? Kinds.label(el).replace(/^bpmn:/, '') : el.type;
    const kindName = IdWords.lcfirst(kind);
    if (id) {
      return `${kindName} ${id}`;
    }
    return owner ? `the ${kindName} of ${this.describe(owner, undefined)}` : kindName;
  }

  protected c7(el: BpmnElement | undefined, local: string): string | undefined {
    if (!el) {
      return undefined;
    }
    let fallback: string | undefined;
    for (const [key, rawValue] of Object.entries(el.attrs ?? {})) {
      if (key.slice(key.indexOf(':') + 1) !== local) {
        continue;
      }
      const uri = this.ns.uriOfName(key);
      if (!CAMUNDA.reads(uri)) {
        continue;
      }
      const value = rawValue === undefined || rawValue === null ? undefined : String(rawValue);
      if (uri === CamundaDescriptor.OPERATON_URI) {
        return value;
      }
      fallback ??= value;
    }
    return fallback;
  }

  protected camundaExt(el: BpmnElement, local: string): BpmnElement[] {
    return this.extensionValues(el)
      .filter((extValue) => extValue.uri && CAMUNDA.reads(extValue.uri) && extValue.local === local)
      .map((extValue) => extValue.el);
  }

  protected children(el: BpmnElement, local?: string): BpmnElement[] {
    return this.genericChildren(el, local, (uri) => CAMUNDA.reads(uri));
  }

  protected isMultiInstance(el: BpmnElement | undefined): boolean {
    return el?.peek<BpmnElement>('loopCharacteristics')?.is('bpmn:MultiInstanceLoopCharacteristics') === true;
  }

  protected selectorOf(host: BpmnElement, vendorElement: BpmnElement): string {
    const same = this.extensionValues(host)
      .map((extValue) => extValue.el)
      .filter((element) => element.type === vendorElement.type);
    for (const key of C7Rules.SELECTOR_KEYS) {
      const val = this.attr(vendorElement, key);
      if (val === undefined || val === '' || same.filter((sibling) => this.attr(sibling, key) === val).length !== 1) {
        continue;
      }
      return `${vendorElement.type}[${key}=${/^[\w.:-]+$/.test(val) ? val : `"${val.replace(/"/g, '\\"')}"`}]`;
    }
    return `${vendorElement.type}[${Math.max(0, same.indexOf(vendorElement))}]`;
  }

  protected extHint(host: BpmnElement, owner: BpmnElement | undefined, vendorElement: BpmnElement, local: string, fix: Record<string, string> = {}): string {
    const addr = this.addressOf(host, owner);
    if (!addr) {
      return 'Fix it in the XML.';
    }
    const slot = addr.prefix;
    const type = vendorElement.type;
    if (CAMUNDA.isSingle(local)) {
      return `See it with \`bpmn show <file> ${addr.id}\`, then rebuild it: \`bpmn ext add <file> ${addr.id} ${ShellWords.slotted(slot, type)} --replace --xml '<${type}>...</${type}>'\`.`;
    }
    const flat = this.extAddArgs(vendorElement, type, fix);
    const again = flat ? `\`bpmn ext add <file> ${addr.id} ${ShellWords.slotted(slot, flat)}\`` : `\`bpmn ext add <file> ${addr.id} ${ShellWords.slotted(slot, type)} --xml '<${type} ...>...</${type}>'\` (\`bpmn show <file> ${addr.id}\` shows it)`;
    return `Replace just this one (--replace would remove every ${type}): \`bpmn ext remove <file> ${addr.id} ${ShellWords.quote(`${slot}${this.selectorOf(host, vendorElement)}`)}\`, then ${again}.`;
  }

  private static actingOrder(el: BpmnElement): string[] | undefined {
    const order = C7Rules.ACTING_ORDERS.find(([type]) => el.is(type))?.[1];
    if (order || !el.is('bpmn:StartEvent')) {
      return order;
    }
    const parent = el.parent;
    if (parent && Kinds.isEventSubProcess(parent)) {
      return ['Message', 'Signal', 'Timer', 'Conditional'];
    }
    return parent?.is('bpmn:Process') ? ['Timer', 'Message', 'Signal', 'Conditional'] : undefined;
  }

  protected actingDefinition(el: BpmnElement): BpmnElement | undefined {
    const defs = el.list('eventDefinitions');
    const order = defs.length > 1 ? C7Rules.actingOrder(el) : undefined;
    if (!order) {
      return undefined;
    }
    const kinds = defs.map((definition) => order.findIndex((kind) => definition.is(`bpmn:${kind}EventDefinition`)));
    if (kinds.some((kind) => kind === -1)) {
      return undefined;
    }
    return defs[kinds.indexOf(Math.min(...kinds))];
  }

  protected actedOn(el: BpmnElement): readonly BpmnElement[] {
    const acting = this.actingDefinition(el);
    return acting ? [acting] : el.list('eventDefinitions');
  }

  protected definitionOf(el: BpmnElement, type: string): BpmnElement | undefined {
    return this.actedOn(el).find((definition) => definition.is(type));
  }

  protected emptyCondition(expr: BpmnElement): boolean {
    return !this.nonEmpty(expr.peek<string>('body')) && !this.nonEmpty(this.c7(expr, 'resource'));
  }
}
