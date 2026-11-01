import { BpmnError, type Family, KindParser, Kinds } from '../../model/index.js';
import type { OperationLocation } from './OperationLocation.js';

export class OperationCheck {
  static readonly PLACEMENT_KEYS = ['after', 'before', 'flow', 'in', 'on'];

  constructor(
    private readonly location: OperationLocation,
    readonly fields: Record<string, unknown>,
  ) {}

  static quoted(keys: readonly string[], separator = ', '): string {
    return keys.map((key) => `"${key}"`).join(separator);
  }

  fail(message: string, hint?: string, candidates?: string[]): BpmnError {
    return this.location.refusal(message, hint, candidates);
  }

  present(keys: readonly string[]): string[] {
    return keys.filter((key) => this.fields[key] !== undefined);
  }

  placement(): void {
    const used = this.present(OperationCheck.PLACEMENT_KEYS);
    if (used.length > 1 && used.join() !== 'after,before') {
      throw this.fail(`${OperationCheck.quoted(used, ' and ')} cannot be combined`, 'Use exactly one placement: "after", "before", "after" + "before" (splice into that flow), "flow", "in", or "on" (boundary events).');
    }
  }

  defaultFlow(holder: Record<string, unknown> = this.fields): void {
    if (String(holder['default']) === 'true' && holder['condition'] !== undefined) {
      throw this.fail('"default" and "condition" are mutually exclusive: a default flow has no condition', 'Keep the condition on the other branches and mark this one as default.');
    }
  }

  flowIntoNode(): void {
    this.defaultFlow();
    const used = this.present(['flowName', 'flowId', 'condition', 'language', 'default', 'flowAs']);
    if (used.length && !this.present(['after', 'before', 'flow']).length) {
      throw this.fail(`${OperationCheck.quoted(used)} describe the flow into the node and need "after", "before" or "flow"`, 'With "in" or "on" no sequence flow is created; connect the node afterwards with a connect op.');
    }
  }

  kind(expectFamily?: Family): Family | undefined {
    const { kind } = this.fields;
    if (typeof kind !== 'string') {
      return undefined;
    }
    const family = this.familyOf(kind);
    if (expectFamily && family !== expectFamily) {
      throw this.fail(`"kind" must be a ${expectFamily} kind, "${kind}" is a ${family}`, `Use ${Kinds.gatewayList()}.`);
    }
    return family;
  }

  groups(groups: string[][], nothingToDo: string): void {
    for (const group of groups) {
      const used = this.present(group);
      if (used.length > 1) {
        throw this.fail(`${OperationCheck.quoted(used, ' and ')} cannot be combined`, `Give at most one of ${OperationCheck.quoted(group)}.`);
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
      throw this.fail('give "ids" and / or a selector ("path", "branch")', 'Example: {"op":"color","path":["startEvent_start","endEvent_done"],"color":"green"}.');
    }
    const path = this.fields['path'] as string[] | undefined;
    if (path && path.length !== 2) {
      throw this.fail(`"path" takes exactly two ids (from and to), got ${path.length}`, 'Example: "path": ["startEvent_start", "endEvent_done"].');
    }
  }

  private familyOf(kind: string): Family {
    try {
      return KindParser.parseToAdd(kind).def.family;
    } catch (error) {
      if (error instanceof BpmnError) {
        throw this.fail(error.message, 'Run `bpmn guide kinds` for the list of kinds and triggers.', error.details.candidates ?? []);
      }
      throw error;
    }
  }
}
