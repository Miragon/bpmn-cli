#!/usr/bin/env bash
# Scaffold of the eval case "edit-hand-drawn-model": writes purchase-request.bpmn into the empty workspace.
# A purchase request process drawn by hand in Camunda Modeler (Modeler ids and coordinates).
set -euo pipefail
cat > purchase-request.bpmn <<'BPMN_FIXTURE'
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_1p7x3kq" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="5.31.0">
  <bpmn:process id="Process_0c4m2wd" name="Purchase request" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Purchase request submitted">
      <bpmn:outgoing>Flow_0b8wq1x</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Activity_0k3x9qa" name="Check budget">
      <bpmn:incoming>Flow_0b8wq1x</bpmn:incoming>
      <bpmn:outgoing>Flow_1j4kz7p</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gateway_1hd8x2m" name="Budget available?" default="Flow_1r2x9bv">
      <bpmn:incoming>Flow_1j4kz7p</bpmn:incoming>
      <bpmn:outgoing>Flow_0yq6cfd</bpmn:outgoing>
      <bpmn:outgoing>Flow_1r2x9bv</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:serviceTask id="Activity_1v0w8zr" name="Order goods">
      <bpmn:incoming>Flow_0yq6cfd</bpmn:incoming>
      <bpmn:outgoing>Flow_0m7sd3e</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="Event_0q2mb7c" name="Goods ordered">
      <bpmn:incoming>Flow_0m7sd3e</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sendTask id="Activity_0f3j5ny" name="Notify requester">
      <bpmn:incoming>Flow_1r2x9bv</bpmn:incoming>
      <bpmn:outgoing>Flow_1c5ag8h</bpmn:outgoing>
    </bpmn:sendTask>
    <bpmn:endEvent id="Event_1n8ld0a" name="Request rejected">
      <bpmn:incoming>Flow_1c5ag8h</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_0b8wq1x" sourceRef="StartEvent_1" targetRef="Activity_0k3x9qa" />
    <bpmn:sequenceFlow id="Flow_1j4kz7p" sourceRef="Activity_0k3x9qa" targetRef="Gateway_1hd8x2m" />
    <bpmn:sequenceFlow id="Flow_0yq6cfd" name="yes" sourceRef="Gateway_1hd8x2m" targetRef="Activity_1v0w8zr">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${budgetAvailable}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_1r2x9bv" name="no" sourceRef="Gateway_1hd8x2m" targetRef="Activity_0f3j5ny" />
    <bpmn:sequenceFlow id="Flow_0m7sd3e" sourceRef="Activity_1v0w8zr" targetRef="Event_0q2mb7c" />
    <bpmn:sequenceFlow id="Flow_1c5ag8h" sourceRef="Activity_0f3j5ny" targetRef="Event_1n8ld0a" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_0c4m2wd">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="172" y="182" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="149" y="225" width="83" height="27" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_0k3x9qa_di" bpmnElement="Activity_0k3x9qa">
        <dc:Bounds x="270" y="160" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_1hd8x2m_di" bpmnElement="Gateway_1hd8x2m" isMarkerVisible="true">
        <dc:Bounds x="435" y="175" width="50" height="50" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="417" y="145" width="87" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_1v0w8zr_di" bpmnElement="Activity_1v0w8zr">
        <dc:Bounds x="550" y="160" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_0q2mb7c_di" bpmnElement="Event_0q2mb7c">
        <dc:Bounds x="722" y="182" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="704" y="225" width="73" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_0f3j5ny_di" bpmnElement="Activity_0f3j5ny">
        <dc:Bounds x="550" y="300" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_1n8ld0a_di" bpmnElement="Event_1n8ld0a">
        <dc:Bounds x="722" y="322" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="698" y="365" width="85" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_0b8wq1x_di" bpmnElement="Flow_0b8wq1x">
        <di:waypoint x="208" y="200" />
        <di:waypoint x="270" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_1j4kz7p_di" bpmnElement="Flow_1j4kz7p">
        <di:waypoint x="370" y="200" />
        <di:waypoint x="435" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_0yq6cfd_di" bpmnElement="Flow_0yq6cfd">
        <di:waypoint x="485" y="200" />
        <di:waypoint x="550" y="200" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="509" y="182" width="18" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_1r2x9bv_di" bpmnElement="Flow_1r2x9bv">
        <di:waypoint x="460" y="225" />
        <di:waypoint x="460" y="340" />
        <di:waypoint x="550" y="340" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="468" y="280" width="13" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_0m7sd3e_di" bpmnElement="Flow_0m7sd3e">
        <di:waypoint x="650" y="200" />
        <di:waypoint x="722" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_1c5ag8h_di" bpmnElement="Flow_1c5ag8h">
        <di:waypoint x="650" y="340" />
        <di:waypoint x="722" y="340" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
BPMN_FIXTURE
