---
description: 'Camunda 7 external task with input mapping, error mapping and an error boundary path that passes validate --strict'
tags: [camunda7, change, scaffold]
runs: 2
max_turns: 30
timeout_seconds: 600
allowed_tools: [Skill, Read, Glob, Grep, Bash, Write, Edit]
---

`payment.bpmn` is our Camunda 7 payment process. Please make "Charge credit card" an external task with the topic `charge-credit-card` that gets the order total as the local input variable `amount` (expression `${order.total}`).

If the worker reports a declined card, that must become the BPMN error `CARD_DECLINED`: map it on the external task with the error expression `${declined}`, catch it on the task with an error boundary event and route it to a user task "Inform customer", after which the process ends as "Payment failed".

Our CI rejects models that do not pass `bpmn validate --strict`, so make sure it passes.
