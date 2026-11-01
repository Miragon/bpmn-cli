# 7. New shapes get the bpmn-js size

Accepted, 2026-11-01.

## Context

Today a new shape copies the median of its neighbours and a task widens for what it carries, so a file drifts from what Camunda Modeler draws. bpmnlint's `standard-size` checks the bpmn-js sizes.

## Decision

Shapes bpmn-cli creates get the bpmn-js size: 100 by 80 for a task, 50 by 50 for a gateway, 36 by 36 for an event. A shape never grows for what it carries.

## Consequences

A new shape no longer copies its neighbours and a task never widens. `ShapeSizes`' test holds the table to the rule, and `test/corpus/` runs the rule over every drawn model.
