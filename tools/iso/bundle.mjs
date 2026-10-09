/**
 * The browser bundle of the core entry: the engine of the isomorphism check
 * (tools/iso/check.mjs in `npm run gate`, test/isomorphic.test.ts).
 *
 * Contract: `bundleCore(opts)` bundles one entry with esbuild for
 * platform=browser and resolves to
 *   { code, bytes, gzip, chunks, inputs, violations }
 * where `code` is the entry chunk, `bytes` / `gzip` the size of all chunks,
 * `chunks` [{ path, bytes, gzip, entry, imports, inputs }] one per output
 * file, `imports` the chunks it loads statically (one
 * without `splitting`), `inputs` the bundled source files
 * (repository-relative) and `violations` lists what would break in a
 * browser, each
 *   { kind: 'builtin', what, file, line }   an import of a Node builtin (node:fs, path, ...)
 *   { kind: 'global', what, file }          a free reference to a Node-only global
 * The bundle is not written. Two mechanisms:
 *  - platform=browser makes every import of a Node builtin a build error;
 *    those errors become `builtin` violations (with the importing file).
 *  - the Node-only globals (NODE_GLOBALS) are replaced by sentinels through
 *    esbuild's `define`, which only rewrites free references: a local
 *    variable named `process` or a property `o.process` stays. Every
 *    sentinel left in the output is a `global` violation, located by the
 *    module comment esbuild puts before each module (unminified build).
 *
 * Options: `entry` (file, default src/index.ts), or `stdin` ({ contents,
 * sourcefile }) for an entry text resolved from the repository root;
 * `minify` (default true); `format` ('esm' default, or 'iife' with
 * `globalName`); `splitting` (esm: dynamic imports become chunks of their
 * own, as a host's bundler would load them).
 */
import { build } from 'esbuild';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Globals a browser does not have (globalThis, setTimeout, TextEncoder, URL, ... are fine). */
export const NODE_GLOBALS = ['process', 'Buffer', 'global', 'require', '__dirname', '__filename', 'setImmediate', 'clearImmediate'];

const SENTINEL = '__ISO_NODE_GLOBAL_';

function esbuildOptions(opts, minify) {
  const define = Object.fromEntries(NODE_GLOBALS.map((g) => [g, `${SENTINEL}${g}`]));
  return {
    ...(opts.stdin ? { stdin: { loader: 'ts', resolveDir: ROOT, ...opts.stdin } } : { entryPoints: [join(ROOT, opts.entry ?? join('src', 'index.ts'))] }),
    bundle: true,
    platform: 'browser',
    format: opts.format ?? 'esm',
    ...(opts.globalName ? { globalName: opts.globalName } : {}),
    target: 'es2022',
    absWorkingDir: ROOT,
    ...(opts.splitting ? { splitting: true, outdir: join(ROOT, '.iso-out') } : {}),
    minify,
    define,
    write: false,
    metafile: true,
    logLevel: 'silent',
  };
}

/** The module comments (`// src/model.ts`) of an unminified bundle with their offsets. */
function moduleMarks(code) {
  const marks = [];
  for (const m of code.matchAll(/^\s*\/\/ (\S+\.(?:[cm]?[jt]s|json))$/gm)) marks.push({ at: m.index, file: m[1] });
  return marks;
}

function globalViolations(code) {
  const marks = moduleMarks(code);
  const seen = new Set();
  const out = [];
  for (const m of code.matchAll(new RegExp(`${SENTINEL}(\\w+)`, 'g'))) {
    const file = [...marks].reverse().find((k) => k.at < m.index)?.file ?? '?';
    const key = `${m[1]}|${file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: 'global', what: m[1], file });
  }
  return out;
}

export async function bundleCore(opts = {}) {
  const minify = opts.minify ?? true;
  let result;
  try {
    result = await build(esbuildOptions(opts, minify));
  } catch (err) {
    if (!err.errors) throw err;
    const violations = err.errors.map((e) => ({
      kind: /Could not resolve/.test(e.text) ? 'builtin' : 'error',
      what: (/"([^"]+)"/.exec(e.text) ?? [])[1] ?? e.text,
      file: e.location?.file ?? '?',
      line: e.location?.line,
      text: e.text,
    }));
    return { code: '', bytes: 0, gzip: 0, chunks: [], inputs: [], violations };
  }
  const chunks = result.outputFiles.map((f) => {
    const meta = result.metafile.outputs[relative(ROOT, f.path)] ?? Object.values(result.metafile.outputs)[0];
    // static imports load with the chunk, dynamic ones on demand
    const imports = (meta?.imports ?? []).filter((i) => i.kind === 'import-statement').map((i) => i.path);
    return { path: relative(ROOT, f.path), bytes: f.contents.length, gzip: gzipSync(f.contents).length, entry: !!meta?.entryPoint, imports, inputs: Object.keys(meta?.inputs ?? {}), text: f.text };
  });
  const entry = chunks.find((c) => c.entry) ?? chunks[0];
  // the sentinels are located in an unminified build (minified output has no module comments)
  const plain = minify ? (await build(esbuildOptions(opts, false))).outputFiles.map((f) => f.text) : chunks.map((c) => c.text);
  return {
    code: entry.text,
    bytes: chunks.reduce((n, c) => n + c.bytes, 0),
    gzip: chunks.reduce((n, c) => n + c.gzip, 0),
    chunks: chunks.map(({ text: _text, ...c }) => c),
    inputs: Object.keys(result.metafile.inputs),
    violations: plain.flatMap(globalViolations),
  };
}

/** `412.3 KB` */
export function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
