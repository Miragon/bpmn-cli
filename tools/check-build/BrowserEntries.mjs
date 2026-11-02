import { BrowserBundle } from './BrowserBundle.mjs';

const BROWSER_ENTRIES = ['src/index.ts', 'packages/render/src/index.ts', 'packages/render/src/text/index.ts'];

/**
 * design-iq loads the core and the renderer in the browser.
 * A Node-only import or global would break it only there, after release, so it fails here.
 */
export class BrowserEntries {
  constructor(root) {
    this.bundle = new BrowserBundle(root);
  }

  async run() {
    const problems = [];
    for (const entry of BROWSER_ENTRIES) {
      problems.push(...(await this.problemsOf(entry)));
    }
    return { problems, summary: `${BROWSER_ENTRIES.join(', ')} run in a browser` };
  }

  async problemsOf(entry) {
    try {
      const { outputFiles } = await this.bundle.build({ entryPoints: [entry] });
      const uses = this.bundle.nodeGlobalsIn(outputFiles[0].text).map(({ name, module }) => `${entry}: ${module} uses the Node-only global ${name}`);
      return [...new Set(uses)];
    } catch (failure) {
      if (!failure.errors) {
        throw failure;
      }
      return failure.errors.map(({ text, location }) => `${entry}: ${location?.file ?? '?'}: ${text}`);
    }
  }
}
