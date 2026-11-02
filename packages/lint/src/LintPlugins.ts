import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { createBundledResolver, getDefaultLintConfig } from '@miragon/bpmnlint-plugin-rules';
import { LintConfig, type PluginsOff } from './LintConfig.js';
import { LintFindings, type LintReport, type LintUnavailable, type ModdleNode, type ParseWarning } from './LintFindings.js';

export interface LintResolver {
  resolveRule(pkg: string, ruleName: string): unknown;
  resolveConfig(pkg: string, configName: string): unknown;
}

export interface LintRule { check?: unknown }

export interface Linter {
  lint(root: unknown): Promise<Record<string, LintReport[]>>;
  resolveConfig(name: string): Promise<Record<string, unknown>>;
  normalizeConfig(config: { rules: Record<string, unknown> }, localPackage: string): { rules: Record<string, unknown> };
  parseRuleName(name: string): { pkg: string; ruleName: string };
  parseConfigName(name: string): { pkg: string };
  parseRuleValue(value: unknown): { category: unknown; config: unknown };
}

export interface LinterOptions {
  config?: { rules: Record<string, unknown> };
  resolver: LintResolver;
  transformRule?: (rule: LintRule, info: { pkg: string; ruleName: string }) => LintRule;
}

export interface LintModdle { fromXML(xml: string): Promise<{ rootElement: ModdleNode; warnings?: ParseWarning[] }> }

interface LintLibraries {
  Linter: new (options: LinterOptions) => Linter;
  NodeResolver: new (options: { require: ProjectRequire }) => LintResolver;
  BpmnModdle: new (descriptors: Record<string, object>) => LintModdle;
}

type ProjectRequire = ((id: string) => unknown) & { resolve(id: string): string };
type Answer = 'rule' | 'config';

const PLUGIN = '@miragon/bpmnlint-plugin-rules';
const OWN_PACKAGE = 'bpmnlint';
const SHIPPED = new Set(['bpmnlint-plugin-camunda-compat', PLUGIN]);
const REQUIRE_ANCHOR = '__bpmn-cli__.js';
const OWN_REQUIRE = createRequire(import.meta.url) as ProjectRequire;
const KNOWN_DESCRIPTORS: Record<string, { engine: 'c7' | 'c8'; prefix: string }> = {
  'camunda-bpmn-moddle/resources/camunda': { engine: 'c7', prefix: 'camunda' },
  'zeebe-bpmn-moddle/resources/zeebe': { engine: 'c8', prefix: 'zeebe' },
};

export class LintPlugins implements LintResolver {
  readonly unavailable: LintUnavailable[] = [];
  private readonly libraries: LintLibraries = LintPlugins.loadLibraries();
  private readonly projectRequire: ProjectRequire;
  private readonly off: PluginsOff | undefined;
  private readonly loadFailures = new Map<string, string>();
  private readonly descriptors: Record<string, object> = {};
  private readonly project = LintPlugins.once(() => new this.libraries.NodeResolver({ require: this.boundedRequire() }));
  private readonly own = LintPlugins.once(() => new this.libraries.NodeResolver({ require: OWN_REQUIRE }));
  private readonly bundled = LintPlugins.once((): LintResolver => createBundledResolver());
  private readonly shipped = LintPlugins.once(() => new this.libraries.NodeResolver({ require: createRequire(OWN_REQUIRE.resolve(PLUGIN)) as ProjectRequire }));

  constructor(private readonly config: LintConfig) {
    this.off = config.pluginsOff();
    this.projectRequire = createRequire(join(config.directory, REQUIRE_ANCHOR)) as ProjectRequire;
    this.readDescriptors();
  }

  linter(options: Partial<LinterOptions> = {}): Linter {
    return new this.libraries.Linter({ resolver: this, ...options });
  }

  moddle(): LintModdle {
    return new this.libraries.BpmnModdle(this.descriptors);
  }

  resolveRule(pkg: string, ruleName: string): Promise<unknown> {
    return this.lookUp('rule', pkg, ruleName);
  }

  resolveConfig(pkg: string, configName: string): Promise<unknown> {
    return this.lookUp('config', pkg, configName);
  }

  private async lookUp(kind: Answer, pkg: string, name: string): Promise<unknown> {
    for (const resolver of this.resolversOf(pkg)) {
      try {
        const answer = await (kind === 'rule' ? resolver().resolveRule(pkg, name) : resolver().resolveConfig(pkg, name));
        if (answer) {
          return answer;
        }
      } catch {}
    }
    throw this.reason(kind, pkg, name);
  }

  private resolversOf(pkg: string): Array<() => LintResolver> {
    if (pkg === OWN_PACKAGE) {
      return [this.own];
    }
    const packaged = SHIPPED.has(pkg) ? [this.bundled, this.shipped] : [this.bundled];
    if (this.off) {
      return packaged;
    }
    return this.projectHas(pkg) ? [this.project] : [this.project, ...packaged];
  }

  private projectHas(pkg: string): boolean {
    const path = this.installedPath(pkg);
    return path !== undefined && this.config.holds(path);
  }

  private installedPath(pkg: string): string | undefined {
    try {
      return this.projectRequire.resolve(pkg);
    } catch {
      return undefined;
    }
  }

  private reason(kind: Answer, pkg: string, name: string): Error {
    if (pkg === OWN_PACKAGE) {
      return LintPlugins.failure(`bpmnlint has no ${kind} ${name}`, `Update bpmn-cli or remove the ${kind}.`);
    }
    const inRepository = this.projectHas(pkg);
    if (SHIPPED.has(pkg) && (this.off || !inRepository)) {
      const why = this.off && inRepository ? `, and ${this.off.why}` : '';
      return LintPlugins.failure(`${pkg} (bundled with bpmn-cli) has no ${kind} ${name}${why}`, this.off?.hint ?? `Check the name. A ${pkg} installed in the repository next to the .bpmnlintrc takes the bundled one's place.`);
    }
    const path = this.installedPath(pkg);
    if (this.off) {
      return LintPlugins.failure(`${pkg} is not bundled with bpmn-cli, and ${this.off.why}`, this.off.hint);
    }
    return path === undefined ? LintPlugins.failure(this.notInstalled(pkg), `Install it next to the .bpmnlintrc (npm i -D ${pkg}) or remove it from the configuration; ${LintConfig.SKIP_HINT}`) : this.installedReason(kind, pkg, name, path);
  }

  private installedReason(kind: Answer, pkg: string, name: string, path: string): Error {
    if (!this.config.holds(path)) {
      return LintPlugins.failure(`${pkg} resolves outside the repository (${path}); bpmn-cli loads project plugins only from inside ${this.config.root}`, `Install it inside the repository (npm i -D ${pkg}).`);
    }
    const failed = this.loadFailures.get(path);
    if (failed !== undefined) {
      return LintPlugins.failure(`${pkg} fails to load: ${failed}`, `Fix or reinstall ${pkg}; ${LintConfig.SKIP_HINT}`);
    }
    return LintPlugins.failure(`${pkg} has no ${kind} ${name}`, `Check the name and the installed version of ${pkg}.`);
  }

  private notInstalled(pkg: string): string {
    return `${pkg} is not installed (looked up from ${this.config.directory})`;
  }

  private boundedRequire(): ProjectRequire {
    const insideRepository = (id: string): string => {
      const path = this.projectRequire.resolve(id);
      if (!this.config.holds(path)) {
        throw new Error(`${id} resolves outside the repository (${path})`);
      }
      return path;
    };
    const bounded = (id: string): unknown => {
      const path = insideRepository(id);
      try {
        return this.projectRequire(path);
      } catch (error) {
        this.loadFailures.set(path, LintFindings.firstLine(error));
        throw error;
      }
    };
    return Object.assign(bounded, { resolve: insideRepository });
  }

  private readDescriptors(): void {
    const map = this.config.content['moddleExtensions'];
    if (typeof map === 'string') {
      this.unavailable.push({ kind: 'moddle', name: 'moddleExtensions', pkg: JSON.stringify(map), reason: 'it is not an object of prefix -> descriptor or module path (bpmnlint fails on the whole file with it)', hint: 'Write it as an object of prefix -> descriptor, e.g. { "camunda": "camunda-bpmn-moddle/resources/camunda.json" }.' });
    }
    const entries = map && typeof map === 'object' ? Object.entries(map) : [];
    for (const [prefix, value] of entries) {
      this.readDescriptor(prefix, value);
    }
    this.dropRejectedDescriptors(new Map(entries));
  }

  private readDescriptor(prefix: string, value: unknown): void {
    if (value && typeof value === 'object') {
      this.descriptors[prefix] = value;
    } else if (typeof value === 'string') {
      this.readDescriptorPath(prefix, value);
    } else {
      this.unavailable.push({ kind: 'moddle', name: prefix, pkg: JSON.stringify(value) ?? String(value), reason: 'neither a descriptor object nor a module path (bpmnlint fails on the whole file with it)', hint: 'Name the JSON descriptor (e.g. camunda-bpmn-moddle/resources/camunda.json), or remove the moddleExtensions entry.' });
    }
  }

  private readDescriptorPath(prefix: string, value: string): void {
    const path = (extname(value) ? [value] : [value, `${value}.json`]).map((spelling) => this.installedPath(spelling)).find((found) => found !== undefined);
    if (path !== undefined && this.config.holds(path)) {
      this.readDescriptorFile(prefix, value, path);
      return;
    }
    const known = KNOWN_DESCRIPTORS[value.replace(/\.json$/, '')];
    const descriptor = known && getDefaultLintConfig({ engine: known.engine }).moddleExtensions?.[known.prefix];
    if (descriptor) {
      this.descriptors[prefix] = descriptor as object;
      return;
    }
    this.unavailable.push({ kind: 'moddle', name: prefix, pkg: value, reason: `not installed (looked up from ${this.config.directory}); bpmn-cli brings camunda-bpmn-moddle/resources/camunda.json and zeebe-bpmn-moddle/resources/zeebe.json only`, hint: 'Install its package next to the .bpmnlintrc, or remove the moddleExtensions entry.' });
  }

  private readDescriptorFile(prefix: string, value: string, path: string): void {
    if (!path.endsWith('.json')) {
      this.unavailable.push({ kind: 'moddle', name: prefix, pkg: value, reason: `only JSON descriptors are loaded (${path})`, hint: 'Name the JSON descriptor (e.g. camunda-bpmn-moddle/resources/camunda.json); bpmn-cli runs no moddle modules.' });
      return;
    }
    try {
      this.descriptors[prefix] = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as object;
    } catch (error) {
      this.unavailable.push({ kind: 'moddle', name: prefix, pkg: value, reason: `cannot be read (${LintFindings.firstLine(error)})`, hint: 'Fix the descriptor, or remove the moddleExtensions entry.' });
    }
  }

  private dropRejectedDescriptors(entries: Map<string, unknown>): void {
    const accepted: Record<string, object> = {};
    for (const [prefix, descriptor] of Object.entries(this.descriptors)) {
      try {
        new this.libraries.BpmnModdle({ ...accepted, [prefix]: descriptor });
        accepted[prefix] = descriptor;
      } catch (error) {
        const value = entries.get(prefix);
        delete this.descriptors[prefix];
        this.unavailable.push({ kind: 'moddle', name: prefix, pkg: typeof value === 'string' ? value : 'descriptor object', reason: `BpmnModdle rejects it (${LintFindings.firstLine(error)})`, hint: 'Fix the descriptor, or remove the moddleExtensions entry; bpmnlint in CI fails on the whole file with it.' });
      }
    }
  }

  private static failure(message: string, hint: string): Error {
    return Object.assign(new Error(message), { hint });
  }

  private static once<Value>(make: () => Value): () => Value {
    let value: Value | undefined;
    return () => {
      value ??= make();
      return value;
    };
  }

  private static loadLibraries(): LintLibraries {
    const { Linter } = OWN_REQUIRE('bpmnlint') as Pick<LintLibraries, 'Linter'>;
    const NodeResolver = OWN_REQUIRE('bpmnlint/lib/resolver/node-resolver') as LintLibraries['NodeResolver'];
    const { BpmnModdle } = OWN_REQUIRE('bpmn-moddle') as Pick<LintLibraries, 'BpmnModdle'>;
    return { Linter, NodeResolver, BpmnModdle };
  }
}
