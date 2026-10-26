/**
 * Binary min-heap of search entries by (total, heuristic, insertion order), so ties are deterministic.
 * Entries live in growable typed arrays; the heap holds their indices.
 */
export class SearchHeap {
  total = new Float64Array(256);
  heuristic = new Float64Array(256);
  cost = new Float64Array(256);
  state = new Int32Array(256);
  private heap = new Int32Array(256);
  private count = 0;
  size = 0;

  private before(leftId: number, rightId: number): boolean {
    const leftTotal = this.total[leftId]!, rightTotal = this.total[rightId]!;
    if (leftTotal !== rightTotal) return leftTotal < rightTotal;
    const leftHeuristic = this.heuristic[leftId]!, rightHeuristic = this.heuristic[rightId]!;
    return leftHeuristic !== rightHeuristic ? leftHeuristic < rightHeuristic : leftId < rightId;
  }

  private grow(): void {
    const capacity = this.total.length * 2;
    const totals = new Float64Array(capacity), heuristics = new Float64Array(capacity), costs = new Float64Array(capacity), states = new Int32Array(capacity), heapSlots = new Int32Array(capacity);
    totals.set(this.total);
    heuristics.set(this.heuristic);
    costs.set(this.cost);
    states.set(this.state);
    heapSlots.set(this.heap);
    [this.total, this.heuristic, this.cost, this.state, this.heap] = [totals, heuristics, costs, states, heapSlots];
  }

  push(state: number, cost: number, heuristic: number): void {
    if (this.count === this.total.length) this.grow();
    const id = this.count++;
    this.total[id] = cost + heuristic;
    this.heuristic[id] = heuristic;
    this.cost[id] = cost;
    this.state[id] = state;
    const slots = this.heap;
    let slot = this.size++;
    while (slot > 0) {
      const parent = (slot - 1) >> 1;
      if (!this.before(id, slots[parent]!)) break;
      slots[slot] = slots[parent]!;
      slot = parent;
    }
    slots[slot] = id;
  }

  /** Read the entry from `state` / `g`. */
  pop(): number {
    const slots = this.heap;
    const top = slots[0]!;
    const last = slots[--this.size]!;
    let slot = 0;
    for (;;) {
      const leftChild = 2 * slot + 1;
      if (leftChild >= this.size) break;
      const rightChild = leftChild + 1;
      const smallerChild = rightChild < this.size && this.before(slots[rightChild]!, slots[leftChild]!) ? rightChild : leftChild;
      if (!this.before(slots[smallerChild]!, last)) break;
      slots[slot] = slots[smallerChild]!;
      slot = smallerChild;
    }
    slots[slot] = last;
    return top;
  }
}
