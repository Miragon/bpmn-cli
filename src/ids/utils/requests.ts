import type { KindDef } from '../../model/kinds.js';
import { lcfirst, localName } from './id-words.js';

/**
 * Names a type-named prefix of the kind could use: the kind and its BPMN
 * type (`userTask`; `eventSubProcess`, `subProcess`). A data reference's
 * kind is the type of the element it stands for (`dataObject`, whose
 * bpmn:DataObject a file names `dataObject_`), so its own type comes first
 * (`dataObjectReference_invoice` next to `dataObject_invoice`).
 */
export function kindTypeNames(def: KindDef): string[] {
  const type = lcfirst(localName(def.type));
  return [...new Set(type === `${def.kind}Reference` ? [type, def.kind] : [def.kind, type])];
}

export interface IdRequest {
  /** style key: a kind of `bpmn kinds` (userTask, eventSubProcess, lane, ...) or a BPMN type (bpmn:Message, bpmn:LaneSet) */
  key: string;
  /** the bpmn-cli prefix of the kind (Activity, Event, Gateway, Message, ...) */
  prefix: string;
  /** names of the kind that a type-named prefix would use (serviceTask_, ServiceTask_), lowerCamel */
  typeNames: string[];
  /** event trigger (message, timer, ...) */
  trigger?: string;
  name?: string;
  /**
   * words that tell an element without name apart: where it is ("After Check
   * invoice", "On Review", "In Payment") or what it belongs to (the process
   * of a lane set, the ends of an association); with a word for the kind
   * they are the body of its id
   */
  context?: string;
  /**
   * a word for the kind of the unnamed anchor whose context `context`
   * repeats (ElementLabels.anchorContext: `Gateway` for the gateway after Check, whose
   * context `After Check` an element after it repeats): where the id from
   * the context alone, or its body, is taken, the context names that anchor
   * too (`After Check Gateway`), before a suffix
   */
  anchorKind?: string;
  /** connections (sequence / message flows): the ids of the ends */
  source?: string;
  target?: string;
  /** connections: the speaking labels of the ends (ElementLabels.label; default: the speaking part of the end ids) */
  sourceLabel?: string;
  targetLabel?: string;
  /**
   * a word after the body that a cut keeps (the backing bpmn:DataObject's
   * `Object` where its id would else be its reference's: ops/artifacts.ts):
   * the body is cut so that the word fits beside it within the 64
   * characters, past the 40 of a name
   */
  tailWord?: string;
}

/** The request for an element of a kind of `bpmn kinds`. */
export function kindRequest(def: KindDef, opts: { trigger?: string; name?: string; context?: string; anchorKind?: string } = {}): IdRequest {
  return { key: def.kind, prefix: def.prefix, typeNames: kindTypeNames(def), ...opts };
}

/** The request for an element of another BPMN type (bpmn:Message, bpmn:LaneSet, bpmn:Association, ...). */
export function typeRequest(type: string, opts: { name?: string; context?: string; prefix?: string } = {}): IdRequest {
  const { prefix, ...rest } = opts;
  return { key: type, prefix: prefix ?? localName(type), typeNames: [lcfirst(localName(type))], ...rest };
}

/** The request for a sequence flow or message flow from `source` to `target` (ids; their labels: see ElementLabels.flowRequest). */
export function connectionRequest(
  type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow',
  source: string,
  target: string,
  opts: { name?: string; sourceLabel?: string; targetLabel?: string } = {},
): IdRequest {
  const { name, ...labels } = opts;
  return { key: type, prefix: 'Flow', typeNames: [lcfirst(localName(type))], source, target, ...(name ? { name } : {}), ...labels };
}

export const CONNECTIONS = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow']);
