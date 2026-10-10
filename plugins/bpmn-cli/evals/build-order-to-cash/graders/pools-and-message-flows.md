---
type: regex
pattern: '^(?=(?:[\s\S]*?<bpmn:participant\b){2})(?=(?:[\s\S]*?<bpmn:messageFlow\b){4})'
target: { source: file, path: order-to-cash.bpmn }
---
