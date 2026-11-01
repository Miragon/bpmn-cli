import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const ARCHITECTURE = readFileSync(join(ROOT, 'docs', 'architecture.md'), 'utf8');
const GENERAL_SECTIONS = new Set(['Layers', 'One write', 'Who finds what']);
const SHAPE = ['Does', 'Holds', 'Why', 'Does not'];
const CLASS = /^(?:export )?(?:abstract )?class (\w+)/gm;
const DECLARED = /^(?:export )?(?:abstract )?(?:class|interface|type) (\w+)/gm;
const NAME = /`([A-Z][A-Za-z0-9]*)`/g;
const SECTION = /^## (.+)$/gm;

function foldersOf(parent: string): string[] {
  return readdirSync(join(ROOT, parent)).filter((name) => statSync(join(ROOT, parent, name)).isDirectory());
}

function moduleSources(): Map<string, string> {
  const modules = foldersOf('src').map((name): [string, string] => [name, join('src', name)]);
  const packages = foldersOf('packages').map((name): [string, string] => [`packages/${name}`, join('packages', name, 'src')]);
  return new Map([...modules, ...packages]);
}

function sourcesIn(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      return sourcesIn(path);
    }
    return path.endsWith('.ts') ? [readFileSync(path, 'utf8')] : [];
  });
}

function namesIn(sources: readonly string[], pattern: RegExp): Set<string> {
  return new Set(sources.flatMap((source) => [...source.matchAll(pattern)].map(([, name]) => name!)));
}

function sectionsOf(text: string): Map<string, string> {
  const headings = [...text.matchAll(SECTION)];
  return new Map(headings.map((heading, index) => [heading[1]!, text.slice(heading.index, headings[index + 1]?.index)]));
}

function namedIn(text: string): string[] {
  return [...text.matchAll(NAME)].map(([, name]) => name!);
}

function problemsOfSection(module: string, section: string, classes: ReadonlySet<string>): string[] {
  const lines = section.split('\n');
  const missing = SHAPE.filter((word) => !lines.some((line) => line.startsWith(`- ${word}: `))).map((word) => `${module} lacks "${word}"`);
  const held = lines.find((line) => line.startsWith('- Holds: ')) ?? '';
  const unknown = namedIn(held).filter((name) => !classes.has(name)).map((name) => `${module} names ${name}, no class of it`);
  return [...missing, ...unknown];
}

function problemsOf(text: string): string[] {
  const sources = moduleSources();
  const sections = sectionsOf(text);
  const declared = namesIn([...sources.values()].flatMap((folder) => sourcesIn(join(ROOT, folder))), DECLARED);
  const missing = [...sources.keys()].filter((module) => !sections.has(module)).map((module) => `${module} has no section`);
  const strangers = [...sections.keys()].filter((heading) => !sources.has(heading) && !GENERAL_SECTIONS.has(heading)).map((heading) => `${heading} is no module`);
  const modules = [...sources].flatMap(([module, folder]) => problemsOfSection(module, sections.get(module) ?? '', namesIn(sourcesIn(join(ROOT, folder)), CLASS)));
  const unknown = namedIn(text).filter((name) => !declared.has(name)).map((name) => `${name} is declared nowhere`);
  return [...missing, ...strangers, ...modules, ...new Set(unknown)];
}

describe('the architecture doc', () => {
  it('has a section in the fixed shape for every module and package, and names only what exists', () => {
    expect(problemsOf(ARCHITECTURE)).toEqual([]);
  });

  it('fails when a module has no section', () => {
    expect(problemsOf(ARCHITECTURE.replace('## scoring', '## judging'))).toEqual(expect.arrayContaining(['scoring has no section', 'judging is no module']));
  });

  it('fails when a section names a class its module does not hold', () => {
    expect(problemsOf(ARCHITECTURE.replace('- Holds: `Scorer`', '- Holds: `Judge`, `FullLayout`'))).toEqual(expect.arrayContaining(['scoring names Judge, no class of it', 'scoring names FullLayout, no class of it', 'Judge is declared nowhere']));
  });

  it('fails when a section loses a line of the shape', () => {
    expect(problemsOf(ARCHITECTURE.replace('- Does not: draw, check or edit.\n', ''))).toContain('model lacks "Does not"');
  });
});
