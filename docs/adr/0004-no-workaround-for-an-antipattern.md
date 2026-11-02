# 4. No workaround for an antipattern

Accepted, 2026-11-01.

## Context

A layout that hides a bad model, for example by widening a task for its boundary events, costs code and keeps the model bad.

## Decision

bpmn-cli has no workaround for an antipattern: it draws and edits by the standard, and a check or the layout score shows what is off.

## Consequences

A task keeps its size however many boundary events it carries, and a boundary event stays where the standard puts it. Fixing such a model is the modeller's call, guided by the finding.
