import { BpmnModdle } from 'bpmn-moddle';
import { kindLabel } from '../../../domain/document/Kinds.js';
import { makeFinding } from '../../../domain/document/utils/finding.js';
import { levenshtein } from '../../../domain/document/utils/fuzzy.js';
import { is, isDiElement, list, peek, walk } from '../../../domain/document/utils/moddle.js';
import { C7_URIS, CAMUNDA, CAMUNDA_URI, OPERATON_URI } from '../../../domain/document/vendor/CamundaDescriptor.js';
import { DocumentNamespaces } from '../../../domain/document/vendor/DocumentNamespaces.js';
import { ZEEBE } from '../../../domain/document/vendor/ZeebeDescriptor.js';
import { DecisionLinkReader } from '../../../domain/editing/properties/DecisionLinkReader.js';

/**
 * The core helpers the lazily loaded engine run gets handed instead of importing them: a module
 * shared by the core and a rule chunk lands in the host's entry chunk, and the rule chunk would
 * import the entry chunk back (a host that awaits a call at top level would wait for itself).
 */
export const ENGINE_KIT = {
  BpmnModdle,
  kindLabel,
  makeFinding,
  levenshtein,
  is,
  isDiElement,
  list,
  peek,
  walk,
  C7_URIS,
  CAMUNDA,
  CAMUNDA_URI,
  OPERATON_URI,
  DocumentNamespaces,
  ZEEBE,
  DecisionLinkReader,
};

export type EngineKit = typeof ENGINE_KIT;
