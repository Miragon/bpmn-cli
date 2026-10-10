---
type: regex
pattern: '\bid="(?!Definitions_|BPMNDiagram_|BPMNPlane_|(?:StartEvent_1|Process_0c4m2wd|Activity_0k3x9qa|Gateway_1hd8x2m|Activity_1v0w8zr|Event_0q2mb7c|Activity_0f3j5ny|Event_1n8ld0a|Flow_0b8wq1x|Flow_1j4kz7p|Flow_0yq6cfd|Flow_1r2x9bv|Flow_0m7sd3e|Flow_1c5ag8h)")[A-Za-z]+_(?:\d+|[0-9][0-9a-z]{6})"'
match: 'not_contains'
target: { source: file, path: purchase-request.bpmn }
---
