# Validators

A library host can run its own checks inside a write. They see exactly the XML that would be
written, and an error a change adds refuses the write, like a structural error does. The CLI takes
no validators: this is [library use](library.md) only.

## Passing validators

The `validators` option takes a list. These calls accept it:

- the in-memory API: `applyToXml`, `newXml`, `layoutXml` and `validateXml`;
- the pipeline on a `Doc`: `mutateDoc`, `layoutDoc` (`MutationOptions`) and `checkDoc`
  (`CheckOptions`);
- the file helpers of `@miragon/bpmn-cli/node`: `mutateFile`, `mutateDocToFile`, `layoutFile`,
  `layoutDocToFile` and `checkFile`.

A validator is a function `(xml, ctx) => findings`, sync or async. It is named after the function,
or `validator<n>` (1-based) when the function has no name. A `NamedValidator` object gives more:

| field | meaning |
| --- | --- |
| `name` | shown with every finding: `[name]` in text, `validator` in JSON |
| `validate` | `(xml, ctx) => findings`: reads the XML |
| `validateDoc` | `(doc, ctx) => findings`: reads the parsed `Doc` instead (see below); read it, never change it |
| `detail` | one line on why it runs, shown in results |
| `covers` | finding code -> the lint warning it says again (see [Covers](#covers)) |

An object needs `validate` or `validateDoc`. Without either the call fails with
`E_VALIDATOR_FAILED`.

`validateDoc` gets the live document before the ops and in a check. After the ops it gets a fresh
parse of the candidate, so a write parses once more than with `validate`. It saves a serialisation
only for a document created in memory (`newXml`, `Doc.create`): that one has no text to hand to
`validate`.

The context `ctx` has:

| field | meaning |
| --- | --- |
| `file` | the file being written or checked, when there is one (see [The file](#the-file)) |
| `phase` | `'before'`, `'after'` (a write) or `'check'` (a validation) |
| `platform` | the engine platform of the document: `'c7'`, `'c8'` or `'none'` (detected, or the explicit `platform` option) |
| `ops` | the ops of the transaction (empty for a check) |
| `doc()` | the XML parsed into a `Doc` (cached per phase; read it, never change it) |

## Findings

A validator returns an array of findings (`ValidatorFinding`):

| field | meaning |
| --- | --- |
| `severity` | `error` in any case is an error; anything else, such as `warning` or `WARN`, is a warning |
| `code` | a stable rule id, such as `UNNAMED_TASK` |
| `ruleId` | read as the code when there is no `code` (`naming/task`); without either the code is `FINDING` |
| `message` | the text |
| `element` | the id of the element the finding is about (optional) |
| `related` | other ids it involves (optional) |
| `hint` | how to fix it (optional) |
| `key` | the finding's identity before and after a change (optional, see [Before and after](#before-and-after)) |

So a finding of the shape `{ severity: 'ERROR' | 'WARN', ruleId, message }` is accepted as it is.

```ts
import { applyToXml, CliError, newXml, type NamedValidator } from '@miragon/bpmn-cli';

// a house rule: a path ends in an end event, never in a task or a gateway
const houseRules: NamedValidator = {
  name: 'house-rules',
  detail: 'our modelling guideline',
  covers: { DEAD_END: 'W_DEAD_END' },
  validateDoc: (doc) =>
    doc.processes()
      .flatMap((process) => doc.flowNodes(process))
      .filter((node) => node.$type !== 'bpmn:EndEvent' && doc.outgoing(node).length === 0)
      .map((node) => ({ severity: 'error', code: 'DEAD_END', message: `${node.id} has no outgoing sequence flow`, element: node.id })),
};

let { xml } = await newXml({ processName: 'Order handling' });
({ xml } = await applyToXml(xml, [
  { op: 'add', kind: 'start', name: 'Order received' },
  { op: 'add', kind: 'end', name: 'Done', after: 'Event_OrderReceived' },
]));

try {
  await applyToXml(xml, [{ op: 'add', kind: 'userTask', name: 'Archive', in: 'Process_OrderHandling' }], { validators: [houseRules] });
} catch (err) {
  if (!(err instanceof CliError)) throw err;
  err.code;           // 'E_VALIDATION'
  err.message;        // 'The change would introduce 1 error(s) reported by validator house-rules; nothing was written'
  err.details.errors; // [{ code: 'DEAD_END', message: 'Activity_Archive has no outgoing sequence flow', validator: 'house-rules', severity: 'error', element: 'Activity_Archive' }]
}

const edit = await applyToXml(xml, [{ op: 'add', kind: 'userTask', name: 'Check invoice', after: 'Event_OrderReceived' }], { validators: [houseRules] });
edit.result.validation.validators; // [{ name: 'house-rules', detail: 'our modelling guideline', errors: [], warnings: [], preexisting: [], resolved: [], counts: { errors: 0, warnings: 0 } }]
```

## Before and after

A write runs every validator twice:

- **before**: on the document before the ops (its text as read);
- **after**: on the candidate after the ops, the layout, the format ops and the text-preserving
  step, so on exactly what would be written.

Then the findings are compared:

- An error the change added refuses the write with `E_VALIDATION`. Its `details.errors` list the
  new errors, each with `validator` and `severity`. Nothing is written. `force: true` writes
  anyway, and the errors stay in `result.validation.errors` (in text: `forced [house-rules]
  DEAD_END Activity_Archive: ...`).
- An error the document already had does not block. It becomes a `W_PREEXISTING_ERROR` warning
  whose message starts with its code (`DEAD_END: Activity_Archive has no outgoing sequence flow
  (already in the model before this change)`). The result counts it with the other warnings the
  file already had (`result.warnings.preexistingCount`), so an old problem never makes a file
  uneditable.
- A warning the change added is reported (`result.warnings.added`). A warning the document had is
  not reported again. It only shows in the validator's `counts.warnings`, not in
  `result.warnings.preexistingCount`.
- A finding the change removed is resolved (`result.warnings.resolved`).

A finding before and one after are the same when they have the same validator, code and severity
and are about the same element. An element the ops renamed keeps its findings. A finding without
an element is matched by its code and message, with the old ids in the message replaced by the
new ones. A `key` replaces that identity, for a message that changes with every write (`process
Process_1 has 11 tasks`). Each finding before matches one finding after at most, so two equal
findings count as two.

The structural check comes first: a change that adds a structural error is refused before the
validators see the candidate.

A check (`validateXml`, `checkDoc`, `checkFile`) runs each validator once, with phase `check`, on
the document's own diagram (before the layout dry run). It reports every finding. An error makes
`ok` false in the `validateXml` report (`validationReport(check)`). `checkDoc` and `checkFile`
have no `ok`: they list the error in `validation.errors`.

A validator that throws, or returns no array, fails the call with `E_VALIDATOR_FAILED`
(`details.validator` names it). Nothing is written. For a validator that throws, the message says
which run failed: `Validator broken failed on the document before the change: boom; nothing was
written` (or `on the changed document`, `on the file`). One that returns no array gets `Validator
broken returned undefined instead of an array of findings; nothing was written`.

## Covers

A validator may say again what a lint warning says, as `DEAD_END` above repeats `W_DEAD_END`.
`covers: { DEAD_END: 'W_DEAD_END' }` drops the lint warning about the same element, so each
problem is reported once. Only a finding with an `element` covers a lint warning.

## The file

`ctx.file` is the file being written or checked:

- `applyToXml`, `newXml`, `layoutXml` and `validateXml`: the `file` option. A string in memory
  has no file otherwise.
- `mutateDoc`, `layoutDoc` and `checkDoc`: the `file` option, else `doc.file`.
- The file helpers: the `file` option, else the file they write (the `out` target with `out`) or
  check.

## Results

- **A write** reports one `ValidatorReport` per validator in `result.validation.validators`:
  `name`, `detail`, `errors` (the errors the change added; only in a forced write), `warnings`
  (the warnings it added), `preexisting`, `resolved` and `counts` (the errors and warnings after
  the change). The added warnings are also in `result.warnings.added`, and the errors of a forced
  write in `result.validation.errors`, each with `validator`. `renderMutation` prints one line per validator: `validator house-rules (our
  modelling guideline): 0 error(s), 0 warning(s) in the result`.
- **A check** reports every finding: `validators` of the `validateXml` report
  (`validation.validators` of `checkDoc` and `checkFile`), with `preexisting` and `resolved`
  empty. The findings are also among the report's `errors` and `warnings`. `renderValidation`
  prints them as `[house-rules] DEAD_END Activity_Archive: ...` and adds `validator
  house-rules (our modelling guideline): 1 error(s), 0 warning(s) in the file` before the
  layout line and the totals.
