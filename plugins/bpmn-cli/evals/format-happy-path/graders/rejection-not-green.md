---
type: regex
pattern: '<bpmndi:BPMN(?:Shape|Edge)\b(?=[^>]*bpmnElement="(?:Activity_SendRejectionLetter|Event_ClaimRejected|Flow_SendRejectionLetterToClaimRejected)")(?=[^>]*(?:#c8e6c9|#205022))'
flags: i
match: 'not_contains'
target: { source: file, path: claim-handling.bpmn }
---
