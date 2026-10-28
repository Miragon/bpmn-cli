import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { CamundaAttributes } from './CamundaAttributes.js';

const BINDINGS = ['latest', 'deployment', 'version', 'versionTag'];
const CASE_BINDINGS = ['latest', 'deployment', 'version'];

/** What is wrong with a binding: a version it needs is missing, or the value is unknown. */
type BindingProblem = 'version' | 'versionTag' | 'value';

/**
 * A `camunda:*Binding` of a call activity or business rule task, which picks the version of the
 * process, case or decision it calls, with the attributes a binding of `version` or `versionTag`
 * needs.
 */
export class ReferenceBinding {
  private constructor(
    private readonly attributes: CamundaAttributes,
    readonly binding: string,
    readonly version: string,
    readonly versionTag: string | undefined,
    readonly allowed: string[],
  ) {}

  /** The bindings of `node` the engines read. */
  static forElement(node: ModdleElement): ReferenceBinding[] {
    const attributes = new CamundaAttributes(node);
    if (is(node, 'bpmn:CallActivity')) {
      return [
        new ReferenceBinding(
          attributes,
          'calledElementBinding',
          'calledElementVersion',
          'calledElementVersionTag',
          BINDINGS,
        ),
        new ReferenceBinding(attributes, 'caseBinding', 'caseVersion', undefined, CASE_BINDINGS),
      ];
    }
    if (is(node, 'bpmn:BusinessRuleTask') && attributes.defined('decisionRef') !== undefined) {
      return [
        new ReferenceBinding(
          attributes,
          'decisionRefBinding',
          'decisionRefVersion',
          'decisionRefVersionTag',
          BINDINGS,
        ),
      ];
    }
    return [];
  }

  get value(): string | undefined {
    return this.attributes.defined(this.binding);
  }

  get problem(): BindingProblem | undefined {
    const value = this.value;
    if (value === undefined) {
      return undefined;
    }
    if (value === 'version' && this.attributes.any(this.version) === undefined) {
      return 'version';
    }
    if (
      value === 'versionTag' &&
      this.versionTag &&
      this.attributes.any(this.versionTag) === undefined
    ) {
      return 'versionTag';
    }
    return this.allowed.includes(value) ? undefined : 'value';
  }
}
