import { EVENT_GATEWAY_TRIGGERS, ignoresConditions, isEventSubProcess, kindLabel } from '../../document/utils/kinds.js';
import { unkeptEntries } from '../../document/utils/mirror.js';
import { BPMN_NS, createModdle, is, isBpmnElement, isDiElement, walk } from '../../document/utils/moddle.js';
import { DecisionLinkReader } from '../../document/DecisionLinkReader.js';
import { decodeXml, elementChildren, readXmlText } from '../../document/utils/text-reader.js';
import { XmlTextError } from '../../document/xml/XmlTextError.js';
import { CAMUNDA, OPERATON_URI } from '../../document/vendor/CamundaDescriptor.js';
import { DocumentNamespaces } from '../../document/vendor/DocumentNamespaces.js';
import { makeFinding } from '../../document/utils/finding.js';
import { ZEEBE } from '../../document/vendor/ZeebeDescriptor.js';

/**
 * The core helpers the lazily loaded engine rules get handed instead of importing them:
 * a module shared by core and rule chunk lands in the host's entry chunk, and a host that
 * awaits a profile at top level would then wait for itself forever.
 */
export const RULE_KIT = {
  BPMN_NS,
  createModdle,
  is,
  isBpmnElement,
  isDiElement,
  walk,
  kindLabel,
  isEventSubProcess,
  ignoresConditions,
  EVENT_GATEWAY_TRIGGERS,
  makeFinding,
  unkeptEntries,
  DecisionLinkReader,
  OPERATON_URI,
  DocumentNamespaces,
  camunda: CAMUNDA,
  zeebe: ZEEBE,
  decodeXml,
  elementChildren,
  readXmlText,
  XmlTextError,
};

export type RuleKit = typeof RULE_KIT;
