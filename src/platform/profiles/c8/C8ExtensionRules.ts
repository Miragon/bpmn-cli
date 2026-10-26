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
    return `Remove it: ${remove}${equivalent ? `; Camunda 8 reads ${this.extAdd(el, owner, equivalent.replace(/^zeebe:/, `${this.prefix}:`))}` : ''}.`;
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
        const home = this.kit.zeebe.typeNames().find((typeName) => this.kit.zeebe.allowedOn(typeName, el) === true && this.kit.zeebe.type(typeName)!.attributes.some((attribute) => attribute.name === local));
        const guess = home ? undefined : didYouMean(local, this.kit.zeebe.attrs().map((attribute) => localName(attribute.name)));
        const value = String(el.$attrs[key] ?? '');
        this.push(
          'runtime',
          'W_C8_UNKNOWN_ATTRIBUTE',
          el,
          owner,
          `attr:${key}`,
          `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${this.prefix}:${guess}?)` : ''}; Camunda 8 ignores it${home ? ` (it reads ${local} on the ${this.zeebeName(localName(home))} extension element)` : ' (most zeebe settings are extension elements: `bpmn kinds`, `bpmn guide`)'}`,
          home ? `Move it: ${unset}, then ${this.extAdd(el, owner, `${this.zeebeName(localName(home))} ${sh(`${local}=${value}`)}`)}.` : `Remove it: ${unset}.`,
        );
        continue;
      }
      if (!def.owners.some((ownerType) => this.kit.is(el, ownerType))) {
        this.push('runtime', 'W_C8_MISPLACED_ATTRIBUTE', el, owner, `attr:${key}`, `${key} on ${where} has no effect: Camunda 8 reads it on ${def.owners.map((ownerType) => lowerFirst(localName(ownerType))).join(', ')} only`, `Remove it: ${unset}.`);
      }
    }
  }

  /** The messages the catch events of the executable processes read: their subscription content. */
  checkCaughtMessages(executable: El[]): void {
    const catching = executable.flatMap((proc) => [...this.kit.walk(proc, { bpmnOnly: true })]).filter((el) => this.kit.is(el, 'bpmn:Event') || this.kit.is(el, 'bpmn:ReceiveTask'));
    const caught = new Set(catching.map((el) => this.messageOf(el)).filter((message): message is El => !!message));
    for (const message of caught) {
      this.checkAttributes(message, undefined);
      this.checkExtensions(message, undefined);
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
    const remove = (extValue: ExtValue): string => (addr ? `\`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${extValue.index}`)}\`` : 'remove it from the XML');
    const counts = new Map<string, number>();
    for (const extValue of values) {
      if (!extValue.uri) continue;
      if (this.kit.camunda.uris.has(extValue.uri)) {
        this.push('runtime', 'W_C8_FOREIGN_CONTENT', host, owner, `ext:${extValue.el.$type}#${extValue.index}`, `${where} contains the Camunda 7 extension ${extValue.el.$type}, which Camunda 8 ignores`, this.foreignHint(host, owner, extValue.local, remove(extValue)));
        continue;
      }
      if (extValue.uri !== this.kit.zeebe.uri) continue;
      const zeebeType = this.kit.zeebe.type(extValue.local);
      if (!zeebeType) {
        const guess = didYouMean(extValue.local, this.kit.zeebe.typeNames().map(localName));
        this.push('runtime', 'W_C8_UNKNOWN_ELEMENT', host, owner, `ext:${extValue.local}`, `${where} has the unknown extension element ${this.zeebeName(extValue.local)}${guess ? ` (did you mean ${this.zeebeName(guess)}?)` : ''}; Camunda 8 ignores it`, `Remove it (${remove(extValue)})${guess && addr ? ` and add the right one: ${this.extAdd(host, owner, `${this.zeebeName(guess)} ...`)}` : ''}.`);
        continue;
      }
      if (this.kit.zeebe.nestedOnly(extValue.local)) {
        const container = this.kit.zeebe.containersOf(extValue.local)[0]!;
        this.push('runtime', 'W_C8_MISPLACED_EXTENSION', host, owner, `ext:${extValue.local}`, `${this.zeebeName(extValue.local)} sits directly in the extension elements of ${where}, but belongs inside ${this.zeebeName(localName(container))}; Camunda 8 ignores it`, `Remove it (${remove(extValue)}) and add it again, \`bpmn ext add\` files it into its container: ${this.extAdd(host, owner, `${this.zeebeName(extValue.local)} ...`)}.`);
        continue;
      }
      if (extValue.local === 'executionListeners' && this.kit.is(host, 'bpmn:SequenceFlow')) {
        this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, 'listener:flow', `${where} has execution listeners; Camunda 8 supports them on processes, activities, events and gateways, not on sequence flows, and refuses the file`, `Remove them (${remove(extValue)}) and put them on the flow's source or target.`);
        continue;
      }
      if (this.kit.zeebe.allowedOn(extValue.local, host) === false) {
        const hosts = zeebeType.allowedIn.filter((allowedHost) => allowedHost.startsWith('bpmn:')).map((allowedHost) => lowerFirst(localName(allowedHost)));
        this.push('runtime', 'W_C8_MISPLACED_EXTENSION', host, owner, `ext:${extValue.local}`, `${this.zeebeName(extValue.local)} on ${where} has no effect: Camunda 8 reads it on ${hosts.length > 5 ? `${hosts.slice(0, 5).join(', ')}, ...` : hosts.join(', ')} only`, `Remove it: ${remove(extValue)}.`);
        continue;
      }
      counts.set(extValue.local, (counts.get(extValue.local) ?? 0) + 1);
      this.checkZeebeElement(host, owner, extValue.el, '');
    }
    for (const [local, count] of counts) {
      if (count < 2 || !this.kit.zeebe.isSingle(local)) continue;
      this.push('deploy', 'W_C8_DEPLOY_DUPLICATE_EXTENSION', host, owner, `dup:${local}`, `${where} has ${count} ${this.zeebeName(local)} elements; Camunda 8 reads one and refuses the file`, `Merge them into one: ${lowerFirst(this.rebuildHint(host, owner, this.zeebeName(local)).replace(/^See it/, 'See them'))}`);
    }
    // input mappings where the engine reads only outputs
    const ignored = this.inputsIgnored(host);
    if (ignored) {
      for (const io of this.zeebe(host, 'ioMapping')) {
        for (const input of this.kids(io, 'input')) {
          const target = attr(input, 'target') ?? '';
          this.push('runtime', 'W_C8_MISPLACED_EXTENSION', host, owner, `input:${target}`, `The input mapping ${target ? `to ${target} ` : ''}on ${where} has no effect: Camunda 8 ignores input mappings on ${ignored} (output mappings work there)`, addr ?`Remove it: \`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${this.zeebeName('input')}[target=${target}]`)}\` (set the variable in an activity before it, or as an output mapping of the element before).` : 'Remove it from the XML.');
        }
      }
    }
  }

  /**
   * Attributes and children of a zeebe element (known names, placement), recursively; then the
   * engine rules on its content.
   */
  private checkZeebeElement(host: El, owner: El | undefined, zeebeElement: El, path: string): void {
    const local = localName(zeebeElement.$type);
    const zeebeType = this.kit.zeebe.type(local);
    if (!zeebeType) return;
    const where = `${this.zeebeName(local)}${path ? ` (in ${path})` : ''} of ${this.describe(host, owner)}`;
    const names = new Set(zeebeType.attributes.map((attribute) => attribute.name));
    for (const attributeKey of Object.keys(zeebeElement as unknown as Record<string, unknown>)) {
      if (attributeKey.startsWith('$') || attributeKey.startsWith('xmlns') || attributeKey.includes(':')) continue;
      if (names.has(attributeKey)) continue;
      const guess = didYouMean(attributeKey, [...names]);
      this.push('runtime', 'W_C8_UNKNOWN_ATTRIBUTE', host, owner, `ext:${path}/${local}@${attributeKey}`, `${where} has the unknown attribute ${attributeKey}${guess ? ` (did you mean ${guess}?)` : ''}; Camunda 8 ignores it`, this.rebuildHint(host, owner, this.zeebeName(path ? path.split(' > ')[0]!.replace(/^[^:]+:/, '') : local)));
    }
    for (const feelAttribute of FEEL_ATTRS[local] ?? []) {
      const value = attr(zeebeElement, feelAttribute);
      const target = attr(zeebeElement, 'target');
      // a mapping is replaced by its target: give the corrected one
      const fix =
        (local === 'input' || local === 'output') && target && isFeel(value)
          ? `${this.extAdd(host, owner, `${this.zeebeName(local)} ${sh(`source==${feelOf(value!.trim().slice(1)).trim()}`)} target=${sh(target)}`)} (replaces the mapping of that target; check the FEEL syntax).`
          : path
            ? this.rebuildHint(host, owner, this.zeebeName(localName(path.split(' > ')[0]!)))
            : this.fixHint(host, owner, zeebeElement, { [feelAttribute]: '=<FEEL expression>' });
      this.checkFeel(host, owner, `${path}/${local}@${feelAttribute}`, `${feelAttribute} of ${where}`, value, fix);
    }
    for (const child of this.kids(zeebeElement)) {
      const cl = localName(child.$type);
      const childPath = path ? `${path} > ${this.zeebeName(local)}` : this.zeebeName(local);
      if (!zeebeType.children.includes(`zeebe:${cl}`)) {
        const known = this.kit.zeebe.type(cl);
        this.push('runtime', known ? 'W_C8_MISPLACED_EXTENSION' : 'W_C8_UNKNOWN_ELEMENT', host, owner, `ext:${childPath}/${cl}`, known ? `${this.zeebeName(cl)} does not belong inside ${this.zeebeName(local)} (${where}); Camunda 8 ignores it` : `${where} contains the unknown element ${this.zeebeName(cl)}; Camunda 8 ignores it`, this.rebuildHint(host, owner, this.zeebeName(path ? localName(path.split(' > ')[0]!) : local)));
        continue;
      }
      this.checkZeebeElement(host, owner, child, childPath);
    }
    if (!path) this.checkContent(host, owner, zeebeElement, local);
  }

  /** Engine rules on the content of one top-level zeebe element. */
  private checkContent(host: El, owner: El | undefined, zeebeElement: El, local: string): void {
    this.checkBinding(host, owner, zeebeElement, local);
    this.contentChecks[local]?.(host, owner, zeebeElement);
  }

  private readonly contentChecks: Record<string, (host: El, owner: El | undefined, zeebeElement: El) => void> = {
    ioMapping: (host, owner, zeebeElement) => this.checkIoMapping(host, owner, zeebeElement),
    taskHeaders: (host, owner, zeebeElement) => this.checkHeaders(host, owner, zeebeElement, ''),
    executionListeners: (host, owner, zeebeElement) => this.checkExecutionListeners(host, owner, zeebeElement),
    taskListeners: (host, owner, zeebeElement) => this.checkTaskListeners(host, owner, zeebeElement),
    linkedResources: (host, owner, zeebeElement) => this.checkLinkedResources(host, owner, zeebeElement),
    adHoc: (host, owner, zeebeElement) => this.checkAdHoc(host, owner, zeebeElement),
    conditionalFilter: (host, owner, zeebeElement) => this.checkConditionalFilter(host, owner, zeebeElement),
    priorityDefinition: (host, owner, zeebeElement) => this.checkPriority(host, owner, zeebeElement),
    taskSchedule: (host, owner, zeebeElement) => this.checkTaskSchedule(host, owner, zeebeElement),
  };

  private checkBinding(host: El, owner: El | undefined, zeebeElement: El, local: string): void {
    const where = this.describe(host, owner);
    const binding = attr(zeebeElement, 'bindingType');
    if (binding === undefined || !['calledDecision', 'calledElement', 'formDefinition'].includes(local)) return;
    if (!BINDING_TYPES.includes(binding)) {
      this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `${local}:bindingType`, `${this.zeebeName(local)} of ${where} has bindingType="${binding}"; Camunda 8 accepts ${BINDING_TYPES.join(', ')} only and refuses the file`, this.fixHint(host, owner, zeebeElement, { bindingType: 'latest' }));
    } else if (binding === 'versionTag' && blank(attr(zeebeElement, 'versionTag'))) {
      this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `${local}:versionTag`, `${this.zeebeName(local)} of ${where} has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file`, this.fixHint(host, owner, zeebeElement, { versionTag: '<versionTag>' }));
    }
  }

  private checkIoMapping(host: El, owner: El | undefined, zeebeElement: El): void {
    const where = this.describe(host, owner);
    const addr = this.addressOf(host, owner);
    for (const [kind, label] of [
      ['input', 'input'],
      ['output', 'output'],
    ] as const) {
      this.kids(zeebeElement, kind).forEach((mapping, index) => {
        const target = attr(mapping, 'target');
        const sel = target ? `${this.zeebeName(kind)}[target=${target}]` : `${this.zeebeName('ioMapping')}/${this.zeebeName(kind)}[${index}]`;
        if (blank(target)) {
          this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `${kind}#${index}:target`, `The ${label} mapping ${index + 1} of ${where} has no target; Camunda 8 refuses the file`, addr ? `Remove it (\`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${sel}`)}\`) and add it with a target: ${this.extAdd(host, owner, `${this.zeebeName(kind)} source==<expression> target=<variable>`)}.` : 'Fix it in the XML.');
        } else if (!PATH.test(target!.trim())) {
          this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `${kind}:${target}:target`, `The ${label} mapping target "${target}" of ${where} is not a variable name or path (a.b.c); Camunda 8 refuses the file`, addr ? `Remove it (\`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${sel}`)}\`) and add it with a valid target: ${this.extAdd(host, owner, `${this.zeebeName(kind)} source=${sh(attr(mapping, 'source') ?? '=<expression>')} target=<variable>`)}.` : 'Fix it in the XML.');
        }
        if (kind === 'output' && blank(attr(mapping, 'source'))) {
          this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `output:${target ?? index}:source`, `The output mapping ${target ? `to ${target} ` : ''}of ${where} has no source; Camunda 8 refuses the file`, `${this.extAdd(host, owner, `${this.zeebeName('output')} source==<expression> target=${target ?? '<variable>'}`)} (replaces the mapping of that target).`);
        }
      });
    }
  }

  private checkExecutionListeners(host: El, owner: El | undefined, zeebeElement: El): void {
    const where = this.describe(host, owner);
    const addr = this.addressOf(host, owner);
    this.kids(zeebeElement, 'executionListener').forEach((listener, index) => {
      const ev = attr(listener, 'eventType');
      const label = `Execution listener ${index + 1}${ev ? ` (${ev})` : ''} of ${where}`;
      const sel = addr ? `\`bpmn ext remove <file> ${addr.id} ${sh(`${addr.prefix}${this.zeebeName('executionListeners')}/${this.zeebeName('executionListener')}[${index}]`)}\`` : 'remove it from the XML';
      const again = (fix: string): string => `${sel}, then ${this.extAdd(host, owner, `${this.zeebeName('executionListeners')}/${this.zeebeName('executionListener')} ${fix}`)}`;
      if (missing(attr(listener, 'type'))) this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${index}:type`, `${label} has no type (the job type of its worker); Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=${ev ?? '<start|end>'} type=<jobType>`)}.`);
      if (ev === undefined || ev.trim() === '') this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${index}:eventType`, `${label} has no eventType; Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=<start|end> type=${attr(listener, 'type') ?? '<jobType>'}`)}.`);
      else if (ev !== 'start' && ev !== 'end') this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${index}:eventType`, `${label}: eventType "${ev}" is not start or end; Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=<start|end> type=${attr(listener, 'type') ?? '<jobType>'}`)}.`);
      else if (ev === 'start' && (this.kit.is(host, 'bpmn:StartEvent') || this.kit.is(host, 'bpmn:BoundaryEvent'))) this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${index}:start`, `${label}: Camunda 8 does not support start listeners on ${this.kit.is(host, 'bpmn:StartEvent') ? 'start' : 'boundary'} events and refuses the file`, `Make it an end listener or remove it: ${again(`eventType=end type=${attr(listener, 'type') ?? '<jobType>'}`)}.`);
      else if (ev === 'end' && this.kit.is(host, 'bpmn:Gateway')) this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `listener:${index}:end`, `${label}: Camunda 8 does not support end listeners on gateways and refuses the file`, `Make it a start listener or remove it: ${again(`eventType=start type=${attr(listener, 'type') ?? '<jobType>'}`)}.`);
      for (const taskHeaders of this.kids(listener, 'taskHeaders')) this.checkHeaders(host, owner, taskHeaders, `execution listener ${index + 1}`);
    });
  }

  private checkTaskListeners(host: El, owner: El | undefined, zeebeElement: El): void {
    const where = this.describe(host, owner);
    if (!this.zeebe(host, 'userTask').length) {
      this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, 'taskListeners:job', `${where} has task listeners but is a job worker user task (no ${this.zeebeName('userTask')}); Camunda 8 allows task listeners on Camunda user tasks only and refuses the file`, `Make it a Camunda user task: ${this.extAdd(host, owner, this.zeebeName('userTask'))} (or remove the listeners: \`bpmn ext remove <file> ${idOf(host)} ${this.zeebeName('taskListeners')}\`).`);
    }
    this.kids(zeebeElement, 'taskListener').forEach((listener, index) => {
      const ev = attr(listener, 'eventType');
      const label = `Task listener ${index + 1}${ev ? ` (${ev})` : ''} of ${where}`;
      const again = (fix: string): string => `\`bpmn ext remove <file> ${idOf(host)} ${sh(`${this.zeebeName('taskListeners')}/${this.zeebeName('taskListener')}[${index}]`)}\`, then ${this.extAdd(host, owner, `${this.zeebeName('taskListeners')}/${this.zeebeName('taskListener')} ${fix}`)}`;
      if (missing(attr(listener, 'type'))) this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `taskListener:${index}:type`, `${label} has no type (the job type of its worker); Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=${ev ?? '<event>'} type=<jobType>`)}.`);
      if (blank(ev)) this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `taskListener:${index}:eventType`, `${label} has no eventType; Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=<creating|assigning|updating|completing|canceling> type=${attr(listener, 'type') ?? '<jobType>'}`)}.`);
      else if (!TASK_LISTENER_EVENTS.includes(ev!)) this.push('deploy', 'W_C8_DEPLOY_LISTENER', host, owner, `taskListener:${index}:eventType`, `${label}: eventType "${ev}" is not one of creating, assigning, updating, completing, canceling; Camunda 8 refuses the file`, `Rebuild it: ${again(`eventType=<creating|assigning|updating|completing|canceling> type=${attr(listener, 'type') ?? '<jobType>'}`)}.`);
    });
  }

  private checkLinkedResources(host: El, owner: El | undefined, zeebeElement: El): void {
    const where = this.describe(host, owner);
    const rebuild = (): string => this.rebuildHint(host, owner, this.zeebeName('linkedResources'));
    this.kids(zeebeElement, 'linkedResource').forEach((resource, index) => {
      if (missing(attr(resource, 'resourceType'))) this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `linkedResource:${index}:resourceType`, `Linked resource ${attr(resource, 'linkName') ?? index + 1} of ${where} has no resourceType; Camunda 8 refuses the file`, rebuild());
      const bindingType = attr(resource, 'bindingType');
      if (bindingType !== undefined && !BINDING_TYPES.includes(bindingType)) this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `linkedResource:${index}:bindingType`, `Linked resource ${attr(resource, 'linkName') ?? index + 1} of ${where} has bindingType="${bindingType}"; Camunda 8 accepts ${BINDING_TYPES.join(', ')} only and refuses the file`, rebuild());
      else if (bindingType === 'versionTag' && blank(attr(resource, 'versionTag'))) this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `linkedResource:${index}:versionTag`, `Linked resource ${attr(resource, 'linkName') ?? index + 1} of ${where} has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file`, rebuild());
    });
  }

  private checkAdHoc(host: El, owner: El | undefined, zeebeElement: El): void {
    const where = this.describe(host, owner);
    const oc = attr(zeebeElement, 'outputCollection');
    const oe = attr(zeebeElement, 'outputElement');
    if ((oc === undefined) === (oe === undefined)) return;
    this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, 'adHoc:output', `${this.zeebeName('adHoc')} of ${where} has ${oc !== undefined ? 'an outputCollection without outputElement' : 'an outputElement without outputCollection'}; Camunda 8 refuses the file`, `${this.extAdd(host, owner, `${this.zeebeName('adHoc')} ${oc !== undefined ? 'outputElement==<expression>' : 'outputCollection=<variable>'}`)}.`);
  }

  private checkConditionalFilter(host: El, owner: El | undefined, zeebeElement: El): void {
    const where = this.describe(host, owner);
    const rebuild = (): string => this.rebuildHint(host, owner, this.zeebeName('conditionalFilter'));
    const events = attr(zeebeElement, 'variableEvents');
    if (events === undefined) return;
    const bad = events.split(',').map((eventName) => eventName.trim()).filter((eventName) => eventName && eventName !== 'create' && eventName !== 'update');
    if (bad.length) this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, 'conditionalFilter:variableEvents', `${this.zeebeName('conditionalFilter')} of ${where} lists the variable events ${bad.join(', ')}; Camunda 8 knows create and update only and refuses the file`, `${rebuild()} (variableEvents=create,update)`);
  }

  private checkPriority(host: El, owner: El | undefined, zeebeElement: El): void {
    const where = this.describe(host, owner);
    const prio = attr(zeebeElement, 'priority');
    if (prio === undefined || prio === '' || isFeel(prio) || (/^\s*\d+\s*$/.test(prio) && Number(prio) <= 100)) return;
    this.push('deploy', 'W_C8_DEPLOY_USER_TASK', host, owner, 'priority', `${this.zeebeName('priorityDefinition')} of ${where} has priority "${prio}"; Camunda 8 needs a number from 0 to 100 (or an expression) and refuses the file`, this.fixHint(host, owner, zeebeElement, { priority: '50' }));
  }

  private checkTaskSchedule(host: El, owner: El | undefined, zeebeElement: El): void {
    const where = this.describe(host, owner);
    for (const dateAttribute of ['dueDate', 'followUpDate']) {
      const dateValue = attr(zeebeElement, dateAttribute);
      if (dateValue !== undefined && !isFeel(dateValue) && dateValue.trim() !== '' && !new TimerValue(dateValue).isDateTime()) {
        this.push('deploy', 'W_C8_DEPLOY_USER_TASK', host, owner, `taskSchedule:${dateAttribute}`, `${this.zeebeName('taskSchedule')} of ${where} has ${dateAttribute}="${dateValue}", which is no ISO 8601 date-time with offset (2030-03-02T15:35+02:00); Camunda 8 refuses the file`, this.fixHint(host, owner, zeebeElement, { [dateAttribute]: '2030-03-02T15:35+02:00' }).replace(/\.$/, ' (or an expression: =<FEEL>).'));
      }
    }
  }

  /** Task headers: duplicate keys (refused), headers without key or value (dropped). */
  private checkHeaders(host: El, owner: El | undefined, headers: El, inWhat: string): void {
    const where = `${inWhat ? `${inWhat} of ` : ''}${this.describe(host, owner)}`;
    const seen = new Set<string>();
    this.kids(headers, 'header').forEach((header, index) => {
      const key = attr(header, 'key');
      const value = attr(header, 'value');
      if (blank(key) || blank(value)) {
        this.push('runtime', 'W_C8_BAD_VALUE', host, owner, `header:${inWhat}:${index}`, `Task header ${key ? `"${key}"` : index + 1} of ${where} has no ${blank(key) ? 'key' : 'value'}; Camunda 8 drops it, the job does not carry it`, idOf(host) && !inWhat ? `${blank(key) ? `Remove it (\`bpmn ext remove <file> ${idOf(host)} ${sh(`${this.zeebeName('taskHeaders')}/${this.zeebeName('header')}[${index}]`)}\`) and add it with a key` : 'Give it a value'}: ${this.extAdd(host, owner, `${this.zeebeName('header')} key=${key ?? '<key>'} value=<value>`)}.` : 'Fix it in the XML.');
      }
      if (key !== undefined && !blank(key)) {
        if (seen.has(key)) {
          this.push('deploy', 'W_C8_DEPLOY_EXTENSION', host, owner, `header:${inWhat}:dup:${key}`, `${where} has the task header "${key}" twice; Camunda 8 refuses the file`, idOf(host) && !inWhat ? `Keep one: \`bpmn ext remove <file> ${idOf(host)} ${sh(`${this.zeebeName('taskHeaders')}/${this.zeebeName('header')}[${index}]`)}\`.` : 'Remove one in the XML.');
        }
        seen.add(key);
      }
    });
  }
}
