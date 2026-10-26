import { EVENT_GATEWAY_TRIGGERS, ignoresConditions, isEventSubProcess, kindLabel } from '../../model/utils/kinds.js';
import { unkeptEntries } from '../../model/utils/mirror.js';
import { BPMN_NS, createModdle, is, isBpmnElement, isDiElement, walk } from '../../model/utils/moddle.js';
import { DecisionLinkReader } from '../../model/DecisionLinkReader.js';
import { decodeXml, elementChildren, readXmlText } from '../../xml/utils/text-reader.js';
import { XmlTextError } from '../../xml/XmlTextError.js';
import { CAMUNDA, OPERATON_URI } from '../CamundaDescriptor.js';
import { DocumentNamespaces } from '../DocumentNamespaces.js';
import { makeFinding } from '../utils/finding.js';
import { ZEEBE } from '../ZeebeDescriptor.js';

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
