/**
 * The decision link of a business rule task (ops/DecisionLinkReader.ts) as
 * `set` writes it.
 *
 * `set <id> calledDecision=<decision>` writes one spelling and removes the
 * others (an unprefixed calledElement too), so a task never carries two links:
 *  - Camunda 7 / 8 file: the engine's spelling. The unprefixed attribute is
 *    never written there: the engines validate the file against the BPMN
 *    schema and refuse it (W_C7_DEPLOY_SCHEMA), so `set` converts a
 *    hand-written unprefixed link into the engine's spelling.
 *  - a model without an engine (platform none): the file's spelling. A task
 *    whose link has an engine spelling keeps it (camunda:decisionRef /
 *    operaton:decisionRef updated in place, a zeebe:calledDecision gets the
 *    decisionId and keeps its resultVariable). A task without a link (a
 *    zeebe:calledDecision without a decisionId is none, as for the readers)
 *    takes the engine spelling of the file's other links when they all have
 *    the same one (with the file's prefix for its namespace). Otherwise, also
 *    on a task whose own link is unprefixed, it is the unprefixed
 *    calledDecision: without an engine there is no vendor namespace to write
 *    the link in, and bpmn-cli does not pick an engine for the file.
 *    bpmn-moddle reports the attribute as unknown and the engines refuse
 *    it; bpmn-cli reports no import warning for it there
 *    (reportedImportWarnings). Detection never gives platform none for a
 *    file with a link in an engine spelling (its namespace makes the file
 *    Camunda 7 / 8), so keeping and following an engine spelling happen
 *    only with an explicit platform none (the library's `platform: 'none'`);
 *    the CLI's `set` converts as for Camunda 7 / 8.
 * An empty value removes the link in every spelling (a Camunda 8 task loses
 * its zeebe:calledDecision with its resultVariable).
 */
import type { Doc } from '../model/Doc.js';
import { modelError } from '../shared/utils/errors.js';
import { kindLabel } from '../model/utils/kinds.js';
import { addTo, is, many, removeFrom, walk, type El } from '../model/utils/moddle.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import { coversProfileSubjects } from './utils/covers.js';
import { textValue } from './utils/text-value.js';
import { DecisionLinkReader } from './DecisionLinkReader.js';
import { CAMUNDA_URI, OPERATON_URI } from '../platform/CamundaDescriptor.js';
import { ZEEBE_URI } from '../platform/ZeebeDescriptor.js';

/** An engine spelling of a decision link a new link can follow: a decisionRef attribute of a Camunda 7 namespace, or the zeebe:calledDecision element. */
type EngineSpelling = { kind: 'c7'; uri: string; prefix: string } | { kind: 'zeebe'; prefix: string };

export class DecisionLinkWriter {
  private readonly reader: DecisionLinkReader;

  constructor(private readonly doc: Doc) {
    this.reader = new DecisionLinkReader(doc);
  }

  /**
   * Sets (or with an empty value removes) the decision link of a business rule
   * task in the spelling of the file's platform, in a model without an engine
   * in the file's own spelling (see the module header); the other spellings
   * are removed and named in the change.
   */
  write(el: El, value: string, cs: ChangeSet): string {
    const doc = this.doc;
    if (!is(el, 'bpmn:BusinessRuleTask')) {
      throw modelError('E_UNKNOWN_KEY', `Unknown key "calledDecision" for ${kindLabel(el)} ${this.idOf(el)} (the decision link of a business rule task)`, {
        element: this.idOf(el),
        hint: `Only a businessRuleTask calls a decision: \`bpmn retype <file> ${this.idOf(el)} businessRuleTask\` first. An unprefixed calledDecision="..." attribute on another element is removed with \`bpmn set <file> ${this.idOf(el)} calledDecision=\`.`,
      });
    }
    const platform = doc.platform();
    // the task's own link before calledElement goes (a task with one has a link: it is not given the file's spelling)
    const ownLink = this.reader.linkOf(el);
    const removed: string[] = [];
    const dropAttr = (key: string): void => {
      if (el.$attrs && Object.prototype.hasOwnProperty.call(el.$attrs, key)) {
        delete el.$attrs[key];
        removed.push(key);
      }
    };
    const dropC7 = (keep?: string): void => {
      for (const [key] of this.reader.c7DecisionRefs(el)) if (key !== keep) dropAttr(key);
    };
    const dropZeebe = (keep?: El): void => {
      const container = el.get<El | undefined>('extensionElements');
      let dropped = false;
      for (const call of this.reader.zeebeCalls(el)) {
        if (call === keep || !container) continue;
        removeFrom(container, 'values', call);
        removed.push(call.$type);
        dropped = true;
      }
      // a container this emptied goes too (an empty one the file had stays)
      if (dropped && container && !many(container, 'values').length) el.set('extensionElements', undefined);
    };
    let written = '';
    /** the decisionRef attribute `key` (a Camunda 7 namespace) */
    const writeC7 = (key: string): void => {
      dropAttr('calledDecision');
      dropC7(key);
      dropZeebe();
      el.$attrs[key] = value;
      written = key;
    };
    /** the decisionId of `own` (a zeebe:calledDecision of the task; its resultVariable stays), else of a new one with the file's zeebe prefix (else `usual`) */
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
    // the unprefixed calledElement is a hand-written decision link too: a new link replaces it
    dropAttr('calledElement');
    if (!value) {
      dropAttr('calledDecision');
      dropC7();
      dropZeebe();
    } else if (platform === 'camunda7') {
      // Operaton reads its own namespace first: an Operaton-only file gets operaton:decisionRef
      const operatonOnly = !doc.prefixFor(CAMUNDA_URI) && !!doc.prefixFor(OPERATON_URI);
      const prefix = operatonOnly ? this.prefixFor(OPERATON_URI, 'operaton') : this.prefixFor(CAMUNDA_URI, 'camunda');
      writeC7(`${prefix}:decisionRef`);
    } else if (platform === 'camunda8') {
      const call = writeZeebe(this.reader.zeebeCalls(el)[0], 'zeebe');
      if (!textValue((call as unknown as Record<string, unknown>)['resultVariable'])) {
        // the Camunda 8 profile reports the same (W_C8_DEPLOY_IMPLEMENTATION) when it runs: then a write shows that one
        cs.warn(
          coversProfileSubjects(
            {
              code: 'W_DECISION_RESULT_VARIABLE',
              message: `${this.idOf(el)} calls decision ${value} without a resultVariable; Camunda 8 requires one to deploy`,
              element: this.idOf(el),
              hint: `Name the variable that receives the result: \`bpmn ext add <file> ${this.idOf(el)} ${call.$type} decisionId=${value} resultVariable=<variable> --replace\`.`,
            },
            ['decision:resultVariable'],
          ),
        );
      }
    } else {
      // a model without an engine: the task's own engine spelling, else the one engine spelling of the file's other links, else
      // bpmn-cli's unprefixed calledDecision; no engine reads the file, so a zeebe link without resultVariable is no warning here.
      // The own link is the one linkOf reads: a decisionRef, else a zeebe:calledDecision with a decisionId (one without
      // a decisionId is no link: the task follows the file, and that element goes unless the file's spelling is zeebe)
      const ownC7 = this.reader.c7DecisionRefs(el)[0]?.[0];
      const ownCall = ownC7 ? undefined : this.reader.zeebeCalls(el).find((call) => textValue((call as unknown as Record<string, unknown>)['decisionId']));
      const follow = ownLink ? undefined : this.fileEngineSpelling(el);
      if (ownC7) writeC7(ownC7);
      else if (ownCall) writeZeebe(ownCall, 'zeebe');
      else if (follow?.kind === 'c7') writeC7(`${this.prefixFor(follow.uri, follow.prefix)}:decisionRef`);
      else if (follow?.kind === 'zeebe') writeZeebe(this.reader.zeebeCalls(el)[0], follow.prefix);
      else {
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

  /** The prefix a new attribute / element of `uri` gets: the file's own, else the usual one (declared on bpmn:definitions). */
  private prefixFor(uri: string, usual: string): string {
    const prefix = this.doc.prefixFor(uri) ?? usual;
    this.doc.declareNamespace(prefix, uri);
    return prefix;
  }

  /**
   * The engine spelling every decision link of the file's other business rule
   * tasks has, when they have one and the same (undefined without links, with
   * two spellings, an unprefixed one among them, or a prefix no namespace is
   * declared for).
   */
  private fileEngineSpelling(el: El): EngineSpelling | undefined {
    const seen = new Map<string, EngineSpelling | undefined>();
    for (const task of walk(this.doc.definitions, { bpmnOnly: true })) {
      if (task === el || !is(task, 'bpmn:BusinessRuleTask')) continue;
      for (const [key] of this.reader.c7DecisionRefs(task)) {
        const prefix = key.slice(0, key.indexOf(':'));
        const uri = this.reader.uriOf(task, prefix);
        seen.set(uri ? `c7 ${uri}` : key, uri ? { kind: 'c7', uri, prefix } : undefined);
      }
      for (const call of this.reader.zeebeCalls(task)) {
        if (!textValue((call as unknown as Record<string, unknown>)['decisionId'])) continue;
        const prefix = call.$type.split(':')[0]!;
        const declared = ((call.$descriptor as { ns?: { uri?: string } }).ns?.uri ?? this.reader.uriOf(task, prefix)) === ZEEBE_URI;
        seen.set(declared ? 'zeebe' : call.$type, declared ? { kind: 'zeebe', prefix } : undefined);
      }
      for (const key of ['calledDecision', 'calledElement']) if (textValue(task.$attrs?.[key])) seen.set(key, undefined);
      if (seen.size > 1) return undefined;
    }
    return [...seen.values()][0];
  }

  private idOf(el: El): string {
    return el.get<string | undefined>('id') ?? '?';
  }
}
