# 10. Render and lint stay private packages

Accepted, 2026-11-01.

## Context

Both stand alone, but nobody outside bpmn-cli needs them yet, and a published package brings a second release line.

## Decision

Render and lint stay private packages until someone outside bpmn-cli needs one; esbuild builds them into what bpmn-cli ships.

## Consequences

No second release line and no exact pin before 1.0. Publishing one later changes no code.
