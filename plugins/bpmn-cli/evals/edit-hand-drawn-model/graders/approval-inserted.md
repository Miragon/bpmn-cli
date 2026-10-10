---
type: regex
pattern: '^(?=[\s\S]*?<bpmn:userTask\b(?=[^>]*\bname="[^"]*[Aa]pprov)(?=[^>]*\bid="([^"]+)"))(?=[\s\S]*<bpmn:sequenceFlow\b(?=[^>]*\bid="Flow_0yq6cfd")(?=[^>]*\btargetRef="\1"))(?:(?=[\s\S]*<bpmn:sequenceFlow\b(?=[^>]*\bsourceRef="\1")(?=[^>]*\btargetRef="Activity_1v0w8zr"))|(?=[\s\S]*<bpmn:sequenceFlow\b(?=[^>]*\bsourceRef="\1")(?=[^>]*\btargetRef="([^"]+)"))(?=[\s\S]*<bpmn:sequenceFlow\b(?=[^>]*\bsourceRef="\2")(?=[^>]*\btargetRef="Activity_1v0w8zr")))'
target: { source: file, path: purchase-request.bpmn }
---
