# 3. New shapes get the bpmn-js size

Accepted, 2026-11-01.

## Context

A shape sized after its neighbours or widened for what it carries drifts from what Camunda Modeler draws, and bpmnlint's `standard-size` checks the bpmn-js sizes.

## Decision

Shapes bpmn-cli creates get the bpmn-js size: 100 by 80 for a task, 50 by 50 for a gateway, 36 by 36 for an event. A shape never grows for what it carries.

## Consequences

`ShapeSizes`' test holds the table to the rule, and `test/fixtures/standard-size.test.ts` runs the rule over every drawn model.
