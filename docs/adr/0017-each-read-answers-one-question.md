# 17. Each read answers one question

Accepted, 2026-11-01.

## Context

Today's reads overlap: `metrics`, `show --layout`, `ext list` and `--context` answer parts of each other's questions.

## Decision

Each read answers one question: `show` describes the model or one element, `find` lists ids, `diagram` judges the drawing, `conventions` names the id patterns. A flag narrows an answer, never changes its shape.

## Consequences

`find` stays a command; `metrics` and `show --layout` become `diagram`; `ext list` and `--context` go into `show <id>`.
