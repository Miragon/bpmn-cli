---
type: regex
pattern: '<bpmn:(?:startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent|task|userTask|serviceTask|sendTask|receiveTask|scriptTask|manualTask|businessRuleTask|exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|subProcess|callActivity)\b'
match: 'count:12'
target: { source: file, path: invoice-approval.bpmn }
---
