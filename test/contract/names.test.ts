import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { CliProgram } from '../../src/cli/CliProgram.js';
import { HelpTopics } from '../../src/cli/help/HelpTopics.js';
import * as contract from '../../src/index.js';
import { designIqCalls, onRebuild } from '../../tools/oracle/design-iq-map.mjs';

interface Names {
  flagsOf: Map<string, Set<string>>;
  anyFlag: Set<string>;
}

const CORPUS = join(import.meta.dirname, '..', '..', 'corpus');
const COMMAND = /(?:^|[`(\s])bpmn ([a-z]+)(?: (add|remove))?([^`\n]*)/gm;
const FLAG = /(?<![\w-])--[a-z][a-z-]*/g;
const PROGRAM_FLAGS = ['--help', '--version'];

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

async function hintsOfRefusedCall(call: Parameters<typeof onRebuild>[1]): Promise<string[]> {
  const hints: string[] = [];
  const applyToXml: typeof contract.applyToXml = (...input) => contract.applyToXml(...input).catch((error: unknown) => {
    hints.push(...hintOfRefusal(error));
    throw error;
  });
  await onRebuild({ ...contract, applyToXml }, call);
  return hints;
}

describe('the names of the guide and the hints', () => {
  const names = namesOfTheCli();

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

  it('names in the hints of the corpus only commands and flags that exist', async () => {
    const hints = (await Promise.all(modelsIn(CORPUS).map(hintsOfValidation))).flat();

    expect(hints.length).toBeGreaterThan(1000);
    expect([...new Set(hints.flatMap((hint) => unknownNames(hint, names)))]).toEqual([]);
  }, 120000);

  it("names in the refusals of design-iq's calls only commands and flags that exist", async () => {
    const hints = (await Promise.all(designIqCalls().map(({ call }) => hintsOfRefusedCall(call)))).flat();

    expect(hints.length).toBeGreaterThan(0);
    expect([...new Set(hints.flatMap((hint) => unknownNames(hint, names)))]).toEqual([]);
  });
});
