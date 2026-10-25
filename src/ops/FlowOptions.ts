import type { Doc } from '../model/Doc.js';
import { ChangeSet } from '../model/ChangeSet.js';
import type { El } from '../model/utils/moddle.js';
import { usageError } from '../shared/utils/errors.js';
import { SequenceFlows, type FlowAttrs } from './SequenceFlows.js';
import { defaultWithConditionViolation } from './utils/op-rules.js';
import type { ConnectOp, FlowOptions as FlowOptionValues } from './types.js';

const FLAGS: ReadonlyArray<readonly [keyof FlowOptionValues, string]> = [
  ['flowName', '--flow-name'],
  ['flowId', '--flow-id'],
  ['condition', '--condition'],
  ['language', '--language'],
  ['default', '--default'],
];

/** The options of the sequence flow an op creates or splices a node into. */
export class FlowOptions {
  constructor(private readonly values: FlowOptionValues) {}

  static of(source: FlowOptionValues): FlowOptionValues {
    const out: Record<string, unknown> = {};
    for (const [key] of FLAGS) if (source[key] !== undefined) out[key] = source[key];
    return out as FlowOptionValues;
  }

  get flags(): string[] {
    return FLAGS.filter(([key]) => this.values[key] !== undefined && this.values[key] !== false).map(([, flag]) => flag);
  }

  assertConsistent(details: { element?: string; related?: string[] } = {}): void {
    const violation = defaultWithConditionViolation(!!this.values.default, this.values.condition !== undefined, (field) => `--${field}`);
    if (violation) throw usageError(violation.message, { ...details, hint: violation.hint });
  }

  /** `keepEmptyCondition`: an empty condition stays, for SequenceFlows.create to refuse. */
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

  toConnect(): Pick<ConnectOp, 'id' | 'name' | 'condition' | 'language' | 'default'> {
    const { flowId, flowName, condition, language } = this.values;
    return {
      ...(flowId ? { id: flowId } : {}),
      ...(flowName ? { name: flowName } : {}),
      ...(condition !== undefined ? { condition } : {}),
      ...(language ? { language } : {}),
      ...(this.values.default ? { default: true } : {}),
    };
  }

  /** For an existing flow (the one into a spliced node); reported as changed when one was given. */
  apply(doc: Doc, flow: El, cs: ChangeSet): void {
    let touched = false;
    if (this.values.flowName !== undefined) {
      flow.set('name', this.values.flowName || undefined);
      touched = true;
    }
    if (this.values.condition !== undefined) {
      new SequenceFlows(doc).setCondition(flow, this.values.condition, this.values.language);
      touched = true;
    }
    if (this.values.default) {
      new SequenceFlows(doc).setDefault(flow, true);
      touched = true;
    }
    if (touched) cs.change(ChangeSet.flowEntryOf(flow));
  }
}
