import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { loadMainApi } from '../lib/main-tools.mjs';
import { REPO_ROOT } from '../lib/paths.mjs';

const NO_PLANE = 'none';

function loadRenderPackage() {
  const { outputFiles } = buildSync({
    entryPoints: [join(REPO_ROOT, 'packages/render/src/index.ts')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

async function drawable(DiagramRenderer, xml) {
  const diagram = await DiagramRenderer.fromXml(xml);
  if (diagram.planes.length > 0) {
    return diagram;
  }
  const { layoutXml } = await loadMainApi();
  return DiagramRenderer.fromXml((await layoutXml(xml, { force: true })).xml);
}

export default {
  name: 'render',
  describes: "packages/render's `.`; a file without a diagram takes main's drawing, since the core's drawing lays it out",
  probes: ['image'],
  async open() {
    const { DiagramRenderer } = await loadRenderPackage();
    return {
      async render(xml, plane) {
        try {
          const diagram = await drawable(DiagramRenderer, xml);
          const { svg, plane: drawn } = diagram.svg(plane === undefined || plane === NO_PLANE ? {} : { plane });
          return { svg, plane: drawn ?? NO_PLANE, planes: diagram.planes.filter((candidate) => candidate !== drawn) };
        } catch (error) {
          return { refused: error.code ?? error.name, reason: error.message };
        }
      },
    };
  },
};
