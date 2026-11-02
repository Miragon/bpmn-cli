const MAX_SHOWN = 5;

function measureText(measures) {
  return Object.entries(measures).map(([name, value]) => `${name} ${value}`).join(', ');
}

function runLines({ probe, inputs, differences, allowed, listed, verdict, measures }) {
  const allowedText = allowed ? `, ${allowed} allowed` : '';
  const lines = [`  ${probe.padEnd(9)} ${verdict.padEnd(9)} ${String(inputs).padStart(5)} inputs, ${differences.length} differences${allowedText}; ${measureText(measures)}`];
  for (const difference of differences.slice(0, MAX_SHOWN)) {
    lines.push(`      ${difference.split('\n')[0]}`);
  }
  if (differences.length > MAX_SHOWN) {
    lines.push(`      ... ${differences.length - MAX_SHOWN} more`);
  }
  if (listed.length) {
    lines.push(`      ${listed.length} listed, not failed`);
  }
  return lines;
}

export function summaryText({ commit, recordedAt, workers, wallSeconds, ok, verdicts, unusedAllowances }, resultFile) {
  const lines = [`oracle: main at ${commit.slice(0, 7)}, ${workers} workers`];
  if (recordedAt !== commit) {
    lines.push(`the corpus was recorded at ${recordedAt.slice(0, 7)}: run npm run oracle:record`);
  }
  for (const entry of new Set(verdicts.map((verdict) => verdict.entry))) {
    const own = verdicts.filter((verdict) => verdict.entry === entry);
    lines.push(entry, ...own.flatMap(runLines));
  }
  for (const { probe, pattern } of unusedAllowances) {
    lines.push(`unused in differences.json: ${probe} ${pattern}`);
  }
  lines.push(`${ok ? 'green' : 'RED'} in ${wallSeconds} s; ${resultFile}`);
  return lines.join('\n');
}
