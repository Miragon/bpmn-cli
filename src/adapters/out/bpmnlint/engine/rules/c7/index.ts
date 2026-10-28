import { compatRules, moddleExtensions } from '@miragon/bpmnlint-plugin-rules/camunda-7';
import type { EngineKit } from '../../../engine-kit.js';
import type { EngineEntry } from '../../EngineRun.js';
import { ElementKinds } from '../describe.js';
import { RuleEntries } from '../RuleEntries.js';
import { C7Diagram } from './C7Diagram.js';
import { CamundaDescriptor } from './CamundaDescriptor.js';
import c7Events from './c7-events.js';
import c7ExtensionContent from './c7-extension-content.js';
import c7Flows from './c7-flows.js';
import c7Implementation from './c7-implementation.js';
import c7Values from './c7-values.js';
import c7VendorContent from './c7-vendor-content.js';

/** bpmn-cli's Camunda 7 rules: the checks camunda-compat's `camunda-platform-7-*` configs leave out. */
export class Camunda7Rules {
  static readonly RULES = [c7Flows, c7Implementation, c7Values, c7Events, c7ExtensionContent, c7VendorContent];

  /** camunda-compat's rules for an engine version with these, as `bpmn-cli/<rule>`, and the moddle extension they read. */
  static entry(kit: EngineKit): EngineEntry {
    ElementKinds.use(kit.kindLabel);
    CamundaDescriptor.use(kit.CAMUNDA);
    return {
      moddleExtensions,
      findings: RuleEntries.findingsOf(Camunda7Rules.RULES),
      rules: (version) => [...compatRules(version), ...RuleEntries.of(Camunda7Rules.RULES, version)],
      afterParse: (definitions, warnings, vendor) => C7Diagram.record(definitions, vendor, warnings),
    };
  }
}
