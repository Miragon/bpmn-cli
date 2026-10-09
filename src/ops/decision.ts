/**
 * The decision link of a business rule task: which DMN decision it calls.
 * BPMN 2.0 has no attribute for it, so each platform has its own spelling;
 * `set <id> calledDecision=<decision>` writes the one of the file's platform
 * and `show` / `find` read all of them (the order is the one design-iq's
 * reader follows, `decisionRefOf` in @bpmiq/notations):
 *
 *   camunda:decisionRef="x"                          Camunda 7 (operaton:decisionRef in an Operaton file)
 *   <zeebe:calledDecision decisionId="x" .../>       Camunda 8 (an extension element; keeps its resultVariable)
 *   calledDecision="x"                               design models (no engine namespace; design-iq hard rule 5)
 *   calledElement="x"                                hand-written models (read, never written)
 *
 * Writing removes the other spellings (an unprefixed calledElement too), so a
 * task never carries two links.
 * In a Camunda 7 or Camunda 8 file the unprefixed attribute is never written:
 * the engines validate the file against the BPMN schema and refuse it
 * (W_C7_DEPLOY_SCHEMA), so `set <id> calledDecision=<d>` there converts a
 * hand-written unprefixed link into the engine's spelling. An empty value
 * removes the link in every spelling (a Camunda 8 task loses its
 * zeebe:calledDecision with its resultVariable).
 */
import type { ImportWarning } from 'bpmn-moddle';
import type { Doc } from '../document.js';
import { modelError } from '../errors.js';
import { kindLabel } from '../kinds.js';
import { addTo, is, many, removeFrom, type El } from '../model.js';
import { C7_URIS, CAMUNDA_URI, OPERATON_URI, ZEEBE_URI } from '../platform/descriptor.js';
import type { ChangeSet } from '../result.js';

export interface DecisionLink {
  /** the decision id (design-iq: the file stem of the .dmn) */
  value: string;
  /** where it is written: the attribute name (`camunda:decisionRef`, `calledDecision`, `calledElement`) or `zeebe:calledDecision` (extension element) */
  spelling: string;
}

function idOf(el: El): string {
  return el.get<string | undefined>('id') ?? '?';
}

function text(v: unknown): string | undefined {
  if (v === undefined || v === null || typeof v === 'object') return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

/** prefix -> namespace URI declared on bpmn:definitions or on the element's ancestors. */
function uriOf(doc: Doc | undefined, el: El, prefix: string): string | undefined {
  for (let p: El | undefined = el; p; p = p.$parent as El | undefined) {
    const v = (p.$attrs as Record<string, unknown> | undefined)?.[`xmlns:${prefix}`];
    if (typeof v === 'string') return v;
  }
  return doc?.namespaceUri(prefix);
}

/** The decisionRef attributes (any prefix bound to a Camunda 7 namespace, camunda first) of the task: [attribute name, value]. */
function c7DecisionRefs(doc: Doc | undefined, el: El): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(el.$attrs ?? {})) {
    const i = k.indexOf(':');
    if (i <= 0 || k.slice(i + 1) !== 'decisionRef') continue;
    const uri = uriOf(doc, el, k.slice(0, i));
    const value = text(v);
    if (value && (!uri || C7_URIS.has(uri))) out.push([k, value]);
  }
  return out.sort((a, b) => Number(uriOf(doc, el, a[0].split(':')[0]!) === OPERATON_URI) - Number(uriOf(doc, el, b[0].split(':')[0]!) === OPERATON_URI));
}

/** The zeebe:calledDecision extension elements of the task. */
function zeebeCalls(doc: Doc | undefined, el: El): El[] {
  // read without creating the lazy collection (views and profiles read the live document)
  const values = (el.get<El | undefined>('extensionElements') as unknown as { values?: El[] } | undefined)?.values;
  if (!Array.isArray(values)) return [];
  return values.filter((v) => {
    const [prefix, local] = v.$type.split(':');
    if (local !== 'calledDecision' || !prefix) return false;
    const uri = (v.$descriptor as { ns?: { uri?: string } }).ns?.uri ?? uriOf(doc, el, prefix);
    return !uri || uri === ZEEBE_URI;
  });
}

/** The decision link of a business rule task in any spelling (undefined for other elements or without one). */
export function decisionLinkOf(el: El, doc?: Doc): DecisionLink | undefined {
  if (!is(el, 'bpmn:BusinessRuleTask')) return undefined;
  const c7 = c7DecisionRefs(doc, el)[0];
  if (c7) return { value: c7[1], spelling: c7[0] };
  for (const call of zeebeCalls(doc, el)) {
    const value = text((call as unknown as Record<string, unknown>)['decisionId']);
    if (value) return { value, spelling: call.$type };
  }
  for (const key of ['calledDecision', 'calledElement']) {
    const value = text(el.$attrs?.[key]);
    if (value) return { value, spelling: key };
  }
  return undefined;
}

/** The prefix a new attribute / element of `uri` gets: the file's own, else the usual one (declared on bpmn:definitions). */
function prefixFor(doc: Doc, uri: string, usual: string): string {
  const prefix = doc.prefixFor(uri) ?? usual;
  doc.declareNamespace(prefix, uri);
  return prefix;
}

/**
 * Sets (or with an empty value removes) the decision link of a business rule
 * task in the spelling of the file's platform (see the module header); the
 * other spellings are removed and named in the change.
 */
export function setDecisionLink(doc: Doc, el: El, value: string, cs: ChangeSet): string {
  if (!is(el, 'bpmn:BusinessRuleTask')) {
    throw modelError('E_UNKNOWN_KEY', `Unknown key "calledDecision" for ${kindLabel(el)} ${idOf(el)} (the decision link of a business rule task)`, {
      element: idOf(el),
      hint: `Only a businessRuleTask calls a decision: \`bpmn retype <file> ${idOf(el)} businessRuleTask\` first. An unprefixed calledDecision="..." attribute on another element is removed with \`bpmn set <file> ${idOf(el)} calledDecision=\`.`,
    });
  }
  const platform = doc.platform();
  const removed: string[] = [];
  const dropAttr = (key: string): void => {
    if (el.$attrs && Object.prototype.hasOwnProperty.call(el.$attrs, key)) {
      delete el.$attrs[key];
      removed.push(key);
    }
  };
  const dropC7 = (keep?: string): void => {
    for (const [key] of c7DecisionRefs(doc, el)) if (key !== keep) dropAttr(key);
  };
  const dropZeebe = (keep?: El): void => {
    const container = el.get<El | undefined>('extensionElements');
    let dropped = false;
    for (const call of zeebeCalls(doc, el)) {
      if (call === keep || !container) continue;
      removeFrom(container, 'values', call);
      removed.push(call.$type);
      dropped = true;
    }
    // a container this emptied goes too (an empty one the file had stays)
    if (dropped && container && !many(container, 'values').length) el.set('extensionElements', undefined);
  };
  let written = '';
  // the unprefixed calledElement is a hand-written decision link too (design-iq reads it): a new link replaces it
  dropAttr('calledElement');
  if (!value) {
    dropAttr('calledDecision');
    dropC7();
    dropZeebe();
  } else if (platform === 'camunda7') {
    // Operaton reads its own namespace first: an Operaton-only file gets operaton:decisionRef
    const operatonOnly = !doc.prefixFor(CAMUNDA_URI) && !!doc.prefixFor(OPERATON_URI);
    const prefix = operatonOnly ? prefixFor(doc, OPERATON_URI, 'operaton') : prefixFor(doc, CAMUNDA_URI, 'camunda');
    dropAttr('calledDecision');
    dropC7(`${prefix}:decisionRef`);
    dropZeebe();
    el.$attrs[`${prefix}:decisionRef`] = value;
    written = `${prefix}:decisionRef`;
  } else if (platform === 'camunda8') {
    dropAttr('calledDecision');
    dropC7();
    let call = zeebeCalls(doc, el)[0];
    if (!call) {
      const prefix = prefixFor(doc, ZEEBE_URI, 'zeebe');
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
    if (!text((call as unknown as Record<string, unknown>)['resultVariable'])) {
      cs.warn({
        code: 'W_DECISION_RESULT_VARIABLE',
        message: `${idOf(el)} calls decision ${value} without a resultVariable; Camunda 8 requires one to deploy`,
        element: idOf(el),
        hint: `Name the variable that receives the result: \`bpmn ext add <file> ${idOf(el)} ${call.$type} decisionId=${value} resultVariable=<variable> --replace\`.`,
      });
    }
  } else {
    // a design model (no engine namespace): design-iq's spelling
    dropC7();
    dropZeebe();
    el.$attrs['calledDecision'] = value;
    written = 'calledDecision';
  }
  const parts = [value ? `calledDecision=${value} (${written})` : 'calledDecision removed'];
  if (removed.length) parts.push(`removed ${[...new Set(removed)].join(', ')}`);
  return parts.join('; ');
}

/**
 * The import warnings worth reporting: in a design model (no engine
 * platform) an unprefixed calledDecision on a business rule task is
 * design-iq's decision link, not content the reader does not know. In a
 * Camunda 7 / 8 file it stays a warning (the engines refuse it).
 */
export function reportedImportWarnings(doc: Doc): ImportWarning[] {
  const designLink = (w: ImportWarning): boolean => w.property === 'calledDecision' && is(w.element, 'bpmn:BusinessRuleTask');
  if (!doc.importWarnings.some(designLink) || doc.platform() !== undefined) return doc.importWarnings;
  return doc.importWarnings.filter((w) => !designLink(w));
}
