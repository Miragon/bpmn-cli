function compiled(allowList) {
  return allowList.map((allowance) => {
    if (!allowance.probe || !allowance.pattern || !allowance.reason) {
      throw new Error(`differences.json: each row needs probe, pattern and reason: ${JSON.stringify(allowance)}`);
    }
    return { ...allowance, regex: new RegExp(allowance.pattern), used: false };
  });
}

function explainedBy(allowances, probe, difference) {
  const allowance = allowances.find((candidate) => candidate.probe === probe && candidate.regex.test(difference));
  if (allowance) {
    allowance.used = true;
  }
  return allowance;
}

function verdictOf(count, limit) {
  if (count > limit) {
    return 'red';
  }
  return count > 0 ? 'reporting' : 'green';
}

export function judge(runs, { allowList, progress }) {
  const allowances = compiled(allowList);
  const verdicts = runs.map((run) => {
    const unexplained = run.differences.filter((difference) => !explainedBy(allowances, run.probe, difference));
    const limit = progress[run.entry]?.[run.probe] ?? 0;
    return {
      ...run,
      differences: unexplained,
      allowed: run.differences.length - unexplained.length,
      state: progress[run.entry] ? 'in progress' : 'gates',
      limit,
      verdict: verdictOf(unexplained.length, limit),
    };
  });
  return {
    ok: verdicts.every(({ verdict }) => verdict !== 'red'),
    verdicts,
    unusedAllowances: allowances.filter(({ used }) => !used).map(({ probe, pattern }) => ({ probe, pattern })),
  };
}
