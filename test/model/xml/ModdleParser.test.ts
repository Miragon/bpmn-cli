import { describe, expect, it } from 'vitest';
import { ModelError } from '../../../src/model/errors/ModelError.js';
import { ModdleParser } from '../../../src/model/xml/ModdleParser.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ModdleParser', () => {
  it('reads a file into its definitions', async () => {
    const { definitions, importWarnings } = await new ModdleParser().parse(Fixtures.text('model/c7-vendor.bpmn'));

    expect(definitions.$type).toBe('bpmn:Definitions');
    expect(importWarnings).toEqual([]);
  });

  it('refuses what is no XML, with the first line of the reason', async () => {
    await expect(new ModdleParser().parse('<<<')).rejects.toMatchObject({ code: 'PARSE_ERROR', message: expect.stringContaining('Cannot parse BPMN XML') });
  });

  it('refuses a root that is no definitions', async () => {
    const parsing = new ModdleParser().parse('<bpmn:process xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="p"/>');

    await expect(parsing).rejects.toBeInstanceOf(ModelError);
    await expect(parsing).rejects.toThrow(/bpmn:Definitions|Cannot parse/);
  });

  it('resolves references padded with whitespace, single and in lists, without a warning', async () => {
    const { definitions, importWarnings } = await new ModdleParser().parse(Fixtures.text('model/padded-references.bpmn'));
    const process = (definitions.get('rootElements') as Array<{ get(name: string): never }>)[0]!;
    const flow = (process.get('flowElements') as Array<{ id: string; sourceRef?: { id: string } }>).find(({ id }) => id === 'flow_padded')!;
    const lane = (process.get('laneSets') as Array<{ lanes: Array<{ flowNodeRef: Array<{ id: string }> }> }>)[0]!.lanes[0]!;

    expect(flow.sourceRef?.id).toBe('task_first');
    expect(lane.flowNodeRef.map(({ id }) => id)).toEqual(['task_first', 'task_second']);
    expect(importWarnings).toEqual([]);
  });

  it('warns about an element the schema allows once', async () => {
    const { importWarnings } = await new ModdleParser().parse(Fixtures.text('model/lossy.bpmn'));

    expect(importWarnings.map(({ message }) => message.split(':')[0])).toEqual(expect.arrayContaining(['duplicate element']));
  });
});
