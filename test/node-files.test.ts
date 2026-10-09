/**
 * The node layer (src/node/files.ts, `@miragon/bpmn-cli/node`) owns every
 * file access: reading (E_FILE_NOT_FOUND / E_IO), the lossy-import guard of
 * loadDoc, the atomic write with -o / --dry-run / --backup / new's
 * existing-file guard. The core's mutateDoc never writes.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as node from '../src/node/index.js';
import { checkFile, layoutFile, loadDoc, mutateDocToFile, mutateFile, readDoc, readXml, writeAtomic } from '../src/node/files.js';
import { Doc } from '../src/document.js';
import { mutateDoc } from '../src/pipeline.js';
import { definitionsXml, LINEAR } from './helpers.js';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-node-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, xml = LINEAR): string {
  const f = join(dir, name);
  writeFileSync(f, xml);
  return f;
}

async function rejected(p: Promise<unknown>): Promise<{ code: string; category: string }> {
  try {
    await p;
  } catch (err) {
    return err as { code: string; category: string };
  }
  throw new Error('expected a rejection');
}

const rename = [{ op: 'set' as const, id: 'Task_A', values: { name: 'Renamed' } }];

describe('the core never writes', () => {
  it('mutateDoc on a document loaded from a file returns the XML and leaves the file alone', async () => {
    const f = file('core.bpmn');
    const r = await mutateDoc(await readDoc(f), rename);
    expect(r.written).toBe(false);
    expect(r.file).toBe(f);
    expect(r.xml).toContain('Renamed');
    expect(readFileSync(f, 'utf8')).toBe(LINEAR);
  });
});

describe('the node layer', () => {
  it('exports the core and the file helpers', () => {
    expect(typeof node.applyToXml).toBe('function');
    expect(typeof node.mutateFile).toBe('function');
    expect(node.mutateDoc).toBe(mutateDoc);
  });

  it('reads with the documented codes', async () => {
    expect(await rejected(readXml(join(dir, 'missing.bpmn')))).toMatchObject({ code: 'E_FILE_NOT_FOUND', category: 'io' });
    expect(await rejected(readDoc(dir))).toMatchObject({ code: 'E_IO' });
    expect(await rejected(readDoc(file('bad.bpmn', '<nope')))).toMatchObject({ code: 'E_PARSE' });
    const lossy = file('lossy.bpmn', definitionsXml('<bpmn:task id="T" /><bpmn:fooBar id="J" />'));
    expect((await readDoc(lossy)).lossyImportWarnings.length).toBeGreaterThan(0);
    expect(await rejected(loadDoc(lossy))).toMatchObject({ code: 'E_IMPORT_LOSSY' });
    expect((await loadDoc(lossy, { force: true })).file).toBe(lossy);
  });

  it('mutateFile writes atomically, or elsewhere, or not at all, and backs up', async () => {
    const f = file('m.bpmn');
    const dry = await mutateFile(f, rename, { dryRun: true });
    expect(dry).toMatchObject({ written: false, file: f });
    expect(readFileSync(f, 'utf8')).toBe(LINEAR);
    const out = join(dir, 'sub', 'out.bpmn');
    expect(await mutateFile(f, rename, { out, show: true })).toMatchObject({ written: true, file: out, view: { file: out } });
    expect(readFileSync(out, 'utf8')).toContain('Renamed');
    expect(readFileSync(f, 'utf8')).toBe(LINEAR);
    const r = await mutateFile(f, rename, { backup: true });
    expect(r).toMatchObject({ written: true, file: f });
    expect(readFileSync(f, 'utf8')).toBe(r.xml);
    expect(readFileSync(`${f}.bak`, 'utf8')).toBe(LINEAR);
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('mutateDocToFile needs a target and refuses an existing one with mustNotExist (unless force)', async () => {
    expect(await rejected(mutateDocToFile(await Doc.fromXml(LINEAR), rename))).toMatchObject({ code: 'E_NO_FILE' });
    const target = file('exists.bpmn');
    expect(await rejected(mutateDocToFile(Doc.create({ processName: 'New' }, target), [], { mustNotExist: true }))).toMatchObject({ code: 'E_FILE_EXISTS' });
    expect(readFileSync(target, 'utf8')).toBe(LINEAR);
    expect(await mutateDocToFile(Doc.create({ processName: 'New' }, target), [], { mustNotExist: true, force: true })).toMatchObject({ written: true });
    const fresh = join(dir, 'fresh.bpmn');
    expect(await mutateDocToFile(Doc.create({ processName: 'New' }, fresh), [], { mustNotExist: true })).toMatchObject({ written: true, file: fresh });
    expect(existsSync(fresh)).toBe(true);
  });

  it('layoutFile and checkFile', async () => {
    const f = file('l.bpmn');
    expect(await rejected(layoutFile(join(dir, 'missing.bpmn'), { tidy: true, expand: [] }))).toMatchObject({ code: 'E_USAGE' });
    const r = await layoutFile(f);
    expect(r).toMatchObject({ written: true, layout: { mode: 'full' } });
    expect((await checkFile(f)).validation.errors).toEqual([]);
    await writeAtomic(f, LINEAR);
    expect(readFileSync(f, 'utf8')).toBe(LINEAR);
  });
});

describe('encodings: every write is UTF-8, and says so', () => {
  const latin1 = (name: string): string =>
    `<?xml version="1.0" encoding="ISO-8859-1"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start" name="${name}"/>
    <bpmn:task id="Task_CheckOrder" name="Check order"/>
  </bpmn:process>
</bpmn:definitions>
`;

  it('in memory: a changed result declares UTF-8 (with a note); a no-op keeps the input and its declaration', async () => {
    const xml = latin1('Größe');
    const r = await node.applyToXml(xml, [{ op: 'set', id: 'Task_CheckOrder', values: { name: 'Prüfung ß' } }], { layout: false });
    expect(r.xml.split('\n')[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    expect(r.xml).toContain('name="Prüfung ß"');
    expect(r.result.notes).toContain('the XML declaration named the encoding ISO-8859-1; the text is written as UTF-8, so it now says UTF-8');
    // only the declaration and the changed element differ
    expect(r.xml.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"').replace('Prüfung ß', 'Check order')).toBe(xml);
    const noop = await node.applyToXml(xml, [{ op: 'set', id: 'Task_CheckOrder', values: { name: 'Check order' } }], { layout: false });
    expect(noop.unchanged).toBe(true);
    expect(noop.xml).toBe(xml);
  });

  it('a file is read in the encoding it declares, so its characters survive a write (ISO-8859-1 bytes)', async () => {
    const f = join(dir, 'latin1.bpmn');
    writeFileSync(f, Buffer.from(latin1('Größe'), 'latin1'));
    expect(await readXml(f)).toBe(latin1('Größe'));
    expect((await readDoc(f)).get('Start')?.get('name')).toBe('Größe');
    const r = await mutateFile(f, [{ op: 'set', id: 'Task_CheckOrder', values: { name: 'Prüfung ß' } }], { layout: false });
    expect(r.written).toBe(true);
    const text = readFileSync(f, 'utf8');
    expect(text).toBe(latin1('Größe').replace('encoding="ISO-8859-1"', 'encoding="UTF-8"').replace('Check order', 'Prüfung ß'));
    // a no-op on the Latin-1 file is not written (the bytes stay)
    const g = join(dir, 'latin1-noop.bpmn');
    writeFileSync(g, Buffer.from(latin1('Größe'), 'latin1'));
    expect((await mutateFile(g, [{ op: 'set', id: 'Task_CheckOrder', values: { name: 'Check order' } }], { layout: false })).written).toBe(false);
    expect(readFileSync(g).equals(Buffer.from(latin1('Größe'), 'latin1'))).toBe(true);
  });

  it('UTF-8 bytes under an ISO-8859-1 declaration read as the declaration says; the write keeps those characters and declares UTF-8', async () => {
    const f = join(dir, 'mislabelled.bpmn');
    writeFileSync(f, latin1('Check'), 'utf8');
    await mutateFile(f, [{ op: 'set', id: 'Task_CheckOrder', values: { name: 'Prüfung ß' } }], { layout: false });
    const bytes = readFileSync(f);
    expect(bytes.toString('utf8').split('\n')[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    expect(bytes.includes(Buffer.from('Prüfung ß', 'utf8'))).toBe(true);
  });

  it('UTF-16 with a byte order mark and UTF-8 files read as before; an encoding nobody can decode is E_IO unless the file is ASCII', () => {
    const xml = latin1('Größe').replace('ISO-8859-1', 'UTF-16');
    expect(node.decodeXmlBytes(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]))).toBe(xml);
    const utf8 = `﻿${latin1('Größe').replace('ISO-8859-1', 'UTF-8')}`;
    expect(node.decodeXmlBytes(Buffer.from(utf8, 'utf8'))).toBe(utf8);
    const exotic = latin1('Size').replace('ISO-8859-1', 'X-NO-SUCH');
    expect(node.decodeXmlBytes(Buffer.from(exotic, 'latin1'))).toBe(exotic);
    let code = '';
    try {
      node.decodeXmlBytes(Buffer.from(latin1('Größe').replace('ISO-8859-1', 'X-NO-SUCH'), 'latin1'));
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe('E_IO');
  });
});
