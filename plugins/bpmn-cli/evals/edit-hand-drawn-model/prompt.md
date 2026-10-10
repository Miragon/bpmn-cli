---
description: 'Insert an approval step and a non-interrupting timer reminder into a hand-drawn model, keeping the drawing'
tags: [change, hand-drawn, scaffold]
runs: 2
max_turns: 30
timeout_seconds: 600
allowed_tools: [Skill, Read, Glob, Grep, Bash, Write, Edit]
---

Our process owner drew `purchase-request.bpmn` by hand in Camunda Modeler and is quite attached to the layout. Two changes are needed:

1. When the budget is available, a manager has to approve the purchase before the goods are ordered.
2. If the manager has not decided within 3 days, send the manager a reminder - the approval itself stays open.

Please change the model accordingly, without messing up the existing drawing.
