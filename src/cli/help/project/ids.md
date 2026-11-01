# Ids

- Named element: prefix + name, `userTask_checkInvoice`.
- Unnamed: prefix + kind and place, `gateway_afterCheckInvoice`, `event_timerOnReview`.
- Flow: `flow_checkInvoiceToBookInvoice`, message flow `messageFlow_`.
- Process: its name in the case, `orderToCash`; unnamed `Process_1`.
- At most 64 characters, cut at whole words. Umlauts become ae, oe, ue, ss. Never a hash or a running number.
- `--id` and `"id"` are taken as given.
