import { describe, expect, it } from 'vitest';
import { SchemaText } from '../../../../src/checks/camunda/values/SchemaText.js';
import { ModdleParser } from '../../../../src/model/index.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('SchemaText', () => {
  const issuesOf = (path: string) => new SchemaText().issues(Fixtures.text(path), ModdleParser.moddle());

  it('finds a laneSet after the flow elements of a process', () => {
    const issues = issuesOf('engine/verdicts/c8-feel-and-deploy/037-order-a-laneset-after-the-flow-elements.bpmn');

    expect(issues.map(({ kind }) => kind)).toContain('order');
  });

  it('finds nothing in a file the schema takes', () => {
    expect(issuesOf('engine/structure/cancel-boundary-on-a-task.bpmn')).toEqual([]);
  });

  it('reads no issue from text that is no XML', () => {
    expect(new SchemaText().issues('<bpmn:definitions>', ModdleParser.moddle())).toEqual([]);
  });
});
