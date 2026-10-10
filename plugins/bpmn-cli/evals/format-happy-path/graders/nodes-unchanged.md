---
type: regex
pattern: '<bpmn:(?:startEvent|endEvent|userTask|serviceTask|sendTask|exclusiveGateway)\b'
match: 'count:7'
target: { source: file, path: claim-handling.bpmn }
---
