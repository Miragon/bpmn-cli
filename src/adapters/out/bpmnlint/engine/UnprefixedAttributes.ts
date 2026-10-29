import type { ProfileFinding } from '../../../../domain/document/Finding.js';
import type { El } from '../../../../domain/document/utils/moddle.js';
import { OwnModelCheck } from './OwnModelCheck.js';
import { ElementKinds } from './rules/support/ElementKinds.js';
import { SetCommand } from './rules/support/SetCommand.js';
import { Shell } from './rules/support/Shell.js';

/**
 * Attributes without a namespace prefix that the BPMN schema does not define, which both engines
 * refuse (cvc-complex-type.3.2.2). A typed parse reads some of them as the vendor attribute of
 * that name (`assignee` on a user task as `camunda:assignee`), so a bpmnlint rule cannot see
 * them: bpmn-cli reads its own model, where they stay what the file says.
 */
export class UnprefixedAttributes extends OwnModelCheck {
  private readonly code = this.engine === 'c8' ? 'W_C8_DEPLOY_SCHEMA' : 'W_C7_DEPLOY_SCHEMA';
  private readonly prefix = this.engine === 'c8' ? 'zeebe' : (this.ns.prefixOf(this.kit.CAMUNDA.uri) ?? 'camunda');

  findings(): ProfileFinding[] {
    const out: ProfileFinding[] = [];
    for (const el of this.kit.walk(this.doc.definitions, { bpmnOnly: true })) {
      const keys = Object.keys(el.$attrs ?? {}).filter((key) => !key.includes(':') && key !== 'xmlns');
      if (!keys.length) continue;
      const parent = el.$parent as El | undefined;
      const slot = parent && this.kit.peek<string>(parent, 'id') ? SetCommand.slotIn(parent, el) : '';
      let owner: El | undefined = slot ? parent : el;
      while (owner && !this.kit.peek<string>(owner, 'id')) owner = owner.$parent as El | undefined;
      const id = owner ? this.kit.peek<string>(owner, 'id') : undefined;
      const di = this.kit.isDiElement(el) || (!!owner && this.kit.isDiElement(owner));
      for (const key of keys) out.push(this.finding(el, owner, id, di ? undefined : slot || (el === owner ? '' : undefined), di, key));
    }
    return out;
  }

  private finding(el: El, owner: El | undefined, id: string | undefined, slot: string | undefined, di: boolean, key: string): ProfileFinding {
    const own = el === owner;
    const vendor = this.engine === 'c7' ? this.kit.CAMUNDA.attr(key) : undefined;
    const fits = !!vendor && own && !!id && vendor.owners.some((ownerType) => this.kit.is(el, ownerType));
    const where = own ? ElementKinds.describe(el) : `${el.$type}${id ? ` in ${id}` : ''}`;
    const remove = id && slot !== undefined ? `\`bpmn set <file> ${id} ${Shell.quote(`${slot}${key}=`)}\`` : undefined;
    const engines = this.engine === 'c8' ? 'Camunda 8 validates the file against the schema and refuses it' : 'the engines validate the file against the schema and refuse it';
    const message = `${where} has the attribute ${key}, which the BPMN schema does not define${fits ? ` (did you mean ${this.prefix}:${key}?)` : ''}; ${engines}`;
    return this.kit.makeFinding('deploy', this.code, message, id ?? this.kit.peek<string>(this.doc.definitions, 'id'), { subject: `schema:${key}`, hint: this.hint(el, id, key, fits, remove, di) });
  }

  private hint(el: El, id: string | undefined, key: string, fits: boolean, remove: string | undefined, di: boolean): string {
    const link = id && this.kit.is(el, 'bpmn:BusinessRuleTask') && (key === 'calledDecision' || key === 'calledElement') && !this.implemented(el) ? new this.kit.DecisionLinkReader(this.doc).linkOf(el) : undefined;
    if (link) {
      const command = `\`bpmn set <file> ${id} ${Shell.quote(`calledDecision=${link.value}`)}\``;
      return this.engine === 'c7' ? `Write the decision link in the engines' spelling: ${command} (${this.prefix}:decisionRef; the unprefixed ${key} is removed).` : `Write the decision link the Camunda 8 way: ${command} (${this.prefix}:calledDecision; the unprefixed ${key} is removed; give it a resultVariable).`;
    }
    if (fits) return `Use the vendor attribute instead: \`bpmn set <file> ${id} ${Shell.quote(`${key}=`)} ${Shell.quote(`${this.prefix}:${key}=${String(el.$attrs[key] ?? '')}`)}\`.`;
    const prefixed = this.engine === 'c8' ? 'vendor attributes need their namespace prefix; Camunda 8 settings are mostly zeebe: extension elements' : `vendor attributes need their namespace prefix, e.g. ${this.prefix}:<name>`;
    if (remove) return `Remove it: ${remove} (${prefixed}).`;
    if (di) return this.engine === 'c8' ? `Remove ${key}="..." from the XML of ${id ?? 'the diagram element'}, or redraw the diagram: \`bpmn layout <file>\` (the hand-made layout is lost).` : `Remove ${key}="..." from the XML of ${id ?? 'the diagram element'}, or redraw the diagram, which writes new diagram elements: \`bpmn layout <file>\` (the hand-made layout is lost).`;
    return this.engine === 'c8' ? `Remove ${key}="..." from the XML${id ? ` of ${id}` : ''}.` : `Remove ${key}="..." from the XML${id ? ` of ${id}` : ''} (${prefixed}).`;
  }

  /** Another implementation stays, so the unprefixed attribute is no decision link. */
  private implemented(el: El): boolean {
    return Object.keys(el.$attrs ?? {}).some((name) => /^[\w.-]+:(class|delegateExpression|expression|type)$/.test(name) && this.kit.CAMUNDA.reads(this.ns.uriOfName(name)));
  }
}
