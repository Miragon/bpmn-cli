---
type: regex
pattern: '^(?=[\s\S]*<bpmn:userTask\b[^>]*name="[^"]*[Aa]pprov)(?=[\s\S]*<bpmn:sequenceFlow\b(?=[^>]*\bid="Flow_0yq6cfd")(?=[^>]*targetRef="[^"]*[Aa]pprov))(?=[\s\S]*<bpmn:sequenceFlow\b(?=[^>]*sourceRef="[^"]*[Aa]pprov)(?=[^>]*targetRef="Activity_1v0w8zr"))'
target: { source: file, path: purchase-request.bpmn }
---
