import { defineRule as declareRule, EngineRule, type DeclaredRuleFactory, type Engine, type ModdleElement, type Reporter, type ReportPath, type RuleDeclaration } from '@miragon/bpmnlint-plugin-rules/engine';
import { reportErrors } from 'bpmnlint-plugin-camunda-compat/rules/utils/reporter.js';

export type { ModdleElement, Reporter, ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';
export { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

/** What the engine does with a file the rule reports: refuses it, fails or ignores a setting when it runs, or runs it other than a reader expects. */
export type Impact = 'deploy' | 'runtime' | 'practice';

/** The findings a rule reports (`data.finding`, else the rule's name), each with its bpmn-cli code and impact. */
export type Findings = Readonly<Record<string, readonly [code: string, impact: Impact]>>;

/** A bpmn-cli engine rule: the plugin's rule factory and the findings it reports. */
export type CamundaRuleFactory = DeclaredRuleFactory & { findings: Findings };

/** The plugin's `defineRule` with the rule's findings, from which bpmn-cli takes codes, severities and the category. */
export function defineRule<const Name extends string>(declaration: RuleDeclaration<Name> & { findings: Findings }, RuleClass: new (config?: object) => EngineRule): CamundaRuleFactory {
  const { findings, ...rest } = declaration;
  return Object.assign(declareRule(rest, RuleClass), { findings });
}

/** What a report says besides its message: camunda-compat's `path` and `data.type`, the fix, the element holding the property (the reported one unless given) and the elements it names. */
export interface ReportData {
  path: ReportPath | null;
  type: string;
  hint?: string;
  node?: ModdleElement;
  [detail: string]: unknown;
}

/** A bpmn-cli engine rule: every report in camunda-compat's shape, with the finding it is in `data.finding`. */
export abstract class CamundaRule extends EngineRule {
  private reporter!: Reporter;

  protected checkElement(node: ModdleElement, reporter: Reporter): boolean | void {
    this.reporter = reporter;
    return this.visit(node);
  }

  protected abstract visit(node: ModdleElement): boolean | void;

  protected report(finding: string, at: ModdleElement, message: string, { path, ...data }: ReportData): void {
    const node = data.node ?? at;
    reportErrors(at, this.reporter, { message, path, data: { ...data, node, parentNode: node === at ? null : at, finding } });
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
