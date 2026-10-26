import type { Doc } from '../model/Doc.js';
import { kindLabel } from '../model/utils/kinds.js';
import { diExpansionState } from '../drawing/utils/expansion.js';
import { Groups } from '../drawing/Groups.js';
import { is, list, peek, shownId, type El } from '../model/utils/moddle.js';
import { laneOf } from '../model/utils/lanes.js';
import { FlowOrder } from '../validate/FlowOrder.js';
import { StructuralValidator } from '../validate/StructuralValidator.js';
import { ElementFacts } from './ElementFacts.js';
import { ElementLinks } from './ElementLinks.js';
import type { ModelView, ViewData, ViewGroup, ViewLane, ViewMessageFlow, ViewNode, ViewProcess } from './model-view.js';
import { compact, nameOf, nonEmpty, refLabel, scopesWithin } from './utils/view.js';

const STANDARD_NS = new Set(['bpmn', 'bpmndi', 'di', 'dc', 'xsi', 'xml']);

const ROOT_KINDS: Array<[string, string]> = [
  ['bpmn:Message', 'message'],
  ['bpmn:Error', 'error'],
  ['bpmn:Signal', 'signal'],
  ['bpmn:Escalation', 'escalation'],
];

/**
 * The agent's read view of the model, without DI and coordinates. Nodes come in flow order:
 * depth-first from start events in declaration order of outgoing flows, unreachable ones last.
 * Missing incoming / outgoing mirror entries are added first, so hand-written files show flows.
 */
export class ModelViewBuilder {
  private readonly links: ElementLinks;
  private readonly expansion: Map<string, boolean>;

  constructor(private readonly doc: Doc) {
    this.links = new ElementLinks(doc);
    this.expansion = diExpansionState(doc.definitions);
  }

  build(): ModelView {
    const doc = this.doc;
    const { errors, warnings } = new StructuralValidator(doc).validate();
    return compact<ModelView>({
      file: doc.file,
      definitions: compact({
        id: shownId(doc.definitions),
        targetNamespace: peek<string>(doc.definitions, 'targetNamespace'),
        namespaces: this.vendorNamespaces(),
      }),
      collaboration: this.collaboration(),
      processes: doc.processes().map((process) => this.process(process)),
      groups: nonEmpty(this.groups()),
      rootElements: this.rootElements(),
      problems: [...errors, ...warnings],
      importWarnings: nonEmpty(doc.lossyImportWarnings.map((warning) => warning.message.split('\n')[0]!)),
    });
  }

  /** `show --scope <id>`: narrows a view in place to one process or sub-process subtree. */
  scope(view: ModelView, scopeId: string): ModelView {
    const doc = this.doc;
    const scope = doc.requireScope(scopeId);
    const id = scope.get<string>('id');
    const processId = doc.processOf(scope)?.get<string>('id');
    view.processes = view.processes.filter((process) => process.id === processId);
    const inScope = (id: string): boolean => {
      for (let el = doc.get(id); el; el = el.$parent as El | undefined) if (el === scope) return true;
      return false;
    };
    view.groups = nonEmpty((view.groups ?? []).filter((group) => group.members.some(inScope)));
    if (id !== processId) {
      const findNode = (nodes: ViewNode[]): ViewNode | undefined => {
        for (const node of nodes) {
          if (node.id === id) return node;
          const inner = node.children ? findNode(node.children) : undefined;
          if (inner) return inner;
        }
        return undefined;
      };
      for (const process of view.processes) {
        const sub = findNode(process.nodes);
        process.nodes = sub ? [sub] : [];
      }
    }
    return view;
  }

  private nodes(scope: El): ViewNode[] {
    const { ordered, unreachable } = new FlowOrder(this.doc, scope);
    return ordered.map((node) => this.node(node, unreachable));
  }

  private node(el: El, unreachable: Set<El>): ViewNode {
    const doc = this.doc;
    const facts = new ElementFacts(el);
    const id = shownId(el);
    const isSub = is(el, 'bpmn:SubProcess');
    const boundary = is(el, 'bpmn:Activity') ? doc.boundaryEventsOf(el).map((boundaryEvent) => this.node(boundaryEvent, unreachable)) : [];
    return compact<ViewNode>({
      id,
      kind: kindLabel(el),
      type: el.$type,
      name: nameOf(el),
      trigger: is(el, 'bpmn:Event') ? facts.trigger() : undefined,
      nonInterrupting: facts.nonInterrupting(),
      documentation: facts.documentation(),
      outgoing: doc.outgoing(el).map((flow) => new ElementFacts(flow).flow()),
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
    const nodes = scopes.flatMap((scope) => this.doc.flowNodes(scope));
    const out: ViewData[] = [];
    for (const scope of scopes) {
      for (const el of this.doc.flowElements(scope)) {
        const kind = is(el, 'bpmn:DataObjectReference') ? 'dataObject' : is(el, 'bpmn:DataStoreReference') ? 'dataStore' : undefined;
        if (!kind) continue;
        const from: string[] = [];
        const to: string[] = [];
        for (const node of nodes) {
          if (list(node, 'dataOutputAssociations').some((association) => peek<El>(association, 'targetRef') === el)) from.push(shownId(node));
          if (list(node, 'dataInputAssociations').some((association) => list(association, 'sourceRef').includes(el))) to.push(shownId(node));
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
      participants: doc.participants().map((participant) => compact({ id: shownId(participant), name: nameOf(participant), process: peek<El>(participant, 'processRef')?.get<string>('id') })),
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

  private vendorNamespaces(): string[] {
    const attrs = (this.doc.definitions.$attrs ?? {}) as Record<string, unknown>;
    return Object.keys(attrs)
      .filter((attributeName) => attributeName.startsWith('xmlns:'))
      .map((attributeName) => attributeName.slice('xmlns:'.length))
      .filter((prefix) => !STANDARD_NS.has(prefix));
  }

  private groups(): ViewGroup[] {
    return [...new Groups(this.doc.definitions).members()].map(([id, members]) => compact<ViewGroup>({ id, name: nameOf(this.doc.require(id)), members }));
  }
}
