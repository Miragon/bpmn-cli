import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const MAX_FOLDER_FILES = 12;
const MAX_FOLDERS_BELOW_MODULE = 2;

/**
 * Small, shallow folders keep a module readable at a glance; one that outgrows them wants a subfolder or a split.
 */
export class FolderShape {
  constructor(tree) {
    this.tree = tree;
  }

  run() {
    const parts = this.tree.parts();
    const problems = [
      ...parts.flatMap(({ sourceRoot }) => this.tree.folders(sourceRoot).flatMap((folder) => this.#sizeProblems(folder))),
      ...parts.flatMap(({ moduleRoots }) => moduleRoots.flatMap((moduleRoot) => this.#depthProblems(moduleRoot))),
    ];
    return { problems, summary: `folders of at most ${MAX_FOLDER_FILES} files` };
  }

  #sizeProblems(folder) {
    const files = readdirSync(folder).filter((name) => statSync(join(folder, name)).isFile());
    return files.length > MAX_FOLDER_FILES ? [`${this.tree.fromRoot(folder)}: holds ${files.length} files, at most ${MAX_FOLDER_FILES}`] : [];
  }

  #depthProblems(moduleRoot) {
    return this.tree
      .folders(moduleRoot)
      .map((folder) => [folder, relative(moduleRoot, folder).split(sep).filter(Boolean).length])
      .filter(([, depth]) => depth > MAX_FOLDERS_BELOW_MODULE)
      .map(([folder, depth]) => `${this.tree.fromRoot(folder)}: sits ${depth} levels below its module, at most ${MAX_FOLDERS_BELOW_MODULE}`);
  }
}
