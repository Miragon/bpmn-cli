# Nested keys

Keys of elements without an id, `<slot>.<key>`; each slot also takes `id`.

`definition.`:
- MessageEventDefinition: messageRef camunda:resultVariable camunda:expression camunda:class camunda:delegateExpression camunda:type camunda:topic camunda:taskPriority
- ErrorEventDefinition: errorRef camunda:errorCodeVariable camunda:errorMessageVariable
- SignalEventDefinition: signalRef camunda:async
- EscalationEventDefinition: escalationRef camunda:escalationCodeVariable
- ConditionalEventDefinition: camunda:variableName camunda:variableEvents
- LinkEventDefinition: name
- CompensateEventDefinition: waitForCompletion activityRef

`loop.`:
- MultiInstanceLoopCharacteristics: isSequential behavior oneBehaviorEventRef noneBehaviorEventRef camunda:async camunda:asyncBefore camunda:asyncAfter camunda:exclusive camunda:jobPriority camunda:collection camunda:elementVariable
- StandardLoopCharacteristics: testBefore loopMaximum

`condition.`:
- FormalExpression: language evaluatesToTypeRef camunda:resource
