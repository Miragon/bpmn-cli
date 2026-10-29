import type { BpmnModdle, ImportWarning } from 'bpmn-moddle';
import type { Doc } from '../../../../../domain/document/Doc.js';
import type { DocumentNamespaces } from '../../../../../domain/document/vendor/DocumentNamespaces.js';
import type { ProfileFinding } from '../../../../../domain/document/Finding.js';
import type { EnginePlatformInfo } from '../../../../../domain/validation/EngineLint.js';
import { lint as lintRules, type RuleEntry } from '@miragon/bpmnlint-plugin-rules/engine';
import type { BpmnlintEngineReport } from '../../bpmnlint-contract.js';
import type { EngineKit } from '../../engine-kit.js';
import type { Findings } from '../rules/CamundaRule.js';
import { WrittenModel } from '../rules/support/WrittenModel.js';
import { CompatVerdicts } from './CompatVerdicts.js';
import { EngineFindings } from './EngineFindings.js';

type Engine = EnginePlatformInfo['platform'];

/** One engine's rules for an engine version and the moddle extension they read, as `rules/c7` and `rules/c8` build them. */
export interface EngineEntry {
  moddleExtensions: Record<string, unknown>;
  /** The findings of bpmn-cli's rules, with their codes and impacts. */
  findings: Findings;
  rules(version: string | undefined): RuleEntry[];
  writtenFileRules: ReadonlySet<string>;
  /** What the rules need of the file that the parse for them no longer shows. */
  afterParse?(definitions: unknown, warnings: readonly ImportWarning[], vendor: { operaton: boolean; prefix: string }): void;
}

const ENGINE_NAMES: Record<Engine, string> = { c7: 'Camunda 7', c8: 'Camunda 8' };
const EXECUTION_PLATFORMS: Record<Engine, string> = { c7: 'Camunda Platform', c8: 'Camunda Cloud' };

/**
 * One engine's rules on a document, loaded on demand: camunda-compat's config for the file's
 * engine version and bpmn-cli's own rules, on the document parsed again
 * with the engine's moddle extension. What that parse drops or rewrites (unknown vendor elements,
 * unprefixed attributes, booleans, publishMessage) the rules read in the file as written.
 */
export class EngineRun {
  private readonly moddle: BpmnModdle;

  constructor(
    private readonly kit: EngineKit,
    private readonly engine: Engine,
    private readonly entry: EngineEntry,
  ) {
    this.moddle = new kit.BpmnModdle(entry.moddleExtensions);
  }

  async findings(doc: Doc, info: EnginePlatformInfo): Promise<ProfileFinding[]> {
    const ns = new this.kit.DocumentNamespaces(doc);
    const { rootElement, elementsById, warnings } = await this.moddle.fromXML(this.lintedXml(await doc.toXml(), info, ns));
    this.entry.afterParse?.(rootElement, warnings, this.vendor(ns, info));
    WrittenModel.record(rootElement, { definitions: doc.definitions, namespaces: ns, decisionLinks: new this.kit.DecisionLinkReader(doc) });
    (rootElement as unknown as { $attrs: Record<string, unknown> }).$attrs['modeler:executionPlatform'] = EXECUTION_PLATFORMS[this.engine];
    const verdicts = new CompatVerdicts(this.kit, this.engine, doc, elementsById, info.version);
    const results = lintRules(rootElement, verdicts.rules(this.entry.rules(info.version))) as Record<string, BpmnlintEngineReport[]>;
    const failures = this.failuresOf(results);
    verdicts.apply(results);
    const lint = new EngineFindings(this.kit, this.engine, elementsById, this.entry, (id, key) => this.spelling(doc, ns, id, key), ns.prefixOf(this.kit.ZEEBE.uri) ?? 'zeebe').of(results);
    const failed = [...failures].map(([rule, message]) => this.kit.makeFinding('practice', 'W_LINT_FAILED', `The ${ENGINE_NAMES[this.engine]} rule ${rule} failed: ${message}; its findings are left out`, undefined, { subject: `failed:${rule}`, hint: 'Report the file and the rule: it is a bug of the rule, not of the model.' }));
    return this.inDocumentOrder(doc, [...lint, ...failed]);
  }

  /** Operaton reads its own namespace like the camunda one: the rules read the camunda properties. */
  private lintedXml(xml: string, info: EnginePlatformInfo, ns: DocumentNamespaces): string {
    if (!info.operaton) return xml;
    const camundaPrefix = ns.prefixOf(this.kit.CAMUNDA_URI);
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
  private vendor(ns: DocumentNamespaces, info: EnginePlatformInfo): { operaton: boolean; prefix: string } {
    const uri = info.operaton ? this.kit.OPERATON_URI : this.kit.CAMUNDA_URI;
    return { operaton: !!info.operaton, prefix: ns.prefixOf(uri) ?? 'camunda' };
  }

  /** The file's spelling of a vendor attribute the typed parse names with its package prefix. */
  private spelling(doc: Doc, ns: DocumentNamespaces, id: string, key: string): string {
    const local = key.slice(key.indexOf(':') + 1);
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

  /** A rule that threw reports one rule-error and no findings: it is named in a finding of its own. */
  private failuresOf(results: Record<string, BpmnlintEngineReport[]>): Map<string, string> {
    const failures = new Map<string, string>();
    for (const [rule, reports] of Object.entries(results)) {
      const failure = reports.find((report) => report.category === 'rule-error');
      if (!failure) continue;
      failures.set(rule, String(failure.message ?? '').split('\n')[0] ?? '');
      delete results[rule];
    }
    return failures;
  }
}
