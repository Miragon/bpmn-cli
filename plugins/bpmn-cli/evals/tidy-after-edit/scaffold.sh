#!/usr/bin/env bash
# Scaffold of the eval case "tidy-after-edit": writes invoice-approval.bpmn into the empty workspace.
# An invoice approval drawn by hand: the gateway's label sits on "Approve invoice", and the rejection
# branch crosses the reminder path of the timer on "Approve invoice" (`bpmn metrics`: labelClash, crossings).
set -euo pipefail
cat > invoice-approval.bpmn <<'BPMN_FIXTURE'
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_InvoiceApproval" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="5.31.0">
  <bpmn:process id="invoiceApproval" name="Invoice approval" isExecutable="false">
    <bpmn:startEvent id="startEvent_invoiceReceived" name="Invoice received">
      <bpmn:outgoing>flow_invoiceReceivedToCheckInvoice</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="userTask_checkInvoice" name="Check invoice">
      <bpmn:incoming>flow_invoiceReceivedToCheckInvoice</bpmn:incoming>
      <bpmn:outgoing>flow_checkInvoiceToInvoiceCorrect</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="gateway_invoiceCorrect" name="Invoice correct?" default="flow_invoiceCorrectToReturnInvoiceToSupplier">
      <bpmn:incoming>flow_checkInvoiceToInvoiceCorrect</bpmn:incoming>
      <bpmn:outgoing>flow_invoiceCorrectToApproveInvoice</bpmn:outgoing>
      <bpmn:outgoing>flow_invoiceCorrectToReturnInvoiceToSupplier</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:userTask id="userTask_approveInvoice" name="Approve invoice">
      <bpmn:incoming>flow_invoiceCorrectToApproveInvoice</bpmn:incoming>
      <bpmn:outgoing>flow_approveInvoiceToPayInvoice</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:serviceTask id="serviceTask_payInvoice" name="Pay invoice">
      <bpmn:incoming>flow_approveInvoiceToPayInvoice</bpmn:incoming>
      <bpmn:outgoing>flow_payInvoiceToInvoicePaid</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="endEvent_invoicePaid" name="Invoice paid">
      <bpmn:incoming>flow_payInvoiceToInvoicePaid</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sendTask id="sendTask_returnInvoiceToSupplier" name="Return invoice to supplier">
      <bpmn:incoming>flow_invoiceCorrectToReturnInvoiceToSupplier</bpmn:incoming>
      <bpmn:outgoing>flow_returnInvoiceToSupplierToInvoiceReturned</bpmn:outgoing>
    </bpmn:sendTask>
    <bpmn:endEvent id="endEvent_invoiceReturned" name="Invoice returned">
      <bpmn:incoming>flow_returnInvoiceToSupplierToInvoiceReturned</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:boundaryEvent id="event_approvalOverdue" name="5 days" cancelActivity="false" attachedToRef="userTask_approveInvoice">
      <bpmn:outgoing>flow_approvalOverdueToRemindApprover</bpmn:outgoing>
      <bpmn:timerEventDefinition id="timerEventDefinition_approvalOverdue">
        <bpmn:timeDuration xsi:type="bpmn:tFormalExpression">P5D</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:sendTask id="sendTask_remindApprover" name="Remind approver">
      <bpmn:incoming>flow_approvalOverdueToRemindApprover</bpmn:incoming>
      <bpmn:outgoing>flow_remindApproverToApproverReminded</bpmn:outgoing>
    </bpmn:sendTask>
    <bpmn:endEvent id="endEvent_approverReminded" name="Approver reminded">
      <bpmn:incoming>flow_remindApproverToApproverReminded</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_invoiceReceivedToCheckInvoice" sourceRef="startEvent_invoiceReceived" targetRef="userTask_checkInvoice" />
    <bpmn:sequenceFlow id="flow_checkInvoiceToInvoiceCorrect" sourceRef="userTask_checkInvoice" targetRef="gateway_invoiceCorrect" />
    <bpmn:sequenceFlow id="flow_invoiceCorrectToApproveInvoice" name="yes" sourceRef="gateway_invoiceCorrect" targetRef="userTask_approveInvoice">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${invoiceCorrect}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="flow_approveInvoiceToPayInvoice" sourceRef="userTask_approveInvoice" targetRef="serviceTask_payInvoice" />
    <bpmn:sequenceFlow id="flow_payInvoiceToInvoicePaid" sourceRef="serviceTask_payInvoice" targetRef="endEvent_invoicePaid" />
    <bpmn:sequenceFlow id="flow_invoiceCorrectToReturnInvoiceToSupplier" name="no" sourceRef="gateway_invoiceCorrect" targetRef="sendTask_returnInvoiceToSupplier" />
    <bpmn:sequenceFlow id="flow_returnInvoiceToSupplierToInvoiceReturned" sourceRef="sendTask_returnInvoiceToSupplier" targetRef="endEvent_invoiceReturned" />
    <bpmn:sequenceFlow id="flow_approvalOverdueToRemindApprover" sourceRef="event_approvalOverdue" targetRef="sendTask_remindApprover" />
    <bpmn:sequenceFlow id="flow_remindApproverToApproverReminded" sourceRef="sendTask_remindApprover" targetRef="endEvent_approverReminded" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="invoiceApproval">
      <bpmndi:BPMNShape id="startEvent_invoiceReceived_di" bpmnElement="startEvent_invoiceReceived">
        <dc:Bounds x="172" y="182" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="149" y="225" width="83" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="userTask_checkInvoice_di" bpmnElement="userTask_checkInvoice">
        <dc:Bounds x="270" y="160" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="gateway_invoiceCorrect_di" bpmnElement="gateway_invoiceCorrect" isMarkerVisible="true">
        <dc:Bounds x="435" y="175" width="50" height="50" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="532" y="168" width="81" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="userTask_approveInvoice_di" bpmnElement="userTask_approveInvoice">
        <dc:Bounds x="550" y="160" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="serviceTask_payInvoice_di" bpmnElement="serviceTask_payInvoice">
        <dc:Bounds x="720" y="160" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="endEvent_invoicePaid_di" bpmnElement="endEvent_invoicePaid">
        <dc:Bounds x="892" y="182" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="881" y="225" width="58" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="sendTask_returnInvoiceToSupplier_di" bpmnElement="sendTask_returnInvoiceToSupplier">
        <dc:Bounds x="500" y="300" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="endEvent_invoiceReturned_di" bpmnElement="endEvent_invoiceReturned">
        <dc:Bounds x="892" y="322" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="871" y="365" width="79" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="sendTask_remindApprover_di" bpmnElement="sendTask_remindApprover">
        <dc:Bounds x="720" y="440" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="endEvent_approverReminded_di" bpmnElement="endEvent_approverReminded">
        <dc:Bounds x="892" y="462" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="866" y="505" width="89" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="event_approvalOverdue_di" bpmnElement="event_approvalOverdue">
        <dc:Bounds x="612" y="222" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="653" y="253" width="33" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="flow_invoiceReceivedToCheckInvoice_di" bpmnElement="flow_invoiceReceivedToCheckInvoice">
        <di:waypoint x="208" y="200" />
        <di:waypoint x="270" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_checkInvoiceToInvoiceCorrect_di" bpmnElement="flow_checkInvoiceToInvoiceCorrect">
        <di:waypoint x="370" y="200" />
        <di:waypoint x="435" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_invoiceCorrectToApproveInvoice_di" bpmnElement="flow_invoiceCorrectToApproveInvoice">
        <di:waypoint x="485" y="200" />
        <di:waypoint x="550" y="200" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="509" y="182" width="18" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_approveInvoiceToPayInvoice_di" bpmnElement="flow_approveInvoiceToPayInvoice">
        <di:waypoint x="650" y="200" />
        <di:waypoint x="720" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_payInvoiceToInvoicePaid_di" bpmnElement="flow_payInvoiceToInvoicePaid">
        <di:waypoint x="820" y="200" />
        <di:waypoint x="892" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_invoiceCorrectToReturnInvoiceToSupplier_di" bpmnElement="flow_invoiceCorrectToReturnInvoiceToSupplier">
        <di:waypoint x="460" y="225" />
        <di:waypoint x="460" y="340" />
        <di:waypoint x="500" y="340" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="468" y="270" width="13" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_returnInvoiceToSupplierToInvoiceReturned_di" bpmnElement="flow_returnInvoiceToSupplierToInvoiceReturned">
        <di:waypoint x="600" y="340" />
        <di:waypoint x="892" y="340" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_approvalOverdueToRemindApprover_di" bpmnElement="flow_approvalOverdueToRemindApprover">
        <di:waypoint x="630" y="258" />
        <di:waypoint x="630" y="480" />
        <di:waypoint x="720" y="480" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_remindApproverToApproverReminded_di" bpmnElement="flow_remindApproverToApproverReminded">
        <di:waypoint x="820" y="480" />
        <di:waypoint x="892" y="480" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
BPMN_FIXTURE
