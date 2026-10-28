import Linter from 'bpmnlint/lib/linter.js';
import { createModdle } from 'bpmnlint/lib/testers/helper.js';
import { describe, expect, it } from 'vitest';
import { CamundaDescriptor } from '../../src/adapters/out/bpmnlint/engine/rules/c7/extensions/CamundaDescriptor.js';
import { ZeebeSchema } from '../../src/adapters/out/bpmnlint/engine/rules/c8/extensions/ZeebeSchema.js';
import { ElementKinds } from '../../src/adapters/out/bpmnlint/engine/rules/describe.js';
import { kindLabel } from '../../src/domain/document/Kinds.js';
import type { DeclaredRuleFactory } from '@miragon/bpmnlint-plugin-rules/engine';
import type { Engine } from '@miragon/bpmnlint-plugin-rules/engine';
import { CAMUNDA_DESCRIPTOR as camundaModdle } from '../../src/domain/document/vendor/camunda-descriptor.js';
import { ZEEBE_DESCRIPTOR as zeebeModdle } from '../../src/domain/document/vendor/zeebe-descriptor.js';

CamundaDescriptor.use(camundaModdle);
ElementKinds.use(kindLabel);
ZeebeSchema.use(zeebeModdle);

const ENGINES: Record<
  Engine,
  { platform: string; version: string; namespace: string; moddle: Record<string, unknown> }
> = {
  c7: {
    platform: 'Camunda Platform',
    version: '7.24.0',
    namespace: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
    moddle: { camunda: camundaModdle },
  },
  c8: {
    platform: 'Camunda Cloud',
    version: '8.10.0',
    namespace: 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"',
    moddle: { zeebe: zeebeModdle },
  },
};

export interface EngineModelOptions {
  /** `modeler:executionPlatformVersion`, e.g. `8.9.0`. Defaults to the latest. */
  version?: string;
  /** Root elements next to the process (`<bpmn:message>`, `<bpmn:error>`, ...). */
  roots?: string;
  /** Attributes of the process; `isExecutable="true"` unless given. */
  processAttributes?: string;
  /** Extra attributes or namespace declarations on `bpmn:definitions`. */
  definitionsAttributes?: string;
}

/**
 * A diagram for an engine rule spec: `bpmn:definitions` that target `engine` (execution platform,
 * version and vendor namespace), one executable process holding `processContent`, parsed with the
 * engine's moddle extension as a host lints it. No DI: engine rules read the semantic tree only.
 */
export function engineModel(
  engine: Engine,
  processContent: string,
  options: EngineModelOptions = {},
) {
  const { platform, version, namespace, moddle } = ENGINES[engine];
  return createModdle(
    `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:modeler="http://camunda.org/schema/modeler/1.0" ${namespace}
    modeler:executionPlatform="${platform}"
    modeler:executionPlatformVersion="${options.version ?? version}"
    ${options.definitionsAttributes ?? ''}
    id="definitions_test" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="process_test" ${options.processAttributes ?? 'isExecutable="true"'}>
    ${processContent}
  </bpmn:process>
  ${options.roots ?? ''}
</bpmn:definitions>`,
    moddle,
  );
}

/** What an engine rule spec expects of one report; `type` is the report's `data.type`. */
export interface ExpectedEngineReport {
  id: string;
  message: string;
  path?: (string | number)[];
  type: string;
}

export interface EngineRuleCase {
  name: string;
  moddleElement: ReturnType<typeof engineModel>;
  config?: Record<string, unknown>;
}

/**
 * bpmnlint's `verify` for an engine rule, comparing what a host reads of a report: its element,
 * message, path and `data.type`, but not the moddle objects camunda-compat puts in `data`.
 */
export function verifyEngineRule(
  ruleName: string,
  rule: DeclaredRuleFactory,
  cases: {
    valid: EngineRuleCase[];
    invalid: Array<EngineRuleCase & { report: ExpectedEngineReport | ExpectedEngineReport[] }>;
  },
) {
  const lint = async ({ moddleElement, config = {} }: EngineRuleCase) => {
    const linter = new Linter({
      resolver: { resolveRule: () => rule, resolveConfig: () => undefined },
    });
    const { root } = await moddleElement;
    const reports = await linter.lint(root, { rules: { [ruleName]: ['error', config] } });
    return (reports[ruleName] ?? []).map((report: any) => ({
      id: report.id,
      message: report.message,
      ...(report.path ? { path: report.path } : {}),
      type: report.data?.type,
    }));
  };

  describe(`rules/${ruleName}`, () => {
    for (const testCase of cases.valid) {
      it(`valid: ${testCase.name}`, async () => {
        expect(await lint(testCase)).toEqual([]);
      });
    }
    for (const testCase of cases.invalid) {
      it(`invalid: ${testCase.name}`, async () => {
        const expected = Array.isArray(testCase.report) ? testCase.report : [testCase.report];
        expect(await lint(testCase)).toEqual(expected);
      });
    }
  });
}
