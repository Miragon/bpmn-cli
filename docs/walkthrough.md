# A worked session

From an empty file to a validated Camunda 8 model with two pools. Claude runs the same session with
the [plugin](./claude-code-plugin.md). A line `...` stands for output left out.

## 1. Create the file

`--target camunda8` makes every result report what Camunda 8 would refuse at deploy.

```console
$ bpmn new order.bpmn "Order handling" --target camunda8
written: order.bpmn
```

## 2. Add the first steps

Each result names its new ids for the next command. A warning carries its fix.

```console{5}
$ bpmn add order.bpmn start "Order received"
...
$ bpmn add order.bpmn userTask "Check invoice" --after startEvent_orderReceived
created userTask: userTask_checkInvoice
warning W_DEAD_END userTask_checkInvoice: userTask userTask_checkInvoice "Check invoice" has no outgoing flow  (Continue the flow (`bpmn add <file> <kind> "<Name>" --after userTask_checkInvoice`) or end it (`bpmn add <file> endEvent "<Name>" --after userTask_checkInvoice`).)
...

$ bpmn add order.bpmn end "Invoice handled" --after userTask_checkInvoice
...
state: 0 errors, 0 warnings (bpmn validate lists them and runs the project's lint)
written: order.bpmn
```

<figure class="diagram">
  <img src="/shots/walkthrough-1-first-steps.svg" alt="Start event Order received, user task Check invoice, end event Invoice handled" />
  <figcaption>After step 2</figcaption>
</figure>

## 3. Branch with one batch

Related changes go into one `bpmn apply` batch: one transaction, one layout pass. `split` inserts
a gateway with its branches and the join; an alias (`"as": "$book"`) names a new element for later
operations.

```json [ops.json]
{
  "ops": [
    {
      "op": "split",
      "after": "userTask_checkInvoice",
      "name": "Invoice ok?",
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
            { "kind": "sendTask", "name": "Ask customer", "as": "$ask" }
          ]
        }
      ]
    },
    {
      "op": "ext",
      "id": "$book",
      "action": "add",
      "type": "zeebe:taskDefinition",
      "attrs": { "type": "book-invoice" }
    }
  ]
}
```

```console{3,6}
$ bpmn apply order.bpmn ops.json
created exclusiveGateway: gateway_invoiceOk, gateway_invoiceOkJoin
aliases: $book = serviceTask_bookInvoice, $ask = sendTask_askCustomer
...
renamed: flow_checkInvoiceToInvoiceHandled -> flow_checkInvoiceToInvoiceOk
warning W_C8_DEPLOY_IMPLEMENTATION sendTask_askCustomer: sendTask sendTask_askCustomer has no zeebe:taskDefinition (nor a zeebe:publishMessage): Camunda 8 needs the job type a worker subscribes to and refuses the file  (Give it a job type: `bpmn ext add <file> sendTask_askCustomer zeebe:taskDefinition type=<jobType>`.)
...
state: 0 errors, 1 warning (bpmn validate lists them and runs the project's lint)
written: order.bpmn
```

<figure class="diagram">
  <img src="/shots/walkthrough-2-split.svg" alt="The gateway Invoice ok? after Check invoice, with the branches Book invoice and Ask customer joined before Invoice handled" />
  <figcaption>The batch's result</figcaption>
</figure>

## 4. Fix the warning

The `ext add` from the hint gives the send task its job type.

```console
$ bpmn ext add order.bpmn sendTask_askCustomer zeebe:taskDefinition type=ask-customer
changed: sendTask_askCustomer
layout quality: score 0 -> 0
state: 0 errors, 0 warnings (bpmn validate lists them and runs the project's lint)
written: order.bpmn
```

## 5. Add the pools and a message flow

::: warning Add the normal pool first
Only a normal pool wraps the existing process. A `--black-box` pool added first fails with
`E_VALIDATION`.
:::

The message flow fits in where the drawing has room and says what that cost: a crossing. A model built
over several writes ends with `bpmn layout`, which redraws it in full.

```console
$ bpmn add order.bpmn participant "Order handling"
created collaboration: collaboration_orderHandling
created participant: participant_orderHandling
note: collaboration collaboration_orderHandling created; participant_orderHandling wraps the existing process orderHandling
...
$ bpmn add order.bpmn participant "Customer" --black-box
created participant: participant_customer
...
$ bpmn connect order.bpmn sendTask_askCustomer participant_customer message=Question
created message: message_question
created messageFlow: messageFlow_askCustomerToCustomer
layout quality: score 0 -> 5; added: crossings flow_invoiceOkToBookInvoice x messageFlow_askCustomerToCustomer
...
$ bpmn layout order.bpmn
...
layout quality: score 5 -> 0; resolved: crossings flow_invoiceOkToBookInvoice x messageFlow_askCustomerToCustomer
...
```

<figure class="diagram">
  <img src="/shots/walkthrough-3-pools.svg" alt="The order process in the pool Order handling, a message flow Question from Ask customer to the black-box pool Customer" />
  <figcaption>The final model with two pools</figcaption>
</figure>

## 6. Read and validate the result

`show` prints the model in flow order.

```console
$ bpmn show order.bpmn
namespaces: zeebe, modeler
collaboration collaboration_orderHandling
  participant participant_orderHandling "Order handling" = orderHandling
  participant participant_customer "Customer" (black box)
  messageFlow messageFlow_askCustomerToCustomer: sendTask_askCustomer "Ask customer" -> participant_customer "Customer" [message Question]
process orderHandling "Order handling" executable in participant_orderHandling
  startEvent startEvent_orderReceived "Order received" -> userTask_checkInvoice (flow_orderReceivedToCheckInvoice)
  userTask userTask_checkInvoice "Check invoice" [ext: zeebe:userTask] -> gateway_invoiceOk (flow_checkInvoiceToInvoiceOk)
  exclusiveGateway gateway_invoiceOk "Invoice ok?" -> serviceTask_bookInvoice (flow_invoiceOkToBookInvoice "yes" if = ok), sendTask_askCustomer (flow_invoiceOkToAskCustomer "no" default)
  serviceTask serviceTask_bookInvoice "Book invoice" [job=book-invoice, ext: zeebe:taskDefinition] -> gateway_invoiceOkJoin (flow_bookInvoiceToInvoiceOkJoin)
  exclusiveGateway gateway_invoiceOkJoin -> endEvent_invoiceHandled (flow_invoiceOkJoinToInvoiceHandled)
  endEvent endEvent_invoiceHandled "Invoice handled"
  sendTask sendTask_askCustomer "Ask customer" [job=ask-customer, ext: zeebe:taskDefinition] -> gateway_invoiceOkJoin (flow_askCustomerToInvoiceOkJoin)
root: message message_question "Question"
state: 0 errors, 0 warnings (bpmn validate lists them and runs the project's lint)

$ bpmn validate order.bpmn
platform: c8 (modeler:executionPlatform "Camunda Cloud") - 0 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 0 warning(s)
```

## Next steps

- [Layout and formatting](./layout.md) continues with this file.
- [Operations (`bpmn apply`)](./ops.md): the batch format. `bpmn guide workflow` prints these steps in short.
- [Camunda 7 and Camunda 8](./camunda.md): engine settings and deploy rules.
