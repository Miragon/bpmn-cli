---
type: regex
pattern: '^(?=[\s\S]*<bpmn:(?:task|sendTask|serviceTask|userTask|manualTask|scriptTask|businessRuleTask)\b[^>]*\bid="([^"]+)"[^>]*\bname="Inform requester")(?=[\s\S]*<bpmn:sequenceFlow\b[^>]*\bsourceRef="sendTask_returnInvoiceToSupplier"[^>]*\btargetRef="\1")(?=[\s\S]*<bpmn:sequenceFlow\b[^>]*\bsourceRef="\1"[^>]*\btargetRef="endEvent_invoiceReturned")'
flags: i
target: { source: file, path: invoice-approval.bpmn }
---
