import type { El } from '../../../model/utils/moddle.js';
import { EngineRules, type Address } from '../EngineRules.js';
import { attr, idOf, isGeneric, list, localName, peek } from '../utils/element.js';
import { lowerFirst, sh, slotted } from '../utils/hint.js';
import { nonEmpty } from '../utils/value.js';
import { extAddArgs } from './utils/hint.js';

export const SERVICE_LIKE = ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask'];

/** Attributes that pick one item of a repeatable type, in the order a selector prefers them. */
const SELECTOR_KEYS = ['id', 'name', 'event', 'target', 'source', 'errorRef'];

/**
 * Base of the Camunda 7 rule classes (also CIB seven and Operaton): how the engines read
 * camunda content and event definitions, and how hints address it.
 */
export abstract class C7Rules extends EngineRules {
  protected override addressOf(el: El, owner: El | undefined): Address | undefined {
    if (owner && el !== owner && !idOf(owner)) return undefined;
    return super.addressOf(el, owner);
  }

  /** `userTask Activity_X`, `the multiInstanceLoopCharacteristics of userTask Activity_X` */
  protected describe(el: El, owner: El | undefined): string {
    const id = idOf(el);
    const kind = this.kit.isBpmnElement(el) ? this.kit.kindLabel(el).replace(/^bpmn:/, '') : el.$type;
    const k = lowerFirst(kind);
    if (id) return `${k} ${id}`;
    return owner ? `the ${k} of ${this.describe(owner, undefined)}` : k;
  }

  /**
   * Value of the camunda attribute `local` of a BPMN element. An operaton:* attribute wins
   * over the camunda one, like Operaton reads them (Camunda 7 and CIB seven ignore it).
   */
  protected c7(el: El | undefined, local: string): string | undefined {
    if (!el) return undefined;
    let fallback: string | undefined;
    for (const [k, v] of Object.entries(el.$attrs ?? {})) {
      if (k.slice(k.indexOf(':') + 1) !== local) continue;
      const uri = this.ns.uriOfName(k);
      if (!this.kit.camunda.reads(uri)) continue;
      const value = v === undefined || v === null ? undefined : String(v);
      if (uri === this.kit.OPERATON_URI) return value;
      fallback ??= value;
    }
    return fallback;
  }

  /** Top-level camunda extension elements of type `local`. */
  protected camundaExt(el: El, local: string): El[] {
    return this.extensionValues(el)
      .filter((v) => v.uri && this.kit.camunda.reads(v.uri) && v.local === local)
      .map((v) => v.el);
  }

  protected children(el: El, local?: string): El[] {
    const kids = peek<unknown[]>(el, '$children');
    if (!Array.isArray(kids)) return [];
    return (kids as El[]).filter((c) => {
      if (!c || typeof c !== 'object' || typeof c.$type !== 'string' || !isGeneric(c)) return false;
      const uri = this.ns.uriOfElement(c);
      return this.kit.camunda.reads(uri) && (local === undefined || localName(c.$type) === local);
    });
  }

  protected isMultiInstance(el: El | undefined): boolean {
    return this.kit.is(peek<El>(el, 'loopCharacteristics'), 'bpmn:MultiInstanceLoopCharacteristics');
  }

  /** `ext remove` selector of a top-level extension element: a unique attribute, else its index. */
  protected selectorOf(host: El, v: El): string {
    const same = this.extensionValues(host)
      .map((x) => x.el)
      .filter((x) => x.$type === v.$type);
    for (const k of SELECTOR_KEYS) {
      const val = attr(v, k);
      if (val === undefined || val === '' || same.filter((o) => attr(o, k) === val).length !== 1) continue;
      return `${v.$type}[${k}=${/^[\w.:-]+$/.test(val) ? val : `"${val.replace(/"/g, '\\"')}"`}]`;
    }
    return `${v.$type}[${Math.max(0, same.indexOf(v))}]`;
  }

  /**
   * How to rebuild the top-level extension element `v` of `host`. A single-instance type is
   * replaced as a whole (`--replace`); a repeatable one is removed by its own selector and added
   * again, as `--replace` would remove its siblings. `fix` puts placeholders in for attributes.
   */
  protected extHint(host: El, owner: El | undefined, v: El, local: string, fix: Record<string, string> = {}): string {
    const addr = this.addressOf(host, owner);
    if (!addr) return 'Fix it in the XML.';
    const slot = addr.prefix;
    const type = v.$type;
    if (this.kit.camunda.isSingle(local)) {
      return `See it with \`bpmn ext list <file> ${addr.id} --json\`, then rebuild it: \`bpmn ext add <file> ${addr.id} ${slotted(slot, type)} --replace --xml '<${type}>...</${type}>'\`.`;
    }
    const flat = extAddArgs(v, type, fix);
    const again = flat ? `\`bpmn ext add <file> ${addr.id} ${slotted(slot, flat)}\`` : `\`bpmn ext add <file> ${addr.id} ${slotted(slot, type)} --xml '<${type} ...>...</${type}>'\` (\`bpmn ext list <file> ${addr.id} --json\` shows it)`;
    return `Replace just this one (--replace would remove every ${type}): \`bpmn ext remove <file> ${addr.id} ${sh(`${slot}${this.selectorOf(host, v)}`)}\`, then ${again}.`;
  }

  /**
   * The order in which the engines pick the one event definition they act on when an event has
   * several (engine-checked, each pair in both XML orders): the first kind present wins, the others
   * are not even parsed. Undefined where the order is not known (every definition is checked then).
   */
  private actingOrder(el: El): string[] | undefined {
    if (this.kit.is(el, 'bpmn:IntermediateCatchEvent')) return ['Timer', 'Signal', 'Message', 'Link', 'Conditional'];
    if (this.kit.is(el, 'bpmn:BoundaryEvent')) return ['Timer', 'Signal', 'Message', 'Conditional'];
    if (this.kit.is(el, 'bpmn:IntermediateThrowEvent')) return ['Signal', 'Message'];
    if (this.kit.is(el, 'bpmn:EndEvent')) return ['Message', 'Signal'];
    if (this.kit.is(el, 'bpmn:StartEvent')) {
      const parent = el.$parent as El | undefined;
      if (parent && this.isEventSubProcess(parent)) return ['Message', 'Signal', 'Timer', 'Conditional'];
      if (parent && this.kit.is(parent, 'bpmn:Process')) return ['Timer', 'Message', 'Signal', 'Conditional'];
    }
    return undefined;
  }

  /** The definition the engines act on when `el` has several (undefined: one, or order unknown). */
  protected actingDefinition(el: El): El | undefined {
    const defs = list(el, 'eventDefinitions');
    const order = defs.length > 1 ? this.actingOrder(el) : undefined;
    if (!order) return undefined;
    const kinds = defs.map((d) => order.findIndex((k) => this.kit.is(d, `bpmn:${k}EventDefinition`)));
    if (kinds.some((k) => k === -1)) return undefined;
    return defs[kinds.indexOf(Math.min(...kinds))];
  }

  /** The event definitions the engines read: the acting one of several, else all. */
  protected actedOn(el: El): El[] {
    const acting = this.actingDefinition(el);
    return acting ? [acting] : list(el, 'eventDefinitions');
  }

  protected definitionOf(el: El, type: string): El | undefined {
    return this.actedOn(el).find((d) => this.kit.is(d, type));
  }

  /**
   * A condition the engines cannot evaluate: no expression text (blank counts) and no script
   * resource. They deploy it; evaluating it fails.
   */
  protected emptyCondition(expr: El): boolean {
    return !nonEmpty(peek<string>(expr, 'body')) && !nonEmpty(this.c7(expr, 'resource'));
  }
}
