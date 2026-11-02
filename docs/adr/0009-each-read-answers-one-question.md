# 9. Each read answers one question

Accepted, 2026-11-01.

## Context

Reads whose answers overlap make a caller combine several of them and guess which one is right.

## Decision

Each read answers one question: `show` describes the model or one element, `find` lists ids, `diagram` judges the drawing, `conventions` names the id patterns. A flag narrows an answer, never changes its shape.

## Consequences

A new question gets a read of its own or narrows an existing one by a flag; no read takes a flag that turns its answer into another's.
