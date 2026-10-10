---
type: regex
pattern: '^(?=[\s\S]*bpmnElement="Activity_AssessClaim"[^>]*>\s*<dc:Bounds x="270" y="220")(?=[\s\S]*bpmnElement="Activity_PayOutClaim"[^>]*>\s*<dc:Bounds x="540" y="220")'
target: { source: file, path: claim-handling.bpmn }
---
