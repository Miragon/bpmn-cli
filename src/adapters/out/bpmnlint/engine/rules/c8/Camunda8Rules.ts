import { compatRules, moddleExtensions } from '@miragon/bpmnlint-plugin-rules/camunda-8';
import type { EngineKit } from '../../../engine-kit.js';
import type { EngineEntry } from '../../run/EngineRun.js';
import { RuleEntries } from '../RuleEntries.js';
import c8Events from './C8EventsRule.js';
import c8Extensions from './C8ExtensionsRule.js';
import c8FeelExpression from './C8FeelExpressionRule.js';
import c8Subscriptions from './C8SubscriptionsRule.js';
import c8VendorContent from './C8VendorContentRule.js';
import c8PublishMessage from './C8PublishMessageRule.js';
import c8UnknownVendorElements from './C8UnknownVendorElementsRule.js';
import c8UnprefixedAttributes from './C8UnprefixedAttributesRule.js';

/** bpmn-cli's Camunda 8 rules: the checks camunda-compat's `camunda-cloud-8-*` configs leave out. */
export class Camunda8Rules {
  static readonly RULES = [c8Events, c8Subscriptions, c8FeelExpression, c8Extensions, c8VendorContent];
  static readonly WRITTEN_FILE_RULES = [c8UnprefixedAttributes, c8PublishMessage, c8UnknownVendorElements];

  /** camunda-compat's rules for an engine version with these, as `bpmn-cli/<rule>`, and the moddle extension they read. */
  static entry(kit: EngineKit): EngineEntry {
    return RuleEntries.entry(kit, Camunda8Rules.RULES, Camunda8Rules.WRITTEN_FILE_RULES, { compatRules, moddleExtensions });
  }
}
