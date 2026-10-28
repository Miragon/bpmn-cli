import { compatRules, moddleExtensions } from '@miragon/bpmnlint-plugin-rules/camunda-8';
import type { EngineKit } from '../../../engine-kit.js';
import type { EngineEntry } from '../../EngineRun.js';
import { ElementKinds } from '../describe.js';
import { RuleEntries } from '../RuleEntries.js';
import { C8Host } from './C8Host.js';
import c8Events from './c8-events.js';
import c8Extensions from './c8-extensions.js';
import c8FeelExpression from './c8-feel-expression.js';
import c8Schema from './c8-schema.js';
import c8Subscriptions from './c8-subscriptions.js';
import c8VendorContent from './c8-vendor-content.js';

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
