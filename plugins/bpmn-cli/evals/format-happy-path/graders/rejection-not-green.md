---
type: regex
pattern: '<bpmndi:BPMN(?:Shape|Edge)\b(?=[^>]*bpmnElement="(?:Activity_SendRejectionLetter|Event_ClaimRejected|Flow_SendRejectionLetterToClaimRejected)")(?=[^>]*(?:#(?:c8e6c9|205022|e8f5e9|a5d6a7|81c784|66bb6a|4caf50|43a047|388e3c|2e7d32|1b5e20|b9f6ca|69f0ae|00e676|00c853|008000|00ff00|0f0|080|32cd32|228b22|006400|2e8b57|3cb371|90ee90|98fb98|00ff7f|7cfc00|7fff00|9acd32|6b8e23|8fbc8f|adff2f)\b|"(?:[a-z]*green|lime)"))'
flags: i
match: 'not_contains'
target: { source: file, path: claim-handling.bpmn }
---
