import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BpmnFile } from '../../../src/cli/files/BpmnFile.js';

let folder: string;

const fileWith = (text: string) => new BpmnFile({ stdin: Readable.from([text]) });

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'bpmn-file-'));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('BpmnFile', () => {
  it('reads a file in the encoding it declares', async () => {
    const path = join(folder, 'latin.bpmn');
    writeFileSync(path, Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a>ä</a>', 'latin1'));

    expect(await fileWith('').read(path)).toContain('<a>ä</a>');
  });

  it('reads UTF-16 by its byte order mark', async () => {
    const path = join(folder, 'wide.bpmn');
    writeFileSync(path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<a/>', 'utf16le')]));

    expect(await fileWith('').read(path)).toBe('<a/>');
  });

  it('refuses an encoding it cannot decode, unless every byte is ASCII', async () => {
    const path = join(folder, 'odd.bpmn');
    writeFileSync(path, Buffer.from('<?xml version="1.0" encoding="no-such"?><a>ä</a>', 'latin1'));
    await expect(fileWith('').read(path)).rejects.toMatchObject({ code: 'E_IO' });

    writeFileSync(path, '<?xml version="1.0" encoding="no-such"?><a/>');
    expect(await fileWith('').read(path)).toContain('<a/>');
  });

  it('answers E_FILE_NOT_FOUND for a missing file', async () => {
    await expect(fileWith('').read(join(folder, 'gone.bpmn'))).rejects.toMatchObject({ code: 'E_FILE_NOT_FOUND' });
    await expect(fileWith('').read(folder)).rejects.toMatchObject({ code: 'E_IO' });
  });

  it('reads stdin once', async () => {
    const file = fileWith('<a/>');

    expect(await file.read('-')).toBe('<a/>');
    await expect(file.read('-')).rejects.toMatchObject({ code: 'E_USAGE' });
  });

  it('reads the operations from a file or from stdin, never both from stdin', async () => {
    const path = join(folder, 'ops.json');
    writeFileSync(path, '[]');

    expect(await fileWith('').readOperations(path, 'a.bpmn')).toBe('[]');
    expect(await fileWith('[1]').readOperations(undefined, 'a.bpmn')).toBe('[1]');
    await expect(fileWith('').readOperations('-', '-')).rejects.toMatchObject({ code: 'E_USAGE' });
    await expect(fileWith('').readOperations(join(folder, 'gone.json'), 'a.bpmn')).rejects.toMatchObject({ code: 'E_FILE_NOT_FOUND' });
  });

  it('writes through a staged file and leaves none behind when it fails', async () => {
    const path = join(folder, 'deep', 'a.bpmn');
    await fileWith('').write(path, 'x');

    expect(readFileSync(path, 'utf8')).toBe('x');
    await expect(fileWith('').write(folder, 'x')).rejects.toMatchObject({ code: 'E_IO' });
    expect(readdirSync(join(folder, '..')).filter((name) => name.endsWith('.tmp') && name.includes('bpmn-file'))).toEqual([]);
  });

  it('refuses a new file over one that exists', async () => {
    const path = join(folder, 'a.bpmn');
    await expect(fileWith('').assertNew(path)).resolves.toBeUndefined();
    writeFileSync(path, '');

    await expect(fileWith('').assertNew(path)).rejects.toMatchObject({ code: 'E_FILE_EXISTS' });
  });
});
