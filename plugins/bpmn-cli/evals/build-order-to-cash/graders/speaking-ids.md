---
type: regex
pattern: '\bid="(?!Definitions_|BPMNDiagram_|BPMNPlane_)[A-Za-z]+_(?:\d+|[0-9][0-9a-z]{6})"'
match: 'not_contains'
target: { source: file, path: order-to-cash.bpmn }
---
