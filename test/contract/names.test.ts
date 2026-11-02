import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { CliProgram } from '../../src/cli/CliProgram.js';
import { HelpTopics } from '../../src/cli/help/HelpTopics.js';
import * as contract from '../../src/index.js';

interface Names {
  flagsOf: Map<string, Set<string>>;
  anyFlag: Set<string>;
}

const CORPUS = join(import.meta.dirname, '..', '..', 'corpus');
const SKILL = join(import.meta.dirname, '..', '..', 'plugins', 'bpmn-cli', 'skills', 'bpmn');
const COMMAND = /(?:^|[`(\s])bpmn ([a-z]+)(?: (add|remove))?([^`\n]*)/gm;
const FLAG = /(?<![\w-])--[a-z][a-z-]*/g;
const PROGRAM_FLAGS = ['--help', '--version'];
const SOURCES = join(import.meta.dirname, '..', '..', 'src');
const HINT = /\bhint: (?:'([^'\n]*)'|`([^`\n]*)`|"([^"\n]*)")/g;
const TEMPLATE_VALUE = /\$\{[^}]*\}/g;
const TYPE_NAME = /(?<![=:\w])[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g;

function namesOfTheCli(): Names {
  const { stdout, stderr, stdin, env } = process;
  const { commander } = new CliProgram({ stdout, stderr, stdin, env }, '0');
  const leaves: Array<[string, Command]> = commander.commands.flatMap((command) => (command.commands.length > 0 ? command.commands.map((child): [string, Command] => [`${command.name()} ${child.name()}`, child]) : [[command.name(), command]]));
  const flagsOf = new Map(leaves.map(([name, command]) => [name, new Set([...PROGRAM_FLAGS, ...command.options.flatMap(({ long }) => long ?? [])])]));
  return { flagsOf, anyFlag: new Set([...flagsOf.values()].flatMap((flags) => [...flags])) };
}

function unknownNames(text: string, { flagsOf, anyFlag }: Names): string[] {
  const unknown: string[] = [];
  const withoutCommands = text.replace(COMMAND, (_line, word: string, subcommand: string | undefined, rest: string) => {
    const name = word === 'ext' ? `ext ${subcommand}` : word;
    const flags = flagsOf.get(name);
    if (!flags) {
      unknown.push(`bpmn ${name}`);
    }
    unknown.push(...[...rest.matchAll(FLAG)].map(([flag]) => flag).filter((flag) => flags && !flags.has(flag)).map((flag) => `bpmn ${name} ${flag}`));
    return ' ';
  });
  return [...unknown, ...[...withoutCommands.matchAll(FLAG)].map(([flag]) => flag).filter((flag) => !anyFlag.has(flag))];
}

function skillText(): string {
  const reference = join(SKILL, 'reference');
  const files = [join(SKILL, 'SKILL.md'), ...readdirSync(reference).map((name) => join(reference, name))];
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

function modelsIn(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      return modelsIn(path);
    }
    return path.endsWith('.bpmn') ? [path] : [];
  });
}

async function hintsOfValidation(path: string): Promise<string[]> {
  try {
    const { findings } = await contract.validateXml(readFileSync(path, 'utf8'));
    return findings.flatMap(({ hint }) => hint ?? []);
  } catch (error) {
    return hintOfRefusal(error);
  }
}

function hintOfRefusal(error: unknown): string[] {
  const { message, details } = error as { message: string; details?: { hint?: string } };
  return [message, ...(details?.hint ? [details.hint] : [])];
}

function filesBelow(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

function typeNamesInHints(): string[] {
  const sources = filesBelow(SOURCES).filter((path) => path.endsWith('.ts')).map((path) => readFileSync(path, 'utf8'));
  const hints = sources.flatMap((source) => [...source.matchAll(HINT)].map(([, single, tick, double]) => (single ?? tick ?? double)!.replace(TEMPLATE_VALUE, '')));
  return [...new Set(hints.flatMap((hint) => [...hint.matchAll(TYPE_NAME)].map(([word]) => word)))];
}

describe('the names of the guide and the hints', () => {
  const names = namesOfTheCli();

  it('names no type of the code in a hint', () => {
    expect(typeNamesInHints()).toEqual([]);
  });

  it('knows the 26 commands', () => {
    expect(names.flagsOf.size).toBe(26);
  });

  it('finds an unknown command, a flag of another command and a retired flag', () => {
    const text = '`bpmn metrics <file>` `bpmn show <file> --color red` and --no-bridge';

    expect(unknownNames(text, names).sort()).toEqual(['--no-bridge', 'bpmn metrics', 'bpmn show --color']);
  });

  it('names in the guide only commands and flags that exist', () => {
    const guide = HelpTopics.text([]) + HelpTopics.text(HelpTopics.names());

    expect(unknownNames(guide.replaceAll('bpmn <command>', ''), names)).toEqual([]);
  });

  it('names in the skill only commands and flags that exist', () => {
    expect(unknownNames(skillText().replaceAll('bpmn <command>', ''), names)).toEqual([]);
  });

  it('names in the hints of the corpus only commands and flags that exist', async () => {
    const hints = (await Promise.all(modelsIn(CORPUS).map(hintsOfValidation))).flat();

    expect(hints.length).toBeGreaterThan(1000);
    expect([...new Set(hints.flatMap((hint) => unknownNames(hint, names)))]).toEqual([]);
  }, 120000);
});
