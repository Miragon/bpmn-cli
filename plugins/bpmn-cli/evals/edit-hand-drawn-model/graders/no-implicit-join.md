---
type: regex
pattern: '<bpmn:sequenceFlow\b[^>]*\btargetRef="(Activity_[^"]+)"[\s\S]*<bpmn:sequenceFlow\b[^>]*\btargetRef="\1"'
match: 'not_contains'
target: { source: file, path: purchase-request.bpmn }
---
