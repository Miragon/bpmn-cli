import type { BpmnlintEngineReport } from '../bpmnlint-contract.js';
import { EngineFindings } from './EngineFindings.js';

/**
 * camunda-compat's rules that report a property of white space only as missing, where Camunda 8.9
 * deploys it (engine-checked): a job type, message, signal, process, decision or listener name, a
 * result variable, an error or escalation code thrown, a link name.
 */
const BLANK_PASSES = ['implementation', 'message-reference', 'signal-reference', 'called-element', 'execution-listener', 'error-reference', 'escalation-reference', 'link-event', 'variable-name'].map((rule) => `camunda-compat/${rule}`);
const COMPAT_TIMER = 'camunda-compat/timer';
const FLOW_CONDITION = 'camunda-compat/sequence-flow-condition';
/** camunda-compat says from 8.10 on; Camunda 8.9 deploys it (engine-checked). */
const JOB_PRIORITY = { rule: 'camunda-compat/no-job-priority-definition', since: [8, 9] };
const OWN_DUPLICATES = 'c8-duplicate-extension';
/** Reported on every element of a group; the engine refuses the second and later ones. */
const REPEATS = new Set(['camunda.elementMultipleNotAllowed', 'camunda.elementPropertyValueDuplicated']);

/**
 * Findings camunda-compat reports as refused at deploy that Camunda 8.9 deploys (engine-checked):
 * the flow out of an exclusive or inclusive gateway is never taken, a standard loop runs once.
 */
const DEPLOYS: Record<string, string> = {
  'camunda-compat/sequence-flow-condition': 'camunda.propertyRequired',
  'camunda-compat/loop-characteristics': 'camunda.propertyTypeNotAllowed',
};

type Results = Record<string, BpmnlintEngineReport[]>;

interface Node {
  id?: string;
  $parent?: Node;
  $instanceOf?: (type: string) => boolean;
  sourceRef?: Node;
}

/** Where camunda-compat's verdict on a Camunda 8 file is not the engine's, its reports are dropped or made runtime findings. */
export class CompatVerdicts {
  constructor(
    private readonly elementsById: Readonly<Record<string, unknown>>,
    private readonly version: string | undefined,
  ) {}

  apply(results: Results): void {
    const duplicated = new Set(Object.entries(results).flatMap(([rule, reports]) => reports.filter((report) => EngineFindings.findingOf(rule, report) === OWN_DUPLICATES).map((report) => report.id)));
    for (const [rule, reports] of Object.entries(results)) {
      if (!rule.startsWith('camunda-compat/')) continue;
      const kept = reports.filter((report) => !this.dropped(rule, report, duplicated));
      for (const report of kept) if (DEPLOYS[rule] === report.data?.type && report.category === 'error') report.category = 'warn';
      results[rule] = this.withoutFirstOfRepeats(kept);
    }
  }

  private dropped(rule: string, report: BpmnlintEngineReport, duplicated: ReadonlySet<string | undefined>): boolean {
    const type = report.data?.type;
    if (duplicated.has(report.id) || duplicated.has((report.data?.node as Node | undefined)?.id)) return true;
    if (BLANK_PASSES.includes(rule) && this.isBlank(report)) return true;
    if (rule === COMPAT_TIMER && type === 'camunda.expressionValueNotAllowed') return true;
    if (rule === FLOW_CONDITION && type === 'camunda.propertyNotAllowed') return this.leavesGateway(report);
    return rule === JOB_PRIORITY.rule && this.runsAtLeast(JOB_PRIORITY.since);
  }

  /** The first element of a group is the one the engine keeps: only the others are reported. */
  private withoutFirstOfRepeats(reports: BpmnlintEngineReport[]): BpmnlintEngineReport[] {
    const seen = new Set<string>();
    return reports.filter((report) => {
      if (!REPEATS.has(report.data?.type ?? '')) return true;
      const node = report.id ? (this.elementsById[report.id] as Node | undefined) : undefined;
      const group = `${report.data?.type}|${node?.$parent?.id ?? ''}|${String(report.data?.duplicatedPropertyValue ?? '')}`;
      if (seen.has(group)) return true;
      seen.add(group);
      return false;
    });
  }

  /** A condition on a flow out of a gateway is the structural W_CONDITION_IGNORED's. */
  private leavesGateway(report: BpmnlintEngineReport): boolean {
    const flow = report.id ? (this.elementsById[report.id] as Node | undefined) : undefined;
    return flow?.sourceRef?.$instanceOf?.('bpmn:Gateway') === true;
  }

  private runsAtLeast([major, minor]: number[]): boolean {
    const [fileMajor, fileMinor] = (this.version ?? '').split('.').map(Number);
    if (fileMajor === undefined || Number.isNaN(fileMajor) || fileMinor === undefined || Number.isNaN(fileMinor)) return true;
    return fileMajor !== major ? fileMajor > major! : fileMinor >= minor!;
  }

  private isBlank(report: BpmnlintEngineReport): boolean {
    let value: unknown = report.id ? this.elementsById[report.id] : undefined;
    for (const step of report.path ?? []) value = (value as Record<string | number, unknown> | undefined)?.[step];
    return typeof value === 'string' && value !== '' && value.trim() === '';
  }
}
