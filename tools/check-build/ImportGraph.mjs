export class ImportGraph {
  constructor(metafile) {
    this.metafile = metafile;
  }

  reachable(starts, kinds) {
    const seen = new Set();
    const visit = (path) => {
      if (seen.has(path) || !this.metafile.outputs[path]) {
        return;
      }
      seen.add(path);
      this.metafile.outputs[path].imports.filter(({ kind, external }) => kinds.includes(kind) && !external).forEach(({ path: imported }) => visit(imported));
    };
    starts.forEach(visit);
    return seen;
  }

  outputOf(entryPoint) {
    return Object.entries(this.metafile.outputs).find(([, output]) => output.entryPoint === entryPoint);
  }
}
