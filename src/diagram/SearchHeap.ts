/**
 * Binary min-heap of search entries ordered by (f, h, insertion order); the
 * insertion order makes ties deterministic. Entries live in growable typed
 * arrays (index = insertion order), the heap holds their indices.
 */
export class SearchHeap {
  f = new Float64Array(256);
  h = new Float64Array(256);
  g = new Float64Array(256);
  state = new Int32Array(256);
  private heap = new Int32Array(256);
  private count = 0;
  size = 0;

  private before(a: number, b: number): boolean {
    const fa = this.f[a]!, fb = this.f[b]!;
    if (fa !== fb) return fa < fb;
    const ha = this.h[a]!, hb = this.h[b]!;
    return ha !== hb ? ha < hb : a < b;
  }

  private grow(): void {
    const n = this.f.length * 2;
    const f = new Float64Array(n), h = new Float64Array(n), g = new Float64Array(n), st = new Int32Array(n), hp = new Int32Array(n);
    f.set(this.f);
    h.set(this.h);
    g.set(this.g);
    st.set(this.state);
    hp.set(this.heap);
    [this.f, this.h, this.g, this.state, this.heap] = [f, h, g, st, hp];
  }

  push(state: number, g: number, h: number): void {
    if (this.count === this.f.length) this.grow();
    const id = this.count++;
    this.f[id] = g + h;
    this.h[id] = h;
    this.g[id] = g;
    this.state[id] = state;
    const a = this.heap;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(id, a[p]!)) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = id;
  }

  /** index of the smallest entry (read it from `state` / `g`), removed from the heap */
  pop(): number {
    const a = this.heap;
    const top = a[0]!;
    const last = a[--this.size]!;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const m = r < this.size && this.before(a[r]!, a[l]!) ? r : l;
      if (!this.before(a[m]!, last)) break;
      a[i] = a[m]!;
      i = m;
    }
    a[i] = last;
    return top;
  }
}
