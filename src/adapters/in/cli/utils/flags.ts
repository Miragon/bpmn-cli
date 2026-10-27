import { extname } from 'node:path';
import { InvalidArgumentError } from 'commander';
import type { ImageFormat } from '../../../../application/port/out/WriteImagePort.js';
import { CliError } from '../../../../domain/document/CliError.js';
import { usageError } from '../../../../domain/document/utils/errors.js';

export function parseKeyValues(items: string[], what = 'property'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    const idx = item.indexOf('=');
    if (idx <= 0) throw new CliError('E_USAGE', `Expected ${what} as key=value, got "${item}"`, 'usage');
    out[item.slice(0, idx).trim()] = item.slice(idx + 1);
  }
  return out;
}

export function givenStrings<TKey extends string>(options: Record<string, unknown>, keys: readonly TKey[]): Partial<Record<TKey, string>> {
  const out: Partial<Record<TKey, string>> = {};
  for (const key of keys) if (options[key]) out[key] = String(options[key]);
  return out;
}

export function givenFlags<TKey extends string>(options: Record<string, unknown>, keys: readonly TKey[]): Partial<Record<TKey, true>> {
  const out: Partial<Record<TKey, true>> = {};
  for (const key of keys) if (options[key]) out[key] = true;
  return out;
}

export function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function depthArg(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new InvalidArgumentError('expected a whole number >= 0');
  return Number(raw);
}

export function assertPathFlags(path: string[] | undefined, via: unknown, hints: { path: string; via?: string }): void {
  if (path && path.length !== 2) throw usageError(`--path takes exactly two ids (from and to), got ${path.length}`, { hint: hints.path });
  if (via && !path) throw usageError('--via needs --path', hints.via !== undefined ? { hint: hints.via } : {});
}

export const RENDER_FORMATS: readonly ImageFormat[] = ['png', 'svg'];

/**
 * --format, else the -o extension (.png / .svg), else png. E_USAGE when the extension
 * contradicts --format, or an -o name lacks .png / .svg and no --format says what to write.
 */
export function renderFormat(format: string | undefined, out: string | undefined): ImageFormat {
  const ext = out && out !== '-' ? extname(out).slice(1).toLowerCase() : '';
  const fromExt = (RENDER_FORMATS as readonly string[]).includes(ext) ? (ext as ImageFormat) : undefined;
  if (format !== undefined && fromExt && format !== fromExt) {
    throw usageError(`--format ${format} does not match the file name ${out}`, { hint: `Drop --format (the extension decides) or name the file .${format}.` });
  }
  if (format === undefined && out && out !== '-' && !fromExt) {
    throw usageError(`-o ${out}: expected a file name ending in .png or .svg (the image formats render writes)`, { hint: `Name the file .png or .svg, or pass --format png|svg to write that format under this name.` });
  }
  return (format as ImageFormat | undefined) ?? fromExt ?? 'png';
}

/** --render <file>: a .png or .svg file (the extension decides the format). */
export function renderTarget(raw: string): string {
  if (raw === '-' || !/\.(png|svg)$/i.test(raw)) throw new InvalidArgumentError('expected a file name ending in .png or .svg (the image of the result; the XML or the report owns stdout)');
  return raw;
}
