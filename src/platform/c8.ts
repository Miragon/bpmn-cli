/**
 * The Camunda 8 validation profile (Zeebe, `zeebe:` namespace). It checks what
 * Camunda 8.9 checks when a file is deployed, what it accepts but ignores or
 * fails on when a process runs, and zeebe content it does not know. Every rule
 * was taken from a deployment against Camunda 8.9.22 (REST v2) and, for the
 * runtime rules, from running the process (test/c8-profile.test.ts holds one
 * model per rule with the engine's verdict and re-checks it with
 * BPMN_C8_ENGINE); placement and known attributes come from the zeebe-bpmn-moddle
 * descriptor, read as data (platform/zeebe.ts; never registered with the model,
 * so zeebe content stays generic).
 *
 * Scope: executable processes (isExecutable="true"; Camunda 8 skips the others,
 * but refuses a file without any), including the content of ad-hoc
 * sub-processes (the engine checks it), plus the root elements they reference
 * and the schema checks, which cover the whole file (the engine validates it
 * against the BPMN schema first).
 *
 * Codes, severity deploy (Camunda 8.9 refuses the deployment):
 *   W_C8_DEPLOY_EXECUTABLE         the file has processes but none is executable
 *   W_C8_DEPLOY_IMPLEMENTATION     service / send / script / business rule task, message throw or end event without
 *                                  its implementation (zeebe:taskDefinition; zeebe:script / zeebe:calledDecision for
 *                                  script / business rule tasks), with two kinds of it, a job without type, a
 *                                  zeebe:script without expression or resultVariable, a zeebe:calledDecision without
 *                                  decisionId or resultVariable, a message whose name is empty
 *   W_C8_DEPLOY_CALLED_ELEMENT     call activity without zeebe:calledElement (a bpmn calledElement is not read) or
 *                                  without processId
 *   W_C8_DEPLOY_DUPLICATE_EXTENSION two of a zeebe element the engine reads once (taskDefinition, ioMapping, taskHeaders,
 *                                  userTask, formDefinition, assignmentDefinition, ..., subscription, loopCharacteristics)
 *   W_C8_DEPLOY_EXTENSION          content of zeebe elements: io mapping without target (or not a variable path),
 *                                  output without source, duplicate header keys, bindingType not deployment / latest /
 *                                  versionTag or versionTag missing, linked resource without resourceType, conditional
 *                                  filter events other than create / update, ad-hoc output collection without element
 *   W_C8_DEPLOY_EXPRESSION         a static value where Camunda 8 requires a FEEL expression (=...): conditions of
 *                                  sequence flows and conditional events, zeebe:script expression, multi-instance
 *                                  inputCollection / outputElement, correlation keys, an ad-hoc sub-process's
 *                                  completion condition; a FEEL syntax error (platform/feel.ts) in a value Camunda 8
 *                                  parses at deploy (FEEL_ATTRS, conditions, message / signal names starting with =)
 *   W_C8_DEPLOY_MESSAGE            message event / receive task without message, message without name, a catching
 *                                  message (not a process start) without exactly one zeebe:subscription with a
 *                                  correlationKey, a FEEL message name on a start event, one message name twice in
 *                                  one scope (boundary events of one activity and the activity, event-based gateway
 *                                  branches, event sub-process starts, process start events)
 *   W_C8_DEPLOY_SIGNAL             signal event without signal or with a nameless one, a FEEL signal name on a start
 *                                  event, one signal name on two start events / boundary events of one activity
 *   W_C8_DEPLOY_ERROR              error end / throw event without error or error code, a catching error code that is
 *                                  an expression, two error catch events with one code (or two catch-alls) in one
 *                                  scope, a non-interrupting error event
 *   W_C8_DEPLOY_ESCALATION         escalation throw without escalation or code, an escalation boundary event on
 *                                  something else than a sub-process or call activity
 *   W_C8_DEPLOY_TIMER              timer without (or with more than one of) date / cycle / duration, a static value that
 *                                  is no ISO 8601 date-time with offset / duration / repeating interval or cron
 *                                  expression, a cycle on an intermediate catch event or an interrupting timer
 *   W_C8_DEPLOY_EVENT_DEFINITION   catch / boundary event without event definition, an event with several, an event
 *                                  definition the position does not support (cancel, a non-none start in a sub-process,
 *                                  a none or compensation start in an event sub-process), a conditional, compensation
 *                                  or link catch definition without id, a compensation activityRef outside the throw
 *                                  event's scope, a compensation boundary event without handler (or with an outgoing
 *                                  flow); schema (every definition in the file): conditional definition without condition
 *   W_C8_DEPLOY_EVENT_GATEWAY      event-based gateway with fewer than two outgoing flows or a branch that is not a
 *                                  message / timer / signal / conditional intermediate catch event
 *   W_C8_DEPLOY_START_EVENT        process without start event or with two none start events, embedded sub-process
 *                                  without exactly one none start event, event sub-process without exactly one
 *                                  triggered start event
 *   W_C8_DEPLOY_AD_HOC_SUBPROCESS  ad-hoc sub-process with a start or end event inside, or without an activity
 *   W_C8_DEPLOY_LINK               link throw without a catch of its name in its (sub-)process, two link catch events
 *                                  with one name in a process; link definition without name (schema) or an empty one
 *   W_C8_DEPLOY_USER_TASK          form definition that is not exactly one of formId / externalReference (Camunda user
 *                                  task) or formId / formKey (job worker user task), task listeners on a job worker user
 *                                  task, a static priority that is not 0..100, a static due / follow-up date that is no
 *                                  ISO 8601 date-time
 *   W_C8_DEPLOY_LISTENER           execution / task listener without type or event type, an unknown event type, start
 *                                  listeners on start and boundary events, end listeners on gateways, listeners on
 *                                  sequence flows
 *   W_C8_DEPLOY_UNSUPPORTED        a transaction, a cancel event (complex gateways are E_UNSUPPORTED_KIND)
 *   W_C8_DEPLOY_BOUNDARY_HOST      boundary event on a compensation handler (validate.ts withProfile drops it next to
 *                                  the structural E_INVALID_HOST)
 *   W_C8_DEPLOY_SCHEMA             an attribute without prefix that the BPMN schema does not define (anywhere in the
 *                                  file), extension elements on bpmn:definitions, an id that is no NCName; from the
 *                                  file's text (platform/schema-text.ts): child elements out of the schema's order,
 *                                  IDREFs that name no id, ids bpmn-moddle could not read
 * severity runtime (it deploys, but the setting is ignored or fails when the process runs):
 *   W_C8_FOREIGN_CONTENT           camunda:* / operaton:* attributes or elements (Camunda 7 content) in a Camunda 8 file
 *   W_C8_UNKNOWN_ELEMENT           zeebe extension element the descriptor does not know (did you mean ...)
 *   W_C8_UNKNOWN_ATTRIBUTE         unknown attribute on a zeebe element, unknown zeebe:* attribute on a BPMN element
 *   W_C8_MISPLACED_ATTRIBUTE       zeebe:* attribute on an element type that does not carry it
 *   W_C8_MISPLACED_EXTENSION       zeebe element on a host (or in a container) that does not read it; input mappings
 *                                  on start, boundary, none intermediate throw and none end events
 *   W_C8_EXCLUSIVE_GATEWAY         a flow out of an exclusive / inclusive gateway with other outgoing flows that has
 *                                  no condition and is not the default: never taken
 *   W_C8_CONDITION_IGNORED         a condition on a flow out of anything but an exclusive / inclusive gateway: the flow
 *                                  is always taken
 *   W_C8_STANDARD_LOOP             standard loop characteristics: Camunda 8 runs the activity once
 *   W_C8_EXPRESSION                a static multi-instance completion condition: every completion fails (incident)
 *   W_C8_BAD_VALUE                 static job retries that are no number (incident), task headers without key or value
 *                                  (dropped)
 *   W_C8_UNSUPPORTED_IMPLEMENTATION zeebe:publishMessage: Camunda 8.9 accepts it but does not run it (a send task gets
 *                                  an incident, a message throw / end event sends nothing)
 * severity practice:
 *   W_C8_JOB_WORKER_USER_TASK      user task without zeebe:userTask: Camunda 8 creates a job of type
 *                                  io.camunda.zeebe:userTask instead of a user task (not in the v2 user task API)
 *
 * White space: a name, job type, code, process / decision id or result variable
 * of white space deploys (only an empty one is refused); FEEL, path and enum
 * attributes, form ids and correlation keys of white space are refused.
 */
import type { Doc } from '../document.js';
import { kindLabel } from '../kinds.js';
import { is, isBpmnElement, isDiElement, walk, type El } from '../model.js';
import { unkeptEntries } from '../mirror.js';
import { decisionLinkOf } from '../ops/decision.js';
import { C7_URIS, ZEEBE_URI } from './descriptor.js';
import { namespaceMap, uriOfElement, uriOfName } from './detect.js';
import { feelSyntaxError } from './feel.js';
import { NCNAME, schemaTextIssues, type SchemaTextIssue } from './schema-text.js';
import { makeFinding, type ProfileFinding, type Severity } from './finding.js';
import { zeebeAllowedOn, zeebeAttr, zeebeAttrs, zeebeContainersOf, zeebeNestedOnly, zeebeType, zeebeTypeNames } from './zeebe.js';

interface Ctx {
  doc: Doc;
  ns: Map<string, string>;
  /** prefix of the zeebe namespace in this file, for messages and hints */
  p: string;
  out: ProfileFinding[];
  /** sequence flows by source, from sourceRef (the outgoing mirror lists are optional) */
  outgoing: Map<El, El[]>;
  /** flows whose source does not list them as written (mirror.ts unkeptEntries): flow -> source */
  unlisted: Map<El, El>;
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

/** No value or only white space: what Camunda 8 refuses for FEEL / path / enum attributes and form ids. */
function blank(v: string | undefined): boolean {
  return v === undefined || v.trim() === '';
}

/**
 * No value at all: Camunda 8 refuses a missing or empty name, job type, code,
 * process / decision id or result variable, but deploys one of white space
 * (engine-checked on 8.9.22).
 */
function missing(v: string | undefined): boolean {
  return v === undefined || v === null || v === '';
}

/** The name as written, or undefined when there is none (white space is a name to Camunda 8). */
function nameAttr(el: El | undefined): string | undefined {
  const n = peek<string>(el, 'name');
  return typeof n === 'string' && n !== '' ? n : undefined;
}

function isGeneric(el: El): boolean {
  return !!(el.$descriptor as { isGeneric?: boolean }).isGeneric;
}

function localName(type: string): string {
  return type.slice(type.indexOf(':') + 1);
}

/** A FEEL expression: the value starts with `=`. */
function isFeel(v: string | undefined): boolean {
  return v !== undefined && v.trim().startsWith('=');
}

/** Quotes a shell argument when it contains characters the shell would interpret (a `<placeholder>` stays as it is). */
function sh(arg: string): string {
  return /^[A-Za-z0-9_.:=,/@+-]*(<[a-zA-Z]+>)?$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** `userTask Activity_X`, `the multiInstanceLoopCharacteristics of userTask Activity_X` */
function describe(el: El, owner?: El): string {
  const id = idOf(el);
  const kind = isBpmnElement(el) ? lowerFirst(kindLabel(el).replace(/^bpmn:/, '')) : el.$type;
  if (id) return `${kind} ${id}`;
  return owner ? `the ${lowerFirst(localName(el.$type))} of ${describe(owner)}` : kind;
}

/** The `set` / `ext` key prefix that addresses `el` through `owner` (`definition.`, `loop.`, `condition.`). */
function addressOf(el: El, owner: El | undefined): { id: string; prefix: string } | undefined {
  const id = idOf(el);
  if (!owner || el === owner) return id ? { id, prefix: '' } : undefined;
  const oid = idOf(owner);
  if (!oid) return id ? { id, prefix: '' } : undefined;
  const defs = list(owner, 'eventDefinitions');
  if (defs.includes(el)) return { id: oid, prefix: defs.length > 1 ? `definition[${defs.indexOf(el)}].` : 'definition.' };
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

function didYouMean(name: string, candidates: string[]): string | undefined {
  const limit = Math.max(1, Math.floor(name.length / 4));
  let best: { c: string; d: number } | undefined;
  for (const c of candidates) {
    const d = distance(name, c);
    if (d <= limit && (!best || d < best.d)) best = { c, d };
  }
  return best?.c;
}

function push(ctx: Ctx, severity: Severity, code: string, element: El | undefined, owner: El | undefined, subject: string, message: string, hint: string, related: string[] = []): void {
  // a nested element (event definition, loop, condition) is reported on the flow node or flow that holds it
  const addr = element ? addressOf(element, owner) : undefined;
  const target = addr?.prefix ? addr.id : (idOf(element) ?? idOf(owner));
  ctx.out.push(makeFinding(severity, code, message, target, { hint, related, subject }));
}

/* ------------------------------------------------------------------ */
/* reading zeebe content                                                */
/* ------------------------------------------------------------------ */

interface ExtValue {
  el: El;
  uri: string | undefined;
  local: string;
  index: number;
}

/** The generic extension elements of a BPMN element, with their namespace. */
function extensionValues(ctx: Ctx, el: El | undefined): ExtValue[] {
  const ext = peek<El>(el, 'extensionElements');
  return list(ext, 'values').map((v, index) => ({ el: v, uri: isGeneric(v) ? uriOfElement(v, ctx.ns) : undefined, local: localName(v.$type), index }));
}

/** Top-level zeebe extension elements of type `local`. */
function zeebe(ctx: Ctx, el: El | undefined, local: string): El[] {
  return extensionValues(ctx, el)
    .filter((v) => v.uri === ZEEBE_URI && v.local === local)
    .map((v) => v.el);
}

/** Zeebe children of a generic element (all, or of type `local`). */
function kids(ctx: Ctx, el: El, local?: string): El[] {
  const raw = peek<unknown[]>(el, '$children');
  if (!Array.isArray(raw)) return [];
  return (raw as El[]).filter((c) => c && typeof c.$type === 'string' && isGeneric(c) && uriOfElement(c, ctx.ns) === ZEEBE_URI && (local === undefined || localName(c.$type) === local));
}

/** An attribute of a generic element. */
function attr(el: El | undefined, name: string): string | undefined {
  const v = peek<unknown>(el, name);
  return v === undefined || v === null ? undefined : String(v);
}

/** `<p>:taskDefinition` in the file's spelling. */
function z(ctx: Ctx, local: string): string {
  return `${ctx.p}:${local}`;
}

/** `bpmn ext add <file> <id> <args>` for an element (with its slot prefix for a nested one). */
function extAdd(ctx: Ctx, el: El, owner: El | undefined, args: string): string {
  const addr = addressOf(el, owner);
  if (!addr) return 'edit the XML';
  const i = args.indexOf(' ');
  const first = i === -1 ? args : args.slice(0, i);
  return `\`bpmn ext add <file> ${addr.id} ${sh(`${addr.prefix}${first}`)}${i === -1 ? '' : args.slice(i)}\``;
}

/**
 * `bpmn ext add` that rebuilds the flat zeebe element `v` with `fix` laid over
 * its attributes (`--replace`: the element is replaced as a whole, so the
 * command carries every attribute it keeps); undefined when it has children.
 */
function replaceCommand(ctx: Ctx, host: El, owner: El | undefined, v: El, fix: Record<string, string>): string | undefined {
  if (kids(ctx, v).length) return undefined;
  const attrs: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as unknown as Record<string, unknown>)) {
    if (k.startsWith('$') || k.startsWith('xmlns') || val === undefined || val === null || typeof val === 'object') continue;
    attrs[k] = String(val);
  }
  Object.assign(attrs, fix);
  const args = Object.entries(attrs).map(([k, val]) => sh(`${k}=${val}`));
  return extAdd(ctx, host, owner, [v.$type, ...args, '--replace'].join(' '));
}

/** The replace command for `v`, or the list-and-rebuild hint when it has children. */
function fixHint(ctx: Ctx, host: El, owner: El | undefined, v: El, fix: Record<string, string>): string {
  const cmd = replaceCommand(ctx, host, owner, v, fix);
  return cmd ? `${cmd}.` : rebuildHint(ctx, host, owner, v.$type);
}

/** How to rebuild a zeebe element with its content: list it, then add it again with --replace (single-instance types). */
function rebuildHint(ctx: Ctx, host: El, owner: El | undefined, type: string): string {
  const addr = addressOf(host, owner);
  if (!addr) return 'Fix it in the XML.';
  return `See it with \`bpmn ext list <file> ${addr.id} --json\`, then rebuild it: \`bpmn ext add <file> ${addr.id} ${sh(`${addr.prefix}${type}`)} --replace --xml '<${type} ...>...</${type}>'\`.`;
}

/* ------------------------------------------------------------------ */
/* values                                                               */
/* ------------------------------------------------------------------ */

// what Camunda 8.9 parses (engine-checked on 60 values): an ISO 8601 period / duration (Java Period + Duration,
// split at an upper-case T; a fraction on the seconds only: PT1.5S, not PT1.5H), a date-time with offset or Z (an
// optional [zone] after it; t and z in either case), a repeating interval R[n]/[start/]duration, a 6-field cron
// expression or one of its macros
const PERIOD = /^[-+]?[Pp](?:[-+]?\d+[Yy])?(?:[-+]?\d+[Mm])?(?:[-+]?\d+[Ww])?(?:[-+]?\d+[Dd])?$/;
const DURATION = /^[-+]?P(?:T(?=[-+]?\d)(?:[-+]?\d+H)?(?:[-+]?\d+M)?(?:[-+]?\d+(?:[.,]\d{0,9})?S)?)$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[Zz]|[+-]\d{2}:\d{2}(?::\d{2})?)(?:\[[^\]]+\])?$/;
const CRON_MACROS = ['@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly'];

export function validDuration(value: string): boolean {
  const v = value.trim();
  const t = v.indexOf('T');
  if (t === -1) return PERIOD.test(v) && /\d/.test(v);
  const period = v.slice(0, t);
  if (!/^[-+]?[Pp]$/.test(period) && !(PERIOD.test(period) && /\d/.test(period))) return false;
  return DURATION.test(`P${v.slice(t)}`) && /\d/.test(v.slice(t));
}

export function validDateTime(value: string): boolean {
  return DATE_TIME.test(value.trim());
}

/**
 * Why Camunda 8 refuses a FEEL expression at deploy (the text after the `=`),
 * or undefined. The JUEL habits first, with their FEEL spelling (&&, ||, ==,
 * !, ${...}, single quotes), then the syntax check of platform/feel.ts (the
 * grammar Camunda 8.9 parses, engine-checked; every valid probe passes).
 */
export function feelProblem(expression: string): string | undefined {
  let code = '';
  for (let i = 0; i < expression.length; i++) {
    const c = expression[i]!;
    if (c === '"' || c === '`') {
      let j = i + 1;
      while (j < expression.length && expression[j] !== c) j += expression[j] === '\\' && c === '"' ? 2 : 1;
      if (j >= expression.length) break;
      code += c === '"' ? ' "s" ' : ' n ';
      i = j;
    } else if (c === '/' && expression[i + 1] === '/') {
      const end = expression.indexOf('\n', i);
      i = end === -1 ? expression.length : end;
    } else if (c === '/' && expression[i + 1] === '*') {
      const end = expression.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
    } else {
      code += c;
    }
  }
  if (/[$#]\{/.test(code)) return '${...} (JUEL; FEEL writes the expression itself: = amount > 100)';
  if (code.includes('&&')) return '&& (FEEL: and)';
  if (code.includes('||')) return '|| (FEEL: or)';
  if (code.includes('==')) return '== (FEEL compares with a single =)';
  if (/!(?!=)/.test(code)) return '! (FEEL: not(...))';
  if (code.includes("'")) return 'single quotes (FEEL strings use double quotes)';
  return feelSyntaxError(expression);
}

/** Zeebe attributes Camunda 8 parses as FEEL when they start with = (engine-checked). */
const FEEL_ATTRS: Record<string, string[]> = {
  taskDefinition: ['type', 'retries'],
  input: ['source'],
  output: ['source'],
  loopCharacteristics: ['inputCollection', 'outputElement'],
  calledElement: ['processId'],
  calledDecision: ['decisionId'],
  script: ['expression'],
  subscription: ['correlationKey'],
  assignmentDefinition: ['assignee', 'candidateGroups', 'candidateUsers'],
  taskSchedule: ['dueDate', 'followUpDate'],
  priorityDefinition: ['priority'],
  adHoc: ['activeElementsCollection', 'outputElement'],
};

/** W_C8_DEPLOY_EXPRESSION for a FEEL value (=...) with a slip feelProblem finds; true when it reported one. */
function checkFeel(ctx: Ctx, el: El, owner: El | undefined, subject: string, what: string, value: string | undefined, fix: string): boolean {
  if (!isFeel(value)) return false;
  const problem = feelProblem(value!.trim().slice(1));
  if (!problem) return false;
  push(ctx, 'deploy', 'W_C8_DEPLOY_EXPRESSION', el, owner, `feel:${subject}`, `${what} "${value!.trim()}" is no valid FEEL: ${problem}; Camunda 8 parses it at deploy and refuses the file`, fix);
  return true;
}

export function validCycle(value: string): boolean {
  const v = value.trim();
  const m = /^R-?\d*\/(.+)$/.exec(v);
  if (m) {
    const parts = m[1]!.split('/');
    if (parts.length === 1) return validDuration(parts[0]!);
    if (parts.length === 2) return validDateTime(parts[0]!) && validDuration(parts[1]!);
    return false;
  }
  if (CRON_MACROS.includes(v)) return true;
  return v.split(/\s+/).length === 6 && !v.startsWith('R');
}

/* ------------------------------------------------------------------ */
/* attributes and extension elements (placement, known names, foreign)   */
/* ------------------------------------------------------------------ */

/** Camunda 7 attributes that have a Camunda 8 counterpart, for hints. */
const C8_EQUIVALENT: Record<string, string> = {
  assignee: 'zeebe:assignmentDefinition assignee=<assignee>',
  candidateGroups: 'zeebe:assignmentDefinition candidateGroups=<groups>',
  candidateUsers: 'zeebe:assignmentDefinition candidateUsers=<users>',
  dueDate: 'zeebe:taskSchedule dueDate=<date>',
  followUpDate: 'zeebe:taskSchedule followUpDate=<date>',
  priority: 'zeebe:priorityDefinition priority=<0..100>',
  formKey: 'zeebe:formDefinition formId=<formId>',
  topic: 'zeebe:taskDefinition type=<jobType>',
  type: 'zeebe:taskDefinition type=<jobType>',
  class: 'zeebe:taskDefinition type=<jobType>',
  delegateExpression: 'zeebe:taskDefinition type=<jobType>',
  expression: 'zeebe:taskDefinition type=<jobType>',
  decisionRef: 'zeebe:calledDecision decisionId=<decisionId> resultVariable=<variable>',
  inputOutput: 'zeebe:input source==<expression> target=<variable>',
  versionTag: 'zeebe:versionTag value=<tag>',
};

function foreignHint(ctx: Ctx, el: El, owner: El | undefined, local: string, remove: string): string {
  const equivalent = C8_EQUIVALENT[local];
  return `Remove it: ${remove}${equivalent ? `; Camunda 8 reads ${extAdd(ctx, el, owner, equivalent.replace(/^zeebe:/, `${ctx.p}:`))}` : ''}.`;
}

/** zeebe:* / camunda:* / operaton:* attributes of a BPMN element. */
function checkAttributes(ctx: Ctx, el: El, owner: El | undefined): void {
  const addr = addressOf(el, owner);
  const where = describe(el, owner);
  for (const key of Object.keys(el.$attrs ?? {})) {
    const uri = uriOfName(key, ctx.ns);
    if (!uri) continue;
    const local = localName(key);
    const unset = addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${key}=`)}\`` : 'edit the XML';
    if (C7_URIS.has(uri)) {
      push(ctx, 'runtime', 'W_C8_FOREIGN_CONTENT', el, owner, `attr:${key}`, `${where} carries the Camunda 7 attribute ${key}, which Camunda 8 ignores`, foreignHint(ctx, el, owner, local, unset));
      continue;
    }
    if (uri !== ZEEBE_URI) continue;
    const def = zeebeAttr(local);
    if (!def) {
      // an attribute of a zeebe extension element written on the BPMN element (zeebe:assignee): name the element
      const home = zeebeTypeNames().find((t) => zeebeAllowedOn(t, el) === true && zeebeType(t)!.attributes.some((a) => a.name === local));
      const guess = home ? undefined : didYouMean(local, zeebeAttrs().map((a) => localName(a.name)));
      const value = String(el.$attrs[key] ?? '');
      push(
        ctx,
        'runtime',
        'W_C8_UNKNOWN_ATTRIBUTE',
        el,
        owner,
        `attr:${key}`,
        `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${ctx.p}:${guess}?)` : ''}; Camunda 8 ignores it${home ? ` (it reads ${local} on the ${z(ctx, localName(home))} extension element)` : ' (most zeebe settings are extension elements: `bpmn kinds`, `bpmn guide`)'}`,
        home ? `Move it: ${unset}, then ${extAdd(ctx, el, owner, `${z(ctx, localName(home))} ${sh(`${local}=${value}`)}`)}.` : `Remove it: ${unset}.`,
      );
      continue;
    }
    if (!def.owners.some((o) => is(el, o))) {
      push(ctx, 'runtime', 'W_C8_MISPLACED_ATTRIBUTE', el, owner, `attr:${key}`, `${key} on ${where} has no effect: Camunda 8 reads it on ${def.owners.map((o) => lowerFirst(localName(o))).join(', ')} only`, `Remove it: ${unset}.`);
    }
  }
}

/** Zeebe types Camunda 8 reads at most once per element (engine-checked: a second one is refused). */
const SINGLE: ReadonlySet<string> = new Set([
  'taskDefinition',
  'ioMapping',
  'taskHeaders',
  'userTask',
  'formDefinition',
  'assignmentDefinition',
  'priorityDefinition',
  'taskSchedule',
  'versionTag',
  'executionListeners',
  'taskListeners',
  'properties',
  'linkedResources',
  'adHoc',
  'calledElement',
  'calledDecision',
  'script',
  'publishMessage',
  'subscription',
  'loopCharacteristics',
  'conditionalFilter',
]);

/** Input mappings Camunda 8 ignores on these hosts (engine-checked; output mappings work there). */
function inputsIgnored(host: El): string | undefined {
  if (is(host, 'bpmn:StartEvent')) return 'start events';
  if (is(host, 'bpmn:BoundaryEvent')) return 'boundary events';
  const defs = list(host, 'eventDefinitions');
  if (is(host, 'bpmn:IntermediateThrowEvent') && !defs.length) return 'none intermediate throw events';
  if (is(host, 'bpmn:EndEvent') && !defs.length) return 'none end events';
  return undefined;
}

/** Extension elements of one BPMN element: foreign, unknown, misplaced, duplicates; then the content of each zeebe element. */
function checkExtensions(ctx: Ctx, host: El, owner: El | undefined): void {
  const values = extensionValues(ctx, host);
  if (!values.length) return;
  const addr = addressOf(host, owner);
  const where = describe(host, owner);
  const remove = (v: ExtValue): string => (addr ? `\`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${v.index}`)}\`` : 'remove it from the XML');
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v.uri) continue;
    if (C7_URIS.has(v.uri)) {
      push(ctx, 'runtime', 'W_C8_FOREIGN_CONTENT', host, owner, `ext:${v.el.$type}#${v.index}`, `${where} contains the Camunda 7 extension ${v.el.$type}, which Camunda 8 ignores`, foreignHint(ctx, host, owner, v.local, remove(v)));
      continue;
    }
    if (v.uri !== ZEEBE_URI) continue;
    const t = zeebeType(v.local);
    if (!t) {
      const guess = didYouMean(v.local, zeebeTypeNames().map(localName));
      push(ctx, 'runtime', 'W_C8_UNKNOWN_ELEMENT', host, owner, `ext:${v.local}`, `${where} has the unknown extension element ${z(ctx, v.local)}${guess ? ` (did you mean ${z(ctx, guess)}?)` : ''}; Camunda 8 ignores it`, `Remove it (${remove(v)})${guess && addr ? ` and add the right one: ${extAdd(ctx, host, owner, `${z(ctx, guess)} ...`)}` : ''}.`);
      continue;
    }
    if (zeebeNestedOnly(v.local)) {
      const container = zeebeContainersOf(v.local)[0]!;
      push(ctx, 'runtime', 'W_C8_MISPLACED_EXTENSION', host, owner, `ext:${v.local}`, `${z(ctx, v.local)} sits directly in the extension elements of ${where}, but belongs inside ${z(ctx, localName(container))}; Camunda 8 ignores it`, `Remove it (${remove(v)}) and add it again, \`bpmn ext add\` files it into its container: ${extAdd(ctx, host, owner, `${z(ctx, v.local)} ...`)}.`);
      continue;
    }
    if (v.local === 'executionListeners' && is(host, 'bpmn:SequenceFlow')) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_LISTENER', host, owner, 'listener:flow', `${where} has execution listeners; Camunda 8 supports them on processes, activities, events and gateways, not on sequence flows, and refuses the file`, `Remove them (${remove(v)}) and put them on the flow's source or target.`);
      continue;
    }
    if (zeebeAllowedOn(v.local, host) === false) {
      const hosts = t.allowedIn.filter((a) => a.startsWith('bpmn:')).map((a) => lowerFirst(localName(a)));
      push(ctx, 'runtime', 'W_C8_MISPLACED_EXTENSION', host, owner, `ext:${v.local}`, `${z(ctx, v.local)} on ${where} has no effect: Camunda 8 reads it on ${hosts.length > 5 ? `${hosts.slice(0, 5).join(', ')}, ...` : hosts.join(', ')} only`, `Remove it: ${remove(v)}.`);
      continue;
    }
    counts.set(v.local, (counts.get(v.local) ?? 0) + 1);
    checkZeebeElement(ctx, host, owner, v.el, '');
  }
  for (const [local, n] of counts) {
    if (n < 2 || !SINGLE.has(local)) continue;
    push(ctx, 'deploy', 'W_C8_DEPLOY_DUPLICATE_EXTENSION', host, owner, `dup:${local}`, `${where} has ${n} ${z(ctx, local)} elements; Camunda 8 reads one and refuses the file`, `Merge them into one: ${lowerFirst(rebuildHint(ctx, host, owner, z(ctx, local)).replace(/^See it/, 'See them'))}`);
  }
  // input mappings where the engine reads only outputs
  const ignored = inputsIgnored(host);
  if (ignored) {
    for (const io of zeebe(ctx, host, 'ioMapping')) {
      for (const input of kids(ctx, io, 'input')) {
        const target = attr(input, 'target') ?? '';
        push(ctx, 'runtime', 'W_C8_MISPLACED_EXTENSION', host, owner, `input:${target}`, `The input mapping ${target ? `to ${target} ` : ''}on ${where} has no effect: Camunda 8 ignores input mappings on ${ignored} (output mappings work there)`, addr ?`Remove it: \`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${z(ctx, 'input')}[target=${target}]`)}\` (set the variable in an activity before it, or as an output mapping of the element before).` : 'Remove it from the XML.');
      }
    }
  }
}

/** Attributes and children of a zeebe element (known names, placement), recursively; then the engine rules on its content. */
function checkZeebeElement(ctx: Ctx, host: El, owner: El | undefined, v: El, path: string): void {
  const local = localName(v.$type);
  const t = zeebeType(local);
  if (!t) return;
  const where = `${z(ctx, local)}${path ? ` (in ${path})` : ''} of ${describe(host, owner)}`;
  const names = new Set(t.attributes.map((a) => a.name));
  for (const k of Object.keys(v as unknown as Record<string, unknown>)) {
    if (k.startsWith('$') || k.startsWith('xmlns') || k.includes(':')) continue;
    if (names.has(k)) continue;
    const guess = didYouMean(k, [...names]);
    push(ctx, 'runtime', 'W_C8_UNKNOWN_ATTRIBUTE', host, owner, `ext:${path}/${local}@${k}`, `${where} has the unknown attribute ${k}${guess ? ` (did you mean ${guess}?)` : ''}; Camunda 8 ignores it`, rebuildHint(ctx, host, owner, z(ctx, path ? path.split(' > ')[0]!.replace(/^[^:]+:/, '') : local)));
  }
  for (const a of FEEL_ATTRS[local] ?? []) {
    const value = attr(v, a);
    const target = attr(v, 'target');
    // a mapping is replaced by its target: give the corrected one
    const fix =
      (local === 'input' || local === 'output') && target && isFeel(value)
        ? `${extAdd(ctx, host, owner, `${z(ctx, local)} ${sh(`source==${feelOf(value!.trim().slice(1)).trim()}`)} target=${sh(target)}`)} (replaces the mapping of that target; check the FEEL syntax).`
        : path
          ? rebuildHint(ctx, host, owner, z(ctx, localName(path.split(' > ')[0]!)))
          : fixHint(ctx, host, owner, v, { [a]: '=<FEEL expression>' });
    checkFeel(ctx, host, owner, `${path}/${local}@${a}`, `${a} of ${where}`, value, fix);
  }
  for (const c of kids(ctx, v)) {
    const cl = localName(c.$type);
    const childPath = path ? `${path} > ${z(ctx, local)}` : z(ctx, local);
    if (!t.children.includes(`zeebe:${cl}`)) {
      const known = zeebeType(cl);
      push(ctx, 'runtime', known ? 'W_C8_MISPLACED_EXTENSION' : 'W_C8_UNKNOWN_ELEMENT', host, owner, `ext:${childPath}/${cl}`, known ? `${z(ctx, cl)} does not belong inside ${z(ctx, local)} (${where}); Camunda 8 ignores it` : `${where} contains the unknown element ${z(ctx, cl)}; Camunda 8 ignores it`, rebuildHint(ctx, host, owner, z(ctx, path ? localName(path.split(' > ')[0]!) : local)));
      continue;
    }
    checkZeebeElement(ctx, host, owner, c, childPath);
  }
  if (!path) checkContent(ctx, host, owner, v, local);
}

const BINDING_TYPES = ['deployment', 'latest', 'versionTag'];
const PATH = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
const TASK_LISTENER_EVENTS = ['creating', 'assigning', 'updating', 'completing', 'canceling', 'create', 'assignment', 'update', 'complete', 'cancel'];

/** Engine rules on the content of one top-level zeebe element. */
function checkContent(ctx: Ctx, host: El, owner: El | undefined, v: El, local: string): void {
  const where = describe(host, owner);
  const rebuild = (): string => rebuildHint(ctx, host, owner, z(ctx, local));
  const addr = addressOf(host, owner);
  // bindingType / versionTag
  const binding = attr(v, 'bindingType');
  if (binding !== undefined && ['calledDecision', 'calledElement', 'formDefinition'].includes(local)) {
    if (!BINDING_TYPES.includes(binding)) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `${local}:bindingType`, `${z(ctx, local)} of ${where} has bindingType="${binding}"; Camunda 8 accepts ${BINDING_TYPES.join(', ')} only and refuses the file`, fixHint(ctx, host, owner, v, { bindingType: 'latest' }));
    } else if (binding === 'versionTag' && blank(attr(v, 'versionTag'))) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `${local}:versionTag`, `${z(ctx, local)} of ${where} has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file`, fixHint(ctx, host, owner, v, { versionTag: '<versionTag>' }));
    }
  }
  if (local === 'ioMapping') {
    for (const [kind, label] of [
      ['input', 'input'],
      ['output', 'output'],
    ] as const) {
      kids(ctx, v, kind).forEach((m, i) => {
        const target = attr(m, 'target');
        const sel = target ? `${z(ctx, kind)}[target=${target}]` : `${z(ctx, 'ioMapping')}/${z(ctx, kind)}[${i}]`;
        if (blank(target)) {
          push(ctx, 'deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `${kind}#${i}:target`, `The ${label} mapping ${i + 1} of ${where} has no target; Camunda 8 refuses the file`, addr ? `Remove it (\`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${sel}`)}\`) and add it with a target: ${extAdd(ctx, host, owner, `${z(ctx, kind)} source==<expression> target=<variable>`)}.` : 'Fix it in the XML.');
        } else if (!PATH.test(target!.trim())) {
          push(ctx, 'deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `${kind}:${target}:target`, `The ${label} mapping target "${target}" of ${where} is not a variable name or path (a.b.c); Camunda 8 refuses the file`, addr ? `Remove it (\`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${sel}`)}\`) and add it with a valid target: ${extAdd(ctx, host, owner, `${z(ctx, kind)} source=${sh(attr(m, 'source') ?? '=<expression>')} target=<variable>`)}.` : 'Fix it in the XML.');
        }
        if (kind === 'output' && blank(attr(m, 'source'))) {
          push(ctx, 'deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `output:${target ?? i}:source`, `The output mapping ${target ? `to ${target} ` : ''}of ${where} has no source; Camunda 8 refuses the file`, `${extAdd(ctx, host, owner, `${z(ctx, 'output')} source==<expression> target=${target ?? '<variable>'}`)} (replaces the mapping of that target).`);
        }
      });
    }
    return;
  }
  if (local === 'taskHeaders') {
    checkHeaders(ctx, host, owner, v, '');
    return;
  }
  if (local === 'executionListeners') {
    kids(ctx, v, 'executionListener').forEach((l, i) => {
      const ev = attr(l, 'eventType');
      const label = `Execution listener ${i + 1}${ev ? ` (${ev})` : ''} of ${where}`;
      const sel = addr ? `\`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${z(ctx, 'executionListeners')}/${z(ctx, 'executionListener')}[${i}]`)}\`` : 'remove it from the XML';
      const again = (fix: string): string => `${sel}, then ${extAdd(ctx, host, owner, `${z(ctx, 'executionListeners')}/${z(ctx, 'executionListener')} ${fix}`)}`;
      if (missing(attr(l, 'type'))) push(ctx, 'deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${i}:type`, `${label} has no type (the job type of its worker); Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=${ev ?? '<start|end>'} type=<jobType>`)}.`);
      if (ev === undefined || ev.trim() === '') push(ctx, 'deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${i}:eventType`, `${label} has no eventType; Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=<start|end> type=${attr(l, 'type') ?? '<jobType>'}`)}.`);
      else if (ev !== 'start' && ev !== 'end') push(ctx, 'deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${i}:eventType`, `${label}: eventType "${ev}" is not start or end; Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=<start|end> type=${attr(l, 'type') ?? '<jobType>'}`)}.`);
      else if (ev === 'start' && (is(host, 'bpmn:StartEvent') || is(host, 'bpmn:BoundaryEvent'))) push(ctx, 'deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${i}:start`, `${label}: Camunda 8 does not support start listeners on ${is(host, 'bpmn:StartEvent') ? 'start' : 'boundary'} events and refuses the file`, `Make it an end listener or remove it: ${again(`eventType=end type=${attr(l, 'type') ?? '<jobType>'}`)}.`);
      else if (ev === 'end' && is(host, 'bpmn:Gateway')) push(ctx, 'deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${i}:end`, `${label}: Camunda 8 does not support end listeners on gateways and refuses the file`, `Make it a start listener or remove it: ${again(`eventType=start type=${attr(l, 'type') ?? '<jobType>'}`)}.`);
      for (const h of kids(ctx, l, 'taskHeaders')) checkHeaders(ctx, host, owner, h, `execution listener ${i + 1}`);
    });
    return;
  }
  if (local === 'taskListeners') {
    if (!zeebe(ctx, host, 'userTask').length) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_LISTENER', host, owner, 'taskListeners:job', `${where} has task listeners but is a job worker user task (no ${z(ctx, 'userTask')}); Camunda 8 allows task listeners on Camunda user tasks only and refuses the file`, `Make it a Camunda user task: ${extAdd(ctx, host, owner, z(ctx, 'userTask'))} (or remove the listeners: \`bpmn ext remove <file> ${idOf(host)} ${z(ctx, 'taskListeners')}\`).`);
    }
    kids(ctx, v, 'taskListener').forEach((l, i) => {
      const ev = attr(l, 'eventType');
      const label = `Task listener ${i + 1}${ev ? ` (${ev})` : ''} of ${where}`;
      const again = (fix: string): string => `\`bpmn ext remove <file> ${idOf(host)} ${sh(`${z(ctx, 'taskListeners')}/${z(ctx, 'taskListener')}[${i}]`)}\`, then ${extAdd(ctx, host, owner, `${z(ctx, 'taskListeners')}/${z(ctx, 'taskListener')} ${fix}`)}`;
      if (missing(attr(l, 'type'))) push(ctx, 'deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `taskListener:${i}:type`, `${label} has no type (the job type of its worker); Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=${ev ?? '<event>'} type=<jobType>`)}.`);
      if (blank(ev)) push(ctx, 'deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `taskListener:${i}:eventType`, `${label} has no eventType; Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=<creating|assigning|updating|completing|canceling> type=${attr(l, 'type') ?? '<jobType>'}`)}.`);
      else if (!TASK_LISTENER_EVENTS.includes(ev!)) push(ctx, 'deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `taskListener:${i}:eventType`, `${label}: eventType "${ev}" is not one of creating, assigning, updating, completing, canceling; Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=<creating|assigning|updating|completing|canceling> type=${attr(l, 'type') ?? '<jobType>'}`)}.`);
    });
    return;
  }
  if (local === 'linkedResources') {
    kids(ctx, v, 'linkedResource').forEach((r, i) => {
      if (missing(attr(r, 'resourceType'))) push(ctx, 'deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `linkedResource:${i}:resourceType`, `Linked resource ${attr(r, 'linkName') ?? i + 1} of ${where} has no resourceType; Camunda 8 refuses the file`, rebuild());
      const b = attr(r, 'bindingType');
      if (b !== undefined && !BINDING_TYPES.includes(b)) push(ctx, 'deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `linkedResource:${i}:bindingType`, `Linked resource ${attr(r, 'linkName') ?? i + 1} of ${where} has bindingType="${b}"; Camunda 8 accepts ${BINDING_TYPES.join(', ')} only and refuses the file`, rebuild());
      else if (b === 'versionTag' && blank(attr(r, 'versionTag'))) push(ctx, 'deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `linkedResource:${i}:versionTag`, `Linked resource ${attr(r, 'linkName') ?? i + 1} of ${where} has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file`, rebuild());
    });
    return;
  }
  if (local === 'adHoc') {
    const oc = attr(v, 'outputCollection');
    const oe = attr(v, 'outputElement');
    if ((oc === undefined) !== (oe === undefined)) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, 'adHoc:output', `${z(ctx, 'adHoc')} of ${where} has ${oc !== undefined ? 'an outputCollection without outputElement' : 'an outputElement without outputCollection'}; Camunda 8 refuses the file`, `${extAdd(ctx, host, owner, `${z(ctx, 'adHoc')} ${oc !== undefined ? 'outputElement==<expression>' : 'outputCollection=<variable>'}`)}.`);
    }
    return;
  }
  if (local === 'conditionalFilter') {
    const events = attr(v, 'variableEvents');
    if (events !== undefined) {
      const bad = events.split(',').map((e) => e.trim()).filter((e) => e && e !== 'create' && e !== 'update');
      if (bad.length) push(ctx, 'deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, 'conditionalFilter:variableEvents', `${z(ctx, 'conditionalFilter')} of ${where} lists the variable events ${bad.join(', ')}; Camunda 8 knows create and update only and refuses the file`, `${rebuild()} (variableEvents=create,update)`);
    }
    return;
  }
  if (local === 'priorityDefinition') {
    const prio = attr(v, 'priority');
    if (prio !== undefined && prio !== '' && !isFeel(prio) && (!/^\s*\d+\s*$/.test(prio) || Number(prio) > 100)) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_USER_TASK', host, owner, 'priority', `${z(ctx, 'priorityDefinition')} of ${where} has priority "${prio}"; Camunda 8 needs a number from 0 to 100 (or an expression) and refuses the file`, fixHint(ctx, host, owner, v, { priority: '50' }));
    }
    return;
  }
  if (local === 'taskSchedule') {
    for (const a of ['dueDate', 'followUpDate']) {
      const d = attr(v, a);
      if (d !== undefined && !isFeel(d) && d.trim() !== '' && !validDateTime(d)) {
        push(ctx, 'deploy', 'W_C8_DEPLOY_USER_TASK', host, owner, `taskSchedule:${a}`, `${z(ctx, 'taskSchedule')} of ${where} has ${a}="${d}", which is no ISO 8601 date-time with offset (2030-03-02T15:35+02:00); Camunda 8 refuses the file`, fixHint(ctx, host, owner, v, { [a]: '2030-03-02T15:35+02:00' }).replace(/\.$/, ' (or an expression: =<FEEL>).'));
      }
    }
  }
}

/** Task headers: duplicate keys (refused), headers without key or value (dropped). */
function checkHeaders(ctx: Ctx, host: El, owner: El | undefined, headers: El, inWhat: string): void {
  const where = `${inWhat ? `${inWhat} of ` : ''}${describe(host, owner)}`;
  const seen = new Set<string>();
  kids(ctx, headers, 'header').forEach((h, i) => {
    const key = attr(h, 'key');
    const value = attr(h, 'value');
    if (blank(key) || blank(value)) {
      push(ctx, 'runtime', 'W_C8_BAD_VALUE', host, owner, `header:${inWhat}:${i}`, `Task header ${key ? `"${key}"` : i + 1} of ${where} has no ${blank(key) ? 'key' : 'value'}; Camunda 8 drops it, the job does not carry it`, idOf(host) && !inWhat ? `${blank(key) ? `Remove it (\`bpmn ext remove <file> ${idOf(host)} ${sh(`${z(ctx, 'taskHeaders')}/${z(ctx, 'header')}[${i}]`)}\`) and add it with a key` : 'Give it a value'}: ${extAdd(ctx, host, owner, `${z(ctx, 'header')} key=${key ?? '<key>'} value=<value>`)}.` : 'Fix it in the XML.');
    }
    if (key !== undefined && !blank(key)) {
      if (seen.has(key)) {
        push(ctx, 'deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `header:${inWhat}:dup:${key}`, `${where} has the task header "${key}" twice; Camunda 8 refuses the file`, idOf(host) && !inWhat ? `Keep one: \`bpmn ext remove <file> ${idOf(host)} ${sh(`${z(ctx, 'taskHeaders')}/${z(ctx, 'header')}[${i}]`)}\`.` : 'Remove one in the XML.');
      }
      seen.add(key);
    }
  });
}

/* ------------------------------------------------------------------ */
/* element rules                                                        */
/* ------------------------------------------------------------------ */

function messageOf(el: El): El | undefined {
  if (is(el, 'bpmn:ReceiveTask') || is(el, 'bpmn:SendTask')) return peek<El>(el, 'messageRef');
  const def = list(el, 'eventDefinitions').find((d) => is(d, 'bpmn:MessageEventDefinition'));
  return peek<El>(def, 'messageRef');
}

function nameOf(el: El | undefined): string | undefined {
  const n = peek<string>(el, 'name');
  return typeof n === 'string' && n.trim() !== '' ? n : undefined;
}

/** A job: exactly one zeebe:taskDefinition with a type (static job retries checked too). */
function checkTaskDefinition(ctx: Ctx, el: El, label: string, alternative?: { local: string; count: number; text: string }): void {
  const tds = zeebe(ctx, el, 'taskDefinition');
  const id = idOf(el)!;
  const alt = alternative?.count ?? 0;
  if (tds.length === 0 && alt === 0) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'impl', `${label} has no ${z(ctx, 'taskDefinition')}${alternative ? ` (nor ${alternative.text})` : ''}: Camunda 8 needs the job type a worker subscribes to and refuses the file`, `Give it a job type: \`bpmn ext add <file> ${id} ${z(ctx, 'taskDefinition')} type=<jobType>\`${alternative?.local === 'script' ? ` (or a FEEL script: \`bpmn ext add <file> ${id} ${z(ctx, 'script')} expression==<expression> resultVariable=<variable>\`)` : alternative?.local === 'calledDecision' ? ` (or call a DMN decision: \`bpmn ext add <file> ${id} ${z(ctx, 'calledDecision')} decisionId=<decisionId> resultVariable=<variable>\`)` : ''}.`);
    return;
  }
  if (tds.length && alt) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'impl:both', `${label} has both a ${z(ctx, 'taskDefinition')} and ${alternative!.text}; Camunda 8 needs exactly one of them and refuses the file`, `Keep one: \`bpmn ext remove <file> ${id} ${z(ctx, 'taskDefinition')}\` (or \`bpmn ext remove <file> ${id} ${z(ctx, alternative!.local)}\`).`);
  }
  for (const td of tds.slice(0, 1)) {
    const type = attr(td, 'type');
    if (missing(type)) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'impl:type', `The ${z(ctx, 'taskDefinition')} of ${label} has no type; Camunda 8 refuses the file`, fixHint(ctx, el, undefined, td, { type: '<jobType>' }));
    }
    const retries = attr(td, 'retries');
    if (retries !== undefined && !isFeel(retries) && !/^\s*-?\d+\s*$/.test(retries)) {
      push(ctx, 'runtime', 'W_C8_BAD_VALUE', el, undefined, 'retries', `The ${z(ctx, 'taskDefinition')} of ${label} has retries="${retries}", which is no number; it deploys, but every instance gets an incident when it reaches ${id}`, fixHint(ctx, el, undefined, td, { retries: '3' }));
    }
  }
}

/** The message a send task / message throw or end event references must have a name (when it references one). */
function checkThrownMessage(ctx: Ctx, el: El, label: string): void {
  const msg = messageOf(el);
  if (msg && !nameAttr(msg)) push(ctx, 'deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'messageName', `Message ${idOf(msg)} of ${label} has no name; Camunda 8 refuses the file`, `\`bpmn set <file> ${idOf(msg)} name=<MessageName>\`.`, [idOf(msg)!]);
}

function checkServiceLike(ctx: Ctx, el: El): void {
  const label = describe(el);
  const id = idOf(el)!;
  if (is(el, 'bpmn:ServiceTask')) {
    checkTaskDefinition(ctx, el, label);
  } else if (is(el, 'bpmn:SendTask')) {
    const pm = zeebe(ctx, el, 'publishMessage');
    checkTaskDefinition(ctx, el, label, { local: 'publishMessage', count: pm.length, text: `a ${z(ctx, 'publishMessage')}` });
    checkThrownMessage(ctx, el, label);
    if (pm.length && !zeebe(ctx, el, 'taskDefinition').length) checkPublishMessage(ctx, el, el, pm[0]!, label);
  } else if (is(el, 'bpmn:ScriptTask')) {
    const scripts = zeebe(ctx, el, 'script');
    checkTaskDefinition(ctx, el, label, { local: 'script', count: scripts.length, text: `a ${z(ctx, 'script')}` });
    const s = scripts[0];
    if (s && !zeebe(ctx, el, 'taskDefinition').length) {
      const expr = attr(s, 'expression');
      if (blank(expr)) push(ctx, 'deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'script:expression', `The ${z(ctx, 'script')} of ${label} has no expression; Camunda 8 refuses the file`, fixHint(ctx, el, undefined, s, { expression: '=<expression>' }));
      else if (!isFeel(expr)) push(ctx, 'deploy', 'W_C8_DEPLOY_EXPRESSION', el, undefined, 'script:expression', `The ${z(ctx, 'script')} expression "${expr}" of ${label} is a static value; Camunda 8 needs a FEEL expression starting with = and refuses the file`, fixHint(ctx, el, undefined, s, { expression: `=${expr!.trim()}` }));
      if (missing(attr(s, 'resultVariable'))) push(ctx, 'deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'script:resultVariable', `The ${z(ctx, 'script')} of ${label} has no resultVariable; Camunda 8 refuses the file`, fixHint(ctx, el, undefined, s, { resultVariable: '<variable>' }));
    }
  } else if (is(el, 'bpmn:BusinessRuleTask')) {
    const calls = zeebe(ctx, el, 'calledDecision');
    checkTaskDefinition(ctx, el, label, { local: 'calledDecision', count: calls.length, text: `a ${z(ctx, 'calledDecision')}` });
    const c = calls[0];
    if (c && !zeebe(ctx, el, 'taskDefinition').length) {
      if (missing(attr(c, 'decisionId'))) push(ctx, 'deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'decision:decisionId', `The ${z(ctx, 'calledDecision')} of ${label} has no decisionId; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} calledDecision=<decisionId>\`.`);
      if (missing(attr(c, 'resultVariable'))) push(ctx, 'deploy', 'W_C8_DEPLOY_IMPLEMENTATION', el, undefined, 'decision:resultVariable', `The ${z(ctx, 'calledDecision')} of ${label} has no resultVariable; Camunda 8 refuses the file`, fixHint(ctx, el, undefined, c, { resultVariable: '<variable>' }));
    }
  }
}

/** A message throw / end event: a job on the event, or a zeebe:publishMessage in its message event definition. */
function checkMessageThrow(ctx: Ctx, el: El, def: El): void {
  const label = describe(el);
  const pm = zeebe(ctx, def, 'publishMessage');
  checkTaskDefinition(ctx, el, label, { local: 'publishMessage', count: pm.length, text: `a ${z(ctx, 'publishMessage')} in its message event definition` });
  checkThrownMessage(ctx, el, label);
  if (pm.length && !zeebe(ctx, el, 'taskDefinition').length) checkPublishMessage(ctx, el, def, pm[0]!, label);
}

/** zeebe:publishMessage: Camunda 8.9 checks it (message, correlationKey) but does not execute it. */
function checkPublishMessage(ctx: Ctx, el: El, host: El, pm: El, label: string): void {
  const id = idOf(el)!;
  if (!messageOf(el)) push(ctx, 'deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, 'publish:messageRef', `${label} publishes no message (no message reference); Camunda 8 refuses the file`, `\`bpmn set <file> ${id} message=<MessageName>\`.`);
  if (missing(attr(pm, 'correlationKey'))) push(ctx, 'deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, 'publish:correlationKey', `The ${z(ctx, 'publishMessage')} of ${label} has no correlationKey; Camunda 8 refuses the file`, `${extAdd(ctx, host, host === el ? undefined : el, `${z(ctx, 'publishMessage')} correlationKey==<expression>`)}.`);
  const send = is(el, 'bpmn:SendTask');
  push(ctx, 'runtime', 'W_C8_UNSUPPORTED_IMPLEMENTATION', el, undefined, 'publishMessage', `${label} publishes its message with ${z(ctx, 'publishMessage')}: Camunda 8.9 accepts the file but does not run it (${send ? 'the instance gets an incident: only job worker send tasks are supported' : 'the event completes without sending anything'})`, `Use a job worker: \`bpmn ext remove <file> ${id} ${send ? '' : 'definition.'}${z(ctx, 'publishMessage')}\`, then \`bpmn ext add <file> ${id} ${z(ctx, 'taskDefinition')} type=<jobType>\`.`);
}

function checkCallActivity(ctx: Ctx, el: El): void {
  const id = idOf(el)!;
  const calls = zeebe(ctx, el, 'calledElement');
  const bpmnCalled = peek<string>(el, 'calledElement');
  if (!calls.length) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_CALLED_ELEMENT', el, undefined, 'calledElement', `Call activity ${id} has no ${z(ctx, 'calledElement')}${bpmnCalled ? ` (Camunda 8 does not read the BPMN calledElement="${bpmnCalled}")` : ''}; Camunda 8 refuses the file`, `\`bpmn ext add <file> ${id} ${z(ctx, 'calledElement')} processId=${sh(bpmnCalled || '<processId>')} propagateAllChildVariables=false\`.`);
    return;
  }
  if (missing(attr(calls[0], 'processId'))) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_CALLED_ELEMENT', el, undefined, 'processId', `The ${z(ctx, 'calledElement')} of call activity ${id} has no processId; Camunda 8 refuses the file`, fixHint(ctx, el, undefined, calls[0]!, { processId: '<processId>' }));
  }
}

function checkUserTask(ctx: Ctx, el: El): void {
  const id = idOf(el)!;
  const label = describe(el);
  const camunda = zeebe(ctx, el, 'userTask').length > 0;
  if (!camunda) {
    push(ctx, 'practice', 'W_C8_JOB_WORKER_USER_TASK', el, undefined, 'jobWorkerUserTask', `${label} has no ${z(ctx, 'userTask')}: Camunda 8 creates a job of type io.camunda.zeebe:userTask for it instead of a user task, which the v2 user task API (/v2/user-tasks) and Tasklist in V2 mode do not list`, `Make it a Camunda user task: \`bpmn ext add <file> ${id} ${z(ctx, 'userTask')}\` (a form then needs formId or externalReference instead of an embedded formKey).`);
  }
  const form = zeebe(ctx, el, 'formDefinition')[0];
  if (!form) return;
  const has = (a: string): boolean => !blank(attr(form, a));
  const [one, other] = camunda ? ['formId', 'externalReference'] : ['formId', 'formKey'];
  if (has(one!) === has(other!)) {
    const what = has(one!) ? `both ${one} and ${other}` : camunda && has('formKey') ? 'only an embedded formKey, which Camunda user tasks do not read' : `neither ${one} nor ${other}`;
    push(ctx, 'deploy', 'W_C8_DEPLOY_USER_TASK', el, undefined, 'form', `The ${z(ctx, 'formDefinition')} of ${camunda ? 'Camunda' : 'job worker'} user task ${id} has ${what}; Camunda 8 needs exactly one of ${one} and ${other} and refuses the file`, `Rebuild it with one of them: \`bpmn ext add <file> ${id} ${z(ctx, 'formDefinition')} formId=<formId> --replace\` (${camunda ? 'a linked form deployed with the process, or externalReference=<url>' : 'a linked form, or formKey=<key>'}).`);
  }
}

function checkMultiInstance(ctx: Ctx, activity: El): void {
  const loop = peek<El>(activity, 'loopCharacteristics');
  const id = idOf(activity)!;
  if (is(loop, 'bpmn:StandardLoopCharacteristics')) {
    push(ctx, 'runtime', 'W_C8_STANDARD_LOOP', activity, undefined, 'standardLoop', `${describe(activity)} has a standard loop; Camunda 8 does not support standard loops and runs the activity once`, `Remove it (\`bpmn set <file> ${id} loop=none\`) and model the loop with a gateway, or make it a multi-instance: \`bpmn set <file> ${id} loop=sequential\`, then \`bpmn ext add <file> ${id} loop.${z(ctx, 'loopCharacteristics')} inputCollection==<items> inputElement=<item>\`.`);
    return;
  }
  if (!is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) return;
  const zl = zeebe(ctx, loop!, 'loopCharacteristics');
  const add = `\`bpmn ext add <file> ${id} loop.${z(ctx, 'loopCharacteristics')} inputCollection==<items> inputElement=<item>\``;
  if (!zl.length) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi', `Multi-instance ${describe(activity)} has no ${z(ctx, 'loopCharacteristics')} on its loop (a BPMN loop cardinality or a camunda:collection is not read); Camunda 8 refuses the file`, `${add} (outputCollection=<results> outputElement==<expression> collects results).`);
  } else {
    const l = zl[0]!;
    const input = attr(l, 'inputCollection');
    if (blank(input)) push(ctx, 'deploy', 'W_C8_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi:inputCollection', `The ${z(ctx, 'loopCharacteristics')} of multi-instance ${describe(activity)} has no inputCollection; Camunda 8 refuses the file`, fixHint(ctx, loop!, activity, l, { inputCollection: '=<items>' }));
    else if (!isFeel(input)) push(ctx, 'deploy', 'W_C8_DEPLOY_EXPRESSION', activity, undefined, 'mi:inputCollection', `inputCollection="${input}" of multi-instance ${describe(activity)} is a static value; Camunda 8 needs a FEEL expression (=${input!.trim()}) and refuses the file`, fixHint(ctx, loop!, activity, l, { inputCollection: `=${input!.trim()}` }));
    const oc = attr(l, 'outputCollection');
    const oe = attr(l, 'outputElement');
    if ((oc === undefined) !== (oe === undefined)) push(ctx, 'deploy', 'W_C8_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi:output', `The ${z(ctx, 'loopCharacteristics')} of multi-instance ${describe(activity)} has ${oc !== undefined ? 'an outputCollection without outputElement' : 'an outputElement without outputCollection'}; Camunda 8 refuses the file`, `\`bpmn ext add <file> ${id} loop.${z(ctx, 'loopCharacteristics')} ${oc !== undefined ? 'outputElement==<expression>' : 'outputCollection=<variable>'}\`.`);
    else if (oe !== undefined && !isFeel(oe)) push(ctx, 'deploy', 'W_C8_DEPLOY_EXPRESSION', activity, undefined, 'mi:outputElement', `outputElement="${oe}" of multi-instance ${describe(activity)} is a static value; Camunda 8 needs a FEEL expression (=${oe.trim()}) and refuses the file`, fixHint(ctx, loop!, activity, l, { outputElement: `=${oe.trim()}` }));
  }
  const cc = peek<El>(loop, 'completionCondition');
  const body = peek<string>(cc, 'body');
  if (cc) checkFeel(ctx, activity, undefined, 'mi:completion', `The completion condition of multi-instance ${describe(activity)}`, body, `\`bpmn set <file> ${id} ${sh(`completion==${feelOf((body ?? '').trim().slice(1))}`)}\` (check the FEEL syntax).`);
  if (cc && !isFeel(body)) {
    push(ctx, 'runtime', 'W_C8_EXPRESSION', activity, undefined, 'mi:completion', `The completion condition "${body ?? ''}" of multi-instance ${describe(activity)} is no FEEL expression (=...); it deploys, but every completed instance gets an incident (expected a boolean, got a string)`, `\`bpmn set <file> ${id} ${sh(`completion==${feelOf(body ?? '')}`)}\` (check the FEEL syntax).`);
  }
}

/** `${a && b}` -> ` a and b` (a starting point for FEEL; the hint asks to check it). */
function feelOf(juel: string): string {
  const m = /^\s*[$#]\{([\s\S]*)\}\s*$/.exec(juel);
  const inner = (m ? m[1]! : juel).trim();
  // JUEL strings may be single-quoted, FEEL strings are double-quoted
  const quoted = inner.replace(/'((?:[^'\\]|\\.)*)'/g, (_m, text: string) => `"${text.replace(/"/g, '\\"')}"`);
  return ` ${quoted.replace(/&&/g, 'and').replace(/\|\|/g, 'or').replace(/==/g, '=').replace(/!\s*\((?!=)/g, 'not(').replace(/!(?!=)\s*([\w.]+)/g, 'not($1)')}`;
}

function checkFlow(ctx: Ctx, flow: El): void {
  const cond = peek<El>(flow, 'conditionExpression');
  if (!cond) return;
  const id = idOf(flow)!;
  const body = peek<string>(cond, 'body') ?? '';
  const source = peek<El>(flow, 'sourceRef');
  checkFeel(ctx, flow, undefined, 'condition', `The condition of sequence flow ${id}`, body, `\`bpmn set <file> ${id} ${sh(`condition==${feelOf(body.trim().slice(1))}`)}\` (check the FEEL syntax: and / or, = for equality, not(...)).`);
  if (!isFeel(body)) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_EXPRESSION', flow, undefined, 'condition', `The condition "${body.trim()}" of sequence flow ${id} is no FEEL expression; Camunda 8 needs one starting with = and refuses the file`, body.trim() ? `\`bpmn set <file> ${id} ${sh(`condition==${feelOf(body)}`)}\` (check the FEEL syntax: and / or, = for equality).` : `Give it one (\`bpmn set <file> ${id} ${sh('condition== <expression>')}\`) or remove it (\`bpmn set <file> ${id} condition=\`).`);
  }
  // (a complex gateway is not supported at all: E_UNSUPPORTED_KIND)
  if (source && !is(source, 'bpmn:ExclusiveGateway') && !is(source, 'bpmn:InclusiveGateway') && !is(source, 'bpmn:ComplexGateway')) {
    push(ctx, 'runtime', 'W_C8_CONDITION_IGNORED', flow, undefined, 'conditionIgnored', `Sequence flow ${id} out of ${describe(source)} has a condition; Camunda 8 evaluates conditions at exclusive and inclusive gateways only and always takes this flow`, `Remove it (\`bpmn set <file> ${id} condition=\`), or branch with a gateway: \`bpmn add <file> exclusiveGateway "<Question?>" --after ${idOf(source)}\`, then move the condition onto its flows.`);
  }
}

function checkBranchingGateway(ctx: Ctx, gw: El): void {
  const flows = ctx.outgoing.get(gw) ?? [];
  if (flows.length < 2) return;
  const def = peek<El>(gw, 'default');
  for (const f of flows) {
    if (f === def || peek<El>(f, 'conditionExpression')) continue;
    push(ctx, 'runtime', 'W_C8_EXCLUSIVE_GATEWAY', gw, undefined, `noCondition:${idOf(f)}`, `Sequence flow ${idOf(f)} out of ${describe(gw)} has no condition and is not the default flow: Camunda 8 never takes it (an instance where no condition holds gets an incident)`, `Make it the default flow (\`bpmn set <file> ${idOf(f)} default=true\`) or give it a condition: \`bpmn set <file> ${idOf(f)} ${sh('condition== <expression>')}\`.`, [idOf(f)!]);
  }
}

function checkEventGateway(ctx: Ctx, gw: El): void {
  const id = idOf(gw)!;
  const flows = ctx.outgoing.get(gw) ?? [];
  // the engine counts the <bpmn:outgoing> entries of the gateway, which a file may leave out (mirror.ts writes them the file's way)
  const listed = flows.filter((f) => !ctx.unlisted.has(f) || ctx.unlisted.get(f) !== gw);
  if (flows.length < 2) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_EVENT_GATEWAY', gw, undefined, 'branches', `Event-based gateway ${id} has ${flows.length} outgoing flow${flows.length === 1 ? '' : 's'}; Camunda 8 needs at least two and refuses the file`, `Add a branch: \`bpmn add <file> intermediateCatchEvent:timer "<Timeout>" --after ${id} --timer PT1H\`.`);
  } else if (listed.length < 2) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_EVENT_GATEWAY', gw, undefined, 'branches', `Event-based gateway ${id} has ${flows.length} outgoing flows, but the file lists ${listed.length} of them as its <bpmn:outgoing> entries; Camunda 8 counts the listed ones and refuses the file`, `Add the missing <bpmn:outgoing>${flows.filter((f) => !listed.includes(f)).map(idOf).join('</bpmn:outgoing>, <bpmn:outgoing>')}</bpmn:outgoing> entries to ${id} in the XML (Camunda Modeler writes them; this file leaves the lists out, and \`bpmn\` keeps a file's style).`);
  }
  for (const f of flows) {
    const t = peek<El>(f, 'targetRef');
    if (!t) continue;
    const defs = list(t, 'eventDefinitions');
    const ok = is(t, 'bpmn:IntermediateCatchEvent') && defs.length === 1 && ['Message', 'Timer', 'Signal', 'Conditional'].some((k) => is(defs[0], `bpmn:${k}EventDefinition`));
    if (!ok) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_EVENT_GATEWAY', gw, undefined, `target:${idOf(t)}`, `Event-based gateway ${id} leads to ${describe(t)}; Camunda 8 allows only message, timer, signal and conditional intermediate catch events after it and refuses the file`, is(t, 'bpmn:ReceiveTask') ? `Use a message catch event: \`bpmn retype <file> ${idOf(t)} intermediateCatchEvent:message --message ${sh(nameOf(messageOf(t)) ?? '<MessageName>')}\`.` : `Put a catch event in between: \`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow ${idOf(f)} --message <MessageName>\` (or retype ${idOf(t)}).`, [idOf(t)!, idOf(f)!]);
    }
  }
}

/* events ------------------------------------------------------------ */

function triggerName(def: El): string {
  return lowerFirst(localName(def.$type).replace(/EventDefinition$/, ''));
}

function isEventSubProcess(el: El | undefined): boolean {
  return !!el && is(el, 'bpmn:SubProcess') && peek<boolean>(el, 'triggeredByEvent') === true;
}

function nonInterrupting(el: El): boolean {
  if (is(el, 'bpmn:BoundaryEvent')) return peek<boolean>(el, 'cancelActivity') === false;
  if (is(el, 'bpmn:StartEvent')) return peek<boolean>(el, 'isInterrupting') === false;
  return false;
}

function checkTimer(ctx: Ctx, el: El, def: El): void {
  const id = idOf(el)!;
  const label = describe(el);
  const kinds = ['timeDate', 'timeCycle', 'timeDuration'].filter((k) => peek<El>(def, k));
  if (kinds.length !== 1) {
    // two of them is a schema error the engine reports first (checkSchemaEventDefinitions)
    if (!kinds.length) push(ctx, 'deploy', 'W_C8_DEPLOY_TIMER', el, undefined, 'timer', `Timer of ${label} has no date, cycle or duration; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} timer=PT1H\` (a duration; R/PT1H is a cycle, an ISO date-time with offset a date).`);
    return;
  }
  const kind = kinds[0]!;
  const value = (peek<string>(peek<El>(def, kind), 'body') ?? '').trim();
  const catchEvent = is(el, 'bpmn:IntermediateCatchEvent');
  if (kind === 'timeCycle' && catchEvent) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_TIMER', el, undefined, 'timer:cycle', `Timer catch event ${id} has a cycle; Camunda 8 allows only a duration or a date on intermediate timer catch events and refuses the file`, `\`bpmn set <file> ${id} timer=PT1H\` (a duration, or a date-time).`);
    return;
  }
  if (kind === 'timeCycle' && (is(el, 'bpmn:BoundaryEvent') || (is(el, 'bpmn:StartEvent') && isEventSubProcess(el.$parent as El))) && !nonInterrupting(el)) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_TIMER', el, undefined, 'timer:interruptingCycle', `${label} is an interrupting timer with a cycle; Camunda 8 refuses interrupting cycles`, `Make it non-interrupting (\`bpmn set <file> ${id} nonInterrupting=true\`) or use a duration (\`bpmn set <file> ${id} timer=PT1H\`).`);
  }
  if (isFeel(value) || value === '') {
    checkFeel(ctx, el, undefined, 'timer', `The ${kind} of ${label}`, value, `\`bpmn set <file> ${id} ${sh('timer==<FEEL expression>')}\` (check the FEEL syntax).`);
    if (value === '') push(ctx, 'deploy', 'W_C8_DEPLOY_TIMER', el, undefined, 'timer:value', `The ${kind} of ${label} is empty; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} timer=PT1H\`.`);
    return;
  }
  const ok = kind === 'timeDuration' ? validDuration(value) : kind === 'timeDate' ? validDateTime(value) : validCycle(value);
  if (!ok) {
    const expected = kind === 'timeDuration' ? 'an ISO 8601 duration (PT1H, P2D)' : kind === 'timeDate' ? 'an ISO 8601 date-time with offset (2030-12-31T10:00:00Z, ...+01:00)' : 'a repeating interval (R/PT1H, R5/2030-01-01T08:00:00Z/P1D) or a 6-field cron expression (0 0 9 * * MON)';
    push(ctx, 'deploy', 'W_C8_DEPLOY_TIMER', el, undefined, 'timer:value', `The ${kind} "${value}" of ${label} is not ${expected}; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} ${sh(`timer=${kind === 'timeDuration' ? 'PT1H' : kind === 'timeDate' ? '2030-12-31T10:00:00Z' : 'R/PT1H'}`)}\` (or a FEEL expression: ${sh('timer==<expression>')} with --timer-kind ${kind.replace('time', '').toLowerCase()}).`);
  }
}

function checkEvent(ctx: Ctx, el: El): void {
  const id = idOf(el)!;
  const label = describe(el);
  const defs = list(el, 'eventDefinitions');
  const parent = el.$parent as El | undefined;
  if (defs.length > 1) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'definitions', `${label} has ${defs.length} event definitions (${defs.map(triggerName).join(', ')}); Camunda 8 allows one and refuses the file`, `Keep one: \`bpmn set <file> ${id} trigger=<${defs.map(triggerName).join('|')}>\` (keeps that definition, drops the others), and model each other trigger as its own event.`);
    return;
  }
  const def = defs[0];
  if (!def) {
    if (is(el, 'bpmn:IntermediateCatchEvent') || is(el, 'bpmn:BoundaryEvent')) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'none', `${label} has no event definition; Camunda 8 refuses ${is(el, 'bpmn:BoundaryEvent') ? 'boundary' : 'intermediate catch'} events without a trigger`, `Give it one: \`bpmn set <file> ${id} trigger=timer timer=PT1H\` (or message, signal, ...).`);
    }
    if (is(el, 'bpmn:StartEvent') && isEventSubProcess(parent)) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'eventSubStart', `Start event ${id} of event sub-process ${idOf(parent)} has no trigger; Camunda 8 needs a message, timer, error, signal, escalation or conditional start there and refuses the file`, `\`bpmn set <file> ${id} trigger=message message=<MessageName>\` (or timer, error, signal, escalation, conditional).`);
    }
    return;
  }
  const trigger = triggerName(def);
  // definition kinds a position does not support
  if (is(def, 'bpmn:CancelEventDefinition')) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_UNSUPPORTED', el, undefined, 'cancel', `${label} is a cancel event; Camunda 8 does not support cancel events (nor transactions) and refuses the file`, `\`bpmn set <file> ${id} trigger=${is(el, 'bpmn:BoundaryEvent') ? 'error' : 'none'}\`${is(el, 'bpmn:BoundaryEvent') ? ' (an error boundary event)' : ''}.`);
    return;
  }
  if (is(el, 'bpmn:StartEvent') && parent && is(parent, 'bpmn:SubProcess') && !isEventSubProcess(parent) && !is(parent, 'bpmn:AdHocSubProcess')) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_START_EVENT', el, undefined, 'subStartType', `Start event ${id} of sub-process ${idOf(parent)} has a ${trigger} trigger; Camunda 8 allows only a none start event in an embedded sub-process and refuses the file`, `\`bpmn set <file> ${id} trigger=none\` (an event sub-process takes triggered starts: \`bpmn add <file> eventSubProcess:${trigger} ... --in ${idOf(parent)}\`).`);
    return;
  }
  if (is(el, 'bpmn:StartEvent') && isEventSubProcess(parent) && is(def, 'bpmn:CompensateEventDefinition')) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'eventSubStart', `Start event ${id} of event sub-process ${idOf(parent)} has a compensation trigger; Camunda 8 needs a message, timer, error, signal, escalation or conditional start there and refuses the file`, `\`bpmn set <file> ${id} trigger=<message|timer|error|signal|escalation|conditional>\`.`);
    return;
  }
  // definitions the engine needs an id on (8.9 fails on them otherwise)
  const needsId = is(def, 'bpmn:ConditionalEventDefinition') || is(def, 'bpmn:CompensateEventDefinition') || (is(def, 'bpmn:LinkEventDefinition') && is(el, 'bpmn:CatchEvent'));
  if (needsId && !idOf(def)) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'definitionId', `The ${trigger} event definition of ${label} has no id; Camunda 8.9 refuses the file (an internal error: "Cannot invoke String.getBytes ... value is null")`, `\`bpmn set <file> ${id} definition.id=${localName(def.$type)}_${id.replace(/^[A-Za-z]+_/, '')}\` (Camunda Modeler gives every event definition an id).`);
  }
  if (is(def, 'bpmn:MessageEventDefinition')) {
    if (is(el, 'bpmn:ThrowEvent')) checkMessageThrow(ctx, el, def);
    else checkMessageCatch(ctx, el);
  } else if (is(def, 'bpmn:TimerEventDefinition')) {
    checkTimer(ctx, el, def);
  } else if (is(def, 'bpmn:SignalEventDefinition')) {
    const sig = peek<El>(def, 'signalRef');
    if (!sig) push(ctx, 'deploy', 'W_C8_DEPLOY_SIGNAL', el, undefined, 'signalRef', `${label} has no signal; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} signal=<SignalName>\`.`);
    else if (!nameAttr(sig)) push(ctx, 'deploy', 'W_C8_DEPLOY_SIGNAL', el, undefined, 'signalName', `Signal ${idOf(sig)} of ${label} has no name; Camunda 8 refuses the file`, `\`bpmn set <file> ${idOf(sig)} name=<SignalName>\`.`, [idOf(sig)!]);
    else if (is(el, 'bpmn:StartEvent') && isFeel(nameOf(sig))) push(ctx, 'deploy', 'W_C8_DEPLOY_SIGNAL', el, undefined, 'signalName', `Start event ${id} catches the signal "${nameOf(sig)}", a FEEL expression; Camunda 8 needs a static signal name on start events and refuses the file`, `\`bpmn set <file> ${idOf(sig)} name=<SignalName>\`.`, [idOf(sig)!]);
  } else if (is(def, 'bpmn:ErrorEventDefinition')) {
    const err = peek<El>(def, 'errorRef');
    const code = peek<string>(err, 'errorCode');
    if (is(el, 'bpmn:ThrowEvent')) {
      if (!err) push(ctx, 'deploy', 'W_C8_DEPLOY_ERROR', el, undefined, 'errorRef', `${label} throws no error (no errorRef); Camunda 8 refuses the file`, `\`bpmn set <file> ${id} error=<ErrorName> errorCode=<CODE>\`.`);
      else if (missing(code)) push(ctx, 'deploy', 'W_C8_DEPLOY_ERROR', el, undefined, 'errorCode', `Error ${idOf(err)} thrown by ${label} has no errorCode; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} errorCode=<CODE>\`.`, [idOf(err)!]);
    } else {
      if (isFeel(code)) push(ctx, 'deploy', 'W_C8_DEPLOY_ERROR', el, undefined, 'errorCode', `${label} catches the error code "${code}", an expression; Camunda 8 needs a static code on catching error events and refuses the file`, `\`bpmn set <file> ${id} errorCode=<CODE>\` (or no code: it catches every error).`, err ? [idOf(err)!] : []);
      if (nonInterrupting(el)) push(ctx, 'deploy', 'W_C8_DEPLOY_ERROR', el, undefined, 'nonInterrupting', `${label} is a non-interrupting error event; Camunda 8 refuses it (error events always interrupt)`, `\`bpmn set <file> ${id} nonInterrupting=false\`.`);
    }
  } else if (is(def, 'bpmn:EscalationEventDefinition')) {
    if (is(el, 'bpmn:ThrowEvent')) {
      const esc = peek<El>(def, 'escalationRef');
      if (!esc) push(ctx, 'deploy', 'W_C8_DEPLOY_ESCALATION', el, undefined, 'escalationRef', `${label} throws no escalation (no escalationRef); Camunda 8 refuses the file`, `\`bpmn set <file> ${id} escalation=<Name> escalationCode=<CODE>\`.`);
      else if (missing(peek<string>(esc, 'escalationCode'))) push(ctx, 'deploy', 'W_C8_DEPLOY_ESCALATION', el, undefined, 'escalationCode', `Escalation ${idOf(esc)} thrown by ${label} has no escalationCode; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} escalationCode=<CODE>\`.`, [idOf(esc)!]);
    } else if (is(el, 'bpmn:BoundaryEvent')) {
      const host = peek<El>(el, 'attachedToRef');
      if (host && !is(host, 'bpmn:SubProcess') && !is(host, 'bpmn:CallActivity')) {
        push(ctx, 'deploy', 'W_C8_DEPLOY_ESCALATION', el, undefined, 'escalationHost', `Escalation boundary event ${id} is attached to ${describe(host)}; Camunda 8 allows it only on sub-processes and call activities and refuses the file`, `Attach it elsewhere (\`bpmn move <file> ${id} --on <subProcessId>\`) or remove it: \`bpmn remove <file> ${id}\`.`, [idOf(host)!]);
      }
    }
  } else if (is(def, 'bpmn:CompensateEventDefinition')) {
    if (is(el, 'bpmn:ThrowEvent')) checkCompensationRef(ctx, el, def);
    if (is(el, 'bpmn:BoundaryEvent')) checkCompensationBoundary(ctx, el);
  } else if (is(def, 'bpmn:ConditionalEventDefinition')) {
    const body = peek<string>(peek<El>(def, 'condition'), 'body');
    checkFeel(ctx, el, undefined, 'condition', `The condition of conditional event ${id}`, body, `\`bpmn set <file> ${id} ${sh(`when==${feelOf((body ?? '').trim().slice(1))}`)}\` (check the FEEL syntax).`);
    if (peek<El>(def, 'condition') && !isFeel(body)) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_EXPRESSION', el, undefined, 'condition', `The condition "${(body ?? '').trim()}" of conditional event ${id} is no FEEL expression; Camunda 8 needs one starting with = and refuses the file`, `\`bpmn set <file> ${id} ${sh(`when==${feelOf(body ?? '')}`)}\` (check the FEEL syntax).`);
    }
  }
}

function checkMessageCatch(ctx: Ctx, el: El): void {
  const id = idOf(el)!;
  const label = describe(el);
  const msg = messageOf(el);
  if (!msg) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, 'messageRef', `${label} has no message; Camunda 8 refuses the file`, `\`bpmn set <file> ${id} message=<MessageName>\` (creates the bpmn:Message), then give it a correlation key: \`bpmn ext add <file> <messageId> ${z(ctx, 'subscription')} correlationKey==<expression>\`.`);
    return;
  }
  const mid = idOf(msg)!;
  const name = nameAttr(msg);
  if (!name) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, 'messageName', `Message ${mid} of ${label} has no name; Camunda 8 refuses the file`, `\`bpmn set <file> ${mid} name=<MessageName>\`.`, [mid]);
    return;
  }
  const processStart = is(el, 'bpmn:StartEvent') && is(el.$parent as El, 'bpmn:Process');
  if (processStart) {
    if (isFeel(name)) push(ctx, 'deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, 'messageName', `Start event ${id} catches the message "${name}", a FEEL expression; Camunda 8 needs a static message name on process start events and refuses the file`, `\`bpmn set <file> ${mid} name=<MessageName>\`.`, [mid]);
    return;
  }
  const subs = zeebe(ctx, msg, 'subscription');
  // two of them: W_C8_DEPLOY_DUPLICATE_EXTENSION on the message
  if (subs.length > 1) return;
  if (!subs.length) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, `subscription:${mid}`, `Message ${mid} ("${name}") of ${label} has no ${z(ctx, 'subscription')}: Camunda 8 needs one with the correlation key that matches a message to an instance and refuses the file`, `\`bpmn ext add <file> ${mid} ${z(ctx, 'subscription')} correlationKey==<expression>\` (e.g. correlationKey==orderId).`, [mid]);
    return;
  }
  const key = attr(subs[0], 'correlationKey');
  if (blank(key)) push(ctx, 'deploy', 'W_C8_DEPLOY_MESSAGE', el, undefined, `correlationKey:${mid}`, `The ${z(ctx, 'subscription')} of message ${mid} ("${name}") has no correlationKey; Camunda 8 refuses the file`, fixHint(ctx, msg, undefined, subs[0]!, { correlationKey: '=<expression>' }), [mid]);
  else if (!isFeel(key)) push(ctx, 'deploy', 'W_C8_DEPLOY_EXPRESSION', el, undefined, `correlationKey:${mid}`, `The correlationKey "${key}" of message ${mid} is a static value; Camunda 8 needs a FEEL expression (=${key!.trim()}) and refuses the file`, fixHint(ctx, msg, undefined, subs[0]!, { correlationKey: `=${key!.trim()}` }), [mid]);
}

/** A compensation throw event's activityRef must name an activity of its own scope (engine-checked). */
function checkCompensationRef(ctx: Ctx, el: El, def: El): void {
  const ref = peek<El>(def, 'activityRef');
  if (!ref) return;
  const scope = ctx.doc.scopeOf(el);
  if (ctx.doc.scopeOf(ref) === scope) return;
  push(ctx, 'deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'activityRef', `Compensation event ${idOf(el)} names ${idOf(ref)}, which is not in its own scope ${idOf(scope)}; Camunda 8 refuses the file`, `\`bpmn set <file> ${idOf(el)} definition.activityRef=<activityId>\` (an activity of ${idOf(scope)}), or \`definition.activityRef=\` to compensate the whole scope.`, [idOf(ref)!]);
}

/** A compensation boundary event needs an association to its handler and no outgoing flow (engine-checked). */
function checkCompensationBoundary(ctx: Ctx, el: El): void {
  const id = idOf(el)!;
  const scope = ctx.doc.scopeOf(el);
  const associated = list(scope, 'artifacts').some((a) => is(a, 'bpmn:Association') && peek<El>(a, 'sourceRef') === el);
  const out = ctx.outgoing.get(el) ?? [];
  if (!associated || out.length) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', el, undefined, 'compensationBoundary', `Compensation boundary event ${id} ${!associated ? 'has no association to a compensation handler' : 'has an outgoing sequence flow'}; Camunda 8 refuses the file`, !associated ? `Connect it to its handler (an activity with isForCompensation=true): \`bpmn connect <file> ${id} <handlerId>\`.` : `Remove the flow (\`bpmn remove <file> ${idOf(out[0])} --no-bridge\`) and connect the handler instead: \`bpmn connect <file> ${id} <handlerId>\`.`);
  }
}

/* scopes ------------------------------------------------------------ */

function checkStartEvents(ctx: Ctx, scope: El): void {
  const id = idOf(scope)!;
  const starts = ctx.doc.flowNodes(scope).filter((n) => is(n, 'bpmn:StartEvent'));
  if (is(scope, 'bpmn:Process')) {
    if (!starts.length) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_START_EVENT', scope, undefined, 'noStart', `Process ${id} has no start event; Camunda 8 refuses the file`, `\`bpmn add <file> startEvent "<Name>" --before <firstNodeId>\` (or --in ${id}).`);
      return;
    }
    const none = starts.filter((s) => !list(s, 'eventDefinitions').length);
    for (const extra of none.slice(1)) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_START_EVENT', extra, undefined, 'noneStart', `Process ${id} has ${none.length} none start events (${none.map(idOf).join(', ')}); Camunda 8 allows one and refuses the file`, `Remove ${idOf(extra)} (\`bpmn remove <file> ${idOf(extra)}\`) or give it a trigger: \`bpmn set <file> ${idOf(extra)} trigger=message message=<MessageName>\`.`, [idOf(none[0])!]);
    }
    return;
  }
  if (is(scope, 'bpmn:AdHocSubProcess') || is(scope, 'bpmn:Transaction')) return;
  const event = isEventSubProcess(scope);
  if (starts.length !== 1) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_START_EVENT', scope, undefined, 'startCount', `${event ? 'Event sub-process' : 'Sub-process'} ${id} has ${starts.length ? `${starts.length} start events` : 'no start event'}; Camunda 8 needs exactly one and refuses the file`, starts.length ? `Keep one: \`bpmn remove <file> ${idOf(starts[1])}\`.` : event ? `\`bpmn add <file> startEvent:message "<Name>" --in ${id} --message <MessageName>\` (or timer, error, signal, escalation, conditional).` : `\`bpmn add <file> startEvent "<Name>" --in ${id}\`, then connect it to the first node.`);
  }
}

function checkAdHoc(ctx: Ctx, el: El): void {
  const id = idOf(el)!;
  const nodes = ctx.doc.flowNodes(el);
  for (const n of nodes) {
    if (is(n, 'bpmn:StartEvent') || is(n, 'bpmn:EndEvent')) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_AD_HOC_SUBPROCESS', el, undefined, `adHoc:${idOf(n)}`, `Ad-hoc sub-process ${id} contains the ${is(n, 'bpmn:StartEvent') ? 'start' : 'end'} event ${idOf(n)}; Camunda 8 refuses start and end events in ad-hoc sub-processes`, `\`bpmn remove <file> ${idOf(n)}\`.`, [idOf(n)!]);
    }
  }
  if (!nodes.some((n) => is(n, 'bpmn:Activity'))) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_AD_HOC_SUBPROCESS', el, undefined, 'adHoc:empty', `Ad-hoc sub-process ${id} contains no activity; Camunda 8 refuses the file`, `\`bpmn add <file> serviceTask "<Name>" --in ${id}\`.`);
  }
  // its completion condition is FEEL, checked at deploy (unlike a multi-instance one, a static value is refused)
  const cc = peek<El>(el, 'completionCondition');
  if (cc) {
    const body = peek<string>(cc, 'body') ?? '';
    const fix = `\`bpmn set <file> ${id} ${sh(`completion==${feelOf(isFeel(body) ? body.trim().slice(1) : body)}`)}\` (check the FEEL syntax)`;
    if (!isFeel(body)) push(ctx, 'deploy', 'W_C8_DEPLOY_EXPRESSION', el, undefined, 'adHoc:completion', `The completion condition "${body.trim()}" of ad-hoc sub-process ${id} is no FEEL expression; Camunda 8 needs one starting with = and refuses the file`, `${fix}, or remove it: \`bpmn set <file> ${id} completion=\`.`);
    else checkFeel(ctx, el, undefined, 'adHoc:completion', `The completion condition of ad-hoc sub-process ${id}`, body, `${fix}.`);
  }
}

/** Message names caught twice in one scope (engine-checked groups), signal names on two starts / one activity's boundaries, error codes twice in one scope. */
function checkSubscriptionScopes(ctx: Ctx, scope: El): void {
  const nodes = ctx.doc.flowNodes(scope);
  const literal = (n: string | undefined): n is string => !!n && !isFeel(n);
  const defOf = (el: El, type: string): El | undefined => {
    const defs = list(el, 'eventDefinitions');
    return defs.length === 1 && is(defs[0], type) ? defs[0] : undefined;
  };
  const report = (els: El[], kind: 'message' | 'signal', name: string, where: string, code: string, subjectPrefix: string): void => {
    const [first, ...rest] = els;
    for (const el of rest) {
      push(ctx, 'deploy', code, el, undefined, `${subjectPrefix}:${name}`, `${describe(el)} waits for the ${kind} "${name}" like ${describe(first!)} ${where}; Camunda 8 refuses one ${kind} name twice there`, `Use another ${kind}: \`bpmn set <file> ${idOf(el)} ${kind}=<Other${kind === 'message' ? 'Message' : 'Signal'}>\`${kind === 'message' ? ` (and a ${z(ctx, 'subscription')} on it)` : ''}.`, [idOf(first!)!]);
    }
  };
  const group = (els: El[], kind: 'message' | 'signal', where: string, code: string, subjectPrefix: string): void => {
    const byName = new Map<string, El[]>();
    for (const el of els) {
      const def = defOf(el, kind === 'message' ? 'bpmn:MessageEventDefinition' : 'bpmn:SignalEventDefinition');
      const name = kind === 'message' ? nameOf(is(el, 'bpmn:ReceiveTask') ? peek<El>(el, 'messageRef') : peek<El>(def, 'messageRef')) : nameOf(peek<El>(def, 'signalRef'));
      if (!literal(name)) continue;
      byName.set(name, [...(byName.get(name) ?? []), el]);
    }
    for (const [name, list_] of byName) if (list_.length > 1) report(list_, kind, name, where, code, subjectPrefix);
  };
  // boundary events of one activity (with the activity itself when it is a receive task)
  for (const act of nodes.filter((n) => is(n, 'bpmn:Activity'))) {
    const boundaries = nodes.filter((n) => is(n, 'bpmn:BoundaryEvent') && peek<El>(n, 'attachedToRef') === act);
    if (!boundaries.length) continue;
    group([...(is(act, 'bpmn:ReceiveTask') ? [act] : []), ...boundaries], 'message', `on ${idOf(act)}`, 'W_C8_DEPLOY_MESSAGE', `boundaryMessage:${idOf(act)}`);
    group(boundaries, 'signal', `on ${idOf(act)}`, 'W_C8_DEPLOY_SIGNAL', `boundarySignal:${idOf(act)}`);
    checkErrorCodes(ctx, boundaries, `the boundary events of ${idOf(act)}`);
  }
  // branches of an event-based gateway
  for (const gw of nodes.filter((n) => is(n, 'bpmn:EventBasedGateway'))) {
    const targets = (ctx.outgoing.get(gw) ?? []).map((f) => peek<El>(f, 'targetRef')).filter((t): t is El => !!t && is(t, 'bpmn:IntermediateCatchEvent'));
    group(targets, 'message', `after event-based gateway ${idOf(gw)}`, 'W_C8_DEPLOY_MESSAGE', `gatewayMessage:${idOf(gw)}`);
  }
  // start events of the event sub-processes of this scope
  const eventSubStarts = nodes.filter(isEventSubProcess).flatMap((sp) => ctx.doc.flowNodes(sp).filter((n) => is(n, 'bpmn:StartEvent')));
  group(eventSubStarts, 'message', `in the event sub-processes of ${idOf(scope)}`, 'W_C8_DEPLOY_MESSAGE', `eventSubMessage:${idOf(scope)}`);
  checkErrorCodes(ctx, eventSubStarts, `the event sub-processes of ${idOf(scope)}`);
  // process start events
  if (is(scope, 'bpmn:Process')) {
    const starts = nodes.filter((n) => is(n, 'bpmn:StartEvent'));
    group(starts, 'message', `in process ${idOf(scope)}`, 'W_C8_DEPLOY_MESSAGE', 'startMessage');
    group(starts, 'signal', `in process ${idOf(scope)}`, 'W_C8_DEPLOY_SIGNAL', 'startSignal');
  }
}

/** Two error catch events with one code (or two without code) in one scope. */
function checkErrorCodes(ctx: Ctx, events: El[], where: string): void {
  const seen = new Map<string, El>();
  for (const el of events) {
    const defs = list(el, 'eventDefinitions');
    if (defs.length !== 1 || !is(defs[0], 'bpmn:ErrorEventDefinition')) continue;
    const code = peek<string>(peek<El>(defs[0], 'errorRef'), 'errorCode');
    const key = blank(code) ? '' : code!;
    const first = seen.get(key);
    if (first) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_ERROR', el, undefined, `errorCode:${key}`, key ? `${describe(el)} catches the error code "${key}" like ${describe(first)} (${where}); Camunda 8 refuses one code twice in a scope` : `${describe(el)} and ${describe(first)} both catch every error (no error code) (${where}); Camunda 8 allows one catch-all per scope`, `Catch another error: \`bpmn set <file> ${idOf(el)} error=<OtherError> errorCode=<OTHER_CODE>\` (the events share no bpmn:Error then), or remove one of them.`, [idOf(first)!]);
    } else {
      seen.set(key, el);
    }
  }
}

/** Link events: a throw needs a catch of its name in its own (sub-)process; catch names are unique in a process. */
function checkLinks(ctx: Ctx, proc: El): void {
  const catches = new Map<string, El[]>();
  const walkScope = (scope: El): void => {
    const nodes = ctx.doc.flowNodes(scope);
    const linkName = (n: El): string | undefined => {
      const defs = list(n, 'eventDefinitions');
      return defs.length === 1 && is(defs[0], 'bpmn:LinkEventDefinition') ? peek<string>(defs[0], 'name') : undefined;
    };
    const here = new Set(nodes.filter((n) => is(n, 'bpmn:IntermediateCatchEvent')).map(linkName).filter((n): n is string => n !== undefined));
    for (const n of nodes) {
      if (is(n, 'bpmn:SubProcess')) walkScope(n);
      const name = linkName(n);
      if (name === undefined) continue;
      if (is(n, 'bpmn:IntermediateCatchEvent')) catches.set(name, [...(catches.get(name) ?? []), n]);
      else if (is(n, 'bpmn:IntermediateThrowEvent') && !here.has(name)) {
        push(ctx, 'deploy', 'W_C8_DEPLOY_LINK', n, undefined, `link:${name}`, `Link throw event ${idOf(n)} goes to "${name}", but ${idOf(scope)} has no link catch event of that name; Camunda 8 refuses the file`, `\`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${idOf(scope)} --link ${sh(name)}\`, then continue from it (or rename the link: \`bpmn set <file> ${idOf(n)} link=<Name>\`).`);
      }
    }
  };
  walkScope(proc);
  for (const [name, els] of catches) {
    for (const el of els.slice(1)) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_LINK', el, undefined, `linkCatch:${name}`, `Link catch events ${idOf(els[0])} and ${idOf(el)} share the name "${name}" in process ${idOf(proc)}; Camunda 8 refuses the file`, `\`bpmn set <file> ${idOf(el)} link=<OtherName>\` (and its throw events).`, [idOf(els[0])!]);
    }
  }
}

/* ------------------------------------------------------------------ */
/* traversal                                                            */
/* ------------------------------------------------------------------ */

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

function visit(ctx: Ctx, el: El, owner: El | undefined): void {
  checkAttributes(ctx, el, owner);
  checkExtensions(ctx, el, owner);
  if (is(el, 'bpmn:Transaction')) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_UNSUPPORTED', el, undefined, 'transaction', `${describe(el)} is a transaction; Camunda 8 does not support transactions and refuses the file`, `\`bpmn retype <file> ${idOf(el)} subProcess\` (an embedded sub-process).`);
    return;
  }
  if (is(el, 'bpmn:Process') || (is(el, 'bpmn:SubProcess') && !is(el, 'bpmn:AdHocSubProcess'))) checkStartEvents(ctx, el);
  if (is(el, 'bpmn:Process') || is(el, 'bpmn:SubProcess')) checkSubscriptionScopes(ctx, el);
  if (is(el, 'bpmn:Process')) checkLinks(ctx, el);
  if (is(el, 'bpmn:AdHocSubProcess')) checkAdHoc(ctx, el);
  if (is(el, 'bpmn:ServiceTask') || is(el, 'bpmn:SendTask') || is(el, 'bpmn:ScriptTask') || is(el, 'bpmn:BusinessRuleTask')) checkServiceLike(ctx, el);
  if (is(el, 'bpmn:ReceiveTask')) checkMessageCatch(ctx, el);
  if (is(el, 'bpmn:CallActivity')) checkCallActivity(ctx, el);
  if (is(el, 'bpmn:UserTask')) checkUserTask(ctx, el);
  if (is(el, 'bpmn:Activity')) checkMultiInstance(ctx, el);
  if (is(el, 'bpmn:Event')) checkEvent(ctx, el);
  if (is(el, 'bpmn:BoundaryEvent')) {
    const host = peek<El>(el, 'attachedToRef');
    if (host && peek<boolean>(host, 'isForCompensation') === true) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_BOUNDARY_HOST', el, undefined, 'compensationHost', `Boundary event ${idOf(el)} is attached to the compensation handler ${idOf(host)}; Camunda 8 refuses boundary events on compensation handlers`, `Remove it: \`bpmn remove <file> ${idOf(el)}\` (or attach it to a normal activity: \`bpmn move <file> ${idOf(el)} --on <activityId>\`).`, [idOf(host)!]);
    }
  }
  if (is(el, 'bpmn:ExclusiveGateway') || is(el, 'bpmn:InclusiveGateway')) checkBranchingGateway(ctx, el);
  if (is(el, 'bpmn:EventBasedGateway')) checkEventGateway(ctx, el);
  if (is(el, 'bpmn:SequenceFlow')) checkFlow(ctx, el);
  const next = idOf(el) ? el : owner;
  for (const c of bpmnChildren(el)) visit(ctx, c, next);
}

/**
 * Attributes without a namespace prefix that BPMN does not define, and
 * extension elements on bpmn:definitions: Camunda 8 validates the whole file
 * against the BPMN schema and refuses it (cvc-complex-type, engine-checked).
 */
function checkSchema(ctx: Ctx): void {
  if (list(peek<El>(ctx.doc.definitions, 'extensionElements'), 'values').length) {
    push(ctx, 'deploy', 'W_C8_DEPLOY_SCHEMA', ctx.doc.definitions, undefined, 'definitions', `bpmn:definitions carries bpmn:extensionElements, which the BPMN schema does not allow there; Camunda 8 refuses the file`, `Move the content to the process: \`bpmn ext remove <file> ${idOf(ctx.doc.definitions) ?? '<definitionsId>'} <type>\`, then \`bpmn ext add <file> <processId> <type> ...\`.`);
  }
  for (const el of walk(ctx.doc.definitions, { bpmnOnly: true })) {
    const bare = Object.keys(el.$attrs ?? {}).filter((k) => !k.includes(':') && k !== 'xmlns');
    if (!bare.length) continue;
    const parent = el.$parent as El | undefined;
    const nested = parent && idOf(parent) && addressOf(el, parent)?.prefix ? parent : undefined;
    let owner: El | undefined = nested ?? el;
    while (owner && !idOf(owner)) owner = owner.$parent as El | undefined;
    const id = idOf(owner);
    const di = isDiElement(el) || (!!owner && isDiElement(owner));
    const addr = di ? undefined : el === owner ? (id ? { id, prefix: '' } : undefined) : owner ? addressOf(el, owner) : undefined;
    for (const k of bare) {
      const where = el === owner ? describe(el) : `${el.$type}${id ? ` in ${id}` : ''}`;
      const link = el === owner && !!id && is(el, 'bpmn:BusinessRuleTask') && (k === 'calledDecision' || k === 'calledElement') ? decisionLinkOf(el, ctx.doc) : undefined;
      const remove = addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${k}=`)}\`` : undefined;
      const hint = link
        ? `Write the decision link the Camunda 8 way: \`bpmn set <file> ${id} ${sh(`calledDecision=${link.value}`)}\` (${z(ctx, 'calledDecision')}; the unprefixed ${k} is removed; give it a resultVariable).`
        : remove
          ? `Remove it: ${remove} (vendor attributes need their namespace prefix; Camunda 8 settings are mostly ${ctx.p}: extension elements).`
          : di
            ? `Remove ${k}="..." from the XML of ${id ?? 'the diagram element'}, or redraw the diagram: \`bpmn layout <file>\` (the hand-made layout is lost).`
            : `Remove ${k}="..." from the XML${id ? ` of ${id}` : ''}.`;
      push(ctx, 'deploy', 'W_C8_DEPLOY_SCHEMA', el, owner, `schema:${k}`, `${where} has the attribute ${k}, which the BPMN schema does not define; Camunda 8 validates the file against the schema and refuses it`, hint);
    }
  }
}

/** An id the BPMN schema does not allow (bpmn-moddle reads `prefix:name` ids; Camunda 8 refuses them, cvc-datatype-valid). */
function checkIds(ctx: Ctx): void {
  for (const el of walk(ctx.doc.definitions)) {
    if (isGeneric(el)) continue;
    const id = peek<string>(el, 'id');
    if (typeof id !== 'string' || !id || NCNAME.test(id.trim())) continue;
    const di = isDiElement(el);
    const fixed = id.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^(?=[^A-Za-z_])/, '_');
    push(ctx, 'deploy', 'W_C8_DEPLOY_SCHEMA', el, undefined, `id:${id}`, `${di ? el.$type : describe(el)} has the id "${id}", which is no XML NCName (${id.includes(':') ? 'a colon is not allowed in an id' : 'letters, digits, _ . - and no leading digit'}); Camunda 8 validates the file against the BPMN schema and refuses it`, di ? `Rename it in the XML (or redraw the diagram: \`bpmn layout <file>\`).` : `\`bpmn set <file> ${sh(id)} id=${fixed}\`.`);
  }
}

/** The schema-text issues of a document's text, read once per text (the profile runs before and after an edit). */
const TEXT_ISSUES = new WeakMap<object, SchemaTextIssue[]>();

/**
 * Child element order and IDREFs that name no id, read from the file's text
 * (platform/schema-text.ts): the model shows neither, Camunda 8 refuses both.
 * After an edit an issue of an element the edit removed is gone.
 */
function checkSchemaText(ctx: Ctx): void {
  const source = ctx.doc.source;
  if (!source) return;
  let issues = TEXT_ISSUES.get(source);
  if (!issues) {
    issues = schemaTextIssues(source.text, ctx.doc.moddle);
    TEXT_ISSUES.set(source, issues);
  }
  for (const issue of issues) {
    if (issue.kind === 'id') {
      // an element bpmn-moddle read is checkIds' (with the rename); this one it could not read (an import warning)
      if (ctx.doc.get(issue.value!)) continue;
      push(ctx, 'deploy', 'W_C8_DEPLOY_SCHEMA', ctx.doc.definitions, undefined, `id:${issue.value}`, `<bpmn:${issue.element}> has the id "${issue.value}", which is no XML NCName (${issue.value!.includes(':') ? 'a colon is not allowed in an id' : 'letters, digits, _ . - and no leading digit'}); bpmn-moddle cannot read the element (an import warning) and Camunda 8 validates the file against the BPMN schema and refuses it`, `Rename it in the XML (and every reference to it), e.g. to ${issue.value!.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^(?=[^A-Za-z_])/, '_')}.`);
      continue;
    }
    const owner = issue.owner !== undefined ? ctx.doc.get(issue.owner) : undefined;
    if (issue.owner !== undefined && !owner) continue;
    const where = owner ? describe(owner) : `<${issue.element}>`;
    if (issue.kind === 'order') {
      const what = owner && issue.element !== localName(owner.$type).replace(/^./, (c) => c.toLowerCase()) ? `<bpmn:${issue.element}> of ${where}` : where;
      push(ctx, 'deploy', 'W_C8_DEPLOY_SCHEMA', owner ?? ctx.doc.definitions, undefined, `order:${issue.element}/${issue.child}`, `In ${what}, <bpmn:${issue.child}> comes after <bpmn:${issue.before}>; the BPMN schema puts ${issue.child} before ${issue.before}, and Camunda 8 validates the file against the schema and refuses it`, `Move <bpmn:${issue.child}> before <bpmn:${issue.before}> in the XML of ${owner ? idOf(owner) : `<${issue.element}>`} (Camunda Modeler and \`bpmn\` write that order for the elements they create or change).`);
    } else {
      const ref = issue.attribute ? `${issue.ref}="${issue.value}"` : `<bpmn:${issue.ref}>${issue.value}</bpmn:${issue.ref}>`;
      push(ctx, 'deploy', 'W_C8_DEPLOY_SCHEMA', owner ?? ctx.doc.definitions, undefined, `idref:${issue.ref}:${issue.value}`, `${where[0]!.toUpperCase()}${where.slice(1)} has ${ref}, but the file has no element with the id ${issue.value}; Camunda 8 checks such references against the ids of the file (cvc-id.1) and refuses it`, `Remove ${ref} from ${issue.owner ?? `<bpmn:${issue.element}>`} in the XML, or point it at an element of the file (bpmn-moddle drops the reference when it reads the file: \`bpmn\` refuses to write the file without --force, and a forced write leaves it out).`);
    }
  }
}

/**
 * The names of the messages and signals the file's elements use: Camunda 8
 * parses one starting with = as FEEL at deploy (a catch, a throw, a send
 * task: engine-checked); each name is checked once.
 */
function checkFeelNames(ctx: Ctx): void {
  const used = new Set<El>();
  for (const el of walk(ctx.doc.definitions, { bpmnOnly: true })) {
    if (!is(el, 'bpmn:FlowNode')) continue;
    const msg = messageOf(el);
    if (msg) used.add(msg);
    for (const def of list(el, 'eventDefinitions')) {
      const sig = is(def, 'bpmn:SignalEventDefinition') ? peek<El>(def, 'signalRef') : undefined;
      if (sig) used.add(sig);
    }
  }
  for (const ref of used) {
    const id = idOf(ref);
    if (!id) continue;
    const what = is(ref, 'bpmn:Signal') ? 'signal' : 'message';
    checkFeel(ctx, ref, undefined, 'name', `The name of ${what} ${id}`, nameAttr(ref), `\`bpmn set <file> ${id} ${sh('name==<FEEL expression>')}\` (check the FEEL syntax), or a static name.`);
  }
}

/** Schema rules on every event definition of the file: a conditional definition needs a condition, a link definition a name. */
function checkSchemaEventDefinitions(ctx: Ctx): void {
  for (const def of walk(ctx.doc.definitions, { bpmnOnly: true })) {
    if (!is(def, 'bpmn:EventDefinition')) continue;
    const event = def.$parent as El | undefined;
    const id = idOf(event);
    const label = id ? describe(event!) : def.$type;
    if (is(def, 'bpmn:ConditionalEventDefinition') && !peek<El>(def, 'condition')) {
      push(ctx, 'deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', event ?? def, undefined, 'schema:condition', `The conditional event definition of ${label} has no condition element, which the BPMN schema requires; Camunda 8 refuses the file`, id ? `\`bpmn set <file> ${id} ${sh('when== <expression>')}\`.` : 'Fix it in the XML.');
    } else if (is(def, 'bpmn:LinkEventDefinition') && missing(peek<string>(def, 'name'))) {
      // no name: the BPMN schema requires one; an empty one: Camunda 8 ("must be present and not empty"; white space passes)
      const none = peek<string>(def, 'name') === undefined || peek<string>(def, 'name') === null;
      push(ctx, 'deploy', 'W_C8_DEPLOY_LINK', event ?? def, undefined, 'schema:linkName', `The link event definition of ${label} has ${none ? 'no name, which the BPMN schema requires' : 'an empty name'}; Camunda 8 refuses the file`, id ? `\`bpmn set <file> ${id} link=<Name>\` (the throw and the catch event of a pair share the name).` : 'Fix it in the XML.');
    }
  }
}




/** Runs the Camunda 8 profile over a document. */
export function c8Findings(doc: Doc): ProfileFinding[] {
  const ns = namespaceMap(doc);
  const prefix = [...ns.entries()].find(([, u]) => u === ZEEBE_URI)?.[0] ?? 'zeebe';
  const outgoing = new Map<El, El[]>();
  for (const flow of walk(doc.definitions, { bpmnOnly: true })) {
    if (!is(flow, 'bpmn:SequenceFlow')) continue;
    const source = peek<El>(flow, 'sourceRef');
    if (source) outgoing.set(source, [...(outgoing.get(source) ?? []), flow]);
  }
  const unlisted = new Map<El, El>();
  if (doc.source) for (const e of unkeptEntries(doc.definitions, doc.source.mirror)) if (e.direction === 'outgoing') unlisted.set(e.flow, e.node);
  const ctx: Ctx = { doc, ns, p: prefix, out: [], outgoing, unlisted };
  const processes = doc.processes();
  const executable = processes.filter((p) => peek<boolean>(p, 'isExecutable') === true);
  if (processes.length && !executable.length) {
    const first = processes[0]!;
    const what = processes.length === 1 ? `Process ${idOf(first)} is not executable` : `None of the ${processes.length} processes is executable`;
    push(ctx, 'deploy', 'W_C8_DEPLOY_EXECUTABLE', first, undefined, 'executable', `${what} (no isExecutable="true"); Camunda 8 refuses to deploy a file without an executable process`, `\`bpmn set <file> ${idOf(first)} isExecutable=true\`.`);
  }
  // root elements the executable processes use are checked through their events; the process content here
  for (const proc of executable) visit(ctx, proc, undefined);
  // messages read by catch events: their subscription content (unknown attributes, foreign content)
  const caught = new Set<El>();
  for (const proc of executable) {
    for (const el of walk(proc, { bpmnOnly: true })) {
      if (is(el, 'bpmn:Event') || is(el, 'bpmn:ReceiveTask')) {
        const m = messageOf(el);
        if (m) caught.add(m);
      }
    }
  }
  for (const m of caught) {
    checkAttributes(ctx, m, undefined);
    checkExtensions(ctx, m, undefined);
  }
  checkSchemaEventDefinitions(ctx);
  checkFeelNames(ctx);
  checkSchema(ctx);
  checkIds(ctx);
  checkSchemaText(ctx);
  return ctx.out;
}
