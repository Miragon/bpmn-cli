import { type BpmnElement, ChangeEntries, type ChangeSet } from '../../model/index.js';
import type { ConnectOperation } from '../../operations/index.js';
import type { EditSession } from '../session/EditSession.js';
import { FlowConditions } from './FlowConditions.js';
import type { FlowAttrs } from './SequenceFlows.js';

export interface FlowOptionValues {
  flowName?: string | undefined;
  flowId?: string | undefined;
  condition?: string | undefined;
  language?: string | undefined;
  default?: boolean | undefined;
}

export class FlowOptions {
  private static readonly FLAGS: ReadonlyArray<readonly [keyof FlowOptionValues, string]> = [
    ['flowName', '--flow-name'],
    ['flowId', '--flow-id'],
    ['condition', '--condition'],
    ['language', '--language'],
    ['default', '--default'],
  ];

  constructor(private readonly values: FlowOptionValues) {}

  static of(source: FlowOptionValues): FlowOptionValues {
    const out: Record<string, unknown> = {};
    for (const [key] of FlowOptions.FLAGS) {
      if (source[key] !== undefined) {
        out[key] = source[key];
      }
    }
    return out as FlowOptionValues;
  }

  get flags(): string[] {
    return FlowOptions.FLAGS.filter(([key]) => this.values[key] !== undefined && this.values[key] !== false).map(([, flag]) => flag);
  }

  toAttrs(keepEmptyCondition = false): FlowAttrs {
    const { flowId, flowName, condition, language } = this.values;
    return {
      ...(flowId ? { id: flowId } : {}),
      ...(flowName ? { name: flowName } : {}),
      ...(condition || (keepEmptyCondition && condition !== undefined) ? { condition } : {}),
      ...(language ? { language } : {}),
      ...(this.values.default ? { isDefault: true } : {}),
    };
  }

  toConnect(): Pick<ConnectOperation, 'id' | 'set'> {
    const { flowId, flowName, condition, language } = this.values;
    const keys = {
      ...(flowName ? { name: flowName } : {}),
      ...(condition !== undefined ? { condition } : {}),
      ...(language ? { language } : {}),
      ...(this.values.default ? { default: 'true' } : {}),
    };
    return { ...(flowId ? { id: flowId } : {}), ...(Object.keys(keys).length ? { set: keys } : {}) };
  }

  apply(edit: EditSession, flow: BpmnElement, changes: ChangeSet): void {
    let touched = false;
    if (this.values.flowName !== undefined) {
      flow.set('name', this.values.flowName || undefined);
      touched = true;
    }
    if (this.values.condition !== undefined) {
      new FlowConditions(edit).setCondition(flow, this.values.condition, this.values.language);
      touched = true;
    }
    if (this.values.default) {
      new FlowConditions(edit).setDefault(flow, true);
      touched = true;
    }
    if (touched) {
      changes.change(ChangeEntries.ofFlow(flow));
    }
  }
}
