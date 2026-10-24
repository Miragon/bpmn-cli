/**
 * The options of the sequence flow an op creates or splices a node into
 * (`flowName`, `flowId`, `condition`, `language`, `default`; on the CLI
 * --flow-name, --flow-id, --condition, --language, --default).
 */
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

export class FlowOptions {
  constructor(private readonly values: FlowOptionValues) {}

  /** The flow options `source` defines (a split branch, one of its nodes). */
  static of(source: FlowOptionValues): FlowOptionValues {
    const out: Record<string, unknown> = {};
    for (const [key] of FLAGS) if (source[key] !== undefined) out[key] = source[key];
    return out as FlowOptionValues;
  }

  /** The flags of the options given, in the order of the CLI. */
  get flags(): string[] {
    return FLAGS.filter(([key]) => this.values[key] !== undefined && this.values[key] !== false).map(([, flag]) => flag);
  }

  /** E_USAGE for --default together with --condition (a default flow has no condition); `details` go into the error. */
  assertConsistent(details: { element?: string; related?: string[] } = {}): void {
    const violation = defaultWithConditionViolation(!!this.values.default, this.values.condition !== undefined, (field) => `--${field}`);
    if (violation) throw usageError(violation.message, { ...details, hint: violation.hint });
  }

  /** The attributes of the flow they create; `keepEmptyCondition`: an empty condition stays, for SequenceFlows.create to refuse. */
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

  /** The fields of a connect that creates such a flow. */
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

  /** Name, condition and default on an existing flow (the flow into a spliced node), reported as changed when one was given. */
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
