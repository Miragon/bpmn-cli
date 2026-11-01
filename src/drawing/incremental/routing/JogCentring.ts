import { Polyline, type Box, type Point } from '../../../model/index.js';
import type { RouteScene } from './RouteScene.js';

interface Jog {
  vertical: boolean;
  from: number;
  to: number;
  at: number;
  low: number;
  high: number;
}

export class JogCentring {
  constructor(private readonly scene: RouteScene) {}

  centred(points: readonly Point[]): Point[] {
    let current = points;
    for (let index = 1; index + 2 < current.length; index++) {
      current = this.centreJog(current, index) ?? current;
    }
    return new Polyline(current).simplified();
  }

  private centreJog(points: readonly Point[], index: number): Point[] | undefined {
    const jog = this.jogAt(points, index);
    const room = jog && this.roomOf(jog);
    if (!jog || !room) {
      return undefined;
    }
    const centre = Math.round((room[0] + room[1]) / 2);
    if (Math.abs(centre - jog.at) < 1) {
      return undefined;
    }
    const moved = new Polyline(points).copy();
    const axis = jog.vertical ? 'x' : 'y';
    moved[index]![axis] = centre;
    moved[index + 1]![axis] = centre;
    const before = this.scene.score(points), after = this.scene.score(moved);
    return after.hits <= before.hits && after.penalty <= before.penalty ? moved : undefined;
  }

  private jogAt(points: readonly Point[], index: number): Jog | undefined {
    const previous = points[index - 1]!, jogStart = points[index]!, jogEnd = points[index + 1]!, next = points[index + 2]!;
    const vertical = jogStart.x === jogEnd.x;
    if (vertical ? previous.y !== jogStart.y || jogEnd.y !== next.y : previous.x !== jogStart.x || jogEnd.x !== next.x) {
      return undefined;
    }
    const along = (point: Point): number => (vertical ? point.x : point.y);
    const across = (point: Point): number => (vertical ? point.y : point.x);
    const direction = Math.sign(along(jogStart) - along(previous));
    if (direction === 0 || direction !== Math.sign(along(next) - along(jogEnd))) {
      return undefined;
    }
    const from = along(previous) + (index === 1 ? direction * this.scene.stub : 0);
    const to = along(next) - (index + 2 === points.length - 1 ? direction * this.scene.stub : 0);
    if (direction * (to - from) < 0) {
      return undefined;
    }
    return { vertical, from, to, at: along(jogStart), low: Math.min(across(jogStart), across(jogEnd)), high: Math.max(across(jogStart), across(jogEnd)) };
  }

  private roomOf(jog: Jog): [number, number] | undefined {
    const { obstacles, margin, source, target, stub } = this.scene;
    const blockers = [...obstacles.map((blocker) => blocker.grow(margin)), source.grow(stub), target.grow(stub)];
    let room: [number, number] | undefined = [Math.min(jog.from, jog.to), Math.max(jog.from, jog.to)];
    for (const blocker of blockers) {
      room = room && this.roomBeside(blocker, jog, room);
    }
    return room && room[1] >= room[0] ? room : undefined;
  }

  private roomBeside(blocker: Box, { vertical, at, low, high }: Jog, [lowest, highest]: [number, number]): [number, number] | undefined {
    const near = vertical ? blocker.x : blocker.y, far = vertical ? blocker.right : blocker.bottom;
    const start = vertical ? blocker.y : blocker.x, end = vertical ? blocker.bottom : blocker.right;
    if (end < low || start > high) {
      return [lowest, highest];
    }
    if (far <= at) {
      return [Math.max(lowest, far), highest];
    }
    return near >= at ? [lowest, Math.min(highest, near)] : undefined;
  }
}
