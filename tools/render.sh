#!/bin/zsh
# Renders .bpmn files to PNG with real bpmn-js, so you can look at a layout.
#
#   tools/render.sh out/ file1.bpmn file2.bpmn ...
#
# Needs Google Chrome installed; bpmn-to-image is fetched on demand with npx.
# Typical use after a layout change:
#   npm run build
#   node tools/layout-regress.mjs --filter claim --keep
#   tools/render.sh /tmp/png tools/.regress-work/*claim*.bpmn
set -e
out=$1
shift
mkdir -p "$out"
pairs=()
for f in "$@"; do
  pairs+=("$f:$out/$(basename ${f%.bpmn}).png")
done
PUPPETEER_EXECUTABLE_PATH="${PUPPETEER_EXECUTABLE_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" \
  npx -y bpmn-to-image@0.10.0 "${pairs[@]}"
echo "wrote ${#pairs[@]} png to $out"
