import type { FindElementsUseCase } from '../port/in/FindElementsUseCase.js';
import { ElementFinder } from '../../domain/views/ElementFinder.js';

export class FindElementsService implements FindElementsUseCase {
  find(command: FindElementsUseCase.Command): FindElementsUseCase.Result {
    return new ElementFinder(command.doc).find(command.text, command.kind);
  }
}
