#!/usr/bin/env bash
# Scaffold of the eval case "camunda7-external-task": writes payment.bpmn into the empty workspace.
# A Camunda 7 payment process whose service task has no implementation yet.
set -euo pipefail
cat > payment.bpmn <<'BPMN_FIXTURE'
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="Camunda Platform" modeler:executionPlatformVersion="7.24.0">
  <bpmn:process id="Process_Payment" name="Payment" isExecutable="true" camunda:historyTimeToLive="180">
    <bpmn:startEvent id="Event_PaymentRequested" name="Payment requested">
      <bpmn:outgoing>Flow_PaymentRequestedToChargeCreditCard</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:serviceTask id="Activity_ChargeCreditCard" name="Charge credit card">
      <bpmn:incoming>Flow_PaymentRequestedToChargeCreditCard</bpmn:incoming>
      <bpmn:outgoing>Flow_ChargeCreditCardToPaymentReceived</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="Event_PaymentReceived" name="Payment received">
      <bpmn:incoming>Flow_ChargeCreditCardToPaymentReceived</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_ChargeCreditCardToPaymentReceived" sourceRef="Activity_ChargeCreditCard" targetRef="Event_PaymentReceived" />
    <bpmn:sequenceFlow id="Flow_PaymentRequestedToChargeCreditCard" sourceRef="Event_PaymentRequested" targetRef="Activity_ChargeCreditCard" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_Process_Payment">
    <bpmndi:BPMNPlane id="BPMNPlane_Process_Payment" bpmnElement="Process_Payment">
      <bpmndi:BPMNShape id="BPMNShape_Event_PaymentRequested" bpmnElement="Event_PaymentRequested">
        <dc:Bounds x="80" y="102" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="61" y="144" width="75" height="28" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="BPMNShape_Activity_ChargeCreditCard" bpmnElement="Activity_ChargeCreditCard">
        <dc:Bounds x="176" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="BPMNShape_Event_PaymentReceived" bpmnElement="Event_PaymentReceived">
        <dc:Bounds x="336" y="102" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="320" y="144" width="68" height="28" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="BPMNEdge_Flow_ChargeCreditCardToPaymentReceived" bpmnElement="Flow_ChargeCreditCardToPaymentReceived">
        <di:waypoint x="276" y="120" />
        <di:waypoint x="336" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="BPMNEdge_Flow_PaymentRequestedToChargeCreditCard" bpmnElement="Flow_PaymentRequestedToChargeCreditCard">
        <di:waypoint x="116" y="120" />
        <di:waypoint x="176" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
BPMN_FIXTURE
