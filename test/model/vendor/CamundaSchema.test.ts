import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from 'camunda-bpmn-moddle/package.json' with { type: 'json' };
import descriptor from 'camunda-bpmn-moddle/resources/camunda.json' with { type: 'json' };
import { CamundaSchema } from '../../../src/model/vendor/CamundaSchema.js';

const installed = createRequire(import.meta.url);

describe('CamundaSchema', () => {
  it('holds the descriptor camunda-bpmn-moddle ships, type for type', () => {
    expect(CamundaSchema.DESCRIPTOR).toEqual(descriptor);
  });

  it('names the version of the installed camunda-bpmn-moddle', () => {
    expect(CamundaSchema.VERSION).toBe(manifest.version);
  });

  it('carries the license text of the package it copies from', () => {
    const license = readFileSync(join(dirname(installed.resolve('camunda-bpmn-moddle/package.json')), 'LICENSE'), 'utf8');

    const lettersOf = (text: string): string => text.replace(/[^a-z0-9]/gi, '');

    expect(lettersOf(CamundaSchema.NOTICE)).toBe(lettersOf(license));
  });
});
