import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import type { BpmnlintConfig, BpmnlintUnavailable } from '../bpmnlint/bpmnlint-contract.js';
import { moddleEntries } from '../bpmnlint/utils/bpmnlint.js';
import type { BpmnlintLibs } from './BpmnlintLibs.js';
import { depState, resolveFirst, type Dep } from './utils/dependencies.js';
import { inside, shown } from './utils/paths.js';
import { firstLine } from '../../../domain/document/utils/text.js';

/** moddleExtensions paths the plugin's own descriptors answer, without `.json`. */
const KNOWN_MODDLE: Record<string, { engine: 'c7' | 'c8'; prefix: string }> = {
  'camunda-bpmn-moddle/resources/camunda': { engine: 'c7', prefix: 'camunda' },
  'zeebe-bpmn-moddle/resources/zeebe': { engine: 'c8', prefix: 'zeebe' },
};

/**
 * The moddleExtensions of a .bpmnlintrc: JSON read from inside the repository (never executed),
 * else the plugin's camunda / zeebe descriptors; anything else is W_LINT_UNAVAILABLE.
 */
export class ModdleExtensions {
  readonly found: Record<string, object> = {};
  readonly unavailable: BpmnlintUnavailable[] = [];
  readonly deps: Dep[] = [];

  constructor(
    config: BpmnlintConfig,
    private readonly rcDir: string,
    private readonly root: string,
    private readonly libs: BpmnlintLibs,
    private readonly from?: string,
  ) {
    const req = createRequire(join(rcDir, '__bpmn-cli__.js'));
    for (const [prefix, value] of moddleEntries(config)) {
      if (typeof value === 'string') this.add(prefix, value, req);
    }
  }

  private add(prefix: string, value: string, req: { resolve(id: string): string }): void {
    const spellings = this.spellings(value);
    const dep = { ids: spellings, state: depState(this.rcDir, spellings) };
    const path = resolveFirst(req, spellings);
    if (path !== undefined && inside(path, this.root)) {
      this.deps.push(dep);
      this.read(prefix, value, path);
      return;
    }
    const known = KNOWN_MODDLE[value.replace(/\.json$/, '')];
    const descriptor = known ? (this.libs.plugin.getDefaultLintConfig({ engine: known.engine }).moddleExtensions?.[known.prefix] as object | undefined) : undefined;
    if (descriptor) {
      this.found[prefix] = descriptor;
      return;
    }
    this.deps.push(dep);
    this.unavailable.push({
      kind: 'moddle',
      name: prefix,
      pkg: value,
      reason: `not installed (looked up from ${shown(this.rcDir, this.from)}); bpmn-cli brings camunda-bpmn-moddle/resources/camunda.json and zeebe-bpmn-moddle/resources/zeebe.json only`,
      hint: 'Install its package next to the .bpmnlintrc, or remove the moddleExtensions entry.',
    });
  }

  private read(prefix: string, value: string, path: string): void {
    if (!path.endsWith('.json')) {
      this.unavailable.push({ kind: 'moddle', name: prefix, pkg: value, reason: `only JSON descriptors are loaded (${shown(path, this.from)})`, hint: 'Name the JSON descriptor (e.g. camunda-bpmn-moddle/resources/camunda.json); bpmn-cli runs no moddle modules.' });
      return;
    }
    try {
      this.found[prefix] = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as object;
    } catch (err) {
      this.unavailable.push({ kind: 'moddle', name: prefix, pkg: value, reason: `cannot be read (${firstLine(err)})`, hint: 'Fix the descriptor, or remove the moddleExtensions entry.' });
    }
  }

  private spellings(value: string): string[] {
    return extname(value) ? [value] : [value, `${value}.json`];
  }
}
