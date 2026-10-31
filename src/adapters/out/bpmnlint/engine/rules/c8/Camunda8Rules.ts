import { compatRules, moddleExtensions } from '@miragon/bpmnlint-plugin-rules/camunda-8';
import type { EngineKit } from '../../../engine-kit.js';
import type { EngineEntry } from '../../run/EngineRun.js';
import { RuleEntries } from '../RuleEntries.js';
import c8EventSubProcessStartNeedsTrigger from './C8EventSubProcessStartNeedsTriggerRule.js';
import c8CompensationNamesOwnActivity from './C8CompensationNamesOwnActivityRule.js';
import c8CompensationBoundaryNeedsAssociation from './C8CompensationBoundaryNeedsAssociationRule.js';
import c8CompensationBoundaryNoOutgoingFlow from './C8CompensationBoundaryNoOutgoingFlowRule.js';
import c8AdHocSubProcessNoStartOrEndEvent from './C8AdHocSubProcessNoStartOrEndEventRule.js';
import c8EventGatewayNeedsTwoBranches from './C8EventGatewayNeedsTwoBranchesRule.js';
import c8EventGatewayTargetAllowed from './C8EventGatewayTargetAllowedRule.js';
import c8EmbeddedStartEventNoTrigger from './C8EmbeddedStartEventNoTriggerRule.js';
import c8SubProcessStartEventUnique from './C8SubProcessStartEventUniqueRule.js';
import c8TimerValueValid from './C8TimerValueValidRule.js';
import c8ConditionalEventNeedsCondition from './C8ConditionalEventNeedsConditionRule.js';
import c8LinkEventNeedsName from './C8LinkEventNeedsNameRule.js';
import c8LinkThrowNeedsCatch from './C8LinkThrowNeedsCatchRule.js';
import c8MessageStartNeedsStaticName from './C8MessageStartNeedsStaticNameRule.js';
import c8MessageSubscriptionUnique from './C8MessageSubscriptionUniqueRule.js';
import c8SignalStartNeedsStaticName from './C8SignalStartNeedsStaticNameRule.js';
import c8SignalSubscriptionUnique from './C8SignalSubscriptionUniqueRule.js';
import c8ErrorCatchNeedsStaticCode from './C8ErrorCatchNeedsStaticCodeRule.js';
import c8ErrorEventInterrupting from './C8ErrorEventInterruptingRule.js';
import c8ErrorCodeUnique from './C8ErrorCodeUniqueRule.js';
import c8ThrownMessageNeedsName from './C8ThrownMessageNeedsNameRule.js';
import c8ConditionNeedsFeel from './C8ConditionNeedsFeelRule.js';
import c8MultiInstanceNeedsFeel from './C8MultiInstanceNeedsFeelRule.js';
import c8ScriptNeedsFeel from './C8ScriptNeedsFeelRule.js';
import c8CorrelationKeyNeedsFeel from './C8CorrelationKeyNeedsFeelRule.js';
import c8FeelExpressionValid from './C8FeelExpressionValidRule.js';
import c8MultiInstanceCompletionNeedsFeel from './C8MultiInstanceCompletionNeedsFeelRule.js';
import c8JobRetriesValid from './C8JobRetriesValidRule.js';
import c8TaskHeaderNeedsKeyAndValue from './C8TaskHeaderNeedsKeyAndValueRule.js';
import c8SequenceFlowNoExecutionListeners from './C8SequenceFlowNoExecutionListenersRule.js';
import c8ExecutionListenerEventTypeValid from './C8ExecutionListenerEventTypeValidRule.js';
import c8TaskListenersNeedCamundaUserTask from './C8TaskListenersNeedCamundaUserTaskRule.js';
import c8TaskListenerEventTypeValid from './C8TaskListenerEventTypeValidRule.js';
import c8LinkedResourceNeedsType from './C8LinkedResourceNeedsTypeRule.js';
import c8BindingTypeKnown from './C8BindingTypeKnownRule.js';
import c8VersionTagBindingNeedsTag from './C8VersionTagBindingNeedsTagRule.js';
import c8ConditionalFilterEventsKnown from './C8ConditionalFilterEventsKnownRule.js';
import c8ExtensionElementUnique from './C8ExtensionElementUniqueRule.js';
import c8NoCamunda7Content from './C8NoCamunda7ContentRule.js';
import c8ZeebeAttributeKnown from './C8ZeebeAttributeKnownRule.js';
import c8ZeebeAttributePlacement from './C8ZeebeAttributePlacementRule.js';
import c8ZeebeExtensionPlacement from './C8ZeebeExtensionPlacementRule.js';
import c8InputMappingPlacement from './C8InputMappingPlacementRule.js';
import c8BpmnAttributeKnown from './C8BpmnAttributeKnownRule.js';
import c8PublishMessageNoTaskDefinition from './C8PublishMessageNoTaskDefinitionRule.js';
import c8PublishMessageNeedsMessage from './C8PublishMessageNeedsMessageRule.js';
import c8PublishMessageNeedsCorrelationKey from './C8PublishMessageNeedsCorrelationKeyRule.js';
import c8PublishMessageUnsupported from './C8PublishMessageUnsupportedRule.js';
import c8ZeebeElementPlacement from './C8ZeebeElementPlacementRule.js';
import c8ZeebeElementKnown from './C8ZeebeElementKnownRule.js';

/** bpmn-cli's Camunda 8 rules: the checks camunda-compat's `camunda-cloud-8-*` configs leave out, in the order their findings of one element are listed. */
export class Camunda8Rules {
  static readonly RULES = [
    c8EventSubProcessStartNeedsTrigger,
    c8CompensationNamesOwnActivity,
    c8CompensationBoundaryNeedsAssociation,
    c8CompensationBoundaryNoOutgoingFlow,
    c8AdHocSubProcessNoStartOrEndEvent,
    c8EventGatewayNeedsTwoBranches,
    c8EventGatewayTargetAllowed,
    c8EmbeddedStartEventNoTrigger,
    c8SubProcessStartEventUnique,
    c8TimerValueValid,
    c8ConditionalEventNeedsCondition,
    c8LinkEventNeedsName,
    c8LinkThrowNeedsCatch,
    c8MessageStartNeedsStaticName,
    c8MessageSubscriptionUnique,
    c8SignalStartNeedsStaticName,
    c8SignalSubscriptionUnique,
    c8ErrorCatchNeedsStaticCode,
    c8ErrorEventInterrupting,
    c8ErrorCodeUnique,
    c8ThrownMessageNeedsName,
    c8ConditionNeedsFeel,
    c8MultiInstanceNeedsFeel,
    c8ScriptNeedsFeel,
    c8CorrelationKeyNeedsFeel,
    c8FeelExpressionValid,
    c8MultiInstanceCompletionNeedsFeel,
    c8JobRetriesValid,
    c8TaskHeaderNeedsKeyAndValue,
    c8SequenceFlowNoExecutionListeners,
    c8ExecutionListenerEventTypeValid,
    c8TaskListenersNeedCamundaUserTask,
    c8TaskListenerEventTypeValid,
    c8LinkedResourceNeedsType,
    c8BindingTypeKnown,
    c8VersionTagBindingNeedsTag,
    c8ConditionalFilterEventsKnown,
    c8ExtensionElementUnique,
    c8NoCamunda7Content,
    c8ZeebeAttributeKnown,
    c8ZeebeAttributePlacement,
    c8ZeebeExtensionPlacement,
    c8InputMappingPlacement,
  ];
  static readonly WRITTEN_FILE_RULES = [
    c8BpmnAttributeKnown,
    c8PublishMessageNoTaskDefinition,
    c8PublishMessageNeedsMessage,
    c8PublishMessageNeedsCorrelationKey,
    c8PublishMessageUnsupported,
    c8ZeebeElementPlacement,
    c8ZeebeElementKnown,
  ];

  /** camunda-compat's rules for an engine version with these, as `bpmn-cli/<rule>`, and the moddle extension they read. */
  static entry(kit: EngineKit): EngineEntry {
    return RuleEntries.entry(kit, Camunda8Rules.RULES, Camunda8Rules.WRITTEN_FILE_RULES, { compatRules, moddleExtensions });
  }
}
