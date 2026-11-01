import { type BpmnElement, BpmnError, CamundaDescriptor, type ChangeSet, DecisionLinkReader, ElementText, ElementWalk, Kinds, ZeebeDescriptor } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';

type EngineSpelling = { kind: 'c7'; uri: string; prefix: string } | { kind: 'c8'; prefix: string };

export class DecisionLinkWriter {
  constructor(private readonly edit: EditSession) {}

  write(el: BpmnElement, value: string, changes: ChangeSet): string {
    const document = this.edit.document;
    const reader = new DecisionLinkReader(document.namespaces);
    if (!el.is('bpmn:BusinessRuleTask')) {
      throw BpmnError.model('E_UNKNOWN_KEY', `Unknown key "calledDecision" for ${Kinds.label(el)} ${ElementText.shownId(el)} (the decision link of a business rule task)`, {
        element: ElementText.shownId(el),
        hint: `Only a businessRuleTask calls a decision: \`bpmn retype <file> ${ElementText.shownId(el)} businessRuleTask\` first. An unprefixed calledDecision="..." attribute on another element is removed with \`bpmn set <file> ${ElementText.shownId(el)} calledDecision=\`.`,
      });
    }
    const platform = this.edit.platform();
    const ownLink = reader.linkOf(el);
    const removed: string[] = [];
    const dropAttr = (key: string): void => {
      if (el.attrs && Object.prototype.hasOwnProperty.call(el.attrs, key)) {
        delete el.attrs[key];
        removed.push(key);
      }
    };
    const dropC7 = (keep?: string): void => {
      for (const [key] of reader.c7DecisionRefs(el)) {
        if (key !== keep) {
          dropAttr(key);
        }
      }
    };
    const dropZeebe = (keep?: BpmnElement): void => {
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
    };
    let written = '';
    const writeC7 = (key: string): void => {
      dropAttr('calledDecision');
      dropC7(key);
      dropZeebe();
      el.attrs[key] = value;
      written = key;
    };
    const writeZeebe = (own: BpmnElement | undefined, usual: string): BpmnElement => {
      dropAttr('calledDecision');
      dropC7();
      let call = own;
      if (!call) {
        const prefix = this.prefixFor(ZeebeDescriptor.URI, usual);
        call = document.tree.buildAny(`${prefix}:calledDecision`, ZeebeDescriptor.URI, {});
        let container = el.get<BpmnElement | undefined>('extensionElements');
        if (!container) {
          container = document.tree.build('bpmn:ExtensionElements');
          container.parent = el;
          el.set('extensionElements', container);
        }
        call.parent = container;
        container.add('values', call);
      }
      dropZeebe(call);
      call.set('decisionId', value);
      written = call.type;
      return call;
    };
    dropAttr('calledElement');
    if (!value) {
      dropAttr('calledDecision');
      dropC7();
      dropZeebe();
    } else if (platform === 'c7') {
      const operatonOnly = !document.namespaces.prefixFor(CamundaDescriptor.URI) && !!document.namespaces.prefixFor(CamundaDescriptor.OPERATON_URI);
      const prefix = operatonOnly ? this.prefixFor(CamundaDescriptor.OPERATON_URI, 'operaton') : this.prefixFor(CamundaDescriptor.URI, 'camunda');
      writeC7(`${prefix}:decisionRef`);
    } else if (platform === 'c8') {
      const call = writeZeebe(reader.zeebeCalls(el)[0], 'zeebe');
      if (!DecisionLinkReader.textValue(call.peek('resultVariable'))) {
        changes.warn(
          {
              code: 'W_DECISION_RESULT_VARIABLE',
              message: `${ElementText.shownId(el)} calls decision ${value} without a resultVariable; Camunda 8 requires one to deploy`,
              element: ElementText.shownId(el),
              hint: `Name the variable that receives the result: \`bpmn ext add <file> ${ElementText.shownId(el)} ${call.type} decisionId=${value} resultVariable=<variable> --replace\`.`,
            },
        );
      }
    } else {
      const ownC7 = reader.c7DecisionRefs(el)[0]?.[0];
      const ownCall = ownC7 ? undefined : reader.zeebeCalls(el).find((call) => DecisionLinkReader.textValue(call.peek('decisionId')));
      const follow = ownLink ? undefined : this.fileEngineSpelling(el);
      if (ownC7) {
        writeC7(ownC7);
      } else if (ownCall) {
        writeZeebe(ownCall, 'zeebe');
      } else if (follow?.kind === 'c7') {
        writeC7(`${this.prefixFor(follow.uri, follow.prefix)}:decisionRef`);
      } else if (follow?.kind === 'c8') {
        writeZeebe(reader.zeebeCalls(el)[0], follow.prefix);
      } else {
        dropC7();
        dropZeebe();
        el.attrs['calledDecision'] = value;
        written = 'calledDecision';
      }
    }
    const parts = [value ? `calledDecision=${value} (${written})` : 'calledDecision removed'];
    if (removed.length) {
      parts.push(`removed ${[...new Set(removed)].join(', ')}`);
    }
    return parts.join('; ');
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
      for (const [key] of reader.c7DecisionRefs(task)) {
        const prefix = key.slice(0, key.indexOf(':'));
        const uri = reader.uriOf(task, prefix);
        seen.set(uri ? `c7 ${uri}` : key, uri ? { kind: 'c7', uri, prefix } : undefined);
      }
      for (const call of reader.zeebeCalls(task)) {
        if (!DecisionLinkReader.textValue(call.peek('decisionId'))) {
          continue;
        }
        const prefix = call.type.split(':')[0]!;
        const declared = ((call.descriptor as { ns?: { uri?: string } }).ns?.uri ?? reader.uriOf(task, prefix)) === ZeebeDescriptor.URI;
        seen.set(declared ? 'zeebe' : call.type, declared ? { kind: 'c8', prefix } : undefined);
      }
      for (const key of ['calledDecision', 'calledElement']) {
        if (DecisionLinkReader.textValue(task.attrs?.[key])) {
          seen.set(key, undefined);
        }
      }
      if (seen.size > 1) {
        return undefined;
      }
    }
    return [...seen.values()][0];
  }
}
