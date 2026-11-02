import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { bundlesOf } from '../build/bundles.mjs';

const CLI_PROGRAM = 'src/cli/CliProgram.ts';
const MEASURED_CLI_OUTPUT = 'node_modules/.cache/bpmn-budgets';
const RECORDED = ['commands', 'flagSlots'];

/**
 * Commands and flags are the CLI's surface for people and agents.
 * Each new one makes the CLI harder to learn, so their number is capped.
 */
export class CliSize {
  constructor(root, budgets) {
    this.root = root;
    this.budgets = budgets;
  }

  async run() {
    const missing = RECORDED.filter((budget) => this.budgets[budget] === undefined).map((budget) => `budgets.json lacks ${budget}`);
    const measured = await this.measure();
    const over = Object.entries(measured).filter(([budget, count]) => count > this.budgets[budget]);
    const problems = [...missing, ...over.map(([budget, count]) => `the CLI has ${count} ${budget}, over its budget of ${this.budgets[budget]}`)];
    return { problems, summary: `${measured.commands} commands, ${measured.flagSlots} flag slots` };
  }

  async measure() {
    if (!existsSync(join(this.root, CLI_PROGRAM))) {
      return { commands: 0, flagSlots: 0 };
    }
    const commands = await this.leafCommands();
    return { commands: commands.length, flagSlots: commands.reduce((sum, { options }) => sum + options.length, 0) };
  }

  async leafCommands() {
    const output = join(this.root, MEASURED_CLI_OUTPUT);
    await build({ ...bundlesOf(this.root).cli, entryPoints: { program: CLI_PROGRAM }, outdir: output });
    const { CliProgram } = await import(pathToFileURL(join(output, 'program.js')).href);
    const silent = { write: () => true };
    const { commander } = new CliProgram({ stdout: silent, stderr: silent, stdin: [], env: {} }, '0');
    rmSync(output, { recursive: true, force: true });
    return this.leavesOf(commander);
  }

  leavesOf(command) {
    return command.commands.length ? command.commands.flatMap((child) => this.leavesOf(child)) : [command];
  }
}
