import { compatRules, moddleExtensions } from '@miragon/bpmnlint-plugin-rules/camunda-7';
import type { EngineKit } from '../../../engine-kit.js';
import type { EngineEntry } from '../../run/EngineRun.js';
import { RuleEntries } from '../RuleEntries.js';
import { C7Diagram } from './support/C7Diagram.js';
import c7EventGatewayTargetAllowed from './C7EventGatewayTargetAllowedRule.js';
import c7EventGatewayBranchesUnique from './C7EventGatewayBranchesUniqueRule.js';
import c7ExclusiveGatewayNeedsOutgoing from './C7ExclusiveGatewayNeedsOutgoingRule.js';
import c7ExclusiveGatewayDefaultNoCondition from './C7ExclusiveGatewayDefaultNoConditionRule.js';
import c7ExclusiveGatewayNeedsDefault from './C7ExclusiveGatewayNeedsDefaultRule.js';
import c7ExclusiveGatewayNeedsConditions from './C7ExclusiveGatewayNeedsConditionsRule.js';
import c7ComplexGatewayNoFlows from './C7ComplexGatewayNoFlowsRule.js';
import c7AdHocSubProcessNoFlows from './C7AdHocSubProcessNoFlowsRule.js';
import c7AdHocSubProcessNoMultiInstance from './C7AdHocSubProcessNoMultiInstanceRule.js';
import c7ScopeNeedsStartEvent from './C7ScopeNeedsStartEventRule.js';
import c7TransactionNeedsStartEvent from './C7TransactionNeedsStartEventRule.js';
import c7StartEventUnique from './C7StartEventUniqueRule.js';
import c7TaskTypeSupported from './C7TaskTypeSupportedRule.js';
import c7ShellTaskNeedsCommand from './C7ShellTaskNeedsCommandRule.js';
import c7ShellFieldValuesFixed from './C7ShellFieldValuesFixedRule.js';
import c7TaskNeedsImplementation from './C7TaskNeedsImplementationRule.js';
import c7MessageThrowNeedsImplementation from './C7MessageThrowNeedsImplementationRule.js';
import c7ExternalTaskNeedsTopic from './C7ExternalTaskNeedsTopicRule.js';
import c7ResultVariableNeedsExpression from './C7ResultVariableNeedsExpressionRule.js';
import c7ScriptTaskNeedsScript from './C7ScriptTaskNeedsScriptRule.js';
import c7HistoryTimeToLiveValid from './C7HistoryTimeToLiveValidRule.js';
import c7JobPriorityValid from './C7JobPriorityValidRule.js';
import c7DecisionResultMapperKnown from './C7DecisionResultMapperKnownRule.js';
import c7BindingKnown from './C7BindingKnownRule.js';
import c7UserTaskPriorityValid from './C7UserTaskPriorityValidRule.js';
import c7VariableEventsKnown from './C7VariableEventsKnownRule.js';
import c7BindingNeedsVersion from './C7BindingNeedsVersionRule.js';
import c7CallActivityOneCalledElement from './C7CallActivityOneCalledElementRule.js';
import c7FormRefNoFormKey from './C7FormRefNoFormKeyRule.js';
import c7FormRefNeedsBinding from './C7FormRefNeedsBindingRule.js';
import c7MultiInstanceNeedsCardinalityOrCollection from './C7MultiInstanceNeedsCardinalityOrCollectionRule.js';
import c7ElementVariableNeedsCollection from './C7ElementVariableNeedsCollectionRule.js';
import c7SignalNameUnique from './C7SignalNameUniqueRule.js';
import c7MessageSubscriptionUnique from './C7MessageSubscriptionUniqueRule.js';
import c7SignalSubscriptionUnique from './C7SignalSubscriptionUniqueRule.js';
import c7LinkCatchNameUnique from './C7LinkCatchNameUniqueRule.js';
import c7LinkThrowNeedsCatch from './C7LinkThrowNeedsCatchRule.js';
import c7TimerNeedsOneTimeValue from './C7TimerNeedsOneTimeValueRule.js';
import c7CompensationNamesOwnActivity from './C7CompensationNamesOwnActivityRule.js';
import c7ConditionalEventNeedsCondition from './C7ConditionalEventNeedsConditionRule.js';
import c7LinkEventNeedsName from './C7LinkEventNeedsNameRule.js';
import c7MessageEventNeedsMessage from './C7MessageEventNeedsMessageRule.js';
import c7MessageNeedsName from './C7MessageNeedsNameRule.js';
import c7SignalEventNeedsSignal from './C7SignalEventNeedsSignalRule.js';
import c7SignalNeedsName from './C7SignalNeedsNameRule.js';
import c7ErrorEndEventNeedsError from './C7ErrorEndEventNeedsErrorRule.js';
import c7ErrorNeedsCode from './C7ErrorNeedsCodeRule.js';
import c7EscalationThrowNeedsEscalation from './C7EscalationThrowNeedsEscalationRule.js';
import c7EscalationNeedsCode from './C7EscalationNeedsCodeRule.js';
import c7EscalationBoundaryHostAllowed from './C7EscalationBoundaryHostAllowedRule.js';
import c7CallMappingNeedsSourceAndTarget from './C7CallMappingNeedsSourceAndTargetRule.js';
import c7ConnectorNeedsId from './C7ConnectorNeedsIdRule.js';
import c7IoParameterNeedsName from './C7IoParameterNeedsNameRule.js';
import c7FormFieldNeedsIdAndType from './C7FormFieldNeedsIdAndTypeRule.js';
import c7FieldNeedsOneValue from './C7FieldNeedsOneValueRule.js';
import c7ListenerNeedsImplementation from './C7ListenerNeedsImplementationRule.js';
import c7ListenerEventKnown from './C7ListenerEventKnownRule.js';
import c7ListenerScriptNeedsFormat from './C7ListenerScriptNeedsFormatRule.js';
import c7TimeoutListenerNeedsTimerAndId from './C7TimeoutListenerNeedsTimerAndIdRule.js';
import c7IoMappingHostAllowed from './C7IoMappingHostAllowedRule.js';
import c7OutputMappingHostAllowed from './C7OutputMappingHostAllowedRule.js';
import c7NoZeebeContent from './C7NoZeebeContentRule.js';
import c7CamundaAttributeKnown from './C7CamundaAttributeKnownRule.js';
import c7CamundaAttributePlacement from './C7CamundaAttributePlacementRule.js';
import c7CamundaExtensionPlacement from './C7CamundaExtensionPlacementRule.js';
import c7CamundaReferenceResolves from './C7CamundaReferenceResolvesRule.js';
import c7BpmnAttributeKnown from './C7BpmnAttributeKnownRule.js';
import c7CamundaBooleanValid from './C7CamundaBooleanValidRule.js';
import c7IoParameterInInputOutput from './C7IoParameterInInputOutputRule.js';
import c7CamundaElementKnown from './C7CamundaElementKnownRule.js';

/** bpmn-cli's Camunda 7 rules: the checks camunda-compat's `camunda-platform-7-*` configs leave out, in the order their findings of one element are listed. */
export class Camunda7Rules {
  static readonly RULES = [
    c7EventGatewayTargetAllowed,
    c7EventGatewayBranchesUnique,
    c7ExclusiveGatewayNeedsOutgoing,
    c7ExclusiveGatewayDefaultNoCondition,
    c7ExclusiveGatewayNeedsDefault,
    c7ExclusiveGatewayNeedsConditions,
    c7ComplexGatewayNoFlows,
    c7AdHocSubProcessNoFlows,
    c7AdHocSubProcessNoMultiInstance,
    c7ScopeNeedsStartEvent,
    c7TransactionNeedsStartEvent,
    c7StartEventUnique,
    c7TaskTypeSupported,
    c7ShellTaskNeedsCommand,
    c7ShellFieldValuesFixed,
    c7TaskNeedsImplementation,
    c7MessageThrowNeedsImplementation,
    c7ExternalTaskNeedsTopic,
    c7ResultVariableNeedsExpression,
    c7ScriptTaskNeedsScript,
    c7HistoryTimeToLiveValid,
    c7JobPriorityValid,
    c7DecisionResultMapperKnown,
    c7BindingKnown,
    c7UserTaskPriorityValid,
    c7VariableEventsKnown,
    c7BindingNeedsVersion,
    c7CallActivityOneCalledElement,
    c7FormRefNoFormKey,
    c7FormRefNeedsBinding,
    c7MultiInstanceNeedsCardinalityOrCollection,
    c7ElementVariableNeedsCollection,
    c7SignalNameUnique,
    c7MessageSubscriptionUnique,
    c7SignalSubscriptionUnique,
    c7LinkCatchNameUnique,
    c7LinkThrowNeedsCatch,
    c7TimerNeedsOneTimeValue,
    c7CompensationNamesOwnActivity,
    c7ConditionalEventNeedsCondition,
    c7LinkEventNeedsName,
    c7MessageEventNeedsMessage,
    c7MessageNeedsName,
    c7SignalEventNeedsSignal,
    c7SignalNeedsName,
    c7ErrorEndEventNeedsError,
    c7ErrorNeedsCode,
    c7EscalationThrowNeedsEscalation,
    c7EscalationNeedsCode,
    c7EscalationBoundaryHostAllowed,
    c7CallMappingNeedsSourceAndTarget,
    c7ConnectorNeedsId,
    c7IoParameterNeedsName,
    c7FormFieldNeedsIdAndType,
    c7FieldNeedsOneValue,
    c7ListenerNeedsImplementation,
    c7ListenerEventKnown,
    c7ListenerScriptNeedsFormat,
    c7TimeoutListenerNeedsTimerAndId,
    c7IoMappingHostAllowed,
    c7OutputMappingHostAllowed,
    c7NoZeebeContent,
    c7CamundaAttributeKnown,
    c7CamundaAttributePlacement,
    c7CamundaExtensionPlacement,
    c7CamundaReferenceResolves,
  ];
  static readonly WRITTEN_FILE_RULES = [
    c7BpmnAttributeKnown,
    c7CamundaBooleanValid,
    c7IoParameterInInputOutput,
    c7CamundaElementKnown,
  ];

  /** camunda-compat's rules for an engine version with these, as `bpmn-cli/<rule>`, and the moddle extension they read. */
  static entry(kit: EngineKit): EngineEntry {
    return RuleEntries.entry(kit, Camunda7Rules.RULES, Camunda7Rules.WRITTEN_FILE_RULES, { compatRules, moddleExtensions }, (definitions, warnings, vendor) => C7Diagram.record(definitions, vendor, warnings));
  }
}
