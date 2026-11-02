# Zeebe elements

`bpmn ext add <file> <id> <type> attr=value`. `single`: one per element; `[…]`: its children.

- `zeebe:ioMapping` single: [input] [output]
- `zeebe:subscription` single on a message: correlationKey
- `zeebe:input` in zeebe:ioMapping: source target
- `zeebe:output` in zeebe:ioMapping: source target
- `zeebe:taskHeaders` single: [header]
- `zeebe:header` in zeebe:taskHeaders: id key value
- `zeebe:taskDefinition` single: type retries
- `zeebe:loopCharacteristics` single on `loop.`: inputCollection inputElement outputCollection outputElement
- `zeebe:calledElement` single: processId processIdExpression propagateAllChildVariables propagateAllParentVariables businessId bindingType versionTag
- `zeebe:userTaskForm`: id
- `zeebe:formDefinition` single: formKey formId externalReference bindingType versionTag
- `zeebe:linkedResource` in zeebe:linkedResources: resourceId resourceType linkName bindingType versionTag
- `zeebe:linkedResources` single: [linkedResource]
- `zeebe:userTask` single: -
- `zeebe:calledDecision` single: decisionId resultVariable bindingType versionTag
- `zeebe:assignmentDefinition` single: assignee candidateGroups candidateUsers
- `zeebe:priorityDefinition` single: priority
- `zeebe:jobPriorityDefinition`: priority
- `zeebe:taskSchedule` single: dueDate followUpDate
- `zeebe:properties` single: [property]
- `zeebe:property` in zeebe:properties: name value
- `zeebe:script` single: expression resultVariable
- `zeebe:executionListeners` single: [executionListener]
- `zeebe:executionListener` in zeebe:executionListeners: eventType retries type [taskHeaders]
- `zeebe:taskListeners` single: [taskListener]
- `zeebe:taskListener` in zeebe:taskListeners: eventType retries type
- `zeebe:versionTag` single: value
- `zeebe:adHoc` single: activeElementsCollection outputCollection outputElement
- `zeebe:conditionalFilter` single on `definition.`: variableNames variableEvents
- `zeebe:agentDefinition`: agentType
- `zeebe:publishMessage` single on `definition.`: correlationKey messageId timeToLive
