import { resolve } from 'node:path';
import { BannedNames } from './BannedNames.mjs';
import { ClassFiles } from './ClassFiles.mjs';
import { ClassShape } from './ClassShape.mjs';
import { CoreLayout } from './CoreLayout.mjs';
import { FolderShape } from './FolderShape.mjs';
import { IndexFiles } from './IndexFiles.mjs';
import { MirroredTests } from './MirroredTests.mjs';
import { SourceTree } from './SourceTree.mjs';

const CHECKS = [CoreLayout, BannedNames, FolderShape, IndexFiles, ClassFiles, ClassShape, MirroredTests];

const tree = new SourceTree(resolve(process.argv[2] ?? '.'));
const results = CHECKS.map((Check) => new Check(tree).run());
const problems = [...new Set(results.flatMap((result) => result.problems))];
problems.forEach((problem) => console.error(problem));
if (problems.length > 0) {
  console.error(`structure: ${problems.length} violation(s)`);
  process.exit(1);
}
console.log(`structure: ${results.map((result) => result.summary).join(', ')}`);
