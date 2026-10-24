import type { Command as CommandType } from 'commander';

export class PositionalHint {
  constructor(private readonly root: CommandType) {}

  /**
   * The command rewritten when an unknown option is one of its positional
   * arguments (`add --kind userTask --name X`: `add <file> userTask X`) or,
   * for a command that takes key=value pairs, a key (`set <id> --name X`:
   * `set <file> <id> name=X`); undefined for any other unknown option.
   */
  of(args: string[]): string | undefined {
    const root = this.root;
    let cmd: CommandType | undefined = root;
    const path: string[] = [];
    let i = 0;
    // the (sub)command: ext add, ...
    while (i < args.length && !args[i]!.startsWith('-')) {
      const sub: CommandType | undefined = cmd.commands.find((c) => c.name() === args[i] || c.aliases().includes(args[i]!));
      if (!sub) break;
      cmd = sub;
      path.push(args[i]!);
      i++;
    }
    if (cmd === root || !cmd.registeredArguments.length) return undefined;
    const positional: string[] = [];
    const known: string[] = [];
    const unknown = new Map<string, string | undefined>();
    for (; i < args.length; i++) {
      const a = args[i]!;
      if (!a.startsWith('-') || a === '-') {
        positional.push(a);
        continue;
      }
      const [flag, inline] = a.split(/=(.*)/s, 2) as [string, string | undefined];
      const opt = cmd.options.find((o) => o.long === flag || o.short === flag);
      if (opt) {
        known.push(a);
        if (inline === undefined && (opt.required || opt.optional) && args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) known.push(args[++i]!);
        continue;
      }
      const value = inline ?? (args[i + 1] !== undefined && !args[i + 1]!.startsWith('-') ? args[++i] : undefined);
      unknown.set(flag.replace(/^-+/, ''), value);
    }
    // shell words of the rewritten command
    const out: string[] = [];
    const used: string[] = [];
    let pairs = 0;
    for (const arg of cmd.registeredArguments) {
      const name = arg.name();
      if (arg.variadic) {
        out.push(...positional.splice(0).map((s) => this.shellWord(s)));
        // key=value pairs (set, add): an unknown option with a value is a key
        for (const [k, v] of unknown) {
          if (used.includes(k) || v === undefined || !/keyValues/i.test(name)) continue;
          out.push(`${k}=${this.shellWord(v)}`);
          used.push(k);
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
    const usage = cmd.registeredArguments.map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}${a.variadic ? '...' : ''}]`)).join(' ');
    const flags = used.map((u) => `--${u}`);
    const listed = flags.length > 1 ? `${flags.slice(0, -1).join(', ')} and ${flags[flags.length - 1]}` : flags[0]!;
    return `${listed} ${flags.length > 1 ? 'are not options' : 'is not an option'} of \`bpmn ${path.join(' ')}\` (${usage}): write ${flags.length > 1 ? 'them' : 'it'} as ${!pairs ? (flags.length > 1 ? 'arguments' : 'an argument') : pairs === flags.length ? (flags.length > 1 ? 'key=value pairs' : 'a key=value pair') : 'arguments and key=value pairs'}: \`bpmn ${[...path.map((s) => this.shellWord(s)), ...out, ...known.map((s) => this.shellWord(s))].join(' ')}\`.`;
  }

  /** A word for the shell: as it is, or in double quotes. */
  private shellWord(s: string): string {
    return /^[A-Za-z0-9_.:\/=@$-]+$/.test(s) ? s : JSON.stringify(s);
  }
}
