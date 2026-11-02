import { BpmnError, type Family, KindParser, Kinds } from '../../model/index.js';
import type { OperationLocation } from './OperationLocation.js';
import { RefusalWording, type Wording } from './RefusalWording.js';

export class OperationCheck {
  static readonly PLACEMENT_KEYS = ['after', 'before', 'flow', 'in', 'on'];

  constructor(
    private readonly location: OperationLocation,
    readonly fields: Record<string, unknown>,
  ) {}

  fail(message: Wording, hint?: Wording, candidates?: string[], commandCode?: string): BpmnError {
    return this.location.refusal(message, hint, candidates, commandCode);
  }

  present(keys: readonly string[]): string[] {
    return keys.filter((key) => this.fields[key] !== undefined);
  }

  placement(): void {
    const used = this.present(OperationCheck.PLACEMENT_KEYS);
    if (used.length > 1 && used.join() !== 'after,before') {
      throw this.fail((key) => `${used.map(key).join(' and ')} cannot be combined`, (key) => `Use exactly one placement: ${key('after')}, ${key('before')}, ${key('after')} + ${key('before')} (splice into that flow), ${key('flow')}, ${key('in')}, or ${key('on')} (boundary events).`);
    }
  }

  defaultFlow(holder: Record<string, unknown> = this.fields): void {
    if (String(holder['default']) === 'true' && holder['condition'] !== undefined) {
      throw this.fail((key) => `${key('default')} and ${key('condition')} are mutually exclusive: a default flow has no condition`, 'Keep the condition on the other branches and mark this one as default.');
    }
  }

  flowIntoNode(): void {
    this.defaultFlow();
    const used = this.present(['flowName', 'flowId', 'condition', 'language', 'default', 'flowAs']);
    if (used.length && !this.present(['after', 'before', 'flow']).length) {
      throw this.fail((key) => `${used.map(key).join(', ')} describe the flow into the node and need ${key('after')}, ${key('before')} or ${key('flow')}`, (key) => `With ${key('in')} or ${key('on')} no sequence flow is created; connect the node afterwards with a connect op.`);
    }
  }

  kind(expectFamily?: Family): Family | undefined {
    const { kind } = this.fields;
    if (typeof kind !== 'string') {
      return undefined;
    }
    const family = this.familyOf(kind);
    if (expectFamily && family !== expectFamily) {
      throw this.fail((key) => `${key('kind')} must be a ${expectFamily} kind, "${kind}" is a ${family}`, `Use ${Kinds.gatewayList()}.`);
    }
    return family;
  }

  groups(groups: string[][], nothingToDo: Wording): void {
    for (const group of groups) {
      const used = this.present(group);
      if (used.length > 1) {
        throw this.fail((key) => `${used.map(key).join(' and ')} cannot be combined`, (key) => `Give at most one of ${group.map(key).join(', ')}.`);
      }
    }
    if (!this.present(groups.flat()).length) {
      throw this.fail(nothingToDo);
    }
  }

  hasSelector(): boolean {
    return this.present(['path', 'branch']).length > 0;
  }

  selection(): void {
    if (this.fields['ids'] === undefined && !this.hasSelector()) {
      throw this.fail((key) => `give ${key('ids')} and / or a selector (${key('path')}, ${key('branch')})`, RefusalWording.onlyInBatch('Example: {"op":"color","path":["startEvent_start","endEvent_done"],"color":"green"}.'));
    }
    const path = this.fields['path'] as string[] | undefined;
    if (path && path.length !== 2) {
      throw this.fail((key) => `${key('path')} takes exactly two ids (from and to), got ${path.length}`, RefusalWording.onlyInBatch('Example: "path": ["startEvent_start", "endEvent_done"].'));
    }
  }

  private familyOf(kind: string): Family {
    try {
      return KindParser.parseToAdd(kind).def.family;
    } catch (error) {
      if (error instanceof BpmnError) {
        throw this.fail(error.message, 'Run `bpmn guide kinds` for the list of kinds and triggers.', error.details.candidates ?? [], error.code);
      }
      throw error;
    }
  }
}
