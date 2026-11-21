/** Disjoint-set (union-find) with path compression and union by size. */
export class UnionFind<T = string> {
  private parent = new Map<T, T>();
  private size = new Map<T, number>();

  constructor(elements: Iterable<T> = []) {
    for (const e of elements) this.add(e);
  }

  add(x: T): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.size.set(x, 1);
    }
  }

  has(x: T): boolean {
    return this.parent.has(x);
  }

  find(x: T): T {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  /** Returns true when two different sets were merged. */
  union(a: T, b: T): boolean {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return false;
    if (this.size.get(ra)! < this.size.get(rb)!) [ra, rb] = [rb, ra];
    this.parent.set(rb, ra);
    this.size.set(ra, this.size.get(ra)! + this.size.get(rb)!);
    return true;
  }

  connected(a: T, b: T): boolean {
    return this.find(a) === this.find(b);
  }

  setSize(x: T): number {
    return this.size.get(this.find(x))!;
  }

  /** Groups of elements, each sorted by insertion order of their root lookups. */
  components(): T[][] {
    const groups = new Map<T, T[]>();
    for (const x of this.parent.keys()) {
      const r = this.find(x);
      const list = groups.get(r) ?? [];
      list.push(x);
      groups.set(r, list);
    }
    return [...groups.values()];
  }
}
