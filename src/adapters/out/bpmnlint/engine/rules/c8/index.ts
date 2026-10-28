import { camunda8 } from '@miragon/bpmnlint-plugin-rules/camunda-8';
import type { EngineKit } from '../../../engine-kit.js';
import type { EngineEntry } from '../../EngineRun.js';
import { ElementKinds } from '../describe.js';
import { ZeebeSchema } from './extensions/ZeebeSchema.js';
import c8BoundaryHost from './c8-boundary-host.js';
import c8EventDefinition from './c8-event-definition.js';
import c8LinkEvent from './c8-link-event.js';
import c8AdHocSubProcess from './c8-ad-hoc-sub-process.js';
import c8EventGateway from './c8-event-gateway.js';
import c8Message from './c8-message.js';
import c8Signal from './c8-signal.js';
import c8Error from './c8-error.js';
import c8StartEvent from './c8-start-event.js';
import c8FeelExpression from './c8-feel-expression.js';
import c8FeelCompletionCondition from './c8-feel-completion-condition.js';
import c8Implementation from './c8-implementation.js';
import c8BadValue from './c8-bad-value.js';
import c8Schema from './c8-schema.js';
import c8Listener from './c8-listener.js';
import c8Extension from './c8-extension.js';
import c8DuplicateExtension from './c8-duplicate-extension.js';
import c8ForeignContent from './c8-foreign-content.js';
import c8UnknownAttribute from './c8-unknown-attribute.js';
import c8MisplacedAttribute from './c8-misplaced-attribute.js';
import c8MisplacedExtension from './c8-misplaced-extension.js';
import c8TimerValue from './c8-timer-value.js';

/** bpmn-cli's Camunda 8 rules: the checks camunda-compat's `camunda-cloud-8-*` configs leave out. */
export class Camunda8Rules {
  static readonly RULES = [c8BoundaryHost, c8EventDefinition, c8LinkEvent, c8AdHocSubProcess, c8EventGateway, c8Message, c8Signal, c8Error, c8StartEvent, c8FeelExpression, c8FeelCompletionCondition, c8Implementation, c8BadValue, c8Schema, c8Listener, c8Extension, c8DuplicateExtension, c8ForeignContent, c8UnknownAttribute, c8MisplacedAttribute, c8MisplacedExtension, c8TimerValue];

  /** camunda-compat's lint for Camunda 8 with these rules, as `bpmn-cli/<rule>`. */
  static lint(kit: EngineKit): EngineEntry {
    ElementKinds.use(kit.kindLabel);
    ZeebeSchema.use(kit.ZEEBE_DESCRIPTOR);
    return camunda8.withRules('bpmn-cli', Camunda8Rules.RULES);
  }
}
