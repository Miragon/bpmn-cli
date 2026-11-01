import type { BpmnElement } from '../document/BpmnElement.js';
import { BpmnError } from '../errors/BpmnError.js';

export class DeclaredNamespaces {
  static readonly BPMN = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

  static readonly KNOWN: Readonly<Record<string, string>> = {
    camunda: 'http://camunda.org/schema/1.0/bpmn',
    operaton: 'http://operaton.org/schema/1.0/bpmn',
    zeebe: 'http://camunda.org/schema/zeebe/1.0',
    modeler: 'http://camunda.org/schema/modeler/1.0',
    bioc: 'http://bpmn.io/schema/bpmn/biocolor/1.0',
    color: 'http://www.omg.org/spec/BPMN/non-normative/color/1.0',
    xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  };

  constructor(private readonly definitions: BpmnElement) {}

  prefixFor(uri: string): string | undefined {
    for (const [key, value] of Object.entries(this.definitions.attrs)) {
      if (key.startsWith('xmlns:') && value === uri) {
        return key.slice('xmlns:'.length);
      }
    }
    return undefined;
  }

  declare(prefix: string, uri?: string): void {
    const key = `xmlns:${prefix}`;
    if (this.definitions.attrs[key]) {
      return;
    }
    const resolved = uri ?? DeclaredNamespaces.KNOWN[prefix];
    if (!resolved) {
      throw BpmnError.model('E_UNKNOWN_NAMESPACE', `Unknown namespace prefix "${prefix}"`, {
        hint: `Declare it once with an inline xmlns: \`bpmn ext add <file> <id> ${prefix}:<type> --xml '<${prefix}:<type> xmlns:${prefix}="<uri>"/>'\`, or add xmlns:${prefix}="<uri>" to bpmn:definitions in the file. Known prefixes: ${Object.keys(DeclaredNamespaces.KNOWN).join(', ')}`,
      });
    }
    this.definitions.attrs[key] = resolved;
  }

  uriOf(prefix: string): string | undefined {
    return (this.definitions.attrs[`xmlns:${prefix}`] as string | undefined) ?? DeclaredNamespaces.KNOWN[prefix];
  }
}
