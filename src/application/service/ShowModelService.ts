import type { ShowModelUseCase } from '../port/in/ShowModelUseCase.js';
import { ViewRequest } from '../../domain/views/ViewRequest.js';

export class ShowModelService implements ShowModelUseCase {
  show(command: ShowModelUseCase.Command): ShowModelUseCase.Result {
    const { doc, ...view } = command;
    return new ViewRequest(view).of(doc);
  }
}
