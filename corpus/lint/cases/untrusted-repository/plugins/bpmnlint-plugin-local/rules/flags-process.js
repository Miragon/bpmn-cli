module.exports = () => ({ check(node, reporter) { if (node.$type === 'bpmn:Process') { reporter.report(node.id, "must not run"); } } });
