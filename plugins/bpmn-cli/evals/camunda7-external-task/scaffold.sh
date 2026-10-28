#!/usr/bin/env bash
# Scaffold of the eval case "camunda7-external-task": writes payment.bpmn into the empty workspace.
# A Camunda 7 payment process whose service task has no implementation yet.
set -euo pipefail
cat > payment.bpmn <<'BPMN_FIXTURE'
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="Camunda Platform" modeler:executionPlatformVersion="7.24.0">
  <bpmn:process id="payment" name="Payment" isExecutable="true" camunda:historyTimeToLive="180">
    <bpmn:startEvent id="startEvent_paymentRequested" name="Payment requested">
      <bpmn:outgoing>flow_paymentRequestedToChargeCreditCard</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:serviceTask id="serviceTask_chargeCreditCard" name="Charge credit card">
      <bpmn:incoming>flow_paymentRequestedToChargeCreditCard</bpmn:incoming>
      <bpmn:outgoing>flow_chargeCreditCardToPaymentReceived</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="endEvent_paymentReceived" name="Payment received">
      <bpmn:incoming>flow_chargeCreditCardToPaymentReceived</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_chargeCreditCardToPaymentReceived" sourceRef="serviceTask_chargeCreditCard" targetRef="endEvent_paymentReceived" />
    <bpmn:sequenceFlow id="flow_paymentRequestedToChargeCreditCard" sourceRef="startEvent_paymentRequested" targetRef="serviceTask_chargeCreditCard" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_payment">
    <bpmndi:BPMNPlane id="BPMNPlane_payment" bpmnElement="payment">
      <bpmndi:BPMNShape id="BPMNShape_startEvent_paymentRequested" bpmnElement="startEvent_paymentRequested">
        <dc:Bounds x="80" y="102" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="61" y="144" width="75" height="28" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="BPMNShape_serviceTask_chargeCreditCard" bpmnElement="serviceTask_chargeCreditCard">
        <dc:Bounds x="176" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="BPMNShape_endEvent_paymentReceived" bpmnElement="endEvent_paymentReceived">
        <dc:Bounds x="336" y="102" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="320" y="144" width="68" height="28" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="BPMNEdge_flow_chargeCreditCardToPaymentReceived" bpmnElement="flow_chargeCreditCardToPaymentReceived">
        <di:waypoint x="276" y="120" />
        <di:waypoint x="336" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="BPMNEdge_flow_paymentRequestedToChargeCreditCard" bpmnElement="flow_paymentRequestedToChargeCreditCard">
        <di:waypoint x="116" y="120" />
        <di:waypoint x="176" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
BPMN_FIXTURE
