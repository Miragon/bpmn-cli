import type { Doc } from '../../document/Doc.js';
import type { DocumentNamespaces } from '../../document/vendor/DocumentNamespaces.js';
import type { El } from '../../document/utils/moddle.js';
import type { ProfileFinding } from '../../document/utils/finding.js';
import type { RuleKit } from './rule-kit.js';
import { peek } from '../utils/element.js';

/** One profile run over a document: what its rule classes read, and the findings they collect. */
export class RuleRun {
  readonly ns: DocumentNamespaces;
  readonly out: ProfileFinding[] = [];
  /** sequence flows by source / target, from sourceRef / targetRef (mirror lists are optional) */
  readonly outgoing = new Map<El, El[]>();
  readonly incoming = new Map<El, El[]>();

  constructor(
    readonly kit: RuleKit,
    readonly doc: Doc,
  ) {
    this.ns = new kit.DocumentNamespaces(doc);
    for (const flow of kit.walk(doc.definitions, { bpmnOnly: true })) {
      if (!kit.is(flow, 'bpmn:SequenceFlow')) continue;
      const source = peek<El>(flow, 'sourceRef');
      const target = peek<El>(flow, 'targetRef');
      if (source) this.outgoing.set(source, [...(this.outgoing.get(source) ?? []), flow]);
      if (target) this.incoming.set(target, [...(this.incoming.get(target) ?? []), flow]);
    }
  }
}
