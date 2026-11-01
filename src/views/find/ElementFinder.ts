import { DecisionLinkReader, ElementSlots, KindParser, Kinds, type BpmnDocument, type BpmnElement } from '../../model/index.js';
import { ElementContainer, ElementFacts, ElementLinks, ExtensionLister, type ExtensionInfo } from '../facts/index.js';
import { Phrase, type ExtensionFacts } from '../lines/index.js';
import { ElementFinderText, type FindHit } from './ElementFinderText.js';

export interface FindOptions {
  text?: string | undefined;
  kind?: string | undefined;
  in?: string | undefined;
}

export interface FindResult {
  text: string;
  hits: FindHit[];
  total: number;
}

export class ElementFinder {
  private static readonly FAMILIES = ['task', 'event', 'gateway'];
  private static readonly MATCH_BODY_MAX = 60;
  private static readonly SEARCHED_TYPES = ['bpmn:FlowElement', 'bpmn:Artifact', 'bpmn:DataAssociation', 'bpmn:Lane', 'bpmn:Participant', 'bpmn:MessageFlow', 'bpmn:Process', 'bpmn:Collaboration', 'bpmn:Message', 'bpmn:Error', 'bpmn:Signal', 'bpmn:Escalation'];

  private readonly links: ElementLinks;

  constructor(
    private readonly document: BpmnDocument,
    private readonly options: FindOptions = {},
  ) {
    this.links = new ElementLinks(document);
  }

  private static isSearched(element: BpmnElement): boolean {
    return !element.isDi && !element.is('bpmn:DataObject') && !element.is('bpmn:DataStore') && ElementFinder.SEARCHED_TYPES.some((type) => element.is(type));
  }

  private static isAssociation(element: BpmnElement): boolean {
    return element.is('bpmn:Association') || element.is('bpmn:DataAssociation');
  }

  private static kindFilter(kind: string): (element: BpmnElement) => boolean {
    const token = kind.trim();
    return ElementFinder.FAMILIES.includes(token) ? (element) => Kinds.of(element)?.family === token : KindParser.filter(token);
  }

  private static extensionMatch(extensions: readonly ExtensionFacts[], query: string, path: string): string | undefined {
    for (const extension of extensions) {
      const attribute = Object.entries(extension.attrs).find(([, value]) => value.toLowerCase().includes(query));
      if (attribute) {
        return `${path}${extension.type} ${attribute[0]}=${attribute[1]}`;
      }
      if (extension.body?.toLowerCase().includes(query)) {
        return `${path}${extension.type} ${new Phrase(extension.body).cut(ElementFinder.MATCH_BODY_MAX)}`;
      }
      const inner = ElementFinder.extensionMatch(extension.children ?? [], query, path);
      if (inner) {
        return inner;
      }
    }
    return undefined;
  }

  private static vendorMatch(element: BpmnElement, query: string): string | undefined {
    const vendor = Object.entries(new ElementFacts(element).vendorValues() ?? {}).find(([, value]) => value.toLowerCase().includes(query));
    if (vendor) {
      return `${vendor[0]}=${vendor[1]}`;
    }
    const decision = new DecisionLinkReader().linkOf(element)?.value;
    if (decision?.toLowerCase().includes(query)) {
      return `calledDecision=${decision}`;
    }
    const lister = new ExtensionLister();
    const owners: Array<[ExtensionInfo[], string]> = [[lister.list(element), ''], ...ElementSlots.entriesOf(element).map(({ prefix, el }): [ExtensionInfo[], string] => [lister.list(el), `${prefix}.`])];
    return owners.map(([extensions, path]) => ElementFinder.extensionMatch(extensions, query, path)).find(Boolean);
  }

  answer(): FindResult {
    const hits = this.hits();
    return { text: new ElementFinderText(hits).text(), hits, total: hits.length };
  }

  private hits(): FindHit[] {
    const { text, kind, in: within } = this.options;
    const query = (text ?? '').trim().toLowerCase();
    const matchesKind = kind ? ElementFinder.kindFilter(kind) : undefined;
    const container = within === undefined ? undefined : new ElementContainer(this.document, within);
    const hits: FindHit[] = [];
    for (const element of this.document.tree.walk()) {
      const kept = this.isCandidate(element, query) && (!matchesKind || matchesKind(element)) && (!container || container.holds(element));
      const hit = kept ? this.hitOf(element, query) : undefined;
      if (hit) {
        hits.push(hit);
      }
    }
    return hits;
  }

  private isCandidate(element: BpmnElement, query: string): boolean {
    if (!element.peek('id')) {
      return false;
    }
    const isAssociationAsked = !ElementFinder.isAssociation(element) || !!this.options.kind;
    return (ElementFinder.isSearched(element) && isAssociationAsked) || (!!query && element.is('bpmn:LoopCharacteristics'));
  }

  private hitOf(element: BpmnElement, query: string): FindHit | undefined {
    const { id, name } = new ElementFacts(element).ref();
    const label = name ?? (element.is('bpmn:TextAnnotation') ? element.peek<string>('text') : undefined);
    const named = !query || id.toLowerCase().includes(query) || !!label?.toLowerCase().includes(query);
    const match = named || !ElementFinder.isSearched(element) ? undefined : ElementFinder.vendorMatch(element, query);
    return named || match ? { id, kind: Kinds.labelOrType(element), name: label, in: this.innermost(element)?.id, match } : undefined;
  }

  private innermost(element: BpmnElement): BpmnElement | undefined {
    if (element.is('bpmn:Process')) {
      return undefined;
    }
    const { scopes } = this.document;
    const scope = scopes.scopeOf(element);
    if (scope?.is('bpmn:SubProcess')) {
      return scope;
    }
    const anchor = element.is('bpmn:SequenceFlow') ? element.peek<BpmnElement>('sourceRef') : element;
    const lane = anchor?.is('bpmn:FlowNode') ? this.links.effectiveLane(anchor)?.lane : undefined;
    const pool = this.links.poolOf(element);
    return lane ?? (pool !== element ? pool : undefined) ?? scope;
  }
}
