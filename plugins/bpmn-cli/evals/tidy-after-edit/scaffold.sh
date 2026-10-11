#!/usr/bin/env bash
# Scaffold of the eval case "tidy-after-edit": writes invoice-approval.bpmn into the empty workspace.
# An invoice approval drawn by hand: the gateway's label sits on "Approve invoice", and the rejection
# branch crosses the reminder path of the timer on "Approve invoice" (`bpmn metrics`: labelClash, crossings).
set -euo pipefail
cat > invoice-approval.bpmn <<'BPMN_FIXTURE'
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_InvoiceApproval" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="5.31.0">
  <bpmn:process id="Process_InvoiceApproval" name="Invoice approval" isExecutable="false">
    <bpmn:startEvent id="Event_InvoiceReceived" name="Invoice received">
      <bpmn:outgoing>Flow_InvoiceReceivedToCheckInvoice</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Activity_CheckInvoice" name="Check invoice">
      <bpmn:incoming>Flow_InvoiceReceivedToCheckInvoice</bpmn:incoming>
      <bpmn:outgoing>Flow_CheckInvoiceToInvoiceCorrect</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gateway_InvoiceCorrect" name="Invoice correct?" default="Flow_InvoiceCorrectNo">
      <bpmn:incoming>Flow_CheckInvoiceToInvoiceCorrect</bpmn:incoming>
      <bpmn:outgoing>Flow_InvoiceCorrectYes</bpmn:outgoing>
      <bpmn:outgoing>Flow_InvoiceCorrectNo</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:userTask id="Activity_ApproveInvoice" name="Approve invoice">
      <bpmn:incoming>Flow_InvoiceCorrectYes</bpmn:incoming>
      <bpmn:outgoing>Flow_ApproveInvoiceToPayInvoice</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:serviceTask id="Activity_PayInvoice" name="Pay invoice">
      <bpmn:incoming>Flow_ApproveInvoiceToPayInvoice</bpmn:incoming>
      <bpmn:outgoing>Flow_PayInvoiceToInvoicePaid</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="Event_InvoicePaid" name="Invoice paid">
      <bpmn:incoming>Flow_PayInvoiceToInvoicePaid</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sendTask id="Activity_ReturnInvoice" name="Return invoice to supplier">
      <bpmn:incoming>Flow_InvoiceCorrectNo</bpmn:incoming>
      <bpmn:outgoing>Flow_ReturnInvoiceToInvoiceReturned</bpmn:outgoing>
    </bpmn:sendTask>
    <bpmn:endEvent id="Event_InvoiceReturned" name="Invoice returned">
      <bpmn:incoming>Flow_ReturnInvoiceToInvoiceReturned</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:boundaryEvent id="Event_ApprovalOverdue" name="5 days" cancelActivity="false" attachedToRef="Activity_ApproveInvoice">
      <bpmn:outgoing>Flow_ApprovalOverdueToRemindApprover</bpmn:outgoing>
      <bpmn:timerEventDefinition id="TimerEventDefinition_ApprovalOverdue">
        <bpmn:timeDuration xsi:type="bpmn:tFormalExpression">P5D</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:sendTask id="Activity_RemindApprover" name="Remind approver">
      <bpmn:incoming>Flow_ApprovalOverdueToRemindApprover</bpmn:incoming>
      <bpmn:outgoing>Flow_RemindApproverToApproverReminded</bpmn:outgoing>
    </bpmn:sendTask>
    <bpmn:endEvent id="Event_ApproverReminded" name="Approver reminded">
      <bpmn:incoming>Flow_RemindApproverToApproverReminded</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_InvoiceReceivedToCheckInvoice" sourceRef="Event_InvoiceReceived" targetRef="Activity_CheckInvoice" />
    <bpmn:sequenceFlow id="Flow_CheckInvoiceToInvoiceCorrect" sourceRef="Activity_CheckInvoice" targetRef="Gateway_InvoiceCorrect" />
    <bpmn:sequenceFlow id="Flow_InvoiceCorrectYes" name="yes" sourceRef="Gateway_InvoiceCorrect" targetRef="Activity_ApproveInvoice">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${invoiceCorrect}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_ApproveInvoiceToPayInvoice" sourceRef="Activity_ApproveInvoice" targetRef="Activity_PayInvoice" />
    <bpmn:sequenceFlow id="Flow_PayInvoiceToInvoicePaid" sourceRef="Activity_PayInvoice" targetRef="Event_InvoicePaid" />
    <bpmn:sequenceFlow id="Flow_InvoiceCorrectNo" name="no" sourceRef="Gateway_InvoiceCorrect" targetRef="Activity_ReturnInvoice" />
    <bpmn:sequenceFlow id="Flow_ReturnInvoiceToInvoiceReturned" sourceRef="Activity_ReturnInvoice" targetRef="Event_InvoiceReturned" />
    <bpmn:sequenceFlow id="Flow_ApprovalOverdueToRemindApprover" sourceRef="Event_ApprovalOverdue" targetRef="Activity_RemindApprover" />
    <bpmn:sequenceFlow id="Flow_RemindApproverToApproverReminded" sourceRef="Activity_RemindApprover" targetRef="Event_ApproverReminded" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_InvoiceApproval">
      <bpmndi:BPMNShape id="Event_InvoiceReceived_di" bpmnElement="Event_InvoiceReceived">
        <dc:Bounds x="172" y="182" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="149" y="225" width="83" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_CheckInvoice_di" bpmnElement="Activity_CheckInvoice">
        <dc:Bounds x="270" y="160" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_InvoiceCorrect_di" bpmnElement="Gateway_InvoiceCorrect" isMarkerVisible="true">
        <dc:Bounds x="435" y="175" width="50" height="50" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="532" y="168" width="81" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_ApproveInvoice_di" bpmnElement="Activity_ApproveInvoice">
        <dc:Bounds x="550" y="160" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_PayInvoice_di" bpmnElement="Activity_PayInvoice">
        <dc:Bounds x="720" y="160" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_InvoicePaid_di" bpmnElement="Event_InvoicePaid">
        <dc:Bounds x="892" y="182" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="881" y="225" width="58" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_ReturnInvoice_di" bpmnElement="Activity_ReturnInvoice">
        <dc:Bounds x="500" y="300" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_InvoiceReturned_di" bpmnElement="Event_InvoiceReturned">
        <dc:Bounds x="892" y="322" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="871" y="365" width="79" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_RemindApprover_di" bpmnElement="Activity_RemindApprover">
        <dc:Bounds x="720" y="440" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_ApproverReminded_di" bpmnElement="Event_ApproverReminded">
        <dc:Bounds x="892" y="462" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="866" y="505" width="89" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_ApprovalOverdue_di" bpmnElement="Event_ApprovalOverdue">
        <dc:Bounds x="612" y="222" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="653" y="253" width="33" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_InvoiceReceivedToCheckInvoice_di" bpmnElement="Flow_InvoiceReceivedToCheckInvoice">
        <di:waypoint x="208" y="200" />
        <di:waypoint x="270" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_CheckInvoiceToInvoiceCorrect_di" bpmnElement="Flow_CheckInvoiceToInvoiceCorrect">
        <di:waypoint x="370" y="200" />
        <di:waypoint x="435" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_InvoiceCorrectYes_di" bpmnElement="Flow_InvoiceCorrectYes">
        <di:waypoint x="485" y="200" />
        <di:waypoint x="550" y="200" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="509" y="182" width="18" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_ApproveInvoiceToPayInvoice_di" bpmnElement="Flow_ApproveInvoiceToPayInvoice">
        <di:waypoint x="650" y="200" />
        <di:waypoint x="720" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_PayInvoiceToInvoicePaid_di" bpmnElement="Flow_PayInvoiceToInvoicePaid">
        <di:waypoint x="820" y="200" />
        <di:waypoint x="892" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_InvoiceCorrectNo_di" bpmnElement="Flow_InvoiceCorrectNo">
        <di:waypoint x="460" y="225" />
        <di:waypoint x="460" y="340" />
        <di:waypoint x="500" y="340" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="468" y="270" width="13" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_ReturnInvoiceToInvoiceReturned_di" bpmnElement="Flow_ReturnInvoiceToInvoiceReturned">
        <di:waypoint x="600" y="340" />
        <di:waypoint x="892" y="340" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_ApprovalOverdueToRemindApprover_di" bpmnElement="Flow_ApprovalOverdueToRemindApprover">
        <di:waypoint x="630" y="258" />
        <di:waypoint x="630" y="480" />
        <di:waypoint x="720" y="480" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_RemindApproverToApproverReminded_di" bpmnElement="Flow_RemindApproverToApproverReminded">
        <di:waypoint x="820" y="480" />
        <di:waypoint x="892" y="480" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
BPMN_FIXTURE
