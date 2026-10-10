---
type: regex
pattern: '^(?=[\s\S]*<bpmn:exclusiveGateway\b)(?=[\s\S]*<bpmn:conditionExpression\b[^>]*>\s*=)'
target: { source: file, path: retoure.bpmn }
---
