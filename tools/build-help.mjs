import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TABLES = join(ROOT, 'src/cli/help/tables');
const TOPIC_FOLDERS = ['guide', 'project', 'tables'];
const CHECK_ONLY = process.argv.includes('--check');

const { BpmnError, kindsJson, OPS_SCHEMA } = await tsImport('../src/api/index.ts', import.meta.url);
const { ElementSlots, NewDocument, PropertyCatalog, ZEEBE } = await tsImport('../src/model/index.ts', import.meta.url);
const { Swatches } = await tsImport('../src/drawing/diagram/Swatches.ts', import.meta.url);

const { kinds, triggers } = kindsJson();

const FAMILY_TITLES = {
  task: 'Tasks',
  subProcess: 'Sub-processes',
  callActivity: 'Call activity',
  gateway: 'Gateways',
  event: 'Events',
  participant: 'Pools',
  lane: 'Lanes',
  data: 'Data',
  artifact: 'Artifacts',
};

const NESTED_HOSTS = {
  'bpmn:Message': 'on a message',
  'bpmn:MultiInstanceLoopCharacteristics': 'on `loop.`',
  'bpmn:MessageEventDefinition': 'on `definition.`',
  'bpmn:ConditionalEventDefinition': 'on `definition.`',
};

const EXIT_MEANINGS = {
  usage: 'usage: unknown command, flag, operation or key (`E_USAGE`)',
  model: 'model or validation error; `validate`: also an error of project lint',
  layout: 'layout error (`E_LAYOUT_*`)',
  io: 'file, parse or render error (`E_FILE_NOT_FOUND`, `E_PARSE`, `E_IMPORT_LOSSY`)',
  internal: 'internal error',
};

function firstClause(text) {
  const clause = text.replace(/ \([^)]*\)/g, '').split(/; |\. |, e\.g/)[0].replace(/\.$/, '');
  return clause.length > 70 ? clause.split(', ')[0] : clause;
}

function kindsTable() {
  const lines = ['# Kinds', '', '`bpmn add <file> <kind[:trigger]>`; aliases in parentheses.', ''];
  for (const [family, title] of Object.entries(FAMILY_TITLES)) {
    const members = kinds.filter((candidate) => candidate.family === family);
    lines.push(`- ${title}: ${members.map(({ kind, aliases }) => (aliases.length > 0 ? `${kind} (${aliases.join(', ')})` : kind)).join(', ')}`);
  }
  return lines;
}

function shortKind(kind) {
  return kinds.find((candidate) => candidate.kind === kind)?.aliases[0] ?? kind;
}

function triggersTable() {
  const lines = ['# Triggers', '', '`bpmn add <file> <kind>:<trigger> [key=value…]`. `timer=`: `R/PT1H` a cycle, `PT5M` a duration, a date a date.', ''];
  for (const { trigger, keys, kinds: hosts, alsoOn } of triggers) {
    const keyList = keys.length > 0 ? ` ${keys.map((key) => `\`${key}=\``).join(' ')}` : '';
    lines.push(`- \`${trigger}\`${keyList}: ${[...hosts, ...(alsoOn ?? [])].map(shortKind).join(', ')}`);
  }
  return lines;
}

function setKeysTable() {
  const triggerKeys = new Set(triggers.flatMap(({ keys }) => keys));
  const documented = PropertyCatalog.DOCS.filter(({ key, appliesTo }) => appliesTo !== 'event' || !triggerKeys.has(key));
  const lines = ['# Set keys', '', '`bpmn set <file> <id> key=value`; `key=` removes. The same on `add`, `retype`, `connect`. The trigger keys, such as `timer=`: `bpmn guide triggers`.'];
  for (const [appliesTo, keys] of Map.groupBy(documented, ({ appliesTo }) => appliesTo)) {
    lines.push('', `${appliesTo}:`);
    for (const { key, description } of keys) {
      lines.push(`- \`${key}\`: ${firstClause(description)}`);
    }
  }
  return lines;
}

function nestedKeysTable() {
  const { tree } = new NewDocument().create();
  const lines = ['# Nested keys', '', 'Keys of elements without an id, `<slot>.<key>`; each slot also takes `id`.'];
  for (const slot of ElementSlots.NAMES) {
    lines.push('', `\`${slot}.\`:`);
    for (const type of ElementSlots.TYPES[slot]) {
      const keys = PropertyCatalog.of(tree.build(type)).nestedKeys(slot).map((key) => key.slice(slot.length + 1)).filter((key) => key !== 'id');
      if (keys.length > 0) {
        lines.push(`- ${type.replace('bpmn:', '')}: ${keys.join(' ')}`);
      }
    }
  }
  return lines;
}

function homeOf(name) {
  if (ZEEBE.nestedOnly(name)) {
    return ZEEBE.containersOf(name).map((container) => `in ${container}`);
  }
  return Object.entries(NESTED_HOSTS).flatMap(([type, home]) => (ZEEBE.allowedOn(name, type) === true && ZEEBE.allowedOn(name, 'bpmn:Task') !== true ? [home] : []));
}

function zeebeElementsTable() {
  const lines = ['# Zeebe elements', '', '`bpmn ext add <file> <id> <type> attr=value`. `single`: one per element; `[…]`: its children.', ''];
  for (const name of ZEEBE.typeNames()) {
    const { attributes, children } = ZEEBE.type(name);
    const names = attributes.map((attribute) => attribute.name).filter((attribute) => !attribute.startsWith('modeler'));
    const parts = [...names, ...children.map((child) => `[${child.replace('zeebe:', '')}]`)];
    const home = homeOf(name).map((place) => ` ${place}`).join('');
    lines.push(`- \`${name}\`${ZEEBE.isSingle(name) ? ' single' : ''}${home}: ${parts.join(' ') || '-'}`);
  }
  return lines;
}

function exitCodesTable() {
  const rows = [[0, 'ok, warnings allowed'], [5, '`validate --strict` and warnings']];
  for (const [category, code] of Object.entries(BpmnError.EXIT_CODES)) {
    rows.push([code, EXIT_MEANINGS[category]]);
  }
  const sorted = rows.sort(([first], [second]) => first - second);
  return ['# Exit codes', '', ...sorted.map(([code, meaning]) => `- ${code}: ${meaning}`)];
}

function colorsTable() {
  const lines = ['# Colors', '', '`bpmn color <file> <ids…> --color <color>`; `default` removes it.', ''];
  for (const [name, { fill, stroke }] of Object.entries(Swatches.TABLE)) {
    lines.push(`- \`${name}\`: fill ${fill}, stroke ${stroke}`);
  }
  return lines;
}

function fieldList(entry) {
  return Object.entries(entry.properties)
    .filter(([key]) => key !== 'op')
    .map(([key]) => `${key}${entry.required.includes(key) ? '*' : ''}`)
    .join(' ') || '-';
}

function opsTable() {
  const definitions = OPS_SCHEMA.$defs;
  const operations = definitions.op.oneOf.map(({ $ref }) => definitions[$ref.split('/').at(-1)]);
  const lines = ['# Operations', '', '`bpmn apply <file> <ops.json>`: `[{"op": "<name>", …}]`; `*` required. Keys are the flags in lowerCamelCase, `set` holds the `key=value`s. `as`, `flowAs`, `outAs`, `refAs`, `joinAs` name what an operation creates, `"as": "$check"`, for later ones.', ''];
  for (const operation of operations) {
    lines.push(`- \`${operation.title}\`: ${fieldList(operation)}`);
  }
  lines.push(`- split \`branches\`: ${fieldList(definitions.branch)}`, `- split \`nodes\`: ${fieldList(definitions.node)}`);
  return lines;
}

const WRITTEN_TABLES = {
  'kinds.md': kindsTable,
  'triggers.md': triggersTable,
  'set-keys.md': setKeysTable,
  'nested-keys.md': nestedKeysTable,
  'zeebe-elements.md': zeebeElementsTable,
  'exit-codes.md': exitCodesTable,
  'colors.md': colorsTable,
  'ops.md': opsTable,
};

function committedText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function compareWithCatalogues(tables) {
  const stale = tables.filter(({ path, text }) => committedText(path) !== text).map(({ path }) => path);
  for (const path of stale) {
    console.error(`build-help: ${path} differs from the catalogues; run npm run build`);
  }
  process.exit(stale.length > 0 ? 1 : 0);
}

function copyTopicsTo(distribution) {
  for (const folder of TOPIC_FOLDERS) {
    cpSync(join(ROOT, 'src/cli/help', folder), join(distribution, folder), { recursive: true });
  }
}

const tables = Object.entries(WRITTEN_TABLES).map(([name, write]) => ({ path: join(TABLES, name), text: `${write().join('\n')}\n` }));
if (CHECK_ONLY) {
  compareWithCatalogues(tables);
}
mkdirSync(TABLES, { recursive: true });
for (const { path, text } of tables) {
  writeFileSync(path, text);
}
copyTopicsTo(resolve(process.argv[2] ?? join(ROOT, 'dist')));
