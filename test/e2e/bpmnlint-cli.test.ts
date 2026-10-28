/**
 * The project's bpmnlint configuration (issue #33) through the CLI: a build of src/ under
 * plain node (it loads bpmnlint and the plugin as the published package
 * does; vitest's module loader would hide a load failure), built into a
 * temporary directory of its own.
 *
 * Every case builds a repository of its own in a temporary directory (a .git
 * directory, a .bpmnlintrc, models). test/helpers/global-setup.ts makes sure no
 * .bpmnlintrc above the temporary directory changes them.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../../src/api.js';
import { ROOT, top, repo, plugin, model, LINE } from '../helpers/bpmnlint.js';

describe('the CLI under plain node (src/ built into a temporary directory)', () => {
  let cli: string;
  let build: string;
  beforeAll(() => {
    // tsc into a directory of its own (cli.test.ts rebuilds dist/ concurrently), next to package.json and node_modules like an install
    build = join(top, 'cli');
    mkdirSync(build, { recursive: true });
    execFileSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(ROOT, 'tsconfig.json'), '--outDir', join(build, 'dist'), '--declaration', 'false', '--sourceMap', 'false'], { cwd: ROOT, stdio: 'inherit' });
    writeFileSync(join(build, 'package.json'), readFileSync(join(ROOT, 'package.json')));
    symlinkSync(join(ROOT, 'node_modules'), join(build, 'node_modules'));
    cli = join(build, 'dist', 'cli.js');
  }, 120000);

  const bpmn = (cwd: string, args: string[], input?: string, bin = cli) => {
    const spawned = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', input: input ?? '' });
    return { code: spawned.status ?? -1, out: spawned.stdout, err: spawned.stderr };
  };

  it('validate runs the .bpmnlintrc (exit 2 on its errors); --no-lint-config and --lint-config; stdin from the working directory; JSON', async () => {
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'models/x.bpmn': xml, 'lint/strict.json': JSON.stringify({ rules: { 'label-required': 'warn' } }) });
    const validated = bpmn(dir, ['validate', 'models/x.bpmn']);
    expect(validated.code, validated.err).toBe(2);
    expect(validated.out).toContain('[bpmnlint error] label-required Activity_AfterCheck: Element is missing label/name\n');
    expect(validated.out).toContain('validator bpmnlint (.bpmnlintrc in .): 1 error(s), 0 warning(s) in the file\n');
    const off = bpmn(dir, ['validate', 'models/x.bpmn', '--no-lint-config']);
    expect(off.code).toBe(0);
    expect(off.out).not.toContain('bpmnlint');
    const other = bpmn(join(dir, 'models'), ['validate', 'x.bpmn', '--lint-config', '../lint/strict.json']);
    expect(other.code).toBe(0);
    expect(other.out).toContain('validator bpmnlint (--lint-config ../lint/strict.json): 0 error(s), 1 warning(s) in the file\n');
    // a rule set to warn: no severity in the tag
    expect(other.out).toContain('[bpmnlint] label-required Activity_AfterCheck: Element is missing label/name\n');
    const stdin = bpmn(dir, ['validate', '-'], xml);
    expect(stdin.code).toBe(2);
    expect(stdin.out).toContain('[bpmnlint error] label-required Activity_AfterCheck');
    const json = JSON.parse(bpmn(dir, ['validate', 'models/x.bpmn', '--json']).out);
    expect(json.validators[0]).toMatchObject({ name: 'bpmnlint', detail: '.bpmnlintrc in .', blocks: false, counts: { errors: 1, warnings: 0 } });
    expect(json.errors).toContainEqual({ code: 'label-required', message: 'Element is missing label/name', element: 'Activity_AfterCheck', validator: 'bpmnlint', severity: 'error' });
    const missing = bpmn(dir, ['validate', 'models/x.bpmn', '--lint-config', 'nope.json']);
    expect(missing.code).toBe(4);
    expect(missing.err).toMatch(/^error E_LINT_CONFIG: /);
  });

  // a CI `container:` job, `docker run -v`: root over a checkout of another uid (simulated: a preload makes process.getuid() 0)
  it.skipIf(!process.getuid || process.getuid() === 0)('root over a checkout of another uid: the .bpmnlintrc at the repository root runs with bpmn-cli\'s rules (exit 2 on an error rule), the project plugin is left out and named', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }, { 'models/x.bpmn': await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]) });
    const marker = join(dir, 'RAN.txt');
    plugin(dir, 'bpmnlint-plugin-evil', { main: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` });
    const asRoot = join(top, 'as-root.cjs');
    writeFileSync(asRoot, 'process.getuid = () => 0; delete process.env.SUDO_UID;\n');
    const spawned = spawnSync(process.execPath, ['--require', asRoot, cli, 'validate', 'x.bpmn'], { cwd: join(dir, 'models'), encoding: 'utf8', input: '' });
    expect(spawned.status, spawned.stderr).toBe(2);
    expect(spawned.stdout).toContain('[bpmnlint error] label-required Activity_AfterCheck: Element is missing label/name\n');
    expect(spawned.stdout).toContain("[bpmnlint] W_LINT_UNAVAILABLE: plugin:evil/recommended left out: bpmnlint-plugin-evil is not bundled with bpmn-cli, and bpmn-cli runs project plugins only in a repository of the user running it (the repository of ../.git belongs to another user)  (Check who created that repository and its .git; run bpmn-cli as its owner (git's safe.directory does not change this), or remove the plugin from the configuration; --no-lint-config skips bpmnlint.)\n");
    expect(spawned.stdout).toContain('validator bpmnlint (.bpmnlintrc in ..; 1 left out (W_LINT_UNAVAILABLE; bpmn validate lists it)): 1 error(s), 1 warning(s) in the file\n');
    expect(existsSync(marker)).toBe(false);
    // as the checkout's owner the plugin runs
    const own = bpmn(join(dir, 'models'), ['validate', 'x.bpmn']);
    expect(own.code, own.err).toBe(2);
    expect(own.out).not.toContain('W_LINT_UNAVAILABLE');
    expect(existsSync(marker)).toBe(true);
  });

  it('a write exits 0 and lists the findings it added (5 with --strict); the hint and the validator line name the file relative to the working directory', async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'models/x.bpmn': await model(LINE) });
    const add = bpmn(join(dir, 'models'), ['add', 'x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run']);
    expect(add.code, add.err).toBe(0);
    expect(add.out).toContain('warning [bpmnlint error] label-required Activity_AfterCheck: Element is missing label/name\n');
    expect(add.out).toContain('validator bpmnlint (.bpmnlintrc in ..): 1 error(s), 0 warning(s) in the result (1 added, 0 resolved, 0 already in the file)\n');
    expect(bpmn(join(dir, 'models'), ['add', 'x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run', '--strict']).code).toBe(5);
    const summary = bpmn(dir, ['add', 'models/x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run', '--summary']);
    expect(summary.out).toContain('warning [bpmnlint error] label-required Activity_AfterCheck: Element is missing label/name\n');
  });

  it('JSON beyond 64 KB reaches a pipe whole with exit 2 and 5 (validate, --strict, a write with --strict): the exit code does not cut it off', async () => {
    // a rule that reports 300 long findings on each task
    const many = `module.exports = () => ({ check(node, reporter) { if (/Task$/.test(node.$type)) for (let i = 0; i < 300; i++) reporter.report(node.id, 'a long finding ' + 'x'.repeat(200) + ' ' + i); } });`;
    const dir = repo({ rules: { 'big/many': 'error' } }, { 'x.bpmn': await model(LINE), 'lint/warn.json': JSON.stringify({ rules: { 'big/many': 'warn' } }) });
    plugin(dir, 'bpmnlint-plugin-big', { rules: { many } });
    const piped = (args: string[], code: number) => {
      const cliRun = bpmn(dir, args);
      expect(cliRun.code, cliRun.err).toBe(code);
      expect(cliRun.out.length, args.join(' ')).toBeGreaterThan(65536);
      return JSON.parse(cliRun.out) as { errors?: unknown[]; warnings?: unknown };
    };
    expect(piped(['validate', 'x.bpmn', '--json'], 2).errors).toHaveLength(300);
    piped(['validate', 'x.bpmn', '--json', '--strict', '--lint-config', 'lint/warn.json'], 5);
    piped(['add', 'x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run', '--json', '--strict'], 5);
    // a reader that closes after the first chunk (`| head`): the exit code stays, no EPIPE trace on stderr
    const early = (args: string[]) =>
      new Promise<{ code: number | null; err: string }>((done) => {
        const child = spawn(process.execPath, [cli, ...args], { cwd: dir });
        let err = '';
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
        child.stdout.once('data', () => child.stdout.destroy());
        child.on('close', (code) => done({ code, err }));
      });
    expect(await early(['validate', 'x.bpmn', '--json'])).toEqual({ code: 2, err: '' });
    expect(await early(['validate', 'x.bpmn'])).toEqual({ code: 2, err: '' });
    expect(await early(['validate', 'x.bpmn', '--strict', '--lint-config', 'lint/warn.json'])).toEqual({ code: 5, err: '' });
    expect(await early(['add', 'x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run', '--json', '--strict'])).toEqual({ code: 5, err: '' });
  });

  it('a project plugin that leaves a timer running does not keep the command alive', async () => {
    const dir = repo({ extends: 'plugin:local/recommended' }, { 'x.bpmn': await model(LINE) });
    plugin(dir, 'bpmnlint-plugin-local', {
      main: "setInterval(() => {}, 1000); module.exports = { configs: { recommended: { rules: { slow: 'error' } } } };",
      rules: { slow: "module.exports = () => ({ check(node, reporter) { if (node.$type === 'bpmn:Process') reporter.report(node.id, 'slow'); return new Promise((done) => setTimeout(done, 60000)); } });" },
    });
    for (const [args, code] of [[['validate', 'x.bpmn'], 2], [['add', 'x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run'], 0]] as const) {
      const started = Date.now();
      const spawned = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', input: '', timeout: 20000 });
      expect(spawned.signal, args.join(' ')).toBeNull();
      expect(spawned.status, spawned.stderr).toBe(code);
      expect(Date.now() - started, args.join(' ')).toBeLessThan(15000);
    }
  }, 60000);

  it.skipIf(process.platform === 'win32')('a working directory that was removed: validate and a write on an absolute path still run, the lookup from the file', async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'x.bpmn': await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]) });
    const gone = join(top, 'gone-cwd');
    const inGone = (args: string[]) => {
      mkdirSync(gone, { recursive: true });
      const spawned = spawnSync('/bin/sh', ['-c', 'cd "$1" && rmdir "$1" && shift && exec "$@"', 'sh', gone, process.execPath, cli, ...args], { encoding: 'utf8', input: '' });
      return { code: spawned.status, out: spawned.stdout, err: spawned.stderr };
    };
    const validated = inGone(['validate', join(dir, 'x.bpmn')]);
    expect(validated.code, validated.err).toBe(2);
    expect(validated.out).toContain('[bpmnlint error] label-required Activity_AfterCheck');
    const off = inGone(['validate', join(dir, 'x.bpmn'), '--no-lint-config']);
    expect(off.code, off.err).toBe(0);
    const add = inGone(['add', join(dir, 'x.bpmn'), 'task', 'Ship', '--after', 'Activity_AfterCheck', '--dry-run']);
    expect(add.code, add.err).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('a model reached through a linked directory from outside its repository runs the repository\'s .bpmnlintrc; a link inside a repository keeps that repository\'s', async () => {
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'models/x.bpmn': xml });
    const outside = join(top, 'cli-links');
    mkdirSync(join(outside, 'ext'), { recursive: true });
    writeFileSync(join(outside, 'ext', 'y.bpmn'), xml);
    symlinkSync(join(dir, 'models'), join(outside, 'mlink'), 'dir');
    symlinkSync(join(outside, 'ext'), join(dir, 'extlink'), 'dir');
    const linked = bpmn(outside, ['validate', 'mlink/x.bpmn']);
    expect(linked.code, linked.err).toBe(2);
    expect(linked.out).toContain('[bpmnlint error] label-required Activity_AfterCheck: Element is missing label/name\n');
    expect(linked.out).toContain(`validator bpmnlint (.bpmnlintrc in ../${basename(dir)}): 1 error(s), 0 warning(s) in the file\n`);
    // a new file in a subdirectory the write creates behind the link: the same .bpmnlintrc
    const created = bpmn(outside, ['new', 'mlink/sub/n.bpmn', '--name', 'Order']);
    expect(created.code, created.err).toBe(0);
    expect(created.out).toContain(`validator bpmnlint (.bpmnlintrc in ../${basename(dir)}): 2 error(s), 0 warning(s) in the result`);
    expect(existsSync(join(dir, 'models', 'sub', 'n.bpmn'))).toBe(true);
    const inRepo = bpmn(dir, ['validate', 'extlink/y.bpmn']);
    expect(inRepo.code, inRepo.err).toBe(2);
    expect(inRepo.out).toContain('validator bpmnlint (.bpmnlintrc in .): 1 error(s), 0 warning(s) in the file\n');
  });

  it('a write looks the .bpmnlintrc up from the file it writes (-o); a model from stdin without -o from the working directory', async () => {
    const xml = await model(LINE);
    const dir = repo(undefined, { 'plain/x.bpmn': xml, 'sub/.bpmnlintrc': JSON.stringify({ extends: 'bpmnlint:recommended' }) });
    const add = ['add', '-', 'task', '--after', 'Activity_Check'];
    expect(bpmn(dir, [...add, '-o', 'sub/out.bpmn'], xml).out).toContain('validator bpmnlint (.bpmnlintrc in sub): 1 error(s)');
    // the XML on stdout, the report on stderr
    const here = bpmn(dir, add, xml);
    expect(here.code, here.err).toBe(0);
    expect(here.err).not.toContain('bpmnlint');
    expect(bpmn(join(dir, 'sub'), add, xml).err).toContain('validator bpmnlint (.bpmnlintrc in .): 1 error(s)');
    // a file written elsewhere: the target's, not the input's
    expect(bpmn(dir, ['add', 'plain/x.bpmn', 'task', '--after', 'Activity_Check', '-o', 'sub/y.bpmn']).out).toContain('validator bpmnlint (.bpmnlintrc in sub): 1 error(s)');
    expect(bpmn(dir, ['add', 'sub/y.bpmn', 'task', 'Ship', '--after', 'Activity_AfterCheck', '-o', 'plain/z.bpmn']).out).not.toContain('bpmnlint');
  });

  it('without a .bpmnlintrc nothing of bpmnlint is loaded and the output is that of --no-lint-config', async () => {
    const dir = repo(undefined, { 'x.bpmn': await model(LINE) });
    const probe = `import { checkFile } from ${JSON.stringify(join(build, 'dist', 'node.js'))}; import { createRequire } from 'node:module';
      await checkFile(process.argv[1], { lintFrom: process.cwd(), lintProjectCode: true });
      console.log(Object.keys(createRequire(import.meta.url).cache).filter((k) => /bpmnlint/.test(k)).length);`;
    const run = (cwd: string) => spawnSync(process.execPath, ['--input-type=module', '-e', probe, join(cwd, 'x.bpmn')], { cwd, encoding: 'utf8' }).stdout.trim();
    expect(run(dir)).toBe('0');
    const withRc = repo({ extends: 'bpmnlint:recommended' }, { 'x.bpmn': await model(LINE) });
    expect(Number(run(withRc))).toBeGreaterThan(30);
    for (const args of [['validate', 'x.bpmn'], ['add', 'x.bpmn', 'task', '--after', 'Activity_Check', '--dry-run']]) {
      expect(bpmn(dir, args).out).toBe(bpmn(dir, [...args, '--no-lint-config']).out);
    }
  });

  it('a library host without a file and without lintFrom gets no lookup, also with a .bpmnlintrc in its working directory', () => {
    const dir = repo({ extends: 'bpmnlint:recommended' });
    const probe = `import { projectBpmnlint } from ${JSON.stringify(join(build, 'dist', 'node.js'))};
      console.log(String(await projectBpmnlint(undefined, {})), (await projectBpmnlint(undefined, { lintFrom: process.cwd() }))?.name);`;
    expect(spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: dir, encoding: 'utf8' }).stdout.trim()).toBe('undefined bpmnlint');
  });

  it('bpmnlint or the plugin cannot be loaded: one W_LINT_UNAVAILABLE, the write goes ahead', async () => {
    // an install whose plugin throws on load
    const broken = join(top, 'broken');
    mkdirSync(join(broken, 'node_modules', '@miragon', 'bpmnlint-plugin-rules'), { recursive: true });
    cpSync(join(build, 'dist'), join(broken, 'dist'), { recursive: true });
    writeFileSync(join(broken, 'package.json'), readFileSync(join(ROOT, 'package.json')));
    for (const name of readdirSync(join(ROOT, 'node_modules'))) if (name !== '@miragon') symlinkSync(join(ROOT, 'node_modules', name), join(broken, 'node_modules', name));
    const stub = join(broken, 'node_modules', '@miragon', 'bpmnlint-plugin-rules');
    writeFileSync(join(stub, 'package.json'), JSON.stringify({ name: '@miragon/bpmnlint-plugin-rules', version: '0.12.0', main: 'index.cjs' }));
    writeFileSync(join(stub, 'index.cjs'), "throw new Error('the plugin is broken');");
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'x.bpmn': await model(LINE) });
    const bin = join(broken, 'dist', 'cli.js');
    const validated = bpmn(dir, ['validate', 'x.bpmn'], undefined, bin);
    expect(validated.code, validated.err).toBe(0);
    expect(validated.out).toContain('[bpmnlint] W_LINT_UNAVAILABLE: bpmnlint could not be loaded: the plugin is broken; the plugin found bpmnlint 11.15.0 in ');
    expect(validated.out).toContain('validator bpmnlint (.bpmnlintrc in .; bpmnlint did not run (bpmn validate lists why)): 0 error(s), 1 warning(s) in the file\n');
    const add = bpmn(dir, ['add', 'x.bpmn', 'task', 'Ship', '--after', 'Activity_Check'], undefined, bin);
    expect(add.code, add.err).toBe(0);
    expect(add.out).toContain('written: x.bpmn');
    expect(readFileSync(join(dir, 'x.bpmn'), 'utf8')).toContain('Activity_Ship');
  });

  it('a project bpmnlint hoisted next to the plugin: an old one is named (the plugin cannot load), a loadable other version too', async () => {
    const project = (name: string, install: (dir: string) => void) => {
      const dir = repo({ extends: 'bpmnlint:recommended' }, { 'x.bpmn': '' });
      const modules = join(dir, 'node_modules');
      const cliDir = join(modules, '@miragon', 'bpmn-cli');
      mkdirSync(join(cliDir, 'node_modules'), { recursive: true });
      cpSync(join(build, 'dist'), join(cliDir, 'dist'), { recursive: true });
      writeFileSync(join(cliDir, 'package.json'), readFileSync(join(ROOT, 'package.json')));
      // bpmn-cli's own bpmnlint (the pinned one) is nested; the plugin and the rest are hoisted
      symlinkSync(join(ROOT, 'node_modules', 'bpmnlint'), join(cliDir, 'node_modules', 'bpmnlint'));
      cpSync(join(ROOT, 'node_modules', '@miragon', 'bpmnlint-plugin-rules'), join(modules, '@miragon', 'bpmnlint-plugin-rules'), { recursive: true });
      for (const entry of readdirSync(join(ROOT, 'node_modules'))) if (entry !== '@miragon' && entry !== 'bpmnlint') symlinkSync(join(ROOT, 'node_modules', entry), join(modules, entry));
      install(join(modules, 'bpmnlint'));
      return { dir, bin: join(cliDir, 'dist', 'cli.js'), name };
    };
    const xml = await model(LINE);
    const old = project('old', (target) => {
      mkdirSync(target);
      writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'bpmnlint', version: '11.0.0', main: 'lib/index.js' }));
    });
    writeFileSync(join(old.dir, 'x.bpmn'), xml);
    const validated = bpmn(old.dir, ['validate', 'x.bpmn'], undefined, old.bin);
    expect(validated.code, validated.err).toBe(0);
    expect(validated.out).toMatch(/\[bpmnlint\] W_LINT_UNAVAILABLE: bpmnlint could not be loaded: Cannot find module 'bpmnlint\/[^']+'; the plugin found bpmnlint 11\.0\.0 in node_modules\/bpmnlint; bpmnlint did not run {2}\(bpmn-cli needs bpmnlint >= 11\.14 next to @miragon\/bpmnlint-plugin-rules \(it pins 11\.15\.0\): update the project's bpmnlint \(npm i -D bpmnlint@11\.15\.0\) or run bpmn-cli from its own install \(npx\); --no-lint-config skips bpmnlint\.\)\n/);
    const other = project('other', (target) => {
      cpSync(join(ROOT, 'node_modules', 'bpmnlint'), target, { recursive: true });
      const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
      writeFileSync(join(target, 'package.json'), JSON.stringify({ ...pkg, version: '11.14.0' }));
    });
    writeFileSync(join(other.dir, 'x.bpmn'), xml);
    const ok = bpmn(other.dir, ['validate', 'x.bpmn'], undefined, other.bin);
    expect(ok.code, ok.err).toBe(0);
    expect(ok.out).toContain('validator bpmnlint (.bpmnlintrc in .; bpmnlint 11.14.0 from node_modules/bpmnlint (bpmn-cli pins 11.15.0)): 0 error(s), 0 warning(s) in the file\n');
  }, 60000);

  it('the examples of docs/bpmnlint.md: validate and a write on a Camunda 7 project with camunda-compat, @miragon/rules and a project plugin', async () => {
    const doc = readFileSync(join(ROOT, 'docs', 'bpmnlint.md'), 'utf8');
    const blocks = [...doc.matchAll(/```(?:console)?\n(\$ bpmn [\s\S]*?)```/g)].map((match) => match[1]!.trimEnd().split('\n'));
    expect(blocks.map((block) => block[0])).toEqual(['$ bpmn validate models/order.bpmn', '$ bpmn add models/order.bpmn serviceTask "Book order" --after Activity_CheckOrder camunda:type=external', '$ bpmn show models/order.bpmn --conventions']);
    const dir = repo({
      extends: ['bpmnlint:recommended', 'plugin:camunda-compat/camunda-platform-7-24', 'plugin:@miragon/rules/recommended-for-automation', 'plugin:local/recommended'],
      moddleExtensions: { camunda: 'camunda-bpmn-moddle/resources/camunda.json' },
    });
    plugin(dir, 'bpmnlint-plugin-local', {
      version: '1.0.0',
      configs: { recommended: { rules: { 'external-task-topic': 'error' } } },
      rules: { 'external-task-topic': "module.exports = () => ({ check(node, reporter) { if (node.$type === 'bpmn:ServiceTask' && node.get('camunda:type') === 'external' && !node.get('camunda:topic')) reporter.report(node.id, 'External task has no topic', ['topic']); } });" },
    });
    const created = (await newXml({ processName: 'Order', target: 'camunda7' })).xml;
    mkdirSync(join(dir, 'models'));
    writeFileSync(join(dir, 'models', 'order.bpmn'), (await applyToXml(created, [
      { op: 'add', kind: 'start', name: 'Order received', id: 'Event_OrderReceived' },
      { op: 'add', kind: 'userTask', name: 'Check order', id: 'Activity_CheckOrder', after: 'Event_OrderReceived' },
      { op: 'add', kind: 'end', name: 'Order checked', id: 'Event_OrderChecked', after: 'Activity_CheckOrder' },
    ])).xml);
    const args = (line: string) => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2]!).slice(2);
    const [validate, add, conventions] = blocks as [string[], string[], string[]];
    // the write first, then validate the result and show its id conventions
    const written = bpmn(dir, args(add[0]!));
    expect(written.code, written.err).toBe(0);
    for (const line of add.slice(1).filter((outputLine) => outputLine !== '...')) expect(written.out.split('\n'), line).toContain(line);
    const checked = bpmn(dir, args(validate[0]!));
    expect(checked.code).toBe(2);
    expect(checked.out.trimEnd()).toBe(validate.slice(1).join('\n'));
    const shown = bpmn(dir, args(conventions[0]!));
    expect(shown.code, shown.err).toBe(0);
    expect(shown.out.trimEnd()).toBe(conventions.slice(1).join('\n'));
  });

  it('id conventions (#34): `new` keeps the process id, show --conventions (a missing file, stdin, --json, --no-lint-config), validate - names W_CONFIG_IGNORED', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-automation'] });
    mkdirSync(join(dir, 'models'));
    // `new` in a repository whose .bpmnlintrc extends recommended-for-automation: the bytes of --no-lint-config
    expect(bpmn(dir, ['new', 'models/a.bpmn', '--name', 'Invoice handling']).code).toBe(0);
    expect(bpmn(dir, ['new', 'models/b.bpmn', '--name', 'Invoice handling', '--no-lint-config']).code).toBe(0);
    expect(readFileSync(join(dir, 'models', 'a.bpmn'), 'utf8')).toBe(readFileSync(join(dir, 'models', 'b.bpmn'), 'utf8'));
    expect(readFileSync(join(dir, 'models', 'a.bpmn'), 'utf8')).toContain('<bpmn:process id="Process_InvoiceHandling"');
    // what fails without a .bpmnlintrc fails first, also with a --lint-config that cannot be read
    const exists = bpmn(dir, ['new', 'models/a.bpmn', '--name', 'Other', '--lint-config', 'missing.json']);
    expect([exists.code, exists.err.split('\n')[0]]).toEqual([4, 'error E_FILE_EXISTS: models/a.bpmn already exists']);
    const badId = bpmn(dir, ['new', 'models/c.bpmn', '--id', '1bad', '--lint-config', 'missing.json']);
    expect([badId.code, badId.err.split('\n')[0]]).toEqual([2, 'error E_INVALID_ID: "1bad" is not a valid id (XML NCName)']);
    expect(bpmn(dir, ['new', 'models/c.bpmn', '--name', 'Other', '--lint-config', 'missing.json']).err).toContain('error E_LINT_CONFIG: ');
    // a file that does not exist yet: the conventions of a new model there
    const fresh = bpmn(dir, ['show', 'models/new.bpmn', '--conventions']);
    expect(fresh.code, fresh.err).toBe(0);
    expect(fresh.out.split('\n').slice(0, 3)).toEqual([
      'conventions of models/new.bpmn (no file yet: a new model)',
      'element-id-naming (.bpmnlintrc in .): warn, case camelCase, eventDefinitionQualifier optional',
      '  <kind>_{name:camel}               lint        task userTask serviceTask scriptTask sendTask receiveTask manualTask businessRuleTask subProcess callActivity startEvent endEvent',
    ]);
    const json = JSON.parse(bpmn(dir, ['show', 'models/a.bpmn', '--conventions', '--json']).out);
    expect(json).toMatchObject({ file: 'models/a.bpmn', exists: true, source: '.bpmnlintrc in .', rule: { severity: 'warn', case: 'camelCase', qualifier: 'optional' }, notes: [] });
    expect(bpmn(dir, ['show', 'models/a.bpmn', '--conventions', '--no-lint-config']).out.split('\n')[1]).toBe("no id conventions: --no-lint-config leaves the .bpmnlintrc out; new ids follow the file's id style");
    // the .bpmnlintrc only decides the conventions: without --conventions its options are an error
    for (const flag of [['--lint-config', 'nope.json'], ['--no-lint-config']]) {
      const plain = bpmn(dir, ['show', 'models/a.bpmn', ...flag]);
      expect(plain.code).toBe(1);
      expect(plain.err).toContain(`error E_USAGE: ${flag[0]} goes only with --conventions`);
    }
    expect(bpmn(dir, ['show', 'models/a.bpmn', '--conventions', '--lint-config', 'nope.json']).code).toBe(4);
    const stdin = bpmn(dir, ['show', '-', '--conventions'], readFileSync(join(dir, 'models', 'a.bpmn'), 'utf8'));
    expect(stdin.out.split('\n').slice(0, 2)).toEqual(['conventions of the model', 'element-id-naming (.bpmnlintrc in .): warn, case camelCase, eventDefinitionQualifier optional']);
    const usage = bpmn(dir, ['show', 'models/a.bpmn', 'Process_InvoiceHandling', '--conventions', '--layout']);
    expect(usage.code).toBe(1);
    expect(usage.err).toContain('error E_USAGE: --conventions shows the id conventions of the whole file; drop the element id and --layout');
    // a .bpmnlintrc that is not strict JSON, one that leaves the rule out (a typo): the reason and the W_LINT_UNAVAILABLE
    const broken = repo('{"extends":["plugin:@miragon/rules/recommended-for-automation"],}');
    const notJson = bpmn(broken, ['show', 'x.bpmn', '--conventions']);
    expect(notJson.code, notJson.err).toBe(0);
    expect(notJson.out.split('\n')[1]).toBe("no id conventions: the .bpmnlintrc in . could not be loaded (W_LINT_UNAVAILABLE below); new ids follow the file's id style");
    expect(notJson.out).toMatch(/^warning W_LINT_UNAVAILABLE: \.bpmnlintrc is not JSON /m);
    expect(JSON.parse(bpmn(broken, ['show', 'x.bpmn', '--conventions', '--json']).out)).toMatchObject({ source: '.bpmnlintrc in .', undeclared: 'not loaded', notes: [{ code: 'W_LINT_UNAVAILABLE' }] });
    const typo = repo({ rules: { 'miragon/element-id-naming': 'error' } });
    const left = bpmn(typo, ['show', 'x.bpmn', '--conventions']);
    expect(left.out.split('\n')[1]).toBe("no id conventions: element-id-naming is off or not configured in the .bpmnlintrc in .; new ids follow the file's id style");
    expect(left.out).toContain('warning W_LINT_UNAVAILABLE: miragon/element-id-naming left out: bpmnlint-plugin-miragon is not installed');
    // validate - (stdin) looks the .bpmnlintrc up from the working directory: its W_CONFIG_IGNORED too
    const odd = repo({ rules: { '@miragon/rules/element-id-naming': ['warn', { eventDefinitionQualifier: 'requried' }] } });
    const piped = bpmn(odd, ['validate', '-'], readFileSync(join(dir, 'models', 'a.bpmn'), 'utf8'));
    expect(piped.out).toContain('[bpmnlint] W_CONFIG_IGNORED: .bpmnlintrc in .: @miragon/rules/element-id-naming eventDefinitionQualifier "requried" is unknown: the rule and new ids take optional  (Write one of off, optional, required in the .bpmnlintrc. Did you mean required?)\n');
  });

  it('a prefix the .bpmnlintrc declares for a DI type: `new`, validate and show --conventions list one W_CONFIG_IGNORED each, a write counts them', async () => {
    const dir = repo({ rules: { '@miragon/rules/element-id-naming': ['warn', { prefixes: { 'bpmndi:BPMNShape': 'shape_', 'bpmndi:BPMNEdge': 'edge_' } }] } });
    const line = (type: string, prefix: string): string => `W_CONFIG_IGNORED: .bpmnlintrc in .: @miragon/rules/element-id-naming prefix of ${type} "${prefix}" is not followed: bpmn-cli names DI after its element (BPMNShape_<id>, <id>_di), and the rule reports new DI ids  (Set it to false or remove it; bpmn-js names DI <id>_di too.)`;
    const created = bpmn(dir, ['new', 'a.bpmn']);
    expect(created.code, created.err).toBe(0);
    expect(created.out).toContain(`warning [bpmnlint] ${line('bpmndi:BPMNShape', 'shape_')}\nwarning [bpmnlint] ${line('bpmndi:BPMNEdge', 'edge_')}\n`);
    // a write: the DI of the new element is reported (bpmn-cli names it after the element), the notes only counted
    const added = bpmn(dir, ['add', 'a.bpmn', 'startEvent', 'Order received']);
    expect(added.out).toContain('warning [bpmnlint] @miragon/rules/element-id-naming BPMNShape_startEvent_orderReceived: Element id must match the naming convention <shape_camelCase>');
    expect(added.out).toContain('validator bpmnlint (.bpmnlintrc in .; 2 element-id-naming values ignored (W_CONFIG_IGNORED; bpmn validate lists them)): ');
    expect(added.out).not.toContain('warning [bpmnlint] W_CONFIG_IGNORED');
    const checked = bpmn(dir, ['validate', 'a.bpmn']);
    expect(checked.out).toContain(`[bpmnlint] ${line('bpmndi:BPMNShape', 'shape_')}\n[bpmnlint] ${line('bpmndi:BPMNEdge', 'edge_')}\n`);
    const shown = bpmn(dir, ['show', 'a.bpmn', '--conventions']);
    expect(shown.out.split('\n').filter((outputLine) => outputLine.startsWith('warning '))).toEqual([`warning ${line('bpmndi:BPMNShape', 'shape_')}`, `warning ${line('bpmndi:BPMNEdge', 'edge_')}`]);
    // DI ids stay bpmn-cli's: no row of the view names them
    expect(shown.out.split('\n').filter((outputLine) => outputLine.startsWith('  ') && /shape_|edge_|BPMN/.test(outputLine))).toEqual([]);
  });
});
