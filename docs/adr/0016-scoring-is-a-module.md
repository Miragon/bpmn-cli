# 16. The layout score is a module of its own

Accepted, 2026-11-01.

## Context

The score sits in the layout code, 18 check methods in one class of 575 lines, with a second copy in `tools/layout-regress.mjs`.

## Decision

The layout score is a module of its own, `scoring`, below drawing: a `Scorer` runs one `ScoringCriterion` class per problem or group of problems; it imports only model and render's `./text`, and only drawing, write and views import it.

## Consequences

The 115 layout scenarios run in drawing's tests from `corpus/layout/`; `tools/layout-regress.mjs` and its second copy of the analysis go.
