/**
 * The design profile: the hard modelling rules of Miragon's design-iq, which
 * refuses to save a model its validator (@bpmiq/validator checkBpmnXml,
 * called by the save gate with every write) reports an ERROR for. The rules
 * are mirrored as design-iq checks them, so that a write bpmn-cli lets
 * through is a save design-iq accepts:
 *
 *  errors (E_DESIGN_*; a change that introduces one is refused, like a
 *  structural error, see src/validators.ts):
 *   E_DESIGN_START_EVENTS  a process with nodes has no start event (on the
 *                          process), or a process or an embedded
 *                          sub-process (not an event sub-process) has more
 *                          than one (on each of its start events)
 *   E_DESIGN_UNREACHABLE   a flow node without incoming sequence flow (start
 *                          events, boundary events and event sub-processes
 *                          excepted)
 *   E_DESIGN_DEAD_END      a flow node without outgoing sequence flow (end
 *                          events and event sub-processes excepted)
 *   E_DESIGN_NOT_IN_LANE   a node of a process with lanes that no top-level
 *                          lane lists (boundary events excepted)
 *   E_DESIGN_NO_DI         a flow node, sequence flow, data reference,
 *                          annotation, association, group, top-level lane,
 *                          participant or message flow without a shape or
 *                          edge (the visual editor breaks, design-iq hard
 *                          rule 2)
 *   E_DESIGN_NAMESPACE     a namespace prefix used but not declared
 *   E_DESIGN_NO_PROCESS    no process at all
 *  warnings (W_DESIGN_*):
 *   W_DESIGN_COMPLEXITY    more than 9 activities in the file (7 +- 2)
 *   W_DESIGN_CALL_LINK     a call activity without calledElement (design
 *                          models), or, inside a content repository, one
 *                          whose calledElement is not a process of the repo
 *   W_DESIGN_DECISION_LINK a business rule task without decision link
 *                          (design models), or, inside a content repository,
 *                          one whose decision is not a .dmn of the repo
 *
 * The flow rules are design-iq's degree checks (a node needs an incoming and
 * an outgoing sequence flow), not a reachability analysis, and they hold for
 * every node, also where BPMN 2.0 itself allows a node without them: a
 * compensation handler, a compensation boundary event, link events and the
 * content of an ad-hoc sub-process are design-iq errors too (the messages say
 * so). What the structural validation already refuses (a start event with
 * incoming flows, an end event with outgoing ones, dangling references) is
 * not repeated here.
 *
 * Which processes and decisions exist is only known inside a design-iq
 * content repository (a bpmiq.yml naming the models folder, see repo.ts):
 * there the links are checked against the file stems of its .bpmn / .dmn
 * files, like design-iq's refs/dangling rule.
 */
import type { Doc } from '../document.js';
import { kindLabel, triggerOf } from '../kinds.js';
import { is, type El } from '../model.js';
import { decisionLinkOf } from '../ops/decision.js';
import type { NamedValidator, ValidatorFinding } from '../validators.js';
import { ZEEBE_URI } from './descriptor.js';

export interface DesignOptions {
  /** the processes of the content repository (file stems of its .bpmn files); a callActivity's calledElement must be one */
  processIds?: Iterable<string>;
  /** the decisions of the content repository (file stems of its .dmn files); a business rule task's decision must be one */
  decisionIds?: Iterable<string>;
  /** why the profile runs, for results (`--profile option`, `bpmiq.yml in <dir>`) */
  detail?: string;
}

/** The name the design profile's findings carry (`[design]`, `validator: "design"`). */
export const DESIGN_VALIDATOR = 'design';

/** More activities than this in one file: design-iq warns (7 +- 2). */
export const COMPLEXITY_LIMIT = 9;

/** A many-valued property without creating it (the profile also reads the live document before a change). */
function list(el: El, prop: string): El[] {
  const v = (el as unknown as Record<string, unknown>)[prop];
  return Array.isArray(v) ? (v as El[]) : [];
}

function idOf(el: El | undefined): string {
  return (el?.get<string | undefined>('id') as string | undefined) ?? '';
}

function describe(el: El): string {
  const name = el.get<string | undefined>('name');
  return `${kindLabel(el)} ${idOf(el)}${name ? ` "${name}"` : ''}`;
}

function isEventSubProcess(el: El): boolean {
  return is(el, 'bpmn:SubProcess') && el.get<boolean | undefined>('triggeredByEvent') === true;
}

interface Container {
  el: El;
  isSub: boolean;
}

/** Every process and (nested) sub-process, the way design-iq walks them: each is its own flow graph. */
function containersOf(doc: Doc): Container[] {
  const out: Container[] = [];
  const visit = (el: El, isSub: boolean): void => {
    out.push({ el, isSub });
    for (const child of list(el, 'flowElements')) if (is(child, 'bpmn:SubProcess')) visit(child, true);
  };
  for (const p of doc.processes()) visit(p, false);
  return out;
}

/** Ids every diagram shows (shapes and edges of every plane, drill-down planes included). */
function diIds(doc: Doc): Set<string> {
  const out = new Set<string>();
  for (const diagram of list(doc.definitions, 'diagrams')) {
    const plane = diagram.get<El | undefined>('plane');
    if (!plane) continue;
    for (const shape of list(plane, 'planeElement')) {
      const id = idOf(shape.get<El | undefined>('bpmnElement'));
      if (id) out.add(id);
    }
  }
  return out;
}

/** The top-level lanes of a process (design-iq does not look into child lane sets). */
function topLanes(process: El): El[] {
  return list(process, 'laneSets').flatMap((set) => list(set, 'lanes'));
}

/** Why design-iq's degree rule hits a node that BPMN 2.0 allows without the flow, if it does. */
function bpmnAllows(el: El, scope: El, missing: 'incoming' | 'outgoing'): string | undefined {
  if (is(scope, 'bpmn:AdHocSubProcess')) return 'the nodes of an ad-hoc sub-process need no sequence flows in BPMN';
  if (el.get<boolean | undefined>('isForCompensation') === true) return 'a compensation handler has no sequence flows in BPMN (it hangs off a compensation boundary event)';
  const trigger = triggerOf(el);
  if (missing === 'outgoing' && is(el, 'bpmn:BoundaryEvent') && trigger === 'compensate') return 'a compensation boundary event is connected by an association, not a sequence flow';
  if (missing === 'outgoing' && is(el, 'bpmn:IntermediateThrowEvent') && trigger === 'link') return 'a throwing link event continues at its catching link event';
  if (missing === 'incoming' && is(el, 'bpmn:IntermediateCatchEvent') && trigger === 'link') return 'a catching link event is entered from its throwing link event';
  return undefined;
}

const DESIGN_IQ_NOTE = 'design-iq requires it for every node; ';

/** The findings of the design profile on a document (see the module header). */
export function designFindings(doc: Doc, opts: DesignOptions = {}): ValidatorFinding[] {
  const out: ValidatorFinding[] = [];
  const error = (code: string, message: string, element: string | undefined, hint: string, extra: { related?: string[]; key?: string } = {}): void => {
    out.push({ severity: 'error', code, message, ...(element ? { element } : {}), hint, ...(extra.related?.length ? { related: extra.related } : {}), ...(extra.key ? { key: extra.key } : {}) });
  };
  const warning = (code: string, message: string, element: string | undefined, hint: string, key?: string): void => {
    out.push({ severity: 'warning', code, message, ...(element ? { element } : {}), hint, ...(key ? { key } : {}) });
  };

  // a namespace prefix the file uses without declaring it: bpmn-moddle cannot read that content at all
  const prefixes = new Set<string>();
  for (const w of doc.importWarnings) {
    const m = /missing namespace for prefix <([^>]+)>/.exec(w.message);
    if (m && !prefixes.has(m[1]!)) {
      prefixes.add(m[1]!);
      error('E_DESIGN_NAMESPACE', `The namespace prefix ${m[1]}: is used but never declared (xmlns:${m[1]}="..." is missing); strict XML parsers, design-iq's included, reject the file`, undefined, `Declare xmlns:${m[1]}="<uri>" on bpmn:definitions in the XML, or remove the content (\`--force\` on the next write drops what bpmn-moddle could not read).`, { key: `namespace:${m[1]}` });
    }
  }

  const processes = doc.processes();
  if (!processes.length) {
    error('E_DESIGN_NO_PROCESS', 'The file has no process; design-iq needs at least one bpmn:process', undefined, 'Create a model with `bpmn new <file> --name "<Name>"`.', { key: 'no-process' });
    return out;
  }

  const di = diIds(doc);
  const needsDi = (el: El): void => {
    const id = idOf(el);
    if (!id || di.has(id)) return;
    error('E_DESIGN_NO_DI', `${describe(el)} has no shape or edge in the diagram; design-iq's visual editor breaks without it`, id, 'A write with the layout draws it (a new element is placed next to its neighbours; avoid --no-layout), or `bpmn layout <file>` redraws the whole diagram.');
  };

  let activities = 0;
  const counted = new Set<string>();
  for (const { el: scope, isSub } of containersOf(doc)) {
    const elements = list(scope, 'flowElements');
    const nodes = elements.filter((e) => is(e, 'bpmn:FlowNode'));
    const flows = elements.filter((e) => is(e, 'bpmn:SequenceFlow'));
    for (const e of elements) if (is(e, 'bpmn:FlowNode') || is(e, 'bpmn:SequenceFlow') || is(e, 'bpmn:DataObjectReference') || is(e, 'bpmn:DataStoreReference')) needsDi(e);
    for (const a of list(scope, 'artifacts')) if (is(a, 'bpmn:TextAnnotation') || is(a, 'bpmn:Association') || is(a, 'bpmn:Group')) needsDi(a);
    for (const n of nodes) {
      const id = idOf(n);
      if (is(n, 'bpmn:Activity') && id && !counted.has(id)) {
        counted.add(id);
        activities++;
      }
    }
    if (!nodes.length) continue; // an empty process / sub-process: nothing to check (design-iq skips it too)
    const incoming = new Map<El, number>();
    const outgoing = new Map<El, number>();
    for (const f of flows) {
      const source = f.get<El | undefined>('sourceRef');
      const target = f.get<El | undefined>('targetRef');
      if (source) outgoing.set(source, (outgoing.get(source) ?? 0) + 1);
      if (target) incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }
    const starts = nodes.filter((n) => is(n, 'bpmn:StartEvent'));
    // no start event: one finding on the process; several: one on each start event, so that a change adding
    // another start event always introduces a finding and removing one never does
    const severalStarts = starts.length > 1 && (!isSub || !isEventSubProcess(scope));
    if (!isSub && !starts.length) {
      error('E_DESIGN_START_EVENTS', `Process ${idOf(scope)} has no start event; design-iq requires exactly one per process`, idOf(scope), 'Add one before the first node: `bpmn add <file> startEvent "<Name>" --before <firstNodeId>`.');
    } else if (severalStarts) {
      for (const start of starts) {
        const others = starts.filter((x) => x !== start).map(idOf);
        error(
          'E_DESIGN_START_EVENTS',
          `${describe(start)} is one of ${starts.length} start events of ${isSub ? 'sub-process' : 'process'} ${idOf(scope)} (also ${others.join(', ')}); design-iq ${isSub ? 'allows at most one per sub-process' : 'requires exactly one per process'}`,
          idOf(start),
          isSub
            ? 'Keep one start event inside the sub-process: `bpmn remove <file> <startId>` for the others.'
            : 'Keep one start event: remove the others (`bpmn remove <file> <startId>`) and model the alternatives after it (an event-based gateway), or move a triggered one into an event sub-process (`bpmn add <file> eventSubProcess:<trigger> "<Name>" --in <processId>`).',
          { related: others },
        );
      }
    }
    for (const n of nodes) {
      if (isEventSubProcess(n)) continue; // started by its own trigger, never connected
      const id = idOf(n);
      if (!is(n, 'bpmn:StartEvent') && !is(n, 'bpmn:BoundaryEvent') && !incoming.get(n)) {
        const allowed = bpmnAllows(n, scope, 'incoming');
        error(
          'E_DESIGN_UNREACHABLE',
          `${describe(n)} has no incoming sequence flow${allowed ? ` (${DESIGN_IQ_NOTE}${allowed})` : ''}`,
          id,
          allowed ? `design-iq cannot save this construct: remove ${id} (\`bpmn remove <file> ${id}\`), or keep it with --profile none (design-iq refuses the save).` : `Connect it (\`bpmn connect <file> <fromId> ${id}\` or \`bpmn move <file> ${id} --after <nodeId>\`) or remove it.`,
        );
      }
      if (!is(n, 'bpmn:EndEvent') && !outgoing.get(n)) {
        const allowed = bpmnAllows(n, scope, 'outgoing');
        error(
          'E_DESIGN_DEAD_END',
          `${describe(n)} has no outgoing sequence flow${allowed ? ` (${DESIGN_IQ_NOTE}${allowed})` : ''}`,
          id,
          allowed ? `design-iq cannot save this construct: remove ${id} (\`bpmn remove <file> ${id}\`), or keep it with --profile none (design-iq refuses the save).` : `Continue the flow (\`bpmn add <file> <kind> "<Name>" --after ${id}\`) or end it (\`bpmn add <file> endEvent "<Name>" --after ${id}\`).`,
        );
      }
    }
  }

  for (const process of processes) {
    const lanes = topLanes(process);
    if (!lanes.length) continue;
    const laned = new Set<El>();
    for (const lane of lanes) {
      needsDi(lane);
      for (const member of list(lane, 'flowNodeRef')) laned.add(member);
    }
    const nested = lanes.some((l) => {
      const children = l.get<El | undefined>('childLaneSet');
      return !!children && list(children, 'lanes').length > 0;
    });
    for (const node of list(process, 'flowElements')) {
      if (!is(node, 'bpmn:FlowNode') || is(node, 'bpmn:BoundaryEvent') || laned.has(node)) continue;
      error(
        'E_DESIGN_NOT_IN_LANE',
        `${describe(node)} is in no lane although process ${idOf(process)} has lanes${nested ? ' (design-iq reads the top-level lanes only)' : ''}`,
        idOf(node),
        `Assign it: \`bpmn set <file> ${idOf(node)} lane=<laneId>\` (lanes: ${lanes.map(idOf).join(', ')}).${nested ? ' A node in a child lane must also be listed by its top-level lane, as bpmn-js writes it.' : ''}`,
      );
    }
  }

  const collaboration = doc.collaboration();
  if (collaboration) {
    for (const p of list(collaboration, 'participants')) needsDi(p);
    for (const m of list(collaboration, 'messageFlows')) needsDi(m);
  }

  if (activities > COMPLEXITY_LIMIT) {
    warning('W_DESIGN_COMPLEXITY', `The file has ${activities} activities; design-iq suggests at most ${COMPLEXITY_LIMIT} (7 +- 2) per model`, processes.length === 1 ? idOf(processes[0]) : undefined, 'Extract a coherent part into its own model and call it: `bpmn add <file> callActivity "<Name>" ... calledElement=<processId>` (or group it in a sub-process).', 'complexity');
  }

  checkLinks(doc, opts, warning);
  return out;
}

/** The process a call activity calls: calledElement, or a zeebe:calledElement processId. */
function calledProcessOf(el: El): string | undefined {
  const called = el.get<string | undefined>('calledElement');
  if (called && String(called).trim()) return String(called).trim();
  const container = el.get<El | undefined>('extensionElements');
  for (const v of container ? list(container, 'values') : []) {
    const uri = (v.$descriptor as { ns?: { uri?: string } }).ns?.uri;
    if (v.$type.endsWith(':calledElement') && (!uri || uri === ZEEBE_URI)) {
      const id = (v as unknown as Record<string, unknown>)['processId'];
      if (typeof id === 'string' && id.trim()) return id.trim();
    }
  }
  return undefined;
}

function checkLinks(doc: Doc, opts: DesignOptions, warning: (code: string, message: string, element: string | undefined, hint: string) => void): void {
  const processIds = opts.processIds ? new Set(opts.processIds) : undefined;
  const decisionIds = opts.decisionIds ? new Set(opts.decisionIds) : undefined;
  // without an engine namespace the link is all a call activity / business rule task means
  const design = doc.platform() === undefined;
  for (const el of doc.byId().values()) {
    if (is(el, 'bpmn:CallActivity')) {
      const id = idOf(el);
      const called = calledProcessOf(el);
      if (!called && design) warning('W_DESIGN_CALL_LINK', `${describe(el)} calls no process (no calledElement)`, id, `Link it to the model it calls (in design-iq the process id is the file stem of its .bpmn): \`bpmn set <file> ${id} calledElement=<processId>\`.`);
      else if (called && processIds && !processIds.has(called)) warning('W_DESIGN_CALL_LINK', `${describe(el)} calls ${called}, which is not a process of this content repository (external or dangling?)`, id, `The process id is the file stem of a .bpmn in the models folder: \`bpmn set <file> ${id} calledElement=<processId>\`.`);
    } else if (is(el, 'bpmn:BusinessRuleTask')) {
      const id = idOf(el);
      const link = decisionLinkOf(el, doc);
      if (!link && design) warning('W_DESIGN_DECISION_LINK', `${describe(el)} calls no decision`, id, `Link it to its decision (in design-iq the decision id is the file stem of its .dmn): \`bpmn set <file> ${id} calledDecision=<decisionId>\`.`);
      else if (link && decisionIds && !decisionIds.has(link.value)) warning('W_DESIGN_DECISION_LINK', `${describe(el)} calls decision ${link.value}, which is not a decision of this content repository (external or dangling?)`, id, `The decision id is the file stem of a .dmn in the models folder: \`bpmn set <file> ${id} calledDecision=<decisionId>\`.`);
    }
  }
}

/** The design profile as a validator (src/validators.ts): it reads the parsed document. */
export function designValidator(opts: DesignOptions = {}): NamedValidator {
  return {
    name: DESIGN_VALIDATOR,
    ...(opts.detail ? { detail: opts.detail } : {}),
    validateDoc: (doc) => designFindings(doc, opts),
    covers: DESIGN_COVERS,
  };
}

/**
 * Lint warnings a design finding says again (as an error) about the same
 * element: the lint warning is dropped where the design profile runs.
 */
export const DESIGN_COVERS: Record<string, string> = {
  E_DESIGN_DEAD_END: 'W_DEAD_END',
  E_DESIGN_UNREACHABLE: 'W_UNREACHABLE',
  E_DESIGN_NOT_IN_LANE: 'W_NOT_IN_LANE',
  E_DESIGN_START_EVENTS: 'W_NO_START',
};
