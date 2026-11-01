import type { BpmnElement } from '../document/BpmnElement.js';
import { BpmnError } from '../errors/BpmnError.js';
import { EditDistance } from '../ids/EditDistance.js';
import { Kinds, type KindDefinition } from './Kinds.js';
import { Triggers, type Trigger } from './Triggers.js';

export interface ParsedKind {
  def: KindDefinition;
  trigger?: Trigger;
}

export class KindParser {
  private static readonly EXTRA_KINDS = ['sequenceFlow', 'messageFlow', 'association', 'dataAssociation', 'process', 'collaboration', 'message', 'error', 'signal', 'escalation'];
  private static readonly TOKENS = KindParser.tokens();

  private static tokens(): Map<string, KindDefinition> {
    const tokens = new Map<string, KindDefinition>();
    for (const definition of Kinds.ALL) {
      for (const token of [definition.kind, definition.type, definition.type.split(':')[1] ?? '', ...definition.aliases]) {
        if (token) {
          tokens.set(token.toLowerCase(), definition);
        }
      }
    }
    const subProcess = Kinds.byName('subProcess')!;
    tokens.set('bpmn:subprocess', subProcess);
    tokens.set('subprocess', subProcess);
    return tokens;
  }

  static parse(token: string): ParsedKind {
    const { kindToken, triggerToken } = KindParser.split(token);
    const def = KindParser.TOKENS.get(kindToken.toLowerCase());
    if (!def) {
      throw KindParser.unknown(kindToken);
    }
    if (!triggerToken) {
      return { def };
    }
    const trigger = Triggers.normalize(triggerToken);
    if (!trigger) {
      throw KindParser.triggerError(`Unknown event trigger "${triggerToken}". Allowed: ${['none', ...Object.keys(Triggers.TABLE)].join(', ')}`);
    }
    if (!def.triggers) {
      throw KindParser.triggerError(`Kind "${def.kind}" is not an event and cannot have a trigger (":${triggerToken}")`);
    }
    if (!def.triggers.includes(trigger)) {
      throw KindParser.triggerError(`Trigger "${trigger}" is not allowed on ${def.kind}. Allowed: ${def.triggers.join(', ')}`);
    }
    return { def, trigger };
  }

  static parseToAdd(token: string): ParsedKind {
    try {
      return KindParser.parse(token);
    } catch (error) {
      if (!(error instanceof BpmnError)) {
        throw error;
      }
      const eventSubProcess = KindParser.parseEventSubProcess(token);
      if (eventSubProcess) {
        return eventSubProcess;
      }
      throw error;
    }
  }

  static suggest(token: string, max = 4): string[] {
    const lowerToken = token.toLowerCase().replace(/^bpmn:/, '');
    return Kinds.ALL.map((definition) => ({ kind: definition.kind, score: KindParser.closeness(definition, lowerToken) }))
      .filter(({ score }) => score <= Math.max(2, Math.floor(lowerToken.length / 3)))
      .sort((left, right) => left.score - right.score)
      .slice(0, max)
      .map(({ kind }) => kind);
  }

  static filter(kind: string): (element: BpmnElement) => boolean {
    try {
      const { def, trigger } = KindParser.parse(kind);
      return (element) => Kinds.of(element)?.kind === def.kind && (!trigger || Triggers.of(element) === trigger);
    } catch (error) {
      if (!(error instanceof BpmnError)) {
        throw error;
      }
      const token = kind.trim().toLowerCase();
      const extra = KindParser.EXTRA_KINDS.find((candidate) => candidate.toLowerCase() === token);
      if (extra) {
        return (element) => Kinds.labelOrType(element) === extra;
      }
      throw BpmnError.usage(error.message, { candidates: [...(error.details.candidates ?? []), ...KindParser.EXTRA_KINDS.filter((candidate) => candidate.toLowerCase().includes(token))] });
    }
  }

  private static split(token: string): { kindToken: string; triggerToken: string } {
    const [rawKind = '', ...rest] = token.trim().split(':');
    if (rawKind.toLowerCase() === 'bpmn' && rest.length) {
      return { kindToken: `bpmn:${rest[0]}`, triggerToken: rest.slice(1).join(':') };
    }
    return { kindToken: rawKind, triggerToken: rest.join(':') };
  }

  private static unknown(kindToken: string): BpmnError {
    const rejection = KindParser.rejectionOf(kindToken);
    if (rejection) {
      return new BpmnError('E_UNSUPPORTED_KIND', `Kind "${kindToken}" is rejected: ${rejection}`, 'usage', { hint: 'Run `bpmn guide kinds` for the supported kinds.' });
    }
    const candidates = KindParser.suggest(kindToken);
    return new BpmnError('E_UNKNOWN_KIND', `Unknown kind "${kindToken}"${candidates.length ? ` (did you mean: ${candidates.join(', ')}?)` : ''}. Run \`bpmn guide kinds\` for the full list.`, 'usage', {
      candidates,
      hint: 'Run `bpmn guide kinds` for the full list.',
    });
  }

  private static rejectionOf(kindToken: string): string | undefined {
    const kind = kindToken.toLowerCase().replace(/^bpmn:/, '');
    const rejected = Object.entries(Kinds.REJECTED_TYPES).find(([type]) => {
      const local = type.split(':')[1]!.toLowerCase();
      return local === kind || local === `${kind}gateway` || local === `${kind}event`;
    });
    return rejected?.[1];
  }

  private static triggerError(message: string): BpmnError {
    return new BpmnError('E_INVALID_TRIGGER', message, 'usage', { hint: 'Use kind:trigger, e.g. startEvent:message or boundaryEvent:timer.' });
  }

  private static closeness(definition: KindDefinition, lowerToken: string): number {
    let best = Number.POSITIVE_INFINITY;
    for (const name of [definition.kind, ...definition.aliases].map((alias) => alias.toLowerCase())) {
      if (name.includes(lowerToken) || lowerToken.includes(name)) {
        best = Math.min(best, 1);
      }
      best = Math.min(best, EditDistance.levenshtein(name, lowerToken));
    }
    return best;
  }

  private static parseEventSubProcess(token: string): ParsedKind | undefined {
    const separator = token.indexOf(':');
    if (separator < 0 || KindParser.TOKENS.get(token.slice(0, separator).trim().toLowerCase())?.kind !== 'eventSubProcess') {
      return undefined;
    }
    const raw = token.slice(separator + 1);
    const trigger = Triggers.normalize(raw);
    const allowed: Trigger[] = (Kinds.byName('startEvent')?.triggers ?? []).filter((startTrigger) => startTrigger !== 'none');
    if (!trigger || !allowed.includes(trigger)) {
      throw new BpmnError('E_INVALID_TRIGGER', `Trigger "${raw}" is not allowed on eventSubProcess. Allowed: ${allowed.join(', ')}`, 'usage', {
        candidates: allowed,
        hint: 'eventSubProcess:<trigger> creates the event sub-process with a startEvent:<trigger> inside, e.g. eventSubProcess:error error=PaymentFailed.',
      });
    }
    return { def: Kinds.byName('eventSubProcess')!, trigger };
  }
}
