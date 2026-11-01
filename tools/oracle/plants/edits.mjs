export default {
  probe: 'edits',
  alsoRed: ['cli'],
  target: 'domain/document/ChangeSet.js',
  find: `this.removed.push(change);`,
  replace: `this.removed.push({ ...change, kind: 'planted' });`,
};
