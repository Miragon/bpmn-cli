import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement, type Reporter } from '../CamundaRules.js';

import type { C7Host, HostExtension } from './extensions/C7Host.js';
import { C7ExtensionRule } from './extensions/C7HostRule.js';
import type { ExtensionHints } from './extensions/ExtensionHints.js';
import { UnresolvedReferences } from './extensions/UnresolvedReferences.js';

/** An id reference of a camunda element that names no element of the type it needs. */
interface DanglingReference {
  /** `errorRef` */
  name: string;
  /** the id the file wrote */
  id: string;
  /** `bpmn:Error` */
  type: string;
}

/**
 * Reports an id reference inside a camunda extension element (the errorRef of
 * camunda:errorEventDefinition) that points to no element or to one of another type; the Camunda
 * 7 engines ignore the mapping when it runs.
 */
class C7DanglingReference extends C7ExtensionRule {
  protected override readonly executableOnly = false;

  protected checkExtensions(host: C7Host, hints: ExtensionHints, reporter: Reporter): void {
    for (const extension of host.camundaExtensions()) {
      for (const reference of this.danglingReferences(extension.value)) {
        this.report(host, hints, extension, reference, reporter);
      }
    }
  }

  private danglingReferences(element: ModdleElement): DanglingReference[] {
    const dangling: DanglingReference[] = [];
    for (const property of element.$descriptor?.properties ?? []) {
      if (!property.isReference || !property.isAttr || property.isMany) {
        continue;
      }
      const name: string = property.ns?.localName ?? property.name;
      const referenced = element.get(property.name);
      const unresolved = UnresolvedReferences.of(element, name);
      if (referenced && !referenced.$instanceOf(property.type)) {
        dangling.push({ name, id: referenced.id, type: property.type });
      } else if (!referenced && unresolved !== undefined) {
        dangling.push({ name, id: unresolved, type: property.type });
      }
    }
    return dangling;
  }

  private report(
    host: C7Host,
    hints: ExtensionHints,
    extension: HostExtension,
    { name, id, type }: DanglingReference,
    reporter: Reporter,
  ): void {
    const typeName = type.replace(/^bpmn:/, '');
    const placeholder = `<${typeName.charAt(0).toLowerCase()}${typeName.slice(1)}Id>`;
    const candidates = this.idsOfType(host.node, type).slice(0, 5);
    const pointAt = `Point it at an existing one${candidates.length ? ` (${candidates.join(', ')})` : ''}`;
    host.report(reporter, {
      message: `${hints.typeName(extension.local)} of ${host.describe()} references ${name}="${id}", which is not a ${type} in the file; the engines ignore the mapping when it runs`,
      path: host.extensionPath(extension.index, name),
      type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
      node: extension.value,
      property: name,
      hint: `${pointAt}. ${hints.rebuild(extension, { [name]: placeholder })}`,
    });
  }

  /** The ids of the root elements of `type` (`bpmn:Error`) a reference may point at instead. */
  private idsOfType(node: ModdleElement, type: string): string[] {
    let definitions = node;
    while (definitions && !is(definitions, 'bpmn:Definitions')) {
      definitions = definitions.$parent;
    }
    return (definitions?.rootElements ?? [])
      .filter((root: ModdleElement) => is(root, type))
      .map((root: ModdleElement) => root.id ?? '');
  }
}

export default defineRule(
  { ruleName: 'c7-dangling-reference', kind: 'engine-specific', targetEngine: 'c7', impact: 'runtime' },
  C7DanglingReference,
);
