import { compatRules, moddleExtensions } from '@miragon/bpmnlint-plugin-rules/camunda-8';
import type { EngineKit } from '../../../engine-kit.js';
import type { EngineEntry } from '../../EngineRun.js';
import { ElementKinds } from '../ElementKinds.js';
import { RuleEntries } from '../RuleEntries.js';
import { C8Host } from './C8Host.js';
import c8Events from './C8Events.js';
import c8Extensions from './C8Extensions.js';
import c8FeelExpression from './C8FeelExpression.js';
import c8Schema from './C8Schema.js';
import c8Subscriptions from './C8Subscriptions.js';
import c8VendorContent from './C8VendorContent.js';

/** bpmn-cli's Camunda 8 rules: the checks camunda-compat's `camunda-cloud-8-*` configs leave out. */
export class Camunda8Rules {
  static readonly RULES = [c8Events, c8Subscriptions, c8FeelExpression, c8Extensions, c8Schema, c8VendorContent];

  /** camunda-compat's rules for an engine version with these, as `bpmn-cli/<rule>`, and the moddle extension they read. */
  static entry(kit: EngineKit): EngineEntry {
    ElementKinds.use(kit.kindLabel);
    C8Host.use(kit.ZEEBE);
    return {
      moddleExtensions,
      findings: RuleEntries.findingsOf(Camunda8Rules.RULES),
      rules: (version) => [...compatRules(version), ...RuleEntries.of(Camunda8Rules.RULES, version)],
    };
  }
}
