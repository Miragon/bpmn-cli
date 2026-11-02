import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { RuleKit } from '../RuleKit.js';

/** How bpmn-cli names a BPMN element's kind (`endEvent:message`). */
export class ElementKinds {
  /** `userTask`, `endEvent:message`; `camunda:InputOutput` for a vendor element. */
  static of(el: ModdleElement): string {
    const type = String(el.$type ?? '');
    const kind = type.startsWith('bpmn:') ? RuleKit.kit.kindLabel(el).replace(/^bpmn:/, '') : type.replace(/^bpmn:/, '');
    return kind.charAt(0).toLowerCase() + kind.slice(1);
  }

  /** `userTask`, `activity, gateway, event, ...`: BPMN types as a message lists them, the first `limit` only. */
  static list(types: string[], limit = Number.POSITIVE_INFINITY): string {
    const names = types.map((type) => type.replace(/^bpmn:/, '')).map((local) => local.charAt(0).toLowerCase() + local.slice(1));
    return names.length > limit ? `${names.slice(0, limit).join(', ')}, ...` : names.join(', ');
  }

  /**
   * How an engine message names an element: `serviceTask Activity_1`, or for an element without an
   * id `the multiInstanceLoopCharacteristics of serviceTask Activity_1`.
   */
  static describe(el: ModdleElement, owner?: ModdleElement): string {
    const kind = ElementKinds.of(el);
    if (el.id) return `${kind} ${el.id}`;
    return owner ? `the ${kind.replace(/^[^:]*:/, '')} of ${ElementKinds.describe(owner)}` : kind;
  }

  /** A type as the XML names its element: `zeebe:TaskDefinition` -> `zeebe:taskDefinition`, `InputOutput` -> `inputOutput`. */
  static xmlName(type: string): string {
    const colon = type.indexOf(':');
    return `${type.slice(0, colon + 1)}${type.charAt(colon + 1).toLowerCase()}${type.slice(colon + 2)}`;
  }

  /** How an engine message names the trigger of an event definition: `timer`, `message`, ... */
  static trigger(definition: ModdleElement): string {
    return ElementKinds.xmlName(String(definition.$type).replace(/^[^:]*:/, '').replace(/EventDefinition$/, ''));
  }
}
