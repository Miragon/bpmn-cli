export class ShellWords {
  private static readonly PLAIN = /^[A-Za-z0-9_.:=,/@+-]*(<[a-zA-Z]+>)?$/;

  static quote(word: string): string {
    return ShellWords.PLAIN.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
  }

  static slotted(slot: string, words: string): string {
    const space = words.indexOf(' ');
    return space === -1 ? ShellWords.quote(`${slot}${words}`) : `${ShellWords.quote(`${slot}${words.slice(0, space)}`)}${words.slice(space)}`;
  }
}
