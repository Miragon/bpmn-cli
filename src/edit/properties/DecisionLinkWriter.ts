import { type BpmnElement, BpmnError, CamundaDescriptor, type ChangeSet, DecisionLinkReader, ElementText, ElementWalk, Kinds, type Platform, ZeebeDescriptor } from '../../model/index.js';
import { ExtensionLevel } from '../extensions/ExtensionLevel.js';
import type { EditSession } from '../session/EditSession.js';

type EngineSpelling = { kind: 'c7'; uri: string; prefix: string } | { kind: 'c8'; prefix: string };

interface LinkWrite {
  el: BpmnElement;
  value: string;
  reader: DecisionLinkReader;
  removed: string[];
  written: string;
}

export class DecisionLinkWriter {
  constructor(private readonly edit: EditSession) {}

  write(el: BpmnElement, value: string, changes: ChangeSet): string {
    if (!el.is('bpmn:BusinessRuleTask')) {
      throw BpmnError.model('E_UNKNOWN_KEY', `Unknown key "calledDecision" for ${Kinds.label(el)} ${ElementText.shownId(el)} (the decision link of a business rule task)`, {
        element: ElementText.shownId(el),
        hint: `Only a businessRuleTask calls a decision: \`bpmn retype <file> ${ElementText.shownId(el)} businessRuleTask\` first. An unprefixed calledDecision="..." attribute on another element is removed with \`bpmn set <file> ${ElementText.shownId(el)} --unset calledDecision\`.`,
      });
    }
    const reader = new DecisionLinkReader(this.edit.document.namespaces);
    const link: LinkWrite = { el, value, reader, removed: [], written: '' };
    const platform = this.edit.platform();
    const ownLink = reader.linkOf(el);
    DecisionLinkWriter.dropAttribute(link, 'calledElement');
    if (value) {
      this.writeForPlatform(link, platform, ownLink, changes);
    } else {
      DecisionLinkWriter.dropAttribute(link, 'calledDecision');
      DecisionLinkWriter.dropC7Refs(link);
      DecisionLinkWriter.dropZeebeCalls(link);
    }
    const parts = [value ? `calledDecision=${value} (${link.written})` : 'calledDecision removed'];
    if (link.removed.length) {
      parts.push(`removed ${[...new Set(link.removed)].join(', ')}`);
    }
    return parts.join('; ');
  }

  private writeForPlatform(link: LinkWrite, platform: Platform, ownLink: ReturnType<DecisionLinkReader['linkOf']>, changes: ChangeSet): void {
    if (platform === 'c7') {
      this.writeC7Default(link);
    } else if (platform === 'c8') {
      this.writeC8(link, changes);
    } else {
      this.writeLikeTheFile(link, ownLink);
    }
  }

  private writeC7Default(link: LinkWrite): void {
    const { namespaces } = this.edit.document;
    const operatonOnly = !namespaces.prefixFor(CamundaDescriptor.URI) && !!namespaces.prefixFor(CamundaDescriptor.OPERATON_URI);
    const prefix = operatonOnly ? this.prefixFor(CamundaDescriptor.OPERATON_URI, 'operaton') : this.prefixFor(CamundaDescriptor.URI, 'camunda');
    DecisionLinkWriter.writeC7(link, `${prefix}:decisionRef`);
  }

  private writeC8(link: LinkWrite, changes: ChangeSet): void {
    const { el, value, reader } = link;
    const call = this.writeZeebe(link, reader.zeebeCalls(el)[0], 'zeebe');
    if (!DecisionLinkReader.textValue(call.peek('resultVariable'))) {
      changes.warn({
        code: 'W_DECISION_RESULT_VARIABLE',
        message: `${ElementText.shownId(el)} calls decision ${value} without a resultVariable; Camunda 8 requires one to deploy`,
        element: ElementText.shownId(el),
        hint: `Name the variable that receives the result: \`bpmn ext add <file> ${ElementText.shownId(el)} ${call.type} decisionId=${value} resultVariable=<variable> --replace\`.`,
      });
    }
  }

  private writeLikeTheFile(link: LinkWrite, ownLink: ReturnType<DecisionLinkReader['linkOf']>): void {
    const { el, reader } = link;
    const ownC7 = reader.c7DecisionRefs(el)[0]?.[0];
    const ownCall = ownC7 ? undefined : reader.zeebeCalls(el).find((call) => DecisionLinkReader.textValue(call.peek('decisionId')));
    const follow = ownLink ? undefined : this.fileEngineSpelling(el);
    if (ownC7) {
      DecisionLinkWriter.writeC7(link, ownC7);
    } else if (ownCall) {
      this.writeZeebe(link, ownCall, 'zeebe');
    } else if (follow?.kind === 'c7') {
      DecisionLinkWriter.writeC7(link, `${this.prefixFor(follow.uri, follow.prefix)}:decisionRef`);
    } else if (follow?.kind === 'c8') {
      this.writeZeebe(link, reader.zeebeCalls(el)[0], follow.prefix);
    } else {
      DecisionLinkWriter.writeBare(link);
    }
  }

  private static writeBare(link: LinkWrite): void {
    DecisionLinkWriter.dropC7Refs(link);
    DecisionLinkWriter.dropZeebeCalls(link);
    link.el.attrs['calledDecision'] = link.value;
    link.written = 'calledDecision';
  }

  private static writeC7(link: LinkWrite, key: string): void {
    DecisionLinkWriter.dropAttribute(link, 'calledDecision');
    DecisionLinkWriter.dropC7Refs(link, key);
    DecisionLinkWriter.dropZeebeCalls(link);
    link.el.attrs[key] = link.value;
    link.written = key;
  }

  private writeZeebe(link: LinkWrite, own: BpmnElement | undefined, usual: string): BpmnElement {
    DecisionLinkWriter.dropAttribute(link, 'calledDecision');
    DecisionLinkWriter.dropC7Refs(link);
    const call = own ?? this.addZeebeCall(link.el, usual);
    DecisionLinkWriter.dropZeebeCalls(link, call);
    call.set('decisionId', link.value);
    link.written = call.type;
    return call;
  }

  private addZeebeCall(el: BpmnElement, usual: string): BpmnElement {
    const { tree } = this.edit.document;
    const prefix = this.prefixFor(ZeebeDescriptor.URI, usual);
    const call = tree.buildAny(`${prefix}:calledDecision`, ZeebeDescriptor.URI, {});
    const container = ExtensionLevel.containerOn(el, this.edit.document);
    call.parent = container;
    container.add('values', call);
    return call;
  }

  private static dropAttribute({ el, removed }: LinkWrite, key: string): void {
    if (Object.prototype.hasOwnProperty.call(el.attrs, key)) {
      delete el.attrs[key];
      removed.push(key);
    }
  }

  private static dropC7Refs(link: LinkWrite, keep?: string): void {
    for (const [key] of link.reader.c7DecisionRefs(link.el)) {
      if (key !== keep) {
        DecisionLinkWriter.dropAttribute(link, key);
      }
    }
  }

  private static dropZeebeCalls({ el, reader, removed }: LinkWrite, keep?: BpmnElement): void {
    const container = el.get<BpmnElement | undefined>('extensionElements');
    let dropped = false;
    for (const call of reader.zeebeCalls(el)) {
      if (call === keep || !container) {
        continue;
      }
      container.remove('values', call);
      removed.push(call.type);
      dropped = true;
    }
    if (dropped && container && !container.list('values').length) {
      el.set('extensionElements', undefined);
    }
  }

  private prefixFor(uri: string, usual: string): string {
    const prefix = this.edit.document.namespaces.prefixFor(uri) ?? usual;
    this.edit.document.namespaces.declare(prefix, uri);
    return prefix;
  }

  private fileEngineSpelling(el: BpmnElement): EngineSpelling | undefined {
    const reader = new DecisionLinkReader(this.edit.document.namespaces);
    const seen = new Map<string, EngineSpelling | undefined>();
    for (const task of new ElementWalk(this.edit.document.tree.definitions).depthFirst({ bpmnOnly: true })) {
      if (task === el || !task.is('bpmn:BusinessRuleTask')) {
        continue;
      }
      DecisionLinkWriter.noteC7Spellings(task, reader, seen);
      DecisionLinkWriter.noteZeebeSpellings(task, reader, seen);
      DecisionLinkWriter.noteBareLinks(task, seen);
      if (seen.size > 1) {
        return undefined;
      }
    }
    return [...seen.values()][0];
  }

  private static noteC7Spellings(task: BpmnElement, reader: DecisionLinkReader, seen: Map<string, EngineSpelling | undefined>): void {
    for (const [key] of reader.c7DecisionRefs(task)) {
      const prefix = key.slice(0, key.indexOf(':'));
      const uri = reader.uriOf(task, prefix);
      seen.set(uri ? `c7 ${uri}` : key, uri ? { kind: 'c7', uri, prefix } : undefined);
    }
  }

  private static noteZeebeSpellings(task: BpmnElement, reader: DecisionLinkReader, seen: Map<string, EngineSpelling | undefined>): void {
    for (const call of reader.zeebeCalls(task)) {
      if (!DecisionLinkReader.textValue(call.peek('decisionId'))) {
        continue;
      }
      const prefix = call.type.split(':')[0]!;
      const declared = ((call.descriptor as { ns?: { uri?: string } }).ns?.uri ?? reader.uriOf(task, prefix)) === ZeebeDescriptor.URI;
      seen.set(declared ? 'zeebe' : call.type, declared ? { kind: 'c8', prefix } : undefined);
    }
  }

  private static noteBareLinks(task: BpmnElement, seen: Map<string, EngineSpelling | undefined>): void {
    for (const key of ['calledDecision', 'calledElement']) {
      if (DecisionLinkReader.textValue(task.attrs[key])) {
        seen.set(key, undefined);
      }
    }
  }
}
