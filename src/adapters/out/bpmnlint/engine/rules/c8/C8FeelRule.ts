import { is } from 'bpmnlint-utils';
import { C8Rule, type ModdleElement, type ReportPath } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';
import { ModdlePath } from '../support/ModdlePath.js';
import { Shell } from '../support/Shell.js';
import { Values } from '../support/Values.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';
import { FeelExpression } from './support/feel/FeelExpression.js';

/**
 * Where a value sits: the element reported on, the element holding the property, and the path;
 * `related` is another element the finding names (the message of a correlation key).
 */
export interface ValueSite {
  owner: ModdleElement;
  holder: ModdleElement;
  property: string;
  path: ReportPath;
  related?: ModdleElement;
}

/** A condition Camunda 8 evaluates as FEEL, with the fixes for an invalid and for a static one. */
export interface FeelCondition {
  site: ValueSite;
  what: string;
  label: string;
  body: string;
  invalidHint: string;
  notFeelHint: string;
}

/**
 * The values Camunda 8 parses as FEEL, for the rules on them (`C8FeelExpressionValidRule`,
 * `C8ConditionNeedsFeelRule`, `C8MultiInstanceNeedsFeelRule`, `C8ScriptNeedsFeelRule`,
 * `C8CorrelationKeyNeedsFeelRule`): where a value sits, the conditions of an element and how a
 * finding on a value is reported.
 * Camunda 8 parses them at deploy and refuses the file.
 *
 * @example a Camunda 7 (JUEL) condition
 * <bpmn:conditionExpression>${amount > 1000}</bpmn:conditionExpression>  <!-- FEEL: =amount > 1000 -->
 */
export abstract class C8FeelRule extends C8Rule {
  /** An element Camunda 8 runs whose values it parses: a transaction is no Camunda 8 element. */
  protected runs(node: ModdleElement): boolean {
    return EngineScope.C8.runs(node) && !is(node, 'bpmn:Transaction');
  }

  /** The condition of a sequence flow, the completion condition of an ad-hoc sub-process, the condition of a conditional event. */
  protected conditionOf(node: ModdleElement): FeelCondition | undefined {
    if (is(node, 'bpmn:SequenceFlow') || is(node, 'bpmn:AdHocSubProcess')) {
      return this.flowConditionOf(node);
    }
    const definition = is(node, 'bpmn:Event') ? C8EventDefinitions.definitionOf(node) : undefined;
    const condition = definition && is(definition, 'bpmn:ConditionalEventDefinition') ? definition.condition : undefined;
    if (!condition) return undefined;
    const body: string = condition.body ?? '';
    const fix = (expression: string) => `\`bpmn set <file> ${node.id} ${Shell.quote(`when==${FeelExpression.fromJuel(expression)}`)}\` (check the FEEL syntax).`;
    return { site: this.siteOf(node, definition, 'condition'), what: 'condition', label: `conditional event ${node.id}`, body, invalidHint: fix(body.trim().slice(1)), notFeelHint: fix(body) };
  }

  private flowConditionOf(node: ModdleElement): FeelCondition | undefined {
    const flow = is(node, 'bpmn:SequenceFlow');
    const condition = flow ? node.conditionExpression : node.completionCondition;
    if (!condition) return undefined;
    const property = flow ? 'conditionExpression' : 'completionCondition';
    const body: string = condition.body ?? '';
    const id = node.id;
    const site = { owner: node, holder: node, property, path: [property] };
    if (flow) {
      const invalidHint = `\`bpmn set <file> ${id} ${Shell.quote(`condition==${FeelExpression.fromJuel(body.trim().slice(1))}`)}\` (check the FEEL syntax: and / or, = for equality, not(...)).`;
      const notFeelHint = body.trim() ? `\`bpmn set <file> ${id} ${Shell.quote(`condition==${FeelExpression.fromJuel(body)}`)}\` (check the FEEL syntax: and / or, = for equality).` : `Give it one (\`bpmn set <file> ${id} ${Shell.quote('condition== <expression>')}\`) or remove it (\`bpmn set <file> ${id} condition=\`).`;
      return { site, what: 'condition', label: `sequence flow ${id}`, body, invalidHint, notFeelHint };
    }
    const fix = `\`bpmn set <file> ${id} ${Shell.quote(`completion==${FeelExpression.fromJuel(Values.isFeel(body) ? body.trim().slice(1) : body)}`)}\` (check the FEEL syntax)`;
    return { site, what: 'completion condition', label: `ad-hoc sub-process ${id}`, body, invalidHint: `${fix}.`, notFeelHint: `${fix}, or remove it: \`bpmn set <file> ${id} completion=\`.` };
  }

  protected siteOf(owner: ModdleElement, holder: ModdleElement, property: string): ValueSite {
    return { owner, holder, property, path: [...ModdlePath.between(owner, holder), property] };
  }

  protected reportAt({ owner, holder, property, path, related }: ValueSite, message: string, type: string, hint: string): void {
    this.report(owner, message, { path, type, node: holder, property, ...(related ? { related } : {}), hint });
  }
}
