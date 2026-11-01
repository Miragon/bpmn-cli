import type { KindDefinition } from '../kinds/Kinds.js';

export interface IdRequest {
  key: string;
  trigger?: string;
  name?: string;
  context?: string;
  anchorKind?: string;
  source?: string;
  target?: string;
  sourceLabel?: string;
  targetLabel?: string;
}

export class IdRequests {
  static readonly CONNECTIONS: ReadonlySet<string> = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow']);

  static kindRequest(def: KindDefinition, opts: { trigger?: string; name?: string; context?: string; anchorKind?: string } = {}): IdRequest {
    return { key: def.kind, ...opts };
  }

  static typeRequest(type: string, opts: { name?: string; context?: string } = {}): IdRequest {
    return { key: type, ...opts };
  }

  static connectionRequest(
    type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow',
    source: string,
    target: string,
    opts: { name?: string; sourceLabel?: string; targetLabel?: string } = {},
  ): IdRequest {
    const { name, ...labels } = opts;
    return { key: type, source, target, ...(name ? { name } : {}), ...labels };
  }
}
