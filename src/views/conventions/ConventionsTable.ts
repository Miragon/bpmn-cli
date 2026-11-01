import { IdDefaults, IdRequests, IdStyle, Kinds, type IdConventions, type IdRequest, type PrefixSource, type ValidatorFinding } from '../../model/index.js';
import { ConventionsTableText, type ConventionsFacts, type ConventionsRow, type Undeclared } from './ConventionsTableText.js';

export interface ConventionsOptions {
  file?: string | undefined;
  exists?: boolean | undefined;
  severity?: string | undefined;
  notes?: ValidatorFinding[] | undefined;
  where?: string | undefined;
  undeclared?: Undeclared | undefined;
}

export interface ConventionsResult extends ConventionsFacts {
  text: string;
}

type GroupedRow = ConventionsRow & { concrete: string };

export class ConventionsTable {
  static readonly UNQUALIFIED_NOTE = 'qualified prefix ignored, new ids take the plain one (W_CONFIG_IGNORED)';

  private static readonly IGNORED_NOTE = 'checked; prefix ignored (W_CONFIG_IGNORED)';
  private static readonly ROOT_TYPES = ['bpmn:Process', 'bpmn:Collaboration', 'bpmn:Message'];
  private static readonly QUALIFIED_EXAMPLES = ['bpmn:StartEvent:timer', 'bpmn:BoundaryEvent:message', 'bpmn:EndEvent:error'];

  private readonly style: IdStyle;
  private readonly groups: GroupedRow[] = [];

  constructor(private readonly conventions?: IdConventions) {
    this.style = IdStyle.of(conventions);
    for (const definition of Kinds.ALL) {
      this.element(definition.kind, definition.type, IdRequests.kindRequest(definition));
    }
    for (const type of ConventionsTable.ROOT_TYPES) {
      this.element(type.charAt(5).toLowerCase() + type.slice(6), type, IdRequests.typeRequest(type));
    }
    this.flow('sequenceFlow', 'bpmn:SequenceFlow');
    this.flow('messageFlow', 'bpmn:MessageFlow');
  }

  patterns(): Map<string, string> {
    return new Map(this.groups.flatMap(({ kinds, pattern }) => kinds.map((kind): [string, string] => [kind, pattern.replace(/<kind>|<Kind>/, (word) => (word === '<kind>' ? kind : kind.charAt(0).toUpperCase() + kind.slice(1)))])));
  }

  answer({ file, exists = true, severity, notes = [], where, undeclared }: ConventionsOptions = {}): ConventionsResult {
    const declared = this.conventions;
    const followed = declared ?? IdDefaults.CONVENTIONS;
    const examples = ConventionsTable.QUALIFIED_EXAMPLES.flatMap((key) => followed.prefixes[key] ?? []);
    const mode = followed.qualifier ?? 'optional';
    const result = {
      file,
      exists,
      source: declared?.source ?? where,
      rule: declared ? { severity: severity ?? 'warn', case: declared.case ?? 'any', qualifier: mode } : undefined,
      undeclared: declared ? undefined : undeclared,
      rows: this.groups.map(({ concrete, ...row }) => (row.kinds.length === 1 ? { ...row, pattern: concrete } : row)),
      qualified: mode !== 'off' && examples.length ? { mode, examples } : undefined,
      notes,
    };
    return { text: new ConventionsTableText(result).text(), ...result };
  }

  private add(kind: string, concrete: string, pattern: string, source: PrefixSource, note?: string): void {
    const row = this.groups.find((candidate) => candidate.pattern === pattern && candidate.source === source && candidate.note === note);
    if (row) {
      row.kinds.push(kind);
    } else {
      this.groups.push({ concrete, pattern, source, kinds: [kind], note });
    }
  }

  private element(kind: string, type: string, request: IdRequest): void {
    const { head, source, body } = this.style.explain(request);
    const ownPrefix = /^[a-z]/.test(head) ? '<kind>_' : '<Kind>_';
    const own = head.toLowerCase() === `${kind.toLowerCase()}_` ? ownPrefix : head;
    const tail = `{name:${body}}`;
    this.add(kind, `${head}${tail}`, `${own}${tail}`, source, source === 'bpmn-cli' ? this.unchecked(type, head) : this.unqualified(type));
  }

  private flow(kind: string, type: string): void {
    const { head, source, body } = this.style.explain(IdRequests.typeRequest(type));
    const joins: Partial<Record<typeof body, string>> = { snake: '_to_', kebab: '-to-' };
    const pattern = `${head}{source}${joins[body] ?? 'To'}{target}`;
    this.add(kind, pattern, pattern, source, source === 'bpmn-cli' ? this.unchecked(type, head) : undefined);
  }

  private unchecked(type: string, head: string): string {
    const checked = this.conventions?.ignored?.includes(type) ? ConventionsTable.IGNORED_NOTE : 'not checked';
    return head === '' ? `${checked}; unnamed: Process_1` : checked;
  }

  private unqualified(type: string): string | undefined {
    const triggers = (this.conventions?.ignored ?? []).filter((key) => key.startsWith(`${type}:`)).map((key) => key.slice(type.length + 1));
    return triggers.length ? `${triggers.join(', ')}: ${ConventionsTable.UNQUALIFIED_NOTE}` : undefined;
  }
}
