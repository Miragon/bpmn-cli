---
description: 'Colour the happy path green and move the rejection branch below the main line, without changing the process'
tags: [format, hand-drawn, scaffold]
runs: 2
max_turns: 30
timeout_seconds: 600
allowed_tools: [Skill, Read, Glob, Grep, Bash, Write, Edit]
---

In `claim-handling.bpmn`, please colour the happy path green: from "Claim received" through "Assess claim" and "Pay out claim" to "Claim paid", including the flows between them.

The rejection branch ("Send rejection letter" and "Claim rejected") is currently drawn above the main line; move it below the main line.

This is only about the diagram: the process logic must stay exactly as it is.
