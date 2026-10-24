import type { Change } from '../change-set.js';
import type { Doc } from '../document.js';

/** What `bpmn new` and newXml report as created: the new document's process. */
export function newProcessChange(doc: Doc, name: string | undefined): Change {
  return { id: doc.processes()[0]!.get<string>('id'), kind: 'process', name };
}
