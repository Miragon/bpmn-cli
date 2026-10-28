/**
 * The project's bpmnlint configuration (issue #33) on disk: src/adapters/out/files/ (ConfigLookup,
 * BpmnlintLoader, ChainResolver: lookup, loading, the resolver chain), with the real bpmnlint and
 * @miragon/bpmnlint-plugin-rules, offline.
 *
 * Every case builds a repository of its own in a temporary directory (a .git
 * directory, a .bpmnlintrc, models; a node_modules only where the case writes
 * project plugins), except the cases about a model outside a repository.
 * test/helpers/global-setup.ts makes sure no .bpmnlintrc above the temporary
 * directory changes them.
 */
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyToXml, newXml } from '../../../../src/api.js';
import { bpmnlintValidator, resolveBpmnlintConfig, idConventionsFromLint, ID_NAMING_RULE, advisoryValidators, mutationReport, mutationSummary, renderMutation, renderSummary, renderValidation, validationReport } from '../../../../src/index.js';
import { Doc } from '../../../../src/domain/document/Doc.js';
import type { BpmnError } from '../../../../src/domain/document/BpmnError.js';
import type { EditCommand } from '../../../../src/domain/commands/types.js';
import { bpmnlintEngine, findBpmnlintConfig, loadBpmnlint, projectBpmnlint, projectBpmnlintSettings } from '../../../../src/node.js';
import { checkFile, checkLoadedDoc, mutateFile } from '../../../../src/node.js';
import { gitRoot } from '../../../../src/adapters/out/files/utils/find-up.js';
import { checkDoc } from '../../../../src/index.js';
import { ROOT, fixture, top, repo, plugin, model, LINE, REDEFINES_NOTHING, lintOf, codes, codeOf } from '../../../helpers/bpmnlint.js';

describe('the .bpmnlintrc on disk: lookup and flags', () => {
  it('the nearest .bpmnlintrc above the file wins; one above the repository root (.git directory or file) does not count', async () => {
    const outer = join(top, 'outer-lookup');
    mkdirSync(outer, { recursive: true });
    writeFileSync(join(outer, '.bpmnlintrc'), '{ "extends": "bpmnlint:recommended" }');
    const dir = repo(undefined, { 'models/a/x.bpmn': '' }, outer);
    expect(findBpmnlintConfig(join(dir, 'models', 'a'))).toBeUndefined();
    writeFileSync(join(dir, '.bpmnlintrc'), '{}');
    writeFileSync(join(dir, 'models', '.bpmnlintrc'), '{}');
    expect(findBpmnlintConfig(join(dir, 'models', 'a'))).toBe(join(dir, 'models', '.bpmnlintrc'));
    // a worktree or submodule: .git is a file
    const sub = join(dir, 'models', 'a');
    writeFileSync(join(sub, '.git'), 'gitdir: ../../.git/modules/a\n');
    expect(findBpmnlintConfig(sub)).toBeUndefined();
  });

  it('outside a git repository only the model\'s own directory counts, and project plugins do not run (bundled rules do)', async () => {
    const outside = join(top, 'outside');
    expect(gitRoot(top), 'the temporary directory lies in a git repository').toBeUndefined();
    const marker = join(outside, 'RAN.txt');
    const evil = { main: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` };
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'userTask_check' }]);
    // a .bpmnlintrc and a plugin in a parent directory (~, /tmp): not looked at
    mkdirSync(join(outside, 'a', 'b'), { recursive: true });
    writeFileSync(join(outside, '.bpmnlintrc'), JSON.stringify({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }));
    plugin(outside, 'bpmnlint-plugin-evil', evil);
    writeFileSync(join(outside, 'a', 'b', 'x.bpmn'), xml);
    expect(findBpmnlintConfig(join(outside, 'a', 'b'))).toBeUndefined();
    const below = await checkFile(join(outside, 'a', 'b', 'x.bpmn'), { lintProjectCode: true, lintFrom: join(outside, 'a', 'b') });
    expect(below.validation.validators).toBeUndefined();
    expect(renderValidation(validationReport(below))).toBe(renderValidation(validationReport(await checkFile(join(outside, 'a', 'b', 'x.bpmn'), { lintConfig: false }))));
    // stdin: from the working directory, the same
    expect((await checkLoadedDoc(await Doc.fromXml(xml), { lintProjectCode: true, lintFrom: join(outside, 'a', 'b') })).validation.validators).toBeUndefined();
    // in the model's own directory: the bundled rules run, the plugin does not
    writeFileSync(join(outside, 'x.bpmn'), xml);
    expect(findBpmnlintConfig(outside)).toBe(join(outside, '.bpmnlintrc'));
    const own = await checkFile(join(outside, 'x.bpmn'), { lintProjectCode: true, lintFrom: outside });
    expect(codes(lintOf(own.validation.errors))).toContain('label-required task_afterCheck');
    expect(own.validation.warnings.filter((warning) => warning.code === 'W_LINT_UNAVAILABLE').map((warning) => `${warning.message}  (${warning.hint})`)).toEqual([
      'plugin:evil/recommended left out: bpmnlint-plugin-evil is not bundled with bpmn-cli, and bpmn-cli runs project plugins only inside a git repository (the .bpmnlintrc in . is in none)  (Keep the .bpmnlintrc and the plugin in a git repository, or remove the plugin from the configuration; --no-lint-config skips bpmnlint.)',
    ]);
    // a library host without lintProjectCode: the hint does not send it to a setting that would not help
    const host = await checkFile(join(outside, 'x.bpmn'), { lintFrom: outside });
    expect(host.validation.warnings.filter((warning) => warning.code === 'W_LINT_UNAVAILABLE').map((warning) => `${warning.message}  (${warning.hint})`)).toEqual([
      'plugin:evil/recommended left out: bpmnlint-plugin-evil is not bundled with bpmn-cli, and this host does not run project plugins (lintProjectCode)  (Remove it from the configuration; lintProjectCode: true would not run it either: bpmn-cli runs project plugins only inside a git repository (the .bpmnlintrc in . is in none).)',
    ]);
    expect(existsSync(marker)).toBe(false);
  });

  // POSIX uids; as root every file belongs to root, which counts as one's own
  it.skipIf(!process.getuid || process.getuid() === 0)('a repository whose .git belongs to another user (a planted /tmp/.git): its .bpmnlintrc applies with the rules bpmn-cli ships, its project plugins do not run, W_LINT_UNAVAILABLE says why', async () => {
    const marker = join(top, 'RAN-foreign.txt');
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'userTask_check' }]);
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }, { 'x.bpmn': xml, 'models/y.bpmn': xml });
    plugin(dir, 'bpmnlint-plugin-evil', { main: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` });
    const why = (from: string) => `plugin:evil/recommended left out: bpmnlint-plugin-evil is not bundled with bpmn-cli, and bpmn-cli runs project plugins only in a repository of the user running it (the repository of ${from} belongs to another user)`;
    // the files belong to the user running the tests: seen from another uid they belong to someone else
    const uid = vi.spyOn(process, 'getuid').mockReturnValue(424242);
    try {
      // the lookup goes up to the repository root, whoever owns it
      expect(findBpmnlintConfig(join(dir, 'models'))).toBe(join(dir, '.bpmnlintrc'));
      for (const [file, from, git] of [[join(dir, 'x.bpmn'), dir, '.git'], [join(dir, 'models', 'y.bpmn'), join(dir, 'models'), '../.git']] as const) {
        const checked = await checkFile(file, { lintProjectCode: true, lintFrom: from });
        expect(codes(lintOf(checked.validation.errors)), file).toContain('label-required task_afterCheck');
        expect(checked.validation.warnings.filter((warning) => warning.code === 'W_LINT_UNAVAILABLE').map((warning) => warning.message), file).toEqual([why(git)]);
        // git's safe.directory is not read: the hint does not say git refuses the repository
        expect(checked.validation.warnings.find((warning) => warning.code === 'W_LINT_UNAVAILABLE')?.hint).toBe("Check who created that repository and its .git; run bpmn-cli as its owner (git's safe.directory does not change this), or remove the plugin from the configuration; --no-lint-config skips bpmnlint.");
      }
      expect(existsSync(marker)).toBe(false);
    } finally {
      uid.mockRestore();
    }
    // as its owner: the plugin runs
    await checkFile(join(dir, 'models', 'y.bpmn'), { lintProjectCode: true, lintFrom: dir });
    expect(existsSync(marker)).toBe(true);
  });

  // what git checks (lstat): a .git link or hard link counts by its own owner, not by what it points to
  it.skipIf(!process.getuid || process.getuid() === 0)('a .git link to / or hard link, planted by another user: the .bpmnlintrc applies, its plugins do not run; a hard link to a file that names no git directory is no repository; root runs plugins only in its own and, under sudo, SUDO_UID\'s', async () => {
    const me = process.getuid!();
    const evil = (marker: string) => ({ main: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` });
    const store = join(top, 'planted-store');
    mkdirSync(join(store, 'wt.git'), { recursive: true });
    writeFileSync(join(store, 'gitfile'), `gitdir: ${join(store, 'wt.git')}\n`);
    // [name, how the .git is planted, whether it makes a repository]
    const layouts: Array<[string, (git: string) => void, boolean]> = [
      ['planted-symlink', (git) => symlinkSync('/', git), true],
      ['planted-hardlink-gitfile', (git) => linkSync(join(store, 'gitfile'), git), true],
      // /etc/hosts names no git directory: git takes it for no repository, and so does the lookup
      ['planted-hardlink', (git) => linkSync('/etc/hosts', git), false],
    ];
    const cases: Array<{ dir: string; marker: string; counts: boolean }> = [];
    for (const [name, git, counts] of layouts) {
      const dir = join(top, name);
      mkdirSync(join(dir, 'models'), { recursive: true });
      try {
        git(join(dir, '.git'));
      } catch {
        continue; // no hard links to root's files here (Linux: fs.protected_hardlinks)
      }
      writeFileSync(join(dir, '.bpmnlintrc'), JSON.stringify({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }));
      plugin(dir, 'bpmnlint-plugin-evil', evil(join(dir, 'RAN.txt')));
      cases.push({ dir, marker: join(dir, 'RAN.txt'), counts });
    }
    expect(cases.length).toBeGreaterThan(1);
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'userTask_check' }]);
    const why = (git: string) => `plugin:evil/recommended left out: bpmnlint-plugin-evil is not bundled with bpmn-cli, and bpmn-cli runs project plugins only in a repository of the user running it (the repository of ${git} belongs to another user)`;
    const uid = vi.spyOn(process, 'getuid').mockReturnValue(424242);
    try {
      for (const { dir, marker, counts } of cases) {
        writeFileSync(join(dir, 'models', 'y.bpmn'), xml);
        // seen from another uid, the planter's files are someone else's: the parent .bpmnlintrc applies (bpmn-cli's rules), its plugin does not run
        expect(findBpmnlintConfig(join(dir, 'models')), dir).toBe(counts ? join(dir, '.bpmnlintrc') : undefined);
        const below = await checkFile(join(dir, 'models', 'y.bpmn'), { lintProjectCode: true, lintFrom: join(dir, 'models') });
        if (counts) {
          expect(codes(lintOf(below.validation.errors)), dir).toContain('label-required task_afterCheck');
          expect(below.validation.warnings.filter((warning) => warning.code === 'W_LINT_UNAVAILABLE').map((warning) => warning.message), dir).toEqual([why('../.git')]);
        } else {
          expect(below.validation.validators, dir).toBeUndefined();
        }
        // the .bpmnlintrc next to the model: bundled rules only
        writeFileSync(join(dir, 'x.bpmn'), xml);
        const checked = await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir });
        expect(codes(lintOf(checked.validation.errors)), dir).toContain('label-required task_afterCheck');
        expect(checked.validation.warnings.filter((warning) => warning.code === 'W_LINT_UNAVAILABLE').map((warning) => warning.message), dir).toEqual([why('.git')]);
        expect(existsSync(marker), dir).toBe(false);
      }
    } finally {
      uid.mockRestore();
    }
    // root over the user's checkout: the .bpmnlintrc applies; plugins run for root's own files and, under sudo, those of SUDO_UID, not another user's
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }, { 'models/y.bpmn': xml });
    const marker = join(dir, 'RAN.txt');
    plugin(dir, 'bpmnlint-plugin-evil', evil(marker));
    const root = vi.spyOn(process, 'getuid').mockReturnValue(0);
    const run = async () => (await checkFile(join(dir, 'models', 'y.bpmn'), { lintProjectCode: true, lintFrom: dir })).validation.warnings.filter((warning) => warning.code === 'W_LINT_UNAVAILABLE').map((warning) => warning.message);
    try {
      // only the decimal digits sudo writes (git's strtoul would also take a leading blank or +)
      for (const sudo of ['', ` ${me}`]) {
        vi.stubEnv('SUDO_UID', sudo);
        expect(findBpmnlintConfig(join(dir, 'models')), sudo).toBe(join(dir, '.bpmnlintrc'));
        expect(await run(), sudo).toEqual([why('.git')]);
        expect(existsSync(marker), sudo).toBe(false);
      }
      vi.stubEnv('SUDO_UID', String(me));
      expect(await run()).toEqual([]);
      expect(existsSync(marker)).toBe(true);
    } finally {
      root.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('a .git link or .git file of one\'s own counts like a .git directory; a .git file whose gitdir is missing does not', () => {
    const store = join(top, 'git-store');
    mkdirSync(join(store, 'wt.git'), { recursive: true });
    const layouts: Array<[string, (git: string) => void, boolean]> = [
      ['own-symlink', (git) => symlinkSync(join(store, 'wt.git'), git), true],
      ['own-gitfile', (git) => writeFileSync(git, `gitdir: ${join(store, 'wt.git')}\n`), true],
      ['own-gitfile-relative', (git) => writeFileSync(git, 'gitdir: ../git-store/wt.git\n'), true],
      ['gitfile-missing', (git) => writeFileSync(git, 'gitdir: ../git-store/missing.git\n'), false],
      ['gitfile-garbage', (git) => writeFileSync(git, 'not a gitfile\n'), false],
    ];
    for (const [name, git, counts] of layouts) {
      const dir = join(top, name);
      mkdirSync(join(dir, 'models'), { recursive: true });
      git(join(dir, '.git'));
      writeFileSync(join(dir, '.bpmnlintrc'), '{}');
      expect(findBpmnlintConfig(join(dir, 'models')), name).toBe(counts ? join(dir, '.bpmnlintrc') : undefined);
    }
  });

  it('a .git file that names no git directory is no repository, and the message says so (not "another user")', async () => {
    const dir = join(top, 'stale-worktree');
    const marker = join(dir, 'RAN.txt');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, '.git'), 'gitdir: ../missing/worktrees/x\n');
    writeFileSync(join(dir, '.bpmnlintrc'), JSON.stringify({ extends: ['bpmnlint:recommended', 'plugin:local/recommended'] }));
    plugin(dir, 'bpmnlint-plugin-local', { main: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` });
    const xml = await model(LINE);
    writeFileSync(join(dir, 'x.bpmn'), xml);
    writeFileSync(join(dir, 'sub', 'y.bpmn'), xml);
    const checked = await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir });
    expect(checked.validation.warnings.filter((warning) => warning.code === 'W_LINT_UNAVAILABLE').map((warning) => `${warning.message}  (${warning.hint})`)).toEqual([
      'plugin:local/recommended left out: bpmnlint-plugin-local is not bundled with bpmn-cli, and bpmn-cli runs project plugins only inside a git repository (.git is a file that names no git directory, so git takes it for no repository either)  (Fix or remove that .git file (a worktree or submodule whose git directory moved), or remove the plugin from the configuration; --no-lint-config skips bpmnlint.)',
    ]);
    expect(findBpmnlintConfig(join(dir, 'sub'))).toBeUndefined();
    expect(existsSync(marker)).toBe(false);
  });

  // simulated on POSIX: no process.getuid, HOME as the home directory
  it.skipIf(process.platform === 'win32')('where there are no uids (Windows), only a repository inside the home directory runs project plugins: a .git and a plugin planted at the drive root run nothing; a repository outside it (C:\\dev) gets its .bpmnlintrc with bpmn-cli\'s rules', async () => {
    const drive = join(top, 'win-drive');
    const home = join(drive, 'Users', 'me');
    const marker = join(drive, 'RAN.txt');
    const evil = (path: string) => ({ main: `require('fs').writeFileSync(${JSON.stringify(path)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` });
    // C:\.git and C:\node_modules, which any user can create
    mkdirSync(join(drive, '.git'), { recursive: true });
    plugin(drive, 'bpmnlint-plugin-evil', evil(marker));
    const xml = await model(LINE);
    for (const name of ['Downloads/m/y.bpmn', 'Desktop/proj/x.bpmn']) {
      mkdirSync(dirname(join(home, name)), { recursive: true });
      writeFileSync(join(home, name), xml);
    }
    // the user's own ~/.bpmnlintrc, and a project folder without a repository of its own that names a plugin it did not install
    writeFileSync(join(home, '.bpmnlintrc'), JSON.stringify({ extends: 'bpmnlint:recommended' }));
    const proj = join(home, 'Desktop', 'proj');
    writeFileSync(join(proj, '.bpmnlintrc'), JSON.stringify({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }));
    // a repository of the user's inside the home directory, with the plugin installed, and one whose .git file names no git directory
    const own = repo({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }, { 'models/z.bpmn': xml }, home);
    const ownMarker = join(own, 'RAN.txt');
    plugin(own, 'bpmnlint-plugin-evil', evil(ownMarker));
    const stale = join(home, 'stale');
    mkdirSync(join(stale, 'models'), { recursive: true });
    writeFileSync(join(stale, '.git'), 'gitdir: ../missing.git\n');
    writeFileSync(join(stale, '.bpmnlintrc'), '{}');
    // a repository outside the home directory (C:\dev\proj), with the plugin installed
    const dev = repo({ extends: ['bpmnlint:recommended', 'plugin:evil/recommended'] }, { 'models/z.bpmn': await model([...LINE, { op: 'add', kind: 'task', after: 'userTask_check' }]) }, join(drive, 'dev'));
    const devMarker = join(dev, 'RAN.txt');
    plugin(dev, 'bpmnlint-plugin-evil', evil(devMarker));
    const homeOff = (git: string) => `plugin:evil/recommended left out: bpmnlint-plugin-evil is not bundled with bpmn-cli, and bpmn-cli runs project plugins only in a repository of the user running it, and where it cannot read file owners (Windows) only in one inside the home directory (${git} is outside it)  (Keep the repository inside your home directory, or remove the plugin from the configuration; --no-lint-config skips bpmnlint.)`;
    const uid = vi.spyOn(process, 'getuid').mockReturnValue(undefined as unknown as number);
    vi.stubEnv('HOME', home);
    try {
      // the planted C:\.git makes C:\ a repository: the lookup goes up to it (the user's own ~/.bpmnlintrc here); only bundled rules run
      expect(findBpmnlintConfig(join(home, 'Downloads', 'm'))).toBe(join(home, '.bpmnlintrc'));
      const checked = await checkFile(join(proj, 'x.bpmn'), { lintProjectCode: true, lintFrom: proj });
      expect(checked.validation.warnings.filter((warning) => warning.code === 'W_LINT_UNAVAILABLE').map((warning) => `${warning.message}  (${warning.hint})`)).toEqual([homeOff('../../../../.git')]);
      expect(existsSync(marker)).toBe(false);
      expect(findBpmnlintConfig(join(stale, 'models'))).toBeUndefined();
      // outside the home directory: the repository's .bpmnlintrc applies with bpmn-cli's rules, the plugin is left out and named
      expect(findBpmnlintConfig(join(dev, 'models'))).toBe(join(dev, '.bpmnlintrc'));
      const outside = await checkFile(join(dev, 'models', 'z.bpmn'), { lintProjectCode: true, lintFrom: join(dev, 'models') });
      expect(codes(lintOf(outside.validation.errors))).toContain('label-required task_afterCheck');
      expect(outside.validation.warnings.filter((warning) => warning.code === 'W_LINT_UNAVAILABLE').map((warning) => `${warning.message}  (${warning.hint})`)).toEqual([homeOff('../.git')]);
      expect(existsSync(devMarker)).toBe(false);
      // inside the home directory: the parent .bpmnlintrc counts and the plugin runs
      expect(findBpmnlintConfig(join(own, 'models'))).toBe(join(own, '.bpmnlintrc'));
      await checkFile(join(own, 'models', 'z.bpmn'), { lintProjectCode: true, lintFrom: own });
      expect(existsSync(ownMarker)).toBe(true);
    } finally {
      uid.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  // symbolic links to directories need rights on Windows
  it.skipIf(process.platform === 'win32')('a model reached through a linked directory: the path as given first, then the physical directory (as git finds the repository)', async () => {
    // physical paths, like the CLI's working directory (the temporary directory itself may be reached through a link)
    const base = join(realpathSync(top), 'links');
    mkdirSync(base, { recursive: true });
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'userTask_check' }]);
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'models/x.bpmn': xml }, base);
    // outside/mlink -> repo/models: as given, outside lies in no repository and has no .bpmnlintrc; the physical directory is the repository's
    const outside = join(base, 'outside');
    mkdirSync(outside);
    symlinkSync(join(dir, 'models'), join(outside, 'mlink'), 'dir');
    expect(findBpmnlintConfig(join(outside, 'mlink'))).toBe(join(dir, '.bpmnlintrc'));
    // a subdirectory a write is about to create: from its deepest existing ancestor
    expect(findBpmnlintConfig(join(outside, 'mlink', 'new', 'deeper'))).toBe(join(dir, '.bpmnlintrc'));
    // a linked model file counts by the directory of the link (outside: nothing)
    symlinkSync(join(dir, 'models', 'x.bpmn'), join(outside, 'flink.bpmn'), 'file');
    expect((await checkFile(join(outside, 'flink.bpmn'), { lintFrom: outside })).validation.validators ?? []).toEqual([]);
    const linked = await checkFile(join(outside, 'mlink', 'x.bpmn'), { lintProjectCode: true, lintFrom: outside });
    expect(linked.validation.validators?.[0]).toMatchObject({ name: 'bpmnlint', detail: `.bpmnlintrc in ../${basename(dir)}` });
    expect(codes(lintOf(linked.validation.errors))).toContain('label-required task_afterCheck');
    // stdin from the linked directory: the same lookup from lintFrom; the path as `..` resolves there
    expect(await projectBpmnlint(undefined, { lintFrom: join(outside, 'mlink') })).toMatchObject({ name: 'bpmnlint', detail: '.bpmnlintrc in ..' });
    // the opposite: repo/extlink -> a directory of another repository; as given the walk finds this repository's .bpmnlintrc, which stays
    const other = repo({ extends: 'bpmnlint:all' }, { 'models/y.bpmn': xml }, base);
    symlinkSync(join(other, 'models'), join(dir, 'extlink'), 'dir');
    expect(findBpmnlintConfig(join(dir, 'extlink'))).toBe(join(dir, '.bpmnlintrc'));
    expect(findBpmnlintConfig(join(other, 'models'))).toBe(join(other, '.bpmnlintrc'));
    // nothing either way (no repository as given, none physically): nothing runs
    const loose = join(base, 'loose');
    mkdirSync(join(loose, 'models'), { recursive: true });
    writeFileSync(join(base, '.bpmnlintrc'), '{}');
    symlinkSync(join(loose, 'models'), join(outside, 'llink'), 'dir');
    expect(findBpmnlintConfig(join(outside, 'llink'))).toBeUndefined();
  });

  it('lintConfig false runs nothing; a document without a file looks up from lintFrom only', async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'x.bpmn': await model(LINE) });
    expect(await projectBpmnlint(join(dir, 'x.bpmnl'), { lintConfig: false })).toBeUndefined();
    expect(await projectBpmnlint(join(dir, 'x.bpmn'))).toMatchObject({ name: 'bpmnlint', blocks: false });
    expect(await projectBpmnlint(undefined, {})).toBeUndefined();
    expect(await projectBpmnlint(undefined, { lintFrom: dir })).toMatchObject({ name: 'bpmnlint', detail: '.bpmnlintrc in .' });
    // stdin (`validate -`): checkLoadedDoc
    const doc = await Doc.fromXml(await model([...LINE, { op: 'add', kind: 'task', after: 'userTask_check' }]));
    const checked = await checkLoadedDoc(doc, { lintFrom: dir });
    expect(codes(lintOf(checked.validation.errors))).toContain('label-required task_afterCheck');
    // a host's own validator named bpmnlint: the .bpmnlintrc's does not run as well
    expect(await projectBpmnlint(join(dir, 'x.bpmn'), { validators: [{ name: 'bpmnlint', validate: () => [] }] })).toBeUndefined();
  });

  it('--lint-config: a file that cannot be read or is not strict JSON is E_LINT_CONFIG; a broken discovered one is W_LINT_UNAVAILABLE and bpmnlint does not run', async () => {
    const dir = repo('{ // a comment\n "extends": "bpmnlint:recommended", }', { 'x.bpmn': await model(LINE), 'other.json': '{ "extends": "bpmnlint:recommended" }' });
    const file = join(dir, 'x.bpmn');
    for (const lintConfig of ['missing.json', '.bpmnlintrc']) {
      const err = await checkFile(file, { lintConfig, lintFrom: dir }).then(() => undefined, (failure: BpmnError) => failure);
      expect(err, lintConfig).toMatchObject({ code: 'E_LINT_CONFIG', category: 'io' });
    }
    const other = await checkFile(file, { lintConfig: 'other.json', lintFrom: dir });
    expect(other.validation.validators?.[0]).toMatchObject({ name: 'bpmnlint', detail: '--lint-config other.json' });
    const broken = await checkFile(file, { lintFrom: dir });
    expect(broken.validation.validators?.[0]).toMatchObject({ detail: '.bpmnlintrc in .; bpmnlint did not run (bpmn validate lists why)', counts: { errors: 0, warnings: 1 } });
    expect(broken.validation.warnings.find((warning) => warning.code === 'W_LINT_UNAVAILABLE')?.message).toMatch(/^\.bpmnlintrc is not JSON \(.*; bpmnlint reads it with JSON\.parse: no comments, no trailing commas\); bpmnlint did not run$/);
  });

  it('the settings (projectBpmnlintSettings): same lookup, normalised names, off included, a later bare flag drops options, unresolvable rules left out', async () => {
    const dir = repo({
      extends: ['bpmnlint:recommended', 'plugin:local/base'],
      rules: { '@miragon/bpmnlint-plugin-rules/element-id-naming': ['error', { case: 'PascalCase' }], 'label-required': 'off', 'local/r': 'warn', 'missing/x': 'warn' },
    });
    plugin(dir, 'bpmnlint-plugin-local', { configs: { base: { rules: { r: ['error', { a: 1 }] } } }, rules: { r: 'module.exports = () => ({ check() {} });' } });
    const settings = await projectBpmnlintSettings(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir });
    expect(settings?.path).toBe(join(dir, '.bpmnlintrc'));
    expect(settings?.rules['@miragon/rules/element-id-naming']).toEqual({ severity: 'error', config: { case: 'PascalCase' } });
    expect(settings?.rules['label-required']).toEqual({ severity: 'off', config: {} });
    expect(settings?.rules['local/r']).toEqual({ severity: 'warn', config: {} });
    expect(settings?.rules['missing/x']).toBeUndefined();
    expect(settings?.unavailable.map((unavailableEntry) => unavailableEntry.name)).toEqual(['missing/x']);
    expect(await projectBpmnlintSettings(join(dir, 'x.bpmn'), { lintConfig: false })).toBeUndefined();
    const jsonc = repo('{ "extends": "bpmnlint:recommended", }');
    const broken = await projectBpmnlintSettings(join(jsonc, 'x.bpmn'));
    expect(broken).toMatchObject({ rules: {}, unavailable: [{ kind: 'file' }] });
  });
});

describe('the resolver chain: bundled, shipped, project', () => {
  const chainOf = async (dir: string, projectCode = true) => {
    const loaded = await loadBpmnlint(join(dir, '.bpmnlintrc'), { projectCode, from: dir });
    if (!loaded.ok) throw new Error(loaded.detail);
    return { loaded, used: loaded.engine.resolver.used };
  };

  it('offline: the bundle answers recommended, @miragon/rules and camunda-compat 7-24; the moddle path maps to the plugin\'s descriptor', async () => {
    const xml = await (async () => {
      const created = (await newXml({ processName: 'Order', target: 'camunda7' })).xml;
      return (await applyToXml(created, LINE)).xml;
    })();
    for (const spelling of ['camunda-bpmn-moddle/resources/camunda.json', 'camunda-bpmn-moddle/resources/camunda']) {
      const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-automation', 'plugin:camunda-compat/camunda-platform-7-24'], moddleExtensions: { camunda: spelling } }, { 'x.bpmn': xml });
      const { loaded, used } = await chainOf(dir);
      expect(new Set(used.values()), spelling).toEqual(new Set(['bundled']));
      expect(loaded.resolved.unavailable, spelling).toEqual([]);
      expect(Object.keys(loaded.resolved.moddleExtensions), spelling).toEqual(['camunda']);
      const found = lintOf((await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true })).validation.warnings);
      // historyTimeToLive is read as camunda:historyTimeToLive (no false finding)
      expect(codes(found), spelling).not.toContain('camunda-compat/history-time-to-live order');
    }
    // without the moddle extension the attribute is unknown, as bpmnlint in CI would see it
    const bare = repo({ extends: ['plugin:camunda-compat/camunda-platform-7-24'] }, { 'x.bpmn': xml });
    const found = lintOf((await checkFile(join(bare, 'x.bpmn'))).validation.warnings);
    expect(codes(found)).toContain('camunda-compat/history-time-to-live order');
  });

  it('camunda-compat configs the bundle lacks come from the camunda-compat bpmn-cli ships (offline, no project code)', async () => {
    for (const config of ['camunda-cloud-1-3', 'camunda-cloud-1-0']) {
      const dir = repo({ extends: [`plugin:camunda-compat/${config}`] });
      const { loaded, used } = await chainOf(dir, false);
      expect(used.get(`config:bpmnlint-plugin-camunda-compat/${config}`), config).toBe('shipped');
      expect(loaded.resolved.unavailable, config).toEqual([]);
      expect(Object.keys(loaded.resolved.rules).length, config).toBeGreaterThan(0);
      expect(loaded.project).toEqual([]);
    }
  });

  it('bpmnlintEngine() for library hosts resolves the same offline: camunda-compat configs the bundle lacks, synchronously; what neither tier knows keeps the bundled resolver\'s error', async () => {
    const engine = bpmnlintEngine();
    const xml = (await applyToXml((await newXml({ processName: 'Order', target: 'camunda8' })).xml, LINE)).xml;
    for (const config of ['camunda-cloud-8-5', 'camunda-platform-7-20']) {
      const rc = { extends: [`plugin:camunda-compat/${config}`] };
      const resolved = await resolveBpmnlintConfig(engine, rc);
      expect(resolved.unavailable, config).toEqual([]);
      // the rules a .bpmnlintrc with the same configuration gets through the chain, and the same findings
      const dir = repo(rc, { 'x.bpmn': xml });
      const { loaded } = await chainOf(dir, false);
      expect(resolved.rules, config).toEqual(loaded.resolved.rules);
      expect(Object.keys(resolved.rules).length, config).toBeGreaterThan(0);
      const library = (await checkDoc(await Doc.fromXml(xml), { validators: [bpmnlintValidator(engine, resolved)] })).validation;
      const file = (await checkFile(join(dir, 'x.bpmn'))).validation;
      expect(codes(lintOf([...library.errors, ...library.warnings])), config).toEqual(codes(lintOf([...file.errors, ...file.warnings])));
    }
    expect(engine.resolver.resolveConfig('bpmnlint-plugin-camunda-compat', 'camunda-cloud-8-5')).toMatchObject({ rules: expect.any(Object) });
    expect(() => engine.resolver.resolveConfig('bpmnlint-plugin-camunda-compat', 'camunda-cloud-99-0')).toThrow('unknown config <bpmnlint-plugin-camunda-compat/camunda-cloud-99-0>');
    expect(() => engine.resolver.resolveRule('bpmnlint-plugin-acme', 'topic')).toThrow('unknown rule <bpmnlint-plugin-acme/topic>');
  });

  it('a project plugin runs from the repository\'s node_modules (named in the detail); a config the project answers pins its package', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:local/recommended', 'plugin:camunda-compat/camunda-cloud-99-0'], rules: { 'local/topic': ['info', { attr: 'topic' }] } }, { 'x.bpmn': await model([...LINE, { op: 'add', kind: 'serviceTask', name: 'Book', after: 'userTask_check' }]) });
    plugin(dir, 'bpmnlint-plugin-local', {
      configs: { recommended: { rules: { topic: 'error' } } },
      rules: { topic: "module.exports = (o = {}) => ({ check(node, reporter) { if (node.$type === 'bpmn:ServiceTask') reporter.report(node.id, `Service task has no ${o.attr ?? 'camunda:topic'}`); } });" },
    });
    plugin(dir, 'bpmnlint-plugin-camunda-compat', {
      version: '9.9.9',
      configs: { 'camunda-cloud-99-0': { rules: { 'history-time-to-live': 'warn' } } },
      rules: { 'history-time-to-live': "module.exports = () => ({ check(node, reporter) { if (node.$type === 'bpmn:Process') reporter.report(node.id, 'from the project'); } });" },
    });
    const { loaded, used } = await chainOf(dir);
    expect(loaded.project).toEqual(['bpmnlint-plugin-local@1.2.0', 'bpmnlint-plugin-camunda-compat@9.9.9']);
    expect(loaded.detail).toBe('.bpmnlintrc in .; project plugins: bpmnlint-plugin-local@1.2.0, bpmnlint-plugin-camunda-compat@9.9.9');
    expect(used.get('rule:bpmnlint-plugin-camunda-compat/history-time-to-live')).toBe('project');
    expect(used.get('rule:bpmnlint/label-required')).toBe('bundled');
    const found = lintOf((await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir })).validation.warnings);
    // info -> warning, options from the .bpmnlintrc
    expect(found.map((finding) => `${finding.code} ${finding.element}: ${finding.message}`)).toEqual(['local/topic serviceTask_book: Service task has no topic', 'camunda-compat/history-time-to-live order: from the project']);
    // a host that does not run project code (the library default)
    const nocode = await chainOf(dir, false);
    expect(nocode.loaded.resolved.unavailable.map((unavailableEntry) => `${unavailableEntry.name}: ${unavailableEntry.reason}`)).toEqual([
      'plugin:local/recommended: bpmnlint-plugin-local is not bundled with bpmn-cli, and this host does not run project plugins (lintProjectCode)',
      'plugin:camunda-compat/camunda-cloud-99-0: bpmnlint-plugin-camunda-compat 2.61.1 (bundled with bpmn-cli) has no config camunda-cloud-99-0, and this host does not run project plugins (lintProjectCode)',
      'local/topic: bpmnlint-plugin-local is not bundled with bpmn-cli, and this host does not run project plugins (lintProjectCode)',
    ]);
  });

  it('project code only from inside the repository: a plugin above the .git root and a moddle module do not run; a JSON descriptor loads', async () => {
    const outer = join(top, 'outer-bounds');
    const marker = join(outer, 'RAN.txt');
    plugin(outer, 'bpmnlint-plugin-up', { main: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { configs: { recommended: { rules: {} } } };` });
    const dir = repo({ extends: 'plugin:up/recommended', moddleExtensions: { x: './tools/x.cjs', y: './tools/y.json' } }, {
      'x.bpmn': await model(LINE),
      'tools/x.cjs': `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = { name: 'X', prefix: 'x', uri: 'http://x', types: [] };`,
      'tools/y.json': JSON.stringify({ name: 'Y', prefix: 'y', uri: 'http://y', types: [] }),
    }, outer);
    const checked = await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir });
    expect(existsSync(marker)).toBe(false);
    const messages = checked.validation.warnings.filter((warning) => warning.code === 'W_LINT_UNAVAILABLE').map((warning) => warning.message);
    expect(messages).toEqual([
      expect.stringMatching(/^plugin:up\/recommended left out: bpmnlint-plugin-up resolves outside the repository \(.*bpmnlint-plugin-up.index\.js\); bpmn-cli loads project plugins only from inside .*repo\d+$/),
      'moddle extension x (./tools/x.cjs) left out: only JSON descriptors are loaded (tools/x.cjs); rules reading x: properties may report findings that are not there',
    ]);
    const loaded = await loadBpmnlint(join(dir, '.bpmnlintrc'), { projectCode: true });
    expect(loaded.ok && Object.keys(loaded.resolved.moddleExtensions)).toEqual(['y']);
  });

  it('what cannot be resolved is named once per package and reason, with a hint; the rest runs', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:missing/recommended'], rules: { 'missing/foo': 'error', 'nope-rule': 'warn', 'miragon/element-id-naming': 'warn' } }, { 'x.bpmn': await model([...LINE, { op: 'add', kind: 'task', after: 'userTask_check' }]) });
    const checked = await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir });
    const unavailable = checked.validation.warnings.filter((warning) => warning.code === 'W_LINT_UNAVAILABLE').map((warning) => `${warning.message}  (${warning.hint})`);
    expect(unavailable).toEqual([
      'plugin:missing/recommended, missing/foo left out: bpmnlint-plugin-missing is not installed (looked up from .)  (Install it next to the .bpmnlintrc (npm i -D bpmnlint-plugin-missing) or remove it from the configuration; --no-lint-config skips bpmnlint.)',
      'nope-rule left out: bpmnlint 11.15.0 has no rule nope-rule  (bpmn-cli runs bpmnlint 11.15.0; update bpmn-cli or remove the rule.)',
      'miragon/element-id-naming left out: bpmnlint-plugin-miragon is not installed (looked up from .)  (Did you mean @miragon/rules/element-id-naming? bpmn-cli bundles that rule.)',
    ]);
    expect(codes(lintOf(checked.validation.errors))).toContain('label-required task_afterCheck');
    // no rule: validate's text never folds them, each keeps its hint
    const text = renderValidation(validationReport(checked)).split('\n');
    expect(text.filter((outputLine) => outputLine.startsWith('[bpmnlint] W_LINT_UNAVAILABLE'))).toEqual(unavailable.map((unavailableLine) => `[bpmnlint] W_LINT_UNAVAILABLE: ${unavailableLine}`));
    // a write counts them, and its validator line says they are there
    expect(checked.validation.validators?.[0]?.detail).toBe('.bpmnlintrc in .; 3 left out (W_LINT_UNAVAILABLE; bpmn validate lists them)');
  });

  it('a library host without lintProjectCode is not told to install a package it would not run (in a repository of its user, outside one)', async () => {
    const rc = { rules: { 'camunda-compat/no-such-rule': 'warn', 'missing/foo': 'warn' } };
    const inRepo = repo(rc);
    const outside = join(top, 'outside-hints');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, '.bpmnlintrc'), JSON.stringify(rc));
    const hints = async (dir: string) => (await projectBpmnlintSettings(join(dir, 'x.bpmn'), { lintFrom: dir }))?.unavailable.map((unavailableEntry) => `${unavailableEntry.name}: ${unavailableEntry.hint}`);
    expect(await hints(inRepo)).toEqual([
      'camunda-compat/no-such-rule: Check the name; a newer bpmnlint-plugin-camunda-compat installed in the repository next to the .bpmnlintrc is used only when the host passes lintProjectCode: true.',
      'missing/foo: Remove it from the configuration, or install it next to the .bpmnlintrc (npm i -D bpmnlint-plugin-missing) and let the host pass lintProjectCode: true.',
    ]);
    expect(await hints(outside)).toEqual([
      'camunda-compat/no-such-rule: Check the name; a newer bpmnlint-plugin-camunda-compat installed next to the .bpmnlintrc would not be used either: this host does not run project plugins (lintProjectCode), and bpmn-cli runs project plugins only inside a git repository (the .bpmnlintrc in . is in none).',
      'missing/foo: Remove it from the configuration; installing it would not help: this host does not run project plugins (lintProjectCode), and bpmn-cli runs project plugins only inside a git repository (the .bpmnlintrc in . is in none).',
    ]);
  });

  it('a project plugin that fails to load is named with its error', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:bad/recommended'] }, { 'x.bpmn': await model(LINE) });
    plugin(dir, 'bpmnlint-plugin-bad', { main: "throw new Error('cannot start');" });
    const checked = await checkFile(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir });
    expect(checked.validation.warnings.filter((warning) => warning.code === 'W_LINT_UNAVAILABLE').map((warning) => `${warning.message}  (${warning.hint})`)).toEqual([
      'plugin:bad/recommended left out: bpmnlint-plugin-bad fails to load: cannot start  (Fix or reinstall bpmnlint-plugin-bad; --no-lint-config skips bpmnlint.)',
    ]);
  });
});

describe('a long-running host: the load cache follows what the .bpmnlintrc left out or read from the project', () => {
  const ALWAYS = "module.exports = () => ({ check(node, reporter) { if (node.$type === 'bpmn:Process') reporter.report(node.id, 'always'); } });";
  const descriptor = (prefix: string, uri = `http://${prefix}`) => JSON.stringify({ name: prefix.toUpperCase(), prefix, uri, types: [] });

  it('a plugin or moddle package installed after the hint, and a descriptor fixed or edited, are picked up by the next call in the same process', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:local/recommended'], moddleExtensions: { y: './tools/y.json', z: 'z-moddle/resources/z' } }, { 'x.bpmn': await model(LINE), 'tools/y.json': '{ broken' });
    const opts = { lintProjectCode: true, lintFrom: dir };
    const left = async () => (await projectBpmnlintSettings(join(dir, 'x.bpmn'), opts))!.unavailable.map((unavailableEntry) => `${unavailableEntry.name}: ${unavailableEntry.reason}`);
    expect(await left()).toEqual([
      'plugin:local/recommended: bpmnlint-plugin-local is not installed (looked up from .)',
      expect.stringMatching(/^y: cannot be read \(/),
      'z: not installed (looked up from .); bpmn-cli brings camunda-bpmn-moddle/resources/camunda.json and zeebe-bpmn-moddle/resources/zeebe.json only',
    ]);
    // the hint's npm i -D: the plugin runs from the next call on
    plugin(dir, 'bpmnlint-plugin-local', { configs: { recommended: { rules: { always: 'warn' } } }, rules: { always: ALWAYS } });
    expect(await left()).toEqual([expect.stringMatching(/^y: cannot be read/), expect.stringMatching(/^z: not installed/)]);
    expect(codes(lintOf((await checkFile(join(dir, 'x.bpmn'), opts)).validation.warnings))).toContain('local/always order');
    // the descriptor fixed, the moddle package installed
    writeFileSync(join(dir, 'tools', 'y.json'), descriptor('y'));
    expect(await left()).toEqual([expect.stringMatching(/^z: not installed/)]);
    mkdirSync(join(dir, 'node_modules', 'z-moddle', 'resources'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'z-moddle', 'resources', 'z.json'), descriptor('z'));
    expect(await left()).toEqual([]);
    // nothing changed: the same load; an edited descriptor of the project: a new load with it
    const rc = join(dir, '.bpmnlintrc');
    const before = await loadBpmnlint(rc, { projectCode: true, from: dir });
    expect(await loadBpmnlint(rc, { projectCode: true, from: dir })).toBe(before);
    expect(before.ok && Object.keys(before.resolved.moddleExtensions)).toEqual(['y', 'z']);
    writeFileSync(join(dir, 'tools', 'y.json'), descriptor('y', 'http://example.com/y/2'));
    const edited = await loadBpmnlint(rc, { projectCode: true, from: dir });
    expect(edited).not.toBe(before);
    expect(edited.ok && edited.resolved.moddleExtensions['y']).toMatchObject({ uri: 'http://example.com/y/2' });
    expect(await loadBpmnlint(rc, { projectCode: true, from: dir })).toBe(edited);
  });

  it('a project plugin that failed to load is loaded again once it is fixed; a library host without lintProjectCode gets the hint for the installed package', async () => {
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:bad/recommended'] }, { 'x.bpmn': await model(LINE) });
    const pkg = plugin(dir, 'bpmnlint-plugin-bad', { main: "throw new Error('cannot start');" });
    const left = async (lintProjectCode: boolean) => (await projectBpmnlintSettings(join(dir, 'x.bpmn'), { lintProjectCode, lintFrom: dir }))!.unavailable.map((unavailableEntry) => `${unavailableEntry.name}: ${unavailableEntry.reason}`);
    expect(await left(true)).toEqual(['plugin:bad/recommended: bpmnlint-plugin-bad fails to load: cannot start']);
    writeFileSync(join(pkg, 'index.js'), `module.exports = { configs: { recommended: { rules: { always: 'error' } } } };`);
    writeFileSync(join(pkg, 'rules', 'always.js'), ALWAYS);
    expect(await left(true)).toEqual([]);
    // the host that does not run project code: not installed -> installed changes the reason
    const other = repo({ extends: ['plugin:later/recommended'] });
    const hostLeft = async () => (await projectBpmnlintSettings(join(other, 'x.bpmn'), { lintFrom: other }))!.unavailable.map((unavailableEntry) => `${unavailableEntry.name}: ${unavailableEntry.reason}`);
    expect(await hostLeft()).toEqual(['plugin:later/recommended: bpmnlint-plugin-later is not installed (looked up from .)']);
    plugin(other, 'bpmnlint-plugin-later', { configs: { recommended: { rules: {} } } });
    expect(await hostLeft()).toEqual(['plugin:later/recommended: bpmnlint-plugin-later is not bundled with bpmn-cli, and this host does not run project plugins (lintProjectCode)']);
  });

  it('a plugin and a moddle package found above the repository, then installed inside it as the hint says, are used from the next call (Node remembers where it found a package)', async () => {
    // a monorepo parent or ~ with its own node_modules
    const parent = join(top, 'above');
    const moddle = (base: string) => {
      mkdirSync(join(base, 'node_modules', 'z-moddle', 'resources'), { recursive: true });
      writeFileSync(join(base, 'node_modules', 'z-moddle', 'resources', 'z.json'), descriptor('z'));
    };
    plugin(parent, 'bpmnlint-plugin-outer', { configs: { recommended: { rules: { always: 'warn' } } }, rules: { always: ALWAYS } });
    moddle(parent);
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:outer/recommended'], moddleExtensions: { z: 'z-moddle/resources/z' } }, { 'x.bpmn': await model(LINE) }, parent);
    const opts = { lintProjectCode: true, lintFrom: dir };
    const left = async () => (await projectBpmnlintSettings(join(dir, 'x.bpmn'), opts))!.unavailable.map((unavailableEntry) => `${unavailableEntry.name}: ${unavailableEntry.reason} (${unavailableEntry.hint})`);
    expect(await left()).toEqual([
      expect.stringMatching(/^plugin:outer\/recommended: bpmnlint-plugin-outer resolves outside the repository \(.*\(Install it inside the repository \(npm i -D bpmnlint-plugin-outer\)\.\)$/),
      expect.stringMatching(/^z: not installed \(looked up from \.\);.*\(Install its package next to the \.bpmnlintrc/),
    ]);
    // nothing changed: the same answer
    expect(await left()).toHaveLength(2);
    plugin(dir, 'bpmnlint-plugin-outer', { configs: { recommended: { rules: { always: 'error' } } }, rules: { always: ALWAYS } });
    expect(await left()).toEqual([expect.stringMatching(/^z: not installed/)]);
    const loaded = await loadBpmnlint(join(dir, '.bpmnlintrc'), { projectCode: true, from: dir });
    expect(loaded.ok && loaded.project).toEqual(['bpmnlint-plugin-outer@1.2.0']);
    expect(loaded.ok && loaded.resolved.rules['outer/always']).toMatchObject({ severity: 'error' });
    moddle(dir);
    expect(await left()).toEqual([]);
    const checked = (await checkFile(join(dir, 'x.bpmn'), opts)).validation;
    expect(codes(lintOf(checked.errors))).toContain('outer/always order');
  });

  it('a package or descriptor that appears while the load runs is seen by the next call (the state is taken before the load looks)', async () => {
    // a project plugin that writes the moddle descriptor when it is required: npm i finishing while the host lints
    const dir = repo({ extends: ['bpmnlint:recommended', 'plugin:setup/recommended'], moddleExtensions: { z: 'z-moddle/resources/z' } }, { 'x.bpmn': await model(LINE) });
    const zModdleResources = join(dir, 'node_modules', 'z-moddle', 'resources');
    plugin(dir, 'bpmnlint-plugin-setup', { main: `require('fs').mkdirSync(${JSON.stringify(zModdleResources)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(join(zModdleResources, 'z.json'))}, ${JSON.stringify(descriptor('z'))});\nmodule.exports = { configs: { recommended: { rules: {} } } };` });
    const left = async () => (await projectBpmnlintSettings(join(dir, 'x.bpmn'), { lintProjectCode: true, lintFrom: dir }))!.unavailable.map((unavailableEntry) => unavailableEntry.name);
    expect(await left()).toEqual(['z']);
    expect(await left()).toEqual([]);
    expect(await left()).toEqual([]);
  });
});

describe('writes and validate with a .bpmnlintrc (in process)', () => {
  const RC = { extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-automation'], rules: { 'no-overlapping-elements': 'off', 'missing/x': 'warn' } };

  it('a write lists the findings it added ([bpmnlint error] in text), never refuses for them, and counts the rest; the bytes are those without bpmnlint (both follow element-id-naming\'s defaults)', async () => {
    const dir = repo(RC, { 'x.bpmn': (await model(LINE)).replaceAll('userTask_check', 'Activity_Check') });
    const file = join(dir, 'x.bpmn');
    const ops: EditCommand[] = [{ op: 'add', kind: 'task', after: 'Activity_Check' }];
    const plain = await mutateFile(file, ops, { dryRun: true, lintConfig: false });
    const mutated = await mutateFile(file, ops, { dryRun: true, lintFrom: dir });
    // recommended-for-automation turns element-id-naming on with its defaults: the ids new ids take anyway (#34)
    expect(mutated.xml).toBe(plain.xml);
    expect(mutated.changes.created.map((createdElement) => createdElement.id)).toEqual(['task_afterCheck', 'flow_afterCheckToDone']);
    const report = mutationReport(mutated);
    // no element-id-naming finding is added
    expect(codes(lintOf(report.warnings.added))).toEqual(['label-required task_afterCheck']);
    expect(codes(lintOf(report.warnings.resolved))).toEqual([]);
    expect(lintOf(report.warnings.added)[0]).toMatchObject({ severity: 'error' });
    // W_LINT_UNAVAILABLE is the same before and after: counted, not added
    expect(codes(report.warnings.added)).not.toContain('W_LINT_UNAVAILABLE');
    const validatorEntry = report.validation.validators?.find((validator) => validator.name === 'bpmnlint');
    expect(validatorEntry).toMatchObject({ blocks: false, errors: [], preexisting: [] });
    const text = renderMutation(report);
    expect(text).toContain('warning [bpmnlint error] label-required task_afterCheck: Element is missing label/name\n');
    const kept = validatorEntry!.counts.errors + validatorEntry!.counts.warnings - 1;
    expect(text).toContain(`\nvalidator bpmnlint (.bpmnlintrc in .; 1 left out (W_LINT_UNAVAILABLE; bpmn validate lists it)): ${validatorEntry!.counts.errors} error(s), ${validatorEntry!.counts.warnings} warning(s) in the result (1 added, ${validatorEntry!.resolved.length} resolved, ${kept} already in the file)\n`);
    expect(text).not.toContain('\nconventions:');
    // --summary has no validator line: its count line counts the old findings (the library form of the CLI's --summary)
    const summary = renderSummary(mutationSummary(report), { advisory: advisoryValidators(report) });
    expect(summary).toContain(`\nwarnings: ${report.warnings.added.length} added, ${report.warnings.resolved.length} resolved, ${report.warnings.preexistingCount + kept} already in the file\n`);
    expect(kept).toBeGreaterThan(0);
    // what a removal fixes is resolved, a renamed element keeps its findings
    const renamed = mutationReport(await mutateFile(file, [{ op: 'set', id: 'Activity_Check', values: { id: 'userTask_check' } }], { dryRun: true, lintFrom: dir }));
    expect(codes(lintOf(renamed.warnings.added))).toEqual([]);
    expect(codes(lintOf(renamed.warnings.resolved))).toEqual(['@miragon/rules/element-id-naming Activity_Check']);
  });

  it('a moddle descriptor on disk BpmnModdle rejects is left out and counted, the rules run in validate and writes; with one it cannot parse with, a write says that no rule ran', async () => {
    const loose = await model([...LINE, { op: 'add', kind: 'task', in: 'order' }]);
    const dup = { name: 'Dup', prefix: 'bpmn', uri: 'http://example.org/dup', types: [] };
    const dir = repo({ extends: 'bpmnlint:recommended', moddleExtensions: { dup: './moddle/dup.json' } }, { 'moddle/dup.json': JSON.stringify(dup), 'x.bpmn': loose });
    const file = join(dir, 'x.bpmn');
    const report = validationReport(await checkFile(file, { lintFrom: dir }));
    expect(codes(lintOf(report.errors))).toEqual(['label-required task_task', 'no-disconnected task_task', 'no-implicit-end task_task', 'no-implicit-start task_task']);
    const text = renderValidation(report);
    expect(text).toContain('\n[bpmnlint] W_LINT_UNAVAILABLE: moddle extension dup (./moddle/dup.json) left out: BpmnModdle rejects it (package with prefix <bpmn> already defined); rules reading dup: properties may report findings that are not there  (Fix the descriptor, or remove the moddleExtensions entry; bpmnlint in CI fails on the whole file with it.)\n');
    expect(text).toContain('\nvalidator bpmnlint (.bpmnlintrc in .; 1 left out (W_LINT_UNAVAILABLE; bpmn validate lists it)): 4 error(s), 1 warning(s) in the file\n');
    const named = mutationReport(await mutateFile(file, [{ op: 'set', id: 'task_task', values: { name: 'Loose' } }], { dryRun: true, lintFrom: dir }));
    expect(codes(lintOf(named.warnings.resolved))).toEqual(['label-required task_task']);
    expect(renderMutation(named)).toContain('\nvalidator bpmnlint (.bpmnlintrc in .; 1 left out (W_LINT_UNAVAILABLE; bpmn validate lists it)): 3 error(s), 1 warning(s) in the result (0 added, 1 resolved, 4 already in the file)\n');

    const broken = repo({ extends: 'bpmnlint:recommended', moddleExtensions: { x: './x.json' } }, { 'x.json': JSON.stringify(REDEFINES_NOTHING), 'x.bpmn': loose });
    expect(codes((await checkFile(join(broken, 'x.bpmn'), { lintFrom: broken })).validation.warnings)).toContain('W_LINT_FAILED');
    const failed = mutationReport(await mutateFile(join(broken, 'x.bpmn'), [{ op: 'set', id: 'task_task', values: { name: 'Loose' } }], { dryRun: true, lintFrom: broken }));
    expect(failed.validation.validators![0]).toMatchObject({ resolved: [], counts: { errors: 0, warnings: 1 }, leftOut: [{ reason: 'W_LINT_FAILED, no rule ran', count: 1 }] });
    expect(renderMutation(failed)).toContain('\nvalidator bpmnlint (.bpmnlintrc in .): 0 error(s), 1 warning(s) in the result (0 added, 0 resolved, 0 already in the file, 1 left out (W_LINT_FAILED, no rule ran; `bpmn validate <file>` lists it))\n');
    // --summary says that no rule ran
    expect(mutationSummary(failed).leftOut).toEqual([{ validator: 'bpmnlint', reason: 'W_LINT_FAILED, no rule ran', count: 1 }]);
    expect(renderSummary(mutationSummary(failed), { dryRun: true }).split('\n')).toContain('validator bpmnlint: 1 left out (W_LINT_FAILED, no rule ran; `bpmn validate <file>` lists it)');
    // a new file has nothing to compare: it lists the W_LINT_FAILED with its cause and hint
    const { mutateDocToFile } = await import('../../../../src/node.js');
    const created = mutationReport(await mutateDocToFile(Doc.create({ processName: 'Order' }, join(broken, 'new.bpmn')), [], { mustNotExist: true, dryRun: true, lintFrom: broken }));
    expect(codes(lintOf(created.warnings.added))).toEqual(['W_LINT_FAILED']);
    expect(created.validation.validators![0]).not.toHaveProperty('leftOut');
    const createdText = renderMutation(created, { dryRun: true });
    expect(createdText).toContain("\nwarning [bpmnlint] W_LINT_FAILED: bpmnlint could not lint the model: refined property <bpmn:x> not found  (No rule ran. Check the .bpmnlintrc's moddleExtensions");
    expect(createdText).toContain('\nvalidator bpmnlint (.bpmnlintrc in .): 0 error(s), 1 warning(s) in the result (1 added, 0 resolved, 0 already in the file)\n');
  });

  it('a lint warning the change resolved that a bpmnlint finding covers is listed once, as that finding', async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'x.bpmn': (await newXml({ processName: 'Order' })).xml });
    const mutation = mutationReport(await mutateFile(join(dir, 'x.bpmn'), [{ op: 'add', kind: 'start', name: 'Received' }], { dryRun: true }));
    expect(codes(mutation.warnings.resolved)).toEqual(['start-event-required order']);
  });

  it('`new` lists the findings of the new model; lintBlocks makes bpmnlint block a write like a validator, old errors do not', async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' });
    const doc = Doc.create({ processName: 'Order' }, join(dir, 'new.bpmn'));
    const { mutateDocToFile } = await import('../../../../src/node.js');
    const created = await mutateDocToFile(doc, [], { mustNotExist: true });
    expect(codes(lintOf(mutationReport(created).warnings.added))).toEqual(['end-event-required order', 'start-event-required order']);
    expect(created.validation.validators?.[0]?.counts).toEqual({ errors: 2, warnings: 0 });
    // and validate fails on them (exit 2 in the CLI)
    expect((await checkFile(join(dir, 'new.bpmn'))).validation.errors.length).toBe(2);
    const err = await mutateFile(join(dir, 'new.bpmn'), [{ op: 'add', kind: 'task', in: 'order' }], { lintBlocks: true }).then(() => undefined, (failure: BpmnError) => failure);
    expect(err).toMatchObject({ code: 'E_VALIDATION' });
    expect(String(err?.details.hint)).toContain("The project's bpmnlint blocks here because the host asked for it (lintBlocks).");
    const fine = await mutateFile(join(dir, 'new.bpmn'), [{ op: 'set', id: 'order', values: { name: 'Orders' } }], { lintBlocks: true, dryRun: true });
    expect(fine.validation.validators?.[0]).toMatchObject({ errors: [], preexisting: [expect.objectContaining({ code: 'end-event-required' }), expect.objectContaining({ code: 'start-event-required' })] });
  });

  it('validate folds an advisory rule with three or more findings into one line; --json keeps every finding; a write groups by rule and message', async () => {
    const dir = repo(RC, { 'gallery.bpmn': fixture('render/gallery.bpmn') });
    const report = validationReport(await checkFile(join(dir, 'gallery.bpmn'), { lintFrom: dir }));
    const all = lintOf([...report.errors, ...report.warnings]);
    const text = renderValidation(report);
    const lines = text.split('\n').filter((outputLine) => /^\[bpmnlint( error)?\] /.test(outputLine));
    // one line per rule and hint (W_LINT_* is no rule: one line each)
    const byRule = new Map<string, number>();
    for (const finding of all) {
      const key = finding.code.startsWith('W_LINT_') ? `${finding.code}|${byRule.size}` : `${finding.code}|${finding.hint ?? ''}`;
      byRule.set(key, (byRule.get(key) ?? 0) + 1);
    }
    expect(lines.length).toBe([...byRule.values()].reduce((total, count) => total + (count >= 3 ? 1 : count), 0));
    expect(lines.length).toBeLessThan(all.length / 3);
    // an error reads [bpmnlint error], a warning [bpmnlint]
    for (const finding of all) {
      expect(lines.some((outputLine) => outputLine.startsWith(`[bpmnlint${finding.severity === 'error' ? ' error' : ''}] ${finding.code}`)), finding.code).toBe(true);
    }
    const naming = lines.find((outputLine) => outputLine.startsWith('[bpmnlint] @miragon/rules/element-id-naming x'))!;
    const [, listed, convention] = naming.match(/^\[bpmnlint\] @miragon\/rules\/element-id-naming x\d+ \[([^\]]+)\]: (Element id must match the naming convention <\w+>) \(\d+ of \d+; \d+ others with \d+ other messages, --json lists them\)$/)!;
    // the ids listed are those with the message shown
    const ids = listed!.split(', ').filter((id) => !id.startsWith('+'));
    expect(ids.length).toBeGreaterThan(2);
    for (const id of ids) {
      expect(all.find((finding) => finding.code === '@miragon/rules/element-id-naming' && finding.element === id)?.message, id).toBe(convention);
    }
    const loose = ['A', 'B', 'C'].map((name): EditCommand => ({ op: 'add', kind: 'task', name, in: 'Process_RenderGallery' }));
    const write = renderMutation(mutationReport(await mutateFile(join(dir, 'gallery.bpmn'), loose, { dryRun: true, lintFrom: dir })));
    expect(write).toMatch(/^warning \[bpmnlint error\] no-disconnected x3 \[task_a, task_b, task_c\]: Element is not connected$/m);
  });
});

describe('the id conventions of the .bpmnlintrc (#34, in process)', () => {
  const AUTOMATION = { extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-automation'] };
  const ADD: EditCommand[] = [{ op: 'add', kind: 'serviceTask', name: 'Ship', after: 'userTask_check' }];

  it('element-id-naming of the .bpmnlintrc decides the new ids; lintConfig false, a host\'s own conventions or its own bpmnlint validator switch the lookup off', async () => {
    const dir = repo({ ...AUTOMATION, rules: { [ID_NAMING_RULE]: ['warn', { case: 'PascalCase' }] } }, { 'x.bpmn': await model(LINE) });
    const file = join(dir, 'x.bpmn');
    const ids = async (opts: Parameters<typeof mutateFile>[2]) => (await mutateFile(file, ADD, { dryRun: true, lintFrom: dir, ...opts })).changes.created.map((createdElement) => createdElement.id);
    expect(await ids({})).toEqual(['serviceTask_Ship', 'flow_ShipToDone']);
    expect(await ids({ lintConfig: false })).toEqual(['serviceTask_ship', 'flow_shipToDone']);
    expect(await ids({ conventions: { prefixes: { 'bpmn:ServiceTask': 'svc_' }, case: 'PascalCase' } })).toEqual(['svc_Ship', 'sequenceFlow_ShipToDone']);
    const own = bpmnlintValidator(bpmnlintEngine(), await resolveBpmnlintConfig(bpmnlintEngine(), { extends: 'bpmnlint:recommended' }));
    expect(await ids({ validators: [own] })).toEqual(['serviceTask_ship', 'flow_shipToDone']);
  });

  it('a value new ids cannot follow is one W_CONFIG_IGNORED of the validator: validate and `new` list it, a write only counts it', async () => {
    const rc = { extends: 'bpmnlint:recommended', rules: { '@miragon/rules/element-id-naming': ['warn', { case: 'camelcase', prefixes: { 'bpmn:UserTask': 'user task_' } }] } };
    const dir = repo(rc, { 'x.bpmn': await model(LINE) });
    const file = join(dir, 'x.bpmn');
    const notes = (issues: readonly unknown[]) => lintOf(issues).filter((issue) => issue.code === 'W_CONFIG_IGNORED');
    const checked = await checkFile(file, { lintFrom: dir });
    expect(notes(checked.validation.warnings).map((note) => note.message)).toEqual([
      '.bpmnlintrc in .: @miragon/rules/element-id-naming case "camelcase" is unknown: the rule checks PascalCase, and new ids take it',
      ".bpmnlintrc in .: @miragon/rules/element-id-naming prefix of bpmn:UserTask \"user task_\" cannot start an id (a letter or _ first, then letters, digits, _ . -, at most 56 characters): new ids of the type take bpmn-cli's own prefix, and the rule reports them",
    ]);
    expect(renderValidation(validationReport(checked))).toMatch(/^\[bpmnlint\] W_CONFIG_IGNORED: \.bpmnlintrc in \.: @miragon\/rules\/element-id-naming case "camelcase" is unknown: .* {2}\(Write one of camelCase, PascalCase, snake_case, kebab-case, any in the \.bpmnlintrc\. Did you mean camelCase\?\)$/m);
    const write = await mutateFile(file, [...ADD, { op: 'add', kind: 'userTask', name: 'Approve', after: 'userTask_check' }], { dryRun: true, lintFrom: dir });
    // the user task's prefix is ignored: bpmn-cli's own prefix, in the case the rule checks
    expect(write.changes.created.map((createdElement) => createdElement.id)).toEqual(['serviceTask_Ship', 'flow_ShipToDone', 'userTask_Approve', 'flow_ApproveToShip']);
    const report = mutationReport(write);
    expect(notes(report.warnings.added)).toEqual([]);
    expect(renderMutation(report)).toContain('\nvalidator bpmnlint (.bpmnlintrc in .; 2 element-id-naming values ignored (W_CONFIG_IGNORED; bpmn validate lists them)): ');
    const { mutateDocToFile } = await import('../../../../src/node.js');
    const created = await mutateDocToFile(Doc.create({ processName: 'Order' }, join(dir, 'new.bpmn')), [], { dryRun: true, lintFrom: dir });
    expect(notes(mutationReport(created).warnings.added)).toHaveLength(2);
    // stdin: looked up from lintFrom
    expect(notes((await checkLoadedDoc(await Doc.fromXml(readFileSync(file, 'utf8')), { lintFrom: dir })).validation.warnings)).toHaveLength(2);
  });

  it('projectIdConventions: the conventions, the notes, the setting; nothing without a .bpmnlintrc or with lintConfig false', async () => {
    const { projectIdConventions } = await import('../../../../src/node.js');
    const dir = repo(AUTOMATION, { 'x.bpmn': await model(LINE) });
    const found = await projectIdConventions(join(dir, 'x.bpmn'), { lintFrom: dir });
    expect(found).toMatchObject({ notes: [], where: '.bpmnlintrc in .', setting: { severity: 'warn', config: {} }, conventions: { case: 'camelCase', qualifier: 'optional', source: '.bpmnlintrc in .' } });
    expect(found!.conventions!.prefixes['bpmn:UserTask']).toBe('userTask_');
    expect(await projectIdConventions(join(dir, 'x.bpmn'), { lintConfig: false })).toBeUndefined();
    expect(await projectIdConventions(join(repo(undefined), 'x.bpmn'))).toBeUndefined();
    // the rule off (as in recommended-for-modeling): nothing declared
    const modeling = repo({ extends: 'plugin:@miragon/rules/recommended-for-modeling' });
    expect((await projectIdConventions(join(modeling, 'x.bpmn'), { lintFrom: modeling }))?.conventions).toBeUndefined();
  });

  it('a .bpmnlintrc without element-id-naming, or with it off, writes every byte as without a .bpmnlintrc (the fixtures)', async () => {
    const fixtures = readdirSync(join(ROOT, 'test', 'fixtures'), { recursive: true, encoding: 'utf8' }).filter((fixturePath) => fixturePath.endsWith('.bpmn'));
    expect(fixtures.length).toBeGreaterThan(40);
    const off = repo({ extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-modeling'], rules: { '@miragon/rules/element-id-naming': 'off' } });
    const absent = repo({ extends: 'bpmnlint:recommended' });
    const compared: string[] = [];
    for (const fixture of fixtures) {
      const text = readFileSync(join(ROOT, 'test', 'fixtures', fixture), 'utf8');
      const doc = await Doc.fromXml(text).catch(() => undefined);
      const process = doc?.processes()[0]?.get<string>('id');
      const flow = doc ? [...doc.byId().values()].find((el) => el.$type === 'bpmn:SequenceFlow')?.get<string>('id') : undefined;
      if (!doc || !process || doc.lossyImportWarnings.length) continue;
      const ops: EditCommand[] = [
        { op: 'add', kind: 'serviceTask', name: 'Conventions probe', in: process },
        { op: 'add', kind: 'xor', in: process },
        { op: 'add', kind: 'startEvent:timer', name: '2 days', in: process, timer: 'P2D' },
        ...(flow ? [{ op: 'add', kind: 'task', name: 'Spliced probe', flow } as EditCommand] : []),
      ];
      const results: string[] = [];
      for (const dir of [off, absent, undefined]) {
        const file = join(dir ?? top, `probe-${compared.length}.bpmn`);
        writeFileSync(file, text);
        const outcome = await mutateFile(file, ops, { dryRun: true, ...(dir ? { lintFrom: dir } : { lintConfig: false }) }).then(
          (mutatedFile) => `${mutatedFile.xml}\n${JSON.stringify(mutatedFile.changes.created)}`,
          (failure: BpmnError) => `${failure.code} ${failure.message}`,
        );
        results.push(outcome);
      }
      expect(results[0], fixture).toBe(results[2]);
      expect(results[1], fixture).toBe(results[2]);
      compared.push(fixture);
    }
    expect(compared.length).toBeGreaterThan(30);
  }, 120000);
});

describe('the library examples (docs/library.md, docs/validators.md)', () => {
  it('bpmnlintEngine + resolveBpmnlintConfig + bpmnlintValidator in applyToXml; the engine default of the plugin', async () => {
    const library = readFileSync(join(ROOT, 'docs', 'library.md'), 'utf8');
    for (const line of [
      'const engine = bpmnlintEngine();',
      "const resolved = await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended' });",
      "const lint = bpmnlintValidator(engine, resolved, { detail: 'our rules' });",
      'const edit = await applyToXml(xml, ops, { validators: [lint] });',
    ]) {
      expect(codeOf(library)).toContain(codeOf(line));
    }
    const engine = bpmnlintEngine();
    const resolved = await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended' });
    const lint = bpmnlintValidator(engine, resolved, { detail: 'our rules' });
    const edit = await applyToXml(await model(LINE), [{ op: 'add', kind: 'task', after: 'userTask_check' }], { validators: [lint] });
    expect(edit.result.warnings.added).toContainEqual(expect.objectContaining({ code: 'label-required', validator: 'bpmnlint', severity: 'error' }));
    // docs/validators.md: the plugin's default for an engine (a descriptor object as moddle extension), which turns element-id-naming on
    const validators = readFileSync(join(ROOT, 'docs', 'validators.md'), 'utf8');
    for (const line of [
      "const rc = engine.plugin.getDefaultLintConfig({ engine: 'c7' });",
      'const resolved = await resolveBpmnlintConfig(engine, rc);',
      'const { conventions, notes } = idConventionsFromLint(resolved.rules[ID_NAMING_RULE], engine.plugin.naming);',
      "const lint = bpmnlintValidator(engine, resolved, { detail: 'default rules', notes });",
      'await applyToXml(xml, ops, { validators: [lint], conventions });',
    ]) {
      expect(codeOf(validators)).toContain(codeOf(line));
    }
    for (const target of ['c7', 'c8'] as const) {
      const rc = engine.plugin.getDefaultLintConfig({ engine: target });
      const resolved = await resolveBpmnlintConfig(engine, rc);
      expect(resolved.unavailable).toEqual([]);
      expect(resolved.rules[ID_NAMING_RULE]?.severity, target).toBe('warn');
      const { conventions, notes } = idConventionsFromLint(resolved.rules[ID_NAMING_RULE], engine.plugin.naming);
      const lint = bpmnlintValidator(engine, resolved, { detail: 'default rules', notes });
      const xml = (await newXml({ processName: 'Order', target: target === 'c7' ? 'camunda7' : 'camunda8' })).xml;
      const ops: EditCommand[] = [
        { op: 'add', kind: 'start', name: 'Order received', as: '$s' },
        { op: 'add', kind: 'userTask', name: 'Check order', after: '$s', as: '$t' },
        { op: 'add', kind: 'end', name: 'Done', after: '$t' },
      ];
      const result = (await applyToXml(xml, ops, { validators: [lint], conventions })).result;
      expect(result.created.map((createdElement) => createdElement.id), target).toEqual(['startEvent_orderReceived', 'userTask_checkOrder', 'flow_orderReceivedToCheckOrder', 'endEvent_done', 'flow_checkOrderToDone']);
      expect(lintOf(result.warnings.added).filter((warning) => warning.code === ID_NAMING_RULE), target).toEqual([]);
    }
    const c7 = await resolveBpmnlintConfig(engine, engine.plugin.getDefaultLintConfig({ engine: 'c7' }));
    expect(Object.keys(c7.moddleExtensions)).toEqual(['camunda']);
    expect(Object.keys(c7.rules)).toContain('camunda-compat/history-time-to-live');
  });

  it('the declared id conventions of a configuration of the host (docs/library.md): new ids pass its element-id-naming', async () => {
    const library = readFileSync(join(ROOT, 'docs', 'library.md'), 'utf8');
    for (const line of [
      "const automation = await resolveBpmnlintConfig(engine, engine.plugin.getDefaultLintConfig({ preset: 'automation' }));",
      "const { conventions, notes } = idConventionsFromLint(automation.rules[ID_NAMING_RULE], engine.plugin.naming, { source: 'our rules' });",
      'await applyToXml(xml, ops, { validators: [bpmnlintValidator(engine, automation, { notes })], conventions });',
      "await applyToXml(xml, ops, { conventions: { prefixes: { 'bpmn:ServiceTask': 'serviceTask_', 'bpmn:SequenceFlow': 'flow_' }, case: 'camelCase' } });",
    ]) {
      expect(codeOf(library)).toContain(codeOf(line));
    }
    const engine = bpmnlintEngine();
    const automation = await resolveBpmnlintConfig(engine, engine.plugin.getDefaultLintConfig({ preset: 'automation' }));
    const { conventions, notes } = idConventionsFromLint(automation.rules[ID_NAMING_RULE], engine.plugin.naming, { source: 'our rules' });
    const ops: EditCommand[] = [{ op: 'add', kind: 'serviceTask', name: 'Ship', after: 'userTask_check' }];
    const named = await applyToXml(await model(LINE), ops, { validators: [bpmnlintValidator(engine, automation, { notes })], conventions });
    expect(named.result.created.map((createdElement) => createdElement.id)).toEqual(['serviceTask_ship', 'flow_shipToDone']);
    expect(lintOf(named.result.warnings.added).filter((warning) => warning.code === ID_NAMING_RULE)).toEqual([]);
    const table = await applyToXml(await model(LINE), ops, { conventions: { prefixes: { 'bpmn:ServiceTask': 'serviceTask_', 'bpmn:SequenceFlow': 'flow_' }, case: 'camelCase' } });
    expect(table.result.created.map((createdElement) => createdElement.id)).toEqual(['serviceTask_ship', 'flow_shipToDone']);
  });
});
