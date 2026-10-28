import { camunda7 } from '@miragon/bpmnlint-plugin-rules/camunda-7';
import type { EngineKit } from '../../../engine-kit.js';
import type { EngineEntry } from '../../EngineRun.js';
import { ElementKinds } from '../describe.js';
import { C7Diagram } from './C7Diagram.js';
import { CamundaDescriptor } from './extensions/CamundaDescriptor.js';
import c7DefinitionsExtension from './c7-definitions-extension.js';
import c7EventGateway from './c7-event-gateway.js';
import c7ExclusiveGateway from './c7-exclusive-gateway.js';
import c7ImplicitDefaultFlow from './c7-implicit-default-flow.js';
import c7ComplexGateway from './c7-complex-gateway.js';
import c7AdHocSubProcess from './c7-ad-hoc-sub-process.js';
import c7EmptyCondition from './c7-empty-condition.js';
import c7Implementation from './c7-implementation.js';
import c7HistoryTimeToLive from './c7-history-time-to-live.js';
import c7AttributeValue from './c7-attribute-value.js';
import c7MessageImplementation from './c7-message-implementation.js';
import c7ExternalTopic from './c7-external-topic.js';
import c7BadValue from './c7-bad-value.js';
import c7ResultVariable from './c7-result-variable.js';
import c7BindingVersion from './c7-binding-version.js';
import c7CalledElement from './c7-called-element.js';
import c7Form from './c7-form.js';
import c7MultiInstance from './c7-multi-instance.js';
import c7Script from './c7-script.js';
import c7BoundaryHost from './c7-boundary-host.js';
import c7EventDefinition from './c7-event-definition.js';
import c7LinkEvent from './c7-link-event.js';
import c7MultipleEventDefinitions from './c7-multiple-event-definitions.js';
import c7Message from './c7-message.js';
import c7Signal from './c7-signal.js';
import c7Error from './c7-error.js';
import c7Escalation from './c7-escalation.js';
import c7StartEvent from './c7-start-event.js';
import c7TransactionStart from './c7-transaction-start.js';
import c7Extension from './c7-extension.js';
import c7Listener from './c7-listener.js';
import c7InputOutput from './c7-input-output.js';
import c7DuplicateExtension from './c7-duplicate-extension.js';
import c7AsyncDuplicateExtension from './c7-async-duplicate-extension.js';
import c7ForeignContent from './c7-foreign-content.js';
import c7UnknownAttribute from './c7-unknown-attribute.js';
import c7MisplacedAttribute from './c7-misplaced-attribute.js';
import c7MisplacedExtension from './c7-misplaced-extension.js';
import c7DanglingReference from './c7-dangling-reference.js';

/** bpmn-cli's Camunda 7 rules: the checks camunda-compat's `camunda-platform-7-*` configs leave out. */
export class Camunda7Rules {
  static readonly RULES = [c7DefinitionsExtension, c7EventGateway, c7ExclusiveGateway, c7ImplicitDefaultFlow, c7ComplexGateway, c7AdHocSubProcess, c7EmptyCondition, c7Implementation, c7HistoryTimeToLive, c7AttributeValue, c7MessageImplementation, c7ExternalTopic, c7BadValue, c7ResultVariable, c7BindingVersion, c7CalledElement, c7Form, c7MultiInstance, c7Script, c7BoundaryHost, c7EventDefinition, c7LinkEvent, c7MultipleEventDefinitions, c7Message, c7Signal, c7Error, c7Escalation, c7StartEvent, c7TransactionStart, c7Extension, c7Listener, c7InputOutput, c7DuplicateExtension, c7AsyncDuplicateExtension, c7ForeignContent, c7UnknownAttribute, c7MisplacedAttribute, c7MisplacedExtension, c7DanglingReference];

  /** camunda-compat's lint for Camunda 7 with these rules, as `bpmn-cli/<rule>`. */
  static lint(kit: EngineKit): EngineEntry {
    ElementKinds.use(kit.kindLabel);
    CamundaDescriptor.use(kit.CAMUNDA_DESCRIPTOR);
    const lint = camunda7.withRules('bpmn-cli', Camunda7Rules.RULES);
    return {
      createResolver: () => lint.createResolver(),
      lintConfig: (version) => lint.lintConfig(version),
      afterParse: (definitions, warnings, vendor) => C7Diagram.record(definitions, vendor, warnings),
    };
  }
}
