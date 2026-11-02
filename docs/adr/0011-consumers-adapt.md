# 11. Consumers adapt to what the refactoring drops

Accepted, 2026-11-01.

## Context

The refactoring drops much of today's surface, and keeping it for one reader would keep the code behind it.

## Decision

Where a consumer reads something the refactoring drops, the consumer adapts along its map; bpmn-cli keeps it only when a consumer cannot do without it or it costs bpmn-cli nothing.

## Consequences

design-iq lists `validateXml`'s findings in its own `validate_bpmn` and drops the layout mode. bpmn-cli keeps the host validator phases and `validate`'s layout dry run.
