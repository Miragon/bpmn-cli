import { CamundaRule, ERROR_TYPES, type ModdleElement } from './CamundaRule.js';
import { RuleKit } from './RuleKit.js';
import { ElementKinds } from './support/ElementKinds.js';
import { SetCommand } from './support/SetCommand.js';
import { Shell } from './support/Shell.js';
import { WrittenModel } from './support/WrittenModel.js';

/**
 * Attributes without a namespace prefix that the BPMN schema does not define, for either engine
 * (`C7UnprefixedAttributesRule`, `C8UnprefixedAttributesRule` name the findings).
 * Both engines validate the file against the schema and refuse it. The typed parse turns some of
 * them into the vendor attribute of that name, so the rule reads each element as the file writes
 * it (`WrittenModel`) and reports on its typed twin. The hint suggests the prefixed vendor
 * attribute where one fits, converts bpmn-cli's own unprefixed decision link, and else says how
 * to remove it.
 *
 * @example an unprefixed assignee
 * <bpmn:userTask id="Review" assignee="anna" />  <!-- camunda:assignee -->
 */
export abstract class UnprefixedAttributesRule extends CamundaRule {
  private model!: WrittenModel;

  protected visit(node: ModdleElement): void {
    const model = WrittenModel.of(node);
    const el = model?.written(node);
    const keys = Object.keys(el?.$attrs ?? {}).filter((key) => !key.includes(':') && key !== 'xmlns');
    if (!model || !keys.length) return;
    this.model = model;
    const { kit } = RuleKit;
    const parent = el.$parent;
    const slot = parent?.id ? SetCommand.slotIn(parent, el) : '';
    let owner = slot ? parent : el;
    while (owner && !owner.id) owner = owner.$parent;
    const id: string | undefined = owner?.id;
    const di = kit.isDiElement(el) || (!!owner && kit.isDiElement(owner));
    for (const key of keys) this.checkAttribute(el, owner, id, di ? undefined : slot || (el === owner ? '' : undefined), di, key);
  }

  private get prefix(): string {
    return this.engine === 'c8' ? 'zeebe' : (this.model.file.namespaces.prefixOf(RuleKit.kit.CAMUNDA.uri) ?? 'camunda');
  }

  private checkAttribute(el: ModdleElement, owner: ModdleElement | undefined, id: string | undefined, slot: string | undefined, di: boolean, key: string): void {
    const own = el === owner;
    const vendor = this.engine === 'c7' ? RuleKit.kit.CAMUNDA.attr(key) : undefined;
    const fits = !!vendor && own && !!id && vendor.owners.some((ownerType) => RuleKit.kit.is(el, ownerType));
    const where = own ? ElementKinds.describe(el) : `${el.$type}${id ? ` in ${id}` : ''}`;
    const remove = id && slot !== undefined ? `\`bpmn set <file> ${id} ${Shell.quote(`${slot}${key}=`)}\`` : undefined;
    const engines = this.engine === 'c8' ? 'Camunda 8 validates the file against the schema and refuses it' : 'the engines validate the file against the schema and refuse it';
    const message = `${where} has the attribute ${key}, which the BPMN schema does not define${fits ? ` (did you mean ${this.prefix}:${key}?)` : ''}; ${engines}`;
    const reported = this.model.typed(owner ?? this.model.file.definitions);
    this.report(`${this.engine}-unprefixed-attributes`, reported, message, { path: null, type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, writtenAt: this.model.position(el), subject: `schema:${key}`, hint: this.hint(el, id, key, fits, remove, di) });
  }

  private hint(el: ModdleElement, id: string | undefined, key: string, fits: boolean, remove: string | undefined, di: boolean): string {
    const link = id && RuleKit.kit.is(el, 'bpmn:BusinessRuleTask') && (key === 'calledDecision' || key === 'calledElement') && !this.implemented(el) ? this.model.file.decisionLinks.linkOf(el) : undefined;
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
  private implemented(el: ModdleElement): boolean {
    return Object.keys(el.$attrs ?? {}).some((name) => /^[\w.-]+:(class|delegateExpression|expression|type)$/.test(name) && RuleKit.kit.CAMUNDA.reads(this.model.file.namespaces.uriOfName(name)));
  }
}
