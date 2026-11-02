import { describe, expect, it } from 'vitest';
import { ModelView } from '../../../src/views/model/ModelView.js';
import { ModelViewText } from '../../../src/views/model/ModelViewText.js';
import { Fixtures } from '../../support/Fixtures.js';

const text = async (file: string, within?: string) => new ModelView(await Fixtures.read(file)).answer(within).text;
const CLAIMS = 'models/views/claims.bpmn';
const LONG = 'views/long-outline.bpmn';

describe('ModelViewText', () => {
  it('prints one line per node with its lane, flags and flows', async () => {
    const shown = await text(CLAIMS);

    expect(shown).toContain('  startEvent:message Event_ClaimReceived "Claim received" [lane=Lane_Office, message Claim] -> Activity_Assess (Flow_ToAssess)');
    expect(shown).toMatch(/\n {4}serviceTask Activity_CheckPolicy "Check policy" \[camunda:type=external/);
    expect(shown).toContain('  lanes:\n    Lane_Office "Office"\n      Lane_Clerks "Clerks"\n    Lane_Fraud "Fraud team"\n');
  });

  it('prints message flows, the black box, data, annotations and root elements', async () => {
    const shown = await text(CLAIMS);

    expect(shown).toContain('  participant Participant_Customer "Customer" (black box)');
    expect(shown).toContain('  messageFlow Flow_Decision "Decision": Activity_SendDecision "Send decision" -> Participant_Customer "Customer"');
    expect(shown).toContain('  annotations:\n    TextAnnotation_Sla "Answer within 5 days" ~ Activity_SendDecision\nprocess Process_Claims');
    expect(shown).toContain('  data:\n    dataObject DataObjectReference_ClaimFile "Claim file" (from Activity_RateDamage; to Activity_Pay)');
    expect(shown).toContain('root: message Message_Claim "Claim", message Message_Cancel "Cancel", error Error_Fraud "Fraud" (FRAUD)');
  });

  it('says what a cut left out in its first line', async () => {
    expect((await text(CLAIMS, 'Lane_Fraud')).split('\n')[0]).toBe('in Lane_Fraud: 5 of 16 nodes, 2 of 12 flows');
  });

  it('marks unreachable nodes, empty lanes and an empty process', async () => {
    const shown = await text('views/groups.bpmn');

    expect(shown).toContain('  ! unreachable: task Stray "Stray"');
    expect(shown).toContain('    Lane_Empty (empty)');
    expect(shown).toContain('process Process_Empty non-executable\n  (empty)');
  });

  it('prints groups with their members, and an empty one as empty', async () => {
    const shown = await text('views/groups.bpmn');

    expect(shown).toContain('groups:\n  Group_Category "Billing": Invoice\n  Group_Box: Boxed\n  Group_Nothing: (empty)');
  });

  it('prints correlation keys of messages and the import warnings of a lossy file', async () => {
    expect(await text('views/implementation.bpmn')).toContain('root: message Message_Notice "Notice" [correlationKey==order.id]');
    expect((await text('model/lossy.bpmn')).split('\n')[0]).toMatch(/^import: /);
  });

  it('collapses past about 150 lines, says what it left out and how to zoom in', async () => {
    const lines = (await text(LONG)).split('\n');

    expect(lines.length).toBeLessThanOrEqual(160);
    expect(lines).toContain('  26 of 175 nodes left out: show --in Lane_Second');
    expect(lines).toContain('process Process_Other "Other" non-executable: 2 nodes, show --in Process_Other');
    expect(lines).toContain('  lanes: 2 left out, --json lists them');
  });

  it('collapses a sub-process that does not fit to one line naming show --in', async () => {
    const shown = await text('views/long-subprocess.bpmn');

    expect(shown).toContain(': 150 nodes, show --in Sub_Long');
    expect(shown).not.toContain('Inner_1 ');
  });

  it('names find --in for nodes that sit in no lane', async () => {
    expect(await text('views/long-subprocess.bpmn')).toContain('find --in Process_Flat');
  });

  it('cuts a long section and says how many lines it left out', () => {
    const groups = Array.from({ length: 200 }, (_entry, index) => ({ id: `Group_${index}`, kind: 'group', members: [] }));

    const lines = new ModelViewText({ kind: 'model', definitions: { id: 'Definitions', namespaces: [] }, processes: [], rootElements: [], groups }).text().split('\n');

    expect(lines).toHaveLength(151);
    expect(lines.at(-1)).toBe('groups: 51 left out, --json lists them');
  });

  it('prints a data object and an annotation on their own', () => {
    expect(ModelViewText.dataLine({ id: 'Data', kind: 'dataStore', from: [], to: [] })).toBe('dataStore Data');
    expect(ModelViewText.annotationLine({ id: 'Note', attachedTo: [] })).toBe('Note');
  });
});
