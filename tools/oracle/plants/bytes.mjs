export default {
  probe: 'bytes',
  target: 'domain/document/xml/TextPreservation.js',
  find: `return { xml, mode: 'preserved',`,
  replace: `return { xml: xml.replace('\\n', ' \\n'), mode: 'preserved',`,
};
