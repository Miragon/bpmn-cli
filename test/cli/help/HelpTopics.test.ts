import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HelpTopics } from '../../../src/cli/help/HelpTopics.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const { guideKilobytes } = JSON.parse(readFileSync(join(ROOT, 'budgets.json'), 'utf8'));

function refusalOf(topic: string): unknown {
  try {
    return HelpTopics.text([topic]);
  } catch (error) {
    return error;
  }
}

describe('HelpTopics', () => {
  it('prints the core without a topic, and it lists every topic', () => {
    const core = HelpTopics.text([]);

    expect(core).toMatch(/^# bpmn\n/);
    expect(core.match(/Topics, .*: (.*)\./)?.[1]?.split(', ')).toEqual(HelpTopics.names());
  });

  it.each(HelpTopics.names())('prints the topic %s with a heading', (topic) => {
    expect(HelpTopics.text([topic])).toMatch(/^# /);
  });

  it('prints several topics in the order they are asked for', () => {
    const text = HelpTopics.text(['quoting', 'kinds']);

    expect(text).toMatch(/^# Quoting\n/);
    expect(text.indexOf('# Kinds')).toBeGreaterThan(0);
  });

  it('finds a topic whatever its case and dashes', () => {
    expect(HelpTopics.text(['setKeys'])).toBe(HelpTopics.text(['set-keys']));
  });

  it('refuses an unknown topic and lists the topics', () => {
    expect(refusalOf('kind-table')).toMatchObject({ code: 'E_USAGE', details: { candidates: HelpTopics.names() } });
  });

  it('keeps the whole guide within its budget', () => {
    const whole = [HelpTopics.text([]), HelpTopics.text(HelpTopics.names())].join('');

    expect(Buffer.byteLength(whole)).toBeLessThan(guideKilobytes * 1000);
  });

  it('holds the tables the catalogues write', () => {
    const { status, stderr } = spawnSync(process.execPath, ['tools/build-help.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });

    expect(stderr).toBe('');
    expect(status).toBe(0);
  });
});
