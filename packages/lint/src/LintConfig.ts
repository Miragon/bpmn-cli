import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { LintFindings, type LintUnavailable } from './LintFindings.js';

export interface PluginsOff { why: string; hint: string }

const MAX_GIT_FILE_BYTES = 1 << 20;
const GIT_FILE_PREFIX = 'gitdir: ';
const BYTE_ORDER_MARK = /^﻿/;

export class LintConfig {
  static readonly SKIP_HINT = '--no-lint-config skips bpmnlint.';

  readonly directory: string;
  readonly root: string;
  readonly path: string;
  readonly content: Record<string, unknown>;
  readonly unavailable: LintUnavailable[] = [];
  private readonly uid = process.getuid?.();
  private readonly gitRoot: string | undefined;

  constructor(path: string) {
    this.path = resolve(path);
    this.directory = dirname(this.path);
    this.gitRoot = LintConfig.gitRootAbove(this.directory);
    this.root = LintConfig.real(this.gitRoot ?? this.directory);
    this.content = this.read();
  }

  holds(path: string): boolean {
    const way = relative(this.root, path);
    return way === '' || (way !== '..' && !way.startsWith(`..${sep}`) && !isAbsolute(way));
  }

  pluginsOff(): PluginsOff | undefined {
    if (this.gitRoot === undefined) {
      return { why: `bpmn-cli runs project plugins only inside a git repository (the .bpmnlintrc in ${this.directory} is in none)`, hint: `Keep the .bpmnlintrc and the plugin in a git repository, or remove the plugin from the configuration; ${LintConfig.SKIP_HINT}` };
    }
    const git = join(this.gitRoot, '.git');
    const gitDirectory = this.gitDirectoryOf(this.root);
    if (this.uid !== undefined && (!this.owned(this.root) || !this.owned(join(this.root, '.git')))) {
      return LintConfig.foreignRepository(git);
    }
    if (gitDirectory === null) {
      return { why: `bpmn-cli runs project plugins only inside a git repository (${git} is a file that names no git directory, so git takes it for no repository either)`, hint: `Fix or remove that .git file, or remove the plugin from the configuration; ${LintConfig.SKIP_HINT}` };
    }
    if (this.uid === undefined) {
      return this.insideHome() ? undefined : { why: `bpmn-cli runs project plugins only in a repository of the user running it, and where it cannot read file owners (Windows) only in one inside the home directory (${git} is outside it)`, hint: `Keep the repository inside your home directory, or remove the plugin from the configuration; ${LintConfig.SKIP_HINT}` };
    }
    return gitDirectory === undefined || this.owned(gitDirectory) ? undefined : LintConfig.foreignRepository(git);
  }

  private read(): Record<string, unknown> {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch (error) {
      return this.broken(`${this.path} cannot be read (${LintFindings.firstLine(error)})`, `Fix its permissions; ${LintConfig.SKIP_HINT}`);
    }
    try {
      const parsed: unknown = JSON.parse(text.replace(BYTE_ORDER_MARK, ''));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not a JSON object');
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      return this.broken(`${this.path} is not JSON (${LintFindings.firstLine(error)}; bpmnlint reads it with JSON.parse: no comments, no trailing commas)`, `Write it as strict JSON, as bpmnlint reads it; ${LintConfig.SKIP_HINT}`);
    }
  }

  private broken(reason: string, hint: string): Record<string, unknown> {
    this.unavailable.push({ kind: 'file', name: this.path, pkg: this.path, reason, hint });
    return {};
  }

  private gitDirectoryOf(root: string): string | undefined | null {
    const git = join(root, '.git');
    try {
      const status = statSync(git);
      if (status.isDirectory()) {
        return undefined;
      }
      if (!status.isFile() || status.size > MAX_GIT_FILE_BYTES) {
        return null;
      }
      const text = readFileSync(git, 'utf8');
      if (!text.startsWith(GIT_FILE_PREFIX)) {
        return null;
      }
      const named = LintConfig.real(resolve(root, text.slice(GIT_FILE_PREFIX.length).replace(/[\r\n]+$/, '')));
      return statSync(named).isDirectory() ? named : null;
    } catch {
      return null;
    }
  }

  private owned(path: string): boolean {
    let owner: number;
    try {
      owner = lstatSync(path).uid;
    } catch {
      return false;
    }
    const sudoUser = process.env['SUDO_UID'];
    return owner === this.uid || (this.uid === 0 && sudoUser !== undefined && /^\d+$/.test(sudoUser) && owner === Number(sudoUser));
  }

  private insideHome(): boolean {
    const home = LintConfig.real(homedir());
    const way = relative(home, this.root);
    return home !== '' && dirname(this.root) !== this.root && !way.startsWith('..') && !isAbsolute(way);
  }

  private static foreignRepository(git: string): PluginsOff {
    return { why: `bpmn-cli runs project plugins only in a repository of the user running it (the repository of ${git} belongs to another user)`, hint: `Check who created that repository and its .git; run bpmn-cli as its owner (git's safe.directory does not change this), or remove the plugin from the configuration; ${LintConfig.SKIP_HINT}` };
  }

  private static gitRootAbove(start: string): string | undefined {
    for (let directory = start; ; directory = dirname(directory)) {
      if (existsSync(join(directory, '.git'))) {
        return directory;
      }
      if (dirname(directory) === directory) {
        return undefined;
      }
    }
  }

  private static real(path: string): string {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  }
}
