import { C7Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { RuleKit } from '../RuleKit.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { SetCommand } from '../support/SetCommand.js';
import { WrittenModel } from '../support/WrittenModel.js';

/**
 * camunda booleans other than the exact `true` / `false`.
 * The engines read only `true`, so `yes` or `TRUE` leave a setting off. The typed parse turns such
 * a value into `false`, so the rule reads the values as the file writes them.
 *
 * - `c7-camunda-booleans`: a camunda boolean attribute of a BPMN element, or of a camunda extension
 *   element, that is neither true nor false.
 *
 * @example a task that is not asynchronous
 * <bpmn:serviceTask id="Charge" camunda:asyncBefore="yes" />  <!-- read as false -->
 */
class C7CamundaBooleansRule extends C7Rule {
  private model!: WrittenModel;

  protected visit(node: ModdleElement): void {
    const model = WrittenModel.of(node);
    const el = model?.written(node);
    if (!el) return;
    this.model = model!;
    this.checkAttributes(el);
    for (const value of el.extensionElements?.values ?? []) {
      this.checkVendorElement(el, value, '');
    }
  }

  private checkAttributes(el: ModdleElement): void {
    const { kit } = RuleKit;
    for (const [key, raw] of Object.entries(el.$attrs ?? {})) {
      if (!kit.CAMUNDA.reads(this.model.file.namespaces.uriOfName(key))) continue;
      const def = kit.CAMUNDA.attr(key.slice(key.indexOf(':') + 1));
      if (def?.type !== 'Boolean' || !def.owners.some((ownerType) => kit.is(el, ownerType))) {
        continue;
      }
      const value = String(raw ?? '');
      if (value === 'true' || value === 'false') continue;
      const address = SetCommand.at(el);
      this.reportValue(el, address, `${key}="${value}" on ${ElementKinds.describe(el)} is not true or false; the engines read only the exact value true (yes, TRUE or True leave it off)`, `attr:${key}`, address ? `\`bpmn set <file> ${address.id} ${address.slot}${key}=true\` (or =false).` : 'Use true or false in the XML.');
    }
  }

  private checkVendorElement(host: ModdleElement, vendorElement: ModdleElement, path: string): void {
    if (!RuleKit.kit.CAMUNDA.reads(this.model.file.namespaces.uriOfElement(vendorElement))) {
      return;
    }
    const local = vendorElement.$type.slice(vendorElement.$type.indexOf(':') + 1);
    const vendorType = RuleKit.kit.CAMUNDA.type(local);
    if (!vendorType) return;
    for (const property of vendorType.properties) {
      if (property.type !== 'Boolean' || !property.isAttr) continue;
      const raw = vendorElement[property.name];
      if (raw === undefined || raw === true || raw === false || raw === 'true' || raw === 'false') {
        continue;
      }
      const address = SetCommand.at(host);
      this.reportValue(host, address, `${property.name}="${String(raw)}" on ${vendorElement.$type}${path ? ` (in ${path})` : ''} of ${ElementKinds.describe(host)} is not true or false; the engines read only the exact value true`, `ext:${path}/${local}@${property.name}`, address ? `See it with \`bpmn ext list <file> ${address.id} --json\`, then rebuild it with \`bpmn ext add <file> ${address.id} ... --replace\` and ${property.name}=true (or false).` : 'Use true or false in the XML.');
    }
    for (const child of vendorElement.$children ?? []) {
      this.checkVendorElement(host, child, path ? `${path} > ${vendorElement.$type}` : vendorElement.$type);
    }
  }

  private reportValue(el: ModdleElement, address: SetCommand | undefined, message: string, subject: string, hint: string): void {
    this.report('c7-camunda-booleans', this.model.typed(address?.slot ? el.$parent : el), message, { path: null, type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, writtenAt: this.model.position(el), subject, hint });
  }
}

export default defineRule({ ruleName: 'c7-camunda-booleans', kind: 'engine-specific', targetEngine: 'c7', findings: { 'c7-camunda-booleans': ['W_C7_BAD_VALUE', 'runtime'] } }, C7CamundaBooleansRule);
