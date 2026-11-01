export default {
  probe: 'edits',
  target: 'domain/document/ChangeSet.js',
  find: `this.removed.push(change);`,
  replace: `this.removed.push({ ...change, kind: 'planted' });`,
};
