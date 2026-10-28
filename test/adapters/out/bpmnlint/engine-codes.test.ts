import { compatRules as c7CompatRules } from '@miragon/bpmnlint-plugin-rules/camunda-7';
import { compatRules as c8CompatRules } from '@miragon/bpmnlint-plugin-rules/camunda-8';
import { describe, expect, it } from 'vitest';
import { ENGINE_KIT } from '../../../../src/adapters/out/bpmnlint/engine-kit.js';
import { EngineCodes } from '../../../../src/adapters/out/bpmnlint/engine/EngineCodes.js';
import { Camunda7Rules } from '../../../../src/adapters/out/bpmnlint/engine/rules/c7/index.js';
import { Camunda8Rules } from '../../../../src/adapters/out/bpmnlint/engine/rules/c8/index.js';

const ENGINES = [
  { platform: 'c7', entry: Camunda7Rules.entry(ENGINE_KIT), compatRules: c7CompatRules, major: 7 },
  { platform: 'c8', entry: Camunda8Rules.entry(ENGINE_KIT), compatRules: c8CompatRules, major: 8 },
] as const;

/** A rule as the results name it: `camunda-compat/<rule>`, `bpmn-cli/<rule>`, a bpmnlint rule bare. */
const resultKey = (rule: string): string => (rule.startsWith('bpmnlint/') ? rule.slice('bpmnlint/'.length) : rule);

describe('every engine rule has a bpmn-cli code', () => {
  for (const { platform, entry, compatRules, major } of ENGINES) {
    it(`${platform}: the rules of every camunda-compat version, and each finding of bpmn-cli's own`, () => {
      const rules = new Set<string>();
      for (let minor = 0; minor < 40; minor++) for (const rule of compatRules(`${major}.${minor}`)) rules.add(resultKey(rule.name));
      expect(rules.size).toBeGreaterThan(0);
      expect([...rules].filter((rule) => !EngineCodes.TABLE[platform][rule]).sort()).toEqual([]);
      expect(Object.keys(EngineCodes.TABLE[platform]).filter((rule) => !rules.has(rule)).sort()).toEqual([]);
      const own = entry.rules(undefined).filter((rule) => rule.name.startsWith('bpmn-cli/'));
      expect(own.length).toBeGreaterThan(5);
      expect(Object.values(entry.findings).filter(([code]) => !code.startsWith(`W_${platform.toUpperCase()}_`))).toEqual([]);
    });
  }
});
