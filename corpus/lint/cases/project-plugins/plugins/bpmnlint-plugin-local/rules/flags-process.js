module.exports = () => ({ check(node, reporter) { if (node.$type === 'bpmn:Process') { reporter.report(node.id, "local says so"); } } });
