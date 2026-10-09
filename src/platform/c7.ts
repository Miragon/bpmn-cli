/**
 * The Camunda 7 validation profile (also CIB seven and Operaton, which read
 * the camunda namespace). It checks what the engines check when a file is
 * deployed, plus vendor content they silently ignore. Every rule was taken
 * from a deployment against Camunda 7.24, CIB seven 2.2 and Operaton 2.1.5
 * (all three gave the same answer) or from the camunda-bpmn-moddle descriptor
 * (platform/descriptor.ts, read as data; it is never registered with the
 * model, so camunda content stays generic: `el.$attrs['camunda:assignee']`,
 * generic `camunda:inputOutput` elements).
 *
 * Scope: the content of executable processes (isExecutable="true"; the
 * engines skip every other process) plus file-level content (definitions,
 * root elements such as bpmn:Error and bpmn:Signal, the collaboration).
 *
 * Codes, severity deploy (the engines refuse the deployment):
 *   W_C7_DEPLOY_HISTORY_TTL        executable process without (or with an unparsable) camunda:historyTimeToLive
 *   W_C7_DEPLOY_IMPLEMENTATION     service/send/business rule task (or message throw/end event) without
 *                                  class/delegateExpression/expression/type=external/connector (decisionRef for
 *                                  business rule tasks), or camunda:type other than "external"
 *   W_C7_DEPLOY_EXTERNAL_TOPIC     camunda:type="external" without camunda:topic
 *   W_C7_DEPLOY_RESULT_VARIABLE    camunda:resultVariable together with camunda:class or camunda:delegateExpression
 *   W_C7_DEPLOY_CALLED_ELEMENT     call activity without calledElement / camunda:caseRef, or with both
 *   W_C7_DEPLOY_BINDING_VERSION    *Binding="version"/"versionTag" without the matching *Version/*VersionTag
 *   W_C7_DEPLOY_FORM               camunda:formRef without a valid camunda:formRefBinding, or formKey and formRef together
 *   W_C7_DEPLOY_BAD_VALUE          mapDecisionResult not one of the four mappers; jobPriority / taskPriority not a number
 *   W_C7_DEPLOY_MULTI_INSTANCE     multi-instance without loopCardinality / camunda:collection, empty cardinality,
 *                                  camunda:elementVariable without a collection
 *   W_C7_DEPLOY_DUPLICATE_EXTENSION a second camunda:inputOutput / connector / connectorId / formData /
 *                                  failedJobRetryTimeCycle (on an element the engine reads it from)
 *   W_C7_DEPLOY_INPUT_OUTPUT       camunda:inputOutput on a start or boundary event, a gateway or an event
 *                                  sub-process; output parameters on an end event or a multi-instance activity
 *   W_C7_DEPLOY_LISTENER           execution/task listener without event or implementation, an event the engine
 *                                  does not know, a script without scriptFormat, a timeout listener without timer
 *   W_C7_DEPLOY_EXTENSION          camunda:in/out without source+target (or variables / businessKey), input/output
 *                                  parameter without name, form field without id or with a type other than
 *                                  string/long/boolean/date/enum, connector without connectorId
 *   W_C7_DEPLOY_EVENT_GATEWAY      event-based gateway branch that is not a message/timer/signal/conditional
 *                                  intermediate catch event, has other incoming flows, or repeats a message/signal
 *   W_C7_DEPLOY_MESSAGE            catching message event without messageRef or with a nameless message; two
 *                                  subscriptions to one message name in the same scope
 *   W_C7_DEPLOY_SIGNAL             signal event without signalRef or with a nameless signal; duplicate signal names
 *   W_C7_DEPLOY_ERROR              error end event without errorRef or whose bpmn:Error has no errorCode
 *   W_C7_DEPLOY_ESCALATION         escalation throw without escalationRef / escalationCode; escalation boundary
 *                                  event on something else than a sub-process, call activity or user task
 *   W_C7_DEPLOY_EVENT_DEFINITION   timer without date/cycle/duration, conditional event without condition
 *   W_C7_DEPLOY_BOUNDARY_HOST      boundary event attached to a compensation handler (isForCompensation="true")
 *   W_C7_DEPLOY_SCRIPT             script task without script and without camunda:resource
 *   W_C7_DEPLOY_EXCLUSIVE_GATEWAY  exclusive gateway without outgoing flow, a single conditional flow, a conditional
 *                                  default flow, or flows without condition next to a default (or more than one)
 *   W_C7_DEPLOY_DEFINITIONS_EXTENSION bpmn:extensionElements directly under bpmn:definitions (XSD-invalid)
 * severity runtime (deploys, but is ignored or fails when the process runs):
 *   W_C7_UNKNOWN_ATTRIBUTE         camunda attribute the descriptor does not know (did you mean ...)
 *   W_C7_MISPLACED_ATTRIBUTE       camunda attribute on an element type that does not read it
 *   W_C7_UNKNOWN_ELEMENT           camunda extension element type the descriptor does not know
 *   W_C7_MISPLACED_EXTENSION       camunda extension element on a host (or in a container) that does not read it
 *   W_C7_FOREIGN_CONTENT           zeebe:* attributes or elements in a Camunda 7 file
 *   W_C7_BAD_VALUE                 boolean not true/false, unknown binding, bad variableEvents, empty topic or
 *                                  calledElement, non-numeric task priority
 *   W_C7_MESSAGE_NO_IMPLEMENTATION message throw/end event without implementation (behaves like a none event)
 *   W_C7_DANGLING_REF              id reference inside camunda content (camunda:errorEventDefinition errorRef) to
 *                                  an element that does not exist
 * severity practice:
 *   W_C7_EXCLUSIVE_GATEWAY_DEFAULT exclusive gateway with exactly one flow without condition and no default flow
 *                                  (the engine warns and takes it as the default)
 *   W_C7_DUPLICATE_EXTENSION       a second camunda:failedJobRetryTimeCycle where it is not read yet (not async)
 *
 * Hints name `bpmn set` / `bpmn ext` command lines; attributes of nested
 * elements are addressed with the `definition.` / `loop.` / `condition.`
 * key prefixes of `bpmn set`.
 */
import type { Doc } from '../document.js';
import { kindLabel } from '../kinds.js';
import { createModdle, is, isBpmnElement, isDiElement, walk, type El } from '../model.js';
import { camundaAttr, camundaAttrs, camundaType, containersOf, idReferenceAttrs, ZEEBE_URI, CAMUNDA_URI, type CamundaElementType } from './descriptor.js';
import { C7_URIS, namespaceMap, uriOfElement, uriOfName } from './detect.js';
import { makeFinding, type ProfileFinding, type Severity } from './finding.js';

interface Ctx {
  doc: Doc;
  ns: Map<string, string>;
  /** prefix of the camunda namespace in this file (for hints) */
  p: string;
  out: ProfileFinding[];
  errors: Map<string, El>;
  /** sequence flows by source / target, from sourceRef/targetRef (the incoming/outgoing mirror lists are optional) */
  outgoing: Map<El, El[]>;
  incoming: Map<El, El[]>;
}

/* ------------------------------------------------------------------ */
/* small helpers                                                        */
/* ------------------------------------------------------------------ */

function peek<T>(el: El | undefined, prop: string): T | undefined {
  return el ? ((el as unknown as Record<string, unknown>)[prop] as T | undefined) : undefined;
}

function list(el: El | undefined, prop: string): El[] {
  const v = peek<unknown>(el, prop);
  return Array.isArray(v) ? (v as El[]) : [];
}

function idOf(el: El | undefined): string | undefined {
  const id = peek<string>(el, 'id');
  return typeof id === 'string' && id ? id : undefined;
}

function nonEmpty(v: string | undefined): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function isGeneric(el: El): boolean {
  return !!(el.$descriptor as { isGeneric?: boolean }).isGeneric;
}

function localName(type: string): string {
  return type.slice(type.indexOf(':') + 1);
}

function isExpression(v: string): boolean {
  return /[$#]\{/.test(v);
}

/** Quotes a shell argument when it contains characters the shell would interpret (a `<placeholder>` stays as it is, like in every hint). */
function sh(arg: string): string {
  return /^[A-Za-z0-9_.:=,/@+-]*(<[a-zA-Z]+>)?$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** `bpmn ext add` arguments that re-create a flat generic element (attributes and body), or undefined when it has children. */
function extAddArgs(v: El, type: string): string | undefined {
  const kids = peek<unknown[]>(v, '$children');
  if (Array.isArray(kids) && kids.length) return undefined;
  const attrs = Object.entries(v as unknown as Record<string, unknown>)
    .filter(([k]) => !k.startsWith('$') && !k.startsWith('xmlns'))
    .map(([k, val]) => sh(`${k}=${String(val)}`));
  const body = peek<string>(v, '$body');
  return [type, ...attrs, ...(body !== undefined ? ['--body', sh(String(body))] : [])].join(' ');
}

/** `userTask Activity_X`, `multiInstanceLoopCharacteristics of userTask Activity_X` */
function describe(el: El, owner: El | undefined): string {
  const id = idOf(el);
  const kind = isBpmnElement(el) ? kindLabel(el).replace(/^bpmn:/, '') : el.$type;
  const k = kind.charAt(0).toLowerCase() + kind.slice(1);
  if (id) return `${k} ${id}`;
  return owner ? `the ${k} of ${describe(owner, undefined)}` : k;
}

function isEventSubProcess(el: El): boolean {
  return is(el, 'bpmn:SubProcess') && peek<boolean>(el, 'triggeredByEvent') === true;
}

/** The `set` key prefix that addresses `el` through `owner` (`definition.`, `loop.`, `condition.`), or '' when `el` is the owner. */
function addressOf(el: El, owner: El | undefined): { id: string; prefix: string } | undefined {
  const id = idOf(el);
  if (!owner || el === owner) return id ? { id, prefix: '' } : undefined;
  const oid = idOf(owner);
  if (!oid) return undefined;
  if (list(owner, 'eventDefinitions').includes(el)) return { id: oid, prefix: 'definition.' };
  if (peek<El>(owner, 'loopCharacteristics') === el) return { id: oid, prefix: 'loop.' };
  if (peek<El>(owner, 'conditionExpression') === el) return { id: oid, prefix: 'condition.' };
  return id ? { id, prefix: '' } : undefined;
}

/** Levenshtein distance, case-insensitive. */
function distance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const row = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (s[i - 1] === t[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[t.length]!;
}

/** The closest candidate within a small edit distance, preferring `preferred`. */
function didYouMean(name: string, candidates: string[], preferred: string[] = []): string | undefined {
  const limit = Math.max(1, Math.floor(name.length / 4));
  let best: { c: string; d: number } | undefined;
  for (const c of [...preferred, ...candidates]) {
    const d = distance(name, c);
    if (d <= limit && (!best || d < best.d)) best = { c, d };
  }
  return best?.c;
}

/* ------------------------------------------------------------------ */
/* reading camunda content                                              */
/* ------------------------------------------------------------------ */

function uriOfAttr(ctx: Ctx, key: string): string | undefined {
  return uriOfName(key, ctx.ns);
}

/** Value of the camunda (or operaton) attribute `local` of a BPMN element. */
function c7(ctx: Ctx, el: El | undefined, local: string): string | undefined {
  if (!el) return undefined;
  for (const [k, v] of Object.entries(el.$attrs ?? {})) {
    if (k.slice(k.indexOf(':') + 1) !== local) continue;
    const uri = uriOfAttr(ctx, k);
    if (uri && C7_URIS.has(uri)) return v === undefined || v === null ? undefined : String(v);
  }
  return undefined;
}

/** The generic extension elements of a BPMN element, with their namespace. */
function extensionValues(ctx: Ctx, el: El): Array<{ el: El; uri: string | undefined; local: string; index: number }> {
  const ext = peek<El>(el, 'extensionElements');
  return list(ext, 'values').map((v, index) => ({ el: v, uri: isGeneric(v) ? uriOfElement(v, ctx.ns) : undefined, local: localName(v.$type), index }));
}

/** Top-level camunda extension elements of type `local`. */
function camundaExt(ctx: Ctx, el: El, local: string): El[] {
  return extensionValues(ctx, el)
    .filter((v) => v.uri && C7_URIS.has(v.uri) && v.local === local)
    .map((v) => v.el);
}

function children(ctx: Ctx, el: El, local?: string): El[] {
  const kids = peek<unknown[]>(el, '$children');
  if (!Array.isArray(kids)) return [];
  return (kids as El[]).filter((c) => {
    if (!c || typeof c !== 'object' || typeof c.$type !== 'string' || !isGeneric(c)) return false;
    const uri = uriOfElement(c, ctx.ns);
    return !!uri && C7_URIS.has(uri) && (local === undefined || localName(c.$type) === local);
  });
}

/** An attribute of a generic vendor element (plain name, e.g. `event`). */
function attr(el: El, name: string): string | undefined {
  const v = peek<unknown>(el, name);
  return v === undefined || v === null ? undefined : String(v);
}

function hasConnector(ctx: Ctx, ...hosts: Array<El | undefined>): boolean {
  return hosts.some((h) => !!h && camundaExt(ctx, h, 'connector').length > 0);
}

/* ------------------------------------------------------------------ */
/* findings                                                             */
/* ------------------------------------------------------------------ */

function push(ctx: Ctx, severity: Severity, code: string, element: El | undefined, owner: El | undefined, subject: string, message: string, hint: string, related: string[] = []): void {
  // a nested element (event definition, loop, condition) is reported on the flow node or flow that holds it
  const addr = element ? addressOf(element, owner) : undefined;
  const target = addr?.prefix ? addr.id : (idOf(element) ?? idOf(owner));
  ctx.out.push(makeFinding(severity, code, message, target, { hint, related, subject }));
}

/* ------------------------------------------------------------------ */
/* attributes                                                           */
/* ------------------------------------------------------------------ */

const BINDINGS = ['latest', 'deployment', 'version', 'versionTag'];
const CASE_BINDINGS = ['latest', 'deployment', 'version'];
const VARIABLE_EVENTS = ['create', 'update', 'delete'];

function kindsText(owners: string[]): string {
  const names = owners.map((o) => o.replace(/^bpmn:/, '')).map((n) => n.charAt(0).toLowerCase() + n.slice(1));
  return names.length > 4 ? `${names.slice(0, 4).join(', ')}, ...` : names.join(', ');
}

/** camunda / zeebe attributes of a BPMN element: unknown, misplaced, foreign, bad booleans. */
function checkAttributes(ctx: Ctx, el: El, owner: El | undefined): void {
  const addr = addressOf(el, owner);
  const where = describe(el, owner);
  for (const [key, raw] of Object.entries(el.$attrs ?? {})) {
    const uri = uriOfAttr(ctx, key);
    if (!uri) continue;
    const local = key.slice(key.indexOf(':') + 1);
    const value = raw === undefined || raw === null ? '' : String(raw);
    const unset = addr ? `\`bpmn set <file> ${addr.id} ${addr.prefix}${key}=\`` : 'edit the XML';
    if (uri === ZEEBE_URI) {
      push(ctx, 'runtime', 'W_C7_FOREIGN_CONTENT', el, owner, `attr:${key}`, `${where} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`, `Remove it: ${unset}, and use the camunda attribute instead (\`bpmn kinds\` lists them).`);
      continue;
    }
    if (!C7_URIS.has(uri)) continue;
    const def = camundaAttr(local);
    if (!def) {
      const applicable = camundaAttrs().filter((a) => a.owners.some((o) => is(el, o))).map((a) => localName(a.name));
      const guess = didYouMean(local, camundaAttrs().map((a) => localName(a.name)), applicable);
      const prefix = key.slice(0, key.indexOf(':'));
      const fits = !!guess && applicable.includes(guess);
      const elsewhere = guess && !fits ? ` It applies to ${kindsText(camundaAttr(guess)!.owners)} only.` : '';
      push(
        ctx,
        'runtime',
        'W_C7_UNKNOWN_ATTRIBUTE',
        el,
        owner,
        `attr:${key}`,
        `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${prefix}:${guess}?${elsewhere})` : ''}; the engines ignore it`,
        fits && addr ? `Rename it: \`bpmn set <file> ${addr.id} ${addr.prefix}${key}= ${sh(`${addr.prefix}${prefix}:${guess}=${value}`)}\`.` : `Remove it: ${unset}.`,
      );
      continue;
    }
    if (!def.owners.some((o) => is(el, o))) {
      push(ctx, 'runtime', 'W_C7_MISPLACED_ATTRIBUTE', el, owner, `attr:${key}`, `${key} on ${where} has no effect: the engines read it on ${kindsText(def.owners)} only`, misplacedHint(ctx, el, owner, key, local, value, def.owners));
      continue;
    }
    if (def.type === 'Boolean' && value !== 'true' && value !== 'false') {
      push(ctx, 'runtime', 'W_C7_BAD_VALUE', el, owner, `attr:${key}`, `${key}="${value}" on ${where} is not true or false; the engines read only the exact value true (yes, TRUE or True leave it off)`, addr ? `\`bpmn set <file> ${addr.id} ${addr.prefix}${key}=true\` (or =false).` : 'Use true or false.');
    }
  }
}

function misplacedHint(ctx: Ctx, el: El, owner: El | undefined, key: string, local: string, value: string, owners: string[]): string {
  const addr = addressOf(el, owner);
  const id = addr?.id;
  const move = (prefix: string): string => `\`bpmn set <file> ${id} ${addr!.prefix}${key}= ${sh(`${prefix}${ctx.p}:${local}=${value}`)}\``;
  if (id && addr!.prefix === '') {
    if (is(el, 'bpmn:Event') && owners.some((o) => list(el, 'eventDefinitions').some((d) => is(d, o)))) {
      return `It belongs on the event definition: ${move('definition.')}.`;
    }
    if (is(el, 'bpmn:Activity') && owners.includes('bpmn:MultiInstanceLoopCharacteristics')) {
      const mi = is(peek<El>(el, 'loopCharacteristics'), 'bpmn:MultiInstanceLoopCharacteristics');
      return `It belongs on the multi-instance loop: ${move('loop.')}${mi ? '' : ' (creates a parallel multi-instance loop)'}.`;
    }
    if (is(el, 'bpmn:SequenceFlow') && owners.includes('bpmn:FormalExpression') && peek<El>(el, 'conditionExpression')) {
      return `It belongs on the condition: ${move('condition.')}.`;
    }
  }
  return id ? `Remove it: \`bpmn set <file> ${id} ${addr!.prefix}${key}=\`.` : 'Remove it from the XML.';
}

/* ------------------------------------------------------------------ */
/* extension elements                                                   */
/* ------------------------------------------------------------------ */

/** Hosts the descriptor misses but the engines read (see the module header). */
const EXTRA_HOSTS: Record<string, string[]> = {
  potentialStarter: ['bpmn:Process'],
  errorEventDefinition: ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask', 'bpmn:MessageEventDefinition', 'bpmn:IntermediateThrowEvent', 'bpmn:EndEvent'],
};

function allowedTop(local: string, host: El): boolean {
  const t = camundaType(local);
  if (!t) return true;
  const hosts = [...t.allowedIn, ...(EXTRA_HOSTS[local] ?? [])];
  return hosts.some((a) => a === '*' || (a.startsWith('bpmn:') && is(host, a)));
}

let probe: ReturnType<typeof createModdle> | undefined;
const bpmnAttrNames = new Map<string, Set<string>>();

/** Attribute names a camunda element type takes: its own, its camunda super types' and its BPMN super type's. */
function attrNames(t: CamundaElementType): Set<string> {
  const names = new Set(t.properties.filter((p) => p.isAttr || p.isReference).map((p) => p.name));
  for (const sup of t.bpmnSuperTypes) {
    let known = bpmnAttrNames.get(sup);
    if (!known) {
      probe ??= createModdle();
      known = new Set<string>();
      try {
        const d = probe.getElementDescriptor(probe.getType(sup)) as { properties?: Array<{ name: string; isAttr?: boolean; isReference?: boolean; isMany?: boolean }> };
        for (const p of d.properties ?? []) if (p.isAttr || (p.isReference && !p.isMany)) known.add(p.name);
      } catch {
        /* unknown BPMN type: nothing to add */
      }
      bpmnAttrNames.set(sup, known);
    }
    for (const n of known) names.add(n);
  }
  return names;
}

/** Child element names a camunda element type takes as plain text properties (connectorId, expression, string). */
function textChildNames(t: CamundaElementType): Set<string> {
  return new Set(t.properties.filter((p) => !p.isAttr && !p.isBody && !p.type.includes(':')).map((p) => p.name));
}

function extHint(hostId: string | undefined, local: string, ctx: Ctx): string {
  return hostId
    ? `See it with \`bpmn ext list <file> ${hostId} --json\`, then rebuild it: \`bpmn ext add <file> ${hostId} ${ctx.p}:${local} --replace --xml '<${ctx.p}:${local}>...</${ctx.p}:${local}>'\`.`
    : 'Fix it in the XML.';
}

/** Attributes and children of a generic camunda element, recursively. */
function checkVendorElement(ctx: Ctx, v: El, host: El, owner: El | undefined, top: string, path: string): void {
  const local = localName(v.$type);
  const t = camundaType(local);
  if (!t) return;
  const hostId = idOf(host) ?? idOf(owner);
  const where = `${ctx.p}:${local}${path ? ` (in ${path})` : ''} of ${describe(host, owner)}`;
  const names = attrNames(t);
  for (const [k, raw] of Object.entries(v as unknown as Record<string, unknown>)) {
    if (k.startsWith('$') || k.startsWith('xmlns')) continue;
    if (k.includes(':')) {
      if (uriOfAttr(ctx, k) === ZEEBE_URI) push(ctx, 'runtime', 'W_C7_FOREIGN_CONTENT', host, owner, `ext:${path}/${local}@${k}`, `${where} carries the Camunda 8 attribute ${k}, which Camunda 7 ignores`, extHint(hostId, top, ctx));
      continue;
    }
    if (!names.has(k)) {
      const guess = didYouMean(k, [...names]);
      push(ctx, 'runtime', 'W_C7_UNKNOWN_ATTRIBUTE', host, owner, `ext:${path}/${local}@${k}`, `${where} has the unknown attribute ${k}${guess ? ` (did you mean ${guess}?)` : ''}; the engines ignore it`, extHint(hostId, top, ctx));
      continue;
    }
    const prop = t.properties.find((p) => p.name === k);
    if (prop?.type === 'Boolean' && raw !== 'true' && raw !== 'false' && raw !== true && raw !== false) {
      push(ctx, 'runtime', 'W_C7_BAD_VALUE', host, owner, `ext:${path}/${local}@${k}`, `${k}="${String(raw)}" on ${where} is not true or false; the engines read only the exact value true`, extHint(hostId, top, ctx));
    }
  }
  const texts = textChildNames(t);
  const kids = peek<unknown[]>(v, '$children');
  for (const c of Array.isArray(kids) ? (kids as El[]) : []) {
    if (!c || typeof c.$type !== 'string' || !isGeneric(c)) continue;
    const uri = uriOfElement(c, ctx.ns);
    const cl = localName(c.$type);
    if (uri === ZEEBE_URI) {
      push(ctx, 'runtime', 'W_C7_FOREIGN_CONTENT', host, owner, `ext:${path}/${local}/${cl}`, `${where} contains the Camunda 8 element ${c.$type}, which Camunda 7 ignores`, extHint(hostId, top, ctx));
      continue;
    }
    if (!uri || !C7_URIS.has(uri)) continue;
    const childPath = path ? `${path} > ${ctx.p}:${local}` : `${ctx.p}:${local}`;
    if (texts.has(cl)) continue;
    const ct = camundaType(cl);
    if (!ct) {
      const guess = didYouMean(cl, [...texts, ...t.properties.filter((p) => p.type.startsWith('camunda:')).map((p) => localName(p.type).replace(/^./, (s) => s.toLowerCase()))]);
      push(ctx, 'runtime', 'W_C7_UNKNOWN_ELEMENT', host, owner, `ext:${childPath}/${cl}`, `${where} contains the unknown element ${ctx.p}:${cl}${guess ? ` (did you mean ${ctx.p}:${guess}?)` : ''}; the engines ignore it`, extHint(hostId, top, ctx));
      continue;
    }
    if (!containersOf(cl).includes(t.name)) {
      push(ctx, 'runtime', 'W_C7_MISPLACED_EXTENSION', host, owner, `ext:${childPath}/${cl}`, `${ctx.p}:${cl} does not belong inside ${ctx.p}:${local} (${where}); the engines ignore it`, extHint(hostId, top, ctx));
      continue;
    }
    checkVendorElement(ctx, c, host, owner, top, childPath);
  }
}

function isAsync(ctx: Ctx, el: El): boolean {
  return ['async', 'asyncBefore', 'asyncAfter'].some((a) => c7(ctx, el, a) === 'true');
}

function hasTimer(el: El): boolean {
  return list(el, 'eventDefinitions').some((d) => is(d, 'bpmn:TimerEventDefinition'));
}

/** Extension elements of one BPMN element: unknown/misplaced types, duplicates, foreign content and the engine rules on their content. */
function checkExtensions(ctx: Ctx, host: El, owner: El | undefined, executable: boolean): void {
  const values = extensionValues(ctx, host);
  if (!values.length) return;
  const hostId = idOf(host) ?? idOf(owner);
  const where = describe(host, owner);
  if (is(host, 'bpmn:Definitions')) {
    const types = values.map((v) => v.el.$type).join(', ');
    push(ctx, 'deploy', 'W_C7_DEPLOY_DEFINITIONS_EXTENSION', host, undefined, 'definitions', `bpmn:definitions carries bpmn:extensionElements (${types}), which the BPMN schema does not allow there; the engines refuse the file`, `Move the content to the process: \`bpmn ext remove <file> ${hostId ?? '<definitionsId>'} <type>\`, then \`bpmn ext add <file> <processId> <type> ...\`.`);
    return;
  }
  const byType = new Map<string, El[]>();
  for (const v of values) {
    if (!v.uri) continue;
    if (v.uri === ZEEBE_URI) {
      push(ctx, 'runtime', 'W_C7_FOREIGN_CONTENT', host, owner, `ext:${v.el.$type}`, `${where} contains the Camunda 8 extension ${v.el.$type}, which Camunda 7 ignores`, hostId ? `Remove it: \`bpmn ext remove <file> ${hostId} ${v.el.$type}\`.` : 'Remove it from the XML.');
      continue;
    }
    if (!C7_URIS.has(v.uri)) continue;
    const t = camundaType(v.local);
    if (!t) {
      const guess = didYouMean(v.local, typeNames());
      push(ctx, 'runtime', 'W_C7_UNKNOWN_ELEMENT', host, owner, `ext:${v.local}`, `${where} has the unknown extension element ${ctx.p}:${v.local}${guess ? ` (did you mean ${ctx.p}:${guess}?)` : ''}; the engines ignore it`, hostId ? `Remove it (\`bpmn ext remove <file> ${hostId} ${v.index}\`) and add the right one with \`bpmn ext add <file> ${hostId} ${ctx.p}:${guess ?? '<type>'} ...\`.` : 'Fix it in the XML.');
      continue;
    }
    byType.set(v.local, [...(byType.get(v.local) ?? []), v.el]);
    if (!allowedTop(v.local, host)) {
      const containers = t.allowedIn.length ? [] : containersOf(v.local);
      const message = containers.length
        ? `${ctx.p}:${v.local} sits directly in the extension elements of ${where}, but belongs inside ${containers.map((c) => c.replace(/^camunda:/, `${ctx.p}:`)).join(' / ')}; the engines ignore it`
        : `${ctx.p}:${v.local} on ${where} has no effect: the engines read it on ${kindsText([...t.allowedIn, ...(EXTRA_HOSTS[v.local] ?? [])])} only`;
      const again = extAddArgs(v.el, `${ctx.p}:${v.local}`);
      const hint = !hostId
        ? 'Fix it in the XML.'
        : containers.length
          ? `Remove it (\`bpmn ext remove <file> ${hostId} ${v.index}\`) and add it again, \`bpmn ext add\` files it into its container: ${again ? `\`bpmn ext add <file> ${hostId} ${again}\`` : `\`bpmn ext add <file> ${hostId} ${ctx.p}:${v.local} --xml '...'\``}.`
          : `Remove it: \`bpmn ext remove <file> ${hostId} ${v.index}\`.`;
      push(ctx, 'runtime', 'W_C7_MISPLACED_EXTENSION', host, owner, `ext:${v.local}`, message, hint);
      continue;
    }
    checkVendorElement(ctx, v.el, host, owner, v.local, '');
    if (executable) checkExtensionRules(ctx, host, owner, v.el, v.local);
  }
  if (!executable) return;
  // duplicates of the containers the engines read with a single-element lookup
  for (const [local, els] of byType) {
    if (els.length < 2) continue;
    let read = false;
    if (local === 'inputOutput') read = is(host, 'bpmn:FlowNode');
    else if (local === 'connector') read = SERVICE_LIKE.some((t) => is(host, t));
    else if (local === 'formData') read = is(host, 'bpmn:UserTask') || is(host, 'bpmn:StartEvent');
    else if (local === 'failedJobRetryTimeCycle') read = isAsync(ctx, host) || hasTimer(host);
    else continue;
    if (!read && local !== 'failedJobRetryTimeCycle') continue;
    const merge = hostId ? `Merge them into one: \`bpmn ext list <file> ${hostId} --json\`, then \`bpmn ext add <file> ${hostId} ${ctx.p}:${local} --replace --xml '<${ctx.p}:${local}>...</${ctx.p}:${local}>'\`.` : 'Merge them in the XML.';
    if (read) {
      push(ctx, 'deploy', 'W_C7_DEPLOY_DUPLICATE_EXTENSION', host, owner, `dup:${local}`, `${where} has ${els.length} ${ctx.p}:${local} elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name ${local})`, merge);
    } else {
      push(ctx, 'practice', 'W_C7_DUPLICATE_EXTENSION', host, owner, `dup:${local}`, `${where} has ${els.length} ${ctx.p}:${local} elements; once it runs asynchronously the engines refuse the file`, merge);
    }
  }
  checkInputOutputHost(ctx, host, owner, byType.get('inputOutput') ?? []);
}

let typeNameCache: string[] | undefined;
function typeNames(): string[] {
  if (typeNameCache) return typeNameCache;
  const names = new Set<string>();
  for (const a of ['inputOutput', 'inputParameter', 'outputParameter', 'in', 'out', 'field', 'connector', 'properties', 'property', 'formData', 'formField', 'formProperty', 'taskListener', 'executionListener', 'failedJobRetryTimeCycle', 'errorEventDefinition', 'potentialStarter', 'list', 'map', 'entry', 'value', 'script', 'validation', 'constraint']) {
    if (camundaType(a)) names.add(a);
  }
  typeNameCache = [...names];
  return typeNameCache;
}

const EXECUTION_EVENTS = ['start', 'end'];
/** the form field types every engine knows (more only through a custom form type plugin) */
const FORM_TYPES = ['string', 'long', 'boolean', 'date', 'enum'];
const TASK_EVENTS = ['create', 'assignment', 'complete', 'update', 'delete', 'timeout'];

/** Engine rules on the content of one (allowed, top-level) camunda extension element. */
function checkExtensionRules(ctx: Ctx, host: El, owner: El | undefined, v: El, local: string): void {
  const hostId = idOf(host) ?? idOf(owner);
  const where = describe(host, owner);
  const rebuild = extHint(hostId, local, ctx);
  if (local === 'executionListener' || local === 'taskListener') {
    if (local === 'taskListener' && !is(host, 'bpmn:UserTask')) return;
    const impl = ['class', 'expression', 'delegateExpression'].some((a) => nonEmpty(attr(v, a))) || children(ctx, v, 'script').length > 0;
    const event = attr(v, 'event');
    const label = `${ctx.p}:${local}${event ? ` (event ${event})` : ''} of ${where}`;
    if (!impl) push(ctx, 'deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:${event}:impl`, `${label} has no class, expression, delegateExpression or script; the engines refuse the file`, rebuild);
    if (!is(host, 'bpmn:SequenceFlow')) {
      const allowed = local === 'taskListener' ? TASK_EVENTS : EXECUTION_EVENTS;
      if (event === undefined) push(ctx, 'deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:event`, `${label} has no event; the engines refuse the file`, `Set event to one of ${allowed.join(', ')}. ${rebuild}`);
      else if (!allowed.includes(event)) push(ctx, 'deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:${event}:event`, `${label}: event "${event}" is not one of ${allowed.join(', ')}; the engines refuse the file`, `${local === 'executionListener' ? 'take is only read on sequence flows. ' : ''}${rebuild}`);
    }
    for (const s of children(ctx, v, 'script')) {
      if (!nonEmpty(attr(s, 'scriptFormat'))) push(ctx, 'deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:${event}:script`, `The script of ${label} has no scriptFormat; the engines refuse the file`, rebuild);
    }
    if (local === 'taskListener' && event === 'timeout') {
      const kids = peek<unknown[]>(v, '$children');
      const timer = Array.isArray(kids) && (kids as El[]).some((c) => c && typeof c.$type === 'string' && /timerEventDefinition$/i.test(c.$type));
      if (!timer) push(ctx, 'deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:timeout:timer`, `${label} has no bpmn:timerEventDefinition; the engines refuse the file`, rebuild);
    }
    return;
  }
  if (local === 'in' || local === 'out') {
    if (!is(host, 'bpmn:CallActivity') && !(local === 'in' && is(host, 'bpmn:SignalEventDefinition'))) return;
    if (attr(v, 'variables') !== undefined || (local === 'in' && attr(v, 'businessKey') !== undefined)) return;
    const source = attr(v, 'source') !== undefined || attr(v, 'sourceExpression') !== undefined;
    const target = attr(v, 'target') !== undefined;
    if (!source || !target) {
      const missing = [!source ? 'source or sourceExpression' : '', !target ? 'target' : ''].filter(Boolean).join(' and ');
      push(ctx, 'deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `${local}:${attr(v, 'source') ?? attr(v, 'sourceExpression') ?? attr(v, 'target') ?? ''}`, `${ctx.p}:${local} of ${where} has no ${missing} (and no variables="all"${local === 'in' ? ' / businessKey' : ''}); the engines refuse the file`, hostId ? `Re-add it complete: \`bpmn ext add <file> ${hostId} ${ctx.p}:${local} source=<var> target=<var>\` (or variables=all) after \`bpmn ext remove <file> ${hostId} <index>\` (\`bpmn ext list <file> ${hostId}\`).` : rebuild);
    }
    return;
  }
  if (local === 'inputOutput') {
    checkParameters(ctx, host, owner, v, rebuild, local);
    return;
  }
  if (local === 'connector') {
    const ids = children(ctx, v).filter((c) => localName(c.$type) === 'connectorId');
    if (!ids.length) push(ctx, 'deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, 'connector:id', `${ctx.p}:connector of ${where} has no ${ctx.p}:connectorId; the engines refuse the file`, rebuild);
    if (ids.length > 1) push(ctx, 'deploy', 'W_C7_DEPLOY_DUPLICATE_EXTENSION', host, owner, 'dup:connectorId', `${ctx.p}:connector of ${where} has ${ids.length} ${ctx.p}:connectorId elements; the engines refuse the file`, rebuild);
    const ios = children(ctx, v, 'inputOutput');
    if (ios.length > 1) push(ctx, 'deploy', 'W_C7_DEPLOY_DUPLICATE_EXTENSION', host, owner, 'dup:connector/inputOutput', `${ctx.p}:connector of ${where} has ${ios.length} ${ctx.p}:inputOutput elements; the engines refuse the file`, rebuild);
    for (const io of ios) checkParameters(ctx, host, owner, io, rebuild, 'connector');
    return;
  }
  if (local === 'formData' && (is(host, 'bpmn:UserTask') || is(host, 'bpmn:StartEvent'))) {
    children(ctx, v, 'formField').forEach((f, i) => {
      const label = `Form field ${attr(f, 'id') ?? i + 1} of ${where}`;
      if (!nonEmpty(attr(f, 'id'))) push(ctx, 'deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `formField#${i}:id`, `${label} has no id; the engines refuse the file`, rebuild);
      const type = attr(f, 'type');
      if (type === undefined) push(ctx, 'deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `formField#${i}:type`, `${label} has no type; the engines refuse the file`, `Use one of ${FORM_TYPES.join(', ')}. ${rebuild}`);
      else if (!FORM_TYPES.includes(type)) push(ctx, 'deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `formField#${i}:type`, `${label} has type "${type}", which is not one of the built-in form types ${FORM_TYPES.join(', ')}; the engines refuse the file (unless a plugin registers it as a custom form type)`, rebuild);
    });
  }
}

function checkParameters(ctx: Ctx, host: El, owner: El | undefined, io: El, rebuild: string, scope: string): void {
  const where = describe(host, owner);
  for (const kind of ['inputParameter', 'outputParameter']) {
    children(ctx, io, kind).forEach((param, i) => {
      if (!nonEmpty(attr(param, 'name'))) push(ctx, 'deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `${scope}:${kind}#${i}:name`, `${ctx.p}:${kind} ${i + 1} of ${where} has no name; the engines refuse the file`, rebuild);
    });
  }
}

/** Where the engines refuse camunda:inputOutput. */
function checkInputOutputHost(ctx: Ctx, host: El, owner: El | undefined, ios: El[]): void {
  if (!ios.length || !is(host, 'bpmn:FlowNode')) return;
  const hostId = idOf(host) ?? idOf(owner);
  const where = describe(host, owner);
  const remove = hostId ? `Move the mappings to the next activity and remove them here: \`bpmn ext remove <file> ${hostId} ${ctx.p}:inputOutput\`.` : 'Remove it from the XML.';
  if (is(host, 'bpmn:StartEvent') || is(host, 'bpmn:BoundaryEvent') || is(host, 'bpmn:Gateway') || isEventSubProcess(host)) {
    const kind = isEventSubProcess(host) ? 'an event sub-process' : `a ${describe(host, undefined).split(' ')[0]}`;
    push(ctx, 'deploy', 'W_C7_DEPLOY_INPUT_OUTPUT', host, owner, 'io:host', `${ctx.p}:inputOutput on ${where}: the engines do not support input/output mappings on ${kind} and refuse the file`, remove);
    return;
  }
  const outputs = ios.some((io) => children(ctx, io, 'outputParameter').length > 0);
  if (!outputs) return;
  const dropOutputs = hostId ? `Remove the output parameters: rebuild the mapping without them (\`bpmn ext list <file> ${hostId} --json\`, then \`bpmn ext add <file> ${hostId} ${ctx.p}:inputOutput --replace --xml '...'\`).` : 'Remove them from the XML.';
  if (is(host, 'bpmn:EndEvent')) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_INPUT_OUTPUT', host, owner, 'io:output', `${ctx.p}:outputParameter on end event ${hostId}: the engines refuse output mappings on end events`, dropOutputs);
  } else if (is(peek<El>(host, 'loopCharacteristics'), 'bpmn:MultiInstanceLoopCharacteristics')) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_INPUT_OUTPUT', host, owner, 'io:output', `${ctx.p}:outputParameter on multi-instance ${where}: the engines refuse output mappings on multi-instance activities`, `${dropOutputs} Collect results in an activity inside the loop instead.`);
  }
}

/* ------------------------------------------------------------------ */
/* element rules                                                        */
/* ------------------------------------------------------------------ */

const SERVICE_LIKE = ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask'];
const TTL_MAX = 2147483647;

function validTtl(v: string): boolean {
  const m = /^\+?(\d+)$/.exec(v) ?? /^P(\d+)D$/.exec(v);
  return !!m && Number(m[1]) <= TTL_MAX;
}

function checkProcess(ctx: Ctx, proc: El): void {
  const id = idOf(proc) ?? '<processId>';
  const ttl = c7(ctx, proc, 'historyTimeToLive');
  const hint = `\`bpmn set <file> ${id} ${ctx.p}:historyTimeToLive=180\` (days, like Camunda Modeler; P180D works too).`;
  if (!nonEmpty(ttl)) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_HISTORY_TTL', proc, undefined, 'ttl', `Executable process ${id} has no ${ctx.p}:historyTimeToLive; Camunda 7.20+, CIB seven and Operaton refuse to deploy it (ENGINE-12018)`, hint);
  } else if (!validTtl(ttl)) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_HISTORY_TTL', proc, undefined, 'ttl', `${ctx.p}:historyTimeToLive="${ttl}" of process ${id} is not a number of days (or P<n>D); the engines refuse it`, hint);
  }
  checkPriorities(ctx, proc, undefined, ['jobPriority', 'taskPriority']);
}

function isNumber(v: string): boolean {
  return /^[+-]?\d+$/.test(v.trim()) && v.trim() === v;
}

/** jobPriority / taskPriority must be numbers or expressions; the engines check them at deploy time. */
function checkPriorities(ctx: Ctx, el: El, owner: El | undefined, names: string[]): void {
  const addr = addressOf(el, owner);
  for (const name of names) {
    const v = c7(ctx, el, name);
    if (v === undefined || isNumber(v) || isExpression(v)) continue;
    if (!camundaAttr(name)?.owners.some((o) => is(el, o))) continue;
    push(ctx, 'deploy', 'W_C7_DEPLOY_BAD_VALUE', el, owner, `attr:${name}`, `${ctx.p}:${name}="${v}" on ${describe(el, owner)} is not a number or expression; the engines refuse it`, addr ? `\`bpmn set <file> ${addr.id} ${addr.prefix}${ctx.p}:${name}=50\` (an integer or \${...}).` : 'Use an integer.');
  }
}

/** Implementation of a service-like element: a task, or the messageEventDefinition of a message throw/end event. */
function checkImplementation(ctx: Ctx, el: El, owner: El | undefined, label: string, opts: { decisionRef?: boolean; event?: El } = {}): void {
  const addr = addressOf(el, owner);
  const set = (kv: string): string => (addr ? `\`bpmn set <file> ${addr.id} ${kv.split(' ').map((p) => sh(`${addr.prefix}${p}`)).join(' ')}\`` : 'edit the XML');
  const type = c7(ctx, el, 'type');
  const topic = c7(ctx, el, 'topic');
  const external = type !== undefined && type.toLowerCase() === 'external';
  const p = ctx.p;
  if (type !== undefined && !external) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, 'impl:type', `${p}:type="${type}" on ${label} is not supported (only "external"); the engines refuse the file`, `Use an external task: ${set(`${p}:type=external ${p}:topic=<topic>`)}, or remove it: ${set(`${p}:type=`)}.`);
    return;
  }
  const impl =
    ['class', 'delegateExpression', 'expression'].some((a) => nonEmpty(c7(ctx, el, a))) ||
    external ||
    hasConnector(ctx, el, opts.event) ||
    (opts.decisionRef === true && c7(ctx, el, 'decisionRef') !== undefined);
  if (!impl) {
    if (opts.event) {
      const misplaced = ['class', 'delegateExpression', 'expression', 'type', 'topic'].some((a) => c7(ctx, opts.event, a) !== undefined);
      if (!misplaced) {
        push(ctx, 'runtime', 'W_C7_MESSAGE_NO_IMPLEMENTATION', el, owner, 'impl', `${label} has no implementation: it sends nothing and behaves like a none event at run time`, `Give it one: ${set(`${p}:type=external ${p}:topic=<topic>`)} (or ${p}:delegateExpression=\${...}).`);
      }
      return;
    }
    const hint = topic !== undefined ? `It has a ${p}:topic but no ${p}:type: ${set(`${p}:type=external`)}.` : `Give it one: ${set(`${p}:type=external ${p}:topic=<topic>`)} (or ${p}:delegateExpression=\${...}, ${p}:class=..., ${p}:expression=\${...}${opts.decisionRef ? `, ${p}:decisionRef=<decisionId>` : ''}).`;
    push(ctx, 'deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, 'impl', `${label} has no implementation (${p}:class, delegateExpression, expression, type=external${opts.decisionRef ? ', decisionRef' : ''} or a connector); the engines refuse the file`, hint);
    return;
  }
  if (external && topic === undefined) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_EXTERNAL_TOPIC', el, owner, 'topic', `${label} is an external task without ${p}:topic; the engines refuse the file`, `${set(`${p}:topic=<topic>`)}.`);
  } else if (external && topic === '') {
    push(ctx, 'runtime', 'W_C7_BAD_VALUE', el, owner, 'attr:topic', `${label} is an external task with an empty ${p}:topic; no worker can fetch it`, `${set(`${p}:topic=<topic>`)}.`);
  }
  if (c7(ctx, el, 'resultVariable') !== undefined && (nonEmpty(c7(ctx, el, 'class')) || nonEmpty(c7(ctx, el, 'delegateExpression')))) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_RESULT_VARIABLE', el, owner, 'resultVariable', `${label} combines ${p}:resultVariable with ${nonEmpty(c7(ctx, el, 'class')) ? `${p}:class` : `${p}:delegateExpression`}; the engines support a result variable only with ${p}:expression and refuse the file`, `Remove it: ${set(`${p}:resultVariable=`)} (or switch to ${p}:expression=\${...}).`);
  }
  if (external) checkPriorities(ctx, el, owner, ['taskPriority']);
}

function checkBinding(ctx: Ctx, el: El, binding: string, version: string, versionTag: string | undefined, allowed: string[]): void {
  const id = idOf(el)!;
  const p = ctx.p;
  const b = c7(ctx, el, binding);
  if (b === undefined) return;
  if (b === 'version' && c7(ctx, el, version) === undefined) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_BINDING_VERSION', el, undefined, binding, `${describe(el, undefined)} has ${p}:${binding}="version" but no ${p}:${version}; the engines refuse the file`, `\`bpmn set <file> ${id} ${p}:${version}=<n>\` (or \`${p}:${binding}=latest\`).`);
  } else if (b === 'versionTag' && versionTag && c7(ctx, el, versionTag) === undefined) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_BINDING_VERSION', el, undefined, binding, `${describe(el, undefined)} has ${p}:${binding}="versionTag" but no ${p}:${versionTag}; the engines refuse the file`, `\`bpmn set <file> ${id} ${p}:${versionTag}=<tag>\` (or \`${p}:${binding}=latest\`).`);
  } else if (!allowed.includes(b)) {
    push(ctx, 'runtime', 'W_C7_BAD_VALUE', el, undefined, `attr:${binding}`, `${p}:${binding}="${b}" on ${describe(el, undefined)} is not one of ${allowed.join(', ')}; the engines accept the file but cannot resolve the reference as intended`, `\`bpmn set <file> ${id} ${p}:${binding}=latest\`.`);
  }
}

function checkCallActivity(ctx: Ctx, el: El): void {
  const id = idOf(el)!;
  const p = ctx.p;
  const called = peek<string>(el, 'calledElement');
  const caseRef = c7(ctx, el, 'caseRef');
  if (called === undefined && caseRef === undefined) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_CALLED_ELEMENT', el, undefined, 'calledElement', `Call activity ${id} has no calledElement (nor ${p}:caseRef); the engines refuse the file`, `\`bpmn set <file> ${id} calledElement=<processId>\`.`);
  } else if (called !== undefined && caseRef !== undefined) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_CALLED_ELEMENT', el, undefined, 'calledElement+caseRef', `Call activity ${id} has both calledElement and ${p}:caseRef; the engines refuse the file`, `Keep one: \`bpmn set <file> ${id} ${p}:caseRef=\`.`);
  } else if (called === '') {
    push(ctx, 'runtime', 'W_C7_BAD_VALUE', el, undefined, 'attr:calledElement', `Call activity ${id} has an empty calledElement; it fails when it runs`, `\`bpmn set <file> ${id} calledElement=<processId>\`.`);
  }
  checkBinding(ctx, el, 'calledElementBinding', 'calledElementVersion', 'calledElementVersionTag', BINDINGS);
  checkBinding(ctx, el, 'caseBinding', 'caseVersion', undefined, CASE_BINDINGS);
}

const DECISION_MAPPERS = ['singleEntry', 'singleResult', 'collectEntries', 'resultList'];

function checkBusinessRule(ctx: Ctx, el: El): void {
  if (c7(ctx, el, 'decisionRef') === undefined) return;
  checkBinding(ctx, el, 'decisionRefBinding', 'decisionRefVersion', 'decisionRefVersionTag', BINDINGS);
  const map = c7(ctx, el, 'mapDecisionResult');
  if (map !== undefined && !DECISION_MAPPERS.includes(map)) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_BAD_VALUE', el, undefined, 'attr:mapDecisionResult', `${ctx.p}:mapDecisionResult="${map}" on ${describe(el, undefined)} is not one of ${DECISION_MAPPERS.join(', ')}; the engines refuse the file`, `\`bpmn set <file> ${idOf(el)} ${ctx.p}:mapDecisionResult=singleEntry\` (or another of the four).`);
  }
}

const FORM_BINDINGS = ['deployment', 'latest', 'version'];

function checkForms(ctx: Ctx, el: El): void {
  const id = idOf(el)!;
  const p = ctx.p;
  const formRef = c7(ctx, el, 'formRef');
  if (formRef === undefined) return;
  if (c7(ctx, el, 'formKey') !== undefined) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_FORM', el, undefined, 'formKey+formRef', `${describe(el, undefined)} has both ${p}:formKey and ${p}:formRef; the engines refuse the file`, `Keep one: \`bpmn set <file> ${id} ${p}:formKey=\` (or ${p}:formRef=).`);
  }
  const binding = c7(ctx, el, 'formRefBinding');
  if (binding === undefined || !FORM_BINDINGS.includes(binding)) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_FORM', el, undefined, 'formRefBinding', `${describe(el, undefined)} has ${p}:formRef but ${binding === undefined ? `no ${p}:formRefBinding` : `${p}:formRefBinding="${binding}"`} (one of ${FORM_BINDINGS.join(', ')} is required); the engines refuse the file`, `\`bpmn set <file> ${id} ${p}:formRefBinding=latest\`.`);
  } else if (binding === 'version' && c7(ctx, el, 'formRefVersion') === undefined) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_BINDING_VERSION', el, undefined, 'formRefBinding', `${describe(el, undefined)} has ${p}:formRefBinding="version" but no ${p}:formRefVersion; the engines refuse the file`, `\`bpmn set <file> ${id} ${p}:formRefVersion=<n>\` (or ${p}:formRefBinding=latest).`);
  }
}

function checkMultiInstance(ctx: Ctx, activity: El): void {
  const loop = peek<El>(activity, 'loopCharacteristics');
  if (!is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) return;
  const id = idOf(activity)!;
  const p = ctx.p;
  const card = peek<El>(loop, 'loopCardinality');
  const collection = c7(ctx, loop, 'collection');
  // the engines read loopDataInputRef as a variable name; bpmn-moddle cannot resolve that and only reports it on import
  const dataInput = peek<unknown>(loop, 'loopDataInputRef') ?? ctx.doc.importWarnings.some((w) => (w as { element?: unknown }).element === loop && /loopDataInputRef/.test(String((w as { property?: unknown }).property ?? '')));
  const elementVariable = c7(ctx, loop, 'elementVariable');
  if (!card && collection === undefined && !dataInput) {
    const misplaced = c7(ctx, activity, 'collection');
    const message = `Multi-instance ${describe(activity, undefined)} has neither a loop cardinality nor ${p}:collection${misplaced !== undefined ? ` (${p}:collection sits on the activity, not on the loop)` : ''}; the engines refuse the file`;
    const hint =
      misplaced !== undefined
        ? `Move it onto the loop: \`bpmn set <file> ${id} ${p}:collection= ${sh(`loop.${p}:collection=${misplaced}`)}${c7(ctx, activity, 'elementVariable') !== undefined ? ` ${p}:elementVariable= ${sh(`loop.${p}:elementVariable=${c7(ctx, activity, 'elementVariable')}`)}` : ''}\`.`
        : `\`bpmn set <file> ${id} ${sh(`loop.${p}:collection=\${items}`)} loop.${p}:elementVariable=item\` (or \`bpmn set <file> ${id} cardinality=3\`).`;
    push(ctx, 'deploy', 'W_C7_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi', message, hint);
    return;
  }
  if (card && !nonEmpty(peek<string>(card, 'body')) && collection === undefined && !dataInput) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi:cardinality', `Multi-instance ${describe(activity, undefined)} has an empty loop cardinality; the engines refuse the file`, `\`bpmn set <file> ${id} cardinality=3\` (a number or \${...}).`);
  }
  if (elementVariable !== undefined && collection === undefined && !dataInput) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi:elementVariable', `Multi-instance ${describe(activity, undefined)} has ${p}:elementVariable but no ${p}:collection; the engines refuse the file`, `\`bpmn set <file> ${id} ${sh(`loop.${p}:collection=\${items}`)}\` (or remove it: \`bpmn set <file> ${id} loop.${p}:elementVariable=\`).`);
  }
}

function nameOf(el: El | undefined): string | undefined {
  const n = peek<string>(el, 'name');
  return nonEmpty(n) ? n : undefined;
}

function definitionOf(el: El, type: string): El | undefined {
  return list(el, 'eventDefinitions').find((d) => is(d, type));
}

function checkEvent(ctx: Ctx, el: El): void {
  const id = idOf(el)!;
  const label = describe(el, undefined);
  const host = is(el, 'bpmn:BoundaryEvent') ? peek<El>(el, 'attachedToRef') : undefined;
  if (host && peek<boolean>(host, 'isForCompensation') === true) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_BOUNDARY_HOST', el, undefined, 'compensationHost', `Boundary event ${id} is attached to the compensation handler ${idOf(host)}; the engines refuse boundary events on compensation handlers`, `Remove it: \`bpmn remove <file> ${id}\` (or attach it to a normal activity: \`bpmn move <file> ${id} --on <activityId>\`).`, [idOf(host)!]);
  }
  const catching = is(el, 'bpmn:StartEvent') || is(el, 'bpmn:IntermediateCatchEvent') || is(el, 'bpmn:BoundaryEvent');
  const throwing = is(el, 'bpmn:IntermediateThrowEvent') || is(el, 'bpmn:EndEvent');
  for (const def of list(el, 'eventDefinitions')) {
    if (is(def, 'bpmn:MessageEventDefinition')) {
      if (catching) {
        const msg = peek<El>(def, 'messageRef');
        if (!msg) push(ctx, 'deploy', 'W_C7_DEPLOY_MESSAGE', el, undefined, 'messageRef', `${label} has no message; the engines refuse the file`, `\`bpmn set <file> ${id} message=<MessageName>\` (creates the bpmn:Message).`);
        else if (!nameOf(msg)) push(ctx, 'deploy', 'W_C7_DEPLOY_MESSAGE', el, undefined, 'messageName', `Message ${idOf(msg)} of ${label} has no name; the engines refuse the file`, `\`bpmn set <file> ${idOf(msg)} name=<MessageName>\`.`, [idOf(msg)!]);
      } else if (throwing) {
        checkImplementation(ctx, def, el, label, { event: el });
      }
    } else if (is(def, 'bpmn:SignalEventDefinition')) {
      const sig = peek<El>(def, 'signalRef');
      if (!sig) push(ctx, 'deploy', 'W_C7_DEPLOY_SIGNAL', el, undefined, 'signalRef', `${label} has no signal; the engines refuse the file`, `\`bpmn set <file> ${id} signal=<SignalName>\`.`);
      else if (!nameOf(sig)) push(ctx, 'deploy', 'W_C7_DEPLOY_SIGNAL', el, undefined, 'signalName', `Signal ${idOf(sig)} of ${label} has no name; the engines refuse the file`, `\`bpmn set <file> ${idOf(sig)} name=<SignalName>\`.`, [idOf(sig)!]);
    } else if (is(def, 'bpmn:ErrorEventDefinition') && is(el, 'bpmn:EndEvent')) {
      const err = peek<El>(def, 'errorRef');
      if (!err) push(ctx, 'deploy', 'W_C7_DEPLOY_ERROR', el, undefined, 'errorRef', `${label} throws no error (no errorRef); the engines refuse the file`, `\`bpmn set <file> ${id} error=<ErrorName> errorCode=<CODE>\`.`);
      else if (!nonEmpty(peek<string>(err, 'errorCode'))) push(ctx, 'deploy', 'W_C7_DEPLOY_ERROR', el, undefined, 'errorCode', `Error ${idOf(err)} thrown by ${label} has no errorCode; the engines refuse the file`, `\`bpmn set <file> ${id} errorCode=<CODE>\`.`, [idOf(err)!]);
    } else if (is(def, 'bpmn:EscalationEventDefinition')) {
      if (throwing) {
        const esc = peek<El>(def, 'escalationRef');
        if (!esc) push(ctx, 'deploy', 'W_C7_DEPLOY_ESCALATION', el, undefined, 'escalationRef', `${label} throws no escalation (no escalationRef); the engines refuse the file`, `\`bpmn set <file> ${id} escalation=<Name> escalationCode=<CODE>\`.`);
        else if (!nonEmpty(peek<string>(esc, 'escalationCode'))) push(ctx, 'deploy', 'W_C7_DEPLOY_ESCALATION', el, undefined, 'escalationCode', `Escalation ${idOf(esc)} thrown by ${label} has no escalationCode; the engines refuse the file`, `\`bpmn set <file> ${id} escalationCode=<CODE>\`.`, [idOf(esc)!]);
      } else if (is(el, 'bpmn:BoundaryEvent')) {
        const host = peek<El>(el, 'attachedToRef');
        if (host && !is(host, 'bpmn:SubProcess') && !is(host, 'bpmn:CallActivity') && !is(host, 'bpmn:UserTask')) {
          push(ctx, 'deploy', 'W_C7_DEPLOY_ESCALATION', el, undefined, 'escalationHost', `Escalation boundary event ${id} is attached to ${describe(host, undefined)}; the engines allow it only on sub-processes, call activities and user tasks and refuse the file`, `Attach it elsewhere (\`bpmn move <file> ${id} --on <subProcessId>\`) or remove it: \`bpmn remove <file> ${id}\`.`, [idOf(host)!]);
        }
      }
    } else if (is(def, 'bpmn:TimerEventDefinition')) {
      if (!['timeDate', 'timeCycle', 'timeDuration'].some((k) => peek<El>(def, k))) {
        push(ctx, 'deploy', 'W_C7_DEPLOY_EVENT_DEFINITION', el, undefined, 'timer', `Timer of ${label} has no date, cycle or duration; the engines refuse the file`, `\`bpmn set <file> ${id} timer=PT1H\` (or R/PT1H, or a date).`);
      }
    } else if (is(def, 'bpmn:ConditionalEventDefinition')) {
      const cond = peek<El>(def, 'condition');
      if (!cond || !nonEmpty(peek<string>(cond, 'body'))) {
        push(ctx, 'deploy', 'W_C7_DEPLOY_EVENT_DEFINITION', el, undefined, 'condition', `Conditional event ${id} has no condition; the engines refuse the file`, `\`bpmn set <file> ${id} ${sh('when=${expression}')}\`.`);
      }
      const events = c7(ctx, def, 'variableEvents');
      if (events !== undefined) {
        const bad = events.split(',').map((e) => e.trim()).filter((e) => e && !VARIABLE_EVENTS.includes(e));
        if (bad.length) push(ctx, 'runtime', 'W_C7_BAD_VALUE', def, el, 'attr:variableEvents', `${ctx.p}:variableEvents="${events}" of ${label} lists ${bad.join(', ')}; only ${VARIABLE_EVENTS.join(', ')} trigger the condition`, `\`bpmn set <file> ${id} ${sh(`definition.${ctx.p}:variableEvents=create, update`)}\`.`);
      }
    }
  }
}

/** Message subscriptions that share a name in one engine scope. */
function checkMessageScopes(ctx: Ctx, scope: El): void {
  const groups = new Map<string, El[]>();
  const add = (key: string, el: El): void => {
    groups.set(key, [...(groups.get(key) ?? []), el]);
  };
  for (const node of ctx.doc.flowNodes(scope)) {
    const def = definitionOf(node, 'bpmn:MessageEventDefinition');
    const name = nameOf(peek<El>(def, 'messageRef'));
    if (!def || !name) continue;
    if (is(node, 'bpmn:StartEvent') && is(scope, 'bpmn:Process')) add(`start\u0000${name}`, node);
    else if (is(node, 'bpmn:BoundaryEvent')) add(`boundary:${idOf(peek<El>(node, 'attachedToRef')) ?? ''}\u0000${name}`, node);
  }
  for (const sub of ctx.doc.flowNodes(scope).filter(isEventSubProcess)) {
    for (const start of ctx.doc.flowNodes(sub).filter((n) => is(n, 'bpmn:StartEvent'))) {
      const name = nameOf(peek<El>(definitionOf(start, 'bpmn:MessageEventDefinition'), 'messageRef'));
      if (name) add(`eventsub\u0000${name}`, start);
    }
  }
  for (const [key, els] of groups) {
    if (els.length < 2) continue;
    const name = key.split('\u0000')[1];
    const [first, ...rest] = els;
    for (const el of rest) {
      push(ctx, 'deploy', 'W_C7_DEPLOY_MESSAGE', el, undefined, `dupMessage:${name}`, `${describe(el, undefined)} waits for message "${name}" like ${idOf(first)} in the same scope; the engines refuse two subscriptions with one name`, `Use another message: \`bpmn set <file> ${idOf(el)} message=<OtherName>\`.`, [idOf(first)!]);
    }
  }
}

function checkEventGateway(ctx: Ctx, gw: El): void {
  const id = idOf(gw)!;
  const names = new Map<string, El>();
  for (const flow of ctx.outgoing.get(gw) ?? []) {
    const t = peek<El>(flow, 'targetRef');
    if (!t) continue;
    const tid = idOf(t)!;
    const fid = idOf(flow)!;
    if (!is(t, 'bpmn:IntermediateCatchEvent')) {
      push(ctx, 'deploy', 'W_C7_DEPLOY_EVENT_GATEWAY', gw, undefined, `target:${tid}`, `Event-based gateway ${id} leads to ${describe(t, undefined)}; the engines accept only intermediate catch events (message, timer, signal, conditional) there and refuse the file`, `Put a catch event in front of it: \`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow ${fid} --message <MessageName>\` (or :timer --timer PT1H).`, [tid, fid]);
      continue;
    }
    const defs = list(t, 'eventDefinitions');
    const kind = defs.length === 1 ? (['Message', 'Timer', 'Signal', 'Conditional'].find((k) => is(defs[0], `bpmn:${k}EventDefinition`)) ?? '') : '';
    if (!kind) {
      push(ctx, 'deploy', 'W_C7_DEPLOY_EVENT_GATEWAY', gw, undefined, `target:${tid}`, `Event-based gateway ${id} leads to ${describe(t, undefined)}; after an event-based gateway the engines accept only message, timer, signal and conditional catch events and refuse the file`, `\`bpmn set <file> ${tid} trigger=message message=<MessageName>\` (or trigger=timer timer=PT1H).`, [tid, fid]);
      continue;
    }
    if ((ctx.incoming.get(t) ?? []).length > 1) {
      push(ctx, 'deploy', 'W_C7_DEPLOY_EVENT_GATEWAY', gw, undefined, `incoming:${tid}`, `${describe(t, undefined)} after event-based gateway ${id} has other incoming flows; the engines refuse the file`, `Join before the gateway instead, and keep only ${fid} into ${tid} (\`bpmn set <file> <otherFlowId> target=<nodeId>\`).`, [tid, fid]);
    }
    const ref = kind === 'Message' ? peek<El>(defs[0], 'messageRef') : kind === 'Signal' ? peek<El>(defs[0], 'signalRef') : undefined;
    const name = nameOf(ref);
    if (!name) continue;
    const key = `${kind}\u0000${name}`;
    const first = names.get(key);
    if (first) {
      push(ctx, 'deploy', 'W_C7_DEPLOY_EVENT_GATEWAY', gw, undefined, `dup:${kind}:${name}`, `Branches ${idOf(first)} and ${tid} of event-based gateway ${id} wait for the same ${kind.toLowerCase()} "${name}"; the engines refuse the file`, `\`bpmn set <file> ${tid} ${kind.toLowerCase()}=<OtherName>\`, or remove one branch.`, [idOf(first)!, tid]);
    } else names.set(key, t);
  }
}

function checkExclusiveGateway(ctx: Ctx, gw: El): void {
  const id = idOf(gw)!;
  const outgoing = ctx.outgoing.get(gw) ?? [];
  const def = peek<El>(gw, 'default');
  const hasCond = (f: El): boolean => !!peek<El>(f, 'conditionExpression');
  if (!outgoing.length) {
    push(ctx, 'deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, 'none', `Exclusive gateway ${id} has no outgoing flow; the engines refuse the file`, `Continue it: \`bpmn add <file> <kind> "<Name>" --after ${id}\`.`);
    return;
  }
  if (outgoing.length === 1) {
    const f = outgoing[0]!;
    if (hasCond(f) && f !== def) push(ctx, 'deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, `single:${idOf(f)}`, `Exclusive gateway ${id} has a single outgoing flow ${idOf(f)} with a condition; the engines refuse the file`, `\`bpmn set <file> ${idOf(f)} condition=\`.`, [idOf(f)!]);
    if (hasCond(f) && f === def) push(ctx, 'deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, `default:${idOf(f)}`, `Default flow ${idOf(f)} of exclusive gateway ${id} has a condition; the engines refuse the file`, `\`bpmn set <file> ${idOf(f)} condition=\`.`, [idOf(f)!]);
    return;
  }
  const unconditioned: El[] = [];
  for (const f of outgoing) {
    if (f === def) {
      if (hasCond(f)) push(ctx, 'deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, `default:${idOf(f)}`, `Default flow ${idOf(f)} of exclusive gateway ${id} has a condition; the engines refuse the file`, `\`bpmn set <file> ${idOf(f)} condition=\`.`, [idOf(f)!]);
      continue;
    }
    if (!hasCond(f)) unconditioned.push(f);
  }
  if (def || unconditioned.length > 1) {
    for (const f of unconditioned) {
      push(ctx, 'deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, `uncond:${idOf(f)}`, `Flow ${idOf(f)} of exclusive gateway ${id} has no condition and is not the default flow${def ? '' : ` (${unconditioned.length} such flows)`}; the engines refuse the file`, `\`bpmn set <file> ${idOf(f)} ${sh('condition=${...}')}\`${def ? '' : ` or make one of them the default: \`bpmn set <file> ${idOf(f)} default=true\``}.`, [idOf(f)!]);
    }
  } else if (unconditioned.length === 1) {
    const f = unconditioned[0]!;
    push(ctx, 'practice', 'W_C7_EXCLUSIVE_GATEWAY_DEFAULT', gw, undefined, `implicit:${idOf(f)}`, `Flow ${idOf(f)} of exclusive gateway ${id} has no condition and is not the default flow; the engines take it as the default and log a warning`, `\`bpmn set <file> ${idOf(f)} default=true\`.`, [idOf(f)!]);
  }
}

function checkScriptTask(ctx: Ctx, el: El): void {
  if (nonEmpty(peek<string>(el, 'script')) || c7(ctx, el, 'resource') !== undefined) return;
  push(ctx, 'deploy', 'W_C7_DEPLOY_SCRIPT', el, undefined, 'script', `Script task ${idOf(el)} has neither a script nor ${ctx.p}:resource; the engines refuse the file`, `\`bpmn set <file> ${idOf(el)} scriptFormat=groovy ${sh('script=...')}\` (or ${ctx.p}:resource=deployment://<file>).`);
}

function checkReceiveTask(ctx: Ctx, el: El): void {
  const msg = peek<El>(el, 'messageRef');
  if (msg && !nameOf(msg)) push(ctx, 'deploy', 'W_C7_DEPLOY_MESSAGE', el, undefined, 'messageName', `Message ${idOf(msg)} of receive task ${idOf(el)} has no name; the engines refuse the file`, `\`bpmn set <file> ${idOf(msg)} name=<MessageName>\`.`, [idOf(msg)!]);
}

function checkUserTaskPriority(ctx: Ctx, el: El): void {
  const v = c7(ctx, el, 'priority');
  if (v === undefined || isNumber(v) || isExpression(v)) return;
  push(ctx, 'runtime', 'W_C7_BAD_VALUE', el, undefined, 'attr:priority', `${ctx.p}:priority="${v}" on ${describe(el, undefined)} is not a number or expression; creating the task fails`, `\`bpmn set <file> ${idOf(el)} ${ctx.p}:priority=50\`.`);
}

/** Id references inside camunda content (camunda:errorEventDefinition errorRef -> bpmn:Error). */
function checkVendorRefs(ctx: Ctx, host: El, owner: El | undefined): void {
  const hostId = idOf(host) ?? idOf(owner);
  for (const v of extensionValues(ctx, host)) {
    if (!v.uri || !C7_URIS.has(v.uri)) continue;
    for (const ref of idReferenceAttrs()) {
      if (localName(ref.element) !== v.local) continue;
      const target = attr(v.el, ref.attr);
      if (target === undefined) continue;
      const el = ctx.doc.get(target);
      if (el && is(el, ref.target)) continue;
      const candidates = ref.target === 'bpmn:Error' ? [...ctx.errors.keys()] : [];
      push(ctx, 'runtime', 'W_C7_DANGLING_REF', host, owner, `ref:${v.local}#${v.index}@${ref.attr}`, `${ctx.p}:${v.local} of ${describe(host, owner)} references ${ref.attr}="${target}", which is not a ${ref.target.replace('bpmn:', 'bpmn:')} in the file; the engines ignore the mapping when it runs`, `${hostId ? `Point it at an existing one${candidates.length ? ` (${candidates.slice(0, 5).join(', ')})` : ''}: \`bpmn ext list <file> ${hostId} --json\`, then \`bpmn ext add <file> ${hostId} ${ctx.p}:${v.local} ... ${ref.attr}=<id> --replace\`.` : 'Fix it in the XML.'}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* traversal                                                            */
/* ------------------------------------------------------------------ */

/** BPMN containment children (no references, no DI, no vendor content). */
function bpmnChildren(el: El): El[] {
  const d = el.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean }> };
  if (d.isGeneric) return [];
  const out: El[] = [];
  for (const p of d.properties ?? []) {
    if (p.isReference || p.name === 'extensionElements' || p.name === 'diagrams') continue;
    const v = peek<unknown>(el, p.name);
    for (const c of Array.isArray(v) ? v : [v]) {
      if (c && typeof c === 'object' && typeof (c as El).$type === 'string' && '$descriptor' in (c as object) && isBpmnElement(c as El) && !isDiElement(c as El)) out.push(c as El);
    }
  }
  return out;
}

function visit(ctx: Ctx, el: El, owner: El | undefined, executable: boolean): void {
  checkAttributes(ctx, el, owner);
  checkExtensions(ctx, el, owner, executable);
  checkVendorRefs(ctx, el, owner);
  if (executable) {
    if (is(el, 'bpmn:Process')) checkProcess(ctx, el);
    if (SERVICE_LIKE.some((t) => is(el, t))) checkImplementation(ctx, el, undefined, describe(el, undefined), { decisionRef: is(el, 'bpmn:BusinessRuleTask') });
    if (is(el, 'bpmn:BusinessRuleTask')) checkBusinessRule(ctx, el);
    if (is(el, 'bpmn:CallActivity')) checkCallActivity(ctx, el);
    if (is(el, 'bpmn:UserTask') || is(el, 'bpmn:StartEvent')) checkForms(ctx, el);
    if (is(el, 'bpmn:UserTask')) checkUserTaskPriority(ctx, el);
    if (is(el, 'bpmn:Activity')) checkMultiInstance(ctx, el);
    if (is(el, 'bpmn:Event')) checkEvent(ctx, el);
    if (is(el, 'bpmn:EventBasedGateway')) checkEventGateway(ctx, el);
    if (is(el, 'bpmn:ExclusiveGateway')) checkExclusiveGateway(ctx, el);
    if (is(el, 'bpmn:ScriptTask')) checkScriptTask(ctx, el);
    if (is(el, 'bpmn:ReceiveTask')) checkReceiveTask(ctx, el);
    if ((is(el, 'bpmn:Activity') || is(el, 'bpmn:Gateway') || is(el, 'bpmn:Event') || is(el, 'bpmn:MultiInstanceLoopCharacteristics')) && !is(el, 'bpmn:Process')) checkPriorities(ctx, el, owner, ['jobPriority']);
    if (is(el, 'bpmn:Process') || is(el, 'bpmn:SubProcess')) checkMessageScopes(ctx, el);
  }
  const next = idOf(el) ? el : owner;
  for (const c of bpmnChildren(el)) visit(ctx, c, next, executable);
}

/** Duplicate names among the root signals (the engines refuse the file even when one is unused). */
function checkSignalNames(ctx: Ctx): void {
  const seen = new Map<string, El>();
  for (const sig of ctx.doc.rootElementsOfType('bpmn:Signal')) {
    const name = nameOf(sig);
    if (!name) continue;
    const first = seen.get(name);
    if (first) push(ctx, 'deploy', 'W_C7_DEPLOY_SIGNAL', sig, undefined, `dupSignal:${name}`, `Signals ${idOf(first)} and ${idOf(sig)} are both named "${name}"; the engines refuse duplicate signal names`, `\`bpmn set <file> ${idOf(sig)} name=<OtherName>\` (or point its events at ${idOf(first)} and remove it).`, [idOf(first)!]);
    else seen.set(name, sig);
  }
}

/** Runs the Camunda 7 profile over a document. */
export function c7Findings(doc: Doc): ProfileFinding[] {
  const ns = namespaceMap(doc);
  const prefix = [...ns.entries()].find(([, uri]) => uri === CAMUNDA_URI)?.[0] ?? [...ns.entries()].find(([, uri]) => C7_URIS.has(uri))?.[0] ?? 'camunda';
  const errors = new Map(doc.rootElementsOfType('bpmn:Error').map((e) => [idOf(e) ?? '', e] as const));
  const outgoing = new Map<El, El[]>();
  const incoming = new Map<El, El[]>();
  for (const flow of walk(doc.definitions, { bpmnOnly: true })) {
    if (!is(flow, 'bpmn:SequenceFlow')) continue;
    const source = peek<El>(flow, 'sourceRef');
    const target = peek<El>(flow, 'targetRef');
    if (source) outgoing.set(source, [...(outgoing.get(source) ?? []), flow]);
    if (target) incoming.set(target, [...(incoming.get(target) ?? []), flow]);
  }
  const ctx: Ctx = { doc, ns, p: prefix, out: [], errors, outgoing, incoming };
  const defs = doc.definitions;
  checkAttributes(ctx, defs, undefined);
  checkExtensions(ctx, defs, undefined, true);
  const processes = doc.processes();
  const executable = processes.filter((p) => peek<boolean>(p, 'isExecutable') === true);
  for (const root of list(defs, 'rootElements')) {
    if (is(root, 'bpmn:Process')) {
      if (executable.includes(root)) visit(ctx, root, undefined, true);
      continue;
    }
    visit(ctx, root, undefined, false);
  }
  if (executable.length) checkSignalNames(ctx);
  return ctx.out;
}
