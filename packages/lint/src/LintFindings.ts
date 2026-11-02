export type LintPlatform = 'c7' | 'c8' | 'none';
export type LintSeverity = 'error' | 'warning';

export interface ReportedImportWarning { message: string }

export interface LintFinding {
  code: string;
  severity: LintSeverity;
  message: string;
  element?: string;
  hint?: string;
}

export interface LintUnavailable {
  kind: 'config' | 'rule' | 'moddle' | 'file';
  name: string;
  pkg: string;
  reason: string;
  hint?: string;
}

export interface LintReport { id?: string | number | null; message: string; category: string }

export interface ModdleNode {
  $type?: string;
  id?: string;
  rootElements?: ModdleNode[];
  flowElements?: ModdleNode[];
  sourceRef?: ModdleNode;
  targetRef?: ModdleNode;
  $instanceOf?(type: string): boolean;
}

export interface ParseWarning { message: string; property?: string; element?: ModdleNode }

interface FlowEnds { incoming: Set<string>; outgoing: Map<string, number> }

const CONTRADICTED_LISTS: Record<string, (id: string, ends: FlowEnds) => boolean> = {
  'no-implicit-end': (id, ends) => ends.outgoing.has(id),
  'no-implicit-start': (id, ends) => ends.incoming.has(id),
  'no-disconnected': (id, ends) => ends.outgoing.has(id) || ends.incoming.has(id),
  'event-based-gateway': (id, ends) => (ends.outgoing.get(id) ?? 0) >= 2,
};

const IMPORT_HINT =
  "bpmnlint parses the file with the .bpmnlintrc's moddle extensions only and reports this as an error; bpmnlint in CI fails on it too. Fix the XML the message names: an unknown attribute needs a moddle extension that declares it (a JSON descriptor in moddleExtensions) or goes (`bpmn set <file> <id> <attr>=`), a reference needs the element it names. --no-lint-config skips bpmnlint.";

const DECISION_LINK_HINT =
  "bpmn-cli's decision link in a model without an engine (an unprefixed calledDecision on a business rule task): keep it. bpmnlint does not know the attribute and fails on it in CI too; a JSON descriptor in the .bpmnlintrc's moddleExtensions that adds calledDecision (isAttr) to bpmn:BusinessRuleTask declares it.";

const NOT_LINTED_HINT = "No rule ran. Check the .bpmnlintrc's moddleExtensions (a descriptor bpmnlint cannot load fails in CI too); else report the file and the .bpmnlintrc. --no-lint-config skips bpmnlint.";

export class LintFindings {
  private readonly knownImportWarnings: Set<string>;

  constructor(
    private readonly platform: LintPlatform,
    importWarnings: readonly ReportedImportWarning[],
  ) {
    this.knownImportWarnings = new Set(importWarnings.map(({ message }) => LintFindings.firstLine(message)));
  }

  static firstLine(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.split('\n')[0] ?? message;
  }

  static ofUnavailable(parts: readonly LintUnavailable[]): LintFinding[] {
    const groups = new Map<string, LintUnavailable[]>();
    for (const part of parts) {
      const key = `${part.kind === 'config' || part.kind === 'rule' ? 'package' : part.kind}|${part.pkg}|${part.reason}`;
      groups.set(key, [...(groups.get(key) ?? []), part]);
    }
    return [...groups.values()].map((group) => LintFindings.ofUnavailableGroup(group));
  }

  ofFailure(error: unknown): LintFinding {
    return { severity: 'warning', code: 'W_LINT_FAILED', message: `bpmnlint could not lint the model: ${LintFindings.firstLine(error)}`, hint: NOT_LINTED_HINT };
  }

  ofReports(results: Record<string, LintReport[]>, root: ModdleNode, failures: Map<string, string>): LintFinding[] {
    const ends: FlowEnds = { incoming: new Set(), outgoing: new Map() };
    (root.rootElements ?? []).forEach((element) => LintFindings.collectFlowEnds(element, ends));
    const findings: LintFinding[] = [];
    for (const [rule, reports] of Object.entries(results)) {
      for (const report of failures.has(rule) ? [] : reports) {
        if (report.category === 'rule-error') {
          failures.set(rule, LintFindings.firstLine(report.message));
        } else {
          findings.push(LintFindings.ofReport(rule, report, ends));
        }
      }
    }
    return [...findings, ...[...failures].map(([rule, reason]) => LintFindings.ofFailedRule(rule, reason))];
  }

  ofImportWarnings(warnings: readonly ParseWarning[]): LintFinding[] {
    const unknown = warnings.filter(({ message }) => !this.knownImportWarnings.has(LintFindings.firstLine(message)));
    return unknown.map((warning) => ({
      severity: 'error',
      code: 'import-warning',
      message: `Import warning: ${LintFindings.firstLine(warning.message)}`,
      ...LintFindings.elementOf(warning.element?.id),
      hint: this.isDecisionLink(warning) ? DECISION_LINK_HINT : IMPORT_HINT,
    }));
  }

  private isDecisionLink({ property, element }: ParseWarning): boolean {
    return this.platform === 'none' && property === 'calledDecision' && element?.$instanceOf?.('bpmn:BusinessRuleTask') === true;
  }

  private static ofUnavailableGroup(group: LintUnavailable[]): LintFinding {
    const [{ kind, pkg, reason, hint }] = group as [LintUnavailable];
    const names = group.map(({ name }) => name).join(', ');
    const messages = { file: `${reason}; bpmnlint did not run`, moddle: `moddle extension ${names} (${pkg}) left out: ${reason}; rules reading its properties may report findings that are not there` };
    const message = kind === 'file' || kind === 'moddle' ? messages[kind] : `${names} left out: ${reason}`;
    return { severity: 'warning', code: 'W_LINT_UNAVAILABLE', message, ...(hint ? { hint } : {}) };
  }

  private static ofFailedRule(rule: string, reason: string): LintFinding {
    return { severity: 'warning', code: 'W_LINT_FAILED', message: `bpmnlint rule ${rule} failed: ${reason}; its findings are left out`, hint: 'Fix the rule or its options in the .bpmnlintrc; --no-lint-config skips bpmnlint.' };
  }

  private static ofReport(rule: string, report: LintReport, ends: FlowEnds): LintFinding {
    const id = report.id === undefined || report.id === null ? undefined : String(report.id);
    const contradicted = id !== undefined && CONTRADICTED_LISTS[rule]?.(id, ends) === true;
    return {
      severity: report.category === 'error' ? 'error' : 'warning',
      code: rule,
      message: String(report.message),
      ...LintFindings.elementOf(id),
      ...(contradicted ? { hint: `The element has sequence flows the file does not list under incoming / outgoing, which ${rule} reads (bpmnlint in CI reports it too).` } : {}),
    };
  }

  private static elementOf(id: string | undefined): { element?: string } {
    return id ? { element: id } : {};
  }

  private static collectFlowEnds(element: ModdleNode, ends: FlowEnds): void {
    for (const child of element.flowElements ?? []) {
      if (child.$type === 'bpmn:SequenceFlow' && child.sourceRef?.id) {
        ends.outgoing.set(child.sourceRef.id, (ends.outgoing.get(child.sourceRef.id) ?? 0) + 1);
      }
      if (child.$type === 'bpmn:SequenceFlow' && child.targetRef?.id) {
        ends.incoming.add(child.targetRef.id);
      }
      LintFindings.collectFlowEnds(child, ends);
    }
  }
}
