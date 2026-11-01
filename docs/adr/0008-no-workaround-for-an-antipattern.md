# 8. No workaround for an antipattern

Accepted, 2026-11-01.

## Context

bpmn-cli carries workarounds that hide bad models and cost code.

## Decision

bpmn-cli has no workaround for an antipattern: it draws and edits by the standard, and a check or the layout score shows what is off.

## Consequences

Three workarounds go: a task widened for three boundary events, a new shape sized like hand-drawn neighbours, a boundary event pushed over the corner.
