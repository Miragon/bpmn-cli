import type { EngineKit } from '../../engine-kit.js';
import { ERROR_TYPES, type ModdleElement } from './CamundaRule.js';
import { DidYouMean } from './support/DidYouMean.js';
import { VendorElementsRule } from './VendorElementsRule.js';

type VendorType = NonNullable<ReturnType<EngineKit['ZEEBE']['type']> | ReturnType<EngineKit['CAMUNDA']['type']>>;
type CamundaType = NonNullable<ReturnType<EngineKit['CAMUNDA']['type']>>;

const ENGINE_NAME = { c7: 'the engines', c8: 'Camunda 8' };

/**
 * Extension elements of the engine's own namespace that its descriptor does not know, directly in
 * the extension elements or inside a known one, for either engine (`C7CamundaElementKnownRule`,
 * `C8ZeebeElementKnownRule`).
 * The engine ignores them silently. The rule reports on the typed twin of the element that holds
 * them, with the known name a typo most likely meant; the content of a misplaced known element is
 * left to the placement rules.
 *
 * @example a misspelled extension element
 * <bpmn:serviceTask id="Charge">
 *   <bpmn:extensionElements><zeebe:taskDefinitions type="charge" /></bpmn:extensionElements>  <!-- zeebe:taskDefinition -->
 * </bpmn:serviceTask>
 */
export abstract class UnknownVendorElementsRule extends VendorElementsRule {
  protected checkValue(host: ModdleElement, value: ModdleElement, index: number): void {
    const local = this.localName(value.$type);
    const known = this.vendor.type(local);
    if (known) {
      if (!this.isMisplaced(host, local)) {
        this.checkChildren(host, value, known, `${this.prefix}:${local}`);
      }
      return;
    }
    const guess = DidYouMean.of(local, this.vendor.typeNames().map((name) => this.localName(name)));
    this.reportUnknown(host, `ext:${local}`, `${this.where(host)} has the unknown extension element ${this.prefix}:${local}${guess ? ` (did you mean ${this.prefix}:${guess}?)` : ''}; ${ENGINE_NAME[this.engine]} ignores it`, this.removeHint(host, index, guess));
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
    while (reported && !reported.id) {
      reported = reported.$parent;
    }
    this.report((reported && this.model.typed(reported)) ?? this.node, message, { path: null, type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, writtenAt: this.model.position(host), subject, hint });
  }
}
