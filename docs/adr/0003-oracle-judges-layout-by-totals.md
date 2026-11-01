# 3. The oracle judges the layout by totals

Accepted, 2026-11-01.

## Context

A rebuilt layout moves coordinates, so a single file can score higher while the whole improves. Main's gate already judges a total.

## Decision

The oracle judges the layout as main's gate does today: the total over the 115 scenarios and the total over the walk steps score no higher than main's.

## Consequences

A single file or step that scores higher is listed, not failed, as the fuzz's `--hard warn` lists hard defects.
