---
description: 'Build an order-to-cash model with lanes, a customer pool and message flows from scratch'
tags: [create, collaboration]
runs: 2
max_turns: 30
timeout_seconds: 600
allowed_tools: [Skill, Read, Glob, Grep, Bash, Write, Edit]
---

We need our order-to-cash process as a BPMN 2.0 diagram in `order-to-cash.bpmn` (in the current directory).

- Our company pool has three lanes: Vertrieb, Lager and Buchhaltung.
- The customer is a separate pool. The customer's order arrives as a message and starts the process.
- Vertrieb checks the order. If it cannot be accepted, Vertrieb sends the customer a rejection (a message) and the process ends.
- Otherwise Lager picks and packs the goods and ships them.
- Then Buchhaltung sends the invoice to the customer (a message) and waits for the customer's payment (a message); when it has arrived, the order is complete.

The diagram has to open cleanly in Camunda Modeler. Tell me briefly what you built.
