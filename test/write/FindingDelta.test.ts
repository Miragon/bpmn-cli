import { describe, expect, it } from 'vitest';
import type { ValidatorIssue } from '../../src/model/index.js';
import { FindingDelta } from '../../src/write/FindingDelta.js';
import type { ValidatorRun } from '../../src/write/HostValidators.js';
import { Findings } from '../support/ModelValues.js';

const issue = (fields: Partial<ValidatorIssue> & { code: string }, key?: string): ValidatorIssue => Findings.withUnserialised({ message: fields.code, validator: 'gate', severity: 'error', ...fields }, key ? { key } : {});
const run = (issues: ValidatorIssue[], blocks?: false): ValidatorRun => ({ name: 'gate', ...(blocks === false ? { blocks } : {}), issues });
const noRenames = new FindingDelta(new Map());

describe('FindingDelta', () => {
  it('tells a new error from one the same element had', () => {
    const kept = { code: 'E_NO_HOST', message: 'kept', element: 'event' };
    const added = { code: 'E_INVALID_HOST', message: 'new', element: 'event' };

    expect(noRenames.newErrors([kept, added], [kept])).toEqual([added]);
  });

  it('follows a renamed element to the error it had', () => {
    const delta = new FindingDelta(new Map([['flow_old', 'flow_new']]));

    expect(delta.newErrors([{ code: 'E_DANGLING_REF', message: 'now', element: 'flow_new' }], [{ code: 'E_DANGLING_REF', message: 'then', element: 'flow_old' }])).toEqual([]);
  });

  it('counts a second error of one code at one element as new', () => {
    const error = { code: 'E_DANGLING_REF', message: 'dangling', element: 'flow' };

    expect(noRenames.newErrors([error, error], [error])).toEqual([error]);
  });

  it('takes a host finding with the key of one from before as one the file had', () => {
    const before = issue({ code: 'gate/flow', element: 'a', message: 'then' }, 'dead-end');
    const after = issue({ code: 'gate/flow', element: 'b', message: 'now' }, 'dead-end');

    expect(noRenames.ofHostValidators([run([before])], [run([after])])).toEqual({ added: [], blocking: [], preexisting: [after] });
  });

  it('reads renamed ids in a key, as whole ids', () => {
    const delta = new FindingDelta(new Map([['task', 'task_new']]));
    const before = issue({ code: 'gate/name' }, 'name of task');
    const other = issue({ code: 'gate/name' }, 'name of task_other');
    const after = issue({ code: 'gate/name' }, 'name of task_new');

    expect(delta.ofHostValidators([run([before, other])], [run([after, other])]).added).toEqual([]);
  });

  it('compares by element, then by message, when there is no key', () => {
    const atElement = issue({ code: 'gate/a', element: 'task', message: 'then' });
    const inFile = issue({ code: 'gate/b', message: 'no end' });
    const moved = issue({ code: 'gate/a', element: 'task', message: 'now' });

    expect(noRenames.ofHostValidators([run([atElement, inFile])], [run([moved, inFile])]).added).toEqual([]);
  });

  it('sees a warning that became an error as added', () => {
    const before = issue({ code: 'gate/a', severity: 'warning' });
    const after = issue({ code: 'gate/a', severity: 'error' });

    expect(noRenames.ofHostValidators([run([before])], [run([after])]).blocking).toEqual([after]);
  });

  it('reports what an advisory validator adds without blocking, and no preexisting of it', () => {
    const old = issue({ code: 'gate/old' });
    const added = issue({ code: 'gate/new' });

    expect(noRenames.ofHostValidators([run([old], false)], [run([old, added], false)])).toEqual({ added: [added], blocking: [], preexisting: [] });
  });

  it('compares the n-th run of a name with the n-th run before', () => {
    const first = issue({ code: 'gate/first' });
    const second = issue({ code: 'gate/second' });

    expect(noRenames.ofHostValidators([run([first]), run([second])], [run([first]), run([second])]).added).toEqual([]);
  });

  it('takes a warning a run adds as added and no blocker', () => {
    const warning = issue({ code: 'gate/new', severity: 'warning' });

    expect(noRenames.ofHostValidators([run([])], [run([warning])])).toEqual({ added: [warning], blocking: [], preexisting: [] });
  });
});
