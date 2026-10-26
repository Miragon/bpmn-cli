import type { Doc } from '../model/Doc.js';
import { isCliError } from '../shared/utils/errors.js';
import { type Warning } from '../shared/CliError.js';
import { ignoresConditions, isEventSubProcess, isLinkCatch, isRejectedType, kindLabel, kindOf, triggerOf, type Trigger } from '../model/utils/kinds.js';
import { completeMirrorLists } from '../model/utils/mirror.js';
import { is, walk, type El, peek, list, shownId } from '../model/utils/moddle.js';
import { FlowRules } from '../model/FlowRules.js';
import { ALWAYS_INTERRUPTING as NON_INTERRUPTING_FORBIDDEN } from '../ops/events/EventTrigger.js';
import type { PlatformChoice } from '../platform/PlatformDetection.js';
import type { ProfileFinding } from '../platform/utils/finding.js';
import { PLATFORM_PROFILES, type PlatformSummary, type ProfileReport } from '../platform/profiles/PlatformProfiles.js';
import type { ValidatorReport } from './validators.js';
import { FlowOrder } from './FlowOrder.js';
import { linkNameOf } from './utils/flow-nodes.js';
import { lintCoveredBy } from './utils/lint-coverage.js';

export interface ValidationResult {
  errors: Warning[];
  warnings: Warning[];
  /** its findings are among the warnings */
  platform?: PlatformSummary;
  /** their findings are among the errors / warnings */
  validators?: ValidatorReport[];
}

export interface ValidateOptions {
  /** omitted runs no profile; a given one's rules must be loaded first (loadProfile) */
  platform?: PlatformChoice;
}

/**
 * Structural validation (errors block writes) and lint (warnings), optionally followed by
 * the platform profile's engine-specific findings.
 */
export class StructuralValidator {
  private static readonly EVENT_SUBPROCESS_ONLY_STARTS: Trigger[] = ['error', 'escalation', 'compensate'];
  private errors: Warning[] = [];
  private warnings: Warning[] = [];

  constructor(private readonly doc: Doc) {}

  /** Completes the incoming/outgoing mirror lists first: the only change it makes to the model. */
  validate(opts: ValidateOptions = {}): ValidationResult {
    const result = this.validateStructure();
    if (opts.platform === undefined) return result;
    const report = PLATFORM_PROFILES.run(this.doc, opts.platform);
    return this.withProfile(result, report, report.findings);
  }

  /**
   * BPMN 2.0 makes the incoming/outgoing lists optional, but the placement grammar, view and
   * lint read them. In memory only: a write keeps the lists the way the file kept them.
   */
  repairFlowLinks(): number {
    return completeMirrorLists(this.doc.definitions);
  }

  /**
   * A lint warning a shown platform finding repeats is dropped (it adds the engine's verdict),
   * and so is a platform finding an E_INVALID_HOST already reports.
   */
  withProfile(result: ValidationResult, report: ProfileReport, shown: ProfileFinding[], delta?: { added: ProfileFinding[]; resolved: ProfileFinding[] }): ValidationResult {
    const invalidHost = new Set(
      [...result.errors, ...result.warnings]
        .filter((e) => e.code === 'E_INVALID_HOST' || (e.code === 'W_PREEXISTING_ERROR' && e.message.startsWith('E_INVALID_HOST')))
        .map((e) => e.element),
    );
    const repeated = (f: ProfileFinding): boolean => (f.code === 'W_C7_DEPLOY_BOUNDARY_HOST' || f.code === 'W_C8_DEPLOY_BOUNDARY_HOST') && invalidHost.has(f.element);
    if (invalidHost.size) {
      shown = shown.filter((f) => !repeated(f));
      report = { ...report, findings: report.findings.filter((f) => !repeated(f)) };
      if (delta) delta = { added: delta.added.filter((f) => !repeated(f)), resolved: delta.resolved };
    }
    const covered = lintCoveredBy(shown);
    const warnings = result.warnings.filter((w) => !covered(w));
    const platform: PlatformSummary = { ...PLATFORM_PROFILES.summarize(report), ...(delta ? { added: delta.added, resolved: delta.resolved } : {}) };
    return { errors: result.errors, warnings: [...warnings, ...shown], platform };
  }

  private validateStructure(): ValidationResult {
    const { doc } = this;
    this.errors = [];
    this.warnings = [];
    this.repairFlowLinks();
    this.checkDuplicateIds();
    this.checkReferences();
    this.checkRoots();
    for (const scope of this.scopes()) {
      for (const el of doc.flowElements(scope)) {
        const rejected = isRejectedType(el.$type);
        if (rejected) {
          this.error('E_UNSUPPORTED_KIND', `${el.$type} ${shownId(el)} is not supported: ${rejected}`, shownId(el), {
            hint: `Remove it: \`bpmn remove <file> ${shownId(el)}\`.`,
          });
        }
        if (is(el, 'bpmn:SequenceFlow')) this.checkSequenceFlow(el, scope);
        if (!is(el, 'bpmn:FlowNode')) continue;
        this.checkFlowLinks(el);
        this.checkDefaultFlow(el);
        if (is(el, 'bpmn:Event')) this.checkEvent(el, scope);
        if (is(el, 'bpmn:BoundaryEvent')) this.checkBoundaryEvent(el, scope);
        if (isEventSubProcess(el)) this.checkEventSubProcess(el);
      }
      if (is(scope, 'bpmn:Process')) this.checkLanes(scope);
      this.lintScope(scope, new FlowOrder(doc, scope));
    }
    this.checkMessageFlows();
    this.checkDuplicateNames();
    return { errors: this.errors, warnings: this.warnings };
  }

  private nameOf(el: El): string | undefined {
    const n = peek<string>(el, 'name');
    return n ? String(n) : undefined;
  }

  /** `userTask Activity_X "name"` */
  private describe(el: El): string {
    const name = this.nameOf(el);
    return `${kindLabel(el)} ${shownId(el)}${name ? ` "${name}"` : ''}`;
  }

  private isDi(el: El): boolean {
    return /^(bpmndi|di|dc):/.test(el.$type);
  }

  private scopes(): El[] {
    return [...walk(this.doc.definitions)].filter((el) => is(el, 'bpmn:Process') || is(el, 'bpmn:SubProcess'));
  }

  private error(code: string, message: string, element: string | undefined, extra: { related?: string[]; hint?: string } = {}): void {
    StructuralValidator.push(this.errors, code, message, element, extra);
  }

  private warning(code: string, message: string, element: string | undefined, extra: { related?: string[]; hint?: string } = {}): void {
    StructuralValidator.push(this.warnings, code, message, element, extra);
  }

  private static push(target: Warning[], code: string, message: string, element: string | undefined, extra: { related?: string[]; hint?: string }): void {
    const finding: Warning = { code, message };
    if (element) finding.element = element;
    if (extra.related?.length) finding.related = extra.related;
    if (extra.hint) finding.hint = extra.hint;
    target.push(finding);
  }

  /** Vendor extension ids (e.g. camunda:formField) are scoped by their vendor and not checked. */
  private checkDuplicateIds(): void {
    const counts = new Map<string, number>();
    for (const el of walk(this.doc.definitions, { bpmnOnly: true })) {
      const id = peek<string>(el, 'id');
      if (typeof id === 'string' && id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, n] of counts) {
      if (n > 1) {
        this.error('E_DUPLICATE_ID', `Id "${id}" is used by ${n} elements`, id, {
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
      this.error('E_DUPLICATE_ID', `Id "${m[1]}" is used by more than one element of the file${dropped ? ` (the later <${dropped}>${line ? ` at line ${line}` : ''} cannot be read)` : ''}; the engines refuse the file`, m[1], {
        hint: 'Ids must be unique: give one of the elements another id in the XML (the model holds only the first, so a write would drop the other).',
      });
    }
  }

  private checkReferences(): void {
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
          this.error('E_DANGLING_REF', `${this.describe(holder)} references ${p.name}="${tid}", which is not in the model`, shownId(holder), {
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
          this.error('E_DANGLING_REF', `${this.describe(el)} has no ${end === 'sourceRef' ? 'source' : 'target'} (unresolved reference)`, shownId(el), {
            hint: `Remove it with \`bpmn remove <file> ${shownId(el)}\` and re-connect with \`bpmn connect <file> <sourceId> <targetId>\`.`,
          });
        }
      }
    }
  }

  private checkRoots(): void {
    const { doc } = this;
    const processes = doc.processes();
    const collab = doc.collaboration();
    if (!collab && processes.length > 1) {
      this.error('E_MULTIPLE_ROOTS', `The file has ${processes.length} root processes but no collaboration; only one can be laid out`, shownId(processes[1]), {
        related: processes.map(shownId),
        hint: 'Wrap every process in a pool in one transaction, `bpmn apply <file> ops.json` with `{"op":"add","kind":"participant","name":"<Name>","process":"<processId>"}` per process (one at a time needs --force until the last one), or remove the extra process.',
      });
    }
    if (!collab) return;
    const bound = doc.participants().filter((p) => !!peek<El>(p, 'processRef'));
    if (!bound.length) {
      this.error('E_EMPTY_COLLABORATION', `Collaboration ${shownId(collab)} has no participant with a process (only black boxes or none at all)`, shownId(collab), {
        hint: 'Add a participant with a process: `bpmn add <file> participant "<Name>" --process <processId>`.',
      });
    }
    for (const p of processes) {
      if (!doc.participantOf(p)) {
        this.error('E_ORPHAN_PROCESS', `Process ${shownId(p)} is not referenced by any participant of ${shownId(collab)}`, shownId(p), {
          hint: `Bind it to a pool: \`bpmn add <file> participant "<Name>" --process ${shownId(p)}\`, or remove it.`,
        });
      }
    }
  }

  private checkSequenceFlow(flow: El, scope: El): void {
    const source = peek<El>(flow, 'sourceRef');
    const target = peek<El>(flow, 'targetRef');
    if (!source || !target) return; // reported by checkReferences
    try {
      new FlowRules(this.doc).assertEndpoints(source, target);
    } catch (err) {
      if (!isCliError(err)) throw err;
      this.error(err.code, err.message, shownId(flow), { related: [shownId(source), shownId(target)], hint: err.details.hint });
      return;
    }
    if (is(source, 'bpmn:BoundaryEvent') && triggerOf(source) === 'compensate') {
      this.error('E_INVALID_SOURCE', `Compensate boundary event ${shownId(source)} cannot have outgoing sequence flows (${shownId(flow)} -> ${shownId(target)})`, shownId(flow), {
        related: [shownId(source), shownId(target)],
        hint: `The compensation handler is linked by an association, not a sequence flow: \`bpmn remove <file> ${shownId(flow)}\`, then \`bpmn connect <file> ${shownId(source)} ${shownId(target)}\`.`,
      });
    }
    const ends: Array<[El, string, string]> = [
      [source, 'E_INVALID_SOURCE', 'source'],
      [target, 'E_INVALID_TARGET', 'target'],
    ];
    for (const [end, code, role] of ends) {
      if (peek<boolean>(end, 'isForCompensation') !== true) continue;
      this.error(code, `Compensation handler ${this.describe(end)} cannot be the ${role} of a sequence flow (${shownId(flow)})`, shownId(flow), {
        related: [shownId(source), shownId(target)],
        hint: `A compensation handler hangs off a compensate boundary event by association only: \`bpmn remove <file> ${shownId(flow)}\`, or make it a normal activity with \`bpmn set <file> ${shownId(end)} isForCompensation=false\`.`,
      });
    }
    const endpointScope = this.doc.scopeOf(source);
    if (endpointScope && endpointScope !== scope) {
      this.error('E_CROSS_SCOPE', `${this.describe(flow)} is declared in ${shownId(scope)} but connects nodes of ${shownId(endpointScope)}`, shownId(flow), {
        related: [shownId(source), shownId(target)],
        hint: `Remove the flow with \`bpmn remove <file> ${shownId(flow)}\` and re-create it with \`bpmn connect <file> ${shownId(source)} ${shownId(target)}\`.`,
      });
    }
  }

  private outgoingOf(node: El): El[] {
    return list(node, 'outgoing');
  }

  private incomingOf(node: El): El[] {
    return list(node, 'incoming');
  }

  private checkFlowLinks(node: El): void {
    for (const f of this.incomingOf(node)) {
      if (is(f, 'bpmn:SequenceFlow') && peek<El>(f, 'targetRef') !== node) {
        this.error('E_FLOW_LINKS', `${this.describe(node)} lists ${shownId(f)} as incoming, but the flow targets ${shownId(peek<El>(f, 'targetRef'))}`, shownId(node), {
          related: [shownId(f)],
          hint: `incoming/outgoing must mirror sourceRef/targetRef: delete the stale <bpmn:incoming>${shownId(f)}</bpmn:incoming> entry from ${shownId(node)} in the XML (missing entries are added automatically).`,
        });
      }
    }
    for (const f of this.outgoingOf(node)) {
      if (is(f, 'bpmn:SequenceFlow') && peek<El>(f, 'sourceRef') !== node) {
        this.error('E_FLOW_LINKS', `${this.describe(node)} lists ${shownId(f)} as outgoing, but the flow starts at ${shownId(peek<El>(f, 'sourceRef'))}`, shownId(node), {
          related: [shownId(f)],
          hint: `incoming/outgoing must mirror sourceRef/targetRef: delete the stale <bpmn:outgoing>${shownId(f)}</bpmn:outgoing> entry from ${shownId(node)} in the XML (missing entries are added automatically).`,
        });
      }
    }
  }

  private checkEvent(el: El, scope: El): void {
    const def = kindOf(el);
    if (!def?.triggers) return;
    const trigger = triggerOf(el);
    const eventDefs = list(el, 'eventDefinitions');
    if (!trigger) {
      this.error('E_INVALID_TRIGGER', `${this.describe(el)} has an unsupported event definition ${eventDefs[0]?.$type ?? ''}`, shownId(el), {
        hint: `Allowed triggers for ${def.kind}: ${def.triggers.join(', ')}. Change it with \`bpmn set <file> ${shownId(el)} trigger=<trigger>\`.`,
      });
      return;
    }
    if (!def.triggers.includes(trigger)) {
      this.error('E_INVALID_TRIGGER', `Trigger "${trigger}" is not allowed on ${def.kind} ${shownId(el)}`, shownId(el), {
        hint: `Allowed triggers for ${def.kind}: ${def.triggers.join(', ')}. Change it with \`bpmn set <file> ${shownId(el)} trigger=<trigger>\` or retype the event.`,
      });
      return;
    }
    if (is(el, 'bpmn:StartEvent')) {
      const inEventSub = isEventSubProcess(scope);
      if (StructuralValidator.EVENT_SUBPROCESS_ONLY_STARTS.includes(trigger) && !inEventSub) {
        this.error('E_INVALID_TRIGGER', `startEvent:${trigger} ${shownId(el)} is only allowed inside an event sub-process`, shownId(el), {
          hint: 'Move it into an eventSubProcess (`bpmn add <file> eventSubProcess "<Name>" --in <scope>`, then `bpmn move <file> <id> --in <eventSubProcessId>`) or use trigger none/message/timer/signal/conditional.',
        });
      } else if (!inEventSub && is(scope, 'bpmn:SubProcess') && trigger !== 'none') {
        this.error('E_INVALID_TRIGGER', `startEvent:${trigger} ${shownId(el)} inside embedded sub-process ${shownId(scope)} must have no trigger`, shownId(el), {
          hint: `Use \`bpmn set <file> ${shownId(el)} trigger=none\`; triggered starts belong to the process or to an event sub-process.`,
        });
      }
      if (!inEventSub && peek<boolean>(el, 'isInterrupting') === false) {
        this.error('E_INVALID_TRIGGER', `Non-interrupting start event ${shownId(el)} is only allowed inside an event sub-process`, shownId(el), {
          hint: `Use \`bpmn set <file> ${shownId(el)} nonInterrupting=false\`.`,
        });
      }
    }
    if (is(el, 'bpmn:EndEvent') && trigger === 'cancel' && !is(scope, 'bpmn:Transaction')) {
      this.error('E_INVALID_TRIGGER', `endEvent:cancel ${shownId(el)} is only allowed inside a transaction sub-process`, shownId(el), {
        hint: 'Use a transaction (`bpmn add <file> transaction "<Name>" ...`) or another end trigger (none, error, terminate, ...).',
      });
    }
  }

  private checkBoundaryEvent(el: El, scope: El): void {
    const host = peek<El>(el, 'attachedToRef');
    if (!host) {
      this.error('E_NO_HOST', `${this.describe(el)} is not attached to any activity`, shownId(el), {
        hint: `Boundary events need a host: \`bpmn remove <file> ${shownId(el)}\` and re-add it with --on <activityId>.`,
      });
      return;
    }
    if (!is(host, 'bpmn:Activity')) {
      this.error('E_INVALID_HOST', `${this.describe(el)} is attached to ${this.describe(host)}, which is not an activity`, shownId(el), {
        related: [shownId(host)],
        hint: 'Boundary events attach to tasks, sub-processes and call activities only.',
      });
      return;
    }
    if (this.doc.scopeOf(host) !== scope) {
      this.error('E_INVALID_HOST', `${this.describe(el)} is declared in ${shownId(scope)} but its host ${shownId(host)} is in ${shownId(this.doc.scopeOf(host))}`, shownId(el), {
        related: [shownId(host)],
        hint: `Move the boundary event next to its host: \`bpmn remove <file> ${shownId(el)}\` and re-add it with --on ${shownId(host)}.`,
      });
    }
    // bpmn-js does not attach boundary events to a compensation handler,
    // and Camunda 7 / CIB seven / Operaton refuse the file
    if (peek<boolean>(host, 'isForCompensation') === true) {
      this.error('E_INVALID_HOST', `${this.describe(el)} is attached to ${shownId(host)}, a compensation handler (isForCompensation=true), which cannot carry boundary events`, shownId(el), {
        related: [shownId(host)],
        hint: `Remove it (\`bpmn remove <file> ${shownId(el)}\`), attach it to a normal activity (\`bpmn move <file> ${shownId(el)} --on <activityId>\`), or make ${shownId(host)} a normal activity (\`bpmn set <file> ${shownId(host)} isForCompensation=false\`).`,
      });
    }
    // an event sub-process has no place in the flow to interrupt or leave
    if (isEventSubProcess(host)) {
      this.error('E_INVALID_HOST', `${this.describe(el)} is attached to ${shownId(host)}, an event sub-process, which cannot carry boundary events`, shownId(el), {
        related: [shownId(host)],
        hint: `Remove it (\`bpmn remove <file> ${shownId(el)}\`) or attach it to an activity in the flow (\`bpmn move <file> ${shownId(el)} --on <activityId>\`).`,
      });
    }
    const trigger = triggerOf(el);
    if (trigger && peek<boolean>(el, 'cancelActivity') === false && NON_INTERRUPTING_FORBIDDEN.includes(trigger)) {
      this.error('E_INVALID_TRIGGER', `boundaryEvent:${trigger} ${shownId(el)} cannot be non-interrupting`, shownId(el), {
        hint: `Error, cancel and compensate boundary events always interrupt: \`bpmn set <file> ${shownId(el)} nonInterrupting=false\`.`,
      });
    }
    if (trigger === 'cancel' && !is(host, 'bpmn:Transaction')) {
      this.error('E_INVALID_TRIGGER', `boundaryEvent:cancel ${shownId(el)} must be attached to a transaction (host ${shownId(host)} is a ${kindLabel(host)})`, shownId(el), {
        related: [shownId(host)],
        hint: 'Cancel boundary events only work on transaction sub-processes.',
      });
    }
  }

  private checkDefaultFlow(node: El): void {
    // only exclusive/inclusive/complex gateways and activities have a `default` property
    const def = peek<El>(node, 'default');
    if (!def || this.outgoingOf(node).includes(def)) return;
    this.error('E_INVALID_DEFAULT', `Default flow ${shownId(def)} of ${this.describe(node)} is not one of its outgoing flows`, shownId(node), {
      related: [shownId(def)],
      hint: `Mark one of the outgoing flows instead: \`bpmn set <file> <flowId> default=true\`.`,
    });
  }

  private checkEventSubProcess(sub: El): void {
    const starts = this.doc.flowNodes(sub).filter((n) => is(n, 'bpmn:StartEvent'));
    if (!starts.length) {
      this.error('E_EVENT_SUBPROCESS_NO_START', `Event sub-process ${shownId(sub)} has no start event`, shownId(sub), {
        hint: `Create it with its trigger in one command: \`bpmn add <file> eventSubProcess:<message|timer|signal|conditional|error|escalation|compensate> "<Name>" --in <scope>\` (the start event is created inside), or add the sub-process and its startEvent:<trigger> together in one batch: \`bpmn apply <file> ops.json\`.`,
      });
      return;
    }
    for (const s of starts) {
      if (triggerOf(s) === 'none') {
        this.error('E_EVENT_SUBPROCESS_PLAIN_START', `Start event ${shownId(s)} of event sub-process ${shownId(sub)} has no trigger`, shownId(s), {
          related: [shownId(sub)],
          hint: `Event sub-processes start on a trigger: \`bpmn set <file> ${shownId(s)} trigger=message|timer|error|signal|escalation|conditional|compensate\`.`,
        });
      }
    }
  }

  private checkLanes(process: El): void {
    const { doc } = this;
    const lanes = doc.allLanes(process);
    if (!lanes.length) return;
    const direct = doc.flowElements(process);
    const seen = new Map<El, El[]>();
    for (const lane of lanes) {
      for (const member of list(lane, 'flowNodeRef')) {
        if (!is(member, 'bpmn:FlowNode') || !direct.includes(member)) {
          this.error('E_INVALID_LANE_MEMBER', `Lane ${shownId(lane)} lists ${shownId(member)}, which is not a flow node of process ${shownId(process)}`, shownId(lane), {
            related: [shownId(member)],
            hint: 'Only flow nodes declared directly in the process (not inside sub-processes) can be lane members. Fix with `bpmn set <file> <nodeId> lane=`.',
          });
          continue;
        }
        seen.set(member, [...(seen.get(member) ?? []), lane]);
      }
    }
    for (const [member, inLanes] of seen) {
      if (inLanes.length > 1) {
        this.error('E_LANE_CONFLICT', `${this.describe(member)} is a member of ${inLanes.length} lanes (${inLanes.map(shownId).join(', ')})`, shownId(member), {
          related: inLanes.map(shownId),
          hint: `A node belongs to one lane: \`bpmn set <file> ${shownId(member)} lane=<laneId>\` keeps only that one.`,
        });
      }
    }
    for (const node of doc.flowNodes(process)) {
      if (is(node, 'bpmn:BoundaryEvent')) continue;
      if (!seen.has(node)) {
        this.warning('W_NOT_IN_LANE', `${this.describe(node)} is in no lane although process ${shownId(process)} has lanes`, shownId(node), {
          hint: `Assign it: \`bpmn set <file> ${shownId(node)} lane=<laneId>\` (lanes: ${lanes.map(shownId).join(', ')}).`,
        });
      }
    }
  }

  private poolOf(el: El): El | undefined {
    if (is(el, 'bpmn:Participant')) return el;
    const process = this.doc.processOf(el);
    return process ? this.doc.participantOf(process) : undefined;
  }

  private checkMessageFlows(): void {
    const { doc } = this;
    for (const mf of doc.messageFlows()) {
      const source = peek<El>(mf, 'sourceRef');
      const target = peek<El>(mf, 'targetRef');
      if (!source || !target) continue; // reported by checkReferences
      let bad = false;
      for (const end of [source, target]) {
        if (!is(end, 'bpmn:InteractionNode')) {
          bad = true;
          this.error('E_INVALID_MESSAGE_FLOW', `Message flow ${shownId(mf)} ends at ${this.describe(end)}, which cannot send or receive messages`, shownId(mf), {
            related: [shownId(end)],
            hint: 'Message flows connect participants, tasks, events, sub-processes and call activities (not gateways or data).',
          });
        }
      }
      if (bad) continue;
      const sPool = this.poolOf(source);
      const tPool = this.poolOf(target);
      if (sPool && tPool && sPool === tPool) {
        this.error('E_MESSAGE_FLOW_SAME_POOL', `Message flow ${shownId(mf)} connects ${shownId(source)} and ${shownId(target)} inside the same pool ${shownId(sPool)}`, shownId(mf), {
          related: [shownId(source), shownId(target)],
          hint: `Inside a pool use a sequence flow: \`bpmn remove <file> ${shownId(mf)}\` then \`bpmn connect <file> ${shownId(source)} ${shownId(target)}\`.`,
        });
      }
    }
  }

  private isSplitGateway(node: El): boolean {
    return is(node, 'bpmn:Gateway') && this.doc.outgoing(node).length >= 2;
  }

  private isJoinGateway(node: El): boolean {
    return is(node, 'bpmn:Gateway') && this.doc.incoming(node).length >= 2 && this.doc.outgoing(node).length <= 1;
  }

  private isDeadEndExempt(node: El): boolean {
    if (is(node, 'bpmn:EndEvent') || isEventSubProcess(node)) return true;
    if (peek<boolean>(node, 'isForCompensation') === true) return true;
    const trigger = triggerOf(node);
    if (is(node, 'bpmn:IntermediateThrowEvent') && trigger === 'link') return true;
    if (is(node, 'bpmn:BoundaryEvent') && trigger === 'compensate') return true;
    return false;
  }

  private lintScope(scope: El, order: FlowOrder): void {
    const { doc } = this;
    const nodes = doc.flowNodes(scope);
    const isProcess = is(scope, 'bpmn:Process');
    // an ad-hoc sub-process needs neither start/end events nor flows: its nodes run on their own
    const adHoc = is(scope, 'bpmn:AdHocSubProcess');
    if ((isProcess || nodes.length) && !adHoc) {
      if (!isEventSubProcess(scope) && !nodes.some((n) => is(n, 'bpmn:StartEvent'))) {
        this.warning('W_NO_START', `${isProcess ? 'Process' : 'Sub-process'} ${shownId(scope)} has no start event`, shownId(scope), {
          hint: `Add one: \`bpmn add <file> startEvent "<Name>" --in ${shownId(scope)}\` (or --before <firstNodeId>).`,
        });
      }
      if (!nodes.some((n) => is(n, 'bpmn:EndEvent'))) {
        this.warning('W_NO_END', `${isProcess ? 'Process' : 'Sub-process'} ${shownId(scope)} has no end event`, shownId(scope), {
          hint: `Add one after the last node: \`bpmn add <file> endEvent "<Name>" --after <nodeId>\`.`,
        });
      }
    }
    for (const node of order.unreachable) {
      const link = isLinkCatch(node) ? linkNameOf(node) : undefined;
      this.warning('W_UNREACHABLE', `${this.describe(node)} is not reachable from any start event${link ? ` (no throwing link event "${link}" pairs with it)` : ''}`, shownId(node), {
        hint: link
          ? `Link events pair by link name: add the throwing side with \`bpmn add <file> intermediateThrowEvent:link "<Name>" --after <nodeId> --link ${link}\`, or remove it.`
          : `Connect it (\`bpmn connect <file> <fromId> ${shownId(node)}\` or \`bpmn move <file> ${shownId(node)} --after <nodeId>\`) or remove it.`,
      });
    }
    for (const node of nodes) {
      const outgoing = doc.outgoing(node);
      const incoming = doc.incoming(node);
      if (!outgoing.length && !adHoc && !this.isDeadEndExempt(node)) {
        this.warning('W_DEAD_END', `${this.describe(node)} has no outgoing flow`, shownId(node), {
          hint: `Continue the flow (\`bpmn add <file> <kind> "<Name>" --after ${shownId(node)}\`) or end it (\`bpmn add <file> endEvent "<Name>" --after ${shownId(node)}\`).`,
        });
      }
      if (['exclusiveGateway', 'inclusiveGateway'].includes(kindOf(node)?.kind ?? '')) {
        if (this.isSplitGateway(node)) {
          const name = this.nameOf(node);
          if (!name || !name.trim().endsWith('?')) {
            this.warning('W_GATEWAY_NAME', `${this.describe(node)} splits but is not named as a question`, shownId(node), {
              hint: `Name splitting gateways as a question, e.g. \`bpmn set <file> ${shownId(node)} name="Invoice ok?"\`.`,
            });
          }
          const unnamed = outgoing.filter((f) => !this.nameOf(f));
          if (unnamed.length) {
            this.warning('W_BRANCH_NAME', `Branches ${unnamed.map(shownId).join(', ')} of ${this.describe(node)} have no name`, shownId(node), {
              related: unnamed.map(shownId),
              hint: 'Name each branch with its answer, e.g. `bpmn set <file> <flowId> name=yes`.',
            });
          }
        } else if (this.isJoinGateway(node) && this.nameOf(node)) {
          this.warning('W_NAMED_JOIN', `Joining gateway ${this.describe(node)} should not have a name`, shownId(node), {
            hint: `Unset it: \`bpmn set <file> ${shownId(node)} name=\`.`,
          });
        }
      }
      if (is(node, 'bpmn:ParallelGateway') && this.nameOf(node)) {
        this.warning('W_NAMED_PARALLEL', `Parallel gateway ${this.describe(node)} should not have a name`, shownId(node), {
          hint: `Unset it: \`bpmn set <file> ${shownId(node)} name=\`.`,
        });
      }
      if (ignoresConditions(node)) {
        const conditional = outgoing.filter((f) => peek<El | undefined>(f, 'conditionExpression'));
        if (conditional.length) {
          this.warning('W_CONDITION_IGNORED', `Flows ${conditional.map(shownId).join(', ')} out of ${this.describe(node)} have a condition, which the gateway never evaluates`, shownId(node), {
            related: conditional.map(shownId),
            hint: `Remove them (\`bpmn set <file> ${shownId(conditional[0])} condition=\`), or branch by condition: \`bpmn retype <file> ${shownId(node)} exclusiveGateway\`.`,
          });
        }
      }
      if (is(node, 'bpmn:EventBasedGateway')) {
        for (const f of outgoing) {
          const t = peek<El>(f, 'targetRef');
          if (t && !is(t, 'bpmn:IntermediateCatchEvent') && !is(t, 'bpmn:ReceiveTask')) {
            this.warning('W_EVENT_GATEWAY_TARGET', `Event-based gateway ${shownId(node)} leads to ${this.describe(t)}, which is not a catching event or receive task`, shownId(node), {
              related: [shownId(t)],
              hint: 'Every branch of an event-based gateway must start with an intermediateCatchEvent (message/timer/signal/conditional) or a receiveTask.',
            });
          }
        }
      }
      if (!is(node, 'bpmn:Gateway')) {
        if (outgoing.length >= 2) {
          this.warning('W_IMPLICIT_SPLIT', `${this.describe(node)} has ${outgoing.length} outgoing flows (implicit split)`, shownId(node), {
            related: outgoing.map(shownId),
            hint: `Split through a gateway instead: \`bpmn add <file> parallelGateway --flow ${shownId(outgoing[0])}\` (or exclusiveGateway "<Question?>" for alternatives), then \`bpmn set <file> ${shownId(outgoing[1])} source=<gatewayId>\` for each other outgoing flow (new branches: a {"op":"split"} op in \`bpmn apply <file> ops.json\`).`,
          });
        }
        if (incoming.length >= 2) {
          this.warning('W_IMPLICIT_JOIN', `${this.describe(node)} has ${incoming.length} incoming flows (implicit join)`, shownId(node), {
            related: incoming.map(shownId),
            hint: `Join through a gateway instead: \`bpmn add <file> exclusiveGateway --flow ${shownId(incoming[0])}\` (parallelGateway to synchronise), then \`bpmn set <file> ${shownId(incoming[1])} target=<gatewayId>\` for each other incoming flow.`,
          });
        }
      }
      if (is(node, 'bpmn:SubProcess') && !doc.flowNodes(node).length) {
        this.warning('W_EMPTY_SUBPROCESS', `${this.describe(node)} contains no nodes`, shownId(node), {
          hint: `Add content: \`bpmn add <file> startEvent "<Name>" --in ${shownId(node)}\` ... or remove it.`,
        });
      }
    }
  }

  private checkDuplicateNames(): void {
    const groups = new Map<string, El[]>();
    for (const el of walk(this.doc.definitions)) {
      if (!is(el, 'bpmn:FlowNode') && !is(el, 'bpmn:Participant') && !is(el, 'bpmn:Lane')) continue;
      const name = this.nameOf(el)?.trim();
      if (!name) continue;
      const key = `${kindLabel(el)}\u0000${name}`;
      groups.set(key, [...(groups.get(key) ?? []), el]);
    }
    for (const els of groups.values()) {
      if (els.length < 2) continue;
      const [first, ...rest] = els;
      this.warning('W_DUPLICATE_NAME', `${els.length} ${kindLabel(first!)} elements are named "${this.nameOf(first!)}" (${els.map(shownId).join(', ')})`, shownId(first), {
        related: rest.map(shownId),
        hint: 'Distinct names keep the model unambiguous; rename with `bpmn set <file> <id> name="<New name>"`.',
      });
    }
  }
}
