import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { Values } from '../support/Values.js';
import { C7ExtensionContentRule } from './C7ExtensionContentRule.js';
import type { C7Host, HostExtension } from './support/C7Host.js';

/** The form field types every engine knows (more only through a custom form type plugin). */
const FORM_TYPES = ['string', 'long', 'boolean', 'date', 'enum'];

/**
 * A form field of camunda:formData without id, without type, or with a type that is none of the
 * built-in form types string, long, boolean, date and enum.
 * Camunda 7 refuses to deploy the file, unless a plugin registers the type as a custom form type.
 *
 * @example a form field without type
 * <camunda:formData><camunda:formField id="amount" /></camunda:formData>  <!-- type="long" -->
 */
class C7FormFieldNeedsIdAndTypeRule extends C7ExtensionContentRule {
  protected checkHost(host: C7Host, read: HostExtension[]): void {
    for (const extension of read) {
      if (extension.local === 'formData') this.checkFormFields(host, extension);
    }
  }

  private checkFormFields(host: C7Host, extension: HostExtension): void {
    const rebuild = host.rebuild(extension);
    (extension.value.get('fields') ?? []).forEach((field: ModdleElement, fieldIndex: number) => {
      const id: string | undefined = field.get('id');
      const type: string | undefined = field.get('type');
      const label = `Form field ${id ?? fieldIndex + 1} of ${host.describe()}`;
      const path = host.extensionPath(extension.index, 'fields', fieldIndex);
      if (!Values.nonEmpty(id)) {
        this.reportOn(host, `${label} has no id; the engines refuse the file`, { path: [...path, 'id'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: field, requiredProperty: 'id', hint: rebuild });
      }
      if (type === undefined) {
        this.reportOn(host, `${label} has no type; the engines refuse the file`, { path: [...path, 'type'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: field, requiredProperty: 'type', hint: `Use one of ${FORM_TYPES.join(', ')}. ${rebuild}` });
      } else if (!FORM_TYPES.includes(type)) {
        this.reportOn(host, `${label} has type "${type}", which is not one of the built-in form types ${FORM_TYPES.join(', ')}; the engines refuse the file (unless a plugin registers it as a custom form type)`, { path: [...path, 'type'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: field, property: 'type', hint: rebuild });
      }
    });
  }
}

export default defineRule({ ruleName: 'c7-form-field-needs-id-and-type', code: 'W_C7_DEPLOY_EXTENSION', impact: 'deploy' }, C7FormFieldNeedsIdAndTypeRule);
