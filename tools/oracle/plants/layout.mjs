export default {
  probe: 'layout',
  target: 'api.js',
  find: 'return toEditResult(xml, await new RelayoutDiagramService(NO_PROJECT, NO_FILES).relayout({ ...opts, source: { doc }, dryRun: true }));',
  replace: `const redrawn = toEditResult(xml, await new RelayoutDiagramService(NO_PROJECT, NO_FILES).relayout({ ...opts, source: { doc }, dryRun: true }));
    return { ...redrawn, xml: redrawn.xml.replace(/(<bpmndi:BPMNShape[^>]*>\\s*<dc:Bounds x=")([\\d.]+)/, (whole, head, x) => head + (Number(x) + 120)) };`,
};
