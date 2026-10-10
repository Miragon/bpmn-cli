/**
 * `show <id> --context` (step 3, verifier round): what can interrupt an
 * element (the boundary events of every kind on the sub-processes around
 * it, non-interrupting ones marked), the message of a message element (id,
 * name, Camunda 8 correlation key) with the message flows of that message,
 * also those drawn to the element's pool, a message flow's ends with their
 * pools, and what uses a message / signal / error / escalation. Synthetic
 * model only.
 */
import { describe, expect, it } from 'vitest';
import { showXml } from '../src/api.js';
import { elementContext } from '../src/context.js';
import { Doc } from '../src/document.js';

/**
 * A shop pool (Process_Shop) between two black boxes (Customer, Bank).
 * Activity_Fulfil (sub-process) holds Activity_Pack (sub-process) holding
 * Activity_PickItems; Activity_Fulfil carries a boundary event of every kind,
 * Activity_Pack a non-interrupting timer. The payment and the cancellation
 * are drawn to the pool, the order to the start event, the reminder (no
 * messageRef, named like its message) from the send task to the customer.
 */
const SHOP = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_Shop" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collaboration_Shop">
    <bpmn:participant id="Participant_Shop" name="Shop" processRef="Process_Shop" />
    <bpmn:participant id="Participant_Customer" name="Customer" />
    <bpmn:participant id="Participant_Bank" name="Bank" />
    <bpmn:messageFlow id="Flow_Order" name="Order" sourceRef="Participant_Customer" targetRef="Event_OrderReceived" messageRef="Message_Order" />
    <bpmn:messageFlow id="Flow_Payment" name="Payment" sourceRef="Participant_Bank" targetRef="Participant_Shop" messageRef="Message_Payment" />
    <bpmn:messageFlow id="Flow_Cancel" name="Cancel" sourceRef="Participant_Customer" targetRef="Participant_Shop" messageRef="Message_Cancel" />
    <bpmn:messageFlow id="Flow_Invoice" name="Invoice" sourceRef="Participant_Bank" targetRef="Participant_Shop" />
    <bpmn:messageFlow id="Flow_Reminder" name="Reminder" sourceRef="Activity_SendReminder" targetRef="Participant_Customer" />
  </bpmn:collaboration>
  <bpmn:message id="Message_Order" name="Order">
    <bpmn:extensionElements>
      <zeebe:subscription correlationKey="= orderId" />
    </bpmn:extensionElements>
  </bpmn:message>
  <bpmn:message id="Message_Payment" name="Payment">
    <bpmn:extensionElements>
      <zeebe:subscription correlationKey="= orderId" />
    </bpmn:extensionElements>
  </bpmn:message>
  <bpmn:message id="Message_Cancel" name="Cancel" />
  <bpmn:message id="Message_Reminder" name="Reminder" />
  <bpmn:signal id="Signal_Stop" name="Stop" />
  <bpmn:error id="Error_Declined" name="Declined" errorCode="DECLINED" />
  <bpmn:escalation id="Escalation_Late" name="Late" escalationCode="LATE" />
  <bpmn:process id="Process_Shop" name="Shop" isExecutable="true">
    <bpmn:startEvent id="Event_OrderReceived" name="Order received">
      <bpmn:outgoing>Flow_ToFulfil</bpmn:outgoing>
      <bpmn:messageEventDefinition id="MessageEventDefinition_Order" messageRef="Message_Order" />
    </bpmn:startEvent>
    <bpmn:subProcess id="Activity_Fulfil" name="Fulfil order">
      <bpmn:incoming>Flow_ToFulfil</bpmn:incoming>
      <bpmn:outgoing>Flow_ToDone</bpmn:outgoing>
      <bpmn:startEvent id="Event_FulfilStart">
        <bpmn:outgoing>Flow_ToPack</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:subProcess id="Activity_Pack" name="Pack goods">
        <bpmn:incoming>Flow_ToPack</bpmn:incoming>
        <bpmn:outgoing>Flow_ToWait</bpmn:outgoing>
        <bpmn:startEvent id="Event_PackStart">
          <bpmn:outgoing>Flow_ToPick</bpmn:outgoing>
        </bpmn:startEvent>
        <bpmn:task id="Activity_PickItems" name="Pick items">
          <bpmn:incoming>Flow_ToPick</bpmn:incoming>
          <bpmn:outgoing>Flow_ToPackEnd</bpmn:outgoing>
        </bpmn:task>
        <bpmn:endEvent id="Event_PackEnd">
          <bpmn:incoming>Flow_ToPackEnd</bpmn:incoming>
        </bpmn:endEvent>
        <bpmn:sequenceFlow id="Flow_ToPick" sourceRef="Event_PackStart" targetRef="Activity_PickItems" />
        <bpmn:sequenceFlow id="Flow_ToPackEnd" sourceRef="Activity_PickItems" targetRef="Event_PackEnd" />
      </bpmn:subProcess>
      <bpmn:boundaryEvent id="Event_PackLate" name="Packing late" cancelActivity="false" attachedToRef="Activity_Pack">
        <bpmn:outgoing>Flow_ToRemind</bpmn:outgoing>
        <bpmn:timerEventDefinition id="TimerEventDefinition_PackLate">
          <bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT2H</bpmn:timeDuration>
        </bpmn:timerEventDefinition>
      </bpmn:boundaryEvent>
      <bpmn:sendTask id="Activity_SendReminder" name="Send reminder" messageRef="Message_Reminder">
        <bpmn:incoming>Flow_ToRemind</bpmn:incoming>
        <bpmn:outgoing>Flow_ToReminded</bpmn:outgoing>
      </bpmn:sendTask>
      <bpmn:endEvent id="Event_Reminded">
        <bpmn:incoming>Flow_ToReminded</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:receiveTask id="Activity_WaitForPayment" name="Wait for payment" messageRef="Message_Payment">
        <bpmn:incoming>Flow_ToWait</bpmn:incoming>
        <bpmn:outgoing>Flow_ToFulfilEnd</bpmn:outgoing>
      </bpmn:receiveTask>
      <bpmn:endEvent id="Event_FulfilEnd">
        <bpmn:incoming>Flow_ToFulfilEnd</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="Flow_ToPack" sourceRef="Event_FulfilStart" targetRef="Activity_Pack" />
      <bpmn:sequenceFlow id="Flow_ToWait" sourceRef="Activity_Pack" targetRef="Activity_WaitForPayment" />
      <bpmn:sequenceFlow id="Flow_ToFulfilEnd" sourceRef="Activity_WaitForPayment" targetRef="Event_FulfilEnd" />
      <bpmn:sequenceFlow id="Flow_ToRemind" sourceRef="Event_PackLate" targetRef="Activity_SendReminder" />
      <bpmn:sequenceFlow id="Flow_ToReminded" sourceRef="Activity_SendReminder" targetRef="Event_Reminded" />
    </bpmn:subProcess>
    <bpmn:boundaryEvent id="Event_Cancelled" name="Cancelled" attachedToRef="Activity_Fulfil">
      <bpmn:outgoing>Flow_ToCancelledEnd</bpmn:outgoing>
      <bpmn:messageEventDefinition id="MessageEventDefinition_Cancel" messageRef="Message_Cancel" />
    </bpmn:boundaryEvent>
    <bpmn:boundaryEvent id="Event_Stopped" name="Stopped" cancelActivity="false" attachedToRef="Activity_Fulfil">
      <bpmn:signalEventDefinition id="SignalEventDefinition_Stop" signalRef="Signal_Stop" />
    </bpmn:boundaryEvent>
    <bpmn:boundaryEvent id="Event_Declined" name="Declined" attachedToRef="Activity_Fulfil">
      <bpmn:errorEventDefinition id="ErrorEventDefinition_Declined" errorRef="Error_Declined" />
    </bpmn:boundaryEvent>
    <bpmn:boundaryEvent id="Event_Late" name="Late" cancelActivity="false" attachedToRef="Activity_Fulfil">
      <bpmn:escalationEventDefinition id="EscalationEventDefinition_Late" escalationRef="Escalation_Late" />
    </bpmn:boundaryEvent>
    <bpmn:boundaryEvent id="Event_StockLow" name="Stock low" attachedToRef="Activity_Fulfil">
      <bpmn:conditionalEventDefinition id="ConditionalEventDefinition_StockLow">
        <bpmn:condition xsi:type="bpmn:tFormalExpression">= stock &lt; 1</bpmn:condition>
      </bpmn:conditionalEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:boundaryEvent id="Event_Undo" name="Undo" attachedToRef="Activity_Fulfil">
      <bpmn:compensateEventDefinition id="CompensateEventDefinition_Undo" />
    </bpmn:boundaryEvent>
    <bpmn:task id="Activity_Refund" name="Refund" isForCompensation="true" />
    <bpmn:endEvent id="Event_OrderCancelled" name="Order cancelled">
      <bpmn:incoming>Flow_ToCancelledEnd</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="Event_Done" name="Done">
      <bpmn:incoming>Flow_ToDone</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:subProcess id="Activity_OnTimeout" name="Handle timeout" triggeredByEvent="true">
      <bpmn:startEvent id="Event_Timeout" name="Timeout">
        <bpmn:outgoing>Flow_ToTimedOut</bpmn:outgoing>
        <bpmn:timerEventDefinition id="TimerEventDefinition_Timeout">
          <bpmn:timeDuration xsi:type="bpmn:tFormalExpression">P1D</bpmn:timeDuration>
        </bpmn:timerEventDefinition>
      </bpmn:startEvent>
      <bpmn:endEvent id="Event_TimedOut">
        <bpmn:incoming>Flow_ToTimedOut</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="Flow_ToTimedOut" sourceRef="Event_Timeout" targetRef="Event_TimedOut" />
    </bpmn:subProcess>
    <bpmn:association id="Association_Undo" associationDirection="One" sourceRef="Event_Undo" targetRef="Activity_Refund" />
    <bpmn:sequenceFlow id="Flow_ToFulfil" sourceRef="Event_OrderReceived" targetRef="Activity_Fulfil" />
    <bpmn:sequenceFlow id="Flow_ToDone" sourceRef="Activity_Fulfil" targetRef="Event_Done" />
    <bpmn:sequenceFlow id="Flow_ToCancelledEnd" sourceRef="Event_Cancelled" targetRef="Event_OrderCancelled" />
  </bpmn:process>
</bpmn:definitions>
`;

const context = async (id: string): Promise<string> => showXml(SHOP, { id, context: true });

describe('show <id> --context: what can interrupt the element', () => {
  it('lists the boundary events of every kind on every sub-process around it, inner first, non-interrupting ones marked', async () => {
    const text = await context('Activity_PickItems');
    expect(text.split('\n')).toEqual([
      'task Activity_PickItems "Pick items"',
      'in: participant Participant_Shop "Shop" > process Process_Shop "Shop" > subProcess Activity_Fulfil "Fulfil order" > subProcess Activity_Pack "Pack goods"',
      'from: startEvent Event_PackStart (Flow_ToPick)',
      'to: endEvent Event_PackEnd (Flow_ToPackEnd)',
      'caught by: boundaryEvent:timer Event_PackLate "Packing late" on Activity_Pack [PT2H, non-interrupting] -> Activity_SendReminder; ' +
        'boundaryEvent:message Event_Cancelled "Cancelled" on Activity_Fulfil [message Cancel] -> Event_OrderCancelled; ' +
        'boundaryEvent:signal Event_Stopped "Stopped" on Activity_Fulfil [signal Stop, non-interrupting]; ' +
        'boundaryEvent:error Event_Declined "Declined" on Activity_Fulfil [error Declined (DECLINED)]; ' +
        'boundaryEvent:escalation Event_Late "Late" on Activity_Fulfil [escalation Late (LATE), non-interrupting]; ' +
        'boundaryEvent:conditional Event_StockLow "Stock low" on Activity_Fulfil [condition = stock < 1]; ' +
        'boundaryEvent:compensate Event_Undo "Undo" on Activity_Fulfil [compensate]',
      'event sub-processes: eventSubProcess Activity_OnTimeout "Handle timeout" in Process_Shop [startEvent:timer Event_Timeout "Timeout" [P1D] -> Event_TimedOut]',
    ]);
    const doc = await Doc.fromXml(SHOP);
    const c = elementContext(doc, 'Activity_PickItems');
    expect(c.caughtBy.map((b) => [b.id, b.on, b.nonInterrupting ?? false])).toEqual([
      ['Event_PackLate', 'Activity_Pack', true],
      ['Event_Cancelled', 'Activity_Fulfil', false],
      ['Event_Stopped', 'Activity_Fulfil', true],
      ['Event_Declined', 'Activity_Fulfil', false],
      ['Event_Late', 'Activity_Fulfil', true],
      ['Event_StockLow', 'Activity_Fulfil', false],
      ['Event_Undo', 'Activity_Fulfil', false],
    ]);
    // the element's own boundary events are `boundary`, not `caught by`
    const pack = elementContext(doc, 'Activity_Pack');
    expect([pack.boundary.map((b) => b.id), pack.caughtBy.map((b) => b.id)]).toEqual([['Event_PackLate'], ['Event_Cancelled', 'Event_Stopped', 'Event_Declined', 'Event_Late', 'Event_StockLow', 'Event_Undo']]);
  });
});

describe('show <id> --context: messages', () => {
  it('a receive task names its message with the correlation key and the flow of that message drawn to its pool', async () => {
    const text = await context('Activity_WaitForPayment');
    expect(text).toContain('\nmessage: Message_Payment "Payment" [correlationKey="= orderId"]\n');
    expect(text).toContain('message flows: in Flow_Payment "Payment" <- Participant_Bank "Bank" [message Payment] (at pool Participant_Shop)');
    // the invoice also ends at the pool, but names no message and not the payment's name
    expect(text).not.toContain('Flow_Invoice');
    expect(text).not.toContain('Flow_Cancel');
  });

  it('a message start event: its message and the flow into it; a message boundary event: the flow to its pool', async () => {
    const start = await context('Event_OrderReceived');
    expect(start).toContain('\nmessage: Message_Order "Order" [correlationKey="= orderId"]\n');
    expect(start).toContain('message flows: in Flow_Order "Order" <- Participant_Customer "Customer" [message Order]');
    const cancel = await context('Event_Cancelled');
    expect(cancel).toContain('\nmessage: Message_Cancel "Cancel"\n');
    expect(cancel).toContain('message flows: in Flow_Cancel "Cancel" <- Participant_Customer "Customer" [message Cancel] (at pool Participant_Shop)');
  });

  it('a send task: its message and the flow out of it (a flow without messageRef matches by the message name only at the pool)', async () => {
    const doc = await Doc.fromXml(SHOP);
    const send = elementContext(doc, 'Activity_SendReminder');
    expect(send.message).toEqual({ id: 'Message_Reminder', name: 'Reminder' });
    expect(send.messageFlows).toEqual([{ direction: 'out', id: 'Flow_Reminder', name: 'Reminder', partner: 'Participant_Customer', partnerName: 'Customer' }]);
    // a task without a message has no message line and no pool flows
    expect(elementContext(doc, 'Activity_PickItems').message).toBeUndefined();
    expect(elementContext(doc, 'Activity_PickItems').messageFlows).toEqual([]);
  });

  it('a message flow: its message, its collaboration and its ends with their pools', async () => {
    expect((await context('Flow_Order')).split('\n')).toEqual([
      'messageFlow Flow_Order "Order"',
      'message: Message_Order "Order" [correlationKey="= orderId"]',
      'in: collaboration Collaboration_Shop',
      'from: participant Participant_Customer "Customer" (Flow_Order)',
      'to: startEvent:message Event_OrderReceived "Order received" (Flow_Order) in Participant_Shop "Shop"',
    ]);
    expect(await context('Flow_Reminder')).toContain('from: sendTask Activity_SendReminder "Send reminder" (Flow_Reminder) in Participant_Shop "Shop"');
  });

  it('a message, signal, error or escalation names what uses it', async () => {
    expect((await context('Message_Payment')).split('\n')).toEqual([
      'message Message_Payment "Payment"',
      'implementation: zeebe:subscription correlationKey="= orderId"',
      'used by: messageFlow Flow_Payment "Payment"; receiveTask Activity_WaitForPayment "Wait for payment"',
    ]);
    expect(await context('Signal_Stop')).toContain('used by: boundaryEvent:signal Event_Stopped "Stopped"');
    expect(await context('Error_Declined')).toContain('used by: boundaryEvent:error Event_Declined "Declined"');
    expect(await context('Escalation_Late')).toContain('used by: boundaryEvent:escalation Event_Late "Late"');
  });
});
