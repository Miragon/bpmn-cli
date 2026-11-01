# 1. Rebuild on one branch, one draft PR into main

Accepted, 2026-11-01.

## Context

Today's code works but is hard to change. A new repository loses the issues, the marketplace path and npm trusted publishing; a refactor in place bends new code to old seams; a tree beside `src/` means two gates.

## Decision

The rebuild grows on its own branch, `rebuild`, as one draft PR into main, one commit or a few per step. It is rebased onto main whenever main moves. Main keeps today's code, takes fixes and releases at the owner's call.

## Consequences

The oracle judges against the commit `rebuild` sits on, and each rebase ports main's new fixes. The plan ends with the draft PR; the merge comes later.
