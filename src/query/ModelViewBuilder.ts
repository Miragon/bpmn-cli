/**
 * The AI's read view of the model (no DI, no coordinates).
 *
 * CONTRACT:
 *  - build(): ModelView. Nodes of a scope are listed in FLOW ORDER:
 *    depth-first from start events (then nodes without incoming flows), in
 *    declaration order of outgoing flows; unreachable nodes follow, flagged.
 *    Boundary events are nested under their host, sub-process children under
 *    the sub-process (recursively). Lanes list member ids. Collaboration
 *    section with participants and message flows. Root messages/errors/
 *    signals/escalations. `problems` = validateDoc(doc) errors + warnings
 *    (validate/structural.ts).
 *  It first adds missing incoming/outgoing mirror entries (optional in BPMN
 *  2.0, see repairFlowLinks in validate/structural.ts) so flows of hand-written files
 *  show up; a file with complete mirrors is left untouched.
 *  The decision link of a business rule task is shown as the node fact
 *  `calledDecision` in every spelling (ops/decision.ts). The Camunda 8
 *  settings that say what a node does are node facts too (`job`,
 *  `calledElement`, `script`, `form`, `assignee` / `candidateGroups` /
 *  `candidateUsers`, `inputCollection` / `inputElement` / `outputCollection`
 *  / `outputElement`), and a message shows its zeebe correlation key.
 */
import type { Doc } from '../model/Doc.js';
import { kindLabel } from '../model/utils/kinds.js';
import { diExpansionState } from '../layout/index.js';
import { is, list, peek, shownId, type El } from '../model/utils/moddle.js';
import { laneOf } from '../ops/utils/lanes.js';
import { groupMembers } from '../diagram/groups.js';
import { flowOrder, validateDoc } from '../validate/structural.js';
import { ElementFacts } from './ElementFacts.js';
import { ElementLinks } from './ElementLinks.js';
import type { ModelView, ViewData, ViewGroup, ViewLane, ViewMessageFlow, ViewNode, ViewProcess } from './model-view.js';
import { compact, nameOf, nonEmpty, refLabel, scopesWithin } from './utils/view.js';

/** xmlns prefixes that are part of BPMN itself (not vendor namespaces). */
const STANDARD_NS = new Set(['bpmn', 'bpmndi', 'di', 'dc', 'xsi', 'xml']);

const ROOT_KINDS: Array<[string, string]> = [
  ['bpmn:Message', 'message'],
  ['bpmn:Error', 'error'],
  ['bpmn:Signal', 'signal'],
  ['bpmn:Escalation', 'escalation'],
];

export class ModelViewBuilder {
  private readonly links: ElementLinks;
  private readonly expansion: Map<string, boolean>;

  constructor(private readonly doc: Doc) {
    this.links = new ElementLinks(doc);
    this.expansion = diExpansionState(doc.definitions);
  }

  /** The complete semantic view of the document (see contract above). */
  build(): ModelView {
    const doc = this.doc;
    const { errors, warnings } = validateDoc(doc);
    return compact<ModelView>({
      file: doc.file,
      definitions: compact({
        id: shownId(doc.definitions),
        targetNamespace: peek<string>(doc.definitions, 'targetNamespace'),
        namespaces: this.vendorNamespaces(),
      }),
      collaboration: this.collaboration(),
      processes: doc.processes().map((p) => this.process(p)),
      groups: nonEmpty(this.groups()),
      rootElements: this.rootElements(),
      problems: [...errors, ...warnings],
      importWarnings: nonEmpty(doc.lossyImportWarnings.map((w) => w.message.split('\n')[0]!)),
    });
  }

  /**
   * `show --scope <id>`: narrows a view (in place) to one process, the process
   * of a participant, or one sub-process subtree. E_NOT_FOUND / E_WRONG_KIND
   * for an id that is no scope (Doc.requireScope).
   */
  scope(view: ModelView, scopeId: string): ModelView {
    const doc = this.doc;
    const scope = doc.requireScope(scopeId);
    const id = scope.get<string>('id');
    const processId = doc.processOf(scope)?.get<string>('id');
    view.processes = view.processes.filter((p) => p.id === processId);
    const inScope = (id: string): boolean => {
      for (let el = doc.get(id); el; el = el.$parent as El | undefined) if (el === scope) return true;
      return false;
    };
    view.groups = nonEmpty((view.groups ?? []).filter((g) => g.members.some(inScope)));
    if (id !== processId) {
      // narrow to the sub-process subtree
      const findNode = (nodes: ViewNode[]): ViewNode | undefined => {
        for (const n of nodes) {
          if (n.id === id) return n;
          const inner = n.children ? findNode(n.children) : undefined;
          if (inner) return inner;
        }
        return undefined;
      };
      for (const p of view.processes) {
        const sub = findNode(p.nodes);
        p.nodes = sub ? [sub] : [];
      }
    }
    return view;
  }

  private nodes(scope: El): ViewNode[] {
    const { ordered, unreachable } = flowOrder(this.doc, scope);
    return ordered.map((node) => this.node(node, unreachable));
  }

  private node(el: El, unreachable: Set<El>): ViewNode {
    const doc = this.doc;
    const facts = new ElementFacts(el);
    const id = shownId(el);
    const isSub = is(el, 'bpmn:SubProcess');
    const boundary = is(el, 'bpmn:Activity') ? doc.boundaryEventsOf(el).map((b) => this.node(b, unreachable)) : [];
    return compact<ViewNode>({
      id,
      kind: kindLabel(el),
      type: el.$type,
      name: nameOf(el),
      trigger: is(el, 'bpmn:Event') ? facts.trigger() : undefined,
      nonInterrupting: facts.nonInterrupting(),
      documentation: facts.documentation(),
      outgoing: doc.outgoing(el).map((f) => new ElementFacts(f).flow()),
      incoming: doc.incoming(el).map(shownId),
      lane: is(el, 'bpmn:BoundaryEvent') ? undefined : laneOf(doc, el)?.get<string>('id'),
      boundary: boundary.length ? boundary : undefined,
      children: isSub ? this.nodes(el) : undefined,
      expanded: isSub ? this.expansion.get(id) !== false : undefined,
      unreachable: unreachable.has(el) ? true : undefined,
      props: facts.props(),
      attrs: facts.vendorValues(),
      extensions: facts.extensionMentions(),
      extensionElements: nonEmpty(facts.extensionTypes()),
    });
  }

  private lanes(laneSet: El | undefined): ViewLane[] {
    if (!laneSet) return [];
    return list(laneSet, 'lanes').map((lane) => {
      const nested = this.lanes(peek<El>(lane, 'childLaneSet'));
      return compact<ViewLane>({
        id: shownId(lane),
        name: nameOf(lane),
        members: list(lane, 'flowNodeRef').map(shownId),
        lanes: nested.length ? nested : undefined,
      });
    });
  }

  private data(process: El): ViewData[] {
    const scopes = scopesWithin(process);
    const nodes = scopes.flatMap((s) => this.doc.flowNodes(s));
    const out: ViewData[] = [];
    for (const scope of scopes) {
      for (const el of this.doc.flowElements(scope)) {
        const kind = is(el, 'bpmn:DataObjectReference') ? 'dataObject' : is(el, 'bpmn:DataStoreReference') ? 'dataStore' : undefined;
        if (!kind) continue;
        const from: string[] = [];
        const to: string[] = [];
        for (const node of nodes) {
          if (list(node, 'dataOutputAssociations').some((a) => peek<El>(a, 'targetRef') === el)) from.push(shownId(node));
          if (list(node, 'dataInputAssociations').some((a) => list(a, 'sourceRef').includes(el))) to.push(shownId(node));
        }
        out.push(compact<ViewData>({ id: shownId(el), kind, name: nameOf(el), from, to }));
      }
    }
    return out;
  }

  private process(process: El): ViewProcess {
    const facts = new ElementFacts(process);
    return compact<ViewProcess>({
      id: shownId(process),
      name: nameOf(process),
      executable: peek<boolean>(process, 'isExecutable') === true,
      participant: this.doc.participantOf(process)?.get<string>('id'),
      attrs: facts.vendorValues(),
      extensions: facts.extensionMentions(),
      extensionElements: nonEmpty(facts.extensionTypes()),
      lanes: list(process, 'laneSets').flatMap((ls) => this.lanes(ls)),
      nodes: this.nodes(process),
      data: this.data(process),
      annotations: this.links.annotationsIn(scopesWithin(process)),
    });
  }

  private rootElements(): ModelView['rootElements'] {
    const out: ModelView['rootElements'] = [];
    for (const el of this.doc.definitions.get<El[]>('rootElements')) {
      const match = ROOT_KINDS.find(([type]) => is(el, type));
      if (!match) continue;
      const code = peek<string>(el, 'errorCode') ?? peek<string>(el, 'escalationCode');
      out.push(compact({ id: shownId(el), kind: match[1], name: nameOf(el), code: code || undefined, correlationKey: new ElementFacts(el).correlationKey() }));
    }
    return out;
  }

  private collaboration(): ModelView['collaboration'] {
    const doc = this.doc;
    const collab = doc.collaboration();
    if (!collab) return undefined;
    const annotations = this.links.annotationsIn([collab]);
    return compact({
      id: shownId(collab),
      participants: doc.participants().map((p) => compact({ id: shownId(p), name: nameOf(p), process: peek<El>(p, 'processRef')?.get<string>('id') })),
      messageFlows: doc.messageFlows().map((mf) => {
        const source = peek<El>(mf, 'sourceRef');
        const target = peek<El>(mf, 'targetRef');
        return compact<ViewMessageFlow>({
          id: shownId(mf),
          source: shownId(source),
          target: shownId(target),
          name: nameOf(mf),
          message: peek<El>(mf, 'messageRef') ? refLabel(peek<El>(mf, 'messageRef')) : undefined,
          sourceName: source ? nameOf(source) : undefined,
          targetName: target ? nameOf(target) : undefined,
        });
      }),
      annotations: nonEmpty(annotations),
    });
  }

  /** Vendor namespace prefixes declared on the definitions (bpmn/di/xsi left out). */
  private vendorNamespaces(): string[] {
    const attrs = (this.doc.definitions.$attrs ?? {}) as Record<string, unknown>;
    return Object.keys(attrs)
      .filter((k) => k.startsWith('xmlns:'))
      .map((k) => k.slice('xmlns:'.length))
      .filter((prefix) => !STANDARD_NS.has(prefix));
  }

  private groups(): ViewGroup[] {
    return [...groupMembers(this.doc.definitions)].map(([id, members]) => compact<ViewGroup>({ id, name: nameOf(this.doc.require(id)), members }));
  }
}
