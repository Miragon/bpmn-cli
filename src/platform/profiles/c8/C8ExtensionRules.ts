import type { El } from '../../../model/utils/moddle.js';
import type { ExtValue } from '../EngineRules.js';
import { TimerValue } from '../TimerValue.js';
import { attr, idOf, list, localName } from '../utils/element.js';
import { didYouMean, lowerFirst, sh } from '../utils/hint.js';
import { blank, feelOf, isFeel, missing } from './utils/value.js';
import { C8Rules } from './C8Rules.js';

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

const BINDING_TYPES = ['deployment', 'latest', 'versionTag'];
const PATH = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
const TASK_LISTENER_EVENTS = ['creating', 'assigning', 'updating', 'completing', 'canceling', 'create', 'assignment', 'update', 'complete', 'cancel'];

/**
 * Zeebe attributes and extension elements: Camunda 7 content, unknown or misplaced zeebe content,
 * FEEL slips, and the engine rules on mappings, headers, listeners and schedules.
 */
export class C8ExtensionRules extends C8Rules {
  private foreignHint(el: El, owner: El | undefined, local: string, remove: string): string {
    const equivalent = C8_EQUIVALENT[local];
    return `Remove it: ${remove}${equivalent ? `; Camunda 8 reads ${this.extAdd(el, owner, equivalent.replace(/^zeebe:/, `${this.p}:`))}` : ''}.`;
  }

  /** zeebe:* / camunda:* / operaton:* attributes of a BPMN element. */
  checkAttributes(el: El, owner: El | undefined): void {
    const addr = this.addressOf(el, owner);
    const where = this.describe(el, owner);
    for (const key of Object.keys(el.$attrs ?? {})) {
      const uri = this.ns.uriOfName(key);
      if (!uri) continue;
      const local = localName(key);
      const unset = addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${key}=`)}\`` : 'edit the XML';
      if (this.kit.camunda.uris.has(uri)) {
        this.push('runtime', 'W_C8_FOREIGN_CONTENT', el, owner, `attr:${key}`, `${where} carries the Camunda 7 attribute ${key}, which Camunda 8 ignores`, this.foreignHint(el, owner, local, unset));
        continue;
      }
      if (uri !== this.kit.zeebe.uri) continue;
      const def = this.kit.zeebe.attr(local);
      if (!def) {
        // an attribute of a zeebe extension element on the BPMN element (zeebe:assignee)
        const home = this.kit.zeebe.typeNames().find((t) => this.kit.zeebe.allowedOn(t, el) === true && this.kit.zeebe.type(t)!.attributes.some((a) => a.name === local));
        const guess = home ? undefined : didYouMean(local, this.kit.zeebe.attrs().map((a) => localName(a.name)));
        const value = String(el.$attrs[key] ?? '');
        this.push(
          'runtime',
          'W_C8_UNKNOWN_ATTRIBUTE',
          el,
          owner,
          `attr:${key}`,
          `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${this.p}:${guess}?)` : ''}; Camunda 8 ignores it${home ? ` (it reads ${local} on the ${this.z(localName(home))} extension element)` : ' (most zeebe settings are extension elements: `bpmn kinds`, `bpmn guide`)'}`,
          home ? `Move it: ${unset}, then ${this.extAdd(el, owner, `${this.z(localName(home))} ${sh(`${local}=${value}`)}`)}.` : `Remove it: ${unset}.`,
        );
        continue;
      }
      if (!def.owners.some((o) => this.kit.is(el, o))) {
        this.push('runtime', 'W_C8_MISPLACED_ATTRIBUTE', el, owner, `attr:${key}`, `${key} on ${where} has no effect: Camunda 8 reads it on ${def.owners.map((o) => lowerFirst(localName(o))).join(', ')} only`, `Remove it: ${unset}.`);
      }
    }
  }

  /** The messages the catch events of the executable processes read: their subscription content. */
  checkCaughtMessages(executable: El[]): void {
    const caught = new Set<El>();
    for (const proc of executable) {
      for (const el of this.kit.walk(proc, { bpmnOnly: true })) {
        if (this.kit.is(el, 'bpmn:Event') || this.kit.is(el, 'bpmn:ReceiveTask')) {
          const m = this.messageOf(el);
          if (m) caught.add(m);
        }
      }
    }
    for (const m of caught) {
      this.checkAttributes(m, undefined);
      this.checkExtensions(m, undefined);
    }
  }

  /** Input mappings Camunda 8 ignores on these hosts (output mappings work there). */
  private inputsIgnored(host: El): string | undefined {
    if (this.kit.is(host, 'bpmn:StartEvent')) return 'start events';
    if (this.kit.is(host, 'bpmn:BoundaryEvent')) return 'boundary events';
    const defs = list(host, 'eventDefinitions');
    if (this.kit.is(host, 'bpmn:IntermediateThrowEvent') && !defs.length) return 'none intermediate throw events';
    if (this.kit.is(host, 'bpmn:EndEvent') && !defs.length) return 'none end events';
    return undefined;
  }

  /**
   * Extension elements of one BPMN element: foreign, unknown, misplaced, duplicates; then the
   * content of each zeebe element.
   */
  checkExtensions(host: El, owner: El | undefined): void {
    const values = this.extensionValues(host);
    if (!values.length) return;
    const addr = this.addressOf(host, owner);
    const where = this.describe(host, owner);
    const remove = (v: ExtValue): string => (addr ? `\`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${v.index}`)}\`` : 'remove it from the XML');
    const counts = new Map<string, number>();
    for (const v of values) {
      if (!v.uri) continue;
      if (this.kit.camunda.uris.has(v.uri)) {
        this.push('runtime', 'W_C8_FOREIGN_CONTENT', host, owner, `ext:${v.el.$type}#${v.index}`, `${where} contains the Camunda 7 extension ${v.el.$type}, which Camunda 8 ignores`, this.foreignHint(host, owner, v.local, remove(v)));
        continue;
      }
      if (v.uri !== this.kit.zeebe.uri) continue;
      const t = this.kit.zeebe.type(v.local);
      if (!t) {
        const guess = didYouMean(v.local, this.kit.zeebe.typeNames().map(localName));
        this.push('runtime', 'W_C8_UNKNOWN_ELEMENT', host, owner, `ext:${v.local}`, `${where} has the unknown extension element ${this.z(v.local)}${guess ? ` (did you mean ${this.z(guess)}?)` : ''}; Camunda 8 ignores it`, `Remove it (${remove(v)})${guess && addr ? ` and add the right one: ${this.extAdd(host, owner, `${this.z(guess)} ...`)}` : ''}.`);
        continue;
      }
      if (this.kit.zeebe.nestedOnly(v.local)) {
        const container = this.kit.zeebe.containersOf(v.local)[0]!;
        this.push('runtime', 'W_C8_MISPLACED_EXTENSION', host, owner, `ext:${v.local}`, `${this.z(v.local)} sits directly in the extension elements of ${where}, but belongs inside ${this.z(localName(container))}; Camunda 8 ignores it`, `Remove it (${remove(v)}) and add it again, \`bpmn ext add\` files it into its container: ${this.extAdd(host, owner, `${this.z(v.local)} ...`)}.`);
        continue;
      }
      if (v.local === 'executionListeners' && this.kit.is(host, 'bpmn:SequenceFlow')) {
        this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, 'listener:flow', `${where} has execution listeners; Camunda 8 supports them on processes, activities, events and gateways, not on sequence flows, and refuses the file`, `Remove them (${remove(v)}) and put them on the flow's source or target.`);
        continue;
      }
      if (this.kit.zeebe.allowedOn(v.local, host) === false) {
        const hosts = t.allowedIn.filter((a) => a.startsWith('bpmn:')).map((a) => lowerFirst(localName(a)));
        this.push('runtime', 'W_C8_MISPLACED_EXTENSION', host, owner, `ext:${v.local}`, `${this.z(v.local)} on ${where} has no effect: Camunda 8 reads it on ${hosts.length > 5 ? `${hosts.slice(0, 5).join(', ')}, ...` : hosts.join(', ')} only`, `Remove it: ${remove(v)}.`);
        continue;
      }
      counts.set(v.local, (counts.get(v.local) ?? 0) + 1);
      this.checkZeebeElement(host, owner, v.el, '');
    }
    for (const [local, n] of counts) {
      if (n < 2 || !this.kit.zeebe.isSingle(local)) continue;
      this.push('deploy', 'W_C8_DEPLOY_DUPLICATE_EXTENSION', host, owner, `dup:${local}`, `${where} has ${n} ${this.z(local)} elements; Camunda 8 reads one and refuses the file`, `Merge them into one: ${lowerFirst(this.rebuildHint(host, owner, this.z(local)).replace(/^See it/, 'See them'))}`);
    }
    // input mappings where the engine reads only outputs
    const ignored = this.inputsIgnored(host);
    if (ignored) {
      for (const io of this.zeebe(host, 'ioMapping')) {
        for (const input of this.kids(io, 'input')) {
          const target = attr(input, 'target') ?? '';
          this.push('runtime', 'W_C8_MISPLACED_EXTENSION', host, owner, `input:${target}`, `The input mapping ${target ? `to ${target} ` : ''}on ${where} has no effect: Camunda 8 ignores input mappings on ${ignored} (output mappings work there)`, addr ?`Remove it: \`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${this.z('input')}[target=${target}]`)}\` (set the variable in an activity before it, or as an output mapping of the element before).` : 'Remove it from the XML.');
        }
      }
    }
  }

  /**
   * Attributes and children of a zeebe element (known names, placement), recursively; then the
   * engine rules on its content.
   */
  private checkZeebeElement(host: El, owner: El | undefined, v: El, path: string): void {
    const local = localName(v.$type);
    const t = this.kit.zeebe.type(local);
    if (!t) return;
    const where = `${this.z(local)}${path ? ` (in ${path})` : ''} of ${this.describe(host, owner)}`;
    const names = new Set(t.attributes.map((a) => a.name));
    for (const k of Object.keys(v as unknown as Record<string, unknown>)) {
      if (k.startsWith('$') || k.startsWith('xmlns') || k.includes(':')) continue;
      if (names.has(k)) continue;
      const guess = didYouMean(k, [...names]);
      this.push('runtime', 'W_C8_UNKNOWN_ATTRIBUTE', host, owner, `ext:${path}/${local}@${k}`, `${where} has the unknown attribute ${k}${guess ? ` (did you mean ${guess}?)` : ''}; Camunda 8 ignores it`, this.rebuildHint(host, owner, this.z(path ? path.split(' > ')[0]!.replace(/^[^:]+:/, '') : local)));
    }
    for (const a of FEEL_ATTRS[local] ?? []) {
      const value = attr(v, a);
      const target = attr(v, 'target');
      // a mapping is replaced by its target: give the corrected one
      const fix =
        (local === 'input' || local === 'output') && target && isFeel(value)
          ? `${this.extAdd(host, owner, `${this.z(local)} ${sh(`source==${feelOf(value!.trim().slice(1)).trim()}`)} target=${sh(target)}`)} (replaces the mapping of that target; check the FEEL syntax).`
          : path
            ? this.rebuildHint(host, owner, this.z(localName(path.split(' > ')[0]!)))
            : this.fixHint(host, owner, v, { [a]: '=<FEEL expression>' });
      this.checkFeel(host, owner, `${path}/${local}@${a}`, `${a} of ${where}`, value, fix);
    }
    for (const c of this.kids(v)) {
      const cl = localName(c.$type);
      const childPath = path ? `${path} > ${this.z(local)}` : this.z(local);
      if (!t.children.includes(`zeebe:${cl}`)) {
        const known = this.kit.zeebe.type(cl);
        this.push('runtime', known ? 'W_C8_MISPLACED_EXTENSION' : 'W_C8_UNKNOWN_ELEMENT', host, owner, `ext:${childPath}/${cl}`, known ? `${this.z(cl)} does not belong inside ${this.z(local)} (${where}); Camunda 8 ignores it` : `${where} contains the unknown element ${this.z(cl)}; Camunda 8 ignores it`, this.rebuildHint(host, owner, this.z(path ? localName(path.split(' > ')[0]!) : local)));
        continue;
      }
      this.checkZeebeElement(host, owner, c, childPath);
    }
    if (!path) this.checkContent(host, owner, v, local);
  }

  /** Engine rules on the content of one top-level zeebe element. */
  private checkContent(host: El, owner: El | undefined, v: El, local: string): void {
    const where = this.describe(host, owner);
    const rebuild = (): string => this.rebuildHint(host, owner, this.z(local));
    const addr = this.addressOf(host, owner);
    // bindingType / versionTag
    const binding = attr(v, 'bindingType');
    if (binding !== undefined && ['calledDecision', 'calledElement', 'formDefinition'].includes(local)) {
      if (!BINDING_TYPES.includes(binding)) {
        this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `${local}:bindingType`, `${this.z(local)} of ${where} has bindingType="${binding}"; Camunda 8 accepts ${BINDING_TYPES.join(', ')} only and refuses the file`, this.fixHint(host, owner, v, { bindingType: 'latest' }));
      } else if (binding === 'versionTag' && blank(attr(v, 'versionTag'))) {
        this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `${local}:versionTag`, `${this.z(local)} of ${where} has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file`, this.fixHint(host, owner, v, { versionTag: '<versionTag>' }));
      }
    }
    if (local === 'ioMapping') {
      for (const [kind, label] of [
        ['input', 'input'],
        ['output', 'output'],
      ] as const) {
        this.kids(v, kind).forEach((m, i) => {
          const target = attr(m, 'target');
          const sel = target ? `${this.z(kind)}[target=${target}]` : `${this.z('ioMapping')}/${this.z(kind)}[${i}]`;
          if (blank(target)) {
            this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `${kind}#${i}:target`, `The ${label} mapping ${i + 1} of ${where} has no target; Camunda 8 refuses the file`, addr ? `Remove it (\`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${sel}`)}\`) and add it with a target: ${this.extAdd(host, owner, `${this.z(kind)} source==<expression> target=<variable>`)}.` : 'Fix it in the XML.');
          } else if (!PATH.test(target!.trim())) {
            this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `${kind}:${target}:target`, `The ${label} mapping target "${target}" of ${where} is not a variable name or path (a.b.c); Camunda 8 refuses the file`, addr ? `Remove it (\`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${sel}`)}\`) and add it with a valid target: ${this.extAdd(host, owner, `${this.z(kind)} source=${sh(attr(m, 'source') ?? '=<expression>')} target=<variable>`)}.` : 'Fix it in the XML.');
          }
          if (kind === 'output' && blank(attr(m, 'source'))) {
            this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `output:${target ?? i}:source`, `The output mapping ${target ? `to ${target} ` : ''}of ${where} has no source; Camunda 8 refuses the file`, `${this.extAdd(host, owner, `${this.z('output')} source==<expression> target=${target ?? '<variable>'}`)} (replaces the mapping of that target).`);
          }
        });
      }
      return;
    }
    if (local === 'taskHeaders') {
      this.checkHeaders(host, owner, v, '');
      return;
    }
    if (local === 'executionListeners') {
      this.kids(v, 'executionListener').forEach((l, i) => {
        const ev = attr(l, 'eventType');
        const label = `Execution listener ${i + 1}${ev ? ` (${ev})` : ''} of ${where}`;
        const sel = addr ? `\`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${this.z('executionListeners')}/${this.z('executionListener')}[${i}]`)}\`` : 'remove it from the XML';
        const again = (fix: string): string => `${sel}, then ${this.extAdd(host, owner, `${this.z('executionListeners')}/${this.z('executionListener')} ${fix}`)}`;
        if (missing(attr(l, 'type'))) this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${i}:type`, `${label} has no type (the job type of its worker); Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=${ev ?? '<start|end>'} type=<jobType>`)}.`);
        if (ev === undefined || ev.trim() === '') this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${i}:eventType`, `${label} has no eventType; Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=<start|end> type=${attr(l, 'type') ?? '<jobType>'}`)}.`);
        else if (ev !== 'start' && ev !== 'end') this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${i}:eventType`, `${label}: eventType "${ev}" is not start or end; Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=<start|end> type=${attr(l, 'type') ?? '<jobType>'}`)}.`);
        else if (ev === 'start' && (this.kit.is(host, 'bpmn:StartEvent') || this.kit.is(host, 'bpmn:BoundaryEvent'))) this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${i}:start`, `${label}: Camunda 8 does not support start listeners on ${this.kit.is(host, 'bpmn:StartEvent') ? 'start' : 'boundary'} events and refuses the file`, `Make it an end listener or remove it: ${again(`eventType=end type=${attr(l, 'type') ?? '<jobType>'}`)}.`);
        else if (ev === 'end' && this.kit.is(host, 'bpmn:Gateway')) this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${i}:end`, `${label}: Camunda 8 does not support end listeners on gateways and refuses the file`, `Make it a start listener or remove it: ${again(`eventType=start type=${attr(l, 'type') ?? '<jobType>'}`)}.`);
        for (const h of this.kids(l, 'taskHeaders')) this.checkHeaders(host, owner, h, `execution listener ${i + 1}`);
      });
      return;
    }
    if (local === 'taskListeners') {
      if (!this.zeebe(host, 'userTask').length) {
        this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, 'taskListeners:job', `${where} has task listeners but is a job worker user task (no ${this.z('userTask')}); Camunda 8 allows task listeners on Camunda user tasks only and refuses the file`, `Make it a Camunda user task: ${this.extAdd(host, owner, this.z('userTask'))} (or remove the listeners: \`bpmn ext remove <file> ${idOf(host)} ${this.z('taskListeners')}\`).`);
      }
      this.kids(v, 'taskListener').forEach((l, i) => {
        const ev = attr(l, 'eventType');
        const label = `Task listener ${i + 1}${ev ? ` (${ev})` : ''} of ${where}`;
        const again = (fix: string): string => `\`bpmn ext remove <file> ${idOf(host)} ${sh(`${this.z('taskListeners')}/${this.z('taskListener')}[${i}]`)}\`, then ${this.extAdd(host, owner, `${this.z('taskListeners')}/${this.z('taskListener')} ${fix}`)}`;
        if (missing(attr(l, 'type'))) this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `taskListener:${i}:type`, `${label} has no type (the job type of its worker); Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=${ev ?? '<event>'} type=<jobType>`)}.`);
        if (blank(ev)) this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `taskListener:${i}:eventType`, `${label} has no eventType; Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=<creating|assigning|updating|completing|canceling> type=${attr(l, 'type') ?? '<jobType>'}`)}.`);
        else if (!TASK_LISTENER_EVENTS.includes(ev!)) this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `taskListener:${i}:eventType`, `${label}: eventType "${ev}" is not one of creating, assigning, updating, completing, canceling; Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=<creating|assigning|updating|completing|canceling> type=${attr(l, 'type') ?? '<jobType>'}`)}.`);
      });
      return;
    }
    if (local === 'linkedResources') {
      this.kids(v, 'linkedResource').forEach((r, i) => {
        if (missing(attr(r, 'resourceType'))) this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `linkedResource:${i}:resourceType`, `Linked resource ${attr(r, 'linkName') ?? i + 1} of ${where} has no resourceType; Camunda 8 refuses the file`, rebuild());
        const b = attr(r, 'bindingType');
        if (b !== undefined && !BINDING_TYPES.includes(b)) this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `linkedResource:${i}:bindingType`, `Linked resource ${attr(r, 'linkName') ?? i + 1} of ${where} has bindingType="${b}"; Camunda 8 accepts ${BINDING_TYPES.join(', ')} only and refuses the file`, rebuild());
        else if (b === 'versionTag' && blank(attr(r, 'versionTag'))) this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `linkedResource:${i}:versionTag`, `Linked resource ${attr(r, 'linkName') ?? i + 1} of ${where} has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file`, rebuild());
      });
      return;
    }
    if (local === 'adHoc') {
      const oc = attr(v, 'outputCollection');
      const oe = attr(v, 'outputElement');
      if ((oc === undefined) !== (oe === undefined)) {
        this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, 'adHoc:output', `${this.z('adHoc')} of ${where} has ${oc !== undefined ? 'an outputCollection without outputElement' : 'an outputElement without outputCollection'}; Camunda 8 refuses the file`, `${this.extAdd(host, owner, `${this.z('adHoc')} ${oc !== undefined ? 'outputElement==<expression>' : 'outputCollection=<variable>'}`)}.`);
      }
      return;
    }
    if (local === 'conditionalFilter') {
      const events = attr(v, 'variableEvents');
      if (events !== undefined) {
        const bad = events.split(',').map((e) => e.trim()).filter((e) => e && e !== 'create' && e !== 'update');
        if (bad.length) this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, 'conditionalFilter:variableEvents', `${this.z('conditionalFilter')} of ${where} lists the variable events ${bad.join(', ')}; Camunda 8 knows create and update only and refuses the file`, `${rebuild()} (variableEvents=create,update)`);
      }
      return;
    }
    if (local === 'priorityDefinition') {
      const prio = attr(v, 'priority');
      if (prio !== undefined && prio !== '' && !isFeel(prio) && (!/^\s*\d+\s*$/.test(prio) || Number(prio) > 100)) {
        this.push('deploy', 'W_C8_DEPLOY_USER_TASK', host, owner, 'priority', `${this.z('priorityDefinition')} of ${where} has priority "${prio}"; Camunda 8 needs a number from 0 to 100 (or an expression) and refuses the file`, this.fixHint(host, owner, v, { priority: '50' }));
      }
      return;
    }
    if (local === 'taskSchedule') {
      for (const a of ['dueDate', 'followUpDate']) {
        const d = attr(v, a);
        if (d !== undefined && !isFeel(d) && d.trim() !== '' && !new TimerValue(d).isDateTime()) {
          this.push('deploy', 'W_C8_DEPLOY_USER_TASK', host, owner, `taskSchedule:${a}`, `${this.z('taskSchedule')} of ${where} has ${a}="${d}", which is no ISO 8601 date-time with offset (2030-03-02T15:35+02:00); Camunda 8 refuses the file`, this.fixHint(host, owner, v, { [a]: '2030-03-02T15:35+02:00' }).replace(/\.$/, ' (or an expression: =<FEEL>).'));
        }
      }
    }
  }

  /** Task headers: duplicate keys (refused), headers without key or value (dropped). */
  private checkHeaders(host: El, owner: El | undefined, headers: El, inWhat: string): void {
    const where = `${inWhat ? `${inWhat} of ` : ''}${this.describe(host, owner)}`;
    const seen = new Set<string>();
    this.kids(headers, 'header').forEach((h, i) => {
      const key = attr(h, 'key');
      const value = attr(h, 'value');
      if (blank(key) || blank(value)) {
        this.push('runtime', 'W_C8_BAD_VALUE', host, owner, `header:${inWhat}:${i}`, `Task header ${key ? `"${key}"` : i + 1} of ${where} has no ${blank(key) ? 'key' : 'value'}; Camunda 8 drops it, the job does not carry it`, idOf(host) && !inWhat ? `${blank(key) ? `Remove it (\`bpmn ext remove <file> ${idOf(host)} ${sh(`${this.z('taskHeaders')}/${this.z('header')}[${i}]`)}\`) and add it with a key` : 'Give it a value'}: ${this.extAdd(host, owner, `${this.z('header')} key=${key ?? '<key>'} value=<value>`)}.` : 'Fix it in the XML.');
      }
      if (key !== undefined && !blank(key)) {
        if (seen.has(key)) {
          this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `header:${inWhat}:dup:${key}`, `${where} has the task header "${key}" twice; Camunda 8 refuses the file`, idOf(host) && !inWhat ? `Keep one: \`bpmn ext remove <file> ${idOf(host)} ${sh(`${this.z('taskHeaders')}/${this.z('header')}[${i}]`)}\`.` : 'Remove one in the XML.');
        }
        seen.add(key);
      }
    });
  }
}
