#!/usr/bin/env node
/**
 * `bpmn`: the bootstrap of the command line interface (src/commands/Cli.ts).
 * It maps BPMN_LAYOUT_DEBUG to LayoutDebug.setProcessSink, runs the command
 * line and exits with the code the command set.
 */
import { readFileSync } from 'node:fs';
import { Cli } from './commands/Cli.js';
import { LayoutDebug } from './shared/LayoutDebug.js';

/** The package version (dist/cli.js and src/cli.ts both sit one level below package.json). */
const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

// placement candidates, reroute reasons, [strip] / [rows] lines of the layout engines
if (process.env['BPMN_LAYOUT_DEBUG']) LayoutDebug.setProcessSink((line) => process.stderr.write(`${line}\n`));

// a reader that closes early (`bpmn validate x.bpmn | head`) ends the output, not the command: no EPIPE trace, the exit code stays
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err;
  });
}

/**
 * The end of every command: exit with the code it set (process.exitCode)
 * once stdout and stderr took what was written. Not right away (that cut
 * off a pipe beyond 64 KB on macOS), and not when the event loop runs dry
 * (a timer a project plugin left would keep the process alive).
 */
function exitWhenWritten(): void {
  process.stdout.write('', () => process.stderr.write('', () => process.exit()));
}

const cli = new Cli(VERSION);
void cli.run(process.argv).then(() => {
  process.exitCode = cli.exitCode;
  exitWhenWritten();
});
