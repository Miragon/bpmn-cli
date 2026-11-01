import { type BpmnElement, BpmnError, type DefinedTrigger, ElementSlots, Kinds, type SlotRef, Triggers } from '../../model/index.js';

type PrefixExample = (prefix: string) => string;

export class NestedResolution {
  private static definitionText(definition: BpmnElement): string {
    const id = definition.get<string | undefined>('id');
    return `${Kinds.typeLabel(definition)}${id ? ` ${id}` : ''}`;
  }

  private static listing(definitions: readonly BpmnElement[]): string {
    return definitions.map((definition, index) => `definition[${index}] = ${NestedResolution.definitionText(definition)}`).join(', ');
  }

  static resolve(element: BpmnElement, ref: SlotRef, what: string, example?: PrefixExample): BpmnElement | undefined {
    NestedResolution.assertSelector(element, ref, what);
    if (ref.slot !== 'definition') {
      return ElementSlots.entriesOf(element).find((entry) => entry.slot === ref.slot)?.el;
    }
    const definitions = ElementSlots.definitionsOf(element);
    if (ref.index !== undefined || ref.trigger) {
      return NestedResolution.selected(element, definitions, ref, what, example);
    }
    if (definitions.length > 1) {
      throw NestedResolution.ambiguous(element, definitions, what, `${definitions.length} event definitions`, example);
    }
    return definitions[0];
  }

  private static assertSelector(element: BpmnElement, ref: SlotRef, what: string): void {
    if (ref.slot !== 'definition' && (ref.index !== undefined || ref.trigger || ref.invalid !== undefined)) {
      throw BpmnError.model('E_UNKNOWN_KEY', `${what}: only definition. takes a selector ([<n>] or [<trigger>]), not ${ref.slot}.`, { element: element.id, hint: `Use ${ref.slot}.<key>.` });
    }
    if (ref.invalid !== undefined) {
      throw BpmnError.model('E_UNKNOWN_KEY', `${what}: "${ref.invalid}" in ${ref.text} is neither a position nor a trigger`, {
        element: element.id,
        hint: 'Select an event definition by position (definition[0], definition[1], ...) or by trigger (definition[message], definition[timer], ...).',
      });
    }
  }

  private static selected(element: BpmnElement, definitions: readonly BpmnElement[], ref: SlotRef, what: string, example: PrefixExample | undefined): BpmnElement {
    const hits = ref.index !== undefined ? definitions.slice(ref.index, ref.index + 1) : definitions.filter((definition) => definition.is(Triggers.TABLE[ref.trigger!].definition));
    if (hits.length > 1) {
      throw NestedResolution.ambiguous(element, definitions, what, `${hits.length} ${ref.trigger} event definitions`, example);
    }
    if (!hits[0]) {
      throw BpmnError.model('E_NO_NESTED_ELEMENT', `${Kinds.label(element)} ${element.id} has no event definition ${ref.text} (${what})`, {
        element: element.id,
        hint: definitions.length ? `Its event definitions: ${NestedResolution.listing(definitions)}.` : `It has no trigger; give it one first: \`bpmn set <file> ${element.id} trigger=<trigger>\`.`,
      });
    }
    return hits[0];
  }

  private static ambiguous(element: BpmnElement, definitions: readonly BpmnElement[], what: string, count: string, example: PrefixExample | undefined): BpmnError {
    const { id } = element;
    const triggers = definitions.map((definition) => Triggers.ofDefinition(definition)).filter((trigger): trigger is DefinedTrigger => !!trigger);
    const unique = triggers.filter((trigger, index) => triggers.indexOf(trigger) === index && triggers.lastIndexOf(trigger) === index);
    const rest = what.replace(/^definition(\[[^\]]*\])?\./, '');
    const show = example ?? ((prefix: string) => `bpmn set <file> ${id} '${prefix}.${rest}=<value>'`);
    const byTrigger = unique.length ? ` or \`${show(`definition[${unique[unique.length - 1]}]`)}\`` : '';
    return BpmnError.model('E_AMBIGUOUS_NESTED', `${Kinds.label(element)} ${id} has ${count} (${NestedResolution.listing(definitions)}); ${what} does not say which one`, {
      element: id,
      candidates: definitions.map((_definition, index) => `definition[${index}]`),
      hint: `Name one by position (0-based) or by trigger, e.g. \`${show('definition[1]')}\`${byTrigger} (quote the brackets in a shell). The engines act on only one event definition per event.`,
    });
  }
}
