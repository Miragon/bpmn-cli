import { describe, expect, it } from 'vitest';
import { ChangeSet } from '../../../src/model/document/ChangeSet.js';
import { DocumentReader } from '../../../src/model/document/DocumentReader.js';
import { DocumentWriter } from '../../../src/model/document/DocumentWriter.js';
import { NewDocument } from '../../../src/model/document/NewDocument.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DocumentWriter', () => {
  it('writes an unchanged file back byte for byte', async () => {
    const text = Fixtures.text('models/roundtrip/styled.bpmn');
    const document = await new DocumentReader().readForWrite(text);

    expect(await new DocumentWriter().write(document)).toBe(text);
  });

  it('changes only the line of a renamed task', async () => {
    const text = Fixtures.text('models/roundtrip/styled.bpmn');
    const document = await new DocumentReader().readForWrite(text);
    const task = document.tree.walk().next().value!;
    const named = [...document.tree.walk()].find((element) => element.is('bpmn:Activity') && element.name) ?? task;
    const before = named.name!;

    named.set('name', `${before} X`);

    const written = (await new DocumentWriter().write(document)).split('\n');
    const lines = text.split('\n');
    expect(written.filter((line, index) => line !== lines[index])).toHaveLength(1);
    expect(written.join('\n')).toContain(`${before} X`);
  });

  it('does not write a list entry a file without lists never had', async () => {
    const text = Fixtures.text('models/roundtrip/listless.bpmn');
    const document = await new DocumentReader().readForWrite(text);

    expect(await new DocumentWriter().write(document)).toBe(text);
    expect(await new DocumentWriter().plain(document)).toContain('<incoming>');
  });

  it('refuses to write a read document without its text as read', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    await expect(new DocumentWriter().write(document)).rejects.toMatchObject({ code: 'E_INTERNAL', category: 'internal' });
  });

  it('writes a new document as moddle serialises it', async () => {
    const document = new NewDocument({ processId: 'Process_new' }).create();
    const xml = await new DocumentWriter().write(document);

    expect(xml).toContain('id="Process_new"');
    expect(await new DocumentWriter().asRead(document)).toBeUndefined();
  });

  it('writes a lossy import plain and says so', async () => {
    const document = await new DocumentReader().readForWrite(Fixtures.text('model/lossy.bpmn'));
    const changes = new ChangeSet();

    const xml = await new DocumentWriter().write(document, changes);

    expect(xml).not.toContain('loop_first');
    expect(changes.notes[0]).toContain("the file's formatting was not kept (the import was lossy)");
  });

  it('declares UTF-8 once a file with another encoding changes, keeps its comment, and says so', async () => {
    const document = await new DocumentReader().readForWrite(Fixtures.text('model/latin1.bpmn'));
    const changes = new ChangeSet();
    document.tree.require('task_latin').set('name', 'Prüfung');

    const xml = await new DocumentWriter().write(document, changes);

    expect(xml).toContain('encoding="UTF-8"');
    expect(xml).toContain('<!-- a comment the text keeps -->');
    expect(changes.notes).toEqual(['the XML declaration named the encoding ISO-8859-1; the text is written as UTF-8, so it now says UTF-8']);
  });

  it('leaves the declaration of an untouched file alone', async () => {
    const text = Fixtures.text('model/latin1.bpmn');

    expect(await new DocumentWriter().write(await new DocumentReader().readForWrite(text))).toBe(text);
  });

  it('notes a comment that goes with the element it sat in', async () => {
    const text = '<?xml version="1.0"?>\n<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="t">\n  <bpmn:process id="p">\n    <bpmn:task id="a">\n      <!-- gone -->\n    </bpmn:task>\n  </bpmn:process>\n</bpmn:definitions>\n';
    const document = await new DocumentReader().readForWrite(text);
    const changes = new ChangeSet();
    const process = document.tree.require('p');
    process.remove('flowElements', document.tree.require('a'));

    const xml = await new DocumentWriter().write(document, changes);

    expect(xml).not.toContain('gone');
    expect(changes.notes).toEqual(['1 XML comment(s) dropped: they were inside or next to elements the change removed or rewrote']);
  });
});
