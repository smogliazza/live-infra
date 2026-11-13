/**
 * Cola de prioridad (min-heap) ordenada por (time, seq).
 * `seq` garantiza un orden total y determinista entre jobs del mismo instante.
 */
export interface Job {
  time: number;
  seq: number;
  label: string;
  run: () => void;
}

export class Scheduler {
  private heap: Job[] = [];
  private nextSeq = 0;

  get size(): number {
    return this.heap.length;
  }

  schedule(time: number, label: string, run: () => void): Job {
    const job: Job = { time, seq: this.nextSeq++, label, run };
    this.heap.push(job);
    this.up(this.heap.length - 1);
    return job;
  }

  peek(): Job | undefined {
    return this.heap[0];
  }

  pop(): Job | undefined {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (top && last && this.heap.length > 0) {
      this.heap[0] = last;
      this.down(0);
    }
    return top;
  }

  private less(a: Job, b: Job): boolean {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq);
  }

  private up(i: number): void {
    const h = this.heap;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }

  private down(i: number): void {
    const h = this.heap;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && this.less(h[l]!, h[m]!)) m = l;
      if (r < h.length && this.less(h[r]!, h[m]!)) m = r;
      if (m === i) return;
      [h[i], h[m]] = [h[m]!, h[i]!];
      i = m;
    }
  }
}
