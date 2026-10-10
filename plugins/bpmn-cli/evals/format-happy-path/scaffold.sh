#!/usr/bin/env bash
# Scaffold of the eval case "format-happy-path": writes claim-handling.bpmn into the empty workspace.
# A claim handling process drawn by hand, the rejection branch above the main line.
set -euo pipefail
cat > claim-handling.bpmn <<'BPMN_FIXTURE'
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_ClaimHandling" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="5.31.0">
  <bpmn:process id="Process_ClaimHandling" name="Claim handling" isExecutable="false">
    <bpmn:startEvent id="Event_ClaimReceived" name="Claim received">
      <bpmn:outgoing>Flow_ClaimReceivedToAssessClaim</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Activity_AssessClaim" name="Assess claim">
      <bpmn:incoming>Flow_ClaimReceivedToAssessClaim</bpmn:incoming>
      <bpmn:outgoing>Flow_AssessClaimToClaimCovered</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gateway_ClaimCovered" name="Claim covered?" default="Flow_ClaimCoveredNo">
      <bpmn:incoming>Flow_AssessClaimToClaimCovered</bpmn:incoming>
      <bpmn:outgoing>Flow_ClaimCoveredYes</bpmn:outgoing>
      <bpmn:outgoing>Flow_ClaimCoveredNo</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:serviceTask id="Activity_PayOutClaim" name="Pay out claim">
      <bpmn:incoming>Flow_ClaimCoveredYes</bpmn:incoming>
      <bpmn:outgoing>Flow_PayOutClaimToClaimPaid</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="Event_ClaimPaid" name="Claim paid">
      <bpmn:incoming>Flow_PayOutClaimToClaimPaid</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sendTask id="Activity_SendRejectionLetter" name="Send rejection letter">
      <bpmn:incoming>Flow_ClaimCoveredNo</bpmn:incoming>
      <bpmn:outgoing>Flow_SendRejectionLetterToClaimRejected</bpmn:outgoing>
    </bpmn:sendTask>
    <bpmn:endEvent id="Event_ClaimRejected" name="Claim rejected">
      <bpmn:incoming>Flow_SendRejectionLetterToClaimRejected</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_ClaimReceivedToAssessClaim" sourceRef="Event_ClaimReceived" targetRef="Activity_AssessClaim" />
    <bpmn:sequenceFlow id="Flow_AssessClaimToClaimCovered" sourceRef="Activity_AssessClaim" targetRef="Gateway_ClaimCovered" />
    <bpmn:sequenceFlow id="Flow_ClaimCoveredYes" name="yes" sourceRef="Gateway_ClaimCovered" targetRef="Activity_PayOutClaim">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${covered}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_PayOutClaimToClaimPaid" sourceRef="Activity_PayOutClaim" targetRef="Event_ClaimPaid" />
    <bpmn:sequenceFlow id="Flow_ClaimCoveredNo" name="no" sourceRef="Gateway_ClaimCovered" targetRef="Activity_SendRejectionLetter" />
    <bpmn:sequenceFlow id="Flow_SendRejectionLetterToClaimRejected" sourceRef="Activity_SendRejectionLetter" targetRef="Event_ClaimRejected" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_ClaimHandling">
    <bpmndi:BPMNPlane id="BPMNPlane_ClaimHandling" bpmnElement="Process_ClaimHandling">
      <bpmndi:BPMNShape id="Event_ClaimReceived_di" bpmnElement="Event_ClaimReceived">
        <dc:Bounds x="172" y="242" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="153" y="285" width="74" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_AssessClaim_di" bpmnElement="Activity_AssessClaim">
        <dc:Bounds x="270" y="220" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_ClaimCovered_di" bpmnElement="Gateway_ClaimCovered" isMarkerVisible="true">
        <dc:Bounds x="425" y="235" width="50" height="50" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="412" y="292" width="76" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_PayOutClaim_di" bpmnElement="Activity_PayOutClaim">
        <dc:Bounds x="540" y="220" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_ClaimPaid_di" bpmnElement="Event_ClaimPaid">
        <dc:Bounds x="712" y="242" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="704" y="285" width="52" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_SendRejectionLetter_di" bpmnElement="Activity_SendRejectionLetter">
        <dc:Bounds x="540" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_ClaimRejected_di" bpmnElement="Event_ClaimRejected">
        <dc:Bounds x="712" y="102" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="694" y="145" width="72" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_ClaimReceivedToAssessClaim_di" bpmnElement="Flow_ClaimReceivedToAssessClaim">
        <di:waypoint x="208" y="260" />
        <di:waypoint x="270" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_AssessClaimToClaimCovered_di" bpmnElement="Flow_AssessClaimToClaimCovered">
        <di:waypoint x="370" y="260" />
        <di:waypoint x="425" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_ClaimCoveredYes_di" bpmnElement="Flow_ClaimCoveredYes">
        <di:waypoint x="475" y="260" />
        <di:waypoint x="540" y="260" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="499" y="242" width="18" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_PayOutClaimToClaimPaid_di" bpmnElement="Flow_PayOutClaimToClaimPaid">
        <di:waypoint x="640" y="260" />
        <di:waypoint x="712" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_ClaimCoveredNo_di" bpmnElement="Flow_ClaimCoveredNo">
        <di:waypoint x="450" y="235" />
        <di:waypoint x="450" y="120" />
        <di:waypoint x="540" y="120" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="458" y="175" width="13" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_SendRejectionLetterToClaimRejected_di" bpmnElement="Flow_SendRejectionLetterToClaimRejected">
        <di:waypoint x="640" y="120" />
        <di:waypoint x="712" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
BPMN_FIXTURE
