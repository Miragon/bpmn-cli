import type { ProfileFinding, Severity } from '../../../../../domain/document/Finding.js';

import type { BpmnlintEngineReport } from '../../bpmnlint-contract.js';
import { EngineCodes } from './EngineCodes.js';
import { EngineHint } from './EngineHint.js';
import { ElementKinds } from '../rules/support/ElementKinds.js';
import type { EngineKit } from '../../engine-kit.js';
import type { EngineEntry } from './EngineRun.js';

/** The engine layers set what a finding means by its bpmnlint category. */
const SEVERITY_OF_CATEGORY: Record<string, Severity> = { error: 'deploy', warn: 'runtime', info: 'practice' };

const OWN_RULES = 'bpmn-cli/';

interface ModdleNode {
  $type?: string;
  id?: string;
  $instanceOf?: unknown;
  $parent?: ModdleNode;
  $descriptor?: { propertiesByName?: Record<string, { ns?: { prefix?: string } }> };
  extensionElements?: { values?: ModdleNode[] };
}

/**
 * The engine rules' bpmnlint reports as bpmn-cli findings: an own rule's code and severity from its
 * declaration, camunda-compat's code from its rule and severity from the category, the hint from `path` and `data.type`, and the subject (what a mutation tells
 * apart on one element) from the path, an extension element as `ext:<local>` and a vendor
 * attribute as `attr:<local>`, as the operation warnings name what they cover.
 */
export class EngineFindings {
  private readonly hint: EngineHint;

  /** `spelling`: the attribute as the file writes it (`operaton:assignee` for the parse's `camunda:assignee`). */
  constructor(
    private readonly kit: EngineKit,
    private readonly platform: 'c7' | 'c8',
    private readonly elementsById: Readonly<Record<string, unknown>>,
    private readonly entry: Pick<EngineEntry, 'codes' | 'writtenFileRules'>,
    private readonly spelling: (id: string, key: string) => string,
    private readonly zeebePrefix: string,
  ) {
    this.hint = new EngineHint(elementsById);
  }

  /**
   * One finding per subject of an element: where an own rule and camunda-compat both report it
   * (a misplaced zeebe:taskDefinition), the own rule's says what bpmn-cli's code says; where two
   * camunda-compat rules report it with one code (io-mapping and variable-name), the first says it.
   * The findings of the rules on the file as written follow, and tell no subject apart.
   */
  of(results: Record<string, BpmnlintEngineReport[]>): ProfileFinding[] {
    const out: ProfileFinding[] = [];
    const written: ProfileFinding[] = [];
    const ownSubjects = new Set<string>();
    const compat: Array<{ finding: ProfileFinding; identity: string }> = [];
    for (const [rule, reports] of Object.entries(results)) {
      for (const report of this.entry.writtenFileRules.has(rule) ? EngineFindings.inWrittenOrder(reports) : reports) {
        const [code, severity] = this.entry.codes[rule] ?? this.compatCodeOf(rule, report);
        const related = this.relatedIds(report);
        const subject = this.subjectOf(report);
        const finding = this.kit.makeFinding(severity, code, String(report.message), report.id ?? undefined, { hint: this.spelledHint(this.hint.of(report, rule), rule), subject, ...(related.length ? { related } : {}) });
        const identity = `${report.id ?? ''}|${subject}`;
        if (this.entry.writtenFileRules.has(rule)) {
          written.push(finding);
        } else if (rule.startsWith(OWN_RULES)) {
          if (subject) ownSubjects.add(identity);
          out.push(finding);
        } else {
          compat.push({ finding, identity });
        }
      }
    }
    const reported = new Set<string>();
    const firstOfSubject = ({ finding, identity }: { finding: ProfileFinding; identity: string }): boolean => {
      if (!finding.subject) return true;
      const key = `${identity}|${finding.code}`;
      if (ownSubjects.has(identity) || reported.has(key)) return false;
      reported.add(key);
      return true;
    };
    return [...out, ...compat.filter(firstOfSubject).map(({ finding }) => finding), ...written];
  }

  private static inWrittenOrder(reports: BpmnlintEngineReport[]): BpmnlintEngineReport[] {
    return [...reports].sort((left, right) => Number(left.data?.writtenAt) - Number(right.data?.writtenAt));
  }

  private compatCodeOf(rule: string, report: BpmnlintEngineReport): readonly [string, Severity] {
    const code = EngineCodes.codeOf(this.platform, rule, report);
    return [code, EngineCodes.RUNTIME.includes(code) ? 'runtime' : (SEVERITY_OF_CATEGORY[report.category] ?? 'runtime')];
  }

  private subjectOf(report: BpmnlintEngineReport): string {
    if (typeof report.data?.subject === 'string') return report.data.subject;
    const path = report.path ?? [];
    const at = path.indexOf('extensionElements');
    const host = report.id ? (this.elementsById[report.id] as ModdleNode | undefined) : undefined;
    if (at === 0 && path[1] === 'values' && typeof path[2] === 'number') {
      const type = host?.extensionElements?.values?.[path[2]]?.$type;
      const local = type?.slice(type.indexOf(':') + 1);
      if (local) {
        return [`ext:${ElementKinds.xmlName(local)}`, ...path.slice(3)].join('.');
      }
    }
    if (path.length === 1 && typeof path[0] === 'string') {
      return `attr:${report.id ? this.spelling(report.id, this.attributeKey(host, path[0])) : this.attributeKey(host, path[0])}`;
    }
    return path.join('.');
  }

  /** A vendor attribute as the operation warnings name it, with its prefix (`camunda:class`). */
  private attributeKey(host: ModdleNode | undefined, name: string): string {
    if (name.includes(':')) return name;
    const prefix = host?.$descriptor?.propertiesByName?.[name]?.ns?.prefix;
    return prefix && prefix !== 'bpmn' ? `${prefix}:${name}` : name;
  }

  /** An event definition or loop of the reported element is part of it, not another element; a flow node in it is one. */
  private isInside(node: ModdleNode, id: string | undefined): boolean {
    for (let parent = node.$parent; parent; parent = parent.$parent) {
      if (parent.id === id) return true;
    }
    return false;
  }

  /** A camunda-compat hint names zeebe content as the file spells it; an own rule's hint does already. */
  private spelledHint(hint: string, rule: string): string {
    return this.zeebePrefix === 'zeebe' || rule.startsWith(OWN_RULES) ? hint : hint.replace(/\bzeebe:/g, `${this.zeebePrefix}:`);
  }

  private isFlowElement(node: ModdleNode): boolean {
    return (node.$instanceOf as ((type: string) => boolean) | undefined)?.('bpmn:FlowElement') === true;
  }

  /** The other elements a report names in its data (a referenced host, a gateway's flow, a duplicate). */
  private relatedIds(report: BpmnlintEngineReport): string[] {
    const ids = new Set<string>();
    for (const value of Object.values(report.data ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) {
        const id = item && typeof item === 'object' && typeof (item as ModdleNode).$instanceOf === 'function' ? (item as ModdleNode).id : undefined;
        if (id && id !== report.id && !(this.isInside(item as ModdleNode, report.id) && !this.isFlowElement(item as ModdleNode))) {
          ids.add(id);
        }
      }
    }
    return [...ids];
  }
}
