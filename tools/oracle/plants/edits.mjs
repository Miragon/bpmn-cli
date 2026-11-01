export default {
  probe: 'edits',
  target: 'domain/editing/connections/SequenceFlows.js',
  find: `const scope = doc.scopeOf(source);`,
  replace: `const scope = doc.scopeOf(source); attrs = { ...attrs, name: attrs.name ?? 'planted' };`,
};
