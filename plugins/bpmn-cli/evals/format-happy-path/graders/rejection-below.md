---
type: regex
pattern: '^(?=[\s\S]*bpmnElement="Activity_SendRejectionLetter"[^>]*>\s*<dc:Bounds x="[-\d.]+" y="(?:3\d\d|[4-9]\d\d|\d{4,})(?:\.\d+)?")(?=[\s\S]*bpmnElement="Event_ClaimRejected"[^>]*>\s*<dc:Bounds x="[-\d.]+" y="(?:3\d\d|[4-9]\d\d|\d{4,})(?:\.\d+)?")'
target: { source: file, path: claim-handling.bpmn }
---
