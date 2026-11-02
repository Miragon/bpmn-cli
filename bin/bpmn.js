#!/usr/bin/env node
import { Cli } from '../dist/cli.js';

process.exitCode = await new Cli(process).run(process.argv.slice(2));
