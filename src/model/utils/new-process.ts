import type { Change } from '../ChangeSet.js';
import type { Doc } from '../Doc.js';

export function newProcessChange(doc: Doc, name: string | undefined): Change {
  return { id: doc.processes()[0]!.get<string>('id'), kind: 'process', name };
}
