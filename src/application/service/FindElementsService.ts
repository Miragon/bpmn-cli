import type { FindElementsUseCase } from '../port/in/FindElementsUseCase.js';
import { ElementFinder } from '../../domain/views/ElementFinder.js';
import { assertKindToken } from '../../domain/document/Kinds.js';

export class FindElementsService implements FindElementsUseCase {
  find(command: FindElementsUseCase.Command): FindElementsUseCase.Result {
    return new ElementFinder(command.doc).find(command.text, command.kind);
  }

  assertKind(command: FindElementsUseCase.KindCommand): void {
    assertKindToken(command.kind);
  }
}
