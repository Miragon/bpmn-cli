# 8. The layout score is a module of its own

Accepted, 2026-11-01.

## Context

drawing, write and views all judge a layout, and the score grows by one problem at a time.

## Decision

The layout score is a module of its own, `scoring`, below drawing: a `Scorer` runs one `ScoringCriterion` class per problem or group of problems; it imports only model and render's `./text`, and only drawing, write and views import it.

## Consequences

A new problem is one new criterion class with its own test, and the CLI and the tests read the same score.
