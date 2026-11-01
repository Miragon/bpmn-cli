import type { Side } from '../../plane/ShapeSides.js';

export class RouteCosts {
  static readonly BEND = 150;
  static readonly AVOID = 100;
  static readonly CROSS = 200;
  static readonly END_ZONE = 25;
  static readonly OVERLAP = 300;
  static readonly HIT = 1_000_000;
  static readonly STUB_TURN = 500;
  static readonly NEAR = 1;
  static readonly MIN_STUB = 15;
  static readonly OVERLAP_TOL = 2;
  static readonly PORT_OFFSET = 10;
  static readonly PORT_SLOPE = 40;
  static readonly SRC_RANK: readonly number[] = [0, 2, 5, 9];
  static readonly TGT_RANK: readonly number[] = [0, 1, 4, 8];
  static readonly REGION_PAD = 100;
  static readonly THIN_MARGIN = 3;
  static readonly EPS = 1e-6;
  static readonly DX: readonly number[] = [1, 0, -1, 0];
  static readonly DY: readonly number[] = [0, 1, 0, -1];
  static readonly OUTWARD: Readonly<Record<Side, number>> = { right: 0, bottom: 1, left: 2, top: 3 };
}
