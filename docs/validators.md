# Validators

A library host can run its own checks inside a write. They see exactly the XML that would be
written, and an error the change adds refuses the write. The CLI runs only the project's bpmnlint,
as an [advisory validator](#advisory-validators). Passing validators: [Library use](library.md).

## An example

A house rule: a path ends in an end event. The first write would add a task without an outgoing
flow and is refused; the second one passes.

```ts
import {
  applyToXml,
  CliError,
  newXml,
  type NamedValidator,
} from '@miragon/bpmn-cli';

// a house rule: a path ends in an end event, never in a task or a gateway
const houseRules: NamedValidator = {
  name: 'house-rules',
  detail: 'our modelling guideline',
  covers: { DEAD_END: 'W_DEAD_END' },
  validateDoc: (doc) =>
    doc.processes()
      .flatMap((process) => doc.flowNodes(process))
      .filter((node) => node.$type !== 'bpmn:EndEvent')
      .filter((node) => doc.outgoing(node).length === 0)
      .map((node) => ({
        severity: 'error',
        code: 'DEAD_END',
        message: `${node.id} has no outgoing sequence flow`,
        element: node.id,
      })),
};

let { xml } = await newXml({ processName: 'Order handling' });
({ xml } = await applyToXml(xml, [
  { op: 'add', kind: 'start', name: 'Order received' },
  { op: 'add', kind: 'end', name: 'Done', after: 'Event_OrderReceived' },
]));

try {
  const archive = {
    op: 'add',
    kind: 'userTask',
    name: 'Archive',
    in: 'Process_OrderHandling',
  };
  await applyToXml(xml, [archive], { validators: [houseRules] });
} catch (err) {
  if (!(err instanceof CliError)) throw err;
  err.code;
  // 'E_VALIDATION'
  err.message;
  // 'The change would introduce 1 error(s) reported by validator
  //  house-rules; nothing was written'
  err.details.errors;
  // [{ code: 'DEAD_END',
  //    message: 'Activity_Archive has no outgoing sequence flow',
  //    validator: 'house-rules', severity: 'error',
  //    element: 'Activity_Archive' }]
}

const check = {
  op: 'add',
  kind: 'userTask',
  name: 'Check invoice',
  after: 'Event_OrderReceived',
};
const edit = await applyToXml(xml, [check], { validators: [houseRules] });

edit.result.validation.validators;
// [{ name: 'house-rules', detail: 'our modelling guideline',
//    errors: [], warnings: [], preexisting: [], resolved: [],
//    counts: { errors: 0, warnings: 0 } }]
```

## Writing a validator

A validator is a function `(xml, ctx) => findings`, sync or async, or a `NamedValidator` object:

| field | meaning |
| --- | --- |
| `name` | shown with every finding: `[name]` in text, `validator` in JSON |
| `validate` / `validateDoc` | `(xml, ctx)` or `(doc, ctx)` to findings; read the `Doc`, never change it |
| `detail` | one line on why it runs |
| `covers` | finding code -> the built-in warning it repeats, which is then dropped (`DEAD_END: 'W_DEAD_END'`) |
| `blocks` | `false` makes it advisory |

`ctx` has `file`, `phase` (`'before'`, `'after'` or `'check'`), `platform`, `ops` and `doc()`.

A finding is `{ severity, code, message, element?, hint? }`. `severity: 'error'` (any case) is an
error, anything else a warning. bpmnlint's `{ severity: 'ERROR', ruleId, message }` is accepted
as it is.

## Before and after

A write runs every validator on the document before the ops and on the candidate after them, and
compares the findings:

| finding | blocking (default) | advisory (`blocks: false`) |
| --- | --- | --- |
| an error the change adds | refuses the write (`E_VALIDATION`) unless `force: true` | reported in `result.warnings.added`; the write goes through |
| an error the file already had | `W_PREEXISTING_ERROR`, never blocks | counted only |
| a warning the change adds | reported | reported |
| a finding the change removed | in `result.warnings.resolved` | the same |

So an old problem never makes a file uneditable. A check (`validateXml`, `checkFile`) runs each
validator once and reports every finding.

### Left out

A finding that says nothing about the change (it comes from data the file does not keep) carries
`leftOut: '<reason>'`. A write counts it but never compares it, so it never blocks.

## Advisory validators

A validator with `blocks: false` reports and never refuses. The project's bpmnlint is one
([bpmnlint](bpmnlint.md)). A host can run the plugin's default configuration the same way:

```js
import {
  applyToXml,
  bpmnlintValidator,
  idConventionsFromLint,
  ID_NAMING_RULE,
  resolveBpmnlintConfig,
} from '@miragon/bpmn-cli';
import { bpmnlintEngine } from '@miragon/bpmn-cli/node';

const engine = bpmnlintEngine();
const rc = engine.plugin.getDefaultLintConfig({ engine: 'c7' });
const resolved = await resolveBpmnlintConfig(engine, rc);
const { conventions, notes } = idConventionsFromLint(
  resolved.rules[ID_NAMING_RULE],
  engine.plugin.naming,
);
const lint = bpmnlintValidator(engine, resolved, {
  detail: 'default rules',
  notes,
});
await applyToXml(xml, ops, { validators: [lint], conventions });
```

The engine defaults turn `@miragon/rules/element-id-naming` on. Pass `conventions` to the write, or
the lint reports every new id ([Library: building blocks](library.md#building-blocks)).

## Next steps

- [Library use](library.md): the options of `applyToXml` and the file helpers.
- [bpmnlint](bpmnlint.md): the project's rules on the command line.
