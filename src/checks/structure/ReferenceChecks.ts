import { type BpmnDocument, type BpmnElement, ElementText } from '../../model/index.js';
import type { StructureFindings } from './StructureFindings.js';

interface ReferenceProperty {
  name: string;
  isReference?: boolean;
  isMany?: boolean;
}

export class ReferenceChecks {
  constructor(
    private readonly document: BpmnDocument,
    private readonly findings: StructureFindings,
  ) {}

  checkDuplicateIds(): void {
    const counts = new Map<string, number>();
    for (const el of this.document.tree.walk(this.document.tree.definitions, { bpmnOnly: true })) {
      const id = el.peek<string>('id');
      if (typeof id === 'string' && id) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    for (const [id, count] of counts) {
      if (count > 1) {
        this.findings.error('E_DUPLICATE_ID', `Id "${id}" is used by ${count} elements`, id, {
          hint: 'Ids must be unique. Edit the XML or remove one of the elements with `bpmn remove <file> <id>` and re-create it with another --id.',
        });
      }
    }
    const seen = new Set<string>();
    for (const warning of this.document.importWarnings) {
      const match = /duplicate ID <([^>]*)>/.exec(warning.message);
      if (!match || seen.has(match[1]!) || (counts.get(match[1]!) ?? 0) > 1) {
        continue;
      }
      seen.add(match[1]!);
      const dropped = /^unparsable content <([^>]+)>/.exec(warning.message)?.[1];
      const line = /\bline: (\d+)/.exec(warning.message)?.[1];
      this.findings.error('E_DUPLICATE_ID', `Id "${match[1]}" is used by more than one element of the file${dropped ? ` (the later <${dropped}>${line ? ` at line ${line}` : ''} cannot be read)` : ''}; the engines refuse the file`, match[1], {
        hint: 'Ids must be unique: give one of the elements another id in the XML (the model holds only the first, so a write would drop the other).',
      });
    }
  }

  checkReferences(): void {
    for (const holder of this.document.tree.walk(this.document.tree.definitions)) {
      this.checkReferencesOf(holder);
    }
    for (const el of this.document.tree.walk(this.document.tree.definitions)) {
      this.checkConnectionEnds(el);
    }
  }

  private checkReferencesOf(holder: BpmnElement): void {
    const descriptor = holder.descriptor as { isGeneric?: boolean; properties?: ReferenceProperty[] };
    if (descriptor.isGeneric || this.isDi(holder)) {
      return;
    }
    const index = this.document.tree.all();
    for (const property of (descriptor.properties ?? []).filter((candidate) => candidate.isReference)) {
      for (const target of this.referencedBy(holder, property)) {
        const tid = target.peek<string>('id');
        if (!tid || index.get(tid) === target) {
          continue;
        }
        this.findings.error('E_DANGLING_REF', `${this.findings.describe(holder)} references ${property.name}="${tid}", which is not in the model`, ElementText.shownId(holder), {
          related: [tid],
          hint: `Remove ${ElementText.shownId(holder)} with \`bpmn remove <file> ${ElementText.shownId(holder)}\` or re-create the missing element "${tid}".`,
        });
      }
    }
  }

  private referencedBy(holder: BpmnElement, property: ReferenceProperty): BpmnElement[] {
    const value = holder.peek<unknown>(property.name);
    if (property.isMany) {
      return Array.isArray(value) ? (value as BpmnElement[]) : [];
    }
    return value ? [value as BpmnElement] : [];
  }

  private checkConnectionEnds(el: BpmnElement): void {
    if (!el.is('bpmn:SequenceFlow') && !el.is('bpmn:MessageFlow') && !el.is('bpmn:Association')) {
      return;
    }
    for (const end of ['sourceRef', 'targetRef'].filter((end) => !el.peek<BpmnElement>(end))) {
      this.findings.error('E_DANGLING_REF', `${this.findings.describe(el)} has no ${end === 'sourceRef' ? 'source' : 'target'} (unresolved reference)`, ElementText.shownId(el), {
        hint: `Remove it with \`bpmn remove <file> ${ElementText.shownId(el)}\` and re-connect with \`bpmn connect <file> <sourceId> <targetId>\`.`,
      });
    }
  }

  checkRoots(): void {
    const processes = this.document.tree.processes();
    const collab = this.document.tree.collaboration();
    if (!collab && processes.length > 1) {
      this.findings.error('E_MULTIPLE_ROOTS', `The file has ${processes.length} root processes but no collaboration; only one can be laid out`, ElementText.shownId(processes[1]), {
        related: processes.map((element) => ElementText.shownId(element)),
        hint: 'Wrap every process in a pool in one transaction, `bpmn apply <file> ops.json` with `{"op":"add","kind":"participant","name":"<Name>","process":"<processId>"}` per process (one at a time needs --force until the last one), or remove the extra process.',
      });
    }
    if (!collab) {
      return;
    }
    const bound = this.document.flows.participants().filter((participant) => !!participant.peek<BpmnElement>('processRef'));
    if (!bound.length) {
      this.findings.error('E_EMPTY_COLLABORATION', `Collaboration ${ElementText.shownId(collab)} has no participant with a process (only black boxes or none at all)`, ElementText.shownId(collab), {
        hint: 'Add a participant with a process: `bpmn add <file> participant "<Name>" --process <processId>`.',
      });
    }
    for (const process of processes) {
      if (!this.document.flows.participantOf(process)) {
        this.findings.error('E_ORPHAN_PROCESS', `Process ${ElementText.shownId(process)} is not referenced by any participant of ${ElementText.shownId(collab)}`, ElementText.shownId(process), {
          hint: `Bind it to a pool: \`bpmn add <file> participant "<Name>" --process ${ElementText.shownId(process)}\`, or remove it.`,
        });
      }
    }
  }

  private isDi(el: BpmnElement): boolean {
    return /^(bpmndi|di|dc):/.test(el.type);
  }
}
