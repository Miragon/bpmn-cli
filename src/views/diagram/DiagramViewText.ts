import { ProblemKinds, type LayoutProblem, type ProblemKind } from '../../scoring/index.js';
import { ElementLine, type ElementRef } from '../lines/index.js';
import type { WideGap } from './DiagramColumns.js';

export type RowFrameKind = 'process' | 'collaboration' | 'participant' | 'lane' | 'subProcess';

export interface RowFrame {
  id: string;
  kind: RowFrameKind;
  name?: string | undefined;
  parent?: string | undefined;
  rows: ElementRef[][];
  columns: number[][];
  gaps?: Array<{ row: number; before: number[] }> | undefined;
}

export interface PlaneRows {
  id: string;
  root: string;
  columns: number;
  gaps: WideGap[];
  frames: RowFrame[];
}

export interface DiagramFacts {
  score: number;
  counts: Record<ProblemKind, number>;
  problems: readonly LayoutProblem[];
  rows: PlaneRows[];
}

export class DiagramViewText {
  private static readonly SHOWN_INTRUDERS = 2;

  constructor(private readonly result: DiagramFacts) {}

  private static problemCells(problem: LayoutProblem): string {
    const separator = ProblemKinds.recordOf(problem.kind).symmetric && problem.ids.length === 2 ? ' x ' : ', ';
    return `${problem.ids.join(separator)}${problem.detail ? ` ${problem.detail}` : ''}`;
  }

  private static intrusions(problems: readonly LayoutProblem[]): Array<[string, string]> {
    const byFrame = new Map<string, string[]>();
    for (const { ids } of problems) {
      byFrame.set(ids[1]!, [...(byFrame.get(ids[1]!) ?? []), ids[0]!]);
    }
    return [...byFrame].map(([frame, intruders]) => {
      const shown = intruders.slice(0, DiagramViewText.SHOWN_INTRUDERS);
      const more = intruders.length - shown.length;
      return ['frameIntrusion', `${frame}: ${shown.join(', ')}${more ? `, +${more}` : ''}`];
    });
  }

  private static rowText(frame: RowFrame, index: number): string {
    const gaps = frame.gaps?.find(({ row }) => row === index)?.before ?? [];
    const cells = frame.rows[index]!.map(({ id }, position) => `${gaps.includes(position) ? ' … ' : ', '}c${frame.columns[index]?.[position] ?? 0} ${id}`);
    return `row ${index + 1}: ${cells.join('').slice(2)}`;
  }

  private static planeLines(plane: PlaneRows): string[] {
    const depth = new Map<string, number>();
    const span = plane.columns ? `  c0..c${plane.columns - 1}` : '';
    const wide = plane.gaps.length ? `; wide gaps: ${plane.gaps.map(({ after, width }) => `c${after}|c${after + 1} ${width}px`).join(', ')}` : '';
    return plane.frames.flatMap((frame) => {
      const level = frame.parent === undefined ? 0 : (depth.get(frame.parent) ?? 0) + 1;
      depth.set(frame.id, level);
      const head = `${ElementLine.INDENT.repeat(level)}${new ElementLine(frame).ref}${level === 0 ? `${span}${wide}` : ''}`;
      const rows = frame.rows.map((_row, index) => DiagramViewText.rowText(frame, index));
      return [`${head}${rows.length ? `   ${rows[0]}` : ''}`, ...rows.slice(1).map((row) => `${' '.repeat(head.length + 3)}${row}`)];
    });
  }

  text(): string {
    return [this.scoreLine(), ...this.problemLines(), ...this.result.rows.flatMap(DiagramViewText.planeLines)].join('\n');
  }

  private scoreLine(): string {
    const { score, counts } = this.result;
    const present = ProblemKinds.ALL.filter((kind) => counts[kind] > 0).map((kind) => `${kind} ${counts[kind]}`);
    return `score ${score}: ${present.join(', ') || 'no layout problems'}`;
  }

  private problemLines(): string[] {
    const { problems } = this.result;
    const intrusions = problems.filter(({ kind }) => kind === 'frameIntrusion');
    const rows: Array<[string, string]> = [...DiagramViewText.intrusions(intrusions), ...problems.filter(({ kind }) => kind !== 'frameIntrusion').map((problem): [string, string] => [problem.kind, DiagramViewText.problemCells(problem)])];
    const width = Math.max(0, ...rows.map(([kind]) => kind.length));
    return rows.map(([kind, cells]) => `${ElementLine.INDENT}${kind.padEnd(width)}  ${cells}`);
  }
}
