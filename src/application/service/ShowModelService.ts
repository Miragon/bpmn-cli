import type { ShowModelUseCase } from '../port/in/ShowModelUseCase.js';
import { ViewRequest } from '../../domain/views/ViewRequest.js';
import { ModelViewBuilder } from '../../domain/views/ModelViewBuilder.js';
import { ElementDetailBuilder } from '../../domain/views/ElementDetailBuilder.js';
import { AroundWindow } from '../../domain/views/AroundWindow.js';
import { ElementContextBuilder } from '../../domain/views/ElementContextBuilder.js';
import { LayoutViewBuilder } from '../../domain/views/LayoutViewBuilder.js';
import { ElementFacts } from '../../domain/views/ElementFacts.js';
import { ExtensionLister, type ExtensionInfo } from '../../domain/document/ExtensionLister.js';
import type { AroundView, ElementContext, Implementation } from '../../domain/views/around-view.js';
import type { LayoutView } from '../../domain/views/layout-view.js';
import type { ElementDetail, ModelView } from '../../domain/views/model-view.js';

export class ShowModelService implements ShowModelUseCase {
  show(command: ShowModelUseCase.Command): ShowModelUseCase.Result {
    const { doc, ...view } = command;
    return new ViewRequest(view).of(doc);
  }

  modelView(command: ShowModelUseCase.DocumentCommand): ModelView {
    return new ModelViewBuilder(command.doc).build();
  }

  elementDetail(command: ShowModelUseCase.DetailCommand): ElementDetail {
    return new ElementDetailBuilder(command.doc, command.element).build();
  }

  aroundView(command: ShowModelUseCase.AroundCommand): AroundView {
    const { doc, id, ...opts } = command;
    return new AroundWindow(doc, id, opts).view();
  }

  elementContext(command: ShowModelUseCase.ElementIdCommand): ElementContext {
    return new ElementContextBuilder(command.doc, command.id).build();
  }

  layoutView(command: ShowModelUseCase.DefinitionsCommand): LayoutView {
    return new LayoutViewBuilder(command.definitions).build();
  }

  implementation(command: ShowModelUseCase.ElementCommand): Implementation | undefined {
    return new ElementFacts(command.element).implementation();
  }

  extensions(command: ShowModelUseCase.ElementCommand): ExtensionInfo[] {
    return new ExtensionLister().list(command.element);
  }

  allExtensions(command: ShowModelUseCase.ElementCommand): ExtensionInfo[] {
    return new ExtensionLister().listAll(command.element);
  }
}
