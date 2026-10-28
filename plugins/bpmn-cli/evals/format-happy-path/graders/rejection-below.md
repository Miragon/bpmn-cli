---
type: regex
pattern: '^(?=[\s\S]*bpmnElement="sendTask_sendRejectionLetter"[^>]*>\s*<dc:Bounds x="[-\d.]+" y="(?:3\d\d|[4-9]\d\d|\d{4,})(?:\.\d+)?")(?=[\s\S]*bpmnElement="endEvent_claimRejected"[^>]*>\s*<dc:Bounds x="[-\d.]+" y="(?:3\d\d|[4-9]\d\d|\d{4,})(?:\.\d+)?")'
target: { source: file, path: claim-handling.bpmn }
---
