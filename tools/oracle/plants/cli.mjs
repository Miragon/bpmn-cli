export default {
  probe: 'cli',
  target: 'adapters/in/cli/ValidateCommand.js',
  find: 'this.cli.exitCode = 5;',
  replace: 'this.cli.exitCode = 6;',
};
