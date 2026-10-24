/** A scale as the notes and the `wrote` line print it: two decimals rounded down (0.7458: 0.74, never above the scale), two significant digits below 0.01. */
export function scaleText(scale: number): string {
  if (scale >= 0.01) return (Math.floor(scale * 100 + 1e-9) / 100).toFixed(2);
  return scale > 0 ? String(Number(scale.toPrecision(2))) : '0';
}
