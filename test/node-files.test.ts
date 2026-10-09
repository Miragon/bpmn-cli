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
