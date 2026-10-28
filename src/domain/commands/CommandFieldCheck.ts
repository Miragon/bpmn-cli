import { BpmnError } from '../document/BpmnError.js';
import { kindByName, gatewayKindList, normalizeTrigger, parseKind, type Family } from '../document/Kinds.js';
import { commandUsageError, type CommandLocation } from './utils/command-location.js';
import { defaultWithConditionViolation, groupViolation, placementViolation } from './utils/op-rules.js';
import { FLOW_KEYS, PLACEMENT_KEYS, TRIGGER_KEYS } from './utils/op-fields.js';

export class CommandFieldCheck {
  constructor(
    readonly location: CommandLocation,
    readonly fields: Record<string, unknown>,
  ) {}

  fail(message: string, hint?: string, candidates?: string[]): BpmnError {
    return commandUsageError(this.location, message, hint, candidates);
  }

  quoted(field: string): string {
    return `"${field}"`;
  }

  present(keys: readonly string[]): string[] {
    return keys.filter((candidateKey) => this.fields[candidateKey] !== undefined);
  }

  placement(): void {
    const violation = placementViolation(this.present(PLACEMENT_KEYS), this.quoted);
    if (violation) throw this.fail(violation.message, violation.hint);
  }

  /** Flow options describe the flow INTO the node: they need a placement that creates one. */
  flowOptions(needsPlacement: boolean): void {
    const obj = this.fields;
    const conditionedDefault = defaultWithConditionViolation(obj['default'] === true, obj['condition'] !== undefined, this.quoted);
    if (conditionedDefault) throw this.fail(conditionedDefault.message, conditionedDefault.hint);
    if (!needsPlacement) return;
    const used = this.present([...FLOW_KEYS, 'flowAs']);
    const createsFlow = obj['after'] !== undefined || obj['before'] !== undefined || obj['flow'] !== undefined;
    if (used.length && !createsFlow) {
      throw this.fail(`${used.map((usedKey) => `"${usedKey}"`).join(', ')} describe the flow into the node and need "after", "before" or "flow"`, 'With "in" or "on" no sequence flow is created; connect the node afterwards with a connect op.');
    }
  }

  /**
   * Trigger options are only meaningful on events, except `message` on send and receive tasks.
   * `eventSubProcess:<trigger>` creates the event sub-process together with its start event, so its
   * trigger options are meaningful there: they configure the start event.
   */
  kind(expectFamily?: string): Family | undefined {
    const obj = this.fields;
    const kind = obj['kind'];
    if (typeof kind !== 'string') return;
    let family: Family;
    const eventSub = /^(eventSubProcess|eventSub|bpmn:eventSubProcess):(.+)$/i.exec(kind);
    if (eventSub) {
      const trigger = normalizeTrigger(eventSub[2]!);
      const allowed: string[] = (kindByName('startEvent')?.triggers ?? []).filter((startTrigger) => startTrigger !== 'none');
      if (!trigger || !allowed.includes(trigger)) {
        throw this.fail(`Trigger "${eventSub[2]}" is not allowed on eventSubProcess. Allowed: ${allowed.join(', ')}`, 'eventSubProcess:<trigger> creates the event sub-process with a startEvent:<trigger> inside, e.g. eventSubProcess:error with "error": "PaymentFailed".', allowed);
      }
      return 'subProcess';
    }
    try {
      family = parseKind(kind).def.family;
    } catch (err) {
      if (err instanceof BpmnError) throw this.fail(err.message, 'Run `bpmn kinds` for the list of kinds and triggers.', err.details.candidates ?? []);
      throw err;
    }
    if (expectFamily && family !== expectFamily) {
      throw this.fail(`"kind" must be a ${expectFamily} kind, "${kind}" is a ${family}`, expectFamily === 'gateway' ? `Use ${gatewayKindList()}.` : undefined);
    }
    const messageTask = ['sendTask', 'receiveTask'].includes(parseKind(kind).def.kind);
    const triggers = this.present(TRIGGER_KEYS).filter((triggerKey) => !(messageTask && triggerKey === 'message'));
    if (triggers.length && family !== 'event') {
      throw this.fail(`${triggers.map((triggerKey) => `"${triggerKey}"`).join(', ')} only apply to events, but "${kind}" is a ${family}`, 'Use an event kind such as startEvent:timer or boundaryEvent:message, or drop the trigger options.');
    }
    return family;
  }

  groups(groups: string[][], atLeastOne: string): void {
    const violation = groupViolation(this.present(groups.flat()), groups, this.quoted);
    if (violation) throw this.fail(violation.message, violation.hint);
    if (!this.present(groups.flat()).length) throw this.fail(atLeastOne);
  }

  hasSelector(): boolean {
    return this.present(['path', 'kind', 'branch']).length > 0;
  }

  selection(needed: boolean): void {
    const obj = this.fields;
    if (needed && obj['ids'] === undefined && !this.hasSelector()) throw this.fail('give "ids" and / or a selector ("path", "kind", "branch")', 'Example: {"op":"color","path":["Event_Start","Event_Done"],"color":"green"}.');
    const path = obj['path'] as string[] | undefined;
    if (path && path.length !== 2) throw this.fail(`"path" takes exactly two ids (from and to), got ${path.length}`, 'Example: "path": ["Event_Start", "Event_Done"], "via": ["Flow_Yes"].');
    if (obj['via'] !== undefined && !path) throw this.fail('"via" needs "path"');
  }
}
