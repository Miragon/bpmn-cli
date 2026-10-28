/** How a hint writes a `bpmn` command line. */
export class Shell {
  /** Quotes a shell argument when the shell would interpret it (a `<placeholder>` stays as it is). */
  static quote(argument: string): string {
    return /^[A-Za-z0-9_.:=,/@+-]*(<[a-zA-Z]+>)?$/.test(argument) ? argument : `'${argument.replace(/'/g, `'\\''`)}'`;
  }

  /** `<slot><first argument>` shell-quoted (`'definition[1].camunda:field'`), the rest as is. */
  static slotted(slot: string, args: string): string {
    const space = args.indexOf(' ');
    return space === -1 ? Shell.quote(`${slot}${args}`) : `${Shell.quote(`${slot}${args.slice(0, space)}`)}${args.slice(space)}`;
  }
}
