import { type BpmnElement } from '../../../model/index.js';
import { ShellWords } from './ShellWords.js';

export class ElementAddress {
  constructor(
    readonly id: string,
    readonly prefix: string,
  ) {}

  static of(element: BpmnElement, owner: BpmnElement | undefined): ElementAddress | undefined {
    const own = element.id ? new ElementAddress(element.id, '') : undefined;
    if (!owner || element === owner || !owner.id) {
      return own;
    }
    const prefix = ElementAddress.nestedPrefix(element, owner);
    return prefix ? new ElementAddress(owner.id, prefix) : own;
  }
  slot(text: string): string {
    return `${this.id} ${ShellWords.quote(`${this.prefix}${text}`)}`;
  }

  private static nestedPrefix(element: BpmnElement, owner: BpmnElement): string | undefined {
    const definitions = owner.list('eventDefinitions');
    if (definitions.includes(element)) {
      return definitions.length > 1 ? `definition[${definitions.indexOf(element)}].` : 'definition.';
    }
    if (owner.peek<BpmnElement>('loopCharacteristics') === element) {
      return 'loop.';
    }
    return owner.peek<BpmnElement>('conditionExpression') === element ? 'condition.' : undefined;
  }
}
