import type { Doc } from '../../../../domain/document/Doc.js';
import type { ProfileFinding } from '../../../../domain/document/Finding.js';
import type { El } from '../../../../domain/document/utils/moddle.js';
import type { DocumentNamespaces } from '../../../../domain/document/vendor/DocumentNamespaces.js';
import type { EnginePlatformInfo } from '../../../../domain/validation/EngineLint.js';
import type { EngineKit } from '../engine-kit.js';

/** A check on bpmn-cli's own model, which keeps what the typed parse for the rules drops or rewrites. */
export abstract class OwnModelCheck {
  constructor(
    protected readonly kit: EngineKit,
    protected readonly doc: Doc,
    protected readonly ns: DocumentNamespaces,
    protected readonly engine: EnginePlatformInfo['platform'],
  ) {}

  abstract findings(): ProfileFinding[];

  /** The BPMN elements of the executable processes, the only ones the engines run. */
  protected *executableElements(): Generator<El> {
    for (const proc of this.doc.processes()) if (this.kit.peek<boolean>(proc, 'isExecutable') === true) yield* this.kit.walk(proc, { bpmnOnly: true });
  }
}
