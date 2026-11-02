import { describe, expect, it } from 'vitest';
import { DocumentValidation } from '../../src/write/DocumentValidation.js';
import type { Validator, ValidatorContext } from '../../src/write/HostValidators.js';
import { WriteTransaction } from '../../src/write/WriteTransaction.js';
import { Fixtures } from '../support/Fixtures.js';

const report = (path: string, validators?: Validator[]) => new DocumentValidation({ validators }).report(Fixtures.text(path));

describe('DocumentValidation', () => {
  it('passes a clean model with its layout dry run', async () => {
    const { ok, findings, layout, state } = await report('edit/order-check.bpmn');

    expect(ok).toBe(true);
    expect(layout).toEqual({ status: 'ok' });
    expect(state).toEqual({ errors: 0, warnings: findings.length });
  });

  it('skips the dry run on a model with structural errors and lists the errors first', async () => {
    const { ok, findings, layout } = await report('edit/events-subscription.bpmn');

    expect(ok).toBe(false);
    expect(layout).toEqual({ status: 'skipped' });
    expect(findings[0]?.severity).toBe('error');
  });

  it('counts what Camunda refuses at deploy and names the platform', async () => {
    const { platform } = await report('edit/extensions-zeebe.bpmn');

    expect(platform).toMatchObject({ platform: 'c8', source: expect.any(String), detail: expect.any(String) });
    expect(platform.counts.deploy).toBe(5);
  });

  it('keeps operaton on the platform of a Camunda 7 file', async () => {
    expect((await report('model/operaton.bpmn')).platform.operaton).toBe(true);
  });

  it('reports a data association reaching into a collapsed sub-process and names the collapse that attaches it', async () => {
    const { findings } = await report('edit/collapsed-data-crossing.bpmn');

    expect(findings.filter(({ element }) => element === 'DataInputAssociation_4')).toEqual([
      {
        code: 'W_LAYOUT_DATA_IN_COLLAPSED',
        element: 'DataInputAssociation_4',
        message: 'DataInputAssociation_4 reaches Activity_Score inside the collapsed Activity_Sub and cannot be drawn; `bpmn set <file> Activity_Sub expanded=false` attaches it to Activity_Sub',
        severity: 'warning',
      },
    ]);
  });

  it('reports data inside a collapsed sub-process read from outside, naming to move the data out', async () => {
    const { xml } = await new WriteTransaction({}).apply(Fixtures.text('layout/artifacts__04b-data-crossscope.bpmn'), [
      { op: 'connect', source: 'DataObjectReference_Score', target: 'Activity_Inform', id: 'informReadsScore' },
      { op: 'set', id: 'Activity_Sub', set: { expanded: false } },
    ]);
    const { findings } = await new DocumentValidation({}).report(xml);

    expect(findings).toContainEqual(expect.objectContaining({ code: 'W_LAYOUT_DATA_IN_COLLAPSED', element: 'informReadsScore', message: 'informReadsScore reaches DataObjectReference_Score inside the collapsed Activity_Sub and cannot be drawn; move DataObjectReference_Score out of Activity_Sub, or expand it' }));
  });

  it('counts a warning of the layout as a warning', async () => {
    const { ok, findings } = await report('write/association-to-group.bpmn');

    expect(ok).toBe(true);
    expect(findings).toContainEqual(expect.objectContaining({ code: 'W_LAYOUT_DI_NOT_CREATED', element: 'association_startToGroup', severity: 'warning' }));
  });

  it('reports a redraw that fails as a finding of its own, not as a crash', async () => {
    const { ok, layout, findings } = await report('write/nested-too-deep-to-draw.bpmn');

    expect(ok).toBe(false);
    expect(layout).toMatchObject({ status: 'failed', error: { code: 'E_INTERNAL' } });
    expect(findings).toContainEqual(expect.objectContaining({ code: 'E_INTERNAL', severity: 'error' }));
  });

  it('runs host validators once with the phase check, on the text as given', async () => {
    const seen: Array<[string, ValidatorContext]> = [];
    const gate: Validator = {
      name: 'gate',
      validate: (xml, context) => {
        seen.push([xml, context]);
        return [{ severity: 'error', code: 'gate/no', message: 'no' }];
      },
    };

    const { ok, findings, validators } = await report('edit/order-check.bpmn', [gate]);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe(Fixtures.text('edit/order-check.bpmn'));
    expect(seen[0]?.[1]).toMatchObject({ phase: 'check', platform: 'none', operations: [], importWarnings: [] });
    expect(ok).toBe(false);
    expect(findings[0]).toMatchObject({ code: 'gate/no', validator: 'gate' });
    expect(validators).toEqual([{ name: 'gate', errors: 1, warnings: 0 }]);
  });

  it('lets an advisory validator fail the check too', async () => {
    const advice: Validator = { name: 'advice', blocks: false, validate: () => [{ severity: 'error', message: 'no' }] };

    expect((await report('edit/order-check.bpmn', [advice])).ok).toBe(false);
  });

  it('hands validators and the report the first lines of the import warnings', async () => {
    const seen: ValidatorContext[] = [];
    const reader: Validator = {
      name: 'reader',
      validate: (_xml, context) => {
        seen.push(context);
        return [];
      },
    };

    const { importWarnings } = await report('model/lossy.bpmn', [reader]);

    expect(importWarnings).toHaveLength(seen[0]!.importWarnings.length);
    expect(importWarnings.every((warning) => !warning.includes('\n'))).toBe(true);
  });
});
