import type { BpmnModdle, ImportWarning } from 'bpmn-moddle';
import type { Doc } from '../../../../domain/document/Doc.js';
import type { ProfileFinding } from '../../../../domain/document/Finding.js';
import type { EnginePlatformInfo } from '../../../../domain/validation/EngineLint.js';
import type { BpmnlintConfig, BpmnlintEngineReport, BpmnlintLinterClass, BpmnlintResolver, BpmnlintRule } from '../bpmnlint-contract.js';
import type { EngineKit } from '../engine-kit.js';
import { CamundaBooleans } from './CamundaBooleans.js';
import { CompatVerdicts } from './CompatVerdicts.js';
import { EngineFindings } from './EngineFindings.js';
import { PublishMessages } from './PublishMessages.js';
import { SchemaText, type SchemaTextIssue } from './SchemaText.js';
import { SchemaTextFindings } from './SchemaTextFindings.js';
import { UnknownVendorElements } from './UnknownVendorElements.js';
import { UnprefixedAttributes } from './UnprefixedAttributes.js';

type Engine = EnginePlatformInfo['platform'];

/** One engine's rules and their config, as `rules/c7` and `rules/c8` build them. */
export interface EngineEntry {
  createResolver(): BpmnlintResolver;
  lintConfig(version?: string): BpmnlintConfig;
  /** What the rules need of the file that the parse for them no longer shows. */
  afterParse?(definitions: unknown, warnings: readonly ImportWarning[], vendor: { operaton: boolean; prefix: string }): void;
}

const ENGINE_NAMES: Record<Engine, string> = { c7: 'Camunda 7', c8: 'Camunda 8' };
const EXECUTION_PLATFORMS: Record<Engine, string> = { c7: 'Camunda Platform', c8: 'Camunda Cloud' };

/**
 * Where bpmn-cli reads camunda-compat's severity differently: a user task needs no form to run,
 * and a job worker user task works (the engines' layers would say runtime for both); Camunda 7.20+
 * refuses a process without a history time to live unless the engine sets a default.
 * c8-feel-expression checks FEEL with the grammar Camunda 8 accepts, names and values without = too.
 */
const SEVERITY_OVERRIDES: Record<Engine, Record<string, string>> = {
  c7: { 'camunda-compat/history-time-to-live': 'error' },
  c8: {
    'camunda-compat/feel': 'off',
    'camunda-compat/user-task-definition': 'off',
    'camunda-compat/zeebe-user-task': 'info',
  },
};

/** It reports a send task with a zeebe:publishMessage as one without an implementation. */
const COMPAT_IMPLEMENTATION = 'camunda-compat/implementation';
const C7_MULTI_INSTANCE = 'bpmn-cli/c7-multi-instance';
/** Rules of camunda-compat's configs that do not skip the processes the engine does not run. */
const EXECUTABLE_ONLY = ['start-event-required', 'camunda-compat/history-time-to-live'];

/**
 * One engine's rules on a document, loaded on demand: camunda-compat's config for the file's
 * engine version and bpmn-cli's own rules, on the document parsed again
 * with the engine's moddle extension. The checks a typed parse cannot see (unknown vendor
 * elements, unprefixed attributes, publishMessage, the schema rules of the file's text) are
 * bpmn-cli's own.
 */
export class EngineRun {
  private readonly moddle: BpmnModdle;
  /** read once per text: an edit lints before and after */
  private readonly textIssues = new WeakMap<object, SchemaTextIssue[]>();

  constructor(
    private readonly kit: EngineKit,
    private readonly engine: Engine,
    private readonly entry: EngineEntry,
    private readonly Linter: BpmnlintLinterClass,
  ) {
    this.moddle = new kit.BpmnModdle(entry.lintConfig().moddleExtensions as Record<string, unknown>);
  }

  async findings(doc: Doc, info: EnginePlatformInfo): Promise<ProfileFinding[]> {
    const engineConfig = this.entry.lintConfig(info.version);
    const config = { ...engineConfig, rules: { ...engineConfig.rules, ...SEVERITY_OVERRIDES[this.engine] } };
    const { rootElement, elementsById, warnings } = await this.moddle.fromXML(this.lintedXml(await doc.toXml(), info, doc));
    this.entry.afterParse?.(rootElement, warnings, this.vendor(doc, info));
    (rootElement as unknown as { $attrs: Record<string, unknown> }).$attrs['modeler:executionPlatform'] = EXECUTION_PLATFORMS[this.engine];
    const failures = new Map<string, string>();
    const linter = new this.Linter({ config, resolver: this.entry.createResolver(), transformRule: (rule, { pkg, ruleName }) => this.guarded(rule, `${pkg}/${ruleName}`, failures) });
    const results = (await linter.lint(rootElement)) as Record<string, BpmnlintEngineReport[]>;
    for (const rule of Object.keys(results)) results[rule] = results[rule]!.filter((report) => report.category !== 'rule-error');
    this.withoutUnresolvedLoopInputs(results, warnings);
    this.withoutNonExecutableProcesses(results, doc);
    const published = this.engine === 'c8' ? new PublishMessages(this.kit, doc) : undefined;
    const ownFindings = published ? published.findings() : new CamundaBooleans(this.kit, doc).findings();
    if (published) {
      this.withoutPublishedImplementations(results, published);
      new CompatVerdicts(elementsById, info.version).apply(results);
    }
    const unprefixed = new UnprefixedAttributes(this.kit, doc, this.engine).findings();
    const schemaKeys = new Set(unprefixed.map((finding) => `${finding.element}|${finding.subject!.replace(/^schema:/, 'attr:')}`));
    const lint = new EngineFindings(this.kit, this.engine, elementsById, (id, key) => this.spelling(doc, id, key), new this.kit.DocumentNamespaces(doc).prefixOf(this.kit.ZEEBE.uri) ?? 'zeebe').of(results);
    const findings = [
      ...lint.filter((finding) => !(finding.code === 'W_C8_DEPLOY_SCHEMA' && schemaKeys.has(`${finding.element}|${finding.subject}`))),
      ...unprefixed,
      ...ownFindings,
      ...[...failures].map(([rule, message]) => this.kit.makeFinding('practice', 'W_LINT_FAILED', `The ${ENGINE_NAMES[this.engine]} rule ${rule} failed: ${message}; its findings are left out`, undefined, { subject: `failed:${rule}`, hint: 'Report the file and the rule: it is a bug of the rule, not of the model.' })),
      ...new UnknownVendorElements(this.kit, doc, this.engine).findings(),
      ...(this.engine === 'c8' ? new SchemaTextFindings(this.kit, doc).findings(this.schemaTextIssues(doc)) : []),
    ];
    return this.inDocumentOrder(doc, findings);
  }

  /** Operaton reads its own namespace like the camunda one: the rules read the camunda properties. */
  private lintedXml(xml: string, info: EnginePlatformInfo, doc: Doc): string {
    if (!info.operaton) return xml;
    const camundaPrefix = new this.kit.DocumentNamespaces(doc).prefixOf(this.kit.CAMUNDA_URI);
    const shadowed = camundaPrefix ? this.withoutCamundaElements(xml, camundaPrefix) : xml;
    return shadowed.replaceAll(`"${this.kit.OPERATON_URI}"`, `"${this.kit.CAMUNDA_URI}"`);
  }

  /**
   * Operaton reads its own namespace: the rules read it as camunda's. In a file that declares both,
   * the camunda extension elements go out of their sight (else one of each reads as doubled), while
   * camunda attributes stay, which Operaton reads when the operaton one is missing.
   */
  private withoutCamundaElements(xml: string, prefix: string): string {
    const shadow = `${prefix}-read-after-operaton`;
    return xml.replace(new RegExp(`<(/?)${prefix}:`, 'g'), `<$1${shadow}:`).replace(/<([\w-]+:)?definitions\b/, (start) => `${start} xmlns:${shadow}="${this.kit.CAMUNDA_URI}#read-after-operaton"`);
  }

  /** The Camunda 7 vendor and the prefix of the content the rules read. */
  private vendor(doc: Doc, info: EnginePlatformInfo): { operaton: boolean; prefix: string } {
    const uri = info.operaton ? this.kit.OPERATON_URI : this.kit.CAMUNDA_URI;
    return { operaton: !!info.operaton, prefix: new this.kit.DocumentNamespaces(doc).prefixOf(uri) ?? 'camunda' };
  }

  /** The file's spelling of a vendor attribute the typed parse names with its package prefix. */
  private spelling(doc: Doc, id: string, key: string): string {
    const local = key.slice(key.indexOf(':') + 1);
    const ns = new this.kit.DocumentNamespaces(doc);
    const written = Object.keys(doc.get(id)?.$attrs ?? {}).find((name) => {
      const uri = ns.uriOfName(name);
      return name.slice(name.indexOf(':') + 1) === local && uri !== undefined && this.kit.C7_URIS.has(uri);
    });
    return written ?? key;
  }

  /** Grouped by element in the order of the file, as `bpmn validate` lists the other findings. */
  private inDocumentOrder(doc: Doc, findings: ProfileFinding[]): ProfileFinding[] {
    const position = new Map<string, number>();
    for (const el of this.kit.walk(doc.definitions)) {
      const id = (el as { id?: unknown }).id;
      if (typeof id === 'string' && !position.has(id)) position.set(id, position.size);
    }
    const at = (finding: ProfileFinding): number => (finding.element !== undefined ? (position.get(finding.element) ?? -1) : -1);
    return findings.map((finding, index) => ({ finding, index })).sort((left, right) => at(left.finding) - at(right.finding) || left.index - right.index).map(({ finding }) => finding);
  }

  /**
   * A loopDataInputRef may name a process variable Camunda 7 resolves, not an id of the file: the
   * parse drops it, and c7-multi-instance then reads the loop as one without a collection.
   */
  private withoutUnresolvedLoopInputs(results: Record<string, BpmnlintEngineReport[]>, warnings: ImportWarning[]): void {
    const reports = results[C7_MULTI_INSTANCE];
    if (!reports) return;
    const loops = new Set(warnings.filter((warning) => warning.property === 'bpmn:loopDataInputRef').map((warning) => (warning.element as { $parent?: { id?: string } } | undefined)?.$parent?.id));
    results[C7_MULTI_INSTANCE] = reports.filter((report) => !loops.has(report.id));
  }

  /** The engines check executable processes only: a missing start event or history time to live elsewhere is no finding. */
  private withoutNonExecutableProcesses(results: Record<string, BpmnlintEngineReport[]>, doc: Doc): void {
    for (const rule of EXECUTABLE_ONLY) {
      const reports = results[rule];
      if (!reports) continue;
      results[rule] = reports.filter((report) => {
        let el = report.id ? doc.get(report.id) : undefined;
        while (el && !this.kit.is(el, 'bpmn:Process')) el = el.$parent as typeof el;
        return !el || this.kit.peek<boolean>(el, 'isExecutable') === true;
      });
    }
  }

  /** A zeebe:publishMessage (its findings read first) is the implementation the typed parse dropped. */
  private withoutPublishedImplementations(results: Record<string, BpmnlintEngineReport[]>, published: PublishMessages): void {
    const reports = results[COMPAT_IMPLEMENTATION];
    if (reports) results[COMPAT_IMPLEMENTATION] = reports.filter((report) => !report.id || !published.hosts.has(report.id));
  }

  /** bpmnlint would print a throwing rule to stderr; its findings are left out instead. */
  private guarded(rule: BpmnlintRule, name: string, failures: Map<string, string>): BpmnlintRule {
    const check = rule?.check;
    if (typeof check !== 'function') return rule;
    return {
      ...rule,
      check: (...args: unknown[]) => {
        if (failures.has(name)) return false;
        try {
          return (check as (...checkArgs: unknown[]) => unknown)(...args);
        } catch (err) {
          failures.set(name, String((err as Error)?.message ?? err).split('\n')[0] ?? '');
          return false;
        }
      },
    };
  }

  private schemaTextIssues(doc: Doc): SchemaTextIssue[] {
    const source = doc.source;
    if (!source) return [];
    let issues = this.textIssues.get(source);
    if (!issues) {
      issues = new SchemaText(this.kit).issues(source.text, doc.moddle);
      this.textIssues.set(source, issues);
    }
    return issues;
  }
}
