// Renders the pictures of the docs with the CLI itself: every docs/shots/<name>.sh runs in an empty
// folder with `bpmn` on its PATH, and the SVGs it writes land in docs/public/shots/.
// Needs the built CLI: run `npm run build` in the repo root first.
import { execFileSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const shotsDir = dirname(fileURLToPath(import.meta.url))
const cli = join(shotsDir, "..", "..", "bin", "bpmn.js")
const outDir = join(shotsDir, "..", "public", "shots")
const recipes = readdirSync(shotsDir).filter((name) => name.endsWith(".sh"))

const binDir = mkdtempSync(join(tmpdir(), "bpmn-shots-bin-"))
const wrapper = join(binDir, "bpmn")
writeFileSync(wrapper, `#!/bin/sh\nexec node "${cli}" "$@"\n`)
chmodSync(wrapper, 0o755)
mkdirSync(outDir, { recursive: true })

for (const recipe of recipes) {
  const workDir = mkdtempSync(join(tmpdir(), "bpmn-shots-"))
  execFileSync("sh", ["-e", join(shotsDir, recipe)], {
    cwd: workDir,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    stdio: ["ignore", "ignore", "inherit"],
  })
  const svgs = readdirSync(workDir).filter((name) => name.endsWith(".svg"))
  for (const svg of svgs) copyFileSync(join(workDir, svg), join(outDir, svg))
  console.log(`${recipe}: ${svgs.join(", ")}`)
  rmSync(workDir, { recursive: true })
}
rmSync(binDir, { recursive: true })
