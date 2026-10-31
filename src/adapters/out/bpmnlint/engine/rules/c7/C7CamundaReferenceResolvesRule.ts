import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { DiagramNamespaces } from '../support/DiagramNamespaces.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { C7VendorContentRule } from './C7VendorContentRule.js';
import { C7Diagram } from './support/C7Diagram.js';
import type { C7Host, HostExtension } from './support/C7Host.js';

/**
 * An id reference of a camunda extension element (the errorRef of camunda:errorEventDefinition)
 * that names no element of the type it needs.
 * Camunda 7 deploys the file and ignores the mapping when it runs.
 *
 * @example an error mapping to an error that does not exist
 * <camunda:errorEventDefinition errorRef="Error_Gone" expression="${failed}" />
 */
class C7CamundaReferenceResolvesRule extends C7VendorContentRule {
  protected checkHost(host: C7Host): void {
    if (host.isDefinitions()) return;
    for (const extension of host.camundaExtensions()) {
      this.checkReferences(host, extension);
    }
  }

  private checkReferences(host: C7Host, extension: HostExtension): void {
    const element = extension.value;
    for (const property of element.$descriptor?.properties ?? []) {
      if (!property.isReference || !property.isAttr || property.isMany) continue;
      const name: string = property.ns?.localName ?? property.name;
      const referenced = element.get(property.name);
      const unresolved = C7Diagram.unresolved(element).get(name);
      if (referenced ? referenced.$instanceOf(property.type) : unresolved === undefined) {
        continue;
      }
      const id = referenced ? referenced.id : unresolved;
      const typeName = property.type.replace(/^bpmn:/, '');
      const candidates = (DiagramNamespaces.definitionsOf(host.node)?.rootElements ?? []).filter((root: ModdleElement) => is(root, property.type)).map((root: ModdleElement) => root.id ?? '').slice(0, 5);
      this.reportContent(host, `${host.typeName(extension.local)} of ${host.describe()} references ${name}="${id}", which is not a ${property.type} in the file; the engines ignore the mapping when it runs`, { path: host.extensionPath(extension.index, name), type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: element, property: name, hint: `Point it at an existing one${candidates.length ? ` (${candidates.join(', ')})` : ''}. ${host.rebuild(extension, { [name]: `<${ElementKinds.xmlName(typeName)}Id>` })}` });
    }
  }
}

export default defineRule({ ruleName: 'c7-camunda-reference-resolves', code: 'W_C7_DANGLING_REF', impact: 'runtime' }, C7CamundaReferenceResolvesRule);
