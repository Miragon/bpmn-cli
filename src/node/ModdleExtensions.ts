import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import type { BpmnlintConfig, BpmnlintUnavailable } from '../validate/bpmnlint-validator.js';
import { moddleEntries } from '../validate/utils/bpmnlint.js';
import type { BpmnlintLibs } from './BpmnlintLibs.js';
import { depState, resolveFirst, type Dep } from './utils/dependencies.js';
import { inside, shown } from './utils/paths.js';
import { firstLine } from '../shared/utils/text.js';

/** moddleExtensions module paths bpmn-cli answers without the project (the plugin's descriptors), `.json` left out. */
const KNOWN_MODDLE: Record<string, { engine: 'c7' | 'c8'; prefix: string }> = {
  'camunda-bpmn-moddle/resources/camunda': { engine: 'c7', prefix: 'camunda' },
  'zeebe-bpmn-moddle/resources/zeebe': { engine: 'c8', prefix: 'zeebe' },
};

/**
 * The moddleExtensions of a .bpmnlintrc that name a module path: read as JSON
 * from the project (inside the repository root `root`; never executed), else
 * camunda-bpmn-moddle/resources/camunda(.json) and
 * zeebe-bpmn-moddle/resources/zeebe(.json) are the plugin's descriptors
 * (offline); anything else is left out (W_LINT_UNAVAILABLE). `deps`: each path
 * the project answered or left out, with its state before the lookup
 * (LoadDeps), not those the plugin's descriptors answered.
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
    for (const [prefix, value] of moddleEntries(config)) if (typeof value === 'string') this.add(prefix, value, req);
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

  /** How a moddleExtensions module path is looked up: as written, and with `.json` when it has no extension. */
  private spellings(value: string): string[] {
    return extname(value) ? [value] : [value, `${value}.json`];
  }
}
