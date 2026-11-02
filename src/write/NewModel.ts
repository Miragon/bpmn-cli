import { DiagramDrawing, DrawingSnapshot } from '../drawing/index.js';
import { ChangeSet, DocumentWriter, type IdConventions, NewDocument, type Target } from '../model/index.js';

export interface NewOptions {
  name?: string | undefined;
  id?: string | undefined;
  target?: Target | undefined;
  conventions?: IdConventions | undefined;
}

export class NewModel {
  constructor(private readonly options: NewOptions = {}) {}

  async xml(): Promise<string> {
    const { id, name, target, conventions } = this.options;
    if (id !== undefined) {
      NewDocument.assertProcessId(id);
    }
    const document = new NewDocument({ processId: id, processName: name, target, conventions, executable: target !== 'none' }).create();
    await new DiagramDrawing(document).update(DrawingSnapshot.of(document), new ChangeSet(), []);
    return new DocumentWriter().plain(document);
  }
}
