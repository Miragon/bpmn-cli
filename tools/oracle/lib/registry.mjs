import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ORACLE_DIR } from './paths.mjs';

export function modulesIn(folder) {
  const dir = join(ORACLE_DIR, folder);
  return readdirSync(dir).filter((name) => name.endsWith('.mjs')).sort().map((name) => join(dir, name));
}

export async function loadModule(file) {
  const { default: definition } = await import(pathToFileURL(file).href);
  return { ...definition, file, name: definition.name ?? basename(file, '.mjs') };
}

export async function loadModules(folder, picked) {
  const modules = await Promise.all(modulesIn(folder).map(loadModule));
  if (!picked) {
    return modules;
  }
  const unknown = picked.filter((name) => !modules.some((module) => module.name === name));
  if (unknown.length) {
    throw new Error(`no ${unknown.join(', ')} in tools/oracle/${folder}`);
  }
  return modules.filter((module) => picked.includes(module.name));
}
