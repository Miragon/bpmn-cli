/**
 * The advisory BpmnlintValidator of the project's bpmnlint configuration (issue #33):
 * src/adapters/out/bpmnlint/, with the real bpmnlint and @miragon/bpmnlint-plugin-rules, offline.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyToXml, newXml } from '../../../../src/api.js';
import { bpmnlintValidator, BPMNLINT_COVERS, resolveBpmnlintConfig, type BpmnlintEngine, mutationReport, mutationSummary, renderMutation, renderSummary, renderValidation, validationReport } from '../../../../src/index.js';
import { Doc } from '../../../../src/domain/document/Doc.js';
import type { EditCommand } from '../../../../src/domain/commands/types.js';
import { bpmnlintEngine } from '../../../../src/node.js';
import { checkFile, mutateFile } from '../../../../src/node.js';
import { checkDoc } from '../../../../src/index.js';
import type { ValidatorFinding } from '../../../../src/domain/validation/validators.js';
import { fixture, repo, model, LINE, REDEFINES_NOTHING, listless, lintOf, codes } from '../../../helpers/bpmnlint.js';

describe('bpmnlintValidator: findings', () => {
  const ctx = (xml: string, phase: 'before' | 'after' | 'check' = 'check') => ({ phase, platform: 'none' as const, ops: [], doc: () => Doc.fromXml(xml) });

  it('maps a report to code, element, severity and a key without array indices; nothing else of the report', async () => {
    const engine = bpmnlintEngine();
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const lintValidator = bpmnlintValidator(engine, await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended', rules: { 'fake-join': 'info', 'label-required': 'warn' } }), { detail: 'test' });
    expect(lintValidator).toMatchObject({ name: 'bpmnlint', detail: 'test', blocks: false, covers: BPMNLINT_COVERS });
    const found = (await lintValidator.validate!(xml, ctx(xml))) as ValidatorFinding[];
    expect(found).toEqual([{ severity: 'warning', code: 'label-required', message: 'Element is missing label/name', element: 'Activity_AfterCheck', key: 'Activity_AfterCheck|name|Element is missing label/name' }]);
  });

  it('the key of a finding with a path leaves out the array indices: removing an earlier sibling changes nothing', async () => {
    const dir = repo({ extends: 'plugin:camunda-compat/camunda-cloud-8-10', moddleExtensions: { zeebe: 'zeebe-bpmn-moddle/resources/zeebe.json' } });
    const xml = await model(LINE).then((modelXml) => applyToXml(modelXml, [{ op: 'ext', id: 'Activity_Check', action: 'add', type: 'zeebe:input', attrs: { source: '=a', target: 'a' } }]));
    // a second input without target (the io-mapping rule reports it with its index in the path)
    const file = join(dir, 'c8.bpmn');
    writeFileSync(file, xml.xml.replace('<zeebe:input source="=a" target="a" />', '<zeebe:input source="=a" target="a" />\n          <zeebe:input source="=b" />'));
    const before = lintOf((await checkFile(file, { lintProjectCode: true })).validation.errors);
    expect(codes(before)).toContain('camunda-compat/io-mapping Activity_Check');
    const mutated = await mutateFile(file, [{ op: 'ext', id: 'Activity_Check', action: 'remove', type: 'zeebe:input[target=a]' }], { dryRun: true });
    const report = mutationReport(mutated);
    expect(codes(report.warnings.added)).not.toContain('camunda-compat/io-mapping Activity_Check');
    expect(codes(report.warnings.resolved)).not.toContain('camunda-compat/io-mapping Activity_Check');
  });

  it('a rule that throws (check or factory) is one W_LINT_FAILED; the others report, nothing goes to stderr', async () => {
    const { Linter, resolver } = bpmnlintEngine();
    const local: Record<string, unknown> = {
      boom: () => ({ check: (node: { $type: string; id: string }) => {
        if (node.$type === 'bpmn:EndEvent') throw new Error(`kaboom on ${node.id}`);
      } }),
      'bad-options': (options: { size: number }) => ({ check: () => options.size.toFixed() }),
      'no-check': () => ({}),
      leave: () => ({ check: { leave: (node: { $type: string; id: string }) => { if (node.$type === 'bpmn:UserTask') throw new Error('on leave'); } } }),
    };
    const engine: BpmnlintEngine = { Linter, resolver: { resolveConfig: (pkg, name) => resolver.resolveConfig(pkg, name), resolveRule: (pkg, name) => (pkg === 'bpmnlint-plugin-local' ? local[name] : resolver.resolveRule(pkg, name)) } };
    const resolved = await resolveBpmnlintConfig(engine, { rules: { 'local/boom': 'warn', 'local/bad-options': ['error'], 'local/no-check': 'warn', 'local/leave': 'warn', 'label-required': 'error' } });
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const found = (await bpmnlintValidator(engine, resolved).validate!(xml, ctx(xml))) as ValidatorFinding[];
      expect(error).not.toHaveBeenCalled();
      expect(found.map((finding) => `${finding.code}: ${finding.message}`).sort()).toEqual([
        'W_LINT_FAILED: bpmnlint rule local/bad-options failed: Cannot read properties of undefined (reading \'size\'); its findings are left out',
        'W_LINT_FAILED: bpmnlint rule local/boom failed: kaboom on Event_Done; its findings are left out',
        'W_LINT_FAILED: bpmnlint rule local/leave failed: on leave; its findings are left out',
        'W_LINT_FAILED: bpmnlint rule local/no-check failed: the rule has no check; its findings are left out',
        'label-required: Element is missing label/name',
      ]);
      expect(found.find((finding) => finding.code === 'W_LINT_FAILED')!.key).toMatch(/^failed\|local\//);
    } finally {
      error.mockRestore();
    }
  });

  it('an async check that rejects and a factory that returns a promise are W_LINT_FAILED, never an unhandled rejection; an async check keeps what it reported before its first await', async () => {
    const { Linter, resolver } = bpmnlintEngine();
    type Node = { $type: string; id: string };
    const local: Record<string, unknown> = {
      'async-check': () => ({ async check(node: Node) {
        if (node.$type === 'bpmn:Process') throw new Error('async boom');
      } }),
      'async-later': () => ({ async check(node: Node) {
        await null;
        if (node.$type === 'bpmn:EndEvent') throw new Error('later boom');
      } }),
      'async-ok': () => ({ async check(node: Node, reporter: { report(id: string, message: string): void }) {
        if (node.$type === 'bpmn:EndEvent') reporter.report(node.id, 'reported before the first await');
      } }),
      'async-factory': async () => {
        throw new Error('async factory boom');
      },
      'async-factory-ok': async () => ({ check: () => undefined }),
    };
    const engine: BpmnlintEngine = { Linter, resolver: { resolveConfig: (pkg, name) => resolver.resolveConfig(pkg, name), resolveRule: (pkg, name) => (pkg === 'bpmnlint-plugin-local' ? local[name] : resolver.resolveRule(pkg, name)) } };
    const resolved = await resolveBpmnlintConfig(engine, { rules: Object.fromEntries([...Object.keys(local).map((name) => [`local/${name}`, 'warn']), ['label-required', 'error']]) });
    const xml = await model([...LINE, { op: 'add', kind: 'task', after: 'Activity_Check' }]);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const found = (await bpmnlintValidator(engine, resolved).validate!(xml, ctx(xml))) as ValidatorFinding[];
      await new Promise((done) => setTimeout(done, 20));
      expect(unhandled).not.toHaveBeenCalled();
      expect(found.map((finding) => `${finding.code}${finding.element ? ` ${finding.element}` : ''}: ${finding.message}`).sort()).toEqual([
        'W_LINT_FAILED: bpmnlint rule local/async-check failed: async boom; its findings are left out',
        'W_LINT_FAILED: bpmnlint rule local/async-factory failed: the rule factory returned a promise (bpmnlint rules are synchronous); its findings are left out',
        'W_LINT_FAILED: bpmnlint rule local/async-factory-ok failed: the rule factory returned a promise (bpmnlint rules are synchronous); its findings are left out',
        'W_LINT_FAILED: bpmnlint rule local/async-later failed: later boom; its findings are left out',
        'label-required Activity_AfterCheck: Element is missing label/name',
        'local/async-ok Event_Done: reported before the first await',
      ]);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('a model bpmnlint cannot lint at all (a descriptor BpmnModdle takes but cannot parse with) is one W_LINT_FAILED that says no rule ran; a write leaves it out', async () => {
    const engine = bpmnlintEngine();
    const xml = await model(LINE);
    const resolved = await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended', moddleExtensions: { x: REDEFINES_NOTHING } });
    expect(resolved.unavailable).toEqual([]);
    const failed = {
      severity: 'warning',
      code: 'W_LINT_FAILED',
      message: 'bpmnlint could not lint the model: refined property <bpmn:x> not found',
      key: 'failed|',
      hint: "No rule ran. Check the .bpmnlintrc's moddleExtensions (a descriptor bpmnlint cannot load fails in CI too); else report the file and the .bpmnlintrc. --no-lint-config skips bpmnlint.",
    };
    const lintValidator = bpmnlintValidator(engine, resolved);
    expect(await lintValidator.validate!(xml, ctx(xml))).toEqual([failed]);
    // a write does not compare it: its validator line says that no rule ran
    for (const phase of ['before', 'after'] as const) expect(await lintValidator.validate!(xml, ctx(xml, phase)), phase).toEqual([{ ...failed, leftOut: 'W_LINT_FAILED, no rule ran' }]);
  });

  it('a moddle descriptor BpmnModdle rejects (a prefix or uri already defined, an extends of an unknown type) is left out alone: W_LINT_UNAVAILABLE, the other rules run', async () => {
    const engine = bpmnlintEngine();
    const xml = await model([...LINE, { op: 'add', kind: 'task', in: 'Process_Order' }]);
    const ext = (prefix: string, more: object = {}) => ({ name: prefix.toUpperCase(), prefix, uri: `http://example.org/${prefix}`, types: [], ...more });
    const moddleExtensions = {
      dup: ext('bpmn'),
      nope: ext('nope', { types: [{ name: 'A', extends: ['bpmn:Nope'], properties: [] }] }),
      uri: ext('u', { uri: 'http://www.omg.org/spec/BPMN/20100524/MODEL' }),
      ok: ext('ok'),
      again: ext('ok'),
      empty: [],
      second: {},
    };
    const resolved = await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended', moddleExtensions });
    expect(resolved.moddleExtensions).toEqual({ ok: moddleExtensions.ok, empty: [] });
    const hint = 'Fix the descriptor, or remove the moddleExtensions entry; bpmnlint in CI fails on the whole file with it.';
    expect(resolved.unavailable).toEqual([
      { kind: 'moddle', name: 'dup', pkg: 'descriptor object', reason: 'BpmnModdle rejects it (package with prefix <bpmn> already defined)', hint },
      { kind: 'moddle', name: 'nope', pkg: 'descriptor object', reason: expect.stringMatching(/^BpmnModdle rejects it \(.+\)$/), hint },
      { kind: 'moddle', name: 'uri', pkg: 'descriptor object', reason: 'BpmnModdle rejects it (package with uri <http://www.omg.org/spec/BPMN/20100524/MODEL> already defined)', hint },
      { kind: 'moddle', name: 'again', pkg: 'descriptor object', reason: 'BpmnModdle rejects it (package with prefix <ok> already defined)', hint },
      { kind: 'moddle', name: 'second', pkg: 'descriptor object', reason: 'BpmnModdle rejects it (package with prefix <undefined> already defined)', hint },
    ]);
    const found = (await bpmnlintValidator(engine, resolved).validate!(xml, ctx(xml))) as ValidatorFinding[];
    expect(codes(found.filter((finding) => !finding.code.startsWith('W_LINT_')))).toEqual(['label-required Activity_Task', 'no-disconnected Activity_Task', 'no-implicit-end Activity_Task', 'no-implicit-start Activity_Task']);
    expect(found.filter((finding) => finding.code.startsWith('W_LINT_')).map((finding) => finding.message)).toEqual([
      'moddle extension dup (descriptor object) left out: BpmnModdle rejects it (package with prefix <bpmn> already defined); rules reading dup: properties may report findings that are not there',
      expect.stringMatching(/^moddle extension nope \(descriptor object\) left out: BpmnModdle rejects it \(.+\); rules reading nope: properties may report findings that are not there$/),
      'moddle extension uri (descriptor object) left out: BpmnModdle rejects it (package with uri <http://www.omg.org/spec/BPMN/20100524/MODEL> already defined); rules reading uri: properties may report findings that are not there',
      'moddle extension again (descriptor object) left out: BpmnModdle rejects it (package with prefix <ok> already defined); rules reading again: properties may report findings that are not there',
      'moddle extension second (descriptor object) left out: BpmnModdle rejects it (package with prefix <undefined> already defined); rules reading second: properties may report findings that are not there',
    ]);
  });

  it('a new Linter per run: stateful rules (no-duplicate-sequence-flows) do not carry state from one run to the next', async () => {
    const engine = bpmnlintEngine();
    const xml = fixture('incremental/orders.bpmn');
    const lintValidator = bpmnlintValidator(engine, await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:all' }));
    const first = (await lintValidator.validate!(xml, ctx(xml))) as ValidatorFinding[];
    const second = (await lintValidator.validate!(xml, ctx(xml))) as ValidatorFinding[];
    expect(second).toEqual(first);
    expect(first.filter((finding) => finding.code === 'no-duplicate-sequence-flows')).toEqual([]);
  });

  it('finds what bpmnlint finds (orders.bpmn, gallery.bpmn), every finding once', async () => {
    const plugin = bpmnlintEngine().plugin;
    const rc = { extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/recommended-for-automation'] };
    for (const name of ['incremental/orders.bpmn', 'render/gallery.bpmn']) {
      const xml = fixture(name);
      const { Linter } = bpmnlintEngine();
      const { BpmnModdle } = await import('bpmn-moddle');
      const reports = await new Linter({ config: rc, resolver: plugin.createBundledResolver() }).lint((await new BpmnModdle().fromXML(xml)).rootElement);
      const expected = Object.entries(reports).flatMap(([rule, list]) => list.map((reportEntry) => `${rule} ${reportEntry.id ?? ''} ${reportEntry.message}`)).sort();
      const engine = bpmnlintEngine();
      const check = await checkDoc(await Doc.fromXml(xml), { validators: [bpmnlintValidator(engine, await resolveBpmnlintConfig(engine, rc))] });
      const found = lintOf([...check.validation.errors, ...check.validation.warnings]).map((finding) => `${finding.code} ${finding.element ?? ''} ${finding.message}`).sort();
      expect(found, name).toEqual(expected);
      expect(found.length, name).toBeGreaterThan(5);
    }
  });

  it('the import warnings of the lint parse bpmn-cli\'s reader does not report: import-warning errors with a hint; bpmn-cli\'s decision link in a model without an engine has its own', async () => {
    const engine = bpmnlintEngine();
    const run = async (xml: string, rc: object) => {
      const lintValidator = bpmnlintValidator(engine, await resolveBpmnlintConfig(engine, rc));
      return { check: await checkDoc(await Doc.fromXml(xml)), found: (await lintValidator.validate!(xml, ctx(xml))) as ValidatorFinding[] };
    };
    // a model without an engine (no engine namespace): bpmn-cli's reader takes calledDecision as the decision link, bpmnlint's parse does not know it
    const design = await model([...LINE, { op: 'add', kind: 'businessRuleTask', name: 'Decide', after: 'Activity_Check' }, { op: 'set', id: 'Activity_Decide', values: { calledDecision: 'risk' } }]);
    const linked = await run(design, { rules: { 'label-required': 'error' } });
    expect(linked.check.importWarnings).toEqual([]);
    expect(linked.found).toEqual([{ severity: 'error', code: 'import-warning', message: 'Import warning: unknown attribute <calledDecision>', element: 'Activity_Decide', key: 'import|Activity_Decide|unknown attribute <calledDecision>', hint: expect.stringMatching(/^bpmn-cli's decision link in a model without an engine \(an unprefixed calledDecision on a business rule task; bpmn-cli's reader keeps it\): keep it\./) }]);
    // a moddle extension that declares the attribute: bpmnlint reads it
    const descriptor = { name: 'DesignIq', prefix: 'diq', uri: 'http://example.org/diq', types: [{ name: 'DecisionLink', extends: ['bpmn:BusinessRuleTask'], properties: [{ name: 'calledDecision', isAttr: true, type: 'String' }] }] };
    expect((await run(design, { rules: { 'label-required': 'error' }, moddleExtensions: { diq: descriptor } })).found).toEqual([]);
    // what bpmn-cli's reader reports itself is not listed again
    const foo = (await model(LINE)).replace('<bpmn:userTask id="Activity_Check"', '<bpmn:userTask foo="bar" id="Activity_Check"');
    const own = await run(foo, { rules: { 'label-required': 'error' } });
    expect(own.check.importWarnings).toEqual(['unknown attribute <foo>']);
    expect(own.found).toEqual([]);
    // an unresolved reference only the lint parse sees (a camunda errorRef read through the camunda moddle extension)
    const c7 = (await applyToXml((await newXml({ processName: 'Order', target: 'camunda7' })).xml, [...LINE, { op: 'add', kind: 'serviceTask', name: 'Call', after: 'Activity_Check' }])).xml
      .replace('<bpmn:serviceTask id="Activity_Call" name="Call">', '<bpmn:serviceTask id="Activity_Call" name="Call">\n      <bpmn:extensionElements><camunda:errorEventDefinition id="Def_X" errorRef="Error_Missing" /></bpmn:extensionElements>');
    const camunda = bpmnlintEngine().plugin.getDefaultLintConfig({ engine: 'c7' }).moddleExtensions!;
    const dangling = await run(c7, { rules: { 'label-required': 'error' }, moddleExtensions: camunda });
    expect(dangling.found).toEqual([expect.objectContaining({ severity: 'error', code: 'import-warning', message: 'Import warning: unresolved reference <Error_Missing>', element: 'Def_X', hint: expect.stringMatching(/^bpmnlint parses the file with the \.bpmnlintrc's moddle extensions only and reports this as an error; bpmnlint in CI fails on it too\./) })]);
  });
});

describe('covered lint warnings and the incoming / outgoing lists', () => {
  const run = async (xml: string, rules: Record<string, unknown> = {}) => {
    const engine = bpmnlintEngine();
    const lintValidator = bpmnlintValidator(engine, await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended', rules }));
    return checkDoc(await Doc.fromXml(xml), { validators: [lintValidator] });
  };

  it('each row of BPMNLINT_COVERS: the lint warning about the same element is dropped, the bpmnlint finding takes its hint', async () => {
    const empty = (await newXml({ processName: 'Order' })).xml;
    const noEnd = await model(LINE.slice(0, 2));
    for (const [xml, rule] of [[empty, 'start-event-required'], [empty, 'end-event-required'], [noEnd, 'no-implicit-end']] as const) {
      const lint = BPMNLINT_COVERS[rule]!;
      const plain = await checkDoc(await Doc.fromXml(xml));
      const warning = plain.validation.warnings.find((candidate) => candidate.code === lint)!;
      expect(warning, rule).toBeDefined();
      const checked = await run(xml);
      expect(codes(checked.validation.warnings), rule).not.toContain(`${lint} ${warning.element}`);
      const finding = [...checked.validation.errors, ...checked.validation.warnings].find((issue) => issue.code === rule && issue.element === warning.element);
      expect(finding?.hint, rule).toBe(warning.hint);
    }
    // a rule that is off covers nothing
    const off = await run(noEnd, { 'no-implicit-end': 'off' });
    expect(codes(off.validation.warnings)).toContain('W_DEAD_END Activity_Check');
  });

  it('a file without incoming / outgoing lists: validate lists the list rules with a hint, a write leaves the false ones out', async () => {
    const xml = listless(await model(LINE));
    const checked = await run(xml);
    const lists = lintOf(checked.validation.errors).filter((finding) => ['no-implicit-end', 'no-implicit-start', 'no-disconnected'].includes(finding.code));
    expect(codes(lists).sort()).toEqual(['no-disconnected Activity_Check', 'no-disconnected Event_Done', 'no-disconnected Event_Received', 'no-implicit-end Activity_Check', 'no-implicit-end Event_Received', 'no-implicit-start Activity_Check', 'no-implicit-start Event_Done']);
    for (const finding of lists) expect(finding.hint).toMatch(/^The element has sequence flows the file does not list under incoming \/ outgoing, which no-/);
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'listless.bpmn': xml });
    const added = mutationReport(await mutateFile(join(dir, 'listless.bpmn'), [{ op: 'add', kind: 'userTask', name: 'Ship', after: 'Activity_Check' }], { dryRun: true })).warnings.added;
    expect(lintOf(added)).toEqual([]);
    // a node that really has no flow is reported (and covers W_DEAD_END)
    const loose = mutationReport(await mutateFile(join(dir, 'listless.bpmn'), [{ op: 'add', kind: 'userTask', name: 'Loose', in: 'Process_Order' }], { dryRun: true })).warnings.added;
    expect(codes(lintOf(loose))).toEqual(['no-disconnected Activity_Loose', 'no-implicit-end Activity_Loose', 'no-implicit-start Activity_Loose']);
    expect(codes(loose)).not.toContain('W_DEAD_END Activity_Loose');
    expect(lintOf(loose).find((finding) => finding.code === 'no-implicit-end')!.hint).toMatch(/^Continue the flow/);
  });

  it("a write on a file without incoming / outgoing lists counts the findings it leaves out: its totals are validate's, also after a new element; they never block", async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'listless.bpmn': listless(await model(LINE)) });
    const file = join(dir, 'listless.bpmn');
    expect((await checkFile(file)).validation.validators![0]!.counts).toEqual({ errors: 7, warnings: 0 });
    const lists = 'incoming / outgoing lists the file does not keep';
    const renamed = mutationReport(await mutateFile(file, [{ op: 'set', id: 'Activity_Check', values: { name: 'Check order' } }], { dryRun: true, lintFrom: dir }));
    expect(renamed.validation.validators).toEqual([{ name: 'bpmnlint', detail: '.bpmnlintrc in .', blocks: false, errors: [], warnings: [], preexisting: [], resolved: [], counts: { errors: 7, warnings: 0 }, leftOut: [{ reason: lists, count: 7 }] }]);
    expect(renderMutation(renamed)).toContain('\nvalidator bpmnlint (.bpmnlintrc in .): 7 error(s), 0 warning(s) in the result (0 added, 0 resolved, 0 already in the file, 7 left out (incoming / outgoing lists the file does not keep; `bpmn validate <file>` lists them))\n');
    // --summary counts the findings the file already had among the warnings, and names the left-out ones in a line of its own
    const summary = mutationSummary(renamed);
    expect(summary.warnings.preexistingCount).toBe(renamed.warnings.preexistingCount);
    expect(summary.leftOut).toEqual([{ validator: 'bpmnlint', reason: lists, count: 7 }]);
    expect(renderSummary(summary, { dryRun: true }).split('\n')).toContain('validator bpmnlint: 7 left out (incoming / outgoing lists the file does not keep; `bpmn validate <file>` lists them)');
    // a new element: its list-rule findings are left out too, none is added; validate on the written file gives the same totals
    const added = await mutateFile(file, [{ op: 'add', kind: 'userTask', name: 'Ship', after: 'Activity_Check' }], { lintFrom: dir });
    expect(lintOf(mutationReport(added).warnings.added)).toEqual([]);
    const after = added.validation.validators![0]!;
    const validate = (await checkFile(file)).validation.validators![0]!;
    expect(after.counts).toEqual(validate.counts);
    expect(after.counts).toEqual({ errors: 10, warnings: 0 });
    expect(after.leftOut).toEqual([{ reason: lists, count: 10 }]);
    // lintBlocks: they do not block, and the line of a blocking validator names them too
    const blocking = mutationReport(await mutateFile(file, [{ op: 'set', id: 'Activity_Ship', values: { name: 'Ship order' } }], { dryRun: true, lintBlocks: true, lintFrom: dir }));
    expect(renderMutation(blocking)).toContain('\nvalidator bpmnlint (.bpmnlintrc in .): 10 error(s), 0 warning(s) in the result (10 left out (incoming / outgoing lists the file does not keep; `bpmn validate <file>` lists them))\n');
    // a file that keeps its lists: no leftOut, the line as before
    const kept = repo({ extends: 'bpmnlint:recommended' }, { 'lists.bpmn': await model(LINE) });
    const plain = mutationReport(await mutateFile(join(kept, 'lists.bpmn'), [{ op: 'set', id: 'Activity_Check', values: { name: 'Check order' } }], { dryRun: true, lintFrom: kept }));
    expect(plain.validation.validators![0]).not.toHaveProperty('leftOut');
    expect(renderMutation(plain)).toContain('\nvalidator bpmnlint (.bpmnlintrc in .): 0 error(s), 0 warning(s) in the result (0 added, 0 resolved, 0 already in the file)\n');
    expect(mutationSummary(plain)).not.toHaveProperty('leftOut');
  });

  it('a write on a file without the lists that gives a real dead end or a loose node a flow resolves no bpmnlint finding it still has; W_DEAD_END is resolved as itself', async () => {
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'loose.bpmn': listless(await model([...LINE, { op: 'add', kind: 'task', name: 'Loose', in: 'Process_Order' }])) });
    const file = join(dir, 'loose.bpmn');
    // the loose task: no-disconnected, no-implicit-end and no-implicit-start, real ones (it has no flow)
    expect(codes(lintOf((await checkFile(file)).validation.errors)).filter((code) => code.endsWith('Activity_Loose'))).toEqual(['no-disconnected Activity_Loose', 'no-implicit-end Activity_Loose', 'no-implicit-start Activity_Loose']);
    for (const ops of [[{ op: 'add', kind: 'end', name: 'Fin', after: 'Activity_Loose' }], [{ op: 'connect', source: 'Activity_Check', target: 'Activity_Loose' }]] as EditCommand[][]) {
      const mutation = mutationReport(await mutateFile(file, ops, { dryRun: true, lintFrom: dir }));
      const firstValidator = mutation.validation.validators![0]!;
      // bpmnlint in CI still reports them (the lists stay unwritten): left out, not resolved
      expect(lintOf(mutation.warnings.resolved), ops[0]!.op).toEqual([]);
      expect(firstValidator.resolved, ops[0]!.op).toEqual([]);
      // added + already in the file + left out = the totals
      const kept = firstValidator.counts.errors + firstValidator.counts.warnings - firstValidator.warnings.length - firstValidator.leftOut![0]!.count;
      expect(renderMutation(mutation), ops[0]!.op).toContain(` in the result (${firstValidator.warnings.length} added, 0 resolved, ${kept} already in the file, ${firstValidator.leftOut![0]!.count} left out (`);
    }
    const ended = mutationReport(await mutateFile(file, [{ op: 'add', kind: 'end', name: 'Fin', after: 'Activity_Loose' }], { dryRun: true, lintFrom: dir }));
    expect(codes(ended.warnings.resolved)).toEqual(['W_DEAD_END Activity_Loose']);
    expect(ended.validation.validators![0]).toMatchObject({ counts: { errors: 12, warnings: 0 }, leftOut: [{ count: 11 }] });
    const connected = mutationReport(await mutateFile(file, [{ op: 'connect', source: 'Activity_Check', target: 'Activity_Loose' }], { dryRun: true, lintFrom: dir }));
    expect(codes(connected.warnings.resolved)).toEqual(['W_UNREACHABLE Activity_Loose']);
    expect(connected.validation.validators![0]).toMatchObject({ counts: { errors: 10, warnings: 0 }, leftOut: [{ count: 9 }] });
  });

  it('validate folds a list rule by hint: a real dead end keeps its own line and the fixing command', async () => {
    // Activity_Loose has an incoming flow and no outgoing one: a dead end among the findings of the missing lists
    const xml = listless(await model([...LINE, { op: 'add', kind: 'task', name: 'Ship', after: 'Activity_Check' }, { op: 'add', kind: 'task', name: 'Loose', in: 'Process_Order' }, { op: 'connect', source: 'Activity_Ship', target: 'Activity_Loose' }]));
    const engine = bpmnlintEngine();
    const lintValidator = bpmnlintValidator(engine, await resolveBpmnlintConfig(engine, { extends: 'bpmnlint:recommended' }));
    const lines = renderValidation(validationReport(await checkDoc(await Doc.fromXml(xml), { validators: [lintValidator] }))).split('\n');
    expect(lines).toContain('[bpmnlint error] no-implicit-end x3 [Event_Received, Activity_Check, Activity_Ship]: Element is an implicit end  (The element has sequence flows the file does not list under incoming / outgoing, which no-implicit-end reads (bpmnlint in CI reports it too); bpmn-cli writes those lists only where the file keeps them.)');
    expect(lines.find((outputLine) => outputLine.startsWith('[bpmnlint error] no-implicit-end Activity_Loose: Element is an implicit end  (Continue the flow (`bpmn add <file> <kind> "<Name>" --after Activity_Loose`)'))).toBeDefined();
  });

  it('event-based-gateway counts the outgoing list: validate lists it with the hint, a write that draws two branches does not, one branch is reported in both', async () => {
    const base = listless(await model([{ op: 'add', kind: 'start', name: 'Paid' }, { op: 'add', kind: 'end', name: 'Done', after: 'Event_Paid' }]));
    const branches: EditCommand[] = [
      { op: 'add', kind: 'eventBasedGateway', after: 'Event_Paid' },
      { op: 'add', kind: 'catch:timer', name: 'Timeout', flow: 'Flow_AfterPaidToDone' },
      { op: 'add', kind: 'catch:message', name: 'Answer', after: 'Gateway_AfterPaid', to: 'Event_Done' },
    ];
    const dir = repo({ extends: 'bpmnlint:recommended' }, { 'paid.bpmn': base });
    const file = join(dir, 'paid.bpmn');
    for (const lintBlocks of [false, true]) {
      const mutation = mutationReport(await mutateFile(file, branches, { dryRun: true, lintBlocks }));
      expect(codes(lintOf(mutation.warnings.added)), String(lintBlocks)).toEqual([]);
    }
    const two = await run((await mutateFile(file, branches, { dryRun: true })).xml);
    const gateway = lintOf(two.validation.errors).find((finding) => finding.code === 'event-based-gateway');
    expect(gateway).toMatchObject({ element: 'Gateway_AfterPaid', hint: expect.stringMatching(/^The element has sequence flows the file does not list under incoming \/ outgoing, which event-based-gateway reads/) });
    // one branch: a finding of the model, not of the lists
    const one = mutationReport(await mutateFile(file, branches.slice(0, 2), { dryRun: true }));
    expect(codes(lintOf(one.warnings.added))).toContain('event-based-gateway Gateway_AfterPaid');
    const single = lintOf((await run((await mutateFile(file, branches.slice(0, 2), { dryRun: true })).xml)).validation.errors).find((finding) => finding.code === 'event-based-gateway');
    expect(single?.hint).toBeUndefined();
  });
});
