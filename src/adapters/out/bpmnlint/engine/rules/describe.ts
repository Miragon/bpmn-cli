import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';

/** How bpmn-cli names a BPMN element's kind (`endEvent:message`), handed over by the engine run. */
export class ElementKinds {
  private static label: ((el: ModdleElement) => string) | undefined;

  static use(label: (el: ModdleElement) => string): void {
    ElementKinds.label = label;
  }

  /** `userTask`, `endEvent:message`; `camunda:InputOutput` for a vendor element. */
  static of(el: ModdleElement): string {
    const type = String(el.$type ?? '');
    const kind = type.startsWith('bpmn:') && ElementKinds.label ? ElementKinds.label(el).replace(/^bpmn:/, '') : type.replace(/^bpmn:/, '');
    return kind.charAt(0).toLowerCase() + kind.slice(1);
  }
}

/**
 * How an engine message names an element: `serviceTask Activity_1`, or for an element without an
 * id `the multiInstanceLoopCharacteristics of serviceTask Activity_1`.
 */
export function describeElement(el: ModdleElement, owner?: ModdleElement): string {
  const kind = ElementKinds.of(el);
  if (el.id) {
    return `${kind} ${el.id}`;
  }
  return owner ? `the ${kind.replace(/^[^:]*:/, '')} of ${describeElement(owner)}` : kind;
}

/** How an engine message names the trigger of an event definition: `timer`, `message`, ... */
export function triggerName(definition: ModdleElement): string {
  const local = String(definition.$type)
    .replace(/^[^:]*:/, '')
    .replace(/EventDefinition$/, '');
  return local.charAt(0).toLowerCase() + local.slice(1);
}
