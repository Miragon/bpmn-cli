# 5. Render and lint stay private packages

Accepted, 2026-11-01.

## Context

`packages/render` and `packages/lint` stand alone, but nobody outside bpmn-cli needs them, and a published package brings a release line of its own.

## Decision

Render and lint stay private packages until someone outside bpmn-cli needs one; esbuild builds them into what bpmn-cli ships.

## Consequences

bpmn-cli has one release line. Publishing one of them later changes no code.
