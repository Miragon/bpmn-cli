import { camunda7 } from '@miragon/bpmnlint-plugin-rules/camunda-7';
import { camunda8 } from '@miragon/bpmnlint-plugin-rules/camunda-8';
import { describe, expect, it } from 'vitest';
import { ENGINE_KIT } from '../../../../src/adapters/out/bpmnlint/engine-kit.js';
import { EngineCodes } from '../../../../src/adapters/out/bpmnlint/engine/EngineCodes.js';
import { Camunda7Rules } from '../../../../src/adapters/out/bpmnlint/engine/rules/c7/index.js';
import { Camunda8Rules } from '../../../../src/adapters/out/bpmnlint/engine/rules/c8/index.js';

const ENGINES = [
  { platform: 'c7', lint: Camunda7Rules.lint(ENGINE_KIT), compat: camunda7, prefix: 'camunda-platform-7-' },
  { platform: 'c8', lint: Camunda8Rules.lint(ENGINE_KIT), compat: camunda8, prefix: 'camunda-cloud-8-' },
] as const;

/** A rule as bpmnlint names it in its results: `camunda-compat/<rule>`, `bpmn-cli/<rule>`, a bpmnlint rule bare. */
const resultKey = (rule: string): string => (rule.startsWith('bpmnlint/') ? rule.slice('bpmnlint/'.length) : rule.includes('/') ? rule : `camunda-compat/${rule}`);

describe('every engine rule has a bpmn-cli code', () => {
  for (const { platform, lint, compat, prefix } of ENGINES) {
    it(`${platform}: the rules of every camunda-compat version and bpmn-cli's own`, () => {
      const resolver = compat.createResolver();
      const versions = Array.from({ length: 40 }, (_unused, minor) => `${prefix}${minor}`).filter((name) => {
        try {
          return !!resolver.resolveConfig('bpmnlint-plugin-camunda-compat', name);
        } catch {
          return false;
        }
      });
      expect(versions.length).toBeGreaterThan(5);
      const rules = new Set<string>();
      for (const version of versions) for (const rule of Object.keys((resolver.resolveConfig('bpmnlint-plugin-camunda-compat', version) as { rules: object }).rules)) rules.add(resultKey(rule));
      for (const rule of Object.keys(lint.lintConfig().rules ?? {})) rules.add(resultKey(rule));
      expect([...rules].filter((rule) => !EngineCodes.TABLE[platform][rule]).sort()).toEqual([]);
      expect(Object.keys(EngineCodes.TABLE[platform]).filter((rule) => !rules.has(rule)).sort()).toEqual([]);
    });
  }
});
