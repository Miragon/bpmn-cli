import { readFileSync, writeFileSync } from 'node:fs';

const CALLS = {
  right: ([x]) => `${x}.right`,
  bottom: ([x]) => `${x}.bottom`,
  center: ([x]) => `${x}.center`,
  cx: ([x]) => `${x}.center.x`,
  cy: ([x]) => `${x}.center.y`,
  copyBox: ([x]) => `${x}.copy()`,
  copyPoints: ([x]) => `new Polyline(${x}).copy()`,
  sameBox: (args) => `Box.same(${args.join(', ')})`,
  equalBoxes: ([a, b]) => `Box.same(${a}, ${b}, 0)`,
  samePoints: ([a, b, t]) => `new Polyline(${a}).same(new Polyline(${b})${t ? `, ${t}` : ''})`,
  overlaps: ([a, ...rest]) => `${a}.overlaps(${rest.join(', ')})`,
  inside: ([a, ...rest]) => `${a}.isInside(${rest.join(', ')})`,
  containsPoint: ([a, ...rest]) => `${a}.contains(${rest.join(', ')})`,
  union: ([a, b]) => `${a}.union(${b})`,
  unionAll: ([a]) => `Box.unionAll(${a})`,
  translate: ([x, ...rest]) => `${x}.translate(${rest.join(', ')})`,
  translatePoints: ([p, ...rest]) => `new Polyline(${p}).translate(${rest.join(', ')})`,
  translateShape: ([s, ...rest]) => `${s}.translate(${rest.join(', ')})`,
  translateEdge: ([e, ...rest]) => `${e}.translate(${rest.join(', ')})`,
  grow: ([b, by]) => `${b}.grow(${by})`,
  segmentHits: ([a, b, ...rest]) => `new Segment(${a}, ${b}).hits(${rest.join(', ')})`,
  segmentHitsBox: ([a, b, ...rest]) => `new Segment(${a}, ${b}).hitsBounds(${rest.join(', ')})`,
  segmentsCross: ([a, b, c, d]) => `new Segment(${a}, ${b}).crosses(new Segment(${c}, ${d}))`,
  properCross: ([a, b]) => `${a}.crosses(${b})`,
  polylinesCross: ([a, b]) => `new Polyline(${a}).crosses(new Polyline(${b}))`,
  pathHits: ([p, ...rest]) => `new Polyline(${p}).hits(${rest.join(', ')})`,
  toSegments: ([p]) => `new Polyline(${p}).segments()`,
  dedupe: ([p]) => `new Polyline(${p}).deduped()`,
  hitCount: ([p, ...rest]) => `new Polyline(${p}).hitCount(${rest.join(', ')})`,
  pathHitsAny: ([p, ...rest]) => `new Polyline(${p}).hitsAny(${rest.join(', ')})`,
  isOrthogonal: ([p, ...rest]) => `new Polyline(${p}).isOrthogonal(${rest.join(', ')})`,
  roundPoints: ([p]) => `new Polyline(${p}).rounded()`,
  degenerate: ([p]) => `new Polyline(${p}).rounded().length < 2`,
  simplify: ([p]) => `new Polyline(${p}).simplified()`,
  median: ([v]) => `new Samples(${v}).median()`,
  clamp: ([v, low, high]) => `new Interval(${low}, ${high}).clamp(${v})`,
  borderDistance: ([b, p]) => `new BoxBorder(${b}).distanceTo(${p})`,
  borderPoint: ([b, p]) => `new BoxBorder(${b}).pointTowards(${p})`,
  is: ([x, t]) => `${x}.is(${t})`,
  raw: ([x, p], type) => `${x}?.peek${type}(${p})`,
  rawList: ([x, p]) => `(${x}?.list(${p}) ?? [])`,
  idOf: ([x]) => `${x}?.peek<string>('id')`,
  boxOf: ([x]) => `DiagramIndex.boxOf(${x})`,
  many: ([x, p]) => `${x}.list(${p})`,
  addTo: ([x, p, ...children]) => `${x}.add(${[p, ...children].join(', ')})`,
  removeFrom: ([x, p, c]) => `${x}.remove(${p}, ${c})`,
  nameOf: ([x]) => `${x}.el.name`,
  outgoingOf: ([x]) => `${x}.outgoing`,
  isEvent: ([x]) => `${x}.isEvent`,
  boundaryLeft: ([x]) => `${x}.keepsBoundaryLeft`,
  shiftNode: ([x, ...rest]) => `${x}.shift(${rest.join(', ')})`,
  shiftScope: ([x, ...rest]) => `new Scope(${x}).shift(${rest.join(', ')})`,
  routedArtifacts: ([x]) => `new Scope(${x}).routedArtifacts()`,
  routedSegments: ([x]) => `new Scope(${x}).routedSegments()`,
  growToFit: ([x]) => `new Scope(${x}).growToFit()`,
  obstacles: ([x, ...rest]) => `new Scope(${x}).obstacles(${rest.join(', ')})`,
  stretchLane: ([x, width]) => `${x}.stretch(${width})`,
  laneDepth: ([x]) => `LaneBox.depthOf(${x})`,
  defaultSizeOf: ([x]) => `ShapeSizes.of(${x})`,
  annotationSize: ([x]) => `ShapeSizes.ofAnnotation(${x})`,
  labelSize: (args) => `TextMetrics.labelSize(${args.join(', ')})`,
  titleDepth: (args) => `TextMetrics.titleDepth(${args.join(', ')})`,
  titleBox: (args) => `Frames.titleBox(${args.join(', ')})`,
  textWidth: (args) => `TextMetrics.width(${args.join(', ')})`,
  wrapLines: (args) => `TextMetrics.wrap(${args.join(', ')})`,
  activitySize: (args) => `TextMetrics.activitySize(${args.join(', ')})`,
  hasExternalLabel: ([x]) => `DShape.hasExternalLabel(${x}.kind)`,
  defaultLabelSide: ([x]) => `DShape.defaultLabelSide(${x})`,
  labelAt: ([s, ...rest]) => `${s}.labelAt(${rest.join(', ')})`,
  labelSideOf: ([s, ...rest]) => `${s}.labelSide(${rest.join(', ')})`,
  edgeLabelSideOf: ([e]) => `${e}.labelSide()`,
  edgeLabelAt: ([e, ...rest]) => `${e}.labelAt(${rest.join(', ')})`,
  attachedSide: (args) => `ShapeSides.attached(${args.join(', ')})`,
  gatewaySide: (args) => `ShapeSides.ofGateway(${args.join(', ')})`,
  defaultSides: (args) => `ShapeSides.of(${args.join(', ')})`,
  span: (args) => `ShapeSides.span(${args.join(', ')})`,
  pointOn: (args) => `ShapeSides.pointOn(${args.join(', ')})`,
  near: ([box, axis]) => `BoxAxis.of(${axis}).near(${box})`,
  far: ([box, axis]) => `BoxAxis.of(${axis}).far(${box})`,
  shiftBox: ([box, axis, delta]) => `BoxAxis.of(${axis}).shift(${box}, ${delta})`,
  resize: ([box, axis, delta]) => `BoxAxis.of(${axis}).resize(${box}, ${delta})`,
  bandOf: ([box, axis]) => `BoxAxis.of(${axis}).bandOf(${box})`,
  centreInBand: ([box, band, axis]) => `BoxAxis.of(${axis}).centreInBand(${box}, ${band})`,
  overlapsBand: ([box, band, axis]) => `BoxAxis.of(${axis}).overlapsBand(${box}, ${band})`,
  pointInBand: ([point, band, axis]) => `BoxAxis.of(${axis}).pointInBand(${point}, ${band})`,
  beyondBand: ([box, band, axis]) => `BoxAxis.of(${axis}).beyondBand(${box}, ${band})`,
  isAnnotationLine: ([x]) => `Semantics.isAnnotationLine(${x})`,
};

const PLANE_METHODS = { isLeaf: ([s]) => `${s}.isLeaf`, leaves: ([p]) => `${p}.leaves()`, contentBox: ([p, ...rest]) => `${p}.contentBox(${rest.join(', ')})`, contentOf: ([p, ...rest]) => `${p}.contentOf(${rest.join(', ')})`, boundariesOf: ([p, ...rest]) => `${p}.boundariesOf(${rest.join(', ')})`, spacingOf: ([p, ...rest]) => `${p}.spacing(${rest.join(', ')})`, verticalBand: ([p]) => `${p}.verticalBand()`, planeWith: (args) => `Plane.with(${args.join(', ')})` };
const FRAME_METHODS = { of: ([p, ...rest]) => `new Frames(${p}).of(${rest.join(', ')})`, within: ([p, ...rest]) => `new Frames(${p}).within(${rest.join(', ')})`, chain: ([p, ...rest]) => `new Frames(${p}).chain(${rest.join(', ')})` };

const SIMPLE = [
  [/\bEl\b(?!ement)/g, 'BpmnElement'],
  [/\bDiagramReader\b/g, 'PlaneReader'],
  [/\.\$parent\b/g, '.parent'],
  [/\.\$type\b/g, '.type'],
  [/\bMETRICS\b/g, 'ShapeSizes.GAPS'],
  [/\bSIZES\.task\b/g, 'ShapeSizes.TASK'],
  [/\bSIZES\.event\b/g, 'ShapeSizes.EVENT'],
  [/\bSIZES\.gateway\b/g, 'ShapeSizes.GATEWAY'],
  [/\bSIZES\.dataObject\b/g, 'ShapeSizes.DATA_OBJECT'],
  [/\bSIZES\.dataStore\b/g, 'ShapeSizes.DATA_STORE'],
  [/\bSIZES\.subProcessPadding\b/g, 'ShapeSizes.SUB_PROCESS_PADDING'],
  [/\bSIZES\.subProcessMin\b/g, 'ShapeSizes.SUB_PROCESS_MIN'],
  [/\bSIZES\.participantHeader\b/g, 'ShapeSizes.PARTICIPANT_HEADER'],
  [/\bSIZES\.laneHeader\b/g, 'ShapeSizes.LANE_HEADER'],
  [/\bSIZES\.lanePadding\b/g, 'ShapeSizes.LANE_PADDING'],
  [/\bSIZES\.blackBoxHeight\b/g, 'ShapeSizes.BLACK_BOX_HEIGHT'],
  [/\bSIZES\.poolGap\b/g, 'ShapeSizes.POOL_GAP'],
  [/\bSIZES\.outerMargin\b/g, 'ShapeSizes.OUTER_MARGIN'],
  [/\bChannelRouter\.countCrossings\b/g, 'RoutingArea.crossingsOf'],
  [/\bDETACHED_GAP\b/g, 'Plane.DETACHED_GAP'],
  [/\bRISE_KEEP\b/g, 'GNode.RISE_KEEP'],
  [/\bLABEL_LINE\b/g, 'TextMetrics.LABEL_LINE'],
  [/\bBOTTOM_ROOM\b/g, 'TextMetrics.BOTTOM_ROOM'],
  [/\bORDER\[/g, 'DShape.LABEL_SIDES['],
  [/\{ x: ([^{},]+), y: ([^{},]+), width: ([^{},]+), height: ([^{},]+) \}/g, 'new Box($1, $2, $3, $4)'],
  [/\{ x: ([^{},]+), y: ([^{},]+) \}/g, 'new Point($1, $2)'],
  [/\{ x, y \}(?! =|:)/g, 'new Point(x, y)'],
  [/\{ \.\.\.(\w+(?:\.\w+)*) \}/g, '$1.copy()'],
];

function closingOf(text, open) {
  let depth = 0;
  let quote;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      quote = char === '\\' ? (index++, quote) : char === quote ? undefined : quote;
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if ('([{'.includes(char)) {
      depth++;
    } else if (')]}'.includes(char) && --depth === 0) {
      return index;
    }
  }
  return -1;
}

function argumentsIn(text) {
  const parts = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if ('([{'.includes(text[index]) || text[index] === "'" || text[index] === '`') {
      index = text[index] === "'" || text[index] === '`' ? text.indexOf(text[index], index + 1) : closingOf(text, index);
    } else if (text[index] === ',') {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  return [...parts, text.slice(start).trim()].filter(Boolean);
}

function needsParens(argument) {
  const bare = argument.replace(/'[^']*'|`[^`]*`/g, "''").replace(/\([^()]*\)|\[[^[\]]*\]|<[^<>]*>/g, '');
  return /[\s?]/.test(bare) && !/^new /.test(bare);
}

function rewriteOnce(text, prefix, table) {
  const names = Object.keys(table).join('|');
  const call = new RegExp(`(?<![\\w.$])${prefix}(${names})(<[^()]*?>)?\\(`, 'g');
  let result = '';
  let last = 0;
  for (let match = call.exec(text); match; match = call.exec(text)) {
    const open = match.index + match[0].length - 1;
    const close = closingOf(text, open);
    const isDeclaration = /(function|=|:)\s*$/.test(text.slice(Math.max(0, match.index - 10), match.index)) && text.slice(close + 1, close + 4).includes('=>');
    if (close < 0 || isDeclaration) {
      continue;
    }
    const rawArguments = argumentsIn(rewriteOnce(text.slice(open + 1, close), prefix, table));
    const shown = rawArguments.map((argument) => (needsParens(argument) ? `(${argument})` : argument));
    result += text.slice(last, match.index) + table[match[1]](shown, match[2] ?? '');
    last = close + 1;
    call.lastIndex = close + 1;
  }
  return result + text.slice(last);
}

export function codemod(source) {
  let text = source.replace(/^[ \t]*\/\*\*[\s\S]*?\*\/\n/gm, '').replace(/^[ \t]*\/\/.*\n/gm, '');
  text = rewriteOnce(text, '', CALLS);
  text = rewriteOnce(text, 'PlaneQuery\\.', PLANE_METHODS);
  text = rewriteOnce(text, 'Frames\\.', FRAME_METHODS);
  for (const [pattern, replacement] of SIMPLE) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

if (process.argv[2]) {
  for (const path of process.argv.slice(2)) {
    writeFileSync(path, codemod(readFileSync(path, 'utf8')));
  }
}
