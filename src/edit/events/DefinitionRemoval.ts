import { type BpmnElement, ElementText, type Finding, type Trigger } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';

export class DefinitionRemoval {
  constructor(private readonly edit: EditSession) {}

  dropAll(event: BpmnElement, trigger: Trigger): Finding[] {
    const defs = [...(event.get<BpmnElement[] | undefined>('eventDefinitions') ?? [])];
    event.set('eventDefinitions', undefined);
    const warnings: Finding[] = [];
    for (const def of defs) {
      this.edit.releaseIdsBelow(def);
      const lost = ElementText.vendorContent(def);
      if (!lost.length) {
        continue;
      }
      const defId = def.get<string | undefined>('id');
      warnings.push({
        code: 'W_PROPERTY_DROPPED',
        message: `${lost.join(', ')} of the ${def.type.replace('bpmn:', '')}${defId ? ` ${defId}` : ''} of ${event.id} ${lost.length > 1 ? 'were' : 'was'} dropped: the trigger changed to ${trigger}`,
        element: event.id,
        hint: 'Vendor attributes and extension elements belong to the old event definition; re-create what the new trigger still needs in the XML, or keep the old trigger and change only its details (e.g. `bpmn set <file> <id> message=<Name>`).',
      });
    }
    return warnings;
  }

  dropOthers(event: BpmnElement, keep: BpmnElement, trigger: Trigger): Finding[] {
    const defs = [...(event.get<BpmnElement[] | undefined>('eventDefinitions') ?? [])];
    const others = defs.filter((definition) => definition !== keep);
    event.set('eventDefinitions', [keep]);
    for (const def of others) {
      this.edit.releaseIdsBelow(def);
    }
    return [
      {
        code: 'W_PROPERTY_DROPPED',
        message: `${others.map(DefinitionRemoval.definitionText).join(', ')} of ${event.id} ${others.length > 1 ? 'were' : 'was'} dropped: trigger=${trigger} keeps only its ${DefinitionRemoval.definitionText(keep).replace(/ \(with .*\)$/, '')} (an event acts on one event definition)`,
        element: event.id,
        hint: 'Set the trigger of the definition the event should keep; the others cannot be kept on the same event.',
      },
    ];
  }

  private static definitionText(definition: BpmnElement): string {
    const local = definition.type.replace('bpmn:', '');
    const id = definition.get<string | undefined>('id');
    const lost = ElementText.vendorContent(definition);
    return `${local.charAt(0).toLowerCase()}${local.slice(1)}${id ? ` ${id}` : ''}${lost.length ? ` (with ${lost.join(', ')})` : ''}`;
  }
}
