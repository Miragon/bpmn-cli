import type { BpmnDocument, BpmnElement } from '../../model/index.js';
import { ElementAnnotations, ElementFacts, ElementLinks } from '../facts/index.js';
import { GroupMembers } from './GroupMembers.js';
import { ModelViewText, type ModelViewData, type ViewCollaboration, type ViewGroup, type ViewRoot } from './ModelViewText.js';
import { OutlineCut } from './OutlineCut.js';
import { ProcessOutline } from './ProcessOutline.js';

export class ModelView {
  private static readonly STANDARD_PREFIXES = new Set(['bpmn', 'bpmndi', 'di', 'dc', 'xsi', 'xml']);
  private static readonly ROOT_TYPES = ['bpmn:Message', 'bpmn:Error', 'bpmn:Signal', 'bpmn:Escalation'];

  private readonly links: ElementLinks;

  constructor(private readonly document: BpmnDocument) {
    this.links = new ElementLinks(document);
  }

  answer(within?: string): { text: string; view: ModelViewData } {
    const whole = this.whole();
    const view = within === undefined ? whole : new OutlineCut(this.document, within).of(whole);
    return { text: new ModelViewText(view).text(), view };
  }

  frame(): Omit<ModelViewData, 'processes' | 'groups' | 'rootElements' | 'importWarnings'> {
    const { definitions } = this.document.tree;
    return { kind: 'model', file: this.document.file, definitions: { id: new ElementFacts(definitions).ref().id, targetNamespace: definitions.peek<string>('targetNamespace'), namespaces: this.vendorNamespaces() }, collaboration: this.collaboration() };
  }

  private whole(): ModelViewData {
    const outline = new ProcessOutline(this.document);
    const lossy = this.document.lossyImportWarnings.map(({ message }) => message.split('\n')[0]!);
    const groups = this.groups();
    return {
      ...this.frame(),
      processes: this.document.tree.processes().map((process) => outline.process(process)),
      groups: groups.length ? groups : undefined,
      rootElements: this.rootElements(),
      importWarnings: lossy.length ? lossy : undefined,
    };
  }

  private vendorNamespaces(): string[] {
    const prefixes = Object.keys(this.document.tree.definitions.attrs).filter((name) => name.startsWith('xmlns:')).map((name) => name.slice('xmlns:'.length));
    return prefixes.filter((prefix) => !ModelView.STANDARD_PREFIXES.has(prefix));
  }

  private collaboration(): ViewCollaboration | undefined {
    const collaboration = this.document.tree.collaboration();
    if (!collaboration) {
      return undefined;
    }
    const annotations = new ElementAnnotations(this.document).in([collaboration]);
    return {
      ...new ElementFacts(collaboration).ref(),
      participants: this.document.flows.participants().map((participant) => {
        const process = participant.peek<BpmnElement>('processRef');
        return { ...new ElementFacts(participant).ref(), process: process && new ElementFacts(process).ref() };
      }),
      messageFlows: this.document.flows.messageFlows().map((flow) => this.links.messageFlowEnds(flow)),
      annotations: annotations.length ? annotations : undefined,
    };
  }

  private groups(): ViewGroup[] {
    const { tree } = this.document;
    return [...new GroupMembers(this.document).of()].map(([id, members]) => ({
      ...new ElementFacts(tree.require(id)).ref(),
      members: members.map((member) => new ElementFacts(tree.require(member)).ref()),
    }));
  }

  private rootElements(): ViewRoot[] {
    const roots = this.document.tree.definitions.list('rootElements').filter((root) => ModelView.ROOT_TYPES.some((type) => root.is(type)));
    return roots.map((root) => {
      const code = root.peek<string>('errorCode') ?? root.peek<string>('escalationCode');
      const facts = new ElementFacts(root);
      return { ...facts.ref(), code: code || undefined, correlationKey: facts.correlationKey() };
    });
  }
}
