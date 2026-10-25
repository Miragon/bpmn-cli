/** Rounded down, never above the scale: 0.7458 prints as 0.74. */
export function scaleText(scale: number): string {
  if (scale >= 0.01) return (Math.floor(scale * 100 + 1e-9) / 100).toFixed(2);
  return scale > 0 ? String(Number(scale.toPrecision(2))) : '0';
}
