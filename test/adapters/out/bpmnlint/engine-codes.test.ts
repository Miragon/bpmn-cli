import { compatRules as c7CompatRules } from '@miragon/bpmnlint-plugin-rules/camunda-7';
import { compatRules as c8CompatRules } from '@miragon/bpmnlint-plugin-rules/camunda-8';
import { describe, expect, it } from 'vitest';
import { ENGINE_KIT } from '../../../../src/adapters/out/bpmnlint/engine-kit.js';
import { CompatVerdicts } from '../../../../src/adapters/out/bpmnlint/engine/CompatVerdicts.js';
import { EngineCodes } from '../../../../src/adapters/out/bpmnlint/engine/EngineCodes.js';
import { Camunda7Rules } from '../../../../src/adapters/out/bpmnlint/engine/rules/c7/Camunda7Rules.js';
import { Camunda8Rules } from '../../../../src/adapters/out/bpmnlint/engine/rules/c8/Camunda8Rules.js';

const ENGINES = [
  { platform: 'c7', entry: Camunda7Rules.entry(ENGINE_KIT), compatRules: c7CompatRules, major: 7 },
  { platform: 'c8', entry: Camunda8Rules.entry(ENGINE_KIT), compatRules: c8CompatRules, major: 8 },
] as const;

describe('every engine rule has a bpmn-cli code', () => {
  for (const { platform, entry, compatRules, major } of ENGINES) {
    it(`${platform}: the rules of every camunda-compat version, and each finding of bpmn-cli's own`, () => {
      const rules = new Set<string>();
      const verdicts = new CompatVerdicts(ENGINE_KIT, platform, undefined as never, {}, undefined);
      for (let minor = 0; minor < 40; minor++) for (const rule of verdicts.rules(compatRules(`${major}.${minor}`))) rules.add(rule.name);
      expect(rules.size).toBeGreaterThan(0);
      expect([...rules].filter((rule) => EngineCodes.codeOf(platform, rule, { data: {} } as never) === EngineCodes.UNMAPPED[platform]).sort()).toEqual([]);
      const tabled = Object.values(EngineCodes.TABLE[platform]).flat().map((rule) => rule.split('#')[0]!).map((rule) => (rule.includes('/') ? rule : `camunda-compat/${rule}`));
      expect(tabled.filter((rule) => !rules.has(rule)).sort()).toEqual([]);
      const own = entry.rules(undefined).filter((rule) => rule.name.startsWith('bpmn-cli/'));
      expect(own.length).toBeGreaterThan(4);
      expect(Object.values(entry.findings).filter(([code]) => !code.startsWith(`W_${platform.toUpperCase()}_`))).toEqual([]);
    });
  }
});
