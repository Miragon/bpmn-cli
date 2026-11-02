import { defineRule as declareRule, EngineRule, type DeclaredRuleFactory, type Engine, type ModdleElement, type Reporter, type ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';
import { reportErrors } from 'bpmnlint-plugin-camunda-compat/rules/utils/reporter.js';
import type { VendorHost } from './support/VendorHost.js';

export type { ModdleElement, ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';
export { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

/** What the engine does with a file the rule reports: refuses it, fails or ignores a setting when it runs, or runs it other than a reader expects. */
export type Impact = 'deploy' | 'runtime' | 'practice';

/** The bpmn-cli code a rule reports and its impact. */
export interface RuleCode {
  code: string;
  impact: Impact;
}

/** A bpmn-cli engine rule: the plugin's rule factory with the code and impact of its findings. */
export type CamundaRuleFactory = DeclaredRuleFactory & RuleCode;

/** The plugin's `defineRule` of an engine-specific rule for the engine its name starts with, with the code and impact from which bpmn-cli takes the finding's code, its severity and the rule's category. */
export function defineRule<const Name extends `${Engine}-${string}`>({ ruleName, code, impact }: { ruleName: Name } & RuleCode, RuleClass: new (config?: object) => EngineRule): CamundaRuleFactory {
  return Object.assign(declareRule({ ruleName, kind: 'engine-specific', targetEngine: ruleName.slice(0, 2) as Engine }, RuleClass), { code, impact });
}

/** What a report says besides its message: camunda-compat's `path` and `data.type`, the fix, the element holding the property (the reported one unless given) and the elements it names. */
export interface ReportData {
  path: ReportPath | null;
  type: string;
  hint?: string;
  node?: ModdleElement;
  [detail: string]: unknown;
}

/**
 * The base of every bpmn-cli engine rule. A rule implements `visit(node)`, which the plugin's
 * single walk calls for each element (return false to skip its children), and reports through
 * `report(at, message, data)`.
 * Every report has camunda-compat's shape (`path`, `data.type`), so `run/` maps own and compat
 * findings alike; bpmn-cli takes its code and severity from what the rule declares in `defineRule`.
 */
export abstract class CamundaRule extends EngineRule {
  private reporter!: Reporter;

  protected checkElement(node: ModdleElement, reporter: Reporter): boolean | void {
    this.reporter = reporter;
    return this.visit(node);
  }

  protected abstract visit(node: ModdleElement): boolean | void;

  protected report(at: ModdleElement, message: string, { path, ...data }: ReportData): void {
    const node = data.node ?? at;
    reportErrors(at, this.reporter, { message, path, data: { ...data, node, parentNode: node === at ? null : at } });
  }

  /** A finding on the element a finding about `host` lands on. */
  protected reportOn(host: VendorHost, message: string, data: ReportData): void {
    this.report(host.target, message, data);
  }
}

/** A rule that checks the diagrams targeting Camunda 7. */
export abstract class C7Rule extends CamundaRule {
  protected readonly engine: Engine = 'c7';
}

/** A rule that checks the diagrams targeting Camunda 8. */
export abstract class C8Rule extends CamundaRule {
  protected readonly engine: Engine = 'c8';
}
