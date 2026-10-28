import { compatRules, moddleExtensions } from '@miragon/bpmnlint-plugin-rules/camunda-7';
import type { EngineKit } from '../../../engine-kit.js';
import type { EngineEntry } from '../../EngineRun.js';
import { RuleEntries } from '../RuleEntries.js';
import { C7Diagram } from './C7Diagram.js';
import c7Events from './C7Events.js';
import c7ExtensionContent from './C7ExtensionContent.js';
import c7Flows from './C7Flows.js';
import c7Implementation from './C7Implementation.js';
import c7Values from './C7Values.js';
import c7VendorContent from './C7VendorContent.js';

/** bpmn-cli's Camunda 7 rules: the checks camunda-compat's `camunda-platform-7-*` configs leave out. */
export class Camunda7Rules {
  static readonly RULES = [c7Flows, c7Implementation, c7Values, c7Events, c7ExtensionContent, c7VendorContent];

  /** camunda-compat's rules for an engine version with these, as `bpmn-cli/<rule>`, and the moddle extension they read. */
  static entry(kit: EngineKit): EngineEntry {
    return RuleEntries.entry(kit, Camunda7Rules.RULES, { compatRules, moddleExtensions }, (definitions, warnings, vendor) => C7Diagram.record(definitions, vendor, warnings));
  }
}
