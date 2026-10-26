import type { Doc } from '../../model/Doc.js';
import { is, walk, type El, peek, shownId } from '../../model/utils/moddle.js';
import type { StructureFindings } from './StructureFindings.js';

/** Unique ids, resolvable references and the root processes a collaboration binds. */
export class ReferenceChecks {
  constructor(
    private readonly doc: Doc,
    private readonly findings: StructureFindings,
  ) {}

  /** Vendor extension ids (e.g. camunda:formField) are scoped by their vendor and not checked. */
  checkDuplicateIds(): void {
    const counts = new Map<string, number>();
    for (const el of walk(this.doc.definitions, { bpmnOnly: true })) {
      const id = peek<string>(el, 'id');
      if (typeof id === 'string' && id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, n] of counts) {
      if (n > 1) {
        this.findings.error('E_DUPLICATE_ID', `Id "${id}" is used by ${n} elements`, id, {
          hint: 'Ids must be unique. Edit the XML or remove one of the elements with `bpmn remove <file> <id>` and re-create it with another --id.',
        });
      }
    }
    // bpmn-moddle keeps the first of a duplicate in the text and drops the later one
    const seen = new Set<string>();
    for (const w of this.doc.importWarnings) {
      const m = /duplicate ID <([^>]*)>/.exec(w.message);
      if (!m || seen.has(m[1]!) || (counts.get(m[1]!) ?? 0) > 1) continue;
      seen.add(m[1]!);
      const dropped = /^unparsable content <([^>]+)>/.exec(w.message)?.[1];
      const line = /\bline: (\d+)/.exec(w.message)?.[1];
      this.findings.error('E_DUPLICATE_ID', `Id "${m[1]}" is used by more than one element of the file${dropped ? ` (the later <${dropped}>${line ? ` at line ${line}` : ''} cannot be read)` : ''}; the engines refuse the file`, m[1], {
        hint: 'Ids must be unique: give one of the elements another id in the XML (the model holds only the first, so a write would drop the other).',
      });
    }
  }

  checkReferences(): void {
    const index = this.doc.byId();
    for (const holder of walk(this.doc.definitions)) {
      const descriptor = holder.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean; isMany?: boolean }> };
      if (descriptor.isGeneric || this.isDi(holder)) continue;
      for (const p of descriptor.properties ?? []) {
        if (!p.isReference) continue;
        const v = peek<unknown>(holder, p.name);
        const targets = p.isMany ? (Array.isArray(v) ? (v as El[]) : []) : v ? [v as El] : [];
        for (const target of targets) {
          const tid = peek<string>(target, 'id');
          if (!tid || index.get(tid) === target) continue;
          this.findings.error('E_DANGLING_REF', `${this.findings.describe(holder)} references ${p.name}="${tid}", which is not in the model`, shownId(holder), {
            related: [tid],
            hint: `Remove ${shownId(holder)} with \`bpmn remove <file> ${shownId(holder)}\` or re-create the missing element "${tid}".`,
          });
        }
      }
    }
    for (const el of walk(this.doc.definitions)) {
      if (!is(el, 'bpmn:SequenceFlow') && !is(el, 'bpmn:MessageFlow') && !is(el, 'bpmn:Association')) continue;
      for (const end of ['sourceRef', 'targetRef']) {
        if (!peek<El>(el, end)) {
          this.findings.error('E_DANGLING_REF', `${this.findings.describe(el)} has no ${end === 'sourceRef' ? 'source' : 'target'} (unresolved reference)`, shownId(el), {
            hint: `Remove it with \`bpmn remove <file> ${shownId(el)}\` and re-connect with \`bpmn connect <file> <sourceId> <targetId>\`.`,
          });
        }
      }
    }
  }

  checkRoots(): void {
    const { doc } = this;
    const processes = doc.processes();
    const collab = doc.collaboration();
    if (!collab && processes.length > 1) {
      this.findings.error('E_MULTIPLE_ROOTS', `The file has ${processes.length} root processes but no collaboration; only one can be laid out`, shownId(processes[1]), {
        related: processes.map(shownId),
        hint: 'Wrap every process in a pool in one transaction, `bpmn apply <file> ops.json` with `{"op":"add","kind":"participant","name":"<Name>","process":"<processId>"}` per process (one at a time needs --force until the last one), or remove the extra process.',
      });
    }
    if (!collab) return;
    const bound = doc.participants().filter((p) => !!peek<El>(p, 'processRef'));
    if (!bound.length) {
      this.findings.error('E_EMPTY_COLLABORATION', `Collaboration ${shownId(collab)} has no participant with a process (only black boxes or none at all)`, shownId(collab), {
        hint: 'Add a participant with a process: `bpmn add <file> participant "<Name>" --process <processId>`.',
      });
    }
    for (const p of processes) {
      if (!doc.participantOf(p)) {
        this.findings.error('E_ORPHAN_PROCESS', `Process ${shownId(p)} is not referenced by any participant of ${shownId(collab)}`, shownId(p), {
          hint: `Bind it to a pool: \`bpmn add <file> participant "<Name>" --process ${shownId(p)}\`, or remove it.`,
        });
      }
    }
  }

  private isDi(el: El): boolean {
    return /^(bpmndi|di|dc):/.test(el.$type);
  }
}
