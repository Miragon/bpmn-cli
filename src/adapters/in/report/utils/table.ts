export function table(rows: string[][], indent = '  '): string {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, column) => (widths[column] = Math.max(widths[column] ?? 0, cell.length)));
  return rows
    .map((row) => indent + row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0))).join('  ').trimEnd())
    .join('\n');
}

export function heading(title: string): string {
  return `\n${title}\n${'-'.repeat(title.length)}`;
}
