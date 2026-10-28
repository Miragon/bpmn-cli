---
type: regex
pattern: '^(?=[\s\S]*bpmnElement="userTask_assessClaim"[^>]*>\s*<dc:Bounds x="270" y="220")(?=[\s\S]*bpmnElement="serviceTask_payOutClaim"[^>]*>\s*<dc:Bounds x="540" y="220")'
target: { source: file, path: claim-handling.bpmn }
---
