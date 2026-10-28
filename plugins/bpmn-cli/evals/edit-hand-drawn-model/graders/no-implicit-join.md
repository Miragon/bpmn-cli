---
type: regex
pattern: '<bpmn:sequenceFlow\b[^>]*\btargetRef="((?:Activity|task|userTask|sendTask|serviceTask|receiveTask|manualTask|scriptTask|businessRuleTask|callActivity|subProcess)_[^"]+)"[\s\S]*<bpmn:sequenceFlow\b[^>]*\btargetRef="\1"'
match: 'not_contains'
target: { source: file, path: purchase-request.bpmn }
---
