---
type: regex
pattern: '<bpmn:boundaryEvent\b(?=[^>]*cancelActivity="false")(?=[^>]*attachedToRef="[^"]*[Aa]pprov)[^>]*>[\s\S]*?<bpmn:timerEventDefinition\b[\s\S]*?>\s*(?:P3D|PT72H)\s*<'
target: { source: file, path: purchase-request.bpmn }
---
