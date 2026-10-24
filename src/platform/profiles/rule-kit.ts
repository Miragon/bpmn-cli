/**
 * What the engine rules that load on demand (platform/profiles/c7.ts, c8.ts and
 * schema-text.ts, which comes with c8.ts) use of the core: the loader
 * (platform/profiles/profile.ts) hands them RULE_KIT right after the import
 * (`useKit`), they import nothing of the core themselves (type imports
 * only).
 *
 * Why: a module that the core and a rule module both import is placed by
 * Rollup / Vite (the host's bundler) into the host's entry chunk, and the
 * rule chunk then imports the entry chunk back. A host whose entry module
 * awaits a Camunda 7 / 8 call (or loadProfile) at top level would wait for
 * itself forever: the rule chunk runs only once the entry module has
 * finished, and that module waits for the rule chunk. A rule chunk that
 * imports nothing loads whatever the host's entry does.
 *
 * Contract: a rule module declares the helpers it uses as module variables
 * (`let { is, walk, ... } = {} as RuleKit`) and exports `useKit(kit)`,
 * which assigns them (and those of the modules it imports); nothing of the
 * kit is used while the module is evaluated, only when a rule runs. A new
 * helper a rule needs is added here. tools/iso/check.mjs and
 * test/isomorphic.test.ts fail when a rule module imports a module the
 * core entry loads, naming both.
 */
import { kindLabel } from '../../model/kinds.js';
import { unkeptEntries } from '../../model/mirror.js';
import { BPMN_NS, createModdle, is, isBpmnElement, isDiElement, walk } from '../../model/utils/moddle.js';
import { decisionLinkOf } from '../../ops/decision.js';
import { decodeXml, elementChildren, readXmlText, XmlTextError } from '../../xml/text-reader.js';
import { C7_URIS, CAMUNDA_URI, camundaAttr, camundaAttrs, camundaType, containersOf, idReferenceAttrs, isC7Uri, OPERATON_URI, ZEEBE_URI } from '../descriptor.js';
import { namespaceMap, namespaceUsage, uriOfElement, uriOfName } from '../detect.js';
import { makeFinding } from '../finding.js';
import { zeebeAllowedOn, zeebeAttr, zeebeAttrs, zeebeContainersOf, zeebeNestedOnly, zeebeType, zeebeTypeNames } from '../zeebe.js';

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
  decisionLinkOf,
  // namespaces and vendor descriptors
  C7_URIS,
  CAMUNDA_URI,
  OPERATON_URI,
  ZEEBE_URI,
  isC7Uri,
  namespaceMap,
  namespaceUsage,
  uriOfElement,
  uriOfName,
  camundaAttr,
  camundaAttrs,
  camundaType,
  containersOf,
  idReferenceAttrs,
  zeebeAllowedOn,
  zeebeAttr,
  zeebeAttrs,
  zeebeContainersOf,
  zeebeNestedOnly,
  zeebeType,
  zeebeTypeNames,
  // the text of a file (schema-text.ts)
  decodeXml,
  elementChildren,
  readXmlText,
  XmlTextError,
};

export type RuleKit = typeof RULE_KIT;
