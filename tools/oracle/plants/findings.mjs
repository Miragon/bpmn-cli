export default {
  probe: 'findings',
  target: 'domain/validation/structure/ScopeLint.js',
  find: `this.findings.warning('W_IMPLICIT_JOIN',`,
  replace: `this.findings.warning('W_IMPLICIT_MERGE',`,
};
