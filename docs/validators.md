# Validators

A library host can run its own checks inside a write. They see exactly the XML that would be
written, and an error the change adds refuses the write. The CLI runs only the project's
[bpmnlint](bpmnlint.md), in `bpmn validate`. Passing validators: [Library use](library.md).

## An example

A house rule: nobody archives by hand. The first write would add such a task and is refused; the second
one passes.

```ts
import {
  applyToXml,
  BpmnError,
  findXml,
  newXml,
  type Validator,
} from '@miragon/bpmn-cli';

const houseRules: Validator = {
  name: 'house-rules',
  detail: 'our modelling guideline',
  async validate(xml) {
    const { hits } = await findXml(xml, { kind: 'task' });
    return hits
      .filter((task) => task.name === 'Archive')
      .map((task) => ({
        severity: 'error',
        code: 'NO_ARCHIVE_TASK',
        message: `${task.id}: archiving is a job of the records system`,
        element: task.id,
        hint: 'Remove the task or rename it.',
      }));
  },
};

const start = await applyToXml(await newXml({ name: 'Order handling' }), [
  { op: 'add', kind: 'start', name: 'Order received' },
  { op: 'add', kind: 'end', name: 'Done', after: 'startEvent_orderReceived' },
]);

const archive = {
  op: 'add',
  kind: 'userTask',
  name: 'Archive',
  after: 'startEvent_orderReceived',
};

try {
  await applyToXml(start.xml, [archive], { validators: [houseRules] });
} catch (error) {
  if (!(error instanceof BpmnError)) {
    throw error;
  }
  error.code;
  // 'E_VALIDATION'
  error.message;
  // 'The change would introduce 1 error(s) reported by validator
  //  house-rules; nothing was written'
  error.details.errors;
  // [{ code: 'NO_ARCHIVE_TASK',
  //    message: 'userTask_archive: archiving is a job of the records system',
  //    validator: 'house-rules', severity: 'error',
  //    element: 'userTask_archive', hint: 'Remove the task or rename it.' }]
}

const check = {
  op: 'add',
  kind: 'userTask',
  name: 'Check invoice',
  after: 'startEvent_orderReceived',
};
const edit = await applyToXml(start.xml, [check], { validators: [houseRules] });

edit.findings;
// []
```

## Writing a validator

A validator is an object:

| field | meaning |
| --- | --- |
| `name` | shown with every finding: `validator` in a finding |
| `validate` | `(xml, context)` to findings, sync or async |
| `detail` | one line on why it runs |
| `blocks` | `false` makes it advisory |

`context` has `phase` (`'before'`, `'after'` or `'check'`), `platform`, `operations`, `importWarnings` and
`file`; the library sets no `file`, so a host reads it as undefined.

A finding is `{ severity, code, message, element?, related?, hint?, key? }`. `severity: 'error'` (any case)
is an error, anything else a warning. bpmnlint's `{ severity: 'ERROR', ruleId, message }` is accepted as
it is. `key` says which finding of the old file this one is; without it the code and the element, or the
message, tell them apart.

## Before and after

A write runs every validator on the old file and on the new one, and compares the findings over the whole
file:

| finding | blocking (default) | advisory (`blocks: false`) |
| --- | --- | --- |
| an error the change adds | refuses the write (`E_VALIDATION`) unless `force: true` | in `findings`; the write goes through |
| a warning the change adds | in `findings` | in `findings` |
| an error the file already had | in `preexisting`, never blocks | the same |

So an old problem never makes a file uneditable. `validateXml` runs each validator once, with the phase
`check`, and reports every finding under its `validators` summary.

## Next steps

- [Library use](library.md): the options of `applyToXml`.
- [bpmnlint](bpmnlint.md): the project's rules on the command line.
