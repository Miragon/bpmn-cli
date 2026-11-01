import { describe, expect, it } from 'vitest';
import { SearchHeap } from '../../../../src/drawing/incremental/grid/SearchHeap.js';

describe('SearchHeap', () => {
  function drain(heap: SearchHeap): number[] {
    const states: number[] = [];
    while (heap.size) {
      states.push(heap.state[heap.pop()]!);
    }
    return states;
  }

  it('hands out the cheapest route first', () => {
    const heap = new SearchHeap();
    heap.push(1, 30, 0);
    heap.push(2, 10, 0);
    heap.push(3, 20, 0);

    expect(drain(heap)).toEqual([2, 3, 1]);
  });

  it('breaks a tie by the smaller estimate, then by arrival', () => {
    const heap = new SearchHeap();
    heap.push(1, 5, 5);
    heap.push(2, 8, 2);
    heap.push(3, 8, 2);

    expect(drain(heap)).toEqual([2, 3, 1]);
  });

  it('keeps its order when a search outgrows the first capacity', () => {
    const heap = new SearchHeap();
    for (let state = 600; state > 0; state--) {
      heap.push(state, state, 0);
    }

    expect(drain(heap).slice(0, 3)).toEqual([1, 2, 3]);
    expect(heap.total.length).toBeGreaterThanOrEqual(600);
  });
});
