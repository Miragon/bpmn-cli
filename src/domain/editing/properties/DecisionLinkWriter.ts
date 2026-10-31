import type { EditSession } from '../../document/EditSession.js';
import { modelError } from '../../document/utils/errors.js';
import { kindLabel } from '../../document/Kinds.js';
import { addTo, is, many, removeFrom, shownId, walk, type El } from '../../document/utils/moddle.js';
import type { ChangeSet } from '../../document/ChangeSet.js';
import { withUnserialised } from '../../document/utils/finding.js';
import { textValue } from '../../document/utils/text-value.js';
import { DecisionLinkReader } from './DecisionLinkReader.js';
import { CAMUNDA_URI, OPERATON_URI } from '../../document/vendor/CamundaDescriptor.js';
import { ZEEBE_URI } from '../../document/vendor/ZeebeDescriptor.js';

type EngineSpelling = { kind: 'c7'; uri: string; prefix: string } | { kind: 'c8'; prefix: string };

/**
 * Writes a business rule task's decision link in one spelling and removes the others, so a
 * task never carries two links. Camunda 7 / 8 files get the engine's spelling: the engines
 * refuse the unprefixed attribute against the BPMN schema.
 */
export class DecisionLinkWriter {
  constructor(private readonly edit: EditSession) {}

  /**
   * Writes the decision link of a business rule task in the platform's spelling. The task's own
   * link is read before calledElement (a hand-written decision link too) goes, so it keeps its
   * spelling; an extension container this empties goes too, one the file had empty stays.
   * Camunda 7 writes operaton:decisionRef in an Operaton-only file, as Operaton reads its own
   * namespace first. Camunda 8 keeps an existing zeebe:calledDecision's resultVariable; its
   * missing-resultVariable warning yields to the Camunda 8 profile's when that runs.
   */
  write(el: El, value: string, changes: ChangeSet): string {
    const doc = this.edit.doc;
    const reader = new DecisionLinkReader(doc);
    if (!is(el, 'bpmn:BusinessRuleTask')) {
      throw modelError('E_UNKNOWN_KEY', `Unknown key "calledDecision" for ${kindLabel(el)} ${shownId(el)} (the decision link of a business rule task)`, {
        element: shownId(el),
        hint: `Only a businessRuleTask calls a decision: \`bpmn retype <file> ${shownId(el)} businessRuleTask\` first. An unprefixed calledDecision="..." attribute on another element is removed with \`bpmn set <file> ${shownId(el)} calledDecision=\`.`,
      });
    }
    const platform = this.edit.platform();
    const ownLink = reader.linkOf(el);
    const removed: string[] = [];
    const dropAttr = (key: string): void => {
      if (el.$attrs && Object.prototype.hasOwnProperty.call(el.$attrs, key)) {
        delete el.$attrs[key];
        removed.push(key);
      }
    };
    const dropC7 = (keep?: string): void => {
      for (const [key] of reader.c7DecisionRefs(el)) {
        if (key !== keep) dropAttr(key);
      }
    };
    const dropZeebe = (keep?: El): void => {
      const container = el.get<El | undefined>('extensionElements');
      let dropped = false;
      for (const call of reader.zeebeCalls(el)) {
        if (call === keep || !container) continue;
        removeFrom(container, 'values', call);
        removed.push(call.$type);
        dropped = true;
      }
      if (dropped && container && !many(container, 'values').length) {
        el.set('extensionElements', undefined);
      }
    };
    let written = '';
    const writeC7 = (key: string): void => {
      dropAttr('calledDecision');
      dropC7(key);
      dropZeebe();
      el.$attrs[key] = value;
      written = key;
    };
    const writeZeebe = (own: El | undefined, usual: string): El => {
      dropAttr('calledDecision');
      dropC7();
      let call = own;
      if (!call) {
        const prefix = this.prefixFor(ZEEBE_URI, usual);
        call = doc.moddle.createAny(`${prefix}:calledDecision`, ZEEBE_URI, {}) as unknown as El;
        let container = el.get<El | undefined>('extensionElements');
        if (!container) {
          container = doc.moddle.create('bpmn:ExtensionElements');
          container.$parent = el;
          el.set('extensionElements', container);
        }
        call.$parent = container;
        addTo(container, 'values', call);
      }
      dropZeebe(call);
      (call as unknown as Record<string, unknown>)['decisionId'] = value;
      written = call.$type;
      return call;
    };
    dropAttr('calledElement');
    if (!value) {
      dropAttr('calledDecision');
      dropC7();
      dropZeebe();
    } else if (platform === 'c7') {
      const operatonOnly = !doc.prefixFor(CAMUNDA_URI) && !!doc.prefixFor(OPERATON_URI);
      const prefix = operatonOnly ? this.prefixFor(OPERATON_URI, 'operaton') : this.prefixFor(CAMUNDA_URI, 'camunda');
      writeC7(`${prefix}:decisionRef`);
    } else if (platform === 'c8') {
      const call = writeZeebe(reader.zeebeCalls(el)[0], 'zeebe');
      if (!textValue((call as unknown as Record<string, unknown>)['resultVariable'])) {
        changes.warn(
          withUnserialised(
            {
              code: 'W_DECISION_RESULT_VARIABLE',
              message: `${shownId(el)} calls decision ${value} without a resultVariable; Camunda 8 requires one to deploy`,
              element: shownId(el),
              hint: `Name the variable that receives the result: \`bpmn ext add <file> ${shownId(el)} ${call.$type} decisionId=${value} resultVariable=<variable> --replace\`.`,
            },
            { covers: ['ext:calledDecision.resultVariable'] },
          ),
        );
      }
    } else {
      /**
       * without an engine: the task's own engine spelling, else the one the file's links share,
       * else the unprefixed calledDecision; no engine reads it, so no resultVariable warning
       */
      const ownC7 = reader.c7DecisionRefs(el)[0]?.[0];
      const ownCall = ownC7 ? undefined : reader.zeebeCalls(el).find((call) => textValue((call as unknown as Record<string, unknown>)['decisionId']));
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
        el.$attrs['calledDecision'] = value;
        written = 'calledDecision';
      }
    }
    const parts = [value ? `calledDecision=${value} (${written})` : 'calledDecision removed'];
    if (removed.length) parts.push(`removed ${[...new Set(removed)].join(', ')}`);
    return parts.join('; ');
  }

  private prefixFor(uri: string, usual: string): string {
    const prefix = this.edit.doc.prefixFor(uri) ?? usual;
    this.edit.doc.declareNamespace(prefix, uri);
    return prefix;
  }

  /** The engine spelling all the file's other decision links share, if they share exactly one. */
  private fileEngineSpelling(el: El): EngineSpelling | undefined {
    const reader = new DecisionLinkReader(this.edit.doc);
    const seen = new Map<string, EngineSpelling | undefined>();
    for (const task of walk(this.edit.doc.definitions, { bpmnOnly: true })) {
      if (task === el || !is(task, 'bpmn:BusinessRuleTask')) continue;
      for (const [key] of reader.c7DecisionRefs(task)) {
        const prefix = key.slice(0, key.indexOf(':'));
        const uri = reader.uriOf(task, prefix);
        seen.set(uri ? `c7 ${uri}` : key, uri ? { kind: 'c7', uri, prefix } : undefined);
      }
      for (const call of reader.zeebeCalls(task)) {
        if (!textValue((call as unknown as Record<string, unknown>)['decisionId'])) {
          continue;
        }
        const prefix = call.$type.split(':')[0]!;
        const declared = ((call.$descriptor as { ns?: { uri?: string } }).ns?.uri ?? reader.uriOf(task, prefix)) === ZEEBE_URI;
        seen.set(declared ? 'zeebe' : call.$type, declared ? { kind: 'c8', prefix } : undefined);
      }
      for (const key of ['calledDecision', 'calledElement']) {
        if (textValue(task.$attrs?.[key])) seen.set(key, undefined);
      }
      if (seen.size > 1) return undefined;
    }
    return [...seen.values()][0];
  }
}
