---
description: 'Add a step to a hand-drawn model and clean up its drawing (a label on a task, two crossing flows) without moving the main line'
tags: [format, hand-drawn, look, scaffold]
runs: 2
max_turns: 30
timeout_seconds: 600
allowed_tools: [Skill, Read, Glob, Grep, Bash, Write, Edit]
---

In `invoice-approval.bpmn`, when an invoice goes back to the supplier, the requester has to be told as well: please add an email step "Inform requester" after "Return invoice to supplier", before the process ends with "Invoice returned".

Our reviewer also found the diagram hard to read in places. Please clean up the drawing while you are at it. Keep the main line from "Invoice received" to "Invoice paid" where it is, and do not change the process apart from the new step.
