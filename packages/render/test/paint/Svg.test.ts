import { describe, expect, it } from 'vitest';
import { Box } from '../../src/read/Box.js';
import { Svg } from '../../src/paint/Svg.js';

describe('Svg', () => {
  it('writes coordinates with 2 decimals and never as -0', () => {
    expect([Svg.number(1.005), Svg.number(10), Svg.number(-0.001)]).toEqual(['1', '10', '0']);
  });

  it('escapes an id in an attribute', () => {
    expect(Svg.attribute('a&b<c>"d"')).toBe('a&amp;b&lt;c&gt;&quot;d&quot;');
  });

  it('writes the attributes of a box', () => {
    expect(Svg.box(new Box(1, 2.5, 3, 4))).toBe('x="1" y="2.5" width="3" height="4"');
  });

  it('leaves the scale out of a glyph drawn at size 1', () => {
    expect(Svg.at(10, 20, 1, 'x')).toBe('<g transform="translate(10 20)">x</g>');
    expect(Svg.at(10, 20, 0.5, 'x')).toBe('<g transform="translate(10 20) scale(0.5)">x</g>');
  });

  it('writes lines of text 1.2 font sizes apart and escapes them', () => {
    const svg = Svg.lines(['a < b', 'c'], 5, 10, 10, '#000', 'middle');
    expect(svg).toBe('<text font-size="10" fill="#000" text-anchor="middle"><tspan x="5" y="10">a &lt; b</tspan><tspan x="5" y="22">c</tspan></text>');
  });
});
