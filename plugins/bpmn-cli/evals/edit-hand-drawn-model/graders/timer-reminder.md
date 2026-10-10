---
type: regex
pattern: '^(?=[\s\S]*?<bpmn:userTask\b(?=[^>]*\bname="[^"]*[Aa]pprov)(?=[^>]*\bid="([^"]+)"))[\s\S]*<bpmn:boundaryEvent\b(?=[^>]*cancelActivity="false")(?=[^>]*attachedToRef="\1")[^>]*>[\s\S]*?<bpmn:timerEventDefinition\b[\s\S]*?>\s*(?:P3D|PT72H)\s*<'
target: { source: file, path: purchase-request.bpmn }
---
