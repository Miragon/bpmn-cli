import type { Command as CommandType } from 'commander';

/**
 * Suggests the corrected command when an unknown option is really a positional
 * argument or a key=value pair (`add --kind userTask` -> `add <file> userTask`).
 */
export class PositionalHint {
  constructor(private readonly root: CommandType) {}

  /** The rewritten command, or undefined for any other unknown option. */
  of(args: string[]): string | undefined {
    const root = this.root;
    let cmd: CommandType | undefined = root;
    const path: string[] = [];
    let index = 0;
    // the (sub)command: ext add, ...
    while (index < args.length && !args[index]!.startsWith('-')) {
      const sub: CommandType | undefined = cmd.commands.find((command) => command.name() === args[index] || command.aliases().includes(args[index]!));
      if (!sub) break;
      cmd = sub;
      path.push(args[index]!);
      index++;
    }
    if (cmd === root || !cmd.registeredArguments.length) return undefined;
    const positional: string[] = [];
    const known: string[] = [];
    const unknown = new Map<string, string | undefined>();
    for (; index < args.length; index++) {
      const arg = args[index]!;
      if (!arg.startsWith('-') || arg === '-') {
        positional.push(arg);
        continue;
      }
      const [flag, inline] = arg.split(/=(.*)/s, 2) as [string, string | undefined];
      const opt = cmd.options.find((option) => option.long === flag || option.short === flag);
      if (opt) {
        known.push(arg);
        if (inline === undefined && (opt.required || opt.optional) && args[index + 1] !== undefined && !args[index + 1]!.startsWith('-')) known.push(args[++index]!);
        continue;
      }
      const value = inline ?? (args[index + 1] !== undefined && !args[index + 1]!.startsWith('-') ? args[++index] : undefined);
      unknown.set(flag.replace(/^-+/, ''), value);
    }
    // shell words of the rewritten command
    const out: string[] = [];
    const used: string[] = [];
    let pairs = 0;
    for (const arg of cmd.registeredArguments) {
      const name = arg.name();
      if (arg.variadic) {
        out.push(...positional.splice(0).map((word) => this.shellWord(word)));
        // key=value pairs (set, add): an unknown option with a value is a key
        for (const [flagName, flagValue] of unknown) {
          if (used.includes(flagName) || flagValue === undefined || !/keyValues/i.test(name)) continue;
          out.push(`${flagName}=${this.shellWord(flagValue)}`);
          used.push(flagName);
          pairs++;
        }
        continue;
      }
      if (positional.length) out.push(this.shellWord(positional.shift()!));
      else if (unknown.has(name)) {
        out.push(this.shellWord(unknown.get(name) ?? `<${name}>`));
        used.push(name);
      } else if (arg.required) out.push(`<${name}>`);
    }
    if (!used.length) return undefined;
    const usage = cmd.registeredArguments.map((argument) => (argument.required ? `<${argument.name()}>` : `[${argument.name()}${argument.variadic ? '...' : ''}]`)).join(' ');
    const flags = used.map((usedFlag) => `--${usedFlag}`);
    const listed = flags.length > 1 ? `${flags.slice(0, -1).join(', ')} and ${flags[flags.length - 1]}` : flags[0]!;
    return `${listed} ${flags.length > 1 ? 'are not options' : 'is not an option'} of \`bpmn ${path.join(' ')}\` (${usage}): write ${flags.length > 1 ? 'them' : 'it'} as ${!pairs ? (flags.length > 1 ? 'arguments' : 'an argument') : pairs === flags.length ? (flags.length > 1 ? 'key=value pairs' : 'a key=value pair') : 'arguments and key=value pairs'}: \`bpmn ${[...path.map((sentence) => this.shellWord(sentence)), ...out, ...known.map((sentence) => this.shellWord(sentence))].join(' ')}\`.`;
  }

  /** A word for the shell: as it is, or in double quotes. */
  private shellWord(word: string): string {
    return /^[A-Za-z0-9_.:\/=@$-]+$/.test(word) ? word : JSON.stringify(word);
  }
}
