---
type: regex
pattern: '<bpmn:boundaryEvent\b[^>]*\bid="([^"]+)"[^>]*cancelActivity="false"[\s\S]*<bpmn:sequenceFlow\b[^>]*sourceRef="\1"'
target: { source: file, path: purchase-request.bpmn }
---
