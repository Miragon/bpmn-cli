import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type { IdConventions, ValidatorFinding } from '../../api/index.js';
import { LintConfigLookup } from './LintConfigLookup.js';
import { type NamingOptions, type NamingPlugin, NamingTable } from './NamingTable.js';

interface RuleSetting {
  severity: string;
  config?: NamingOptions | undefined;
}

interface LintConfigContent {
  extends?: unknown;
  rules?: Record<string, unknown>;
}

export interface DeclaredConventions {
  conventions?: IdConventions | undefined;
  notes: ValidatorFinding[];
  where?: string | undefined;
  severity?: string | undefined;
  undeclared?: 'no config' | 'not loaded' | 'off' | undefined;
  brokenConfig?: string | undefined;
}

export class IdConventionsReader {
  private static readonly RULE = '@miragon/rules/element-id-naming';
  private static readonly PLUGIN_CONFIG = 'plugin:@miragon/rules/';
  private static readonly SEVERITIES: Readonly<Record<string, string>> = { 0: 'off', 1: 'warn', 2: 'error' };

  private readonly read = new Map<string, Promise<DeclaredConventions>>();

  private static startOf(path: string): string {
    return path === '-' ? process.cwd() : dirname(resolve(path));
  }

  private static whereOf(rcPath: string): string {
    return `.bpmnlintrc in ${relative(process.cwd(), dirname(rcPath)) || '.'}`;
  }

  private static content(rcPath: string): LintConfigContent | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(rcPath, 'utf8').replace(/^﻿/, ''));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as LintConfigContent) : undefined;
    } catch {
      return undefined;
    }
  }

  private static settingOf(value: unknown): RuleSetting {
    const [severity, config] = Array.isArray(value) ? value : [value];
    return { severity: IdConventionsReader.SEVERITIES[String(severity)] ?? String(severity), config: config as NamingOptions | undefined };
  }

  private static parents(content: LintConfigContent): string[] {
    const named = Array.isArray(content.extends) ? content.extends : [content.extends];
    return named.flatMap((name) => (typeof name === 'string' && name.startsWith(IdConventionsReader.PLUGIN_CONFIG) ? [name.slice(IdConventionsReader.PLUGIN_CONFIG.length)] : []));
  }

  private static async plugin(): Promise<NamingPlugin> {
    return (await import('@miragon/bpmnlint-plugin-rules')) as unknown as NamingPlugin;
  }

  near(path: string): Promise<DeclaredConventions> {
    const start = IdConventionsReader.startOf(path);
    let declared = this.read.get(start);
    if (!declared) {
      const rcPath = new LintConfigLookup(start).nearest();
      declared = rcPath === undefined ? Promise.resolve({ notes: [], undeclared: 'no config' as const }) : this.of(rcPath, IdConventionsReader.whereOf(rcPath));
      this.read.set(start, declared);
    }
    return declared;
  }

  async of(rcPath: string, where: string): Promise<DeclaredConventions> {
    const content = IdConventionsReader.content(rcPath);
    if (!content) {
      return { notes: [], where, undeclared: 'not loaded', brokenConfig: rcPath };
    }
    const value = content.rules?.[IdConventionsReader.RULE];
    const parents = IdConventionsReader.parents(content);
    if (value === undefined && parents.length === 0) {
      return { notes: [], where, undeclared: 'off' };
    }
    const plugin = await IdConventionsReader.plugin();
    const inherited = parents.map((name) => plugin.configs[name]?.rules?.[IdConventionsReader.RULE]).filter((setting) => setting !== undefined);
    const setting = IdConventionsReader.settingOf(value ?? inherited.at(-1) ?? 'off');
    if (setting.severity === 'off') {
      return { notes: [], where, undeclared: 'off' };
    }
    return { ...new NamingTable(plugin.naming, setting.config, where).read(), where, severity: setting.severity };
  }
}
