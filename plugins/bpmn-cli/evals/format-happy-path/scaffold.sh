#!/usr/bin/env bash
# Scaffold of the eval case "format-happy-path": writes claim-handling.bpmn into the empty workspace.
# A claim handling process drawn by hand, the rejection branch above the main line.
set -euo pipefail
cat > claim-handling.bpmn <<'BPMN_FIXTURE'
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_ClaimHandling" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="5.31.0">
  <bpmn:process id="claimHandling" name="Claim handling" isExecutable="false">
    <bpmn:startEvent id="startEvent_claimReceived" name="Claim received">
      <bpmn:outgoing>flow_claimReceivedToAssessClaim</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="userTask_assessClaim" name="Assess claim">
      <bpmn:incoming>flow_claimReceivedToAssessClaim</bpmn:incoming>
      <bpmn:outgoing>flow_assessClaimToClaimCovered</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="gateway_claimCovered" name="Claim covered?" default="flow_claimCoveredToSendRejectionLetter">
      <bpmn:incoming>flow_assessClaimToClaimCovered</bpmn:incoming>
      <bpmn:outgoing>flow_claimCoveredToPayOutClaim</bpmn:outgoing>
      <bpmn:outgoing>flow_claimCoveredToSendRejectionLetter</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:serviceTask id="serviceTask_payOutClaim" name="Pay out claim">
      <bpmn:incoming>flow_claimCoveredToPayOutClaim</bpmn:incoming>
      <bpmn:outgoing>flow_payOutClaimToClaimPaid</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="endEvent_claimPaid" name="Claim paid">
      <bpmn:incoming>flow_payOutClaimToClaimPaid</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sendTask id="sendTask_sendRejectionLetter" name="Send rejection letter">
      <bpmn:incoming>flow_claimCoveredToSendRejectionLetter</bpmn:incoming>
      <bpmn:outgoing>flow_sendRejectionLetterToClaimRejected</bpmn:outgoing>
    </bpmn:sendTask>
    <bpmn:endEvent id="endEvent_claimRejected" name="Claim rejected">
      <bpmn:incoming>flow_sendRejectionLetterToClaimRejected</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_claimReceivedToAssessClaim" sourceRef="startEvent_claimReceived" targetRef="userTask_assessClaim" />
    <bpmn:sequenceFlow id="flow_assessClaimToClaimCovered" sourceRef="userTask_assessClaim" targetRef="gateway_claimCovered" />
    <bpmn:sequenceFlow id="flow_claimCoveredToPayOutClaim" name="yes" sourceRef="gateway_claimCovered" targetRef="serviceTask_payOutClaim">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${covered}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="flow_payOutClaimToClaimPaid" sourceRef="serviceTask_payOutClaim" targetRef="endEvent_claimPaid" />
    <bpmn:sequenceFlow id="flow_claimCoveredToSendRejectionLetter" name="no" sourceRef="gateway_claimCovered" targetRef="sendTask_sendRejectionLetter" />
    <bpmn:sequenceFlow id="flow_sendRejectionLetterToClaimRejected" sourceRef="sendTask_sendRejectionLetter" targetRef="endEvent_claimRejected" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_ClaimHandling">
    <bpmndi:BPMNPlane id="BPMNPlane_ClaimHandling" bpmnElement="claimHandling">
      <bpmndi:BPMNShape id="startEvent_claimReceived_di" bpmnElement="startEvent_claimReceived">
        <dc:Bounds x="172" y="242" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="153" y="285" width="74" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="userTask_assessClaim_di" bpmnElement="userTask_assessClaim">
        <dc:Bounds x="270" y="220" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="gateway_claimCovered_di" bpmnElement="gateway_claimCovered" isMarkerVisible="true">
        <dc:Bounds x="425" y="235" width="50" height="50" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="412" y="292" width="76" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="serviceTask_payOutClaim_di" bpmnElement="serviceTask_payOutClaim">
        <dc:Bounds x="540" y="220" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="endEvent_claimPaid_di" bpmnElement="endEvent_claimPaid">
        <dc:Bounds x="712" y="242" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="704" y="285" width="52" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="sendTask_sendRejectionLetter_di" bpmnElement="sendTask_sendRejectionLetter">
        <dc:Bounds x="540" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="endEvent_claimRejected_di" bpmnElement="endEvent_claimRejected">
        <dc:Bounds x="712" y="102" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="694" y="145" width="72" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="flow_claimReceivedToAssessClaim_di" bpmnElement="flow_claimReceivedToAssessClaim">
        <di:waypoint x="208" y="260" />
        <di:waypoint x="270" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_assessClaimToClaimCovered_di" bpmnElement="flow_assessClaimToClaimCovered">
        <di:waypoint x="370" y="260" />
        <di:waypoint x="425" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_claimCoveredToPayOutClaim_di" bpmnElement="flow_claimCoveredToPayOutClaim">
        <di:waypoint x="475" y="260" />
        <di:waypoint x="540" y="260" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="499" y="242" width="18" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_payOutClaimToClaimPaid_di" bpmnElement="flow_payOutClaimToClaimPaid">
        <di:waypoint x="640" y="260" />
        <di:waypoint x="712" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_claimCoveredToSendRejectionLetter_di" bpmnElement="flow_claimCoveredToSendRejectionLetter">
        <di:waypoint x="450" y="235" />
        <di:waypoint x="450" y="120" />
        <di:waypoint x="540" y="120" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="458" y="175" width="13" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_sendRejectionLetterToClaimRejected_di" bpmnElement="flow_sendRejectionLetterToClaimRejected">
        <di:waypoint x="640" y="120" />
        <di:waypoint x="712" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
BPMN_FIXTURE
