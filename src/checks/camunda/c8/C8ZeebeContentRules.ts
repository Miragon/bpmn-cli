import { type BpmnElement, IdWords } from '../../../model/index.js';
import { C8Rules } from './C8Rules.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';
import { TimerValue } from '../values/TimerValue.js';

export class C8ZeebeContentRules extends C8Rules {
  private static readonly BINDING_TYPES = ['deployment', 'latest', 'versionTag'];
  private static readonly PATH = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
  private static readonly TASK_LISTENER_EVENTS = ['creating', 'assigning', 'updating', 'completing', 'canceling', 'create', 'assignment', 'update', 'complete', 'cancel'];

  check(element: BpmnElement, reporter: RuleReporter): void {
    const { host, owner } = reporter;
    const local = IdWords.localName(element.type);
    this.checkBinding(host, owner, element, local, reporter);
    this.contentChecks[local]?.(host, owner, element, reporter);
  }

  private readonly contentChecks: Record<string, (host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, reporter: RuleReporter) => void> = {
    ioMapping: (host, owner, zeebeElement, reporter) => this.checkIoMapping(host, owner, zeebeElement, reporter),
    taskHeaders: (host, owner, zeebeElement, reporter) => this.checkHeaders(host, owner, zeebeElement, '', reporter),
    executionListeners: (host, owner, zeebeElement, reporter) => this.checkExecutionListeners(host, owner, zeebeElement, reporter),
    taskListeners: (host, owner, zeebeElement, reporter) => this.checkTaskListeners(host, owner, zeebeElement, reporter),
    linkedResources: (host, owner, zeebeElement, reporter) => this.checkLinkedResources(host, owner, zeebeElement, reporter),
    adHoc: (host, owner, zeebeElement, reporter) => this.checkAdHoc(host, owner, zeebeElement, reporter),
    conditionalFilter: (host, owner, zeebeElement, reporter) => this.checkConditionalFilter(host, owner, zeebeElement, reporter),
    priorityDefinition: (host, owner, zeebeElement, reporter) => this.checkPriority(host, owner, zeebeElement, reporter),
    taskSchedule: (host, owner, zeebeElement, reporter) => this.checkTaskSchedule(host, owner, zeebeElement, reporter),
  };

  private checkBinding(host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, local: string, reporter: RuleReporter): void {
    const where = this.describe(host, owner);
    const binding = this.attr(zeebeElement, 'bindingType');
    if (binding === undefined || !['calledDecision', 'calledElement', 'formDefinition'].includes(local)) {
      return;
    }
    if (!C8ZeebeContentRules.BINDING_TYPES.includes(binding)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EXTENSION', element: host, owner, subject: `${local}:bindingType`, message: `${this.zeebeName(local)} of ${where} has bindingType="${binding}"; Camunda 8 accepts ${C8ZeebeContentRules.BINDING_TYPES.join(', ')} only and refuses the file`, hint: this.fixHint(host, owner, zeebeElement, { bindingType: 'latest' }) });
    } else if (binding === 'versionTag' && this.blank(this.attr(zeebeElement, 'versionTag'))) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EXTENSION', element: host, owner, subject: `${local}:versionTag`, message: `${this.zeebeName(local)} of ${where} has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file`, hint: this.fixHint(host, owner, zeebeElement, { versionTag: '<versionTag>' }) });
    }
  }

  private checkIoMapping(host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, reporter: RuleReporter): void {
    const where = this.describe(host, owner);
    const addr = this.addressOf(host, owner);
    for (const [kind, label] of [
      ['input', 'input'],
      ['output', 'output'],
    ] as const) {
      this.kids(zeebeElement, kind).forEach((mapping, index) => {
        const target = this.attr(mapping, 'target');
        const sel = target ? `${this.zeebeName(kind)}[target=${target}]` : `${this.zeebeName('ioMapping')}/${this.zeebeName(kind)}[${index}]`;
        if (this.blank(target)) {
          reporter.deploy({ code: 'W_C8_DEPLOY_EXTENSION', element: host, owner, subject: `${kind}#${index}:target`, message: `The ${label} mapping ${index + 1} of ${where} has no target; Camunda 8 refuses the file`, hint: addr ? `Remove it (\`bpmn ext remove <file> ${addr.id} ${ShellWords.quote(`${addr.prefix}${sel}`)}\`) and add it with a target: ${this.extAdd(host, owner, `${this.zeebeName(kind)} source==<expression> target=<variable>`)}.` : 'Fix it in the XML.' });
        } else if (!C8ZeebeContentRules.PATH.test(target!.trim())) {
          reporter.deploy({ code: 'W_C8_DEPLOY_EXTENSION', element: host, owner, subject: `${kind}:${target}:target`, message: `The ${label} mapping target "${target}" of ${where} is not a variable name or path (a.b.c); Camunda 8 refuses the file`, hint: addr ? `Remove it (\`bpmn ext remove <file> ${addr.id} ${ShellWords.quote(`${addr.prefix}${sel}`)}\`) and add it with a valid target: ${this.extAdd(host, owner, `${this.zeebeName(kind)} source=${ShellWords.quote(this.attr(mapping, 'source') ?? '=<expression>')} target=<variable>`)}.` : 'Fix it in the XML.' });
        }
        if (kind === 'output' && this.blank(this.attr(mapping, 'source'))) {
          reporter.deploy({ code: 'W_C8_DEPLOY_EXTENSION', element: host, owner, subject: `output:${target ?? index}:source`, message: `The output mapping ${target ? `to ${target} ` : ''}of ${where} has no source; Camunda 8 refuses the file`, hint: `${this.extAdd(host, owner, `${this.zeebeName('output')} source==<expression> target=${target ?? '<variable>'}`)} (replaces the mapping of that target).` });
        }
      });
    }
  }

  private checkExecutionListeners(host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, reporter: RuleReporter): void {
    const where = this.describe(host, owner);
    const addr = this.addressOf(host, owner);
    this.kids(zeebeElement, 'executionListener').forEach((listener, index) => {
      const ev = this.attr(listener, 'eventType');
      const label = `Execution listener ${index + 1}${ev ? ` (${ev})` : ''} of ${where}`;
      const sel = addr ? `\`bpmn ext remove <file> ${addr.id} ${ShellWords.quote(`${addr.prefix}${this.zeebeName('executionListeners')}/${this.zeebeName('executionListener')}[${index}]`)}\`` : 'remove it from the XML';
      const again = (fix: string): string => `${sel}, then ${this.extAdd(host, owner, `${this.zeebeName('executionListeners')}/${this.zeebeName('executionListener')} ${fix}`)}`;
      if (this.missing(this.attr(listener, 'type'))) {
        reporter.deploy({ code: 'W_C8_DEPLOY_LISTENER', element: host, owner, subject: `listener:${index}:type`, message: `${label} has no type (the job type of its worker); Camunda 8 refuses the file`, hint: `Rebuild it: ${again(`eventType=${ev ?? '<start|end>'} type=<jobType>`)}.` });
      }
      if (ev === undefined || ev.trim() === '') {
        reporter.deploy({ code: 'W_C8_DEPLOY_LISTENER', element: host, owner, subject: `listener:${index}:eventType`, message: `${label} has no eventType; Camunda 8 refuses the file`, hint: `Rebuild it: ${again(`eventType=<start|end> type=${this.attr(listener, 'type') ?? '<jobType>'}`)}.` });
      } else if (ev !== 'start' && ev !== 'end') {
        reporter.deploy({ code: 'W_C8_DEPLOY_LISTENER', element: host, owner, subject: `listener:${index}:eventType`, message: `${label}: eventType "${ev}" is not start or end; Camunda 8 refuses the file`, hint: `Rebuild it: ${again(`eventType=<start|end> type=${this.attr(listener, 'type') ?? '<jobType>'}`)}.` });
      } else if (ev === 'start' && (host.is('bpmn:StartEvent') || host.is('bpmn:BoundaryEvent'))) {
        reporter.deploy({ code: 'W_C8_DEPLOY_LISTENER', element: host, owner, subject: `listener:${index}:start`, message: `${label}: Camunda 8 does not support start listeners on ${host.is('bpmn:StartEvent') ? 'start' : 'boundary'} events and refuses the file`, hint: `Make it an end listener or remove it: ${again(`eventType=end type=${this.attr(listener, 'type') ?? '<jobType>'}`)}.` });
      } else if (ev === 'end' && host.is('bpmn:Gateway')) {
        reporter.deploy({ code: 'W_C8_DEPLOY_LISTENER', element: host, owner, subject: `listener:${index}:end`, message: `${label}: Camunda 8 does not support end listeners on gateways and refuses the file`, hint: `Make it a start listener or remove it: ${again(`eventType=start type=${this.attr(listener, 'type') ?? '<jobType>'}`)}.` });
      }
      for (const taskHeaders of this.kids(listener, 'taskHeaders')) {
        this.checkHeaders(host, owner, taskHeaders, `execution listener ${index + 1}`, reporter);
      }
    });
  }

  private checkTaskListeners(host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, reporter: RuleReporter): void {
    const where = this.describe(host, owner);
    if (!this.zeebe(host, 'userTask').length) {
      reporter.deploy({ code: 'W_C8_DEPLOY_LISTENER', element: host, owner, subject: 'taskListeners:job', message: `${where} has task listeners but is a job worker user task (no ${this.zeebeName('userTask')}); Camunda 8 allows task listeners on Camunda user tasks only and refuses the file`, hint: `Make it a Camunda user task: ${this.extAdd(host, owner, this.zeebeName('userTask'))} (or remove the listeners: \`bpmn ext remove <file> ${host.id} ${this.zeebeName('taskListeners')}\`).` });
    }
    this.kids(zeebeElement, 'taskListener').forEach((listener, index) => {
      const ev = this.attr(listener, 'eventType');
      const label = `Task listener ${index + 1}${ev ? ` (${ev})` : ''} of ${where}`;
      const again = (fix: string): string => `\`bpmn ext remove <file> ${host.id} ${ShellWords.quote(`${this.zeebeName('taskListeners')}/${this.zeebeName('taskListener')}[${index}]`)}\`, then ${this.extAdd(host, owner, `${this.zeebeName('taskListeners')}/${this.zeebeName('taskListener')} ${fix}`)}`;
      if (this.missing(this.attr(listener, 'type'))) {
        reporter.deploy({ code: 'W_C8_DEPLOY_LISTENER', element: host, owner, subject: `taskListener:${index}:type`, message: `${label} has no type (the job type of its worker); Camunda 8 refuses the file`, hint: `Rebuild it: ${again(`eventType=${ev ?? '<event>'} type=<jobType>`)}.` });
      }
      if (this.blank(ev)) {
        reporter.deploy({ code: 'W_C8_DEPLOY_LISTENER', element: host, owner, subject: `taskListener:${index}:eventType`, message: `${label} has no eventType; Camunda 8 refuses the file`, hint: `Rebuild it: ${again(`eventType=<creating|assigning|updating|completing|canceling> type=${this.attr(listener, 'type') ?? '<jobType>'}`)}.` });
      } else if (!C8ZeebeContentRules.TASK_LISTENER_EVENTS.includes(ev!)) {
        reporter.deploy({ code: 'W_C8_DEPLOY_LISTENER', element: host, owner, subject: `taskListener:${index}:eventType`, message: `${label}: eventType "${ev}" is not one of creating, assigning, updating, completing, canceling; Camunda 8 refuses the file`, hint: `Rebuild it: ${again(`eventType=<creating|assigning|updating|completing|canceling> type=${this.attr(listener, 'type') ?? '<jobType>'}`)}.` });
      }
    });
  }

  private checkLinkedResources(host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, reporter: RuleReporter): void {
    const where = this.describe(host, owner);
    const rebuild = (): string => this.rebuildHint(host, owner, this.zeebeName('linkedResources'));
    this.kids(zeebeElement, 'linkedResource').forEach((resource, index) => {
      if (this.missing(this.attr(resource, 'resourceType'))) {
        reporter.deploy({ code: 'W_C8_DEPLOY_EXTENSION', element: host, owner, subject: `linkedResource:${index}:resourceType`, message: `Linked resource ${this.attr(resource, 'linkName') ?? index + 1} of ${where} has no resourceType; Camunda 8 refuses the file`, hint: rebuild() });
      }
      const bindingType = this.attr(resource, 'bindingType');
      if (bindingType !== undefined && !C8ZeebeContentRules.BINDING_TYPES.includes(bindingType)) {
        reporter.deploy({ code: 'W_C8_DEPLOY_EXTENSION', element: host, owner, subject: `linkedResource:${index}:bindingType`, message: `Linked resource ${this.attr(resource, 'linkName') ?? index + 1} of ${where} has bindingType="${bindingType}"; Camunda 8 accepts ${C8ZeebeContentRules.BINDING_TYPES.join(', ')} only and refuses the file`, hint: rebuild() });
      } else if (bindingType === 'versionTag' && this.blank(this.attr(resource, 'versionTag'))) {
        reporter.deploy({ code: 'W_C8_DEPLOY_EXTENSION', element: host, owner, subject: `linkedResource:${index}:versionTag`, message: `Linked resource ${this.attr(resource, 'linkName') ?? index + 1} of ${where} has bindingType="versionTag" but no versionTag; Camunda 8 refuses the file`, hint: rebuild() });
      }
    });
  }

  private checkAdHoc(host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, reporter: RuleReporter): void {
    const where = this.describe(host, owner);
    const oc = this.attr(zeebeElement, 'outputCollection');
    const oe = this.attr(zeebeElement, 'outputElement');
    if ((oc === undefined) === (oe === undefined)) {
      return;
    }
    reporter.deploy({ code: 'W_C8_DEPLOY_EXTENSION', element: host, owner, subject: 'adHoc:output', message: `${this.zeebeName('adHoc')} of ${where} has ${oc !== undefined ? 'an outputCollection without outputElement' : 'an outputElement without outputCollection'}; Camunda 8 refuses the file`, hint: `${this.extAdd(host, owner, `${this.zeebeName('adHoc')} ${oc !== undefined ? 'outputElement==<expression>' : 'outputCollection=<variable>'}`)}.` });
  }

  private checkConditionalFilter(host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, reporter: RuleReporter): void {
    const where = this.describe(host, owner);
    const rebuild = (): string => this.rebuildHint(host, owner, this.zeebeName('conditionalFilter'));
    const events = this.attr(zeebeElement, 'variableEvents');
    if (events === undefined) {
      return;
    }
    const bad = events.split(',').map((eventName) => eventName.trim()).filter((eventName) => eventName && eventName !== 'create' && eventName !== 'update');
    if (bad.length) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EXTENSION', element: host, owner, subject: 'conditionalFilter:variableEvents', message: `${this.zeebeName('conditionalFilter')} of ${where} lists the variable events ${bad.join(', ')}; Camunda 8 knows create and update only and refuses the file`, hint: `${rebuild()} (variableEvents=create,update)` });
    }
  }

  private checkPriority(host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, reporter: RuleReporter): void {
    const where = this.describe(host, owner);
    const prio = this.attr(zeebeElement, 'priority');
    if (prio === undefined || prio === '' || this.isFeel(prio) || (/^\s*\d+\s*$/.test(prio) && Number(prio) <= 100)) {
      return;
    }
    reporter.deploy({ code: 'W_C8_DEPLOY_USER_TASK', element: host, owner, subject: 'priority', message: `${this.zeebeName('priorityDefinition')} of ${where} has priority "${prio}"; Camunda 8 needs a number from 0 to 100 (or an expression) and refuses the file`, hint: this.fixHint(host, owner, zeebeElement, { priority: '50' }) });
  }

  private checkTaskSchedule(host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, reporter: RuleReporter): void {
    const where = this.describe(host, owner);
    for (const dateAttribute of ['dueDate', 'followUpDate']) {
      const dateValue = this.attr(zeebeElement, dateAttribute);
      if (dateValue !== undefined && !this.isFeel(dateValue) && dateValue.trim() !== '' && !new TimerValue(dateValue).isDateTime()) {
        reporter.deploy({ code: 'W_C8_DEPLOY_USER_TASK', element: host, owner, subject: `taskSchedule:${dateAttribute}`, message: `${this.zeebeName('taskSchedule')} of ${where} has ${dateAttribute}="${dateValue}", which is no ISO 8601 date-time with offset (2030-03-02T15:35+02:00); Camunda 8 refuses the file`, hint: this.fixHint(host, owner, zeebeElement, { [dateAttribute]: '2030-03-02T15:35+02:00' }).replace(/\.$/, ' (or an expression: =<FEEL>).') });
      }
    }
  }

  private checkHeaders(host: BpmnElement, owner: BpmnElement | undefined, headers: BpmnElement, inWhat: string, reporter: RuleReporter): void {
    const where = `${inWhat ? `${inWhat} of ` : ''}${this.describe(host, owner)}`;
    const seen = new Set<string>();
    this.kids(headers, 'header').forEach((header, index) => {
      const key = this.attr(header, 'key');
      const value = this.attr(header, 'value');
      if (this.blank(key) || this.blank(value)) {
        reporter.runtime({ code: 'W_C8_BAD_VALUE', element: host, owner, subject: `header:${inWhat}:${index}`, message: `Task header ${key ? `"${key}"` : index + 1} of ${where} has no ${this.blank(key) ? 'key' : 'value'}; Camunda 8 drops it, the job does not carry it`, hint: host.id && !inWhat ? `${this.blank(key) ? `Remove it (\`bpmn ext remove <file> ${host.id} ${ShellWords.quote(`${this.zeebeName('taskHeaders')}/${this.zeebeName('header')}[${index}]`)}\`) and add it with a key` : 'Give it a value'}: ${this.extAdd(host, owner, `${this.zeebeName('header')} key=${key ?? '<key>'} value=<value>`)}.` : 'Fix it in the XML.' });
      }
      if (key !== undefined && !this.blank(key)) {
        if (seen.has(key)) {
          reporter.deploy({ code: 'W_C8_DEPLOY_EXTENSION', element: host, owner, subject: `header:${inWhat}:dup:${key}`, message: `${where} has the task header "${key}" twice; Camunda 8 refuses the file`, hint: host.id && !inWhat ? `Keep one: \`bpmn ext remove <file> ${host.id} ${ShellWords.quote(`${this.zeebeName('taskHeaders')}/${this.zeebeName('header')}[${index}]`)}\`.` : 'Remove one in the XML.' });
        }
        seen.add(key);
      }
    });
  }
}
