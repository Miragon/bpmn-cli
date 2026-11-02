import { basename } from 'node:path';

const BANNED_NAMES = new Set(['utils', 'helpers', 'common', 'shared', 'misc', 'types']);

/**
 * A folder or file named utils or shared says nothing about what it holds and grows into a drawer for everything.
 */
export class BannedNames {
  constructor(tree) {
    this.tree = tree;
  }

  run() {
    const problems = this.tree.parts().flatMap(({ sourceRoot }) => [...this.#bannedFolders(sourceRoot), ...this.#bannedFiles(sourceRoot)]);
    return { problems, summary: 'no banned names' };
  }

  #bannedFolders(sourceRoot) {
    return this.tree
      .folders(sourceRoot)
      .slice(1)
      .filter((folder) => BANNED_NAMES.has(basename(folder).toLowerCase()))
      .map((folder) => `${this.tree.fromRoot(folder)}: ${basename(folder)} is a banned folder name`);
  }

  #bannedFiles(sourceRoot) {
    return this.tree
      .files(sourceRoot)
      .map((file) => [file, basename(file).split('.')[0]])
      .filter(([, stem]) => BANNED_NAMES.has(stem.toLowerCase()))
      .map(([file, stem]) => `${this.tree.fromRoot(file)}: ${stem} is a banned file name`);
  }
}
