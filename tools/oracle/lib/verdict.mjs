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

export function judge(runs, { allowList }) {
  const allowances = compiled(allowList);
  const verdicts = runs.map((run) => {
    const unexplained = run.differences.filter((difference) => !explainedBy(allowances, run.probe, difference));
    return {
      ...run,
      differences: unexplained,
      allowed: run.differences.length - unexplained.length,
      verdict: unexplained.length > 0 ? 'red' : 'green',
    };
  });
  return {
    ok: verdicts.every(({ verdict }) => verdict !== 'red'),
    verdicts,
    unusedAllowances: allowances.filter(({ used }) => !used).map(({ probe, pattern }) => ({ probe, pattern })),
  };
}
