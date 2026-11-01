import * as bpmnModdle from 'bpmn-moddle';
import type { ModdleObject, PropertyDescriptor } from '../document/BpmnElement.js';
import { ModelError } from '../errors/ModelError.js';
import { OverwriteWatch, type BpmnModdle, type ImportResult, type ImportWarning } from './OverwriteWatch.js';

export type { BpmnModdle, ImportWarning };

export interface ParsedModel {
  moddle: BpmnModdle;
  definitions: ModdleObject;
  importWarnings: ImportWarning[];
}

type ImportedReference = ImportResult['references'][number];

export class ModdleParser {
  static moddle(): BpmnModdle {
    return new (bpmnModdle as unknown as { BpmnModdle: new () => BpmnModdle }).BpmnModdle();
  }

  private static manyProperty(reference: ImportedReference): PropertyDescriptor | undefined {
    return reference.element.$descriptor.propertiesByName?.[reference.property];
  }

  private static isPaddedWarning(warning: ImportWarning, padded: readonly ImportedReference[]): boolean {
    return /^unresolved reference/.test(warning.message) && padded.some((reference) => reference.element === warning.element && reference.property === warning.property && reference.id === warning.value);
  }

  async parse(xml: string, moddle: BpmnModdle = ModdleParser.moddle()): Promise<ParsedModel> {
    const watch = new OverwriteWatch(moddle);
    let result: ImportResult;
    try {
      result = await moddle.fromXML(xml);
    } catch (failure) {
      const error = failure as Error & { warnings?: ImportWarning[] };
      throw new ModelError(`Cannot parse BPMN XML: ${error.message.split('\n')[0]}`, 'PARSE_ERROR', {
        message: error.message,
        warnings: (error.warnings ?? []).map((warning) => warning.message),
      });
    } finally {
      watch.stop();
    }
    const definitions = result.rootElement;
    if (!definitions.$instanceOf('bpmn:Definitions')) {
      throw new ModelError('Root element is not bpmn:Definitions', 'PARSE_ERROR');
    }
    return { moddle, definitions, importWarnings: [...this.resolvePaddedReferences(result), ...watch.warnings()] };
  }

  private resolvePaddedReferences(result: ImportResult): ImportWarning[] {
    const byId = result.elementsById;
    const padded = result.references.filter((reference) => reference.id !== reference.id.trim() && !byId[reference.id] && byId[reference.id.trim()]);
    if (!padded.length) {
      return result.warnings;
    }
    const rebuilt = new Map<unknown, Set<string>>();
    for (const reference of padded) {
      const property = ModdleParser.manyProperty(reference);
      if (property && !property.isMany) {
        reference.element.set(property.name, byId[reference.id.trim()]);
      } else if (property) {
        this.rebuildList(result, reference, property, rebuilt);
      }
    }
    return result.warnings.filter((warning) => !ModdleParser.isPaddedWarning(warning, padded));
  }

  private rebuildList(result: ImportResult, reference: ImportedReference, property: PropertyDescriptor, rebuilt: Map<unknown, Set<string>>): void {
    const seen = rebuilt.get(reference.element) ?? new Set<string>();
    rebuilt.set(reference.element, seen);
    if (seen.has(reference.property)) {
      return;
    }
    seen.add(reference.property);
    const byId = result.elementsById;
    const resolved = result.references
      .filter((sibling) => sibling.element === reference.element && sibling.property === reference.property)
      .map((sibling) => byId[sibling.id] ?? byId[sibling.id.trim()])
      .filter((sibling) => !!sibling);
    const collection = reference.element.get(property.name) as unknown[];
    collection.splice(0, collection.length, ...resolved);
  }
}
