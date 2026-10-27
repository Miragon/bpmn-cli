import type { FindElementsUseCase } from '../port/in/FindElementsUseCase.js';
import { ElementFinder } from '../../domain/views/ElementFinder.js';
import { assertKindToken } from '../../domain/document/utils/kinds.js';

export class FindElementsService implements FindElementsUseCase {
  find(command: FindElementsUseCase.Command): FindElementsUseCase.Result {
    if (command.validateKind && command.kind !== undefined) assertKindToken(command.kind);
    return new ElementFinder(command.doc).find(command.text, command.kind);
  }
}
