# Kinds

`bpmn add <file> <kind[:trigger]>`; aliases in parentheses.

- Tasks: task, userTask (user), serviceTask (service), scriptTask (script), sendTask (send), receiveTask (receive), manualTask (manual), businessRuleTask (rule, businessRule, decision)
- Sub-processes: subProcess (sub), eventSubProcess (eventSub), adHocSubProcess (adhoc), transaction
- Call activity: callActivity (call)
- Gateways: exclusiveGateway (xor, exclusive), parallelGateway (and, parallel), inclusiveGateway (or, inclusive), complexGateway (complex), eventBasedGateway (eventBased, event-based, eventGateway)
- Events: startEvent (start), endEvent (end), intermediateCatchEvent (catch, icatch, catchEvent), intermediateThrowEvent (throw, ithrow, throwEvent), boundaryEvent (boundary)
- Pools: participant (pool)
- Lanes: lane
- Data: dataObject (data, dataObjectReference), dataStore (store, dataStoreReference)
- Artifacts: textAnnotation (note, annotation, text), group
