import { is } from 'bpmnlint-utils';
import type { EngineKit } from '../../engine-kit.js';
import { CamundaRule, ERROR_TYPES, type ModdleElement } from './CamundaRule.js';
import { RuleKit } from './RuleKit.js';
import { DidYouMean } from './support/DidYouMean.js';
import { ElementKinds } from './support/ElementKinds.js';
import { EngineScope } from './support/EngineScope.js';
import { SetCommand } from './support/SetCommand.js';
import { WrittenModel } from './support/WrittenModel.js';

type VendorType = NonNullable<ReturnType<EngineKit['ZEEBE']['type']> | ReturnType<EngineKit['CAMUNDA']['type']>>;
type CamundaType = NonNullable<ReturnType<EngineKit['CAMUNDA']['type']>>;

const ENGINE_NAME = { c7: 'the engines', c8: 'Camunda 8' };

/**
 * Extension elements of the engine's own namespace that its descriptor does not know, or that sit
 * where the engine does not read them, for either engine (`C7UnknownVendorElementsRule`,
 * `C8UnknownVendorElementsRule` name the findings).
 * The engine ignores them silently. The typed parse drops them with a warning that names neither
 * the element nor where it sat, so the rule reads the extension elements of each element of an
 * executable process as the file writes them (`WrittenModel`) and reports on the typed twin, with
 * the known name a typo most likely meant.
 *
 * @example a misspelled extension element
 * <bpmn:serviceTask id="Charge">
 *   <bpmn:extensionElements><zeebe:taskDefinitions type="charge" /></bpmn:extensionElements>  <!-- zeebe:taskDefinition -->
 * </bpmn:serviceTask>
 */
export abstract class UnknownVendorElementsRule extends CamundaRule {
  private model!: WrittenModel;
  private node!: ModdleElement;

  protected visit(node: ModdleElement): boolean | void {
    if (is(node, 'bpmn:Definitions')) return;
    if (!EngineScope.inExecutableProcess(node)) return false;
    const model = WrittenModel.of(node);
    const host = model?.written(node);
    if (!host) return;
    this.model = model!;
    this.node = node;
    (host.extensionElements?.values ?? []).forEach((value: ModdleElement, index: number) => this.checkValue(host, value, index));
  }

  private get vendor(): EngineKit['ZEEBE'] | EngineKit['CAMUNDA'] {
    return this.engine === 'c8' ? RuleKit.kit.ZEEBE : RuleKit.kit.CAMUNDA;
  }

  private get prefix(): string {
    return this.model.file.namespaces.prefixOf(this.vendor.uri) ?? this.vendor.prefix;
  }

  private checkValue(host: ModdleElement, value: ModdleElement, index: number): void {
    if (!this.isOwnGeneric(value)) return;
    const local = this.localName(value.$type);
    const known = this.vendor.type(local);
    if (known) {
      if (!(this.engine === 'c8' ? this.misplaced(host, local, index) : this.looseParameter(host, value, local, index))) this.checkChildren(host, value, known, `${this.prefix}:${local}`);
      return;
    }
    const guess = DidYouMean.of(local, this.vendor.typeNames().map((name) => this.localName(name)));
    this.reportUnknown(host, `ext:${local}`, `${this.where(host)} has the unknown extension element ${this.prefix}:${local}${guess ? ` (did you mean ${this.prefix}:${guess}?)` : ''}; ${ENGINE_NAME[this.engine]} ignores it`, this.removeHint(host, index, guess));
  }

  /**
   * A known zeebe element the typed parse drops, so no rule sees where it sits: one that belongs
   * inside a container (a loose zeebe:input), or zeebe:publishMessage where Camunda 8 does not read
   * it (on an end event instead of its message event definition).
   */
  private misplaced(host: ModdleElement, local: string, index: number): boolean {
    const { ZEEBE } = RuleKit.kit;
    const id: string | undefined = host.id;
    const remove = id ? `\`bpmn ext remove <file> ${id} ${index}\`` : 'remove it from the XML';
    const name = `${this.prefix}:${local}`;
    if (ZEEBE.nestedOnly(local)) {
      const container = ZEEBE.containersOf(local)[0]!;
      const add = id ? `: \`bpmn ext add <file> ${id} ${name} ...\`` : '';
      this.reportMisplaced(host, local, `${name} sits directly in the extension elements of ${this.where(host)}, but belongs inside ${this.prefix}:${this.localName(container)}; Camunda 8 ignores it`, `Remove it (${remove}) and add it again, \`bpmn ext add\` files it into its container${add}.`);
      return true;
    }
    const type = ZEEBE.type(local)!;
    if (this.node.$model.getTypeDescriptor(type.type) || ZEEBE.allowedOn(local, host) !== false) return false;
    const hosts = type.allowedIn.filter((allowed) => allowed.startsWith('bpmn:')).map((allowed) => `${allowed.charAt(5).toLowerCase()}${allowed.slice(6)}`);
    this.reportMisplaced(host, local, `${name} on ${this.where(host)} has no effect: Camunda 8 reads it on ${hosts.length > 5 ? `${hosts.slice(0, 5).join(', ')}, ...` : hosts.join(', ')} only`, `Remove it: ${remove}.`);
    return true;
  }

  /** A camunda:inputParameter or outputParameter outside camunda:inputOutput, which the typed parse drops. */
  private looseParameter(host: ModdleElement, parameter: ModdleElement, local: string, index: number): boolean {
    if (local !== 'inputParameter' && local !== 'outputParameter') return false;
    const { id, slot } = this.address(host);
    const name: string | undefined = parameter.name ?? parameter.$attrs?.name;
    const body: string | undefined = parameter.$body;
    const add = id ? `: \`bpmn ext add <file> ${id} ${slot}camunda:${local}${name ? ` name=${name}` : ''}${body ? ` --body ${body}` : ''}\`` : '';
    const remove = id ? `\`bpmn ext remove <file> ${id} ${slot}${index}\`` : 'remove it from the XML';
    const reported = slot ? this.model.typed(host.$parent) : this.node;
    this.report('c7-loose-parameter', reported, `${this.prefix}:${local} sits directly in the extension elements of ${this.where(host)}, but belongs inside ${this.prefix}:inputOutput; the engines ignore it`, { path: null, type: ERROR_TYPES.CHILD_ELEMENT_TYPE_NOT_ALLOWED, writtenAt: this.model.position(host), subject: `ext:${local}`, hint: `Remove it (${remove}) and add it again, \`bpmn ext add\` files it into its container${add}.` });
    return true;
  }

  /**
   * How `bpmn` addresses the extension elements of `host`: an event definition or a loop through
   * its flow node and slot (`W definition.`, `SP loop.`), any other element by its id.
   */
  private address(host: ModdleElement): { id: string | undefined; slot: string } {
    return SetCommand.at(host) ?? { id: undefined, slot: '' };
  }

  /** `timerEventDefinition Def_T`, or `the timerEventDefinition of intermediateCatchEvent:timer W` */
  private where(host: ModdleElement): string {
    return ElementKinds.describe(host, host.$parent);
  }

  private reportMisplaced(host: ModdleElement, local: string, message: string, hint: string): void {
    this.report('c8-misplaced-element', this.node, message, { path: null, type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, writtenAt: this.model.position(host), subject: `ext:${local}`, hint });
  }

  private checkChildren(host: ModdleElement, parent: ModdleElement, parentType: VendorType, path: string): void {
    for (const child of parent.$children ?? []) {
      if (!this.isOwnGeneric(child)) continue;
      const local = this.localName(child.$type);
      if (this.isTextChild(parentType, local)) continue;
      const known = this.vendor.type(local);
      if (known) {
        this.checkChildren(host, child, known, `${path} > ${this.prefix}:${local}`);
        continue;
      }
      this.reportUnknown(host, `ext:${path}/${local}`, `${this.where(host)} contains the unknown element ${this.prefix}:${local}${path ? ` (in ${path})` : ''}; ${ENGINE_NAME[this.engine]} ignores it`, this.rebuildHint(host, path.split(' > ')[0]!));
    }
  }

  private isOwnGeneric(el: ModdleElement): boolean {
    return !!el?.$descriptor?.isGeneric && this.vendor.reads(this.model.file.namespaces.uriOfElement(el));
  }

  /** Children a camunda type takes as plain text (connectorId, expression, string). */
  private isTextChild(parentType: VendorType, local: string): boolean {
    return this.engine === 'c7' && (parentType as CamundaType).properties.some((property) => property.name === local && !property.isAttr && !property.isBody && !property.type.includes(':'));
  }

  private removeHint(host: ModdleElement, index: number, guess: string | undefined): string {
    const { id, slot } = this.address(host);
    if (!id) return 'Fix it in the XML.';
    return `Remove it (\`bpmn ext remove <file> ${id} ${slot}${index}\`)${guess ? ` and add the right one: \`bpmn ext add <file> ${id} ${slot}${this.prefix}:${guess} ...\`` : ''}.`;
  }

  private rebuildHint(host: ModdleElement, type: string): string {
    const { id, slot } = this.address(host);
    if (!id) return 'Fix it in the XML.';
    return `See it with \`bpmn ext list <file> ${id} --json\`, then rebuild it: \`bpmn ext add <file> ${id} ${slot}${type} --replace --xml '<${type} ...>...</${type}>'\`.`;
  }

  private reportUnknown(host: ModdleElement, subject: string, message: string, hint: string): void {
    let reported: ModdleElement | undefined = this.address(host).id === host.id ? host : host.$parent;
    while (reported && !reported.id) reported = reported.$parent;
    this.report(`${this.engine}-unknown-element`, (reported && this.model.typed(reported)) ?? this.node, message, { path: null, type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, writtenAt: this.model.position(host), subject, hint });
  }

  private localName(type: string): string {
    return type.slice(type.indexOf(':') + 1);
  }
}
