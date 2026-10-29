import type { Doc } from '../../../../../domain/document/Doc.js';
import type { EnginePlatformInfo } from '../../../../../domain/validation/EngineLint.js';
import type { RuleEntry } from '@miragon/bpmnlint-plugin-rules/engine';
import type { BpmnlintEngineReport } from '../../bpmnlint-contract.js';
import type { EngineKit } from '../../engine-kit.js';
import { EngineFindings } from './EngineFindings.js';

type Engine = EnginePlatformInfo['platform'];

/**
 * Where bpmn-cli reads camunda-compat's severity differently: a user task needs no form to run,
 * and a job worker user task works (the engines' layers would say runtime for both); Camunda 7.20+
 * refuses a process without a history time to live unless the engine sets a default.
 * c8-feel-expression checks FEEL with the grammar Camunda 8 accepts, names and values without = too.
 */
const SEVERITY_OVERRIDES: Record<Engine, Record<string, RuleEntry['category'] | 'off'>> = {
  c7: { 'camunda-compat/history-time-to-live': 'error' },
  c8: {
    'camunda-compat/feel': 'off',
    'camunda-compat/user-task-definition': 'off',
    'camunda-compat/zeebe-user-task': 'info',
  },
};

/** Rules of camunda-compat's configs that do not skip the processes the engine does not run. */
const EXECUTABLE_ONLY = ['bpmnlint/start-event-required', 'camunda-compat/history-time-to-live'];
/** It reports a send task with a zeebe:publishMessage as one without an implementation. */
const COMPAT_IMPLEMENTATION = 'camunda-compat/implementation';
const PUBLISH_MESSAGE = 'bpmn-cli/c8-publish-message';

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

type Results = Record<string, BpmnlintEngineReport[]>;

interface Node {
  id?: string;
  $parent?: Node;
  $instanceOf?: (type: string) => boolean;
  sourceRef?: Node;
}

/** Where camunda-compat's verdict is not the engine's: its rules at bpmn-cli's severity, its reports dropped. */
export class CompatVerdicts {
  constructor(
    private readonly kit: EngineKit,
    private readonly engine: Engine,
    private readonly doc: Doc,
    private readonly elementsById: Readonly<Record<string, unknown>>,
    private readonly version: string | undefined,
  ) {}

  /** The rules at bpmn-cli's category where it reads camunda-compat's differently, without the ones it turns off. */
  rules(entries: RuleEntry[]): RuleEntry[] {
    const overrides = SEVERITY_OVERRIDES[this.engine];
    return entries.flatMap((entry) => {
      const category = overrides[entry.name];
      if (!category) return [entry];
      return category === 'off' ? [] : [{ ...entry, category }];
    });
  }

  apply(results: Results): void {
    this.withoutNonExecutableProcesses(results);
    if (this.engine !== 'c8') return;
    const published = new Set(results[PUBLISH_MESSAGE]?.map((report) => report.id));
    const implementations = results[COMPAT_IMPLEMENTATION];
    if (implementations) results[COMPAT_IMPLEMENTATION] = implementations.filter((report) => !report.id || !published.has(report.id));
    const duplicated = new Set(Object.entries(results).flatMap(([rule, reports]) => reports.filter((report) => EngineFindings.findingOf(rule, report) === OWN_DUPLICATES).map((report) => report.id)));
    for (const [rule, reports] of Object.entries(results)) {
      if (!rule.startsWith('camunda-compat/')) continue;
      results[rule] = this.withoutFirstOfRepeats(reports.filter((report) => !this.dropped(rule, report, duplicated)));
    }
  }

  /** The engines check executable processes only: a missing start event or history time to live elsewhere is no finding. */
  private withoutNonExecutableProcesses(results: Results): void {
    for (const rule of EXECUTABLE_ONLY) {
      const reports = results[rule];
      if (!reports) continue;
      results[rule] = reports.filter((report) => {
        let el = report.id ? this.doc.get(report.id) : undefined;
        while (el && !this.kit.is(el, 'bpmn:Process')) el = el.$parent as typeof el;
        return !el || this.kit.peek<boolean>(el, 'isExecutable') === true;
      });
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
