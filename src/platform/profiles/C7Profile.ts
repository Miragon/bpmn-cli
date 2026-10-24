/**
 * The Camunda 7 validation profile (also CIB seven and Operaton, which read
 * the camunda namespace). It checks what the engines check when a file is
 * deployed, plus vendor content they silently ignore. Every rule was taken
 * from a deployment against Camunda 7.24, CIB seven 2.2 and Operaton 2.1.5
 * (all three gave the same answer) or from the camunda-bpmn-moddle descriptor
 * (platform/CamundaDescriptor.ts, read as data; it is never registered with the
 * model, so camunda content stays generic: `el.$attrs['camunda:assignee']`,
 * generic `camunda:inputOutput` elements).
 *
 * Operaton's own namespace (operaton:*) holds the same types. Only Operaton
 * reads it, first, with camunda:* as the fallback; Camunda 7 and CIB seven
 * ignore it. A file that uses it targets Operaton (platform/PlatformDetection.ts `operaton`) and
 * is read that way: an operaton attribute wins over the camunda one, and one
 * operaton:inputOutput next to one camunda:inputOutput is no duplicate.
 *
 * Scope: the content of executable processes (isExecutable="true"; the
 * engines skip every other process, and every ad-hoc sub-process with its
 * content) plus file-level content (definitions, root elements such as
 * bpmn:Error and bpmn:Signal, the collaboration, and the schema checks, which
 * cover the whole file: W_C7_DEPLOY_SCHEMA and checkSchemaEventDefinitions).
 *
 * Codes, severity deploy (the engines refuse the deployment):
 *   W_C7_DEPLOY_HISTORY_TTL        executable process without (or with an unparsable) camunda:historyTimeToLive
 *   W_C7_DEPLOY_IMPLEMENTATION     service/send/business rule task (or message throw/end event) without
 *                                  class/delegateExpression/expression/type=external/connector (decisionRef for
 *                                  business rule tasks), camunda:type other than "external" or "shell" ("mail"
 *                                  included); a shell task without a command field, with an expression field, or
 *                                  with wait/redirectError/cleanEnv other than true/false
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
 *                                  or without id
 *   W_C7_DEPLOY_EXTENSION          camunda:in/out without source+target (or variables / businessKey), input/output
 *                                  parameter without name, form field without id or with a type other than
 *                                  string/long/boolean/date/enum, connector without connectorId, camunda:field
 *                                  without a value (or with stringValue and camunda:string together) where the
 *                                  engines read fields (class / delegateExpression implementations and listeners,
 *                                  shell tasks)
 *   W_C7_DEPLOY_EVENT_GATEWAY      event-based gateway branch that is not a message/timer/signal/conditional
 *                                  intermediate catch event, has other incoming flows, or repeats a message/signal
 *   W_C7_DEPLOY_MESSAGE            catching message event without messageRef or with a nameless message; two
 *                                  subscriptions to one message name in the same scope (checkSubscriptions)
 *   W_C7_DEPLOY_SIGNAL             signal event without signalRef or with a nameless signal; duplicate signal names;
 *                                  two subscriptions to one signal name in the same scope
 *   W_C7_DEPLOY_ERROR              error end event without errorRef or whose bpmn:Error has no errorCode
 *   W_C7_DEPLOY_ESCALATION         escalation throw without escalationRef / escalationCode; escalation boundary
 *                                  event on something else than a sub-process, call activity or user task
 *   W_C7_DEPLOY_EVENT_DEFINITION   timer without date/cycle/duration, compensation activityRef outside the throw
 *                                  event's (sub-)process; schema (every definition in the file, also one the engines
 *                                  ignore): conditional definition without a condition element, timer definition with
 *                                  more than one of timeDate/timeCycle/timeDuration
 *   W_C7_DEPLOY_START_EVENT        process or embedded sub-process without a start event (also an empty one), a
 *                                  second none/timer start event in a process, a second start event in a sub-process
 *   W_C7_DEPLOY_AD_HOC_SUBPROCESS  ad-hoc sub-process with a sequence flow or a boundary event, or (not Operaton) a
 *                                  multi-instance loop (the engines do not run ad-hoc sub-processes; one that
 *                                  nothing connects is skipped with its content, its loop rules hold)
 *   W_C7_DEPLOY_COMPLEX_GATEWAY    complex gateway with a sequence flow (the engines ignore complex gateways; one that
 *                                  nothing connects deploys)
 *   W_C7_DEPLOY_LINK               two link catch events with one name in a process, a link throw event (with an
 *                                  incoming flow) without a catch event of its name in its own (sub-)process;
 *                                  schema (every definition in the file): link definition without name
 *   W_C7_DEPLOY_SCHEMA             an attribute without prefix that the BPMN schema does not define (anywhere in
 *                                  the file: the engines validate it against the schema); `set <id> <attr>=` removes it;
 *                                  a business rule task's calledDecision (bpmn-cli's decision link for a model
 *                                  without an engine) is converted to camunda:decisionRef by
 *                                  `set <id> calledDecision=<decision>`
 *   W_C7_DEPLOY_BOUNDARY_HOST      boundary event attached to a compensation handler (isForCompensation="true");
 *                                  validate/structural.ts withProfile drops it next to the structural E_INVALID_HOST
 *   W_C7_DEPLOY_SCRIPT             script task without script and without camunda:resource
 *   W_C7_DEPLOY_EXCLUSIVE_GATEWAY  exclusive gateway without outgoing flow, a single conditional flow, a conditional
 *                                  default flow, or flows without condition next to a default (or more than one)
 *   W_C7_DEPLOY_DEFINITIONS_EXTENSION bpmn:extensionElements directly under bpmn:definitions (XSD-invalid)
 * severity runtime (deploys, but is ignored or fails when the process runs):
 *   W_C7_UNKNOWN_ATTRIBUTE         camunda attribute the descriptor does not know (did you mean ...)
 *   W_C7_MISPLACED_ATTRIBUTE       camunda attribute on an element type that does not read it, or on the wrong side
 *                                  of an event definition (SIDE_RULES: delegate settings on a message catch event,
 *                                  camunda:async on a signal catch, code variables on error / escalation throws)
 *   W_C7_UNKNOWN_ELEMENT           camunda extension element type the descriptor does not know
 *   W_C7_MISPLACED_EXTENSION       camunda extension element on a host (or in a container) that does not read it
 *                                  (also camunda:field / connector on a message catch, camunda:in on a signal catch)
 *   W_C7_FOREIGN_CONTENT           zeebe:* attributes or elements in a Camunda 7 file
 *   W_C7_BAD_VALUE                 boolean not true/false, unknown binding, bad variableEvents, empty topic or
 *                                  calledElement, non-numeric task priority
 *   W_C7_MESSAGE_NO_IMPLEMENTATION message throw/end event without implementation (behaves like a none event)
 *   W_C7_EMPTY_CONDITION           condition without expression and without camunda:resource on a conditional event
 *                                  or on a sequence flow the engines evaluate: it deploys, evaluating it fails
 *   W_C7_TRANSACTION_NO_START      transaction without a start event: it deploys, every instance that reaches it fails
 *   W_C7_MULTIPLE_EVENT_DEFINITIONS event with several event definitions: the engines act on one of them (for catch
 *                                  events the first of an engine-checked order, actingOrder) and ignore the others;
 *                                  the deploy rules above look at that one only, like the engines, except the schema
 *                                  rules: the engines validate every definition against the schema first
 *   W_C7_DANGLING_REF              id reference inside camunda content (camunda:errorEventDefinition errorRef) to
 *                                  an element that does not exist
 * severity practice:
 *   W_C7_EXCLUSIVE_GATEWAY_DEFAULT exclusive gateway with exactly one flow without condition and no default flow
 *                                  (the engine warns and takes it as the default)
 *   W_C7_DUPLICATE_EXTENSION       a second camunda:failedJobRetryTimeCycle where it is not read yet (not async)
 *
 * Hints name `bpmn set` / `bpmn ext` command lines; attributes of nested
 * elements are addressed with the `definition.` / `loop.` / `condition.`
 * key prefixes of `bpmn set` (and `ext`), one of several event definitions
 * with `definition[<n>].`. A repeatable extension element
 * (listener, field, camunda:in/out, error mapping) is rebuilt by removing it
 * with its own selector and adding it again, never with `--replace`, which
 * would delete its siblings (extHint).
 */
import type { El } from '../../model/utils/moddle.js';
import type { CamundaElementType } from '../CamundaDescriptor.js';
import type { RuleKit } from './rule-kit.js';
import { EngineProfile, type ElementWalk } from './EngineProfile.js';
import { attr, idOf, isGeneric, list, localName, nameOf, peek, triggerName } from './utils/element.js';
import { didYouMean, sh } from './utils/hint.js';

type FieldValue = { kind: 'string' | 'expression'; value: string } | { problem: string };

const SHELL_FLAGS = ['wait', 'redirectError', 'cleanEnv'];

const BINDINGS = ['latest', 'deployment', 'version', 'versionTag'];
const CASE_BINDINGS = ['latest', 'deployment', 'version'];
const VARIABLE_EVENTS = ['create', 'update', 'delete'];

/**
 * Content of an event definition the engines read on one side only (the
 * descriptor allows it on both): delegate and external-task settings and
 * field / connector elements on message THROW events, camunda:async and
 * camunda:in on signal throw events, the code variables on error and
 * escalation CATCH events. Returns where it is read, or undefined.
 */
const SIDE_RULES: Array<{ def: string; side: 'throw' | 'catch'; attrs: string[]; ext: string[]; where: string }> = [
  { def: 'bpmn:MessageEventDefinition', side: 'throw', attrs: ['class', 'delegateExpression', 'expression', 'resultVariable', 'type', 'topic', 'taskPriority'], ext: ['field', 'connector'], where: 'message throw and end events' },
  { def: 'bpmn:SignalEventDefinition', side: 'throw', attrs: ['async'], ext: ['in'], where: 'signal throw and end events' },
  { def: 'bpmn:ErrorEventDefinition', side: 'catch', attrs: ['errorCodeVariable', 'errorMessageVariable'], ext: [], where: 'error boundary and error start events' },
  { def: 'bpmn:EscalationEventDefinition', side: 'catch', attrs: ['escalationCodeVariable'], ext: [], where: 'escalation boundary and escalation start events' },
];

/** Hosts the descriptor misses but the engines read (see the module header). */
const EXTRA_HOSTS: Record<string, string[]> = {
  potentialStarter: ['bpmn:Process'],
  errorEventDefinition: ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask', 'bpmn:MessageEventDefinition', 'bpmn:IntermediateThrowEvent', 'bpmn:EndEvent'],
};

/** Attributes the engines read that the descriptor models as child elements only (camunda:field expression="${...}", engine-checked). */
const EXTRA_ATTRS: Record<string, string[]> = { field: ['expression'] };

/** Attributes that pick one item of a repeatable type, in the order a selector prefers them. */
const SELECTOR_KEYS = ['id', 'name', 'event', 'target', 'source', 'errorRef'];

const EXECUTION_EVENTS = ['start', 'end'];
/** the form field types every engine knows (more only through a custom form type plugin) */
const FORM_TYPES = ['string', 'long', 'boolean', 'date', 'enum'];
const TASK_EVENTS = ['create', 'assignment', 'complete', 'update', 'delete', 'timeout'];

const SERVICE_LIKE = ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask'];
const TTL_MAX = 2147483647;

const DECISION_MAPPERS = ['singleEntry', 'singleResult', 'collectEntries', 'resultList'];

const FORM_BINDINGS = ['deployment', 'latest', 'version'];

const TIMER_ELEMENTS = ['timeDate', 'timeCycle', 'timeDuration'];

export class C7Profile extends EngineProfile {
  private probe: ReturnType<RuleKit['createModdle']> | undefined;
  private readonly bpmnAttrNames = new Map<string, Set<string>>();
  private typeNameCache: string[] | undefined;

  /** the file uses the operaton namespace: read it as Operaton does (operaton:* first, camunda:* as the fallback) */
  private operaton = false;
  private errors = new Map<string, El>();

  /**
   * Runs the Camunda 7 profile over a document. `operaton`: the file uses the
   * operaton namespace and is read like Operaton reads it (detected when omitted).
   */
  protected override checkDocument(opts: { operaton?: boolean }): void {
    const doc = this.doc;
    this.operaton = opts.operaton ?? (this.ns.usage().get(this.kit.OPERATON_URI) ?? 0) > 0;
    this.p = (this.operaton ? this.ns.prefixOf(this.kit.OPERATON_URI) : undefined) ?? this.ns.prefixOf(this.kit.camunda.uri) ?? this.ns.prefixOf(this.kit.OPERATON_URI) ?? 'camunda';
    this.errors = new Map(doc.rootElementsOfType('bpmn:Error').map((e) => [idOf(e) ?? '', e] as const));
    const defs = doc.definitions;
    this.checkAttributes(defs, undefined);
    this.checkExtensions(defs, undefined, true);
    const processes = doc.processes();
    const executable = processes.filter((p) => peek<boolean>(p, 'isExecutable') === true);
    for (const root of list(defs, 'rootElements')) {
      if (this.kit.is(root, 'bpmn:Process')) {
        if (executable.includes(root)) this.visit(root, undefined, true);
        continue;
      }
      this.visit(root, undefined, false);
    }
    if (executable.length) this.checkSignalNames();
    this.checkSchemaEventDefinitions();
    this.checkSchemaAttributes();
  }

  protected override checkElement(el: El, owner: El | undefined, executable: boolean): ElementWalk {
    const is = this.kit.is;
    if (executable && is(el, 'bpmn:AdHocSubProcess')) {
      // the engines skip an ad-hoc sub-process with its content, like a non-executable process
      this.checkAdHoc(el);
      return 'stop';
    }
    this.checkAttributes(el, owner);
    this.checkExtensions(el, owner, executable);
    this.checkVendorRefs(el, owner);
    if (executable) {
      if (is(el, 'bpmn:Process')) this.checkProcess(el);
      if (SERVICE_LIKE.some((t) => is(el, t))) this.checkImplementation(el, undefined, this.describe(el, undefined), { decisionRef: is(el, 'bpmn:BusinessRuleTask') });
      if (is(el, 'bpmn:BusinessRuleTask')) this.checkBusinessRule(el);
      if (is(el, 'bpmn:CallActivity')) this.checkCallActivity(el);
      if (is(el, 'bpmn:UserTask') || is(el, 'bpmn:StartEvent')) this.checkForms(el);
      if (is(el, 'bpmn:UserTask')) this.checkUserTaskPriority(el);
      if (is(el, 'bpmn:Activity')) this.checkMultiInstance(el);
      if (is(el, 'bpmn:Event')) this.checkEvent(el);
      if (is(el, 'bpmn:EventBasedGateway')) this.checkEventGateway(el);
      if (is(el, 'bpmn:ComplexGateway')) this.checkComplexGateway(el);
      if (is(el, 'bpmn:ExclusiveGateway')) this.checkExclusiveGateway(el);
      if (is(el, 'bpmn:ScriptTask')) this.checkScriptTask(el);
      if (is(el, 'bpmn:ReceiveTask')) this.checkReceiveTask(el);
      if (is(el, 'bpmn:SequenceFlow')) this.checkFlowCondition(el);
      if ((is(el, 'bpmn:Activity') || is(el, 'bpmn:Gateway') || is(el, 'bpmn:Event') || is(el, 'bpmn:MultiInstanceLoopCharacteristics')) && !is(el, 'bpmn:Process')) this.checkPriorities(el, owner, ['jobPriority']);
      if (is(el, 'bpmn:Process') || is(el, 'bpmn:SubProcess')) this.checkStartEvents(el);
      if (is(el, 'bpmn:Process')) {
        this.checkSubscriptions(el);
        this.checkLinks(el);
      }
    }
    return 'descend';
  }

  private nonEmpty(v: string | undefined): v is string {
    return typeof v === 'string' && v.trim() !== '';
  }

  private isExpression(v: string): boolean {
    return /[$#]\{/.test(v);
  }

  /** `<slot><first argument>` quoted for the shell (`'definition[1].camunda:field'`), the other arguments as they are. */
  private slotted(slot: string, args: string): string {
    const i = args.indexOf(' ');
    return i === -1 ? sh(`${slot}${args}`) : `${sh(`${slot}${args.slice(0, i)}`)}${args.slice(i)}`;
  }

  /** `bpmn ext add` arguments that re-create a flat generic element (attributes and body), or undefined when it has children; `fix` replaces attribute values (placeholders). */
  private extAddArgs(v: El, type: string, fix: Record<string, string> = {}): string | undefined {
    const kids = peek<unknown[]>(v, '$children');
    if (Array.isArray(kids) && kids.length) return undefined;
    const entries = Object.entries(v as unknown as Record<string, unknown>).filter(([k]) => !k.startsWith('$') && !k.startsWith('xmlns'));
    for (const k of Object.keys(fix)) if (!entries.some(([e]) => e === k)) entries.push([k, fix[k]]);
    const attrs = entries.map(([k, val]) => sh(`${k}=${k in fix ? fix[k] : String(val)}`));
    const body = peek<string>(v, '$body');
    return [type, ...attrs, ...(body !== undefined ? ['--body', sh(String(body))] : [])].join(' ');
  }

  /** `userTask Activity_X`, `multiInstanceLoopCharacteristics of userTask Activity_X` */
  private describe(el: El, owner: El | undefined): string {
    const id = idOf(el);
    const kind = this.kit.isBpmnElement(el) ? this.kit.kindLabel(el).replace(/^bpmn:/, '') : el.$type;
    const k = kind.charAt(0).toLowerCase() + kind.slice(1);
    if (id) return `${k} ${id}`;
    return owner ? `the ${k} of ${this.describe(owner, undefined)}` : k;
  }

  /** The `set` key prefix that addresses `el` through `owner` (`definition.`, `loop.`, `condition.`), or '' when `el` is the owner. */
  protected override addressOf(el: El, owner: El | undefined): { id: string; prefix: string } | undefined {
    const id = idOf(el);
    if (!owner || el === owner) return id ? { id, prefix: '' } : undefined;
    const oid = idOf(owner);
    if (!oid) return undefined;
    const defs = list(owner, 'eventDefinitions');
    // one of several event definitions: `definition.` would be ambiguous (E_AMBIGUOUS_NESTED)
    if (defs.includes(el)) return { id: oid, prefix: defs.length > 1 ? `definition[${defs.indexOf(el)}].` : 'definition.' };
    if (peek<El>(owner, 'loopCharacteristics') === el) return { id: oid, prefix: 'loop.' };
    if (peek<El>(owner, 'conditionExpression') === el) return { id: oid, prefix: 'condition.' };
    return id ? { id, prefix: '' } : undefined;
  }

  private uriOfAttr(key: string): string | undefined {
    return this.ns.uriOfName(key);
  }

  /**
   * Value of the camunda attribute `local` of a BPMN element. An operaton:*
   * attribute wins over the camunda one, like Operaton reads them (a file with
   * operaton content targets Operaton; Camunda 7 and CIB seven ignore it).
   */
  private c7(el: El | undefined, local: string): string | undefined {
    if (!el) return undefined;
    let fallback: string | undefined;
    for (const [k, v] of Object.entries(el.$attrs ?? {})) {
      if (k.slice(k.indexOf(':') + 1) !== local) continue;
      const uri = this.uriOfAttr(k);
      if (!this.kit.camunda.reads(uri)) continue;
      const value = v === undefined || v === null ? undefined : String(v);
      if (uri === this.kit.OPERATON_URI) return value;
      fallback ??= value;
    }
    return fallback;
  }

  /** Top-level camunda extension elements of type `local`. */
  private camundaExt(el: El, local: string): El[] {
    return this.extensionValues(el)
      .filter((v) => v.uri && this.kit.camunda.reads(v.uri) && v.local === local)
      .map((v) => v.el);
  }

  private children(el: El, local?: string): El[] {
    const kids = peek<unknown[]>(el, '$children');
    if (!Array.isArray(kids)) return [];
    return (kids as El[]).filter((c) => {
      if (!c || typeof c !== 'object' || typeof c.$type !== 'string' || !isGeneric(c)) return false;
      const uri = this.ns.uriOfElement(c);
      return this.kit.camunda.reads(uri) && (local === undefined || localName(c.$type) === local);
    });
  }

  /**
   * The value of a camunda:field as the engines parse it: stringValue / a
   * camunda:string element first, then expression / a camunda:expression
   * element. A field with none, or with the attribute and the element of one
   * kind together, makes the engines refuse the file (where they read fields at
   * all, see fieldsRead). An element without text counts as a value: the model
   * cannot tell an empty one (refused) from one holding blanks (accepted).
   */
  private fieldValue(f: El): FieldValue {
    const pick = (attrName: string, child: string): { value?: string; problem?: string } => {
      const a = attr(f, attrName);
      const kids = this.children(f, child);
      if (a !== undefined && kids.length) return { problem: `both the attribute ${attrName} and a ${this.p}:${child} element` };
      if (kids.length) {
        const text = peek<unknown>(kids[0], '$body');
        return { value: typeof text === 'string' ? text : '' };
      }
      return a !== undefined && a.length > 0 ? { value: a } : {};
    };
    const s = pick('stringValue', 'string');
    if (s.problem) return { problem: s.problem };
    if (s.value !== undefined) return { kind: 'string', value: s.value };
    const e = pick('expression', 'expression');
    if (e.problem) return { problem: e.problem };
    if (e.value !== undefined) return { kind: 'expression', value: e.value };
    return { problem: 'no value' };
  }

  /**
   * Whether the engines parse the camunda:field elements of an implementation:
   * a class or a delegate expression (an expression wins over a delegate
   * expression and reads no fields), a shell task; never an external task or an
   * expression (engine-checked, also for listeners).
   */
  private fieldsRead(el: El, opts: { type?: string } = {}): boolean {
    if (opts.type !== undefined) return opts.type.toLowerCase() === 'shell';
    const get = (a: string): string | undefined => (isGeneric(el) ? attr(el, a) : this.c7(el, a));
    if (this.nonEmpty(get('class'))) return true;
    return get('expression') === undefined && this.nonEmpty(get('delegateExpression'));
  }

  /** Fields without a value where the engines read them (W_C7_DEPLOY_EXTENSION). `add` builds the `ext add` type argument that replaces one field. */
  private checkFieldValues(host: El, owner: El | undefined, fields: El[], label: string, add: string | undefined): void {
    fields.forEach((f, i) => {
      const v = this.fieldValue(f);
      if (!('problem' in v)) return;
      const name = attr(f, 'name');
      const hint = add && name !== undefined ? `Give it one: \`bpmn ext add <file> ${add} name=${sh(name)} stringValue=<value>\` (replaces the field of that name; or ${sh('expression=${...}')}).` : `Give it a stringValue or an expression in the XML.`;
      this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `field:${name ?? `#${i}`}`, `${this.p}:field${name !== undefined ? ` "${name}"` : ''} of ${label} has ${v.problem}; the engines refuse the file (a field needs stringValue, expression, a ${this.p}:string or a ${this.p}:expression)`, hint);
    });
  }

  /** camunda:type="shell": a command field, fixed values only, true/false flags (engine-checked). */
  private checkShell(el: El, owner: El | undefined, label: string, add: string | undefined): void {
    const p = this.p;
    const fields = this.camundaExt(el, 'field');
    if (!fields.some((f) => attr(f, 'name') === 'command')) {
      this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, 'shell:command', `${label} is a shell task without a ${p}:field named command; the engines refuse the file`, add ? `\`bpmn ext add <file> ${add} name=command stringValue=<command>\`.` : 'Add a command field in the XML.');
    }
    for (const f of fields) {
      const name = attr(f, 'name') ?? '';
      const v = this.fieldValue(f);
      if ('problem' in v) continue;
      if (v.kind === 'expression') {
        this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, `shell:${name}`, `${p}:field "${name}" of shell task ${label} is an expression; the shell task takes fixed values only and the engines refuse the file`, add ? `\`bpmn ext add <file> ${add} name=${sh(name)} stringValue=<value>\`.` : 'Use a stringValue.');
      } else if (SHELL_FLAGS.includes(name) && !['true', 'false'].includes(v.value.toLowerCase())) {
        this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, `shell:${name}`, `${p}:field "${name}" of shell task ${label} is "${v.value}", not true or false; the engines refuse the file`, add ? `\`bpmn ext add <file> ${add} name=${name} stringValue=true\` (or false).` : 'Use true or false.');
      }
    }
  }

  private hasConnector(...hosts: Array<El | undefined>): boolean {
    return hosts.some((h) => !!h && this.camundaExt(h, 'connector').length > 0);
  }

  private kindsText(owners: string[]): string {
    const names = owners.map((o) => o.replace(/^bpmn:/, '')).map((n) => n.charAt(0).toLowerCase() + n.slice(1));
    return names.length > 4 ? `${names.slice(0, 4).join(', ')}, ...` : names.join(', ');
  }

  private wrongSide(def: El, owner: El | undefined, local: string, kind: 'attrs' | 'ext'): string | undefined {
    if (!owner || !list(owner, 'eventDefinitions').includes(def)) return undefined;
    const side = this.kit.is(owner, 'bpmn:CatchEvent') ? 'catch' : this.kit.is(owner, 'bpmn:ThrowEvent') ? 'throw' : undefined;
    if (!side) return undefined;
    const rule = SIDE_RULES.find((r) => this.kit.is(def, r.def) && r[kind].includes(local));
    return rule && rule.side !== side ? rule.where : undefined;
  }

  /** camunda / zeebe attributes of a BPMN element: unknown, misplaced, foreign, bad booleans. */
  private checkAttributes(el: El, owner: El | undefined): void {
    const addr = this.addressOf(el, owner);
    const where = this.describe(el, owner);
    for (const [key, raw] of Object.entries(el.$attrs ?? {})) {
      const uri = this.uriOfAttr(key);
      if (!uri) continue;
      const local = key.slice(key.indexOf(':') + 1);
      const value = raw === undefined || raw === null ? '' : String(raw);
      const unset = addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${key}=`)}\`` : 'edit the XML';
      if (uri === this.kit.zeebe.uri) {
        this.push('runtime', 'W_C7_FOREIGN_CONTENT', el, owner, `attr:${key}`, `${where} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`, `Remove it: ${unset}, and use the camunda attribute instead (\`bpmn kinds\` lists them).`);
        continue;
      }
      if (!this.kit.camunda.reads(uri)) continue;
      const def = this.kit.camunda.attr(local);
      if (!def) {
        const applicable = this.kit.camunda.attrs().filter((a) => a.owners.some((o) => this.kit.is(el, o))).map((a) => localName(a.name));
        const guess = didYouMean(local, this.kit.camunda.attrs().map((a) => localName(a.name)), applicable);
        const prefix = key.slice(0, key.indexOf(':'));
        const fits = !!guess && applicable.includes(guess);
        const elsewhere = guess && !fits ? ` It applies to ${this.kindsText(this.kit.camunda.attr(guess)!.owners)} only.` : '';
        this.push(
          'runtime',
          'W_C7_UNKNOWN_ATTRIBUTE',
          el,
          owner,
          `attr:${key}`,
          `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${prefix}:${guess}?${elsewhere})` : ''}; the engines ignore it`,
          fits && addr ? `Rename it: \`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${key}=`)} ${sh(`${addr.prefix}${prefix}:${guess}=${value}`)}\`.` : `Remove it: ${unset}.`,
        );
        continue;
      }
      if (!def.owners.some((o) => this.kit.is(el, o))) {
        this.push('runtime', 'W_C7_MISPLACED_ATTRIBUTE', el, owner, `attr:${key}`, `${key} on ${where} has no effect: the engines read it on ${this.kindsText(def.owners)} only`, this.misplacedHint(el, owner, key, local, value, def.owners));
        continue;
      }
      const side = this.wrongSide(el, owner, local, 'attrs');
      if (side) {
        this.push('runtime', 'W_C7_MISPLACED_ATTRIBUTE', el, owner, `attr:${key}`, `${key} on ${where} has no effect: the engines read it on ${side} only`, `Remove it: ${unset}.`);
        continue;
      }
      if (def.type === 'Boolean' && value !== 'true' && value !== 'false') {
        this.push('runtime', 'W_C7_BAD_VALUE', el, owner, `attr:${key}`, `${key}="${value}" on ${where} is not true or false; the engines read only the exact value true (yes, TRUE or True leave it off)`, addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${key}=true`)}\` (or =false).` : 'Use true or false.');
      }
    }
  }

  private misplacedHint(el: El, owner: El | undefined, key: string, local: string, value: string, owners: string[]): string {
    const addr = this.addressOf(el, owner);
    const id = addr?.id;
    const move = (prefix: string): string => `\`bpmn set <file> ${id} ${sh(`${addr!.prefix}${key}=`)} ${sh(`${prefix}${this.p}:${local}=${value}`)}\``;
    if (id && addr!.prefix === '') {
      const defs = list(el, 'eventDefinitions');
      const fit = defs.findIndex((d) => owners.some((o) => this.kit.is(d, o)));
      if (this.kit.is(el, 'bpmn:Event') && fit !== -1) {
        return `It belongs on the event definition: ${move(defs.length > 1 ? `definition[${fit}].` : 'definition.')}.`;
      }
      if (this.kit.is(el, 'bpmn:Activity') && owners.includes('bpmn:MultiInstanceLoopCharacteristics')) {
        const mi = this.kit.is(peek<El>(el, 'loopCharacteristics'), 'bpmn:MultiInstanceLoopCharacteristics');
        return `It belongs on the multi-instance loop: ${move('loop.')}${mi ? '' : ' (creates a parallel multi-instance loop)'}.`;
      }
      if (this.kit.is(el, 'bpmn:SequenceFlow') && owners.includes('bpmn:FormalExpression') && peek<El>(el, 'conditionExpression')) {
        return `It belongs on the condition: ${move('condition.')}.`;
      }
    }
    return id ? `Remove it: \`bpmn set <file> ${id} ${sh(`${addr!.prefix}${key}=`)}\`.` : 'Remove it from the XML.';
  }

  private allowedTop(local: string, host: El): boolean {
    const t = this.kit.camunda.type(local);
    if (!t) return true;
    const hosts = [...t.allowedIn, ...(EXTRA_HOSTS[local] ?? [])];
    return hosts.some((a) => a === '*' || (a.startsWith('bpmn:') && this.kit.is(host, a)));
  }

  /** Attribute names a camunda element type takes: its own, its camunda super types' and its BPMN super type's. */
  private attrNames(t: CamundaElementType): Set<string> {
    const names = new Set(t.properties.filter((p) => p.isAttr || p.isReference).map((p) => p.name));
    for (const sup of t.bpmnSuperTypes) {
      let known = this.bpmnAttrNames.get(sup);
      if (!known) {
        this.probe ??= this.kit.createModdle();
        known = new Set<string>();
        try {
          const d = this.probe.getElementDescriptor(this.probe.getType(sup)) as { properties?: Array<{ name: string; isAttr?: boolean; isReference?: boolean; isMany?: boolean }> };
          for (const p of d.properties ?? []) if (p.isAttr || (p.isReference && !p.isMany)) known.add(p.name);
        } catch {
          /* unknown BPMN type: nothing to add */
        }
        this.bpmnAttrNames.set(sup, known);
      }
      for (const n of known) names.add(n);
    }
    return names;
  }

  /** Child element names a camunda element type takes as plain text properties (connectorId, expression, string). */
  private textChildNames(t: CamundaElementType): Set<string> {
    return new Set(t.properties.filter((p) => !p.isAttr && !p.isBody && !p.type.includes(':')).map((p) => p.name));
  }

  /** `ext remove` selector for the top-level extension element `v` of `host`: a unique attribute, else its index among its type. */
  private selectorOf(host: El, v: El): string {
    const same = this.extensionValues(host)
      .map((x) => x.el)
      .filter((x) => x.$type === v.$type);
    for (const k of SELECTOR_KEYS) {
      const val = attr(v, k);
      if (val === undefined || val === '' || same.filter((o) => attr(o, k) === val).length !== 1) continue;
      return `${v.$type}[${k}=${/^[\w.:-]+$/.test(val) ? val : `"${val.replace(/"/g, '\\"')}"`}]`;
    }
    return `${v.$type}[${Math.max(0, same.indexOf(v))}]`;
  }

  /**
   * How to rebuild the top-level extension element `v` (of type `local`) of
   * `host`. A single-instance type is replaced as a whole (`--replace`). A
   * repeatable one (listeners, fields, camunda:in/out, error mappings) is
   * removed by its own selector and added again, so its siblings stay:
   * `--replace` would remove every element of the type. `fix` puts placeholders
   * in for the attributes to correct (`{ event: '<start|end>' }`).
   */
  private extHint(host: El, owner: El | undefined, v: El, local: string, fix: Record<string, string> = {}): string {
    const addr = this.addressOf(host, owner);
    if (!addr) return 'Fix it in the XML.';
    const slot = addr.prefix;
    const type = v.$type;
    if (this.kit.camunda.isSingle(local)) {
      return `See it with \`bpmn ext list <file> ${addr.id} --json\`, then rebuild it: \`bpmn ext add <file> ${addr.id} ${this.slotted(slot, type)} --replace --xml '<${type}>...</${type}>'\`.`;
    }
    const flat = this.extAddArgs(v, type, fix);
    const again = flat ? `\`bpmn ext add <file> ${addr.id} ${this.slotted(slot, flat)}\`` : `\`bpmn ext add <file> ${addr.id} ${this.slotted(slot, type)} --xml '<${type} ...>...</${type}>'\` (\`bpmn ext list <file> ${addr.id} --json\` shows it)`;
    return `Replace just this one (--replace would remove every ${type}): \`bpmn ext remove <file> ${addr.id} ${sh(`${slot}${this.selectorOf(host, v)}`)}\`, then ${again}.`;
  }

  /** Attributes and children of a generic camunda element, recursively. */
  private checkVendorElement(v: El, host: El, owner: El | undefined, topEl: El, path: string): void {
    const local = localName(v.$type);
    const t = this.kit.camunda.type(local);
    if (!t) return;
    const rebuild = (): string => this.extHint(host, owner, topEl, localName(topEl.$type));
    const where = `${this.p}:${local}${path ? ` (in ${path})` : ''} of ${this.describe(host, owner)}`;
    const names = this.attrNames(t);
    for (const extra of EXTRA_ATTRS[local] ?? []) names.add(extra);
    for (const [k, raw] of Object.entries(v as unknown as Record<string, unknown>)) {
      if (k.startsWith('$') || k.startsWith('xmlns')) continue;
      if (k.includes(':')) {
        if (this.uriOfAttr(k) === this.kit.zeebe.uri) this.push('runtime', 'W_C7_FOREIGN_CONTENT', host, owner, `ext:${path}/${local}@${k}`, `${where} carries the Camunda 8 attribute ${k}, which Camunda 7 ignores`, rebuild());
        continue;
      }
      if (!names.has(k)) {
        const guess = didYouMean(k, [...names]);
        this.push('runtime', 'W_C7_UNKNOWN_ATTRIBUTE', host, owner, `ext:${path}/${local}@${k}`, `${where} has the unknown attribute ${k}${guess ? ` (did you mean ${guess}?)` : ''}; the engines ignore it`, rebuild());
        continue;
      }
      const prop = t.properties.find((p) => p.name === k);
      if (prop?.type === 'Boolean' && raw !== 'true' && raw !== 'false' && raw !== true && raw !== false) {
        this.push('runtime', 'W_C7_BAD_VALUE', host, owner, `ext:${path}/${local}@${k}`, `${k}="${String(raw)}" on ${where} is not true or false; the engines read only the exact value true`, rebuild());
      }
    }
    const texts = this.textChildNames(t);
    const kids = peek<unknown[]>(v, '$children');
    for (const c of Array.isArray(kids) ? (kids as El[]) : []) {
      if (!c || typeof c.$type !== 'string' || !isGeneric(c)) continue;
      const uri = this.ns.uriOfElement(c);
      const cl = localName(c.$type);
      if (uri === this.kit.zeebe.uri) {
        this.push('runtime', 'W_C7_FOREIGN_CONTENT', host, owner, `ext:${path}/${local}/${cl}`, `${where} contains the Camunda 8 element ${c.$type}, which Camunda 7 ignores`, rebuild());
        continue;
      }
      if (!this.kit.camunda.reads(uri)) continue;
      const childPath = path ? `${path} > ${this.p}:${local}` : `${this.p}:${local}`;
      if (texts.has(cl)) continue;
      const ct = this.kit.camunda.type(cl);
      if (!ct) {
        const guess = didYouMean(cl, [...texts, ...t.properties.filter((p) => p.type.startsWith('camunda:')).map((p) => localName(p.type).replace(/^./, (s) => s.toLowerCase()))]);
        this.push('runtime', 'W_C7_UNKNOWN_ELEMENT', host, owner, `ext:${childPath}/${cl}`, `${where} contains the unknown element ${this.p}:${cl}${guess ? ` (did you mean ${this.p}:${guess}?)` : ''}; the engines ignore it`, rebuild());
        continue;
      }
      if (!this.kit.camunda.containersOf(cl).includes(t.name)) {
        this.push('runtime', 'W_C7_MISPLACED_EXTENSION', host, owner, `ext:${childPath}/${cl}`, `${this.p}:${cl} does not belong inside ${this.p}:${local} (${where}); the engines ignore it`, rebuild());
        continue;
      }
      this.checkVendorElement(c, host, owner, topEl, childPath);
    }
  }

  private isAsync(el: El): boolean {
    return ['async', 'asyncBefore', 'asyncAfter'].some((a) => this.c7(el, a) === 'true');
  }

  private hasTimer(el: El): boolean {
    return list(el, 'eventDefinitions').some((d) => this.kit.is(d, 'bpmn:TimerEventDefinition'));
  }

  /** Extension elements of one BPMN element: unknown/misplaced types, duplicates, foreign content and the engine rules on their content. */
  private checkExtensions(host: El, owner: El | undefined, executable: boolean): void {
    const values = this.extensionValues(host);
    if (!values.length) return;
    // `ext` addresses the extension elements of an event definition / loop / condition through its flow node (or
    // flow) with a key prefix, also when the nested element has an id of its own (`ext <ownId> definition.0` fails)
    const addr = this.addressOf(host, owner);
    const hostId = addr?.id;
    const slot = addr?.prefix ?? '';
    const where = this.describe(host, owner);
    if (this.kit.is(host, 'bpmn:Definitions')) {
      const types = values.map((v) => v.el.$type).join(', ');
      this.push('deploy', 'W_C7_DEPLOY_DEFINITIONS_EXTENSION', host, undefined, 'definitions', `bpmn:definitions carries bpmn:extensionElements (${types}), which the BPMN schema does not allow there; the engines refuse the file`, `Move the content to the process: \`bpmn ext remove <file> ${hostId ?? '<definitionsId>'} <type>\`, then \`bpmn ext add <file> <processId> <type> ...\`.`);
      return;
    }
    // per namespace: Operaton reads one operaton:inputOutput next to one camunda:inputOutput (engine-checked)
    const byType = new Map<string, { local: string; type: string; uri: string; els: El[] }>();
    for (const v of values) {
      if (!v.uri) continue;
      if (v.uri === this.kit.zeebe.uri) {
        this.push('runtime', 'W_C7_FOREIGN_CONTENT', host, owner, `ext:${v.el.$type}`, `${where} contains the Camunda 8 extension ${v.el.$type}, which Camunda 7 ignores`, hostId ? `Remove it: \`bpmn ext remove <file> ${hostId} ${this.slotted(slot, v.el.$type)}\`.` : 'Remove it from the XML.');
        continue;
      }
      if (!this.kit.camunda.reads(v.uri)) continue;
      const t = this.kit.camunda.type(v.local);
      if (!t) {
        const guess = didYouMean(v.local, this.typeNames());
        this.push('runtime', 'W_C7_UNKNOWN_ELEMENT', host, owner, `ext:${v.local}`, `${where} has the unknown extension element ${this.p}:${v.local}${guess ? ` (did you mean ${this.p}:${guess}?)` : ''}; the engines ignore it`, hostId ? `Remove it (\`bpmn ext remove <file> ${hostId} ${this.slotted(slot, String(v.index))}\`) and add the right one with \`bpmn ext add <file> ${hostId} ${this.slotted(slot, `${this.p}:${guess ?? '<type>'}`)} ...\`.` : 'Fix it in the XML.');
        continue;
      }
      const key = `${v.uri}\u0000${v.local}`;
      const group = byType.get(key) ?? { local: v.local, type: v.el.$type, uri: v.uri, els: [] };
      group.els.push(v.el);
      byType.set(key, group);
      const side = this.wrongSide(host, owner, v.local, 'ext');
      if (side) {
        this.push('runtime', 'W_C7_MISPLACED_EXTENSION', host, owner, `ext:${v.local}`, `${v.el.$type} on ${where} has no effect: the engines read it on ${side} only`, hostId ? `Remove it: \`bpmn ext remove <file> ${hostId} ${sh(`${slot}${this.selectorOf(host, v.el)}`)}\`.` : 'Remove it from the XML.');
        continue;
      }
      if (!this.allowedTop(v.local, host)) {
        const containers = t.allowedIn.length ? [] : this.kit.camunda.containersOf(v.local);
        const message = containers.length
          ? `${this.p}:${v.local} sits directly in the extension elements of ${where}, but belongs inside ${containers.map((c) => c.replace(/^camunda:/, `${this.p}:`)).join(' / ')}; the engines ignore it`
          : `${this.p}:${v.local} on ${where} has no effect: the engines read it on ${this.kindsText([...t.allowedIn, ...(EXTRA_HOSTS[v.local] ?? [])])} only`;
        const again = this.extAddArgs(v.el, `${this.p}:${v.local}`);
        const hint = !hostId
          ? 'Fix it in the XML.'
          : containers.length
            ? `Remove it (\`bpmn ext remove <file> ${hostId} ${this.slotted(slot, String(v.index))}\`) and add it again, \`bpmn ext add\` files it into its container: ${again ? `\`bpmn ext add <file> ${hostId} ${this.slotted(slot, again)}\`` : `\`bpmn ext add <file> ${hostId} ${this.slotted(slot, `${this.p}:${v.local}`)} --xml '...'\``}.`
            : `Remove it: \`bpmn ext remove <file> ${hostId} ${this.slotted(slot, String(v.index))}\`${this.movable(host, owner, v.local, again)}.`;
        this.push('runtime', 'W_C7_MISPLACED_EXTENSION', host, owner, `ext:${v.local}`, message, hint);
        continue;
      }
      this.checkVendorElement(v.el, host, owner, v.el, '');
      if (executable) this.checkExtensionRules(host, owner, v.el, v.local);
    }
    if (!executable) return;
    // duplicates of the containers the engines read with a single-element lookup
    for (const { local, type, uri, els } of byType.values()) {
      if (els.length < 2) continue;
      let read = false;
      if (local === 'inputOutput') read = this.kit.is(host, 'bpmn:FlowNode');
      else if (local === 'connector') read = SERVICE_LIKE.some((t) => this.kit.is(host, t));
      else if (local === 'formData') read = this.kit.is(host, 'bpmn:UserTask') || this.kit.is(host, 'bpmn:StartEvent');
      else if (local === 'failedJobRetryTimeCycle') read = this.isAsync(host) || this.hasTimer(host);
      else continue;
      if (!read && local !== 'failedJobRetryTimeCycle') continue;
      const merge = hostId ? `Merge them into one: \`bpmn ext list <file> ${hostId} --json\`, then \`bpmn ext add <file> ${hostId} ${this.slotted(slot, type)} --replace --xml '<${type}>...</${type}>'\`.` : 'Merge them in the XML.';
      const subject = `dup:${local}${uri === this.kit.camunda.uri ? '' : `@${uri}`}`;
      if (read) {
        this.push('deploy', 'W_C7_DEPLOY_DUPLICATE_EXTENSION', host, owner, subject, `${where} has ${els.length} ${type} elements; the engines refuse the file (ENGINE-01009 multiple elements with tag name ${local})`, merge);
      } else {
        this.push('practice', 'W_C7_DUPLICATE_EXTENSION', host, owner, subject, `${where} has ${els.length} ${type} elements; once it runs asynchronously the engines refuse the file`, merge);
      }
    }
    this.checkInputOutputHost(host, owner, [...byType.values()].filter((g) => g.local === 'inputOutput').flatMap((g) => g.els));
  }

  /**
   * `, then add it to <flow node>: ...` when an extension element on a nested
   * element (an event definition, a loop) is read on the flow node that holds
   * it and that node has none of its type yet; '' otherwise.
   */
  private movable(host: El, owner: El | undefined, local: string, again: string | undefined): string {
    const oid = idOf(owner);
    if (!owner || owner === host || !oid || !again || !this.allowedTop(local, owner) || this.camundaExt(owner, local).length) return '';
    return `, then add it to ${this.describe(owner, undefined)}, where the engines read it: \`bpmn ext add <file> ${oid} ${again}\``;
  }

  private typeNames(): string[] {
    if (this.typeNameCache) return this.typeNameCache;
    const names = new Set<string>();
    for (const a of ['inputOutput', 'inputParameter', 'outputParameter', 'in', 'out', 'field', 'connector', 'properties', 'property', 'formData', 'formField', 'formProperty', 'taskListener', 'executionListener', 'failedJobRetryTimeCycle', 'errorEventDefinition', 'potentialStarter', 'list', 'map', 'entry', 'value', 'script', 'validation', 'constraint']) {
      if (this.kit.camunda.type(a)) names.add(a);
    }
    this.typeNameCache = [...names];
    return this.typeNameCache;
  }

  /** Engine rules on the content of one (allowed, top-level) camunda extension element. */
  private checkExtensionRules(host: El, owner: El | undefined, v: El, local: string): void {
    const where = this.describe(host, owner);
    const rebuild = (fix: Record<string, string> = {}): string => this.extHint(host, owner, v, local, fix);
    if (local === 'executionListener' || local === 'taskListener') {
      if (local === 'taskListener' && !this.kit.is(host, 'bpmn:UserTask')) return;
      const impl = ['class', 'expression', 'delegateExpression'].some((a) => this.nonEmpty(attr(v, a))) || this.children(v, 'script').length > 0;
      const event = attr(v, 'event');
      const label = `${this.p}:${local}${event ? ` (event ${event})` : ''} of ${where}`;
      if (!impl) this.push('deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:${event}:impl`, `${label} has no class, expression, delegateExpression or script; the engines refuse the file`, rebuild({ [`expression`]: '${...}' }));
      if (!this.kit.is(host, 'bpmn:SequenceFlow')) {
        const allowed = local === 'taskListener' ? TASK_EVENTS : EXECUTION_EVENTS;
        const placeholder = `<${allowed.join('|')}>`;
        if (event === undefined) this.push('deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:event`, `${label} has no event; the engines refuse the file`, `Set event to one of ${allowed.join(', ')}. ${rebuild({ event: placeholder })}`);
        else if (!allowed.includes(event)) this.push('deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:${event}:event`, `${label}: event "${event}" is not one of ${allowed.join(', ')}; the engines refuse the file`, `${event === 'take' && local === 'executionListener' ? 'take is only read on sequence flows. ' : ''}${rebuild({ event: placeholder })}`);
      }
      for (const s of this.children(v, 'script')) {
        if (!this.nonEmpty(attr(s, 'scriptFormat'))) this.push('deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:${event}:script`, `The script of ${label} has no scriptFormat; the engines refuse the file`, rebuild());
      }
      if (local === 'taskListener' && event === 'timeout') {
        const kids = peek<unknown[]>(v, '$children');
        const timer = Array.isArray(kids) && (kids as El[]).some((c) => c && typeof c.$type === 'string' && /timerEventDefinition$/i.test(c.$type));
        if (!timer) this.push('deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:timeout:timer`, `${label} has no bpmn:timerEventDefinition; the engines refuse the file`, rebuild());
        if (attr(v, 'id') === undefined) this.push('deploy', 'W_C7_DEPLOY_LISTENER', host, owner, `listener:${local}:timeout:id`, `${label} has no id, which the engines require on timeout task listeners; they refuse the file`, rebuild({ id: '<listenerId>' }));
      }
      // fields of a class / delegateExpression listener are parsed when the file is deployed
      const fieldsHere = this.children(v, 'field');
      if (fieldsHere.length && this.fieldsRead(v)) {
        const addr = this.addressOf(host, owner);
        this.checkFieldValues(host, owner, fieldsHere, label, addr ? `${addr.id} ${sh(`${addr.prefix}${this.selectorOf(host, v)}/${this.p}:field`)}` : undefined);
      }
      return;
    }
    if (local === 'in' || local === 'out') {
      if (!this.kit.is(host, 'bpmn:CallActivity') && !(local === 'in' && this.kit.is(host, 'bpmn:SignalEventDefinition'))) return;
      if (attr(v, 'variables') !== undefined || (local === 'in' && attr(v, 'businessKey') !== undefined)) return;
      const source = attr(v, 'source') !== undefined || attr(v, 'sourceExpression') !== undefined;
      const target = attr(v, 'target') !== undefined;
      if (!source || !target) {
        const missing = [!source ? 'source or sourceExpression' : '', !target ? 'target' : ''].filter(Boolean).join(' and ');
        const fix: Record<string, string> = {};
        if (!source) fix['source'] = '<var>';
        if (!target) fix['target'] = '<var>';
        this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `${local}:${attr(v, 'source') ?? attr(v, 'sourceExpression') ?? attr(v, 'target') ?? ''}`, `${this.p}:${local} of ${where} has no ${missing} (and no variables="all"${local === 'in' ? ' / businessKey' : ''}); the engines refuse the file`, `${rebuild(fix).replace(/\.$/, '')} (or with variables=all instead of source and target).`);
      }
      return;
    }
    if (local === 'inputOutput') {
      this.checkParameters(host, owner, v, rebuild(), local);
      return;
    }
    if (local === 'connector') {
      const ids = this.children(v).filter((c) => localName(c.$type) === 'connectorId');
      if (!ids.length) this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, 'connector:id', `${this.p}:connector of ${where} has no ${this.p}:connectorId; the engines refuse the file`, rebuild());
      if (ids.length > 1) this.push('deploy', 'W_C7_DEPLOY_DUPLICATE_EXTENSION', host, owner, 'dup:connectorId', `${this.p}:connector of ${where} has ${ids.length} ${this.p}:connectorId elements; the engines refuse the file`, rebuild());
      const ios = this.children(v, 'inputOutput');
      if (ios.length > 1) this.push('deploy', 'W_C7_DEPLOY_DUPLICATE_EXTENSION', host, owner, 'dup:connector/inputOutput', `${this.p}:connector of ${where} has ${ios.length} ${this.p}:inputOutput elements; the engines refuse the file`, rebuild());
      for (const io of ios) this.checkParameters(host, owner, io, rebuild(), 'connector');
      return;
    }
    if (local === 'formData' && (this.kit.is(host, 'bpmn:UserTask') || this.kit.is(host, 'bpmn:StartEvent'))) {
      this.children(v, 'formField').forEach((f, i) => {
        const label = `Form field ${attr(f, 'id') ?? i + 1} of ${where}`;
        if (!this.nonEmpty(attr(f, 'id'))) this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `formField#${i}:id`, `${label} has no id; the engines refuse the file`, rebuild());
        const type = attr(f, 'type');
        if (type === undefined) this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `formField#${i}:type`, `${label} has no type; the engines refuse the file`, `Use one of ${FORM_TYPES.join(', ')}. ${rebuild()}`);
        else if (!FORM_TYPES.includes(type)) this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `formField#${i}:type`, `${label} has type "${type}", which is not one of the built-in form types ${FORM_TYPES.join(', ')}; the engines refuse the file (unless a plugin registers it as a custom form type)`, rebuild());
      });
    }
  }

  private checkParameters(host: El, owner: El | undefined, io: El, rebuild: string, scope: string): void {
    const where = this.describe(host, owner);
    for (const kind of ['inputParameter', 'outputParameter']) {
      this.children(io, kind).forEach((param, i) => {
        if (!this.nonEmpty(attr(param, 'name'))) this.push('deploy', 'W_C7_DEPLOY_EXTENSION', host, owner, `${scope}:${kind}#${i}:name`, `${this.p}:${kind} ${i + 1} of ${where} has no name; the engines refuse the file`, rebuild);
      });
    }
  }

  /** Where the engines refuse camunda:inputOutput. */
  private checkInputOutputHost(host: El, owner: El | undefined, ios: El[]): void {
    if (!ios.length || !this.kit.is(host, 'bpmn:FlowNode')) return;
    const hostId = idOf(host) ?? idOf(owner);
    const where = this.describe(host, owner);
    const remove = hostId ? `Move the mappings to the next activity and remove them here: \`bpmn ext remove <file> ${hostId} ${this.p}:inputOutput\`.` : 'Remove it from the XML.';
    if (this.kit.is(host, 'bpmn:StartEvent') || this.kit.is(host, 'bpmn:BoundaryEvent') || this.kit.is(host, 'bpmn:Gateway') || this.isEventSubProcess(host)) {
      const kind = this.isEventSubProcess(host) ? 'an event sub-process' : `a ${this.describe(host, undefined).split(' ')[0]}`;
      this.push('deploy', 'W_C7_DEPLOY_INPUT_OUTPUT', host, owner, 'io:host', `${this.p}:inputOutput on ${where}: the engines do not support input/output mappings on ${kind} and refuse the file`, remove);
      return;
    }
    const outputs = ios.some((io) => this.children(io, 'outputParameter').length > 0);
    if (!outputs) return;
    const dropOutputs = hostId ? `Remove the output parameters: rebuild the mapping without them (\`bpmn ext list <file> ${hostId} --json\`, then \`bpmn ext add <file> ${hostId} ${this.p}:inputOutput --replace --xml '...'\`).` : 'Remove them from the XML.';
    if (this.kit.is(host, 'bpmn:EndEvent')) {
      this.push('deploy', 'W_C7_DEPLOY_INPUT_OUTPUT', host, owner, 'io:output', `${this.p}:outputParameter on end event ${hostId}: the engines refuse output mappings on end events`, dropOutputs);
    } else if (this.kit.is(peek<El>(host, 'loopCharacteristics'), 'bpmn:MultiInstanceLoopCharacteristics')) {
      this.push('deploy', 'W_C7_DEPLOY_INPUT_OUTPUT', host, owner, 'io:output', `${this.p}:outputParameter on multi-instance ${where}: the engines refuse output mappings on multi-instance activities`, `${dropOutputs} Collect results in an activity inside the loop instead.`);
    }
  }

  private validTtl(v: string): boolean {
    const m = /^\+?(\d+)$/.exec(v) ?? /^P(\d+)D$/.exec(v);
    return !!m && Number(m[1]) <= TTL_MAX;
  }

  private checkProcess(proc: El): void {
    const id = idOf(proc) ?? '<processId>';
    const ttl = this.c7(proc, 'historyTimeToLive');
    const hint = `\`bpmn set <file> ${id} ${this.p}:historyTimeToLive=180\` (days, like Camunda Modeler; P180D works too).`;
    if (!this.nonEmpty(ttl)) {
      this.push('deploy', 'W_C7_DEPLOY_HISTORY_TTL', proc, undefined, 'ttl', `Executable process ${id} has no ${this.p}:historyTimeToLive; Camunda 7.20+, CIB seven and Operaton refuse to deploy it (ENGINE-12018)`, hint);
    } else if (!this.validTtl(ttl)) {
      this.push('deploy', 'W_C7_DEPLOY_HISTORY_TTL', proc, undefined, 'ttl', `${this.p}:historyTimeToLive="${ttl}" of process ${id} is not a number of days (or P<n>D); the engines refuse it`, hint);
    }
    this.checkPriorities(proc, undefined, ['jobPriority', 'taskPriority']);
  }

  private isNumber(v: string): boolean {
    return /^[+-]?\d+$/.test(v.trim()) && v.trim() === v;
  }

  /** jobPriority / taskPriority must be numbers or expressions; the engines check them at deploy time. */
  private checkPriorities(el: El, owner: El | undefined, names: string[]): void {
    const addr = this.addressOf(el, owner);
    for (const name of names) {
      const v = this.c7(el, name);
      if (v === undefined || this.isNumber(v) || this.isExpression(v)) continue;
      if (!this.kit.camunda.attr(name)?.owners.some((o) => this.kit.is(el, o))) continue;
      this.push('deploy', 'W_C7_DEPLOY_BAD_VALUE', el, owner, `attr:${name}`, `${this.p}:${name}="${v}" on ${this.describe(el, owner)} is not a number or expression; the engines refuse it`, addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${this.p}:${name}=50`)}\` (an integer or \${...}).` : 'Use an integer.');
    }
  }

  /** Implementation of a service-like element: a task, or the messageEventDefinition of a message throw/end event. */
  private checkImplementation(el: El, owner: El | undefined, label: string, opts: { decisionRef?: boolean; event?: El } = {}): void {
    const addr = this.addressOf(el, owner);
    const set = (kv: string): string => (addr ? `\`bpmn set <file> ${addr.id} ${kv.split(' ').map((p) => sh(`${addr.prefix}${p}`)).join(' ')}\`` : 'edit the XML');
    const type = this.c7(el, 'type');
    const topic = this.c7(el, 'topic');
    const external = type !== undefined && type.toLowerCase() === 'external';
    const shell = type !== undefined && type.toLowerCase() === 'shell';
    const p = this.p;
    // `ext add` type argument for one camunda:field of this element (keyed by name: replaces it)
    const fieldAdd = addr ? `${addr.id} ${sh(`${addr.prefix}${p}:field`)}` : undefined;
    if (type !== undefined && !external && !shell) {
      const mail = type.toLowerCase() === 'mail' ? ' (the standard engine distributions cannot load the mail task)' : '';
      this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, 'impl:type', `${p}:type="${type}" on ${label} is not supported (only "external" and "shell")${mail}; the engines refuse the file`, `Use an external task: ${set(`${p}:type=external ${p}:topic=<topic>`)}, or remove it: ${set(`${p}:type=`)}.`);
      return;
    }
    if (shell) this.checkShell(el, owner, label, fieldAdd);
    if (this.fieldsRead(el, { type })) this.checkFieldValues(el, owner, this.camundaExt(el, 'field'), label, fieldAdd);
    const impl =
      ['class', 'delegateExpression', 'expression'].some((a) => this.nonEmpty(this.c7(el, a))) ||
      external ||
      shell ||
      this.hasConnector(el, opts.event) ||
      (opts.decisionRef === true && this.c7(el, 'decisionRef') !== undefined);
    if (!impl) {
      if (opts.event) {
        const misplaced = ['class', 'delegateExpression', 'expression', 'type', 'topic'].some((a) => this.c7(opts.event, a) !== undefined);
        if (!misplaced) {
          this.push('runtime', 'W_C7_MESSAGE_NO_IMPLEMENTATION', el, owner, 'impl', `${label} has no implementation: it sends nothing and behaves like a none event at run time`, `Give it one: ${set(`${p}:type=external ${p}:topic=<topic>`)} (or ${p}:delegateExpression=\${...}).`);
        }
        return;
      }
      const hint = topic !== undefined ? `It has a ${p}:topic but no ${p}:type: ${set(`${p}:type=external`)}.` : `Give it one: ${set(`${p}:type=external ${p}:topic=<topic>`)} (or ${p}:delegateExpression=\${...}, ${p}:class=..., ${p}:expression=\${...}${opts.decisionRef ? `, ${p}:decisionRef=<decisionId>` : ''}).`;
      this.push('deploy', 'W_C7_DEPLOY_IMPLEMENTATION', el, owner, 'impl', `${label} has no implementation (${p}:class, delegateExpression, expression, type=external${opts.decisionRef ? ', decisionRef' : ''} or a connector); the engines refuse the file`, hint);
      return;
    }
    if (external && topic === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_EXTERNAL_TOPIC', el, owner, 'topic', `${label} is an external task without ${p}:topic; the engines refuse the file`, `${set(`${p}:topic=<topic>`)}.`);
    } else if (external && topic === '') {
      this.push('runtime', 'W_C7_BAD_VALUE', el, owner, 'attr:topic', `${label} is an external task with an empty ${p}:topic; no worker can fetch it`, `${set(`${p}:topic=<topic>`)}.`);
    }
    if (this.c7(el, 'resultVariable') !== undefined && (this.nonEmpty(this.c7(el, 'class')) || this.nonEmpty(this.c7(el, 'delegateExpression')))) {
      this.push('deploy', 'W_C7_DEPLOY_RESULT_VARIABLE', el, owner, 'resultVariable', `${label} combines ${p}:resultVariable with ${this.nonEmpty(this.c7(el, 'class')) ? `${p}:class` : `${p}:delegateExpression`}; the engines support a result variable only with ${p}:expression and refuse the file`, `Remove it: ${set(`${p}:resultVariable=`)} (or switch to ${p}:expression=\${...}).`);
    }
    if (external) this.checkPriorities(el, owner, ['taskPriority']);
  }

  private checkBinding(el: El, binding: string, version: string, versionTag: string | undefined, allowed: string[]): void {
    const id = idOf(el)!;
    const p = this.p;
    const b = this.c7(el, binding);
    if (b === undefined) return;
    if (b === 'version' && this.c7(el, version) === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_BINDING_VERSION', el, undefined, binding, `${this.describe(el, undefined)} has ${p}:${binding}="version" but no ${p}:${version}; the engines refuse the file`, `\`bpmn set <file> ${id} ${p}:${version}=<n>\` (or \`${p}:${binding}=latest\`).`);
    } else if (b === 'versionTag' && versionTag && this.c7(el, versionTag) === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_BINDING_VERSION', el, undefined, binding, `${this.describe(el, undefined)} has ${p}:${binding}="versionTag" but no ${p}:${versionTag}; the engines refuse the file`, `\`bpmn set <file> ${id} ${p}:${versionTag}=<tag>\` (or \`${p}:${binding}=latest\`).`);
    } else if (!allowed.includes(b)) {
      this.push('runtime', 'W_C7_BAD_VALUE', el, undefined, `attr:${binding}`, `${p}:${binding}="${b}" on ${this.describe(el, undefined)} is not one of ${allowed.join(', ')}; the engines accept the file but cannot resolve the reference as intended`, `\`bpmn set <file> ${id} ${p}:${binding}=latest\`.`);
    }
  }

  private checkCallActivity(el: El): void {
    const id = idOf(el)!;
    const p = this.p;
    const called = peek<string>(el, 'calledElement');
    const caseRef = this.c7(el, 'caseRef');
    if (called === undefined && caseRef === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_CALLED_ELEMENT', el, undefined, 'calledElement', `Call activity ${id} has no calledElement (nor ${p}:caseRef); the engines refuse the file`, `\`bpmn set <file> ${id} calledElement=<processId>\`.`);
    } else if (called !== undefined && caseRef !== undefined) {
      this.push('deploy', 'W_C7_DEPLOY_CALLED_ELEMENT', el, undefined, 'calledElement+caseRef', `Call activity ${id} has both calledElement and ${p}:caseRef; the engines refuse the file`, `Keep one: \`bpmn set <file> ${id} ${p}:caseRef=\`.`);
    } else if (called === '') {
      this.push('runtime', 'W_C7_BAD_VALUE', el, undefined, 'attr:calledElement', `Call activity ${id} has an empty calledElement; it fails when it runs`, `\`bpmn set <file> ${id} calledElement=<processId>\`.`);
    }
    this.checkBinding(el, 'calledElementBinding', 'calledElementVersion', 'calledElementVersionTag', BINDINGS);
    this.checkBinding(el, 'caseBinding', 'caseVersion', undefined, CASE_BINDINGS);
  }

  private checkBusinessRule(el: El): void {
    if (this.c7(el, 'decisionRef') === undefined) return;
    this.checkBinding(el, 'decisionRefBinding', 'decisionRefVersion', 'decisionRefVersionTag', BINDINGS);
    const map = this.c7(el, 'mapDecisionResult');
    if (map !== undefined && !DECISION_MAPPERS.includes(map)) {
      this.push('deploy', 'W_C7_DEPLOY_BAD_VALUE', el, undefined, 'attr:mapDecisionResult', `${this.p}:mapDecisionResult="${map}" on ${this.describe(el, undefined)} is not one of ${DECISION_MAPPERS.join(', ')}; the engines refuse the file`, `\`bpmn set <file> ${idOf(el)} ${this.p}:mapDecisionResult=singleEntry\` (or another of the four).`);
    }
  }

  private checkForms(el: El): void {
    const id = idOf(el)!;
    const p = this.p;
    const formRef = this.c7(el, 'formRef');
    if (formRef === undefined) return;
    if (this.c7(el, 'formKey') !== undefined) {
      this.push('deploy', 'W_C7_DEPLOY_FORM', el, undefined, 'formKey+formRef', `${this.describe(el, undefined)} has both ${p}:formKey and ${p}:formRef; the engines refuse the file`, `Keep one: \`bpmn set <file> ${id} ${p}:formKey=\` (or ${p}:formRef=).`);
    }
    const binding = this.c7(el, 'formRefBinding');
    if (binding === undefined || !FORM_BINDINGS.includes(binding)) {
      this.push('deploy', 'W_C7_DEPLOY_FORM', el, undefined, 'formRefBinding', `${this.describe(el, undefined)} has ${p}:formRef but ${binding === undefined ? `no ${p}:formRefBinding` : `${p}:formRefBinding="${binding}"`} (one of ${FORM_BINDINGS.join(', ')} is required); the engines refuse the file`, `\`bpmn set <file> ${id} ${p}:formRefBinding=latest\`.`);
    } else if (binding === 'version' && this.c7(el, 'formRefVersion') === undefined) {
      this.push('deploy', 'W_C7_DEPLOY_BINDING_VERSION', el, undefined, 'formRefBinding', `${this.describe(el, undefined)} has ${p}:formRefBinding="version" but no ${p}:formRefVersion; the engines refuse the file`, `\`bpmn set <file> ${id} ${p}:formRefVersion=<n>\` (or ${p}:formRefBinding=latest).`);
    }
  }

  private checkMultiInstance(activity: El): void {
    const loop = peek<El>(activity, 'loopCharacteristics');
    if (!this.kit.is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) return;
    const id = idOf(activity)!;
    const p = this.p;
    const card = peek<El>(loop, 'loopCardinality');
    const collection = this.c7(loop, 'collection');
    // the engines read loopDataInputRef as a variable name; bpmn-moddle cannot resolve that and only reports it on import
    const dataInput = peek<unknown>(loop, 'loopDataInputRef') ?? this.doc.importWarnings.some((w) => (w as { element?: unknown }).element === loop && /loopDataInputRef/.test(String((w as { property?: unknown }).property ?? '')));
    const elementVariable = this.c7(loop, 'elementVariable');
    if (!card && collection === undefined && !dataInput) {
      const misplaced = this.c7(activity, 'collection');
      const message = `Multi-instance ${this.describe(activity, undefined)} has neither a loop cardinality nor ${p}:collection${misplaced !== undefined ? ` (${p}:collection sits on the activity, not on the loop)` : ''}; the engines refuse the file`;
      const hint =
        misplaced !== undefined
          ? `Move it onto the loop: \`bpmn set <file> ${id} ${p}:collection= ${sh(`loop.${p}:collection=${misplaced}`)}${this.c7(activity, 'elementVariable') !== undefined ? ` ${p}:elementVariable= ${sh(`loop.${p}:elementVariable=${this.c7(activity, 'elementVariable')}`)}` : ''}\`.`
          : `\`bpmn set <file> ${id} ${sh(`loop.${p}:collection=\${items}`)} loop.${p}:elementVariable=item\` (or \`bpmn set <file> ${id} cardinality=3\`).`;
      this.push('deploy', 'W_C7_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi', message, hint);
      return;
    }
    if (card && !this.nonEmpty(peek<string>(card, 'body')) && collection === undefined && !dataInput) {
      this.push('deploy', 'W_C7_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi:cardinality', `Multi-instance ${this.describe(activity, undefined)} has an empty loop cardinality; the engines refuse the file`, `\`bpmn set <file> ${id} cardinality=3\` (a number or \${...}).`);
    }
    if (elementVariable !== undefined && collection === undefined && !dataInput) {
      this.push('deploy', 'W_C7_DEPLOY_MULTI_INSTANCE', activity, undefined, 'mi:elementVariable', `Multi-instance ${this.describe(activity, undefined)} has ${p}:elementVariable but no ${p}:collection; the engines refuse the file`, `\`bpmn set <file> ${id} ${sh(`loop.${p}:collection=\${items}`)}\` (or remove it: \`bpmn set <file> ${id} loop.${p}:elementVariable=\`).`);
    }
  }

  private definitionOf(el: El, type: string): El | undefined {
    return this.actedOn(el).find((d) => this.kit.is(d, type));
  }

  /**
   * The order in which the engines pick the one event definition they act on
   * when an event has several (engine-checked on all three engines, each pair
   * in both XML orders): the first kind present wins, the others are not even
   * parsed (a broken ignored definition deploys, a broken acting one does not).
   * Throw events: only message + signal checked. Other kinds: unknown
   * (undefined; every definition is checked then).
   */
  private actingOrder(el: El): string[] | undefined {
    if (this.kit.is(el, 'bpmn:IntermediateCatchEvent')) return ['Timer', 'Signal', 'Message', 'Link', 'Conditional'];
    if (this.kit.is(el, 'bpmn:BoundaryEvent')) return ['Timer', 'Signal', 'Message', 'Conditional'];
    if (this.kit.is(el, 'bpmn:IntermediateThrowEvent')) return ['Signal', 'Message'];
    if (this.kit.is(el, 'bpmn:EndEvent')) return ['Message', 'Signal'];
    if (this.kit.is(el, 'bpmn:StartEvent')) {
      const parent = el.$parent as El | undefined;
      if (parent && this.isEventSubProcess(parent)) return ['Message', 'Signal', 'Timer', 'Conditional'];
      if (parent && this.kit.is(parent, 'bpmn:Process')) return ['Timer', 'Message', 'Signal', 'Conditional'];
    }
    return undefined;
  }

  /** The event definition the engines act on when `el` has several, or undefined (one definition, or an order not known). */
  private actingDefinition(el: El): El | undefined {
    const defs = list(el, 'eventDefinitions');
    const order = defs.length > 1 ? this.actingOrder(el) : undefined;
    if (!order) return undefined;
    const kinds = defs.map((d) => order.findIndex((k) => this.kit.is(d, `bpmn:${k}EventDefinition`)));
    if (kinds.some((k) => k === -1)) return undefined;
    return defs[kinds.indexOf(Math.min(...kinds))];
  }

  /** The event definitions the engines read: the acting one of several, else all. */
  private actedOn(el: El): El[] {
    const acting = this.actingDefinition(el);
    return acting ? [acting] : list(el, 'eventDefinitions');
  }

  /**
   * An event with several event definitions (BPMN's "multiple" trigger): the
   * engines act on one of them and ignore the others (engine-checked: a message
   * + timer catch event creates only the timer job). Runtime: it deploys.
   */
  private checkMultipleDefinitions(el: El): void {
    const defs = list(el, 'eventDefinitions');
    if (defs.length < 2) return;
    const id = idOf(el)!;
    const kinds = defs.map(triggerName);
    const acting = this.actingDefinition(el);
    const what = acting
      ? `the engines act on the ${triggerName(acting)} only and ignore the ${kinds.filter((_, i) => defs[i] !== acting).join(' and ')}`
      : 'the engines act on one of them only and ignore the others';
    const keep = acting ? triggerName(acting) : '<trigger>';
    this.push('runtime', 'W_C7_MULTIPLE_EVENT_DEFINITIONS', el, undefined, 'definitions', `${this.describe(el, undefined)} has ${defs.length} event definitions (${kinds.join(', ')}); ${what}`, `Keep one: \`bpmn set <file> ${id} trigger=${keep}\` (keeps that definition, drops the others), and model each other trigger as its own event (behind an event-based gateway, or another boundary / start event). One definition is edited with \`bpmn set <file> ${id} 'definition[<n>].<key>=<value>'\`.`);
  }

  private checkEvent(el: El): void {
    const id = idOf(el)!;
    const label = this.describe(el, undefined);
    const host = this.kit.is(el, 'bpmn:BoundaryEvent') ? peek<El>(el, 'attachedToRef') : undefined;
    if (host && peek<boolean>(host, 'isForCompensation') === true) {
      this.push('deploy', 'W_C7_DEPLOY_BOUNDARY_HOST', el, undefined, 'compensationHost', `Boundary event ${id} is attached to the compensation handler ${idOf(host)}; the engines refuse boundary events on compensation handlers`, `Remove it: \`bpmn remove <file> ${id}\` (or attach it to a normal activity: \`bpmn move <file> ${id} --on <activityId>\`).`, [idOf(host)!]);
    }
    const catching = this.kit.is(el, 'bpmn:StartEvent') || this.kit.is(el, 'bpmn:IntermediateCatchEvent') || this.kit.is(el, 'bpmn:BoundaryEvent');
    const throwing = this.kit.is(el, 'bpmn:IntermediateThrowEvent') || this.kit.is(el, 'bpmn:EndEvent');
    this.checkMultipleDefinitions(el);
    // of several definitions the engines parse only the one they act on
    for (const def of this.actedOn(el)) {
      if (this.kit.is(def, 'bpmn:MessageEventDefinition')) {
        if (catching) {
          const msg = peek<El>(def, 'messageRef');
          if (!msg) this.push('deploy', 'W_C7_DEPLOY_MESSAGE', el, undefined, 'messageRef', `${label} has no message; the engines refuse the file`, `\`bpmn set <file> ${id} message=<MessageName>\` (creates the bpmn:Message).`);
          else if (!nameOf(msg)) this.push('deploy', 'W_C7_DEPLOY_MESSAGE', el, undefined, 'messageName', `Message ${idOf(msg)} of ${label} has no name; the engines refuse the file`, `\`bpmn set <file> ${idOf(msg)} name=<MessageName>\`.`, [idOf(msg)!]);
        } else if (throwing) {
          this.checkImplementation(def, el, label, { event: el });
        }
      } else if (this.kit.is(def, 'bpmn:SignalEventDefinition')) {
        const sig = peek<El>(def, 'signalRef');
        if (!sig) this.push('deploy', 'W_C7_DEPLOY_SIGNAL', el, undefined, 'signalRef', `${label} has no signal; the engines refuse the file`, `\`bpmn set <file> ${id} signal=<SignalName>\`.`);
        else if (!nameOf(sig)) this.push('deploy', 'W_C7_DEPLOY_SIGNAL', el, undefined, 'signalName', `Signal ${idOf(sig)} of ${label} has no name; the engines refuse the file`, `\`bpmn set <file> ${idOf(sig)} name=<SignalName>\`.`, [idOf(sig)!]);
      } else if (this.kit.is(def, 'bpmn:ErrorEventDefinition') && this.kit.is(el, 'bpmn:EndEvent')) {
        const err = peek<El>(def, 'errorRef');
        if (!err) this.push('deploy', 'W_C7_DEPLOY_ERROR', el, undefined, 'errorRef', `${label} throws no error (no errorRef); the engines refuse the file`, `\`bpmn set <file> ${id} error=<ErrorName> errorCode=<CODE>\`.`);
        else if (!this.nonEmpty(peek<string>(err, 'errorCode'))) this.push('deploy', 'W_C7_DEPLOY_ERROR', el, undefined, 'errorCode', `Error ${idOf(err)} thrown by ${label} has no errorCode; the engines refuse the file`, `\`bpmn set <file> ${id} errorCode=<CODE>\`.`, [idOf(err)!]);
      } else if (this.kit.is(def, 'bpmn:EscalationEventDefinition')) {
        if (throwing) {
          const esc = peek<El>(def, 'escalationRef');
          if (!esc) this.push('deploy', 'W_C7_DEPLOY_ESCALATION', el, undefined, 'escalationRef', `${label} throws no escalation (no escalationRef); the engines refuse the file`, `\`bpmn set <file> ${id} escalation=<Name> escalationCode=<CODE>\`.`);
          else if (!this.nonEmpty(peek<string>(esc, 'escalationCode'))) this.push('deploy', 'W_C7_DEPLOY_ESCALATION', el, undefined, 'escalationCode', `Escalation ${idOf(esc)} thrown by ${label} has no escalationCode; the engines refuse the file`, `\`bpmn set <file> ${id} escalationCode=<CODE>\`.`, [idOf(esc)!]);
        } else if (this.kit.is(el, 'bpmn:BoundaryEvent')) {
          const host = peek<El>(el, 'attachedToRef');
          if (host && !this.kit.is(host, 'bpmn:SubProcess') && !this.kit.is(host, 'bpmn:CallActivity') && !this.kit.is(host, 'bpmn:UserTask')) {
            this.push('deploy', 'W_C7_DEPLOY_ESCALATION', el, undefined, 'escalationHost', `Escalation boundary event ${id} is attached to ${this.describe(host, undefined)}; the engines allow it only on sub-processes, call activities and user tasks and refuse the file`, `Attach it elsewhere (\`bpmn move <file> ${id} --on <subProcessId>\`) or remove it: \`bpmn remove <file> ${id}\`.`, [idOf(host)!]);
          }
        }
      } else if (this.kit.is(def, 'bpmn:CompensateEventDefinition')) {
        if (throwing) this.checkCompensationRef(el, def);
      } else if (this.kit.is(def, 'bpmn:TimerEventDefinition')) {
        if (!['timeDate', 'timeCycle', 'timeDuration'].some((k) => peek<El>(def, k))) {
          this.push('deploy', 'W_C7_DEPLOY_EVENT_DEFINITION', el, undefined, 'timer', `Timer of ${label} has no date, cycle or duration; the engines refuse the file`, `\`bpmn set <file> ${id} timer=PT1H\` (or R/PT1H, or a date).`);
        }
      } else if (this.kit.is(def, 'bpmn:ConditionalEventDefinition')) {
        // a missing condition element is a schema error (checkSchemaEventDefinitions)
        const cond = peek<El>(def, 'condition');
        if (cond && this.emptyCondition(cond)) {
          this.push('runtime', 'W_C7_EMPTY_CONDITION', el, undefined, 'emptyCondition', `Conditional event ${id} has an empty condition (no expression and no ${this.p}:resource): it deploys, but evaluating it fails when the process runs`, `\`bpmn set <file> ${id} ${sh('when=${expression}')}\` (or a script: \`bpmn set <file> ${id} condition.${this.p}:resource=deployment://<script>.groovy condition.language=groovy\`).`);
        }
        const events = this.c7(def, 'variableEvents');
        if (events !== undefined) {
          const bad = events.split(',').map((e) => e.trim()).filter((e) => e && !VARIABLE_EVENTS.includes(e));
          if (bad.length) this.push('runtime', 'W_C7_BAD_VALUE', def, el, 'attr:variableEvents', `${this.p}:variableEvents="${events}" of ${label} lists ${bad.join(', ')}; only ${VARIABLE_EVENTS.join(', ')} trigger the condition`, `\`bpmn set <file> ${id} ${sh(`${this.addressOf(def, el)?.prefix ?? 'definition.'}${this.p}:variableEvents=create, update`)}\`.`);
        }
      }
    }
  }

  /** Every flow node of a scope and of its nested sub-processes. */
  private allFlowNodes(scope: El): El[] {
    const out: El[] = [];
    for (const n of this.doc.flowNodes(scope)) {
      out.push(n);
      // the engines skip the content of an ad-hoc sub-process (checkAdHoc)
      if (this.kit.is(n, 'bpmn:SubProcess') && !this.kit.is(n, 'bpmn:AdHocSubProcess')) out.push(...this.allFlowNodes(n));
    }
    return out;
  }

  private isMultiInstance(el: El | undefined): boolean {
    return this.kit.is(peek<El>(el, 'loopCharacteristics'), 'bpmn:MultiInstanceLoopCharacteristics');
  }

  /** The flow nodes reachable from `from` along sequence flows (without `from`, unless a loop leads back to it). */
  private reachableFrom(from: El): Set<El> {
    const seen = new Set<El>();
    const queue = [from];
    while (queue.length) {
      for (const flow of this.outgoing.get(queue.shift()!) ?? []) {
        const t = peek<El>(flow, 'targetRef');
        if (t && !seen.has(t)) {
          seen.add(t);
          queue.push(t);
        }
      }
    }
    return seen;
  }

  /**
   * How to get rid of a second start event `extra` next to the start event
   * `first` that stays (W_C7_DEPLOY_START_EVENT), without running a node twice.
   * A flow of `extra` into a node `first` already reaches just goes with
   * `extra`. A flow into a branch of its own is moved to `first`, which then
   * starts that branch in parallel, unless the branch runs into a node `first`
   * reaches (that node would run once per branch): then only removing `extra`
   * is offered. A process can keep `extra` as another way in with another
   * trigger; an event sub-process its trigger in an event sub-process of its own.
   */
  private extraStartHint(scope: El, first: El, extra: El): string {
    const sid = idOf(extra)!;
    const fid = idOf(first)!;
    const reached = this.reachableFrom(first);
    const flows = this.outgoing.get(extra) ?? [];
    const own = flows.filter((f) => {
      const t = peek<El>(f, 'targetRef');
      return t && t !== first && !reached.has(t);
    });
    const into = flows.filter((f) => !own.includes(f));
    // nodes (no end events) that a branch of its own runs into and `first` reaches as well
    const meet = new Set<string>();
    for (const f of own) {
      const t = peek<El>(f, 'targetRef')!;
      for (const n of this.reachableFrom(t)) if (reached.has(n) && !this.kit.is(n, 'bpmn:EndEvent') && idOf(n)) meet.add(idOf(n)!);
    }
    const ids = (els: El[]): string => els.map(idOf).join(', ');
    const targets = (els: El[]): string => [...new Set(els.map((f) => idOf(peek<El>(f, 'targetRef'))).filter((x): x is string => !!x))].join(', ');
    const remove = `\`bpmn remove <file> ${sid}\``;
    const parts: string[] = [];
    if (!own.length) {
      parts.push(`Remove it: ${remove}${into.length ? ` (${fid} already leads to ${targets(into)}; ${ids(into)} go${into.length === 1 ? 'es' : ''} with it)` : ''}`);
    } else if (meet.size) {
      const names = [...meet].slice(0, 3).join(', ') + (meet.size > 3 ? ', ...' : '');
      parts.push(`Remove it: ${remove} (${targets(own)} is then no longer started; starting it from ${fid} instead would run ${names}, which ${fid} reaches too, once per branch)`);
    } else {
      const moves = own.map((f) => `\`bpmn set <file> ${idOf(f)} source=${fid}\``).join(', ');
      const notes = [(this.outgoing.get(first) ?? []).length ? `${fid} then starts both branches in parallel` : '', into.length ? `${ids(into)} into ${targets(into)}, which ${fid} already reaches, go${into.length === 1 ? 'es' : ''} with ${sid}` : ''].filter(Boolean);
      parts.push(`Start its branch from ${fid}: ${moves}, then ${remove}${notes.length ? ` (${notes.join('; ')})` : ''}`);
    }
    if (this.kit.is(scope, 'bpmn:Process')) parts.push(`give it another trigger, which keeps it as a second way into the process: \`bpmn set <file> ${sid} trigger=message message=<Name>\``);
    const again = this.isEventSubProcess(scope) ? this.ownEventSubProcess(scope, extra) : '';
    return `${parts.join(', or ')}${again ? `; ${again}` : ''}.`;
  }

  /** `then keep its <trigger> trigger in an event sub-process of its own: \`bpmn add ...\``, for the second start event `extra` of event sub-process `scope`. */
  private ownEventSubProcess(scope: El, extra: El): string {
    const def = this.actingDefinition(extra) ?? list(extra, 'eventDefinitions')[0];
    if (!def) return '';
    const trigger = triggerName(def);
    const ref = (prop: string): string => sh(nameOf(peek<El>(def, prop)) ?? '<Name>');
    const option: Record<string, string> = {
      message: `--message ${ref('messageRef')}`,
      signal: `--signal ${ref('signalRef')}`,
      error: `--error ${ref('errorRef')}`,
      escalation: `--escalation ${ref('escalationRef')}`,
      timer: '--timer <value>',
      conditional: `--when ${sh('${expression}')}`,
    };
    const opts = [option[trigger] ?? '', peek<boolean>(extra, 'isInterrupting') === false ? '--non-interrupting' : ''].filter(Boolean).join(' ');
    return `then keep its ${trigger} trigger in an event sub-process of its own: \`bpmn add <file> eventSubProcess:${trigger} "<Name>" --in ${idOf(this.doc.scopeOf(scope)) ?? '<parentId>'}${opts ? ` ${opts}` : ''}\``;
  }

  /**
   * Start events of a process or sub-process (engine-checked): every process
   * and every embedded sub-process needs one, also an empty one ("process /
   * subProcess must define a startEvent element"); a transaction without one
   * deploys, and every instance that reaches it fails ("No initial activity
   * found for subprocess", W_C7_TRANSACTION_NO_START, runtime); an event
   * sub-process without one is E_EVENT_SUBPROCESS_NO_START. A process allows one
   * none or timer start event (more with message / signal / conditional
   * triggers), a sub-process (event sub-processes and transactions too) one
   * start event at all. Ad-hoc sub-processes: checkAdHoc.
   */
  private checkStartEvents(scope: El): void {
    const id = idOf(scope) ?? '<scopeId>';
    const nodes = this.doc.flowNodes(scope);
    const starts = nodes.filter((n) => this.kit.is(n, 'bpmn:StartEvent'));
    const isProcess = this.kit.is(scope, 'bpmn:Process');
    const transaction = this.kit.is(scope, 'bpmn:Transaction');
    const kind = isProcess ? 'Process' : this.isEventSubProcess(scope) ? 'Event sub-process' : transaction ? 'Transaction' : 'Sub-process';
    if (!starts.length) {
      // an event sub-process without one is E_EVENT_SUBPROCESS_NO_START
      if (this.isEventSubProcess(scope)) return;
      const what = nodes.length ? 'has no start event' : 'is empty, without a start event';
      const add = nodes.length
        ? `Add one: \`bpmn add <file> startEvent "<Name>" --before <firstNodeId>\` (or --in ${id}, then connect it)`
        : `Add content: \`bpmn add <file> startEvent "<Name>" --in ${id}\` and continue from it`;
      const hint = `${add}${isProcess ? '' : `, or remove it: \`bpmn remove <file> ${id}\``}.`;
      if (transaction) {
        this.push('runtime', 'W_C7_TRANSACTION_NO_START', scope, undefined, 'start:none', `${kind} ${id} ${what}: it deploys, but every instance that reaches it fails ("No initial activity found for subprocess ${id}")`, hint);
      } else {
        this.push('deploy', 'W_C7_DEPLOY_START_EVENT', scope, undefined, 'start:none', `${kind} ${id} ${what}; the engines refuse the file (${isProcess ? 'process' : 'subProcess'} must define a startEvent element)`, hint);
      }
      return;
    }
    const limited = isProcess ? starts.filter((n) => this.actedOn(n).every((d) => this.kit.is(d, 'bpmn:TimerEventDefinition'))) : starts;
    const [first, ...rest] = limited;
    for (const extra of rest) {
      const sid = idOf(extra)!;
      const message = isProcess
        ? `Start event ${sid} is a second none or timer start event of process ${id} (with ${idOf(first)}); the engines allow only one and refuse the file`
        : `${kind} ${id} has ${limited.length} start events (${limited.map(idOf).join(', ')}); the engines allow only one in a sub-process and refuse the file`;
      this.push('deploy', 'W_C7_DEPLOY_START_EVENT', extra, undefined, 'start:multiple', message, this.extraStartHint(scope, first!, extra), [idOf(first)!]);
    }
  }

  /**
   * Ad-hoc sub-processes (engine-checked): the engines do not run them and skip
   * them with their content, like a non-executable process (visit does not
   * descend into them; an unconnected one deploys and never runs, W_UNREACHABLE).
   * A sequence flow into or out of one, or a boundary event on one, makes them
   * refuse the file ("Invalid destination 'X' of sequence flow", "Invalid
   * reference in boundary event"). Its multi-instance loop is parsed before the
   * engines skip the element: the loop rules hold (checkMultiInstance, all three
   * engines), and Camunda 7 and CIB seven refuse any loop on it (ENGINE-01009
   * "activity is null"; Operaton deploys a valid one).
   */
  private checkAdHoc(el: El): void {
    const id = idOf(el)!;
    const flows = [...(this.incoming.get(el) ?? []), ...(this.outgoing.get(el) ?? [])];
    const scope = this.doc.scopeOf(el);
    const boundaries = scope ? this.doc.flowNodes(scope).filter((n) => this.kit.is(n, 'bpmn:BoundaryEvent') && peek<El>(n, 'attachedToRef') === el) : [];
    const loop = this.isMultiInstance(el);
    this.checkMultiInstance(el);
    if (!flows.length && !boundaries.length && (!loop || this.operaton)) return;
    const parts = [flows.length ? `sequence flow${flows.length > 1 ? 's' : ''} ${flows.map(idOf).join(', ')}` : '', boundaries.length ? `boundary event${boundaries.length > 1 ? 's' : ''} ${boundaries.map(idOf).join(', ')}` : ''].filter(Boolean);
    const connected = parts.length > 0;
    const message = connected
      ? `Ad-hoc sub-process ${id} is connected (${parts.join(' and ')}); the engines do not run ad-hoc sub-processes and refuse the file (${flows.length ? `invalid ${(this.incoming.get(el) ?? []).length ? 'destination' : 'source'} '${id}' of sequence flow ${idOf(flows[0])}` : 'invalid reference in boundary event'})`
      : `Ad-hoc sub-process ${id} has a multi-instance loop; the engines do not run ad-hoc sub-processes, and Camunda 7 and CIB seven refuse the file (ENGINE-01009, "activity" is null)`;
    const retype = `Make it an embedded sub-process: \`bpmn retype <file> ${id} subProcess\`, then give its content a start event and flows (\`bpmn add <file> startEvent "<Name>" --in ${id}\`, \`bpmn connect <file> <fromId> <toId>\`)`;
    this.push('deploy', 'W_C7_DEPLOY_AD_HOC_SUBPROCESS', el, undefined, 'adHoc', message, connected ? `${retype}.` : `${retype}, or drop the loop: \`bpmn set <file> ${id} loop=none\`.`, [...flows, ...boundaries].map(idOf).filter((x): x is string => !!x));
  }

  private checkComplexGateway(el: El): void {
    const id = idOf(el)!;
    const incoming = this.incoming.get(el) ?? [];
    const flows = [...incoming, ...(this.outgoing.get(el) ?? [])];
    if (!flows.length) return;
    this.push('deploy', 'W_C7_DEPLOY_COMPLEX_GATEWAY', el, undefined, 'complexGateway', `Complex gateway ${id} is connected; the engines do not run complex gateways and refuse the file (invalid ${incoming.length ? 'destination' : 'source'} '${id}' of sequence flow ${idOf(flows[0])})`, `\`bpmn retype <file> ${id} inclusiveGateway\` (or exclusiveGateway: one path).`, flows.map(idOf).filter((x): x is string => !!x));
  }

  /**
   * Message and signal subscriptions that share a name in one engine scope
   * (engine-checked): the start events of a process; the event sub-process
   * starts of a (sub-)process together with the boundary events on that
   * sub-process; the boundary events of one activity together with its own
   * receive-task message (a multi-instance activity: its boundary events and
   * the inner activity are separate scopes). Catch events after an event-based
   * gateway are W_C7_DEPLOY_EVENT_GATEWAY; other catch events are scopes of their own.
   */
  private checkSubscriptions(proc: El): void {
    const groups = new Map<string, El[]>();
    const add = (kind: 'message' | 'signal', scope: string, name: string | undefined, el: El): void => {
      if (!name) return;
      const key = `${kind}\u0000${scope}\u0000${name}`;
      groups.set(key, [...(groups.get(key) ?? []), el]);
    };
    for (const node of this.allFlowNodes(proc)) {
      let scope: string | undefined;
      if (this.kit.is(node, 'bpmn:StartEvent')) {
        const parent = this.doc.scopeOf(node);
        if (parent && this.kit.is(parent, 'bpmn:Process')) scope = `start:${idOf(parent)}`;
        else if (parent && this.isEventSubProcess(parent)) scope = `scope:${idOf(this.doc.scopeOf(parent))}`;
      } else if (this.kit.is(node, 'bpmn:BoundaryEvent')) {
        const host = peek<El>(node, 'attachedToRef');
        if (host) scope = `${this.isMultiInstance(host) ? 'body' : 'scope'}:${idOf(host)}`;
      } else if (this.kit.is(node, 'bpmn:ReceiveTask')) {
        add('message', `scope:${idOf(node)}`, nameOf(peek<El>(node, 'messageRef')), node);
      }
      if (!scope) continue;
      add('message', scope, nameOf(peek<El>(this.definitionOf(node, 'bpmn:MessageEventDefinition'), 'messageRef')), node);
      add('signal', scope, nameOf(peek<El>(this.definitionOf(node, 'bpmn:SignalEventDefinition'), 'signalRef')), node);
    }
    for (const [key, els] of groups) {
      if (els.length < 2) continue;
      const [kind, , name] = key.split('\u0000') as ['message' | 'signal', string, string];
      const [first, ...rest] = els;
      for (const el of rest) {
        const code = kind === 'message' ? 'W_C7_DEPLOY_MESSAGE' : 'W_C7_DEPLOY_SIGNAL';
        this.push('deploy', code, el, undefined, kind === 'message' ? `dupMessage:${name}` : `dupSignalEvent:${name}`, `${this.describe(el, undefined)} waits for ${kind} "${name}" like ${idOf(first)} in the same scope; the engines refuse two ${kind} subscriptions with one name`, `Use another ${kind}: \`bpmn set <file> ${idOf(el)} ${kind}=<OtherName>\`.`, [idOf(first)!]);
      }
    }
  }

  /**
   * Link events (engine-checked): catch names are unique in the whole process
   * (sub-processes included); a throw event that is reached by a sequence flow
   * needs a catch event of its name in the same (sub-)process. That every link
   * event definition has a name is a schema rule (checkSchemaEventDefinitions).
   */
  private checkLinks(proc: El): void {
    const firstCatch = new Map<string, El>();
    const catchesIn = new Map<El | undefined, Set<string>>();
    const throws: Array<{ el: El; name: string }> = [];
    for (const node of this.allFlowNodes(proc)) {
      const def = this.definitionOf(node, 'bpmn:LinkEventDefinition');
      if (!def) continue;
      const id = idOf(node)!;
      const name = peek<string>(def, 'name');
      // a missing name is a schema error (checkSchemaEventDefinitions)
      if (name === undefined || name === null) continue;
      if (this.kit.is(node, 'bpmn:IntermediateCatchEvent')) {
        const first = firstCatch.get(name);
        if (first) {
          this.push('deploy', 'W_C7_DEPLOY_LINK', node, undefined, `link:dup:${name}`, `Link catch events ${idOf(first)} and ${id} are both named "${name}"; the engines refuse two link catch events with one name in a process (sub-processes included)`, `\`bpmn set <file> ${id} link=<OtherName>\` (and its throw events too).`, [idOf(first)!]);
        } else firstCatch.set(name, node);
        const scope = this.doc.scopeOf(node);
        catchesIn.set(scope, new Set([...(catchesIn.get(scope) ?? []), name]));
      } else if (this.kit.is(node, 'bpmn:IntermediateThrowEvent') && (this.incoming.get(node) ?? []).length) {
        throws.push({ el: node, name });
      }
    }
    for (const { el, name } of throws) {
      const scope = this.doc.scopeOf(el);
      if (catchesIn.get(scope)?.has(name)) continue;
      const id = idOf(el)!;
      const sid = idOf(scope) ?? '<scopeId>';
      const elsewhere = firstCatch.get(name);
      this.push('deploy', 'W_C7_DEPLOY_LINK', el, undefined, `link:target:${name}`, `Link throw event ${id} jumps to "${name}", but ${elsewhere ? `the catch event of that name (${idOf(elsewhere)}) is in another scope` : 'no link catch event has that name'}; the engines resolve links within one (sub-)process (${sid}) and refuse the file`, `Add the catching side in ${sid}: \`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${sid} --link ${sh(name)}\` and continue from it, or point the throw at an existing catch: \`bpmn set <file> ${id} link=<Name>\`.`, elsewhere ? [idOf(elsewhere)!] : []);
    }
  }

  /** The activities a compensation throw event may name (engine-checked): those of its own (sub-)process, for an event sub-process also those of its parent scope. */
  private checkCompensationRef(el: El, def: El): void {
    const ref = peek<El>(def, 'activityRef');
    if (!ref) return;
    const scope = this.doc.scopeOf(el);
    if (!scope) return;
    const allowed: Array<El | undefined> = [scope];
    if (this.isEventSubProcess(scope)) allowed.push(this.doc.scopeOf(scope));
    if (this.kit.is(ref, 'bpmn:FlowNode') && allowed.includes(this.doc.scopeOf(ref))) return;
    const id = idOf(el)!;
    const sid = idOf(scope) ?? '<scopeId>';
    const candidates = this.doc
      .flowNodes(scope)
      .filter((n) => this.kit.is(n, 'bpmn:Activity') && !this.isEventSubProcess(n))
      .map(idOf)
      .filter((x): x is string => !!x)
      .slice(0, 5);
    const what = this.kit.is(ref, 'bpmn:FlowNode') ? `${this.describe(ref, undefined)}, which is not in ${sid}` : `${idOf(ref)}, which is not a flow node`;
    const key = `${this.addressOf(def, el)?.prefix ?? 'definition.'}activityRef`;
    this.push('deploy', 'W_C7_DEPLOY_EVENT_DEFINITION', el, undefined, 'activityRef', `Compensation event ${id} names activityRef ${what}; the engines compensate only activities of the throw event's own (sub-)process and refuse the file`, `\`bpmn set <file> ${id} ${sh(`${key}=<activityId>`)}\`${candidates.length ? ` (in ${sid}: ${candidates.join(', ')})` : ''}, or compensate the whole scope: \`bpmn set <file> ${id} ${sh(`${key}=`)}\`.`, idOf(ref) ? [idOf(ref)!] : []);
  }

  /**
   * A condition the engines cannot evaluate: no expression text (blank counts)
   * and no script resource. They deploy it; evaluating it fails ("condition
   * expression returns non-Boolean" / "condition script returns null").
   */
  private emptyCondition(expr: El): boolean {
    return !this.nonEmpty(peek<string>(expr, 'body')) && !this.nonEmpty(this.c7(expr, 'resource'));
  }

  /** An empty condition on a sequence flow the engines evaluate (not a default flow, not out of a parallel / event-based gateway). */
  private checkFlowCondition(flow: El): void {
    const cond = peek<El>(flow, 'conditionExpression');
    if (!cond || !this.emptyCondition(cond)) return;
    const source = peek<El>(flow, 'sourceRef');
    if (source && (this.kit.is(source, 'bpmn:ParallelGateway') || this.kit.is(source, 'bpmn:EventBasedGateway') || peek<El>(source, 'default') === flow)) return;
    const id = idOf(flow)!;
    this.push('runtime', 'W_C7_EMPTY_CONDITION', flow, undefined, 'emptyCondition', `Sequence flow ${id} has an empty condition (no expression and no ${this.p}:resource): it deploys, but the engines fail when they evaluate it`, `Give it one: \`bpmn set <file> ${id} ${sh('condition=${expression}')}\`, or remove it: \`bpmn set <file> ${id} condition=\`.`);
  }

  private checkEventGateway(gw: El): void {
    const id = idOf(gw)!;
    const names = new Map<string, El>();
    for (const flow of this.outgoing.get(gw) ?? []) {
      const t = peek<El>(flow, 'targetRef');
      if (!t) continue;
      const tid = idOf(t)!;
      const fid = idOf(flow)!;
      if (!this.kit.is(t, 'bpmn:IntermediateCatchEvent')) {
        this.push('deploy', 'W_C7_DEPLOY_EVENT_GATEWAY', gw, undefined, `target:${tid}`, `Event-based gateway ${id} leads to ${this.describe(t, undefined)}; the engines accept only intermediate catch events (message, timer, signal, conditional) there and refuse the file`, `Put a catch event in front of it: \`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow ${fid} --message <MessageName>\` (or :timer --timer PT1H).`, [tid, fid]);
        continue;
      }
      // of several definitions the engines act on one (a link among them is refused only when it wins)
      const defs = this.actedOn(t);
      const kind = defs.length === 1 ? (['Message', 'Timer', 'Signal', 'Conditional'].find((k) => this.kit.is(defs[0], `bpmn:${k}EventDefinition`)) ?? '') : '';
      if (!kind) {
        this.push('deploy', 'W_C7_DEPLOY_EVENT_GATEWAY', gw, undefined, `target:${tid}`, `Event-based gateway ${id} leads to ${this.describe(t, undefined)}; after an event-based gateway the engines accept only message, timer, signal and conditional catch events and refuse the file`, `\`bpmn set <file> ${tid} trigger=message message=<MessageName>\` (or trigger=timer timer=PT1H).`, [tid, fid]);
        continue;
      }
      if ((this.incoming.get(t) ?? []).length > 1) {
        this.push('deploy', 'W_C7_DEPLOY_EVENT_GATEWAY', gw, undefined, `incoming:${tid}`, `${this.describe(t, undefined)} after event-based gateway ${id} has other incoming flows; the engines refuse the file`, `Join before the gateway instead, and keep only ${fid} into ${tid} (\`bpmn set <file> <otherFlowId> target=<nodeId>\`).`, [tid, fid]);
      }
      const ref = kind === 'Message' ? peek<El>(defs[0], 'messageRef') : kind === 'Signal' ? peek<El>(defs[0], 'signalRef') : undefined;
      const name = nameOf(ref);
      if (!name) continue;
      const key = `${kind}\u0000${name}`;
      const first = names.get(key);
      if (first) {
        this.push('deploy', 'W_C7_DEPLOY_EVENT_GATEWAY', gw, undefined, `dup:${kind}:${name}`, `Branches ${idOf(first)} and ${tid} of event-based gateway ${id} wait for the same ${kind.toLowerCase()} "${name}"; the engines refuse the file`, `\`bpmn set <file> ${tid} ${kind.toLowerCase()}=<OtherName>\`, or remove one branch.`, [idOf(first)!, tid]);
      } else names.set(key, t);
    }
  }

  private checkExclusiveGateway(gw: El): void {
    const id = idOf(gw)!;
    const outgoing = this.outgoing.get(gw) ?? [];
    const def = peek<El>(gw, 'default');
    const hasCond = (f: El): boolean => !!peek<El>(f, 'conditionExpression');
    if (!outgoing.length) {
      this.push('deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, 'none', `Exclusive gateway ${id} has no outgoing flow; the engines refuse the file`, `Continue it: \`bpmn add <file> <kind> "<Name>" --after ${id}\`.`);
      return;
    }
    if (outgoing.length === 1) {
      const f = outgoing[0]!;
      if (hasCond(f) && f !== def) this.push('deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, `single:${idOf(f)}`, `Exclusive gateway ${id} has a single outgoing flow ${idOf(f)} with a condition; the engines refuse the file`, `\`bpmn set <file> ${idOf(f)} condition=\`.`, [idOf(f)!]);
      if (hasCond(f) && f === def) this.push('deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, `default:${idOf(f)}`, `Default flow ${idOf(f)} of exclusive gateway ${id} has a condition; the engines refuse the file`, `\`bpmn set <file> ${idOf(f)} condition=\`.`, [idOf(f)!]);
      return;
    }
    const unconditioned: El[] = [];
    for (const f of outgoing) {
      if (f === def) {
        if (hasCond(f)) this.push('deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, `default:${idOf(f)}`, `Default flow ${idOf(f)} of exclusive gateway ${id} has a condition; the engines refuse the file`, `\`bpmn set <file> ${idOf(f)} condition=\`.`, [idOf(f)!]);
        continue;
      }
      if (!hasCond(f)) unconditioned.push(f);
    }
    if (def || unconditioned.length > 1) {
      for (const f of unconditioned) {
        this.push('deploy', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', gw, undefined, `uncond:${idOf(f)}`, `Flow ${idOf(f)} of exclusive gateway ${id} has no condition and is not the default flow${def ? '' : ` (${unconditioned.length} such flows)`}; the engines refuse the file`, `\`bpmn set <file> ${idOf(f)} ${sh('condition=${...}')}\`${def ? '' : ` or make one of them the default: \`bpmn set <file> ${idOf(f)} default=true\``}.`, [idOf(f)!]);
      }
    } else if (unconditioned.length === 1) {
      const f = unconditioned[0]!;
      this.push('practice', 'W_C7_EXCLUSIVE_GATEWAY_DEFAULT', gw, undefined, `implicit:${idOf(f)}`, `Flow ${idOf(f)} of exclusive gateway ${id} has no condition and is not the default flow; the engines take it as the default and log a warning`, `\`bpmn set <file> ${idOf(f)} default=true\`.`, [idOf(f)!]);
    }
  }

  private checkScriptTask(el: El): void {
    if (this.nonEmpty(peek<string>(el, 'script')) || this.c7(el, 'resource') !== undefined) return;
    this.push('deploy', 'W_C7_DEPLOY_SCRIPT', el, undefined, 'script', `Script task ${idOf(el)} has neither a script nor ${this.p}:resource; the engines refuse the file`, `\`bpmn set <file> ${idOf(el)} scriptFormat=groovy ${sh('script=...')}\` (or ${this.p}:resource=deployment://<file>).`);
  }

  private checkReceiveTask(el: El): void {
    const msg = peek<El>(el, 'messageRef');
    if (msg && !nameOf(msg)) this.push('deploy', 'W_C7_DEPLOY_MESSAGE', el, undefined, 'messageName', `Message ${idOf(msg)} of receive task ${idOf(el)} has no name; the engines refuse the file`, `\`bpmn set <file> ${idOf(msg)} name=<MessageName>\`.`, [idOf(msg)!]);
  }

  private checkUserTaskPriority(el: El): void {
    const v = this.c7(el, 'priority');
    if (v === undefined || this.isNumber(v) || this.isExpression(v)) return;
    this.push('runtime', 'W_C7_BAD_VALUE', el, undefined, 'attr:priority', `${this.p}:priority="${v}" on ${this.describe(el, undefined)} is not a number or expression; creating the task fails`, `\`bpmn set <file> ${idOf(el)} ${this.p}:priority=50\`.`);
  }

  /** Id references inside camunda content (camunda:errorEventDefinition errorRef -> bpmn:Error). */
  private checkVendorRefs(host: El, owner: El | undefined): void {
    for (const v of this.extensionValues(host)) {
      if (!v.uri || !this.kit.camunda.reads(v.uri)) continue;
      for (const ref of this.kit.camunda.idReferenceAttrs()) {
        if (localName(ref.element) !== v.local) continue;
        const target = attr(v.el, ref.attr);
        if (target === undefined) continue;
        const el = this.doc.get(target);
        if (el && this.kit.is(el, ref.target)) continue;
        const candidates = ref.target === 'bpmn:Error' ? [...this.errors.keys()] : [];
        const pointAt = `Point it at an existing one${candidates.length ? ` (${candidates.slice(0, 5).join(', ')})` : ''}`;
        this.push('runtime', 'W_C7_DANGLING_REF', host, owner, `ref:${v.local}#${v.index}@${ref.attr}`, `${v.el.$type} of ${this.describe(host, owner)} references ${ref.attr}="${target}", which is not a ${ref.target} in the file; the engines ignore the mapping when it runs`, `${pointAt}. ${this.extHint(host, owner, v.el, v.local, { [ref.attr]: `<${localName(ref.target).replace(/^./, (c) => c.toLowerCase())}Id>` })}`);
      }
    }
  }

  /**
   * Attributes without a namespace prefix that BPMN does not define
   * (calledDecision="..." on a business rule task): the engines validate the
   * whole file against the BPMN schema, non-executable processes and the
   * diagram included, and refuse it (cvc-complex-type.3.2.2, engine-checked).
   * Vendor attributes need their prefix.
   */
  private checkSchemaAttributes(): void {
    for (const el of this.kit.walk(this.doc.definitions, { bpmnOnly: true })) {
      const bare = Object.keys(el.$attrs ?? {}).filter((k) => !k.includes(':') && k !== 'xmlns');
      if (!bare.length) continue;
      // a nested element (event definition, loop, condition) is reported on and addressed through its flow node / flow
      const parent = el.$parent as El | undefined;
      const nested = parent && idOf(parent) && this.addressOf(el, parent)?.prefix ? parent : undefined;
      let owner: El | undefined = nested ?? el;
      while (owner && !idOf(owner)) owner = owner.$parent as El | undefined;
      const id = idOf(owner);
      // `bpmn set` removes it with an empty value: on the element itself or through a nested key (not in the diagram)
      const di = this.kit.isDiElement(el) || (!!owner && this.kit.isDiElement(owner));
      const addr = di ? undefined : el === owner ? (id ? { id, prefix: '' } : undefined) : owner ? this.addressOf(el, owner) : undefined;
      for (const k of bare) {
        const vendor = this.kit.camunda.attr(k);
        const fits = !!vendor && vendor.owners.some((o) => this.kit.is(el, o)) && !!id && el === owner;
        const where = el === owner ? this.describe(el, undefined) : `${el.$type}${id ? ` in ${id}` : ''}`;
        const remove = addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${k}=`)}\`` : undefined;
        // a decision link without prefix (bpmn-cli's calledDecision for a model without an engine, or calledElement read as one): `set calledDecision=` writes the engines' spelling
        // (not next to another implementation: class, delegateExpression, expression or type=external stay, the attribute just goes)
        const implemented = Object.keys(el.$attrs ?? {}).some((a) => /^[\w.-]+:(class|delegateExpression|expression|type)$/.test(a) && this.kit.camunda.reads(this.ns.uriOfName(a)));
        const link = el === owner && !!id && !implemented && this.kit.is(el, 'bpmn:BusinessRuleTask') && (k === 'calledDecision' || k === 'calledElement') ? this.kit.decisionLinkOf(el, this.doc) : undefined;
        const hint = link
          ? `Write the decision link in the engines' spelling: \`bpmn set <file> ${id} ${sh(`calledDecision=${link.value}`)}\` (${this.p}:decisionRef; the unprefixed ${k} is removed).`
          : fits
          ? `Use the vendor attribute instead: \`bpmn set <file> ${id} ${sh(`${k}=`)} ${sh(`${this.p}:${k}=${String(el.$attrs[k] ?? '')}`)}\`.`
          : remove
            ? `Remove it: ${remove} (vendor attributes need their namespace prefix, e.g. ${this.p}:<name>).`
            : di
              ? `Remove ${k}="..." from the XML of ${id ?? 'the diagram element'}, or redraw the diagram, which writes new diagram elements: \`bpmn layout <file>\` (the hand-made layout is lost).`
              : `Remove ${k}="..." from the XML${id ? ` of ${id}` : ''} (vendor attributes need their namespace prefix, e.g. ${this.p}:<name>).`;
        this.push('deploy', 'W_C7_DEPLOY_SCHEMA', el, owner, `schema:${k}`, `${where} has the attribute ${k}, which the BPMN schema does not define${fits ? ` (did you mean ${this.p}:${k}?)` : ''}; the engines validate the file against the schema and refuse it`, hint);
      }
    }
  }

  /**
   * What the BPMN schema requires of an event definition (engine-checked): a
   * conditional definition has a condition element, a link definition a name
   * (W_C7_DEPLOY_LINK), a timer definition at most one of timeDate, timeCycle
   * and timeDuration. The engines validate the whole file against the schema
   * before they pick the definition an event acts on (actingDefinition), so this
   * holds for every definition: one the engines would ignore, one of a
   * non-executable process. Rules on what a definition means (an empty timer, a
   * message without messageRef) apply to the acting one only (checkEvent).
   */
  private checkSchemaEventDefinitions(): void {
    for (const def of this.kit.walk(this.doc.definitions, { bpmnOnly: true })) {
      if (!this.kit.is(def, 'bpmn:EventDefinition')) continue;
      const parent = def.$parent as El | undefined;
      const event = parent && this.kit.is(parent, 'bpmn:Event') && idOf(parent) ? parent : undefined;
      const id = idOf(event);
      const defs = list(event, 'eventDefinitions');
      const subject = defs.length > 1 ? `#${defs.indexOf(def)}` : '';
      /** the fix, or how to drop this definition when the engines act on another one */
      const fix = (cmd: string, keeps: string): string => {
        if (!id) return 'Fix it in the XML.';
        if (defs.length < 2) return `\`bpmn set <file> ${id} ${cmd}\`${keeps ? ` (${keeps})` : ''}.`;
        const acting = this.actingDefinition(event!);
        const only = `\`bpmn set <file> ${id} ${cmd}\` (keeps only the ${triggerName(def)} definition)`;
        if (!acting || acting === def) return `${only}.`;
        return `The engines act on the ${triggerName(acting)} definition and ignore this one, but they validate it too: drop it with \`bpmn set <file> ${id} trigger=${triggerName(acting)}\` (keeps only the ${triggerName(acting)}), or ${only}.`;
      };
      const label = id ? this.describe(event!, undefined) : `${def.$type}${idOf(def) ? ` ${idOf(def)}` : ''}`;
      // `Conditional event X`, or `The conditional definition of intermediateCatchEvent:timer X` among several
      const what = (single: string): string => (defs.length > 1 ? `The ${triggerName(def)} definition of ${label}` : id ? `${single} ${id}` : label);
      if (this.kit.is(def, 'bpmn:ConditionalEventDefinition') && !peek<El>(def, 'condition')) {
        this.push('deploy', 'W_C7_DEPLOY_EVENT_DEFINITION', event ?? def, undefined, `condition${subject}`, `${what('Conditional event')} has no condition element, which the BPMN schema requires; the engines refuse the file`, fix(sh('when=${expression}'), ''));
      } else if (this.kit.is(def, 'bpmn:LinkEventDefinition') && (peek<string>(def, 'name') === undefined || peek<string>(def, 'name') === null)) {
        this.push('deploy', 'W_C7_DEPLOY_LINK', event ?? def, undefined, `link:name${subject}`, `${what('Link event')} has no link name, which the BPMN schema requires; the engines refuse the file`, fix('link=<Name>', 'the throw and the catch event of a pair share the name'));
      } else if (this.kit.is(def, 'bpmn:TimerEventDefinition')) {
        const set = TIMER_ELEMENTS.filter((k) => peek<El>(def, k));
        if (set.length < 2) continue;
        this.push('deploy', 'W_C7_DEPLOY_EVENT_DEFINITION', event ?? def, undefined, `timer:elements${subject}`, `${what('Timer event')} has ${set.join(' and ')}; the BPMN schema allows only one of timeDate, timeCycle and timeDuration, and the engines refuse the file`, fix('timer=<value>', 'R/PT1H is a cycle, PT1H a duration, else a date; the other elements go'));
      }
    }
  }

  /** Duplicate names among the root signals (the engines refuse the file even when one is unused). */
  private checkSignalNames(): void {
    const seen = new Map<string, El>();
    for (const sig of this.doc.rootElementsOfType('bpmn:Signal')) {
      const name = nameOf(sig);
      if (!name) continue;
      const first = seen.get(name);
      if (first) this.push('deploy', 'W_C7_DEPLOY_SIGNAL', sig, undefined, `dupSignal:${name}`, `Signals ${idOf(first)} and ${idOf(sig)} are both named "${name}"; the engines refuse duplicate signal names`, `\`bpmn set <file> ${idOf(sig)} name=<OtherName>\` (or point its events at ${idOf(first)} and remove it).`, [idOf(first)!]);
      else seen.set(name, sig);
    }
  }
}
