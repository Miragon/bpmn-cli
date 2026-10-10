---
type: regex
pattern: '^(?=[\s\S]*<bpmndi:BPMN(?:Shape|Edge)\b(?=[^>]*bpmnElement="Event_ClaimReceived")(?=[^>]*(?:#c8e6c9|#205022)))(?=[\s\S]*<bpmndi:BPMN(?:Shape|Edge)\b(?=[^>]*bpmnElement="Activity_AssessClaim")(?=[^>]*(?:#c8e6c9|#205022)))(?=[\s\S]*<bpmndi:BPMN(?:Shape|Edge)\b(?=[^>]*bpmnElement="Activity_PayOutClaim")(?=[^>]*(?:#c8e6c9|#205022)))(?=[\s\S]*<bpmndi:BPMN(?:Shape|Edge)\b(?=[^>]*bpmnElement="Event_ClaimPaid")(?=[^>]*(?:#c8e6c9|#205022)))(?=[\s\S]*<bpmndi:BPMN(?:Shape|Edge)\b(?=[^>]*bpmnElement="Flow_AssessClaimToClaimCovered")(?=[^>]*(?:#205022)))(?=[\s\S]*<bpmndi:BPMN(?:Shape|Edge)\b(?=[^>]*bpmnElement="Flow_PayOutClaimToClaimPaid")(?=[^>]*(?:#205022)))'
flags: i
target: { source: file, path: claim-handling.bpmn }
---
