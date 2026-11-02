# Operations (`bpmn apply`)

`bpmn apply <file> ops.json` (or `-` for stdin) runs many changes as one transaction. Use it
whenever a change touches more than one element.

::: tip From the CLI
`bpmn guide ops` lists every operation with its keys. Programs read `OPS_SCHEMA`, the JSON Schema of all
operations, from the [library](library.md).
:::

## Running a batch

- If any operation fails, nothing is written and the error names it (`ops[3] (add): ...`).
- Only the final state is validated and laid out. Steps that are invalid alone (an event sub-process
  before its start event) pass.
- An operation is an object with `"op"` and the flags of the matching command in lowerCamelCase
  (`--flow-name` -> `flowName`). What the element holds, the `key=value`s of the command, goes under
  `"set"`. The input is an array of operations or `{"ops": [...]}`.
- Operations are parsed strictly: an unknown key answers `E_USAGE` and names the keys the operation takes.
- Model operations come first. A model operation after a drawing operation answers `E_USAGE`: send two
  batches.
- `--dry-run` runs a risky batch without writing.

## A first batch

`"as": "$book"` names the new task, so later operations never guess its id.

```json [book.json]
[
  {
    "op": "add",
    "kind": "serviceTask",
    "name": "Book invoice",
    "after": "userTask_checkInvoice",
    "as": "$book"
  },
  {
    "op": "set",
    "id": "$book",
    "set": { "doc": "Posts the invoice to the ledger." }
  },
  {
    "op": "ext",
    "id": "$book",
    "action": "add",
    "type": "zeebe:taskDefinition",
    "attrs": { "type": "book-invoice" }
  }
]
```

```console
$ bpmn apply order.bpmn book.json
created serviceTask: serviceTask_bookInvoice
created sequenceFlow: flow_bookInvoiceToInvoiceHandled
aliases: $book = serviceTask_bookInvoice
changed: flow_checkInvoiceToBookInvoice
renamed: flow_checkInvoiceToInvoiceHandled -> flow_checkInvoiceToBookInvoice
note: inserted between userTask_checkInvoice and endEvent_invoiceHandled
layout quality: score 0 -> 0
state: 0 errors, 0 warnings (bpmn validate lists them and runs the project's lint)
written: order.bpmn
```

## The operations

Nine change what the model says, eight only where things are drawn.

| operation | required keys |
| --- | --- |
| `add` | `kind` |
| `connect` | `source`, `target` |
| `set` | `id`, `set` |
| `remove` | `ids` |
| `retype` | `id`, `kind` |
| `move` | `ids` |
| `order` | `id` |
| `ext` | `id`, `action` (`add` / `remove`) |
| `split` | `after`, `branches` |
| `layout`, `tidy`, `compact` | none |
| `place`, `space` | see `bpmn guide ops` |
| `color` | `color` |
| `label` | `id`, `side` |
| `route` | `id` |

## `split`

`split` exists only in a batch. It places a gateway after the anchor, creates every branch and a join
gateway of the same kind. An empty `nodes` list is a direct flow to the join. A branch that ends in an
end event stops there.

## Aliases

| key | names | on |
| --- | --- | --- |
| `"as"` | what the operation creates | `add`, `connect`, `split`, split nodes |
| `"flowAs"` | the flow into a new node | `add` that appends or prepends, split nodes |
| `"outAs"` | the one flow an `add` creates out of the new node | `add` that splices, prepends or has `"to"` |
| `"joinAs"` | the join of a split | `split` |
| `"refAs"` | the message, error, signal or escalation | `add` with a trigger |

An alias is defined once and used only after its operation. It follows its element through a rename and a
retype. On a splice `"flowAs"` names the flow into the new node and `"outAs"` the flow the splice
creates (new node -> old successor), so the same batch can give it a condition:

```json
{
  "op": "add",
  "kind": "exclusiveGateway",
  "name": "Valid?",
  "flow": "flow_checkToOk",
  "as": "$valid",
  "outAs": "$yes"
}
```

## A full example

After a start event, a "Check invoice" user task and an end event in a Camunda 8 file, this batch
splits after the check, adds a reminder timer with its own path and gives both tasks a job type.

```json [ops.json]
{
  "ops": [
    {
      "op": "split",
      "after": "userTask_checkInvoice",
      "kind": "exclusiveGateway",
      "name": "Invoice ok?",
      "as": "$ok",
      "branches": [
        {
          "flowName": "yes",
          "condition": "= ok",
          "nodes": [
            {
              "kind": "serviceTask",
              "name": "Book invoice",
              "as": "$book"
            }
          ]
        },
        {
          "flowName": "no",
          "default": true,
          "nodes": [
            {
              "kind": "userTask",
              "name": "Clarify invoice",
              "as": "$clarify",
              "set": {
                "doc": "Call the customer and clarify the open positions."
              }
            }
          ]
        }
      ]
    },
    {
      "op": "add",
      "kind": "boundaryEvent:timer",
      "name": "Reminder",
      "on": "$clarify",
      "as": "$reminder",
      "set": { "timer": "P2D", "nonInterrupting": true }
    },
    {
      "op": "add",
      "kind": "sendTask",
      "name": "Remind customer",
      "after": "$reminder",
      "as": "$remind"
    },
    {
      "op": "add",
      "kind": "endEvent",
      "name": "Reminder sent",
      "in": "orderHandling",
      "as": "$sent"
    },
    { "op": "connect", "source": "$remind", "target": "$sent" },
    {
      "op": "set",
      "id": "$book",
      "set": {
        "name": "Book invoice in ERP",
        "doc": "Posts the invoice to the ledger."
      }
    },
    {
      "op": "ext",
      "id": "$book",
      "action": "add",
      "type": "zeebe:taskDefinition",
      "attrs": { "type": "book-invoice", "retries": "3" }
    },
    {
      "op": "ext",
      "id": "$remind",
      "action": "add",
      "type": "zeebe:taskDefinition",
      "attrs": { "type": "remind-customer" }
    }
  ]
}
```

<figure class="diagram">
  <img src="/shots/ops-batch-result.svg" alt="The order process after the batch: the gateway Invoice ok? with the branches Book invoice in ERP and Clarify invoice, a join, and a non-interrupting reminder timer on Clarify invoice that leads to Remind customer and Reminder sent" />
  <figcaption>The result of the batch, laid out in one pass</figcaption>
</figure>

## Next steps

- [Commands](commands.md): the command behind each operation, with its flags.
- [Camunda 7 and Camunda 8](camunda.md): the extension elements the `ext` operations write.
- [A worked session](walkthrough.md): a batch inside a whole modelling session.
