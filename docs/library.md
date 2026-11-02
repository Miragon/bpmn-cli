# Library

bpmn-cli as a package, for tools that embed it, such as a modeler. It runs in Node and in the
browser. Agents and scripts use the CLI.

```sh
npm install @miragon/bpmn-cli
```

## Edit a model

Every function takes the XML as a string. A write returns the new XML together with what the CLI
would print.

```ts
import { applyToXml, BpmnError, newXml, showXml } from '@miragon/bpmn-cli';

let xml = await newXml({ name: 'Order handling', target: 'camunda8' });
const edit = await applyToXml(xml, [
  { op: 'add', kind: 'start', name: 'Order received' },
  { op: 'add', kind: 'userTask', name: 'Check invoice', after: 'startEvent_orderReceived' },
  { op: 'add', kind: 'end', name: 'Done', after: 'userTask_checkInvoice' },
]);
if (!edit.unchanged) {
  xml = edit.xml;
}
edit.created.map((change) => change.id);
// ['startEvent_orderReceived', 'userTask_checkInvoice', 'flow_orderReceivedToCheckInvoice', 'endEvent_done', 'flow_checkInvoiceToDone']

(await showXml(xml)).text;
// the text of `bpmn show`

try {
  await applyToXml(xml, [{ op: 'add', kind: 'userTask', name: 'Ship', after: 'userTask_check' }]);
} catch (error) {
  if (!(error instanceof BpmnError)) {
    throw error;
  }
  error.code;               // 'E_NOT_FOUND'
  error.details.candidates; // ['userTask_checkInvoice']
}
```

The operations are those of `bpmn apply` ([Model a process](./modeling.md#2-branch-with-one-batch));
`OPS_SCHEMA` is their JSON Schema. A failure throws a `BpmnError` with `code`, `category` (`usage`,
`model`, `layout`, `io`, `internal`) and `details`, and the caller still has its input.

## The exports

| export | like |
| --- | --- |
| `applyToXml(xml, operations, options?)` | `bpmn apply`, and every edit and draw command |
| `showXml(xml, { id?, in?, around?, depth? })` | `bpmn show` |
| `findXml(xml, { text?, kind?, in? })` | `bpmn find` |
| `diagramXml(xml)` | `bpmn diagram` |
| `renderXml(xml, { ids?, around?, depth?, path?, problems? })` | `bpmn render`, as SVG |
| `validateXml(xml, { validators? })` | `bpmn validate`, without the project's bpmnlint |
| `newXml({ name?, id?, target?, conventions? })` | `bpmn new` |
| `kindsJson({ conventions? })` | the kinds and triggers of `bpmn guide kinds`, with each kind's id pattern |
| `OPS_SCHEMA` | the JSON Schema of the operations |
| `BpmnError` | the error every function throws |

The full signatures ship as TypeScript types. A read returns `{ text, ... }`: the printed text and
the same answer as data, as `--json` prints it.

`EditResult` holds `xml` and `unchanged`, the elements `created`, `changed`, `removed` and `renamed`,
the `aliases` of the batch, the `findings` at the touched elements, `preexisting` validator errors,
the `state` of the whole file and the layout `score` before and after.

- **Redraw:** `applyToXml(xml, [{ op: 'layout' }])`. There is no separate layout function.
- **Id conventions:** without `conventions`, new ids follow the defaults of
  `@miragon/rules/element-id-naming`. A host whose lint configures that rule passes the same settings:
  `{ conventions: { prefixes: { 'bpmn:ServiceTask': 'st_' }, case: 'snake_case' } }`.
- **Browser:** the core weighs about 800 KB minified; the Camunda rules and the painter load on first
  use. PNG output and bpmnlint are the CLI's only.

## Validators

A host can run its own rules inside a write. A validator sees the XML that would be written, and an
error the change adds refuses the write with `E_VALIDATION`.

```ts
import { applyToXml, findXml, type Validator } from '@miragon/bpmn-cli';

const houseRules: Validator = {
  name: 'house-rules',
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

await applyToXml(xml, operations, { validators: [houseRules] });
```

A finding is `{ severity, code, message, element?, related?, hint?, key? }`; `severity: 'error'` is an
error, anything else a warning. bpmnlint's findings are accepted as they are, so a host can pass its
lint as a validator.

| finding | blocking validator (default) | advisory (`blocks: false`) |
| --- | --- | --- |
| an error the change adds | refuses the write, unless `force: true` | in `findings` |
| a warning the change adds | in `findings` | in `findings` |
| an error the file already had | in `preexisting`, never blocks | the same |

So an old problem never makes a file uneditable. `validateXml` runs each validator once and reports
every finding.
