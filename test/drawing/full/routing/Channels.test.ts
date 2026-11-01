import { describe, expect, it } from 'vitest';
import { Channels } from '../../../../src/drawing/full/routing/Channels.js';

describe('Channels', () => {
  it('gives two loops over one span different heights', () => {
    const channels = new Channels();

    expect(channels.claim(0, 100, 50, 15)).toBe(50);
    expect(channels.claim(100, 20, 50, 15)).toBe(65);
  });

  it('lets loops over apart spans share a height', () => {
    const channels = new Channels();
    channels.take(50, 0, 100);

    expect(channels.free(200, 300, 50, 15)).toBe(50);
  });

  it('knows the lowest channel, 0 without one', () => {
    const channels = new Channels();
    expect(channels.lowest()).toBe(0);

    channels.take(70, 0, 10);

    expect(channels.lowest()).toBe(70);
  });
});
