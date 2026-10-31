import { is } from 'bpmnlint-utils';
import type { EngineKit } from '../../engine-kit.js';
import { CamundaRule, type ModdleElement } from './CamundaRule.js';
import { RuleKit } from './RuleKit.js';
import { ElementKinds } from './support/ElementKinds.js';
import { EngineScope } from './support/EngineScope.js';
import { SetCommand } from './support/SetCommand.js';
import { WrittenModel } from './support/WrittenModel.js';

/**
 * The extension elements of the engine's own namespace in an executable process, as the file
 * writes them, for the rules on what the typed parse drops of them (`UnknownVendorElementsRule`,
 * `C7IoParameterInInputOutputRule`, `C8ZeebeElementPlacementRule`).
 * The typed parse drops an unknown or misplaced vendor element with a warning that names neither
 * the element nor where it sat, so the rules read the extension elements of each element as the
 * file writes them (`WrittenModel`) and report on the typed twin.
 *
 * @example a zeebe element outside its container
 * <bpmn:serviceTask id="Charge">
 *   <bpmn:extensionElements><zeebe:input source="=a" target="b" /></bpmn:extensionElements>  <!-- inside zeebe:ioMapping -->
 * </bpmn:serviceTask>
 */
export abstract class VendorElementsRule extends CamundaRule {
  protected model!: WrittenModel;
  protected node!: ModdleElement;

  protected visit(node: ModdleElement): boolean | void {
    if (is(node, 'bpmn:Definitions')) return;
    if (!EngineScope.inExecutableProcess(node)) return false;
    const model = WrittenModel.of(node);
    const host = model?.written(node);
    if (!host) return;
    this.model = model!;
    this.node = node;
    (host.extensionElements?.values ?? []).forEach((value: ModdleElement, index: number) => {
      if (this.isOwnGeneric(value)) this.checkValue(host, value, index);
    });
  }

  /** An extension element of the engine's namespace that the typed parse dropped, at `index` of the extension elements of `host`. */
  protected abstract checkValue(host: ModdleElement, value: ModdleElement, index: number): void;

  protected get vendor(): EngineKit['ZEEBE'] | EngineKit['CAMUNDA'] {
    return this.engine === 'c8' ? RuleKit.kit.ZEEBE : RuleKit.kit.CAMUNDA;
  }

  protected get prefix(): string {
    return this.model.file.namespaces.prefixOf(this.vendor.uri) ?? this.vendor.prefix;
  }

  protected isOwnGeneric(el: ModdleElement): boolean {
    return !!el?.$descriptor?.isGeneric && this.vendor.reads(this.model.file.namespaces.uriOfElement(el));
  }

  /**
   * A known element the typed parse drops where it sits: a camunda parameter outside
   * camunda:inputOutput, a zeebe element that belongs inside a container (a loose zeebe:input), or
   * zeebe:publishMessage where Camunda 8 does not read it (on an end event instead of its message
   * event definition).
   */
  protected isMisplaced(host: ModdleElement, local: string): boolean {
    if (this.engine === 'c7') {
      return local === 'inputParameter' || local === 'outputParameter';
    }
    const { ZEEBE } = RuleKit.kit;
    return ZEEBE.nestedOnly(local) || (!this.node.$model.getTypeDescriptor(ZEEBE.type(local)!.type) && ZEEBE.allowedOn(local, host) === false);
  }

  protected localName(type: string): string {
    return type.slice(type.indexOf(':') + 1);
  }

  /**
   * How `bpmn` addresses the extension elements of `host`: an event definition or a loop through
   * its flow node and slot (`W definition.`, `SP loop.`), any other element by its id.
   */
  protected address(host: ModdleElement): { id: string | undefined; slot: string } {
    return SetCommand.at(host) ?? { id: undefined, slot: '' };
  }

  /** `timerEventDefinition Def_T`, or `the timerEventDefinition of intermediateCatchEvent:timer W` */
  protected where(host: ModdleElement): string {
    return ElementKinds.describe(host, host.$parent);
  }
}
