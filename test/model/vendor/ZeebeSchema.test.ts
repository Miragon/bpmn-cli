import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from 'zeebe-bpmn-moddle/package.json' with { type: 'json' };
import descriptor from 'zeebe-bpmn-moddle/resources/zeebe.json' with { type: 'json' };
import { ZeebeSchema } from '../../../src/model/vendor/ZeebeSchema.js';

const installed = createRequire(import.meta.url);

describe('ZeebeSchema', () => {
  it('holds the descriptor zeebe-bpmn-moddle ships, type for type', () => {
    expect(ZeebeSchema.DESCRIPTOR).toEqual(descriptor);
  });

  it('names the version of the installed zeebe-bpmn-moddle', () => {
    expect(ZeebeSchema.VERSION).toBe(manifest.version);
  });

  it('carries the license text of the package it copies from', () => {
    const license = readFileSync(join(dirname(installed.resolve('zeebe-bpmn-moddle/package.json')), 'LICENSE'), 'utf8');

    const lettersOf = (text: string): string => text.replace(/[^a-z0-9]/gi, '');

    expect(lettersOf(ZeebeSchema.NOTICE)).toBe(lettersOf(license));
  });
});
