import type { KindDef } from '../Kinds.js';

export interface IdRequest {
  /** a kind of `bpmn kinds` or a BPMN type (bpmn:Message, bpmn:LaneSet) */
  key: string;
  trigger?: string;
  name?: string;
  /**
   * words that tell an unnamed element apart: where it is ("After Check invoice", "On Review")
   * or what it belongs to; with a kind word they are its id body
   */
  context?: string;
  /**
   * the kind word of the unnamed anchor whose context `context` repeats (`Gateway`):
   * where the id is taken, the context names that anchor too (`After Check Gateway`)
   */
  anchorKind?: string;
  source?: string;
  target?: string;
  sourceLabel?: string;
  targetLabel?: string;
  /**
   * a word after the body that a cut keeps (a backing bpmn:DataObject's `Object`):
   * the body is cut so the word fits within the 64 characters
   */
  tailWord?: string;
}

export function kindRequest(def: KindDef, opts: { trigger?: string; name?: string; context?: string; anchorKind?: string } = {}): IdRequest {
  return { key: def.kind, ...opts };
}

export function typeRequest(type: string, opts: { name?: string; context?: string } = {}): IdRequest {
  return { key: type, ...opts };
}

export function connectionRequest(
  type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow',
  source: string,
  target: string,
  opts: { name?: string; sourceLabel?: string; targetLabel?: string } = {},
): IdRequest {
  const { name, ...labels } = opts;
  return { key: type, source, target, ...(name ? { name } : {}), ...labels };
}

export const CONNECTIONS = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow']);
