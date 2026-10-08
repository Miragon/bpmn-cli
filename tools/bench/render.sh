#!/bin/zsh
# Renders bench result files (or any .bpmn) to PNG with real bpmn-js, to look at a layout.
#
#   tools/bench/render.sh <outdir> <file.bpmn> [<file.bpmn> ...]
#   tools/bench/render.sh /tmp/png tools/bench/results/latest/work/edits/new-auto/scenarios/agent__claim/*/model.bpmn
#
# Contract: one <outdir>/<name>.png per input. A bench work file (.../work/<track>/<arm>/<corpus>/<model>/<case>/model.bpmn)
# is named after its path below work/ with slashes as "__", so the runs of one model sort together; any other
# file after its basename. Needs Google Chrome (PUPPETEER_EXECUTABLE_PATH overrides the macOS default);
# bpmn-to-image@0.10.0 is fetched on demand with npx. The exit code of bpmn-to-image is passed through.
set -e
if [[ $# -lt 2 ]]; then echo "usage: $0 <outdir> <file.bpmn>..." >&2; exit 1; fi
out=$1
shift
mkdir -p "$out"
pairs=()
for f in "$@"; do
  abs=${f:A}
  if [[ "$(basename $abs)" == "model.bpmn" && "$abs" == */work/* ]]; then
    rel=${abs##*/work/}
    name=${${rel%/model.bpmn}//\//__}
  else
    name=$(basename ${abs%.bpmn})
  fi
  pairs+=("$abs:${out:A}/$name.png")
done
PUPPETEER_EXECUTABLE_PATH="${PUPPETEER_EXECUTABLE_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" \
  npx -y bpmn-to-image@0.10.0 "${pairs[@]}"
echo "wrote ${#pairs[@]} png to $out"
