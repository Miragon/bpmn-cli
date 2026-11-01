import { type IdConventions, type KindDefinition, Kinds, type Trigger, Triggers } from '../../model/index.js';
import { ConventionsTable } from './ConventionsTable.js';

export interface Kind extends Pick<KindDefinition, 'kind' | 'type' | 'family' | 'aliases' | 'triggers' | 'props' | 'description'> {
  pattern?: string;
}

export interface TriggerRow {
  trigger: Trigger;
  type?: string;
  keys: string[];
  description: string;
  kinds: string[];
  alsoOn?: string[];
}

type TriggerDoc = Pick<TriggerRow, 'trigger' | 'keys' | 'description' | 'alsoOn'>;

export interface KindTableResult {
  kinds: Kind[];
  triggers: TriggerRow[];
}

export class KindTable {
  private static readonly TRIGGERS: readonly TriggerDoc[] = [
    { trigger: 'none', keys: [], description: 'plain event; the default for start/end/throw events in `add` (`retype` keeps the current trigger unless the suffix :none is given)' },
    { trigger: 'message', keys: ['message'], description: 'root bpmn:Message found by name, created when missing', alsoOn: ['sendTask', 'receiveTask'] },
    { trigger: 'timer', keys: ['timer'], description: 'R/PT1H -> timeCycle, PT2D -> timeDuration, 2026-01-31T09:00:00Z -> timeDate (auto-classified)' },
    { trigger: 'error', keys: ['error', 'errorCode'], description: 'root bpmn:Error by name, created when missing' },
    { trigger: 'signal', keys: ['signal'], description: 'root bpmn:Signal by name, created when missing' },
    { trigger: 'escalation', keys: ['escalation', 'escalationCode'], description: 'root bpmn:Escalation by name, created when missing' },
    { trigger: 'conditional', keys: ['when'], description: 'condition expression' },
    { trigger: 'link', keys: ['link'], description: 'a throwing and a catching link event pair up by name' },
    { trigger: 'compensate', keys: [], description: 'compensation' },
    { trigger: 'terminate', keys: [], description: 'terminate end event' },
    { trigger: 'cancel', keys: [], description: 'transaction cancel' },
  ];

  constructor(private readonly conventions?: IdConventions) {}

  private static kindOf({ kind, type, family, aliases, triggers, props, description }: KindDefinition, pattern: string | undefined): Kind {
    return { kind, type, family, aliases, ...(pattern ? { pattern } : {}), ...(triggers ? { triggers } : {}), ...(props ? { props } : {}), description };
  }

  private static triggerOf({ trigger, ...doc }: TriggerDoc): TriggerRow {
    const definition = trigger === 'none' ? undefined : Triggers.TABLE[trigger].definition;
    const kinds = Kinds.ALL.filter(({ triggers }) => triggers?.includes(trigger)).map(({ kind }) => kind);
    return { trigger, ...(definition ? { type: definition } : {}), ...doc, kinds };
  }

  answer(): KindTableResult {
    const patterns = new ConventionsTable(this.conventions).patterns();
    return { kinds: Kinds.ALL.map((definition) => KindTable.kindOf(definition, patterns.get(definition.kind))), triggers: KindTable.TRIGGERS.map(KindTable.triggerOf) };
  }
}
