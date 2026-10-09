/**
 * Roundtrip fidelity (audit 2026-10 bugs #30, #31, #44, #45, #46): a write
 * changes the text of the elements the change touched and nothing else.
 *
 *  - a change that leaves the model as it was is not written (`unchanged`);
 *  - everything outside the changed elements keeps its text: prolog,
 *    comments, the root tag with its namespace order, vendor attributes in
 *    their place, CDATA, entities, quotes, indentation, the missing final
 *    line break (preserve.ts);
 *  - changed and new elements follow the file's style (attribute order,
 *    indentation unit, `/>`, a CDATA section stays one);
 *  - comments next to removed elements are reported, never dropped silently;
 *  - incoming / outgoing lists are written the way the file keeps them
 *    (mirror.ts), never added for flows that did not change;
 *  - the safety net: a text that would not read back as the changed model
 *    falls back to bpmn-moddle's serialisation.
 *
 * Fixtures in test/fixtures/roundtrip/ are synthetic.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { is, type El } from '../src/model.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, mutateFile, type MutationOptions, type MutationResult } from '../src/pipeline.js';
import { preserveText } from '../src/preserve.js';
import { readXmlText, XmlTextError } from '../src/xmltext.js';
import { definitionsXml } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const fixture = (name: string): string => readFileSync(join(HERE, 'fixtures', 'roundtrip', name), 'utf8');
const STYLED = fixture('styled.bpmn');
const LISTLESS = fixture('listless.bpmn');

async function dry(xml: string, ops: Op[], opts: MutationOptions = {}): Promise<MutationResult> {
  return mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, ...opts });
}

const rename = (id: string, name: string): Op => ({ op: 'set', id, values: { name } });

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-roundtrip-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('a change that leaves the model as it was is not written (#46)', () => {
  it.each([['auto', 'auto'], ['--no-layout', false]] as const)('keeps the file byte for byte and its mtime (%s)', async (_, layout) => {
    const file = join(dir, `noop-${String(layout)}.bpmn`);
    writeFileSync(file, STYLED);
    const past = new Date('2020-01-01T00:00:00Z');
    utimesSync(file, past, past);
    const r = await mutateFile(file, [rename('Task_Check', 'Check order')], { layout });
    expect(r).toMatchObject({ unchanged: true, written: false });
    expect(r.xml).toBe(STYLED);
    expect(readFileSync(file, 'utf8')).toBe(STYLED);
    expect(statSync(file).mtime.getTime()).toBe(past.getTime());
  });

  it('a dry run says so; --out still gets its copy', async () => {
    const file = join(dir, 'noop-out.bpmn');
    const other = join(dir, 'noop-copy.bpmn');
    writeFileSync(file, STYLED);
    expect(await mutateFile(file, [rename('Task_Check', 'Check order')], { dryRun: true })).toMatchObject({ unchanged: true, written: false });
    const r = await mutateFile(file, [rename('Task_Check', 'Check order')], { out: other });
    expect(r).toMatchObject({ unchanged: true, written: true });
    expect(readFileSync(other, 'utf8')).toBe(STYLED);
  });

  it('a real change is written and not unchanged', async () => {
    const r = await dry(STYLED, [rename('Task_Check', 'Check the order')], { layout: false });
    expect(r.unchanged).toBe(false);
  });
});

describe('text-preserving output (#30, #31, #44)', () => {
  it.each([['auto', 'auto'], ['--no-layout', false]] as const)('a rename changes the renamed start tag only, in its attribute order (%s)', async (_, layout) => {
    const r = await dry(STYLED, [rename('Task_Check', 'Check the order')], { layout });
    expect(r.xml).toBe(STYLED.replace('name="Check order"', 'name="Check the order"'));
  });

  it('prolog, comments, CDATA, entities, quotes, the root tag and the missing final line break survive an insert', async () => {
    const r = await dry(STYLED, [{ op: 'add', kind: 'task', name: 'Audit', id: 'Activity_Audit', after: 'Task_Check' }]);
    const out = r.xml;
    expect(out.startsWith(STYLED.slice(0, STYLED.indexOf('<bpmn:process')))).toBe(true);
    for (const kept of [
      '<!-- the order starts here -->',
      '<!-- scripted step: the script stays readable -->',
      '    <!-- end of the synthetic fixture -->\n</bpmn:definitions>',
      '<bpmn:script><![CDATA[var total = a < b && c > 0 ? a : b;]]></bpmn:script>',
      '<![CDATA[${amount < 100 && ok}]]>',
      '<bpmn:scriptTask id="Task_Script" name="Pick &amp; pack" scriptFormat="javascript">',
      "<bpmn:endEvent id='End' name='Done'>",
      '<bpmn:process id="Process_Styled" camunda:historyTimeToLive="180" isExecutable="true">',
      '<bpmn:userTask id="Task_Check" camunda:asyncBefore="true" name="Check order" camunda:assignee="clerk">',
    ]) {
      expect(out).toContain(kept);
    }
    expect(out.endsWith('\n')).toBe(false);
    expect(r.changes.notes.join(' ')).not.toMatch(/comment|formatting/);
  });

  it("new and changed elements follow the file's indentation, empty-element style and attribute order", async () => {
    const out = (await dry(STYLED, [{ op: 'add', kind: 'task', name: 'Audit', id: 'Activity_Audit', after: 'Task_Check' }])).xml;
    // the spliced flow keeps its place and its tight `/>`, the new elements are indented by the file's four spaces
    expect(out).toMatch(/\n {8}<bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Check" targetRef="Activity_Audit"\/>\n/);
    expect(out).toMatch(/\n {8}<bpmn:task id="Activity_Audit" name="Audit">\n {12}<bpmn:incoming>Flow_2<\/bpmn:incoming>\n {12}<bpmn:outgoing>(Flow_\w+)<\/bpmn:outgoing>\n {8}<\/bpmn:task>\n/);
    expect(out).toMatch(/\n {8}<bpmn:sequenceFlow id="Flow_\w+" sourceRef="Activity_Audit" targetRef="Gateway_Ok"\/>\n/);
    expect(out).toMatch(/\n {12}<bpmndi:BPMNShape id="Activity_Audit_di" bpmnElement="Activity_Audit">\n {16}<dc:Bounds x="\d+" y="\d+" width="100" height="80"\/>\n {12}<\/bpmndi:BPMNShape>/);
    // a label written on one line stays on one line when its bounds change
    expect(out).toMatch(/<bpmndi:BPMNShape id="End_di" bpmnElement="End">\n {16}<dc:Bounds [^\n]*\/>\n {16}<bpmndi:BPMNLabel><dc:Bounds [^\n]*\/><\/bpmndi:BPMNLabel>/);
  });

  it('CRLF line breaks and tab indentation are kept, also around new elements', async () => {
    const crlfTabs = STYLED.replace(/^((?: {4})+)/gm, (m) => '\t'.repeat(m.length / 4)).replace(/\n/g, '\r\n');
    const out = (await dry(crlfTabs, [{ op: 'add', kind: 'task', name: 'Audit', id: 'Activity_Audit', after: 'Task_Check' }])).xml;
    expect(out).not.toMatch(/[^\r]\n/);
    expect(out).toMatch(/\r\n\t\t<bpmn:task id="Activity_Audit" name="Audit">\r\n\t\t\t<bpmn:incoming>Flow_2<\/bpmn:incoming>/);
    expect(out).toMatch(/\/>\r\n\t\t<bpmn:sequenceFlow id="Flow_Yes"/);
    expect(out).toMatch(/\r\n\t\t\t<bpmndi:BPMNShape id="Activity_Audit_di" bpmnElement="Activity_Audit">\r\n\t\t\t\t<dc:Bounds /);
  });

  it('a changed condition keeps its CDATA section', async () => {
    const r = await dry(STYLED, [{ op: 'set', id: 'Flow_Yes', values: { condition: '${amount < 200 && ok}' } }], { layout: false });
    expect(r.xml).toBe(STYLED.replace('${amount < 100 && ok}', '${amount < 200 && ok}'));
  });

  it('a retype keeps the attribute order and renames both tags', async () => {
    const r = await dry(STYLED, [{ op: 'retype', id: 'Task_Check', kind: 'manualTask' }], { layout: false });
    expect(r.xml).toBe(STYLED.replace('<bpmn:userTask id="Task_Check"', '<bpmn:manualTask id="Task_Check"').replace('</bpmn:userTask>', '</bpmn:manualTask>'));
  });

  it('a namespace the change declares joins the original root tag', async () => {
    const r = await dry(LISTLESS, [{ op: 'set', id: 'Task_A', values: { 'camunda:asyncBefore': 'true' } }], { layout: false });
    const declaration = ' xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';
    expect(r.xml).toContain(declaration);
    expect(r.xml.replace(declaration, '')).toBe(LISTLESS.replace('<task id="Task_A" name="Register request" />', '<task id="Task_A" name="Register request" camunda:asyncBefore="true" />'));
  });
});

describe('comments next to removed elements are reported (#31)', () => {
  it('removing an element drops the comment before it with a note, the other comments stay', async () => {
    const r = await dry(STYLED, [{ op: 'remove', ids: ['Task_Script'] }]);
    expect(r.xml).not.toContain('scripted step');
    for (const kept of ['Synthetic roundtrip fixture', 'the order starts here', 'end of the synthetic fixture']) expect(r.xml).toContain(kept);
    expect(r.changes.notes).toContain('1 XML comment(s) dropped: they were inside or next to elements the change removed or rewrote');
  });

  it('a forced write of a lossy import says that the formatting and the comments are gone', async () => {
    const lossy = STYLED.replace('<bpmn:userTask id="Task_Check"', '<bpmn:userTask id="Task_Check" ').replace('</bpmn:process>', '<bpmn:fooBar id="X" />\n    </bpmn:process>');
    const r = await dry(lossy, [rename('Task_Check', 'Check the order')], { layout: false, force: true });
    expect(r.changes.notes.join('\n')).toMatch(/the file's formatting was not kept \(the import was lossy\).*4 XML comment\(s\) dropped/);
  });
});

describe('incoming / outgoing lists are written the way the file keeps them (#45)', () => {
  const lists = (xml: string): number => (xml.match(/<(bpmn:)?(incoming|outgoing)>/g) ?? []).length;

  it('a file without the lists does not get them, for a rename or an insert', async () => {
    const renamed = await dry(LISTLESS, [rename('Task_A', 'Register the request')]);
    expect(renamed.xml).toBe(LISTLESS.replace('name="Register request"', 'name="Register the request"'));
    const inserted = await dry(LISTLESS, [{ op: 'add', kind: 'task', name: 'Check request', after: 'Task_A' }]);
    expect(lists(inserted.xml)).toBe(0);
    expect(inserted.xml).toMatch(/\n {4}<task id="Activity_CheckRequest" name="Check request" \/>\n/);
  });

  it('in memory the lists are complete (the placement grammar and the views read them)', async () => {
    const doc = await Doc.fromXml(LISTLESS);
    const id = (e: El): string => e.get<string>('id');
    expect(doc.outgoing(doc.require('Task_A')).map(id)).toEqual(['flow_a_b']);
    expect(doc.incoming(doc.require('End')).map(id)).toEqual(['flow_b_end']);
  });

  it('a file with the lists gets entries for new and changed flows only; a missing entry of an unchanged flow stays missing', async () => {
    const partial = STYLED.replace('            <bpmn:incoming>Flow_4</bpmn:incoming>\n', '');
    const renamed = await dry(partial, [rename('Task_Check', 'Check the order')], { layout: false });
    expect(renamed.xml).toBe(partial.replace('name="Check order"', 'name="Check the order"'));
    const inserted = await dry(STYLED, [{ op: 'add', kind: 'task', name: 'Audit', id: 'Activity_Audit', after: 'Task_Check' }]);
    const after = await Doc.fromXml(inserted.xml);
    expect(after.source!.mirror.listed.get(after.require('Activity_Audit'))).toBeDefined();
    expect(inserted.xml).toMatch(/<bpmn:exclusiveGateway id="Gateway_Ok" name="Order ok\?" default="Flow_No">\n {12}<bpmn:incoming>Flow_\w+<\/bpmn:incoming>/);
    expect(lists(inserted.xml)).toBe(lists(STYLED) + 2);
  });

  it('a file without any sequence flow, like a new one, gets the lists the Modeler writes', async () => {
    const r = await dry(definitionsXml('    <bpmn:startEvent id="Start" />'), [{ op: 'add', kind: 'task', name: 'Work', id: 'Activity_Work', after: 'Start' }], { layout: false });
    expect(r.xml).toMatch(/<bpmn:startEvent id="Start">\s*<bpmn:outgoing>Flow_\w+<\/bpmn:outgoing>/);
    expect(r.xml).toMatch(/<bpmn:task id="Activity_Work" name="Work">\s*<bpmn:incoming>Flow_\w+<\/bpmn:incoming>/);
  });
});

describe('the safety net', () => {
  it('falls back to the plain serialisation when the preserved text would not read back as the changed model', async () => {
    // a baseline that does not describe the original: its unchanged task text would be copied from the original
    const original = definitionsXml('    <bpmn:task id="A" name="as read" />\n    <bpmn:task id="B" name="b" />');
    const model = async (a: string, b: string): Promise<string> => (await Doc.fromXml(definitionsXml(`    <bpmn:task id="A" name="${a}" />\n    <bpmn:task id="B" name="${b}" />`))).toXml();
    const r = await preserveText(original, await model('other', 'b'), await model('other', 'b2'));
    expect(r.mode).toBe('plain');
    expect(r.reason).toMatch(/does not read back/);
    expect(r.xml).toBe(await model('other', 'b2'));
  });

  it('a DOCTYPE keeps the plain serialisation', async () => {
    const original = `<?xml version="1.0"?>\n<!DOCTYPE definitions>\n${definitionsXml('    <bpmn:task id="A" />').replace(/^<\?xml[^>]*>\n/, '')}`;
    const next = await (await Doc.fromXml(definitionsXml('    <bpmn:task id="A" name="x" />'))).toXml();
    const r = await preserveText(original, await (await Doc.fromXml(definitionsXml('    <bpmn:task id="A" />'))).toXml(), next);
    expect(r).toMatchObject({ mode: 'plain', xml: next });
    expect(r.reason).toMatch(/DOCTYPE/);
  });

  it('the position-keeping reader', () => {
    const text = `<?xml version="1.0"?>\n<a:root xmlns:a="urn:a" x='1'>\n  <!-- c -->\n  <a:kid id="k" a:y="2"/>text<![CDATA[<raw>]]></a:root>\n`;
    const doc = readXmlText(text);
    expect(doc.comments).toBe(1);
    expect(doc.root).toMatchObject({ name: 'a:root', uri: 'urn:a', local: 'root', selfClosing: false });
    const kid = doc.root.children.find((c) => c.kind === 'element') as ReturnType<typeof readXmlText>['root'];
    expect(text.slice(kid.start, kid.end)).toBe('<a:kid id="k" a:y="2"/>');
    expect(kid.attrs.map((a) => [a.name, a.raw, a.ws])).toEqual([['id', 'k', ' '], ['a:y', '2', ' ']]);
    expect(doc.root.children.map((c) => c.kind)).toEqual(['text', 'comment', 'text', 'element', 'text', 'cdata']);
    for (const bad of ['<a><b></a></b>', '<x:a/>', '<a b="1" b="2"/>', '<!DOCTYPE a><a/>', '<a/><b/>', '<a>']) expect(() => readXmlText(bad)).toThrow(XmlTextError);
  });
});

/* ------------------------------------------------------------------ */
/* every synthetic fixture and scenario                                 */
/* ------------------------------------------------------------------ */

function bpmnFiles(base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const path = join(base, entry.name);
    if (entry.isDirectory()) out.push(...bpmnFiles(path));
    else if (entry.name.endsWith('.bpmn')) out.push(path);
  }
  return out.sort();
}

const CORPUS = [...bpmnFiles(join(HERE, 'fixtures')), ...bpmnFiles(join(ROOT, 'tools', 'scenarios'))].map((p) => [p.slice(ROOT.length + 1), p] as const);

describe('every synthetic fixture and scenario', () => {
  it.each(CORPUS)('%s: a no-op is unchanged, a rename changes one line', async (_, path) => {
    const xml = readFileSync(path, 'utf8');
    const doc = await Doc.fromXml(xml);
    if (doc.lossyImportWarnings.length) return;
    const named = [...doc.byId().values()].find((e) => (is(e, 'bpmn:Activity') || is(e, 'bpmn:Event')) && e.get<string | undefined>('name'));
    if (!named) return;
    const id = named.get<string>('id');
    const name = named.get<string>('name');
    const same = await mutateDoc(doc, [rename(id, name)], { dryRun: true, layout: false, force: true });
    expect(same.unchanged).toBe(true);
    const renamed = await mutateDoc(await Doc.fromXml(xml), [rename(id, `${name} X`)], { dryRun: true, layout: false, force: true });
    const a = xml.split('\n');
    const b = renamed.xml.split('\n');
    expect(b.length).toBe(a.length);
    expect(a.filter((line, i) => line !== b[i])).toHaveLength(1);
  });
});
