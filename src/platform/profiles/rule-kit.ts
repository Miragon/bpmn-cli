/**
 * What the engine rules that load on demand (platform/profiles/C7Profile.ts,
 * C8Profile.ts and the modules they import) use of the core: the loader
 * (platform/profiles/PlatformProfiles.ts) hands them RULE_KIT right after the import
 * (`new C7Profile(RULE_KIT)`), they import nothing of the core themselves
 * (type imports only).
 *
 * Why: a module that the core and a rule module both import is placed by
 * Rollup / Vite (the host's bundler) into the host's entry chunk, and the
 * rule chunk then imports the entry chunk back. A host whose entry module
 * awaits a Camunda 7 / 8 call (or loadProfile) at top level would wait for
 * itself forever: the rule chunk runs only once the entry module has
 * finished, and that module waits for the rule chunk. A rule chunk that
 * imports nothing loads whatever the host's entry does.
 *
 * Contract: a profile reads the helpers as `this.kit` (EngineProfile takes
 * the kit in its constructor), nothing of the kit is used while a rule
 * module is evaluated, only when a rule runs. A new helper a rule needs is
 * added here. tools/iso/check.mjs and
 * test/isomorphic.test.ts fail when a rule module imports a module the
 * core entry loads, naming both.
 */
import { kindLabel } from '../../model/utils/kinds.js';
import { unkeptEntries } from '../../model/utils/mirror.js';
import { BPMN_NS, createModdle, is, isBpmnElement, isDiElement, walk } from '../../model/utils/moddle.js';
import { DecisionLinkReader } from '../../ops/DecisionLinkReader.js';
import { decodeXml, elementChildren, readXmlText } from '../../xml/utils/text-reader.js';
import { XmlTextError } from '../../xml/XmlTextError.js';
import { CAMUNDA, OPERATON_URI } from '../CamundaDescriptor.js';
import { DocumentNamespaces } from '../DocumentNamespaces.js';
import { makeFinding } from '../utils/finding.js';
import { ZEEBE } from '../ZeebeDescriptor.js';

export const RULE_KIT = {
  // model, kinds, findings
  BPMN_NS,
  createModdle,
  is,
  isBpmnElement,
  isDiElement,
  walk,
  kindLabel,
  makeFinding,
  unkeptEntries,
  DecisionLinkReader,
  // namespaces and vendor descriptors
  OPERATON_URI,
  DocumentNamespaces,
  camunda: CAMUNDA,
  zeebe: ZEEBE,
  // the text of a file (SchemaText.ts)
  decodeXml,
  elementChildren,
  readXmlText,
  XmlTextError,
};

export type RuleKit = typeof RULE_KIT;
